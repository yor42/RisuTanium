/**
 * V3 `setCharacterToIndex` keeps the live retained-paths field, as it keeps the live alternatives: a plugin holds a
 * copy of the character taken at read time, so its copy can lack the field or hold an older value, and the write must
 * not make the live character forget a file its history can still restore. The V3 `setChar` and `setDatabase` paths
 * pass through the V2 setters, which the plugin setter tests drive.
 *
 * Drives the REAL `src/ts/plugins/apiV3/v3.svelte.ts` over a real reactive `DBState.db`. The module-mock set is the one
 * `v3CharacterIdSetters.svelte.test.ts` uses to load the otherwise very heavy `v3.svelte.ts`.
 *
 * Feature guards: the carry did not exist before; each test fails against a setter that skips it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'

//#region module mocks, as in v3CharacterIdSetters.svelte.test.ts

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the character and database APIs
                // from prompting; every other key is absent.
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                    if (key.endsWith('_dbWrite_lastGrantTime')) return Date.now()
                    if (key.endsWith('_dbWrite')) return true
                }
                return null
            }),
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
        alertStore: writable({ type: 'none', msg: '' }),
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
    alertToast: vi.fn(),
    doingAlert: vi.fn(() => false),
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
import { resetIdlessCopyNoticeForTest } from '../../idlessCopyNotice'
import { ASSET_RETAINED_KEY } from '../../../studio/assets/assetOwnerKeys'

afterEach(() => {
    resetIdlessCopyNoticeForTest()
})

type Entry = Record<string, unknown>

const LIVE = [['x', 'assets/K.png'], ['y', 'assets/Y.png']]
const STALE = [['x', 'assets/K.png']]
const FOREIGN = [['z', 'assets/Z.png']]

function installDb(liveRetained: unknown): void {
    const slot: Entry = { chaId: 'a', name: 'A', type: 'character', chats: [] }
    if (liveRetained !== undefined) {
        slot[ASSET_RETAINED_KEY] = liveRetained
    }
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: 'test-plugin', script: '' }],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [slot, { chaId: 'b', name: 'B', type: 'character', chats: [] }],
    } as unknown as Database
}

const live = () => DBState.db.characters as unknown as Entry[]

const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, { name: 'test-plugin' } as never)

function pluginCopy(id: string, retained: unknown): Entry {
    const copy: Entry = { chaId: id, name: 'edited', type: 'character', chats: [] }
    if (retained !== undefined) {
        copy[ASSET_RETAINED_KEY] = retained
    }
    return copy
}

beforeEach(() => {
    installDb(LIVE)
})

describe('V3 setCharacterToIndex carries the live retained list', () => {
    test('a plugin copy without the field leaves the slot holding the live list', async () => {
        await api().setCharacterToIndex(0, pluginCopy('a', undefined))
        expect(live()[0].name).toBe('edited')
        expect(live()[0][ASSET_RETAINED_KEY]).toEqual(LIVE)
    })

    test('a stale plugin copy loses to the live list, which still holds the file added after the copy was read', async () => {
        await api().setCharacterToIndex(0, pluginCopy('a', STALE))
        expect(live()[0].name).toBe('edited')
        expect(live()[0][ASSET_RETAINED_KEY]).toEqual(LIVE)
    })

    test('when the live slot has no list, a list on the plugin copy is removed', async () => {
        installDb(undefined)
        await api().setCharacterToIndex(0, pluginCopy('a', FOREIGN))
        expect(live()[0].name).toBe('edited')
        expect(Object.hasOwn(live()[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('a plugin copy with another id continues no live character and keeps its own value', async () => {
        await api().setCharacterToIndex(0, pluginCopy('fresh', FOREIGN))
        expect(live()[0].chaId).toBe('fresh')
        expect(live()[0][ASSET_RETAINED_KEY]).toEqual(FOREIGN)
    })
})
