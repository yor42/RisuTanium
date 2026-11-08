// The device store of the Studio history: the IndexedDB adapter of the frozen `StudioHistoryStore`
// port. One database of its own, `risuStudio`, version 1, one object store `records` with out-of-line
// string keys and string values; it is never part of the profile's `risuai` database, its version is
// never raised, and nothing in it is ever deleted or re-created except the owner generations the
// cap evicts and the parts a save replaces. The layout (a header per owner, and an index plus one
// entry per step under one owner/generation key range), the strict readers and the pure pieces of
// the save transaction (load classification, the S4 decision, the planners, the per-owner cap and
// the eviction plan) live in studioHistoryStore.ts; this file only runs them inside real
// transactions. Nothing here throws or rejects into the edit path.

import { createPageSession } from './historyModel'
import type { Expectation, OwnerKey } from './ownerPhase'
import {
    CAP_BYTES,
    HEADER_BOUNDS,
    asideMarkKey,
    classifyHeader,
    classifyLoad,
    genBounds,
    headerKey,
    prepareSave,
    readHeaders,
    readOwnHeader,
    type Baseline,
    type KeyBounds,
    type LoadClassification,
    type LoadResult,
    type OpenResult,
    type SaveResult,
    type StudioHistoryStore,
} from './studioHistoryStore'

export const STUDIO_DB_NAME = 'risuStudio'
export const STUDIO_DB_VERSION = 1
export const STUDIO_STORE_NAME = 'records'

export interface StudioStoreIdbOptions {
    // Default: the page's `indexedDB`. A page without one gets an unavailable store.
    factory?: Pick<IDBFactory, 'open'> | null
    // The store cap; each owner's cap is derived from it (`ownerCapFor`).
    capBytes?: number
    // Must not contain `|`: a generation is a page session plus a counter, and the key ranges rely on it.
    pageSession?: string
}

// A read request's result, as a promise. Used only inside a transaction that is still active. A
// request that an abort cancels while nobody awaits it any more rejects quietly. Write requests
// never use it: they carry no success handler, and errors reach the transaction's `abort`.
function ask<T>(request: IDBRequest<T>): Promise<T> {
    const answer = new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
    answer.catch(() => undefined)
    return answer
}

// Settles when the transaction commits (resolve) or aborts (reject). The caller attaches its own
// handler before awaiting anything else, so an abort never goes unhandled.
function completion(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
}

function rangeOf(bounds: KeyBounds): IDBKeyRange {
    return IDBKeyRange.bound(bounds.lower, bounds.upper, false, true)
}

function pageFactory(): Pick<IDBFactory, 'open'> | null {
    try {
        return typeof indexedDB === 'undefined' ? null : indexedDB
    } catch {
        return null
    }
}

export function createStudioStoreIdb(options: StudioStoreIdbOptions = {}): StudioHistoryStore {
    const capBytes = options.capBytes ?? CAP_BYTES
    const pageSession = options.pageSession ?? createPageSession((bytes) => crypto.getRandomValues(bytes))
    if (pageSession.includes('|')) {
        throw new Error('A page session must not contain "|".')
    }
    const expectations = new Map<OwnerKey, Expectation>()
    // What this instance last loaded or wrote, per owner. Every load outcome replaces it; a failed
    // save leaves it unchanged.
    const baselines = new Map<OwnerKey, Baseline>()
    // Lengths of entries that were measured but not stored, so a repeated save does not measure them again.
    const memo = new WeakMap<object, number>()
    const closedCallbacks: (() => void)[] = []
    let closed = false
    let writeCounter = 0
    let connecting: Promise<IDBDatabase | null> | null = null

    function markClosed(): void {
        if (closed) {
            return
        }
        closed = true
        const callbacks = closedCallbacks.splice(0)
        for (const callback of callbacks) {
            try {
                callback()
            } catch (error) {
                console.error(error)
            }
        }
    }

    function connect(): Promise<IDBDatabase | null> {
        connecting ??= new Promise<IDBDatabase | null>((resolve) => {
            const factory = options.factory === undefined ? pageFactory() : options.factory
            if (!factory) {
                resolve(null)
                return
            }
            try {
                const request = factory.open(STUDIO_DB_NAME, STUDIO_DB_VERSION)
                request.onupgradeneeded = () => {
                    const db = request.result
                    if (!db.objectStoreNames.contains(STUDIO_STORE_NAME)) {
                        db.createObjectStore(STUDIO_STORE_NAME)
                    }
                }
                request.onsuccess = () => {
                    const db = request.result
                    // A database of this name without the store belongs to something else: leave it be.
                    if (!db.objectStoreNames.contains(STUDIO_STORE_NAME)) {
                        db.close()
                        resolve(null)
                        return
                    }
                    db.addEventListener('versionchange', () => {
                        // Another connection wants to change the database: step aside, never block it.
                        db.close()
                        markClosed()
                    })
                    db.addEventListener('close', () => markClosed())
                    resolve(db)
                }
                // A VersionError (a foreign or manual upgrade), an upgrade failure or a blocked
                // storage origin: the store is unavailable and nothing is deleted.
                request.onerror = () => resolve(null)
            } catch {
                resolve(null)
            }
        })
        return connecting
    }

    async function usableDatabase(): Promise<IDBDatabase | null> {
        const db = await connect()
        return db && !closed ? db : null
    }

    const store: StudioHistoryStore = {
        onClosed(callback) {
            if (closed) {
                callback()
                return
            }
            closedCallbacks.push(callback)
        },

        async open(): Promise<OpenResult> {
            try {
                return (await usableDatabase()) ? 'ok' : 'unavailable'
            } catch {
                return 'unavailable'
            }
        },

        async load(owner): Promise<LoadResult> {
            try {
                const db = await usableDatabase()
                if (!db) {
                    return { kind: 'failed' }
                }
                const tx = db.transaction(STUDIO_STORE_NAME, 'readonly')
                const done = completion(tx)
                done.catch(() => undefined)
                const objects = tx.objectStore(STUDIO_STORE_NAME)
                // Batch 1: the header, and whether the aside marker exists (its bytes are never read).
                const [headerValue, asideAt] = await Promise.all([
                    ask<unknown>(objects.get(headerKey(owner))),
                    ask(objects.getKey(asideMarkKey(owner))),
                ])
                const asidePresent = asideAt !== undefined
                const step = classifyHeader(owner, headerValue, asidePresent)
                let classification: LoadClassification
                if (step.kind === 'classified') {
                    classification = step.classification
                } else {
                    // Batch 2, only when the header passed: the header's own generation, nothing else.
                    const range = rangeOf(genBounds(owner, step.header.gen))
                    const [values, keys] = await Promise.all([
                        ask<unknown[]>(objects.getAll(range)),
                        ask<IDBValidKey[]>(objects.getAllKeys(range)),
                    ])
                    classification = classifyLoad(owner, headerValue, asidePresent, keys, values)
                }
                await done
                expectations.set(owner, classification.expectation)
                if (classification.baseline) {
                    baselines.set(owner, classification.baseline)
                } else {
                    baselines.delete(owner)
                }
                return classification.result
            } catch {
                baselines.delete(owner)
                return { kind: 'failed' }
            }
        },

        async save(owner, record, protect): Promise<SaveResult> {
            let tx: IDBTransaction | null = null
            try {
                const db = await usableDatabase()
                if (!db) {
                    return { kind: 'unwritable' }
                }
                const expectation = expectations.get(owner)
                if (!expectation) {
                    return { kind: 'notLoaded' }
                }
                tx = db.transaction(STUDIO_STORE_NAME, 'readwrite')
                const done = completion(tx)
                done.catch(() => undefined)
                const objects = tx.objectStore(STUDIO_STORE_NAME)

                // One read batch: every header (the eviction's input and the S4 guard's) and the aside
                // marker's key. No entry value is read on any save path.
                const range = rangeOf(HEADER_BOUNDS)
                const [values, keys, asideAt] = await Promise.all([
                    ask<unknown[]>(objects.getAll(range)),
                    ask<IDBValidKey[]>(objects.getAllKeys(range)),
                    ask(objects.getKey(asideMarkKey(owner))),
                ])
                const { headers, raw } = readHeaders(keys, values)
                const prepared = prepareSave({
                    owner,
                    record,
                    protect,
                    expectation,
                    baseline: baselines.get(owner) ?? null,
                    ownHeader: readOwnHeader(owner, raw.get(headerKey(owner))),
                    headers,
                    asideTaken: asideAt !== undefined,
                    cap: capBytes,
                    memo,
                    nextWid: () => {
                        writeCounter += 1
                        return `${pageSession}:${writeCounter}`
                    },
                })
                if (prepared.kind === 'result') {
                    await done
                    return prepared.result
                }

                // One transaction applies all of it or none of it. The writes carry no success
                // handler; a request error or a quota failure aborts the transaction.
                for (const request of prepared.requests) {
                    if (request.op === 'put') {
                        objects.put(request.value, request.key)
                    } else if (request.op === 'delete') {
                        objects.delete(request.key)
                    } else {
                        objects.delete(rangeOf(request))
                    }
                }
                await done
                expectations.set(owner, { kind: 'wid', wid: prepared.wid })
                baselines.set(owner, prepared.baseline)
                return { kind: 'ok', asided: prepared.asided, trimmed: prepared.trimmed }
            } catch {
                // A quota failure, a throwing request or an aborted transaction: nothing was written,
                // the expectation and the baseline still stand and the next save retries.
                try {
                    tx?.abort()
                } catch {
                    // The transaction had already finished.
                }
                return { kind: 'unwritable' }
            }
        },
    }
    return store
}
