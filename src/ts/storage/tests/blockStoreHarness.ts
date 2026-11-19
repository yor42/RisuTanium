/**
 * Test-only: an in-memory `ByteStore` that can behave like the Node server
 * (revisions, tombstones, 409s) or like the unversioned stores, records every
 * call and injects faults.
 *
 * Nothing here says anything about the real stores: the real Node server and
 * fake-indexeddb are exercised by their own tests.
 */
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
