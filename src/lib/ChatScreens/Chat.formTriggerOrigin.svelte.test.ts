// @vitest-environment happy-dom

/**
 * Mounts the real `Chat.svelte` and `ChatBody.svelte` and submits a
 * `risu-form` form through a real DOM event. `handleFormTriggerWithin` must
 * follow the button path's origin discipline: the run is registered, the
 * origin travels to the Lua run, and the chat on screen is never replaced by
 * the run's result.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn(async (text: string) => text ?? ''),
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
        createSimpleCharacter: vi.fn(() => null),
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
    translateHTML: vi.fn(async (html: string) => html),
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

// Stubbed out entirely -- not exercised by this file's trigger/button logic,
// and it independently duplicates PartialEditController's edit surface.
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

// The Lua engine cannot load under happy-dom (wasmoon's loader), so the form
// run is a gate standing in for the script's own await. The engine's origin
// handling is covered by the node-environment suite.
const luaFormGate = { resolve: () => {} }

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
    runLuaInteractionTrigger: vi.fn(async () => {
        await new Promise<void>((res) => { luaFormGate.resolve = res })
        return { stopSending: false, res: undefined }
    }),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chat from './Chat.svelte'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'
import { setCurrentChat } from 'src/ts/storage/database.svelte'
import { runLuaInteractionTrigger } from 'src/ts/process/scriptings'
// Not mocked: `handleFormTriggerWithin`'s own `beginWork`/`end()` are real.
import { isWriting } from 'src/ts/process/chatOrigin'

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
        modules: [], templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [],
        ...overrides,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountChat(props: Record<string, unknown> & { isLastMemory: boolean }) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props })
    mountedInstances.push(instance)
    flushSync()
    // ChatBody's message body renders through an async `{#await}` (real
    // ParseMarkdown, mocked but still a Promise) -- let it settle before a
    // caller looks for rendered trigger markup.
    await new Promise((r) => setTimeout(r, 20))
    flushSync()
    return { target, instance }
}

async function settle(ms = 60) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
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
})

//#endregion

const FORM_HTML = '<form risu-form="send"><input name="a" value="1"><button type="submit">go</button></form>'

function submit(form: HTMLFormElement): SubmitEvent {
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    return event
}

describe('A risu-form submit through Chat.svelte\'s handler', () => {
    test('a chat switch during the script\'s await does not replace the chat on screen, and the origin travels to the run', async () => {
        const a1 = makeChat('a1')
        a1.message.push({ role: 'char', data: FORM_HTML })
        const a2 = makeChat('a2', { message: [{ role: 'user', data: 'a2-message' }] })
        const char = makeCharacter('char-form', [a1, a2])
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveChar = DBState.db.characters[0]

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const form = target.querySelector<HTMLFormElement>('form[risu-form="send"]')
        expect(form).not.toBeNull()
        const event = submit(form!)
        expect(event.defaultPrevented).toBe(true)

        const call = vi.mocked(runLuaInteractionTrigger).mock.calls[0]
        expect(call[0]).toBe('form')
        expect(call[2]).toBe('send')
        expect(call[3]).toEqual({ data: { a: '1' } })
        const origin = call[4] as { chaId: string, chatId: string }
        expect(origin.chaId).toBe('char-form')
        expect(isWriting({ chaId: origin.chaId, chatId: origin.chatId })).toBe(true)

        liveChar.chatPage = 1 // the selection moves during the script's await
        luaFormGate.resolve()
        await settle(60)

        expect(setCurrentChat).not.toHaveBeenCalled()
        const finalChats = (DBState.db.characters[0] as character).chats as { id: string, message: { data: string }[] }[]
        expect(finalChats.map((c) => c.id)).toEqual(['a1', 'a2'])
        expect(finalChats[1].message[0].data).toBe('a2-message')
        expect(isWriting({ chaId: origin.chaId, chatId: origin.chatId })).toBe(false)
    })

    test('a form without risu-form still has its submit prevented and starts no run', async () => {
        const a1 = makeChat('a1')
        a1.message.push({ role: 'char', data: '<form><input name="a" value="1"></form>' })
        const char = makeCharacter('char-plainform', [a1])
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const form = target.querySelector<HTMLFormElement>('form')
        expect(form).not.toBeNull()
        const event = submit(form!)

        expect(event.defaultPrevented).toBe(true)
        expect(runLuaInteractionTrigger).not.toHaveBeenCalled()
    })
})
