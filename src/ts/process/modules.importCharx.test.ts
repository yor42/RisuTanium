/**
 * `importModule` in `src/ts/process/modules.ts` for a `.charx` file: which message the user is left with when
 * `importCharacterProcess` returns without a character.
 *
 * The real `modules.ts` runs; the character import and everything else it reaches are replaced by recorders.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    log: [] as string[],
    modules: [] as unknown[],
    imported: undefined as unknown,
    importer: null as null | ((arg: { name: string, data: Uint8Array, returnCharacter?: boolean }) => Promise<unknown>),
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn((msg: string) => { h.log.push('error:' + msg) }),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ modules: h.modules })),
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
    saveAsset: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectSingleFile: vi.fn(async () => ({ name: 'card.charx', data: new Uint8Array([1, 2, 3]) })),
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
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(() => ({ id: 'converted-module' })),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(async (arg: { name: string, data: Uint8Array, returnCharacter?: boolean }) => h.importer?.(arg)),
}) as unknown as typeof import('src/ts/characterCards'))

import { importModule } from 'src/ts/process/modules'
import { language } from 'src/lang'

beforeEach(() => {
    h.log = []
    h.modules = []
    h.importer = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('importModule with a .charx file', () => {
    test('a refusal that importCharacterProcess already reported is not followed by another message', async () => {
        h.importer = async () => {
            h.log.push('error:' + language.cardFileIncomplete)
            return null
        }
        await importModule()
        expect(h.log).toEqual(['error:' + language.cardFileIncomplete])
        expect(h.modules).toEqual([])
    })

    test('a size refusal that importCharacterProcess already reported is not followed by noData or a success message (compatibility guard)', async () => {
        h.importer = async () => {
            h.log.push('error:' + language.cardFileEntryTooLarge('assets/big.bin', 200))
            return undefined
        }
        await importModule()
        expect(h.log).toEqual(['error:' + language.cardFileEntryTooLarge('assets/big.bin', 200)])
        expect(h.modules).toEqual([])
    })

    test('a declined low-level-access prompt, which shows no message of its own, still shows noData (compatibility guard)', async () => {
        h.importer = async () => false
        await importModule()
        expect(h.log).toEqual(['error:' + language.errors.noData])
        expect(h.modules).toEqual([])
    })

    test('a returned character becomes a module and reports success (compatibility guard)', async () => {
        h.importer = async (arg) => {
            expect(arg.returnCharacter).toBe(true)
            return { name: 'Synthetic' }
        }
        await importModule()
        expect(h.modules).toEqual([{ id: 'converted-module' }])
        expect(h.log).toEqual(['normal:' + language.successImport])
    })
})
