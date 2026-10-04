/**
 * `importColorScheme` shows its "invalid color scheme" error in the active UI language, read
 * at call time. The language module is switched per test and restored to English afterwards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
    alertError: vi.fn(),
    selectSingleFile: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: spies.alertError,
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: spies.selectSingleFile,
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { importColorScheme } from './colorscheme'

const file = (text: string) => ({ name: 'scheme.json', data: new TextEncoder().encode(text) })

beforeEach(() => spies.alertError.mockReset())
afterEach(() => changeLanguage('en'))

describe('importColorScheme: invalid color scheme error', () => {
    test.each([
        ['unparseable JSON', 'not json'],
        ['JSON missing required fields', '{}'],
    ])('guard: English shows the exact English text for %s', async (_label, text) => {
        spies.selectSingleFile.mockResolvedValueOnce(file(text))
        await importColorScheme()
        expect(spies.alertError).toHaveBeenCalledWith('Invalid color scheme')
        expect(languageEnglish.errors.invalidColorScheme).toBe('Invalid color scheme')
    })

    test.each([
        ['unparseable JSON', 'not json'],
        ['JSON missing required fields', '{}'],
    ])('regression reproducer: Korean shows the Korean locale value for %s', async (_label, text) => {
        changeLanguage('ko')
        spies.selectSingleFile.mockResolvedValueOnce(file(text))
        await importColorScheme()
        expect(spies.alertError).toHaveBeenCalledWith(languageKorean.errors.invalidColorScheme)
        expect(languageKorean.errors.invalidColorScheme).not.toBe(languageEnglish.errors.invalidColorScheme)
    })
})
