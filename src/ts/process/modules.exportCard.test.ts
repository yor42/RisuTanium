/**
 * `exportModule` reports success only after a completed export, and stays silent when the person cancels the save dialog.
 *
 * Drives the REAL `writeModuleCard` in `src/ts/process/modules.ts`. MOCKED: the alert module (records every alert),
 * the `LocalWriter` (its `init` returns `false` on a cancelled Tauri save dialog, as the real one does) and
 * `exportCharacterCard` (resolves `false` after it has shown its own error, as the real one does). Titles beginning
 * "guard:" pass before and after the change; titles beginning "regression reproducer:" fail against a version that
 * ignores the export result or the dialog result.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
    init: vi.fn(async (_name: string, _ext: string[]) => true),
    exportCard: vi.fn(async (..._args: unknown[]) => true),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: spies.alertError,
    alertModuleSelect: vi.fn(),
    alertNormal: spies.alertNormal,
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({})),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class { },
    downloadFile: vi.fn(async () => {}),
    forageStorage: {},
    LocalWriter: class {
        init(name: string, ext: string[]) { return spies.init(name, ext) }
    },
    readImage: vi.fn(async () => new Uint8Array([1])),
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
    compressImage: vi.fn(async (b: Uint8Array) => b),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(),
    encodeRPack: vi.fn(async (b: Buffer) => b),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(() => ({ name: 'M', image: 'img' })),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: spies.exportCard,
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { language } from 'src/lang'
import { exportModule, type RisuModule } from './modules'

const module = { name: 'M', description: '', id: 'm1' } as unknown as RisuModule

beforeEach(() => {
    vi.clearAllMocks()
    spies.init.mockImplementation(async () => true)
    spies.exportCard.mockImplementation(async () => true)
})

describe('exportModule result handling', () => {
    test('guard: a completed export shows the success message', async () => {
        await exportModule(module)
        expect(spies.exportCard).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith(language.successExport)
    })

    test('guard: alertEnd false keeps a completed export silent', async () => {
        await exportModule(module, { alertEnd: false })
        expect(spies.exportCard).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('regression reproducer: a failed export shows no success message over its error', async () => {
        spies.exportCard.mockImplementation(async () => false)
        await exportModule(module)
        expect(spies.exportCard).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('regression reproducer: a cancelled save dialog exports nothing and shows no alert', async () => {
        spies.init.mockImplementation(async () => false)
        await exportModule(module)
        expect(spies.exportCard).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()
    })
})
