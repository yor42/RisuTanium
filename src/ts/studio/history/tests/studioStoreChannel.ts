// A stand-in for the worker channel of the Studio history store. It runs the real host and the real
// IndexedDB adapter in-process, on a factory of its own (never the page's global `indexedDB`), and behaves
// like a worker boundary: `structuredClone` both ways, each delivery as a macrotask, nothing delivered
// after `terminate`. A suite injects the faults a worker can show: a throwing `postMessage`, a dropped or
// held message, an `error` or `messageerror` event, and a message the host never sent.

import { IDBFactory } from 'fake-indexeddb'
import { createStudioStoreHost } from '../studioStoreHost'
import type { StudioHistoryStore } from '../studioHistoryStore'
import type { FromWorker, ToWorker } from '../studioStoreProtocol'
import type { StudioWorkerLike } from '../studioStoreProxy'
import { createStudioStoreIdb, STUDIO_DB_NAME, STUDIO_DB_VERSION, STUDIO_STORE_NAME } from '../studioStoreIdb'

// Resolved at import, so a suite that fakes timers later still gets real macrotasks.
const realSetTimeout = globalThis.setTimeout

export interface StudioChannelOptions {
    // The worker-realm database; share one between channels to stand for two pages of one origin.
    factory?: IDBFactory
    // Replaces the real adapter (a double that rejects, for instance).
    adapter?: StudioHistoryStore
    capBytes?: number
    pageSession?: string
}

export interface StudioChannel {
    readonly factory: IDBFactory
    readonly adapter: StudioHistoryStore
    // Every message main posted, cloned at the moment of the post, in order.
    readonly posted: ToWorker[]
    // Every message the host sent, cloned at the moment of sending, in order.
    readonly replies: FromWorker[]
    readonly spawned: { count: number }
    readonly terminated: { value: boolean }
    // The `spawn` option of the proxy.
    spawn(): StudioWorkerLike
    // Every later `postMessage` throws this until cleared with null.
    failPosts(error: Error | null): void
    // The next message of this type is recorded in `posted` but never reaches the host.
    dropNext(type: ToWorker['t']): void
    // Replies are kept instead of delivered, until `releaseReplies`.
    holdReplies(): void
    releaseReplies(order: 'arrival' | 'reverse'): void
    // Events the worker would raise on the main side.
    emitError(): void
    emitMessageError(): void
    // A message that arrives from the worker whatever the host did.
    emitFromWorker(data: unknown): void
    // Waits for the macrotasks the channel has scheduled and a few more, so a reply that needs no new
    // database work has arrived.
    flush(rounds?: number): Promise<void>
}

export function createStudioChannel(options: StudioChannelOptions = {}): StudioChannel {
    const factory = options.factory ?? new IDBFactory()
    const adapter = options.adapter ?? createStudioStoreIdb({ factory, capBytes: options.capBytes, pageSession: options.pageSession })
    const posted: ToWorker[] = []
    const replies: FromWorker[] = []
    const spawned = { count: 0 }
    const terminated = { value: false }
    const listeners: Record<'message' | 'messageerror' | 'error', ((event: Event) => void)[]> = { message: [], messageerror: [], error: [] }
    let postError: Error | null = null
    let dropType: ToWorker['t'] | null = null
    let holding = false
    let held: FromWorker[] = []

    function toMain(data: unknown): void {
        realSetTimeout(() => {
            if (terminated.value) {
                return
            }
            for (const listener of listeners.message) {
                listener(new MessageEvent('message', { data }))
            }
        }, 0)
    }

    const host = createStudioStoreHost(adapter, (message) => {
        const copy = structuredClone(message)
        replies.push(copy)
        if (holding) {
            held.push(copy)
        } else {
            toMain(copy)
        }
    })

    function raise(type: 'error' | 'messageerror'): void {
        for (const listener of listeners[type]) {
            listener(new Event(type))
        }
    }

    const worker: StudioWorkerLike = {
        postMessage(message) {
            if (terminated.value) {
                return
            }
            if (postError) {
                throw postError
            }
            const copy = structuredClone(message)
            posted.push(copy)
            if (dropType === copy.t) {
                dropType = null
                return
            }
            realSetTimeout(() => {
                if (!terminated.value) {
                    host.handle(copy)
                }
            }, 0)
        },
        terminate() {
            terminated.value = true
        },
        addEventListener(type, listener) {
            listeners[type].push(listener)
        },
    }

    return {
        factory,
        adapter,
        posted,
        replies,
        spawned,
        terminated,
        spawn() {
            spawned.count += 1
            return worker
        },
        failPosts(error) {
            postError = error
        },
        dropNext(type) {
            dropType = type
        },
        holdReplies() {
            holding = true
        },
        releaseReplies(order) {
            holding = false
            const batch = order === 'reverse' ? held.slice().reverse() : held
            held = []
            for (const reply of batch) {
                toMain(reply)
            }
        },
        emitError: () => raise('error'),
        emitMessageError: () => raise('messageerror'),
        emitFromWorker: (data) => toMain(structuredClone(data)),
        async flush(rounds = 5) {
            for (let round = 0; round < rounds; round++) {
                await new Promise<void>((resolve) => realSetTimeout(resolve, 0))
            }
        },
    }
}

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(STUDIO_DB_NAME, STUDIO_DB_VERSION)
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STUDIO_STORE_NAME)) {
                request.result.createObjectStore(STUDIO_STORE_NAME)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

// Puts the entries into the database directly: the stand-in for another producer's data.
export async function writeStoredEntries(factory: IDBFactory, entries: Iterable<[string, string]>): Promise<void> {
    const db = await openRaw(factory)
    const tx = db.transaction(STUDIO_STORE_NAME, 'readwrite')
    const finished = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
    })
    for (const [key, value] of entries) {
        tx.objectStore(STUDIO_STORE_NAME).put(value, key)
    }
    await finished
    db.close()
}

// Every key and value of the channel's database, as the stored state a reader would see.
export async function readStoredMap(factory: IDBFactory): Promise<Map<string, string>> {
    const db = await openRaw(factory)
    const objects = db.transaction(STUDIO_STORE_NAME, 'readonly').objectStore(STUDIO_STORE_NAME)
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = objects.getAllKeys()
        request.onsuccess = () => resolve(request.result)
    })
    const values = await new Promise<unknown[]>((resolve) => {
        const request = objects.getAll()
        request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return new Map(keys.map((key, index) => [String(key), String(values[index])]))
}
