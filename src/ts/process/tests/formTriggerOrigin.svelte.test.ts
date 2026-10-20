// @vitest-environment node

/**
 * Engine suite for the form trigger: the REAL `runTrigger`, real Lua (wasmoon) and
 * the real `./scriptings.ts` against a plain `DBState.db`. A form submit is a
 * Lua `onFormSubmit` run that carries the submitter's origin, so its writes
 * land on the origin chat even when the selection moves during the script's
 * own await. Only network-facing modules are mocked.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { triggerscript, triggerEffect } from '../triggers'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    // Identity pass-through: none of this suite's fixtures rely on CBS
    // substitution, only on the literal effect fields, so the real (heavy)
    // CBS engine is not needed to exercise the writer.
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
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

const processMultiCommandMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    // Real-shaped: mirrors util.ts's own parseKeyValue exactly (a "key=value"
    // per-line parse), needed for runTrigger's defaultVariables handling.
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    // Real (not faked): a genuine setTimeout-based wait. Since a caller of an
    // async function runs synchronously up to its first await regardless of
    // that await's duration, a concurrent mutation performed by test code
    // immediately after starting (not yet awaiting) `runTrigger()` always
    // lands truly "during" a `v2Wait`, even at 0ms.
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../../util'))

vi.mock(import('../command'), () => ({
    processMultiCommand: processMultiCommandMock,
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

// Real-shaped re-implementations reading/writing through the SAME mocked
// `DBState`/`selectedCharID` above -- mirrors database.svelte.ts's own
// getCurrentCharacter/getCurrentChat/setCurrentCharacter/setCurrentChat
// exactly, which is what lets this suite drive the real selection-based
// accessors faithfully without loading the real (heavy) database.svelte.ts.
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

// A lightweight stand-in, NOT a faithful mirror of modules.ts's own
// getModuleTriggers(): it reproduces the same stamp shape
// (`t.lowLevelAccess = module.lowLevelAccess; return t`), matching what
// `tests/modulesTriggerStamping.svelte.test.ts` checks against the REAL
// getModuleTriggers() (with its own characterCards/interchangeability/
// rpack_js/media import graph). This file has no test of its own for that
// stamping: runTrigger calls getModuleTriggers() on every run here, but none
// of this suite's fixtures ever populate a module trigger, so the stand-in
// always returns []. getModuleLorebooks is unused by this suite's fixtures
// (no module lorebook entries) and returns [] to match.
vi.mock(import('../modules'), async () => {
    const stores = await import('../../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    return {
        getModuleLorebooks: vi.fn(() => []),
        getModuleTriggers: vi.fn(() => {
            const modules = DBState.db.modules ?? []
            let triggers: any[] = []
            for (const module of modules) {
                if (!module) continue
                if (module.trigger) {
                    triggers = triggers.concat(module.trigger.map((t: any) => {
                        t.lowLevelAccess = module.lowLevelAccess
                        return t
                    }))
                }
            }
            return triggers
        }),
    } as unknown as typeof import('../modules')
})

//#endregion

let runTrigger: typeof import('../triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('../chatOrigin').beginWork
let isWriting: typeof import('../chatOrigin').isWriting
let RisuSaveEncoder: typeof import('../../storage/risuSave').RisuSaveEncoder
let decodeRisuSave: typeof import('../../storage/risuSave').decodeRisuSave
let installCharacterSaveMarks: typeof import('../../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest
let runLuaEditTrigger: typeof import('../scriptings').runLuaEditTrigger
let runScripted: typeof import('../scriptings').runScripted
let runLuaInteractionTrigger: typeof import('../scriptings').runLuaInteractionTrigger
let alertInput: typeof import('../../alert').alertInput
let generateAIImage: typeof import('../stableDiff').generateAIImage

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const triggers = await import('../triggers')
    runTrigger = triggers.runTrigger
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('../chatOrigin')
    beginWork = origin.beginWork
    isWriting = origin.isWriting
    const risuSave = await import('../../storage/risuSave')
    RisuSaveEncoder = risuSave.RisuSaveEncoder
    decodeRisuSave = risuSave.decodeRisuSave
    const marks = await import('../../storage/characterSaveMarks')
    installCharacterSaveMarks = marks.installCharacterSaveMarks
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
    const scriptings = await import('../scriptings')
    runLuaEditTrigger = scriptings.runLuaEditTrigger
    runScripted = scriptings.runScripted
    runLuaInteractionTrigger = scriptings.runLuaInteractionTrigger
    const alertMod = await import('../../alert')
    alertInput = alertMod.alertInput
    const stableDiff = await import('../stableDiff')
    generateAIImage = stableDiff.generateAIImage
})

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

// Fixture helpers below build only the fields these tests actually read or
// write, then cast to the real domain type -- matching the established
// pattern in characters.saveMarks.svelte.test.ts and
// sendChatSaveMarks.svelte.test.ts, which do the same for the same reason
// (the real `character`/`Chat`/`Database` types carry many fields no test
// fixture needs to populate).
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
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        replaceGlobalNote: '',
        firstMessage: 'hello',
        backgroundHTML: '',
        lowLevelAccess: false,
        ...overrides,
    } as unknown as character
}

function makeGroup(chaId: string, memberChaIds: string[], overrides: Record<string, unknown> = {}): groupChat {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat-0`)],
        characters: memberChaIds,
        characterActive: memberChaIds.map(() => true),
        characterTalks: memberChaIds.map(() => 1),
        globalLore: [] as unknown[],
        desc: `${chaId}-group-desc`,
        ...overrides,
    } as unknown as groupChat
}

function installDb(characters: (character | groupChat)[] = [], extra: Record<string, unknown> = {}) {
    DBState.db = {
        characters,
        modules: [],
        botPresets: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        ...extra,
    } as unknown as Database
    selectedCharID.set(0)
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
    processMultiCommandMock.mockClear()
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('The Lua onFormSubmit run resolves through its origin, not the selection', () => {
    test('a switch during the script\'s own await does not move where addChat lands, and the submitted data reaches the script', async () => {
        const char = makeCharacter('char-form-origin')
        const chatA = makeChat('chat-a')
        const chatB = makeChat('chat-b')
        char.chats = [chatA, chatB]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onFormSubmit = async(function(id, key, meta)',
                '  alertInput(id, "wait"):await()',
                '  addChat(id, "user", "form:" .. key .. ":" .. json.decode(meta).data.a)',
                'end)',
            ].join('\n'),
        }]))

        const handle = beginWork(char, chatA)

        let releaseGate: () => void = () => {}
        const gate = new Promise<string>((res) => { releaseGate = () => res('answer') })
        let reachedResolve: () => void = () => {}
        const reached = new Promise<void>((res) => { reachedResolve = res })
        vi.mocked(alertInput).mockImplementationOnce(async () => {
            reachedResolve()
            return gate
        })

        const p = runLuaInteractionTrigger('form', char, 'send', { data: { a: '1' } }, handle!.origin)
        await reached

        char.chatPage = 1 // the selection moves to chat B, during the script's own await

        releaseGate()
        await p
        handle!.end()

        expect(chatA.message.some((m) => m.data === 'form:send:1')).toBe(true)
        expect(chatB.message.some((m) => m.data === 'form:send:1')).toBe(false)
    })
})
