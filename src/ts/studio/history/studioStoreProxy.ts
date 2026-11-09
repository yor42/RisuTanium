// The main-thread side of the Studio history store: an implementation of the frozen `StudioHistoryStore`
// port that forwards to a dedicated module worker hosting the IndexedDB adapter. This realm imports no
// serializer, planner or eviction function and builds no database adapter, so no history is encoded and no
// IndexedDB request is made on the main thread; a page that cannot start the worker has an unavailable
// store (memory-only, with the existing banner), never a main-thread one.
//
// What changed is decided here by object identity, as the adapter's own walk does: every entry object gets
// a token once, and `posted` holds, per owner, the entries the worker's mirror holds, by token. A save
// posts the entries whose tokens are not in `posted` and the four token lists, synchronously, before it
// returns, so the page-hide flush reaches the worker inside the hide task. A changed step or restore point
// whose base (the held step with the same id, or the held restore point) is in `posted` travels as the
// edits from that base instead of in full.

import type { OwnerRecord } from './historyModel'
import type { OwnerKey } from './ownerPhase'
import type { LoadResult, OpenResult, SaveResult, StudioHistoryStore } from './studioHistoryStore'
import {
    diffEntry,
    parseFromWorker,
    proxyToken,
    type DeltaEntry,
    type FromWorker,
    type LoadTokens,
    type PutEntry,
    type SaveMessage,
    type Tok,
    type ToWorker,
} from './studioStoreProtocol'

// What the proxy needs of a worker: `Worker` satisfies it, and so does a test channel.
export interface StudioWorkerLike {
    postMessage(message: ToWorker): void
    terminate(): void
    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void
}

export interface StudioStoreProxyOptions {
    // Starts the worker. A throw means the page cannot run a module worker.
    spawn?: () => StudioWorkerLike
}

function spawnModuleWorker(): StudioWorkerLike {
    return new Worker(new URL('./studioStoreWorker.ts', import.meta.url), { type: 'module' })
}

// The held entries a changed entry can be diffed against: a step by id, and the restore point.
interface BaseIndex {
    steps: Map<string, Extract<PutEntry, { k: 's' }>>
    restore: Extract<PutEntry, { k: 'r' }> | null
}

type Pending =
    | { op: 'open'; resolve: (result: OpenResult) => void }
    | { op: 'load'; owner: OwnerKey; resolve: (result: LoadResult) => void }
    | { op: 'save'; owner: OwnerKey; resolve: (result: SaveResult) => void }

// `fresh`: no worker started yet. `live`: the worker runs. `unavailable`: it never ran (the page cannot
// start it, or it failed before it said anything); the store answers like one without a database and
// `onClosed` never fires. `closed`: it ran and is gone or closed; `onClosed` has fired.
type Mode = 'fresh' | 'live' | 'unavailable' | 'closed'

export function createStudioStoreProxy(options: StudioStoreProxyOptions = {}): StudioHistoryStore {
    const spawn = options.spawn ?? spawnModuleWorker
    let mode: Mode = 'fresh'
    let worker: StudioWorkerLike | null = null
    // True once any message (or message error) has come from the worker.
    let heard = false
    let sequence = 0
    let tokenCounter = 0
    const pending = new Map<number, Pending>()
    const tokenOf = new WeakMap<object, Tok>()
    // Per owner, the entries the worker's mirror holds as of the last post, load or mirror loss. It changes
    // only when a post went out, a load answered, the worker said it lost the mirror or an ack could not be
    // read (which deletes the owner's entry); a post that threw
    // leaves it as it was, so the next delta is made against what the worker last received.
    const posted = new Map<OwnerKey, Map<Tok, PutEntry>>()
    const closedCallbacks: (() => void)[] = []
    let closedFired = false

    function answerFailed(entry: Pending): void {
        switch (entry.op) {
            case 'open':
                entry.resolve('unavailable')
                break
            case 'load':
                entry.resolve({ kind: 'failed' })
                break
            case 'save':
                entry.resolve({ kind: 'unwritable' })
                break
        }
    }

    function failPending(): void {
        const entries = [...pending.values()]
        pending.clear()
        for (const entry of entries) {
            answerFailed(entry)
        }
    }

    function fireClosed(): void {
        if (closedFired) {
            return
        }
        closedFired = true
        for (const callback of closedCallbacks.splice(0)) {
            try {
                callback()
            } catch (error) {
                console.error(error)
            }
        }
    }

    function stopWorker(): void {
        const gone = worker
        worker = null
        try {
            gone?.terminate()
        } catch {
            // Already gone.
        }
    }

    // The worker failed before it said anything: the page cannot run it. Not a closed connection.
    function becomeUnavailable(): void {
        mode = 'unavailable'
        failPending()
        stopWorker()
    }

    // The worker failed after it ran: what it held is gone for this page.
    function shutDown(): void {
        mode = 'closed'
        failPending()
        fireClosed()
        stopWorker()
    }

    function onError(): void {
        if (worker === null) {
            return
        }
        if (heard) {
            shutDown()
        } else {
            becomeUnavailable()
        }
    }

    function onMessageError(): void {
        heard = true
        if (worker !== null) {
            shutDown()
        }
    }

    function adopt(owner: OwnerKey, record: OwnerRecord, tokens: LoadTokens): boolean {
        if (
            record.done.length !== tokens.done.length ||
            record.undone.length !== tokens.undone.length ||
            record.deleted.length !== tokens.deleted.length ||
            (record.restore === null) !== (tokens.restore === null)
        ) {
            return false
        }
        const held = new Map<Tok, PutEntry>()
        const note = (entry: PutEntry): void => {
            tokenOf.set(entry.value, entry.tok)
            held.set(entry.tok, entry)
        }
        record.done.forEach((value, at) => note({ k: 's', tok: tokens.done[at], value }))
        record.undone.forEach((value, at) => note({ k: 's', tok: tokens.undone[at], value }))
        record.deleted.forEach((value, at) => note({ k: 'd', tok: tokens.deleted[at], value }))
        if (record.restore !== null && tokens.restore !== null) {
            note({ k: 'r', tok: tokens.restore, value: record.restore })
        }
        posted.set(owner, held)
        return true
    }

    function settle(message: Extract<FromWorker, { t: 'ack' }>): void {
        const entry = pending.get(message.seq)
        if (!entry) {
            return
        }
        pending.delete(message.seq)
        if (entry.op !== message.op) {
            answerFailed(entry)
            return
        }
        // The entry has left `pending`, so an ack whose body is malformed must still answer it.
        try {
            switch (message.op) {
                case 'open':
                    if (entry.op === 'open') {
                        entry.resolve(message.reply)
                    }
                    break
                case 'load':
                    if (entry.op === 'load') {
                        // The loaded objects carry their tokens before the service can see them.
                        const adopted = message.reply.kind === 'ok' && message.tokens !== null && adopt(entry.owner, message.reply.record, message.tokens)
                        if (!adopted) {
                            posted.delete(entry.owner)
                        }
                        entry.resolve(message.reply)
                    }
                    break
                case 'save':
                    if (entry.op === 'save') {
                        if (message.reply.kind === 'unwritable' && 'mirrorLost' in message.reply) {
                            // The worker could not resolve a token: it holds nothing for this owner now.
                            posted.delete(entry.owner)
                        }
                        entry.resolve(message.reply.kind === 'unwritable' ? { kind: 'unwritable' } : message.reply)
                    }
                    break
            }
        } catch {
            // What the worker holds for this owner is unknown: the next save posts every entry.
            if (entry.op !== 'open') {
                posted.delete(entry.owner)
            }
            answerFailed(entry)
        }
    }

    function onMessage(event: Event): void {
        if (worker === null) {
            return
        }
        heard = true
        const message = parseFromWorker('data' in event ? event.data : undefined)
        if (!message) {
            shutDown()
            return
        }
        switch (message.t) {
            case 'ack':
                settle(message)
                break
            case 'closed':
                mode = 'closed'
                fireClosed()
                break
            case 'fatal':
                shutDown()
                break
        }
    }

    // The worker to post to, starting it on first use; null when the store answers locally.
    function liveWorker(): StudioWorkerLike | null {
        if (mode === 'fresh') {
            let created: StudioWorkerLike | null = null
            try {
                created = spawn()
                created.addEventListener('message', onMessage)
                created.addEventListener('messageerror', onMessageError)
                created.addEventListener('error', onError)
                worker = created
                mode = 'live'
            } catch {
                try {
                    created?.terminate()
                } catch {
                    // Already gone.
                }
                mode = 'unavailable'
            }
        }
        return mode === 'live' ? worker : null
    }

    // The request is registered before the post: a reply cannot arrive inside it, and a post that throws
    // for any reason leaves nothing registered.
    function post(target: StudioWorkerLike, message: ToWorker, entry: Pending): boolean {
        pending.set(message.seq, entry)
        try {
            target.postMessage(message)
            return true
        } catch {
            pending.delete(message.seq)
            return false
        }
    }

    function tokenFor(value: object): Tok {
        let tok = tokenOf.get(value)
        if (tok === undefined) {
            tokenCounter += 1
            tok = proxyToken(tokenCounter)
            tokenOf.set(value, tok)
        }
        return tok
    }

    return {
        onClosed(callback) {
            if (closedFired) {
                callback()
                return
            }
            closedCallbacks.push(callback)
        },

        open() {
            return new Promise<OpenResult>((resolve) => {
                const target = liveWorker()
                if (!target) {
                    resolve('unavailable')
                    return
                }
                sequence += 1
                if (!post(target, { t: 'open', seq: sequence }, { op: 'open', resolve })) {
                    resolve('unavailable')
                }
            })
        },

        load(owner) {
            return new Promise<LoadResult>((resolve) => {
                const target = liveWorker()
                if (!target) {
                    resolve({ kind: 'failed' })
                    return
                }
                sequence += 1
                if (!post(target, { t: 'load', seq: sequence, owner }, { op: 'load', owner, resolve })) {
                    resolve({ kind: 'failed' })
                }
            })
        },

        save(owner, record, protect) {
            return new Promise<SaveResult>((resolve) => {
                const target = liveWorker()
                if (!target) {
                    resolve({ kind: 'unwritable' })
                    return
                }
                const held = posted.get(owner)
                // Every entry of the record, by token: what the worker holds once this message is handled.
                const next = new Map<Tok, PutEntry>()
                const put: PutEntry[] = []
                const delta: DeltaEntry[] = []
                // The bases a changed entry can be sent against, from the held entries: a step by id, and the one
                // held restore point. Built once, when the first entry needs them.
                let index: BaseIndex | null = null
                const bases = (): BaseIndex => {
                    if (index === null) {
                        const built: BaseIndex = { steps: new Map(), restore: null }
                        for (const entry of held?.values() ?? []) {
                            if (entry.k === 's') {
                                built.steps.set(entry.value.id, entry)
                            } else if (entry.k === 'r') {
                                built.restore = entry
                            }
                        }
                        index = built
                    }
                    return index
                }
                // Records the entry, and sends it when it must travel: the worker does not hold it and this message
                // does not carry it yet. It goes as a delta when its base is held and the diff applies, else whole.
                const note = (entry: PutEntry): void => {
                    const first = !next.has(entry.tok)
                    next.set(entry.tok, entry)
                    if (!first || held?.has(entry.tok)) {
                        return
                    }
                    if (entry.k === 's') {
                        const base = bases().steps.get(entry.value.id)
                        const edits = base ? diffEntry(entry.value, base.value) : null
                        if (base && edits) {
                            delta.push({ k: 's', tok: entry.tok, base: base.tok, edits })
                            return
                        }
                    } else if (entry.k === 'r') {
                        const base = bases().restore
                        const edits = base ? diffEntry(entry.value, base.value) : null
                        if (base && edits) {
                            delta.push({ k: 'r', tok: entry.tok, base: base.tok, edits })
                            return
                        }
                    }
                    put.push(entry)
                }
                const done = record.done.map((value) => {
                    const tok = tokenFor(value)
                    note({ k: 's', tok, value })
                    return tok
                })
                const undone = record.undone.map((value) => {
                    const tok = tokenFor(value)
                    note({ k: 's', tok, value })
                    return tok
                })
                const deleted = record.deleted.map((value) => {
                    const tok = tokenFor(value)
                    note({ k: 'd', tok, value })
                    return tok
                })
                let restore: Tok | null = null
                if (record.restore !== null) {
                    restore = tokenFor(record.restore)
                    note({ k: 'r', tok: restore, value: record.restore })
                }
                sequence += 1
                const message: SaveMessage = {
                    t: 'save',
                    seq: sequence,
                    owner,
                    ownerKey: record.ownerKey,
                    touchedAt: record.touchedAt,
                    protect: [...protect],
                    done,
                    undone,
                    deleted,
                    restore,
                    put,
                    delta,
                }
                if (!post(target, message, { op: 'save', owner, resolve })) {
                    resolve({ kind: 'unwritable' })
                    return
                }
                // Only a post that went out changes what the worker is believed to hold.
                posted.set(owner, next)
            })
        },
    }
}
