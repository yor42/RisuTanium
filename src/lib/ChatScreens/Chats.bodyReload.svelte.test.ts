// @vitest-environment happy-dom

/**
 * The real `Chats.svelte` mounts one real `Chat` (and `ChatBody`) per message hash; a changed hash mounts a new `Chat`
 * before the old one is unmounted, so a `ReloadChatPointer` bump remounts the body above the `{#key}` of `Chat`. The
 * parser and the translator are held doubles that give every call a fresh deferred (the doomed body and the new one
 * both parse after a bump). The body is sampled once per macrotask while the new parse is unanswered.
 *
 * Labels: R = regression reproducer (the base samples an empty body), G = guard (passes before and after).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addActiveStream, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import Chat from './Chat.svelte'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
    reject: (error: Error) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    translations: [] as Held[],
    // 'hold' gives every ParseMarkdown call a fresh deferred; 'reject' fails the call at once.
    parseMode: 'hold' as 'hold' | 'reject',
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn((...args: unknown[]) => {
        if (h.parseMode === 'reject') {
            return Promise.reject(new Error('parse failed'))
        }
        return new Promise<string>((resolve, reject) => { h.parses.push({ args, resolve, reject }) })
    }),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
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
            const char = (stores.DBState as unknown as { db: any }).db.characters[
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
    translateHTML: vi.fn((...args: unknown[]) => new Promise<string>((resolve, reject) => { h.translations.push({ args, resolve, reject }) })),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
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
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
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

// wasmoon cannot load under happy-dom; the button and form scripts are not part of these rows.
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

function makeChat(id: string, overrides: Record<string, unknown> = {}): ChatData {
    return {
        id,
        message: [] as unknown[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as ChatData
}

function makeCharacter(chaId: string, chats: ChatData[], overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        modules: [] as string[],
        ...overrides,
    } as unknown as character
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        ...overrides,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

/** One macrotask of the body's markup: text and html of the message body span. */
async function sampleBody(target: HTMLElement, selector = '.chattext') {
    flushSync()
    await tick()
    await wait(0)
    await tick()
    const bodies = [...target.querySelectorAll(selector)]
    return {
        text: bodies.map((b) => b.textContent ?? '').join('|'),
        html: bodies.map((b) => b.innerHTML).join('|'),
        indicators: target.querySelectorAll(`${selector} [role="status"]`).length,
    }
}

async function answerParse(index: number, text: string) {
    h.parses[index].resolve(text)
    await wait(0)
    await tick()
}

async function answerTranslation(index: number, text: string) {
    h.translations[index].resolve(text)
    await wait(20)
    await tick()
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    selIdState.selId = 0
    h.parses.length = 0
    h.translations.length = 0
    h.parseMode = 'hold'
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

//#endregion

interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, interrupted?: boolean }

let stopGuiReset: () => void = () => {}

beforeEach(() => {
    // The real store resets the chat pointer in the first subscriber of the GUI pointer.
    stopGuiReset = ReloadGUIPointer.subscribe(() => { ReloadChatPointer.set({}) })
})

afterEach(() => {
    stopGuiReset()
    resetActiveStreamsForTest()
})

function mountChats(messages: LiveMessage[], dbOverrides: Record<string, unknown> = {}) {
    DBState.db = baseDb(dbOverrides) as never
    DBState.db.characters = [makeCharacter('a', [makeChat('cA', { message: messages })], { image: '' })] as never
    const live = (DBState.db.characters as unknown as Array<{ chats: Array<{ message: LiveMessage[], isStreaming?: boolean }> }>)[0]
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chats, {
        target,
        props: {
            messages: live.chats[0].message as never,
            currentCharacter: live as never,
            onReroll: () => {},
            unReroll: () => {},
            currentUsername: 'User',
            userIcon: '',
            loadPages: 10,
        },
    })
    mountedInstances.push(instance)
    flushSync()
    return { target, chat: live.chats[0] }
}

/** Mounts one message, answers its parse and returns once it shows `P:<text>`. */
async function renderedMessage(text = 'FIRST') {
    const mountedChats = mountChats([{ role: 'char', data: text }])
    await wait(20)
    await answerParse(0, `P:${text}`)
    expect((await sampleBody(mountedChats.target)).text).toContain(`P:${text}`)
    return mountedChats
}

describe('S3 a Chats-level remount keeps what the body showed', () => {
    test('R T6c row 1: a chat-pointer bump of the index never blanks the body', async () => {
        const { target } = await renderedMessage()
        ReloadChatPointer.update((v) => { v[0] = 1; return v })
        const held = await sampleBody(target)
        expect(h.parses.length).toBeGreaterThan(1)
        expect(held.text).toContain('P:FIRST')

        await answerParse(h.parses.length - 1, 'P:SECOND')
        expect((await sampleBody(target)).text).toContain('P:SECOND')
    })

    test('R T6c row 2: a GUI bump after a nonzero chat pointer never blanks the body', async () => {
        const { target } = await renderedMessage()
        ReloadChatPointer.update((v) => { v[0] = 1; return v })
        await sampleBody(target)
        await answerParse(h.parses.length - 1, 'P:FIRST')
        expect((await sampleBody(target)).text).toContain('P:FIRST')

        ReloadGUIPointer.update((v) => v + 1)
        const held = await sampleBody(target)
        expect(held.text).toContain('P:FIRST')
    })

    test('R T6d: with auto-translate on, a remount keeps the translated content', async () => {
        DBState.db = baseDb() as never
        const settings = {
            autoTranslate: true, translatorType: 'google', translator: 'ko', translatorInputLanguage: 'en',
            showTranslationLoading: false,
        }
        const first = mountChats([{ role: 'char', data: 'FIRST' }])
        Object.assign(DBState.db, settings)
        // The first run decides to translate and flips `translated`; the second run translates.
        ReloadChatPointer.update((v) => { v[0] = 1; return v })
        await wait(60)
        h.parses.length = 0
        h.translations.length = 0
        ReloadChatPointer.update((v) => { v[0] = 2; return v })
        await wait(60)
        await answerParse(h.parses.length - 1, 'P:FIRST')
        await wait(30)
        await answerTranslation(h.translations.length - 1, 'T:P:FIRST')
        expect((await sampleBody(first.target)).text).toContain('T:P:FIRST')

        ReloadChatPointer.update((v) => { v[0] = 3; return v })
        const held = await sampleBody(first.target)
        expect(held.text).toContain('T:P:FIRST')
        await wait(40)
        expect((await sampleBody(first.target)).text).toContain('T:P:FIRST')
    })
})

describe('S3 boundary: a source change plus a remount shows the indicator, never the old html', () => {
    test('R T22 row 1: an edited last message shows the indicator until the new parse resolves', async () => {
        const { target, chat } = await renderedMessage()
        chat.message[0].data = 'EDITED'
        ReloadChatPointer.update((v) => { v[0] = 1; return v })
        const held = await sampleBody(target)
        expect(held.indicators).toBeGreaterThan(0)
        expect(held.text).not.toContain('P:FIRST')

        await answerParse(h.parses.length - 1, 'P:EDITED')
        const after = await sampleBody(target)
        expect(after.text).toContain('P:EDITED')
        expect(after.indicators).toBe(0)
    })

    test('G T22 row 2: the old html is never shown for an edited message', async () => {
        const { target, chat } = await renderedMessage()
        chat.message[0].data = 'EDITED'
        const held = await sampleBody(target)
        expect(held.text).not.toContain('P:FIRST')
    })

    test('G T22 row 3: the streaming reply is not given an indicator per chunk', async () => {
        const { target, chat } = await renderedMessage()
        chat.isStreaming = true
        for (const chunk of ['FIRST a', 'FIRST ab', 'FIRST abc']) {
            chat.message[0].data = chunk
            const held = await sampleBody(target)
            expect(held.indicators).toBe(0)
            expect(held.text).not.toContain('P:FIRST')
        }
    })

    test('R T22 row 4: a message before the streaming tail still gets the indicator', async () => {
        const mountedChats = mountChats([{ role: 'user', data: 'FIRST' }, { role: 'char', data: 'TAIL' }])
        await wait(20)
        for (const parse of h.parses.slice()) {
            parse.resolve(`P:${parse.args[0] as string}`)
        }
        await wait(20)
        const { target, chat } = mountedChats
        chat.isStreaming = true
        chat.message[0].data = 'EDITED'
        const held = await sampleBody(target)
        expect(held.indicators).toBeGreaterThan(0)
    })
})

//#region S5: the streaming tail waits for its reply to end before it auto-translates

const AUTO_TRANSLATE = {
    autoTranslate: true, translatorType: 'google', translator: 'ko', translatorInputLanguage: 'en',
    showTranslationLoading: false,
}

type LiveChat = ReturnType<typeof mountChats>['chat']

/** Answers every parse and translation asked so far, a few rounds, so a decision run, its rerun and the translation all land. */
async function answerEverything(rounds = 4) {
    for (let round = 0; round < rounds; round++) {
        for (const parse of h.parses.slice()) {
            parse.resolve(`P:${parse.args[0] as string}`)
        }
        for (const translation of h.translations.slice()) {
            translation.resolve(`T:${translation.args[0] as string}`)
        }
        await wait(30)
        await tick()
    }
}

/** The producer's pair: the registry entry and `isStreaming` are written in the same synchronous block. */
function startStream(chat: LiveChat, replyChatId: string) {
    const remove = addActiveStream({ chaId: 'a', replyChatId })
    chat.isStreaming = true
    return remove
}

function endStream(chat: LiveChat, remove: () => void) {
    remove()
    chat.isStreaming = false
}

/** The mounted row containers by message index: the document lists the newest row first. */
function rowNodes(target: HTMLElement) {
    return [...target.querySelectorAll('.chat-message-container')].reverse()
}

/** The body texts by message index, from a `sampleBody` result. */
const rowTexts = (held: { text: string }) => held.text.split('|').reverse()

const replyPair = (): LiveMessage[] => [
    { role: 'user', data: 'U', chatId: 'u1' },
    { role: 'char', data: 'C', chatId: 'c1' },
]

describe('S5 the Chats tail defers auto-translate while its reply streams', () => {
    test.each(['off', 'normal'] as const)('R T5.4 mode %s: no translation during the stream, exactly one after it, of the final text', async (mode) => {
        const { target, chat } = mountChats(replyPair(), { ...AUTO_TRANSLATE, streamingDisplayOptimizationMode: mode })
        await wait(20)
        await answerEverything()
        h.translations.length = 0

        const remove = startStream(chat, 'c1')
        for (const chunk of ['C a', 'C ab']) {
            chat.message[1].data = chunk
            await wait(40)
            for (const parse of h.parses.slice()) {
                parse.resolve(`P:${parse.args[0] as string}`)
            }
            await wait(40)
        }
        expect(h.translations).toHaveLength(0)

        endStream(chat, remove)
        await wait(40)
        await answerEverything()
        expect(h.translations).toHaveLength(1)
        expect(h.translations[0].args[0]).toBe('P:C ab')
        expect((await sampleBody(target)).text).toContain('T:P:C ab')
    })

    test('R T5.5 an aborted reply in mode off translates its partial text exactly once', async () => {
        const { target, chat } = mountChats(replyPair(), { ...AUTO_TRANSLATE })
        await wait(20)
        await answerEverything()
        h.translations.length = 0

        const remove = startStream(chat, 'c1')
        chat.message[1].data = 'C part'
        await wait(40)
        await answerEverything(2)
        expect(h.translations).toHaveLength(0)

        chat.message[1].interrupted = true
        endStream(chat, remove)
        await wait(40)
        await answerEverything()
        expect(h.translations).toHaveLength(1)
        expect(h.translations[0].args[0]).toBe('P:C part')
        expect((await sampleBody(target)).text).toContain('T:P:C part')
    })

    test('G T5.6 the row before the streaming tail keeps its translation and is not re-mounted', async () => {
        const { target, chat } = mountChats(replyPair(), { ...AUTO_TRANSLATE })
        await wait(20)
        await answerEverything()
        const first = rowNodes(target)[0]
        expect(rowTexts(await sampleBody(target))[0]).toContain('T:P:U')

        const remove = startStream(chat, 'c1')
        for (const chunk of ['C a', 'C ab']) {
            chat.message[1].data = chunk
            await wait(40)
            await answerEverything(2)
        }
        expect(rowNodes(target)[0]).toBe(first)
        expect(rowTexts(await sampleBody(target))[0]).toContain('T:P:U')
        endStream(chat, remove)
    })

    test('G T5.14 a registered reply that is not at the last index is never deferred or re-mounted', async () => {
        const { target, chat } = mountChats([
            { role: 'char', data: 'C', chatId: 'c1' },
            { role: 'user', data: 'U', chatId: 'u1' },
        ], { ...AUTO_TRANSLATE })
        await wait(20)
        await answerEverything()
        const nodes = rowNodes(target)

        const remove = startStream(chat, 'c1')
        await wait(40)
        expect(rowNodes(target)[0]).toBe(nodes[0])
        endStream(chat, remove)
        await wait(40)
        expect(rowNodes(target)[0]).toBe(nodes[0])
    })

    test('G T5.8 auto-translate off: the stream start and end change no hash, no parse and no translation', async () => {
        const { target, chat } = mountChats(replyPair(), { streamingDisplayOptimizationMode: 'off' })
        await wait(20)
        await answerEverything()
        const tail = rowNodes(target)[1]
        const parsesBefore = h.parses.length

        const remove = startStream(chat, 'c1')
        await wait(40)
        expect(rowNodes(target)[1]).toBe(tail)
        endStream(chat, remove)
        await wait(40)
        await answerEverything()
        expect(rowNodes(target)[1]).toBe(tail)
        expect(h.parses.length).toBe(parsesBefore)
        expect(h.translations).toHaveLength(0)
    })

    test.each(['char', 'user'] as const)('G T5.12 a stream flag with no registered reply and a %s tail: no remount at the flip, no extra translation', async (tailRole) => {
        const { target, chat } = mountChats([
            { role: tailRole === 'char' ? 'user' : 'char', data: 'U', chatId: 'u1' },
            { role: tailRole, data: 'C', chatId: 'c1' },
        ], { ...AUTO_TRANSLATE })
        await wait(20)
        await answerEverything()
        const tail = rowNodes(target)[1]
        const translationsBefore = h.translations.length

        chat.isStreaming = true
        await wait(40)
        expect(rowNodes(target)[1]).toBe(tail)
        chat.isStreaming = false
        await wait(40)
        await answerEverything()
        expect(rowNodes(target)[1]).toBe(tail)
        expect(h.translations.length).toBe(translationsBefore)
    })

    test('G T5.13 a Chat mounted outside Chats with the bookmark list props translates the final text after the stream ends', async () => {
        DBState.db = baseDb({ ...AUTO_TRANSLATE }) as never
        DBState.db.characters = [makeCharacter('a', [makeChat('cA', { message: replyPair() })], { image: '' })] as never
        const live = (DBState.db.characters as unknown as Array<{ chats: Array<{ message: LiveMessage[], isStreaming?: boolean }> }>)[0].chats[0]
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        const instance = mount(Chat, {
            target,
            props: {
                idx: 1,
                get message() { return live.message[1].data },
                set message(_value: string) {},
                name: 'A',
                img: '',
                role: 'char',
                rerollIcon: false,
                character: { name: 'A' },
                isLastMemory: false,
                expectedId: 'c1',
            } as never,
        })
        mountedInstances.push(instance)
        flushSync()
        await wait(20)
        await answerEverything()

        const remove = startStream(live as never, 'c1')
        live.message[1].data = 'C a'
        await wait(40)
        await answerEverything(2)
        endStream(live as never, remove)
        await wait(40)
        await answerEverything()
        expect((await sampleBody(target)).text).toContain('T:P:C a')
    })

    test('G SEED mode off, auto-translate on: the tail is replaced at the end and shows the parse until the translation lands', async () => {
        const { target, chat } = mountChats(replyPair(), { ...AUTO_TRANSLATE, streamingDisplayOptimizationMode: 'off' })
        await wait(20)
        await answerEverything()
        const remove = startStream(chat, 'c1')
        chat.message[1].data = 'C ab'
        await wait(40)
        await answerEverything(2)
        h.translations.length = 0
        const tail = rowNodes(target)[1]

        endStream(chat, remove)
        const samples: Array<{ text: string, indicators: number }> = []
        for (let i = 0; i < 6; i++) {
            const held = await sampleBody(target)
            samples.push({ text: rowTexts(held)[1] ?? '', indicators: held.indicators })
            for (const parse of h.parses.slice()) {
                parse.resolve(`P:${parse.args[0] as string}`)
            }
        }
        expect(rowNodes(target)[1]).not.toBe(tail)
        for (const sample of samples) {
            expect(sample.indicators).toBe(0)
            expect(sample.text).toContain('P:C ab')
        }
        await answerEverything()
        expect((await sampleBody(target)).text).toContain('T:P:C ab')
    })
})

//#endregion
