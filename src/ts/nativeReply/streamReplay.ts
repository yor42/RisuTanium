import type { RunSubject } from '../process/chatOrigin'
import type { OpenAIChatReadRule } from '../process/request/openAI/chatBodyParse'
import { createAnthropicStreamReader } from '../process/request/anthropicStreamRead'
import { openAIChatStreamTransform } from '../process/request/openAI/chatStreamTransform'
import { responsesStreamTransform, type ResponsesReadRule } from '../process/request/openAI/responsesStreamTransform'
import type { StreamResponseChunk } from '../process/request/request'
import type { InlaySignature } from '../process/files/inlays'
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

/** A Gemini thought signature collected by a replay and written, when its token is in the written text, by the apply. */
export interface GeminiSignatureRecord {
    id: string
    signature: InlaySignature
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
    }
}
