/**
 * V3 `getArg` and `setArg` reach only the calling plugin's own arguments: the
 * name before `::` must be the plugin's own name, otherwise the call throws and
 * no other plugin's `realArg` is read or changed (the fork's difference from
 * upstream; see `plugins.md`).
 *
 * Drives the REAL `makeRisuaiAPIV3` over the REAL `plugins.svelte.ts` (whose
 * `getArg` and `setArg` the V3 wrappers delegate to) and a real reactive
 * `DBState.db`. The module-mock set is the one `v3IdentityFill.svelte.test.ts`
 * uses to load both real modules side by side.
 *
 * Title labels: (R) marks a reproducer that fails against the V3 API handing
 * out the V2 functions directly; (G) marks a guard that passes with or without
 * the restriction.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'

//#region module mocks, as in v3IdentityFill.svelte.test.ts

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    setDatabaseLite: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../../storage/database.svelte'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    ;(globalThis as unknown as { __testDBState: { db: Database } }).__testDBState = state
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    sleep: vi.fn(async () => {}),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFetchLogs: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
}) as unknown as typeof import('../../../globalApi.svelte'))

vi.mock(import('../../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../../gui/colorscheme'))

vi.mock(import('../../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../../parser/parser.svelte'))

vi.mock(import('../../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../../model/modellist'))

vi.mock(import('../../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../../process/request/request'))

vi.mock(import('../../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState } from '../../../stores.svelte'

type PluginEntry = { name: string, script: string, realArg: Record<string, string | number> }

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [
            { name: 'A', script: '', realArg: { k: 'a-value' } },
            { name: 'B', script: '', realArg: { k: 'b-value' } },
        ],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [],
    } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

const pluginArgs = (name: string) =>
    (DBState.db.plugins as unknown as PluginEntry[]).find((p) => p.name === name)!.realArg

const apiFor = (name: string) => makeRisuaiAPIV3({} as HTMLIFrameElement, { name, script: '' } as never)

beforeEach(() => {
    installDb()
})

describe('V3 getArg and setArg reach only the calling plugin\'s own arguments', () => {
    test('(G) getArg of the plugin\'s own argument returns its value', () => {
        expect(apiFor('A').getArg('A::k')).toBe('a-value')
    })

    test('(G) setArg of the plugin\'s own argument writes it and leaves the other plugin alone', () => {
        apiFor('A').setArg('A::k', 'changed')
        expect(pluginArgs('A').k).toBe('changed')
        expect(pluginArgs('B').k).toBe('b-value')
    })

    test('(R) getArg of another plugin\'s argument throws and names getArgument', () => {
        expect(() => apiFor('A').getArg('B::k')).toThrow(/only its own arguments.*getArgument/i)
    })

    test('(R) setArg of another plugin\'s argument throws, names setArgument and changes nothing', () => {
        expect(() => apiFor('A').setArg('B::k', 'x')).toThrow(/only its own arguments.*setArgument/i)
        expect(pluginArgs('B').k).toBe('b-value')
        expect(pluginArgs('A').k).toBe('a-value')
    })

    test('(R) a key with no :: throws for both calls and changes nothing', () => {
        expect(() => apiFor('A').getArg('k')).toThrow(/only its own arguments/i)
        expect(() => apiFor('A').setArg('k', 'x')).toThrow(/only its own arguments/i)
        expect(pluginArgs('A').k).toBe('a-value')
        expect(pluginArgs('B').k).toBe('b-value')
    })

    test('(R) a name that only starts with the plugin\'s own name is another plugin', () => {
        ;(DBState.db.plugins as unknown as PluginEntry[]).push({ name: 'AB', script: '', realArg: { k: 'ab-value' } })
        expect(() => apiFor('A').getArg('AB::k')).toThrow()
        expect(() => apiFor('A').setArg('AB::k', 'x')).toThrow()
        expect(pluginArgs('AB').k).toBe('ab-value')
    })
})
