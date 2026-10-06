// @vitest-environment node

/**
 * A trigger's or a Lua call's own reads follow its origin -- the resolved
 * owner and chat a run was started for -- not whichever chat is selected on
 * screen by the time the read runs. Drives the real `runTrigger`
 * (`../triggers`), the real `risuChatParser`/`cbs.ts` (via
 * `../../parser/parser.svelte`), the real `chatVar.svelte.ts`/
 * `infunctions.ts`, the real persona helpers from `../../util`
 * (`checkPersonaBinded`, `getUserName`, `getPersonaPrompt`, `getUserIcon` --
 * taken from the actual module through `vi.importActual`, never
 * re-implemented), the real `../modules` (`getModules` and its lookups), the
 * real `../lorebook.svelte` (`loadLoreBookV3Prompt`), and real Lua (wasmoon,
 * via the real `../scriptings`). This file needs `@vitest-environment node`
 * for wasmoon's own sake: wasmoon's WASM loader calls
 * `createRequire(import.meta.url)`, which needs a real `file://` URL --
 * under this project's default `happy-dom` environment, `import.meta.url`
 * resolves to an `http://` URL instead, and wasmoon fails outright. Under
 * plain Node, though, `document` is absent, and wasmoon's own module-load-time
 * script-path detection (`_scriptDir`) branches on `typeof document`, so
 * installing a `document` global for `../../parser/parser.svelte`'s sake
 * (its own module-load-time `DOMPurify.addHook` call needs one) would break
 * wasmoon's file resolution instead -- the two real dependencies want
 * opposite environments. `dompurify` itself is mocked as an inert
 * passthrough (`addHook` a no-op, `sanitize` the identity function) to
 * sidestep the conflict: sanitization is not part of what this suite tests,
 * and every parse this suite drives resolves per-chat data, never HTML
 * safety. `DBState.db` is a plain object (not a rune) -- nothing here needs
 * a reactive graph. Only network/storage/tokenizer/image I/O and the
 * packages that would otherwise pull in Tauri dialogs, `PopupList.svelte`,
 * and the module-import/character-card machinery are mocked; a stand-in for
 * any of the modules named above would test the stand-in, not the fix.
 *
 * Every non-display run forms its origin the way a real caller does:
 * `beginWork(owner, chat, member?)` on objects read back through `DBState`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import fc from 'fast-check'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { triggerscript, triggerEffect } from '../triggers'

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
    // `../modules.ts`'s own extra needs; unreached by `getModules()`/`getModuleTriggers()`.
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
    // `../modules.ts`'s own extra needs (module import/export plumbing), not
    // reached by any read path under test here.
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

// Inert passthrough -- see the file banner for why real DOMPurify (which
// needs `window`/`document`) and real wasmoon (which needs them absent)
// cannot both load in this one process.
vi.mock('dompurify', () => ({
    default: {
        addHook: vi.fn(),
        sanitize: (html: string) => html,
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

// The following four are pulled in only because `../../util`'s real module
// (loaded below through `vi.importActual` for its persona helpers) imports
// them at its own top level -- none is reached by any function this suite
// actually calls.
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

// Real-shaped: `checkPersonaBinded`, `getUserName`, `getPersonaPrompt` and
// `getUserIcon` are the actual implementations from `../../util`, taken
// through `vi.importActual` rather than re-implemented -- a stand-in for
// these four would test the stand-in, not the fix. Everything else `../../util`
// exports is replaced: `findCharacterbyId`/`pickHashRand`/`replaceAsync` with
// the real (pure, dependency-free) implementations copied inline, and
// `parseKeyValue`/`sleep` real-shaped to match
// `triggerOriginWrites.svelte.test.ts`'s own mock, since loading the actual
// `../../util` module in full would additionally pull in Tauri dialogs and
// `PopupList.svelte` well beyond what those four functions need.
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

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('../request/request'))

// `../../parser/parser.svelte`'s own `ParseMarkdown` (not exercised by this
// suite) calls `processScriptFull` for its `editdisplay` step; real
// `../scripts` pulls in `../../plugins/plugins.svelte`, whose `SafeDocument`
// reads `document` at module load, unavailable under this file's Node
// environment.
vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, data: string) => data),
    processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
    resetScriptCache: vi.fn(),
}) as unknown as typeof import('../scripts'))

// `../../parser/parser.svelte`'s own `getModelInfo` import; the real
// `../../model/modellist` pulls in `../../plugins/plugins.svelte`
// transitively (for its custom-provider machinery), same `document`-at-load
// problem as `../scripts` above.
vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({
        id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
        internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0,
    })),
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

// Real-shaped re-implementation of database.svelte.ts's own selection
// accessors, reading/writing through the same mocked `DBState`/`selectedCharID`
// above -- exactly `triggerOriginWrites.svelte.test.ts`'s own stand-in.
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

// `../modules.ts`'s own extra dependencies (module import/export, asset
// conversion) -- not reached by `getModules()`/`getModuleTriggers()`/
// `getModuleLorebooks()`, the only entry points this suite exercises.
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
// (getModules and its lookups) and `../lorebook.svelte`
// (loadLoreBookV3Prompt) are not mocked -- they are real, exactly as
// `tests/modulesTriggerStamping.svelte.test.ts` loads the real `../modules`
// against the same kind of stand-ins above.

//#endregion

let runTrigger: typeof import('../triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('../chatOrigin').beginWork
let createRunSubject: typeof import('../chatOrigin').createRunSubject
let originOf: typeof import('../chatOrigin').originOf
let resolutionCountForTests: typeof import('../chatOrigin').resolutionCountForTests
let resetResolutionCountForTests: typeof import('../chatOrigin').resetResolutionCountForTests
let runLuaButtonTrigger: typeof import('../scriptings').runLuaButtonTrigger
let runScripted: typeof import('../scriptings').runScripted
let alertInput: typeof import('../../alert').alertInput
let alertNormal: typeof import('../../alert').alertNormal
let readImage: typeof import('../../globalApi.svelte').readImage
let loadLoreBookV3Prompt: (target?: unknown) => ReturnType<typeof import('../lorebook.svelte').loadLoreBookV3Prompt>
let risuChatParser: typeof import('../../parser/parser.svelte').risuChatParser
let installCharacterSaveMarks: typeof import('../../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest

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
    createRunSubject = origin.createRunSubject
    originOf = origin.originOf
    resolutionCountForTests = origin.resolutionCountForTests
    resetResolutionCountForTests = origin.resetResolutionCountForTests
    const scriptings = await import('../scriptings')
    runLuaButtonTrigger = scriptings.runLuaButtonTrigger
    runScripted = scriptings.runScripted
    const alertMod = await import('../../alert')
    alertInput = alertMod.alertInput
    alertNormal = alertMod.alertNormal
    const globalApi = await import('../../globalApi.svelte')
    readImage = globalApi.readImage
    const lorebook = await import('../lorebook.svelte')
    loadLoreBookV3Prompt = lorebook.loadLoreBookV3Prompt as never
    const parser = await import('../../parser/parser.svelte')
    risuChatParser = parser.risuChatParser
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
        fmIndex: -1,
        modules: [] as string[],
        GLGlobalVariables: {} as Record<string, string>,
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
        desc: `${chaId}-desc`,
        personality: `${chaId}-personality`,
        scenario: `${chaId}-scenario`,
        exampleMessage: `${chaId}-example`,
        replaceGlobalNote: '',
        firstMessage: `${chaId}-first-message`,
        alternateGreetings: [] as string[],
        backgroundHTML: '',
        lowLevelAccess: false,
        image: `${chaId}-image.png`,
        emotionImages: [] as [string, string][],
        additionalAssets: [] as [string, string, string][],
        prebuiltAssetCommand: false,
        prebuiltAssetExclude: [] as string[],
        modules: [] as string[],
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
        backgroundHTML: '',
        ...overrides,
    } as unknown as groupChat
}

function installDb(characters: (character | groupChat)[] = [], extra: Record<string, unknown> = {}) {
    DBState.db = {
        characters,
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        enabledModules: [] as string[],
        loreBookDepth: 20,
        loreBookToken: 999999,
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

/** Starts a manual trigger without awaiting it, so the caller can mutate the
 * selection or the database synchronously right after -- a caller of an
 * async function runs synchronously up to its first `await` regardless of
 * that await's duration, so a switch performed immediately after this call
 * returns always lands truly "during" the run's own `v2Wait`. */
function startManualTrigger(char: character, chat: Chat, effects: unknown[], manualName = 't') {
    char.triggerscript.push(trig(manualName, 'manual', effects))
    const handle = beginWork(char, chat)!
    const p = runTrigger(char, 'manual', { chat, manualName, origin: handle.origin } as never)
    return { p, handle }
}

/** An `alertInput` gate a test can control by hand: the mock resolves once
 * `reached` settles (confirming the Lua script's own `await` was actually
 * entered), and does not itself resolve until `releaseGate()` is called. */
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

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    resetResolutionCountForTests()
    vi.mocked(readImage).mockClear()
})

//#endregion

describe('A trigger\'s CBS reads the origin chat, across a switch', () => {
    test('a v2SetVar whose value is {{getvar::src}} writes the origin chat\'s value, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-getvar', { chats: [makeChat('chat-origin-getvar', { scriptstate: { '$src': 'origin-src' } })] })
        const other = makeCharacter('char-other-getvar', { chats: [makeChat('chat-other-getvar', { scriptstate: { '$src': 'other-src' } })] })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'dst', valueType: 'value', value: '{{getvar::src}}' }),
        ])
        selectedCharID.set(1) // switch to "other", during the wait
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$dst']).toBe('origin-src')
    })

    test('a v2SetVar copying {{char}} in a non-group trigger writes the origin character\'s name, after a switch to another character', async () => {
        const origin = makeCharacter('char-origin-charname', { name: 'origin-name' })
        const other = makeCharacter('char-other-charname', { name: 'other-name' })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'outname', valueType: 'value', value: '{{char}}' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$outname']).toBe('origin-name')
    })
})

describe('#when conditions read the origin chat\'s variables', () => {
    test('#when var, vis, toggle and tis all read the origin chat, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-when', {
            chats: [makeChat('chat-origin-when', {
                scriptstate: { '$x': '0', '$y': 'origin-val' },
                GLGlobalVariables: { toggle_tg: '1', toggle_tv: 'origin-val2' },
            })],
        })
        const other = makeCharacter('char-other-when', {
            chats: [makeChat('chat-other-when', {
                scriptstate: { '$x': '1', '$y': 'other-val' },
                GLGlobalVariables: { toggle_tg: '0', toggle_tv: 'other-val2' },
            })],
        })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'whenvar', valueType: 'value', value: '{{#when::var::x}}YES{{/when}}' }),
            v2('v2SetVar', { operator: '=', var: 'whenvis', valueType: 'value', value: '{{#when::y::vis::origin-val}}YES{{/when}}' }),
            v2('v2SetVar', { operator: '=', var: 'whentoggle', valueType: 'value', value: '{{#when::toggle::tg}}YES{{/when}}' }),
            v2('v2SetVar', { operator: '=', var: 'whentis', valueType: 'value', value: '{{#when::tv::tis::origin-val2}}YES{{/when}}' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        // Origin's own $x is falsy ('0'), so #when::var::x must not render.
        expect(origin.chats[0].scriptstate['$whenvar']).toBe('')
        // Origin's own $y equals 'origin-val', so #when::y::vis::origin-val must render.
        expect(origin.chats[0].scriptstate['$whenvis']).toBe('YES')
        // Origin's own toggle_tg is truthy ('1'), so #when::toggle::tg must render.
        expect(origin.chats[0].scriptstate['$whentoggle']).toBe('YES')
        // Origin's own toggle_tv equals 'origin-val2', so #when::tv::tis::origin-val2 must render.
        expect(origin.chats[0].scriptstate['$whentis']).toBe('YES')
    })
})

describe('A trigger\'s {{user}} and {{persona}} read the origin chat\'s bound persona', () => {
    test('{{user}} and {{persona}} read the origin chat\'s bound persona, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-persona', { chats: [makeChat('chat-origin-persona', { bindedPersona: 'persona-origin' })] })
        const other = makeCharacter('char-other-persona', { chats: [makeChat('chat-other-persona', { bindedPersona: 'persona-other' })] })
        installDb([origin, other], {
            personas: [
                { id: 'persona-origin', name: 'Origin Persona', personaPrompt: 'origin-persona-prompt', icon: 'origin-icon.png' },
                { id: 'persona-other', name: 'Other Persona', personaPrompt: 'other-persona-prompt', icon: 'other-icon.png' },
            ],
        })
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'u', valueType: 'value', value: '{{user}}' }),
            v2('v2SetVar', { operator: '=', var: 'per', valueType: 'value', value: '{{persona}}' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$u']).toBe('Origin Persona')
        expect(origin.chats[0].scriptstate['$per']).toBe('origin-persona-prompt')
    })
})

describe('Message-history tags read the origin chat, across a switch', () => {
    test('{{lastmessage}} and {{previouscharchat}} read the origin chat\'s messages, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-hist', {
            chats: [makeChat('chat-origin-hist', { message: [{ role: 'user', data: 'origin-user' }, { role: 'char', data: 'origin-char' }] })],
        })
        const other = makeCharacter('char-other-hist', {
            chats: [makeChat('chat-other-hist', { message: [{ role: 'user', data: 'other-user' }, { role: 'char', data: 'other-char' }] })],
        })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'lm', valueType: 'value', value: '{{lastmessage}}' }),
            v2('v2SetVar', { operator: '=', var: 'pcc', valueType: 'value', value: '{{previouscharchat}}' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$lm']).toBe('origin-char')
        expect(origin.chats[0].scriptstate['$pcc']).toBe('origin-char')
    })
})

describe('{{getglobalvar}} inside a trigger reads the origin chat\'s per-chat override', () => {
    test('{{getglobalvar::k}} reads the origin chat\'s override, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-glvar', { chats: [makeChat('chat-origin-glvar', { GLGlobalVariables: { k: 'origin-global' } })] })
        const other = makeCharacter('char-other-glvar', { chats: [makeChat('chat-other-glvar', { GLGlobalVariables: { k: 'other-global' } })] })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'gk', valueType: 'value', value: '{{getglobalvar::k}}' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$gk']).toBe('origin-global')
    })
})

describe('calc/? and v2Calculate\'s @ token read the origin chat\'s variables', () => {
    test('{{calc}}, {{? expr}} and v2Calculate\'s @ token read the origin chat, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-calc', { chats: [makeChat('chat-origin-calc', { scriptstate: { '$x': '10' }, GLGlobalVariables: { k: '5' } })] })
        const other = makeCharacter('char-other-calc', { chats: [makeChat('chat-other-calc', { scriptstate: { '$x': '99' }, GLGlobalVariables: { k: '99' } })] })
        installDb([origin, other])
        selectedCharID.set(0)

        const { p, handle } = startManualTrigger(origin, origin.chats[0], [
            v2('v2Wait', { value: '0', valueType: 'value' }),
            v2('v2SetVar', { operator: '=', var: 'calcres', valueType: 'value', value: '{{calc::$x+1}}' }),
            v2('v2SetVar', { operator: '=', var: 'qres', valueType: 'value', value: '{{? $x+1}}' }),
            v2('v2Calculate', { expression: '@k+1', expressionType: 'value', outputVar: 'atres' }),
        ])
        selectedCharID.set(1)
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$calcres']).toBe('11')
        expect(origin.chats[0].scriptstate['$qres']).toBe('11')
        expect(origin.chats[0].scriptstate['$atres']).toBe('6')
    })
})

describe('Every corpus tag reads the origin chat, regardless of a mid-run switch (property)', () => {
    // One entry per distinct per-chat accessor in `cbs.ts`/`parser.svelte.ts`:
    // chat variables, the global-variable override, message history, the
    // author's note, the lorebook/emotion/asset lists, the bound persona and
    // module lookups. Each snippet's expected value is computed while origin
    // is still selected (before the switch), so the comparison never depends
    // on the timing of the switch itself.
    function buildCorpus(): { name: string, snippet: string }[] {
        return [
            { name: 'getvar', snippet: '{{getvar::x}}' },
            { name: 'getglobalvar', snippet: '{{getglobalvar::k}}' },
            { name: 'char', snippet: '{{char}}' },
            { name: 'user', snippet: '{{user}}' },
            { name: 'persona', snippet: '{{persona}}' },
            { name: 'lastmessage', snippet: '{{lastmessage}}' },
            { name: 'lastmessageid', snippet: '{{lastmessageid}}' },
            { name: 'previouscharchat', snippet: '{{previouscharchat}}' },
            { name: 'firstmsgindex', snippet: '{{firstmsgindex}}' },
            { name: 'userhistory', snippet: '{{userhistory}}' },
            { name: 'charhistory', snippet: '{{charhistory}}' },
            { name: 'authornote', snippet: '{{authornote}}' },
            { name: 'lorebook', snippet: '{{lorebook}}' },
            { name: 'emotionlist', snippet: '{{emotionlist}}' },
            { name: 'assetlist', snippet: '{{assetlist}}' },
            { name: 'chardisplayasset', snippet: '{{chardisplayasset}}' },
            { name: 'moduleenabled', snippet: '{{moduleenabled::ns}}' },
            { name: 'moduleassetlist', snippet: '{{moduleassetlist::ns}}' },
            { name: 'pick', snippet: '{{pick::a,b,c,d,e,f,g,h}}' },
            { name: 'rollp', snippet: '{{rollp::20}}' },
        ]
    }

    test('a run whose parses copy every corpus tag matches a same-target no-switch parse, over random field values', async () => {
        await fc.assert(fc.asyncProperty(
            fc.record({
                originX: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
                otherX: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
                originK: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
                otherK: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
                originName: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
                otherName: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s)),
            }),
            async (vals) => {
                const origin = makeCharacter('char-origin-corpus', {
                    name: vals.originName,
                    chats: [makeChat('chat-origin-corpus', {
                        scriptstate: { '$x': vals.originX },
                        GLGlobalVariables: { k: vals.originK },
                        message: [{ role: 'user', data: 'origin-user-msg' }, { role: 'char', data: 'origin-char-msg' }],
                        note: 'origin-note',
                        bindedPersona: 'persona-origin',
                        fmIndex: 0,
                        // `{{lorebook}}`'s character-lore component reads
                        // `matcherArg.chara` (always "origin" here, regardless
                        // of selection); only its chat-lore component is
                        // selection-bound, so a distinct `localLore` per chat
                        // is what exercises it.
                        localLore: [{ comment: 'origin-chat-lore', content: 'origin-chat-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
                    })],
                    globalLore: [{ comment: 'origin-lore', content: 'origin-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
                    emotionImages: [['origin-emo', 'origin-emo.png']],
                    additionalAssets: [['origin-asset', 'origin-asset.png', 'png']],
                    prebuiltAssetCommand: true,
                    modules: ['mod-origin-corpus'],
                })
                const other = makeCharacter('char-other-corpus', {
                    name: vals.otherName,
                    chats: [makeChat('chat-other-corpus', {
                        scriptstate: { '$x': vals.otherX },
                        GLGlobalVariables: { k: vals.otherK },
                        message: [{ role: 'user', data: 'other-user-msg' }, { role: 'char', data: 'other-char-msg' }, { role: 'user', data: 'other-user-msg-2' }],
                        note: 'other-note',
                        bindedPersona: 'persona-other',
                        // A different message count and `fmIndex` from
                        // origin's, so `lastmessageid`/`firstmsgindex` --
                        // count/index-only tags -- actually differentiate
                        // too, not just the content-bearing tags above.
                        fmIndex: -1,
                        localLore: [{ comment: 'other-chat-lore', content: 'other-chat-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
                    })],
                    globalLore: [{ comment: 'other-lore', content: 'other-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
                    emotionImages: [['other-emo', 'other-emo.png']],
                    additionalAssets: [['other-asset', 'other-asset.png', 'png']],
                    prebuiltAssetCommand: true,
                    modules: ['mod-other-corpus'],
                })
                installDb([origin, other], {
                    personas: [
                        { id: 'persona-origin', name: 'PersonaOrigin', personaPrompt: 'prompt-origin', icon: 'icon-origin.png' },
                        { id: 'persona-other', name: 'PersonaOther', personaPrompt: 'prompt-other', icon: 'icon-other.png' },
                    ],
                    modules: [
                        { id: 'mod-origin-corpus', namespace: 'ns', assets: [['modasset-origin', 'x', 'png']] },
                        { id: 'mod-other-corpus', namespace: 'ns-other', assets: [['modasset-other', 'y', 'png']] },
                    ],
                })
                selectedCharID.set(0) // origin selected -- matches what the origin's own run would see with no switch

                const corpus = buildCorpus()
                const expected: Record<string, string> = {}
                for (const { name, snippet } of corpus) {
                    expected[name] = risuChatParser(snippet, { chara: origin })
                }

                const effects = [
                    v2('v2Wait', { value: '0', valueType: 'value' }),
                    ...corpus.map(({ name, snippet }) => v2('v2SetVar', { operator: '=', var: name, valueType: 'value', value: snippet })),
                ]
                const { p, handle } = startManualTrigger(origin, origin.chats[0], effects)
                selectedCharID.set(1) // switch to "other", during the wait
                await p
                handle.end()

                for (const { name } of corpus) {
                    expect(origin.chats[0].scriptstate['$' + name]).toBe(expected[name])
                }
            },
        ), { numRuns: 15 })
    })
})

describe('A group\'s last-speaker lookup reads the origin chat, not the group\'s current chatPage', () => {
    test('a member\'s triggerlua calling cbs("{{char}}") reads the origin chat\'s last speaker, after a chat switch inside the group', async () => {
        const speakerInOriginChat = makeCharacter('char-speaker-origin-chat')
        const speakerInOtherChat = makeCharacter('char-speaker-other-chat')
        const member = makeCharacter('member-lastspeaker')
        const chatA = makeChat('group-chat-a', { message: [{ role: 'char', saying: 'char-speaker-origin-chat', data: 'a-said' }] })
        const chatB = makeChat('group-chat-b', { message: [{ role: 'char', saying: 'char-speaker-other-chat', data: 'b-said' }] })
        const group = makeGroup('group-lastspeaker', ['member-lastspeaker'], { chats: [chatA, chatB] })
        installDb([group, speakerInOriginChat, speakerInOtherChat, member])
        selectedCharID.set(0) // the group is selected

        member.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  local result = cbs("{{char}}")',
                '  setState(id, "lastspeaker", result)',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(group, chatA, member)!
        const p = runTrigger(member, 'output', { chat: chatA, origin: handle.origin } as never)
        await reached

        group.chatPage = 1 // switch to chat B, inside the same group, during the Lua call's own await

        releaseGate()
        await p
        handle.end()

        expect(JSON.parse(chatA.scriptstate['$__lastspeaker'] as string)).toBe('char-speaker-origin-chat')
    })
})

describe('cbs, persona, lorebook and image Lua bindings read the origin, across a switch', () => {
    test('cbs/getPersonaName/getPersonaDescription/getPersonaImageMain/getLoreBooksMain/getGlobalVar/getCharacterImageMain/getCharacterLastMessage all read the origin, after a switch during an await', async () => {
        const origin = makeCharacter('char-origin-luaread', {
            image: 'origin-image.png',
            firstMessage: 'origin-first-message',
            globalLore: [{ comment: 'origin-lore', content: 'origin-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
            chats: [makeChat('chat-origin-luaread', {
                scriptstate: { '$x': 'origin-x' },
                GLGlobalVariables: { gk: 'origin-global' },
                bindedPersona: 'persona-origin',
                message: [], // no char message, so getCharacterLastMessage falls to firstMessage
                modules: ['mod-luaread'],
            })],
        })
        const other = makeCharacter('char-other-luaread', {
            image: 'other-image.png',
            firstMessage: 'other-first-message',
            globalLore: [{ comment: 'other-lore', content: 'other-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
            chats: [makeChat('chat-other-luaread', {
                scriptstate: { '$x': 'other-x' },
                GLGlobalVariables: { gk: 'other-global' },
                bindedPersona: 'persona-other',
                message: [],
            })],
        })
        installDb([origin, other], {
            personas: [
                { id: 'persona-origin', name: 'PersonaOrigin', personaPrompt: 'prompt-origin', icon: 'icon-origin.png' },
                { id: 'persona-other', name: 'PersonaOther', personaPrompt: 'prompt-other', icon: 'icon-other.png' },
            ],
            modules: [{
                id: 'mod-luaread',
                lorebook: [{ comment: 'module-lore-luaread', content: 'module-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
            }],
        })
        selectedCharID.set(0)

        origin.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  setState(id, "cbsx", cbs("{{getvar::x}}"))',
                '  setState(id, "personaname", getPersonaName(id))',
                '  setState(id, "personadesc", getPersonaDescription(id))',
                '  getPersonaImageMain(id):await()',
                '  setState(id, "lore", getLoreBooksMain(id, "origin-lore"))',
                '  setState(id, "modlore", getLoreBooksMain(id, "module-lore-luaread"))',
                '  setState(id, "globalvar", getGlobalVar(id, "gk"))',
                '  getCharacterImageMain(id):await()',
                '  setState(id, "lastmsg", getCharacterLastMessage(id))',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(origin, origin.chats[0])!
        const p = runTrigger(origin, 'output', { chat: origin.chats[0], origin: handle.origin } as never)
        await reached

        selectedCharID.set(1) // switch to "other", during the Lua call's own await

        releaseGate()
        await p
        handle.end()

        const state = origin.chats[0].scriptstate
        expect(JSON.parse(state['$__cbsx'] as string)).toBe('origin-x')
        expect(JSON.parse(state['$__personaname'] as string)).toBe('PersonaOrigin')
        expect(JSON.parse(state['$__personadesc'] as string)).toBe('prompt-origin')
        expect(JSON.parse(state['$__lore'] as string)).toContain('origin-lore-content')
        // The module is enabled only through the origin chat's own `modules`
        // list, never through the switched-to selection's.
        expect(JSON.parse(state['$__modlore'] as string)).toContain('module-lore-content')
        expect(JSON.parse(state['$__globalvar'] as string)).toBe('origin-global')
        expect(JSON.parse(state['$__lastmsg'] as string)).toBe('origin-first-message')

        // getPersonaImageMain/getCharacterImageMain: `readImage` is called
        // with the origin's own icon/image, never the switched-to selection's.
        const readImageArgs = vi.mocked(readImage).mock.calls.map((c) => c[0])
        expect(readImageArgs).toContain('icon-origin.png')
        expect(readImageArgs).toContain('origin-image.png')
        expect(readImageArgs).not.toContain('icon-other.png')
        expect(readImageArgs).not.toContain('other-image.png')
    })
})

describe('getCharacterLastMessage/getUserLastMessage read the origin chat, across the call\'s own await', () => {
    test('getCharacterLastMessage reads a replacement of the origin chat made during the call\'s own await', async () => {
        const char = makeCharacter('char-replaced-chat', { firstMessage: 'char-first-message' })
        installDb([char])
        selectedCharID.set(0)
        const originalChat = char.chats[0]

        char.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  setState(id, "lastmsg", getCharacterLastMessage(id))',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(char, originalChat)!
        const p = runTrigger(char, 'output', { chat: originalChat, origin: handle.origin } as never)
        await reached

        // The origin chat's slot is replaced with a different chat object
        // holding the same id -- origin resolution-by-id still finds "the
        // chat", but the Lua call's own held reference does not move.
        char.chats[0] = makeChat(originalChat.id, { message: [{ role: 'char', data: 'replacement-char-message' }] })

        releaseGate()
        await p
        handle.end()

        expect(JSON.parse((char.chats[0].scriptstate['$__lastmsg'] as string) ?? (originalChat.scriptstate['$__lastmsg'] as string))).toBe('replacement-char-message')
    })

    test('a plain switch of the selection during the call\'s own await does not move where getCharacterLastMessage reads (guard)', async () => {
        const char = makeCharacter('char-plainswitch-lastmsg', { firstMessage: 'char-first-message' })
        const other = makeCharacter('char-plainswitch-other')
        installDb([char, other])
        selectedCharID.set(0)
        const chat = char.chats[0]
        chat.message = [{ role: 'char', data: 'held-char-message' }] as never

        char.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  setState(id, "lastmsg", getCharacterLastMessage(id))',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(char, chat)!
        const p = runTrigger(char, 'output', { chat, origin: handle.origin } as never)
        await reached

        selectedCharID.set(1) // a plain switch -- the chat object itself is unchanged

        releaseGate()
        await p
        handle.end()

        expect(JSON.parse(chat.scriptstate['$__lastmsg'] as string)).toBe('held-char-message')
    })
})

describe('Lua loadLoreBooksMain reads the origin\'s lorebook, across a switch', () => {
    test('loadLoreBooksMain returns the origin\'s lorebook, and a keep_activate_after_match entry marks the origin (unselected) character for save', async () => {
        const origin = makeCharacter('char-origin-loadlore', {
            lowLevelAccess: true,
            globalLore: [{
                comment: 'origin-lore-entry',
                content: '@@keep_activate_after_match\norigin-lore-body',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: true,
                key: '',
                secondkey: '',
                selective: false,
            }],
        })
        const other = makeCharacter('char-other-loadlore', {
            globalLore: [{
                comment: 'other-lore-entry',
                content: 'other-lore-body',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: true,
                key: '',
                secondkey: '',
                selective: false,
            }],
        })
        installDb([origin, other])
        selectedCharID.set(0)

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        origin.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  local books = loadLoreBooksMain(id, 100000):await()',
                '  setState(id, "books", books)',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(origin, origin.chats[0])!
        const p = runTrigger(origin, 'output', { chat: origin.chats[0], origin: handle.origin } as never)
        await reached

        selectedCharID.set(1) // switch to "other", during the Lua call's own await

        releaseGate()
        await p
        handle.end()

        const books = JSON.parse(origin.chats[0].scriptstate['$__books'] as string)
        expect(JSON.stringify(books)).toContain('origin-lore-body')
        expect(JSON.stringify(books)).not.toContain('other-lore-body')

        // `keep_activate_after_match`'s own flag write, not just the Lua
        // `setState` write already checked above, must land on the origin's
        // own chat and never on the switched-to selection's. The flag's key
        // is `id ?? hash(content)`, and this entry has no `id` field, so the
        // key is checked by its `$__internal_ka_` prefix rather than the
        // hash itself.
        const originFlagKeys = Object.keys(origin.chats[0].scriptstate ?? {}).filter((k) => k.startsWith('$__internal_ka_'))
        const otherFlagKeys = Object.keys(other.chats[0].scriptstate ?? {}).filter((k) => k.startsWith('$__internal_ka_'))
        expect(originFlagKeys.length).toBe(1)
        expect(otherFlagKeys.length).toBe(0)

        // The character marked for save is the origin (unselected)
        // character, never the selected "other" -- the Lua `setState` write
        // already marks the origin, so this alone would not tell the flag's
        // own mark apart from that write; the direct-call test below isolates it.
        expect(tracker.character).toContain('char-origin-loadlore')
        expect(tracker.character).not.toContain('char-other-loadlore')
    })

    test('a direct loadLoreBookV3Prompt(subject) marks the origin (unselected) character for save and writes its flag there, with nothing else marking', async () => {
        const origin = makeCharacter('char-origin-loadlore-direct', {
            globalLore: [{
                comment: 'origin-lore-entry-direct',
                content: '@@keep_activate_after_match\norigin-lore-body-direct',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: true,
                key: '',
                secondkey: '',
                selective: false,
            }],
        })
        const other = makeCharacter('char-other-loadlore-direct')
        installDb([other, origin])
        selectedCharID.set(0) // "other" is selected; origin is not

        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const subject = createRunSubject(originOf(origin, origin.chats[0])!)
        await loadLoreBookV3Prompt(subject)

        const originFlagKeys = Object.keys(origin.chats[0].scriptstate ?? {}).filter((k) => k.startsWith('$__internal_ka_'))
        expect(originFlagKeys.length).toBe(1)
        expect(tracker.character).toContain('char-origin-loadlore-direct')
        expect(tracker.character).not.toContain('char-other-loadlore-direct')
    })
})

describe('Module selection reads the origin chat\'s enabled modules, from before a switch', () => {
    test('a run whose origin chat enables a module the selection\'s chat does not still runs that module\'s output trigger', async () => {
        const origin = makeCharacter('char-origin-modsel', {
            chats: [makeChat('chat-origin-modsel', { modules: ['mod-origin-modsel'] })],
        })
        const other = makeCharacter('char-other-modsel', {
            chats: [makeChat('chat-other-modsel', { modules: [] })],
        })
        installDb([origin, other], {
            modules: [{
                id: 'mod-origin-modsel',
                trigger: [trig('modtrig', 'output', [v2('v2SetVar', { operator: '=', var: 'moduleran', valueType: 'value', value: '1' })])],
            }],
        })
        selectedCharID.set(0)

        // `getModuleTriggers()` is read once, synchronously, at `runTrigger`'s
        // own start -- so the switch that matters here happens before this
        // call, as it would after an earlier, unrelated await elsewhere
        // (`sendChat`'s own, for the output trigger this models), not during
        // this run's own `v2Wait`.
        selectedCharID.set(1) // switch to "other" (whose chat does not enable the module)

        const { p, handle } = startOutputTrigger(origin, origin.chats[0])
        await p
        handle.end()

        expect(origin.chats[0].scriptstate['$moduleran']).toBe('1')
    })

    function startOutputTrigger(char: character, chat: Chat) {
        const handle = beginWork(char, chat)!
        const p = runTrigger(char, 'output', { chat, origin: handle.origin } as never)
        return { p, handle }
    }
})

describe('A gone origin\'s Lua read never falls back to the selection', () => {
    test('the origin chat is deleted during an await, then cbs("{{getvar::x}}") returns the default chain, not the selection\'s value', async () => {
        const origin = makeCharacter('char-gone-origin-cbs')
        const selectedThroughout = makeCharacter('char-stays-selected-cbs', {
            chats: [makeChat('chat-stays-selected-cbs', { scriptstate: { '$x': 'selected-value' } })],
        })
        installDb([selectedThroughout, origin], { templateDefaultVariables: 'x=template-default' })
        selectedCharID.set(0) // "selectedThroughout" is selected and stays selected throughout

        const originChat = origin.chats[0]
        // `setState`/`setChatVar` silently drops a write once the origin is
        // gone, which makes it unusable to observe this read's result once
        // the chat is deleted, so the result is reported through
        // `alertNormal` instead, a binding gated only by the call's access
        // key, never by the origin.
        vi.mocked(alertNormal).mockClear()
        origin.triggerscript.push(trig('m', 'output', [{
            type: 'triggerlua',
            code: [
                'onOutput = async(function(id)',
                '  alertInput(id, "wait"):await()',
                '  alertNormal(id, cbs("{{getvar::x}}"))',
                'end)',
            ].join('\n'),
        }]))

        const { reached, releaseGate } = makeAlertGate()
        const handle = beginWork(origin, originChat)!
        const p = runTrigger(origin, 'output', { chat: originChat, origin: handle.origin } as never)
        await reached

        origin.chats.splice(0, 1) // the origin chat is gone, during the Lua call's own await

        releaseGate()
        await p
        handle.end()

        expect(vi.mocked(alertNormal).mock.calls[0]?.[0]).toBe('template-default')
    })
})

describe('Resolution counts (specification)', () => {
    // `refreshSubject()` resolves once per trigger match, independent of
    // anything this test measures -- so the effects below are
    // `v2ShowAlert` (parses its value, then calls `alertNormal`; writes
    // nothing) rather than `v2SetVar`, whose own write would resolve
    // through the run's `setVar` regardless of whether any read ever
    // consults the subject, masking the count this test is actually about.
    // This checks that many reads in the same synchronous stretch cost
    // only the one resolution the run already pays for `refreshSubject()`
    // -- not one more per read.
    test('a trigger run\'s reads in one stretch share one resolution', async () => {
        const char = makeCharacter('char-rescount-reads')
        installDb([char])
        selectedCharID.set(0)
        const chat = char.chats[0]
        chat.scriptstate = { '$x': 'val' }

        resetResolutionCountForTests()
        const manyReads = Array.from({ length: 10 }, () => v2('v2ShowAlert', { value: '{{getvar::x}}', valueType: 'value' }))
        const { p, handle } = startManualTrigger(char, chat, manyReads, 'manyreads')
        await p
        handle.end()
        const manyReadsCount = resolutionCountForTests()
        console.log('resolution count -- ten corpus reads in one stretch:', manyReadsCount)

        expect(manyReadsCount).toBe(1)
    })

    test('a loadLoreBookV3Prompt call resolves once, independent of its number of active entries', async () => {
        const char = makeCharacter('char-rescount-lorebook', {
            // Each entry's own content reads per-chat data (`{{getvar}}`,
            // `{{lastmessage}}`) and carries `keep_activate_after_match`, so
            // a per-entry re-resolution (rather than one shared snapshot)
            // would actually show up in the count below, not just in a scan
            // that never touches the target at all.
            globalLore: Array.from({ length: 5 }, (_, i) => ({
                comment: `lore-${i}`,
                content: `@@keep_activate_after_match\nlore-body-${i} {{getvar::x}} {{lastmessage}}`,
                mode: 'normal',
                insertorder: 100,
                alwaysActive: true,
                key: '',
                secondkey: '',
                selective: false,
            })),
        })
        installDb([char])
        selectedCharID.set(0)
        const chat = char.chats[0]
        chat.scriptstate = { '$x': 'v' }
        chat.message = [{ role: 'user', data: 'hi' }] as never

        resetResolutionCountForTests()
        const subject = createRunSubject(originOf(char, chat)!)
        const result = await loadLoreBookV3Prompt(subject) as { actives: unknown[] }
        const lorebookCallCount = resolutionCountForTests()
        console.log('resolution count -- one loadLoreBookV3Prompt call over 5 active entries:', lorebookCallCount, 'actives:', result?.actives?.length)

        // All 5 entries must actually have been scanned (each its own
        // `tokenize` await) for the resolution count below to mean anything
        // -- a scan that skipped them all would trivially show few
        // resolutions without ever exercising the per-call bound.
        expect(result.actives.length).toBe(5)
        expect(lorebookCallCount).toBe(1)
    })

    // `loadLoreBooksMain` (Lua) is called directly through `runScripted`,
    // with its own `origin` argument, rather than through `runTrigger` --
    // `runTrigger`'s own `refreshSubject()` would resolve once regardless
    // of anything this test measures, the same reason the "many reads"
    // test above avoids `v2SetVar`. `runScripted` itself still resolves
    // once on every call, win or lose, for its own trailing
    // `currentChatFor(ScriptingEngineState)` -- so this compares three
    // runs from a reset count (no call, one book, five books) rather than
    // asserting a single call's count in isolation, which would also count
    // that unrelated resolution as if it belonged to the lorebook scan.
    test('a Lua loadLoreBooksMain call adds at most one resolution, however many books it returns (specification)', async () => {
        const charNoCall = makeCharacter('char-rescount-lua-lorebook-none', { lowLevelAccess: true })
        const char1Book = makeCharacter('char-rescount-lua-lorebook-1', {
            lowLevelAccess: true,
            // Per-chat content, the same reason as the direct-call test
            // above: a per-book re-resolution would show up here too.
            globalLore: [{ comment: 'lore-0', content: 'lore-body-0 {{getvar::x}} {{lastmessage}}', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
        })
        const char5Books = makeCharacter('char-rescount-lua-lorebook-5', {
            lowLevelAccess: true,
            globalLore: Array.from({ length: 5 }, (_, i) => ({
                comment: `lore-${i}`,
                content: `lore-body-${i} {{getvar::x}} {{lastmessage}}`,
                mode: 'normal',
                insertorder: 100,
                alwaysActive: true,
                key: '',
                secondkey: '',
                selective: false,
            })),
        })
        const characters = [charNoCall, char1Book, char5Books]
        installDb(characters)

        // Each run also selects its own character, keeping the fixture's
        // selection and origin in step, so `books.length` gives a real,
        // meaningful sanity check regardless of which one the scan itself
        // actually reads through.
        async function runLua(char: character, code: string, mode: string) {
            const chat = char.chats[0]
            selectedCharID.set(characters.indexOf(char))
            resetResolutionCountForTests()
            const handle = beginWork(char, chat)!
            const runResult = await runScripted(code, {
                char,
                chat,
                mode,
                lowLevelAccess: true,
                origin: handle.origin,
            } as never)
            handle.end()
            return { count: resolutionCountForTests(), res: (runResult as { res: string }).res }
        }

        const noCallCode = 'noop = async(function(id) return "[]" end)'
        const withCallCode = [
            'loadbooks = async(function(id)',
            '  local books = loadLoreBooksMain(id, 100000):await()',
            '  return books',
            'end)',
        ].join('\n')

        const a = await runLua(charNoCall, noCallCode, 'noop')
        const b = await runLua(char1Book, withCallCode, 'loadbooks')
        const c = await runLua(char5Books, withCallCode, 'loadbooks')

        const booksB = JSON.parse(b.res)
        const booksC = JSON.parse(c.res)
        console.log('resolution count -- no loadLoreBooksMain call:', a.count)
        console.log('resolution count -- one loadLoreBooksMain call over 1 active book:', b.count)
        console.log('resolution count -- one loadLoreBooksMain call over 5 active books:', c.count)

        expect(booksB.length).toBe(1)
        expect(booksC.length).toBe(5)
        // The count added by the call itself, isolated from `runScripted`'s
        // own unconditional resolution, must not grow with the book count,
        // and must add no more than one resolution regardless -- this can
        // already hold with the call adding none at all.
        expect(c.count).toBe(b.count)
        expect(b.count - a.count).toBeLessThanOrEqual(1)
    })
})

describe('A group run\'s {{getvar}} default comes from the group (guard)', () => {
    test('with no switch, {{getvar}} for an unset variable in a group member\'s trigger returns the group\'s own default, not the member\'s', () => {
        const member = makeCharacter('member-r8default', { defaultVariables: 'x=member-default' })
        const group = makeGroup('group-r8default', ['member-r8default'], { defaultVariables: 'x=group-default' } as never)
        installDb([group, member])
        selectedCharID.set(0) // the group is selected -- matches the origin owner, so there is no switch

        // A real origin, the same as a group run's own subject -- `{{getvar}}`
        // reads the target's owner (the group) for its defaults, never the
        // runner passed as `chara` (the member), so this must return the
        // group's own default even though `chara` names the member.
        const handle = beginWork(group, group.chats[0], member)!
        const subject = createRunSubject(handle.origin)
        const result = risuChatParser('{{getvar::x}}', { chara: member, subject } as never)
        handle.end()

        expect(result).toBe('group-default')
    })
})
