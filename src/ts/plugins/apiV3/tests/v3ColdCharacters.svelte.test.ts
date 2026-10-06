/**
 * Plugin access to archived characters ("stubs": placeholders whose full data
 * lives in a cold-storage unit), through the V3 host API
 * (`makeRisuaiAPIV3` in `v3.svelte.ts`) and the V2 plugin APIs it wraps
 * (`getV2PluginAPIs` in `plugins.svelte.ts`).
 *
 * Invariants exercised here:
 * - Reading an archived character through `getCharacterFromIndex` or
 *   `getChatFromIndex` returns the unit's data as an independent copy: the
 *   stub stays in its slot, nothing is marked for save, the copy carries the
 *   stub's trash state. A missing, unreadable or mismatched unit rejects the
 *   call and the user gets one alert naming the character.
 * - `getDatabase` keeps handing out stubs as stubs.
 * - The plugin setters refuse an incoming stub (keyed by its chaId, not by
 *   slot) when the live holder of that chaId is a full character, when the
 *   live holder is an archived character with another unit key, or when no
 *   character has that chaId. An incoming stub over a live stub with the same
 *   unit key is accepted, and a full character may replace a stub.
 * - `setChatToIndex` on an archived character restores it first, then writes
 *   into the restored character found again by `chaId`, and marks it. A failed
 *   restore writes nothing, rejects, and the stub stays.
 *
 * Drives the REAL `v3.svelte.ts`, `plugins.svelte.ts`, `chatIds.ts`,
 * `coldCharacter.ts`, `coldCharacterRestore.ts`, `characterSaveMarks.ts`,
 * `registerDbChangeEffects` and `RisuSaveEncoder`. The cold-storage read is a
 * mock (`readColdStorageItem`); it says nothing about the native backends.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { toSaveType } from '../../../storage/risuSave'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Every text shown to the user, except progress notices. */
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

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

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../../storage/database.svelte')
})

vi.mock(import('../../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../../pluginSafety'))

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
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: alertConfirmMock,
        alertPluginConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
    } as unknown as typeof import('../../../alert')
})

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    getFetchLogs: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
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
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
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
import { getV2PluginAPIs } from '../../plugins.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { registerDbChangeEffects } from '../../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../../storage/characterSaveMarks'
import { buildColdStub } from '../../../process/coldCharacter'
import { restoreColdCharacter } from '../../../process/coldCharacterRestore'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const PLUGIN_NAME = 'cold-test-plugin'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'cold-characters-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeChat(id: string, text: string) {
    return { id, message: [{ role: 'user', data: text, time: 1 }], note: '', name: id, localLore: [] }
}

/** A full character with the fields the tests read. */
function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [{ comment: `${chaId} lore`, content: `${chaId} lore content`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        chats: [makeChat(`${chaId}-chat-0`, 'first'), makeChat(`${chaId}-chat-1`, 'second'), makeChat(`${chaId}-chat-2`, 'third')],
        ...extra,
    } as unknown as character
}

/**
 * The stub as it sits in the list after load: the fields the boot-time format
 * check fills on every character are default-filled.
 */
function stubOf(full: character, key: string): CharacterFixture {
    const stub = buildColdStub(full, key, []) as unknown as Record<string, unknown>
    Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
    return stub as unknown as CharacterFixture
}

interface UnitEntry { kind: 'ok', character: unknown }
const units = new Map<string, UnitEntry | { kind: 'error' }>()

function putUnit(key: string, stored: unknown): void {
    units.set(key, { kind: 'ok', character: stored })
}

function installUnitReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        const entry = units.get(key)
        if (!entry) {
            return { status: 'missing' }
        }
        if (entry.kind === 'error') {
            return { status: 'error', error: new Error('unit unreadable') }
        }
        return { status: 'ok', value: { character: structuredClone(entry.character) } }
    })
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

/** The real save machinery, wired as saveDb() does. */
async function wireSaveMachinery() {
    const tracker = makeTracker()
    const cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: vi.fn() })
    })
    flushSync()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    const encoder = new RisuSaveEncoder()
    await encoder.init(snapshotDb(DBState.db), { compression: false })
    tracker.character = []
    return { tracker, encoder, cleanup }
}

async function roundTrip(tracker: toSaveType, encoder: RisuSaveEncoder): Promise<Database> {
    flushSync()
    const toSave = structuredClone(tracker) as toSaveType
    await encoder.set(snapshotDb(DBState.db), toSave)
    return await decodeRisuSave(new Uint8Array(encoder.encode()!))
}

function decodedOf(decoded: Database, chaId: string): ColdCharacter {
    return decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId) as unknown as ColdCharacter
}

function liveOf(chaId: string): ColdCharacter {
    return DBState.db.characters.find((c: CharacterFixture) => c.chaId === chaId) as unknown as ColdCharacter
}

/** Runs `fn` so that both a throw and a rejection surface as a rejection, and a plain return as a fulfilment. */
function settled<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve().then(fn)
}

function noticesNaming(name: string): string[] {
    return notices.texts.filter((text) => text.includes(name))
}

let warnSpy: MockInstance<typeof console.warn>

function warnedAbout(chaId: string): boolean {
    return warnSpy.mock.calls.some((args) => {
        const text = args.map((a) => String(a)).join(' ')
        return text.includes(PLUGIN_NAME) && text.includes(chaId)
    })
}

beforeEach(() => {
    units.clear()
    notices.texts.length = 0
    readColdStorageItemMock.mockReset()
    installUnitReader()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    selectedCharID.set(0)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    vi.restoreAllMocks()
})

//#endregion

describe('V3 getCharacterFromIndex and getChatFromIndex on an archived character', () => {
    test('getCharacterFromIndex returns the unit\'s description, chats and lorebook and leaves the stub in its slot, unmarked', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const { tracker, cleanup } = await wireSaveMachinery()
        const stubBefore = DBState.db.characters[1]
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const result = await api.getCharacterFromIndex(1) as unknown as character

        expect(result.desc).toBe('hero description')
        expect(result.chats).toHaveLength(3)
        expect(result.chats[1].message[0].data).toBe('second')
        expect(result.globalLore).toHaveLength(1)
        expect(result.globalLore[0].content).toBe('hero lore content')
        expect(DBState.db.characters[1]).toBe(stubBefore)
        expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
        flushSync()
        expect(tracker.character).not.toContain('hero')
        cleanup()
    })

    test('the returned character is a copy: changing it changes neither the stub nor what the next read returns', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const first = await api.getCharacterFromIndex(1) as unknown as character
        expect(first.desc).toBe('hero description')
        first.desc = 'changed by the plugin'
        first.chats.length = 0
        const second = await api.getCharacterFromIndex(1) as unknown as character

        expect(second.desc).toBe('hero description')
        expect(second.chats).toHaveLength(3)
        expect(DBState.db.characters).toHaveLength(2)
        expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
    })

    test('the copy carries the stub\'s trash state, not the unit\'s', async () => {
        const trashedInUnit = fullCharacter('hero', { trashTime: 777 })
        putUnit('unit-hero', trashedInUnit)
        const liftedStub = stubOf(fullCharacter('hero'), 'unit-hero')
        installDb([fullCharacter('warm'), liftedStub])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const lifted = await api.getCharacterFromIndex(1) as unknown as character

        expect(lifted.desc).toBe('hero description')
        expect(lifted.trashTime).toBeUndefined()

        const trashedStub = stubOf(fullCharacter('hero', { trashTime: 999 }), 'unit-hero')
        installDb([fullCharacter('warm'), trashedStub])
        putUnit('unit-hero', fullCharacter('hero'))

        const trashed = await api.getCharacterFromIndex(1) as unknown as character

        expect(trashed.desc).toBe('hero description')
        expect(trashed.trashTime).toBe(999)
    })

    test('getChatFromIndex returns the unit\'s chat at that index and null past the end', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const second = await api.getChatFromIndex(1, 1) as unknown as character['chats'][number]
        expect(second?.message[0].data).toBe('second')
        expect(await api.getChatFromIndex(1, 99)).toBeNull()
    })

    test.each([
        ['a missing unit', undefined],
        ['an unreadable unit', { kind: 'error' } as const],
        ['a unit holding another character', { kind: 'ok', character: fullCharacter('someone-else') } as const],
    ])('getCharacterFromIndex rejects for %s and the user gets exactly one alert naming the character', async (_label, entry) => {
        if (entry) {
            units.set('unit-hero', entry)
        }
        const hero = stubOf(fullCharacter('hero', { name: 'Archived Hero' }), 'unit-hero')
        installDb([fullCharacter('warm'), hero])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => api.getCharacterFromIndex(1))).rejects.toThrow()

        expect(noticesNaming('Archived Hero')).toHaveLength(1)
        expect(notices.texts).toHaveLength(1)
        expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
    })

    test('getChatFromIndex rejects for a missing unit and the user gets exactly one alert naming the character', async () => {
        const hero = stubOf(fullCharacter('hero', { name: 'Archived Hero' }), 'unit-hero')
        installDb([fullCharacter('warm'), hero])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => api.getChatFromIndex(1, 1))).rejects.toThrow()

        expect(noticesNaming('Archived Hero')).toHaveLength(1)
        expect(notices.texts).toHaveLength(1)
    })

    test('guard: out-of-range character and chat indices return null as for a full character', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        expect(await api.getCharacterFromIndex(7)).toBeNull()
        expect(await api.getChatFromIndex(7, 0)).toBeNull()
        expect(notices.texts).toHaveLength(0)
    })

    test('guard: getCharacterFromIndex and getChatFromIndex read a full character from memory without touching cold storage', async () => {
        installDb([fullCharacter('warm'), fullCharacter('other')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const character = await api.getCharacterFromIndex(1) as unknown as character
        const chat = await api.getChatFromIndex(1, 2) as unknown as character['chats'][number]

        expect(character.desc).toBe('other description')
        expect(chat.message[0].data).toBe('third')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })

    test('guard: getDatabase still returns an archived character as a stub', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const all = await api.getDatabase('all') as unknown as { characters: ColdCharacter[] }

        expect(all.characters).toHaveLength(2)
        expect(all.characters[1].coldstorage).toBe('unit-hero')
        expect(all.characters[1].chaId).toBe('hero')
        expect(all.characters[1].chats).toHaveLength(1)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })
})

describe('plugin setters and incoming stubs: the refusal rule by chaId', () => {
    interface Scenario {
        live: CharacterFixture[]
        /** What the plugin read from getDatabase('all') while its target was a stub. */
        snapshot: { characters: CharacterFixture[] }
    }

    /**
     * The plugin reads the database while `hero` is archived, the user then
     * opens `hero` (restoring it), and the plugin writes back what it read.
     */
    async function pluginReadsThenUserOpensHero(): Promise<Scenario> {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
        const snapshot = await api.getDatabase('all') as unknown as { characters: CharacterFixture[] }
        expect((snapshot.characters[1] as unknown as ColdCharacter).coldstorage).toBe('unit-hero')

        const outcome = await restoreColdCharacter(DBState.db.characters[1])
        expect(outcome.status).toBe('restored')
        expect(liveOf('hero').coldstorage).toBeUndefined()
        return { live: DBState.db.characters, snapshot }
    }

    const arraySetters: [string, (characters: CharacterFixture[]) => Promise<unknown>][] = [
        ['V3 setDatabase', async (characters) => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin()).setDatabase({ characters })],
        ['V3 setDatabaseLite', async (characters) => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin()).setDatabaseLite({ characters })],
        ['V2 setDatabase', async (characters) => getV2PluginAPIs().setDatabase({ characters }, PLUGIN_NAME)],
        ['V2 setDatabaseLite', async (characters) => getV2PluginAPIs().setDatabaseLite({ characters }, PLUGIN_NAME)],
    ]

    test.each(arraySetters)('%s with a stub for a character that is full keeps it full, applies the other changes and survives an encode-decode round trip', async (_label, apply) => {
        const { snapshot } = await pluginReadsThenUserOpensHero()
        const { tracker, encoder, cleanup } = await wireSaveMachinery()
        snapshot.characters[0].name = 'warm renamed by plugin'

        await apply(snapshot.characters)
        flushSync()

        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('hero description')
        expect(liveOf('hero').chats).toHaveLength(3)
        expect(liveOf('warm').name).toBe('warm renamed by plugin')
        expect(warnedAbout('hero')).toBe(true)

        const decoded = await roundTrip(tracker, encoder)
        expect(decodedOf(decoded, 'hero').coldstorage).toBeUndefined()
        expect(decodedOf(decoded, 'hero').desc).toBe('hero description')
        expect(decodedOf(decoded, 'hero').chats).toHaveLength(3)
        cleanup()
    })

    test('V3 setCharacterToIndex with a stub for the full character in that slot rejects and leaves the slot unchanged', async () => {
        const { live, snapshot } = await pluginReadsThenUserOpensHero()
        const heroBefore = live[1]
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => api.setCharacterToIndex(1, snapshot.characters[1]))).rejects.toThrow()

        expect(DBState.db.characters[1]).toBe(heroBefore)
        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('hero description')
        expect(warnedAbout('hero')).toBe(true)
    })

    test.each([
        ['setChar', (api: ReturnType<typeof makeRisuaiAPIV3>, char: CharacterFixture) => api.setChar(char)],
        ['setCharacter', (api: ReturnType<typeof makeRisuaiAPIV3>, char: CharacterFixture) => api.setCharacter(char)],
    ])('V3 %s with a stub for the selected full character rejects and leaves it unchanged', async (_label, call) => {
        const { live, snapshot } = await pluginReadsThenUserOpensHero()
        const heroBefore = live[1]
        selectedCharID.set(1)
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => call(api, snapshot.characters[1]))).rejects.toThrow()

        expect(DBState.db.characters[1]).toBe(heroBefore)
        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('hero description')
        expect(warnedAbout('hero')).toBe(true)
    })

    test('V2 setChar with a stub for the selected full character writes nothing', async () => {
        const { live, snapshot } = await pluginReadsThenUserOpensHero()
        const heroBefore = live[1]
        selectedCharID.set(1)

        try {
            getV2PluginAPIs().setChar(snapshot.characters[1], PLUGIN_NAME)
        } catch {
            // A refusal may be reported by throwing; only the written state matters here.
        }

        expect(DBState.db.characters[1]).toBe(heroBefore)
        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('hero description')
    })

    test('an incoming stub with another unit key than the live stub is refused: the live stub stays and the other changes apply', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
        const incoming = [
            { ...fullCharacter('warm'), name: 'warm renamed by plugin' } as unknown as CharacterFixture,
            stubOf(full, 'unit-elsewhere'),
        ]

        await api.setDatabase({ characters: incoming })

        expect(liveOf('hero').coldstorage).toBe('unit-hero')
        expect(liveOf('warm').name).toBe('warm renamed by plugin')
        expect(DBState.db.characters).toHaveLength(2)
        expect(warnedAbout('hero')).toBe(true)
    })

    test('an incoming stub whose chaId exists nowhere is left out of the array and the other changes apply', async () => {
        installDb([fullCharacter('warm'), fullCharacter('other')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
        const ghost = stubOf(fullCharacter('ghost'), 'unit-ghost')
        const incoming = [
            { ...fullCharacter('warm'), name: 'warm renamed by plugin' } as unknown as CharacterFixture,
            fullCharacter('other') as unknown as CharacterFixture,
            ghost,
        ]

        await api.setDatabase({ characters: incoming })

        expect(DBState.db.characters.map((c: CharacterFixture) => c.chaId)).toEqual(['warm', 'other'])
        expect(liveOf('warm').name).toBe('warm renamed by plugin')
        expect(warnedAbout('ghost')).toBe(true)
    })

    test('V3 setCharacterToIndex with a stub whose chaId exists nowhere rejects and leaves the slot unchanged', async () => {
        installDb([fullCharacter('warm'), fullCharacter('other')])
        const warmBefore = DBState.db.characters[0]
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => api.setCharacterToIndex(0, stubOf(fullCharacter('ghost'), 'unit-ghost')))).rejects.toThrow()

        expect(DBState.db.characters[0]).toBe(warmBefore)
        expect(liveOf('warm').desc).toBe('warm description')
        expect(warnedAbout('ghost')).toBe(true)
    })

    test('setDatabase keeps a character full when the user restored it while a plugin-install confirm of the same call was open', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
        const snapshot = await api.getDatabase('all') as unknown as { characters: CharacterFixture[], plugins: RisuPlugin[] }
        expect((snapshot.characters[1] as unknown as ColdCharacter).coldstorage).toBe('unit-hero')
        const newPlugin = { name: 'another-plugin', script: '//@name another-plugin\n//@api 3.0\n//@version 1.0.0\n// another-script', version: '3.0', arguments: {}, realArg: {}, customLink: [], argMeta: {} }
        let answerInstallConfirm!: (install: boolean) => void
        const confirmsBefore = alertConfirmMock.mock.calls.length
        alertConfirmMock.mockImplementationOnce(() => new Promise<boolean>((resolve) => { answerInstallConfirm = resolve }))

        // The install confirm precedes the `characters` assignment, and `characters` is reconciled against the live list at the moment it is assigned, so a restore during the confirm is seen.
        const pending = api.setDatabase({ plugins: [...snapshot.plugins, newPlugin], characters: snapshot.characters })
        for (let i = 0; i < 50 && alertConfirmMock.mock.calls.length === confirmsBefore; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        expect(alertConfirmMock.mock.calls.length).toBe(confirmsBefore + 1)
        const outcome = await restoreColdCharacter(DBState.db.characters[1])
        expect(outcome.status).toBe('restored')
        expect(liveOf('hero').coldstorage).toBeUndefined()
        answerInstallConfirm(true)
        await pending

        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('hero description')
        expect(liveOf('hero').chats).toHaveLength(3)
    })

    test('guard: an incoming stub with the same chaId and unit key as the live stub is accepted', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
        const snapshot = await api.getDatabase('all') as unknown as { characters: CharacterFixture[] }
        snapshot.characters[1].name = 'hero renamed by plugin'

        await api.setDatabase({ characters: snapshot.characters })

        expect(liveOf('hero').coldstorage).toBe('unit-hero')
        expect(liveOf('hero').name).toBe('hero renamed by plugin')
    })

    test('guard: an incoming full character replaces a live stub', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await api.setDatabase({ characters: [fullCharacter('warm'), fullCharacter('hero', { desc: 'written by the plugin' })] })
        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('written by the plugin')

        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        api.setCharacterToIndex(1, fullCharacter('hero', { desc: 'written by index' }))
        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').desc).toBe('written by index')
    })
})

describe('V3 setChatToIndex on an archived character', () => {
    test('restores the character, replaces that chat, keeps the unit\'s other chats, marks it and survives an encode-decode round trip', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        const { tracker, encoder, cleanup } = await wireSaveMachinery()
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await api.setChatToIndex(1, 1, makeChat('hero-chat-1', 'written by the plugin'))
        flushSync()

        const hero = liveOf('hero')
        expect(hero.coldstorage).toBeUndefined()
        expect(hero.chats).toHaveLength(3)
        expect(hero.chats[1].message[0].data).toBe('written by the plugin')
        expect(hero.chats[0].message[0].data).toBe('first')
        expect(hero.chats[2].message[0].data).toBe('third')
        expect(tracker.character).toContain('hero')

        const decoded = await roundTrip(tracker, encoder)
        expect(decodedOf(decoded, 'hero').coldstorage).toBeUndefined()
        expect(decodedOf(decoded, 'hero').chats[1].message[0].data).toBe('written by the plugin')
        expect(decodedOf(decoded, 'hero').chats[2].message[0].data).toBe('third')
        cleanup()
    })

    test('a character inserted in front of the stub while its unit is being read does not receive the write', async () => {
        const full = fullCharacter('hero')
        putUnit('unit-hero', full)
        installDb([fullCharacter('warm'), stubOf(full, 'unit-hero')])
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        readColdStorageItemMock.mockImplementation(async () => {
            await gate
            return { status: 'ok', value: { character: structuredClone(full) } }
        })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        const pending = api.setChatToIndex(1, 1, makeChat('hero-chat-1', 'written by the plugin'))
        for (let i = 0; i < 20 && readColdStorageItemMock.mock.calls.length === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        DBState.db.characters.unshift(fullCharacter('inserted'))
        release()
        await pending

        expect(liveOf('hero').coldstorage).toBeUndefined()
        expect(liveOf('hero').chats[1].message[0].data).toBe('written by the plugin')
        expect(liveOf('inserted').chats[1].message[0].data).toBe('second')
        expect(liveOf('warm').chats[1].message[0].data).toBe('second')
    })

    test.each([
        ['a missing unit', undefined],
        ['an unreadable unit', { kind: 'error' } as const],
    ])('rejects for %s, writes nothing, leaves the stub and shows one alert naming the character', async (_label, entry) => {
        if (entry) {
            units.set('unit-hero', entry)
        }
        const hero = stubOf(fullCharacter('hero', { name: 'Archived Hero' }), 'unit-hero')
        installDb([fullCharacter('warm'), hero])
        const { tracker, cleanup } = await wireSaveMachinery()
        const stubBefore = DBState.db.characters[1]
        const stubChatsBefore = JSON.stringify($state.snapshot(stubBefore.chats))
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await expect(settled(() => api.setChatToIndex(1, 1, makeChat('hero-chat-1', 'written by the plugin')))).rejects.toThrow()

        flushSync()
        expect(DBState.db.characters[1]).toBe(stubBefore)
        expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
        expect(JSON.stringify($state.snapshot(DBState.db.characters[1].chats))).toBe(stubChatsBefore)
        expect(tracker.character).not.toContain('hero')
        expect(noticesNaming('Archived Hero')).toHaveLength(1)
        expect(notices.texts).toHaveLength(1)
        cleanup()
    })

    test('guard: writing a chat into a full character that is not selected replaces it and marks it', async () => {
        installDb([fullCharacter('warm'), fullCharacter('other')])
        const { tracker, cleanup } = await wireSaveMachinery()
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

        await api.setChatToIndex(1, 1, makeChat('other-chat-1', 'written by the plugin'))
        flushSync()

        expect(liveOf('other').chats[1].message[0].data).toBe('written by the plugin')
        expect(tracker.character).toContain('other')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        cleanup()
    })
})
