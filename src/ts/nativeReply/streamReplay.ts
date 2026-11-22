import type { RunSubject } from '../process/chatOrigin'
import type { OpenAIChatReadRule } from '../process/request/openAI/chatBodyParse'
import { createAnthropicStreamReader } from '../process/request/anthropicStreamRead'
import { openAIChatStreamTransform } from '../process/request/openAI/chatStreamTransform'
import { responsesStreamTransform, type ResponsesReadRule } from '../process/request/openAI/responsesStreamTransform'
import type { StreamResponseChunk } from '../process/request/request'
import {
    geminiDisplayText,
    geminiStreamTransform,
    type GeminiReadRule,
    type GeminiSignatureRecord,
} from '../process/request/geminiStreamTransform'
import type { UsageMeterState } from '../usage/usageTypes'
import type { StreamReplyBlob } from './blob'

/**
 * What a replay is given: the bytes of a recorded OpenAI-compatible chat stream and the rule the request read it with.
 * `complete` says whether the bytes are a whole body or a prefix of one; the OpenAI read treats both the same way, and the
 * flag is part of the entry so the readers of other providers share its shape.
 */
export interface OpenAIChatStreamReplayInput {
    bytes: Uint8Array
    complete: boolean
    rule: OpenAIChatReadRule
    subject?: RunSubject
}

/**
 * Reads the bytes through the live transform and returns the last text it emitted, which is the reply as the stream's
 * consumer ends with it. The usage the stream reported goes to `meter` once, at the end. Nothing is trimmed, escaped or
 * script-processed here, and a body without text (a JSON body, an error-only body, a `[DONE]` before any content) gives
 * an empty text; the status is the caller's to check.
 */
export async function replayOpenAIChatStream(
    input: OpenAIChatStreamReplayInput,
    meter: UsageMeterState,
): Promise<{ modelText: string }> {
    const transform = openAIChatStreamTransform(input.rule, {
        subject: input.subject,
        onUsage: (usage) => meter.report(usage),
    })
    const bytes = input.bytes
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            if (bytes.length > 0) {
                controller.enqueue(bytes)
            }
            controller.close()
        },
    })
    // The readable is drained while the source is piped in, as the live request does; writing and closing before reading
    // would wait on a full queue.
    const piping = source.pipeTo(transform.writable)
    const reader = transform.readable.getReader()
    let last: StreamResponseChunk | undefined
    for (;;) {
        const read = await reader.read()
        if (read.done) {
            break
        }
        if (read.value) {
            last = read.value
        }
    }
    await piping
    // Numeric keys other than "0" are further candidates; only the first one is recovered.
    return { modelText: last?.['0'] || '' }
}

/** The bytes of a recorded Responses API stream and the rule the request read it with. */
export interface ResponsesStreamReplayInput {
    bytes: Uint8Array
    complete: boolean
    rule: ResponsesReadRule
    subject?: RunSubject
}

/**
 * Reads the bytes through the live Responses transform and returns the last text it emitted, which is the reply as the
 * stream's consumer ends with it (an error event makes that text the error JSON, as the live page shows it). The usage the
 * stream reported goes to `meter` once, at the end.
 */
export async function replayResponsesStream(
    input: ResponsesStreamReplayInput,
    meter: UsageMeterState,
): Promise<{ modelText: string }> {
    const transform = responsesStreamTransform(input.rule, {
        subject: input.subject,
        onUsage: (usage) => meter.report(usage),
    })
    const bytes = input.bytes
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            if (bytes.length > 0) {
                controller.enqueue(bytes)
            }
            controller.close()
        },
    })
    // The readable is drained while the source is piped in, as the live request does; writing and closing before reading
    // would wait on a full queue.
    const piping = source.pipeTo(transform.writable)
    const reader = transform.readable.getReader()
    let last: StreamResponseChunk | undefined
    for (;;) {
        const read = await reader.read()
        if (read.done) {
            break
        }
        if (read.value) {
            last = read.value
        }
    }
    await piping
    return { modelText: last?.['0'] || '' }
}

/** The bytes of a recorded Anthropic stream; the stream is read with no rule. */
export interface AnthropicStreamReplayInput {
    bytes: Uint8Array
    complete: boolean
}

/**
 * Reads the bytes through the live Anthropic reader and returns the reply text. The replay never retries: an overload
 * error reads as an ordinary in-band error, and an unterminated last line is dropped as the live read drops it. An open
 * thinking block is closed for a prefix too, as a stopped live stream closes it. The usage goes to `meter`, which an
 * in-band error also marks failed.
 */
export async function replayAnthropicStream(
    input: AnthropicStreamReplayInput,
    meter: UsageMeterState,
): Promise<{ modelText: string }> {
    const reader = createAnthropicStreamReader({
        onUsage: (usage) => meter.report(usage),
        onFailed: () => meter.markFailed(),
    })
    reader.feed(input.bytes)
    reader.reportUsage()
    return { modelText: reader.finish() }
}

export type { GeminiSignatureRecord }

/** The bytes of a recorded Gemini stream and the rule the request read it with. */
export interface GeminiStreamReplayInput {
    bytes: Uint8Array
    complete: boolean
    rule: GeminiReadRule
    subject?: RunSubject
}

/**
 * Reads the bytes through the live Gemini transform one complete line at a time (each write ends at its LF byte, which
 * never occurs inside a multibyte character), then the unterminated rest. The live transform emits one snapshot per read,
 * so the last emission under the per-line partition is everything committed before a `[DONE]` or a malformed line halts
 * it; a coarser feed would stop at the first halt before emitting. The thought signatures the read meets are collected,
 * never written: only the apply writes them, and only those whose token is in the text it writes. The usage goes to `meter`.
 * A tool call in the stream is not followed: only the text is recovered.
 */
export async function replayGeminiStream(
    input: GeminiStreamReplayInput,
    meter: UsageMeterState,
): Promise<{ modelText: string, signatures: GeminiSignatureRecord[] }> {
    const collected: GeminiSignatureRecord[] = []
    const transform = geminiStreamTransform(input.rule, {
        onUsage: (usage) => meter.report(usage),
        onSignature: (record) => collected.push(record),
    })
    const bytes = input.bytes
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            let from = 0
            for (let at = bytes.indexOf(0x0A, from); at !== -1; at = bytes.indexOf(0x0A, from)) {
                controller.enqueue(bytes.subarray(from, at + 1))
                from = at + 1
            }
            if (from < bytes.length) {
                controller.enqueue(bytes.subarray(from))
            }
            controller.close()
        },
    })
    // The readable is drained while the source is piped in, as the live request does; writing before reading would wait on
    // a full queue.
    const piping = source.pipeTo(transform.writable)
    const reader = transform.readable.getReader()
    let last: StreamResponseChunk | undefined
    for (;;) {
        const read = await reader.read()
        if (read.done) {
            break
        }
        if (read.value) {
            last = read.value
        }
    }
    await piping
    const modelText = last ? geminiDisplayText(last, input.rule, input.subject, '') : ''
    return {
        modelText,
        signatures: collected.filter((record) => modelText.includes('{{inlayeddata::' + record.id + '}}')),
    }
}

/**
 * The one kind switch of a stream replay: the bytes go to the reader of the blob's own parse kind. Only a Gemini replay
 * returns signatures.
 */
export async function replayStreamRecord(
    blob: StreamReplyBlob,
    bytes: Uint8Array,
    complete: boolean,
    subject: RunSubject,
    meter: UsageMeterState,
): Promise<{ modelText: string, signatures: GeminiSignatureRecord[] }> {
    const parse = blob.parse
    switch (parse.kind) {
        case 'openai-chat-stream': {
            const { modelText } = await replayOpenAIChatStream({
                bytes,
                complete,
                rule: {
                    deepSeekThinkingOutput: parse.deepSeekThinkingOutput,
                    extractJson: parse.extractJson,
                    jsonSchema: parse.jsonSchema,
                    multiGen: parse.multiGen,
                },
                subject,
            }, meter)
            return { modelText, signatures: [] }
        }
        case 'openai-responses-stream': {
            const { modelText } = await replayResponsesStream({
                bytes,
                complete,
                rule: { extractJson: parse.extractJson, jsonSchema: parse.jsonSchema },
                subject,
            }, meter)
            return { modelText, signatures: [] }
        }
        case 'anthropic-stream': {
            const { modelText } = await replayAnthropicStream({ bytes, complete }, meter)
            return { modelText, signatures: [] }
        }
        case 'gemini-stream':
            return await replayGeminiStream({
                bytes,
                complete,
                rule: {
                    extractJson: parse.extractJson,
                    jsonSchema: parse.jsonSchema,
                    streamThoughts: parse.streamThoughts,
                    saveSignatures: parse.saveSignatures,
                    signatureSource: parse.signatureSource,
                    signatureFormat: parse.signatureFormat,
                },
                subject,
            }, meter)
    }
}
