// @vitest-environment node

/**
 * Tests for the module reference rule. The `getModules` guards are
 * compatibility guards: which ids `getModules` collects from the enabled list,
 * chat, character, persona and integration string, and how those ids select
 * modules (id or namespace, first duplicate id wins, memo keyed by the joined
 * id list). They hold both before and after the rule is extracted into
 * `../moduleRefs`. The leaf tests pin the extracted `referencedModuleIds` and
 * `matchesModuleRef` directly, including the order of the ids and that the
 * caller's arrays are left unchanged. `../modules.ts`'s unrelated heavy
 * dependencies are mocked; none is reached by `getModules`.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest'

//#region module mocks

const ctx = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    chat: undefined as { modules?: string[] } | undefined,
    character: undefined as { modules?: string[] } | undefined,
    persona: false as false | { embeddedModule?: { id: string } },
}))

vi.mock('../../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
    }
})

vi.mock('../../alert', async () => {
    const { writable } = await import('svelte/store')
    return {
        alertError: vi.fn(),
        alertInput: vi.fn(async () => ''),
        alertNormal: vi.fn(),
        alertSelect: vi.fn(async () => ''),
        alertConfirm: vi.fn(async () => true),
        alertClear: vi.fn(),
        alertModuleSelect: vi.fn(async () => -1),
        alertStore: writable({ type: '', msg: '' }),
        alertWait: vi.fn(),
    }
})

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    AppendableBuffer: class {},
    AssetSourceChangedError: class extends Error {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
    saveAssetFromPieces: vi.fn(async () => ''),
}))

vi.mock('../../tokenizer', () => ({
    tokenize: vi.fn(async () => 1),
}))

vi.mock('src/ts/platform', () => ({
    isTauri: false,
    isNodeServer: false,
}))

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

vi.mock('../../util', () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => ctx.persona),
    selectSingleFile: vi.fn(),
    selectFileByDom: vi.fn(),
    parseKeyValue: vi.fn(() => []),
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}))

vi.mock('../lorebook.svelte', () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    convertExternalLorebook: vi.fn((v: unknown) => v),
}))

vi.mock('../../media', () => ({
    compressImage: vi.fn(async (v: unknown) => v),
}))

vi.mock('../../rpack/rpack_js', () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()),
    encodeRPack: vi.fn(async () => new Uint8Array()),
}))

vi.mock('../../interchangeability', () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}))

vi.mock('../../characterCards', () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(),
    importCharacterProcess: vi.fn(),
}))

vi.mock('../../storage/database.svelte', () => ({
    presetTemplate: {},
    getDatabase: vi.fn(() => ctx.db),
    setDatabase: vi.fn(),
    getCurrentCharacter: vi.fn(() => ctx.character),
    getCurrentChat: vi.fn(() => ctx.chat),
    setCurrentCharacter: vi.fn(),
    setCurrentChat: vi.fn(),
}))

//#endregion

type TestModule = { id: string, name: string, description: string, namespace?: string }

let getModules: typeof import('../modules').getModules
let step = 0

beforeAll(async () => {
    getModules = (await import('../modules')).getModules
})

function mod(id: string, namespace?: string, name: string = id): TestModule {
    const m: TestModule = { id, name, description: '' }
    if (namespace !== undefined) {
        m.namespace = namespace
    }
    return m
}

type Sources = {
    enabled?: string[]
    chat?: string[]
    character?: string[]
    persona?: string
    integration?: string
}

// Distinct enabled ids per call keep the module-level memo from answering a
// later setup with an earlier one's result.
function select(modules: TestModule[], sources: Sources): TestModule[] {
    step += 1
    ctx.db = { modules: [], enabledModules: [`reset-${step}`] }
    ctx.chat = undefined
    ctx.character = undefined
    ctx.persona = false
    getModules()
    ctx.db = {
        modules,
        enabledModules: sources.enabled ?? [],
        moduleIntergration: sources.integration ?? '',
    }
    ctx.chat = sources.chat ? { modules: sources.chat } : undefined
    ctx.character = sources.character ? { modules: sources.character } : undefined
    ctx.persona = sources.persona ? { embeddedModule: { id: sources.persona } } : false
    return getModules() as unknown as TestModule[]
}

function selectedIds(modules: TestModule[], sources: Sources): string[] {
    return select(modules, sources).map((m) => m.id)
}

describe('moduleRefs leaf functions', () => {
    test('referencedModuleIds keeps source order and empty segments', async () => {
        const { referencedModuleIds } = await import('../moduleRefs')
        expect(referencedModuleIds({
            enabledModules: ['e'],
            chat: { modules: ['c'] },
            character: { modules: ['h'] },
            persona: { embeddedModule: { id: 'p' } },
            moduleIntergration: ' i , ,j',
        })).toEqual(['e', 'c', 'h', 'p', 'i', '', 'j'])
        expect(referencedModuleIds({})).toEqual([])
        expect(referencedModuleIds({ chat: {}, persona: false, character: {} })).toEqual([])
        expect(referencedModuleIds({ persona: {} })).toEqual([])
    })

    test('referencedModuleIds leaves an empty integration string unreferenced', async () => {
        const { referencedModuleIds } = await import('../moduleRefs')
        expect(referencedModuleIds({ moduleIntergration: '' })).toEqual([])
    })

    test('referencedModuleIds leaves every input array unchanged', async () => {
        const { referencedModuleIds } = await import('../moduleRefs')
        const enabled = Object.freeze(['e1', 'e2']) as string[]
        const chatModules = Object.freeze(['c']) as string[]
        const characterModules = Object.freeze(['h']) as string[]
        const input = {
            enabledModules: enabled,
            chat: { modules: chatModules },
            character: { modules: characterModules },
            persona: { embeddedModule: { id: 'p' } },
            moduleIntergration: 'i,j',
        }
        const before = JSON.stringify(input)
        expect(referencedModuleIds(input)).toEqual(['e1', 'e2', 'c', 'h', 'p', 'i', 'j'])
        expect(JSON.stringify(input)).toBe(before)
        expect(enabled).toEqual(['e1', 'e2'])
        expect(chatModules).toEqual(['c'])
        expect(characterModules).toEqual(['h'])
    })

    test('referencedModuleIds with only enabled modules does not let later concatenation reach the caller array', async () => {
        const { referencedModuleIds } = await import('../moduleRefs')
        const enabled = ['e']
        const extended = referencedModuleIds({ enabledModules: enabled }).concat(['later'])
        expect(extended).toEqual(['e', 'later'])
        expect(enabled).toEqual(['e'])
        const withChat = referencedModuleIds({ enabledModules: enabled, chat: { modules: ['c'] } })
        expect(withChat).toEqual(['e', 'c'])
        expect(enabled).toEqual(['e'])
    })

    test('matchesModuleRef matches id or non-empty namespace', async () => {
        const { matchesModuleRef } = await import('../moduleRefs')
        const refs = new Set(['a', 'ns', ''])
        expect(matchesModuleRef({ id: 'a' }, refs)).toBe(true)
        expect(matchesModuleRef({ id: 'z', namespace: 'ns' }, refs)).toBe(true)
        expect(matchesModuleRef({ id: 'z', namespace: 'nope' }, refs)).toBe(false)
        expect(matchesModuleRef({ id: 'z' }, refs)).toBe(false)
        expect(matchesModuleRef({ id: 'z', namespace: '' }, refs)).toBe(false)
    })
})

describe('module reference rule through getModules', () => {
    const all = [mod('a'), mod('b'), mod('c'), mod('d'), mod('e'), mod('f')]

    test.each([
        ['enabled', { enabled: ['a'] }, ['a']],
        ['chat', { chat: ['b'] }, ['b']],
        ['character', { character: ['c'] }, ['c']],
        ['persona', { persona: 'd' }, ['d']],
        ['integration', { integration: 'e' }, ['e']],
        ['integration with spaces', { integration: ' e , f ' }, ['e', 'f']],
        ['all sources', { enabled: ['a'], chat: ['b'], character: ['c'], persona: 'd', integration: 'e,f' }, ['a', 'b', 'c', 'd', 'e', 'f']],
        ['no sources', {}, []],
    ] as [string, Sources, string[]][])('ids-built-as-before: %s', (_name, sources, expected) => {
        expect(selectedIds(all, sources)).toEqual(expected)
    })

    test('ids-built-as-before: an empty integration segment is a reference to the empty id', () => {
        const withEmptyId = [mod(''), mod('a')]
        expect(selectedIds(withEmptyId, { integration: 'a,' })).toEqual(['', 'a'])
        expect(selectedIds(withEmptyId, { integration: 'a' })).toEqual(['a'])
    })

    test('ids-built-as-before: $embedded reaches the persona module id only', () => {
        const embedded = [mod('$embedded'), mod('a')]
        expect(selectedIds(embedded, { persona: '$embedded' })).toEqual(['$embedded'])
        expect(selectedIds(embedded, { enabled: ['a'] })).toEqual(['a'])
    })

    test('id-or-namespace-match', () => {
        const modules = [mod('m1', 'ns'), mod('m2'), mod('ns')]
        expect(selectedIds(modules, { enabled: ['m2'] })).toEqual(['m2'])
        expect(selectedIds(modules, { enabled: ['m1'] })).toEqual(['m1'])
        expect(selectedIds(modules, { enabled: ['ns'] })).toEqual(['m1', 'ns'])
    })

    test('every-namespace-holder-matches', () => {
        const modules = [mod('m1', 'ns'), mod('m2', 'ns'), mod('m3', 'other')]
        expect(selectedIds(modules, { integration: 'ns' })).toEqual(['m1', 'm2'])
    })

    test('first-duplicate-id-wins', () => {
        const modules = [mod('dup', undefined, 'first'), mod('x', 'ns'), mod('dup', undefined, 'second')]
        const picked = select(modules, { enabled: ['dup', 'ns'] })
        expect(picked.map((m) => m.id)).toEqual(['dup', 'x'])
        expect(picked[0].name).toBe('first')
    })

    test('memo-key-is-the-joined-ids-and-the-list-object', () => {
        const list = [mod('a', undefined, 'old')]
        const first = select(list, { enabled: ['a'], chat: ['b'] })
        expect(first.map((m) => m.name)).toEqual(['old'])
        // Same joined id list and the same list object: the memoised result is returned, not recomputed.
        ctx.db = { modules: list, enabledModules: ['a'], moduleIntergration: '' }
        expect(getModules()).toBe(first)
        // The same ids in a replaced list (a whole-list write) recompute.
        ctx.db = { modules: [mod('a', undefined, 'new')], enabledModules: ['a'], moduleIntergration: '' }
        const replaced = getModules()
        expect(replaced).not.toBe(first)
        expect((replaced as unknown as TestModule[]).map((m) => m.name)).toEqual(['new'])
        // A different joined id list recomputes.
        const shared = [mod('a', undefined, 'new'), mod('a-z', undefined, 'joined')]
        ctx.chat = undefined
        ctx.db = { modules: shared, enabledModules: ['a', 'z'], moduleIntergration: '' }
        expect((getModules() as unknown as TestModule[]).map((m) => m.name)).toEqual(['new'])
        // The key is the ids joined with '-', so with the same list object these two lists collide.
        ctx.db = { modules: shared, enabledModules: ['a-z'], moduleIntergration: '' }
        const collided = getModules() as unknown as TestModule[]
        expect(collided.map((m) => m.name)).toEqual(['new'])
    })

    test('empty-integration-string-selects-nothing', () => {
        expect(selectedIds([mod('')], { integration: '' })).toEqual([])
    })

    test('empty-namespace-not-matched-by-empty-segment', () => {
        const modules = [mod('x', ''), mod('a')]
        expect(selectedIds(modules, { integration: 'a,' })).toEqual(['a'])
    })
})
