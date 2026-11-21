/**
 * The deleting pass of the inlay sweep (`store2/sweep/inlayRun.ts`): the keep-set members, the legacy-store filter, the
 * refusals and stops, the per-delete checks and the delete order.
 *
 * Stand-ins: inlays are written with the real `writeAppInlay` into a memory byte store; the closure is real frames in the
 * memory backend (inlay lists from the real producer `deriveInlayList`) read through the production reader; the gate is
 * the real `openDeleterGate`; the page's live facts (resident ids, other tabs, stop conditions, the legacy listing) are
 * functions of the test. Nothing here says anything about a real store, a real library or a real browser.
 *
 * The pass does not exist on the base, so an import failure there proves nothing: every test is a guard that a named
 * mutant of the rule it pins turns red.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { inlayBodyKey, inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { cacheInlayRender, cachedInlayRender } from 'src/ts/process/files/inlayRenderCache'
import {
    inlayWrittenThisPage, readAppInlayRecord, resetInlaysWrittenForTests, withInlayLock, writeAppInlay,
    type InlayAsset,
} from 'src/ts/process/files/inlayStore'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { openDeleterGate, type GateResult } from 'src/ts/storage/store2/boot'
import {
    encodeUnit, refOfFrame, UNIT_TYPE,
    type InlayList, type ListRef, type Manifest, type ModuleEntry, type Ref, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import { deriveInlayList } from 'src/ts/storage/store2/lists'
import {
    inlaySweepKind, runInlaySweep,
    type AssetSweepSession, type InlayResident, type InlaySweepEnv, type InlaySweepResult,
} from 'src/ts/storage/store2/sweep'
import { assetListOf, commitKeyOf, inlayListOf, manifestKey, unitTail } from './sweepFixtures'

const legacy = vi.hoisted(() => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    keys: vi.fn(async (): Promise<string[]> => []),
    clear: vi.fn(async () => undefined),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => legacy } }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

const uuid = (n: number): string => `0a1b2c3d-1111-4222-8333-${String(n).padStart(12, '0')}`
const A = uuid(1)
const R = uuid(2)
const O = uuid(3)
const O2 = uuid(4)
const Z = uuid(5)

interface World {
    backend: MemoryBackend
    store: MemoryByteStore
    kind: AppStoreKind
    nextUnit: number
    idleReason: string | null
    marks: number
    stop: boolean
    mentioned: Set<string>
    legacyIds: string[]
    openGate: (deleter: Parameters<AssetSweepSession['openGate']>[0]) => Promise<GateResult>
    peers: ReturnType<typeof vi.fn<InlaySweepEnv['peers']>>
    residentInlays: ReturnType<typeof vi.fn<InlaySweepEnv['residentInlays']>>
    legacyInlayIds: ReturnType<typeof vi.fn<InlaySweepEnv['legacyInlayIds']>>
    env: InlaySweepEnv
}

function newWorld(kind: AppStoreKind = 'indexeddb', over: Partial<InlaySweepEnv> = {}): World {
    const backend = createMemoryBackend()
    const store = createMemoryByteStore()
    const world: World = {
        backend, store, kind, nextUnit: 1, idleReason: null, marks: 0, stop: false, mentioned: new Set(), legacyIds: [],
        openGate: deleter => openDeleterGate(backend, deleter, { idleReason: world.idleReason }),
        peers: vi.fn<InlaySweepEnv['peers']>(async () => 'alone'),
        residentInlays: vi.fn<InlaySweepEnv['residentInlays']>(async (): Promise<InlayResident | null> => ({
            mentioned: world.mentioned, sameDatabase: () => true,
        })),
        legacyInlayIds: vi.fn<InlaySweepEnv['legacyInlayIds']>(async () => world.legacyIds),
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
        peers: world.peers,
        shouldStop: () => world.stop,
        saveMarks: () => world.marks,
        writtenThisPage: inlayWrittenThisPage,
        legacyInlayIds: world.legacyInlayIds,
        residentInlays: world.residentInlays,
        lock: withInlayLock,
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

async function storeList(world: World, type: typeof UNIT_TYPE.assetList | typeof UNIT_TYPE.inlayList, list: { v: number }): Promise<ListRef> {
    const { ref } = await storeUnit(world, type, list)
    return [ref[0], ref[1], ref[2], list.v]
}

/** The inlay list of an owner whose text names `ids`, from the real producer. */
function listNaming(...ids: string[]): InlayList {
    return deriveInlayList([{ text: ids.map(id => `{{inlayed::${id}}}`).join(' ') }])
}

interface ManifestSpec {
    configIl?: InlayList
    characters?: { u: string, il?: InlayList | 'missing' }[]
}

/** Stores a manifest of the producer's shape under `manifestKey(n)`; its inlay lists are real frames. */
async function addManifest(world: World, spec: ManifestSpec, n: number): Promise<string> {
    const characters: ShardEntry[] = []
    for (const c of spec.characters ?? []) {
        const al = await storeList(world, UNIT_TYPE.assetList, assetListOf([]))
        let il: ListRef | null = null
        if (c.il === 'missing') {
            il = [unitTail(900), 10, 1, 1]
        } else if (c.il !== undefined) {
            il = await storeList(world, UNIT_TYPE.inlayList, c.il)
        }
        characters.push({
            u: c.u, type: 'character', name: c.u, chaId: c.u, creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
            core: [unitTail(0), 10, 1], lore: null, scripts: null, al, il, dsp: false, chats: [],
        })
    }
    const shard = await storeUnit(world, UNIT_TYPE.shard, { v: 1, entries: characters })
    const modules: ModuleEntry[] = []
    const index = await storeUnit(world, UNIT_TYPE.moduleIndex, { v: 1, entries: modules })
    const configAl = await storeList(world, UNIT_TYPE.assetList, assetListOf([]))
    const configIl = await storeList(world, UNIT_TYPE.inlayList, spec.configIl ?? inlayListOf({}))
    const dummy: Ref = [unitTail(0), 10, 1]
    const manifest: Manifest = {
        fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [shard.ref],
        fixed: {
            config: dummy, configAl, il: configIl,
            statics: dummy, order: dummy, loadouts: dummy,
            moduleIndex: index.ref, presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] },
            legacyKeep: null,
        },
    }
    const key = manifestKey(n)
    await world.backend.putUnit(key, encodeUnit(UNIT_TYPE.manifest, manifest))
    return key
}

async function plantCommit(world: World, over: Parameters<typeof commitKeyOf>[0]): Promise<void> {
    await world.backend.casCommit((await world.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf(over)))
}

/** Writes an inlay with the real writer; the page's written set is cleared afterwards unless `keepWritten`. */
async function put(world: World, id: string, keepWritten = false): Promise<{ meta: string, body: string }> {
    const asset: InlayAsset = { name: id, ext: 'txt', type: 'image', data: `payload ${id}` }
    await writeAppInlay(world.store, id, asset)
    if (!keepWritten) {
        resetInlaysWrittenForTests()
    }
    const record = (await readAppInlayRecord(world.store, id))!
    return { meta: inlayMetaKey(id)!, body: record.body }
}

/** The current manifest names A, a retained manifest names R, O (and more) is named by nothing. */
async function libraryWorld(orphans: readonly string[], kind: AppStoreKind = 'indexeddb', over: Partial<InlaySweepEnv> = {}): Promise<World> {
    const world = newWorld(kind, over)
    const current = await addManifest(world, { characters: [{ u: 'a'.repeat(26), il: listNaming(A) }] }, 1)
    const retained = await addManifest(world, { characters: [{ u: 'b'.repeat(26), il: listNaming(R) }] }, 2)
    await plantCommit(world, { current, retained: [{ key: retained, at: 0 }] })
    for (const id of [A, R, ...orphans]) {
        await put(world, id)
    }
    return world
}

function present(world: World, id: string): boolean {
    return world.store.files.has(inlayMetaKey(id)!)
}

function done(result: InlaySweepResult) {
    if (result.status !== 'done') {
        throw new Error(`The pass ended ${JSON.stringify(result)}.`)
    }
    return result
}

let moves = 0

/** A commit by another writer: a new current manifest whose config names `ids`, the earlier manifests kept as retained. */
async function moveCommit(world: World, ids: readonly string[]): Promise<void> {
    moves++
    const next = await addManifest(world, { configIl: listNaming(...ids) }, 100 + moves)
    await plantCommit(world, {
        current: next,
        retained: [{ key: manifestKey(1), at: 0 }, { key: manifestKey(2), at: 0 }],
        seq: 10 + moves,
    })
}

beforeEach(() => {
    resetInlaysWrittenForTests()
    legacy.setItem.mockClear()
    legacy.removeItem.mockClear()
    legacy.clear.mockClear()
    legacy.keys.mockClear()
    moves = 0
})

describe('what the pass deletes', () => {
    test.each(['indexeddb', 'tauri'] as const)('AS1/G2: an unreferenced inlay goes with its body; the current and the retained manifest keep theirs (%s)', async (kind) => {
        const world = await libraryWorld([O], kind)
        const o = await put(world, O)
        world.store.deletes.length = 0

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ candidates: 1, deleted: 1, bodies: 1, failed: 0, keptLive: 0, keptLegacy: 0 })
        expect(result.stopped).toBeUndefined()
        expect(world.store.files.has(o.meta)).toBe(false)
        expect(world.store.files.has(o.body)).toBe(false)
        expect(present(world, A)).toBe(true)
        expect(present(world, R)).toBe(true)
        expect(world.store.deletes[0]).toBe(o.meta)
        expect(legacy.setItem).not.toHaveBeenCalled()
        expect(legacy.removeItem).not.toHaveBeenCalled()
        expect(legacy.clear).not.toHaveBeenCalled()
        if (kind === 'tauri') {
            expect(world.peers).not.toHaveBeenCalled()
        }
    })

    test('T3: an id only the resident walk names is kept', async () => {
        const world = await libraryWorld([O])
        world.mentioned.add(O)

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ candidates: 0, deleted: 0 })
        expect(present(world, O)).toBe(true)
    })

    test('T4: an id this page wrote through the real writer is kept; once the set is cleared the same world deletes it', async () => {
        const world = await libraryWorld([])
        await put(world, O, true)

        const first = done(await runInlaySweep(world.env))

        expect(first).toMatchObject({ candidates: 1, deleted: 0, keptLive: 1 })
        expect(present(world, O)).toBe(true)

        resetInlaysWrittenForTests()
        const second = done(await runInlaySweep(world.env))

        expect(second).toMatchObject({ deleted: 1, keptLive: 0 })
        expect(present(world, O)).toBe(false)
    })

    test('T5: a same-id writer queued ahead of the delete rewrites the inlay and it stays readable', async () => {
        const world = await libraryWorld([O])
        let release: () => void = () => undefined
        const held = new Promise<void>(resolve => { release = resolve })
        let lockAsked: () => void = () => undefined
        const asked = new Promise<void>(resolve => { lockAsked = resolve })
        world.env.lock = (id, work) => {
            lockAsked()
            return withInlayLock(id, work)
        }
        const writer = withInlayLock(O, async () => {
            await held
            const rewritten: InlayAsset = { name: O, ext: 'txt', type: 'image', data: 'rewritten' }
            await writeAppInlay(world.store, O, rewritten)
        })

        const pass = runInlaySweep(world.env)
        await asked
        release()
        await writer
        const result = done(await pass)

        expect(result).toMatchObject({ deleted: 0, keptLive: 1 })
        expect(await readAppInlayRecord(world.store, O)).not.toBeNull()
    })

    test('T6: a metadata delete that fails leaves the inlay whole and is counted', async () => {
        const world = await libraryWorld([O])
        const o = await put(world, O)
        world.store.failDelete = key => (key === o.meta ? new Error('delete failed') : null)

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0, failed: 1 })
        expect(world.store.files.has(o.meta)).toBe(true)
        expect(world.store.files.has(o.body)).toBe(true)
    })

    test('T7: a deleted id loses every listed body; a kept id\'s stale body and a body with no metadata stay', async () => {
        const world = await libraryWorld([O])
        const staleO = inlayBodyKey(O, 'ffffffffffffffff')!
        const staleA = inlayBodyKey(A, 'eeeeeeeeeeeeeeee')!
        const orphan = inlayBodyKey(Z, 'dddddddddddddddd')!
        for (const key of [staleO, staleA, orphan]) {
            world.store.files.set(key, new Uint8Array([1]))
        }

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 1, bodies: 2 })
        expect(world.store.files.has(staleO)).toBe(false)
        expect(world.store.files.has(staleA)).toBe(true)
        expect(world.store.files.has(orphan)).toBe(true)
    })

    test('T8: a metadata of a newer version is kept', async () => {
        const world = await libraryWorld([O])
        const meta = inlayMetaKey(O)!
        const record = JSON.parse(new TextDecoder().decode(world.store.files.get(meta)!)) as Record<string, unknown>
        world.store.files.set(meta, new TextEncoder().encode(JSON.stringify({ ...record, v: 2 })))

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0, keptLive: 1 })
        expect(world.store.files.has(meta)).toBe(true)
    })

    test('T15: an other-shaped id that nothing names is kept', async () => {
        const world = await libraryWorld([])
        await put(world, 'free-token')

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ candidates: 0, deleted: 0 })
        expect(present(world, 'free-token')).toBe(true)
    })

    test('T17: the render cached for a deleted id is dropped and the legacy store is never written', async () => {
        const world = await libraryWorld([O])
        cacheInlayRender(O, { type: 'image', url: '', source: 'signature' }, null)

        done(await runInlaySweep(world.env))

        expect(present(world, O)).toBe(false)
        expect(cachedInlayRender(O)).toBeNull()
        expect(legacy.removeItem).not.toHaveBeenCalled()
        expect(legacy.setItem).not.toHaveBeenCalled()
    })

    test('T16: no candidate and no unlegacied candidate mean no resident walk', async () => {
        const quiet = await libraryWorld([])
        done(await runInlaySweep(quiet.env))
        expect(quiet.residentInlays).not.toHaveBeenCalled()

        const listed = await libraryWorld([O])
        listed.legacyIds = [O]
        done(await runInlaySweep(listed.env))
        expect(listed.residentInlays).not.toHaveBeenCalled()
    })
})

describe('the legacy store filter', () => {
    test('T22: an unreferenced id the legacy store lists is kept; once unlisted a later pass deletes it', async () => {
        const world = await libraryWorld([O])
        world.legacyIds = [O]

        const first = done(await runInlaySweep(world.env))

        expect(first).toMatchObject({ candidates: 0, deleted: 0, keptLegacy: 1 })
        expect(present(world, O)).toBe(true)
        expect(legacy.setItem).not.toHaveBeenCalled()

        world.legacyIds = []
        const second = done(await runInlaySweep(world.env))

        expect(second).toMatchObject({ deleted: 1, keptLegacy: 0 })
        expect(present(world, O)).toBe(false)
    })

    test('T22: a legacy listing that fails refuses the round although the id is otherwise deletable', async () => {
        const world = await libraryWorld([O])
        world.legacyInlayIds.mockRejectedValue(new Error('no listing'))

        const result = await runInlaySweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'legacy-unlisted' })
        expect(present(world, O)).toBe(true)
        expect(world.store.deletes).toEqual([])
    })
})

describe('refusals', () => {
    test('T1: a keep-set that cannot be completed refuses and deletes nothing', async () => {
        const world = newWorld()
        const current = await addManifest(world, { characters: [{ u: 'a'.repeat(26), il: 'missing' }] }, 1)
        await plantCommit(world, { current })
        await put(world, O)

        const result = await runInlaySweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'keep-incomplete' })
        expect(present(world, O)).toBe(true)
    })

    test('T2: an owner whose list overflowed refuses and deletes nothing', async () => {
        const world = newWorld()
        const overflowed = deriveInlayList([{ text: `{{inlayed::${A}}}` }], { maxInlayBodyBytes: 1 })
        const current = await addManifest(world, { characters: [{ u: 'a'.repeat(26), il: overflowed }] }, 1)
        await plantCommit(world, { current })
        await put(world, O)

        const result = await runInlaySweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'unknown-owner' })
        expect(present(world, O)).toBe(true)
    })

    test.each([
        ['a standing marker', 'staging', (world: World) => plantCommit(world, {
            current: manifestKey(1),
            staging: { owner: 'b'.repeat(26), prefix: 'store2/g-0123456789abcdef-', startedAt: 0, label: 'bulk' },
        })],
        ['a fence', 'fenced', async (world: World) => {
            await world.backend.casFence((await world.backend.readFence()).token, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 0, priorCommits: [], keys: [] }))
        }],
    ])('T9: %s refuses at the gate and deletes nothing', async (_name, reason, setup) => {
        const world = await libraryWorld([O])
        await setup(world)

        const result = await runInlaySweep(world.env)

        expect(result).toMatchObject({ status: 'refused', reason })
        expect(present(world, O)).toBe(true)
        expect(world.store.deletes).toEqual([])
    })

    test('T14: a resident walk that could not finish refuses and deletes nothing', async () => {
        const world = await libraryWorld([O])
        world.residentInlays.mockResolvedValue(null)

        const result = await runInlaySweep(world.env)

        expect(result).toEqual({ status: 'refused', reason: 'resident-incomplete' })
        expect(present(world, O)).toBe(true)
    })

    test('T10: web peers: unsupported refuses, others refuses at the start and stops the pass before the next delete', async () => {
        const unsupported = await libraryWorld([O])
        unsupported.peers.mockResolvedValue('unsupported')
        expect(await runInlaySweep(unsupported.env)).toEqual({ status: 'refused', reason: 'no-web-locks' })
        expect(present(unsupported, O)).toBe(true)

        const others = await libraryWorld([O])
        others.peers.mockResolvedValue('others')
        expect(await runInlaySweep(others.env)).toEqual({ status: 'refused', reason: 'other-tab' })
        expect(present(others, O)).toBe(true)

        const later = await libraryWorld([O, O2])
        later.peers.mockResolvedValueOnce('alone').mockResolvedValueOnce('alone').mockResolvedValue('others')
        const result = done(await runInlaySweep(later.env))
        expect(result).toMatchObject({ deleted: 1, stopped: 'other-tab' })
        expect(present(later, O) !== present(later, O2)).toBe(true)
    })

    test('T25/G4: a Node session is skipped before any read, listing or gate', async () => {
        const world = await libraryWorld([O], 'node')
        const opened = vi.fn(world.openGate)
        world.openGate = opened
        world.store.lists.length = 0

        const result = await runInlaySweep(world.env)

        expect(result).toEqual({ status: 'skipped' })
        expect(inlaySweepKind('node')).toBe(false)
        expect(inlaySweepKind('tauri') && inlaySweepKind('indexeddb')).toBe(true)
        expect(present(world, O)).toBe(true)
        expect(world.store.lists).toEqual([])
        expect(world.legacyInlayIds).not.toHaveBeenCalled()
        expect(opened).not.toHaveBeenCalled()
    })
})

describe('stops before and between deletes', () => {
    test('T11: a stop condition that turns true before the second delete ends the pass with one delete', async () => {
        const world = await libraryWorld([O, O2])
        let locks = 0
        world.env.lock = async (id, work) => {
            const result = await withInlayLock(id, work)
            if (++locks === 1) {
                world.stop = true
            }
            return result
        }

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 1, stopped: 'yielded' })
        expect(present(world, O) !== present(world, O2)).toBe(true)
    })

    test('T11b: a stop that holds at the synchronous check and is gone right after still ends the pass', async () => {
        const world = await libraryWorld([O])
        world.env.lock = async (id, work) => {
            world.stop = true
            try {
                return await withInlayLock(id, work)
            } finally {
                world.stop = false
            }
        }

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0, keptLive: 0, stopped: 'yielded' })
        expect(present(world, O)).toBe(true)
    })

    test('T12: save marks that moved after the resident walk end the pass before any delete', async () => {
        const world = await libraryWorld([O])
        world.residentInlays.mockImplementation(async () => {
            world.marks++
            return { mentioned: new Set(), sameDatabase: () => true }
        })

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0, stopped: 'changed' })
        expect(present(world, O)).toBe(true)
    })

    test('T24: a database object replaced after the walk ends the pass before any delete', async () => {
        const world = await libraryWorld([O])
        world.residentInlays.mockImplementation(async () => ({ mentioned: new Set(), sameDatabase: () => false }))

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0, stopped: 'changed' })
        expect(present(world, O)).toBe(true)
    })

    test('T13: a commit between the listing and the first batch rebuilds the round, and an id the new commit names is kept', async () => {
        const world = await libraryWorld([O])
        let moved = false
        world.residentInlays.mockImplementation(async () => {
            if (!moved) {
                moved = true
                await moveCommit(world, [O])
            }
            return { mentioned: new Set(), sameDatabase: () => true }
        })

        const result = done(await runInlaySweep(world.env))

        expect(result).toMatchObject({ deleted: 0 })
        expect(result.stopped).toBeUndefined()
        expect(present(world, O)).toBe(true)
        expect(present(world, A)).toBe(true)
    })
})
