/**
 * The shell Display data: every legacy Display id is placed once, left out as dead, or not offered; every key the
 * rows name exists in English; the inverse and fallback overrides read and write the stored meaning exactly; and the
 * sidebar picker's list (`getFullSettingsData`) is unchanged.
 *
 * MOCKED: the application modules the data files import for their click handlers, as in `settingLabelKeys.test.ts`.
 * The real `src/lang` is used, so the step names come from the English module.
 */
import { describe, expect, test, vi } from 'vitest'
import type { SettingItem } from 'src/ts/setting/types'
import type { Database } from 'src/ts/storage/database.svelte'

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
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import { basicParameterItems, modelSpecificParameterItems, penaltyParameterItems, samplingParameterItems, seedSetting } from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import {
    DISPLAY_NOT_OFFERED_IDS,
    DISPLAY_SHELL_SECTIONS,
    displaySectionOfRow,
    displayShellItems,
    displayShellRowIds,
    quoteBoxItems,
    unplacedLegacyDisplayIds,
    type DisplayRowSpec,
} from './displayShellSettingsData'
import { getFullSettingsData } from './utils'
import { CURLY_QUOTES, DEAD_DISPLAY_IDS, storedAnimationOf } from '../settingsShell/displayPresentation'

const english = languageEnglish as unknown as Record<string, unknown>

function item(id: string): SettingItem {
    const found = displayShellItems.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`no shell item ${id}`)
    return found
}

function rowIdsOf(sectionId: string): string[] {
    const section = DISPLAY_SHELL_SECTIONS.find((candidate) => candidate.id === sectionId)!
    return section.rows.map((row) => (row.kind === 'setting' ? row.item.id : row.id))
}

function asDb(fields: Partial<Record<keyof Database, unknown>>): Database {
    return fields as unknown as Database
}

describe('sections', () => {
    test('five open sections in order, then a collapsed Advanced', () => {
        expect(DISPLAY_SHELL_SECTIONS.map((section) => section.id)).toEqual([
            'display.themeColor',
            'display.fontSize',
            'display.chat',
            'display.sound',
            'display.motion',
            'display.advanced',
        ])
        expect(DISPLAY_SHELL_SECTIONS.map((section) => section.collapsed)).toEqual([false, false, false, false, false, true])
    })

    test('Advanced holds custom CSS, the sticker, full screen and the rows that keep a home there until their batch', () => {
        expect(rowIdsOf('display.advanced')).toEqual([
            'display.customCSS',
            'display.useChatSticker',
            'display.fullScreen',
            'display.hideApiKey',
            'display.useLegacyGUI',
            'display.menuSideBar',
            'display.showPromptComparison',
            'display.useAdditionalAssetsPreview',
        ])
    })
})

describe('placement of the legacy Display ids (T-B5)', () => {
    test('every legacy id is placed, dead or not offered', () => {
        expect(unplacedLegacyDisplayIds()).toEqual([])
    })

    test('a row id is placed once', () => {
        const ids = displayShellRowIds()
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('dead fields and the custom theme button are not on the page', () => {
        const ids = new Set(displayShellRowIds())
        for (const dead of DEAD_DISPLAY_IDS) expect(ids.has(dead)).toBe(false)
        for (const hidden of DISPLAY_NOT_OFFERED_IDS) expect(ids.has(hidden)).toBe(false)
        expect(DEAD_DISPLAY_IDS.has('display.showMemoryLimit')).toBe(true)
        expect(DEAD_DISPLAY_IDS.has('display.memoryLimitThickness')).toBe(true)
    })

    test('the page only names ids the legacy list has', () => {
        const legacy = new Set(displaySettingsItems.map((candidate) => candidate.id))
        expect(displayShellRowIds().filter((id) => !legacy.has(id) && id !== 'display.quoteBoxes')).toEqual([])
    })

    test('a quote box belongs to the chat section, an unknown row to none', () => {
        expect(displaySectionOfRow('display.leadingDoubleQuote')).toBe('display.chat')
        expect(displaySectionOfRow('display.customCSS')).toBe('display.advanced')
        expect(displaySectionOfRow('display.nothing')).toBeNull()
    })

    test('the sidebar picker list is the union of its nine lists and gains nothing from the shell page', () => {
        const nine = [
            ...accessibilitySettingsItems,
            ...advancedSettingsItems,
            ...basicParameterItems,
            seedSetting,
            ...samplingParameterItems,
            ...penaltyParameterItems,
            ...modelSpecificParameterItems,
            ...chatFormatSettingsItems,
            ...displaySettingsItems,
        ]
        expect(getFullSettingsData().map((candidate) => candidate.id)).toEqual(nine.map((candidate) => candidate.id))
    })
})

describe('keys the rows name', () => {
    function rowKeys(row: DisplayRowSpec): string[] {
        if (row.kind !== 'setting') return []
        return [
            row.dim?.reasonKey,
            row.dim?.jump?.labelKey,
            row.phoneNoteKey,
            row.ends?.startKey,
            row.ends?.endKey,
            row.hintKey,
        ].filter((key): key is string => key !== undefined)
    }

    test('every section label, row label and note names a non-empty English string', () => {
        const keys = [
            ...DISPLAY_SHELL_SECTIONS.map((section) => section.labelKey),
            ...DISPLAY_SHELL_SECTIONS.flatMap((section) => section.rows.flatMap(rowKeys)),
            ...displayShellItems.flatMap((candidate) => (candidate.labelKey === undefined ? [] : [candidate.labelKey])),
        ]
        const bad = keys.filter((key) => typeof english[key] !== 'string' || english[key] === '')
        expect(bad).toEqual([])
        expect(keys.length).toBeGreaterThan(30)
    })

    test('every help key a row names exists in the English help table', () => {
        const help = languageEnglish.help as unknown as Record<string, unknown>
        const missing = displayShellItems
            .flatMap((candidate) => (candidate.helpKey === undefined ? [] : [candidate.helpKey]))
            .filter((key) => typeof help[key] !== 'string')
        expect(missing).toEqual([])
    })

    test('the font name row has a label and a help line', () => {
        const font = item('display.customFont')
        expect(font.labelKey).toBe('settingsShellFontName')
        expect(font.helpKey).toBe('customFont')
    })

    test('the theme, step and scheme tables cover every theme, step and preset', () => {
        expect(Object.keys(languageEnglish.settingsShellThemeNames)).toEqual(['standard', 'waifu', 'mobilechat', 'cardboard', 'customHTML'])
        expect(Object.keys(languageEnglish.settingsShellThemeDescs)).toEqual(Object.keys(languageEnglish.settingsShellThemeNames))
        expect(Object.keys(languageEnglish.settingsShellStepNames)).toHaveLength(11)
    })
})

describe('inverse quote styling (I2)', () => {
    test('shows the positive reading of the stored inverse and writes the inverse back', () => {
        const row = item('display.unformatQuotes')
        const db = asDb({ unformatQuotes: false })
        expect(row.getValue!(db)).toBe(true)
        row.setValue!(db, false)
        expect(db.unformatQuotes).toBe(true)
        expect(row.getValue!(db)).toBe(false)
        row.setValue!(db, true)
        expect(db.unformatQuotes).toBe(false)
    })
})

describe('inverse animation speed (I2)', () => {
    test('every 0.05 step round-trips to the exact stored duration', () => {
        const row = item('display.animationSpeed')
        for (let step = 0; step <= 20; step++) {
            const position = step / 20
            const db = asDb({ animationSpeed: 0.4 })
            row.setValue!(db, position)
            expect(db.animationSpeed).toBe(storedAnimationOf(position))
            expect(row.getValue!(db)).toBe(Math.round(position * 100) / 100)
        }
    })

    test('0.6 on the slider is a 0.4 s duration and the fast end is instant', () => {
        const row = item('display.animationSpeed')
        const db = asDb({ animationSpeed: 0.4 })
        row.setValue!(db, 0.6)
        expect(db.animationSpeed).toBe(0.4)
        row.setValue!(db, 1)
        expect(db.animationSpeed).toBe(0)
        const text = row.options!.customText as (value: number) => string
        expect(text(1)).toBe(languageEnglish.settingsShellAnimationInstant)
        expect(text(0.6)).toBe(languageEnglish.settingsShellAnimationSeconds(0.4))
    })

    test('keeps the legacy update hook', () => {
        expect(item('display.animationSpeed').onChange).toBeTypeOf('function')
    })
})

describe('quote boxes', () => {
    test('read the stored curly default while the stored set is missing', () => {
        const db = asDb({})
        expect(quoteBoxItems.map((box) => box.getValue!(db))).toEqual([...CURLY_QUOTES])
    })

    test('the first edit materialises the curly default, not straight quotes', () => {
        const db = asDb({})
        quoteBoxItems[1].setValue!(db, '>>')
        expect(db.customQuotesData).toEqual([CURLY_QUOTES[0], '>>', CURLY_QUOTES[2], CURLY_QUOTES[3]])
    })

    test('an empty box stays empty', () => {
        const db = asDb({ customQuotesData: ['a', 'b', 'c', 'd'] })
        quoteBoxItems[0].setValue!(db, '')
        expect(quoteBoxItems[0].getValue!(db)).toBe('')
    })

    test('the boxes show only while custom quotes is on', () => {
        const on = { db: asDb({ customQuotes: true }) }
        const off = { db: asDb({ customQuotes: false }) }
        for (const box of quoteBoxItems) {
            expect(box.condition!(on as never)).toBe(true)
            expect(box.condition!(off as never)).toBe(false)
        }
    })
})

describe('step names', () => {
    test('the named-step sliders show English names from the language module', () => {
        for (const id of ['display.textAreaSize', 'display.textAreaTextSize', 'display.sideBarSize']) {
            const text = item(id).options!.customText as (value: number) => string
            expect(text(0)).toBe(languageEnglish.settingsShellStepNames.default)
            expect(text(2)).toBe(languageEnglish.settingsShellStepNames.bigger)
            expect(text(99)).toBe(languageEnglish.settingsShellStepNames.default)
        }
        const area = item('display.textAreaSize').options!.customText as (value: number) => string
        expect(area(-5)).toBe(languageEnglish.settingsShellStepNames.tiniest)
        expect(area(5)).toBe(languageEnglish.settingsShellStepNames.hugest)
    })
})
