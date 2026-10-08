// @vitest-environment node

/**
 * W1a engine suite: drives the REAL `runTrigger` (`./triggers.ts`) against
 * `DBState.db`, the real `selectedCharID` store and real Lua (wasmoon, via
 * the real `./scriptings.ts`). `DBState.db` is declared with `$state(...)`
 * below, but this file compiles under `@vitest-environment node`, where
 * Svelte generates `$state()` for the server -- a plain object, not a
 * reactive Proxy. Every read and write here goes through the same object
 * literal the browser build would produce, just without reactivity; nothing
 * in this suite's assertions depends on that reactivity. Only network-facing
 * modules are mocked (alerts, request/request, stableDiff, memory/hypamemory),
 * plus `./command` and `./modules`, whose real implementations pull in the
 * whole `index.svelte.ts`/`characterCards`/`interchangeability` module graphs
 * that this suite has no reason to load -- neither module's own logic is
 * under test here (the 'command' v1 effect and module-sourced triggers are
 * exercised through faithful, minimal re-implementations below; the
 * module-trigger stamping shape the `./modules` stand-in reproduces is
 * checked against the REAL `./modules.ts` separately, in
 * `tests/modulesTriggerStamping.svelte.test.ts`, not in this file).
 *
 * Every test that is not a display/request run forms its origin the way a
 * real caller will: `beginWork(owner, chat, member?)` on objects read back
 * through `DBState`, with `handle.end()` in a `finally`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database } from '../storage/database.svelte'
import type { toSaveType } from '../storage/risuSave'
import type { triggerscript, triggerEffect } from './triggers'

//#region module mocks

vi.mock(import('../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    // Identity pass-through: none of this suite's fixtures rely on CBS
    // substitution, only on the literal effect fields, so the real (heavy)
    // CBS engine is not needed to exercise the writer.
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
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

const processMultiCommandMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../util'), () => ({
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
}) as unknown as typeof import('../util'))

vi.mock(import('./command'), () => ({
    processMultiCommand: processMultiCommandMock,
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

// Real-shaped re-implementations reading/writing through the SAME mocked
// `DBState`/`selectedCharID` above -- mirrors database.svelte.ts's own
// getCurrentCharacter/getCurrentChat/setCurrentCharacter/setCurrentChat
// exactly, which is what lets this suite drive the real selection-based
// accessors faithfully without loading the real (heavy) database.svelte.ts.
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
vi.mock(import('./modules'), async () => {
    const stores = await import('../stores.svelte')
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
    } as unknown as typeof import('./modules')
})

//#endregion

let runTrigger: typeof import('./triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('./chatOrigin').beginWork
let isWriting: typeof import('./chatOrigin').isWriting
let RisuSaveEncoder: typeof import('../storage/risuSave').RisuSaveEncoder
let decodeRisuSave: typeof import('../storage/risuSave').decodeRisuSave
let installCharacterSaveMarks: typeof import('../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../storage/characterSaveMarks').resetCharacterSaveMarksForTest
let runLuaEditTrigger: typeof import('./scriptings').runLuaEditTrigger
let runScripted: typeof import('./scriptings').runScripted
let runLuaButtonTrigger: typeof import('./scriptings').runLuaButtonTrigger
let alertInput: typeof import('../alert').alertInput
let generateAIImage: typeof import('./stableDiff').generateAIImage

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const triggers = await import('./triggers')
    runTrigger = triggers.runTrigger
    const stores = await import('../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('./chatOrigin')
    beginWork = origin.beginWork
    isWriting = origin.isWriting
    const risuSave = await import('../storage/risuSave')
    RisuSaveEncoder = risuSave.RisuSaveEncoder
    decodeRisuSave = risuSave.decodeRisuSave
    const marks = await import('../storage/characterSaveMarks')
    installCharacterSaveMarks = marks.installCharacterSaveMarks
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
    const scriptings = await import('./scriptings')
    runLuaEditTrigger = scriptings.runLuaEditTrigger
    runScripted = scriptings.runScripted
    runLuaButtonTrigger = scriptings.runLuaButtonTrigger
    const alertMod = await import('../alert')
    alertInput = alertMod.alertInput
    const stableDiff = await import('./stableDiff')
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

describe('A group member effect run with no switch', () => {
    test('a member trigger writes the member\'s desc/globalLore and the group\'s chat note, without replacing the group\'s slot', async () => {
        const member = makeCharacter('member-A')
        const group = makeGroup('group-A', ['member-A'])
        installDb([group, member])
        selectedCharID.set(0) // the group is selected

        const groupSlotBefore = DBState.db.characters[0]
        const memberSlotBefore = DBState.db.characters[1]
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2SetCharacterDesc', { value: 'member-new-desc', valueType: 'value' }),
            v2('v2CreateLorebook', { name: 'n', nameType: 'value', key: 'k', keyType: 'value', content: 'c', contentType: 'value', insertOrder: '100', insertOrderType: 'value' }),
            v2('v2SetAuthorNote', { value: 'group-note', valueType: 'value' }),
        ]))

        const handle = beginWork(group, groupChat, member)
        try {
            await runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        } finally {
            handle!.end()
        }

        expect(DBState.db.characters[1].desc).toBe('member-new-desc')
        expect(DBState.db.characters[1].globalLore.length).toBe(1)
        expect(DBState.db.characters[0].chats[0].note).toBe('group-note')

        // The group's own slot is the SAME object, untouched otherwise.
        expect(DBState.db.characters[0]).toBe(groupSlotBefore)
        expect(DBState.db.characters[0].desc).toBe('group-A-group-desc')
        expect(DBState.db.characters[0].globalLore.length).toBe(0)
        // The member's slot is likewise still its own object.
        expect(DBState.db.characters[1]).toBe(memberSlotBefore)

        const chaIds = DBState.db.characters.map((c: { chaId: string }) => c.chaId)
        expect(chaIds).toEqual(['group-A', 'member-A'])
    })
})

describe('Lua upsertLocalLoreBook', () => {
    test('a triggerlua run\'s upsertLocalLoreBook lands on the origin chat and survives encode and decode', async () => {
        const char = makeCharacter('char-lore')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('loretrig', 'manual', [
            { type: 'triggerlua', code: 'function loretrig(id)\n  upsertLocalLoreBook(id, "entry", "content", {})\nend' },
        ]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const handle = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 'loretrig', origin: handle!.origin } as never)
        } finally {
            handle!.end()
        }

        expect(chat.localLore.length).toBe(1)
        expect((chat.localLore[0] as { comment: string }).comment).toBe('entry')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-lore')
        expect(decodedChar?.chats[0].localLore.length).toBe(1)
    })
})

describe('Stale Lua closures across two runs sharing a mode', () => {
    test('upsertLocalLoreBook lands on each run\'s own origin chat, not a closure captured from an earlier run', async () => {
        const charA = makeCharacter('char-stale-A')
        const charB = makeCharacter('char-stale-B')
        installDb([charA, charB])

        const code = 'function sharedlora(id)\n  upsertLocalLoreBook(id, "entry", "content", {})\nend'
        charA.triggerscript.push(trig('sharedlora', 'manual', [{ type: 'triggerlua', code }]))
        charB.triggerscript.push(trig('sharedlora', 'manual', [{ type: 'triggerlua', code }]))

        const handleA = beginWork(charA, charA.chats[0])
        try {
            await runTrigger(charA, 'manual', { chat: charA.chats[0], manualName: 'sharedlora', origin: handleA!.origin } as never)
        } finally { handleA!.end() }

        const handleB = beginWork(charB, charB.chats[0])
        try {
            await runTrigger(charB, 'manual', { chat: charB.chats[0], manualName: 'sharedlora', origin: handleB!.origin } as never)
        } finally { handleB!.end() }

        expect(charA.chats[0].localLore.length).toBe(1)
        expect(charB.chats[0].localLore.length).toBe(1)
    })

    // setDescription's type guard validates its OWN `desc` parameter on
    // every call, never a value closed over once, when the engine for this
    // mode/code was first built -- so reusing that engine for a later,
    // different character must judge each call on its own argument.
    test('setDescription validates its own desc argument, not a stale call\'s data', async () => {
        installDb([makeCharacter('char-setdesc-A'), makeCharacter('char-setdesc-B')])
        selectedCharID.set(0)
        // Byte-identical code for both calls -- the whole point is that the
        // SECOND call reuses the cached engine (no rebuild) under the same
        // mode. The Lua-level `desc` argument is hardcoded and always a
        // valid string.
        const code = 'function shareddesc(id)\n  setDescription(id, "hardcoded-desc")\nend'

        // Builds the engine for mode 'shareddesc' with runScripted's own
        // `data` argument set to a non-string.
        await runScripted(code, {
            char: DBState.db.characters[0],
            chat: DBState.db.characters[0].chats[0],
            mode: 'shareddesc',
            data: [{ role: 'user', content: 'x' }] as never,
        })

        selectedCharID.set(1)
        // Same mode, same code (no rebuild) -- THIS call's own `data` is a
        // valid string (the default ''), so setDescription must not throw.
        await runScripted(code, {
            char: DBState.db.characters[1],
            chat: DBState.db.characters[1].chats[0],
            mode: 'shareddesc',
        })
        expect(DBState.db.characters[1].desc).toBe('hardcoded-desc')
    })

    test('a second run of the same code and mode that calls stopChat stops the send', async () => {
        const charA = makeCharacter('char-stop-A')
        const charB = makeCharacter('char-stop-B')
        installDb([charA, charB])
        const code = 'function stoptrig(id)\n  stopChat(id)\nend'
        charA.triggerscript.push(trig('stoptrig', 'manual', [{ type: 'triggerlua', code }]))
        charB.triggerscript.push(trig('stoptrig', 'manual', [{ type: 'triggerlua', code }]))

        await runTrigger(charA, 'manual', { chat: charA.chats[0], manualName: 'stoptrig' } as never)
        const result = await runTrigger(charB, 'manual', { chat: charB.chats[0], manualName: 'stoptrig' } as never)

        expect(result?.stopSending).toBe(true)
    })
})

describe('Nested triggers', () => {
    test('a child trigger\'s desc write survives the parent\'s later effect', async () => {
        const char = makeCharacter('char-nested')
        installDb([char])
        const chat = char.chats[0]

        char.triggerscript.push(trig('parent', 'manual', [
            v2('v2RunTrigger', { target: 'child' }),
            v2('v2SetReplaceGlobalNote', { value: 'note', valueType: 'value' }),
        ]))
        char.triggerscript.push(trig('child', 'manual', [
            v2('v2SetCharacterDesc', { value: 'x', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 'parent', origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(DBState.db.characters[0].desc).toBe('x')
    })
})

describe('An unselected origin is saved', () => {
    test('a trigger whose origin is not selected still lands its writes on the origin, saved through encode and decode', async () => {
        const selected = makeCharacter('char-selected')
        const origin = makeCharacter('char-origin')
        installDb([selected, origin]) // index 0 selected, origin at index 1
        selectedCharID.set(0)

        const originChat = origin.chats[0]
        origin.triggerscript.push(trig('t', 'manual', [
            v2('v2SetCharacterDesc', { value: 'origin-new-desc', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'x', valueType: 'value', value: '1' }),
        ]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const handle = beginWork(origin, originChat)
        try {
            await runTrigger(origin, 'manual', { chat: originChat, manualName: 't', origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(DBState.db.characters[1].desc).toBe('origin-new-desc')
        expect(DBState.db.characters[1].chats[0].scriptstate['$x']).toBe('1')
        expect(DBState.db.characters[0].desc).toBe('char-selected-original-desc')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedOrigin = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-origin')
        expect(decodedOrigin?.desc).toBe('origin-new-desc')
        expect((decodedOrigin as unknown as { chats: { scriptstate: Record<string, string> }[] })?.chats[0].scriptstate?.['$x']).toBe('1')
    })
})

describe('Trigger definitions are not stamped onto shared entries', () => {
    // The module-trigger case (getModuleTriggers()'s own stamping) is covered
    // against the REAL `../modules.ts` in
    // `tests/modulesTriggerStamping.svelte.test.ts` instead of here: this
    // file's own `./modules` mock is a lightweight stand-in most of this
    // suite's other tests rely on, and it does not exercise modules.ts's own
    // stamping logic.

    test('a display run leaves a character triggerscript entry unchanged', async () => {
        const char = makeCharacter('char-disp')
        installDb([char])
        const trigger = trig('t', 'display', [v2('v2Comment', { value: '' })])
        trigger.lowLevelAccess = true // sentinel: differs from what stamping computes (false)
        char.triggerscript.push(trigger)
        const before = structuredClone(trigger)

        await runTrigger(char, 'display', { chat: char.chats[0], displayMode: true, tempVars: {} } as never)

        expect(char.triggerscript[0]).toStrictEqual(before)
    })

    test('a request run leaves a character triggerscript entry unchanged', async () => {
        const char = makeCharacter('char-req')
        installDb([char])
        const trigger = trig('t', 'request', [v2('v2Comment', { value: '' })])
        trigger.lowLevelAccess = true
        char.triggerscript.push(trigger)
        const before = structuredClone(trigger)

        await runTrigger(char, 'request', { chat: char.chats[0], displayMode: true, displayData: JSON.stringify([]) } as never)

        expect(char.triggerscript[0]).toStrictEqual(before)
    })

    test('a runLuaEditTrigger call leaves a character triggerscript entry unchanged', async () => {
        const char = makeCharacter('char-edit')
        installDb([char])
        const trigger = trig('t', 'input', [{ type: 'triggerlua', code: 'function onEditInput(id, v)\n  return v\nend' }])
        trigger.lowLevelAccess = true
        char.triggerscript.push(trigger)
        const before = structuredClone(trigger)

        await runLuaEditTrigger(char, 'editinput', 'hello')

        expect(char.triggerscript[0]).toStrictEqual(before)
    })
})

describe('A gone origin, in the run', () => {
    test('a chat deleted during the wait stops the run, so its later effect never lands', async () => {
        const char = makeCharacter('char-gonechat')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        const p = runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        char.chats.splice(0, 1) // the origin chat is gone, during the wait
        let threw = false
        try { await p } catch { threw = true }
        handle!.end()

        expect(threw).toBe(false)
        expect(DBState.db.characters[0].desc).toBe('char-gonechat-original-desc')
        expect(isWriting({ chaId: 'char-gonechat' })).toBe(false)
    })

    test('an owner deleted during the wait stops the run, so its later effect never lands', async () => {
        const char = makeCharacter('char-goneowner')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        const p = runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        DBState.db.characters.splice(0, 1) // the owner itself is gone, during the wait
        let threw = false
        try { await p } catch { threw = true }
        handle!.end()

        expect(threw).toBe(false)
        expect(char.desc).toBe('char-goneowner-original-desc')
    })

    test('a trashed owner still resolves, so its effect still lands', async () => {
        const char = makeCharacter('char-trashed')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'lands-anyway', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        const p = runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        char.trashTime = Date.now() // trashed, but not removed and not a cold-storage placeholder
        await p
        handle!.end()

        expect(DBState.db.characters[0].desc).toBe('lands-anyway')
    })
})

describe('An ambiguous origin, in the run', () => {
    test('a duplicate chat id appearing during the wait stops the run, so its later effect never lands', async () => {
        const char = makeCharacter('char-dupchat')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        const p = runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        char.chats.push(makeChat(chat.id)) // a second chat now holds the same id
        let threw = false
        try { await p } catch { threw = true }
        handle!.end()

        expect(threw).toBe(false)
        expect(DBState.db.characters[0].desc).toBe('char-dupchat-original-desc')
    })

    test('a duplicate chaId appearing during the wait stops the run, so its later effect never lands', async () => {
        const char = makeCharacter('char-dupcha')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        const p = runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        DBState.db.characters.push(makeCharacter('char-dupcha')) // a second character now holds the same chaId
        let threw = false
        try { await p } catch { threw = true }
        handle!.end()

        expect(threw).toBe(false)
        expect(char.desc).toBe('char-dupcha-original-desc')
    })
})

describe('A gone member in a group run', () => {
    test('a gone member skips its v2 character-field write, but a following chat write still lands on the group', async () => {
        const member = makeCharacter('member-gone')
        const group = makeGroup('group-membergone', ['member-gone'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'y', valueType: 'value', value: '1' }),
        ]))

        const handle = beginWork(group, groupChat, member)
        const p = runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        DBState.db.characters.splice(1, 1) // the member is deleted during the wait
        await p
        handle!.end()

        expect(member.desc).toBe('member-gone-original-desc')
        expect(DBState.db.characters[0].desc).toBe('group-membergone-group-desc')
        expect(DBState.db.characters[0].globalLore.length).toBe(0)
        // The point of the title's "but a following chat write still lands
        // on the group": v2SetVar, which runs AFTER the skipped v2SetCharacterDesc,
        // is chat data, so it must still land on the group's chat.
        expect(DBState.db.characters[0].chats[0].scriptstate['$y']).toBe('1')
    })
})

describe('Resolution cost is measured through a test seam', () => {
    test('a run with no await makes one full resolution; three waits each followed by a write make four', async () => {
        const chatOrigin = await import('./chatOrigin')
        const char = makeCharacter('char-rescount')
        installDb([char])
        const chat = char.chats[0]

        chatOrigin.resetResolutionCountForTests()
        const oneShotEffects = []
        for (let i = 0; i < 50; i++) {
            oneShotEffects.push(v2('v2SetVar', { operator: '=', var: `v${i}`, valueType: 'value', value: String(i) }))
        }
        char.triggerscript.push(trig('oneshot', 'manual', oneShotEffects))
        const handle1 = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 'oneshot', origin: handle1!.origin } as never)
        } finally { handle1!.end() }
        expect(chatOrigin.resolutionCountForTests()).toBe(1)

        chatOrigin.resetResolutionCountForTests()
        char.triggerscript.push(trig('threewaits', 'manual', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'a', valueType: 'value', value: '1' }),
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'b', valueType: 'value', value: '1' }),
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'c', valueType: 'value', value: '1' }),
        ]))
        const handle2 = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 'threewaits', origin: handle2!.origin } as never)
        } finally { handle2!.end() }
        expect(chatOrigin.resolutionCountForTests()).toBe(4)
    })
})

describe('Registration', () => {
    // This test's own `handle!.end()` call below is what clears the
    // registration -- `runTrigger` itself never calls `end()`. A caller that
    // reaches `handleButtonTriggerWithin` (see the `Chat.svelte` mount suite)
    // is what proves a real caller's own `finally` clears it without the
    // test doing so itself.
    test('isWriting reflects an in-flight run on the origin chat and the member, and end() clears it once called', async () => {
        const member = makeCharacter('member-reg')
        const group = makeGroup('group-reg', ['member-reg'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
        ]))

        const handle = beginWork(group, groupChat, member)
        expect(isWriting({ chaId: 'group-reg', chatId: groupChat.id })).toBe(true)
        expect(isWriting({ chaId: 'member-reg' })).toBe(true)

        const p = runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        // Still mid-flight: the run is suspended inside v2Wait right now.
        expect(isWriting({ chaId: 'group-reg', chatId: groupChat.id })).toBe(true)
        await p
        handle!.end()

        expect(isWriting({ chaId: 'group-reg', chatId: groupChat.id })).toBe(false)
        expect(isWriting({ chaId: 'member-reg' })).toBe(false)
    })

    test('the registry clears even when an effect throws', async () => {
        const char = makeCharacter('char-throw')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            { type: 'command', value: 'boom' },
        ]))
        processMultiCommandMock.mockImplementationOnce(async () => { throw new Error('boom') })

        const handle = beginWork(char, chat)
        let threw = false
        try {
            await runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        } catch {
            threw = true
        } finally {
            handle!.end()
        }

        expect(threw).toBe(true)
        expect(isWriting({ chaId: 'char-throw' })).toBe(false)
    })
})

describe('Read-your-writes (guard)', () => {
    test('a var set before an await is read back correctly by a later effect in the same run', async () => {
        const char = makeCharacter('char-ryw')
        installDb([char])
        const chat = char.chats[0]
        char.triggerscript.push(trig('t', 'manual', [
            v2('v2SetVar', { operator: '=', var: 'x', valueType: 'value', value: '1' }),
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'y', valueType: 'var', value: 'x' }),
        ]))

        const handle = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(DBState.db.characters[0].chats[0].scriptstate['$y']).toBe('1')
    })
})

describe('A plain run with no switch (guard)', () => {
    test('with no switch, the nine v2 effects and setvar write the selected character\'s own fields', async () => {
        const char = makeCharacter('char-plain')
        installDb([char])
        const chat = char.chats[0]
        // v2ModifyLorebook/v2SetLorebookActivation address globalLore entries
        // by array index (`v[0]`/`v[2]`, a tuple shape); v2CreateLorebook and
        // the ModifyByIndex/AlwaysActive/DeleteByIndex effects address the
        // object shape (`.comment`/`.alwaysActive`) instead. Both APIs write
        // the same `char.globalLore` array, so this fixture keeps a tuple
        // entry at index 0 for the first pair and lets v2CreateLorebook
        // append its own object entry afterward, rather than mixing shapes on
        // one entry.
        chat.localLore = []
        ;(char as { globalLore: unknown[] }).globalLore = [['tuple-key', 'tuple-value', false]]

        char.triggerscript.push(trig('t', 'manual', [
            { type: 'setvar', operator: '=', var: 'z', value: '9' },
            v2('v2ModifyLorebook', { target: 'tuple-key', targetType: 'value', value: 'tuple-modified', valueType: 'value' }),
            v2('v2SetLorebookActivation', { index: '0', indexType: 'value', value: true }),
            v2('v2SetCharacterDesc', { value: 'plain-new-desc', valueType: 'value' }),
            v2('v2SetReplaceGlobalNote', { value: 'plain-note', valueType: 'value' }),
            v2('v2CreateLorebook', { name: 'n', nameType: 'value', key: 'k', keyType: 'value', content: 'c', contentType: 'value', insertOrder: '100', insertOrderType: 'value' }),
            v2('v2ModifyLorebookByIndex', { index: '1', indexType: 'value', name: 'n2', nameType: 'value', key: 'k2', keyType: 'value', content: 'c2', contentType: 'value', insertOrder: '5', insertOrderType: 'value' }),
            v2('v2SetLorebookAlwaysActive', { index: '1', indexType: 'value', value: true }),
            v2('v2CreateLorebook', { name: 'delete-me', nameType: 'value', key: '', keyType: 'value', content: '', contentType: 'value', insertOrder: '0', insertOrderType: 'value' }),
            v2('v2DeleteLorebookByIndex', { index: '2', indexType: 'value' }),
            v2('v2SetAuthorNote', { value: 'plain-authornote', valueType: 'value' }),
        ]))

        const handle = beginWork(char, chat)
        try {
            await runTrigger(char, 'manual', { chat, manualName: 't', origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(DBState.db.characters[0].chats[0].scriptstate['$z']).toBe('9')
        expect(DBState.db.characters[0].desc).toBe('plain-new-desc')
        expect(DBState.db.characters[0].replaceGlobalNote).toBe('plain-note')
        expect(DBState.db.characters[0].globalLore[0][1]).toBe('tuple-modified')
        expect(DBState.db.characters[0].globalLore[0][2]).toBe(true)
        expect(DBState.db.characters[0].globalLore.length).toBe(2) // the scratch "delete-me" entry was removed
        expect(DBState.db.characters[0].globalLore[1].comment).toBe('n2')
        expect(DBState.db.characters[0].globalLore[1].alwaysActive).toBe(true)
        expect(DBState.db.characters[0].chats[0].note).toBe('plain-authornote')
    })

    test('with no switch, the four Lua character setters write the selected character\'s own fields', async () => {
        const char = makeCharacter('char-luaplain')
        installDb([char])
        const chat = char.chats[0]
        const code = [
            'function luaplain(id)',
            '  setName(id, "new-name")',
            '  setDescription(id, "new-lua-desc")',
            '  setCharacterFirstMessage(id, "new-first")',
            '  setBackgroundEmbedding(id, "new-bg")',
            'end',
        ].join('\n')
        char.triggerscript.push(trig('luaplain', 'manual', [{ type: 'triggerlua', code }]))

        await runTrigger(char, 'manual', { chat, manualName: 'luaplain' } as never)

        expect(DBState.db.characters[0].name).toBe('new-name')
        expect(DBState.db.characters[0].desc).toBe('new-lua-desc')
        expect(DBState.db.characters[0].firstMessage).toBe('new-first')
        expect(DBState.db.characters[0].backgroundHTML).toBe('new-bg')
    })
})

describe('Lua character bindings in a group run act on the owner (guard)', () => {
    test('a member\'s setBackgroundEmbedding changes the group\'s backgroundHTML', async () => {
        const member = makeCharacter('member-bg')
        const group = makeGroup('group-bg', ['member-bg'], { backgroundHTML: '' })
        installDb([group, member])
        selectedCharID.set(0)

        member.triggerscript.push(trig('m', 'output', [
            { type: 'triggerlua', code: 'function onOutput(id)\n  setBackgroundEmbedding(id, "group-bg-value")\nend' },
        ]))

        const handle = beginWork(group, group.chats[0], member)
        try {
            await runTrigger(member, 'output', { chat: group.chats[0], origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(DBState.db.characters[0].backgroundHTML).toBe('group-bg-value')
    })
})

describe('Display and request runs (guard)', () => {
    test('a display run writes only temp variables, never a character field', async () => {
        const char = makeCharacter('char-displayonly')
        installDb([char])
        char.triggerscript.push(trig('t', 'display', [
            v2('v2SetVar', { operator: '=', var: 'temp', valueType: 'value', value: '1' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const tempVars: Record<string, string> = {}
        await runTrigger(char, 'display', { chat: char.chats[0], displayMode: true, tempVars } as never)

        expect(tempVars.temp).toBe('1')
        expect(char.desc).toBe('char-displayonly-original-desc')
    })

    test('a request run writes only request state, never a character field', async () => {
        const char = makeCharacter('char-requestonly')
        installDb([char])
        char.triggerscript.push(trig('t', 'request', [
            v2('v2SetRequestStateRole', { index: '0', indexType: 'value', value: 'system', valueType: 'value' }),
            v2('v2SetCharacterDesc', { value: 'should-not-land', valueType: 'value' }),
        ]))

        const result = await runTrigger(char, 'request', {
            chat: char.chats[0],
            displayMode: true,
            displayData: JSON.stringify([{ role: 'user', content: 'hi' }]),
        } as never)

        expect(result?.displayData ? JSON.parse(result.displayData)[0].role : undefined).toBe('system')
        expect(char.desc).toBe('char-requestonly-original-desc')
    })
})

describe('Diagnostic: the mark is load-bearing', () => {
    test('with marking disabled, an unselected origin\'s write is lost after encode and decode', async () => {
        vi.doMock('../storage/characterSaveMarks', async () => {
            const real = await vi.importActual('../storage/characterSaveMarks') as typeof import('../storage/characterSaveMarks')
            return {
                ...real,
                markCharacterForSave: () => {}, // marking disabled
            }
        })
        vi.resetModules()

        const chatOriginNoMark = await import('./chatOrigin')
        const triggersNoMark = await import('./triggers')
        const marksNoMark = await import('../storage/characterSaveMarks')

        const selected = makeCharacter('char-selected-diag')
        const origin = makeCharacter('char-origin-diag')
        installDb([selected, origin])
        selectedCharID.set(0)
        const originChat = origin.chats[0]

        origin.triggerscript.push(trig('t', 'manual', [
            v2('v2SetCharacterDesc', { value: 'origin-new-desc', valueType: 'value' }),
        ]))

        const tracker = makeTracker()
        marksNoMark.installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const handle = chatOriginNoMark.beginWork(origin, originChat)
        try {
            await triggersNoMark.runTrigger(origin, 'manual', { chat: originChat, manualName: 't', origin: handle!.origin } as never)
        } finally { handle!.end() }

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedOrigin = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-origin-diag')

        // Isolates the mark's own role: with marking disabled, an
        // unselected origin's write is lost after encode and decode, so the
        // mark -- not the identity tracker -- is what saves an in-place
        // write to a character other than the selected one.
        expect(decodedOrigin?.desc).not.toBe('origin-new-desc')

        vi.doUnmock('../storage/characterSaveMarks')
        vi.resetModules()
    })
})

describe('The Lua button binding resolves through its origin, not the selection (guard)', () => {
    test('with an origin, a switch during the script\'s own await does not move where addChat lands', async () => {
        const char = makeCharacter('char-luabtn-origin')
        const chatA = makeChat('chat-a')
        const chatB = makeChat('chat-b')
        char.chats = [chatA, chatB]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            // `:await()` only works inside the `async(...)` coroutine
            // wrapper -- a plain `function onButtonClick` that awaits
            // fails with "cannot yield in callbacks from javascript".
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  addChat(id, "user", "lua-added-message")',
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

        const p = runLuaButtonTrigger(char, 'click-data', handle!.origin)
        await reached

        char.chatPage = 1 // the selection moves to chat B, during the script's own await

        releaseGate()
        await p
        handle!.end()

        expect(chatA.message.some((m) => m.data === 'lua-added-message')).toBe(true)
        expect(chatB.message.some((m) => m.data === 'lua-added-message')).toBe(false)
    })
})

/**
 * An `alertInput` gate a test can control by hand: the mock resolves once
 * `reached` settles (confirming the Lua script's own `await` was actually
 * entered), and does not itself resolve until `releaseGate()` is called.
 */
function makeAlertGate() {
    let releaseGate: () => void = () => {}
    const gate = new Promise<string>((res) => { releaseGate = () => res('answer') })
    let reachedResolve: () => void = () => {}
    const reached = new Promise<void>((res) => { reachedResolve = res })
    vi.mocked(alertInput).mockImplementationOnce(async () => {
        reachedResolve()
        return gate
    })
    return { reached, releaseGate }
}

describe('Lua writes to an unselected origin are marked for save', () => {
    test('a Lua button\'s addChat, to an unselected origin, survives encode and decode', async () => {
        const charA = makeCharacter('char-unsel-addchat-A')
        const charB = makeCharacter('char-unsel-addchat-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  addChat(id, "user", "b1-added-message")',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1) // select B, during the script's own await

        releaseGate()
        await p
        handle!.end()

        // The live write already lands correctly (the origin resolves by
        // id, never through the selection) -- only the SAVE is at issue.
        expect(chatA.message.some((m) => m.data === 'b1-added-message')).toBe(true)

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-addchat-A')
        expect(decodedA?.chats[0].message.some((m: { data: string }) => m.data === 'b1-added-message')).toBe(true)
    })

    test('a Lua button\'s setDescription, to an unselected origin, survives encode and decode', async () => {
        const charA = makeCharacter('char-unsel-setdesc-A')
        const charB = makeCharacter('char-unsel-setdesc-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  setDescription(id, "b1-new-desc")',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1)

        releaseGate()
        await p
        handle!.end()

        expect(charA.desc).toBe('b1-new-desc')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-setdesc-A')
        expect(decodedA?.desc).toBe('b1-new-desc')
    })

    test('a Lua button\'s upsertLocalLoreBook, to an unselected origin, survives encode and decode', async () => {
        const charA = makeCharacter('char-unsel-lore-A')
        const charB = makeCharacter('char-unsel-lore-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  upsertLocalLoreBook(id, "b1-entry", "content", {})',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1)

        releaseGate()
        await p
        handle!.end()

        expect(chatA.localLore.length).toBe(1)

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-lore-A')
        expect(decodedA?.chats[0].localLore.length).toBe(1)
    })

    test('a triggerlua effect\'s write made before its own internal await is already saved when encoded mid-await', async () => {
        const charA = makeCharacter('char-unsel-triggerlua-A')
        installDb([charA])
        selectedCharID.set(0)
        const chatA = charA.chats[0]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                't = async(function(id)',
                '  setDescription(id, "before-await-desc")',
                '  alertInput(id, "wait"):await()',
                '  addChat(id, "user", "after-await-msg")',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runTrigger(charA, 'manual', { chat: chatA, manualName: 't', origin: handle!.origin } as never)
        await reached

        // Encode NOW, mid-Lua-await -- before the triggerlua effect (and so
        // the mark it makes once `runScripted` returns) has run.
        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-triggerlua-A')

        releaseGate()
        await p
        handle!.end()

        expect(decodedA?.desc).toBe('before-await-desc')
    })

    test('a Lua button\'s removeChat, on an unselected origin, survives encode and decode', async () => {
        const charA = makeCharacter('char-unsel-removechat-A')
        const charB = makeCharacter('char-unsel-removechat-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]
        chatA.message = [{ role: 'user', data: 'keep-me' }, { role: 'user', data: 'remove-me' }]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  removeChat(id, 1)',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1) // select B, during the script's own await

        releaseGate()
        await p
        handle!.end()

        expect(chatA.message.length).toBe(1)
        expect((chatA.message[0] as { data: string }).data).toBe('keep-me')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-removechat-A')
        expect(decodedA?.chats[0].message.length).toBe(1)
        expect((decodedA?.chats[0].message[0] as { data: string }).data).toBe('keep-me')
    })

    test('a Lua button\'s setFullChat, on an unselected origin, survives encode and decode', async () => {
        const charA = makeCharacter('char-unsel-fullchat-A')
        const charB = makeCharacter('char-unsel-fullchat-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]
        chatA.message = [{ role: 'user', data: 'stale-message' }]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  setFullChat(id, {{role="user", data="replaced-message"}})',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1) // select B, during the script's own await

        releaseGate()
        await p
        handle!.end()

        expect(chatA.message.length).toBe(1)
        expect((chatA.message[0] as { data: string }).data).toBe('replaced-message')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-unsel-fullchat-A')
        expect(decodedA?.chats[0].message.length).toBe(1)
        expect((decodedA?.chats[0].message[0] as { data: string }).data).toBe('replaced-message')
    })
})

describe('A gone member and effects that follow it', () => {
    test('a nested trigger after the member is gone does not throw, and a following chat write still lands on the group', async () => {
        const member = makeCharacter('member-nestedgone')
        const group = makeGroup('group-nestedgone', ['member-nestedgone'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2RunTrigger', { target: 'child' }),
            v2('v2SetVar', { operator: '=', var: 'y', valueType: 'value', value: '1' }),
        ]))
        member.triggerscript.push(trig('child', 'manual', [
            v2('v2SetCharacterDesc', { value: 'should-not-matter', valueType: 'value' }),
        ]))

        const handle = beginWork(group, groupChat, member)
        const p = runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        DBState.db.characters.splice(1, 1) // the member is deleted during the wait
        let threw = false
        try {
            await p
        } catch {
            threw = true
        }
        handle!.end()

        expect(threw).toBe(false)
        expect(groupChat.scriptstate['$y']).toBe('1')
    })

    test('a v1 runtrigger effect after the member is gone does not throw, and a following chat write still lands on the group', async () => {
        const member = makeCharacter('member-nestedgone-v1')
        const group = makeGroup('group-nestedgone-v1', ['member-nestedgone-v1'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            { type: 'runtrigger', value: 'child' },
            v2('v2SetVar', { operator: '=', var: 'w', valueType: 'value', value: '1' }),
        ]))
        member.triggerscript.push(trig('child', 'manual', [
            v2('v2SetCharacterDesc', { value: 'should-not-matter', valueType: 'value' }),
        ]))

        const handle = beginWork(group, groupChat, member)
        const p = runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        DBState.db.characters.splice(1, 1) // the member is deleted during the wait
        let threw = false
        try {
            await p
        } catch {
            threw = true
        }
        handle!.end()

        expect(threw).toBe(false)
        expect(groupChat.scriptstate['$w']).toBe('1')
    })

    test('v2ImgGen after the member is gone does not call generateAIImage with the group; it generates nothing', async () => {
        const member = makeCharacter('member-imggone', { lowLevelAccess: true })
        const group = makeGroup('group-imggone', ['member-imggone'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2ImgGen', { value: 'prompt', valueType: 'value', negValue: '', negValueType: 'value', outputVar: 'imgresult' }),
        ]))

        vi.mocked(generateAIImage).mockClear()

        const handle = beginWork(group, groupChat, member)
        const p = runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        DBState.db.characters.splice(1, 1) // the member is deleted during the wait
        await p
        handle!.end()

        expect(generateAIImage).not.toHaveBeenCalled()
    })
})

describe('Lua character setters resolve through the origin, not the selection', () => {
    test.each([
        ['setName', 'name'],
        ['setDescription', 'desc'],
        ['setCharacterFirstMessage', 'firstMessage'],
        ['setBackgroundEmbedding', 'backgroundHTML'],
    ] as const)('%s lands on the origin owner, not the character selected during the wait', async (luaFn, field) => {
        const charA = makeCharacter(`char-luasetter-${luaFn}-A`)
        const charB = makeCharacter(`char-luasetter-${luaFn}-B`)
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]
        const value = `luasetter-${luaFn}-value`

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                't = async(function(id)',
                '  alertInput(id, "wait"):await()',
                `  ${luaFn}(id, "${value}")`,
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runTrigger(charA, 'manual', { chat: chatA, manualName: 't', origin: handle!.origin } as never)
        await reached

        selectedCharID.set(1) // the selection moves to B, during the internal Lua await

        releaseGate()
        await p
        handle!.end()

        expect((DBState.db.characters[0] as unknown as Record<string, string>)[field]).toBe(value)
        expect((DBState.db.characters[1] as unknown as Record<string, string>)[field]).not.toBe(value)
    })
})

describe('Lua generateImage in a group run uses the runner, not the group', () => {
    test('a member\'s generateImage calls generateAIImage with the member', async () => {
        const member = makeCharacter('member-img', { lowLevelAccess: true })
        const group = makeGroup('group-img', ['member-img'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: 'function onOutput(id)\n  generateImage(id, "prompt", "")\nend',
        }]))

        vi.mocked(generateAIImage).mockClear()

        const handle = beginWork(group, groupChat, member)
        try {
            await runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(generateAIImage).toHaveBeenCalled()
        expect(vi.mocked(generateAIImage).mock.calls[0][1]).toBe(member)
    })
})

describe('Lua upsertLocalLoreBook in a group run lands on the group\'s chat', () => {
    test('a member\'s upsertLocalLoreBook writes the group\'s localLore, though the runner\'s (not the group\'s) type is what the check must pass', async () => {
        const member = makeCharacter('member-lore')
        const group = makeGroup('group-lore', ['member-lore'])
        installDb([group, member])
        selectedCharID.set(0)
        const groupChat = group.chats[0]

        member.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: 'function onOutput(id)\n  upsertLocalLoreBook(id, "group-lore-entry", "content", {})\nend',
        }]))

        const handle = beginWork(group, groupChat, member)
        try {
            await runTrigger(member, 'output', { chat: groupChat, origin: handle!.origin } as never)
        } finally { handle!.end() }

        expect(groupChat.localLore.length).toBe(1)
        expect((groupChat.localLore[0] as { comment: string }).comment).toBe('group-lore-entry')
    })
})

describe('Each write marks its own origin, in isolation', () => {
    async function runSingleEffectOnUnselectedOrigin(chaSuffix: string, effect: unknown) {
        const selected = makeCharacter(`char-iso-selected-${chaSuffix}`)
        const origin = makeCharacter(`char-iso-origin-${chaSuffix}`)
        installDb([selected, origin])
        selectedCharID.set(0)
        const originChat = origin.chats[0]
        origin.triggerscript.push(trig('t', 'manual', [effect]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const handle = beginWork(origin, originChat)
        try {
            await runTrigger(origin, 'manual', { chat: originChat, manualName: 't', origin: handle!.origin } as never)
        } finally { handle!.end() }

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        return decoded.characters?.find((c: { chaId: string }) => c.chaId === `char-iso-origin-${chaSuffix}`)
    }

    test('v2SetAuthorNote alone marks the origin chat\'s note for save', async () => {
        const decodedOrigin = await runSingleEffectOnUnselectedOrigin('note', v2('v2SetAuthorNote', { value: 'm2-note', valueType: 'value' }))
        expect(decodedOrigin?.chats[0].note).toBe('m2-note')
    })

    test('v2CreateLorebook alone marks the origin\'s globalLore for save', async () => {
        const decodedOrigin = await runSingleEffectOnUnselectedOrigin('lore', v2('v2CreateLorebook', { name: 'm2-name', nameType: 'value', key: 'k', keyType: 'value', content: 'c', contentType: 'value', insertOrder: '100', insertOrderType: 'value' }))
        expect(decodedOrigin?.globalLore.length).toBe(1)
    })

    test('impersonate alone marks the origin chat\'s message for save', async () => {
        const decodedOrigin = await runSingleEffectOnUnselectedOrigin('imp', { type: 'impersonate', role: 'user', value: 'm2-impersonated' })
        expect(decodedOrigin?.chats[0].message.some((m: { data: string }) => m.data === 'm2-impersonated')).toBe(true)
    })

    test('v2SetCharacterDesc alone marks the origin\'s desc for save', async () => {
        const decodedOrigin = await runSingleEffectOnUnselectedOrigin('desc', v2('v2SetCharacterDesc', { value: 'm2-desc', valueType: 'value' }))
        expect(decodedOrigin?.desc).toBe('m2-desc')
    })

    test('v2SetVar alone marks the origin chat\'s scriptstate for save', async () => {
        const decodedOrigin = await runSingleEffectOnUnselectedOrigin('var', v2('v2SetVar', { operator: '=', var: 'm2v', valueType: 'value', value: '1' }))
        expect((decodedOrigin as unknown as { chats: { scriptstate: Record<string, string> }[] })?.chats[0].scriptstate?.['$m2v']).toBe('1')
    })
})

describe('Lua setChatVar/getChatVar resolve through the run\'s origin, not the selection', () => {
    test('a switch to another chat of the same character during the button\'s own await does not move where setChatVar lands', async () => {
        const char = makeCharacter('char-setchatvar-samechar')
        const chatA1 = makeChat('chat-m23-a1')
        const chatA2 = makeChat('chat-m23-a2')
        char.chats = [chatA1, chatA2]
        installDb([char])
        selectedCharID.set(0)

        char.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  setChatVar(id, "k", "v")',
                '  local readback = getChatVar(id, "k")',
                '  setChatVar(id, "k2", readback)',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(char, chatA1)
        const p = runLuaButtonTrigger(char, 'click-data', handle!.origin)
        await reached

        char.chatPage = 1 // the selection moves to A2, during the button's own internal await

        releaseGate()
        await p
        handle!.end()

        // The button's origin is chat A1, fixed at the click -- a chat
        // switch during the script's own internal await must not move where
        // setChatVar/getChatVar act, and a read after the write sees it.
        expect(chatA1.scriptstate['$k']).toBe('v')
        expect(chatA2.scriptstate['$k']).toBeUndefined()
        expect(chatA1.scriptstate['$k2']).toBe('v')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-setchatvar-samechar')
        expect(decodedChar?.chats[0].scriptstate?.['$k']).toBe('v')
    })

    test('a switch to another character during the button\'s own await does not move where setChatVar lands', async () => {
        const charA = makeCharacter('char-setchatvar-A')
        const charB = makeCharacter('char-setchatvar-B')
        installDb([charA, charB])
        selectedCharID.set(0)
        const chatA = charA.chats[0]
        const chatB = charB.chats[0]

        charA.triggerscript.push(trig('t', 'manual', [{
            type: 'triggerlua',
            code: [
                'onButtonClick = async(function(id, data)',
                '  alertInput(id, "wait"):await()',
                '  setChatVar(id, "k", "v")',
                '  local readback = getChatVar(id, "k")',
                '  setChatVar(id, "k2", readback)',
                'end)',
            ].join('\n'),
        }]))

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(charA, chatA)
        const p = runLuaButtonTrigger(charA, 'click-data', handle!.origin)
        await reached

        selectedCharID.set(1) // the selection moves to character B, during the button's own internal await

        releaseGate()
        await p
        handle!.end()

        expect(chatA.scriptstate['$k']).toBe('v')
        expect(chatB.scriptstate['$k']).toBeUndefined()
        expect(chatA.scriptstate['$k2']).toBe('v')

        await encoder.set(snapshotDb(DBState.db), structuredClone(tracker))
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((c: { chaId: string }) => c.chaId === 'char-setchatvar-A')
        expect(decodedA?.chats[0].scriptstate?.['$k']).toBe('v')
    })
})
