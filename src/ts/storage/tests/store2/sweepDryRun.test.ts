// @vitest-environment node
/**
 * The sweep dry run (`store2/sweep/dryRun.ts`): the keep-set members that protect an asset or an inlay, the refusals that end
 * the run, the report of a keep-set that is not complete, and the rule that the run writes nothing.
 *
 * What is a stand-in: the closure is real frames in the memory backend read through the production reader; the page store is a
 * memory byte store; the resident database is a function. Nothing here says anything about a real store or a real library.
 *
 * The dry run does not exist on the red base (the W5b commit), so a file here fails at import there, which proves nothing by
 * itself. A "reproducer" is red under the mutant named in the hand-back that removes the rule it pins; a "guard" pins a
 * behaviour that another layer also upholds or that documents the current rule.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import {
    encodeUnit, refOfFrame, SWEEP_KEY, UNIT_TYPE,
    type InlayList, type LegacyList, type ListRef, type Manifest, type ModuleEntry, type Ref, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import {
    buildInlayKeepSet, createBackendClosureReader, runSweepDryRun,
    type SweepDryRunEnv, type SweepDryRunReport,
} from 'src/ts/storage/store2/sweep'
import { assetListOf, commitKeyOf, inlayListOf, legacyListOf, manifestKey, refOf, unitTail } from './sweepFixtures'

const UUID_CURRENT = '00000000-0000-4000-8000-000000000001'
const UUID_RETAINED = '00000000-0000-4000-8000-000000000002'
const UUID_PINNED = '00000000-0000-4000-8000-000000000003'
const UUID_LEGACY = '00000000-0000-4000-8000-000000000004'
const UUID_RESIDENT = '00000000-0000-4000-8000-000000000005'
const UUID_ORPHAN = '00000000-0000-4000-8000-000000000006'
const NOW = 1_900_000_000_000

interface ManifestSpec {
    config?: string[]
    characters?: { u: string, assets?: string[], il?: InlayList | null }[]
    legacy?: { list: LegacyList, files: { key: string, status: 'ok' | 'unreadable' | 'gone' }[] }
}

interface Built {
    key: string
    configAl: string
    configIl: string
}

interface Faults {
    /** Backend methods called, in order. */
    backendCalls: string[]
    /** Write attempts of the page store and of the backend, in order. */
    writeAttempts: string[]
}

interface World {
    backend: MemoryBackend
    store: MemoryByteStore
    faults: Faults
    nextUnit: number
    idleReason: string | null
    env: SweepDryRunEnv
}

function newWorld(over: Partial<SweepDryRunEnv> = {}): World {
    const backend = createMemoryBackend()
    const store = createMemoryByteStore({ blobs: true })
    const faults: Faults = { backendCalls: [], writeAttempts: [] }
    const forbid = (name: string): never => {
        faults.writeAttempts.push(name)
        throw new Error(`The dry run called ${name}.`)
    }
    // The page store refuses and records every write form; the backend does the same for every write of the protocol.
    store.write = async () => forbid('store.write')
    store.delete = async () => forbid('store.delete')
    store.deleteMany = async () => forbid('store.deleteMany')
    store.writeBlob = async () => forbid('store.writeBlob')
    const guarded: Store2Backend = {
        readCommit: () => { faults.backendCalls.push('readCommit'); return backend.readCommit() },
        readFence: () => { faults.backendCalls.push('readFence'); return backend.readFence() },
        casCommit: () => forbid('casCommit'),
        casFence: () => forbid('casFence'),
        readUnits: keys => { faults.backendCalls.push('readUnits'); return backend.readUnits(keys) },
        listStore2: () => { faults.backendCalls.push('listStore2'); return backend.listStore2() },
        countPrefix: prefix => { faults.backendCalls.push('countPrefix'); return backend.countPrefix(prefix) },
        commitOrdinary: () => forbid('commitOrdinary'),
        putUnit: () => forbid('putUnit'),
        removeBatch: () => forbid('removeBatch'),
    }
    const world: World = {
        backend, store, faults, nextUnit: 1, idleReason: null,
        env: null as never,
    }
    world.env = {
        session: { backend: guarded, openGate: deleter => openDeleterGate(guarded, deleter, { idleReason: world.idleReason }) },
        store,
        residentRefs: () => [],
        writtenThisPage: () => [],
        residentInlays: async () => new Set(),
        isOwnerResident: () => false,
        now: () => NOW,
        ...over,
    }
    return world
}

/** Stores `body` as a unit of `type` and returns the Ref a referrer would hold. */
function storeUnit(world: World, type: UnitType, body: object): { key: string, ref: Ref } {
    const key = `store2/${unitTail(world.nextUnit++)}`
    const bytes = encodeUnit(type, body)
    world.backend.poke(key, bytes)
    return { key, ref: refOfFrame(key, bytes) }
}

function storeList(world: World, type: typeof UNIT_TYPE.assetList | typeof UNIT_TYPE.inlayList, list: { v: number }): { key: string, ref: ListRef } {
    const { key, ref } = storeUnit(world, type, list)
    return { key, ref: [ref[0], ref[1], ref[2], list.v] }
}

function addManifest(world: World, spec: ManifestSpec, n: number): Built {
    const characters: ShardEntry[] = (spec.characters ?? []).map(c => ({
        u: c.u, type: 'character', name: c.u, chaId: c.u, creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
        core: refOf(unitTail(0)), lore: null, scripts: null,
        al: storeList(world, UNIT_TYPE.assetList, assetListOf(c.assets ?? [])).ref,
        il: c.il ? storeList(world, UNIT_TYPE.inlayList, c.il).ref : null,
        dsp: false, chats: [],
    }))
    const shard = storeUnit(world, UNIT_TYPE.shard, { v: 1, entries: characters })
    const modules: ModuleEntry[] = []
    const index = storeUnit(world, UNIT_TYPE.moduleIndex, { v: 1, entries: modules })
    const configAl = storeList(world, UNIT_TYPE.assetList, assetListOf(spec.config ?? []))
    const configIl = storeList(world, UNIT_TYPE.inlayList, inlayListOf({}))
    const dummy = refOf(unitTail(0))
    const legacy = spec.legacy === undefined ? null : {
        unit: storeUnit(world, UNIT_TYPE.legacyList, spec.legacy.list).ref,
        v: spec.legacy.list.v,
        files: spec.legacy.files,
    }
    const manifest: Manifest = {
        fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [shard.ref],
        fixed: {
            config: dummy, configAl: configAl.ref, il: configIl.ref, statics: dummy, order: dummy, loadouts: dummy,
            moduleIndex: index.ref, presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] },
            legacyKeep: legacy,
        },
    }
    const key = manifestKey(n)
    world.backend.poke(key, encodeUnit(UNIT_TYPE.manifest, manifest))
    return { key, configAl: configAl.key, configIl: configIl.key }
}

async function plantCommit(world: World, over: Parameters<typeof commitKeyOf>[0]): Promise<void> {
    await world.backend.casCommit((await world.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf(over)))
}

function putAssets(world: World, names: readonly string[]): void {
    for (const name of names) {
        world.store.files.set(`assets/${name}`, new Uint8Array([1]))
    }
}

function putInlays(world: World, ids: readonly string[]): void {
    for (const id of ids) {
        world.store.files.set(`inlays/m-${id}`, new Uint8Array([1]))
    }
}

/** The library every member test shares: one asset and one inlay per keep-set member, and one of each that nothing protects. */
const MEMBER_ASSETS = {
    current: 'cur.png',
    config: 'cfg.png',
    retained: 'ret.png',
    pinned: 'pin.png',
    legacy: 'leg.png',
    resident: 'res.png',
    written: 'wrt.png',
} as const

async function memberWorld(over: Partial<SweepDryRunEnv> = {}): Promise<World> {
    const world = newWorld({
        residentRefs: () => [MEMBER_ASSETS.resident],
        writtenThisPage: () => [`assets/${MEMBER_ASSETS.written}`],
        residentInlays: async () => new Set([UUID_RESIDENT]),
        ...over,
    })
    const current = addManifest(world, {
        config: [MEMBER_ASSETS.config],
        characters: [{ u: 'a'.repeat(26), assets: [MEMBER_ASSETS.current], il: inlayListOf({ u: [UUID_CURRENT] }) }],
        legacy: {
            list: legacyListOf({ l: [MEMBER_ASSETS.legacy], i: inlayListOf({ u: [UUID_LEGACY] }) }),
            files: [{ key: 'database/database.bin', status: 'ok' }],
        },
    }, 1)
    const retained = addManifest(world, {
        characters: [{ u: 'b'.repeat(26), assets: [MEMBER_ASSETS.retained], il: inlayListOf({ u: [UUID_RETAINED] }) }],
    }, 2)
    const pinned = addManifest(world, {
        characters: [{ u: 'c'.repeat(26), assets: [MEMBER_ASSETS.pinned], il: inlayListOf({ u: [UUID_PINNED] }) }],
    }, 3)
    await plantCommit(world, {
        current: current.key,
        retained: [{ key: retained.key, at: 0 }],
        pins: [{ key: pinned.key, reason: 'test' }],
    })
    putAssets(world, [...Object.values(MEMBER_ASSETS), 'orphan.png'])
    putInlays(world, [UUID_CURRENT, UUID_RETAINED, UUID_PINNED, UUID_LEGACY, UUID_RESIDENT, UUID_ORPHAN])
    return world
}

function done(report: SweepDryRunReport) {
    if (report.status !== 'done') {
        throw new Error(`The dry run ended ${JSON.stringify(report)}.`)
    }
    return report
}

describe('each asset keep-set member protects its asset', () => {
    test.each(Object.entries(MEMBER_ASSETS))('reproducer: the %s member keeps %s out of the candidates', async (_member, name) => {
        const world = await memberWorld()

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.keep).toEqual({ keepSet: 'complete' })
        expect(report.assets.candidates.sample).not.toContain(name)
    })

    test('reproducer: an asset no member protects is the only candidate', async () => {
        const world = await memberWorld()

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.candidates).toEqual({ count: 1, sample: ['orphan.png'] })
        expect(report.assets.listed).toBe(8)
    })

    test('guard: a nested key under assets/ is not an asset name and is never listed as a candidate', async () => {
        const world = await memberWorld()
        world.store.files.set('assets/sub/deep.png', new Uint8Array([1]))

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.listed).toBe(8)
        expect(report.assets.candidates.sample).not.toContain('sub/deep.png')
    })
})

describe('each inlay keep-set member protects its inlay', () => {
    test.each([
        ['current', UUID_CURRENT],
        ['retained-only', UUID_RETAINED],
        ['pinned-only', UUID_PINNED],
        ['legacy-i-only', UUID_LEGACY],
        ['resident database', UUID_RESIDENT],
    ])('reproducer: the %s inlay is not a would-delete candidate', async (_member, id) => {
        const world = await memberWorld()

        const report = done(await runSweepDryRun(world.env))

        expect(report.inlays.keep).toEqual({ keepSet: 'complete' })
        expect(report.inlays.wouldDelete.sample).not.toContain(id)
    })

    test('reproducer: the one inlay no member protects is the only would-delete candidate, and the rest are kept by reason', async () => {
        const world = await memberWorld()

        const report = done(await runSweepDryRun(world.env))

        expect(report.inlays.stored).toBe(6)
        expect(report.inlays.wouldDelete).toEqual({ count: 1, sample: [UUID_ORPHAN] })
        expect(report.inlays.kept).toEqual({ 'in-keep-set': 4, 'in-resident-database': 1 })
    })

    test('guard: an owner whose inlay list is null is not recorded as an owner, so it cannot make an id of another shape stay', async () => {
        const world = newWorld()
        const built = addManifest(world, { characters: [{ u: 'a'.repeat(26), il: null }] }, 1)
        await plantCommit(world, { current: built.key })

        const reader = createBackendClosureReader(world.env.session.backend as Store2Backend)
        const keep = await buildInlayKeepSet({
            commitKey: commitKeyOf({ current: built.key }),
            reader,
        })

        expect(keep.status).toBe('complete')
        expect(keep.status === 'complete' ? keep.keep.owners.map(owner => owner.kind) : []).toEqual(['config'])
    })
})

describe('a keep-set that is not complete reports why and names no candidate', () => {
    test('reproducer: an unreadable asset list makes the asset keep-set incomplete with zero candidates', async () => {
        const world = await memberWorld()
        const built = addManifest(world, { config: ['x.png'] }, 4)
        await plantCommit(world, { current: built.key })
        world.backend.poke(built.configAl, null)

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.keep.keepSet).toBe('incomplete')
        expect(report.assets.keep.keepSet === 'incomplete' ? report.assets.keep.reasons.map(reason => reason.code) : []).toContain('node-missing')
        expect(report.assets.candidates).toEqual({ count: 0, sample: [] })
    })

    test('reproducer: an inlay list that fails its checksum makes the inlay keep-set incomplete with zero would-delete', async () => {
        const world = await memberWorld()
        const built = addManifest(world, { config: ['x.png'] }, 4)
        await plantCommit(world, { current: built.key })
        const stored = (await world.backend.readUnits([built.configIl])).get(built.configIl) as Uint8Array
        const flipped = stored.slice()
        flipped[flipped.length - 1] ^= 0xff
        world.backend.poke(built.configIl, flipped)

        const report = done(await runSweepDryRun(world.env))

        expect(report.inlays.keep.keepSet).toBe('incomplete')
        expect(report.inlays.keep.keepSet === 'incomplete' ? report.inlays.keep.reasons.map(reason => reason.code) : []).toContain('node-crc-failed')
        expect(report.inlays.wouldDelete).toEqual({ count: 0, sample: [] })
        expect(report.assets.keep).toEqual({ keepSet: 'complete' })
    })

    test('guard: every manifest the commit key names is read, so one damaged retained manifest makes the result incomplete', async () => {
        const world = await memberWorld()
        const damaged = addManifest(world, {}, 5)
        world.backend.poke(damaged.key, null)
        await plantCommit(world, { current: manifestKey(1), retained: [{ key: damaged.key, at: 0 }] })

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.keep.keepSet).toBe('incomplete')
        expect(report.assets.candidates.count).toBe(0)
    })
})

describe('the asset count and the limit', () => {
    test('reproducer: a count above the limit is reported as over the limit and does not stop the report', async () => {
        const world = await memberWorld({ limit: 3 })
        world.store.countPrefix = async () => 8

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets).toMatchObject({ count: 8, limit: 3, auto: false, limitReason: 'over-limit' })
        expect(report.assets.candidates.count).toBe(1)
    })

    test('reproducer: a store that cannot count answers unknown, which is not within the limit', async () => {
        const world = await memberWorld()
        world.store.countPrefix = async () => null

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets).toMatchObject({ count: 'unknown', auto: false, limitReason: 'unknown-count' })
    })

    test('guard: a store with no count (Tauri) uses the listing, and a count within the limit is within the limit', async () => {
        const world = await memberWorld()

        const report = done(await runSweepDryRun(world.env))

        expect(world.store.countPrefix).toBeUndefined()
        expect(report.assets).toMatchObject({ count: 8, auto: true, limitReason: 'within-limit' })
    })
})

describe('the refusals that end the run before any closure read', () => {
    async function refusedWorld(setup: (world: World) => Promise<void> | void) {
        const world = await memberWorld()
        await setup(world)
        world.faults.backendCalls.length = 0
        world.store.reads.length = 0
        world.store.lists.length = 0
        return world
    }

    test.each([
        ['an idle session', 'idle', (world: World) => { world.idleReason = 'The commit key could not be flushed.' }],
        ['a fence', 'fenced', async (world: World) => {
            await world.backend.casFence((await world.backend.readFence()).token, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 0, priorCommits: [], keys: [] }))
        }],
        ['a standing marker', 'staging', async (world: World) => {
            await plantCommit(world, {
                current: manifestKey(1),
                staging: { owner: 'b'.repeat(26), prefix: 'store2/g-0123456789abcdef-', startedAt: 0, label: 'bulk' },
            })
        }],
        ['no current manifest', 'no-current', (world: World) => plantCommit(world, { current: null })],
    ])('reproducer: %s refuses at the gate and reads nothing beyond the commit key and the fence', async (_name, reason, setup) => {
        const world = await refusedWorld(setup)

        const report = await runSweepDryRun(world.env)

        expect(report).toMatchObject({ status: 'refused', stage: 'gate', reason })
        expect(world.faults.backendCalls.every(call => call === 'readCommit' || call === 'readFence')).toBe(true)
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
    })

    test('reproducer: an unreadable legacy file refuses at the fence check and names no candidate', async () => {
        const world = newWorld()
        const built = addManifest(world, {
            legacy: { list: legacyListOf({}), files: [{ key: 'database/dbbackup-1.bin', status: 'unreadable' }] },
        }, 1)
        await plantCommit(world, { current: built.key })

        const report = await runSweepDryRun(world.env)

        expect(report).toMatchObject({ status: 'refused', stage: 'fences' })
        expect(report.status === 'refused' && report.stage === 'fences' ? report.reasons : []).toContain('legacy-file-unreadable')
    })

    test('guard: a read-only session with no backend refuses at the gate', async () => {
        const world = await memberWorld()

        const report = await runSweepDryRun({
            ...world.env,
            session: { backend: null, openGate: async () => ({ status: 'refused', reason: 'idle', detail: 'read-only' }) },
        })

        expect(report).toMatchObject({ status: 'refused', stage: 'gate', reason: 'idle' })
    })
})

describe('the age record is read and never written', () => {
    test('reproducer: an absent record, a damaged record and a stored record are each reported', async () => {
        const world = await memberWorld()

        expect(done(await runSweepDryRun(world.env)).ageRecord).toEqual({ state: 'absent' })

        world.store.files.set(SWEEP_KEY, new Uint8Array([9, 9, 9]))
        expect(done(await runSweepDryRun(world.env)).ageRecord).toEqual({ state: 'unreadable' })

        world.store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, {
            v: 1, at: NOW - 3_600_000, items: [['orphan.png', null], ['gone.png', null]],
        }))
        expect(done(await runSweepDryRun(world.env)).ageRecord).toEqual({
            state: 'ok', at: NOW - 3_600_000, ageMs: 3_600_000, items: 2, stillCandidates: 1,
        })
    })

    test('reproducer: a full dry run over a library with every member calls no write or delete of the store or the backend, and changes nothing', async () => {
        const world = await memberWorld()
        world.store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: NOW - 1000, items: [['orphan.png', null]] }))
        const storeBefore = new Map([...world.store.files].map(([key, bytes]) => [key, bytes.slice()]))
        const backendBefore = world.backend.snapshot()

        const report = done(await runSweepDryRun(world.env))

        expect(report.assets.candidates.count).toBe(1)
        expect(world.faults.writeAttempts).toEqual([])
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
        expect(world.store.files).toEqual(storeBefore)
        expect(world.backend.snapshot()).toEqual(backendBefore)
    })

    test('guard: the keep-set builds share one read per unit, so each stored unit is fetched at most once', async () => {
        const world = await memberWorld()
        const fetched: string[] = []
        const inner = world.env.session.backend as Store2Backend
        world.env.session = {
            backend: { ...inner, readUnits: keys => { fetched.push(...keys); return inner.readUnits(keys) } },
            openGate: world.env.session.openGate,
        }

        done(await runSweepDryRun(world.env))

        expect(fetched.length).toBeGreaterThan(0)
        expect(new Set(fetched).size).toBe(fetched.length)
    })
})
