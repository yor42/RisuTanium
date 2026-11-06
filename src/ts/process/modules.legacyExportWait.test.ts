/**
 * `exportModuleLegacy` shows the per-asset wait text in the active UI language, read at call
 * time, and the English text keeps its exact shape with the zero-based asset counter. A file export
 * opens its save dialog before any asset is read, leaves no wait dialog behind when the dialog is
 * dismissed or the export ends without a notice, and posts the success notice only after the file
 * was closed.
 *
 * Drives the REAL `src/ts/process/modules.ts`. MOCKED: the alert module over a small working alert
 * store (records every wait message and keeps the dialog on screen), the writer (`LocalWriter`
 * records `init`, `write` and `close`) and every module `modules.ts` imports, so nothing is read,
 * compressed, encoded or written. Titles beginning "guard:" pin behaviour that must be preserved
 * before and after the change; titles beginning "regression reproducer:" fail against the version
 * that prints the fixed English text under every language or reads every asset before the dialog.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ScreenAlert = { type: string, msg: string, onCancel?: () => void }

const spies = vi.hoisted(() => {
    // A store that works like the real one for `get`, `set` and `subscribe`, so a dialog left on screen is visible.
    const storeSet = vi.fn()
    let current: ScreenAlert = { type: 'none', msg: '' }
    const subscribers = new Set<(value: ScreenAlert) => void>()
    const alertStore = {
        set: (value: ScreenAlert) => {
            storeSet(value)
            current = value
            subscribers.forEach((run) => run(value))
        },
        update: vi.fn(),
        subscribe: (run: (value: ScreenAlert) => void) => {
            run(current)
            subscribers.add(run)
            return () => { subscribers.delete(run) }
        },
    }
    return {
        storeSet,
        alertStore,
        screen: () => current,
        clear: vi.fn(),
        normal: vi.fn(),
        init: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
        offersCancel: vi.fn(),
        readImage: vi.fn(),
    }
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: () => {
        spies.clear()
        spies.alertStore.set({ type: 'none', msg: '' })
    },
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: (msg: string) => {
        spies.normal(msg)
        spies.alertStore.set({ type: 'normal', msg })
    },
    alertStore: spies.alertStore,
    alertWait: (msg: string, onCancel?: () => void) => {
        const dialog: ScreenAlert = { type: 'wait', msg, onCancel }
        spies.alertStore.set(dialog)
        return dialog
    },
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
    downloadFile: vi.fn(),
    forageStorage: {},
    LocalWriter: class {
        writer = undefined
        init = spies.init
        write = spies.write
        close = spies.close
        abort = spies.abort
        useCancel = vi.fn()
    },
    readImage: spies.readImage,
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
    alertStore: spies.alertStore,
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    exportOffersCancel: spies.offersCancel,
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
    spies.alertStore.set({ type: 'none', msg: '' })
    spies.storeSet.mockClear()
    spies.init.mockReset()
    spies.init.mockResolvedValue(true)
    spies.write.mockReset()
    spies.write.mockResolvedValue(undefined)
    spies.close.mockReset()
    spies.close.mockResolvedValue(undefined)
    spies.abort.mockReset()
    spies.offersCancel.mockReset()
    spies.offersCancel.mockReturnValue(false)
    spies.readImage.mockReset()
    spies.readImage.mockResolvedValue(new Uint8Array([1]))
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

    test('guard: bytes for the CharX embed are returned without a writer, a Cancel or a busy entry', async () => {
        const bytes = await exportModuleLegacy(twoAssetModule, { saveData: false, alertEnd: false })

        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes?.[bytes.length - 1]).toBe(0)
        expect(spies.init).not.toHaveBeenCalled()
        expect(spies.write).not.toHaveBeenCalled()
        expect(spies.offersCancel).not.toHaveBeenCalled()
    })
})

describe('exportModuleLegacy save result', () => {
    test('regression reproducer: a dismissed save dialog reads no asset, shows no notice and leaves no wait dialog', async () => {
        spies.offersCancel.mockReturnValue(true)
        spies.init.mockResolvedValue(false)

        const result = await exportModuleLegacy(twoAssetModule)

        expect(spies.readImage).not.toHaveBeenCalled()
        expect(spies.init).toHaveBeenCalledTimes(1)
        expect(result).toBeNull()
        expect(spies.normal).not.toHaveBeenCalled()
        expect(spies.write).not.toHaveBeenCalled()
        expect(spies.screen().type).toBe('none')
    })

    test('regression reproducer: a dismissed save dialog without a Cancel reads no asset and shows no notice', async () => {
        spies.init.mockResolvedValue(false)

        await exportModuleLegacy(twoAssetModule, { alertEnd: false })

        expect(spies.readImage).not.toHaveBeenCalled()
        expect(spies.normal).not.toHaveBeenCalled()
        expect(spies.screen().type).toBe('none')
    })

    test('regression reproducer: the dialog is asked for the module name with the risum extension, before any read', async () => {
        await exportModuleLegacy(twoAssetModule)

        expect(spies.init).toHaveBeenCalledWith('RisuM File', ['risum'], 'M.risum', undefined)
        expect(spies.init.mock.invocationCallOrder[0]).toBeLessThan(spies.readImage.mock.invocationCallOrder[0])
    })

    test('regression reproducer: a saved export shows the success notice once, after the file was closed', async () => {
        await exportModuleLegacy(twoAssetModule)

        expect(spies.normal).toHaveBeenCalledTimes(1)
        expect(spies.clear).not.toHaveBeenCalled()
        expect(spies.close).toHaveBeenCalledTimes(1)
        expect(spies.close.mock.invocationCallOrder[0]).toBeLessThan(spies.normal.mock.invocationCallOrder[0])
    })

    test('regression reproducer: with a Cancel offered and no success notice, the wait dialog is gone after the export', async () => {
        spies.offersCancel.mockReturnValue(true)

        await exportModuleLegacy(twoAssetModule, { alertEnd: false })

        expect(spies.normal).not.toHaveBeenCalled()
        expect(spies.close).toHaveBeenCalledTimes(1)
        expect(spies.storeSet.mock.calls.some(([value]) => (value as ScreenAlert).type === 'wait' && (value as ScreenAlert).onCancel !== undefined)).toBe(true)
        expect(spies.screen().type).not.toBe('wait')
    })

    test('regression reproducer: the Cancel rule is asked once with the risum type and the asset count, and a module without assets still finishes', async () => {
        const noAssets = { name: 'N', description: '', id: 'n1', assets: [] } as unknown as RisuModule
        const result = await exportModuleLegacy(noAssets, { alertEnd: false })

        expect(result).toBeNull()
        expect(spies.offersCancel).toHaveBeenCalledTimes(1)
        expect(spies.offersCancel.mock.calls[0][0]).toMatchObject({ type: 'risum', assetCount: 0, writer: undefined, tauri: expect.any(Boolean) })
        expect(spies.readImage).not.toHaveBeenCalled()
        expect(spies.close).toHaveBeenCalledTimes(1)
    })
})
