/**
 * `collectLegacyColdKeys`: the fail-whole, key-only walk behind the
 * `coldstorage/` exclusion of the old files' deletion. It returns the keys the
 * legacy trees refer to (found, missing, invalid and every root key) and rejects
 * on any failure, because a deletion run on a partial answer could remove a unit
 * an upstream backup still names.
 *
 * Tests labelled `new behaviour` assert the walk's rules; `guard` ones pin the
 * shared enumeration against the collector's own root listing.
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
import { coldStorageHeader, listColdBackupRoots } from 'src/ts/process/coldstorageData'
import { legacyRefsOfDatabase } from 'src/ts/storage/store2/legacy/refs'
import { LegacyReadError } from 'src/ts/storage/store2/legacy/resolve'
import { collectLegacyColdKeys } from 'src/ts/storage/store2/legacy/walk'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { ALL_GOLDENS, DEEP, deepChain, ID, loadGolden, readerOver, unitValue, type StoredUnit } from './legacyFixtures'

const KEYS = {
    'fork-full.bin': [ID.stubBlob, ID.blobChatUnit, ID.inlineChatUnit, ID.pluginUnit],
    'upstream-full.bin': [ID.stubBlob, ID.blobChatUnit, ID.inlineChatUnit, ID.pluginUnit, ID.errorTextUnit],
    'fork-missing-unit.bin': [ID.missingChatUnit],
    'upstream-missing-unit.bin': [ID.missingChatUnit],
    'upstream-plugin-object-no-entry.bin': [ID.pluginUnit],
    'fork-stub-missing-entry.bin': [ID.stubBlob, ID.blobChatUnit],
    'upstream-stub-missing-entry.bin': [ID.stubBlob, ID.blobChatUnit],
    'fork-stub-wrong-shape.bin': [ID.stubBlob, ID.blobChatUnit],
    'upstream-stub-wrong-shape.bin': [ID.stubBlob, ID.blobChatUnit],
} as const

function sorted(keys: Iterable<string>): string[] {
    return [...keys].sort()
}

describe('new behaviour: the exact key set over the goldens', () => {
    test.each(Object.entries(KEYS))('%s', async (file, expected) => {
        const golden = await loadGolden(file)

        const keys = await collectLegacyColdKeys([golden.tree], readerOver(golden.units))

        expect(sorted(keys)).toEqual(sorted(expected))
    })

    test('a unit whose body is not JSON hides the references it holds, so the walk rejects (the stub-bad-json goldens)', async () => {
        for (const file of ['fork-stub-bad-json.bin', 'upstream-stub-bad-json.bin']) {
            const golden = await loadGolden(file)

            await expect(collectLegacyColdKeys([golden.tree], readerOver(golden.units))).rejects.toBeInstanceOf(LegacyReadError)
        }
    })

    test('each unit is read once, and plugin units are listed but never read', async () => {
        const golden = await loadGolden('fork-full.bin')
        const reader = readerOver(golden.units)

        const keys = await collectLegacyColdKeys([golden.tree, golden.tree], reader)

        expect(keys.size).toBe(4)
        expect(sorted(reader.reads)).toEqual(sorted(new Set(reader.reads)))
        expect(reader.reads).not.toContain(ID.pluginUnit)
    })

    test('keys held only inside units are found, through a pointer, a load-error text and a second unit', async () => {
        const deep = deepChain()
        const reader = readerOver(deep.units)

        const keys = await collectLegacyColdKeys([deep.tree], reader)

        expect(sorted(keys)).toEqual(sorted(Object.values(DEEP)))
        expect(reader.reads).toEqual(expect.arrayContaining([DEEP.stub, DEEP.chat, DEEP.errorNamed]))
    })

    test('numbered backups: a key only a backup refers to is in the result', async () => {
        const main = await loadGolden('fork-stub-missing-entry.bin')
        const backup = await loadGolden('upstream-missing-unit.bin')

        const keys = await collectLegacyColdKeys([main.tree, backup.tree], readerOver(new Map()))

        expect(keys.has(ID.missingChatUnit)).toBe(true)
        expect(keys.has(ID.stubBlob)).toBe(true)
    })

    test('a tree is read as it is produced: a lazily decoded sequence is consumed one at a time', async () => {
        const golden = await loadGolden('fork-full.bin')
        const produced: number[] = []
        async function* trees(): AsyncGenerator<Database> {
            for (let i = 0; i < 3; i++) {
                produced.push(i)
                yield golden.tree
            }
        }

        const keys = await collectLegacyColdKeys(trees(), readerOver(golden.units))

        expect(produced).toEqual([0, 1, 2])
        expect(keys.size).toBe(4)
    })
})

describe('new behaviour: any error means no answer', () => {
    test('a referenced key that cannot name a unit rejects instead of being skipped', async () => {
        const golden = await loadGolden('fork-full.bin')
        const tree = { ...golden.tree, characters: [{ ...(golden.tree.characters[0] as object), chats: [{ message: [{ data: coldStorageHeader + '../odd' }] }] }] } as unknown as Database

        await expect(collectLegacyColdKeys([tree], readerOver(golden.units))).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('a truthy coldstorage that is not a unit id rejects', async () => {
        const golden = await loadGolden('fork-full.bin')
        const tree = { ...golden.tree, characters: [{ chaId: 'x', coldstorage: 42, chats: [] }] } as unknown as Database

        await expect(collectLegacyColdKeys([tree], readerOver(golden.units))).rejects.toBeInstanceOf(LegacyReadError)
    })

    test.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('%s while reading a unit rejects', async (_label, fault) => {
        const golden = await loadGolden('fork-full.bin')

        const outcome = await collectLegacyColdKeys([golden.tree], readerOver(golden.units, { [fault]: new Set([ID.blobChatUnit]) })).then(
            () => 'answered',
            (error: unknown) => error,
        )

        expect(outcome).toBeInstanceOf(LegacyReadError)
        expect((outcome as LegacyReadError).key).toBe(ID.blobChatUnit)
    })

    test('a tree that fails to decode rejects the walk with that failure', async () => {
        const golden = await loadGolden('fork-full.bin')
        async function* trees(): AsyncGenerator<Database> {
            yield golden.tree
            throw new Error('backup 2 does not decode')
        }

        await expect(collectLegacyColdKeys(trees(), readerOver(golden.units))).rejects.toThrow('backup 2 does not decode')
    })

    test('the walk does not continue past an error: no later tree is read and nothing is returned', async () => {
        const golden = await loadGolden('fork-full.bin')
        const later = await loadGolden('upstream-missing-unit.bin')
        const reader = readerOver(golden.units, { errorKeys: new Set([ID.stubBlob]) })

        const outcome = await collectLegacyColdKeys([golden.tree, later.tree], reader).then(() => 'answered', (error: unknown) => error)

        expect(outcome).toBeInstanceOf(LegacyReadError)
        expect(reader.reads).not.toContain(ID.missingChatUnit)
    })

    test('an absent or wrongly shaped unit is not an error', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = new Map<string, StoredUnit>(golden.units)
        units.delete(ID.inlineChatUnit)
        units.set(ID.blobChatUnit, { status: 'ok', value: { a: 1 } })

        const keys = await collectLegacyColdKeys([golden.tree], readerOver(units))

        expect(sorted(keys)).toEqual(sorted(KEYS['fork-full.bin']))
    })
})

describe('new behaviour: the visit callback and per-file calls', () => {
    test('visit sees the key and parsed body of every unit read successfully, and nothing for a missing or unparsable one', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = new Map<string, StoredUnit>(golden.units)
        units.delete(ID.inlineChatUnit)
        const visited: [string, unknown][] = []

        await collectLegacyColdKeys([golden.tree], readerOver(units), (key, value) => { visited.push([key, value]) })

        expect(visited.map(([key]) => key).sort()).toEqual([ID.stubBlob, ID.blobChatUnit].sort())
        for (const [key, value] of visited) {
            expect(value).toEqual(unitValue(golden, key))
        }
    })

    test('without a visit callback the walk answers exactly as before', async () => {
        const golden = await loadGolden('fork-full.bin')

        const plain = await collectLegacyColdKeys([golden.tree], readerOver(golden.units))
        const visited = await collectLegacyColdKeys([golden.tree], readerOver(golden.units), () => { })

        expect(sorted(visited)).toEqual(sorted(plain))
    })

    test('one call per file keeps its own state: a unit two files share is read and visited once for each, and one file\'s failure leaves the other\'s answer intact', async () => {
        const golden = await loadGolden('fork-full.bin')
        const reader = readerOver(golden.units)
        const seen: string[] = []

        const first = await collectLegacyColdKeys([golden.tree], reader, key => { seen.push(key) })
        const second = await collectLegacyColdKeys([golden.tree], reader, key => { seen.push(key) })

        expect(sorted(first)).toEqual(sorted(second))
        expect(seen.filter(key => key === ID.stubBlob)).toHaveLength(2)
        const failing = readerOver(golden.units, { errorKeys: new Set([ID.blobChatUnit]) })
        await expect(collectLegacyColdKeys([golden.tree], failing)).rejects.toBeInstanceOf(LegacyReadError)
        expect(sorted(await collectLegacyColdKeys([golden.tree], readerOver(golden.units)))).toEqual(sorted(first))
    })
})

const INDEX_ID = '00000000-0000-4000-8000-0000000000d1'
const LARGE_A = '00000000-0000-4000-8000-0000000000d2'
const LARGE_B = '00000000-0000-4000-8000-0000000000d3'

function indexUnit(entries: unknown[]): StoredUnit {
    return { status: 'ok', value: { type: 'risu-plugin-storage-index', version: 1, entries, trash: [] } }
}

function treeWithStorage(storage: Record<string, unknown>): Database {
    return { characters: [], pluginCustomStorage: storage } as unknown as Database
}

describe('the upstream plugin storage index is part of the walk', () => {
    test('reproducer: the pointer and every large unit id the index names are in the result, and the large units are not read', async () => {
        const units = new Map<string, StoredUnit>([[INDEX_ID, indexUnit([{ k: 'a', s: '1' }, { k: 'b', l: LARGE_A }, { k: 'c', l: LARGE_B }])]])
        const reader = readerOver(units)

        const keys = await collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], reader)

        expect(sorted(keys)).toEqual(sorted([INDEX_ID, LARGE_A, LARGE_B]))
        expect(reader.reads).toEqual([INDEX_ID])
    })

    test('reproducer: visit receives the index unit once, so a caller scans it without a second read', async () => {
        const units = new Map<string, StoredUnit>([[INDEX_ID, indexUnit([])]])
        const visited: string[] = []

        await collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], readerOver(units), key => { visited.push(key) })

        expect(visited).toEqual([INDEX_ID])
    })

    test.each([
        ['absent', new Map<string, StoredUnit>()],
        ['not JSON', new Map<string, StoredUnit>([[INDEX_ID, { status: 'unparsable' }]])],
        ['not an index (wrong type)', new Map<string, StoredUnit>([[INDEX_ID, { status: 'ok', value: { type: 'something-else', entries: [], trash: [] } }]])],
        ['not an index (no trash list)', new Map<string, StoredUnit>([[INDEX_ID, { status: 'ok', value: { type: 'risu-plugin-storage-index', entries: [] } }]])],
    ])('reproducer: an index unit that is %s rejects, because it hides the large units it names', async (_label, units) => {
        await expect(collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], readerOver(units))).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('reproducer: an index key that cannot name a unit rejects', async () => {
        await expect(collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: '../x' })], readerOver(new Map()))).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('reproducer: with absentIndexKeepsNothing an absent index contributes only its own key and is not visited', async () => {
        const reader = readerOver(new Map())
        const visited: string[] = []

        const keys = await collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], reader, key => { visited.push(key) }, { absentIndexKeepsNothing: true })

        expect(sorted(keys)).toEqual([INDEX_ID])
        expect(visited).toEqual([])
    })

    test('guard: with absentIndexKeepsNothing a present index still contributes the large units it names', async () => {
        const units = new Map<string, StoredUnit>([[INDEX_ID, indexUnit([{ k: 'b', l: LARGE_A }])]])

        const keys = await collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], readerOver(units), undefined, { absentIndexKeepsNothing: true })

        expect(sorted(keys)).toEqual(sorted([INDEX_ID, LARGE_A]))
    })

    test.each([
        ['not JSON', new Map<string, StoredUnit>([[INDEX_ID, { status: 'unparsable' }]]), {}],
        ['not an index (wrong type)', new Map<string, StoredUnit>([[INDEX_ID, { status: 'ok', value: { type: 'something-else', entries: [], trash: [] } }]]), {}],
        ['not an index (no trash list)', new Map<string, StoredUnit>([[INDEX_ID, { status: 'ok', value: { type: 'risu-plugin-storage-index', entries: [] } }]]), {}],
        ['an error status', new Map<string, StoredUnit>(), { errorKeys: new Set([INDEX_ID]) }],
        ['a rejection', new Map<string, StoredUnit>(), { throwKeys: new Set([INDEX_ID]) }],
    ])('guard: with absentIndexKeepsNothing an index that is %s still rejects', async (_label, units, faults) => {
        await expect(collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: INDEX_ID })], readerOver(units, faults), undefined, { absentIndexKeepsNothing: true })).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('guard: with absentIndexKeepsNothing an index key that cannot name a unit still rejects before any read', async () => {
        const reader = readerOver(new Map())

        await expect(collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: '../x' })], reader, undefined, { absentIndexKeepsNothing: true })).rejects.toBeInstanceOf(LegacyReadError)
        expect(reader.reads).toEqual([])
    })

    test.each([['a number', 5], ['null', null], ['an empty string', '']])('guard: a pointer that is %s is ignored, as upstream reads a pointer only when it is a non-empty string', async (_label, pointer) => {
        const reader = readerOver(new Map())

        const keys = await collectLegacyColdKeys([treeWithStorage({ _coldpluginIndex: pointer })], reader)

        expect(keys.size).toBe(0)
        expect(reader.reads).toEqual([])
    })

    test('reproducer: a later tree that points at a key an earlier tree read as an ordinary unit still validates it as an index', async () => {
        const units = new Map<string, StoredUnit>([[INDEX_ID, { status: 'ok', value: { a: 1 } }]])
        const first = { characters: [{ chaId: 'x', coldstorage: INDEX_ID, chats: [] }] } as unknown as Database

        await expect(collectLegacyColdKeys([first, treeWithStorage({ _coldpluginIndex: INDEX_ID })], readerOver(units))).rejects.toBeInstanceOf(LegacyReadError)
    })
})

describe('guard: the walk and the resolver enumerate the same references', () => {
    test.each([...ALL_GOLDENS, 'deep chain'])('%s: every unit the resolver reads is in the walk\'s key set', async (file) => {
        const golden = file === 'deep chain' ? deepChain() : await loadGolden(file)
        const resolverReader = readerOver(golden.units)

        await resolveLegacyTree(golden.tree, resolverReader, { newId: () => 'id', now: () => 1 })
        const walked = await collectLegacyColdKeys([golden.tree], readerOver(golden.units)).catch(() => null)

        // A damaged golden makes the walk reject by design; the resolver's reads are then compared with the roots alone.
        const known = walked ?? new Set(legacyRefsOfDatabase(golden.tree).map(ref => ref.key))
        expect(resolverReader.reads.filter(key => !known.has(key))).toEqual([])
    })

    test.each(ALL_GOLDENS)('%s: the root keys equal the collector\'s own root listing', async (file) => {
        const golden = await loadGolden(file)

        const walkRoots = await collectLegacyColdKeys([golden.tree], readerOver(new Map()))

        expect(sorted(walkRoots)).toEqual(sorted(new Set(listColdBackupRoots(golden.tree).map(root => root.key))))
        expect(sorted(new Set(legacyRefsOfDatabase(golden.tree).map(ref => ref.key)))).toEqual(sorted(walkRoots))
    })

    test('the plugin mapping is part of the enumeration', async () => {
        const golden = await loadGolden('fork-full.bin')

        const kinds = new Set(legacyRefsOfDatabase(golden.tree).map(ref => ref.kind))

        expect(kinds).toEqual(new Set(['stub', 'stubChat', 'chatPointer', 'plugin']))
    })
})
