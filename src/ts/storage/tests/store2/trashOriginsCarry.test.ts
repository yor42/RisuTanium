import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks for the legacy RisuSave encoder (the set of risuSave.test.ts)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { assembleDatabase, checkUnit, unitMapSource } from 'src/ts/storage/store2/codec'
import { UNIT_TYPE } from 'src/ts/storage/store2/format'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { asDatabase, buildSmall, encodeWith, type Obj } from './codecFixtures'

/**
 * `trashOrigins` is a config-root field of the profile (UI-S4 stage E1). It is in neither `CONFIG_PARTITIONED_FIELDS`
 * nor the legacy encoder's leave-out list, so the store2 config unit and the legacy root block both carry it with no
 * schema change. Guards: all pass with and without the `Database` interface field, and a record of any shape rides
 * through unchanged.
 */

const ORIGINS = [
    { chaId: 'c1', t: 1_700_000_000_000, folder: 'f1', after: { char: 'a' } },
    { chaId: 'c2', t: 1_700_000_000_001 },
    { chaId: 'c3', t: 1_700_000_000_002, after: { folder: 'f2' }, futureField: [1, 2] },
    { foo: 1 },
]

function withOrigins(trashOrigins: unknown) {
    return asDatabase({ ...(JSON.parse(JSON.stringify(buildSmall(2))) as Obj), trashOrigins })
}

describe('trashOrigins in the store2 config unit', () => {
    test('guard: the decoded config body holds the array as it was set', () => {
        const tree = encodeWith(withOrigins(ORIGINS))
        const checked = checkUnit(unitMapSource(tree.units), tree.manifest.fixed.config, UNIT_TYPE.configRoot)
        expect(checked.status).toBe('ok')
        const fields = (checked as unknown as { body: { f: Record<string, unknown> } }).body.f
        expect(fields.trashOrigins).toEqual(ORIGINS)
    })

    test('guard: encode and assemble return the array', () => {
        const tree = encodeWith(withOrigins(ORIGINS))
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Record<string, unknown>
        expect(assembled.trashOrigins).toEqual(ORIGINS)
    })

    test('guard: an empty array and a value that is not an array both come back as they were set', () => {
        for (const value of [[], {}, 'x', 5]) {
            const tree = encodeWith(withOrigins(value))
            const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Record<string, unknown>
            expect(assembled.trashOrigins).toEqual(value)
        }
    })

    test('guard: a database without the field assembles without it', () => {
        const tree = encodeWith(buildSmall(2))
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Record<string, unknown>
        expect('trashOrigins' in assembled).toBe(false)
    })
})

describe('trashOrigins through the legacy RisuSave root block', () => {
    function legacyDb(extra: Obj = {}): Database {
        return {
            formatversion: 5, botPresets: [], botPresetsId: 0, modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
            characters: [{ chaId: 'char1', type: 'character', name: 'Test Character', chats: [] }],
            ...extra,
        } as unknown as Database
    }

    test('guard: a full encode and decode keep the array', async () => {
        const encoder = new RisuSaveEncoder()
        await encoder.init(legacyDb({ trashOrigins: ORIGINS }))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!)) as unknown as Record<string, unknown>
        expect(decoded.trashOrigins).toEqual(ORIGINS)
    })

    test('guard: a pass that marks nothing still writes a changed array, because the root is rewritten on every pass', async () => {
        const db = legacyDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        const before = await decodeRisuSave(new Uint8Array(encoder.encode()!)) as unknown as Record<string, unknown>
        expect('trashOrigins' in before).toBe(false)

        ;(db as unknown as Obj).trashOrigins = ORIGINS
        await encoder.set(db, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        const after = await decodeRisuSave(new Uint8Array(encoder.encode()!)) as unknown as Record<string, unknown>

        expect(after.trashOrigins).toEqual(ORIGINS)
    })
})
