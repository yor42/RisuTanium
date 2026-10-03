/**
 * `exportUserPersona` shows its "incomplete persona" error in the active UI language, read at
 * call time. The language module is switched per test and restored to English afterwards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({ alertError: vi.fn() }))

vi.mock(import('src/ts/alert'), () => ({
    alertError: spies.alertError,
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({ username: '', personaPrompt: '' }),
    saveImage: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { exportUserPersona } from './persona'

beforeEach(() => spies.alertError.mockReset())
afterEach(() => changeLanguage('en'))

describe('exportUserPersona: incomplete persona error', () => {
    test('guard: English shows the exact English text', async () => {
        await exportUserPersona()
        expect(spies.alertError).toHaveBeenCalledWith('username or persona prompt is empty')
        expect(languageEnglish.errors.personaIncomplete).toBe('username or persona prompt is empty')
    })

    test('regression reproducer: Korean shows the Korean locale value', async () => {
        changeLanguage('ko')
        await exportUserPersona()
        expect(spies.alertError).toHaveBeenCalledWith(languageKorean.errors.personaIncomplete)
        expect(languageKorean.errors.personaIncomplete).not.toBe(languageEnglish.errors.personaIncomplete)
    })
})
