/**
 * The network hint in `alertError` (src/ts/alert.ts) is triggered when the message includes
 * 'Failed to fetch'. `errors.fetchModelsFailed` embeds the raw error, so a real network
 * TypeError must still reach that check in every locale.
 */
import { describe, test, expect } from 'vitest'
import { languageEnglish } from './en'
import { languageKorean } from './ko'
import { languageChinese } from './cn'
import { languageChineseTraditional } from './zh-Hant'
import { languageVietnamese } from './vi'
import { languageGerman } from './de'
import { languageSpanish } from './es'
import { fillLang } from './fill'

const locales: Array<[string, { errors: { fetchModelsFailed?: string } }]> = [
    ['en', languageEnglish],
    ['ko', languageKorean],
    ['cn', languageChinese],
    ['zh-Hant', languageChineseTraditional],
    ['vi', languageVietnamese],
    ['de', languageGerman],
    ['es', languageSpanish],
]

describe('guard: errors.fetchModelsFailed keeps the raw error text', () => {
    test.each(locales)('%s declares {error} and renders the raw network error', (_name, locale) => {
        const template = locale.errors.fetchModelsFailed ?? ''
        expect(template).toContain('{error}')
        const rendered = fillLang(template, { error: `${new TypeError('Failed to fetch')}` })
        expect(rendered).toContain('Failed to fetch')
        expect(rendered).not.toContain('{error}')
    })
})
