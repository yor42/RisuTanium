/**
 * WR-7: the risk warning in all eight locales. The Android variant has four paragraphs and quotes the shortcut label the
 * launcher shows, read from the Android resource files so a renamed label breaks this test; Korean also quotes the Korean
 * label. The other platforms' variant is the same text without the Android-only second paragraph and names no label.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { languageEnglish } from './en'
import { languageKorean } from './ko'
import { languageChinese } from './cn'
import { languageChineseTraditional } from './zh-Hant'
import { languageVietnamese } from './vi'
import { languageGerman } from './de'
import { languageSpanish } from './es'
import { languageJapanese } from './ja'

const RES = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res')

function longLabel(folder: string): string {
    const xml = readFileSync(join(RES, folder, 'strings.xml'), 'utf8')
    const match = /<string name="shortcut_no_pack_long">([^<]*)<\/string>/.exec(xml)
    if (match === null) {
        throw new Error(`no shortcut_no_pack_long in ${folder}`)
    }
    return match[1]
}

/** The warning of one locale module, read by key so a locale that lacks it fails here and not in the type check. */
function riskOf(locale: object): (android: boolean) => string {
    const read = Object.getOwnPropertyDescriptor(locale, 'themePackRiskConfirm')?.value as unknown
    if (typeof read !== 'function') {
        throw new Error('the locale has no themePackRiskConfirm')
    }
    return (android) => String((read as (android: boolean) => unknown)(android))
}

const ENGLISH_LABEL = longLabel('values')
const KOREAN_LABEL = longLabel('values-ko')

const LOCALES = [
    ['en', languageEnglish], ['ko', languageKorean], ['cn', languageChinese], ['zh-Hant', languageChineseTraditional],
    ['vi', languageVietnamese], ['de', languageGerman], ['es', languageSpanish], ['ja', languageJapanese],
] as const

const ANDROID_ENGLISH = 'A theme pack can make the app hard or impossible to use.\n\n'
    + 'If that happens, long-press the app icon and choose "Start without theme pack". If the app is frozen, close it from recent apps first, or Force stop it in App info.\n\n'
    + 'While a pack is on, data-loss warnings and save-failure notices may be hidden or hard to read.\n\n'
    + 'Install this theme pack?'
const PLAIN_ENGLISH = 'A theme pack can make the app hard or impossible to use.\n\n'
    + 'While a pack is on, data-loss warnings and save-failure notices may be hidden or hard to read.\n\n'
    + 'Install this theme pack?'

describe('WR-7 the risk warning in every locale', () => {
    test('the label comes from the resource file', () => {
        expect(ENGLISH_LABEL).toBe('Start without theme pack')
        expect(KOREAN_LABEL.length).toBeGreaterThan(0)
    })

    test('English equals both approved literals', () => {
        expect(riskOf(languageEnglish)(true)).toBe(ANDROID_ENGLISH)
        expect(riskOf(languageEnglish)(false)).toBe(PLAIN_ENGLISH)
    })

    test.each(LOCALES)('%s: four paragraphs with the launcher label, and the plain variant is the same without paragraph two', (_name, locale) => {
        const android = riskOf(locale)(true).split('\n\n')
        const plain = riskOf(locale)(false).split('\n\n')
        expect(android).toHaveLength(4)
        expect(plain).toEqual(android.filter((_paragraph, index) => index !== 1))
        expect(android[1]).toContain(ENGLISH_LABEL)
        for (const paragraph of plain) {
            expect(paragraph).not.toContain(ENGLISH_LABEL)
            expect(paragraph).not.toContain(KOREAN_LABEL)
        }
    })

    test('ko also quotes the Korean label', () => {
        expect(riskOf(languageKorean)(true).split('\n\n')[1]).toContain(KOREAN_LABEL)
    })
})