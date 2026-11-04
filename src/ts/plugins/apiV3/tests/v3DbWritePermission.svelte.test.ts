// @vitest-environment jsdom

/**
 * The V3 database, character and chat setters (`makeRisuaiAPIV3` in
 * `src/ts/plugins/apiV3/v3.svelte.ts`) need two consents, asked in this order:
 *
 *  - 'db', then 'dbWrite'. A denied setter rejects with an Error naming the
 *    permission that was refused and writes nothing; 'dbWrite' is never asked
 *    when 'db' was refused. The getters ask for 'db' only.
 *  - Both are re-asked when no grant from the last 3 days is stored, through
 *    the setters and through `requestPluginPermission` alike; one answer
 *    reaches every caller that waits for it.
 *  - `requestPluginPermission('dbWrite')` prompts with the dbWrite text.
 *
 * Labels: R = regression reproducer (fails on the code without the dbWrite
 * consent), G = compatibility guard (passes before and after), P = post-change
 * check. The module-mock set comes from `v3PermissionGaps.svelte.test.ts`, with
 * a memStore-backed permission store so a stored grant and its time can be
 * seeded. The prompt mock answers by text: the 'db' text gets the 'db' answer,
 * any other text gets the 'dbWrite' answer. Every scenario uses a script no
 * other scenario uses, because the session permission cache is keyed by the
 * script hash.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import type { Database } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_text: string) => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
/** The API objects handed to the sandbox host, so a test can unload the plugin that owns one. */
const hostedApis = vi.hoisted(() => [] as unknown[])

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
    SandboxHost: class {
        constructor(api: unknown) {
            hostedApis.push(api)
        }
        run() {}
        terminate() {}
    },
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

import { makeRisuaiAPIV3, executePluginV3, loadV3Plugins } from '../v3.svelte'
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

function installDb(): void {
    DBState.db = {
        plugins: [],
        modules: [{ id: 'module-before' }],
        enabledModules: ['module-before'],
        characters: [makeCharacter('char-0', 'Zero'), makeCharacter('char-1', 'One')],
    } as unknown as Database
}

const liveCharacters = () => DBState.db.characters as unknown as CharacterFixture[]

const live = () => ({
    modules: JSON.stringify($state.snapshot(DBState.db.modules)),
    enabledModules: JSON.stringify($state.snapshot(DBState.db.enabledModules)),
    characters: JSON.stringify($state.snapshot(DBState.db.characters)),
})

const pluginNameOf = (script: string) => `dbw-plugin-${script}`

function makePlugin(script: string): RisuPlugin {
    return {
        name: pluginNameOf(script),
        script,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeApi(script: string) {
    return makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin(script))
}

type Api = ReturnType<typeof makeApi>

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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Stores a grant as an earlier session left it: the grant under the script
 * hash, and when `ageMs` is given its time under the plugin NAME.
 */
async function seedStoredGrant(script: string, permission: 'db' | 'dbWrite', ageMs: number): Promise<void> {
    const scriptHash = await hasherMock(new TextEncoder().encode(script))
    memStore.set(`${scriptHash}_${permission}`, true)
    memStore.set(`${pluginNameOf(script)}_${permission}_lastGrantTime`, Date.now() - ageMs)
}

const dbPromptText = (script: string) => language.getFullDatabaseConsent.replace('{}', pluginNameOf(script))
const dbWritePromptText = (script: string) => language.dbWriteConsent.replace('{}', pluginNameOf(script))

/** The user's answers, by permission; a 'dbWrite' prompt waits for `heldDbWrite` when a test holds it. */
const answers = { db: true, dbWrite: true }
let heldDbWrite: Promise<boolean> | null = null

function holdDbWritePrompt(): { answer: (granted: boolean) => void } {
    let release: (granted: boolean) => void = () => {}
    heldDbWrite = new Promise<boolean>((resolve) => { release = resolve })
    return { answer: (granted) => release(granted) }
}

/** Lets every request that can reach its confirm do so. */
const letRequestsReachTheirConfirm = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

const promptTexts = () => alertConfirmMock.mock.calls.map((call) => call[0])

const databaseUpdate = { modules: [{ id: 'module-after' }], enabledModules: ['module-after'] }

/** One call per setter, each with a write that changes the live state. */
const setters: Array<[string, (api: Api) => Promise<unknown>]> = [
    ['setDatabase', (api) => api.setDatabase(databaseUpdate)],
    ['setDatabaseLite', (api) => api.setDatabaseLite(databaseUpdate)],
    ['setChar', (api) => api.setChar(makeCharacter('char-0', 'Overwritten'))],
    ['setCharacter', (api) => api.setCharacter(makeCharacter('char-0', 'Overwritten'))],
    ['setCharacterToIndex', (api) => api.setCharacterToIndex(1, makeCharacter('char-1', 'Overwritten'))],
    ['setChatToIndex', (api) => api.setChatToIndex(0, 0, makeChat('char-0-chat', 'Overwritten chat'))],
]

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    memStore.clear()
    hostedApis.length = 0
    answers.db = true
    answers.dbWrite = true
    heldDbWrite = null
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async (text) => {
        const [dbPrefix, dbSuffix] = language.getFullDatabaseConsent.split('{}')
        if (text.startsWith(dbPrefix) && text.endsWith(dbSuffix)) {
            return answers.db
        }
        return heldDbWrite ?? answers.dbWrite
    })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installDb()
})

afterEach(async () => {
    await loadV3Plugins([])
    warnSpy.mockRestore()
})

//#endregion

describe('a denied "dbWrite" consent stops every setter', () => {
    test.each(setters)('D1: %s rejects naming "dbWrite" after both prompts and writes nothing', async (name, call) => {
        answers.dbWrite = false
        const api = makeApi(`d1-${name}`)
        const before = live()

        const outcome = await settle(() => call(api))

        expect(promptTexts()).toHaveLength(2)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'dbWrite'")
        expect(live()).toEqual(before)
    })

    test('D2: the second prompt is the dbWrite consent text with the plugin name filled in', async () => {
        answers.dbWrite = false
        const script = 'd2-text'
        const api = makeApi(script)

        await settle(() => api.setDatabase(databaseUpdate))

        expect(promptTexts()).toHaveLength(2)
        expect(language).toHaveProperty('dbWriteConsent')
        expect(promptTexts()[0]).toBe(dbPromptText(script))
        expect(promptTexts()[1]).toBe(dbWritePromptText(script))
    })

    test.each(setters)('guard (D3): %s with "db" denied rejects naming "db", asks once and never asks "dbWrite"', async (name, call) => {
        answers.db = false
        answers.dbWrite = false
        const api = makeApi(`d3-${name}`)
        const before = live()

        const outcome = await settle(() => call(api))

        expect(promptTexts()).toHaveLength(1)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'db'")
        expect(outcome.message).not.toContain("'dbWrite'")
        expect(live()).toEqual(before)
    })

    test('D8: a denial holds for the session, so a second setter rejects without a new prompt', async () => {
        answers.dbWrite = false
        const api = makeApi('d8-session')
        await settle(() => api.setDatabase(databaseUpdate))
        expect(promptTexts()).toHaveLength(2)

        const outcome = await settle(() => api.setCharacterToIndex(1, makeCharacter('char-1', 'Overwritten')))

        expect(promptTexts()).toHaveLength(2)
        expect(outcome.rejected).toBe(true)
        expect(outcome.message).toContain("'dbWrite'")
        expect(liveCharacters()[1].name).toBe('One')
    })
})

describe('guard (D4): granted setters write and resolve as before', () => {
    test('setDatabase and setDatabaseLite resolve their light counts and write', async () => {
        const api = makeApi('d4-database')

        await expect(api.setDatabase(databaseUpdate)).resolves.toEqual({ lightKept: 0, lightLeftOut: 0 })
        expect(JSON.parse(live().enabledModules)).toEqual(['module-after'])
        installDb()
        await expect(api.setDatabaseLite(databaseUpdate)).resolves.toEqual({ lightKept: 0, lightLeftOut: 0 })
        expect(JSON.parse(live().enabledModules)).toEqual(['module-after'])
    })

    test('the character and chat setters write', async () => {
        const api = makeApi('d4-characters')

        await api.setCharacterToIndex(1, makeCharacter('char-1', 'Written index'))
        await api.setChar(makeCharacter('char-0', 'Written char'))
        await api.setCharacter(makeCharacter('char-0', 'Written character'))
        await api.setChatToIndex(0, 0, makeChat('char-0-chat', 'Written chat'))

        expect(liveCharacters()[1].name).toBe('Written index')
        expect(liveCharacters()[0].name).toBe('Written character')
        expect(liveCharacters()[0].chats[0].name).toBe('Written chat')
    })
})

describe('the dbWrite consent comes before any refusal that depends on live state', () => {
    test('D5: setChar with a character that is not the selected one rejects naming "dbWrite"', async () => {
        answers.dbWrite = false
        const api = makeApi('d5-mismatch')

        const outcome = await settle(() => api.setChar(makeCharacter('char-1', 'Not selected')))

        expect(outcome.message).toContain("'dbWrite'")
        expect(outcome.message).not.toMatch(/not the selected character/i)
    })

    test.each(['setChar', 'setCharacterToIndex'] as const)('D5: %s with an archived-character placeholder over a full character rejects naming "dbWrite" and logs no refusal', async (name) => {
        answers.dbWrite = false
        const api = makeApi(`d5-placeholder-${name}`)
        const placeholder = makeCharacter('char-0', 'Zero', { coldstorage: 'unit-char-0' })

        const outcome = await settle(() => name === 'setChar' ? api.setChar(placeholder) : api.setCharacterToIndex(0, placeholder))

        expect(outcome.message).toContain("'dbWrite'")
        expect(outcome.message).not.toMatch(/archived-character placeholder/i)
        expect(warnSpy.mock.calls.flat().some((arg) => typeof arg === 'string' && arg.includes('char-0'))).toBe(false)
    })

    test.each(['setChar', 'setCharacterToIndex'] as const)('D5: %s with a light entry rejects naming "dbWrite", not the light-entry refusal', async (name) => {
        answers.dbWrite = false
        const api = makeApi(`d5-light-${name}`)
        const entry = { lightEntry: true, chaId: 'char-0', name: 'Zero', type: 'character' } as unknown as CharacterFixture

        const outcome = await settle(() => name === 'setChar' ? api.setChar(entry) : api.setCharacterToIndex(0, entry))

        expect(outcome.message).toContain("'dbWrite'")
        expect(outcome.message).not.toMatch(/light character entry/i)
    })
})

describe('the stored grant of "dbWrite" and the time it is re-asked', () => {
    test('D7a: a granted setter stores the grant and the time of the grant', async () => {
        const script = 'd7a-store'
        const api = makeApi(script)
        const scriptHash = await hasherMock(new TextEncoder().encode(script))

        await api.setDatabase(databaseUpdate)

        expect(memStore.get(`${scriptHash}_dbWrite`)).toBe(true)
        expect(memStore.get(`${pluginNameOf(script)}_dbWrite_lastGrantTime`)).toEqual(expect.any(Number))
    })

    test('guard (D7b): recent stored grants of both permissions let the write land without a prompt', async () => {
        const script = 'd7b-recent'
        await seedStoredGrant(script, 'db', DAY_MS)
        await seedStoredGrant(script, 'dbWrite', DAY_MS)
        const api = makeApi(script)

        await api.setDatabase(databaseUpdate)

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(JSON.parse(live().enabledModules)).toEqual(['module-after'])
    })

    test('D7c: a stale stored "dbWrite" grant is asked again, with the dbWrite text, and a no stops the write', async () => {
        answers.dbWrite = false
        const script = 'd7c-stale'
        await seedStoredGrant(script, 'db', DAY_MS)
        await seedStoredGrant(script, 'dbWrite', 4 * DAY_MS)
        const api = makeApi(script)
        const before = live()

        const outcome = await settle(() => api.setDatabase(databaseUpdate))

        expect(promptTexts()).toHaveLength(1)
        expect(language).toHaveProperty('dbWriteConsent')
        expect(promptTexts()[0]).toBe(dbWritePromptText(script))
        expect(outcome.message).toContain("'dbWrite'")
        expect(live()).toEqual(before)
    })

    test('D7d: a stale stored "dbWrite" grant is asked again by requestPluginPermission first, and a no then stops the setter without a new prompt', async () => {
        answers.dbWrite = false
        const script = 'd7d-request-first'
        await seedStoredGrant(script, 'db', DAY_MS)
        await seedStoredGrant(script, 'dbWrite', 4 * DAY_MS)
        const api = makeApi(script)
        const before = live()

        const granted = await api.requestPluginPermission('dbWrite')

        expect(promptTexts()).toHaveLength(1)
        expect(granted).toBe(false)
        const outcome = await settle(() => api.setDatabase(databaseUpdate))
        expect(promptTexts()).toHaveLength(1)
        expect(outcome.message).toContain("'dbWrite'")
        expect(live()).toEqual(before)
    })

    test.each([
        ['denied', false],
        ['granted', true],
    ])('D7d-c: a requestPluginPermission and a setDatabase started together share one prompt, %s', async (_label, granted) => {
        const script = `d7d-c-${_label}`
        await seedStoredGrant(script, 'db', DAY_MS)
        await seedStoredGrant(script, 'dbWrite', 4 * DAY_MS)
        const api = makeApi(script)
        const held = holdDbWritePrompt()
        const before = live()

        const request = api.requestPluginPermission('dbWrite')
        const write = settle(() => api.setDatabase(databaseUpdate))
        await letRequestsReachTheirConfirm()

        expect(promptTexts()).toHaveLength(1)
        held.answer(granted)
        expect(await request).toBe(granted)
        const outcome = await write
        if (granted) {
            expect(outcome.rejected).toBe(false)
            expect(JSON.parse(live().enabledModules)).toEqual(['module-after'])
            expect(memStore.get(`${pluginNameOf(script)}_dbWrite_lastGrantTime`) as number).toBeGreaterThan(Date.now() - DAY_MS)
        } else {
            expect(outcome.message).toContain("'dbWrite'")
            expect(live()).toEqual(before)
        }
    })
})

describe('requestPluginPermission("dbWrite")', () => {
    test('D9: asks with the dbWrite text and resolves true when granted', async () => {
        const script = 'd9-request'
        const api = makeApi(script)

        const granted = await api.requestPluginPermission('dbWrite')

        expect(promptTexts()).toHaveLength(1)
        expect(language).toHaveProperty('dbWriteConsent')
        expect(promptTexts()[0]).toBe(dbWritePromptText(script))
        expect(granted).toBe(true)
    })
})

describe('concurrent and unloading setters', () => {
    test('D10: two setters started together share one dbWrite prompt and both write after a yes', async () => {
        const script = 'd10-concurrent'
        await seedStoredGrant(script, 'db', DAY_MS)
        const api = makeApi(script)
        const held = holdDbWritePrompt()

        const first = api.setCharacterToIndex(0, makeCharacter('char-0', 'First'))
        const second = api.setCharacterToIndex(1, makeCharacter('char-1', 'Second'))
        await letRequestsReachTheirConfirm()

        expect(promptTexts()).toHaveLength(1)
        expect(language).toHaveProperty('dbWriteConsent')
        expect(promptTexts()[0]).toBe(dbWritePromptText(script))
        held.answer(true)
        await Promise.all([first, second])
        expect(liveCharacters().map((character) => character.name)).toEqual(['First', 'Second'])
    })

    test('D11: a write whose dbWrite prompt is open when the plugin unloads still lands once it is granted', async () => {
        const script = 'd11-unload'
        await seedStoredGrant(script, 'db', DAY_MS)
        await executePluginV3(makePlugin(script))
        const api = hostedApis[0] as Api
        const held = holdDbWritePrompt()

        const write = api.setCharacterToIndex(1, makeCharacter('char-1', 'Written after unload'))
        await letRequestsReachTheirConfirm()
        expect(promptTexts()).toHaveLength(1)
        await loadV3Plugins([])
        held.answer(true)
        await write

        expect(liveCharacters()[1].name).toBe('Written after unload')
    })
})

describe('guard (D12): the getters never ask for dbWrite', () => {
    test('the character, chat and database getters ask for "db" only', async () => {
        const script = 'd12-getters'
        answers.dbWrite = false
        const api = makeApi(script)

        await api.getCharacter()
        await api.getChar()
        await api.getCharacterFromIndex(0)
        await api.getChatFromIndex(0, 0)
        await api.getLightCharacters()
        await api.getDatabase()

        expect(promptTexts()).toEqual([dbPromptText(script)])
    })
})
