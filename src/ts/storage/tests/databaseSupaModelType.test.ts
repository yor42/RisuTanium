// @vitest-environment happy-dom

/**
 * Legacy summariser model values in a loaded database. The settings page and
 * the summariser request only know `distilbart`, `instruct35` and `subModel`;
 * a saved `davinci` or `curie` selects a legacy completion model, so loading
 * must map them to `instruct35` and leave every other value alone.
 *
 * This drives the REAL `setDatabase`/`getDatabase`
 * (`src/ts/storage/database.svelte.ts`) with the module mocks of
 * `databaseAccountField.test.ts`, none of them touching `supaModelType`.
 */

import { describe, expect, test, vi } from 'vitest'

//#region module mocks

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

function loadWith(supaModelType: string | undefined): string {
    setDatabase({ supaModelType, pluginCustomStorage: {} } as unknown as Database)
    return getDatabase().supaModelType
}

describe('setDatabase summariser model migration', () => {
    test.each(['distilbart', 'instruct35', 'subModel', 'none'])('guard: %s is kept as saved', (value) => {
        expect(loadWith(value)).toBe(value)
    })

    test('guard: a missing value defaults to none', () => {
        expect(loadWith(undefined)).toBe('none')
    })

    // regression reproducer: CHORE-10 SUPA-5, MC-712 7
    test.fails.each(['davinci', 'curie'])('a saved %s loads as instruct35', (value) => {
        expect(loadWith(value)).toBe('instruct35')
    })
})
