/**
 * A plugin setter (`setCharacterToIndex`, or `setChar` / `setCharacter` through
 * `getV2PluginAPIs().setChar`) that writes an id-less copy over a character that
 * has an id still gives the copy a fresh id, and now tells the user once: one
 * toast per plugin burst naming the plugin and the written copy. A plugin that
 * keeps editing a copy this path minted is not announced again, and the toast
 * waits while another alert, or a wait notice, is on screen.
 *
 * Driven through the real `makeRisuaiAPIV3` and the real `plugins.svelte.ts`
 * (mock set copied from v3IdentityFill.svelte.test.ts), with fake timers for the
 * burst and flush timers.
 *
 * Title labels: (R) marks a reproducer that fails against setters that raise no
 * notice; (G) marks a guard that passes with or without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'

//#region module mocks -- the set v3IdentityFill.svelte.test.ts uses

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                }
                return memStore.get(key) ?? null
            }),
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
        alertStore: writable({ type: 'none', msg: '' }),
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
import { DBState, selectedCharID, alertStore } from '../../../stores.svelte'
import { alertToast, doingAlert } from '../../../alert'
import { resetIdlessCopyNoticeForTest } from '../../idlessCopyNotice'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string | undefined, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{
            id: `${name}-chat-0`,
            message: [{ role: 'user', data: name, time: 1 }],
            note: '',
            name: `${name} chat 0`,
            localLore: [],
        }],
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: 'test-plugin', script: '' }],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1', 'char-2'],
        characters: [
            makeCharacter('char-0', 'Character Zero'),
            makeCharacter('char-1', 'Character One'),
            makeCharacter('char-2', 'Character Two'),
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function makeApi(pluginName = 'test-plugin') {
    return makeRisuaiAPIV3({} as HTMLIFrameElement, { name: pluginName } as never)
}

async function idlessClone(api: ReturnType<typeof makeApi>, index: number): Promise<CharacterFixture> {
    const clone = await api.getCharacterFromIndex(index) as CharacterFixture
    delete (clone as { chaId?: string }).chaId
    return clone
}

function toasts(): string[] {
    return vi.mocked(alertToast).mock.calls.map((call) => call[0])
}

//#endregion

beforeEach(() => {
    vi.useFakeTimers()
    resetIdlessCopyNoticeForTest()
    vi.mocked(alertToast).mockClear()
    vi.mocked(doingAlert).mockReset()
    vi.mocked(doingAlert).mockReturnValue(false)
    alertStore.set({ type: 'none', msg: '' })
    installDb()
})

afterEach(() => {
    resetIdlessCopyNoticeForTest()
    vi.useRealTimers()
})

describe('an id-less copy written over a character with an id raises one notice', () => {
    test('(R) setCharacterToIndex names the plugin and the written copy, not the replaced character', async () => {
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Replacement'))
        expect(toasts()).toHaveLength(0)
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
        expect(toasts()[0]).toContain('"test-plugin"')
        expect(toasts()[0]).toContain('"Replacement"')
        expect(toasts()[0]).not.toContain('Character One')
    })

    test('(R) setChar over the selected character raises the notice too', async () => {
        selectedCharID.set(1)
        const api = makeApi()
        await api.setChar(makeCharacter(undefined, 'Replacement'))
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
        expect(toasts()[0]).toContain('"test-plugin"')
        expect(toasts()[0]).toContain('"Replacement"')
    })

    test('(R) a swap whose halves are both id-less gives one notice naming both copies', async () => {
        const api = makeApi()
        const zero = await idlessClone(api, 0)
        const one = await idlessClone(api, 1)
        await api.setCharacterToIndex(0, one)
        await api.setCharacterToIndex(1, zero)
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
        expect(toasts()[0]).toContain('"Character One"')
        expect(toasts()[0]).toContain('"Character Zero"')
    })

    test('(R) a three-way rotation of id-less copies gives one notice', async () => {
        const api = makeApi()
        const zero = await idlessClone(api, 0)
        const one = await idlessClone(api, 1)
        const two = await idlessClone(api, 2)
        await api.setCharacterToIndex(0, one)
        await api.setCharacterToIndex(1, two)
        await api.setCharacterToIndex(2, zero)
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
    })

    test('(R) a plugin that keeps replacing the copy it just wrote is announced once', async () => {
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'First'))
        vi.advanceTimersByTime(3000)
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Second'))
        vi.advanceTimersByTime(6000)
        expect(toasts()).toHaveLength(1)
    })

    test('(R) an id this path did not mint is announced even after the plugin wrote that id explicitly', async () => {
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter('k', 'Keeper'))
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Copy'))
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
        expect(toasts()[0]).toContain('"Copy"')
    })
})

describe('no notice when nothing was replaced by an id-less copy', () => {
    test('(G) a reinstall that carries its own chaId raises none', async () => {
        const api = makeApi()
        const clone = await api.getCharacterFromIndex(1) as CharacterFixture
        await api.setCharacterToIndex(1, clone)
        vi.advanceTimersByTime(6000)
        expect(toasts()).toHaveLength(0)
    })

    test('(G) an id-less copy over a slot that has no id raises none', async () => {
        DBState.db.characters[1] = makeCharacter(undefined, 'No Id Yet')
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Replacement'))
        vi.advanceTimersByTime(6000)
        expect(toasts()).toHaveLength(0)
    })

    test('(G) refused writes raise none', async () => {
        const api = makeApi()
        selectedCharID.set(-1)
        await expect(api.setChar(makeCharacter(undefined, 'Replacement'))).rejects.toThrow()
        selectedCharID.set(1)
        // A value that is not a character has no chaId, so it counts as id-less; only the refusal keeps it silent.
        await expect(api.setChar(5)).rejects.toThrow()
        await expect(api.setCharacterToIndex(1, 5)).rejects.toThrow()
        await expect(api.setCharacterToIndex(1, { chaId: 'preset', name: 'x', type: 'character', chats: [] })).rejects.toThrow()
        vi.advanceTimersByTime(6000)
        expect(toasts()).toHaveLength(0)
    })

    test('(G) an explicit duplicate of another slot\'s id raises none', async () => {
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter('char-0', 'Duplicate'))
        vi.advanceTimersByTime(6000)
        expect(toasts()).toHaveLength(0)
    })
})

describe('the notice waits while another alert is open', () => {
    test('(R) an open alert holds the toast back until it closes', async () => {
        vi.mocked(doingAlert).mockReturnValue(true)
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Replacement'))
        vi.advanceTimersByTime(5000)
        expect(toasts()).toHaveLength(0)
        vi.mocked(doingAlert).mockReturnValue(false)
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
    })

    test('(R) a wait notice holds the toast back until it closes', async () => {
        alertStore.set({ type: 'wait', msg: 'working' })
        const api = makeApi()
        await api.setCharacterToIndex(1, makeCharacter(undefined, 'Replacement'))
        vi.advanceTimersByTime(5000)
        expect(toasts()).toHaveLength(0)
        alertStore.set({ type: 'none', msg: '' })
        vi.advanceTimersByTime(1000)
        expect(toasts()).toHaveLength(1)
    })
})
