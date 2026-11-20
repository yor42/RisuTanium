import { DBState } from '../stores.svelte'
import { ChatTokenizer, tokenize } from '../tokenizer'
import type { OpenAIChat } from '../process/index.svelte'
import type { requestDataResponse, StreamResponseChunk } from '../process/request/request'
import { recordUsage } from './usageLedger'
import { createUsageMeter } from './usageMeter'
import { usagePurposeOf } from './usagePurpose'
import { applyUsageRetention } from './usageRetention'
import type { UsageEntry, UsageMeterState, UsageMode, UsagePurpose } from './usageTypes'

/**
 * Usage capture of one `requestChatDataMain` attempt. Invariants:
 *  - It never throws into a request, never delays it and never changes its result: a stream is wrapped by a
 *    pass-through that forwards the same chunk objects, the same error object and the same cancel reason.
 *  - An attempt settles at most once. Reported usage is recorded at once; the estimate for an attempt without
 *    reported usage runs afterwards and is never awaited by the request.
 *  - A failed attempt (a `fail` result, a throw, a stream that errored, or an attempt the provider parser marked
 *    failed) is counted only when it holds reported usage. A user Stop is not a failure and falls back to the estimate.
 */

/** What capture reads from the request argument; `RequestDataArgumentExtended` satisfies it. */
export interface UsageCaptureArg {
    usageMeter?: UsageMeterState
    usagePurpose?: UsagePurpose
    usageInputEstimate?: number
    mainSend?: boolean
    previewBody?: boolean
    aiModel?: string
    formated?: OpenAIChat[]
}

type Settlement = 'finished' | 'failed'

/** Starts a fresh meter on the argument: a meter left by an earlier attempt on a reused argument is never reused. */
export function beginUsageCapture(arg: UsageCaptureArg): UsageMeterState {
    const meter = createUsageMeter()
    arg.usageMeter = meter
    return meter
}

/** The ledger's model label: routed entries carry the model they route to. */
export function usageModelKey(aiModel: string, db: {
    openrouterRequestModel?: string
    customProxyRequestModel?: string
    nanogptRequestModel?: string
    ollamaModel?: string
    ollamaCloudModel?: string
} | undefined): string {
    switch (aiModel) {
        case 'openrouter': return `openrouter>${db?.openrouterRequestModel ?? ''}`
        case 'reverse_proxy': return `reverse_proxy>${db?.customProxyRequestModel ?? ''}`
        case 'nanogpt': return `nanogpt>${db?.nanogptRequestModel ?? ''}`
        case 'ollama-hosted': return `ollama>${db?.ollamaModel ?? ''}`
        case 'ollama-cloud': return `ollama>${db?.ollamaCloudModel ?? ''}`
        default: return aiModel
    }
}

function textOfMultiline(result: [string, string][]): string {
    return result.map((pair) => pair[1]).join('\n')
}

async function estimateTokens(inputEstimate: number | undefined, formated: OpenAIChat[] | undefined, text: string): Promise<{ input: number, output: number } | null> {
    try {
        let input = inputEstimate
        if (input === undefined) {
            const tokenizer = new ChatTokenizer(0, 'noName')
            input = 0
            for (const chat of formated ?? []) {
                input += await tokenizer.tokenizeChat(chat)
            }
        }
        const output = text ? await tokenize(text) : 0
        return { input, output }
    } catch (error) {
        return null
    }
}

/** Everything the settle step reads off the argument, taken synchronously so a later change to it cannot leak in. */
function snapshotAttempt(arg: UsageCaptureArg, mode: UsageMode) {
    const db = DBState.db
    return {
        meter: arg.usageMeter,
        modelKey: usageModelKey(arg.aiModel ?? '', db),
        purpose: usagePurposeOf(arg, mode),
        inputEstimate: arg.usageInputEstimate,
        formated: arg.formated,
    }
}

type Attempt = ReturnType<typeof snapshotAttempt>

function record(attempt: Attempt, entry: Pick<UsageEntry, 'reported' | 'estimated'>): void {
    try {
        const now = new Date()
        // Pruning first frees room under the key cap; in an unchanged month this is one string compare.
        applyUsageRetention(DBState.db, now)
        recordUsage(DBState.db?.statics, { modelKey: attempt.modelKey, purpose: attempt.purpose, ...entry }, now)
    } catch (error) {}
}

function finishAttempt(attempt: Attempt, how: Settlement, outputText: string): void {
    try {
        const reported = attempt.meter?.reported() ?? null
        if (reported !== null) {
            record(attempt, { reported, estimated: null })
            return
        }
        if (how === 'failed' || attempt.meter?.failed()) {
            return
        }
        void estimateTokens(attempt.inputEstimate, attempt.formated, outputText)
            .then((estimated) => record(attempt, { reported: null, estimated }))
            .catch(() => {})
    } catch (error) {}
}

/** Pass-through of `inner`. Pull-based with no read-ahead; settles exactly once on close, error or cancel. */
function wrapStream(inner: ReadableStream<StreamResponseChunk>, settle: (how: Settlement, lastText: string) => void): ReadableStream<StreamResponseChunk> {
    const reader = inner.getReader()
    let lastText = ''
    let settled = false
    const settleOnce = (how: Settlement) => {
        if (settled) {
            return
        }
        settled = true
        try {
            settle(how, lastText)
        } catch (error) {}
    }
    return new ReadableStream<StreamResponseChunk>({
        async pull(controller) {
            let read: ReadableStreamReadResult<StreamResponseChunk>
            try {
                read = await reader.read()
            } catch (error) {
                settleOnce('failed')
                controller.error(error)
                return
            }
            if (read.done) {
                settleOnce('finished')
                controller.close()
                return
            }
            try {
                lastText = read.value?.['0'] ?? lastText
            } catch (error) {}
            controller.enqueue(read.value)
        },
        cancel(reason) {
            settleOnce('finished')
            return reader.cancel(reason)
        },
    }, { highWaterMark: 0 })
}

/**
 * Settles the attempt that produced `result` and returns the result the request hands on: the same object unless it
 * is a stream, which is replaced by the pass-through. A `previewBody` attempt is never recorded.
 */
export function settleUsage(arg: UsageCaptureArg, mode: UsageMode, result: requestDataResponse): requestDataResponse {
    try {
        if (arg.previewBody || !arg.usageMeter) {
            return result
        }
        const attempt = snapshotAttempt(arg, mode)
        switch (result.type) {
            case 'streaming':
                return { ...result, result: wrapStream(result.result, (how, lastText) => finishAttempt(attempt, how, lastText)) }
            case 'multiline':
                finishAttempt(attempt, 'finished', textOfMultiline(result.result))
                return result
            case 'success':
                finishAttempt(attempt, 'finished', result.result)
                return result
            default:
                finishAttempt(attempt, 'failed', '')
                return result
        }
    } catch (error) {
        return result
    }
}

/** An attempt that threw: counted only when a tool round already reported usage. */
export function settleUsageFailure(arg: UsageCaptureArg, mode: UsageMode): void {
    try {
        if (arg.previewBody || !arg.usageMeter) {
            return
        }
        finishAttempt(snapshotAttempt(arg, mode), 'failed', '')
    } catch (error) {}
}
