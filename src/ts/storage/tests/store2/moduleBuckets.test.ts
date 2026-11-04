// @vitest-environment node
/**
 * The bucketed module index (CHORE-412 stage S3a), through the real producer and every reader: `planScopedEncode` and
 * `finalize` write the store, `assembleDatabase`, `previousOfTree`, `readTreeBytes`, `readTree`, `markLiveKeys`, the
 * keep-set, `checkTree` and the recovery pick read it. The writer is dormant (layout 1) in the build, so the module
 * `moduleIndexParams` is replaced by a mutable object and a test names the layout it writes under.
 *
 * Labels: "guard" passes with or without the change it names (a migration guard passes on the base too); "hand-modified"
 * marks a store the producer wrote and the test then damaged by deleting or re-framing one unit.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    assembleDatabase, moduleHandles, planScopedEncode, previousFrom, unitMapSource, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { bucketOfKey } from 'src/ts/storage/store2/codec/pluginStorage'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { checkTree, createKeyMint, type BuildContext, type Committer } from 'src/ts/storage/store2/commit'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, keyOfRef, newManifestKey, newUnitKey, parseModuleBucket, readUnit, refOfFrame, UNIT_TYPE,
    type Manifest, type ModuleBucket, type ModuleEntry, type Ref,
} from 'src/ts/storage/store2/format'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { pickCandidate } from 'src/ts/storage/store2/recoveryPick'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import { buildClosureAssetKeepSet, createBackendClosureReader } from 'src/ts/storage/store2/sweep'
import { readTree } from 'src/ts/storage/store2/tree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { asDatabase, buildSmall, encodeWith, seededEnv, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

beforeEach(() => {
    layout.MODULE_INDEX_LAYOUT = 1
})

const NOW = 1_700_000_000_000
const MODS: EncodeScope = { modules: true, characters: new Set() }
const ALL: EncodeScope = { modules: true, characters: 'all' }
const HEX = 'cd'.repeat(32)

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

/** `count` modules with distinct ids, in an order that is not the order of the ids. */
function manyModules(count: number): Obj[] {
    return Array.from({ length: count }, (_, index) => mod(`m-${String((index * 7) % count).padStart(4, '0')}`))
}

function profile(modules: Obj[]): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = modules
    return asDatabase(base)
}

interface Rig {
    store: Map<string, Uint8Array>
    pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number): Promise<{ plan: Awaited<ReturnType<typeof planScopedEncode>>, tree: EncodedTree }>
    persist(tree: EncodedTree): void
    boot(tree: EncodedTree): PreviousEncoding
}

function makeRig(envSeed = 1300, mintSeed = 15200): Rig {
    const store = new Map<string, Uint8Array>()
    const lists = createListDerivation()
    let env = envSeed
    let mint = mintSeed
    return {
        store,
        async pass(db, previous, scope, seq) {
            const options: EncodeOptions = { env: seededEnv(env++), lists, seq, createdAt: NOW, previous }
            const plan = await planScopedEncode(db, options, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return { plan, tree: plan.finalize(context) }
        },
        persist(tree) {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        boot(tree) {
            return previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => store.get(key) } })
        },
    }
}

/** The first full encoding of `modules` under `which`, persisted. */
async function firstTree(rig: Rig, modules: Obj[], which: 1 | 2): Promise<{ tree: EncodedTree, db: Database }> {
    layout.MODULE_INDEX_LAYOUT = which
    const db = profile(modules)
    const first = await rig.pass(db, null, ALL, 1)
    rig.persist(first.tree)
    return { tree: first.tree, db }
}

function identitiesWritten(tree: EncodedTree): string[] {
    return unitsToWrite(tree).map(unit => unit.identity).sort()
}

function manifestOf(rig: Rig, manifestKey: string): Manifest {
    const bytes = rig.store.get(manifestKey)
    const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.manifest)
    if (read === undefined || read.status !== 'ok') {
        throw new Error('The manifest is not stored or does not parse.')
    }
    return read.value.body as Manifest
}

function bucketsOf(rig: Rig, manifest: Manifest): ModuleBucket[] {
    return (manifest.fixed.moduleBuckets ?? []).map(ref => {
        const bytes = rig.store.get(keyOfRef(ref))
        const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.moduleBucket)
        if (read === undefined || read.status !== 'ok') {
            throw new Error('A bucket is not stored or does not parse.')
        }
        return read.value.body as ModuleBucket
    })
}

function rootOf(rig: Rig, manifest: Manifest): JsonObject {
    const bytes = rig.store.get(keyOfRef(manifest.fixed.moduleIndex))
    const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.moduleIndex)
    if (read === undefined || read.status !== 'ok') {
        throw new Error('The root is not stored or does not parse.')
    }
    return JSON.parse(JSON.stringify(read.value.body)) as JsonObject
}

describe('the bucket count', () => {
    test.each([[0, 1], [1, 1], [16, 1], [17, 2], [32, 2], [33, 4], [164, 16], [1000, 16]] as const)(
        'guard: %i modules are written into %i buckets, at most 16',
        async (count, expected) => {
            const rig = makeRig()
            const { tree } = await firstTree(rig, manyModules(count), 2)
            expect(tree.manifest.fixed.moduleBuckets).toHaveLength(expected)
            const manifest = manifestOf(rig, tree.manifestKey)
            const stored = bucketsOf(rig, manifest)
            expect(stored.reduce((sum, bucket) => sum + bucket.entries.length, 0)).toBe(count)
            expect(rootOf(rig, manifest)).toEqual({ v: 2, handles: expect.any(Array) })
            expect((rootOf(rig, manifest).handles as string[]).length).toBe(count)
        },
        60_000,
    )
})

describe('the layout 2 writer', () => {
    test('guard: entries sit in the bucket of their id in id order, the root lists the handles of the logical order, the token is set and the store assembles equal', async () => {
        const rig = makeRig()
        const modules = [...manyModules(40), mod('dup', { name: 'zeta' }), mod('dup', { name: 'alpha' })]
        const { tree, db } = await firstTree(rig, modules, 2)
        const manifest = manifestOf(rig, tree.manifestKey)
        expect(manifest.req).toContain('module-buckets')
        const buckets = bucketsOf(rig, manifest)
        expect(buckets).toHaveLength(4)
        buckets.forEach((bucket, position) => {
            expect(bucket.entries.map(entry => bucketOfKey(entry.id, buckets.length))).toEqual(bucket.entries.map(() => position))
            const ids = bucket.entries.map(entry => entry.id)
            expect(ids).toEqual([...ids].sort())
        })
        const logical = tree.index.objects?.moduleIndex
        expect(logical?.entries.map(entry => entry.id)).toEqual(modules.map(entry => entry.id))
        expect(rootOf(rig, manifest).handles).toEqual(moduleHandles(logical?.entries ?? []))
        // The two entries of `dup` keep their relative order whatever their names sort to.
        const dupBucket = buckets[bucketOfKey('dup', buckets.length)]
        expect(dupBucket.entries.filter(entry => entry.id === 'dup').map(entry => entry.name)).toEqual(['zeta', 'alpha'])
        const assembled = assembleDatabase(manifest, { get: key => rig.store.get(key) })
        expect(assembled.modules.map(entry => entry.id)).toEqual(modules.map(entry => entry.id))
        expect(assembled).toEqual(assembleDatabase(encodeWith(db).manifest, unitMapSource(encodeWith(db).units)))
    })

    test('guard: duplicate ids keep their order through the write, the read and a later write', async () => {
        const rig = makeRig()
        const modules = [...manyModules(30), mod('dup', { description: 'zeta-first' }), mod('dup', { description: 'alpha-second' }), mod('dup', { description: 'mid-third' })]
        const { tree, db } = await firstTree(rig, modules, 2)
        const manifest = manifestOf(rig, tree.manifestKey)
        const assembled = assembleDatabase(manifest, { get: key => rig.store.get(key) })
        expect(assembled.modules.filter(entry => entry.id === 'dup').map(entry => entry.description)).toEqual(['zeta-first', 'alpha-second', 'mid-third'])
        const next = await rig.pass(db, previousFrom(tree), MODS, 2)
        expect(next.plan.unchanged).toBe(true)
        // A rewrite of the second `dup` alone leaves the other two in place.
        const edited = profile(modules.map((entry, index) => index === 31 ? { ...entry, description: 'alpha-second edited' } : entry))
        const rewritten = await rig.pass(edited, previousFrom(tree), MODS, 3)
        rig.persist(rewritten.tree)
        const after = assembleDatabase(manifestOf(rig, rewritten.tree.manifestKey), { get: key => rig.store.get(key) })
        expect(after.modules.filter(entry => entry.id === 'dup').map(entry => entry.description)).toEqual(['zeta-first', 'alpha-second edited', 'mid-third'])
    })

    describe('the units one edit writes', () => {
        async function base() {
            const rig = makeRig(1400, 16200)
            const modules = [...manyModules(40), mod('dup', { name: 'first' }), mod('dup', { name: 'second' })]
            const first = await firstTree(rig, modules, 2)
            return { rig, modules, ...first }
        }

        test('guard: a reorder writes the root and the manifest, no bucket and no module', async () => {
            const { rig, modules, tree } = await base()
            const reordered = profile([modules[1], modules[0], ...modules.slice(2)])
            const pass = await rig.pass(reordered, previousFrom(tree), MODS, 2)
            expect(identitiesWritten(pass.tree)).toEqual(['manifest', 'moduleIndex'])
        })

        test('guard: an added module writes its body and lists, one bucket, the root and the manifest', async () => {
            const { rig, modules, tree } = await base()
            const added = profile([...modules, mod('added-one')])
            const pass = await rig.pass(added, previousFrom(tree), MODS, 2)
            const written = identitiesWritten(pass.tree)
            const buckets = written.filter(identity => identity.startsWith('moduleIndex:bucket:'))
            expect(buckets).toHaveLength(1)
            expect(buckets[0]).toBe(`moduleIndex:bucket:${bucketOfKey('added-one', 4)}`)
            expect(written).toContain('moduleIndex')
            expect(written).toContain('manifest')
            expect(written.filter(identity => identity.startsWith('module:'))).toEqual(['module:added-one#0'])
            expect(written.filter(identity => !identity.startsWith('module') && identity !== 'manifest' && !identity.startsWith('al:module') && !identity.startsWith('il:module'))).toEqual([])
        })

        test('guard: a description edit writes the body, the lists and the one bucket of the module, and the manifest, not the root', async () => {
            const { rig, modules, tree } = await base()
            const edited = profile(modules.map((entry, index) => index === 3 ? { ...entry, description: 'changed description' } : entry))
            const pass = await rig.pass(edited, previousFrom(tree), MODS, 2)
            const written = identitiesWritten(pass.tree)
            const id = modules[3].id as string
            expect(written.filter(identity => identity.startsWith('moduleIndex'))).toEqual([`moduleIndex:bucket:${bucketOfKey(id, 4)}`])
            expect(written).toContain('manifest')
            expect(written).toContain(`module:${id}#0`)
            expect(written).not.toContain('moduleIndex')
            expect(written.filter(identity => !identity.startsWith('moduleIndex:bucket:') && identity !== 'manifest' && !identity.includes(id))).toEqual([])
        })
    })

    test('guard: a pass without the modules keeps the bucket Refs and the token, and a later unchanged module pass is unchanged', async () => {
        const rig = makeRig(1500, 17200)
        const { tree, db } = await firstTree(rig, manyModules(40), 2)
        const characterEdit = JSON.parse(JSON.stringify(db)) as Database
        characterEdit.characters[0].name = 'renamed'
        const pass = await rig.pass(characterEdit, previousFrom(tree), { modules: false, characters: new Set([characterEdit.characters[0].chaId]) }, 2)
        expect(pass.plan.unchanged).toBe(false)
        expect(pass.tree.manifest.fixed.moduleBuckets).toEqual(tree.manifest.fixed.moduleBuckets)
        expect(pass.tree.manifest.fixed.moduleIndex).toEqual(tree.manifest.fixed.moduleIndex)
        expect(pass.tree.manifest.req).toContain('module-buckets')
        expect(identitiesWritten(pass.tree).filter(identity => identity.startsWith('module'))).toEqual([])
        rig.persist(pass.tree)
        const settled = await rig.pass(characterEdit, previousFrom(pass.tree), MODS, 3)
        expect(settled.plan.unchanged).toBe(true)
    })

    test('guard: an unknown field of a unique module entry is carried into its bucket, and the root carries its own unknown field', async () => {
        const rig = makeRig(1600, 18200)
        const { tree, db } = await firstTree(rig, manyModules(40), 2)
        const previous = previousFrom(tree)
        const entries = previous.objects?.moduleIndex?.entries
        const carried = entries?.[5]
        if (entries === undefined || carried === undefined) {
            throw new Error('The previous holds no module index.')
        }
        ;(carried as unknown as Obj).futureEntryField = { n: [1] }
        ;(previous.objects?.moduleIndex as unknown as Obj).futureRootField = 'kept'
        const edited = JSON.parse(JSON.stringify(db)) as Database
        edited.modules[5].description = 'edited so the bucket is rewritten'
        const pass = await rig.pass(edited, previous, MODS, 2)
        rig.persist(pass.tree)
        const manifest = manifestOf(rig, pass.tree.manifestKey)
        const stored = bucketsOf(rig, manifest).flatMap(bucket => bucket.entries).find(entry => entry.id === carried.id)
        expect((stored as unknown as Obj).futureEntryField).toEqual({ n: [1] })
        expect(rootOf(rig, manifest).futureRootField).toBe('kept')
    })

    test('guard: after finalize the logical module index of the encoding equals the index read back from the stored root and buckets, and a boot rebuilds the same', async () => {
        const rig = makeRig(1700, 19200)
        const modules = [...manyModules(40), mod('dup', { name: 'first' }), mod('dup', { name: 'second' })]
        const { tree } = await firstTree(rig, modules, 2)
        const logical = tree.index.objects?.moduleIndex
        const manifest = manifestOf(rig, tree.manifestKey)
        const readBack = bucketsOf(rig, manifest).flatMap(bucket => bucket.entries)
        expect(logical?.v).toBe(1)
        expect(logical?.entries).toHaveLength(modules.length)
        expect([...(logical?.entries ?? [])].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entry => entry.unit))
            .toEqual([...readBack].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entry => entry.unit))
        for (const entry of logical?.entries ?? []) {
            expect(entry.unit[0].startsWith('u-vvvvvvvvvv'), 'no placeholder tail is left').toBe(false)
        }
        expect(rig.boot(tree).objects?.moduleIndex).toEqual(logical)
        const passed = await rig.pass(profile(modules), previousFrom(tree), MODS, 2)
        expect(passed.plan.unchanged).toBe(true)
        expect(passed.tree.index.objects?.moduleIndex).toEqual(logical)
        // The previous a boot builds names the bucket units by the same identities the encoder gives them, so a pass over it reuses them.
        const rebooted = await rig.pass(profile(modules), rig.boot(tree), MODS, 3)
        expect(rebooted.plan.unchanged).toBe(true)
        expect(identitiesWritten(rebooted.tree)).toEqual(['manifest'])
        expect(rebooted.tree.index.objects?.moduleIndex).toEqual(logical)
    })
})

// ---- Damage ----

/** A store the producer wrote under layout 2, with the handles to re-frame one unit of it. */
async function layout2Store() {
    const rig = makeRig(1800, 20200)
    const { tree } = await firstTree(rig, [...manyModules(40), mod('dup', { name: 'first' }), mod('dup', { name: 'second' })], 2)
    return { rig, tree, manifest: manifestOf(rig, tree.manifestKey) }
}

interface Damaged {
    store: Map<string, Uint8Array>
    manifestKey: string
}

interface Parts {
    root: JsonObject
    buckets: JsonObject[]
    manifest: Manifest
}

/** A copy of the store whose manifest names a root and buckets changed by `change`, every Ref re-framed so only the change is wrong. */
function restitched(source: { rig: Rig, tree: EncodedTree, manifest: Manifest }, change: (parts: Parts) => void): Damaged {
    const store = new Map(source.rig.store)
    const parts: Parts = {
        root: rootOf(source.rig, source.manifest),
        buckets: bucketsOf(source.rig, source.manifest).map(bucket => JSON.parse(JSON.stringify(bucket)) as JsonObject),
        manifest: JSON.parse(JSON.stringify(source.manifest)) as Manifest,
    }
    change(parts)
    const env = seededEnv(9100)
    const put = (type: typeof UNIT_TYPE.moduleIndex | typeof UNIT_TYPE.moduleBucket, body: JsonObject): Ref => {
        const key = newUnitKey(env)
        const bytes = encodeUnit(type, body)
        store.set(key, bytes)
        return refOfFrame(key, bytes)
    }
    parts.manifest.fixed.moduleIndex = put(UNIT_TYPE.moduleIndex, parts.root)
    if (parts.manifest.fixed.moduleBuckets !== undefined) {
        parts.manifest.fixed.moduleBuckets = parts.buckets.map(bucket => put(UNIT_TYPE.moduleBucket, bucket))
    }
    const manifestKey = newManifestKey(env)
    store.set(manifestKey, encodeUnit(UNIT_TYPE.manifest, parts.manifest))
    return { store, manifestKey }
}

const DAMAGE: [string, (source: { rig: Rig, tree: EncodedTree, manifest: Manifest }) => Damaged][] = [
    ['a deleted bucket', source => {
        const store = new Map(source.rig.store)
        store.delete(keyOfRef((source.manifest.fixed.moduleBuckets as Ref[])[1]))
        return { store, manifestKey: source.tree.manifestKey }
    }],
    ['an entry in the wrong bucket', source => restitched(source, parts => {
        const moved = (parts.buckets[0].entries as JsonObject[]).shift() as JsonObject
        ;(parts.buckets[1].entries as JsonObject[]).push(moved)
    })],
    ['a handle that names no entry', source => restitched(source, parts => {
        ;(parts.root.handles as string[]).push('ghost#0')
    })],
    ['an entry no handle names', source => restitched(source, parts => {
        ;(parts.root.handles as string[]).pop()
    })],
    ['a repeated handle', source => restitched(source, parts => {
        const handles = parts.root.handles as string[]
        handles[1] = handles[0]
    })],
    ['a v1 root beside the manifest buckets', source => restitched(source, parts => {
        parts.root = { v: 1, entries: [] }
    })],
    ['a v2 root under a manifest with no buckets', source => restitched(source, parts => {
        delete parts.manifest.fixed.moduleBuckets
    })],
]

/** A memory backend holding `store`, with a commit key that names `manifestKey` as current. */
async function backendOf(store: Map<string, Uint8Array>, manifestKey: string): Promise<MemoryBackend> {
    const backend = createMemoryBackend()
    for (const [key, bytes] of store) {
        await backend.putUnit(key, bytes)
    }
    const manifestBytes = store.get(manifestKey)
    const manifest = manifestBytes === undefined ? undefined : readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifest === undefined || manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    const key = firstCommitKey({ current: { key: manifestKey, at: NOW }, staging: null, manifests: [manifest.value.body as Manifest] }, seededEnv(1))
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    return backend
}

type Reader = (damaged: Damaged) => Promise<boolean>

/** True when the reader reports damage and does not hand back a module index. */
const LOGICAL_READERS: [string, Reader][] = [
    ['assembleDatabase', async ({ store, manifestKey }) => {
        try {
            assembleDatabase(manifestOfStore(store, manifestKey), { get: key => store.get(key) })
            return false
        } catch {
            return true
        }
    }],
    ['previousOfTree', async ({ store, manifestKey }) => {
        try {
            previousOfTree({ manifestKey, manifest: manifestOfStore(store, manifestKey), source: { get: key => store.get(key) } })
            return false
        } catch {
            return true
        }
    }],
    ['readTreeBytes', async ({ store, manifestKey }) => (await readTreeBytes(await backendOf(store, manifestKey), manifestKey)).status === 'structure'],
    ['the closure keep-set', async ({ store, manifestKey }) => {
        const backend = await backendOf(store, manifestKey)
        const keep = await buildClosureAssetKeepSet({ commitKey: await parsedKey(backend), reader: createBackendClosureReader(backend) })
        return keep.status === 'incomplete'
    }],
]

function manifestOfStore(store: Map<string, Uint8Array>, manifestKey: string): Manifest {
    const bytes = store.get(manifestKey)
    const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.manifest)
    if (read === undefined || read.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    return read.value.body as Manifest
}

async function parsedKey(backend: MemoryBackend) {
    const read = readUnit((await backend.readCommit()).bytes as Uint8Array, UNIT_TYPE.commit)
    if (read.status !== 'ok') {
        throw new Error('The commit key does not parse.')
    }
    return read.value.body as Parameters<typeof buildClosureAssetKeepSet>[0]['commitKey']
}

describe('a damaged module index (hand-modified stores)', () => {
    describe.each(DAMAGE)('%s', (_name, damage) => {
        test.each(LOGICAL_READERS)('guard: %s reports damage and no module index', async (_reader, read) => {
            expect(await read(damage(await layout2Store()))).toBe(true)
        })
    })

    test.each(DAMAGE.filter(([name]) => name === 'a deleted bucket' || name.startsWith('a v')))(
        'guard: %s is damaged for the tree judge and the mark refuses it',
        async (_name, damage) => {
            const { store, manifestKey } = damage(await layout2Store())
            const backend = await backendOf(store, manifestKey)
            expect(['damaged', 'missing']).toContain((await readTree(backend, manifestKey)).status)
            const marked = await markLiveKeys(backend, await backend.readCommit())
            expect(marked.status).toBe('refused')
        },
    )

    test('guard: a manifest without buckets over a v2 root is damaged for the tree judge, and no mark reads it as a store without modules', async () => {
        const { store, manifestKey } = DAMAGE[6][1](await layout2Store())
        const backend = await backendOf(store, manifestKey)
        const read = await readTree(backend, manifestKey)
        expect(read.status).toBe('damaged')
        const marked = await markLiveKeys(backend, await backend.readCommit())
        expect(marked).toMatchObject({ status: 'refused', reason: 'closure-not-ok' })
    })

    test('guard: a v1 root beside manifest buckets is damaged for the tree judge', async () => {
        const { store, manifestKey } = DAMAGE[5][1](await layout2Store())
        const backend = await backendOf(store, manifestKey)
        expect((await readTree(backend, manifestKey)).status).toBe('damaged')
    })

    test('guard: the tree check and the recovery pick name a deleted bucket as missing', async () => {
        const source = await layout2Store()
        const { store, manifestKey } = DAMAGE[0][1](source)
        const deleted = keyOfRef((source.manifest.fixed.moduleBuckets as Ref[])[1])
        const backend = await backendOf(store, manifestKey)
        const checked = await checkTree(backend, manifestKey)
        expect(checked).toMatchObject({ status: 'incomplete' })
        expect(checked.status === 'incomplete' ? checked.missing : []).toContain(deleted)
        const picked = await pickCandidate(backend, await backend.readCommit(), manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(createClock(), 77),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('invalid')
        if (picked.status === 'invalid') {
            expect(picked.problem).toMatchObject({ kind: 'missing' })
            expect(picked.problem.kind === 'missing' ? picked.problem.keys : []).toContain(deleted)
        }
    })

    test('guard: a bucket body parses as the module bucket type and a bucket holding a foreign body does not', () => {
        expect(parseModuleBucket({ v: 1, entries: [] }).status).toBe('ok')
        expect(parseModuleBucket({ v: 1, handles: [] }).status).toBe('damaged')
    })
})

// ---- The frozen v1 fixture ----

describe('the frozen layout 1 fixture (written by the S2 encoder)', () => {
    interface FixtureFile { generatedBy: string, manifestKey: string, units: { identity: string, key: string, bytes: string }[], database: Obj }
    const fixture = JSON.parse(readFileSync(new URL('./moduleBucketsV1.fixture.json', import.meta.url), 'utf8')) as FixtureFile

    function loaded(): { store: Map<string, Uint8Array>, manifest: Manifest } {
        const store = new Map<string, Uint8Array>()
        for (const unit of fixture.units) {
            store.set(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
        }
        return { store, manifest: manifestOfStore(store, fixture.manifestKey) }
    }

    test('guard: the fixture is a layout 1 store, with no bucket and no token, holding duplicate ids and an asset', () => {
        const { store, manifest } = loaded()
        expect(manifest.fixed.moduleBuckets).toBeUndefined()
        expect(manifest.req).not.toContain('module-buckets')
        const root = readUnit(store.get(keyOfRef(manifest.fixed.moduleIndex)) as Uint8Array, UNIT_TYPE.moduleIndex)
        expect(root.status === 'ok' ? (root.value.body as { v: number }).v : null).toBe(1)
        const ids = (root.status === 'ok' ? (root.value.body as { entries: ModuleEntry[] }).entries : []).map(entry => entry.id)
        expect(ids).toHaveLength(40)
        expect(ids.filter(id => id === 'dup')).toHaveLength(2)
        expect([...store.keys()].some(key => key.startsWith('store2/') === false)).toBe(false)
    })

    test('migration guard (passes on the base too): the layout 1 store reads in place by assemble, previous, tree judge, tree bytes, mark, keep-set and tree check', async () => {
        const { store, manifest } = loaded()
        const assembled = assembleDatabase(manifest, { get: key => store.get(key) })
        const independent = encodeWith(asDatabase(JSON.parse(JSON.stringify(fixture.database)) as Obj))
        expect(assembled).toEqual(assembleDatabase(independent.manifest, unitMapSource(independent.units)))
        expect(assembled.modules.map(entry => entry.id)).toEqual((fixture.database.modules as Obj[]).map(entry => entry.id))

        const previous = previousOfTree({ manifestKey: fixture.manifestKey, manifest, source: { get: key => store.get(key) } })
        expect(previous.objects?.moduleIndex?.entries).toHaveLength(40)

        const backend = await backendOf(store, fixture.manifestKey)
        expect((await readTree(backend, fixture.manifestKey)).status).toBe('ok')
        expect((await readTreeBytes(backend, fixture.manifestKey)).status).toBe('ok')
        const marked = await markLiveKeys(backend, await backend.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status === 'marked') {
            for (const key of store.keys()) {
                expect(marked.live.has(key), key).toBe(true)
            }
        }
        const keep = await buildClosureAssetKeepSet({ commitKey: await parsedKey(backend), reader: createBackendClosureReader(backend) })
        expect(keep.status).toBe('complete')
        if (keep.status === 'complete') {
            expect(keep.keep.holds(`assets/${HEX}.png`)).toBe(true)
        }
        expect((await checkTree(backend, fixture.manifestKey)).status).toBe('complete')
    })

    test('migration guard (passes on the base too): the recovery pick takes the layout 1 store', async () => {
        const { store } = loaded()
        const backend = await backendOf(store, fixture.manifestKey)
        const picked = await pickCandidate(backend, await backend.readCommit(), fixture.manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(createClock(), 78),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('ready')
    })

    test('guard: the first module pass over the fixture under layout 2 writes the buckets, the root and the manifest, and reuses every module', async () => {
        const { store, manifest } = loaded()
        const rig = makeRig(1900, 21200)
        const previous = previousOfTree({ manifestKey: fixture.manifestKey, manifest, source: { get: key => store.get(key) } })
        layout.MODULE_INDEX_LAYOUT = 2
        const pass = await rig.pass(asDatabase(JSON.parse(JSON.stringify(fixture.database)) as Obj), previous, MODS, 2)
        expect(pass.plan.unchanged).toBe(false)
        const written = identitiesWritten(pass.tree)
        expect(written.filter(identity => identity.startsWith('moduleIndex:bucket:'))).toHaveLength(4)
        expect(written.filter(identity => identity !== 'manifest' && identity !== 'moduleIndex' && !identity.startsWith('moduleIndex:bucket:'))).toEqual([])
        expect(pass.tree.manifest.req).toContain('module-buckets')
    })
})

// ---- The growth of the manifest ----

describe('the manifest growth', () => {
    test('diagnostic: sixteen bucket Refs add at most 818 bytes to the manifest, eight add less', async () => {
        const sizeOf = async (count: number, which: 1 | 2): Promise<number> => {
            const rig = makeRig()
            const { tree } = await firstTree(rig, manyModules(count), which)
            return (rig.store.get(tree.manifestKey) as Uint8Array).length
        }
        const v1 = await sizeOf(256, 1)
        const sixteen = await sizeOf(256, 2)
        const eight = await sizeOf(128, 2)
        const eightV1 = await sizeOf(128, 1)
        expect(sixteen - v1).toBeGreaterThan(0)
        expect(sixteen - v1).toBeLessThanOrEqual(818)
        expect(eight - eightV1).toBeGreaterThan(0)
        expect(eight - eightV1).toBeLessThan(sixteen - v1)
    }, 60_000)
})

// ---- The idle net ----

describe('the idle net writes layout 2 at the first module tick after 30 s', () => {
    interface Run {
        kit: Store2Kit
        clock: { now: number }
        start: number
        requests: SavePassRequest[]
        crashed: unknown[]
        /** Moves the clock to `offset` ms after the loop's start and waits for the slot that follows to end. */
        slotAt(offset: number): Promise<void>
        stop(): void
    }

    const runs: Run[] = []

    afterEach(() => {
        for (const run of runs) {
            run.stop()
        }
        runs.length = 0
    })

    /** The loop over a real memory backend and committer with a hand-built port whose clock the test sets. */
    async function startRun(db: Database): Promise<Run> {
        const kit = await startStore2({ db, idleNet: { intervalMs: 1 } })
        const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
        const requests: SavePassRequest[] = []
        const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
        encoder.plan = async (planDb, request) => {
            requests.push(request)
            return inner.plan(planDb, request)
        }
        kit.context.encoder = encoder
        const counted = { reads: 0, sweeps: 0 }
        const wrapped = kit.context.session.committer
        if (wrapped !== null) {
            const counting: Committer = {
                ...wrapped,
                async readCommit() {
                    counted.reads += 1
                    return wrapped.readCommit()
                },
            }
            kit.context.session = { ...kit.context.session, committer: counting }
        }
        let stopped = false
        let tail: Promise<void> = Promise.resolve()
        const clock = { now: 1_800_000_000_000 }
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const state = { due: false, dirty: false }
        const crashed: unknown[] = []
        const run: Run = {
            kit, clock, start: clock.now, requests, crashed,
            async slotAt(offset) {
                const reads = counted.reads
                clock.now = run.start + offset
                await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
                const sweeps = counted.sweeps
                await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
            },
            stop() {
                stopped = true
            },
        }
        const idle = () => new Promise<void>((resolve) => {
            if (!stopped) {
                setTimeout(resolve, 2)
            }
        })
        const port: Store2LoopPort = {
            tracker,
            reloadFlag: { state: false },
            getDatabase: () => db,
            mergeBack(live, snapshot) {
                live.modules ||= snapshot.modules
            },
            liveCheck: () => {},
            sweep() {
                counted.sweeps += 1
            },
            isDue: () => state.due,
            isDirty: () => state.dirty,
            hasDrafts: () => false,
            beginIteration() {
                state.due = false
            },
            endIteration: () => {},
            snapshotTaken() {
                state.dirty = false
            },
            requestPass() {
                state.dirty = true
                state.due = true
            },
            unsavable: () => {},
            saved: () => {},
            broadcast: () => {},
            peerHeard: () => false,
            setStopped: () => {},
            reportFailure(error) {
                crashed.push(error)
                return 1
            },
            reportUncountedFailure(error) {
                crashed.push(error)
                return 1
            },
            async withWriteLock(work) {
                const before = tail
                let release: () => void = () => {}
                tail = new Promise<void>((resolve) => { release = resolve })
                await before
                try {
                    return await work()
                } finally {
                    release()
                }
            },
            wait: idle,
            sleep: () => idle(),
            sleepForever: () => new Promise<never>(() => {}),
            now: () => clock.now,
        }
        runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
            crashed.push(error)
        })
        runs.push(run)
        return run
    }

    async function currentFixed(kit: Store2Kit): Promise<Manifest['fixed']> {
        const key = await kit.commitKey()
        const bytes = key.current === null ? undefined : kit.memory.snapshot().get(key.current.key)
        const read = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.manifest)
        if (read === undefined || read.status !== 'ok') {
            throw new Error('The current manifest is not stored or does not parse.')
        }
        return (read.value.body as Manifest).fixed
    }

    test('guard: a layout 1 store is untouched at 29.999 s and gets its buckets from the first module tick at 30 s', async () => {
        const db = JSON.parse(JSON.stringify(buildSmall(4))) as Database
        const run = await startRun(db)
        expect((await currentFixed(run.kit)).moduleBuckets).toBeUndefined()
        layout.MODULE_INDEX_LAYOUT = 2
        await run.slotAt(2_000)
        await run.slotAt(29_999)
        await new Promise<void>(resolve => setTimeout(resolve, 60))
        expect((await currentFixed(run.kit)).moduleBuckets).toBeUndefined()
        expect(run.requests.some(request => request.modules || request.net?.modules === true || request.whole)).toBe(false)

        run.clock.now = run.start + 30_000
        await until(async () => (await currentFixed(run.kit)).moduleBuckets !== undefined, 'the module tick to write the buckets', 4000)
        expect(run.requests.some(request => request.net?.modules === true || request.modules)).toBe(true)
        expect((await run.kit.commitKey()).req).toContain('module-buckets')
        expect(run.crashed).toEqual([])
    })
})

// ---- The keep-set ----

describe('the asset keep-set of a layout 2 store', () => {
    test('guard: an asset only a bucketed module names is held, and an unnamed one is not', async () => {
        const rig = makeRig(2000, 22200)
        const modules = [...manyModules(30), mod('with-asset', { assets: [['a', `assets/${HEX}.png`]] })]
        const { tree } = await firstTree(rig, modules, 2)
        expect(tree.manifest.fixed.moduleBuckets).toHaveLength(2)
        const backend = await backendOf(rig.store, tree.manifestKey)
        const keep = await buildClosureAssetKeepSet({ commitKey: await parsedKey(backend), reader: createBackendClosureReader(backend) })
        expect(keep.status).toBe('complete')
        if (keep.status === 'complete') {
            expect(keep.keep.holds(`assets/${HEX}.png`)).toBe(true)
            expect(keep.keep.holds(`assets/${'ef'.repeat(32)}.png`)).toBe(false)
        }
    })
})