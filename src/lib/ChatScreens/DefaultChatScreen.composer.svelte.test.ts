// @vitest-environment happy-dom

/**
 * Mount harness: drives the REAL `DefaultChatScreen.svelte`, the REAL
 * `src/ts/process/composerActions.svelte.ts` (the send/reroll/auto-mode
 * actions) and the REAL `src/ts/process/composerDrafts.svelte.ts` (the
 * per-chat record store) through the DOM. Only services outside all three --
 * the message tree (`Chats.svelte`, `Chat.svelte`), the home/playground
 * menus (`MainMenu.svelte`, `PlaygroundMenu.svelte`), `Suggestion.svelte`,
 * cold storage, file/paste handling, TTS, the translator, and generation
 * itself (`sendChat`/`doingChat`) -- are mocked. `AssetInput.svelte` (the
 * sticker picker) is real.
 * `sendCharacterMessage`, `runTrigger` and `processScript` are real, on the
 * same pattern as `src/ts/process/tests/composerActions.svelte.test.ts`
 * (real Lua trigger engine, network mocked, a controllable
 * `pluginV2.editinput` hook standing in for a slow input step).
 *
 * Every state read after a production-code write goes through `DBState.db`,
 * never a raw fixture reference: Svelte 5's `$state` proxy is not guaranteed
 * to mutate the object a fixture was built from.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([] as any[])
    const additionalFloatingActionButtons = $state([] as any[])
    const chatPanelStore = $state([] as any[])
    const easyPanelStore = $state({ open: false })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
        PlaygroundStore: writable(0),
        createSimpleCharacter: vi.fn(() => null),
        hypaV3ModalOpen: writable(false),
        ScrollToMessageStore: scrollToMessage,
        additionalChatMenu,
        additionalFloatingActionButtons,
        easyPanelStore,
        chatPanelStore,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const chatFoldedState = $state<{ data: null | { targetCharacterId: string, targetChatId: string, targetMessageId: string } }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
        aiLawApplies: vi.fn(() => false),
        chatFoldedState,
        chatFoldedStateMessageIndex,
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        // Only the real (unstubbed) `AssetInput.svelte` needs these: it
        // calls `getFileSrc` for every additionalAsset's own preview and
        // `saveAsset` from its own "+" button, which this harness's sticker
        // scenario does not click.
        getFileSrc: vi.fn(async () => ''),
        saveAsset: vi.fn(async () => ''),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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

vi.mock(import('src/ts/util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    selectMultipleFile: vi.fn(),
    replacePlaceholders: vi.fn((s: string) => s),
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    // No interception needed here: this harness's scenarios never depend on
    // the exact moment `sendMain`'s own post-append sleep(10) lands.
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

const processMultiCommandMock = vi.hoisted(() => vi.fn(async (_cmd: string): Promise<string | false> => false))
vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: processMultiCommandMock,
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

const postChatFileMock = vi.hoisted(() => vi.fn(async (_query: unknown): Promise<Array<{ type: string, data: string, name?: string }> | null> => []))
vi.mock(import('src/ts/process/files/multisend'), () => ({
    postChatFile: postChatFileMock,
}) as unknown as typeof import('src/ts/process/files/multisend'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
    stopTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    snapshotSubject: vi.fn(),
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

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

// Real (mutable) Sets so a test can register its OWN plugin hook -- the "slow
// input step" fixtures need a genuine `pluginV2.editinput` await they control
// by hand, the same way a real plugin would (same technique as composerActions.svelte.test.ts).
const pluginV2Mock = vi.hoisted(() => ({
    editinput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editoutput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editdisplay: new Set<(data: string) => Promise<string | null | undefined>>(),
    editprocess: new Set<(data: string) => Promise<string | null | undefined>>(),
}))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: pluginV2Mock,
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
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
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const cold = await import('src/ts/process/coldstorageData')
    return {
        coldStorageHeader: cold.coldStorageHeader,
        preLoadChat: vi.fn(async () => 'ok'),
        retryLegacyColdChatLoad: vi.fn(async () => 'ok'),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

const isExpTranslatorMock = vi.hoisted(() => vi.fn(() => false))
const translateMock = vi.hoisted(() => vi.fn(async (_text: string, _reverse: boolean): Promise<string> => ''))
vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: isExpTranslatorMock,
    translate: translateMock,
}) as unknown as typeof import('src/ts/translator/translator'))

// Generation is out of scope: this spy mirrors the real module's own
// `doingChat` handling (refuse at once when already set, otherwise set it
// synchronously, await a controllable gate and clear it when it settles), the
// same as composerActions.svelte.test.ts. A per-call queue
// (`sendChatGateQueue`) additionally lets a test gate a specific call --
// needed for auto mode's loop, where every tick calls `sendChat` again once
// the previous one resolves.
const doingChatMock = vi.hoisted(() => {
    let value = false
    const subscribers = new Set<(v: boolean) => void>()
    return {
        subscribe(run: (v: boolean) => void) {
            subscribers.add(run)
            run(value)
            return () => subscribers.delete(run)
        },
        set(v: boolean) {
            value = v
            subscribers.forEach((run) => run(value))
        },
    }
})
const generationGateBox = vi.hoisted(() => ({ current: Promise.resolve() as Promise<void> }))
const sendChatGateQueue = vi.hoisted(() => [] as Array<{ gate: Promise<void> }>)
const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, arg: { signal?: AbortSignal, continue?: boolean }) => {
    if (get(doingChatMock as never)) {
        return false
    }
    doingChatMock.set(true)
    try {
        const queued = sendChatGateQueue.shift()
        await (queued ? queued.gate : generationGateBox.current)
        return true
    } finally {
        doingChatMock.set(false)
    }
}))
vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: doingChatMock,
    chatProcessStage: writable(0),
    sendChat: sendChatMock,
}) as unknown as typeof import('src/ts/process/index.svelte'))

// Stubs for everything DefaultChatScreen mounts that is not the composer
// itself: the message tree and the home/playground menus. None of this
// harness's scenarios exercise message rendering or the home menu, and each
// of these pulls in a large tree of its own (Realm, character cards,
// avatars) that has nothing to do with the composer. `AssetInput.svelte`
// (the sticker picker) is left real: it is light once `getFileSrc` and
// `saveAsset` are mocked above, and the sticker scenario below drives its
// own `onSelect` callback through it.
vi.mock('./Chats.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./Chat.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./Suggestion.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/MainMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../Playground/PlaygroundMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { isComposerBusy, isComposerLocked, isAutoModeActive, resetComposerActionsForTests } from 'src/ts/process/composerActions.svelte'
import { isWriting } from 'src/ts/process/chatOrigin'
import { hasLocalDrafts, hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { getMultiTabAction } from 'src/ts/storage/multiTabReload'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { preLoadChat, retryLegacyColdChatLoad } from 'src/ts/process/coldstorage.svelte'
import { getInlayAsset } from 'src/ts/process/files/inlays'
import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'

//#region fixtures

let idSeq = 0
function freshId(prefix: string): string {
    idSeq += 1
    return `${prefix}-${idSeq}`
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        characters: [] as unknown[],
        modules: [],
        templateDefaultVariables: '',
        personas: [{ name: 'User', largePortrait: false, icon: '' }],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        translator: '',
        username: 'User',
        newMessageButtonStyle: 'bottom-center',
        fixedChatTextarea: false,
        useChatSticker: false,
        hypaV3: false,
        hypav2: false,
        sideMenuRerollButton: false,
        showMenuChatList: false,
        showMenuHypaMemoryModal: false,
        enableRisuaiProTools: false,
        sendWithEnter: true,
        useAutoSuggestions: false,
        subModel: '',
        supaModelType: 'none',
        autoSuggestClean: false,
        personaPrompt: '',
        ...overrides,
    }
}

function makeMessage(role: string, data: string, overrides: Record<string, unknown> = {}) {
    return { role, data, ...overrides }
}

function makeChat(id: string | undefined, messages: unknown[] = [], overrides: Record<string, unknown> = {}) {
    return {
        id,
        message: messages,
        scriptstate: {},
        note: '',
        localLore: [],
        ...overrides,
    }
}

function makeCharacter(chaId: string | undefined, chats: unknown[], overrides: Record<string, unknown> = {}) {
    return {
        chaId,
        name: chaId ?? 'unnamed',
        type: 'character',
        chatPage: 0,
        chats,
        triggerscript: [],
        customscript: [],
        globalLore: [],
        desc: `${chaId ?? 'unnamed'}-desc`,
        firstMessage: 'greeting',
        alternateGreetings: [],
        largePortrait: false,
        removedQuotes: true,
        creatorNotes: '',
        image: '',
        ttsMode: 'none',
        additionalAssets: [],
        ...overrides,
    }
}

function makeGroup(chaId: string, chats: unknown[], overrides: Record<string, unknown> = {}) {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        chats,
        ttsMode: 'none',
        ...overrides,
    }
}

function installDb(characters: unknown[], overrides: Record<string, unknown> = {}) {
    DBState.db = baseDb(overrides) as never
    DBState.db.characters = characters as never
    selectedCharID.set(0)
}

/** The live character at `index`, read through the reactive proxy. */
function liveChar(index: number): any {
    return (DBState.db as any).characters[index]
}

//#endregion

//#region mount / DOM helpers

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountScreen() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

async function unmountScreen(instance: unknown) {
    const idx = mountedInstances.indexOf(instance)
    if (idx !== -1) mountedInstances.splice(idx, 1)
    await unmount(instance as never).catch(() => {})
}

async function settle() {
    flushSync()
    await tick()
    flushSync()
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor: condition not met within timeout')
        }
        await new Promise((r) => setTimeout(r, 5))
        flushSync()
    }
}

function mainTextarea(target: HTMLElement): HTMLTextAreaElement {
    return target.querySelector<HTMLTextAreaElement>('textarea.text-input-area')!
}
function translateTextarea(target: HTMLElement): HTMLTextAreaElement | null {
    return target.querySelector<HTMLTextAreaElement>('#messageInputTranslate')
}
function sendButton(target: HTMLElement): HTMLButtonElement {
    return target.querySelector<HTMLButtonElement>('.button-icon-send')!
}
function busyButton(target: HTMLElement): HTMLButtonElement | null {
    return target.querySelector<HTMLButtonElement>('button[aria-labelledby="cancel"]')
}
function stagedFilePreviews(target: HTMLElement): HTMLImageElement[] {
    return Array.from(target.querySelectorAll<HTMLImageElement>('img[alt="Inlay"]'))
}
function stagedFileRemoveButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll<HTMLButtonElement>('button.absolute'))
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
    textarea.value = value
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressEnter(textarea: HTMLTextAreaElement, opts: { shiftKey?: boolean } = {}) {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, shiftKey: opts.shiftKey ?? false }))
}

function openComposerMenu(target: HTMLElement) {
    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button'))
    const menuButton = buttons.find((b) => !b.classList.contains('button-icon-send') && b.getAttribute('aria-labelledby') !== 'cancel')
    if (!menuButton) throw new Error('composer menu (hamburger) button not found')
    menuButton.click()
    flushSync()
}

function clickMenuItemByLabel(target: HTMLElement, labelText: string) {
    const item = Array.from(target.querySelectorAll<HTMLElement>('div')).find((d) => {
        const span = d.querySelector(':scope > span')
        return span?.textContent?.trim() === labelText
    })
    if (!item) throw new Error(`menu item not found: ${labelText}`)
    item.click()
}

/**
 * Registers one `pluginV2.editinput` hook (a real plugin's own shape) whose
 * successive invocations are gated one at a time via `nextGate()`. A call for
 * which no gate was queued passes its text through at once -- the same as a
 * real install with no hook at all. Identical technique to composerActions.svelte.test.ts.
 */
function installEditinputQueue() {
    let callIndex = 0
    const queue: Array<{ gate: Promise<void>, markReached: () => void } | undefined> = []
    pluginV2Mock.editinput.add(async (data: string) => {
        const entry = queue[callIndex]
        callIndex++
        if (!entry) {
            return data
        }
        entry.markReached()
        await entry.gate
        return data
    })
    return {
        nextGate() {
            let release: () => void = () => {}
            const gate = new Promise<void>((res) => { release = res })
            let markReached: () => void = () => {}
            const reached = new Promise<void>((res) => { markReached = res })
            queue.push({ gate, markReached })
            return { release, reached }
        },
    }
}

/** Holds the NEXT `sendChat` call's own gate open, independent of any other. */
function gateNextGeneration() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    sendChatGateQueue.push({ gate })
    return release
}

//#endregion

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
})

beforeEach(() => {
    idSeq = 0
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetLocalDraftsForTest()
    resetComposerActionsForTests()
    pluginV2Mock.editinput.clear()
    pluginV2Mock.editoutput.clear()
    pluginV2Mock.editdisplay.clear()
    processMultiCommandMock.mockReset()
    processMultiCommandMock.mockImplementation(async () => false)
    sendChatMock.mockClear()
    sendChatGateQueue.splice(0)
    generationGateBox.current = Promise.resolve()
    doingChatMock.set(false)
    isExpTranslatorMock.mockReset()
    isExpTranslatorMock.mockReturnValue(false)
    translateMock.mockReset()
    translateMock.mockResolvedValue('')
    postChatFileMock.mockReset()
    postChatFileMock.mockResolvedValue([])
})

describe('switching chats shows the other chat\'s own composer', () => {
    test('another character shows an empty composer after typing, staging a file and translating in the previous one', async () => {
        translateMock.mockResolvedValueOnce('A-translated')
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB], { useAutoTranslateInput: true })

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'A-text')
        await settle()
        // Setup: the translation this scenario also stages resolves quickly.
        await waitFor(() => translateMock.mock.calls.length > 0)
        await settle()

        postChatFileMock.mockResolvedValueOnce([{ type: 'asset', data: 'staged-a.png' }])
        openComposerMenu(target)
        clickMenuItemByLabel(target, language.postFile)
        await waitFor(() => postChatFileMock.mock.calls.length > 0)
        await settle()

        // Sanity: A really did stage all three values before the switch.
        expect(mainTextarea(target).value).toBe('A-text')
        expect(translateTextarea(target)?.value).toBe('A-translated')
        expect(stagedFilePreviews(target).length).toBe(1)

        selectedCharID.set(1)
        await settle()

        expect(mainTextarea(target).value).toBe('')
        expect(translateTextarea(target)?.value).toBe('')
        expect(stagedFilePreviews(target).length).toBe(0)

        sendButton(target).click()
        await waitFor(() => !isComposerBusy())
        await settle()

        expect(liveChar(1).chats[0].message.some((m: any) => m.data === 'A-text')).toBe(false)

        selectedCharID.set(0)
        await settle()
        expect(mainTextarea(target).value).toBe('A-text')
        expect(translateTextarea(target)?.value).toBe('A-translated')
        expect(stagedFilePreviews(target).length).toBe(1)
    })

    test('another chat of the same character shows an empty composer after typing in the previous one', async () => {
        const chat0 = makeChat(freshId('chat'), [])
        const chat1 = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chat0, chat1])
        installDb([charA])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'first-chat-text')
        await settle()
        expect(mainTextarea(target).value).toBe('first-chat-text')

        liveChar(0).chatPage = 1
        await settle()

        expect(mainTextarea(target).value).toBe('')
    })
})

describe('returning to the origin chat', () => {
    test('guard: text typed in the origin chat is still there after switching away and back without typing elsewhere', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'origin-text')
        await settle()

        selectedCharID.set(1)
        await settle()
        selectedCharID.set(0)
        await settle()

        expect(mainTextarea(target).value).toBe('origin-text')
    })
})

describe('a freshly created chat starts with an empty composer', () => {
    test('a new chat shown after typing in the previous one starts empty, and the previous chat keeps its text', async () => {
        const oldChat = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [oldChat])
        installDb([charA])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'pre-branch-text')
        await settle()
        expect(mainTextarea(target).value).toBe('pre-branch-text')

        // Stands in for Branch/Copy/New Chat, each of which unshifts a fresh
        // chat and switches to it (Chat.svelte's own branch button does
        // exactly this: `chats.unshift(newChat); changeChatTo(0)`).
        const newChat = makeChat(freshId('chat'), [])
        const char = liveChar(0)
        char.chats.unshift(newChat)
        char.chatPage = 0
        await settle()

        expect(mainTextarea(target).value).toBe('')

        char.chatPage = 1
        await settle()
        expect(mainTextarea(target).value).toBe('pre-branch-text')
    })
})

describe('remounting the composer', () => {
    test('keeps unsent text typed before an unmount visible after a remount', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const { target: target1, instance: instance1 } = mountScreen()
        typeInto(mainTextarea(target1), 'unsent-text')
        await settle()

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        expect(mainTextarea(target2).value).toBe('unsent-text')
    })

    test('guard: a message that was already sent does not reappear after a remount', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const { target: target1, instance: instance1 } = mountScreen()
        typeInto(mainTextarea(target1), 'sent-text')
        await settle()
        sendButton(target1).click()
        await waitFor(() => !isComposerBusy())
        await settle()

        expect(liveChar(0).chats[0].message.some((m: any) => m.data === 'sent-text')).toBe(true)

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        expect(mainTextarea(target2).value).toBe('')
    })
})

describe('a cancelled send puts its values back after a remount', () => {
    test('a cancelled send from a remounted composer restores the original values where the composer is now shown', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { target: target1, instance: instance1 } = mountScreen()
        typeInto(mainTextarea(target1), 'stuck-text')
        pressEnter(mainTextarea(target1)) // drives Send through Enter, not the button
        await first.reached
        expect(isComposerBusy()).toBe(true)

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        const busy = busyButton(target2)
        expect(busy).not.toBeNull()
        busy!.click()
        await settle()

        expect(mainTextarea(target2).value).toBe('stuck-text')
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)

        first.release()
        await settle()
        expect(liveChar(0).chats[0].message.length).toBe(0)
    })
})

describe('a cancelled send puts its values back after a switch', () => {
    test('cancelling a send after switching to another chat does not alter that chat\'s own text', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'A-text')
        sendButton(target).click()
        await first.reached
        // The take clears the composer; the field is empty until the switch.
        expect(mainTextarea(target).value).toBe('')

        selectedCharID.set(1)
        await settle()
        typeInto(mainTextarea(target), 'B-text')
        await settle()

        const busy = busyButton(target)
        expect(busy).not.toBeNull()
        busy!.click()
        await settle()

        expect(mainTextarea(target).value).toBe('B-text')

        first.release()
        await settle()

        selectedCharID.set(0)
        await settle()
        expect(mainTextarea(target).value).toBe('A-text')
    })

    test('a send whose chat is deleted during the wait does not alter the chat switched to during it', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'A-text')
        sendButton(target).click()
        await first.reached

        liveChar(0).chats.splice(0, 1) // the origin chat is gone during the wait

        selectedCharID.set(1)
        await settle()
        typeInto(mainTextarea(target), 'B-text')
        await settle()

        first.release()
        await waitFor(() => !isComposerBusy())
        await settle()

        expect(liveChar(1).chats[0].message.length).toBe(0)
        expect(mainTextarea(target).value).toBe('B-text')
    })
})

describe('the first write fills a missing chat id', () => {
    test('fills a missing id and chaId on the first keystroke into an id-less on-screen chat', async () => {
        const chatA = makeChat(undefined, [])
        const charA = makeCharacter(undefined, [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'first-write')
        await settle()

        expect(typeof liveChar(0).chaId).toBe('string')
        expect(typeof liveChar(0).chats[0].id).toBe('string')
        expect(isWriting({ chaId: liveChar(0).chaId, chatId: liveChar(0).chats[0].id })).toBe(false)
        expect(mainTextarea(target).value).toBe('first-write')

        const filledChaId = liveChar(0).chaId
        const filledChatId = liveChar(0).chats[0].id

        typeInto(mainTextarea(target), 'first-write-more')
        await settle()

        selectedCharID.set(1)
        await settle()
        selectedCharID.set(0)
        await settle()

        // The ids are the SAME strings the first fill produced -- a second
        // fill would mint fresh ones -- and the text typed since the first
        // fill is still under that one key.
        expect(liveChar(0).chaId).toBe(filledChaId)
        expect(liveChar(0).chats[0].id).toBe(filledChatId)
        expect(mainTextarea(target).value).toBe('first-write-more')
    })
})

describe('a late file result after a switch', () => {
    test('a Post File result that resolves after a switch does not land in the chat now on screen', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        let release: (v: Array<{ type: string, data: string }>) => void = () => {}
        const gate = new Promise<Array<{ type: string, data: string }>>((res) => { release = res })
        postChatFileMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        openComposerMenu(target)
        clickMenuItemByLabel(target, language.postFile)
        await waitFor(() => postChatFileMock.mock.calls.length > 0)

        selectedCharID.set(1)
        await settle()
        typeInto(mainTextarea(target), 'B-text')
        await settle()

        release([{ type: 'asset', data: 'late-asset.png' }])
        await settle()
        await settle()

        expect(stagedFilePreviews(target).length).toBe(0)
        expect(mainTextarea(target).value).toBe('B-text')

        selectedCharID.set(0)
        await settle()
        expect(stagedFilePreviews(target).length).toBe(1)
        expect(composerDrafts.peek({ chaId: liveChar(0).chaId, chatId: liveChar(0).chats[0].id }).fileInput).toEqual(['late-asset.png'])
    })

    test('a pasted image result that resolves after a switch does not land in the chat now on screen', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        let release: (v: Array<{ type: string, data: string, name?: string }>) => void = () => {}
        const gate = new Promise<Array<{ type: string, data: string, name?: string }>>((res) => { release = res })
        postChatFileMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        const file = new File([new Uint8Array([1, 2, 3])], 'late.png', { type: 'image/png' })
        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown }
        pasteEvent.clipboardData = {
            items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        }
        mainTextarea(target).dispatchEvent(pasteEvent)
        await waitFor(() => postChatFileMock.mock.calls.length > 0)

        selectedCharID.set(1)
        await settle()
        typeInto(mainTextarea(target), 'B-text')
        await settle()

        release([{ type: 'text', data: 'pasted-content', name: 'late.png' }])
        await settle()
        await settle()

        expect(mainTextarea(target).value).toBe('B-text')

        selectedCharID.set(0)
        await settle()
        expect(mainTextarea(target).value).toBe('{{file::late.png::pasted-content}}')
    })
})

describe('a late translation after a switch', () => {
    test('a translation that resolves after a switch does not land in the chat now on screen', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB], { useAutoTranslateInput: true })

        let release: (v: string) => void = () => {}
        const gate = new Promise<string>((res) => { release = res })
        translateMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'A-text')
        await waitFor(() => translateMock.mock.calls.length > 0)

        selectedCharID.set(1)
        await settle()
        // B's own (untouched) view, before A's translation resolves.
        expect(translateTextarea(target)?.value).toBe('')

        release('A-translated')
        await settle()
        await settle()

        expect(translateTextarea(target)?.value).toBe('')

        selectedCharID.set(0)
        await settle()
        expect(translateTextarea(target)?.value).toBe('A-translated')
    })

    test('guard: a translation whose source text changed before it resolved is discarded', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA], { useAutoTranslateInput: true })

        let release: (v: string) => void = () => {}
        const gate = new Promise<string>((res) => { release = res })
        translateMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'original-text')
        await waitFor(() => translateMock.mock.calls.length > 0)

        // The source field changes before the in-flight translation resolves.
        typeInto(mainTextarea(target), 'edited-text')
        await settle()

        release('stale-translation')
        await settle()
        await settle()

        expect(translateTextarea(target)?.value).toBe('')
    })
})

describe('which composer text holds the multi-tab reload', () => {
    test('does not hold the multi-tab reload open for text left in a chat that is not on screen', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'A-text')
        await settle()
        expect(hasLocalDrafts()).toBe(true)

        selectedCharID.set(1)
        await settle()

        expect(hasLocalDrafts()).toBe(false)
        const action = getMultiTabAction({
            dirty: false,
            now: Date.now(),
            history: { lastAt: null, burst: 0 },
            lastPromptAt: null,
            hasLocalDraft: hasLocalDrafts(),
        })
        expect(action).not.toBe('stay')
    })

    test('guard: text on screen holds the multi-tab reload open', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const { target } = mountScreen()
        expect(hasLocalDrafts()).toBe(false)
        typeInto(mainTextarea(target), 'on-screen-text')
        await settle()

        expect(hasLocalDrafts()).toBe(true)
    })

    test('guard: a stored composer draft never registers as a message-editor draft', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'composer-text')
        await settle()

        expect(hasMessageEditorDrafts()).toBe(false)
    })
})

describe('stopping auto mode from a remounted composer', () => {
    test('stops the auto-mode loop after its current tick when toggled off from a remounted composer', async () => {
        const groupChatA = makeChat(freshId('chat'), [])
        const groupA = makeGroup(freshId('cha'), [groupChatA])
        const otherChat = makeChat(freshId('chat'), [])
        const otherChar = makeCharacter(freshId('cha'), [otherChat])
        installDb([groupA, otherChar])

        const release1 = gateNextGeneration()
        const { target: target1, instance: instance1 } = mountScreen()
        openComposerMenu(target1)
        clickMenuItemByLabel(target1, language.autoMode)
        await waitFor(() => sendChatMock.mock.calls.length >= 1)

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        const release2 = gateNextGeneration()
        openComposerMenu(target2)
        clickMenuItemByLabel(target2, language.autoMode) // attempts to stop the loop from the new instance
        await settle()

        try {
            release1()
            await new Promise((r) => setTimeout(r, 50))
            flushSync()
            expect(sendChatMock.mock.calls.length).toBe(1)
        } finally {
            // Cleanup, regardless of the assertion above: switching the
            // selected character trips `runAutoMode`'s own
            // stop-on-character-change rule, so the loop this test started
            // never keeps running into a later test.
            selectedCharID.set(1)
            release2()
            await waitFor(() => !isComposerBusy(), 3000)
            await settle()
        }
    })
})

describe('aborting generation from a remounted composer', () => {
    test('aborts a send-started generation from the busy button of a remounted composer', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const release = gateNextGeneration()
        const { target: target1, instance: instance1 } = mountScreen()
        typeInto(mainTextarea(target1), 'send-text')
        sendButton(target1).click()
        await waitFor(() => sendChatMock.mock.calls.length >= 1)

        const passedSignal = (sendChatMock.mock.calls.at(-1)?.[1] as { signal?: AbortSignal })?.signal
        expect(passedSignal).toBeDefined()

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        const busy = busyButton(target2)
        expect(busy).not.toBeNull()
        busy!.click()
        await settle()

        expect(passedSignal!.aborted).toBe(true)

        release()
        await waitFor(() => !isComposerBusy())
    })

    test('aborts an auto-mode-started generation from the busy button of a remounted composer', async () => {
        const groupChatA = makeChat(freshId('chat'), [])
        const groupA = makeGroup(freshId('cha'), [groupChatA])
        const otherChat = makeChat(freshId('chat'), [])
        const otherChar = makeCharacter(freshId('cha'), [otherChat])
        installDb([groupA, otherChar])

        const release1 = gateNextGeneration()
        const { target: target1, instance: instance1 } = mountScreen()
        openComposerMenu(target1)
        clickMenuItemByLabel(target1, language.autoMode)
        await waitFor(() => sendChatMock.mock.calls.length >= 1)

        const passedSignal = (sendChatMock.mock.calls.at(-1)?.[1] as { signal?: AbortSignal })?.signal
        expect(passedSignal).toBeDefined()

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        try {
            const busy = busyButton(target2)
            expect(busy).not.toBeNull()
            busy!.click()
            await settle()

            expect(passedSignal!.aborted).toBe(true)
        } finally {
            const release2 = gateNextGeneration()
            release1()
            selectedCharID.set(1) // trips the loop's own stop-on-character-change valve
            release2()
            await waitFor(() => !isComposerBusy(), 3000)
            await settle()
        }
    })
})

describe('id-less chats and same-id replacement', () => {
    test('guard: showing an id-less chat without typing fills no id', async () => {
        const chatA = makeChat(undefined, [])
        const charA = makeCharacter(undefined, [chatA])
        installDb([charA])

        mountScreen()
        await settle()

        expect(liveChar(0).chaId).toBeUndefined()
        expect(liveChar(0).chats[0].id).toBeUndefined()
    })

    test('guard: replacing the on-screen chat object with a same-id clone keeps the draft', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        installDb([charA])

        const { target } = mountScreen()
        typeInto(mainTextarea(target), 'kept-text')
        await settle()

        const sameIdClone = makeChat(liveChar(0).chats[0].id, [...liveChar(0).chats[0].message])
        liveChar(0).chats[0] = sameIdClone
        await settle()

        expect(mainTextarea(target).value).toBe('kept-text')
    })
})

describe('translation late writers, both directions and the experimental path', () => {
    test('a translation started from the translate field resolves after a switch and lands in A\'s main field, not B\'s', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB], { useAutoTranslateInput: true })

        let release: (v: string) => void = () => {}
        const gate = new Promise<string>((res) => { release = res })
        translateMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        typeInto(translateTextarea(target)!, 'A-reverse-text')
        await waitFor(() => translateMock.mock.calls.length > 0)

        selectedCharID.set(1)
        await settle()
        expect(mainTextarea(target).value).toBe('')

        release('A-derived-main-text')
        await settle()
        await settle()

        expect(mainTextarea(target).value).toBe('')

        selectedCharID.set(0)
        await settle()
        expect(mainTextarea(target).value).toBe('A-derived-main-text')
    })

    test('an experimental-translator delayed translation resolves after a switch and lands in A\'s main field, not B\'s', async () => {
        isExpTranslatorMock.mockReturnValue(true)
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB], { useAutoTranslateInput: true })

        let release: (v: string) => void = () => {}
        const gate = new Promise<string>((res) => { release = res })
        translateMock.mockImplementationOnce(() => gate)

        const { target } = mountScreen()
        typeInto(translateTextarea(target)!, 'A-exp-text')
        await waitFor(() => translateMock.mock.calls.length > 0)

        selectedCharID.set(1)
        await settle()
        expect(mainTextarea(target).value).toBe('')

        release('A-exp-derived-text')
        await settle()
        await settle()

        expect(mainTextarea(target).value).toBe('')

        selectedCharID.set(0)
        await settle()
        expect(mainTextarea(target).value).toBe('A-exp-derived-text')
    })
})

describe('the staged file\'s remove button is scoped to the on-screen record', () => {
    test('guard: removing a staged file only changes the on-screen chat\'s record, not another chat\'s', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA])
        const chatB = makeChat(freshId('chat'), [])
        const charB = makeCharacter(freshId('cha'), [chatB])
        installDb([charA, charB])

        composerDrafts.write({ chaId: charB.chaId as string, chatId: chatB.id as string }, (record) => {
            record.fileInput.push('b-staged.png')
        })

        const { target } = mountScreen()
        postChatFileMock.mockResolvedValueOnce([{ type: 'asset', data: 'a-staged.png' }])
        openComposerMenu(target)
        clickMenuItemByLabel(target, language.postFile)
        await waitFor(() => postChatFileMock.mock.calls.length > 0)
        await settle()

        expect(stagedFilePreviews(target).length).toBe(1)

        const removeButtons = stagedFileRemoveButtons(target)
        expect(removeButtons.length).toBe(1)
        removeButtons[0].click()
        await settle()

        expect(stagedFilePreviews(target).length).toBe(0)
        expect(composerDrafts.peek({ chaId: charB.chaId as string, chatId: chatB.id as string }).fileInput).toEqual(['b-staged.png'])
    })
})

describe('a staged file whose asset cannot be loaded', () => {
    test('regression reproducer: a rejected asset shows the file name, warns, raises no unhandled rejection, and its remove button still removes it from the record', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        process.on('unhandledRejection', onUnhandled)
        vi.mocked(getInlayAsset).mockImplementation(async () => { throw new Error('asset gone') })
        try {
            const chatA = makeChat(freshId('chat'), [])
            const charA = makeCharacter(freshId('cha'), [chatA])
            installDb([charA])
            composerDrafts.write({ chaId: charA.chaId as string, chatId: chatA.id as string }, (record) => {
                record.fileInput.push('broken-asset.png')
            })

            const { target } = mountScreen()
            await settle()
            await new Promise((r) => setTimeout(r, 20))
            flushSync()

            expect(unhandled).toEqual([])
            expect(warn).toHaveBeenCalled()
            expect(target.textContent).toContain('broken-asset.png')
            const removeButtons = stagedFileRemoveButtons(target)
            expect(removeButtons.length).toBe(1)

            removeButtons[0].click()
            await settle()

            expect(composerDrafts.peek({ chaId: charA.chaId as string, chatId: chatA.id as string }).fileInput).toEqual([])
            expect(target.textContent).not.toContain('broken-asset.png')
        } finally {
            process.off('unhandledRejection', onUnhandled)
            warn.mockRestore()
            vi.mocked(getInlayAsset).mockImplementation((async () => ({ type: 'image', data: '' })) as never)
        }
    })
})

describe('a sticker append', () => {
    test('guard: selecting a sticker appends it to the on-screen chat\'s record', async () => {
        const chatA = makeChat(freshId('chat'), [])
        const charA = makeCharacter(freshId('cha'), [chatA], {
            additionalAssets: [['sticker-1', 'assets/sticker-1.png', 'png']],
        })
        installDb([charA], { useChatSticker: true })

        const { target } = mountScreen()
        const laughToggle = target.querySelector('svg.lucide-laugh')?.closest('div')
        expect(laughToggle).not.toBeNull()
        ;(laughToggle as HTMLElement).click()
        await settle()

        const pickerButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('.ml-4.flex.flex-wrap button'))
        // Index 0 is AssetInput's own "+" (add) button; index 1 is the
        // sticker button this fixture's single additionalAsset produces.
        expect(pickerButtons.length).toBe(2)
        pickerButtons[1].click()
        await settle()

        expect(mainTextarea(target).value).toBe(
            "<span class='notranslate' translate='no'>{{img::sticker-1}}</span> *sticker-1 added*"
        )
    })
})

describe('auto mode stays visible as running across a remount', () => {
    test('a remounted composer shows a running auto mode as running', async () => {
        const groupChatA = makeChat(freshId('chat'), [])
        const groupA = makeGroup(freshId('cha'), [groupChatA])
        installDb([groupA])

        const release = gateNextGeneration()
        const { target: target1, instance: instance1 } = mountScreen()
        openComposerMenu(target1)
        clickMenuItemByLabel(target1, language.autoMode)
        await waitFor(() => sendChatMock.mock.calls.length >= 1)

        await unmountScreen(instance1)
        const { target: target2 } = mountScreen()
        await settle()

        const busy = busyButton(target2)
        expect(busy).not.toBeNull()
        const indicator = busy!.querySelector('.loadmove')
        expect(indicator?.classList.contains('autoload')).toBe(true)

        openComposerMenu(target2)
        clickMenuItemByLabel(target2, language.autoMode) // stops the loop
        release()
        await waitFor(() => !isComposerBusy(), 3000)
        await settle()
    })
})

describe('the notice for an archived chat that cannot be loaded', () => {
    const KEY = 'chat-unit-key'
    type PreLoadResult = Awaited<ReturnType<typeof preLoadChat>>
    type RetryResult = Awaited<ReturnType<typeof retryLegacyColdChatLoad>>

    afterEach(() => {
        vi.mocked(preLoadChat).mockResolvedValue('ok')
        vi.mocked(retryLegacyColdChatLoad).mockResolvedValue('ok')
    })

    async function openPointerChat(result: PreLoadResult): Promise<HTMLElement> {
        vi.mocked(preLoadChat).mockResolvedValue(result)
        const chat = makeChat(freshId('chat'), [makeMessage('char', coldStorageHeader + KEY)])
        installDb([makeCharacter(freshId('cha'), [chat])])
        const { target } = mountScreen()
        await waitFor(() => vi.mocked(preLoadChat).mock.calls.length > 0)
        await settle()
        return target
    }

    function retryButton(target: HTMLElement): HTMLButtonElement | undefined {
        return Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.errors.coldStorageLegacyChatRetryButton)
    }

    async function openLegacyChat(): Promise<HTMLElement> {
        const chat = makeChat(freshId('chat'), [makeMessage('char', formatColdStorageLoadError(KEY))])
        installDb([makeCharacter(freshId('cha'), [chat])])
        const { target } = mountScreen()
        await settle()
        return target
    }

    async function pressRetry(target: HTMLElement, result: RetryResult): Promise<void> {
        vi.mocked(retryLegacyColdChatLoad).mockResolvedValue(result)
        const button = retryButton(target)
        expect(button).toBeDefined()
        button!.click()
        await waitFor(() => vi.mocked(retryLegacyColdChatLoad).mock.calls.length > 0)
        await settle()
    }

    test('first open with no storage on the page shows the no-storage text for that key, not the temporary-problem text', async () => {
        const target = await openPointerChat('unavailable')

        const text = target.textContent ?? ''
        expect(text).toMatch(/offers no storage/i)
        expect(text).not.toMatch(/temporary/i)
        expect(text).toContain(language.errors.coldStorageChatUnavailable(KEY))
    })

    test('first open with a damaged copy shows the damaged text for that key, not the temporary-problem text', async () => {
        const target = await openPointerChat('damaged')

        const text = target.textContent ?? ''
        expect(text).toMatch(/may be damaged/i)
        expect(text).not.toMatch(/temporary/i)
        expect(text).toContain(language.errors.coldStorageChatDamaged(KEY))
    })

    test('guard: first open with a plain read error shows the temporary-problem text', async () => {
        const target = await openPointerChat('error')

        expect(target.textContent).toContain(language.errors.coldStorageChatLoadFailed(KEY))
    })

    test('guard: first open with a missing unit shows the not-found text', async () => {
        const target = await openPointerChat('missing')

        expect(target.textContent).toContain(language.errors.coldStorageChatDataMissing(KEY))
    })

    test('guard: first open with a loaded chat shows no notice', async () => {
        const target = await openPointerChat('ok')

        const text = target.textContent ?? ''
        expect(text).not.toContain(language.errors.coldStorageChatLoadFailed(KEY))
        expect(text).not.toContain(language.errors.coldStorageChatDataMissing(KEY))
    })

    test('guard: a legacy error-text chat offers the Retry button with the retry invitation before any retry', async () => {
        const target = await openLegacyChat()

        expect(target.textContent).toContain(language.errors.coldStorageLegacyChatRetryNotice)
        expect(retryButton(target)).toBeDefined()
    })

    test.each([
        ['unavailable', () => language.errors.coldStorageLegacyChatUnavailable, /offers no storage/i],
        ['damaged', () => language.errors.coldStorageLegacyChatDamaged, /may be damaged/i],
    ] as const)('a retry that finds %s replaces the notice with that text, hides the Retry button and never says to try later', async (result, expectedText, wording) => {
        const target = await openLegacyChat()

        await pressRetry(target, result)

        const text = target.textContent ?? ''
        expect(text).toMatch(wording)
        expect(text).toContain(expectedText())
        expect(text).not.toContain(language.errors.coldStorageLegacyChatRetryNotice)
        expect(text).not.toContain(language.errors.coldStorageLegacyChatRetryFailed)
        expect(retryButton(target)).toBeUndefined()
    })

    test.each(['error', 'busy'] as const)('guard: a retry that ends %s keeps the Retry button and adds the try-later line', async (result) => {
        const target = await openLegacyChat()

        await pressRetry(target, result)

        expect(target.textContent).toContain(language.errors.coldStorageLegacyChatRetryNotice)
        expect(target.textContent).toContain(language.errors.coldStorageLegacyChatRetryFailed)
        expect(retryButton(target)).toBeDefined()
    })

    test('guard: while a retry is pending the Retry button is disabled and a second press starts no second retry', async () => {
        const target = await openLegacyChat()
        let finish: (result: RetryResult) => void = () => {}
        vi.mocked(retryLegacyColdChatLoad).mockClear()
        vi.mocked(retryLegacyColdChatLoad).mockReturnValue(new Promise<RetryResult>((resolve) => { finish = resolve }))

        retryButton(target)!.click()
        await settle()

        expect(vi.mocked(retryLegacyColdChatLoad)).toHaveBeenCalledTimes(1)
        expect(retryButton(target)?.disabled).toBe(true)
        retryButton(target)!.click()
        await settle()
        expect(vi.mocked(retryLegacyColdChatLoad)).toHaveBeenCalledTimes(1)

        finish('error')
        await settle()
        expect(retryButton(target)?.disabled).toBe(false)
    })

    test('guard: while a reply is being generated the Retry button is disabled', async () => {
        const target = await openLegacyChat()
        expect(retryButton(target)?.disabled).toBe(false)

        doingChatMock.set(true)
        await settle()

        expect(retryButton(target)?.disabled).toBe(true)
    })

    test('guard: a retry that finds the unit missing shows the not-found text and hides the Retry button', async () => {
        const target = await openLegacyChat()

        await pressRetry(target, 'missing')

        expect(target.textContent).toContain(language.errors.coldStorageLegacyChatDataMissing)
        expect(target.textContent).not.toContain(language.errors.coldStorageLegacyChatRetryNotice)
        expect(retryButton(target)).toBeUndefined()
    })
})
