import { describe, expect, test } from 'vitest'
import { firstIndexOf, orderedPages, pageForIndex, settingsLabel } from './settingsPages'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'
import { languageSpanish } from '../../lang/es'
import { languageGerman } from '../../lang/de'
import { languageChinese } from '../../lang/cn'
import { languageJapanese } from '../../lang/ja'
import { languageVietnamese } from '../../lang/vi'
import { languageChineseTraditional } from '../../lang/zh-Hant'

// Every literal index the writers use (Fix route 1, HypaV3 2, modules 14, prompt template 13, Ctrl+S and the
// legacy menu entries), and the page and view each one must show.
const WRITER_INDEXES: Array<[number, string, string]> = [
    [0, 'data', 'data'],
    [1, 'models', 'chatBot'],
    [2, 'features', 'features'],
    [3, 'display', 'display'],
    [4, 'extensions', 'plugins'],
    [6, 'advanced', 'advanced'],
    [10, 'language', 'language'],
    [11, 'input', 'input'],
    [12, 'personas', 'personas'],
    [13, 'models', 'prompt'],
    [14, 'extensions', 'modules'],
    [15, 'shortcuts', 'shortcuts'],
]

describe('Settings index to page mapping', () => {
    test.each(WRITER_INDEXES)('index %i shows page %s, view %s', (index, page, view) => {
        expect(pageForIndex(index)).toEqual({ page, view })
    })

    test.each([-1, 5, 16, 99, NaN, 1.5])('index %s hosts no page', (index) => {
        expect(pageForIndex(index)).toBeNull()
    })

    test('a page opens on its first view and the round trip stays on the same page', () => {
        for (const [index, page] of WRITER_INDEXES) {
            const opened = firstIndexOf(pageForIndex(index)!.page)
            expect(pageForIndex(opened)!.page, `index ${index}`).toBe(page)
        }
        expect(firstIndexOf('models')).toBe(1)
        expect(firstIndexOf('extensions')).toBe(4)
    })

    test('every legacy index is hosted by exactly one view', () => {
        const indexes = orderedPages().flatMap((page) => page.views.map((view) => view.legacyIndex))
        expect(new Set(indexes).size).toBe(indexes.length)
        expect([...indexes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 6, 10, 11, 12, 13, 14, 15])
    })
})

describe('Settings index order', () => {
    test('the ten entries follow the specification order', () => {
        expect(orderedPages().map((page) => page.id)).toEqual([
            'models', 'features', 'display', 'input', 'language',
            'personas', 'extensions', 'data', 'shortcuts', 'advanced',
        ])
    })

    test('every entry has a label key and at least one view, and every label key has text', () => {
        for (const page of orderedPages()) {
            expect(settingsLabel(page.labelKey), page.id).not.toBe(page.labelKey)
            for (const view of page.views) expect(settingsLabel(view.labelKey), view.id).not.toBe(view.labelKey)
            expect(page.labelKey.startsWith('settingsShell'), page.id).toBe(true)
            expect(page.views.length, page.id).toBeGreaterThan(0)
        }
    })

    test.each([
        ['en', languageEnglish],
        ['ko', languageKorean],
        ['es', languageSpanish],
        ['de', languageGerman],
        ['cn', languageChinese],
        ['ja', languageJapanese],
        ['vi', languageVietnamese],
        ['zh-Hant', languageChineseTraditional],
    ] as Array<[string, { settingsShellPageData: string, backupAndFiles: string }]>)(
        'the Data page label reads like the Backup & Files heading in %s', (_locale, strings) => {
            expect(strings.settingsShellPageData).toBe(strings.backupAndFiles)
        })
})
