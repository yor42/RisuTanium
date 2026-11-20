// @vitest-environment node
/**
 * The library core of a whole-profile import over a store2 page (`legacy/importTree.ts`): repairs, resolve, whole-tree
 * plan and one forced commit that carries the replaced manifest's keep set. Driven over a memory backend seeded with a
 * synthetic profile, with the `.bin` goldens as the imported trees. Labels in test names: `guard` may pass before and
 * after a change, `new behaviour` asserts the rule of this module.
 */
import { describe, expect, test, vi } from 'vitest'
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

import type { Database } from 'src/ts/storage/database.svelte'
import {
    createMemoryBackend, Store2BackendFailureError, Store2UnknownOutcomeError, type MemoryBackend,
} from 'src/ts/storage/store2/backend'
import { assembleDatabase, planScopedEncode, unitDigest } from 'src/ts/storage/store2/codec'
import { readBaseContentIndex, type BaseContentIndex } from 'src/ts/storage/store2/baseContent'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import type { Committer, CommitRequest } from 'src/ts/storage/store2/commit'
import { createKeyMint, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    canonicalJson, decodeFrame, encodeUnit, keyOfRef, newManifestKey, readUnit, refOfFrame, REQ_MODULE_BUCKETS, UNIT_TYPE, type LegacyList, type Manifest,
} from 'src/ts/storage/store2/format'
import { LegacyListBuilder } from 'src/ts/storage/store2/lists/legacyList'
import {
    buildImport, importLegacyTree, repairImportTree, type ImportOutcome, type ImportRequest,
} from 'src/ts/storage/store2/legacy/importTree'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { dbWithCharacters, fakeLists, buildSmall, seededEnv } from './codecFixtures'
import {
    buildTree, committerOf, createClock, expectInvariant, hooked, parsedCommit, peerWrite, plantKey, seedStore, testEnv, treeRequest,
    treeUnitCount, type Hooks, type TestClock,
} from './commitFixtures'
import { ALL_GOLDENS, FULL_GOLDENS, loadGolden, readerOver, type Golden, type StoredUnit } from './legacyFixtures'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import { characterIdProblem, isUsableCharacterId } from 'src/ts/storage/characterIds'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const accept = { async confirmIncomplete() { return true } }

/**
 * The goldens whose import writes more than `BULK_UNIT_THRESHOLD` units, the bucket of the module index included, and so
 * commits as a bulk commit; every other golden commits as an ordinary one.
 */
const BULK_GOLDENS: ReadonlySet<string> = new Set(['upstream-full.bin'])

/** A full golden that stays an ordinary commit, for the tests that hook `commitOrdinary`. */
const ORDINARY_GOLDEN = 'fork-full.bin'

const EMPTY_INDEX: BaseContentIndex = { from: null, units: new Map(), stats: { units: 0, bytes: 0, skipped: 0, backendError: false } }

interface Rig {
    memory: MemoryBackend
    clock: TestClock
    m0: string
    committer: Committer
    peer: Committer
    request(golden: Pick<Golden, 'tree' | 'units'>, extra?: Partial<ImportRequest>): ImportRequest
}

async function rig(hooks?: Hooks): Promise<Rig & { wrapped: ReturnType<typeof hooked> }> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(memory, testEnv(clock, 1))
    const wrapped = hooked(memory, hooks)
    const committer = committerOf(wrapped.backend, clock, 100)
    const peer = committerOf(memory, clock, 200)
    clock.advance(1000)
    return {
        memory, clock, m0, committer, peer, wrapped,
        request: (golden, extra = {}) => ({
            source: { tree: golden.tree },
            reader: readerOver(golden.units),
            committer,
            backend: wrapped.backend,
            lists: fakeLists,
            env: testEnv(clock, 300),
            resolve: OPTIONS,
            ...extra,
        }),
    }
}

function committedOf(outcome: ImportOutcome): Extract<ImportOutcome, { status: 'committed' }> {
    expect(outcome.status).toBe('committed')
    if (outcome.status !== 'committed') {
        throw new Error(`The import answered ${outcome.status}.`)
    }
    return outcome
}

async function currentManifest(memory: MemoryBackend): Promise<Manifest> {
    const key = (await parsedCommit(memory)).current
    if (key === null) {
        throw new Error('No manifest is current.')
    }
    const read = await readTreeBytes(memory, key.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree.manifest
}

async function storedDatabase(memory: MemoryBackend): Promise<Database> {
    const key = (await parsedCommit(memory)).current
    const read = await readTreeBytes(memory, key!.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source)
}

/** The characters as JSON with each chat id replaced by its position: the repair mints ids for chats that have none, differently on every run. */
function comparable(characters: readonly unknown[]): unknown {
    const copy = JSON.parse(JSON.stringify(characters)) as { chats?: { id?: string }[] }[]
    for (const character of copy) {
        character.chats?.forEach((chat, index) => { chat.id = `chat#${index}` })
    }
    return copy
}

function listOf(...files: [string, 'ok' | 'unreadable'][]): LegacyList {
    const builder = new LegacyListBuilder()
    for (const [key, status] of files) {
        if (status === 'unreadable') {
            builder.addUnreadable(key)
        } else {
            builder.beginFile(key, { characters: [] })
        }
    }
    return builder.build()
}

/** A request whose tree is a complete store2 tree that also names `list` as its keep set, with fields this build does not know at every level. */
function keepingRequest(list: LegacyList, tag: string, extra: { req?: string[], futureTop?: boolean } = {}): CommitRequest {
    return {
        newUnits: treeUnitCount(0) + 1, carry: IMPORT_REPLACES_BASE,
        build(context) {
            const built = buildTree(0, context, tag)
            const key = context.mint.unit()
            const bytes = encodeUnit(UNIT_TYPE.legacyList, list)
            built.units.push({ key, bytes })
            const body = built.manifest.body as unknown as Record<string, unknown>
            const fixed = built.manifest.body.fixed as unknown as Record<string, unknown>
            fixed.legacyKeep = {
                unit: refOfFrame(key, bytes),
                v: list.v,
                files: list.files.map(file => ({ key: file.key, status: file.status, futureFileField: tag })),
                futureKeepField: [tag, 2],
            }
            fixed.futureFixed = { tag }
            built.manifest.body.fixed.pluginStorage = { ...built.manifest.body.fixed.pluginStorage, futureStorage: tag } as typeof built.manifest.body.fixed.pluginStorage
            if (extra.futureTop !== false) {
                body.futureTop = { tag }
            }
            if (extra.req !== undefined) {
                built.manifest.body.req = extra.req
            }
            return built
        },
    }
}

describe('guard: a golden imports and assembles back to what the resolver gave', () => {
    test.each(ALL_GOLDENS.map(name => [name]))('%s', async (name) => {
        const test = await rig()
        const golden = await loadGolden(name)
        const marked = golden.tree as unknown as { characters: Record<string, unknown>[] }
        const plain = marked.characters.findIndex(slot => !slot.coldstorage)
        const withUnknown = plain >= 0
        if (withUnknown) {
            marked.characters[plain].futureCharacterField = { n: 1 }
        }
        // A bulk golden is imported with no base index: over the rig's base, content reuse would bring its written units
        // under the bulk threshold, and this test covers the bulk commit of a whole golden.
        const noIndex = BULK_GOLDENS.has(name) ? { baseContent: async () => EMPTY_INDEX } : {}
        const outcome = committedOf(await importLegacyTree(test.request(golden, noIndex), accept))
        expect(outcome.mode).toBe(BULK_GOLDENS.has(name) ? 'bulk' : 'ordinary')

        const expectedSource = await loadGolden(name)
        if (withUnknown) {
            (expectedSource.tree as unknown as { characters: Record<string, unknown>[] }).characters[plain].futureCharacterField = { n: 1 }
        }
        const reader = readerOver(expectedSource.units)
        await repairImportTree(expectedSource.tree, reader)
        const expected = (await resolveLegacyTree(expectedSource.tree, reader, OPTIONS)).database

        const stored = await storedDatabase(test.memory)
        expect(comparable(stored.characters)).toEqual(comparable(expected.characters))
        expect(stored.pluginCustomStorage ?? {}).toEqual(expected.pluginCustomStorage ?? {})
        if (withUnknown) {
            expect((stored.characters[plain] as unknown as Record<string, unknown>).futureCharacterField).toEqual({ n: 1 })
        }
        await expectInvariant(test.memory)
    })

    test('the full goldens bring in characters', async () => {
        for (const name of FULL_GOLDENS) {
            const test = await rig()
            const golden = await loadGolden(name)
            committedOf(await importLegacyTree(test.request(golden), accept))
            expect((await storedDatabase(test.memory)).characters.length).toBeGreaterThan(0)
        }
    })
})

describe('new behaviour: what could not be brought in is confirmed first', () => {
    test('an unparsable unit is surfaced, and a decline writes nothing', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-stub-bad-json.bin')
        const before = { key: await test.memory.readCommit(), units: test.memory.snapshot() }
        const asked: unknown[] = []
        const outcome = await importLegacyTree(test.request(golden), {
            async confirmIncomplete(items) {
                asked.push(...items)
                return false
            },
        })
        expect(outcome.status).toBe('declined')
        expect(asked).toEqual([expect.objectContaining({ kind: 'character', reason: 'unparsable' })])
        expect((await test.memory.readCommit()).bytes).toEqual(before.key.bytes)
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.units.keys()].sort())
        expect(test.wrapped.count('putUnit') + test.wrapped.count('commitOrdinary') + test.wrapped.count('casCommit')).toBe(0)
    })

    test('a missing unit is surfaced and accepting it commits the placeholder', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-stub-missing-entry.bin')
        const outcome = committedOf(await importLegacyTree(test.request(golden), accept))
        expect(outcome.manifestKey).toBe((await parsedCommit(test.memory)).current?.key)
    })

    test('a complete tree asks nothing', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-full.bin')
        let asked = 0
        committedOf(await importLegacyTree(test.request(golden), { async confirmIncomplete() { asked++; return true } }))
        expect(asked).toBe(0)
    })

    test('an archived character whose own id is unusable and whose unit cannot supply one refuses before any write', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-full.bin')
        const stub = (golden.tree as unknown as { characters: Record<string, unknown>[] }).characters.find(slot => slot.coldstorage)
        expect(stub).toBeDefined()
        stub!.chaId = 'root'
        stub!.coldstorage = '00000000-0000-4000-8000-0000000000ff'
        const outcome = await importLegacyTree(test.request(golden), accept)
        expect(outcome.status).toBe('repair-refused')
        expect(test.wrapped.count('putUnit') + test.wrapped.count('commitOrdinary') + test.wrapped.count('casCommit')).toBe(0)
    })

    test('a reader failure aborts as a failed read with nothing written', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-full.bin')
        const failing = [...golden.units.keys()][0]
        const outcome = await importLegacyTree(test.request(golden, { reader: readerOver(golden.units, { errorKeys: new Set([failing]) }) }), accept)
        expect(outcome.status).toBe('read-failed')
        expect(test.wrapped.count('putUnit') + test.wrapped.count('commitOrdinary') + test.wrapped.count('casCommit')).toBe(0)
    })
})

describe('new behaviour: the replaced state is always kept', () => {
    test('ordinary: the pre-import current is first in retained inside the admission window', async () => {
        const test = await rig()
        const m1 = (await test.committer.commit(await test.committer.readCommit(), treeRequest(0, { tag: 'before' })))
        expect(m1.status).toBe('committed')
        const pre = (await parsedCommit(test.memory)).current!.key
        test.clock.advance(1000)
        const outcome = committedOf(await importLegacyTree(test.request(await loadGolden(ORDINARY_GOLDEN)), accept))
        expect(outcome.mode).toBe('ordinary')
        const key = await parsedCommit(test.memory)
        expect(key.retained[0].key).toBe(pre)
        expect(key.retained.map(entry => entry.key)).toEqual([pre, test.m0])
        expect(key.current?.key).toBe(outcome.manifestKey)
        expect(key.staging).toBeNull()
    })

    test('bulk: the pre-import current is first in retained inside the admission window', async () => {
        const test = await rig()
        await test.committer.commit(await test.committer.readCommit(), treeRequest(0, { tag: 'before' }))
        const pre = (await parsedCommit(test.memory)).current!.key
        test.clock.advance(1000)
        const outcome = committedOf(await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }), accept))
        expect(outcome.mode).toBe('bulk')
        const key = await parsedCommit(test.memory)
        expect(key.retained.map(entry => entry.key)).toEqual([pre, test.m0])
        expect(key.current?.key).toBe(outcome.manifestKey)
        await expectInvariant(test.memory)
    })

    test('the commit is labelled import: a bulk marker carries that label', async () => {
        const labels: string[] = []
        const hooks: Hooks = {}
        const test = await rig(hooks)
        hooks.before = async (call, count) => {
            if (call === 'putUnit' && count === 1) {
                const staging = (await parsedCommit(test.memory)).staging
                labels.push(staging?.label ?? 'none')
            }
        }
        committedOf(await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }), accept))
        expect(labels).toEqual(['import'])
    })
})

describe('new behaviour: the replaced manifest\'s keep set travels with the import', () => {
    const baseList = listOf(['database/database.bin', 'unreadable'], ['database/dbbackup-100.bin', 'unreadable'])

    async function withKeepingBase(hooks?: Hooks) {
        const test = await rig(hooks)
        const base = await test.committer.commit(await test.committer.readCommit(), keepingRequest(baseList, 'base'))
        expect(base.status).toBe('committed')
        test.clock.advance(1000)
        return { ...test, baseManifest: await currentManifest(test.memory) }
    }

    test('guard: the imported manifest holds the base keep set whole, and the unit it names is stored', async () => {
        const test = await withKeepingBase()
        const base = test.baseManifest.fixed.legacyKeep
        expect(base).not.toBeNull()
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept))
        const imported = await currentManifest(test.memory)
        // Compares the whole keep object by canonical JSON: the unit reference, `v`, every file entry and the fields this build does not know.
        expect(canonicalJson(imported.fixed.legacyKeep)).toBe(canonicalJson(base))
        expect(imported.fixed.legacyKeep?.files).toEqual(base?.files)
        expect(imported.fixed.legacyKeep?.files.map(file => file.key)).toEqual(['database/database.bin', 'database/dbbackup-100.bin'])
        expect(test.memory.snapshot().has(keyOfRef(imported.fixed.legacyKeep!.unit))).toBe(true)
        await expectInvariant(test.memory)
    })

    test('the fields this build does not know, at the top, in fixed and in pluginStorage, survive the import (MC-175)', async () => {
        const test = await withKeepingBase()
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept))
        const imported = await currentManifest(test.memory) as unknown as Record<string, unknown> & { fixed: Record<string, unknown> }
        expect(imported.futureTop).toEqual({ tag: 'base' })
        expect(imported.fixed.futureFixed).toEqual({ tag: 'base' })
        expect((imported.fixed.pluginStorage as Record<string, unknown>).futureStorage).toBe('base')
    })

    test('buildImport carries the base req union as well', async () => {
        const env = seededEnv(5)
        const plan = await planScopedEncode(buildSmall(2), { env, lists: fakeLists, seq: 0, createdAt: 1 }, { modules: true, characters: 'all' })
        const base = structuredClone((await withKeepingBase()).baseManifest)
        base.req = ['zzz-future']
        const { mint } = createKeyMint(env, null)
        const built = await buildImport(plan, { base }).build({ mint, seq: 9, now: 10 })
        expect(built.manifest.body.req).toEqual([REQ_MODULE_BUCKETS, 'zzz-future'])
        expect(canonicalJson(built.manifest.body.fixed.legacyKeep)).toBe(canonicalJson(base.fixed.legacyKeep))
    })

    test('a base the commit key marks as requiring an unknown feature is refused as too new, nothing written', async () => {
        const test = await rig()
        const committed = await test.committer.commit(await test.committer.readCommit(), keepingRequest(baseList, 'req', { req: ['zzz-future'] }))
        expect(committed.status).toBe('committed')
        const before = test.memory.snapshot()
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
        expect(outcome.status === 'refused' && outcome.reason).toBe('too-new')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
    })

    test('the base is the manifest current at the read the commit is made over, not one read earlier', async () => {
        const otherList = listOf(['database/dbbackup-777.bin', 'unreadable'])
        const hooks: Hooks = {}
        const test = await withKeepingBase(hooks)
        const golden = await loadGolden('upstream-stub-bad-json.bin')
        const outcome = await importLegacyTree(test.request(golden), {
            // A peer replaces the profile, with another keep set, after the import has started and before it reads the commit key.
            async confirmIncomplete() {
                const peerRead = await test.peer.readCommit()
                expect((await test.peer.commit(peerRead, keepingRequest(otherList, 'peer'))).status).toBe('committed')
                return true
            },
        })
        committedOf(outcome)
        const imported = await currentManifest(test.memory)
        expect(imported.fixed.legacyKeep?.files.map(file => file.key)).toEqual(['database/dbbackup-777.bin'])
        expect((imported as unknown as Record<string, unknown>).futureTop).toEqual({ tag: 'peer' })
        await expectInvariant(test.memory)
    })

    test('a base whose manifest is absent refuses with nothing written, and does not commit a null keep set', async () => {
        const test = await rig()
        const key = await parsedCommit(test.memory)
        await plantKey(test.memory, { ...key, seq: key.seq + 1, epoch: 'e'.repeat(key.epoch.length), current: { key: newManifestKey(seededEnv(9)), at: 5 } })
        const before = test.memory.snapshot()
        const commitBefore = (await test.memory.readCommit()).bytes
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
        expect(outcome.status).toBe('base-unreadable')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
        expect((await test.memory.readCommit()).bytes).toEqual(commitBefore)
    })

    test('a base whose manifest is damaged refuses with nothing written', async () => {
        const test = await rig()
        const key = await parsedCommit(test.memory)
        const damaged = newManifestKey(seededEnv(10))
        test.memory.poke(damaged, new Uint8Array([1, 2, 3, 4]))
        await plantKey(test.memory, { ...key, seq: key.seq + 1, epoch: 'f'.repeat(key.epoch.length), current: { key: damaged, at: 5 } })
        const before = test.memory.snapshot()
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
        expect(outcome.status).toBe('base-unreadable')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
    })

    test('an explicit keep list for old files is written as the manifest\'s keep set, as one more unit', async () => {
        const test = await rig()
        const list = listOf(['database/database.bin', 'unreadable'], ['database/dbbackup-5.bin', 'unreadable'])
        const outcome = committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { legacyKeep: list }), accept))
        const imported = await currentManifest(test.memory)
        expect(imported.fixed.legacyKeep?.files).toEqual([
            { key: 'database/database.bin', status: 'unreadable' },
            { key: 'database/dbbackup-5.bin', status: 'unreadable' },
        ])
        const stored = readUnit(test.memory.snapshot().get(keyOfRef(imported.fixed.legacyKeep!.unit)) as Uint8Array, UNIT_TYPE.legacyList)
        expect(stored.status).toBe('ok')
        expect(stored.status === 'ok' && canonicalJson(stored.value.body)).toBe(canonicalJson(list))
        expect(outcome.manifestKey).toBe(imported.fixed.legacyKeep ? (await parsedCommit(test.memory)).current?.key : '')
        await expectInvariant(test.memory)
    })

    test('new behaviour: an explicit keep list REPLACES the carried one, and names every file of the base keep set so replacing drops no protection', async () => {
        const test = await withKeepingBase()
        const base = test.baseManifest.fixed.legacyKeep
        const explicit = listOf(['database/database.bin', 'unreadable'], ['database/dbbackup-100.bin', 'unreadable'], ['database/dbbackup-200.bin', 'unreadable'])
        // The precondition of replacing instead of merging: every file the base keep set names is in the explicit list.
        const explicitKeys = new Set(explicit.files.map(file => file.key))
        expect(base?.files.length).toBeGreaterThan(0)
        for (const file of base?.files ?? []) {
            expect(explicitKeys.has(file.key), file.key).toBe(true)
        }
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { legacyKeep: explicit }), accept))
        const imported = await currentManifest(test.memory)
        // Replaced, not merged: the explicit entries only (a merge would keep the base entries' unknown field), and the unit is the explicit list's.
        expect(imported.fixed.legacyKeep?.files).toEqual(explicit.files.map(file => ({ key: file.key, status: file.status })))
        expect(canonicalJson(imported.fixed.legacyKeep)).not.toBe(canonicalJson(base))
        const stored = readUnit(test.memory.snapshot().get(keyOfRef(imported.fixed.legacyKeep!.unit)) as Uint8Array, UNIT_TYPE.legacyList)
        expect(stored.status === 'ok' && canonicalJson(stored.value.body)).toBe(canonicalJson(explicit))
    })
})

describe('new behaviour: the plan takes no entity id of the profile it replaces', () => {
    test('imported characters take fresh entity ids, none of the replaced profile\'s', async () => {
        const test = await rig()
        const first = await loadGolden('upstream-full.bin')
        committedOf(await importLegacyTree(test.request(first), accept))
        const idsOf = async (): Promise<string[]> => {
            const key = (await parsedCommit(test.memory)).current!.key
            const read = await readTreeBytes(test.memory, key)
            if (read.status !== 'ok') {
                throw new Error('unreadable')
            }
            const ids: string[] = []
            for (const ref of read.tree.manifest.shards) {
                const shard = readUnit(read.tree.source.get(keyOfRef(ref)) as Uint8Array, UNIT_TYPE.shard)
                if (shard.status !== 'ok') {
                    throw new Error('shard unreadable')
                }
                ids.push(...(shard.value.body as { entries: { u: string }[] }).entries.map(entry => entry.u))
            }
            return ids.sort()
        }
        const before = await idsOf()
        expect(before.length).toBeGreaterThan(0)
        test.clock.advance(1000)
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { env: testEnv(test.clock, 301) }), accept))
        const after = await idsOf()
        expect(after).toHaveLength(before.length)
        expect(after.filter(id => before.includes(id))).toEqual([])
    })

    test('guard: the shard and order units of a second import of the same file are all under new keys', async () => {
        const { test, before, first } = await importedTwiceSetup()
        const second = committedOf(await importLegacyTree(test.request(await loadStable(), { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))
        const manifest = await currentManifest(test.memory)
        const own = [...manifest.shards, manifest.fixed.order].map(keyOfRef)
        expect(own.length).toBeGreaterThan(1)
        for (const key of own) {
            expect(before.has(key), key).toBe(false)
        }
        expect(second.manifestKey).not.toBe(first.manifestKey)
    })
})

const GOLDEN_BIN = 'upstream-full.bin'

/** The golden with an id on every chat that has none: the repair mints a random id otherwise, and two imports would never hold equal chat cores. */
async function loadStable(): Promise<Golden> {
    const golden = await loadGolden(GOLDEN_BIN)
    let n = 0
    for (const slot of (golden.tree as unknown as { characters: { chats?: { id?: unknown }[] }[] }).characters) {
        for (const chat of slot.chats ?? []) {
            if (typeof chat.id !== 'string' || chat.id === '') {
                chat.id = `golden-chat-${++n}`
            }
        }
    }
    return golden
}

/** Resolve options whose minted ids repeat from run to run, so two imports of one file produce equal leaves. */
function stableOptions(): typeof OPTIONS & { newUnitId: () => string } {
    let n = 0
    return { ...OPTIONS, newUnitId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }
}

/** The first import of the golden over the rig's base, committed; `before` is what the store held afterwards. */
async function importedTwiceSetup(hooks?: Hooks) {
    const test = await rig(hooks)
    const first = committedOf(await importLegacyTree(test.request(await loadStable(), { resolve: stableOptions() }), accept))
    const before = test.memory.snapshot()
    test.clock.advance(1000)
    return { test, first, before }
}

/** The unit types an import writes again whatever the base holds: the manifest, and the units that carry an entity id. */
const ALWAYS_NEW: ReadonlySet<number> = new Set([UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order])

function typeOfStored(bytes: Uint8Array): number {
    const frame = decodeFrame(bytes)
    if (frame.status !== 'ok') {
        throw new Error('A stored unit does not decode.')
    }
    return frame.type
}

/** The keys `after` holds and `before` did not. */
function addedKeys(before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>): string[] {
    return [...after.keys()].filter(key => !before.has(key))
}

/** The new keys, other than the always-new types, whose content equals a unit stored before: what content reuse must leave empty. */
function duplicatesOf(before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>): string[] {
    const known = new Set([...before.values()].map(bytes => unitDigest(bytes)))
    return addedKeys(before, after).filter(key => {
        const bytes = after.get(key) as Uint8Array
        return !ALWAYS_NEW.has(typeOfStored(bytes)) && known.has(unitDigest(bytes))
    })
}

/** The base units the current tree names: its indexed keys that were stored before `before`. */
async function namedFrom(memory: MemoryBackend, before: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
    const index = await readBaseContentIndex(memory, await memory.readCommit())
    return [...index.units.values()].flat().map(unit => unit.key).filter(key => before.has(key))
}

describe('regression: re-importing the same file stores no unit whose content is already stored', () => {
    test('regression reproducer (IT1): the second import of one golden adds only a manifest, shards, an order unit and at most one parent whose equal-content children took stored keys in another order', async () => {
        const { test, before } = await importedTwiceSetup()

        committedOf(await importLegacyTree(test.request(await loadStable(), { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))

        const after = test.memory.snapshot()
        expect(duplicatesOf(before, after)).toEqual([])
        // A parent written again is one that names an equal-content unit under another stored key (empty asset lists repeat,
        // and equal units take the base keys in encode order); it is never a leaf.
        const types = new Set(addedKeys(before, after).map(key => typeOfStored(after.get(key) as Uint8Array)))
        expect([...types].filter(type => !ALWAYS_NEW.has(type) && type !== UNIT_TYPE.moduleBucket)).toEqual([])
        expect(addedKeys(before, after).filter(key => typeOfStored(after.get(key) as Uint8Array) === UNIT_TYPE.moduleBucket).length).toBeLessThanOrEqual(1)
        await expectInvariant(test.memory)
    })

    test('guard (IT3): the commit carries the first import\'s manifest and the count of base units the new tree names', async () => {
        const { test, first, before } = await importedTwiceSetup()
        const carries: CommitRequest['carry'][] = []
        const spy: Committer = { ...test.committer, commit: async (read, request) => { carries.push(request.carry); return test.committer.commit(read, request) } }

        committedOf(await importLegacyTree(test.request(await loadStable(), { committer: spy, env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))

        const named = await namedFrom(test.memory, before)
        expect(named.length).toBeGreaterThan(0)
        expect(carries).toEqual([{ from: first.manifestKey, units: named.length }])
    })

    test('guard (IT3): an import that names no unit of the base replaces it', async () => {
        const test = await rig()
        const before = test.memory.snapshot()
        const carries: CommitRequest['carry'][] = []
        const spy: Committer = { ...test.committer, commit: async (read, request) => { carries.push(request.carry); return test.committer.commit(read, request) } }

        committedOf(await importLegacyTree(test.request({ tree: dbWithCharacters([{ chaId: 'solo-1', name: 'Solo only', type: 'character', chats: [] }]), units: new Map() }, { committer: spy }), accept))

        const named = await namedFrom(test.memory, before)
        expect(carries).toEqual([named.length === 0 ? IMPORT_REPLACES_BASE : { from: test.m0, units: named.length }])
    })

    test('guard (IT4, ordinary): when the commit key stops naming the manifest the index was read from, the import is refused base-unnamed and nothing lands', async () => {
        const hooks: Hooks = {}
        const { test, first } = await importedTwiceSetup(hooks)
        const unrelated = test.m0
        let reads = 0
        hooks.before = async (call) => {
            // The first read of the commit key is the index's; the second is the one the commit is made over.
            if (call === 'readCommit' && ++reads === 2) {
                const key = await parsedCommit(test.memory)
                await plantKey(test.memory, { ...key, seq: key.seq + 1, epoch: 'e'.repeat(key.epoch.length), current: { key: unrelated, at: 5 }, retained: [], pins: [] })
            }
        }
        const stored = test.memory.snapshot()

        const outcome = await importLegacyTree(test.request(await loadStable(), { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept)

        expect(first.manifestKey).not.toBe(unrelated)
        expect(outcome.status === 'refused' && outcome.reason).toBe('base-unnamed')
        expect((await parsedCommit(test.memory)).current?.key).toBe(unrelated)
        expect(addedKeys(stored, test.memory.snapshot())).toEqual([])
    })

    test('guard (IT4/IT9, bulk): a peer that drops the base under the marker refuses the import base-unnamed, the marker is cleared, and a second import lands', async () => {
        const hooks: Hooks = {}
        const test = await rig(hooks)
        const small = (): { tree: Database, units: Map<string, StoredUnit> } => ({ tree: buildSmall(30), units: new Map() })
        const first = committedOf(await importLegacyTree(test.request(small(), { resolve: stableOptions() }), accept))
        test.clock.advance(1000)
        let planted = false
        hooks.before = async (call) => {
            // The commit key under this import's own standing marker, rewritten by a peer that does not name the base.
            if (call === 'casCommit' && !planted && (await parsedCommit(test.memory)).staging !== null) {
                planted = true
                const key = await parsedCommit(test.memory)
                expect(key.staging).not.toBeNull()
                await plantKey(test.memory, { ...key, seq: key.seq + 1, epoch: 'g'.repeat(key.epoch.length), current: { key: test.m0, at: 5 }, retained: [], pins: [] })
            }
        }
        const tree = (): { tree: Database, units: Map<string, StoredUnit> } => ({ tree: buildSmall(90), units: new Map() })

        const outcome = await importLegacyTree(test.request(tree(), { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept)

        expect(planted).toBe(true)
        expect(outcome.status === 'refused' && outcome.reason).toBe('base-unnamed')
        expect(outcome.status === 'refused' && outcome.cleared?.status).toBe('cleared')
        expect((await parsedCommit(test.memory)).staging).toBeNull()
        expect(first.manifestKey).not.toBe(test.m0)
        // Nothing the refused import staged or named is reachable from the store's manifests, and the sweep keeps every named unit.
        const removed = await gcPass({ backend: test.memory, kind: 'tauri', idleReason: () => null })
        expect(removed.status).toBe('done')
        await expectInvariant(test.memory)

        hooks.before = undefined
        const again = committedOf(await importLegacyTree(test.request(tree(), { env: testEnv(test.clock, 302), resolve: stableOptions() }), accept))
        expect(again.manifestKey).toBe((await parsedCommit(test.memory)).current?.key)
        await expectInvariant(test.memory)
    })

    test('guard (IT5): a peer commit that keeps the base retained lands the import, carrying the index\'s manifest and the keep of the peer\'s', async () => {
        const hooks: Hooks = {}
        const { test, first } = await importedTwiceSetup(hooks)
        const peerList = listOf(['database/dbbackup-555.bin', 'unreadable'])
        let seen: string[] = []
        let reads = 0
        hooks.before = async (call) => {
            // After the index read and before the commit read: a peer replaces the profile and keeps the first import's manifest retained.
            if (call === 'readCommit' && ++reads === 2) {
                const peerRead = await test.peer.readCommit()
                expect((await test.peer.commit(peerRead, { ...keepingRequest(peerList, 'peer'), force: true })).status).toBe('committed')
                seen = (await parsedCommit(test.memory)).retained.map(entry => entry.key)
                expect(seen).toContain(first.manifestKey)
            }
        }
        const carries: CommitRequest['carry'][] = []
        const spy: Committer = { ...test.committer, commit: async (read, request) => { carries.push(request.carry); return test.committer.commit(read, request) } }

        const outcome = committedOf(await importLegacyTree(test.request(await loadStable(), { committer: spy, env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))

        expect(seen).toContain(first.manifestKey)
        expect(carries).toHaveLength(1)
        expect(carries[0]).toMatchObject({ from: first.manifestKey })
        expect((carries[0] as { units: number }).units).toBeGreaterThan(0)
        const imported = await currentManifest(test.memory)
        expect(outcome.manifestKey).toBe((await parsedCommit(test.memory)).current?.key)
        expect(imported.fixed.legacyKeep?.files.map(file => file.key)).toEqual(['database/dbbackup-555.bin'])
        await expectInvariant(test.memory)
    })

    test('guard (IT6): a base leaf that is absent, and one overwritten by another unit, only lose their own reuse; the import lands', async () => {
        const { test, before } = await importedTwiceSetup()
        const index = await readBaseContentIndex(test.memory, await test.memory.readCommit())
        // Units whose content no other base unit repeats, so a lost one cannot be replaced by an equal candidate.
        const leaves = [...index.units.values()].filter(candidates => candidates.length === 1).map(candidates => candidates[0])
        expect(leaves.length).toBeGreaterThan(3)
        const gone = leaves[0]
        const swapped = leaves[1]
        test.memory.poke(gone.key, null)
        test.memory.poke(swapped.key, before.get(leaves[2].key) as Uint8Array)

        committedOf(await importLegacyTree(test.request(await loadStable(), { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))

        const after = test.memory.snapshot()
        const added = addedKeys(before, after)
        const addedDigests = new Set(added.map(key => unitDigest(after.get(key) as Uint8Array)))
        expect(addedDigests.has(gone.digest)).toBe(true)
        expect(addedDigests.has(swapped.digest)).toBe(true)
        // Most of the base is still reused: the units written are the two lost contents and the parents that name them.
        const other = added.filter(key => !ALWAYS_NEW.has(typeOfStored(after.get(key) as Uint8Array)))
        expect(other.length).toBeLessThan(leaves.length / 2)
    })
})

describe('guard (IT7): over the synthetic base the replaced state is still kept, and the commit mode follows the units written', () => {
    test('a tree whose units the base already holds commits as ordinary, a new one as bulk', async () => {
        const test = await rig()
        const big = committedOf(await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }, { resolve: stableOptions() }), accept))
        expect(big.mode).toBe('bulk')
        test.clock.advance(1000)

        const again = committedOf(await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }, { env: testEnv(test.clock, 301), resolve: stableOptions() }), accept))

        expect(again.mode).toBe('ordinary')
        expect((await parsedCommit(test.memory)).retained[0].key).toBe(big.manifestKey)
    })
})

describe('new behaviour: the decoded tree is released before the commit', () => {
    test('the source holds no tree when commit() is called', async () => {
        const test = await rig()
        const golden = await loadGolden('upstream-full.bin')
        const request = test.request(golden)
        let seen: Database | null | undefined
        const committer: Committer = {
            ...test.committer,
            commit: async (read, commitRequest) => {
                seen = request.source.tree
                return test.committer.commit(read, commitRequest)
            },
        }
        committedOf(await importLegacyTree({ ...request, committer }, accept))
        expect(seen).toBeNull()
    })

    test('a second use of a released source is refused', async () => {
        const test = await rig()
        const request = test.request(await loadGolden('upstream-full.bin'))
        committedOf(await importLegacyTree(request, accept))
        await expect(importLegacyTree(request, accept)).rejects.toThrow(TypeError)
    })
})

describe('new behaviour: a tree the codec cannot hold writes nothing', () => {
    test('a chat that is not an object is unsavable', async () => {
        const test = await rig()
        const tree = dbWithCharacters([{ chaId: 'c1', name: 'Broken', type: 'character', chats: [42] }])
        const before = test.memory.snapshot()
        const outcome = await importLegacyTree(test.request({ tree, units: new Map() }), accept)
        expect(outcome.status).toBe('unsavable')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
        expect(test.wrapped.count('commitOrdinary') + test.wrapped.count('casCommit')).toBe(0)
    })

    // Guard (passes before and after the save loop learned to skip an unreadable character): an import has no earlier copy
    // to fall back on, so a character the codec cannot read refuses the whole import instead of being left out.
    test('a character whose data cannot be read refuses the import and is never left out', async () => {
        const test = await rig()
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        const tree = dbWithCharacters([{ chaId: 'c1', name: 'Cyclic', type: 'character', chats: [], personality: cycle }])
        const before = test.memory.snapshot()
        const outcome = await importLegacyTree(test.request({ tree, units: new Map() }), accept)
        expect(outcome.status).toBe('unsavable')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
        expect(test.wrapped.count('commitOrdinary') + test.wrapped.count('casCommit')).toBe(0)
    })
})

describe('new behaviour: the commit outcomes are typed', () => {
    test('a peer that commits first is a conflict and nothing of the import lands', async () => {
        const hooks: Hooks = {}
        const test = await rig(hooks)
        hooks.before = async (call) => {
            if (call === 'commitOrdinary') {
                await test.peer.commit(await test.peer.readCommit(), treeRequest(0, { tag: 'peer' }))
            }
        }
        const outcome = await importLegacyTree(test.request(await loadGolden(ORDINARY_GOLDEN)), accept)
        expect(outcome.status).toBe('conflict')
        expect((await parsedCommit(test.memory)).current?.key).not.toBe(test.m0)
    })

    test('a definite backend failure is failed', async () => {
        const hooks: Hooks = {}
        const test = await rig(hooks)
        hooks.before = (call) => {
            if (call === 'commitOrdinary') {
                throw new Store2BackendFailureError('Injected failure.')
            }
        }
        const outcome = await importLegacyTree(test.request(await loadGolden(ORDINARY_GOLDEN)), accept)
        expect(outcome.status).toBe('failed')
        expect((await parsedCommit(test.memory)).current?.key).toBe(test.m0)
    })

    test('a write whose outcome cannot be read back is unknown', async () => {
        const hooks: Hooks = {}
        const test = await rig(hooks)
        hooks.before = (call, count) => {
            if (call === 'commitOrdinary') {
                throw new Store2UnknownOutcomeError('Injected lost response.')
            }
            // The reads are the content index's, the commit's own, and the read-back after the lost response.
            if (call === 'readCommit' && count === 3) {
                throw new Store2BackendFailureError('Injected read failure.')
            }
        }
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
        expect(outcome.status).toBe('unknown')
    })

    test('a standing foreign bulk marker refuses a bulk import as marker-present, and writes no unit', async () => {
        const test = await rig()
        const marker = { owner: 'q'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const
        await peerWrite(test.memory, testEnv(test.clock, 400), { staging: marker })
        const before = test.memory.snapshot()
        const outcome = await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }), accept)
        expect(outcome.status === 'refused' && outcome.reason).toBe('marker-present')
        expect([...test.memory.snapshot().keys()].sort()).toEqual([...before.keys()].sort())
    })

    test('a failed unit upload abandons the bulk import with its cause and clears the own marker', async () => {
        const hooks: Hooks = {}
        const test = await rig(hooks)
        hooks.before = (call, count) => {
            if (call === 'putUnit' && count === 3) {
                throw new Store2BackendFailureError('Injected failure.')
            }
        }
        const outcome = await importLegacyTree(test.request({ tree: buildSmall(40), units: new Map() }), accept)
        expect(outcome.status).toBe('abandoned')
        expect(outcome.status === 'abandoned' && outcome.reason).toBe('upload-failed')
        expect(outcome.status === 'abandoned' && outcome.cause).toBeInstanceOf(Store2BackendFailureError)
        const key = await parsedCommit(test.memory)
        expect(key.current?.key).toBe(test.m0)
        expect(key.staging).toBeNull()
    })

    test('a commit key that names no current refuses, and nothing is built', async () => {
        const test = await rig()
        const key = await parsedCommit(test.memory)
        await plantKey(test.memory, { ...key, seq: key.seq + 1, epoch: 'd'.repeat(key.epoch.length), current: null })
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
        expect(outcome.status === 'refused' && outcome.reason).toBe('no-current')
        expect(classifyCommitRead(await test.memory.readCommit()).status).toBe('parsed')
    })
})

describe('task presets over an import: the page\'s list is kept by value, a tree\'s own key never lands', () => {
    const OWN = [{ id: 'own-0', name: 'From the file', instructions: 'x', model: 'm' }]
    const LIVE = [
        { id: 'live-0', name: 'Live', instructions: 'a', model: 'm', futureKey: { n: [1] } },
        { id: 'live-1', name: 'Unsaved edit', instructions: 'b', model: 'm' },
    ]

    /** A golden whose database entry was edited to carry its own `taskPresets`: a hand-edited `.bin`, or a later upstream field. */
    async function goldenWithOwn(): Promise<Golden> {
        const golden = await loadGolden('upstream-full.bin')
        ;(golden.tree as unknown as Record<string, unknown>).taskPresets = JSON.parse(JSON.stringify(OWN))
        return golden
    }

    function idsOf(db: Database): string[] {
        return ((db as unknown as { taskPresets?: { id: string }[] }).taskPresets ?? []).map(preset => preset.id)
    }

    test('regression reproducer: with no list passed, the tree\'s own key creates no unit, no field and no token', async () => {
        const test = await rig()
        committedOf(await importLegacyTree(test.request(await goldenWithOwn()), accept))
        const manifest = await currentManifest(test.memory)
        expect(Object.hasOwn(manifest.fixed, 'taskPresets')).toBe(false)
        expect(manifest.req).not.toContain('task-presets')
        expect(Object.hasOwn(await storedDatabase(test.memory), 'taskPresets')).toBe(false)
    })

    test('regression reproducer: both lists present, only the page\'s land, by value with the unknown key, under fresh unit keys', async () => {
        const test = await rig()
        committedOf(await importLegacyTree(test.request(await goldenWithOwn(), { taskPresets: LIVE }), accept))
        const stored = await storedDatabase(test.memory)
        expect(idsOf(stored)).toEqual(['live-0', 'live-1'])
        expect((stored as unknown as { taskPresets: Record<string, unknown>[] }).taskPresets[0].futureKey).toEqual({ n: [1] })
        expect((await currentManifest(test.memory)).req).toContain('task-presets')
    })

    test('the caller\'s list is not changed by the import', async () => {
        const test = await rig()
        const before = JSON.stringify(LIVE)
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { taskPresets: LIVE }), accept))
        expect(JSON.stringify(LIVE)).toBe(before)
    })

    test('guard: over a base that already holds the token, an empty list keeps the token and drops the field (the token is never lowered)', async () => {
        const test = await rig()
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { taskPresets: LIVE }), accept))
        committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin'), { taskPresets: [] }), accept))
        const manifest = await currentManifest(test.memory)
        expect(manifest.req).toContain('task-presets')
        expect(Object.hasOwn(manifest.fixed, 'taskPresets')).toBe(false)
    })

    test('regression reproducer: resolveLegacyTree itself removes the key, so the boot conversion cannot adopt it either', async () => {
        const golden = await goldenWithOwn()
        const resolved = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)
        expect(Object.hasOwn(resolved.database, 'taskPresets')).toBe(false)
    })
})

describe('a re-id the import repair makes is followed by every stored reference', () => {
    type Obj = Record<string, unknown>
    const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const LONG = 'L'.repeat(300)
    const say = (saying: string, data: string, role = 'char'): Obj => ({ role, data, saying, time: 1, chatId: `m-${data}` })
    const altOf = (m: Obj): Obj => ({ m, p: `parent-${String(m.data)}`, a: 2, mem: { kept: String(m.data) } })
    const chatOf = (id: string, message: Obj[], alt?: Obj[]): Obj => ({
        id, name: id, note: '', localLore: [], message, ...(alt !== undefined ? { alt } : {}),
    })
    const pointer = (unit: string): Obj => ({ role: 'char', data: coldStorageHeader + unit, time: 1 })

    interface Ids { config: string, long: string, proto: string, root: string }
    const REAL: Ids = { config: 'config', long: LONG, proto: '__proto__', root: 'root' }
    /** The same tree with every unusable id already replaced by a usable one. */
    const TWIN: Ids = { config: 'B1', long: 'F1', proto: 'P1', root: 'E1' }

    /** Producer-shaped legacy tree: hot characters, an archived character and group, a pointer chat unit, hot and cold `alt`. */
    function build(ids: Ids): Golden {
        const units = new Map<string, StoredUnit>()
        const sayings = (chatId: string, names: string[]) => names.map((name, index) => say(name, `${chatId}:${index}`))
        units.set(U(1), { status: 'ok', value: { message: sayings('gu', [ids.config, ids.long, 'A1', ids.root, ids.proto]) } })
        units.set(U(2), { status: 'ok', value: { character: {
            chaId: 'E1', name: 'E', type: 'character', chats: [
                chatOf('ec', sayings('ec', [ids.config])),
                chatOf('ea', sayings('ea', ['A1']), [altOf(say(ids.config, 'ea:alt0'))]),
                chatOf('em', sayings('em', [ids.config]), [altOf(say('A1', 'em:alt0'))]),
            ],
        } } })
        units.set(U(3), { status: 'ok', value: { character: {
            chaId: 'H1', name: 'H', type: 'group', characters: [ids.config, ids.root, ids.long, 'A1', ids.proto],
            chats: [chatOf('hc', sayings('hc', [ids.config, ids.root, ids.long, ids.proto]), [altOf(say(ids.config, 'hc:alt0'))])],
        } } })
        const characters: Obj[] = [
            { chaId: 'A1', name: 'A', type: 'character', chats: [chatOf('ac', sayings('ac', ['A1']))] },
            { chaId: ids.config, name: 'B', type: 'character', chats: [chatOf('bc', sayings('bc', [ids.config]), [altOf(say(ids.config, 'bc:alt0'))])] },
            {
                chaId: 'G1', name: 'G', type: 'group', characters: [ids.config, 'A1', ids.long, ids.root, ids.proto], chats: [
                    chatOf('gc', sayings('gc', [ids.config, 'A1', ids.long]), [altOf(say(ids.config, 'gc:alt0'))]),
                    chatOf('gcold', [pointer(U(1)), say(ids.config, 'gcold:1')]),
                ],
            },
            { chaId: ids.root, name: 'E-archived', type: 'character', coldstorage: U(2), chats: [] },
            { chaId: 'H1', name: 'H-archived-group', type: 'group', coldstorage: U(3), chats: [] },
            { chaId: ids.long, name: 'F-long', type: 'character', chats: [chatOf('fc', sayings('fc', [ids.long]))] },
            { chaId: ids.proto, name: 'P-proto', type: 'character', chats: [chatOf('pc', sayings('pc', [ids.proto]))] },
        ]
        const tree = {
            characters,
            characterOrder: [ids.config, 'A1', { id: 'fold', data: [ids.root, ids.long, ids.proto] }, 'G1'],
            loadouts: [{ id: 'l', characterIds: [ids.config, ids.root] }],
        }
        return { tree: tree as unknown as Database, units }
    }

    /** Every speaker reference (member, message speaker, alternative speaker) that names no character the tree holds. */
    function dangling(db: Database): string[] {
        const all = db.characters as unknown as Obj[]
        const held = new Set(all.filter(c => isUsableCharacterId(c.chaId)).map(c => String(c.chaId)))
        const out: string[] = []
        const check = (id: unknown, where: string) => {
            if (typeof id === 'string' && !held.has(id)) {
                out.push(`${where}:${id.length > 20 ? 'LONG' : id}`)
            }
        }
        for (const character of all) {
            for (const member of (character.characters as unknown[] | undefined) ?? []) {
                check(member, `members(${String(character.name)})`)
            }
            for (const chat of (character.chats as Obj[] | undefined) ?? []) {
                for (const m of (chat.message as Obj[] | undefined) ?? []) {
                    if (m.role === 'char') {
                        check(m.saying, `say(${String(character.name)}/${String(chat.id)})`)
                    }
                }
                for (const record of (chat.alt as { m: Obj }[] | undefined) ?? []) {
                    if (record.m.role === 'char') {
                        check(record.m.saying, `alt(${String(character.name)}/${String(chat.id)})`)
                    }
                }
            }
        }
        return out
    }

    /** A message or alternative message with every key but `saying`, so a rebuilt record that loses any other key shows. */
    function withoutSaying(message: Obj): Obj {
        const { saying: _saying, ...rest } = message
        return rest
    }

    /** What a lost, swapped or invented list shows in: ids, members and sayings are left out, content is kept. */
    function contentShape(db: Database): unknown {
        return (db.characters as unknown as Obj[]).map(character => ({
            name: character.name,
            type: character.type,
            chats: Array.isArray(character.chats) ? (character.chats as Obj[]).map(chat => ({
                id: chat.id,
                keys: Object.keys(chat).sort(),
                message: Object.hasOwn(chat, 'message') ? (chat.message as Obj[]).map(withoutSaying) : 'absent',
                alt: !Object.hasOwn(chat, 'alt') ? 'absent'
                    : Array.isArray(chat.alt) ? (chat.alt as { m: Obj }[]).map(record => ({ ...record, m: withoutSaying(record.m) })) : typeof chat.alt,
            })) : null,
        }))
    }

    async function importStored(golden: Golden): Promise<Database> {
        const test = await rig()
        committedOf(await importLegacyTree(test.request(golden), accept))
        return await storedDatabase(test.memory)
    }

    test('reproducer: the stored tree names no id that no character holds', async () => {
        const stored = await importStored(build(REAL))

        expect(dangling(stored)).toEqual([])
    })

    test('guard: the stored chats keep their content, whatever the ids (a twin without id problems has the same shape)', async () => {
        const real = await importStored(build(REAL))
        const twin = await importStored(build(TWIN))

        expect(contentShape(real)).toEqual(contentShape(twin))
    })

    test('guard: the repair summary of the fixture is what it was, and a following step adds none', async () => {
        const golden = build(REAL)

        const repaired = await repairImportTree(golden.tree, readerOver(golden.units))

        expect(repaired.status).toBe('repaired')
        expect('summary' in repaired ? repaired.summary : null).toEqual({ dropped: 0, changed: 3, recovered: 1 })
    })

    test('guard: a speaker and a member that name a usable id no character holds stay as they are', async () => {
        const golden = build(REAL)
        const characters = golden.tree.characters as unknown as Obj[]
        ;(characters[0].chats as Obj[])[0].message = [say('ghost', 'ac:ghost')]
        characters[2].characters = ['ghost', 'config']

        const stored = await importStored(golden)

        const all = stored.characters as unknown as Obj[]
        expect(all[2].characters).toEqual(['ghost', all[1].chaId])
        expect(((all[0].chats as Obj[])[0].message as Obj[])[0].saying).toBe('ghost')
    })

    test('reproducer: a saying in the cold unit of the golden\'s pointer chat follows the re-id of the character that owns it', async () => {
        const golden = await loadGolden('upstream-full.bin')
        const tree = golden.tree as unknown as { characters: Obj[], characterOrder?: unknown[], loadouts?: Obj[] }
        const owner = tree.characters[0]
        const oldId = owner.chaId as string
        const chats = owner.chats as Obj[]
        const unitKey = ((chats[1].message as Obj[])[0].data as string).slice(coldStorageHeader.length)
        const unit = golden.units.get(unitKey)
        if (unit === undefined || unit.status !== 'ok') {
            throw new Error('The golden holds no readable unit under its pointer chat.')
        }
        const unitMessage = (unit.value as { message: Obj[] }).message[0]
        unitMessage.role = 'char'
        unitMessage.saying = 'config'
        owner.chaId = 'config'
        const rename = (list: unknown[] | undefined) => list?.forEach((entry, index) => { if (entry === oldId) { list[index] = 'config' } })
        rename(tree.characterOrder)
        tree.loadouts?.forEach(loadout => rename(loadout.characterIds as unknown[] | undefined))
        tree.characters.forEach(character => rename(character.characters as unknown[] | undefined))

        // (a) the chat is a pointer, (b) the edited message sits in its unit and in no hot chat, (c) it reads as edited.
        expect(String((chats[1].message as Obj[])[0].data).startsWith(coldStorageHeader)).toBe(true)
        const hot = tree.characters.flatMap(character => (character.chats as Obj[] | undefined) ?? [])
        expect(hot.some(chat => (chat.message as Obj[]).some(m => m.saying === 'config'))).toBe(false)
        expect(unitMessage.role).toBe('char')
        expect(unitMessage.saying).toBe('config')

        const stored = await importStored(golden)

        const renamed = (stored.characters as unknown as Obj[])[0]
        expect(characterIdProblem(renamed.chaId)).toBeNull()
        expect(((renamed.chats as Obj[])[1].message as Obj[])[0].saying).toBe(renamed.chaId)
    })
})

