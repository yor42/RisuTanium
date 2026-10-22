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
import { assembleDatabase, planScopedEncode } from 'src/ts/storage/store2/codec'
import type { Committer, CommitRequest } from 'src/ts/storage/store2/commit'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    canonicalJson, encodeUnit, keyOfRef, newManifestKey, readUnit, refOfFrame, UNIT_TYPE, type LegacyList, type Manifest,
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
import { ALL_GOLDENS, FULL_GOLDENS, loadGolden, readerOver, type Golden } from './legacyFixtures'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const accept = { async confirmIncomplete() { return true } }

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
        newUnits: treeUnitCount(0) + 1,
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
        const outcome = committedOf(await importLegacyTree(test.request(golden), accept))
        expect(outcome.mode).toBe('ordinary')

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
        const outcome = committedOf(await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept))
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
        expect(built.manifest.body.req).toEqual(['zzz-future'])
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

describe('new behaviour: the plan reuses nothing from the profile it replaces', () => {
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
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
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
        const outcome = await importLegacyTree(test.request(await loadGolden('upstream-full.bin')), accept)
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
            if (call === 'readCommit' && count === 2) {
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

