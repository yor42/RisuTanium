// Memory doubles for the Studio history ports. The store double implements the same contract as
// the IndexedDB adapter (layout, baseline, S4 decision, aside rule, S5 total, per-owner cap and
// eviction) over one Map<string, string>, with the same pure pieces from studioHistoryStore.ts, so
// two instances over one Map stand for two tabs of one database.

import type { OwnerRecord } from '../historyModel'
import type { Expectation, OwnerKey } from '../ownerPhase'
import {
    CAP_BYTES,
    HEADER_BOUNDS,
    INDEX_PART,
    RESTORE_PART,
    asideMarkKey,
    classifyHeader,
    classifyLoad,
    deletedPart,
    entryKey,
    genBounds,
    headerKey,
    inBounds,
    planFull,
    prepareSave,
    readHeader,
    readHeaders,
    readOwner,
    readOwnHeader,
    stepPart,
    storedSizeOf,
    type Baseline,
    type ClaimResult,
    type KeyBounds,
    type LoadClassification,
    type LoadResult,
    type OpenResult,
    type SaveResult,
    type StoredHeader,
    type StudioClaimPort,
    type StudioHistoryStore,
    type WriteRequest,
} from '../studioHistoryStore'

// A promise that settles when the test says so; an unreleased gate stands for a port that hangs.
export interface Gate {
    promise: Promise<void>
    release(): void
    reject(error: Error): void
}

export function createGate(): Gate {
    let release!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((resolve, rej) => {
        release = resolve
        reject = rej
    })
    return { promise, release, reject }
}

// A hook runs before the double acts. Awaiting a gate holds the call; throwing or returning a
// rejected promise makes the double's method reject (defence-in-depth input for the service).
export type StoreHook = () => Promise<void> | void

export interface StoreHooks {
    open?: StoreHook
    load?: StoreHook
    save?: StoreHook
}

export interface StoreCounts {
    open: number
    load: number
    save: number
    // Entry (`e:`) values read by loads. The double's saves never read an entry value; the adapter's
    // spy test pins that for the real save path.
    entryValueReads: number
}

export interface MemoryStudioStoreOptions {
    shared?: Map<string, string>
    // The store cap; each owner's cap is derived from it (`ownerCapFor`).
    capBytes?: number
    pageSession?: string
}

export interface SavedWrites {
    owner: OwnerKey
    // The write requests of one save, in the order they were applied.
    requests: WriteRequest[]
}

export interface MemoryStudioStore extends StudioHistoryStore {
    readonly shared: Map<string, string>
    readonly hooks: StoreHooks
    readonly counts: StoreCounts
    // When set, `save` answers this without touching the Map (a quota failure, for instance).
    forcedSave: SaveResult | null
    simulateClose(): void
    isClosed(): boolean
    expectationOf(owner: OwnerKey): Expectation | undefined
    baselineOf(owner: OwnerKey): Baseline | undefined
    // Every save request, in order: owner and the record reference it carried.
    readonly saves: { owner: OwnerKey; record: OwnerRecord; protect: ReadonlySet<OwnerKey> }[]
    // The write requests every save that wrote applied, in order.
    readonly writes: SavedWrites[]
}

let instanceCounter = 0

// Keys of the Map inside the bounds, in the code-unit order a database lists them.
export function keysInBounds(shared: ReadonlyMap<string, string>, bounds: KeyBounds): string[] {
    return [...shared.keys()].filter((key) => inBounds(key, bounds)).sort()
}

export function createMemoryStudioStore(options: MemoryStudioStoreOptions = {}): MemoryStudioStore {
    const shared = options.shared ?? new Map<string, string>()
    const capBytes = options.capBytes ?? CAP_BYTES
    instanceCounter += 1
    const pageSession = options.pageSession ?? `double${instanceCounter}`
    if (pageSession.includes('|')) {
        throw new Error('A page session must not contain "|".')
    }
    const hooks: StoreHooks = {}
    const counts: StoreCounts = { open: 0, load: 0, save: 0, entryValueReads: 0 }
    const expectations = new Map<OwnerKey, Expectation>()
    const baselines = new Map<OwnerKey, Baseline>()
    const memo = new WeakMap<object, number>()
    const closedCallbacks: (() => void)[] = []
    const saves: MemoryStudioStore['saves'] = []
    const writes: SavedWrites[] = []
    let closed = false
    let writeCounter = 0

    function apply(request: WriteRequest): void {
        if (request.op === 'put') {
            if (typeof request.value !== 'string') {
                throw new Error('The double stores strings only.')
            }
            shared.set(request.key, request.value)
        } else if (request.op === 'delete') {
            shared.delete(request.key)
        } else {
            for (const key of keysInBounds(shared, request)) {
                shared.delete(key)
            }
        }
    }

    const store: MemoryStudioStore = {
        shared,
        hooks,
        counts,
        forcedSave: null,
        saves,
        writes,
        simulateClose() {
            if (closed) {
                return
            }
            closed = true
            const callbacks = closedCallbacks.splice(0)
            for (const callback of callbacks) {
                callback()
            }
        },
        isClosed: () => closed,
        expectationOf: (owner) => expectations.get(owner),
        baselineOf: (owner) => baselines.get(owner),
        onClosed(callback) {
            closedCallbacks.push(callback)
        },
        async open(): Promise<OpenResult> {
            counts.open += 1
            await hooks.open?.()
            return closed ? 'unavailable' : 'ok'
        },
        async load(owner): Promise<LoadResult> {
            counts.load += 1
            await hooks.load?.()
            if (closed) {
                return { kind: 'failed' }
            }
            const headerValue = shared.get(headerKey(owner))
            const asidePresent = shared.has(asideMarkKey(owner))
            const step = classifyHeader(owner, headerValue, asidePresent)
            let classification: LoadClassification
            if (step.kind === 'classified') {
                classification = step.classification
            } else {
                const keys = keysInBounds(shared, genBounds(owner, step.header.gen))
                counts.entryValueReads += keys.length
                classification = classifyLoad(
                    owner,
                    headerValue,
                    asidePresent,
                    keys,
                    keys.map((key) => shared.get(key)),
                )
            }
            expectations.set(owner, classification.expectation)
            if (classification.baseline) {
                baselines.set(owner, classification.baseline)
            } else {
                baselines.delete(owner)
            }
            return classification.result
        },
        async save(owner, record, protect): Promise<SaveResult> {
            counts.save += 1
            saves.push({ owner, record, protect })
            await hooks.save?.()
            if (closed) {
                return { kind: 'unwritable' }
            }
            if (store.forcedSave) {
                return store.forcedSave
            }
            const headerKeys = keysInBounds(shared, HEADER_BOUNDS)
            const { headers, raw } = readHeaders(
                headerKeys,
                headerKeys.map((key) => shared.get(key)),
            )
            const prepared = prepareSave({
                owner,
                record,
                protect,
                expectation: expectations.get(owner),
                baseline: baselines.get(owner) ?? null,
                ownHeader: readOwnHeader(owner, raw.get(headerKey(owner))),
                headers,
                asideTaken: shared.has(asideMarkKey(owner)),
                cap: capBytes,
                memo,
                nextWid: () => {
                    writeCounter += 1
                    return `${pageSession}:${writeCounter}`
                },
            })
            if (prepared.kind === 'result') {
                return prepared.result
            }
            // The transaction applies all of it or none of it: nothing above has touched the Map.
            for (const request of prepared.requests) {
                apply(request)
            }
            writes.push({ owner, requests: prepared.requests })
            expectations.set(owner, { kind: 'wid', wid: prepared.wid })
            baselines.set(owner, prepared.baseline)
            return { kind: 'ok', asided: prepared.asided, trimmed: prepared.trimmed }
        },
    }
    return store
}

// ---------------------------------------------------------------- reading a Map as the stored state

export interface StoredOwnerView {
    record: OwnerRecord
    header: StoredHeader
    // Every key of the header's generation, in listing order.
    keys: string[]
}

// The owner as a strict reader sees it in `shared`, or null when its header is missing or rejected
// or its generation does not read.
export function storedRecord(shared: ReadonlyMap<string, string>, owner: OwnerKey): StoredOwnerView | null {
    const headerText = shared.get(headerKey(owner))
    const header = headerText === undefined ? null : readHeader(headerText, owner)
    if (!header) {
        return null
    }
    const keys = keysInBounds(shared, genBounds(owner, header.gen))
    const stored = readOwner(
        owner,
        headerText,
        keys,
        keys.map((key) => shared.get(key)),
    )
    return stored ? { record: stored.record, header: stored.header, keys } : null
}

// Writes `record` into `shared` through the store's own writers, as a full rewrite under the gen
// `wid`: the stand-in for another producer's data (a foreign generation, a second tab's state). The
// owner cap is `Infinity` unless given.
export function seedOwner(
    shared: Map<string, string>,
    record: OwnerRecord,
    wid: string,
    ownerCap = Infinity,
): StoredHeader {
    const plan = planFull(record, wid, ownerCap, new WeakMap())
    for (const request of plan.requests) {
        if (request.op !== 'put' || typeof request.value !== 'string') {
            throw new Error('A full rewrite of a fresh gen only puts strings.')
        }
        shared.set(request.key, request.value)
    }
    return plan.header
}

// The record the keep walk must store at `ownerCap`: the longest prefix of the priority order
// (restore point, then deleted, undone and done, each newest to oldest) whose stored size fits. Built
// by measuring prefixes with the untrimmed size, so it shares no code with the walk itself.
export function walkOracle(record: OwnerRecord, ownerCap: number): OwnerRecord {
    const order: { part: 'restore' | 'deleted' | 'undone' | 'done'; at: number }[] = []
    if (record.restore !== null) {
        order.push({ part: 'restore', at: 0 })
    }
    for (const part of ['deleted', 'undone', 'done'] as const) {
        for (let at = record[part].length - 1; at >= 0; at--) {
            order.push({ part, at })
        }
    }
    const build = (count: number): OwnerRecord => {
        const taken = order.slice(0, count)
        const has = (part: 'deleted' | 'undone' | 'done', at: number) => taken.some((item) => item.part === part && item.at === at)
        return {
            ownerKey: record.ownerKey,
            touchedAt: record.touchedAt,
            done: record.done.filter((_, at) => has('done', at)),
            undone: record.undone.filter((_, at) => has('undone', at)),
            deleted: record.deleted.filter((_, at) => has('deleted', at)),
            restore: taken.some((item) => item.part === 'restore') ? record.restore : null,
        }
    }
    let best = 0
    for (let count = 1; count <= order.length; count++) {
        if (storedSizeOf(build(count), record.ownerKey, Infinity) > ownerCap) {
            break
        }
        best = count
    }
    return build(best)
}

// The keys an intact owner holds: its header, and in its generation the index, the restore point when
// there is one and one key per step and deleted item.
export function expectedOwnerKeys(header: StoredHeader, record: OwnerRecord): string[] {
    const owner = header.ownerKey
    const keys = [headerKey(owner), entryKey(owner, header.gen, INDEX_PART)]
    if (record.restore !== null) {
        keys.push(entryKey(owner, header.gen, RESTORE_PART))
    }
    for (const step of [...record.done, ...record.undone]) {
        keys.push(entryKey(owner, header.gen, stepPart(step.id)))
    }
    for (const item of record.deleted) {
        keys.push(entryKey(owner, header.gen, deletedPart(item.id)))
    }
    return keys.sort()
}

// ---------------------------------------------------------------- claim double

export type ClaimHook = (chaId: string) => Promise<void> | void

export interface ClaimDouble extends StudioClaimPort {
    // Every request, in order.
    readonly calls: string[]
    hook: ClaimHook | null
    // When true the page has no Web Locks: every claim answers `unsupported`.
    unsupported: boolean
    // When set, the next requests answer this without taking a lock.
    forced: ClaimResult | null
    holds(chaId: string): boolean
    // The page ends: its locks are released.
    endPage(): void
}

export interface ClaimWorld {
    createPage(): ClaimDouble
}

// Pages of one origin share a lock table. A lock is exclusive and not re-entrant: a second
// request for a name the same page already holds is `held`, as in the Web Locks specification.
export function createClaimWorld(): ClaimWorld {
    const holders = new Map<string, ClaimDouble>()
    return {
        createPage() {
            const calls: string[] = []
            const page: ClaimDouble = {
                calls,
                hook: null,
                unsupported: false,
                forced: null,
                async tryClaim(chaId): Promise<ClaimResult> {
                    calls.push(chaId)
                    await Promise.resolve()
                    await page.hook?.(chaId)
                    if (page.forced) {
                        return page.forced
                    }
                    if (page.unsupported) {
                        return 'unsupported'
                    }
                    if (holders.has(chaId)) {
                        return 'held'
                    }
                    holders.set(chaId, page)
                    return 'granted'
                },
                holds: (chaId) => holders.get(chaId) === page,
                endPage() {
                    for (const [chaId, holder] of [...holders]) {
                        if (holder === page) {
                            holders.delete(chaId)
                        }
                    }
                },
            }
            return page
        },
    }
}

export function createClaimDouble(): ClaimDouble {
    return createClaimWorld().createPage()
}
