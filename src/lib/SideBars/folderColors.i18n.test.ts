/**
 * `getFolderColorLabels` returns the folder colour names for the select list in the UI
 * language, read at call time, and `getFolderColorValue` returns the English lower-case
 * colour stored on the folder for the same list position. Label and stored value come from
 * one entry, so the position chosen in the select always maps to its own colour.
 *
 * The language module is switched per test and restored to English afterwards.
 *
 * The helper is a new module, so every test here is a `guard:` of its contract; the
 * render-level reproducer for the labels is in `Sidebar.folderColor.i18n.svelte.test.ts`.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { getFolderColorLabels, getFolderColorValue } from './folderColors'

const STORED = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default']

afterEach(() => {
    changeLanguage('en')
})

describe('folder colour helper', () => {
    test('guard: Korean returns the Korean labels in select order', () => {
        changeLanguage('ko')
        const ko = languageKorean.sidebarUi
        expect(getFolderColorLabels()).toEqual([
            ko.folderColorRed,
            ko.folderColorGreen,
            ko.folderColorBlue,
            ko.folderColorYellow,
            ko.folderColorIndigo,
            ko.folderColorPurple,
            ko.folderColorPink,
            ko.folderColorDefault,
        ])
        expect(getFolderColorLabels()).not.toEqual(STORED)
    })

    test('guard: English returns the English colour names in select order', () => {
        expect(getFolderColorLabels()).toEqual(STORED)
        expect(languageEnglish.sidebarUi.folderColorDefault).toBe('default')
    })

    test('guard: the labels follow the language at call time, not at import time', () => {
        const before = getFolderColorLabels()
        changeLanguage('ko')
        const after = getFolderColorLabels()
        expect(before).toEqual(STORED)
        expect(after).not.toEqual(before)
    })

    test('guard: the stored value for each index is the English lower-case colour in every language', () => {
        for (const code of ['en', 'ko'] as const) {
            changeLanguage(code)
            expect(STORED.map((_, i) => getFolderColorValue(i))).toEqual(STORED)
        }
    })

    test('guard: an index outside the list has no stored value', () => {
        for (const index of [-1, 8, 100, Number.NaN]) {
            expect(getFolderColorValue(index)).toBeUndefined()
        }
    })

    test('guard: no label contains the "||" separator that the select list joins its entries with', () => {
        for (const code of ['en', 'ko', 'cn', 'zh-Hant', 'vi', 'de', 'es']) {
            changeLanguage(code)
            for (const label of getFolderColorLabels()) {
                expect(label).not.toContain('||')
                expect(label.length).toBeGreaterThan(0)
            }
            expect(getFolderColorLabels()).toHaveLength(8)
        }
    })
})
