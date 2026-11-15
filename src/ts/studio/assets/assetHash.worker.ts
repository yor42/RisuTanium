// The hash worker of Check bytes. The page posts one piece at a time as a transfer and waits for its
// acknowledgement, so one piece is in flight; the worker feeds each to an incremental SHA-256 and answers the
// digest when the asset ends. Nothing here touches a store.

import { Sha256 } from '../../assetHash'

export type HashWorkerRequest =
    | { t: 'begin', id: number }
    | { t: 'piece', id: number, buffer: ArrayBuffer }
    | { t: 'end', id: number }
    | { t: 'abandon', id: number }

export type HashWorkerReply =
    | { t: 'piece', id: number }
    | { t: 'digest', id: number, hex: string }

/** The worker's message handler; `reply` posts to the page. One asset is hashed at a time. */
export function createHashWorkerHandler(reply: (message: HashWorkerReply) => void): (message: HashWorkerRequest) => void {
    let current: { id: number, hash: Sha256 } | null = null
    return (message) => {
        if (message.t === 'begin') {
            current = { id: message.id, hash: new Sha256() }
            return
        }
        if (current === null || current.id !== message.id) {
            return
        }
        if (message.t === 'piece') {
            current.hash.update(new Uint8Array(message.buffer))
            reply({ t: 'piece', id: message.id })
        } else if (message.t === 'end') {
            reply({ t: 'digest', id: message.id, hex: current.hash.digestHex() })
            current = null
        } else {
            current = null
        }
    }
}

// Wires the handler only inside a worker; a page or a test that imports this module for the handler is untouched.
if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    const handle = createHashWorkerHandler((message) => self.postMessage(message))
    self.onmessage = (event: MessageEvent<HashWorkerRequest>) => handle(event.data)
}
