/**
 * Body readers that never touch the Body mixin (`text`, `json`, `arrayBuffer`, ...).
 *
 * A hidden Android page can be frozen while a reply arrives. The native event stream of `fetchNative`
 * still delivers into the page, and `ReadableStream.getReader()` reads it without a task hop, but a
 * Body-mixin read on the same Response waits on a task that a frozen page never runs. Replies that must
 * be delivered while frozen are therefore read only through these helpers.
 */

/** Collects every chunk of the stream and joins them once. */
export async function readBodyBytes(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) {
                break
            }
            if (value && value.length > 0) {
                chunks.push(value)
                total += value.length
            }
        }
    } finally {
        reader.releaseLock()
    }
    if (chunks.length === 1) {
        return chunks[0]
    }
    const joined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.length
    }
    return joined
}

/** Decodes the whole body once, so a UTF-8 character split across chunks stays intact. */
export async function readBodyText(res: Response): Promise<string> {
    if (res.body === null) {
        return ''
    }
    return new TextDecoder('utf-8').decode(await readBodyBytes(res.body))
}

export async function parseJsonBody(res: Response): Promise<unknown> {
    return JSON.parse(await readBodyText(res))
}
