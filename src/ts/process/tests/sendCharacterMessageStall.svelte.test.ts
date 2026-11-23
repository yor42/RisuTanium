// @vitest-environment node

/**
 * The composer's cancel ends a `sendCharacterMessage` whose input trigger or `editinput` pass never settles.
 *
 * Drives the REAL `sendCharacterMessage` (`../sendCharacterMessage`) with the real `runTrigger` and the real
 * `processScript`, the module graph mocked as in `sendCharacterMessage.svelte.test.ts` (copied: each suite mocks its own
 * graph). `../command` is a mock, so a trigger's command line is the controllable hang; a plugin `editinput` handler is the
 * other. Each hook never settles; after the abort the seam resolves `false` and appends nothing.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../../storage/database.svelte'
import type { triggerscript, triggerEffect } from '../triggers'
import type { toSaveType } from '../../storage/risuSave'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    downloadFile: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('../../tokenizer'))

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

vi.mock(import('../../util'), () => ({
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
}) as unknown as typeof import('../../util'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

// Real (mutable) Sets so a test can register its OWN plugin hook -- the
// no-triggers variant below needs a genuine `pluginV2.editinput` await it
// controls by hand.
const pluginV2Mock = {
    editinput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editoutput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editdisplay: new Set<(data: string) => Promise<string | null | undefined>>(),
    editprocess: new Set<(data: string) => Promise<string | null | undefined>>(),
}

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: pluginV2Mock,
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
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
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

//#endregion

let sendCharacterMessage: typeof import('../sendCharacterMessage').sendCharacterMessage
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('../chatOrigin').beginWork
let RisuSaveEncoder: typeof import('../../storage/tests/risuSaveEncoder').RisuSaveEncoder
let decodeRisuSave: typeof import('../../storage/risuSave').decodeRisuSave
let installCharacterSaveMarks: typeof import('../../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const seam = await import('../sendCharacterMessage')
    sendCharacterMessage = seam.sendCharacterMessage
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('../chatOrigin')
    beginWork = origin.beginWork
    const risuSave = await import('../../storage/risuSave')
    const encoderFixture = await import('../../storage/tests/risuSaveEncoder')
    RisuSaveEncoder = encoderFixture.RisuSaveEncoder
    decodeRisuSave = risuSave.decodeRisuSave
    const marks = await import('../../storage/characterSaveMarks')
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
        botPresets: [],
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

import { processMultiCommand } from '../command'

//#region 7d fixtures

const hang = () => new Promise<never>(() => {})

function track<T>(promise: Promise<T>): { done: boolean, value: T | undefined } {
    const state: { done: boolean, value: T | undefined } = { done: false, value: undefined }
    void promise.then((value) => { state.done = true; state.value = value })
    return state
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
        if (condition()) {
            return
        }
        await new Promise<void>((res) => setTimeout(res, 0))
    }
    throw new Error(`timed out waiting for: ${what}`)
}

//#endregion

describe('sendCharacterMessage: a hook that never settles, at the composer\'s cancel', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.mocked(processMultiCommand).mockImplementation(async () => '')
        vi.restoreAllMocks()
    })

    test('CM-1 (AS-23) regression reproducer: an editinput handler that never settles is abandoned by the cancel; false, nothing appended', async () => {
        const char = makeCharacter('char-c')
        installDb([char])
        const startChat = char.chats[char.chatPage]
        const workHandle = beginWork(char, startChat)!
        const hook = vi.fn(async (_data: string) => hang())
        pluginV2Mock.editinput.add(hook)
        const cancel = new AbortController()
        const onAppended = vi.fn()

        const state = track(sendCharacterMessage(workHandle, char, startChat, 'hello', cancel.signal, onAppended))
        await until(() => hook.mock.calls.length > 0, 'the editinput handler to start')
        expect(state.done).toBe(false)
        cancel.abort()
        await until(() => state.done, 'the send to settle after the cancel')
        workHandle.end()

        expect(state.value).toBe(false)
        expect(startChat.message).toHaveLength(0)
        expect(onAppended).not.toHaveBeenCalled()
    })

    test('CM-1 (AS-23) regression reproducer: an input trigger that never settles is abandoned by the cancel; false, nothing appended', async () => {
        const char = makeCharacter('char-c')
        char.triggerscript.push(trig('t', 'input', [v2('v2Command', { value: '/pass x', valueType: 'value' })]))
        installDb([char])
        const startChat = char.chats[char.chatPage]
        const workHandle = beginWork(char, startChat)!
        vi.mocked(processMultiCommand).mockImplementation(hang)
        const cancel = new AbortController()
        const onAppended = vi.fn()

        const state = track(sendCharacterMessage(workHandle, char, startChat, 'hello', cancel.signal, onAppended))
        await until(() => vi.mocked(processMultiCommand).mock.calls.length > 0, 'the trigger command to start')
        expect(state.done).toBe(false)
        cancel.abort()
        await until(() => state.done, 'the send to settle after the cancel')
        workHandle.end()

        expect(state.value).toBe(false)
        expect(startChat.message).toHaveLength(0)
        expect(onAppended).not.toHaveBeenCalled()
    })
})