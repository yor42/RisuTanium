/**
 * `importModule` in `src/ts/process/modules.ts` and `hasModuleStubKey` in `src/ts/storage/moduleStub.ts`: a module file
 * that carries the module stub marker key, whatever its value, is refused with the generic unreadable-file text before
 * any asset is saved, any question is asked or anything is added to the list.
 *
 * The real `modules.ts`, `moduleDuplicates.ts`, `importBatch.ts` and `moduleImportStop.ts` run on synthetic files; the
 * card importer and everything else around them are replaced by recorders, as in `modules.duplicateImport.test.ts`.
 *
 * Labels: R rows fail on the code before the guard (the file is imported); G rows pass before and after; M rows use the
 * new `hasModuleStubKey` and fail at import before the guard.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

type Stored = { id: string, name?: unknown, description?: string, lowLevelAccess?: boolean }

const h = vi.hoisted(() => ({
    log: [] as string[],
    db: { modules: [] as unknown[], enabledModules: [] as string[] },
    files: [] as File[],
    prompts: [] as string[],
    answers: [] as string[],
    /** alert and asset-save events in the order they happened */
    events: [] as string[],
    ids: 0,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' + (++h.ids) }))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(),
        alertConfirm: vi.fn(async (msg: string) => { h.prompts.push(msg); h.events.push('confirm'); return true }),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
        alertSelect: vi.fn(async () => { h.events.push('ask'); return h.answers.shift() ?? '1' }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => h.db),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(),
    saveAsset: vi.fn(async () => { h.events.push('save'); return 'saved-asset' }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => h.files),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
}) as unknown as typeof import('src/ts/bootWindow'))

import { importModule } from 'src/ts/process/modules'
import { MODULE_STUB_KEY, hasModuleStubKey } from 'src/ts/storage/moduleStub'
import { language } from 'src/lang'

const risum = (fileName: string, over: { records?: Uint8Array[], module?: Record<string, unknown> } = {}) =>
    new File([risumBytes({ records: over.records, module: { name: 'Marked', description: 'new', ...over.module } })], fileName)
const json = (fileName: string, value: unknown) => new File([JSON.stringify(value)], fileName)
const list = () => h.db.modules as Stored[]
const refusedText = ['error:' + language.errors.noData]

beforeEach(() => {
    h.log = []
    h.db = { modules: [], enabledModules: [] }
    h.files = []
    h.prompts = []
    h.answers = []
    h.events = []
    h.ids = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a .risum file that carries the stub marker', () => {
    test('R: it is refused with the unreadable-file text and nothing is added', async () => {
        h.files = [risum('marked.risum', { module: { [MODULE_STUB_KEY]: 1 } })]
        await importModule()
        expect(list()).toEqual([])
        expect(h.log).toEqual(refusedText)
    })

    test('R: the refusal saves no asset, asks no question and shows no low-level prompt', async () => {
        h.files = [risum('marked.risum', { records: [patterned(8, 1)], module: { [MODULE_STUB_KEY]: 1, lowLevelAccess: true } })]
        await importModule()
        expect(h.events).toEqual([])
        expect(h.prompts).toEqual([])
        expect(list()).toEqual([])
    })

    test.each([[0], ['yes'], [null], [{}]])('R: the marker with the value %j is refused too', async (value) => {
        h.files = [risum('marked.risum', { module: { [MODULE_STUB_KEY]: value } })]
        await importModule()
        expect(list()).toEqual([])
        expect(h.log).toEqual(refusedText)
    })

    test('G: an ordinary module with assets imports unchanged', async () => {
        h.files = [risum('plain.risum', { records: [patterned(8, 1)], module: { name: 'Plain' } })]
        await importModule()
        expect(list()).toMatchObject([{ name: 'Plain', id: 'uuid1' }])
        expect(h.events).toEqual(['save'])
        expect(h.log).toEqual([])
    })
})

describe('a .json module that carries the stub marker', () => {
    test('R: it is refused with the unreadable-file text, before the low-level prompt, and nothing is added', async () => {
        h.files = [json('marked.json', { type: 'risuModule', name: 'Marked', id: 'x', lowLevelAccess: true, [MODULE_STUB_KEY]: 1 })]
        await importModule()
        expect(list()).toEqual([])
        expect(h.prompts).toEqual([])
        expect(h.log).toEqual(refusedText)
    })

    test.each([[0], ['yes'], [null]])('R: the marker with the value %j is refused too', async (value) => {
        h.files = [json('marked.json', { type: 'risuModule', name: 'Marked', id: 'x', [MODULE_STUB_KEY]: value })]
        await importModule()
        expect(list()).toEqual([])
        expect(h.log).toEqual(refusedText)
    })

    test('R: a module of the same name is not replaced and no duplicate question is asked', async () => {
        h.db.modules = [{ id: 't', name: 'Marked', description: 'old' }]
        h.files = [json('marked.json', { type: 'risuModule', name: 'Marked', id: 'x', description: 'new', [MODULE_STUB_KEY]: 1 })]
        h.answers = ['0']
        await importModule()
        expect(list()).toEqual([{ id: 't', name: 'Marked', description: 'old' }])
        expect(h.events).toEqual([])
        expect(h.log).toEqual(refusedText)
    })

    test('R: a .risum of the same name is not replaced either', async () => {
        h.db.modules = [{ id: 't', name: 'Marked', description: 'old' }]
        h.files = [risum('marked.risum', { module: { [MODULE_STUB_KEY]: 1 } })]
        h.answers = ['0']
        await importModule()
        expect(list()).toEqual([{ id: 't', name: 'Marked', description: 'old' }])
        expect(h.events).toEqual([])
    })

    test('G: an ordinary module imports unchanged', async () => {
        h.files = [json('plain.json', { type: 'risuModule', name: 'Plain', id: 'x', description: 'd' })]
        await importModule()
        expect(list()).toMatchObject([{ name: 'Plain', id: 'uuid1' }])
        expect(h.log).toEqual([])
    })
})

describe('hasModuleStubKey', () => {
    test('M: it is true for an object that holds the key with any value', () => {
        for (const value of [1, 0, 'x', null, undefined, false]) {
            expect(hasModuleStubKey({ [MODULE_STUB_KEY]: value })).toBe(true)
        }
    })

    test('M: it is false for an object without the key, an inherited key, an array and a non-object', () => {
        expect(hasModuleStubKey({ name: 'a' })).toBe(false)
        expect(hasModuleStubKey(Object.create({ [MODULE_STUB_KEY]: 1 }))).toBe(false)
        expect(hasModuleStubKey(Object.assign([], { [MODULE_STUB_KEY]: 1 }))).toBe(false)
        expect(hasModuleStubKey(null)).toBe(false)
        expect(hasModuleStubKey('text')).toBe(false)
        expect(hasModuleStubKey(undefined)).toBe(false)
    })
})
