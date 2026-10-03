/**
 * Every `labelKey` in the settings registry files (`src/ts/setting/*Data*`) is read flat as
 * `language[labelKey]`, so it must name an existing top-level key of the English language
 * object. A mistyped key is a plain string to the type system and would render the English
 * fallback (or nothing) in every locale.
 *
 * MOCKED: the application modules the data files import for their click handlers
 * (`util`, `gui/*`, `alert`, `globalApi.svelte`, `translator/translator`, `stores.svelte`,
 * `platform`). Only the registry data is inspected, never those handlers.
 */
import { describe, expect, test, vi } from 'vitest'
import type { SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    sleep: vi.fn(),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/guisize'), () => ({
    guiSizeText: vi.fn(),
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    CustomGUISettingMenuStore: { set: vi.fn() },
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

import { languageEnglish } from 'src/lang/en'

const modules = import.meta.glob(['./*Data*.ts', '!./*.test.ts'], { eager: true }) as Record<string, Record<string, unknown>>

function isItem(value: unknown): value is SettingItem {
    return typeof value === 'object' && value !== null && 'id' in value && 'type' in value
}

interface Found { where: string, labelKey: string }

function collect(item: SettingItem, file: string, found: Found[]): void {
    const at = `${file} ${item.id}`
    if (item.labelKey !== undefined) found.push({ where: at, labelKey: item.labelKey })
    for (const opt of item.options?.selectOptions ?? []) {
        if (opt.labelKey !== undefined) found.push({ where: `${at} select ${opt.value}`, labelKey: opt.labelKey })
    }
    for (const opt of item.options?.segmentOptions ?? []) {
        if (opt.labelKey !== undefined) found.push({ where: `${at} segment ${String(opt.value)}`, labelKey: opt.labelKey })
    }
    for (const child of item.options?.children ?? []) collect(child, file, found)
}

function allKeys(): Found[] {
    const found: Found[] = []
    for (const [file, mod] of Object.entries(modules)) {
        for (const exported of Object.values(mod)) {
            if (Array.isArray(exported)) {
                for (const item of exported) if (isItem(item)) collect(item, file, found)
            } else if (isItem(exported)) {
                collect(exported, file, found)
            }
        }
    }
    return found
}

describe('settings registry labelKeys', () => {
    test('guard: every registry data file loads and the walk finds registry keys', () => {
        const files = Object.keys(modules).map((f) => f.replace('./', ''))
        for (const expected of [
            'accessibilitySettingsData.ts',
            'advancedSettingsData.ts',
            'botSettingsParamsData.ts',
            'chatFormatSettingsData.ts',
            'displaySettingsData.svelte.ts',
            'languageSettingsData.svelte.ts',
        ]) {
            expect(files).toContain(expected)
        }
        expect(allKeys().length).toBeGreaterThan(100)
    })

    test('guard: every labelKey names an existing top-level English language key', () => {
        const english = languageEnglish as unknown as Record<string, unknown>
        const missing = allKeys().filter((k) => !(k.labelKey in english))
        expect(missing).toEqual([])
    })

    test('guard: every labelKey resolves to a non-empty English string', () => {
        const english = languageEnglish as unknown as Record<string, unknown>
        const notStrings = allKeys().filter((k) => typeof english[k.labelKey] !== 'string' || english[k.labelKey] === '')
        expect(notStrings).toEqual([])
    })
})
