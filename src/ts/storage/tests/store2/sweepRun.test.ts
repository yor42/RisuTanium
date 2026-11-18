// @vitest-environment node
/**
 * The deleting pass of the asset sweep (`store2/sweep/run.ts`): the two-pass age rule, the keep-set members, the refusals and
 * stops, the per-delete checks, the deletion hold and the freshness probe of both backend kinds.
 *
 * Stand-ins: the closure is real frames in the memory backend read through the production reader; the page store is a memory
 * byte store; the page's live facts (resident names, written names, other tabs, stop conditions) are functions of the test.
 * Nothing here says anything about a real store, a real library or a real browser. The Tauri native gate has its own file
 * (`sweepRunTauriGate.test.ts`).
 *
 * The pass does not exist on the base, so an import failure there proves nothing: every test is a guard that a named mutant
 * of the rule it pins turns red.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { AssetDeleteHoldOverlapError, assetDeletionSettled, holdAssetDeletion, isAssetDeletionHeld, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { openDeleterGate, type GateResult } from 'src/ts/storage/store2/boot'
import {
    encodeUnit, refOfFrame, SWEEP_KEY, UNIT_TYPE,
    type ListRef, type Manifest, type ModuleEntry, type Ref, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import {
    SWEEP_MIN_AGE_MS, readSweepRecord, runAssetSweep,
    type AssetSweepEnv, type AssetSweepResult, type AssetSweepSession,
} from 'src/ts/storage/store2/sweep'
import { assetListOf, commitKeyOf, inlayListOf, manifestKey, unitTail } from './sweepFixtures'

const NOW = 1_900_000_000_000
const DAY = SWEEP_MIN_AGE_MS
const REFERENCED = ['cfg.png', 'cur.png', 'ret.png', 'pin.png'] as const

interface World {
    backend: MemoryBackend
    store: MemoryByteStore
    kind: AppStoreKind
    now: number
    nextUnit: number
    idleReason: string | null
    written: Set<string>
    resident: Set<string>
    released: string[][]
    openGate: (deleter: Parameters<AssetSweepSession['openGate']>[0]) => Promise<GateResult>
    env: AssetSweepEnv
}

function newWorld(kind: AppStoreKind = 'indexeddb', over: Partial<AssetSweepEnv> = {}): World {
    const backend = createMemoryBackend()
    const store = createMemoryByteStore()
    const world: World = {
        backend, store, kind, now: NOW, nextUnit: 1, idleReason: null,
        written: new Set(), resident: new Set(), released: [],
        openGate: deleter => openDeleterGate(backend, deleter, { idleReason: world.idleReason }),
        env: null as never,
    }
    const session: AssetSweepSession = {
        kind,
        backend,
        get idleReason() { return world.idleReason },
        openGate: deleter => world.openGate(deleter),
    }
    world.env = {
        session,
        store,
        now: () => world.now,
        residentRefs: () => world.resident,
        writtenCount: () => world.written.size,
        writtenThisPage: () => world.written,
        peers: async () => 'alone',
        shouldStop: () => false,
        release: keys => { world.released.push([...keys]) },
        hold: remove => holdAssetDeletion(remove),
        ...over,
    }
    return world
}

async function storeUnit(world: World, type: UnitType, body: object): Promise<{ key: string, ref: Ref }> {
    const key = `store2/${unitTail(world.nextUnit++)}`
    const bytes = encodeUnit(type, body)
    await world.backend.putUnit(key, bytes)
    return { key, ref: refOfFrame(key, bytes) }
}

async function storeList(world: World, type: typeof UNIT_TYPE.assetList | typeof UNIT_TYPE.inlayList, list: { v: number }): Promise<{ key: string, ref: ListRef }> {
    const { key, ref } = await storeUnit(world, type, list)
    return { key, ref: [ref[0], ref[1], ref[2], list.v] }
}

interface ManifestSpec {
    config?: string[]
    characters?: { u: string, assets?: string[] }[]
}

/** Stores a manifest of the producer's shape under `manifestKey(n)`; its asset lists are real frames. */
async function addManifest(world: World, spec: ManifestSpec, n: number): Promise<{ key: string, configAl: string, characterAl: string[] }> {
    const characterAl: string[] = []
    const characters: ShardEntry[] = []
    for (const c of spec.characters ?? []) {
        const al = await storeList(world, UNIT_TYPE.assetList, assetListOf(c.assets ?? []))
        characterAl.push(al.key)
        characters.push({
            u: c.u, type: 'character', name: c.u, chaId: c.u, creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
            core: [unitTail(0), 10, 1], lore: null, scripts: null, al: al.ref, il: null, dsp: false, chats: [],
        })
    }
    const shard = await storeUnit(world, UNIT_TYPE.shard, { v: 1, entries: characters })
    const modules: ModuleEntry[] = []
    const index = await storeUnit(world, UNIT_TYPE.moduleIndex, { v: 1, entries: modules })
    const configAl = await storeList(world, UNIT_TYPE.assetList, assetListOf(spec.config ?? []))
    const configIl = await storeList(world, UNIT_TYPE.inlayList, inlayListOf({}))
    const dummy: Ref = [unitTail(0), 10, 1]
    const manifest: Manifest = {
        fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [shard.ref],
        fixed: {
            config: dummy, configAl: configAl.ref, il: configIl.ref, statics: dummy, order: dummy, loadouts: dummy,
            moduleIndex: index.ref, presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] },
            legacyKeep: null,
        },
    }
    const key = manifestKey(n)
    await world.backend.putUnit(key, encodeUnit(UNIT_TYPE.manifest, manifest))
    return { key, configAl: configAl.key, characterAl }
}

async function plantCommit(world: World, over: Parameters<typeof commitKeyOf>[0]): Promise<void> {
    await world.backend.casCommit((await world.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf(over)))
}

function putAssets(world: World, names: readonly string[]): void {
    for (const name of names) {
        world.store.files.set(`assets/${name}`, new Uint8Array([1]))
    }
}

function has(world: World, name: string): boolean {
    return world.store.files.has(`assets/${name}`)
}

function orphanNames(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `o${String(i).padStart(3, '0')}.png`)
}

/** Current, retained and pinned manifests each refer to one asset, the config to another; `orphans` are stored and referred to by nothing. */
async function libraryWorld(orphans: readonly string[], kind: AppStoreKind = 'indexeddb', over: Partial<AssetSweepEnv> = {}): Promise<World> {
    const world = newWorld(kind, over)
    const current = await addManifest(world, { config: ['cfg.png'], characters: [{ u: 'a'.repeat(26), assets: ['cur.png'] }] }, 1)
    const retained = await addManifest(world, { characters: [{ u: 'b'.repeat(26), assets: ['ret.png'] }] }, 2)
    const pinned = await addManifest(world, { characters: [{ u: 'c'.repeat(26), assets: ['pin.png'] }] }, 3)
    await plantCommit(world, {
        current: current.key,
        retained: [{ key: retained.key, at: 0 }],
        pins: [{ key: pinned.key, reason: 'test' }],
    })
    putAssets(world, [...REFERENCED, ...orphans])
    return world
}

let moves = 0

/** A commit by another writer: a new current manifest that also refers to `protect`, the earlier manifests kept as retained and pinned. */
async function moveCommit(world: World, protect: readonly string[] = []): Promise<void> {
    moves++
    const next = await addManifest(world, { config: ['cfg.png', ...protect] }, 100 + moves)
    await plantCommit(world, {
        current: next.key,
        retained: [{ key: manifestKey(1), at: 0 }, { key: manifestKey(2), at: 0 }],
        pins: [{ key: manifestKey(3), reason: 'test' }],
        seq: 10 + moves,
    })
}

function done(result: AssetSweepResult) {
    if (result.status !== 'done') {
        throw new Error(`The pass ended ${JSON.stringify(result)}.`)
    }
    return result
}

/** Records the orphans (first pass), then moves the clock past the minimum age and clears the store's write log. */
async function recordThenAge(world: World): Promise<void> {
    expect(done(await runAssetSweep(world.env)).phase).toBe('recorded')
    world.now += DAY + 1000
    world.store.writes.length = 0
    world.store.deletes.length = 0
}

beforeEach(() => {
    resetAssetDeleteHoldForTests()
})

afterEach(() => {
    resetAssetDeleteHoldForTests()
})

describe('the two-pass age rule', () => {
    test('C1: the first pass records the orphan and deletes nothing, the pass 24 hours later deletes it and keeps every referenced asset', async () => {
        const world = await libraryWorld(['orphan.png'])

        const first = done(await runAssetSweep(world.env))

        expect(first).toMatchObject({ phase: 'recorded', deleted: 0, recorded: true, candidates: 1 })
        expect(has(world, 'orphan.png')).toBe(true)
        expect(world.store.deletes).toEqual([])
        expect(await readSweepRecord(world.store)).toMatchObject({ status: 'ok', value: { at: NOW, items: [['orphan.png', null]] } })

        world.now += DAY + 1000
        const second = done(await runAssetSweep(world.env))

        expect(second).toMatchObject({ phase: 'swept', deleted: 1, failed: 0, keptLive: 0, recorded: true })
        expect(has(world, 'orphan.png')).toBe(false)
        for (const name of REFERENCED) {
            expect(has(world, name)).toBe(true)
        }
    })

    test('C2: assets only a retained or a pinned manifest names are kept, and the swept pass rewrites the record with the assets first seen now', async () => {
        const world = await libraryWorld(['orphan.png'])
        await recordThenAge(world)
        putAssets(world, ['fresh.png'])

        const second = done(await runAssetSweep(world.env))

        expect(second).toMatchObject({ phase: 'swept', deleted: 1, recorded: true })
        expect(has(world, 'ret.png') && has(world, 'pin.png')).toBe(true)
        expect(has(world, 'fresh.png')).toBe(true)
        expect(await readSweepRecord(world.store)).toMatchObject({ status: 'ok', value: { at: world.now, items: [['fresh.png', null]] } })
    })

    test('C3: a pass inside the minimum age writes nothing and deletes nothing', async () => {
        const world = await libraryWorld(['orphan.png'])
        await recordThenAge(world)
        world.now = NOW + DAY - 60_000
        const before = await world.store.read(SWEEP_KEY)

        const second = done(await runAssetSweep(world.env))

        expect(second).toMatchObject({ phase: 'young', deleted: 0, recorded: false })
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
        expect(has(world, 'orphan.png')).toBe(true)
        expect((await world.store.read(SWEEP_KEY)).bytes).toEqual(before.bytes)
    })

    test('C13: a record dated more than ten minutes ahead is recorded again, one within ten minutes is young', async () => {
        const world = await libraryWorld(['orphan.png'])
        const plant = (at: number) => world.store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at, items: [['orphan.png', null]] }))

        plant(NOW + 11 * 60_000)
        const far = done(await runAssetSweep(world.env))
        expect(far).toMatchObject({ phase: 'recorded', deleted: 0, recorded: true })
        expect(await readSweepRecord(world.store)).toMatchObject({ value: { at: NOW } })

        world.store.writes.length = 0
        plant(NOW + 5 * 60_000)
        const near = done(await runAssetSweep(world.env))
        expect(near).toMatchObject({ phase: 'young', recorded: false })
        expect(world.store.writes).toEqual([])
        expect(has(world, 'orphan.png')).toBe(true)
    })
})

describe('what ends the pass before any delete', () => {
    test('C4: an incomplete keep-set deletes nothing and leaves the record as it was', async () => {
        const world = await libraryWorld(['orphan.png'])
        await recordThenAge(world)
        const before = await world.store.read(SWEEP_KEY)
        const next = await addManifest(world, { config: ['x.png'] }, 50)
        await plantCommit(world, { current: next.key })
        world.backend.poke(next.configAl, null)

        const result = await runAssetSweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'keep-incomplete' })
        expect(world.store.deletes).toEqual([])
        expect(world.store.writes).toEqual([])
        expect((await world.store.read(SWEEP_KEY)).bytes).toEqual(before.bytes)
        expect(has(world, 'orphan.png')).toBe(true)
    })

    test.each([
        ['an idle session', 'idle', (world: World) => { world.idleReason = 'The commit key could not be flushed.' }],
        ['a fence', 'fenced', async (world: World) => {
            await world.backend.casFence((await world.backend.readFence()).token, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 0, priorCommits: [], keys: [] }))
        }],
        ['a standing marker', 'staging', (world: World) => plantCommit(world, {
            current: manifestKey(1),
            staging: { owner: 'b'.repeat(26), prefix: 'store2/g-0123456789abcdef-', startedAt: 0, label: 'bulk' },
        })],
        ['no current manifest', 'no-current', (world: World) => plantCommit(world, { current: null })],
    ])('C5: %s refuses at the gate and lists, reads, writes and deletes nothing', async (_name, reason, setup) => {
        const world = await libraryWorld(['orphan.png'])
        await recordThenAge(world)
        await setup(world)
        world.store.reads.length = 0
        world.store.lists.length = 0

        const result = await runAssetSweep(world.env)

        expect(result).toEqual({ status: 'refused', reason })
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
    })

    test('C15: a count above the limit, and a store that cannot count, delete nothing and write nothing', async () => {
        const world = await libraryWorld(['orphan.png'], 'indexeddb', { limit: 3 })
        world.store.countPrefix = async () => 5

        expect(await runAssetSweep(world.env)).toEqual({ status: 'refused', reason: 'over-limit' })

        world.env.limit = undefined
        world.store.countPrefix = async () => null
        expect(await runAssetSweep(world.env)).toEqual({ status: 'refused', reason: 'unknown-count' })
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
    })

    test('C16: a record a newer build wrote, and a record the store could not read, refuse with no write; a damaged record starts a new clock', async () => {
        const world = await libraryWorld(['orphan.png'])
        world.store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 2, at: 1, items: [['orphan.png', null]] }))
        expect(await runAssetSweep(world.env)).toEqual({ status: 'refused', reason: 'record-too-new' })
        expect(world.store.writes).toEqual([])

        world.store.files.set(SWEEP_KEY, new Uint8Array([1, 2, 3]))
        world.store.failRead = key => key === SWEEP_KEY ? new Error('read failed') : null
        expect(await runAssetSweep(world.env)).toEqual({ status: 'refused', reason: 'record-io-failed' })
        expect(world.store.writes).toEqual([])
        expect([...(world.store.files.get(SWEEP_KEY) ?? [])]).toEqual([1, 2, 3])

        world.store.failRead = null
        expect(done(await runAssetSweep(world.env))).toMatchObject({ phase: 'recorded', recorded: true, deleted: 0 })
        expect(has(world, 'orphan.png')).toBe(true)
    })

    test.each(['indexeddb', 'tauri'] as const)('C16: a commit key that moves between the gate and the record write writes no record (%s)', async (kind) => {
        const world = await libraryWorld(['orphan.png'], kind)
        const openGate = world.openGate
        world.openGate = async deleter => {
            const gate = await openGate(deleter)
            await moveCommit(world)
            return gate
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'commit-conflict', recorded: false, deleted: 0 })
        expect(world.store.writes).toEqual([])
    })

    test.each([['node'], ['opfs-transitional']] as const)('C12: a %s page reads, lists, writes and deletes nothing and never opens the gate', async (kind) => {
        const world = await libraryWorld(['orphan.png'], kind)
        const openGate = vi.fn(world.openGate)
        world.openGate = openGate
        world.store.reads.length = 0

        expect(await runAssetSweep(world.env)).toEqual({ status: 'skipped' })

        expect(openGate).not.toHaveBeenCalled()
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
    })

    test('C12: a page with no backend is skipped without a read', async () => {
        const world = await libraryWorld(['orphan.png'], 'tauri')
        const session: AssetSweepSession = { kind: 'tauri', backend: null, idleReason: null, openGate: world.openGate }

        expect(await runAssetSweep({ ...world.env, session })).toEqual({ status: 'skipped' })
        expect(world.store.lists).toEqual([])
    })
})

describe('what the pass keeps at the moment of each delete', () => {
    test.each(['indexeddb', 'tauri'] as const)('C8: an asset this page wrote after the keep-set was built is kept, also under another case (%s)', async (kind) => {
        const world = await libraryWorld(['late.png', 'other.png'], kind)
        await recordThenAge(world)
        // `now` is read once per round, after the keep-set is built.
        world.env.now = () => {
            world.written.add('assets/LATE.png')
            return world.now
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ deleted: 1, keptLive: 1 })
        expect(has(world, 'late.png')).toBe(true)
        expect(has(world, 'other.png')).toBe(false)
    })

    test('C9: resident names are read again for every batch, so a name that became resident after the keep-set was built is kept', async () => {
        const orphans = orphanNames(26)
        const world = await libraryWorld(orphans)
        await recordThenAge(world)
        world.env.now = () => {
            world.resident.add(orphans[0])
            return world.now
        }
        world.env.pace = async () => {
            world.resident.add(orphans[25])
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ deleted: 24, keptLive: 2, batches: 2 })
        expect(has(world, orphans[0])).toBe(true)
        expect(has(world, orphans[25])).toBe(true)
        expect(has(world, orphans[1])).toBe(false)
    })

    test('C17: a name nested under assets/ is not an asset, and a delete the store fails is counted without naming the asset while the rest are removed', async () => {
        const world = await libraryWorld(['bad.png', 'good.png'])
        world.store.files.set('assets/sub/deep.png', new Uint8Array([1]))
        await recordThenAge(world)
        world.store.failDelete = key => key === 'assets/bad.png' ? new Error('delete failed') : null

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ deleted: 1, failed: 1, phase: 'swept', recorded: true })
        expect(JSON.stringify(result)).not.toContain('bad.png')
        expect(has(world, 'bad.png')).toBe(true)
        expect(has(world, 'good.png')).toBe(false)
        expect(world.store.files.has('assets/sub/deep.png')).toBe(true)
    })

    test('C14: the keys released are exactly the keys removed', async () => {
        const world = await libraryWorld(['bad.png', 'good.png', 'live.png'])
        await recordThenAge(world)
        world.resident.add('live.png')
        world.env.now = () => world.now
        world.store.failDelete = key => key === 'assets/bad.png' ? new Error('delete failed') : null

        done(await runAssetSweep(world.env))

        expect(world.released).toEqual([['assets/good.png']])
    })
})

describe('what ends the pass between and at deletes', () => {
    test('C10: other tabs ask before every delete on the web: the second delete is refused and the pass stops with one delete and no record', async () => {
        const world = await libraryWorld(['o1.png', 'o2.png', 'o3.png'])
        await recordThenAge(world)
        let calls = 0
        world.env.peers = async () => {
            calls++
            return calls >= 3 ? 'others' : 'alone'
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'other-tab', deleted: 1, recorded: false })
        expect(world.store.deletes).toEqual(['assets/o1.png'])
        expect(world.store.writes).toEqual([])
    })

    test.each([['unsupported', 'no-web-locks'], ['others', 'other-tab']] as const)('C10: a web page whose tab query says %s reads and deletes nothing', async (answer, reason) => {
        const world = await libraryWorld(['o1.png'])
        world.env.peers = async () => answer
        world.store.reads.length = 0

        expect(await runAssetSweep(world.env)).toEqual({ status: 'refused', reason })
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
    })

    test('C10: a Tauri page never asks about other tabs', async () => {
        const world = await libraryWorld(['o1.png'], 'tauri')
        const peers = vi.fn(async () => 'others' as const)
        world.env.peers = peers

        expect(done(await runAssetSweep(world.env)).recorded).toBe(true)
        expect(peers).not.toHaveBeenCalled()
    })

    test('C11: a stop condition after the first delete ends the pass before the next delete and writes no record', async () => {
        const world = await libraryWorld(['o1.png', 'o2.png', 'o3.png'])
        await recordThenAge(world)
        world.env.shouldStop = () => world.store.deletes.length >= 1

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'yielded', deleted: 1, recorded: false })
        expect(world.store.deletes).toHaveLength(1)
        expect(world.store.writes).toEqual([])
    })

    test('C11: a stop condition already true at the start touches nothing', async () => {
        const world = await libraryWorld(['o1.png'])
        world.env.shouldStop = () => true
        world.store.reads.length = 0

        expect(done(await runAssetSweep(world.env))).toMatchObject({ stopped: 'yielded', phase: null })
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
    })

    test('S3: a session that goes idle between batches stops the pass before the next batch', async () => {
        const orphans = orphanNames(26)
        const world = await libraryWorld(orphans, 'tauri')
        await recordThenAge(world)
        world.env.pace = async () => {
            world.idleReason = 'The commit key could not be flushed.'
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'idle', deleted: 25, recorded: false })
        expect(has(world, orphans[25])).toBe(true)
    })

    test.each(['indexeddb', 'tauri'] as const)('C6: a fence that appears between batches stops the pass before the next batch (%s)', async (kind) => {
        const orphans = orphanNames(26)
        const world = await libraryWorld(orphans, kind)
        await recordThenAge(world)
        world.env.pace = async () => {
            await world.backend.casFence((await world.backend.readFence()).token, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 0, priorCommits: [], keys: [] }))
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'fence-conflict', deleted: 25, recorded: false })
        expect(has(world, orphans[25])).toBe(true)
        expect(world.store.writes).toEqual([])
    })

    test.each(['indexeddb', 'tauri'] as const)('C7: a commit between batches rebuilds the keep-set, so an asset the new commit refers to survives (%s)', async (kind) => {
        const orphans = orphanNames(26)
        const world = await libraryWorld(orphans, kind)
        await recordThenAge(world)
        world.env.pace = async () => {
            await moveCommit(world, [orphans[25]])
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ phase: 'swept', deleted: 25, batches: 1, recorded: true })
        expect(result.stopped).toBeUndefined()
        expect(has(world, orphans[25])).toBe(true)
        expect(await readSweepRecord(world.store)).toMatchObject({ status: 'ok', value: { at: world.now, items: [] } })
    })

    test.each(['indexeddb', 'tauri'] as const)('C7: a commit key that moves in every round ends the pass after two rounds with nothing deleted (%s)', async (kind) => {
        const world = await libraryWorld(['o1.png'], kind)
        await recordThenAge(world)
        const openGate = world.openGate
        let opened = 0
        world.openGate = async deleter => {
            opened++
            const gate = await openGate(deleter)
            await moveCommit(world)
            return gate
        }

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'commit-conflict', deleted: 0, recorded: false })
        expect(opened).toBe(2)
        expect(has(world, 'o1.png')).toBe(true)
        expect(world.store.writes).toEqual([])
    })

    test('C7: a refusal in the round after a rebuild carries the deletes of the earlier round', async () => {
        const orphans = orphanNames(26)
        const world = await libraryWorld(orphans)
        await recordThenAge(world)
        world.env.pace = async () => {
            await moveCommit(world)
        }
        const openGate = world.openGate
        let opened = 0
        world.openGate = async deleter => {
            opened++
            if (opened === 2) {
                return { status: 'refused', reason: 'staging', detail: 'test' }
            }
            return openGate(deleter)
        }

        const result = await runAssetSweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'staging', deleted: 25, failed: 0 })
        expect(world.store.writes).toEqual([])
    })

    test('M30a: a stop that turns true only after the last delete and before the record write writes no record', async () => {
        const world = await libraryWorld(['o1.png'])
        await recordThenAge(world)
        world.env.shouldStop = () => world.store.deletes.length >= 1

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ stopped: 'yielded', deleted: 1, recorded: false })
        expect(world.store.writes).toEqual([])
    })
})

describe('the deletion hold', () => {
    test('C18: every delete runs inside the hold callback and the hold is registered once per delete', async () => {
        const world = await libraryWorld(['o1.png', 'o2.png'])
        await recordThenAge(world)
        const original = world.store.delete.bind(world.store)
        world.store.delete = async (key, condition) => {
            if (!isAssetDeletionHeld()) {
                throw new Error('A delete ran outside the hold.')
            }
            return original(key, condition)
        }
        const hold = vi.fn((remove: () => Promise<void>) => holdAssetDeletion(remove))
        world.env.hold = hold

        const result = done(await runAssetSweep(world.env))

        expect(result).toMatchObject({ deleted: 2, failed: 0 })
        expect(hold).toHaveBeenCalledTimes(2)
        expect(isAssetDeletionHeld()).toBe(false)
    })

    test('C19: a same-page writer that notes the asset in a microtask after the written check waits for the delete and writes afterwards, so the asset is present at the end', async () => {
        const world = await libraryWorld(['x1.png', 'x2.png'])
        await recordThenAge(world)
        let reads = 0
        let writer: Promise<void> = Promise.resolve()
        world.env.writtenCount = () => {
            reads++
            if (reads === 1) {
                queueMicrotask(() => {
                    writer = (async () => {
                        world.written.add('assets/x1.png')
                        if (isAssetDeletionHeld()) {
                            await assetDeletionSettled()
                        }
                        world.store.files.set('assets/x1.png', new Uint8Array([2]))
                    })()
                })
            }
            return world.written.size
        }

        const result = done(await runAssetSweep(world.env))
        await writer

        expect(result).toMatchObject({ deleted: 2 })
        expect([...(world.store.files.get('assets/x1.png') ?? [])]).toEqual([2])
        expect(has(world, 'x2.png')).toBe(false)
    })

    test('E1: a hold overlap is a programming error that ends the pass with a rejection and writes no record', async () => {
        const world = await libraryWorld(['o1.png', 'o2.png'])
        await recordThenAge(world)
        world.env.hold = () => {
            throw new AssetDeleteHoldOverlapError()
        }

        await expect(runAssetSweep(world.env)).rejects.toBeInstanceOf(AssetDeleteHoldOverlapError)

        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
    })
})
