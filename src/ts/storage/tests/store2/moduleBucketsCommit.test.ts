// @vitest-environment node
/**
 * The bucketed module index (CHORE-412 stage S3a) through the real committer over the memory backend: a layout 1 store
 * migrates by one module pass, the token stays on the commit key, a layout 1 writer over a layout 2 store keeps every
 * module reachable, and the migration stays on the ordinary or the bulk path the unit count says. The writer is dormant
 * (layout 1) in the build, so `moduleIndexParams` is replaced by a mutable object and a test names the layout it writes
 * under; `shardCountFor` is wrapped so a test can write the 16-shard store a build before the shard growth wrote.
 *
 * Labels: "guard" passes with or without the change it names; "diagnostic" establishes a number; "hand-modified" marks
 * a store the producer wrote and the test then damaged by deleting one unit.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))
const shards = vi.hoisted(() => ({ fixedSixteen: false }))
vi.mock('src/ts/storage/store2/codec/shard', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/store2/codec/shard')>()
    return { ...actual, shardCountFor: (characters: number, previous?: number) => shards.fixedSixteen ? 16 : actual.shardCountFor(characters, previous) }
})

import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import {
    assembleDatabase, encodeDatabase, previousFrom, unitMapSource, type EncodedTree,
} from 'src/ts/storage/store2/codec'
import { checkTree, type Committer } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, keyOfRef, keyOfTail, readUnit, UNIT_TYPE, type Manifest, type ModuleBucket, type Ref,
} from 'src/ts/storage/store2/format'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { importLegacyTree, type ImportOutcome } from 'src/ts/storage/store2/legacy/importTree'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { pickCandidate } from 'src/ts/storage/store2/recoveryPick'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { asDatabase, bytesOf, buildSmall, encodeWith, seededEnv, type Obj } from './codecFixtures'
import {
    committerOf, createClock, expectInvariant, parsedCommit, seedStore, testEnv, type TestClock,
} from './commitFixtures'
import { FULL_GOLDENS, loadGolden, readerOver } from './legacyFixtures'
import { closureOf } from './recoveryFixtures'
import { buildCharactersProfile, rigRequest, RIG_NOW } from './writeAmplificationRig'

beforeEach(() => {
    layout.MODULE_INDEX_LAYOUT = 1
    shards.fixedSixteen = false
})

const HEX = 'cd'.repeat(32)

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

interface World {
    memory: MemoryBackend
    clock: TestClock
    encoder: SaveEncoder
    committer: Committer
    manifestKey: string
}

function worldOver(memory: MemoryBackend, clock: TestClock, manifestKey: string, manifest: Manifest, previous: ReturnType<typeof previousFrom>): World {
    void manifest
    return {
        memory, clock, manifestKey,
        encoder: createSaveEncoder({ previous, lists: createListDerivation(), env: testEnv(clock, 5), now: () => RIG_NOW }),
        committer: committerOf(memory, clock, 100),
    }
}

/** The first complete tree of `db` written under `which`, named by a fresh commit key. */
async function seedWorld(db: Database, which: 1 | 2): Promise<World> {
    layout.MODULE_INDEX_LAYOUT = which
    const clock = createClock()
    const memory = createMemoryBackend()
    const env = testEnv(clock, 1)
    const tree: EncodedTree = encodeDatabase(db, { env, lists: createListDerivation(), seq: 1, createdAt: env.now() })
    for (const unit of tree.units) {
        await memory.putUnit(unit.key, bytesOf(unit))
    }
    const first = firstCommitKey({ current: { key: tree.manifestKey, at: env.now() }, staging: null, manifests: [tree.manifest] }, env)
    await memory.casCommit((await memory.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))
    return worldOver(memory, clock, tree.manifestKey, tree.manifest, previousFrom(tree))
}

interface FixtureFile { generatedBy: string, manifestKey: string, units: { identity: string, key: string, bytes: string }[], database: Obj }
const fixture = JSON.parse(readFileSync(new URL('./moduleBucketsV1.fixture.json', import.meta.url), 'utf8')) as FixtureFile

function fixtureDatabase(): Database {
    return asDatabase(clone(fixture.database))
}

/** The frozen layout 1 store, named by a fresh commit key, with the previous a boot builds from it. */
async function fixtureWorld(): Promise<World> {
    const clock = createClock()
    const memory = createMemoryBackend()
    const store = new Map<string, Uint8Array>()
    for (const unit of fixture.units) {
        store.set(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
        await memory.putUnit(unit.key, store.get(unit.key) as Uint8Array)
    }
    const read = readUnit(store.get(fixture.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
    if (read.status !== 'ok') {
        throw new Error('The fixture manifest does not parse.')
    }
    const manifest = read.value.body as Manifest
    const env = testEnv(clock, 1)
    const first = firstCommitKey({ current: { key: fixture.manifestKey, at: env.now() }, staging: null, manifests: [manifest] }, env)
    await memory.casCommit((await memory.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))
    const previous = previousOfTree({ manifestKey: fixture.manifestKey, manifest, source: { get: key => store.get(key) } })
    return worldOver(memory, clock, fixture.manifestKey, manifest, previous)
}

interface Landed {
    plan: Awaited<ReturnType<SaveEncoder['plan']>>
    result: Awaited<ReturnType<Committer['commit']>>
    /** The identities of the units the pass added to the store, sorted. */
    written: string[]
}

async function land(world: World, db: Database, request: SavePassRequest): Promise<Landed> {
    const before = new Set(world.memory.snapshot().keys())
    const plan = await world.encoder.plan(db, request)
    const result = await world.committer.commit(await world.committer.readCommit(), plan.commitRequest())
    if (result.status === 'committed') {
        plan.acknowledge()
    }
    const identityOfKey = new Map<string, string>()
    for (const [identity, unit] of world.encoder.acknowledged().units) {
        identityOfKey.set(unit.key, identity)
    }
    const written = [...world.memory.snapshot().keys()]
        .filter(key => !before.has(key))
        .map(key => identityOfKey.get(key) ?? `?${key}`)
        .sort()
    return { plan, result, written }
}

function committed(landed: Landed): Extract<Landed['result'], { status: 'committed' }> {
    if (landed.result.status !== 'committed') {
        throw new Error(`Expected committed, got ${landed.result.status}.`)
    }
    return landed.result
}

function manifestIn(memory: MemoryBackend, key: string): Manifest {
    const bytes = memory.snapshot().get(key)
    const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.manifest)
    if (read === undefined || read.status !== 'ok') {
        throw new Error(`The manifest ${key} is not stored or does not parse.`)
    }
    return read.value.body as Manifest
}

function bodyIn(memory: MemoryBackend, ref: Ref, type: typeof UNIT_TYPE.moduleIndex | typeof UNIT_TYPE.moduleBucket): Record<string, unknown> {
    const bytes = memory.snapshot().get(keyOfRef(ref))
    const read = bytes === undefined ? undefined : readUnit(bytes, type)
    if (read === undefined || read.status !== 'ok') {
        throw new Error(`The unit ${keyOfRef(ref)} is not stored or does not parse.`)
    }
    return JSON.parse(JSON.stringify(read.value.body)) as Record<string, unknown>
}

async function currentManifestKey(memory: MemoryBackend): Promise<string> {
    const current = (await parsedCommit(memory)).current
    if (current === null) {
        throw new Error('No manifest is current.')
    }
    return current.key
}

async function assembledOf(memory: MemoryBackend): Promise<Database> {
    const read = await readTreeBytes(memory, await currentManifestKey(memory))
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source)
}

/** The database a fresh encoding of `db` assembles to, under the layout now set. */
function independentOf(db: Database): Database {
    const independent = encodeWith(db, { env: seededEnv(3), lists: createListDerivation() })
    return assembleDatabase(independent.manifest, unitMapSource(independent.units))
}

/** The store2 units of `memory`, without the commit key. */
function unitsOf(memory: MemoryBackend): [string, Uint8Array][] {
    return [...memory.snapshot()].filter(([key]) => key.startsWith('store2/'))
}

/** A backend holding `memory`'s units but `drop`, and its commit key. */
async function cloneWithout(memory: MemoryBackend, drop: string): Promise<MemoryBackend> {
    const copy = createMemoryBackend()
    for (const [key, bytes] of unitsOf(memory)) {
        if (key !== drop) {
            await copy.putUnit(key, bytes)
        }
    }
    await copy.casCommit((await copy.readCommit()).token, (await memory.readCommit()).bytes as Uint8Array)
    return copy
}

const MODULES_ONLY = rigRequest([], { modules: true })

describe('the first module pass over a layout 1 store', () => {
    test('guard: it writes the buckets, the root and the manifest, commits ordinarily, sets the token on the manifest and the key, assembles equal and is then unchanged', async () => {
        const world = await fixtureWorld()
        const v1Manifest = manifestIn(world.memory, fixture.manifestKey)
        expect(v1Manifest.fixed.moduleBuckets).toBeUndefined()
        const db = fixtureDatabase()

        layout.MODULE_INDEX_LAYOUT = 2
        const landed = await land(world, db, MODULES_ONLY)
        const result = committed(landed)
        expect(result.mode).toBe('ordinary')
        expect(landed.written).toEqual([
            'manifest', 'moduleIndex', 'moduleIndex:bucket:0', 'moduleIndex:bucket:1', 'moduleIndex:bucket:2', 'moduleIndex:bucket:3',
        ])
        expect(landed.plan.newUnits).toBe(6)

        const key = await parsedCommit(world.memory)
        expect(key.staging).toBeNull()
        expect(key.req).toContain('module-buckets')
        const manifest = manifestIn(world.memory, result.manifestKey)
        expect(manifest.req).toContain('module-buckets')
        expect(manifest.fixed.moduleBuckets).toHaveLength(4)

        expect(await assembledOf(world.memory)).toEqual(independentOf(db))
        const next = await world.encoder.plan(db, MODULES_ONLY)
        expect(next.unchanged).toBe(true)
        await expectInvariant(world.memory)
    })

    test('guard: the layout 1 root is outside the new current closure and stays live while the layout 1 manifest is retained', async () => {
        const world = await fixtureWorld()
        const v1Manifest = manifestIn(world.memory, fixture.manifestKey)
        const db = fixtureDatabase()
        layout.MODULE_INDEX_LAYOUT = 2
        const result = committed(await land(world, db, MODULES_ONLY))

        const oldRoot = keyOfRef(v1Manifest.fixed.moduleIndex)
        const closure = await closureOf(world.memory, result.manifestKey)
        expect(closure.problems).toEqual([])
        expect(closure.keys.has(oldRoot)).toBe(false)
        const key = await parsedCommit(world.memory)
        expect(key.retained.map(entry => entry.key)).toContain(fixture.manifestKey)
        const marked = await markLiveKeys(world.memory, await world.memory.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status === 'marked') {
            expect(marked.live.has(oldRoot)).toBe(true)
            for (const kept of closure.keys) {
                expect(marked.live.has(kept), kept).toBe(true)
            }
        }
    })

    test('guard: a pass without the modules over a layout 1 store writes no token and keeps the layout 1 root', async () => {
        const world = await fixtureWorld()
        const v1Manifest = manifestIn(world.memory, fixture.manifestKey)
        const db = fixtureDatabase()
        db.characters[0].name = 'renamed by a character pass'
        layout.MODULE_INDEX_LAYOUT = 2
        const landed = await land(world, db, rigRequest([String(db.characters[0].chaId)]))
        const result = committed(landed)
        expect(landed.written.filter(identity => identity.startsWith('moduleIndex'))).toEqual([])
        const manifest = manifestIn(world.memory, result.manifestKey)
        expect(manifest.req).not.toContain('module-buckets')
        expect(manifest.fixed.moduleBuckets).toBeUndefined()
        expect(manifest.fixed.moduleIndex).toEqual(v1Manifest.fixed.moduleIndex)
        expect((await parsedCommit(world.memory)).req).not.toContain('module-buckets')
    })

    test('guard: a 1000-module layout 1 store migrates in at most 59 new units, the manifest included', async () => {
        const modules = Array.from({ length: 1000 }, (_, index) => mod(`big-${String(index).padStart(4, '0')}`))
        const db = asDatabase({ ...(clone(buildSmall(1)) as unknown as Obj), modules })
        const world = await seedWorld(db, 1)
        layout.MODULE_INDEX_LAYOUT = 2
        const landed = await land(world, clone(db), MODULES_ONLY)
        const result = committed(landed)
        expect(landed.plan.newUnits).toBe(18)
        expect(landed.plan.newUnits).toBeLessThanOrEqual(59)
        expect(result.mode).toBe('ordinary')
        expect(manifestIn(world.memory, result.manifestKey).fixed.moduleBuckets).toHaveLength(16)
    }, 60_000)
})

describe('a module unit missing under layout 2 (hand-modified store)', () => {
    test('guard: the tree check, the recovery pick, the commit invariant and the closure walk each report it', async () => {
        const world = await fixtureWorld()
        layout.MODULE_INDEX_LAYOUT = 2
        const landed = await land(world, fixtureDatabase(), MODULES_ONLY)
        const manifestKey = committed(landed).manifestKey
        const manifest = manifestIn(world.memory, manifestKey)
        const bucket = bodyIn(world.memory, (manifest.fixed.moduleBuckets as Ref[])[0], UNIT_TYPE.moduleBucket) as unknown as ModuleBucket
        const dropped = keyOfTail(bucket.entries[0].unit[0])

        const damaged = await cloneWithout(world.memory, dropped)
        const checked = await checkTree(damaged, manifestKey)
        expect(checked.status).toBe('incomplete')
        expect(checked.status === 'incomplete' ? checked.missing : []).toContain(dropped)

        // The commit invariant reads the commit key, so it runs before the pick writes its marker over it.
        await expect(expectInvariant(damaged)).rejects.toThrow()
        const closure = await closureOf(damaged, manifestKey)
        expect(closure.problems.some(problem => problem.includes(dropped))).toBe(true)

        const picked = await pickCandidate(damaged, await damaged.readCommit(), manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(createClock(), 77),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('invalid')
        if (picked.status === 'invalid') {
            expect(picked.problem).toMatchObject({ kind: 'missing' })
            expect(picked.problem.kind === 'missing' ? picked.problem.keys : []).toContain(dropped)
        }

        // The same store with the unit present is whole, so each report above names the unit and nothing else.
        expect((await checkTree(world.memory, manifestKey)).status).toBe('complete')
        await expectInvariant(world.memory)
    })
})

describe('a layout 1 writer over a layout 2 store', () => {
    async function layout2World(): Promise<{ world: World, db: Database }> {
        const modules = [...Array.from({ length: 40 }, (_, index) => mod(`mod-${String(index).padStart(2, '0')}`)), mod('dup', { name: 'first' }), mod('dup', { name: 'second' })]
        const db = asDatabase({ ...(clone(buildSmall(2)) as unknown as Obj), modules })
        return { world: await seedWorld(db, 2), db }
    }

    test('guard: a module pass writes a root with only version and entries, no bucket Refs, keeps the token, assembles equal, and the tree is complete after a collection', async () => {
        const { world, db } = await layout2World()
        const before = manifestIn(world.memory, world.manifestKey)
        expect(before.fixed.moduleBuckets).toHaveLength(4)
        layout.MODULE_INDEX_LAYOUT = 1
        const edited = clone(db)
        edited.modules[3].description = 'edited under layout 1'
        const landed = await land(world, edited, MODULES_ONLY)
        const result = committed(landed)
        expect(landed.written).toContain('moduleIndex')
        expect(landed.written.filter(identity => identity.startsWith('moduleIndex:bucket:'))).toEqual([])

        const manifest = manifestIn(world.memory, result.manifestKey)
        expect(manifest.fixed.moduleBuckets).toBeUndefined()
        expect(manifest.req).toContain('module-buckets')
        const root = bodyIn(world.memory, manifest.fixed.moduleIndex, UNIT_TYPE.moduleIndex)
        expect(Object.keys(root).sort()).toEqual(['entries', 'v'])
        expect(root.v).toBe(1)
        expect((await parsedCommit(world.memory)).req).toContain('module-buckets')
        expect(await assembledOf(world.memory)).toEqual(independentOf(edited))

        // A collection that keeps only the new manifest keeps every unit it needs.
        const collected = createMemoryBackend()
        for (const [key, bytes] of unitsOf(world.memory)) {
            await collected.putUnit(key, bytes)
        }
        const only = firstCommitKey({ current: { key: result.manifestKey, at: RIG_NOW }, staging: null, manifests: [manifest] }, seededEnv(2))
        await collected.casCommit((await collected.readCommit()).token, encodeUnit(UNIT_TYPE.commit, only))
        const marked = await markLiveKeys(collected, await collected.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status !== 'marked') {
            return
        }
        const survivors = createMemoryBackend()
        for (const [key, bytes] of unitsOf(collected)) {
            if (marked.live.has(key)) {
                await survivors.putUnit(key, bytes)
            }
        }
        await survivors.casCommit((await survivors.readCommit()).token, (await collected.readCommit()).bytes as Uint8Array)
        expect(survivors.snapshot().size).toBeLessThan(collected.snapshot().size)
        expect((await checkTree(survivors, result.manifestKey)).status).toBe('complete')
        expect(await assembledOf(survivors)).toEqual(independentOf(edited))
    })

    test('guard: a pass without the modules keeps the bucket Refs, the root and the token, and the mark keeps every module, list and bucket', async () => {
        const { world, db } = await layout2World()
        const before = manifestIn(world.memory, world.manifestKey)
        layout.MODULE_INDEX_LAYOUT = 1
        const edited = clone(db)
        edited.characters[0].name = 'renamed under layout 1'
        const landed = await land(world, edited, rigRequest([String(edited.characters[0].chaId)]))
        const result = committed(landed)
        expect(landed.written.filter(identity => identity.startsWith('module'))).toEqual([])

        const manifest = manifestIn(world.memory, result.manifestKey)
        expect(manifest.fixed.moduleBuckets).toEqual(before.fixed.moduleBuckets)
        expect(manifest.fixed.moduleIndex).toEqual(before.fixed.moduleIndex)
        expect(manifest.req).toContain('module-buckets')
        expect(await assembledOf(world.memory)).toEqual(independentOf(edited))

        const closure = await closureOf(world.memory, result.manifestKey)
        expect(closure.problems).toEqual([])
        const marked = await markLiveKeys(world.memory, await world.memory.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status === 'marked') {
            for (const key of closure.keys) {
                expect(marked.live.has(key), key).toBe(true)
            }
        }
        await expectInvariant(world.memory)
    })
})

describe('a migration that shares its pass with a shard count growth', () => {
    /** 164 modules, each holding an asset and an inlay so its body, asset list and inlay list are all rewritten by an edit. */
    function modulesWithLists(edited: number): Obj[] {
        const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
        const hex = (n: number) => n.toString(16).padStart(64, '0')
        return Array.from({ length: 164 }, (_, index) => {
            const generation = index < edited ? 1 : 0
            return mod(`list-${String(index).padStart(3, '0')}`, {
                assets: [['a', `assets/${hex(index + 1 + generation * 1000)}.png`]],
                lorebook: [{ content: `see {{inlay::${uuid(index + 1 + generation * 1000)}}}` }],
                description: generation === 1 ? 'edited' : 'plain',
            })
        })
    }

    async function pass(edited: number) {
        shards.fixedSixteen = true
        const profile = buildCharactersProfile(257)
        const base = asDatabase({ ...(profile.db as unknown as Obj), modules: modulesWithLists(0) })
        const world = await seedWorld(base, 1)
        const seeded = manifestIn(world.memory, world.manifestKey)
        expect(seeded.shardCount).toBe(16)
        shards.fixedSixteen = false
        layout.MODULE_INDEX_LAYOUT = 2
        const next = asDatabase({ ...(profile.db as unknown as Obj), modules: modulesWithLists(edited) })
        const landed = await land(world, next, MODULES_ONLY)
        return { world, next, landed }
    }

    test('guard: three edited modules make 59 new units and commit ordinarily; the store assembles equal and the next pass is unchanged', async () => {
        const { world, next, landed } = await pass(3)
        const result = committed(landed)
        expect(landed.plan.newUnits).toBe(59)
        expect(result.mode).toBe('ordinary')
        const manifest = manifestIn(world.memory, result.manifestKey)
        expect(manifest.shardCount).toBe(32)
        expect(manifest.fixed.moduleBuckets).toHaveLength(16)
        expect((await parsedCommit(world.memory)).staging).toBeNull()
        expect(await assembledOf(world.memory)).toEqual(independentOf(next))
        expect((await world.encoder.plan(next, MODULES_ONLY)).unchanged).toBe(true)
        await expectInvariant(world.memory)
    }, 120_000)

    test('guard: four edited modules make 62 new units, commit in bulk and leave no marker, the store assembling equal', async () => {
        const { world, next, landed } = await pass(4)
        const result = committed(landed)
        expect(landed.plan.newUnits).toBe(62)
        expect(result.mode).toBe('bulk')
        expect((await parsedCommit(world.memory)).staging).toBeNull()
        expect(manifestIn(world.memory, result.manifestKey).fixed.moduleBuckets).toHaveLength(16)
        expect(await assembledOf(world.memory)).toEqual(independentOf(next))
        expect((await world.encoder.plan(next, MODULES_ONLY)).unchanged).toBe(true)
        await expectInvariant(world.memory)
    }, 120_000)
})

describe('a whole-profile import over a layout 2 store', () => {
    const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
    const accept = { async confirmIncomplete() { return true } }

    async function importOver(which: 1 | 2) {
        const modules = Array.from({ length: 20 }, (_, index) => mod(`base-${String(index).padStart(2, '0')}`))
        const base = asDatabase({ ...(clone(buildSmall(1)) as unknown as Obj), modules })
        const world = await seedWorld(base, 2)
        const baseKey = await parsedCommit(world.memory)
        expect(baseKey.req).toContain('module-buckets')
        layout.MODULE_INDEX_LAYOUT = which
        const golden = await loadGolden('upstream-full.bin')
        const clock = createClock()
        clock.advance(1000)
        const outcome: ImportOutcome = await importLegacyTree({
            source: { tree: golden.tree },
            reader: readerOver(golden.units),
            committer: world.committer,
            backend: world.memory,
            lists: createListDerivation(),
            env: testEnv(clock, 300),
            resolve: OPTIONS,
        }, accept)
        if (outcome.status !== 'committed') {
            throw new Error(`The import answered ${outcome.status}.`)
        }
        return { world, outcome, baseKey }
    }

    test.each([[2], [1]] as const)('compatibility guard (the never-lower rule; passes on the base for chat-alt): the commit key keeps the token under layout %i and the old current is retained', async (which) => {
        const { world, outcome, baseKey } = await importOver(which)
        const key = await parsedCommit(world.memory)
        expect(key.req).toContain('module-buckets')
        expect(key.retained.map(entry => entry.key)).toContain(baseKey.current?.key)
        const manifest = manifestIn(world.memory, outcome.manifestKey)
        // `carryManifest` unions the replaced manifest's req, so the token stays on the manifest even where no bucket is written.
        expect(manifest.req).toContain('module-buckets')
        expect(manifest.fixed.moduleBuckets !== undefined).toBe(which === 2)
        await expectInvariant(world.memory)
    })
})

describe('the .bin goldens do not depend on the layout', () => {
    const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
    const accept = { async confirmIncomplete() { return true } }

    async function importedUnder(name: string, which: 1 | 2): Promise<Database> {
        layout.MODULE_INDEX_LAYOUT = which
        const memory = createMemoryBackend()
        const clock = createClock()
        await seedStore(memory, testEnv(clock, 1))
        const committer = committerOf(memory, clock, 100)
        clock.advance(1000)
        const golden = await loadGolden(name)
        const outcome = await importLegacyTree({
            source: { tree: golden.tree },
            reader: readerOver(golden.units),
            committer,
            backend: memory,
            lists: createListDerivation(),
            env: testEnv(clock, 300),
            resolve: OPTIONS,
        }, accept)
        if (outcome.status !== 'committed') {
            throw new Error(`The import answered ${outcome.status}.`)
        }
        const manifest = manifestIn(memory, outcome.manifestKey)
        expect(manifest.fixed.moduleBuckets !== undefined).toBe(which === 2)
        await expectInvariant(memory)
        return assembledOf(memory)
    }

    test.each(FULL_GOLDENS.map(name => [name]))('compatibility guard (the logical content is the same on the base): %s imports to equal databases under both layouts, and a layout 2 store re-encodes to the same content under layout 1', async (name) => {
        const one = await importedUnder(name, 1)
        const two = await importedUnder(name, 2)
        expect(JSON.parse(JSON.stringify(two.modules))).toEqual(JSON.parse(JSON.stringify(one.modules)))
        expect(two.characters.length).toBe(one.characters.length)
        expect(JSON.parse(JSON.stringify(two.characters.map(slot => slot.chaId)))).toEqual(JSON.parse(JSON.stringify(one.characters.map(slot => slot.chaId))))
        layout.MODULE_INDEX_LAYOUT = 1
        expect(JSON.parse(JSON.stringify(independentOf(two).modules))).toEqual(JSON.parse(JSON.stringify(one.modules)))
    })
})

describe('the commit key', () => {
    test('guard: the key of a first layout 2 tree carries the token and one of a layout 1 tree does not', async () => {
        const db = asDatabase({ ...(clone(buildSmall(1)) as unknown as Obj), modules: [mod('only')] })
        const two = await seedWorld(db, 2)
        const one = await seedWorld(db, 1)
        expect((await parsedCommit(two.memory)).req).toContain('module-buckets')
        expect((await parsedCommit(one.memory)).req).not.toContain('module-buckets')
        expect(classifyCommitRead(await two.memory.readCommit()).status).toBe('parsed')
    })
})
