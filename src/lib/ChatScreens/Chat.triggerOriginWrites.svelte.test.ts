// @vitest-environment happy-dom

/**
 * W1a `Chat.svelte` suite: mounts the REAL `Chat.svelte` and the
 * REAL `ChatBody.svelte` (so a message's `risu-trigger`/`risu-btn` markup
 * actually renders and is clickable), driving `handleButtonTriggerWithin`
 * through real DOM clicks against the REAL `runTrigger` (`./triggers.ts`)
 * and a REAL `$state` `DBState.db`. Follows
 * `Chat.messageEditor.svelte.test.ts`'s mount pattern, but does NOT mock
 * `src/ts/process/triggers` -- it is the module under test.
 *
 * `src/ts/process/scriptings`'s `runLuaButtonTrigger` IS mocked here, as the
 * one deliberate exception: wasmoon's WASM loader calls Node's
 * `createRequire(import.meta.url)`, which throws under `happy-dom` (Vite
 * rewrites `import.meta.url` to a fake `http://localhost` origin there, not a
 * real file path) -- confirmed against this repo's `scriptings.test.ts`,
 * which needs `@vitest-environment node` for that exact reason, incompatible
 * with mounting a Svelte component. The mock does NOT reproduce the real
 * function's own resolution mechanism (which takes an origin and re-resolves
 * through it on every access, ignoring the mock's `origin` argument
 * entirely): it captures `getCurrentChat()` once, at the click, before its
 * own await (a hand-controlled gate standing in for the script's
 * `:await()`), then writes directly onto that captured chat object -- the
 * same "read once, held across a yield" shape as the real risk this file
 * cares about, but resolved through the OLD, selection-based mechanism, not
 * the real one. So this file's own assertions are narrowed to what
 * `Chat.svelte` itself is responsible for regardless of which chat the
 * script's write actually lands on: it does not replace the chat on screen,
 * and it never lets two chats share one id. The engine suite
 * (`triggerOriginWrites.svelte.test.ts`, `@vitest-environment node`) is where
 * `runLuaButtonTrigger` itself, and its real origin-based resolution, run
 * unmocked.
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

// See the file header: the one deliberate mock, forced by the
// wasmoon/happy-dom environment conflict. `luaButtonGate` lets a test control
// exactly when the "script" resolves, standing in for a real `:await()`.
const luaButtonGate = { resolve: () => {} }

vi.mock(import('src/ts/process/scriptings'), async () => {
    const database = await import('src/ts/storage/database.svelte')
    return {
        runLuaButtonTrigger: vi.fn(async () => {
            const chat = database.getCurrentChat()
            await new Promise<void>((res) => { luaButtonGate.resolve = res })
            ;(chat as { message: unknown[] }).message.push({ role: 'user', data: 'lua-added-message' })
            return { stopSending: false, chat, res: undefined }
        }),
    } as unknown as typeof import('src/ts/process/scriptings')
})

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chat from './Chat.svelte'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'
import type { triggerscript, triggerEffect } from 'src/ts/process/triggers'
// Not mocked in this file (see the header) -- `handleButtonTriggerWithin`'s
// own `beginWork`/`workHandle.end()` are real.
import { isWriting } from 'src/ts/process/chatOrigin'

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

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

describe('A manual trigger\'s setVar, through Chat.svelte\'s handler', () => {
    test('a chat switch during the wait leaves the other chat\'s scriptstate untouched', async () => {
        const a1 = makeChat('a1')
        const a2 = makeChat('a2')
        a1.message.push({ role: 'char', data: '<button risu-trigger="waitset" risu-id="t1">Click</button>' })
        const char = makeCharacter('char-c25', [a1, a2])
        char.triggerscript.push(trig('waitset', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'x', valueType: 'value', value: '1' }),
        ]))
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        // Every further read/write goes through the LIVE reactive proxy, not
        // the plain objects above -- Svelte's $state does not mirror
        // mutations onto the original raw object (see
        // Chat.messageEditor.svelte.test.ts for the same pin).
        const liveChar = DBState.db.characters[0]

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="waitset"]')
        expect(button).not.toBeNull()
        button!.click()

        liveChar.chatPage = 1 // the selection moves to A2 of the same character, during the wait
        await settle()

        expect(liveChar.chats[0].scriptstate['$x']).toBe('1')
        expect(liveChar.chats[1].scriptstate['$x']).toBeUndefined()
    })

    test('a switch to a different character during the wait leaves that character untouched', async () => {
        const a1 = makeChat('a1')
        a1.message.push({ role: 'char', data: '<button risu-trigger="waitset2" risu-id="t1">Click</button>' })
        const charC = makeCharacter('char-c25b', [a1])
        charC.triggerscript.push(trig('waitset2', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'x', valueType: 'value', value: '1' }),
        ]))
        const bChat = makeChat('b1')
        const charB = makeCharacter('char-b', [bChat])
        DBState.db = baseDb() as never
        DBState.db.characters = [charC, charB] as never
        selIdState.selId = 0
        selectedCharID.set(0)
        const liveCharC = DBState.db.characters[0]
        const liveCharB = DBState.db.characters[1]

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="waitset2"]')
        expect(button).not.toBeNull()
        button!.click()

        selIdState.selId = 1
        selectedCharID.set(1) // switch to character B, during the wait
        await settle()

        expect(liveCharC.chats[0].scriptstate['$x']).toBe('1')
        expect(liveCharB.chats[0].scriptstate?.['$x']).toBeUndefined()
    })
})

describe('No concurrent edit is lost during a manual trigger\'s wait', () => {
    test('a concurrent send, in-place edit and a push onto another chat all survive a manual trigger\'s wait', async () => {
        const a1 = makeChat('a1', { message: [{ role: 'user', data: 'first' }, { role: 'char', data: 'second' }] })
        a1.message.push({ role: 'char', data: '<button risu-trigger="waitdesc" risu-id="t1">Click</button>' })
        const a2 = makeChat('a2', { message: [{ role: 'user', data: 'a2-only' }] })
        const char = makeCharacter('char-nolose', [a1, a2])
        char.triggerscript.push(trig('waitdesc', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'new-desc', valueType: 'value' }),
        ]))
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveChar = DBState.db.characters[0]
        const liveA1 = liveChar.chats[0]
        const liveA2 = liveChar.chats[1]

        const { target } = await mountChat({ idx: 2, message: a1.message[2].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="waitdesc"]')
        button!.click()

        // During the wait: a user message and a reply pushed onto A1...
        liveA1.message.push({ role: 'user', data: 'concurrent user msg' })
        liveA1.message.push({ role: 'char', data: 'concurrent reply' })
        // ...an earlier message edited in place...
        liveA1.message[0].data = 'first-edited'
        // ...and a message pushed onto A2, a DIFFERENT chat of the same character.
        liveA2.message.push({ role: 'char', data: 'a2-concurrent' })

        await settle()

        // Read back FRESH through DBState, never through liveA1/liveA2 held
        // since before the click -- a whole-chat or whole-character replace
        // would orphan a held reference (it would keep reflecting only what
        // THIS test wrote onto it, not what a real render would show), so
        // only a fresh lookup proves the concurrent edits are visible in the
        // slot the app actually reads from now.
        const finalChar = DBState.db.characters[0] as character
        expect(finalChar.chats[0].message[0].data).toBe('first-edited')
        expect(finalChar.chats[0].message.some((m: { data: string }) => m.data === 'concurrent user msg')).toBe(true)
        expect(finalChar.chats[0].message.some((m: { data: string }) => m.data === 'concurrent reply')).toBe(true)
        expect(finalChar.chats[1].message.some((m: { data: string }) => m.data === 'a2-concurrent')).toBe(true)
        expect(finalChar.desc).toBe('new-desc')
    })
})

describe('Trigger and user operations both land', () => {
    test('an impersonate effect and a concurrent in-place edit both land', async () => {
        const a1 = makeChat('a1', { message: [{ role: 'user', data: 'first' }] })
        a1.message.push({ role: 'char', data: '<button risu-trigger="waitimp" risu-id="t1">Click</button>' })
        const char = makeCharacter('char-both', [a1])
        char.triggerscript.push(trig('waitimp', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            { type: 'impersonate', role: 'user', value: 'impersonated line' },
        ]))
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveA1 = DBState.db.characters[0].chats[0]

        const { target } = await mountChat({ idx: 1, message: a1.message[1].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="waitimp"]')
        button!.click()
        liveA1.message[0].data = 'first-edited-concurrently'
        await settle()

        // Fresh lookup: see the comment on the equivalent read in "No
        // concurrent edit is lost during a manual trigger's wait" above.
        const finalMessages = DBState.db.characters[0].chats[0].message
        expect(finalMessages[0].data).toBe('first-edited-concurrently')
        expect(finalMessages.some((m: { data: string }) => m.data === 'impersonated line')).toBe(true)
    })

    test('a cutchat effect applies to the live chat as it is when the cut runs', async () => {
        const buttonData = '<button risu-trigger="waitcut" risu-id="t1">Click</button>'
        const a1 = makeChat('a1', { message: [{ role: 'user', data: 'first' }] })
        a1.message.push({ role: 'char', data: buttonData })
        const char = makeCharacter('char-cut', [a1])
        char.triggerscript.push(trig('waitcut', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            // start=1,end=3 on the two-message fixture ([first, button])
            // keeps only `button` -- so a push landing at index 2 during the
            // wait changes the cut's own result (button, pushed) from what a
            // copy taken before the push would give (button alone). A
            // start=0,end=2 range cannot tell live from a stale copy apart:
            // slicing either the two-message original or the three-message
            // live array to the SAME two indices yields the SAME first two
            // messages regardless of the push.
            v2('v2CutChat', { start: '1', startType: 'value', end: '3', endType: 'value' }),
        ]))
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveChar = DBState.db.characters[0]
        const liveA1 = liveChar.chats[0]

        const { target } = await mountChat({ idx: 1, message: a1.message[1].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="waitcut"]')
        button!.click()
        // A message is pushed during the wait -- the cut must apply to the
        // chat as it stands (three messages) WHEN the cut actually runs, not
        // to a copy captured before the push.
        liveA1.message.push({ role: 'user', data: 'pushed-before-cut-runs' })
        await settle()

        expect(liveChar.chats[0].message.length).toBe(2)
        expect(liveChar.chats[0].message[0].data).toBe(buttonData)
        expect(liveChar.chats[0].message[1].data).toBe('pushed-before-cut-runs')
    })
})

describe('The Lua button after a switch', () => {
    // Where the mocked script's write actually lands is the mock's own
    // decision (see the file header), not Chat.svelte's -- so this test only
    // asserts what Chat.svelte itself governs: the chat on screen is not
    // replaced, and no chat id ends up held twice.
    test('the chat on screen is not replaced and no chat id is duplicated after a switch during the script\'s await', async () => {
        const a1 = makeChat('a1', { message: [] })
        a1.message.push({ role: 'char', data: '<button risu-btn="clickme">Click</button>' })
        const a2 = makeChat('a2', { message: [{ role: 'user', data: 'a2-message' }] })
        const char = makeCharacter('char-luabtn', [a1, a2])
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveChar = DBState.db.characters[0]

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-btn="clickme"]')
        expect(button).not.toBeNull()
        button!.click()

        liveChar.chatPage = 1 // the chat is switched during the "script"'s own await
        luaButtonGate.resolve()
        await settle(60)

        // Fresh reads: see the comment on the equivalent read in "No
        // concurrent edit is lost during a manual trigger's wait" above -- a
        // whole-slot replace would orphan liveA1/liveA2 held from before the
        // click.
        const finalChar = DBState.db.characters[0] as character
        const finalChats = finalChar.chats as { id: string, message: { data: string }[] }[]
        // Which chat the message lands on is the mock's own decision (it
        // captured `getCurrentChat()` before its own await); this only
        // checks the write is not silently dropped.
        expect(finalChats.some((c) => c.message.some((m) => m.data === 'lua-added-message'))).toBe(true)
        // A2's own message must still be there, not overwritten by A1's
        // object landing in its slot.
        expect(finalChats.some((c) => c.message.some((m) => m.data === 'a2-message'))).toBe(true)
        const chaIds = finalChats.map((c) => c.id)
        expect(new Set(chaIds).size).toBe(chaIds.length)
    })
})

describe('Registration through the mounted handler', () => {
    test('isWriting is true during a manual trigger\'s wait and false once the handler settles, without this test calling end() itself', async () => {
        const a1 = makeChat('a1')
        a1.message.push({ role: 'char', data: '<button risu-trigger="regwait" risu-id="t1">Click</button>' })
        const char = makeCharacter('char-reg', [a1])
        char.triggerscript.push(trig('regwait', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))
        DBState.db = baseDb() as never
        DBState.db.characters = [char] as never
        selIdState.selId = 0
        const liveChar = DBState.db.characters[0]
        const liveChat = liveChar.chats[0]

        const { target } = await mountChat({ idx: 0, message: a1.message[0].data, isLastMemory: false })
        const button = target.querySelector<HTMLButtonElement>('[risu-trigger="regwait"]')
        expect(button).not.toBeNull()
        button!.click()

        // `handleButtonTriggerWithin`'s own `beginWork` has registered the
        // write, mid-wait -- this test calls no `end()` of its own; only the
        // handler's own `finally` does, once it settles below.
        expect(isWriting({ chaId: liveChar.chaId, chatId: liveChat.id })).toBe(true)

        await settle()

        expect(isWriting({ chaId: liveChar.chaId, chatId: liveChat.id })).toBe(false)
    })
})
