import type { RunSubject } from '../process/chatOrigin'
import type { OpenAIChatReadRule } from '../process/request/openAI/chatBodyParse'
import { openAIChatStreamTransform } from '../process/request/openAI/chatStreamTransform'
import type { StreamResponseChunk } from '../process/request/request'
import type { UsageMeterState } from '../usage/usageTypes'

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
