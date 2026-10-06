// @vitest-environment node

/**
 * W1a `sendCharacterMessage` suite: drives the extracted seam
 * (`sendCharacterMessage.ts`, `sendMain`'s character branch with no
 * behaviour change) against `DBState.db`, the real `selectedCharID` store,
 * the real `runTrigger` (`./triggers.ts`) and the real `processScript`
 * (`./scripts.ts`, which itself calls the real `runLuaEditTrigger`).
 * `DBState.db` is declared with `$state(...)` below, but this file compiles
 * under `@vitest-environment node`, where Svelte generates `$state()` for
 * the server -- a plain object, not a reactive Proxy (needed here for real
 * Lua/wasmoon, the same reason the engine suite
 * (`triggerOriginWrites.svelte.test.ts`) uses node). Only network-facing
 * modules are mocked, plus `./command`/`./modules`/`../plugins/plugins.svelte`
 * for the same reasons as that engine suite.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../storage/database.svelte'
import type { triggerscript, triggerEffect } from './triggers'
import type { toSaveType } from '../storage/risuSave'

//#region module mocks

vi.mock(import('../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
    } as unknown as typeof import('../stores.svelte')
})

vi.mock(import('../alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../alert'))

vi.mock(import('../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    downloadFile: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('../tokenizer'))

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

vi.mock(import('../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../util'))

vi.mock(import('./command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('./command'))

vi.mock(import('./files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('./files/inlays'))

vi.mock(import('./lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('./lorebook.svelte'))

vi.mock(import('./memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('./memory/hypamemory'))

vi.mock(import('./request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('./request/request'))

vi.mock(import('./stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('./stableDiff'))

// Real (mutable) Sets so a test can register its OWN plugin hook -- the
// no-triggers variant below needs a genuine `pluginV2.editinput` await it
// controls by hand.
const pluginV2Mock = {
    editinput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editoutput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editdisplay: new Set<(data: string) => Promise<string | null | undefined>>(),
    editprocess: new Set<(data: string) => Promise<string | null | undefined>>(),
}

vi.mock(import('../plugins/plugins.svelte'), () => ({
    pluginV2: pluginV2Mock,
}) as unknown as typeof import('../plugins/plugins.svelte'))

vi.mock(import('../storage/database.svelte'), async () => {
    const stores = await import('../stores.svelte')
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
    } as unknown as typeof import('../storage/database.svelte')
})

vi.mock(import('./modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('./modules'))

//#endregion

let sendCharacterMessage: typeof import('./sendCharacterMessage').sendCharacterMessage
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('./chatOrigin').beginWork
let RisuSaveEncoder: typeof import('../storage/risuSave').RisuSaveEncoder
let decodeRisuSave: typeof import('../storage/risuSave').decodeRisuSave
let installCharacterSaveMarks: typeof import('../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../storage/characterSaveMarks').resetCharacterSaveMarksForTest

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const seam = await import('./sendCharacterMessage')
    sendCharacterMessage = seam.sendCharacterMessage
    const stores = await import('../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('./chatOrigin')
    beginWork = origin.beginWork
    const risuSave = await import('../storage/risuSave')
    RisuSaveEncoder = risuSave.RisuSaveEncoder
    decodeRisuSave = risuSave.decodeRisuSave
    const marks = await import('../storage/characterSaveMarks')
    installCharacterSaveMarks = marks.installCharacterSaveMarks
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
})

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

function makeChat(id: string, overrides: Record<string, unknown> = {}): Chat {
    return {
        id,
        message: [] as unknown[],
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as Chat
}

function makeCharacter(chaId: string, overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat-0`)],
        triggerscript: [] as unknown[],
        customscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        ...overrides,
    } as unknown as character
}

function installDb(characters: character[] = []) {
    DBState.db = {
        characters,
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        presetRegex: [],
    } as unknown as Database
    selectedCharID.set(0)
}

// A promise the test resolves by hand, matching the alert-input pattern.
function makeGate() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    return { gate, release: () => release() }
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db as object) as Database
}

function makeTracker(): toSaveType {
    return {
        character: [] as string[],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    } as unknown as toSaveType
}

beforeEach(() => {
    pluginV2Mock.editinput.clear()
    pluginV2Mock.editoutput.clear()
    pluginV2Mock.editdisplay.clear()
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('sendCharacterMessage: the input trigger, after a switch', () => {
    test('the message lands on the chat the send started from, not on the chat now selected', async () => {
        const char = makeCharacter('char-c')
        const a1 = makeChat('a1')
        const a2 = makeChat('a2')
        char.chats = [a1, a2]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'input', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))

        const startChat = char.chats[char.chatPage]
        const workHandle = beginWork(char, startChat)!
        const p = sendCharacterMessage(workHandle, char, startChat, 'hello', new AbortController().signal, () => {})
        // `sendCharacterMessage` runs synchronously up to its first await
        // (inside the trigger's own `v2Wait`), so the switch made right
        // here, before this test itself awaits anything, reliably lands
        // inside the trigger's wait.
        char.chatPage = 1 // the selection moves to A2 of the same character, during the wait
        const appended = await p
        workHandle.end()

        expect(a1.message.length).toBe(1)
        expect(a1.message[0]?.data).toBe('hello')
        expect(a2.message.length).toBe(0)
        expect(a1.message === a2.message).toBe(false)
        expect(appended).toBe(true)
    })

    test('a plugin editinput hook that awaits during a switch does not alias the two chats even with no triggers at all', async () => {
        const char = makeCharacter('char-noswitchplugin')
        const a1 = makeChat('a1')
        const a2 = makeChat('a2')
        char.chats = [a1, a2]
        installDb([char])
        selectedCharID.set(0)

        const { gate, release } = makeGate()
        pluginV2Mock.editinput.add(async (data: string) => {
            await gate
            return data
        })

        const startChat = char.chats[char.chatPage]
        const workHandle = beginWork(char, startChat)!
        const p = sendCharacterMessage(workHandle, char, startChat, 'hello', new AbortController().signal, () => {})
        char.chatPage = 1 // switch during the plugin hook's own await
        release()
        const appended = await p
        workHandle.end()

        expect(a1.message.length).toBe(1)
        expect(a1.message[0]?.data).toBe('hello')
        expect(a2.message.length).toBe(0)
        expect(a1.message === a2.message).toBe(false)
        expect(appended).toBe(true)
    })

    test('a switch to another character during the wait: the message still survives encode and decode', async () => {
        const charA = makeCharacter('char-a')
        const charB = makeCharacter('char-b')
        installDb([charA, charB])
        selectedCharID.set(0)

        // A baseline encode of the empty state, taken before the send, so
        // the later incremental `.set()` re-encodes only what got marked
        // for save in between -- the same before/after shape as the engine
        // suite's "An unselected origin is saved" test.
        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { gate, release } = makeGate()
        charA.triggerscript.push(trig('t', 'input', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))
        void gate

        const startChat = charA.chats[charA.chatPage]
        const workHandle = beginWork(charA, startChat)!
        const p = sendCharacterMessage(workHandle, charA, startChat, 'hello', new AbortController().signal, () => {})
        selectedCharID.set(1) // switch to a DIFFERENT character, during the wait
        release()
        const appended = await p
        workHandle.end()

        expect(charA.chats[0].message.length).toBe(1)
        expect(charA.chats[0].message[0]?.data).toBe('hello')
        expect(charB.chats[0].message.length).toBe(0)

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-a')
        expect(decodedA?.chats[0].message.length).toBe(1)
        expect(decodedA?.chats[0].message[0]?.data).toBe('hello')
        expect(appended).toBe(true)
    })

    test('guard: with no switch, an input trigger that cuts the chat still appends onto the live, cut array', async () => {
        const char = makeCharacter('char-cutinput')
        const chat = char.chats[0]
        chat.message = [{ role: 'user', data: 'old-1' }, { role: 'user', data: 'old-2' }]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'input', [
            v2('v2CutChat', { start: '0', startType: 'value', end: '1', endType: 'value' }),
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))

        const startChat = char.chats[char.chatPage]
        const workHandle = beginWork(char, startChat)!
        const appended = await sendCharacterMessage(workHandle, char, startChat, 'new-message', new AbortController().signal, () => {})
        workHandle.end()

        expect(char.chats[0].message.length).toBe(2)
        expect(char.chats[0].message[0]?.data).toBe('old-1')
        expect(char.chats[0].message[1]?.data).toBe('new-message')
        expect(appended).toBe(true)
    })

    test('a plugin editinput hook that replaces the origin chat object (same id) lands the message on the LIVE object now in the slot', async () => {
        const char = makeCharacter('char-replacechat')
        installDb([char])
        selectedCharID.set(0)
        const originalChat = char.chats[0]

        let replacementChat: Chat | undefined
        pluginV2Mock.editinput.add(async (data: string) => {
            // A new object, same id, put into the owner's chat slot --
            // never the same array or object as `originalChat`.
            replacementChat = makeChat(originalChat.id, { message: [...originalChat.message] })
            char.chats[0] = replacementChat
            return data
        })

        const workHandle = beginWork(char, originalChat)!
        const appended = await sendCharacterMessage(workHandle, char, originalChat, 'hello', new AbortController().signal, () => {})
        workHandle.end()

        expect(appended).toBe(true)
        expect(char.chats[0]).toBe(replacementChat)
        expect(replacementChat!.message.some((m) => m.data === 'hello')).toBe(true)
        expect(originalChat.message.some((m) => m.data === 'hello')).toBe(false)
    })
})

describe('sendCharacterMessage: a gone or ambiguous origin', () => {
    test('a gone origin appends nothing, even when another chat has shifted into its slot', async () => {
        const char = makeCharacter('char-gone')
        const a2 = makeChat('a2')
        char.chats.push(a2)
        installDb([char])
        selectedCharID.set(0)
        const chat = char.chats[0]

        char.triggerscript.push(trig('t', 'input', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))

        const cha = chat.message
        const workHandle = beginWork(char, chat)!
        const p = sendCharacterMessage(workHandle, char, chat, 'hello', new AbortController().signal, () => {})
        char.chats.splice(0, 1) // the origin chat is gone during the wait; a2 shifts into its slot
        let appended: boolean | undefined
        let threw = false
        try {
            appended = await p
        } catch {
            threw = true
        }
        workHandle.end()

        const anywhereInDb = char.chats.some((c: { message: { data: string }[] }) => c.message.some((m) => m.data === 'hello'))
        expect(threw).toBe(false)
        expect(anywhereInDb).toBe(false)
        expect(a2.message.length).toBe(0)
        expect(cha.length).toBe(0)
        expect(appended).toBe(false)
    })

    test('an ambiguous origin still appends to the chat object held since the start, not to whichever chat now occupies its slot', async () => {
        const char = makeCharacter('char-ambiginput')
        const chat = char.chats[0]
        chat.message = [{ role: 'user', data: 'old-1' }, { role: 'user', data: 'old-2' }]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'input', [
            v2('v2CutChat', { start: '0', startType: 'value', end: '1', endType: 'value' }),
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))

        const { gate, release } = makeGate()
        // A duplicate chat sharing the origin's id is unshifted to the
        // FRONT during the second wait, so it -- not the origin -- now
        // occupies chatPage 0.
        pluginV2Mock.editinput.add(async (data: string) => {
            char.chats.unshift(makeChat(chat.id))
            await gate
            return data
        })

        const heldArrayBeforeCut = chat.message
        const workHandle = beginWork(char, chat)!
        const p = sendCharacterMessage(workHandle, char, chat, 'new-message', new AbortController().signal, () => {})
        release()
        const appended = await p
        workHandle.end()

        // Must land on the origin chat object (`chat`), never on the
        // pre-cut array held since the start and never on whichever object
        // now sits at chatPage 0.
        expect(heldArrayBeforeCut === chat.message).toBe(false)
        expect(chat.message[chat.message.length - 1]?.data).toBe('new-message')
        expect(appended).toBe(true)
    })
})
