/**
 * Test-only: a wrapper over a store2 backend that behaves as a Tauri backend does for the page's flush tracking. The plain
 * memory backend reports `flushed: undefined` for every write, which a `tauri` session reads as "not known to be flushed",
 * so it is idle for ever and the collector refuses `idle`. This wrapper reports `flushed: true` from `casCommit`,
 * `casFence` and `commitOrdinary`, with a switch to report `false` for a test that needs the session to turn idle.
 *
 * It also records every call by method name and offers a `before` hook, so a test can say "no pass ran" (no `readCommit`,
 * `listStore2` or `removeBatch` after a point) and can interleave a write at an exact call. A mocked success here is not
 * evidence of native backend behaviour.
 */
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeBackend, type Store2Backend, type Store2WriteResult } from 'src/ts/storage/store2/backend'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { GC_AGE_KEY } from 'src/ts/storage/store2/gc/unitAge'
import { createNodeSemanticStore, type NodeSemanticStore } from './replay/nodeSemanticStore'

export interface FlushConfirming {
    /** What the page's session is opened over. */
    readonly backend: Store2Backend
    /** What a completed top-level write reports as `flushed`; `true` until a test switches it off. */
    flushed: boolean
    /** Every call so far, by method name, in order; a test empties it to start counting from a point. */
    readonly calls: string[]
    /** How many times `name` is in `calls`. */
    count(name: string): number
    /** Runs before the named call reaches the inner backend; `count` counts this call, so it starts at 1. */
    before: ((name: string, count: number) => Promise<void> | void) | null
}

export function flushConfirming(inner: Store2Backend): FlushConfirming {
    async function run<T>(name: string, body: () => Promise<T>): Promise<T> {
        control.calls.push(name)
        await control.before?.(name, control.count(name))
        return await body()
    }
    async function confirmed(name: string, body: () => Promise<Store2WriteResult>): Promise<Store2WriteResult> {
        const result = await run(name, body)
        return { ...result, flushed: control.flushed }
    }
    const backend: Store2Backend = {
        readCommit: () => run('readCommit', () => inner.readCommit()),
        readFence: () => run('readFence', () => inner.readFence()),
        casCommit: (expected, next) => confirmed('casCommit', () => inner.casCommit(expected, next)),
        casFence: (expected, next) => next === null
            ? run('casFence', () => inner.casFence(expected, next))
            : confirmed('casFence', () => inner.casFence(expected, next)),
        readUnits: keys => run('readUnits', () => inner.readUnits(keys)),
        listStore2: () => run('listStore2', () => inner.listStore2()),
        countPrefix: prefix => run('countPrefix', () => inner.countPrefix(prefix)),
        commitOrdinary: (expectedCommit, units, nextCommit) => confirmed('commitOrdinary', () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => run('putUnit', () => inner.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => run('removeBatch', () => inner.removeBatch(keys, expectedCommit, expectedFence)),
    }
    const control: FlushConfirming = {
        backend,
        flushed: true,
        calls: [],
        count: name => control.calls.filter(call => call === name).length,
        before: null,
    }
    return control
}

/** One Node world: the byte store a Node page holds and the store2 backend over that same store. */
export interface NodeWorld {
    /** The semantic model of the server behind `store`, for planting and inspecting files without a request. */
    readonly semantic: NodeSemanticStore
    /** The page's byte store: the semantic store with the server clock the aged deletion reads. */
    readonly store: ByteStore
    /** What the session is opened over and what the deleter runs on; it shares revisions with `store`. */
    readonly backend: Store2Backend
}

/**
 * Test-only: a Node page's store and backend over one `createNodeSemanticStore()`. The model has the guarded routes but no
 * server clock or revision listing, so the store adds `serverNow` from the test's own clock and `listRevisions` from the
 * model's revisions; every deleter that needs the aged dependencies
 * (`buildNodeGcAge`) therefore runs instead of being refused `capability-missing`. A pass here says nothing about the
 * real server's clock.
 */
export function nodeWorld(): NodeWorld {
    const semantic = createNodeSemanticStore()
    const { guarded } = semantic.store
    if (guarded === undefined) {
        throw new Error('The Node semantic store offers no guarded operations.')
    }
    const store: ByteStore = {
        ...semantic.store,
        // The revisions the model holds, as the server lists them under a prefix.
        listRevisions: async prefix => semantic.list(prefix).map(key => ({ key, rev: semantic.peek(key).revision })),
        guarded: { ...guarded, serverNow: async () => Date.now() },
    }
    return { semantic, store, backend: createNodeBackend(store) }
}

/** An earlier pass's record naming each of `keys` as seen before, dated `ageMs` ago: the next aged pass may retire them. */
export async function plantSeenUnits(world: NodeWorld, keys: readonly string[], ageMs: number = 25 * 60 * 60 * 1000): Promise<void> {
    const items = keys.map((key): [string, null, number] => [key, null, 1])
    await world.store.write(GC_AGE_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - ageMs, items }), 'unconditional')
}
