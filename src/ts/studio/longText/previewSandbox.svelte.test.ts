// @vitest-environment jsdom
/**
 * The preview sandbox against the real parser, `cbs.ts`, `chatVar.svelte.ts`, persona helpers and module lookups; only
 * storage, stores and platform edges are stand-ins (the harness of `parser/tests/parserTarget.svelte.test.ts`).
 * `DBState.db` is a plain object here, so a snapshot is a `structuredClone`.
 */
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database, character } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    processScriptFull: vi.fn((): never => { throw new Error('processScriptFull must not run in a preview') }),
    mark: vi.fn(),
}))

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: 0 },
    ReloadGUIPointer: writable(0),
    HideIconStore: writable(false),
    moduleBackgroundEmbedding: writable(''),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))

// The persona helpers are the real implementations; the rest of `util` is a light stand-in.
vi.mock(import('src/ts/util'), async () => {
    const real = await vi.importActual<typeof import('src/ts/util')>('src/ts/util')
    return {
        checkPersonaBinded: real.checkPersonaBinded,
        getUserName: real.getUserName,
        getPersonaPrompt: real.getPersonaPrompt,
        getUserIcon: real.getUserIcon,
        livePersona: real.livePersona,
        parseToggleSyntax: real.parseToggleSyntax,
        pickHashRand: real.pickHashRand,
        replaceAsync: real.replaceAsync,
        findCharacterbyId: () => ({ name: 'Unknown Character' }),
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
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder', internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0 })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const { get } = await import('svelte/store')
    const state = stores.DBState as unknown as { db: { characters?: { chats: unknown[]; chatPage: number }[] } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    return {
        appVer: '1234.5.67',
        defaultSdDataFunc: () => [],
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(() => {
            const char = getCurrentCharacter()
            return char?.chats?.[char.chatPage]
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/media'), () => ({ compressImage: vi.fn(async (v: unknown) => v) }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()), encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

// A run that reaches the script pipeline throws; `calls` stays 0 for every preview.
vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: h.processScriptFull,
    processScriptFull: h.processScriptFull,
    resetScriptCache: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/storage/characterSaveMarks'), async (importOriginal) => ({
    ...(await importOriginal()),
    markCharacterForSave: h.mark,
}))

//#endregion

import { get } from 'svelte/store'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { getGlobalChatVar } from 'src/ts/parser/chatVar.svelte'
import { createRunSubject } from 'src/ts/process/chatOrigin'
import { createBlankChar } from 'src/ts/characters'
import {
    copiedChatValues, runPreview, sandboxKeysOf, sandboxSourceOf, sandboxUserName, variesIn, VARIES_NAMES,
    type SandboxSource, type SandboxValues,
} from './previewSandbox'
import { previewHtml } from './previewSanitize'
import { collectMacroEntries } from './macroRegistry'
import { createMacroIndex } from './macroIndex'

//#region fixtures

type TestDb = { db: Database }
const state = (DBState as unknown as TestDb)

function installDb(characters: character[] = [], extra: Record<string, unknown> = {}): void {
    state.db = {
        characters,
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        enabledModules: [] as string[],
        moduleIntergration: '',
        globalChatVariables: {} as Record<string, string>,
        username: 'Uma',
        hideAllImages: false,
        ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

const snapshot = (): unknown => structuredClone(state.db)

/** The live character as the app builds one: a blank character with its own chat. */
function liveCharacter(overrides: Partial<character> = {}): character {
    const live = createBlankChar()
    live.name = 'Live'
    live.desc = 'S'
    Object.assign(live, overrides)
    return live
}

function values(overrides: Partial<SandboxValues> = {}): SandboxValues {
    return { char: 'Alice', chat: {}, toggles: {}, ...overrides }
}

function sourceOf(live: character = liveCharacter(), chat: Chat | null = null): SandboxSource {
    return sandboxSourceOf(live, chat)
}

function textOf(fieldText: string, kind: 'desc' | 'greeting' | 'note', source: SandboxSource, v: SandboxValues): string {
    const run = runPreview(fieldText, kind, source, v)
    if (!run.ok) throw new Error('the run failed')
    return run.text
}

beforeEach(() => {
    h.processScriptFull.mockClear()
    h.mark.mockClear()
    installDb([liveCharacter()])
})

//#endregion

describe('E2-U1 sandboxKeysOf lists static names only', () => {
    test('chat keys from the four variable macros and #when; toggles from getglobalvar, #when and tis; in order, once', () => {
        const text = '{{getvar::a}}{{setvar::b::1}}{{addvar::c::1}}{{setdefaultvar::d::1}}{{#when::var::e}}x{{/when}}'
            + '{{#when::f::vis::v}}y{{/when}}{{#when::f::visnot::v}}{{/when}}'
            + '{{getglobalvar::toggle_a}}{{#when::toggle::b}}z{{/when}}{{#when::c::tis::1}}w{{/when}}{{#when::c::tisnot::1}}{{/when}}'
            + '{{getglobalvar::g}}{{getvar::{{x}}}}{{getvar::a}}'
        expect(sandboxKeysOf(text)).toEqual({ chat: ['a', 'b', 'c', 'd', 'e', 'f'], toggles: ['toggle_a', 'toggle_b', 'toggle_c'] })
    })

    test('a name that holds another macro, or is never closed, is not listed', () => {
        expect(sandboxKeysOf('{{getvar::a{{x}}}}{{getvar::open')).toEqual({ chat: [], toggles: [] })
    })

    test('non-toggle globals are never listed', () => {
        expect(sandboxKeysOf('{{getglobalvar::g}}{{getglobalvar::toggle_}}')).toEqual({ chat: [], toggles: [] })
    })
})

describe('E2-U2 runPreview resolves macros offline', () => {
    test('{{char}} is the sample name and variables come from the values, then the source defaults', () => {
        const source = sourceOf(liveCharacter({ defaultVariables: 'hp=7' }))
        expect(textOf('{{char}}', 'desc', source, values())).toBe('Alice')
        expect(textOf('{{getvar::hp}}', 'desc', source, values({ chat: { hp: '3' } }))).toBe('3')
        expect(textOf('{{getvar::hp}}', 'desc', source, values())).toBe('7')
    })

    test('unknown and asset macros stay as written', () => {
        expect(textOf('{{nosuch}} {{img::x}}', 'greeting', sourceOf(), values())).toBe('{{nosuch}} {{img::x}}')
    })

    test('a greeting run reads the source description; a desc run reads its own text, not the source description', () => {
        const source = sourceOf(liveCharacter({ desc: 'S' }))
        expect(textOf('{{description}}', 'greeting', source, values())).toBe('S')
        const desc = textOf('F{{description}}', 'desc', source, values())
        expect(desc.startsWith('FF')).toBe(true)
        expect(desc).not.toContain('S')
    })

    test('the two sample messages exist, so {{lastmessage}} never reads an empty list', () => {
        const run = runPreview('{{lastmessage}}', 'greeting', sourceOf(), values({ samples: { user: 'U-sample', char: 'C-sample' } }))
        expect(run).toMatchObject({ ok: true })
        expect(['U-sample', 'C-sample']).toContain(run.ok ? run.text : '')
    })

    test('the source holds only strings and one string array', () => {
        const source = sourceOf(liveCharacter({ alternateGreetings: ['g1'], modules: ['m'] }))
        const walk = (value: unknown): void => {
            if (Array.isArray(value)) return value.forEach((v) => expect(typeof v).toBe('string'))
            if (value !== null && typeof value === 'object') return Object.values(value).forEach(walk)
            expect(['string']).toContain(typeof value)
        }
        walk({ ...source, bindedPersona: source.bindedPersona ?? '' })
    })
})

describe('E2-U3 a preview writes nothing outside its scratch chat (isolation)', () => {
    const TEXT = '{{setvar::hp::5}}{{getvar::hp}}{{addvar::n::2}}{{setdefaultvar::d::x}}'

    function liveWorld(): { live: character; before: unknown } {
        const live = liveCharacter()
        delete live.chats[0].scriptstate
        installDb([live], { globalChatVariables: { toggle_a: '1', g: 'live' }, templateDefaultVariables: 'z=9' })
        return { live, before: snapshot() }
    }

    test('the sandboxed variables change, the database does not, and nothing is marked', () => {
        const { live, before } = liveWorld()
        const run = runPreview(TEXT, 'desc', sourceOf(live), values({ chat: { hp: '1', n: '3' } }))
        expect(run).toEqual({
            ok: true,
            text: '5',
            writes: [
                { key: 'd', before: null, after: 'x' },
                { key: 'hp', before: '1', after: '5' },
                { key: 'n', before: '3', after: '5' },
            ],
            varies: false,
        })
        expect(snapshot()).toEqual(before)
        expect(live.chats[0].scriptstate).toBeUndefined()
        expect(h.mark).not.toHaveBeenCalled()
        expect(state.db.characters.map((c) => c.chaId)).toEqual([live.chaId])
    })

    test('seeded keys that the run leaves unchanged or sets to the same value are not listed as writes', () => {
        const { live } = liveWorld()
        const run = runPreview('{{getvar::hp}}{{setvar::hp::1}}', 'desc', sourceOf(live), values({ chat: { hp: '1', other: 'z' } }))
        expect(run).toEqual({ ok: true, text: '1', writes: [], varies: false })
    })

    test('a second run gives identical writes: nothing accumulates between runs', () => {
        const { live } = liveWorld()
        const first = runPreview(TEXT, 'desc', sourceOf(live), values({ chat: { hp: '1', n: '3' } }))
        const second = runPreview(TEXT, 'desc', sourceOf(live), values({ chat: { hp: '1', n: '3' } }))
        expect(second).toEqual(first)
    })

    test('the scratch objects never enter the database and the source is not aliased', () => {
        const { live } = liveWorld()
        const source = sourceOf(live)
        runPreview('{{setvar::x::1}}', 'desc', source, values())
        expect(source.modules).not.toBe(live.modules)
        expect(state.db.characters).toHaveLength(1)
        expect(live.alternateGreetings).toEqual([])
    })
})

describe('E2-U4 unlisted globals read null', () => {
    test('an unlisted global reads null whatever the live value; a listed toggle reads its sandbox value, empty included', () => {
        installDb([liveCharacter()], { globalChatVariables: { g: 'live', toggle_a: '1' } })
        const source = sourceOf()
        expect(textOf('{{getglobalvar::g}}', 'desc', source, values())).toBe('null')
        expect(textOf('{{getglobalvar::toggle_a}}', 'desc', source, values())).toBe('null')
        expect(textOf('{{getglobalvar::toggle_a}}', 'desc', source, values({ toggles: { toggle_a: '0' } }))).toBe('0')
        expect(textOf('[{{getglobalvar::toggle_a}}]', 'desc', source, values({ toggles: { toggle_a: '' } }))).toBe('[]')
    })

    test('an inherited object name reads null', () => {
        expect(textOf('{{getglobalvar::constructor}}', 'desc', sourceOf(), values())).toBe('null')
    })

    test('#when reads a toggle from the sandbox value', () => {
        installDb([liveCharacter()], { globalChatVariables: { toggle_a: '1' } })
        expect(textOf('{{#when::toggle::a}}yes{{:else}}no{{/when}}', 'desc', sourceOf(), values())).toBe('no')
        expect(textOf('{{#when::toggle::a}}yes{{:else}}no{{/when}}', 'desc', sourceOf(), values({ toggles: { toggle_a: '1' } }))).toBe('yes')
    })
})

describe('E2-U6 variesIn and VARIES_NAMES', () => {
    test('clock and random macros vary, an ordinary macro does not', () => {
        for (const text of ['{{time}}', '{{random::a::b}}', '{{roll::6}}', '{{idleduration}}', '{{datetimeformat::YYYY}}', '{{getvar::{{time}}}}']) {
            expect(variesIn(text), text).toBe(true)
        }
        expect(variesIn('{{char}} {{getvar::time}}')).toBe(false)
    })

    test('every VARIES_NAMES entry resolves in the real registry', () => {
        const index = createMacroIndex(collectMacroEntries())
        for (const name of VARIES_NAMES) expect(index.lookup(name), name).not.toBeNull()
    })
})

describe('E2-U7 copiedChatValues', () => {
    test('copies every $ string key and the toggles by the chat-local rule, and never writes the live chat', () => {
        const chat: Chat = {
            id: 'c', name: '', note: '', localLore: [], message: [],
            scriptstate: { $hp: '1', $n: 3, $flag: true, plain: 'x' },
            GLGlobalVariables: { toggle_b: '9', toggle_c: 'null', toggle_d: '' },
        }
        const globals = { toggle_a: '1', toggle_b: '0', toggle_c: '5', toggle_d: '6', other: 'o' }
        const before = structuredClone(chat)
        expect(copiedChatValues(chat, globals)).toEqual({
            chat: { hp: '1' },
            toggles: { toggle_a: '1', toggle_b: '9', toggle_c: '5', toggle_d: '6' },
        })
        expect(chat).toEqual(before)
    })

    test('no chat gives null', () => {
        expect(copiedChatValues(null, {})).toBeNull()
        expect(copiedChatValues(undefined, {})).toBeNull()
    })

    test('each copied toggle equals what a real run reads for it, and the live chat keeps no scriptstate', () => {
        const live = liveCharacter()
        const chat = live.chats[0]
        chat.GLGlobalVariables = { toggle_b: '9', toggle_c: 'null' }
        installDb([live], { globalChatVariables: { toggle_a: '1', toggle_b: '0', toggle_c: '5' } })
        const subject = createRunSubject({ chaId: live.chaId, chatId: chat.id ?? '' })
        const copied = copiedChatValues(chat, state.db.globalChatVariables)
        expect(copied).not.toBeNull()
        for (const [key, value] of Object.entries(copied?.toggles ?? {})) expect(value, key).toBe(getGlobalChatVar(key, subject))
        expect(chat.scriptstate).toBeUndefined()
    })
})

describe('E2-U8 and E2-U9 failure and the script pipeline', () => {
    // The parser's matcher swallows a throwing macro callback, so the failure is injected where the run reads its source.
    test('a throw during the run gives ok:false and leaves the database unchanged', () => {
        const before = snapshot()
        const broken = Object.defineProperty({ ...sourceOf() }, 'texts', { get: (): never => { throw new Error('source unreadable') } })
        expect(runPreview('{{getvar::x}}', 'desc', broken, values())).toEqual({ ok: false })
        expect(snapshot()).toEqual(before)
    })

    test('the script pipeline is never called: both the run and the HTML succeed with it set to throw', () => {
        const run = runPreview('**{{char}}**', 'greeting', sourceOf(), values())
        expect(run.ok).toBe(true)
        expect(previewHtml(run.ok ? run.text : '').html).toContain('<strong>Alice</strong>')
        expect(h.processScriptFull).not.toHaveBeenCalled()
    })
})

describe('E2-U10 the {{user}} name follows the source chat (MC-1847)', () => {
    function personaWorld(): { live: character; boundChat: Chat } {
        const live = liveCharacter()
        const boundChat: Chat = { id: 'src-chat', name: '', note: '', localLore: [], message: [], bindedPersona: 'p1' }
        live.chats[0].bindedPersona = 'p2'
        installDb([live], {
            username: 'Uma',
            personas: [
                { id: 'p0', name: 'Uma', personaPrompt: 'P0', icon: '', note: '' },
                { id: 'p1', name: 'Pat', personaPrompt: 'PP', icon: '', note: '' },
                { id: 'p2', name: 'Sel', personaPrompt: 'PS', icon: '', note: '' },
            ],
            selectedPersona: 0,
        })
        return { live, boundChat }
    }

    test('a source chat bound to a persona gives its name and prompt', () => {
        const { live, boundChat } = personaWorld()
        const source = sourceOf(live, boundChat)
        expect(textOf('{{user}}', 'greeting', source, values())).toBe('Pat')
        expect(textOf('{{persona}}', 'greeting', source, values())).toBe('PP')
        expect(sandboxUserName(source)).toBe('Pat')
    })

    test('no source chat gives the global name, not the selected live chat\'s binding', () => {
        const { live } = personaWorld()
        const source = sourceOf(live, null)
        expect(textOf('{{user}}', 'greeting', source, values())).toBe('Uma')
        expect(sandboxUserName(source)).toBe('Uma')
    })
})

describe('E2-U11 module references come from the source (D4)', () => {
    function modulesWorld(): { before: unknown; live: character } {
        const live = liveCharacter({ modules: ['id-m1'] })
        const make = (id: string, namespace: string) => ({ id, name: namespace, namespace, lorebook: [] })
        installDb([live], { modules: [make('id-m1', 'n1'), make('id-m2', 'n2'), make('id-m3', 'n3')], enabledModules: ['id-m3'] })
        return { before: snapshot(), live }
    }
    const TEXT = '{{moduleenabled::n1}}{{moduleenabled::n2}}{{moduleenabled::n3}}'

    test('the character, chat and globally enabled modules all read as enabled; an empty source reads only the global one', () => {
        const { before, live } = modulesWorld()
        const chat: Chat = { id: 'src', name: '', note: '', localLore: [], message: [], modules: ['id-m2'] }
        expect(textOf(TEXT, 'greeting', sourceOf(live, chat), values())).toBe('111')
        expect(textOf(TEXT, 'greeting', sourceOf(liveCharacter({ modules: [] }), null), values())).toBe('001')
        expect(snapshot()).toEqual(before)
    })
})

describe('E2-U12 greetings are the displayed form (D5)', () => {
    test('a greeting keeps a comment as displayed text; a description or note drops it', () => {
        const text = 'a{{comment::c}}b'
        const greeting = textOf(text, 'greeting', sourceOf(), values())
        expect(greeting).toContain('risu-comment')
        expect(greeting).toContain('c')
        expect(textOf(text, 'desc', sourceOf(), values())).toBe('ab')
    })

    test('a greeting runs with first-message conditions; a desc run does not', () => {
        expect(textOf('{{isfirstmsg}}', 'greeting', sourceOf(), values())).toBe('1')
        expect(textOf('{{isfirstmsg}}', 'desc', sourceOf(), values())).toBe('0')
    })
})

describe('E2-U13 the engine reads of the live selection stay untouched', () => {
    test('the selected character id is unchanged by a run', () => {
        selectedCharID.set(0)
        runPreview('{{setvar::a::1}}{{getvar::a}}', 'desc', sourceOf(), values())
        expect(get(selectedCharID)).toBe(0)
    })
})

describe('E2-U14 an owner author defaults reach the preview (CHORE-570a)', () => {
    const WHEN = '{{#when::toggle::k}}Y{{/when}}'

    // regression reproducer: the base drops the owner's toggle text, so the unset toggle reads off
    test('an owner default-on check shows its body while the preview holds no value', () => {
        const source = sourceOf(liveCharacter({ customModuleToggle: 'k=K===1' }))
        expect(textOf(WHEN, 'desc', source, values())).toBe('Y')
        expect(textOf('{{getglobalvar::toggle_k}}', 'desc', source, values())).toBe('1')
    })

    // compatibility guard: a preview value is the shared slot, so it wins over the default
    test('a preview value of 0 wins over the default', () => {
        const source = sourceOf(liveCharacter({ customModuleToggle: 'k=K===1' }))
        expect(textOf(WHEN, 'desc', source, values({ toggles: { toggle_k: '0' } }))).toBe('')
        expect(textOf(WHEN, 'desc', source, values({ toggles: { toggle_k: '1' } }))).toBe('Y')
    })

    // compatibility guard: no default, no change
    test('an owner toggle without a default stays off, and the live database is untouched', () => {
        const live = liveCharacter({ customModuleToggle: 'k=K' })
        installDb([live], { customPromptTemplateToggle: '', globalChatVariables: { toggle_a: '1' } })
        const before = snapshot()
        expect(textOf(WHEN, 'desc', sourceOf(live), values())).toBe('')
        expect(snapshot()).toEqual(before)
    })

    test('the source copies the owner text as a string', () => {
        expect(sourceOf(liveCharacter({ customModuleToggle: 'k=K===1' })).customModuleToggle).toBe('k=K===1')
        expect(sourceOf(liveCharacter()).customModuleToggle).toBe('')
    })
})