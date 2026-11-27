// @vitest-environment node

/**
 * The three script-driven redraws (Lua `reloadDisplay`, the `v2UpdateGUI` effect and the varChanged completion of a
 * trigger run) ask the chat bodies to draw again without remounting them: each moves the soft redraw count together
 * with the GUI pointer, so `pointer - count`, the part of the chat row key a redraw must not change, stays put.
 * The REAL `runTrigger`, real Lua and the real `scriptings.ts` run against a plain `DBState.db`.
 *
 * Labels: R = regression reproducer (the base moves the pointer alone), G = guard.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../../storage/database.svelte'
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

let SoftRedrawCount: typeof import('../softRedraw').SoftRedrawCount
let ReloadGUIPointer: ReturnType<typeof writable<number>>
let runTrigger: typeof import('../triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('../chatOrigin').beginWork
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest
let runLuaInteractionTrigger: typeof import('../scriptings').runLuaInteractionTrigger

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
    const marks = await import('../../storage/characterSaveMarks')
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
    const scriptings = await import('../scriptings')
    const soft = await import('../softRedraw')
    SoftRedrawCount = soft.SoftRedrawCount
    ReloadGUIPointer = stores.ReloadGUIPointer as never
    runLuaInteractionTrigger = scriptings.runLuaInteractionTrigger
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

function installDb(characters: character[] = []) {
    DBState.db = {
        characters,
        modules: [],
        botPresets: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
    } as unknown as Database
    selectedCharID.set(0)
}

beforeEach(() => {
    processMultiCommandMock.mockClear()
    resetCharacterSaveMarksForTest()
    SoftRedrawCount.set(0)
    ReloadGUIPointer.set(0)
})

//#endregion


// What the chat row key reads: a redraw must leave this unchanged while still moving the pointer for every other reader.
const rowKeyPart = () => get(ReloadGUIPointer) - get(SoftRedrawCount)

describe('a script redraw moves the pointer for its readers but not the chat body key', () => {
    test('R T1: the v2UpdateGUI effect', async () => {
        const char = makeCharacter('char-redraw-v2')
        installDb([char])
        char.triggerscript.push(trig('go', 'manual', [v2('v2UpdateGUI')]))
        const before = rowKeyPart()

        await runTrigger(char, 'manual', { chat: char.chats[0], manualName: 'go' } as never)

        expect(get(ReloadGUIPointer)).toBeGreaterThan(0)
        expect(rowKeyPart()).toBe(before)
    })

    test('R T2: the varChanged completion of a trigger run', async () => {
        const char = makeCharacter('char-redraw-var')
        installDb([char])
        char.triggerscript.push(trig('go', 'manual', [v2('v2SetVar', { var: 'x', operator: '=', valueType: 'value', value: '1' })]))
        const before = rowKeyPart()

        await runTrigger(char, 'manual', { chat: char.chats[0], manualName: 'go' } as never)

        expect(char.chats[0].scriptstate['$x']).toBe('1')
        expect(get(ReloadGUIPointer)).toBeGreaterThan(0)
        expect(rowKeyPart()).toBe(before)
    })

    test('R T3: Lua reloadDisplay', async () => {
        const char = makeCharacter('char-redraw-lua')
        installDb([char])
        char.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: ['onButtonClick = function(id, key, meta)', '  reloadDisplay(id)', 'end'].join('\n'),
        }]))
        const before = rowKeyPart()

        await runLuaInteractionTrigger('button', char, 'go', {})

        expect(get(ReloadGUIPointer)).toBeGreaterThan(0)
        expect(rowKeyPart()).toBe(before)
    })
})
