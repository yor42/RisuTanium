/**
 * Direct `risuChatParser` calls with a `subject` argument: the resolved
 * origin owner and chat a call reads/writes when one is given, instead of
 * whichever chat is selected on screen. Drives the real
 * `risuChatParser`/`cbs.ts` (via `../parser.svelte`), the real
 * `chatVar.svelte.ts`/`infunctions.ts`, the real persona helpers from
 * `../../util` (`checkPersonaBinded`, `getUserName`, `getPersonaPrompt`,
 * `getUserIcon` -- taken from the actual module through `vi.importActual`,
 * never re-implemented), and the real `../../process/modules` (`getModules`
 * and its lookups), the same real-module set
 * `tests/modulesTriggerStamping.svelte.test.ts` loads against the same kind
 * of stand-ins. This file needs neither Lua nor `runTrigger`, so it runs
 * under the project's default (happy-dom) environment with real DOMPurify,
 * matching `parser/tests/trimMarkdownStyle.test.ts` and
 * `parser/tests/cbs/conditionals.test.ts`, which already prove real
 * `../parser.svelte` loads and runs there; `DBState.db` below is a plain
 * object (not a rune), matching those same two files.
 *
 * `../../process/scripts` is mocked (only `ParseMarkdown`, exercised by the
 * display guard, reaches it) with a stand-in whose own `processScriptFull`
 * still calls the real `risuChatParser` for its CBS step, with no `chara`
 * and no target -- the display guard never gives `ParseMarkdown` a target
 * to pass down, so this stand-in omits the `subject` field the real call
 * also carries. Real `../../process/scripts` would pull in
 * `../../plugins/plugins.svelte` and, through `../../process/scriptings`,
 * wasmoon, neither of which any test in this file needs.
 */
import fc from 'fast-check'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database } from '../../storage/database.svelte'

//#region module mocks

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as any }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        ReloadGUIPointer: writable(0),
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
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

// Pulled in only because `../../util`'s real module (loaded below through
// `vi.importActual`) imports them at its own top level.
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
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
// `getUserIcon` are the actual `../../util` implementations (through
// `vi.importActual`); everything else is a light stand-in -- the real
// module also pulls in Tauri dialogs and `PopupList.svelte`, matching
// `process/tests/triggerOriginReads.svelte.test.ts`'s own mock.
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

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({
        id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
        internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0,
    })),
}) as unknown as typeof import('../../model/modellist'))

// Real-shaped re-implementation of database.svelte.ts's own selection
// accessors, matching `process/tests/triggerOriginReads.svelte.test.ts`'s
// own stand-in, reading/writing through the same mocked `DBState`/
// `selectedCharID` above.
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

// `../../process/modules.ts`'s own extra dependencies -- not reached by
// `getModules()` and its lookups, the only entry points this suite
// exercises through the CBS tag corpus.
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

vi.mock(import('../../process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn((v: unknown) => v),
}) as unknown as typeof import('../../process/lorebook.svelte'))

// `ParseMarkdown`'s own `processScriptFull` call, for the display guard
// alone -- real-shaped for the one call the guard actually exercises (its
// CBS step), never a target: the display guard never gives `ParseMarkdown`
// a target to forward, so this omits the `subject` field production's own
// call carries alongside `chatID`/`cbsConditions`, along with `chara`.
// `../parser.svelte` is imported lazily, inside each mocked function body,
// never at this factory's own top level -- `../parser.svelte` itself
// statically imports `../../process/scripts`, so an eager `await import(...)`
// here would deadlock the circular pair at module-load time.
vi.mock(import('../../process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, data: string, _mode: string, cbsConditions: unknown = {}) => {
        const parserSvelte = await import('../parser.svelte')
        return parserSvelte.risuChatParser(data, { cbsConditions } as never)
    }),
    processScriptFull: vi.fn(async (_char: unknown, data: string, _mode: string, chatID = -1, cbsConditions: unknown = {}) => {
        const parserSvelte = await import('../parser.svelte')
        return {
            data: parserSvelte.risuChatParser(data, { chatID, cbsConditions } as never),
            emoChanged: false,
        }
    }),
    resetScriptCache: vi.fn(),
}) as unknown as typeof import('../../process/scripts'))

// `../parser.svelte` (risuChatParser, cbs.ts, ParseMarkdown), `../chatVar.svelte`,
// `../../process/infunctions` and `../../process/modules` are not mocked --
// they are real.

//#endregion

let risuChatParser: typeof import('../parser.svelte').risuChatParser
let ParseMarkdown: typeof import('../parser.svelte').ParseMarkdown
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let createRunSubject: typeof import('../../process/chatOrigin').createRunSubject
let originOf: typeof import('../../process/chatOrigin').originOf
let resolutionCountForTests: typeof import('../../process/chatOrigin').resolutionCountForTests
let resetResolutionCountForTests: typeof import('../../process/chatOrigin').resetResolutionCountForTests

beforeAll(async () => {
    const parser = await import('../parser.svelte')
    risuChatParser = parser.risuChatParser
    ParseMarkdown = parser.ParseMarkdown
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('../../process/chatOrigin')
    createRunSubject = origin.createRunSubject
    originOf = origin.originOf
    resolutionCountForTests = origin.resolutionCountForTests
    resetResolutionCountForTests = origin.resetResolutionCountForTests
})

//#region fixtures

function makeChat(id: string, overrides: Record<string, unknown> = {}): Chat {
    return {
        id,
        message: [] as unknown[],
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        fmIndex: -1,
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
        firstMessage: `${chaId}-first-message`,
        alternateGreetings: [] as string[],
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
        globalLore: [] as unknown[],
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
        globalChatVariables: {} as Record<string, string>,
        ...extra,
    } as unknown as Database
    ;(globalThis as unknown as { __risuTestDb: Database }).__risuTestDb = DBState.db
    selectedCharID.set(0)
}

/**
 * One entry per distinct per-chat accessor in `cbs.ts`/`parser.svelte.ts`:
 * chat variables, the global-variable override, message history (including the
 * `chatID`-gated tags a trigger's own parses never reach, since a trigger
 * parse's `chatID` is always -1), the author's note, the lorebook/emotion/
 * asset lists, the bound persona and module lookups. `chatID` is fixed so
 * `previoususerchat`/`messagetime`/`messagedate`/`messageidleduration`/
 * `role`'s message branch resolve against a real message index.
 */
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
        { name: 'previoususerchat', snippet: '{{previoususerchat}}' },
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
        { name: 'messagetime', snippet: '{{messagetime}}' },
        { name: 'messagedate', snippet: '{{messagedate}}' },
        { name: 'messageidleduration', snippet: '{{messageidleduration}}' },
        { name: 'role', snippet: '{{role}}' },
    ]
}

interface CorpusPairValues {
    originX: string
    otherX: string
    originK: string
    otherK: string
    originUserMsg: string
    otherUserMsg: string
}

const defaultCorpusPairValues: CorpusPairValues = {
    originX: 'origin-x', otherX: 'other-x',
    originK: 'origin-global', otherK: 'other-global',
    originUserMsg: 'origin-user-msg', otherUserMsg: 'other-user-msg',
}

function installCorpusPair(vals: CorpusPairValues = defaultCorpusPairValues) {
    const now = Date.now()
    const origin = makeCharacter('char-origin-corpus', {
        chats: [makeChat('chat-origin-corpus', {
            scriptstate: { '$x': vals.originX },
            GLGlobalVariables: { k: vals.originK },
            // Message index 1 (the fixed `chatID` every corpus call below
            // passes) has role "char" here and role "char" in "other" too
            // would leave `{{role}}` unable to differentiate -- see "other"
            // below, where it is "char" instead, and this one is "user".
            message: [
                { role: 'char', data: 'origin-char-msg', time: now - 9000 },
                // Two days back, so `{{messagedate}}` (day granularity, not
                // just `{{messagetime}}`) also differs from "other"'s.
                { role: 'user', data: vals.originUserMsg, time: now - 172800000 },
            ],
            note: 'origin-note',
            bindedPersona: 'persona-origin',
            fmIndex: 0,
            alternateGreetings: ['origin-alt-greeting'],
            // `{{lorebook}}`'s character-lore component already reads
            // `matcherArg.chara` (fixed to "origin" here); only its
            // chat-lore component is selection-bound, so a distinct
            // `localLore` per chat is what exercises it.
            localLore: [{ comment: 'origin-chat-lore', content: 'origin-chat-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
        })],
        globalLore: [{ comment: 'origin-lore', content: 'origin-lore-content', mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }],
        emotionImages: [['origin-emo', 'origin-emo.png']],
        additionalAssets: [['origin-asset', 'origin-asset.png', 'png']],
        prebuiltAssetCommand: true,
        modules: ['mod-origin-corpus'],
    })
    const other = makeCharacter('char-other-corpus', {
        chats: [makeChat('chat-other-corpus', {
            scriptstate: { '$x': vals.otherX },
            GLGlobalVariables: { k: vals.otherK },
            message: [
                { role: 'user', data: vals.otherUserMsg, time: now - 3000 },
                { role: 'char', data: 'other-char-msg', time: now - 2000 },
                { role: 'user', data: 'other-user-msg-2', time: now - 1000 },
            ],
            note: 'other-note',
            bindedPersona: 'persona-other',
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
    return { origin, other }
}

beforeEach(() => {
    resetResolutionCountForTests()
})

//#endregion

describe('Switched-selection differential over the CBS tag corpus, direct parse (specification)', () => {
    const safeString = fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !/[:{}\n]/.test(s))

    test('a direct parse with a target matches a same-target no-switch parse, while the selection differs', () => {
        fc.assert(fc.property(
            fc.record({
                originX: safeString, otherX: safeString,
                originK: safeString, otherK: safeString,
                originUserMsg: safeString, otherUserMsg: safeString,
            }),
            (vals) => {
                const { origin } = installCorpusPair(vals)
                selectedCharID.set(0) // origin selected -- matches what a no-switch parse at origin would see

                const corpus = buildCorpus()
                const expected: Record<string, string> = {}
                for (const { name, snippet } of corpus) {
                    expected[name] = risuChatParser(snippet, { chara: origin, chatID: 1 })
                }

                selectedCharID.set(1) // switch to "other"
                const subject = createRunSubject(originOf(origin, origin.chats[0])!)

                for (const { name, snippet } of corpus) {
                    const actual = risuChatParser(snippet, { chara: origin, chatID: 1, subject } as never)
                    expect(actual).toBe(expected[name])
                }
            },
        ), { numRuns: 15 })
    })
})

describe('A direct parse with a gone or ambiguous target (specification)', () => {
    // A rich, distinctively-named selection: every corpus tag's output is
    // checked against these markers afterward, so a read that wrongly fell
    // back to the selection (rather than the empty chat an unresolvable
    // target requires) shows up as one of them leaking into the result, not
    // just as a thrown error.
    function makeRichSelected(chaId: string, moduleId: string, personaId: string) {
        return makeCharacter(chaId, {
            name: 'SELNAME',
            modules: [moduleId],
            chats: [makeChat(`${chaId}-chat`, {
                scriptstate: { '$x': 'selected-value' },
                bindedPersona: personaId,
                message: [{ role: 'char', data: 'SELMSG' }],
                note: 'SELNOTE',
            })],
        })
    }

    test('a gone target reads no selection data and does not throw, including the group last-speaker lookup', () => {
        const goneChar = makeCharacter('char-gone-direct')
        const selected = makeRichSelected('char-selected-direct', 'gone-direct-mod', 'gone-direct-persona')
        const goneChat = goneChar.chats[0]
        goneChar.chats = [] // the chat is already gone
        installDb([selected, goneChar], {
            templateDefaultVariables: 'x=template-default',
            personas: [{ id: 'gone-direct-persona', name: 'SELPERSONA', personaPrompt: 'SELPROMPT', icon: 'x' }],
            modules: [{ id: 'gone-direct-mod', namespace: 'ns' }],
        })
        selectedCharID.set(0)

        const subject = createRunSubject(originOf({ ...goneChar, chats: [goneChat] } as never, goneChat)!)

        const outputs: Record<string, string> = {}
        for (const { name, snippet } of buildCorpus()) {
            expect(() => { outputs[name] = risuChatParser(snippet, { chara: goneChar, subject } as never) }).not.toThrow()
        }
        // No selection-only marker (name, message, note or bound persona)
        // may appear in any output.
        expect(Object.values(outputs).join('|')).not.toMatch(/SELNAME|SELMSG|SELNOTE|SELPERSONA/)
        // The module is enabled only through the selected character, never
        // through the gone target's own (nonexistent) owner.
        expect(outputs['moduleenabled']).toBe('0')

        // A group whose last-speaker lookup is asked for a gone target's
        // owner never falls back to the selection, and never throws --
        // this sits outside `matcher()`'s own `try`.
        const group = makeGroup('group-gone-direct', [], {
            chats: [makeChat('group-gone-direct-chat', { message: [{ role: 'char', saying: 'char-selected-direct', data: 'x' }] })],
        })
        let groupResult = ''
        expect(() => { groupResult = risuChatParser('{{char}}', { chara: group, subject } as never) }).not.toThrow()
        expect(groupResult).not.toBe('SELNAME')
    })

    test('an ambiguous target reads no selection data and does not throw', () => {
        const dupA = makeCharacter('char-dup-direct')
        const dupB = makeCharacter('char-dup-direct') // same chaId -- ambiguous
        const selected = makeRichSelected('char-selected-ambig', 'ambig-direct-mod', 'ambig-direct-persona')
        installDb([selected, dupA, dupB], {
            templateDefaultVariables: 'x=template-default',
            personas: [{ id: 'ambig-direct-persona', name: 'SELPERSONA', personaPrompt: 'SELPROMPT', icon: 'x' }],
            modules: [{ id: 'ambig-direct-mod', namespace: 'ns' }],
        })
        selectedCharID.set(0)

        const subject = createRunSubject(originOf(dupA, dupA.chats[0])!)

        const outputs: Record<string, string> = {}
        for (const { name, snippet } of buildCorpus()) {
            expect(() => { outputs[name] = risuChatParser(snippet, { chara: dupA, subject } as never) }).not.toThrow()
        }
        expect(Object.values(outputs).join('|')).not.toMatch(/SELNAME|SELMSG|SELNOTE|SELPERSONA/)
        expect(outputs['moduleenabled']).toBe('0')

        const group = makeGroup('group-ambig-direct', [], {
            chats: [makeChat('group-ambig-direct-chat', { message: [{ role: 'char', saying: 'char-selected-ambig', data: 'x' }] })],
        })
        let groupResult = ''
        expect(() => { groupResult = risuChatParser('{{char}}', { chara: group, subject } as never) }).not.toThrow()
        expect(groupResult).not.toBe('SELNAME')
    })
})

describe('Nested reads keep the outer parse\'s target (specification)', () => {
    test('a #when body, a function-call body and authornote\'s recursive parse all read the target, not the selection', () => {
        const origin = makeCharacter('char-origin-nested', {
            chats: [makeChat('chat-origin-nested', {
                scriptstate: { '$x': '1' },
                note: '{{getvar::notevar}}',
            })],
        })
        origin.chats[0].scriptstate['$notevar'] = 'origin-note-value'
        const other = makeCharacter('char-other-nested', {
            chats: [makeChat('chat-other-nested', { scriptstate: { '$x': '0', '$notevar': 'other-note-value' } })],
        })
        installDb([origin, other])
        selectedCharID.set(1) // "other" is selected; origin is the target

        const subject = createRunSubject(originOf(origin, origin.chats[0])!)

        // The #when condition here is unconditionally true (`#when true`,
        // never a variable), so the block always renders regardless of
        // selection -- isolating this check to the body's own nested tag,
        // not the condition's own target compliance (checked elsewhere).
        const whenResult = risuChatParser('{{#when true}}{{getvar::notevar}}{{/when}}', { chara: origin, subject } as never)
        expect(whenResult).toBe('origin-note-value')

        // A `#func`/`{{call::name}}` body's nested tag keeps the outer target.
        const funcResult = risuChatParser('{{#func f}}{{getvar::notevar}}{{/func}}{{call::f}}', { chara: origin, subject } as never)
        expect(funcResult).toBe('origin-note-value')

        // `{{authornote}}`'s own recursive parse of the note text keeps the
        // target that reached it.
        const noteResult = risuChatParser('{{authornote}}', { chara: origin, subject } as never)
        expect(noteResult).toBe('origin-note-value')
    })
})

describe('A direct parse resolves at most once (specification)', () => {
    test('a parse with a target and no per-chat tag resolves nothing; one with several resolves once', () => {
        const origin = makeCharacter('char-origin-r7direct', { chats: [makeChat('chat-origin-r7direct', { scriptstate: { '$x': 'v' } })] })
        installDb([origin])
        selectedCharID.set(0)
        const subject = createRunSubject(originOf(origin, origin.chats[0])!)

        resetResolutionCountForTests()
        risuChatParser('no CBS tag in this literal text', { chara: origin, subject } as never)
        expect(resolutionCountForTests()).toBe(0)

        resetResolutionCountForTests()
        risuChatParser('{{getvar::x}} {{getvar::x}} {{char}} {{lastmessage}}', { chara: origin, subject } as never)
        expect(resolutionCountForTests()).toBe(1)
    })
})

describe('A parse with no target reads the selection (guard)', () => {
    test('with no subject argument, every corpus tag follows the selection across a switch', () => {
        const { origin } = installCorpusPair()
        selectedCharID.set(0)

        const corpus = buildCorpus()
        const beforeValues = corpus.map(({ snippet }) => risuChatParser(snippet, { chara: origin, chatID: 1 }))

        selectedCharID.set(1) // switch -- a no-target parse must follow it
        const afterValues = corpus.map(({ snippet }) => risuChatParser(snippet, { chara: origin, chatID: 1 }))

        expect(afterValues).not.toEqual(beforeValues)
    })
})

describe('A target equal to the selection gives the same output as no target (guard)', () => {
    test('over the corpus, a target at the selection matches a parse with no target, for a character and for a group', () => {
        const { origin } = installCorpusPair()
        selectedCharID.set(0) // origin selected; the target below is also origin -- no switch

        const subject = createRunSubject(originOf(origin, origin.chats[0])!)
        for (const { name, snippet } of buildCorpus()) {
            const withTarget = risuChatParser(snippet, { chara: origin, chatID: 1, subject } as never)
            const withNoTarget = risuChatParser(snippet, { chara: origin, chatID: 1 })
            expect(withTarget).toBe(withNoTarget)
        }

        const member = makeCharacter('member-r4group')
        const group = makeGroup('group-r4', ['member-r4group'], {
            chats: [makeChat('group-r4-chat', { message: [{ role: 'char', saying: 'member-r4group', data: 'said' }] })],
        })
        installDb([group, member])
        selectedCharID.set(0)
        const groupSubject = createRunSubject(originOf(group, group.chats[0])!)
        const groupWithTarget = risuChatParser('{{char}}', { chara: group, subject: groupSubject } as never)
        const groupWithNoTarget = risuChatParser('{{char}}', { chara: group })
        expect(groupWithTarget).toBe(groupWithNoTarget)
        expect(groupWithTarget).toBe('member-r4group')
    })
})

describe('Display: ParseMarkdown reads the selected chat, never a target (guard)', () => {
    test('ParseMarkdown of a message with {{getvar}} reads the selected chat\'s variable', async () => {
        const charA = makeCharacter('char-display-a', { chats: [makeChat('chat-display-a', { scriptstate: { '$x': 'a-value' } })] })
        const charB = makeCharacter('char-display-b', { chats: [makeChat('chat-display-b', { scriptstate: { '$x': 'b-value' } })] })
        installDb([charA, charB])

        selectedCharID.set(0)
        const resultA = await ParseMarkdown('{{getvar::x}}', charA)
        expect(resultA).toContain('a-value')

        selectedCharID.set(1)
        const resultB = await ParseMarkdown('{{getvar::x}}', charB)
        expect(resultB).toContain('b-value')
    })
})
