/**
 * The V3 character, chat and database APIs (`makeRisuaiAPIV3` in
 * `src/ts/plugins/apiV3/v3.svelte.ts`) need the 'db' permission:
 *
 *  - `getCharacter`, `getChar`, `getCharacterFromIndex` and `getChatFromIndex`
 *    resolve `null` when it is denied.
 *  - `setCharacter`, `setChar`, `setCharacterToIndex`, `setChatToIndex`,
 *    `setDatabase` and `setDatabaseLite` reject, naming the permission, and
 *    write nothing when it is denied.
 *  - A gated API reads no live state before its permission settles, so a
 *    refusal that depends on live state (an archived-character placeholder,
 *    the selected character) never pre-empts the permission message.
 *
 * Every setter reproducer calls through `Promise.resolve().then(...)` and
 * checks the state first: a setter that wrote before or without the
 * permission check fails on "unchanged" and not on the harness shape.
 *
 * The V2 plugin API the V3 wrappers delegate to is replaced by a small fake
 * that applies the write, so the fake's write is exactly what a missing or
 * late permission check would let through. The module-mock set comes from
 * `v3PluginPermissions.svelte.test.ts`. Each scenario uses a script no other
 * scenario uses, because the session permission cache is keyed by the script
 * hash.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))

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

vi.mock(import('../../plugins.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    type Slot = { chaId?: string, name?: string }
    const applyDatabase = (newDb: object) => {
        Object.assign(liveDBState.db, newDb)
    }
    return {
        allowedDbKeys: [],
        customProviderStore: writable([] as string[]),
        getV2PluginAPIs: () => ({
            safeLocalStorage: {
                getItem: vi.fn(),
                setItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
                key: vi.fn(),
                keys: vi.fn(),
            },
            getChar: () => structuredClone($state.snapshot(liveDBState.db.characters[0])),
            // Mirrors the V2 `setChar` refusal of a character that is not the selected one.
            setChar: (char: Slot) => {
                const selected = liveDBState.db.characters[0] as Slot
                if (char?.chaId !== undefined && char.chaId !== selected.chaId) {
                    throw new Error('That is not the selected character, so the character was not set. Nothing was written.')
                }
                liveDBState.db.characters[0] = char as never
            },
            setDatabase: async (newDb: object) => applyDatabase(newDb),
            setDatabaseLite: async (newDb: object) => applyDatabase(newDb),
        }),
        handlePluginInstallViaPlugin: vi.fn(),
        pluginV2: {
            providers: new Map(),
            providerOptions: new Map(),
            chatOutput: new Set(),
        },
    } as unknown as typeof import('../../plugins.svelte')
})

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
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
        selectedCharID: writable(0),
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
    alertConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertToast: vi.fn(),
    doingAlert: vi.fn(() => false),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => []),
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
    getInlayAsset: vi.fn(async () => 'asset-data'),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
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

//#region fixtures

type ChatFixture = { id: string, name: string, message: unknown[], note: string, localLore: unknown[] }
type CharacterFixture = {
    chaId: string
    name: string
    type: string
    chats: ChatFixture[]
    chatPage: number
    coldstorage?: string
    oaiTTSConfig?: { apiKey: string }
}

const makeChat = (id: string, name: string): ChatFixture => ({ id, name, message: [], note: '', localLore: [] })

const makeCharacter = (chaId: string, name: string, extra: Partial<CharacterFixture> = {}): CharacterFixture => ({
    chaId,
    name,
    type: 'character',
    chats: [makeChat(`${chaId}-chat`, `${name} chat`)],
    chatPage: 0,
    ...extra,
})

const SECRET = 'sk-card'

function installDb(characters?: CharacterFixture[]): void {
    DBState.db = {
        plugins: [],
        modules: [{ id: 'module-before' }],
        enabledModules: ['module-before'],
        characters: characters ?? [
            makeCharacter('char-0', 'Zero', { oaiTTSConfig: { apiKey: SECRET } }),
            makeCharacter('char-1', 'One'),
        ],
    } as unknown as Database
}

const liveCharacters = () => DBState.db.characters as unknown as CharacterFixture[]

/** Each scenario gets a script no other scenario uses, so no session decision carries over. */
function makeApi(script: string) {
    const plugin: RisuPlugin = {
        name: `gap-plugin-${script}`,
        script,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

type Outcome = { rejected: boolean, message: string | null }

/** Calls inside a microtask, as the sandbox bridge does, and settles the promise into an outcome. */
async function settle(call: () => Promise<unknown>): Promise<Outcome> {
    try {
        await Promise.resolve().then(call)
        return { rejected: false, message: null }
    } catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) }
    }
}

const live = () => ({
    modules: JSON.stringify($state.snapshot(DBState.db.modules)),
    enabledModules: JSON.stringify($state.snapshot(DBState.db.enabledModules)),
    characters: JSON.stringify($state.snapshot(DBState.db.characters)),
})

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    memStore.clear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => false)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installDb()
})

afterEach(() => {
    warnSpy.mockRestore()
})

//#endregion

describe('a denied "db" permission stops the V3 database setters (P1, P2)', () => {
    test.each(['setDatabase', 'setDatabaseLite'] as const)('%s rejects naming the permission and replaces nothing', async (kind) => {
        const api = makeApi(`script-gap-${kind}`)
        const before = live()

        const outcome = await settle(() => api[kind]({ modules: [{ id: 'module-after' }], enabledModules: ['module-after'] }))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
    })
})

describe('a denied "db" permission stops the V3 character and chat getters (P3, P4, P6, P6b)', () => {
    test('getCharacter and getChar resolve null and return no character data', async () => {
        const api = makeApi('script-gap-get-selected')
        const viaCharacter = await api.getCharacter()
        const viaChar = await api.getChar()
        expect(viaCharacter).toBeNull()
        expect(viaChar).toBeNull()
    })

    test('getCharacterFromIndex resolves null instead of the character', async () => {
        const api = makeApi('script-gap-get-index')
        const result = await api.getCharacterFromIndex(0)
        expect(result).toBeNull()
        expect(JSON.stringify(result)).not.toContain(SECRET)
    })

    test('getChatFromIndex resolves null instead of the chat', async () => {
        const api = makeApi('script-gap-get-chat')
        const result = await api.getChatFromIndex(0, 0)
        expect(result).toBeNull()
    })

    test('guard: a granted getCharacterFromIndex returns the character', async () => {
        alertConfirmMock.mockImplementation(async () => true)
        const api = makeApi('script-gap-get-granted')
        const result = await api.getCharacterFromIndex(0) as CharacterFixture
        expect(result.chaId).toBe('char-0')
    })
})

describe('a denied "db" permission stops the V3 character and chat setters (P5, P5b, P6c, P6d)', () => {
    test('setCharacterToIndex rejects naming the permission and leaves the slot', async () => {
        const api = makeApi('script-gap-set-index')
        const before = live()

        const outcome = await settle(() => api.setCharacterToIndex(1, makeCharacter('char-1', 'Overwritten')))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
    })

    test('setChatToIndex rejects naming the permission and leaves the chat', async () => {
        const api = makeApi('script-gap-set-chat')
        const before = live()

        const outcome = await settle(() => api.setChatToIndex(0, 0, makeChat('char-0-chat', 'Overwritten chat')))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
    })

    test.each(['setChar', 'setCharacter'] as const)('%s rejects naming the permission and leaves the character', async (kind) => {
        const api = makeApi(`script-gap-set-${kind}`)
        const before = live()

        const outcome = await settle(() => api[kind](makeCharacter('char-0', 'Overwritten')))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
    })

    test('guard: granted setters write and resolve', async () => {
        alertConfirmMock.mockImplementation(async () => true)
        const api = makeApi('script-gap-set-granted')

        await expect(api.setCharacterToIndex(1, makeCharacter('char-1', 'Written'))).resolves.toBeUndefined()
        await expect(api.setChar(makeCharacter('char-0', 'Written zero'))).resolves.toBeUndefined()

        expect(liveCharacters()[1].name).toBe('Written')
        expect(liveCharacters()[0].name).toBe('Written zero')
    })
})

describe('the permission settles before any live state decides the outcome (P14)', () => {
    test('setChar with a character that is not the selected one rejects with the permission message', async () => {
        const api = makeApi('script-gap-order-mismatch')
        const before = live()

        const outcome = await settle(() => api.setChar(makeCharacter('char-1', 'Not selected')))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
        expect(outcome.message).not.toMatch(/not the selected character/i)
    })

    test('setChar with an archived-character placeholder over a full character rejects with the permission message and logs no refusal', async () => {
        const api = makeApi('script-gap-order-placeholder')
        const before = live()
        const placeholder = makeCharacter('char-0', 'Zero', { coldstorage: 'unit-char-0' })

        const outcome = await settle(() => api.setChar(placeholder))

        expect(live()).toEqual(before)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
        expect(outcome.message).not.toMatch(/archived-character placeholder/i)
        expect(warnSpy.mock.calls.flat().some((arg) => typeof arg === 'string' && arg.includes('char-0'))).toBe(false)
    })

    test('guard: once granted, the same placeholder is refused as a placeholder', async () => {
        alertConfirmMock.mockImplementation(async () => true)
        const api = makeApi('script-gap-order-granted')
        const placeholder = makeCharacter('char-0', 'Zero', { coldstorage: 'unit-char-0' })

        const outcome = await settle(() => api.setChar(placeholder))

        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toMatch(/archived-character placeholder/i)
    })
})
