// @vitest-environment happy-dom

/**
 * A standalone real `Chat.svelte` marked as a surface row, under an installed chat surface. The parser is a held
 * double: every `ParseMarkdown` call pushes a deferred that the test answers, and `risuChatParser` reads a database
 * value the way a CBS macro does, so the row's display effect depends on it. Settings is opened and closed through
 * the real `settingsOpen` writable that `chatSurface` follows. No change counter is registered here, so a database
 * write never forces a rebuild: only a reload signal does.
 *
 * Labels: R = regression reproducer (must fail on the base without the hold), G = guard (passes before and after).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Chat from './Chat.svelte'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import { chatSurface, installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
import { risuChatParser } from 'src/ts/process/scripts'
import type { Database, character, Chat as ChatData } from 'src/ts/storage/database.svelte'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    // Reads a database value the way a CBS macro such as {{user}} does, so a row's display effect depends on it.
    readDatabaseValue: (() => {}) as () => void,
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.parses.push({ args, resolve }) })),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Database })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        aiLawApplies: vi.fn(() => false),
        changeChatTo: vi.fn((v: number | string) => {
            const char = (stores.DBState as unknown as { db: Database }).db.characters[
                (stores.selIdState as unknown as { selId: number }).selId
            ]
            if (typeof v === 'number' && char) {
                char.chatPage = v
            }
        }),
        foldChatToMessage: vi.fn(),
        chatFoldedStateMessageIndex: { index: -1 },
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const DBState = stores.DBState as unknown as { db: Database }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: Database) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertError: vi.fn(),
    alertSelect: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(async (html: string) => html),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => { h.readDatabaseValue(); return text ?? '' }),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/longtouch'), () => ({
    longpress: vi.fn(() => ({ destroy: () => {} })),
}) as unknown as typeof import('src/ts/gui/longtouch'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
    findCharacterbyId: vi.fn(() => null),
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    checkPersonaBinded: vi.fn(() => false),
    parseKeyValue: () => [],
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

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

vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

function makeChat(messages: unknown[]): ChatData {
    return {
        id: 'chat0',
        message: messages,
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
    } as unknown as ChatData
}

function baseDb() {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '',
        personas: [], selectedPersona: 0, username: 'User',
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

async function answerAll() {
    for (let round = 0; round < 3; round++) {
        for (const parse of h.parses.slice()) {
            parse.resolve(`P:${parse.args[0] as string}`)
        }
        await wait(20)
        await tick()
    }
}

/** Mounts one surface row and settles its first parse. */
async function mountSettledRow(surface = true) {
    DBState.db = baseDb() as never
    const messages = [{ role: 'char', data: 'FIRST', chatId: 'id0' }]
    DBState.db.characters = [{
        chaId: 'a', name: 'a', type: 'character', ttsMode: 'none', chatPage: 0, chats: [makeChat(messages)],
        triggerscript: [], globalLore: [], desc: '', modules: [], image: '',
    } as unknown as character] as never
    selectedCharID.set(0)
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const props = $state({
        idx: 0,
        message: 'FIRST',
        name: 'A',
        img: '',
        role: 'char',
        rerollIcon: false,
        character: { name: 'A' },
        isLastMemory: false,
        surface,
    })
    mountedInstances.push(mount(Chat, { target, props: props as never }))
    flushSync()
    await wait(20)
    await answerAll()
    expect(target.querySelector('.chattext')?.textContent).toContain('P:FIRST')
    return { target, props }
}

async function openSettings() {
    settingsOpen.set(true)
    await tick()
    await tick()
}

async function closeSettingsAndSettle() {
    settingsOpen.set(false)
    await tick()
    await tick()
    await wait(20)
    await answerAll()
}

beforeEach(() => {
    window.innerWidth = 1024
    h.parses.length = 0
    h.readDatabaseValue = () => { void DBState.db?.username }
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    settingsOpen.set(false)
    clearChatBodyRenderCache()
    resetChatSurfaceForTests()
    installChatSurface()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    vi.clearAllMocks()
})

//#endregion

describe('a surface row kept across a rebuild return', () => {
    test('R T22 the old row neither parses nor runs the display script from the hidden bump to the settle', async () => {
        const { target } = await mountSettledRow()
        const parseMark = vi.mocked(ParseMarkdown).mock.calls.length
        const scriptMark = vi.mocked(risuChatParser).mock.calls.length

        await openSettings()
        ReloadGUIPointer.update((v) => v + 1)
        // A dependency of the display script changes too, so the row's effect has a held run to release.
        DBState.db.username = 'Renamed'
        await wait(30)
        // The body is not re-created while hidden: it keeps what it showed.
        expect(target.querySelector('.chattext')?.textContent).toContain('P:FIRST')
        await closeSettingsAndSettle()

        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(0)
    })

    test('R a body input that changed while hidden starts no run hidden, and one on the return', async () => {
        const { props } = await mountSettledRow()
        const parseMark = vi.mocked(ParseMarkdown).mock.calls.length

        await openSettings()
        props.character = { name: 'B' }
        await wait(30)
        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBe(0)

        await closeSettingsAndSettle()
        expect(chatSurface.rebuildEpoch).toBe(0)
        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBe(1)
    })

    test('R a later visible bump and dependency change leave the dead row alone', async () => {
        await mountSettledRow()
        await openSettings()
        ReloadGUIPointer.update((v) => v + 1)
        await closeSettingsAndSettle()
        expect(chatSurface.rebuildEpoch).toBe(1)
        const parseMark = vi.mocked(ParseMarkdown).mock.calls.length
        const scriptMark = vi.mocked(risuChatParser).mock.calls.length

        ReloadGUIPointer.update((v) => v + 1)
        DBState.db.username = 'Later'
        await wait(30)
        await answerAll()

        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(0)
    })

    test('G a row without the surface prop follows the bump as always', async () => {
        await mountSettledRow(false)
        const parseMark = vi.mocked(ParseMarkdown).mock.calls.length

        await openSettings()
        ReloadGUIPointer.update((v) => v + 1)
        await wait(30)

        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBeGreaterThan(0)
    })
})

describe('the display script of a surface row', () => {
    test('R T19 a dependency change while hidden runs it only on the release, once', async () => {
        await mountSettledRow()
        const scriptMark = vi.mocked(risuChatParser).mock.calls.length

        await openSettings()
        DBState.db.username = 'Renamed'
        await wait(30)
        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(0)

        await closeSettingsAndSettle()
        expect(chatSurface.rebuildEpoch).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(1)
    })

    test('G T11 an idle visit runs it zero times', async () => {
        await mountSettledRow()
        const scriptMark = vi.mocked(risuChatParser).mock.calls.length
        const parseMark = vi.mocked(ParseMarkdown).mock.calls.length

        await openSettings()
        await wait(30)
        await closeSettingsAndSettle()

        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(0)
        expect(vi.mocked(ParseMarkdown).mock.calls.length - parseMark).toBe(0)
    })

    test('G the row still follows a dependency change after the visit', async () => {
        await mountSettledRow()
        await openSettings()
        await closeSettingsAndSettle()
        const scriptMark = vi.mocked(risuChatParser).mock.calls.length

        DBState.db.username = 'Later'
        await wait(30)

        expect(vi.mocked(risuChatParser).mock.calls.length - scriptMark).toBe(1)
    })
})
