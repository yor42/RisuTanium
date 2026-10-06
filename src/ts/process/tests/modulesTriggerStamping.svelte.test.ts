// @vitest-environment node

/**
 * W1a, trigger definitions stay read-only (no run writes a character's
 * `triggerscript` entries or a module's `trigger` entries): the REAL
 * `getModuleTriggers()` (`../modules.ts`) is exercised directly through the
 * REAL `runTrigger` (`../triggers.ts`), against `DBState.db`. `DBState.db` is
 * declared with `$state(...)` below, but this file compiles under
 * `@vitest-environment node`, where Svelte generates `$state()` for the
 * server -- a plain object, not a reactive Proxy; nothing here relies on
 * reactivity. `../modules.ts`'s own heavy, unrelated dependencies
 * (`../characterCards`, `../interchangeability`, `../rpack/rpack_js`,
 * `../media`, and the asset/file half of `../../globalApi.svelte`) are
 * mocked, since `getModuleTriggers()` and the `getModules()` it calls never
 * reach any of them -- only their module graphs, not their behaviour, would
 * otherwise load. This is a separate file from
 * `triggerOriginWrites.svelte.test.ts` because that suite's other tests all
 * rely on a lightweight stand-in for `../modules` (module-sourced triggers
 * are not what most of them exercise), and unmocking it there would pull the
 * same heavy graph into every one of those tests for no reason.
 *
 * Every other mock below matches `triggerOriginWrites.svelte.test.ts`'s own
 * (network-facing stubs, or real-shaped re-implementations reading/writing
 * the same mocked `DBState`/`selectedCharID`), extended only with what
 * `../modules.ts` itself additionally imports.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character } from '../../storage/database.svelte'
import type { triggerscript, triggerEffect } from '../triggers'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
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
    // The four below are `../modules.ts`'s own extra needs; none of them is
    // called by `getModules()`/`getModuleTriggers()`.
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    // `../modules.ts`'s own extra needs (module import/export plumbing), not
    // reached by `getModules()`/`getModuleTriggers()`.
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
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
    // `../modules.ts`'s own extra need; not reached by `getModules()`.
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
    // `../modules.ts`'s own extra need; not reached by `getModuleTriggers()`.
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

// `../modules.ts`'s own extra dependencies. None of these is ever called by
// `getModules()`/`getModuleTriggers()` -- they belong to module import/
// export and asset conversion, a different behaviour from the one under
// test -- so an opaque stub is real-shaped enough.
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

// Real-shaped re-implementations reading/writing through the SAME mocked
// `DBState`/`selectedCharID` above -- mirrors database.svelte.ts's own
// getCurrentCharacter/getCurrentChat/setCurrentCharacter/setCurrentChat
// exactly, which is what lets `getModules()` (called by the REAL
// `getModuleTriggers()` below) resolve without loading the real (heavy)
// database.svelte.ts.
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

// `../modules.ts` itself is NOT mocked here -- it is the module under test.

//#endregion

let runTrigger: typeof import('../triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('../chatOrigin').beginWork

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
})

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

function makeChat(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        message: [] as unknown[],
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    }
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

// `enabledModules` is what the REAL `getModules()` reads to select which
// database modules apply -- a module absent from it is invisible to
// `getModuleTriggers()`, matching production's own selection rule.
function installDb(characters: character[], modules: Record<string, unknown>[]) {
    DBState.db = {
        characters,
        modules,
        enabledModules: modules.map((m) => m.id as string),
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
    } as unknown as import('../../storage/database.svelte').Database
    selectedCharID.set(0)
}

//#endregion

describe('Trigger definitions are not stamped onto shared entries (real modules.ts)', () => {
    test('a module trigger entry\'s lowLevelAccess is unchanged after a run in each mode', async () => {
        const char = makeCharacter('char-mod')
        const moduleTrigger = trig('modtrig', 'start', [v2('v2Comment', { value: '' })])
        // Sentinel: differs from what the real getModuleTriggers() computes
        // for this run (module.lowLevelAccess === true), so a stamp landing
        // on the shared entry -- rather than a run-local copy -- is caught.
        moduleTrigger.lowLevelAccess = false
        installDb([char], [{ id: 'mod-1', lowLevelAccess: true, trigger: [moduleTrigger] }])
        const chat = char.chats[0]
        const before = structuredClone(DBState.db.modules[0].trigger[0])

        for (const mode of ['start', 'manual', 'output', 'input'] as const) {
            const handle = beginWork(char, chat)
            try {
                await runTrigger(char, mode, {
                    chat,
                    manualName: mode === 'manual' ? 'modtrig' : undefined,
                    origin: handle!.origin,
                } as never)
            } finally { handle!.end() }
        }

        expect(DBState.db.modules[0].trigger[0]).toStrictEqual(before)
    })
})
