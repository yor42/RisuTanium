// The main-thread side of the pack judge: implements intake's `PackJudge` over a module worker. Every call spawns its own
// worker, posts only sheet text, and terminates the worker when the call settles. There is no main-thread fallback: a spawn
// failure, a timeout, a worker error or an answer that does not pass `readJudgement` rejects, and intake turns every
// rejection into `couldNotCheck`. The validator is imported as types only, so it never joins the main-thread bundle.
import type { AreaSheetJudgement, FontFaceBlock, LintError, PackSheetsJudgement, ResourceSpan } from './index'
import type { PackJudge } from './intake'
import { spawnJudgeWorker } from './worker/spawnJudgeWorker'

/** What the client needs of a worker: `Worker` satisfies it, and so does a test channel. */
export interface JudgeWorkerLike {
    postMessage(message: JudgeRequest): void
    terminate(): void
    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void
}
export interface JudgeRequest { id: number; sheets: { chat?: string } }

export const JUDGE_TIMEOUT_MS = 60_000

export class JudgeUnavailableError extends Error {}
export class JudgeTimeoutError extends Error {}
export class JudgeProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrors(value: unknown): LintError[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const errors: LintError[] = []
    for (const item of value) {
        if (!isRecord(item) || typeof item.selector !== 'string' || typeof item.prop !== 'string' || typeof item.why !== 'string') {
            return null
        }
        errors.push({ selector: item.selector, prop: item.prop, why: item.why })
    }
    return errors
}

/** Safe-integer offsets in order, each span inside the canonical text and starting with the token its form names. */
function readResources(value: unknown, canonical: string): ResourceSpan[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const spans: ResourceSpan[] = []
    let previousEnd = 0
    for (const item of value) {
        if (!isRecord(item)) {
            return null
        }
        const { start, end, raw, target, form } = item
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
            return null
        }
        if (typeof raw !== 'string' || typeof target !== 'string' || (form !== 'url-token' && form !== 'string')) {
            return null
        }
        if (start < previousEnd || start >= end || end > canonical.length) {
            return null
        }
        const opening = form === 'url-token' ? canonical.slice(start, start + 4).toLowerCase() === 'url(' : /^["']/.test(canonical.slice(start, start + 1))
        if (!opening) {
            return null
        }
        spans.push({ start, end, raw, target, form })
        previousEnd = end
    }
    return spans
}

function readFontFaceBlocks(value: unknown): FontFaceBlock[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const blocks: FontFaceBlock[] = []
    for (const item of value) {
        if (!isRecord(item)) {
            return null
        }
        const { start, end, text } = item
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || typeof text !== 'string') {
            return null
        }
        blocks.push({ start, end, text })
    }
    return blocks
}

function readAreaSheet(value: unknown): AreaSheetJudgement | null {
    if (!isRecord(value) || !isRecord(value.result) || typeof value.canonical !== 'string') {
        return null
    }
    const { ok, errors, name } = value.result
    const errorList = readErrors(errors)
    if (typeof ok !== 'boolean' || errorList === null) {
        return null
    }
    const resources = readResources(value.resources, value.canonical)
    const fontFaceBlocks = readFontFaceBlocks(value.fontFaceBlocks)
    if (resources === null || fontFaceBlocks === null) {
        return null
    }
    return { result: { ok, errors: errorList, name: typeof name === 'string' ? name : '' }, canonical: value.canonical, resources, fontFaceBlocks }
}

/** Narrows a worker answer into a fresh judgement, or null when any part is out of shape. Only the chat area is read. */
export function readJudgement(value: unknown): PackSheetsJudgement | null {
    if (!isRecord(value) || typeof value.ok !== 'boolean' || !isRecord(value.areas)) {
        return null
    }
    const areas: PackSheetsJudgement['areas'] = {}
    if (value.areas.chat !== undefined) {
        const chat = readAreaSheet(value.areas.chat)
        if (chat === null) {
            return null
        }
        areas.chat = chat
    }
    return { ok: value.ok, areas }
}

let nextRequestId = 0

export function createJudgeClient(options: { spawn?: () => JudgeWorkerLike; timeoutMs?: number } = {}): PackJudge {
    const spawn = options.spawn ?? spawnJudgeWorker
    const timeoutMs = options.timeoutMs ?? JUDGE_TIMEOUT_MS
    return (sheets) => new Promise<PackSheetsJudgement>((resolve, reject) => {
        let worker: JudgeWorkerLike
        try {
            worker = spawn()
        } catch (error) {
            reject(new JudgeUnavailableError(`the judge worker could not start: ${String(error)}`))
            return
        }
        nextRequestId += 1
        const id = nextRequestId
        let settled = false
        const timer = setTimeout(() => settle(() => reject(new JudgeTimeoutError(`the judge gave no answer within ${timeoutMs} ms`))), timeoutMs)
        function settle(finish: () => void): void {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            worker.terminate()
            finish()
        }
        worker.addEventListener('message', (event) => {
            const data: unknown = (event as MessageEvent<unknown>).data
            if (!isRecord(data) || data.id !== id) {
                return
            }
            if (data.ok === true) {
                const judgement = readJudgement(data.judgement)
                settle(() => judgement === null ? reject(new JudgeProtocolError('the judge answered with a malformed judgement')) : resolve(judgement))
            } else {
                settle(() => reject(new Error(typeof data.error === 'string' ? data.error : 'the judge failed')))
            }
        })
        worker.addEventListener('messageerror', () => settle(() => reject(new JudgeProtocolError('the judge answer could not be read'))))
        worker.addEventListener('error', () => settle(() => reject(new JudgeUnavailableError('the judge worker failed'))))
        const request: JudgeRequest = { id, sheets: {} }
        if (sheets.chat !== undefined) {
            request.sheets.chat = sheets.chat
        }
        try {
            worker.postMessage(request)
        } catch (error) {
            settle(() => reject(new JudgeUnavailableError(`the judge request could not be sent: ${String(error)}`)))
        }
    })
}
