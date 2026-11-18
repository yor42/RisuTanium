import { deflateSync } from 'fflate'

/**
 * The packing worker of `readStubsForExport` (`drive/exportInline.ts`): raw-deflates a stub unit entry's encoded body off
 * the main thread. It imports only fflate, so it carries no measurement code. The bytes it returns are exactly those
 * `deflateSync(bytes, { level: 1 })` gives on the main thread, which is what the main-thread fallback of the client runs.
 */

/** A job: the encoded body of one stub entry, and the id its reply is matched by. */
export interface PackRequest {
    id: number
    bytes: Uint8Array
}

export type PackReply = { id: number, packed: Uint8Array } | { id: number, error: string }

function isPackRequest(data: unknown): data is PackRequest {
    if (typeof data !== 'object' || data === null) {
        return false
    }
    const candidate = data as { id?: unknown, bytes?: unknown }
    return typeof candidate.id === 'number' && Number.isInteger(candidate.id) && candidate.bytes instanceof Uint8Array
}

/** The reply to one message: the packed body under the message's id, or the id and the reason it could not be packed. */
export function handlePackMessage(data: unknown): PackReply {
    if (!isPackRequest(data)) {
        const id = typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'number' ? (data as { id: number }).id : -1
        return { id, error: 'malformed pack message' }
    }
    try {
        return { id: data.id, packed: deflateSync(data.bytes, { level: 1 }) }
    } catch (error) {
        return { id: data.id, error: error instanceof Error ? error.message : 'the body could not be packed' }
    }
}

// Wires the handler only inside a worker; a page or a test that imports this module for the handler is untouched.
if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event: MessageEvent<unknown>) => {
        const reply = handlePackMessage(event.data)
        if ('packed' in reply) {
            // fflate returns an exactly sized copy, so the transfer moves only the packed bytes.
            self.postMessage(reply, { transfer: [reply.packed.buffer as ArrayBuffer] })
        } else {
            self.postMessage(reply)
        }
    }
}
