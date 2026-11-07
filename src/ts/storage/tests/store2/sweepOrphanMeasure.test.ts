// @vitest-environment node
/**
 * The orphan measurement (`store2/sweep/orphanMeasure.ts`): the tiers it reports, the keep-sets each depends on, the size
 * sources and the rule that it reads and never writes.
 *
 * What is a stand-in: the closure is real frames in the memory backend read through the production reader; the page store is a
 * memory byte store with doubles for the optional size members; the resident database is a function. Nothing here says anything
 * about a real store or a real library, and a `sizeOf` double is not the native `read_range` command.
 *
 * The module does not exist on the commit before it, so a file here fails at import there, which proves nothing by
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
import { DEFAULT_SAMPLE, runSweepDryRun } from 'src/ts/storage/store2/sweep'
import { measureAssetOrphans, type AssetOrphanEnv, type AssetOrphanReport } from 'src/ts/storage/store2/sweep/orphanMeasure'
import { assetListOf, commitKeyOf, inlayListOf, legacyListOf, manifestKey, refOf, unitTail } from './sweepFixtures'

const NOW = 1_900_000_000_000

interface ManifestSpec {
    config?: string[]
    characters?: { u: string, assets?: string[], il?: InlayList | null }[]
    legacy?: { list: LegacyList, files: { key: string, status: 'ok' | 'unreadable' | 'gone' }[] }
}

interface Built {
    key: string
    configAl: string
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
    env: AssetOrphanEnv
}

function newWorld(over: Partial<AssetOrphanEnv> = {}): World {
    const backend = createMemoryBackend()
    const store = createMemoryByteStore({ blobs: true })
    const faults: Faults = { backendCalls: [], writeAttempts: [] }
    const forbid = (name: string): never => {
        faults.writeAttempts.push(name)
        throw new Error(`The measurement called ${name}.`)
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
    const world: World = { backend, store, faults, nextUnit: 1, idleReason: null, env: null as never }
    world.env = {
        session: { backend: guarded, openGate: deleter => openDeleterGate(guarded, deleter, { idleReason: world.idleReason }) },
        store,
        residentRefs: () => [],
        writtenThisPage: () => [],
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
    return { key, configAl: configAl.key }
}

async function plantCommit(world: World, over: Parameters<typeof commitKeyOf>[0]): Promise<void> {
    await world.backend.casCommit((await world.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf(over)))
}

/** Stores each asset with `size` bytes (a name's size from `sizes`, else 1). */
function putAssets(world: World, names: readonly string[], sizes: Readonly<Record<string, number>> = {}): void {
    for (const name of names) {
        world.store.files.set(`assets/${name}`, new Uint8Array(sizes[name] ?? 1))
    }
}

/** The library every member test shares: one asset per keep-set member and per page source, and one that nothing protects. */
const MEMBER_ASSETS = {
    current: 'cur.png',
    config: 'cfg.png',
    retained: 'ret.png',
    pinned: 'pin.png',
    legacy: 'leg.png',
    resident: 'res.png',
    written: 'wrt.png',
} as const

const SIZES: Record<string, number> = {
    'cur.png': 1, 'cfg.png': 2, 'ret.png': 3, 'pin.png': 4, 'leg.png': 5, 'res.png': 6, 'wrt.png': 7, 'orphan.png': 8,
}

async function memberWorld(over: Partial<AssetOrphanEnv> = {}): Promise<World> {
    const world = newWorld({
        residentRefs: () => [MEMBER_ASSETS.resident],
        writtenThisPage: () => [`assets/${MEMBER_ASSETS.written}`],
        ...over,
    })
    const current = addManifest(world, {
        config: [MEMBER_ASSETS.config],
        characters: [{ u: 'a'.repeat(26), assets: [MEMBER_ASSETS.current] }],
        legacy: {
            list: legacyListOf({ l: [MEMBER_ASSETS.legacy] }),
            files: [{ key: 'database/database.bin', status: 'ok' }],
        },
    }, 1)
    const retained = addManifest(world, { characters: [{ u: 'b'.repeat(26), assets: [MEMBER_ASSETS.retained] }] }, 2)
    const pinned = addManifest(world, { characters: [{ u: 'c'.repeat(26), assets: [MEMBER_ASSETS.pinned] }] }, 3)
    await plantCommit(world, {
        current: current.key,
        retained: [{ key: retained.key, at: 0 }],
        pins: [{ key: pinned.key, reason: 'test' }],
    })
    putAssets(world, [...Object.values(MEMBER_ASSETS), 'orphan.png'], SIZES)
    return world
}

function done(report: AssetOrphanReport) {
    if (report.status !== 'done') {
        throw new Error(`The measurement ended ${JSON.stringify(report)}.`)
    }
    return report
}

describe('the tiers of a library with every keep-set member', () => {
    test('reproducer: each tier lists exactly the names its rule leaves out, with the bytes of those names', async () => {
        const world = await memberWorld()

        const report = done(await measureAssetOrphans(world.env))

        expect(report.keep).toEqual({ head: { keepSet: 'complete' }, full: { keepSet: 'complete' } })
        expect(report.listed).toBe(8)
        expect(report.retained).toBe(1)
        expect(report.pins).toBe(1)
        expect(report.notInHead).toEqual({ count: 3, bytes: 3 + 4 + 8, sample: ['orphan.png', 'pin.png', 'ret.png'] })
        expect(report.notInAny).toEqual({ count: 1, bytes: 8, sample: ['orphan.png'] })
        expect(report.restorePointsOnly).toEqual({ count: 2, bytes: 3 + 4, sample: ['pin.png', 'ret.png'] })
        expect(report.pageOnly).toEqual({ count: 2, bytes: null, sample: ['res.png', 'wrt.png'] })
        expect(report.bytesSource).toBe('read')
        expect(report.vanished).toBe(0)
    })

    test('reproducer: a name this page refers to is in no orphan tier and is counted as page-only', async () => {
        const world = await memberWorld()

        const report = done(await measureAssetOrphans(world.env))

        for (const tier of [report.notInHead, report.notInAny, report.restorePointsOnly]) {
            expect(tier?.sample).not.toContain(MEMBER_ASSETS.resident)
            expect(tier?.sample).not.toContain(MEMBER_ASSETS.written)
        }
        expect(report.pageOnly?.sample).toEqual([MEMBER_ASSETS.resident, MEMBER_ASSETS.written])
    })

    test('guard: a nested key under assets/ is not an asset name and is in no tier', async () => {
        const world = await memberWorld()
        world.store.files.set('assets/sub/deep.png', new Uint8Array([1]))

        const report = done(await measureAssetOrphans(world.env))

        expect(report.listed).toBe(8)
        expect(report.notInHead?.sample).not.toContain('sub/deep.png')
        expect(report.notInAny?.sample).not.toContain('sub/deep.png')
    })

    test('guard: notInAny counts the same names as the dry run candidates on the same inputs', async () => {
        const world = await memberWorld()

        const report = done(await measureAssetOrphans(world.env))
        const dry = await runSweepDryRun({
            ...world.env,
            residentInlays: async () => new Set(),
            isOwnerResident: () => false,
            now: () => NOW,
        })

        expect(dry.status).toBe('done')
        expect(report.notInAny?.count).toBe(dry.status === 'done' ? dry.assets.candidates.count : -1)
        expect(report.notInAny?.sample).toEqual(dry.status === 'done' ? dry.assets.candidates.sample : [])
    })

    test('reproducer: the sample lists at most sampleSize names and the count is still whole', async () => {
        const world = await memberWorld({ sampleSize: 1 })

        const report = done(await measureAssetOrphans(world.env))

        expect(report.notInHead?.count).toBe(3)
        expect(report.notInHead?.sample).toEqual(['orphan.png'])
    })
})

describe('legacyKeepInHead follows the current manifest', () => {
    test('reproducer: true when the current manifest carries a legacy list, false when it does not', async () => {
        const withLegacy = await memberWorld()
        const without = newWorld()
        const plain = addManifest(without, { config: ['x.png'] }, 1)
        await plantCommit(without, { current: plain.key })

        const first = done(await measureAssetOrphans(withLegacy.env))
        const second = done(await measureAssetOrphans(without.env))

        expect(first.legacyKeepInHead).toBe(true)
        expect(second.legacyKeepInHead).toBe(false)
    })
})

describe('a keep-set that is not complete reports why and gives no partial number', () => {
    test('reproducer: a fault in the current manifest makes every tier null and reads no size', async () => {
        const world = await memberWorld()
        const built = addManifest(world, { config: ['x.png'] }, 4)
        await plantCommit(world, { current: built.key })
        world.backend.poke(built.configAl, null)

        const report = done(await measureAssetOrphans(world.env))

        expect(report.keep.head.keepSet).toBe('incomplete')
        expect(report.keep.full.keepSet).toBe('incomplete')
        expect(report.notInHead).toBeNull()
        expect(report.notInAny).toBeNull()
        expect(report.restorePointsOnly).toBeNull()
        expect(report.pageOnly).toBeNull()
        expect(report.bytesSource).toBeNull()
        expect(world.store.reads).toEqual([])
    })

    test('reproducer: a fault only in a retained manifest keeps the head tier with its bytes and nulls the rest', async () => {
        const world = await memberWorld()
        const damaged = addManifest(world, {}, 5)
        world.backend.poke(damaged.key, null)
        await plantCommit(world, { current: manifestKey(1), retained: [{ key: damaged.key, at: 0 }] })

        const report = done(await measureAssetOrphans(world.env))

        expect(report.keep.head).toEqual({ keepSet: 'complete' })
        expect(report.keep.full.keepSet).toBe('incomplete')
        expect(report.notInHead).toEqual({ count: 3, bytes: 3 + 4 + 8, sample: ['orphan.png', 'pin.png', 'ret.png'] })
        expect(report.notInAny).toBeNull()
        expect(report.restorePointsOnly).toBeNull()
        expect(report.pageOnly).toBeNull()
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

        const report = await measureAssetOrphans(world.env)

        expect(report).toMatchObject({ status: 'refused', stage: 'gate', reason })
        expect(world.faults.backendCalls.every(call => call === 'readCommit' || call === 'readFence')).toBe(true)
        expect(world.store.reads).toEqual([])
        expect(world.store.lists).toEqual([])
    })

    test('reproducer: an unreadable legacy file refuses at the fence check with its reason and reports no tier', async () => {
        const world = newWorld()
        const built = addManifest(world, {
            legacy: { list: legacyListOf({}), files: [{ key: 'database/dbbackup-1.bin', status: 'unreadable' }] },
        }, 1)
        await plantCommit(world, { current: built.key })

        const report = await measureAssetOrphans(world.env)

        expect(report).toMatchObject({ status: 'refused', stage: 'fences' })
        expect(report.status === 'refused' && report.stage === 'fences' ? report.reasons : []).toContain('legacy-file-unreadable')
    })

    test('guard: a listing that fails is reported as a failed listing', async () => {
        const world = await memberWorld()
        world.store.list = async () => { throw new Error('The listing failed.') }

        const report = await measureAssetOrphans(world.env)

        expect(report).toEqual({ status: 'failed', stage: 'assets-listing', detail: 'The listing failed.' })
    })
})

describe('the stored size comes from the first source the store offers', () => {
    test('reproducer: listSized sums every orphan, not the sample, and a key it omits is empty', async () => {
        const world = newWorld()
        const built = addManifest(world, { config: ['keep.png'] }, 1)
        await plantCommit(world, { current: built.key })
        const names = Array.from({ length: DEFAULT_SAMPLE + 5 }, (_, i) => `o${String(i).padStart(2, '0')}.png`)
        putAssets(world, ['keep.png', ...names], Object.fromEntries(names.map((name, i) => [name, i === 0 ? 0 : i + 1])))
        world.store.listSized = async (prefix, minSize) => [...world.store.files]
            .filter(([key, bytes]) => key.startsWith(prefix) && bytes.length > minSize)
            .map(([key, bytes]) => ({ key, size: bytes.length }))
        world.store.read = async key => { throw new Error(`read ${key}`) }

        const report = done(await measureAssetOrphans(world.env))

        const expected = names.reduce((sum, _name, i) => sum + (i === 0 ? 0 : i + 1), 0)
        expect(report.bytesSource).toBe('listSized')
        expect(report.notInHead?.count).toBe(names.length)
        expect(report.notInHead?.sample).toHaveLength(DEFAULT_SAMPLE)
        expect(report.notInHead?.bytes).toBe(expected)
        expect(report.notInAny?.bytes).toBe(expected)
        expect(report.vanished).toBe(0)
    })

    test('reproducer: a listSized answer of null falls through to the next source', async () => {
        const world = await memberWorld()
        world.store.listSized = async () => null

        const report = done(await measureAssetOrphans(world.env))

        expect(report.bytesSource).toBe('read')
        expect(report.notInHead?.bytes).toBe(3 + 4 + 8)
    })

    test('reproducer: readValue gives a Blob its size without loading the bytes through read', async () => {
        const world = await memberWorld()
        world.store.files.delete('assets/orphan.png')
        world.store.blobs.set('assets/orphan.png', new Blob([new Uint8Array(11)]))
        world.store.readValue = async key => world.store.blobs.get(key) ?? world.store.files.get(key) ?? null

        const report = done(await measureAssetOrphans(world.env))

        expect(report.bytesSource).toBe('readValue')
        expect(report.notInHead?.bytes).toBe(3 + 4 + 11)
        expect(world.store.reads).toEqual([])
    })

    test('guard: with no optional member the last resort reads the bytes, and a name gone since the listing is vanished', async () => {
        const world = await memberWorld()
        const list = world.store.list
        world.store.list = async prefix => {
            const keys = await list(prefix)
            world.store.files.delete('assets/orphan.png')
            return keys
        }

        const report = done(await measureAssetOrphans(world.env))

        expect(report.bytesSource).toBe('read')
        expect(report.vanished).toBe(1)
        expect(report.notInHead).toEqual({ count: 3, bytes: 3 + 4, sample: ['orphan.png', 'pin.png', 'ret.png'] })
    })

    test('reproducer: sizeOf takes precedence, reads no body, and a null answer is vanished with no bytes', async () => {
        const sizes: Record<string, number | null> = { 'assets/ret.png': 30, 'assets/pin.png': 40, 'assets/orphan.png': null }
        const world = await memberWorld({ sizeOf: async key => sizes[key] ?? null })
        world.store.listSized = async () => { throw new Error('listSized is not used when sizeOf is given') }

        const report = done(await measureAssetOrphans(world.env))

        expect(report.bytesSource).toBe('stat')
        expect(world.store.reads).toEqual([])
        expect(report.vanished).toBe(1)
        expect(report.notInHead?.bytes).toBe(70)
        expect(report.notInAny).toMatchObject({ count: 1, bytes: 0 })
        expect(report.restorePointsOnly?.bytes).toBe(70)
    })

    test('reproducer: a sizeOf failure other than absence leaves every bytes null with the detail and keeps the counts', async () => {
        const world = await memberWorld({
            sizeOf: async key => {
                if (key === 'assets/pin.png') {
                    throw new Error('The size read failed.')
                }
                return 5
            },
        })

        const report = done(await measureAssetOrphans(world.env))

        expect(report.bytesSource).toBe('stat')
        expect(report.bytesDetail).toBe('The size read failed.')
        expect(report.notInHead).toMatchObject({ count: 3, bytes: null })
        expect(report.notInAny).toMatchObject({ count: 1, bytes: null })
        expect(report.restorePointsOnly).toMatchObject({ count: 2, bytes: null })
    })

    test('reproducer: measureBytes false reads no size and leaves every bytes null', async () => {
        let asked = 0
        const world = await memberWorld({ measureBytes: false, sizeOf: async () => { asked++; return 1 } })

        const report = done(await measureAssetOrphans(world.env))

        expect(asked).toBe(0)
        expect(world.store.reads).toEqual([])
        expect(report.bytesSource).toBeNull()
        expect(report.notInHead).toMatchObject({ count: 3, bytes: null })
    })
})

describe('the measurement reads and never writes', () => {
    test('reproducer: no write, delete or commit is attempted and the age record is not created', async () => {
        const world = await memberWorld()
        const before = new Map(world.store.files)

        done(await measureAssetOrphans(world.env))

        expect(world.faults.writeAttempts).toEqual([])
        expect(world.store.writes).toEqual([])
        expect(world.store.deletes).toEqual([])
        expect(world.store.files.has(SWEEP_KEY)).toBe(false)
        expect(world.store.files).toEqual(before)
    })
})
