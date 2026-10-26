// @vitest-environment node

/**
 * The six module body getters skip a slot that is marked as a module stub, even one that has gained body keys (an
 * edited or malformed stub), while `getModules` itself keeps returning stubs: callers read their id, namespace and
 * icon flags. The module list memo also misses when a whole-list write replaces `db.modules` with rows of the same ids.
 * Drives the REAL `modules.ts` over a plain `DBState.db`, with its unrelated import/export dependencies mocked the way
 * `modulesTriggerStamping.svelte.test.ts` does.
 *
 * Labels: R = regression reproducer (fails on the pre-change base at an assertion), G = guard (passes before and
 * after the change).
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as any }
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
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../../util'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    convertExternalLorebook: vi.fn((v: unknown) => v),
}) as unknown as typeof import('../lorebook.svelte'))

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
    } as unknown as typeof import('../../storage/database.svelte')
})

//#endregion

type Plain = Record<string, unknown>

let modulesApi: typeof import('../modules')
let DBState: { db: any }

beforeAll(async () => {
    modulesApi = await import('../modules')
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: any }
})

const lorebookEntry = { key: 'k', secondkey: '', insertorder: 1, comment: 'c', content: 'BODY', mode: 'normal', alwaysActive: true, selective: false }
const regexEntry = { comment: 'r', in: 'a', out: 'b', type: 'editinput', flag: 'g', ableFlag: true }
const triggerEntry = { comment: 't', type: 'manual', conditions: [], effect: [] }

/** A stub that carries body keys, as an edited or malformed stub would. */
function bodyKeyedStub(id: string): Plain {
    return {
        id, name: id, description: '', [MODULE_STUB_KEY]: 1,
        lorebook: [lorebookEntry], assets: [['a', 'b', 'c']], trigger: [triggerEntry], regex: [regexEntry],
        customModuleToggle: 'TOGGLE', mcp: { url: 'http://mcp.test' },
    }
}

function wellFormedStub(id: string): Plain {
    return { id, name: id, description: '', [MODULE_STUB_KEY]: 1 }
}

function residentModule(id: string): Plain {
    return {
        id, name: id, description: '',
        lorebook: [lorebookEntry], assets: [['a', 'b', 'c']], trigger: [triggerEntry], regex: [regexEntry],
        customModuleToggle: 'TOGGLE', mcp: { url: 'http://mcp.test' },
    }
}

function installDb(modules: Plain[], enabled: string[] = modules.map((m) => m.id as string)) {
    DBState.db = { characters: [], modules, enabledModules: enabled, moduleIntergration: '', personas: [] }
    modulesApi.refreshModules()
}

beforeEach(() => {
    installDb([])
})

describe('the six body getters skip a stub', () => {
    test('R producer-skip-six-getters-return-empty-for-body-keyed-stub', () => {
        installDb([bodyKeyedStub('s1')])
        expect(modulesApi.getModuleLorebooks()).toEqual([])
        expect(modulesApi.getModuleAssets()).toEqual([])
        expect(modulesApi.getModuleTriggers()).toEqual([])
        expect(modulesApi.getModuleRegexScripts()).toEqual([])
        expect(modulesApi.getModuleToggles()).toBe('')
        expect(modulesApi.getModuleMcps()).toEqual([])
    })

    test('G producer-skip-resident-module-still-yields-its-body', () => {
        installDb([residentModule('m1')])
        expect(modulesApi.getModuleLorebooks()).toHaveLength(1)
        expect(modulesApi.getModuleAssets()).toHaveLength(1)
        expect(modulesApi.getModuleTriggers()).toHaveLength(1)
        expect(modulesApi.getModuleRegexScripts()).toHaveLength(1)
        expect(modulesApi.getModuleToggles()).toContain('TOGGLE')
        expect(modulesApi.getModuleMcps()).toEqual(['http://mcp.test'])
    })

    test('G producer-skip-well-formed-stub-yields-empty', () => {
        installDb([wellFormedStub('s1')])
        expect(modulesApi.getModuleLorebooks()).toEqual([])
        expect(modulesApi.getModuleAssets()).toEqual([])
        expect(modulesApi.getModuleTriggers()).toEqual([])
        expect(modulesApi.getModuleRegexScripts()).toEqual([])
        expect(modulesApi.getModuleToggles()).toBe('')
        expect(modulesApi.getModuleMcps()).toEqual([])
    })

    test('R producer-skip-leaves-a-resident-neighbour-alone', () => {
        installDb([bodyKeyedStub('s1'), residentModule('m1')])
        expect(modulesApi.getModuleLorebooks()).toHaveLength(1)
        expect(modulesApi.getModuleMcps()).toEqual(['http://mcp.test'])
    })

    test('G getModules-still-returns-stub', () => {
        installDb([wellFormedStub('s1'), residentModule('m1')])
        expect(modulesApi.getModules().map((m) => m.id)).toEqual(['s1', 'm1'])
    })
})

describe('the module list memo', () => {
    test('G memo-still-hits-on-repeated-call', () => {
        installDb([residentModule('m1')])
        const first = modulesApi.getModules()
        expect(modulesApi.getModules()).toBe(first)
    })

    test('R whole-list-plugin-write-refreshes-module-cache', () => {
        installDb([residentModule('m1')])
        const before = modulesApi.getModules()
        const replacement = residentModule('m1')
        replacement.description = 'replaced'
        DBState.db.modules = [replacement]
        const after = modulesApi.getModules()
        expect(after).not.toBe(before)
        expect(after[0].description).toBe('replaced')
    })

    test('G refreshModules-forces-a-rebuild', () => {
        installDb([residentModule('m1')])
        const before = modulesApi.getModules()
        modulesApi.refreshModules()
        expect(modulesApi.getModules()).not.toBe(before)
    })
})
