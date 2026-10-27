/**
 * Fixtures of the commit-protocol tests: the three backends of the fence
 * fixtures, a deterministic clock and randomness, synthetic complete trees (a
 * manifest, a shard, a module index, a plugin-storage bucket and leaves), a
 * recording and fault-injecting backend wrapper, and an independent I1 oracle
 * that walks the stored trees without the library's own tree check.
 */
import { expect } from 'vitest'
import {
    createCommitter, IMPORT_REPLACES_BASE, type BuildContext, type BuiltCommit, type Committer, type CommitRequest,
} from 'src/ts/storage/store2/commit'
import { classifyCommitRead, firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import type { Store2Backend, UnitWrite } from 'src/ts/storage/store2/backend'
import {
    encodeUnit, newManifestKey, newShardKey, newUnitKey, readUnit, refOfFrame, refsOf, UNIT_TYPE,
    type CommitKey, type KeyEnv, type Manifest, type Ref, type UnitType,
} from 'src/ts/storage/store2/format'
import { freshOwnerId, type ForeignClearHook } from 'src/ts/storage/store2/owner'

export { FENCE_BACKENDS as COMMIT_BACKENDS, plantCommit, type OpenedBackend } from './fenceFixtures'

export const START_TIME = 1_700_000_000_000

export interface TestClock {
    now: number
    advance(ms: number): void
}

export function createClock(start = START_TIME): TestClock {
    const clock: TestClock = { now: start, advance: (ms) => { clock.now += ms } }
    return clock
}

/** A seeded byte stream: no two draws of a run repeat, and two seeds differ. */
function seededRandom(seed: number): (length: number) => Uint8Array {
    let state = seed >>> 0
    return (length) => Uint8Array.from({ length }, () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) & 0xFF
    })
}

export function testEnv(clock: TestClock, seed: number): KeyEnv {
    return { random: seededRandom(seed), now: () => clock.now }
}

export interface BuildRecord {
    /** Every key the build issued, manifest included. */
    keys: string[]
    manifest: string
    /** The plugin-storage value unit reached only through the bucket. */
    value: string
    /** The first extra preset unit, or null when none. */
    preset: string | null
}

/** A complete tree of `10 + extra` units besides the manifest, under keys of `ctx.mint`. */
export function buildTree(extra: number, ctx: BuildContext, tag: string, record?: BuildRecord[]): BuiltCommit {
    const units: UnitWrite[] = []
    const add = (type: UnitType, body: object, key: string): Ref => {
        const bytes = encodeUnit(type, body)
        units.push({ key, bytes })
        return refOfFrame(key, bytes)
    }
    const listRef = (type: UnitType, body: object): [string, number, number, number] => {
        const ref = add(type, body, ctx.mint.unit())
        return [ref[0], ref[1], ref[2], 1]
    }
    const valueRef = add(UNIT_TYPE.pluginStorageValue, { v: 1, tag }, ctx.mint.unit())
    const bucketRef = add(UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [{ k: 'a', ref: valueRef }] }, ctx.mint.unit())
    const presets: Ref[] = []
    for (let i = 0; i < extra; i++) {
        presets.push(add(UNIT_TYPE.preset, { v: 1, tag, i }, ctx.mint.unit()))
    }
    const body: Manifest = {
        fmt: 1,
        req: [],
        seq: ctx.seq,
        createdAt: ctx.now,
        shardCount: 1,
        shards: [add(UNIT_TYPE.shard, { v: 1, entries: [] }, ctx.mint.shard())],
        fixed: {
            config: add(UNIT_TYPE.configRoot, { v: 1, tag }, ctx.mint.unit()),
            configAl: listRef(UNIT_TYPE.assetList, { v: 1, h: '', l: [] }),
            il: listRef(UNIT_TYPE.inlayList, { v: 1, u: [], h: '', o: [] }),
            statics: add(UNIT_TYPE.statics, { v: 1 }, ctx.mint.unit()),
            order: add(UNIT_TYPE.order, { v: 1, tag }, ctx.mint.unit()),
            loadouts: add(UNIT_TYPE.loadouts, { v: 1 }, ctx.mint.unit()),
            moduleIndex: add(UNIT_TYPE.moduleIndex, { v: 1, entries: [] }, ctx.mint.unit()),
            presets,
            plugins: [],
            pluginStorage: { buckets: 1, refs: [bucketRef] },
            legacyKeep: null,
        },
    }
    const manifestKey = ctx.mint.manifest()
    record?.push({
        keys: [...units.map(unit => unit.key), manifestKey],
        manifest: manifestKey,
        value: valueRef[0],
        preset: presets.length > 0 ? presets[0][0] : null,
    })
    return { units, manifest: { key: manifestKey, body } }
}

/** Units a `buildTree(extra)` writes, the manifest included. */
export function treeUnitCount(extra: number): number {
    return 11 + extra
}

export function treeRequest(extra: number, options: { tag?: string, record?: BuildRecord[], label?: CommitRequest['label'] } = {}): CommitRequest {
    return {
        newUnits: treeUnitCount(extra),
        label: options.label,
        carry: IMPORT_REPLACES_BASE,
        build: (ctx) => buildTree(extra, ctx, options.tag ?? 'x', options.record),
    }
}

/** Writes a first complete tree and the first commit key naming it: the state every protocol test starts from. Returns the manifest key. */
export async function seedStore(backend: Store2Backend, env: KeyEnv): Promise<string> {
    const built = buildTree(0, {
        mint: {
            shard: () => newShardKey(env),
            unit: () => newUnitKey(env),
            manifest: () => newManifestKey(env),
        },
        seq: 1,
        now: env.now(),
    }, 'seed')
    for (const unit of [...built.units, { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }]) {
        await backend.putUnit(unit.key, unit.bytes)
    }
    const first = firstCommitKey({ current: { key: built.manifest.key, at: env.now() }, staging: null, manifests: [built.manifest.body] }, env)
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))
    return built.manifest.key
}

export function committerOf(backend: Store2Backend, clock: TestClock, seed: number, options: { owner?: string, foreignClear?: ForeignClearHook } = {}): Committer {
    const env = testEnv(clock, seed)
    return createCommitter(backend, {
        owner: options.owner ?? freshOwnerId(env),
        env,
        foreignClear: options.foreignClear,
    })
}

export async function parsedCommit(backend: Store2Backend): Promise<CommitKey> {
    const read = classifyCommitRead(await backend.readCommit())
    if (read.status !== 'parsed') {
        throw new Error(`The commit key is ${read.status}.`)
    }
    return read.value
}

/** Writes `next` as the commit key over whatever is stored: how a test plays a peer or plants a marker. */
export async function plantKey(backend: Store2Backend, key: CommitKey): Promise<void> {
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
}

/** A peer's logical write over the stored key: `change` applied through `nextCommitKey` and written at a fresh read. */
export async function peerWrite(backend: Store2Backend, env: KeyEnv, change: Parameters<typeof nextCommitKey>[1]): Promise<CommitKey> {
    const next = nextCommitKey(await parsedCommit(backend), change, env)
    await plantKey(backend, next)
    return next
}

const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

/**
 * I1: every manifest the commit key names (`current`, `retained`, `pins`) has its
 * complete tree stored. The walk uses `refsOf` and a listing only.
 */
export async function expectInvariant(backend: Store2Backend): Promise<void> {
    const key = await parsedCommit(backend)
    const listed = new Set(await backend.listStore2())
    const manifests = new Set<string>([
        ...(key.current === null ? [] : [key.current.key]),
        ...key.retained.map(entry => entry.key),
        ...key.pins.map(pin => pin.key),
    ])
    for (const manifestKey of manifests) {
        expect(listed.has(manifestKey), `${manifestKey} is stored`).toBe(true)
        const bytes = (await backend.readUnits([manifestKey])).get(manifestKey) ?? null
        expect(bytes).not.toBeNull()
        const manifest = readUnit(bytes as Uint8Array, UNIT_TYPE.manifest)
        expect(manifest.status).toBe('ok')
        if (manifest.status !== 'ok') {
            continue
        }
        for (const target of refsOf(UNIT_TYPE.manifest, manifest.value.body)) {
            const named = `store2/${target.tail}`
            expect(listed.has(named), `${named} named by ${manifestKey} at ${target.path}`).toBe(true)
            const type = DESCENT[target.path]
            if (type === undefined) {
                continue
            }
            const child = readUnit((await backend.readUnits([named])).get(named) as Uint8Array, type)
            expect(child.status).toBe('ok')
            if (child.status !== 'ok') {
                continue
            }
            for (const leaf of refsOf(type, child.value.body)) {
                expect(listed.has(`store2/${leaf.tail}`), `store2/${leaf.tail} named by ${named}`).toBe(true)
            }
        }
    }
}

export interface Hooks {
    /** Runs before the named call reaches the inner backend; throwing aborts the call without applying it. `count` starts at 1. */
    before?: (name: string, count: number) => Promise<void> | void
    /** Runs after the call completed; throwing loses its response after it was applied. */
    after?: (name: string, count: number) => Promise<void> | void
}

export interface Hooked {
    backend: Store2Backend
    /** Every call in order by method name. */
    log: string[]
    count(name: string): number
}

/** The backend with every call recorded and optional interleavings and faults; everything else is delegated unchanged. */
export function hooked(inner: Store2Backend, hooks: Hooks = {}): Hooked {
    const log: string[] = []
    const started = new Map<string, number>()
    const finished = new Map<string, number>()

    async function run<T>(name: string, body: () => Promise<T>): Promise<T> {
        log.push(name)
        const begun = (started.get(name) ?? 0) + 1
        started.set(name, begun)
        await hooks.before?.(name, begun)
        const result = await body()
        const done = (finished.get(name) ?? 0) + 1
        finished.set(name, done)
        await hooks.after?.(name, done)
        return result
    }

    const backend: Store2Backend = {
        readCommit: () => run('readCommit', () => inner.readCommit()),
        readFence: () => run('readFence', () => inner.readFence()),
        casCommit: (expected, next) => run('casCommit', () => inner.casCommit(expected, next)),
        casFence: (expected, next) => run('casFence', () => inner.casFence(expected, next)),
        readUnits: (keys) => run('readUnits', () => inner.readUnits(keys)),
        listStore2: () => run('listStore2', () => inner.listStore2()),
        countPrefix: (prefix) => run('countPrefix', () => inner.countPrefix(prefix)),
        commitOrdinary: (expectedCommit, units, nextCommit) => run('commitOrdinary', () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => run('putUnit', () => inner.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => run('removeBatch', () => inner.removeBatch(keys, expectedCommit, expectedFence)),
    }
    return { backend, log, count: (name) => started.get(name) ?? 0 }
}
