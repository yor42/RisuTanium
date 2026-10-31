/**
 * `moduleUpdate` publishes the embedding of exactly the current chat's modules: a chat without an embedding module
 * clears the embedding the previous chat left in `moduleBackgroundEmbedding`.
 *
 * Drives the REAL `src/ts/process/modules.ts` with real `writable` stores. MOCKED: the database accessors and every
 * module `modules.ts` imports, so nothing is read or written. R = regression reproducer (the base keeps the previous
 * embedding), G = guard (passes before and after).
 */
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { modules: [] as unknown[], enabledModules: [] as string[], moduleIntergration: '' },
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => ({ type: 'character', modules: [] as string[] })),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => h.db),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    LocalWriter: class {},
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    VirtualWriter: class {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(),
    encodeRPack: vi.fn(),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    get DBState() { return { db: h.db } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: writable(''),
    ReloadGUIPointer: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { moduleBackgroundEmbedding } from 'src/ts/stores.svelte'
import { moduleUpdate, refreshModules } from '../modules'

const withEmbedding = { id: 'E', name: 'E', description: '', backgroundEmbedding: '<style>.a{}</style>' }
const plain = { id: 'P', name: 'P', description: '' }

beforeEach(() => {
    h.db.modules = [withEmbedding, plain]
    h.db.enabledModules = []
    refreshModules()
    moduleBackgroundEmbedding.set('')
})

describe('moduleUpdate embedding', () => {
    test('G: a chat with an embedding module publishes it', () => {
        h.db.enabledModules = ['E']
        moduleUpdate()
        expect(get(moduleBackgroundEmbedding)).toBe('\n<style>.a{}</style>\n')
    })

    test('R T12: a chat without an embedding module clears the previous chat\'s embedding', () => {
        h.db.enabledModules = ['E']
        moduleUpdate()
        expect(get(moduleBackgroundEmbedding)).not.toBe('')

        h.db.enabledModules = ['P']
        moduleUpdate()
        expect(get(moduleBackgroundEmbedding)).toBe('')
    })

    test('R T12b: a chat with no modules at all clears the embedding', () => {
        h.db.enabledModules = ['E']
        moduleUpdate()
        h.db.enabledModules = []
        moduleUpdate()
        expect(get(moduleBackgroundEmbedding)).toBe('')
    })
})
