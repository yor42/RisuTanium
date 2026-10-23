// @vitest-environment happy-dom

/**
 * The internal `setDatabase` and `setDatabaseLite` (boot, restore, import) never apply the empty-chat
 * rule: a loaded chat with no messages keeps its SupaMemory data and covered-ID field. The rule lives
 * only at the plugin write sites and the explicit removal sites (MC-721 1, MC-722 2; no memory-time or
 * load-time clearing).
 *
 * Test kind: guard (passes before and after the change); it fails the mutant that puts the rule into
 * the internal `setDatabase`.
 *
 * This drives the REAL `setDatabase`/`setDatabaseLite` with the module mocks of
 * `databaseSupaModelType.test.ts`.
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

import { setDatabase, setDatabaseLite, getDatabase, type Database } from 'src/ts/storage/database.svelte'

function emptyChatDb(supaMemoryData: string): Database {
    return {
        pluginCustomStorage: {},
        characters: [{
            chaId: 'a',
            name: 'A',
            type: 'character',
            chats: [{ id: 'chat-a', message: [], supaMemoryData, supaMemoryCoveredId: 'm1' }],
        }],
    } as unknown as Database
}

const chatOf = () => (getDatabase().characters[0] as unknown as { chats: Record<string, unknown>[] }).chats[0]

describe('internal database writes keep an empty chat\'s SupaMemory data', () => {
    test.each(['m1\nold summary text', 'hypa:m1\nold summary text'])('guard: setDatabase keeps %j', (data) => {
        setDatabase(emptyChatDb(data))
        expect(chatOf().supaMemoryData).toBe(data)
        expect(chatOf().supaMemoryCoveredId).toBe('m1')
    })

    test.each(['m1\nold summary text', 'hypa:m1\nold summary text'])('guard: setDatabaseLite keeps %j', (data) => {
        setDatabaseLite(emptyChatDb(data))
        expect(chatOf().supaMemoryData).toBe(data)
        expect(chatOf().supaMemoryCoveredId).toBe('m1')
    })
})
