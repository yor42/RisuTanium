/**
 * Re-chunks a response body so that no chunk ends inside a multibyte character.
 *
 * A reader that decodes each chunk on its own turns a character split across two reads into U+FFFD. The
 * decoder here is created once per body and keeps the pending bytes between chunks, so every emitted chunk holds
 * whole characters only. Nothing is added or removed apart from that: no line breaks are inserted, and a body
 * that ends inside a character still emits the decoder's flush output.
 *
 * A response without a body is returned as is. Otherwise the returned Response keeps the status, status text and
 * headers of the original.
 */
export function wholeCharacterStream(response: Response): Response {
    if (!response.body) {
        return response
    }

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            const text = decoder.decode(chunk, { stream: true })
            if (text.length > 0) {
                controller.enqueue(encoder.encode(text))
            }
        },
        flush(controller) {
            const rest = decoder.decode()
            if (rest.length > 0) {
                controller.enqueue(encoder.encode(rest))
            }
        },
    }))

    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
}
