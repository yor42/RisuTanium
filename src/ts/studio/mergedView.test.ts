import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import type { RisuModule } from '../process/modules'
import type { customscript, loreBook } from '../storage/database.svelte'
import { buildOwnerModel, type OwnerModel } from './ownerModel'
import { buildMergedView, type MergedGroup, type MergedKind, type MergedRow } from './mergedView'
import type { ScriptListEntry } from './scriptMode'
import { luaScripts, makeCharacter, makeChat, makeInput, makePreset, residentModule, stubModule, v2Scripts } from './studioFixtures.test-helpers'

// The engine functions (getModuleRegexScripts and friends) run for real over a plain database; the unrelated
// import/export dependencies of process/modules are replaced the way moduleProducerSkip.test.ts does.

vi.mock(import('../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('../stores.svelte'), () => {
    const state = { db: {} as Record<string, unknown> }
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
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../alert'))

vi.mock(import('../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../tokenizer'), () => ({ tokenize: vi.fn(async () => 1) }) as unknown as typeof import('../tokenizer'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock(import('../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../util'))
vi.mock(import('../process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    convertExternalLorebook: vi.fn((v: unknown) => v),
}) as unknown as typeof import('../process/lorebook.svelte'))
vi.mock(import('../media'), () => ({ compressImage: vi.fn(async (v: unknown) => v) }) as unknown as typeof import('../media'))
vi.mock(import('../rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()),
    encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('../rpack/rpack_js'))
vi.mock(import('../interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('../interchangeability'))
vi.mock(import('../characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('../characterCards'))
vi.mock(import('../storage/database.svelte'), async () => {
    const stores = await import('../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: { chatPage: number, chats?: unknown[] }[] } }
    const currentCharacter = () => {
        state.db.characters ??= []
        return state.db.characters[get(stores.selectedCharID)]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => state.db),
        setDatabase: vi.fn(),
        getCurrentCharacter: vi.fn(currentCharacter),
        getCurrentChat: vi.fn(() => {
            const character = currentCharacter()
            return character?.chats?.[character.chatPage]
        }),
    } as unknown as typeof import('../storage/database.svelte')
})

let engine: typeof import('../process/modules')
let listing: typeof import('../process/moduleRefList')
let state: { db: Record<string, unknown> }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    engine = await import('../process/modules')
    listing = await import('../process/moduleRefList')
    const stores = await import('../stores.svelte')
    state = stores.DBState as unknown as { db: Record<string, unknown> }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
})

beforeEach(() => {
    state.db = {}
})

function loreBook(comment: string): loreBook {
    return { key: comment, secondkey: '', insertorder: 1, comment, content: 'body', mode: 'normal', alwaysActive: false, selective: false }
}

function script(comment: string): customscript {
    return { comment, in: 'a', out: 'b', type: 'editinput' }
}

interface Scene {
    model: OwnerModel
    presetRegex: customscript[]
    characterRegex: customscript[]
    characterLore: loreBook[]
    chatLore: loreBook[]
    modules: RisuModule[]
}

/** Installs a database the engine reads and builds the model over the very same rows. */
function scene(options: { modules?: RisuModule[], enabled?: string[], license?: string, characterToggle?: string, presetToggle?: string, triggerscript?: ScriptListEntry[] } = {}): Scene {
    const presetRegex = [script('preset-1')]
    const characterRegex = [script('char-1'), script('char-2')]
    const characterLore = [loreBook('char-lore-1'), loreBook('char-lore-2')]
    const chatLore = [loreBook('chat-lore-1')]
    const modules = options.modules ?? [
        residentModule('m1', { regex: [script('m1-r1'), script('m1-r2')], lorebook: [loreBook('m1-l1'), loreBook('m1-l2')], customModuleToggle: 'a=A' }),
        residentModule('m2', { regex: [script('m2-r1')], lorebook: [], customModuleToggle: 'b=B' }),
    ]
    const enabled = options.enabled ?? modules.map((row) => row.id)
    const character = {
        ...makeCharacter({
            customscript: characterRegex,
            globalLore: characterLore,
            customModuleToggle: options.characterToggle ?? 'char=C',
            triggerscript: options.triggerscript,
            license: options.license,
            chats: [makeChat({ id: 'c1', name: 'Chat', localLore: chatLore })],
        }),
        type: 'character',
    }
    state.db = {
        characters: [character],
        modules,
        enabledModules: enabled,
        moduleIntergration: '',
        personas: [],
    }
    selectedCharID.set(0)
    engine.refreshModules()
    const model = buildOwnerModel(makeInput({
        character,
        modules,
        enabledModules: enabled,
        presets: [makePreset('Main', { regex: presetRegex, toggles: options.presetToggle ?? 'preset=P' })],
        activePreset: 0,
        lister: listing.moduleListOf,
    }))
    return { model, presetRegex, characterRegex, characterLore, chatLore, modules }
}

function group(model: OwnerModel, kind: MergedKind): MergedGroup {
    const found = buildMergedView(model).groups.find((candidate) => candidate.kind === kind)
    if (!found) throw new Error(`no ${kind} group`)
    return found
}

function sourceOfRow<T>(scene: Scene, row: MergedRow, field: 'regex' | 'lorebook'): T {
    const owner = row.ownerKey
    if (owner === 'preset:0') return scene.presetRegex[row.item.index] as T
    if (owner === 'character:cha-1') return (field === 'regex' ? scene.characterRegex : scene.characterLore)[row.item.index] as T
    if (owner === 'chat:c1') return scene.chatLore[row.item.index] as T
    const module = scene.modules.find((candidate) => `module:${candidate.id}` === owner)
    return module?.[field]?.[row.item.index] as T
}

describe('3d merged order equals the engine concatenation', () => {
    test('groups come in the table order', () => {
        const { model } = scene()
        expect(buildMergedView(model).groups.map((candidate) => candidate.kind)).toEqual(['toggles', 'regex', 'lore', 'scripts'])
    })

    test('regex: preset, character, modules; ordinals follow the engine list', () => {
        const fixture = scene()
        const rows = group(fixture.model, 'regex').rows()
        const engineList = fixture.presetRegex.concat(fixture.characterRegex).concat(engine.getModuleRegexScripts())
        expect(engineList).toHaveLength(6)
        expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 6])
        rows.forEach((row, index) => {
            expect(sourceOfRow<customscript>(fixture, row, 'regex')).toBe(engineList[(row.ordinal ?? 0) - 1])
            expect(sourceOfRow<customscript>(fixture, row, 'regex')).toBe(engineList[index])
        })
        expect(rows.map((row) => row.ownerKey)).toEqual(['preset:0', 'character:cha-1', 'character:cha-1', 'module:m1', 'module:m1', 'module:m2'])
        expect(rows.map((row) => row.position)).toEqual([1, 1, 2, 1, 2, 1])
    })

    test('lore: character, chat, modules; ordinals follow the engine list', () => {
        const fixture = scene()
        const rows = group(fixture.model, 'lore').rows()
        const engineList = fixture.characterLore.concat(fixture.chatLore).concat(engine.getModuleLorebooks())
        expect(engineList).toHaveLength(5)
        expect(rows.map((row) => row.ownerKey)).toEqual(['character:cha-1', 'character:cha-1', 'chat:c1', 'module:m1', 'module:m1'])
        rows.forEach((row) => {
            expect(sourceOfRow<loreBook>(fixture, row, 'lorebook')).toBe(engineList[(row.ordinal ?? 0) - 1])
        })
    })

    test('toggles: preset, modules, character; the modules keep the order of getModuleToggles()', () => {
        const fixture = scene()
        const rows = group(fixture.model, 'toggles').rows()
        expect(rows.map((row) => row.ownerKey)).toEqual(['preset:0', 'module:m1', 'module:m2', 'character:cha-1'])
        expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4])
        const moduleText = engine.getModuleToggles()
        const positions = ['a=A', 'b=B'].map((text) => moduleText.indexOf(text))
        expect(positions[0]).toBeGreaterThanOrEqual(0)
        expect(positions[0]).toBeLessThan(positions[1])
    })

    test('modules keep database order whatever order they were enabled in', () => {
        const modules = [residentModule('first', { regex: [script('f')] }), residentModule('second', { regex: [script('s')] })]
        const fixture = scene({ modules, enabled: ['second', 'first'] })
        const owners = group(fixture.model, 'regex').rows().map((row) => row.ownerKey).filter((key) => key.startsWith('module:'))
        expect(owners).toEqual(['module:first', 'module:second'])
        expect(engine.getModuleRegexScripts().map((entry) => entry.comment)).toEqual(['f', 's'])
    })
})

describe('3d2 numbering stops at a segment Studio cannot show', () => {
    test('an unloaded active module stops the absolute numbers; later rows keep their position', () => {
        const modules = [
            residentModule('m1', { regex: [script('m1-r1'), script('m1-r2')] }),
            stubModule('s1'),
            residentModule('m3', { regex: [script('m3-r1')] }),
        ]
        const fixture = scene({ modules })
        const regex = group(fixture.model, 'regex')
        const rows = regex.rows()
        expect(rows.map((row) => [row.ownerKey, row.ordinal, row.position])).toEqual([
            ['preset:0', 1, 1],
            ['character:cha-1', 2, 1],
            ['character:cha-1', 3, 2],
            ['module:m1', 4, 1],
            ['module:m1', 5, 2],
            ['module:m3', null, 1],
        ])
        expect(regex.unshownSegments).toBe(1)
        expect(regex.segments).toContain('module:s1')
        expect(rows.some((row) => row.ownerKey === 'module:s1')).toBe(false)
    })

    test('private content stops the numbers at the character in the regex group', () => {
        const fixture = scene({ license: 'private' })
        const regex = group(fixture.model, 'regex')
        expect(regex.rows().map((row) => [row.ownerKey, row.ordinal])).toEqual([
            ['preset:0', 1], ['module:m1', null], ['module:m1', null], ['module:m2', null],
        ])
        expect(regex.unshownSegments).toBe(1)
        const lore = group(fixture.model, 'lore')
        expect(lore.rows().every((row) => row.ordinal === null)).toBe(true)
        expect(lore.unshownSegments).toBe(2)
    })

    test('with nothing hidden there is no partial segment', () => {
        const fixture = scene()
        expect(buildMergedView(fixture.model).groups.map((candidate) => candidate.unshownSegments)).toEqual([0, 0, 0, 0])
    })
})

describe('3e the scripts group is not numbered', () => {
    test('every row has a position and no absolute number', () => {
        const modules = [residentModule('m1', {
            trigger: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'v2Header', indent: 0 }] }],
        })]
        const fixture = scene({ modules, triggerscript: v2Scripts })
        const scripts = group(fixture.model, 'scripts')
        const rows = scripts.rows()
        expect(scripts.numbered).toBe(false)
        expect(rows.map((row) => row.ownerKey)).toEqual(['character:cha-1', 'module:m1'])
        expect(rows.map((row) => row.ordinal)).toEqual([null, null])
        expect(rows.map((row) => row.position)).toEqual([1, 1])
        expect(rows.map((row) => row.item.mode)).toEqual(['v2', 'v2'])
    })

    test('the other groups are numbered', () => {
        const fixture = scene()
        expect(buildMergedView(fixture.model).groups.filter((candidate) => candidate.numbered).map((candidate) => candidate.kind)).toEqual(
            ['toggles', 'regex', 'lore'],
        )
    })

    test('a lua script list is one scripts row', () => {
        const model = buildOwnerModel(makeInput({ character: makeCharacter({ triggerscript: luaScripts }) }))
        expect(group(model, 'scripts').rows().map((row) => row.item.mode)).toEqual(['lua'])
    })
})
