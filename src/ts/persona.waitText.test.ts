/**
 * `exportUserPersona` shows its two wait texts in the active UI language, read at call time,
 * and the English texts are exactly the two it has always shown, in the order of the steps.
 *
 * Drives the REAL `src/ts/persona.ts`. MOCKED: the alert store (records every wait message),
 * the database, the image and PNG modules and the download, so nothing is written.
 * Titles beginning "guard:" pin behaviour that must be preserved before and after the
 * change; titles beginning "regression reproducer:" fail against the version that prints
 * the fixed English texts under every language.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({ storeSet: vi.fn() }))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: spies.storeSet, update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({ username: 'Ann', personaPrompt: 'prompt', userIcon: 'icon', userNote: '' }),
    saveImage: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(async () => {}),
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

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { exportUserPersona } from './persona'

async function waitTexts(): Promise<string[]> {
    await exportUserPersona()
    return spies.storeSet.mock.calls
        .map(([value]) => value as { type: string, msg: string })
        .filter((value) => value.type === 'wait')
        .map((value) => value.msg)
}

beforeEach(() => spies.storeSet.mockReset())
afterEach(() => changeLanguage('en'))

describe('exportUserPersona wait texts', () => {
    test('guard: English shows the two exact English wait texts in step order', async () => {
        expect(await waitTexts()).toEqual(['Loading... (Writing Exif)', 'Loading... (Writing)'])
    })

    test('regression reproducer: Korean shows the two Korean locale values in step order', async () => {
        changeLanguage('ko')
        expect(languageKorean.alerts.writingExif).not.toBe(languageEnglish.alerts.writingExif)
        expect(languageKorean.alerts.writingPng).not.toBe(languageEnglish.alerts.writingPng)
        expect(await waitTexts()).toEqual([languageKorean.alerts.writingExif, languageKorean.alerts.writingPng])
    })
})
