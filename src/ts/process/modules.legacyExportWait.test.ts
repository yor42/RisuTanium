/**
 * `exportModuleLegacy` shows the per-asset wait text in the active UI language, read at call
 * time, and the English text keeps its exact shape with the zero-based asset counter.
 *
 * Drives the REAL `src/ts/process/modules.ts`. MOCKED: the alert store (records every wait
 * message) and every module `modules.ts` imports, so nothing is read, compressed, encoded or
 * downloaded. Titles beginning "guard:" pin behaviour that must be preserved before and after
 * the change; titles beginning "regression reproducer:" fail against the version that prints
 * the fixed English text under every language.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
    storeSet: vi.fn(),
    clear: vi.fn(),
    normal: vi.fn(),
    download: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: spies.clear,
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: spies.normal,
    alertStore: { set: spies.storeSet, update: vi.fn(), subscribe: vi.fn() },
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
    AppendableBuffer: class {
        parts: Buffer[] = []
        append(b: Buffer) { this.parts.push(b) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    downloadFile: spies.download,
    forageStorage: {},
    LocalWriter: class {},
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
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { fillLang } from 'src/lang/fill'
import { exportModuleLegacy, type RisuModule } from './modules'

const twoAssetModule = {
    name: 'M', description: '', id: 'm1',
    assets: [['a', 'a.png', 'png'], ['b', 'b.png', 'png']],
} as unknown as RisuModule

async function waitTexts(): Promise<string[]> {
    await exportModuleLegacy(twoAssetModule, { saveData: false, alertEnd: false })
    return spies.storeSet.mock.calls
        .map(([value]) => value as { type: string, msg: string })
        .filter((value) => value.type === 'wait')
        .map((value) => value.msg)
}

beforeEach(() => {
    spies.storeSet.mockReset()
    spies.clear.mockReset()
    spies.normal.mockReset()
    spies.download.mockReset()
    spies.download.mockResolvedValue(true)
})
afterEach(() => changeLanguage('en'))

describe('exportModuleLegacy asset wait text', () => {
    test('guard: English shows the exact English text per asset with a zero-based counter', async () => {
        expect(await waitTexts()).toEqual([
            'Loading... (Adding Assets 0 / 2)',
            'Loading... (Adding Assets 1 / 2)',
        ])
    })

    test('regression reproducer: Korean shows the Korean locale text per asset', async () => {
        changeLanguage('ko')
        expect(languageKorean.alerts.addingAssets).not.toBe(languageEnglish.alerts.addingAssets)
        expect(await waitTexts()).toEqual([
            fillLang(languageKorean.alerts.addingAssets, { completed: 0, total: 2 }),
            fillLang(languageKorean.alerts.addingAssets, { completed: 1, total: 2 }),
        ])
    })
})

describe('exportModuleLegacy save result', () => {
    test('regression reproducer: a cancelled picker clears the wait dialog and shows no success notice', async () => {
        spies.download.mockResolvedValue(false)

        await exportModuleLegacy(twoAssetModule)

        expect(spies.download).toHaveBeenCalledTimes(1)
        const waitCalls = spies.storeSet.mock.invocationCallOrder
        expect(waitCalls.length).toBeGreaterThan(0)
        expect(spies.clear).toHaveBeenCalledTimes(1)
        expect(spies.clear.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...waitCalls))
        expect(spies.normal).not.toHaveBeenCalled()
    })

    test('regression reproducer: a cancelled picker clears the wait dialog even when alertEnd is false', async () => {
        spies.download.mockResolvedValue(false)

        await exportModuleLegacy(twoAssetModule, { alertEnd: false })

        expect(spies.clear).toHaveBeenCalledTimes(1)
        expect(spies.normal).not.toHaveBeenCalled()
    })

    test('guard: a saved export shows the success notice once and does not clear', async () => {
        await exportModuleLegacy(twoAssetModule)

        expect(spies.normal).toHaveBeenCalledTimes(1)
        expect(spies.clear).not.toHaveBeenCalled()
    })
})
