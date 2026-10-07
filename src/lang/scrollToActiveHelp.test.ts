/**
 * The help text of the "scroll to active character" setting describes only the hotkey: the
 * sidebar rail's drag does not scroll to the active character, so a mention of holding Ctrl
 * while dragging would promise a feature that does not exist.
 */
import { describe, expect, test } from 'vitest'
import { languageChinese } from './cn'
import { languageGerman } from './de'
import { languageEnglish } from './en'
import { languageSpanish } from './es'
import { languageKorean } from './ko'
import { languageVietnamese } from './vi'
import { languageChineseTraditional } from './zh-Hant'

const CTRL = /ctrl|strg/i

const languages = [
    ['en', languageEnglish, /drag/i],
    ['ko', languageKorean, /드래그|끌/],
    ['cn', languageChinese, /拖动|拖拽|拖曳/],
    ['zh-Hant', languageChineseTraditional, /拖曳|拖動|拖拉/],
    ['vi', languageVietnamese, /kéo/i],
    ['de', languageGerman, /zieh/i],
    ['es', languageSpanish, /arrastr/i],
] as const

describe('enableScrollToActiveChar help text', () => {
    test.each(languages)('%s help text mentions neither Ctrl nor dragging', (_code, language, dragWord) => {
        const help = language.help.enableScrollToActiveChar
        expect(help.length).toBeGreaterThan(0)
        expect(help).not.toMatch(CTRL)
        expect(help).not.toMatch(dragWord)
    })

    test('the English text still describes the hotkey and the automatic opening of folders', () => {
        const help = languageEnglish.help.enableScrollToActiveChar
        expect(help).toMatch(/hotkey/i)
        expect(help).toMatch(/folders/i)
    })
})
