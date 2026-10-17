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
import { ALL_GOLDENS, DEEP, deepChain, ID, loadGolden, readerOver, type StoredUnit } from './legacyFixtures'

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
