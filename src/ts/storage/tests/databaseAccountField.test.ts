// @vitest-environment happy-dom

/**
 * `db.account` carries an upstream RisuAccount token (MC-080). Once loaded,
 * nothing in this fork may keep it: `setDatabase` must drop any `account` an
 * incoming database carries, so neither a later `getDatabase()` read nor a
 * `database.bin` encode/decode round trip can hand it back out.
 *
 * This drives the REAL `setDatabase`/`getDatabase` (`src/ts/storage/database.svelte.ts`)
 * and the REAL `RisuSaveEncoder`/`decodeRisuSave` (`src/ts/storage/risuSave.ts`) --
 * the same encoder `saveDb()` uses for `database.bin` -- against a real
 * `Database` fixture. Every other direct import of those two modules is
 * mocked below, none of them account-related, so the account-dropping
 * behaviour under test is never itself faked away.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks -- every OTHER direct import of database.svelte.ts and
// risuSave.ts, none of them touching `account`.

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => {}),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

// `database.svelte.ts` imports `DBState`/`selectedCharID` from the real,
// Svelte-runed `stores.svelte.ts`, which pulls in the whole plugin/module
// update graph. A plain mutable object is enough for `setDatabaseLite`'s
// `DBState.db = data` assignment and `getDatabase()`'s `DBState.db` read --
// no component reactivity is exercised here.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

// `database.svelte.ts` imports the LLMFormat/LLMFlags/LLMTokenizer enums
// from `model/modellist.ts`, which itself pulls in the whole provider list
// and plugin system. The enums themselves are defined in the much lighter
// `model/types.ts` (a type-only import chain), so this mock re-exports the
// real enum values from there instead of faking them.
vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { setDatabase, getDatabase, type Database } from 'src/ts/storage/database.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { RisuSaveEncoder } from 'src/ts/storage/tests/risuSaveEncoder'

/**
 * A minimal fixture carrying an upstream `account` block, shaped like
 * upstream's `account` field (`src/ts/storage/database.svelte.ts`).
 * `setDatabase` fills in every other required field via its own defaulting,
 * so nothing else needs to be supplied here.
 */
function makeFixtureWithAccount(): Database {
    return {
        account: {
            token: 'upstream-secret-token',
            id: 'upstream-user-id',
            data: { refresh_token: 'rt', access_token: 'at', expires_in: 3600 },
            useSync: true,
            kei: true,
        },
        // Not part of the account-field contract under test; supplied only so
        // the encode/decode round trip below has no other block to complain
        // about.
        pluginCustomStorage: {},
    } as unknown as Database
}

beforeEach(() => {
    localStorage.clear()
})

describe('setDatabase drops db.account (I4)', () => {
    test('getDatabase() has no own "account" property after loading a database that carried one', () => {
        setDatabase(makeFixtureWithAccount())

        const db = getDatabase()
        expect(Object.prototype.hasOwnProperty.call(db, 'account')).toBe(false)
        expect((db as unknown as { account?: unknown }).account).toBeUndefined()
    })

    test('a decoded encode of the post-load database carries no account field either', async () => {
        setDatabase(makeFixtureWithAccount())
        const db = getDatabase({ snapshot: true })

        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        expect(Object.prototype.hasOwnProperty.call(decoded, 'account')).toBe(false)
        expect((decoded as unknown as { account?: unknown }).account).toBeUndefined()
    })
})
