// @vitest-environment node

/**
 * The `editinput` path: `sendCharacterMessage`'s own input trigger and its
 * `processScript(char, messageInput, 'editinput')` call run after that
 * trigger's own await, so its Lua `editInput` listener, its regex scripts,
 * and their module selection must resolve the send's own origin chat, not
 * whichever chat is selected on screen by the time the call actually runs.
 * Drives the real `sendCharacterMessage` (`../sendCharacterMessage`), the
 * real `processScript`/`processScriptFull` (`../scripts`), the real
 * `runLuaEditTrigger` and Lua (wasmoon, via the real `../scriptings`), the
 * real `getModuleTriggers`/`getModuleRegexScripts` (`../modules`), and the
 * real `risuChatParser`/`cbs.ts` (via `../../parser/parser.svelte`).
 * `dompurify` is mocked as an inert passthrough and this file needs
 * `@vitest-environment node` for wasmoon's own sake, both for the same
 * reason `triggerOriginReads.svelte.test.ts` documents in its own banner:
 * real DOMPurify (needs `window`/`document`) and real wasmoon (needs them
 * absent) cannot coexist in one process, and sanitization is not part of
 * what this suite tests. `../../plugins/plugins.svelte` is mocked (its
 * `SafeDocument` reads `document` at module load) rather than `../scripts`
 * itself, since `processScript` is the real module under test here.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { triggerscript } from '../triggers'

//#region module mocks

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as any }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
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
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)),
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

// Inert passthrough -- real DOMPurify (needs `window`/`document`) and real
// wasmoon (needs them absent) cannot both load in this process; see the
// file banner.
vi.mock('dompurify', () => ({
    default: { addHook: vi.fn(), sanitize: (html: string) => html },
}))

// Pulled in only because `../../util`'s real module (loaded below through
// `vi.importActual`) imports them at its own top level.
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/path', () => ({
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({
    default: class {},
}))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(() => ({ name: '', chaId: '' })),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

// Real-shaped: only `checkPersonaBinded`/`getUserName`/`getPersonaPrompt`/
// `getUserIcon` are the actual `../../util` implementations (taken through
// `vi.importActual`); everything else is a light stand-in, matching
// `triggerOriginReads.svelte.test.ts`'s own mock for the same reason (the
// real module also pulls in Tauri dialogs and `PopupList.svelte`).
vi.mock(import('../../util'), async () => {
    const real = await vi.importActual<typeof import('../../util')>('../../util')
    return {
        checkPersonaBinded: real.checkPersonaBinded,
        getUserName: real.getUserName,
        getPersonaPrompt: real.getPersonaPrompt,
        getUserIcon: real.getUserIcon,
        pickHashRand: real.pickHashRand,
        replaceAsync: real.replaceAsync,
        findCharacterbyId: (id: string) => {
            const db = (globalThis as unknown as { __risuTestDb?: Database }).__risuTestDb
            for (const char of db?.characters ?? []) {
                if (char && (char as { chaId?: string }).chaId === id && char.type !== 'group') {
                    return char
                }
            }
            return { name: 'Unknown Character' } as unknown as character
        },
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
        selectSingleFile: vi.fn(),
        asBuffer: vi.fn(() => new Uint8Array()),
    } as unknown as typeof import('../../util')
})

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    convertExternalLorebook: vi.fn((v: unknown) => v),
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

// `../../plugins/plugins.svelte`'s `pluginV2` -- real `../scripts` (the
// module under test) checks `pluginV2[mode].size`, and the real plugin
// module's own `SafeDocument` reads `document` at load time.
vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
    },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

// `../../model/modellist`'s `getModelInfo` -- `../../parser/parser.svelte`'s
// own import; the real module pulls in `../../plugins/plugins.svelte`
// transitively.
vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({
        id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
        internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0,
    })),
}) as unknown as typeof import('../../model/modellist'))

// Real-shaped re-implementation of database.svelte.ts's own selection
// accessors, reading/writing through the same mocked `DBState`/`selectedCharID`
// above -- matches `triggerOriginReads.svelte.test.ts`'s own stand-in.
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
        appVer: '1234.5.67',
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

// `../modules.ts`'s own extra dependencies -- not reached by
// `getModuleTriggers()`/`getModuleRegexScripts()`, the only entry points
// this suite exercises.
vi.mock(import('../../media'), () => ({
    compressImage: vi.fn(async (v: unknown) => v),
}) as unknown as typeof import('../../media'))

vi.mock(import('../../rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()),
    encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('../../rpack/rpack_js'))

vi.mock(import('../../interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('../../interchangeability'))

vi.mock(import('../../characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('../../characterCards'))

// `../../parser/parser.svelte` (risuChatParser, cbs.ts), `../modules`
// (getModuleTriggers/getModuleRegexScripts), `../scriptings`
// (runLuaEditTrigger), `../scripts` (processScript) and
// `../sendCharacterMessage` are not mocked -- they are real.

//#endregion

let sendCharacterMessage: typeof import('../sendCharacterMessage').sendCharacterMessage
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let resetScriptCache: typeof import('../scripts').resetScriptCache
let processScript: (char: character, data: string, mode: string, cbsConditions?: unknown, origin?: import('../chatOrigin').Origin) => Promise<string>
let installCharacterSaveMarks: typeof import('../../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest
let originOf: typeof import('../chatOrigin').originOf
let beginWork: typeof import('../chatOrigin').beginWork

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const send = await import('../sendCharacterMessage')
    sendCharacterMessage = send.sendCharacterMessage
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const scripts = await import('../scripts')
    resetScriptCache = scripts.resetScriptCache
    processScript = scripts.processScript as never
    const marks = await import('../../storage/characterSaveMarks')
    installCharacterSaveMarks = marks.installCharacterSaveMarks
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
    const origin = await import('../chatOrigin')
    originOf = origin.originOf
    beginWork = origin.beginWork
})

//#region fixtures

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
        modules: [] as string[],
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
        desc: `${chaId}-desc`,
        firstMessage: `${chaId}-first-message`,
        lowLevelAccess: false,
        modules: [] as string[],
        ...overrides,
    } as unknown as character
}

function installDb(characters: character[] = [], extra: Record<string, unknown> = {}) {
    DBState.db = {
        characters,
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        enabledModules: [] as string[],
        presetRegex: [] as unknown[],
        globalChatVariables: {} as Record<string, string>,
        ...extra,
    } as unknown as Database
    ;(globalThis as unknown as { __risuTestDb: Database }).__risuTestDb = DBState.db
    selectedCharID.set(0)
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
    resetCharacterSaveMarksForTest()
    resetScriptCache()
})

//#endregion

describe('editinput\'s module selection, Lua write and regex read all resolve the send\'s own origin chat', () => {
    test('a switch right after the send starts still lands the editinput module\'s Lua write and regex read on the send\'s own chat', async () => {
        const origin = makeCharacter('char-editinput-send', {
            chats: [makeChat('chat-editinput-send', { scriptstate: { '$y': 'origin-y' }, modules: ['mod-editinput-A'] })],
        })
        const other = makeCharacter('char-editinput-other', {
            chats: [makeChat('chat-editinput-other', { scriptstate: { '$y': 'other-y' }, modules: ['mod-editinput-B'] })],
        })
        installDb([origin, other], {
            modules: [
                {
                    id: 'mod-editinput-A',
                    trigger: [trig('modAtrig', 'input', [{
                        type: 'triggerlua',
                        code: [
                            'listenEdit(\'editInput\', function(id, value, meta)',
                            '  setState(id, \'markerA\', \'from-modA\')',
                            '  return value',
                            'end)',
                        ].join('\n'),
                    }])],
                    regex: [{ type: 'editinput', in: 'REGEXMARKER', out: 'from-modA-y-{{getvar::y}}', flag: '', ableFlag: false }],
                },
                {
                    id: 'mod-editinput-B',
                    trigger: [trig('modBtrig', 'input', [{
                        type: 'triggerlua',
                        code: [
                            'listenEdit(\'editInput\', function(id, value, meta)',
                            '  setState(id, \'markerB\', \'from-modB\')',
                            '  return value',
                            'end)',
                        ].join('\n'),
                    }])],
                    regex: [{ type: 'editinput', in: 'REGEXMARKER', out: 'from-modB-y-{{getvar::y}}', flag: '', ableFlag: false }],
                },
            ],
        })
        selectedCharID.set(0) // "origin" (the sender) is selected when the send starts

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const chatA = origin.chats[0]
        const chatB = other.chats[0]

        const workHandle = beginWork(origin, chatA)!
        const p = sendCharacterMessage(workHandle, origin, chatA, 'REGEXMARKER', new AbortController().signal, () => {})
        // A caller of an async function runs synchronously up to its first
        // `await` regardless of that await's duration -- `sendCharacterMessage`
        // yields at its own `runTrigger('input', ...)` call before this
        // line runs, so this switch always lands truly after the input
        // trigger's own await.
        selectedCharID.set(1) // switch to "other", whose chat enables the other module
        const result = await p
        workHandle.end()

        expect(result).toBe(true)

        // modA is the send's own chat's module: its Lua write must land on
        // chatA, and its regex output (its own `{{getvar::y}}` read) must
        // resolve chatA's `y`, giving this exact combined string.
        expect(JSON.parse(chatA.scriptstate['$__markerA'] as string ?? 'null')).toBe('from-modA')

        // modB is enabled only for the chat the selection switched to; it
        // must never run for this send at all.
        expect(chatB.scriptstate['$__markerB']).toBeUndefined()

        // The regex script that actually ran, and what `{{getvar::y}}`
        // inside it read, are visible together in the appended message.
        const appended = chatA.message.at(-1) as { data: string } | undefined
        expect(appended?.data).toBe('from-modA-y-origin-y')
    })
})

describe('The editinput Lua write marks the send\'s own character for save (specification)', () => {
    // `sendCharacterMessage`'s own message append already marks its origin
    // for save, which would make that mark alone indistinguishable from the
    // editinput Lua write's own -- so this drives `processScript` directly,
    // with no message append at all, passing its optional `origin` argument
    // (the same kind of argument `runLuaEditTrigger` takes, and the
    // counterpart of `risuChatParser`'s own optional `subject`).
    test('with an origin, the Lua write marks the send\'s own (unselected) character for save', async () => {
        const origin = makeCharacter('char-editinput-markonly', {
            chats: [makeChat('chat-editinput-markonly', { modules: ['mod-editinput-mark'] })],
        })
        const other = makeCharacter('char-editinput-markonly-other')
        installDb([origin, other], {
            modules: [{
                id: 'mod-editinput-mark',
                trigger: [trig('modtrig', 'input', [{
                    type: 'triggerlua',
                    code: [
                        'listenEdit(\'editInput\', function(id, value, meta)',
                        '  setState(id, \'marked\', \'1\')',
                        '  return value',
                        'end)',
                    ].join('\n'),
                }])],
            }],
        })
        selectedCharID.set(1) // "other" is selected; origin is not

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        await processScript(origin, 'irrelevant text', 'editinput', {}, originOf(origin, origin.chats[0])!)

        expect(tracker.character).toContain('char-editinput-markonly')
    })
})
