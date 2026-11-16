/**
 * `exportUserPersona` exports a persona with an empty name or description and shows the "empty
 * fields are left out" warning in the active UI language, read at call time. The language module
 * is switched per test and restored to English afterwards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
    alertError: vi.fn(),
    postToast: vi.fn(),
    download: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: spies.alertError,
    alertNormal: vi.fn(),
    alertClear: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: spies.postToast,
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({ username: 'Ann', personaPrompt: '', userIcon: 'icon', userNote: '' }),
    saveImage: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: spies.download,
    readImage: vi.fn(async () => new Uint8Array([1])),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (img: Uint8Array) => img),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: { write: vi.fn(async () => new Uint8Array([2])), readGenerator: vi.fn() },
}) as unknown as typeof import('src/ts/pngChunk'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { exportUserPersona } from './persona'

beforeEach(() => {
    spies.alertError.mockReset()
    spies.postToast.mockReset()
    spies.download.mockReset()
    spies.download.mockResolvedValue(true)
})
afterEach(() => changeLanguage('en'))

describe('exportUserPersona: empty description', () => {
    test('regression reproducer: English exports and shows the exact English warning', async () => {
        await exportUserPersona()

        expect(spies.download).toHaveBeenCalledTimes(1)
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.postToast).toHaveBeenCalledWith({
            kind: 'warning',
            text: 'The name or description is empty · empty fields are left out',
        })
        expect(languageEnglish.settingsShellPersonaExportEmpty).toBe('The name or description is empty · empty fields are left out')
    })

    test('regression reproducer: Korean exports and shows the warning read from the active language', async () => {
        changeLanguage('ko')

        await exportUserPersona()

        expect(spies.download).toHaveBeenCalledTimes(1)
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.postToast).toHaveBeenCalledTimes(1)
        expect(spies.postToast).toHaveBeenCalledWith({
            kind: 'warning',
            text: language.settingsShellPersonaExportEmpty,
        })
    })
})
