/**
 * V3 `setCharacterToIndex` refuses an object that is not a character and an id
 * that cannot be saved, and keeps accepting a write that carries back the id
 * the slot already holds (the fork's difference from upstream; see
 * `plugins.md`). The V3 `setChar`, `setCharacter` and `setDatabase` calls pass
 * through the V2 setters, which `pluginCharacterIdSetters.svelte.test.ts`
 * drives.
 *
 * Drives the REAL `src/ts/plugins/apiV3/v3.svelte.ts` over a real reactive
 * `DBState.db`. The module-mock set is the one `v3SaveMarks.svelte.test.ts`
 * uses to load the otherwise very heavy `v3.svelte.ts`.
 *
 * Title labels: (R) marks a reproducer that fails against a setter with no
 * check; (G) marks a guard that passes with or without it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'

//#region module mocks, as in v3SaveMarks.svelte.test.ts

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
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: new Set() },
}) as unknown as typeof import('../../plugins.svelte'))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../../storage/database.svelte'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
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
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFetchLogs: vi.fn(),
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

type Entry = Record<string, unknown>

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: 'test-plugin', script: '' }],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [
            { chaId: 'a', name: 'A', type: 'character', chats: [] },
            { chaId: 'b', name: 'B', type: 'character', chats: [] },
        ],
    } as unknown as Database
}

const live = () => DBState.db.characters as unknown as Entry[]

const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, { name: 'test-plugin' } as never)

beforeEach(() => {
    installDb()
})

describe('V3 setCharacterToIndex (S11, S20)', () => {
    test.each([
        ['a number', 5],
        ['null', null],
        ['a list', []],
        ['an id that is a block name', { chaId: 'preset', name: 'x', type: 'character', chats: [] }],
        ['an id of 300 characters', { chaId: 'x'.repeat(300), name: 'x', type: 'character', chats: [] }],
        ['an id that is a Symbol', { chaId: Symbol('id'), name: 'x', type: 'character', chats: [] }],
    ])('(R) rejects %s and leaves the slot as it was', (_label, bad) => {
        expect(() => api().setCharacterToIndex(1, bad)).toThrow()
        expect(live()[1].chaId).toBe('b')
        expect(live()[1].name).toBe('B')
    })

    test('(G) accepts a well-formed replacement, a missing id (filled) and a numeric id', () => {
        api().setCharacterToIndex(1, { chaId: 'b', name: 'B edited', type: 'character', chats: [] })
        expect(live()[1].name).toBe('B edited')
        api().setCharacterToIndex(0, { name: 'No id', type: 'character', chats: [] })
        expect(typeof live()[0].chaId).toBe('string')
        expect(live()[0].chaId).not.toBe('')
        api().setCharacterToIndex(1, { chaId: 7, name: 'Seven', type: 'character', chats: [] })
        expect(live()[1].chaId).toBe(7)
    })

    test('(G) while the slot holds an id that cannot be saved, a write carrying that id back is accepted', () => {
        live()[1].chaId = 'config'
        expect(() => api().setCharacterToIndex(1, { chaId: 'config', name: 'B edited', type: 'character', chats: [] })).not.toThrow()
        expect(live()[1].name).toBe('B edited')
    })

    test('(R) that id cannot be moved onto another slot, and another unusable id is refused', () => {
        live()[1].chaId = 'config'
        expect(() => api().setCharacterToIndex(0, { chaId: 'config', name: 'A renamed', type: 'character', chats: [] })).toThrow()
        expect(() => api().setCharacterToIndex(1, { chaId: 'preset', name: 'B renamed', type: 'character', chats: [] })).toThrow()
        expect(live()[0].chaId).toBe('a')
        expect(live()[1].chaId).toBe('config')
    })
})
