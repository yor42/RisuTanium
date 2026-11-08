// The English retention copy must state the purge age the code enforces and
// the downgrade caveat: other versions may purge a trashed character sooner.
// The two confirm texts are functions, so they are called, never stringified.
import { describe, expect, it } from 'vitest'
import { language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { languageChinese } from 'src/lang/cn'
import { languageChineseTraditional } from 'src/lang/zh-Hant'
import { languageVietnamese } from 'src/lang/vi'
import { languageGerman } from 'src/lang/de'
import { languageSpanish } from 'src/lang/es'
import { languageJapanese } from 'src/lang/ja'
import { TRASH_PURGE_AGE_MS } from '../trashPurge'

const DAY_MS = 86_400_000
const RETENTION = `${TRASH_PURGE_AGE_MS / DAY_MS} days`

const surfaces: Array<[string, () => string]> = [
    ['trashDesc', () => language.trashDesc],
    ['deleteFolderTrashConfirm (one)', () => language.deleteFolderTrashConfirm('F', 1)],
    ['deleteFolderTrashConfirm (many)', () => language.deleteFolderTrashConfirm('F', 2)],
    ['othersUi.editTrashConfirm (one)', () => language.othersUi.editTrashConfirm(1)],
    ['othersUi.editTrashConfirm (many)', () => language.othersUi.editTrashConfirm(2)],
]

describe('Trash retention copy (en)', () => {
    it.each(surfaces)('%s says 30 days and the other-versions caveat', (_name, read) => {
        const text = read()
        expect(text).toContain('30 days')
        expect(text).toContain('other versions may remove')
    })

    it.each(surfaces)('%s names the age the constant enforces', (_name, read) => {
        expect(read()).toContain(RETENTION)
    })
})

// Every locale states the enforced purge age and no other retention, so a
// leftover sentence from an older retention cannot sit beside the current one.
interface TrashCopyLocale {
    trashDesc: string
    deleteFolderTrashConfirm: (name: string, count: number) => string
    othersUi: { editTrashConfirm: (count: number) => string }
}

const locales: Array<[string, TrashCopyLocale]> = [
    ['en', languageEnglish],
    ['ko', languageKorean],
    ['cn', languageChinese],
    ['zh-Hant', languageChineseTraditional],
    ['vi', languageVietnamese],
    ['de', languageGerman],
    ['es', languageSpanish],
    ['ja', languageJapanese],
]

const DAY_WORDS = '(?:일|天|日|ngày|Tage|días|days)'

function statedDayCounts(text: string): number[] {
    const counts: number[] = []
    for (const match of text.matchAll(new RegExp(`(\\d+)\\s*${DAY_WORDS}`, 'g'))) {
        counts.push(Number(match[1]))
    }
    return counts
}

const enforcedDays = TRASH_PURGE_AGE_MS / DAY_MS

describe('Trash retention copy (all locales)', () => {
    describe.each(locales)('%s', (_locale, lang) => {
        const surfacesFor: Array<[string, string, boolean]> = [
            ['trashDesc', lang.trashDesc, true],
            ['deleteFolderTrashConfirm (one)', lang.deleteFolderTrashConfirm('F', 1), true],
            ['deleteFolderTrashConfirm (many)', lang.deleteFolderTrashConfirm('F', 2), true],
            ['editTrashConfirm (one)', lang.othersUi.editTrashConfirm(1), false],
            ['editTrashConfirm (many)', lang.othersUi.editTrashConfirm(2), false],
        ]

        it.each(surfacesFor)('%s states no retention other than the enforced age', (_name, text) => {
            for (const days of statedDayCounts(text)) {
                expect(days).toBe(enforcedDays)
            }
        })

        it.each(surfacesFor.filter(([, , required]) => required))('%s states the enforced age', (_name, text) => {
            expect(statedDayCounts(text)).toContain(enforcedDays)
        })
    })
})
