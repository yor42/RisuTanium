/**
 * Test-only: an in-memory `ByteStore` that can behave like the Node server
 * (revisions, tombstones, 409s) or like the unversioned stores, records every
 * call, injects faults, and lets a scheduler decide the order in which two
 * owners' store calls run. Plus builders for the framed block sets the commit
 * owner takes.
 *
 * Nothing here says anything about the real stores: the real Node server and
 * fake-indexeddb are exercised by their own tests.
 */
import { BLOCK_TYPE_CHARACTER_WITH_CHAT, BLOCK_TYPE_ROOT, frameBlock, frameJsonBlock, type JsonObject } from 'src/ts/storage/blockFrame'
import { BlockStoreOwner, type BlockLayout, type BlockOwnerDeps, type BlockSetInput, type CommitLock } from 'src/ts/storage/blockStore'
import { createMutexHeadSwap, createNodeHeadSwap, type HeadSwap } from 'src/ts/storage/headSwap'
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'
import {
    StoreDeleteManyError,
    StoreUnsupportedConditionError,
    StoreVersionConflictError,
    type DeleteReportEntry,
} from 'src/ts/storage/store/errors'

export type StoreOp =
    | { kind: 'read' | 'write' | 'delete' | 'has', key: string, condition?: StoreCondition }
    | { kind: 'list', key: string }
    | { kind: 'deleteMany', key: string, keys: string[] }

export class InjectedFault extends Error {
    constructor(message = 'injected fault') {
        super(message)
        this.name = 'InjectedFault'
    }
}

export interface FaultRule {
    /** Whether this call is the one to fault. */
    match(op: StoreOp): boolean
    /** `before`: the call fails and changes nothing. `after`: the change lands and the call then throws. */
    mode: 'before' | 'after'
    /** How many matching calls fault; default 1. */
    times?: number
    error?: Error
}

export interface FakeStoreOptions {
    versioned: boolean
    /** Awaited before every call, for a scheduler. */
    gate?: () => Promise<void>
    /** Awaited after every call that changed the store. */
    onMutation?: (op: StoreOp) => Promise<void>
}

interface Entry {
    bytes: Uint8Array | null
    revision: number
}

export interface FakeStore extends ByteStore {
    readonly ops: StoreOp[]
    readonly versioned: boolean
    faults: FaultRule[]
    /** A copy of the live values, for a crash-point check. */
    snapshotValues(): Map<string, Uint8Array>
    /** The same store state behind a new store object, without gates, faults or hooks. */
    cloneUngated(): FakeStore
    /** Direct access for arranging a scenario; no op is recorded and no fault fires. */
    plant(key: string, bytes: Uint8Array): void
    unplant(key: string): void
    peek(key: string): Uint8Array | null
    revisionOf(key: string): number
    keys(prefix?: string): string[]
    mutating(): StoreOp[]
}

const MUTATING = new Set(['write', 'delete', 'deleteMany'])

export function createFakeStore(options: FakeStoreOptions, state?: Map<string, Entry>): FakeStore {
    const entries: Map<string, Entry> = state ?? new Map()
    const ops: StoreOp[] = []
    const faults: FaultRule[] = []

    function entryOf(key: string): Entry {
        let entry = entries.get(key)
        if (entry === undefined) {
            entry = { bytes: null, revision: 0 }
            entries.set(key, entry)
        }
        return entry
    }

    function consumeFault(op: StoreOp, mode: 'before' | 'after'): Error | null {
        for (const rule of faults) {
            if (rule.mode !== mode || (rule.times ?? 1) <= 0 || !rule.match(op)) {
                continue
            }
            rule.times = (rule.times ?? 1) - 1
            return rule.error ?? new InjectedFault()
        }
        return null
    }

    async function run<T>(op: StoreOp, apply: () => T): Promise<T> {
        await options.gate?.()
        ops.push(op)
        const before = consumeFault(op, 'before')
        if (before !== null) {
            throw before
        }
        const result = apply()
        if (MUTATING.has(op.kind)) {
            await options.onMutation?.(op)
        }
        const after = consumeFault(op, 'after')
        if (after !== null) {
            throw after
        }
        return result
    }

    function checkCondition(key: string, condition: StoreCondition): void {
        if (condition === 'unconditional') {
            return
        }
        if (!options.versioned) {
            throw new StoreUnsupportedConditionError()
        }
        const current = entries.get(key)?.revision ?? 0
        if (current !== condition.ifVersion) {
            throw new StoreVersionConflictError(key, current)
        }
    }

    const store: FakeStore = {
        capabilities: { conditionalWrites: options.versioned },
        ops,
        versioned: options.versioned,
        faults,

        read: (key) => run<ReadResult>({ kind: 'read', key }, () => {
            const entry = entries.get(key)
            return {
                bytes: entry?.bytes === null || entry === undefined ? null : entry.bytes.slice(),
                version: options.versioned ? entry?.revision ?? 0 : null,
            }
        }),

        write: (key, bytes, condition) => run<WriteResult>({ kind: 'write', key, condition }, () => {
            checkCondition(key, condition)
            const entry = entryOf(key)
            entry.bytes = bytes.slice()
            if (options.versioned) {
                entry.revision++
            }
            return { version: options.versioned ? entry.revision : null }
        }),

        delete: (key, condition) => run<void>({ kind: 'delete', key, condition }, () => {
            checkCondition(key, condition)
            const entry = entries.get(key)
            if (entry !== undefined) {
                entry.bytes = null
                if (options.versioned) {
                    entry.revision++
                }
            }
        }),

        deleteMany: (list: readonly DeleteEntry[]) => run<void>({ kind: 'deleteMany', key: list[0]?.key ?? '', keys: list.map((entry) => entry.key) }, () => {
            const report: DeleteReportEntry[] = list.map((entry) => ({ key: entry.key, outcome: 'unchanged' as const }))
            for (let i = 0; i < list.length; i++) {
                try {
                    checkCondition(list[i].key, list[i].condition)
                } catch (error) {
                    if (error instanceof StoreVersionConflictError) {
                        report[i] = { key: list[i].key, outcome: 'conflict', currentVersion: error.currentVersion }
                        throw new StoreDeleteManyError(report)
                    }
                    throw error
                }
            }
            for (const entry of list) {
                const existing = entries.get(entry.key)
                if (existing !== undefined) {
                    existing.bytes = null
                    if (options.versioned) {
                        existing.revision++
                    }
                }
            }
        }),

        list: (prefix) => run<string[]>({ kind: 'list', key: prefix }, () => store.keys(prefix)),

        has: (key) => run<boolean>({ kind: 'has', key }, () => entries.get(key)?.bytes != null),

        snapshotValues() {
            const out = new Map<string, Uint8Array>()
            for (const [key, entry] of entries) {
                if (entry.bytes !== null) {
                    out.set(key, entry.bytes.slice())
                }
            }
            return out
        },

        cloneUngated() {
            const copy = new Map<string, Entry>()
            for (const [key, entry] of entries) {
                copy.set(key, { bytes: entry.bytes === null ? null : entry.bytes.slice(), revision: entry.revision })
            }
            return createFakeStore({ versioned: options.versioned }, copy)
        },

        plant(key, bytes) {
            const entry = entryOf(key)
            entry.bytes = bytes.slice()
            if (options.versioned) {
                entry.revision++
            }
        },

        unplant(key) {
            const entry = entries.get(key)
            if (entry !== undefined) {
                entry.bytes = null
                if (options.versioned) {
                    entry.revision++
                }
            }
        },

        peek: (key) => entries.get(key)?.bytes?.slice() ?? null,
        revisionOf: (key) => entries.get(key)?.revision ?? 0,
        keys: (prefix = '') => Array.from(entries).filter(([key, entry]) => entry.bytes !== null && key.startsWith(prefix)).map(([key]) => key),
        mutating: () => ops.filter((op) => MUTATING.has(op.kind)),
    }
    return store
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/** A commit lock that does not exclude anything, for a single-owner test. */
export function passthroughLock(available = true): CommitLock {
    return { available, run: (work) => work() }
}

/** A real exclusion between owners in this process, not scheduler-aware. For tests that run owners one after the other. */
export class SharedLockCore {
    private tail: Promise<void> = Promise.resolve()
    held = false
    acquisitions = 0
    lockFor(available = true): CommitLock {
        return {
            available,
            run: async (work) => {
                const previous = this.tail
                let release!: () => void
                this.tail = new Promise<void>((resolve) => { release = resolve })
                await previous
                this.held = true
                this.acquisitions++
                try {
                    return await work()
                } finally {
                    this.held = false
                    release()
                }
            },
        }
    }
}

// ---------------------------------------------------------------------------
// The interleaving scheduler
// ---------------------------------------------------------------------------

export type Pick = (waiting: readonly number[], step: number) => number

/** A seeded pseudo-random pick (mulberry32). */
export function seededPick(seed: number): Pick {
    let state = seed >>> 0
    const next = () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return (waiting) => waiting[Math.floor(next() * waiting.length)]
}

/** Follows `order` (task ids) as far as it goes, then the lowest waiting task. A task that is not waiting is skipped. */
export function scriptedPick(order: readonly number[]): Pick {
    return (waiting, step) => {
        const wanted = order[step]
        return wanted !== undefined && waiting.includes(wanted) ? wanted : waiting[0]
    }
}

/**
 * Runs several tasks that share a store, letting `pick` decide which task's
 * next store call goes first. A task runs until it reaches a store call or a
 * lock, so every interleaving at the granularity of store calls can be
 * reproduced from the order.
 */
export class Interleaver {
    private waiting: Array<{ task: number, release: () => void }> = []
    private active = 0
    private step = 0
    private lockHeld = false
    private lockQueue: Array<() => void> = []
    /** The order in which tasks were released, for reproducing a failing schedule. */
    readonly trace: number[] = []

    constructor(private readonly pick: Pick) { }

    gate(task: number): () => Promise<void> {
        return () => new Promise<void>((resolve) => {
            this.active--
            this.waiting.push({ task, release: resolve })
            this.pump()
        })
    }

    private pump(): void {
        if (this.active > 0 || this.waiting.length === 0) {
            return
        }
        const ids = this.waiting.map((entry) => entry.task)
        const chosen = this.pick(ids, this.step++)
        const index = this.waiting.findIndex((entry) => entry.task === chosen)
        const [entry] = this.waiting.splice(index < 0 ? 0 : index, 1)
        this.trace.push(entry.task)
        this.active++
        entry.release()
    }

    /** A commit lock whose waiters do not count as runnable, so a holder waiting at a store call can still be scheduled. */
    lockFor(task: number, available = true): CommitLock {
        return {
            available,
            run: async (work) => {
                await this.gate(task)()
                if (this.lockHeld) {
                    await new Promise<void>((resolve) => {
                        this.active--
                        this.lockQueue.push(() => {
                            this.active++
                            resolve()
                        })
                        this.pump()
                    })
                } else {
                    this.lockHeld = true
                }
                try {
                    return await work()
                } finally {
                    const next = this.lockQueue.shift()
                    if (next === undefined) {
                        this.lockHeld = false
                    } else {
                        next()
                    }
                }
            },
        }
    }

    async run<T>(tasks: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
        this.active = tasks.length
        const finished = tasks.map(async (task) => {
            try {
                return await task()
            } finally {
                this.active--
                this.pump()
            }
        })
        return await Promise.all(finished)
    }
}

// ---------------------------------------------------------------------------
// Block sets
// ---------------------------------------------------------------------------

export interface CharacterSpec {
    chaId: string
    /** Anything JSON; stored as the character's payload. */
    data?: string
}

export interface SetSpec {
    characters?: CharacterSpec[]
    packed?: string[]
    /** Payload text per fixed block; defaults are derived from the name. */
    fixed?: Partial<Record<'preset' | 'modules' | 'loadouts' | 'plugins' | 'pluginStorage' | 'config', string>>
    /** Extra fields of the encoder's root. */
    rootFields?: JsonObject
}

const FIXED_ORDER = ['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage'] as const
/** The fixed blocks whose payload is a JSON list, as the encoder writes them. */
const LIST_FIXED: ReadonlySet<string> = new Set(['preset', 'modules', 'loadouts', 'plugins'])
const FIXED_TYPES: Record<string, number> = { preset: 4, modules: 5, loadouts: 10, plugins: 9, pluginStorage: 11, config: 0 }

export function characterBlock(chaId: string, data = `{"chaId":${JSON.stringify(chaId)},"chats":[]}`): Uint8Array {
    return frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, chaId, new TextEncoder().encode(data))
}

/** A block set in the shape the encoder produces: the root first, the fixed blocks, the characters, then config. */
export function makeSet(spec: SetSpec = {}): BlockSetInput {
    const characters = spec.characters ?? []
    const keys: string[] = ['root']
    const blocks: Uint8Array[] = []
    const names: string[] = []
    for (const name of FIXED_ORDER) {
        names.push(name)
    }
    for (const character of characters) {
        names.push(character.chaId)
    }
    names.push('config')
    const rootFields: JsonObject = { ...(spec.rootFields ?? {}), __directory: names }
    blocks.push(frameJsonBlock(BLOCK_TYPE_ROOT, 'root', rootFields))
    for (const name of FIXED_ORDER) {
        keys.push(name)
        blocks.push(frameBlock(FIXED_TYPES[name], name, new TextEncoder().encode(spec.fixed?.[name] ?? (LIST_FIXED.has(name) ? `[${JSON.stringify(name)}]` : `{"${name}":1}`))))
    }
    for (const character of characters) {
        keys.push(character.chaId)
        blocks.push(characterBlock(character.chaId, character.data))
    }
    keys.push('config')
    blocks.push(frameBlock(FIXED_TYPES.config, 'config', new TextEncoder().encode(spec.fixed?.config ?? '{"version":1}')))
    const layout: BlockLayout = { keys, blocks }
    return { layout, packed: new Set(spec.packed ?? []) }
}

/** A copy of `input` with one block's bytes replaced (the root by name `root`). */
export function withBlock(input: BlockSetInput, name: string, bytes: Uint8Array): BlockSetInput {
    const index = input.layout.keys.indexOf(name)
    if (index < 0) {
        throw new Error(`no block ${name}`)
    }
    const blocks = input.layout.blocks.slice()
    blocks[index] = bytes
    return { layout: { keys: input.layout.keys, blocks }, packed: input.packed }
}

/** A copy of `input` without the named character block. */
export function withoutBlock(input: BlockSetInput, name: string): BlockSetInput {
    const keys: string[] = []
    const blocks: Uint8Array[] = []
    input.layout.keys.forEach((key, i) => {
        if (key !== name) {
            keys.push(key)
            blocks.push(input.layout.blocks[i])
        }
    })
    const packed = new Set(input.packed)
    packed.delete(name)
    return { layout: { keys, blocks }, packed }
}

/** A copy of `input` with a character block added before `config`. */
export function withCharacter(input: BlockSetInput, chaId: string, data?: string): BlockSetInput {
    const keys = input.layout.keys.slice()
    const blocks = input.layout.blocks.slice()
    const at = keys.indexOf('config')
    keys.splice(at, 0, chaId)
    blocks.splice(at, 0, characterBlock(chaId, data))
    return { layout: { keys, blocks }, packed: input.packed }
}

export function withPacked(input: BlockSetInput, packed: readonly string[]): BlockSetInput {
    return { layout: input.layout, packed: new Set(packed) }
}

/** A copy of `input` with the root's own fields replaced (keeping `__directory`). */
export function withRootFields(input: BlockSetInput, fields: JsonObject): BlockSetInput {
    const directory = input.layout.keys.filter((key) => key !== 'root')
    return withBlock(input, 'root', frameJsonBlock(BLOCK_TYPE_ROOT, 'root', { ...fields, __directory: directory }))
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

export interface OwnerBundle<S extends ByteStore = ByteStore> {
    owner: BlockStoreOwner
    store: S
    headSwap: HeadSwap
}

let idCounter = 0

export function makeOwner<S extends ByteStore>(store: S, extra: Partial<BlockOwnerDeps> = {}): OwnerBundle<S> {
    // The fake stands in for the Node server (versioned) or for the desktop files (unversioned); a test of IndexedDB passes its own swap.
    const headSwap = extra.headSwap ?? (store.capabilities.conditionalWrites ? createNodeHeadSwap(store) : createMutexHeadSwap(store))
    const owner = new BlockStoreOwner({
        commitLock: passthroughLock(),
        sleep: async () => { },
        generationIds: {
            now: () => 1_700_000_000_000 + idCounter,
            randomBytes: (length) => {
                const out = new Uint8Array(length)
                idCounter++
                new DataView(out.buffer).setUint32(0, idCounter, false)
                return out
            },
        },
        ...extra,
        store,
        headSwap,
    })
    return { owner, store, headSwap }
}

/** Seeds an empty fake store with `input` through a throwaway owner and returns the live generation. */
export async function seedStore(store: ByteStore, input: BlockSetInput): Promise<string> {
    const { owner } = makeOwner(store)
    const result = await owner.replaceWholeState(input, { requireAbsentHead: true })
    if (result.kind !== 'won') {
        throw new Error(`seeding failed: ${result.kind}`)
    }
    return result.generation
}

export function textOf(bytes: Uint8Array | null): string {
    return bytes === null ? '<absent>' : new TextDecoder().decode(bytes)
}
