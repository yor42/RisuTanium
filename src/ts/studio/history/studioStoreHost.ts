// The worker side of the Studio history store: everything the worker does with a message. It hosts the
// unchanged device adapter behind the port and keeps, per owner, a mirror of the entries of the last
// record the proxy posted, decoded or loaded, so an entry the proxy does not post again resolves to the very object the adapter's
// baseline holds and the adapter's delta rules run as they do on the main thread.
//
// It takes the adapter and the reply channel as parameters and touches no worker global, so a suite can
// run it in-process. Handling a message never throws and never drops it: every request gets an ack for
// its seq, and a message that carries no usable seq gets `fatal`.

import type { DeletedItem, OwnerRecord, RestorePoint, Step } from './historyModel'
import type { OwnerKey } from './ownerPhase'
import type { LoadResult, SaveResult, StudioHistoryStore } from './studioHistoryStore'
import {
    applyEdits,
    parseToWorker,
    workerToken,
    type FromWorker,
    type LoadTokens,
    type PutEntry,
    type SaveMessage,
    type SaveReply,
    type Tok,
} from './studioStoreProtocol'

export interface StudioStoreHost {
    handle(data: unknown): void
}

type Kind = PutEntry['k']

function isKind<K extends Kind>(entry: PutEntry | undefined, kind: K): entry is Extract<PutEntry, { k: K }> {
    return entry !== undefined && entry.k === kind
}

export function createStudioStoreHost(adapter: StudioHistoryStore, send: (message: FromWorker) => void): StudioStoreHost {
    // Per owner, the entries of the last record posted or loaded, by token.
    const mirror = new Map<OwnerKey, Map<Tok, PutEntry>>()
    let tokenCounter = 0

    // A reply that cannot be posted (it cannot be cloned) is replaced by the failure answer for its request.
    function emit(message: FromWorker, fallback?: FromWorker): void {
        try {
            send(message)
        } catch {
            if (!fallback) {
                return
            }
            try {
                send(fallback)
            } catch {
                // The channel itself is gone; the proxy's error handling covers it.
            }
        }
    }

    function ackOpen(seq: number, reply: 'ok' | 'unavailable'): void {
        emit({ t: 'ack', seq, op: 'open', reply }, { t: 'ack', seq, op: 'open', reply: 'unavailable' })
    }

    function ackLoad(seq: number, reply: LoadResult, tokens: LoadTokens | null): void {
        emit({ t: 'ack', seq, op: 'load', reply, tokens }, { t: 'ack', seq, op: 'load', reply: { kind: 'failed' }, tokens: null })
    }

    function ackSave(seq: number, reply: SaveReply): void {
        emit({ t: 'ack', seq, op: 'save', reply }, { t: 'ack', seq, op: 'save', reply: { kind: 'unwritable' } })
    }

    function lose(owner: OwnerKey, seq: number): void {
        mirror.delete(owner)
        ackSave(seq, { kind: 'unwritable', mirrorLost: true })
    }

    function open(seq: number): void {
        adapter.open().then(
            (reply) => ackOpen(seq, reply),
            () => ackOpen(seq, 'unavailable'),
        )
    }

    function adopt(owner: OwnerKey, record: OwnerRecord): LoadTokens {
        const held = new Map<Tok, PutEntry>()
        const fresh = (): Tok => {
            tokenCounter += 1
            return workerToken(tokenCounter)
        }
        const hold = (entry: PutEntry): Tok => {
            held.set(entry.tok, entry)
            return entry.tok
        }
        const tokens: LoadTokens = {
            done: record.done.map((value) => hold({ k: 's', tok: fresh(), value })),
            undone: record.undone.map((value) => hold({ k: 's', tok: fresh(), value })),
            deleted: record.deleted.map((value) => hold({ k: 'd', tok: fresh(), value })),
            restore: record.restore === null ? null : hold({ k: 'r', tok: fresh(), value: record.restore }),
        }
        mirror.set(owner, held)
        return tokens
    }

    function load(seq: number, owner: OwnerKey): void {
        adapter.load(owner).then(
            (reply) => {
                let tokens: LoadTokens | null = null
                try {
                    if (reply.kind === 'ok') {
                        tokens = adopt(owner, reply.record)
                    } else {
                        mirror.delete(owner)
                    }
                } catch {
                    mirror.delete(owner)
                    ackLoad(seq, { kind: 'failed' }, null)
                    return
                }
                ackLoad(seq, reply, tokens)
            },
            () => {
                mirror.delete(owner)
                ackLoad(seq, { kind: 'failed' }, null)
            },
        )
    }

    // The synchronous part (resolving the tokens, replacing the mirror, starting the adapter's save) finishes
    // inside the message's own task, so saves reach the adapter in the order they were posted.
    function save(message: SaveMessage): void {
        const { seq, owner } = message
        const posted = new Map<Tok, PutEntry>()
        for (const entry of message.put) {
            posted.set(entry.tok, entry)
        }
        const prior = mirror.get(owner)
        // A delta resolves its base against the mirror as it was before this save, never against this message's
        // own entries: the base may be an entry this very save replaces. An unheld base, a base of the other
        // kind or an edit that does not fit throws, and the handler answers `mirrorLost`.
        for (const entry of message.delta) {
            const base = prior?.get(entry.base)
            if (entry.k === 's' && isKind(base, 's')) {
                posted.set(entry.tok, { k: 's', tok: entry.tok, value: applyEdits(base.value, entry.edits) })
            } else if (entry.k === 'r' && isKind(base, 'r')) {
                posted.set(entry.tok, { k: 'r', tok: entry.tok, value: applyEdits(base.value, entry.edits) })
            } else {
                lose(owner, seq)
                return
            }
        }
        const next = new Map<Tok, PutEntry>()
        const find = (tok: Tok): PutEntry | undefined => posted.get(tok) ?? prior?.get(tok)

        const steps = (toks: readonly Tok[]): Step[] | null => {
            const out: Step[] = []
            for (const tok of toks) {
                const entry = find(tok)
                if (!isKind(entry, 's')) {
                    return null
                }
                next.set(tok, entry)
                out.push(entry.value)
            }
            return out
        }
        const done = steps(message.done)
        const undone = steps(message.undone)
        const deleted: DeletedItem[] = []
        for (const tok of message.deleted) {
            const entry = find(tok)
            if (!isKind(entry, 'd')) {
                lose(owner, seq)
                return
            }
            next.set(tok, entry)
            deleted.push(entry.value)
        }
        let restore: RestorePoint | null = null
        if (message.restore !== null) {
            const entry = find(message.restore)
            if (!isKind(entry, 'r')) {
                lose(owner, seq)
                return
            }
            next.set(message.restore, entry)
            restore = entry.value
        }
        if (!done || !undone) {
            lose(owner, seq)
            return
        }

        mirror.set(owner, next)
        const record: OwnerRecord = { ownerKey: message.ownerKey, touchedAt: message.touchedAt, done, undone, deleted, restore }
        adapter.save(owner, record, new Set(message.protect)).then(
            (reply: SaveResult) => ackSave(seq, reply),
            () => ackSave(seq, { kind: 'unwritable' }),
        )
    }

    adapter.onClosed(() => emit({ t: 'closed' }))

    return {
        handle(data) {
            const message = parseToWorker(data)
            if (!message) {
                emit({ t: 'fatal' })
                return
            }
            try {
                switch (message.t) {
                    case 'open':
                        open(message.seq)
                        break
                    case 'load':
                        load(message.seq, message.owner)
                        break
                    case 'save':
                        save(message)
                        break
                }
            } catch {
                // Whatever went wrong while handling, the request still gets its answer; a save also drops its
                // owner's mirror, so the proxy's next save posts every entry.
                switch (message.t) {
                    case 'open':
                        ackOpen(message.seq, 'unavailable')
                        break
                    case 'load':
                        mirror.delete(message.owner)
                        ackLoad(message.seq, { kind: 'failed' }, null)
                        break
                    case 'save':
                        lose(message.owner, message.seq)
                        break
                }
            }
        },
    }
}
