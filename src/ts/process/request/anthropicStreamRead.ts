import { mergeAnthropicStreamUsage } from '../../usage/usageParse'
import type { TokenUsage } from '../../usage/usageTypes'

/** The parse context of a recorded Anthropic stream. The stream is read with no rule: it extracts nothing. */
export interface AnthropicStreamParseContext {
    kind: 'anthropic-stream'
}

/**
 * What the Anthropic stream reader reports to its caller. It is the whole input of the reader besides the bytes, so the
 * live request and a recovered record read a stream the same way.
 */
export interface AnthropicStreamIo {
    /** Called by `reportUsage` with the merged usage, once a `message_delta` usage was seen. */
    onUsage?: (usage: TokenUsage) => void
    /** Called when an in-band error ends the attempt as a failure. */
    onFailed?: () => void
    /** Asked when an overload error arrives; true makes `feed` answer `'overload'` so the caller can refetch. */
    retryOverload?: () => boolean
}

export interface AnthropicStreamReader {
    /**
     * Reads the next bytes of the stream. It stops at the first line that asks for a retry and drops the rest of that
     * read; the caller then calls `reset` and continues with the retried stream.
     */
    feed(bytes: Uint8Array): 'overload' | null
    /** The reply text so far. */
    text(): string
    /** Closes an open thinking block and returns the final text. An unterminated last line is never read. */
    finish(): string
    /** Reports the usage seen, once a `message_delta` carried it; a stopped or failed stream reports nothing. */
    reportUsage(): void
    /** Starts over for a retried stream: no text, no open thinking block, no partial line, no usage. */
    reset(): void
}

/** A stateful line reader of an Anthropic event stream; it reads no request argument or database. */
export function createAnthropicStreamReader(io: AnthropicStreamIo): AnthropicStreamReader {
    let text = ''
    let thinking = false
    // The decoded text after the last LF: at most one unfinished line carried to the next read.
    let tail = ''
    let decoder = new TextDecoder()
    // Usage of the response being read: `message_start` gives the start, the last `message_delta` the cumulative update.
    let startUsage: unknown = null
    let deltaUsage: unknown = null

    const parseEvent = (e: string): 'overload' | undefined => {
        try {
            const parsedData = JSON.parse(e)

            if(parsedData?.type === 'message_start'){
                startUsage = parsedData?.message?.usage ?? null
            }
            if(parsedData?.type === 'message_delta' && parsedData?.usage){
                deltaUsage = parsedData.usage
            }

            if(parsedData?.type === 'content_block_delta'){
                if(parsedData?.delta?.type === 'text' || parsedData.delta?.type === 'text_delta'){
                    if(thinking){
                        text += "</Thoughts>\n\n"
                        thinking = false
                    }
                    text += parsedData.delta?.text ?? ''
                }

                if(parsedData?.delta?.type === 'thinking' || parsedData.delta?.type === 'thinking_delta'){
                    if(!thinking){
                        text += "<Thoughts>\n"
                        thinking = true
                    }
                    text += parsedData.delta?.thinking ?? ''
                }

                if(parsedData?.delta?.type === 'redacted_thinking'){
                    if(!thinking){
                        text += "<Thoughts>\n"
                        thinking = true
                    }
                    text += '\n{{redacted_thinking}}\n'
                }
            }

            if(parsedData?.type === 'error'){
                const errormsg:string = parsedData?.error?.message
                if(errormsg && errormsg.toLocaleLowerCase().includes('overload') && io.retryOverload?.() === true){
                    return 'overload'
                }
                // An in-band error ends the attempt as a failure: with no reported usage it is not counted.
                io.onFailed?.()
                text += "Error:" + parsedData?.error?.message
            }
        }
        catch (error) {
        }
    }

    return {
        feed(bytes) {
            const decoded = decoder.decode(bytes, {stream: true})
            let lines: string[] = []
            if(decoded.includes('\n')){
                lines = (tail + decoded).split('\n')
                tail = lines.pop() ?? ''
            }
            else{
                tail += decoded
            }
            for(const line of lines){
                if(line.startsWith('data: ') && parseEvent(line.slice(6)) === 'overload'){
                    return 'overload'
                }
            }
            return null
        },
        text() {
            return text
        },
        finish() {
            if(thinking){
                text += "</Thoughts>\n\n"
                thinking = false
            }
            return text
        },
        reportUsage() {
            try {
                if(deltaUsage === null){
                    return
                }
                const usage = mergeAnthropicStreamUsage(startUsage, deltaUsage)
                if(usage){
                    io.onUsage?.(usage)
                }
            } catch (error) {}
        },
        reset() {
            thinking = false
            text = ''
            tail = ''
            startUsage = null
            deltaUsage = null
            decoder = new TextDecoder()
        },
    }
}
