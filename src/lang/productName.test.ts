/**
 * The app's own name in English UI text is RisuTanium. Text that names the upstream project or its
 * domains keeps upstream wording, so exactly the allow-listed keys may still contain a product-name
 * mention, and each of those must use the upstream phrasing.
 */
import { describe, test, expect } from 'vitest'
import { languageEnglish } from './en'
import { languageKorean } from './ko'
import { languageChinese } from './cn'
import { languageChineseTraditional } from './zh-Hant'
import { languageVietnamese } from './vi'
import { languageGerman } from './de'
import { languageSpanish } from './es'
import { languageJapanese } from './ja'

const MENTION = /risu ?ai/gi

// Phrases that name upstream or its domains; removed before the scan. The first two are case-sensitive.
const ALLOWED_PHRASES = ['upstream RisuAI', 'upstream version of RisuAI', 'risuai.xyz', 'risuai.net']

type Walkable = { [key: string]: unknown }

// Strings as is, functions through their compiled body, so interpolated templates are scanned too.
function collectTexts(node: unknown, prefix: string, out: Map<string, string>) {
    if (typeof node === 'string') {
        out.set(prefix, node)
    } else if (typeof node === 'function') {
        out.set(prefix, String(node))
    } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Walkable)) {
            collectTexts(value, prefix ? `${prefix}.${key}` : key, out)
        }
    }
}

function textsOf(locale: unknown): Map<string, string> {
    const out = new Map<string, string>()
    collectTexts(locale, '', out)
    return out
}

function stripAllowed(text: string): string {
    let result = text
    for (const phrase of ALLOWED_PHRASES) {
        result = result.split(phrase).join('')
    }
    return result
}

function hasMention(text: string): boolean {
    return text.match(MENTION) !== null
}

const OWN_PRODUCT_KEYS = [
    'iris.introTip',
    'browserStorageUnavailable',
    'opfsFallbackNoticeTab',
    'opfsFallbackNoticeSpace',
    'opfsFallbackNoticeNoIndexedDb',
    'opfsFallbackNoticeError',
    'opfsReadOnlyNotice',
    'personasRepairedNotice',
    'restoreRepairedNotice',
    'saveCharacterNeverSavedNotice',
    'saveCharacterUnsavedNotice',
    'saveDamagedChanged',
    'saveDamagedChoiceTitle',
    'saveDamagedNotice',
    'saveDamagedOtherTab',
    'saveDamagedStopped',
    'saveDamagedUnconfirmed',
    'saveLeftoverNotice',
    'saveReadFailed',
    'saveRepairedEntriesNotice',
    'saveSeedBlocked',
    'saveSeedFailed',
    'savingStoppedInvalidDataMessage',
    'savingStoppedUnconfirmedMessage',
    'store2ImportTooNew',
    'store2ImportUnconfirmed',
    'store2RestoreUnconfirmed',
]

// Keys whose text refers to upstream and must say so.
const UPSTREAM_WORDING_KEYS = ['realmDesc', 'risupresetDesc', 'risuMDesc', 'saveMainFileLeftNotice']

// Keys that name upstream or its domains by design.
const UPSTREAM_NAMING_KEYS = [
    'backupUpstreamOversizeConfirm',
    'staleAccountProfileNotice',
    'upstreamAgreementPromptBefore',
    'upstreamConsentPlaceholder',
    'encryptedBackupRefused',
]

const MENTION_ALLOW_LIST = [...UPSTREAM_NAMING_KEYS, ...UPSTREAM_WORDING_KEYS].sort()

// Locales held to the rule. Non-English locales join once their text is converted.
const LOCALES: Record<string, unknown> = {
    en: languageEnglish,
    ja: languageJapanese,
    ko: languageKorean,
    cn: languageChinese,
    'zh-Hant': languageChineseTraditional,
    vi: languageVietnamese,
    de: languageGerman,
    es: languageSpanish,
}
const LOCALES_UNDER_GUARD = ['en', 'ja', 'ko', 'cn', 'zh-Hant', 'vi', 'de', 'es']

describe('English product name', () => {
    const texts = textsOf(languageEnglish)

    test('no key outside the allow-list mentions the product under another name', () => {
        const offenders = [...texts]
            .filter(([key, text]) => hasMention(stripAllowed(text)))
            .map(([key]) => key)
        expect(offenders).toEqual([])
    })

    test.each(OWN_PRODUCT_KEYS)('%s names RisuTanium and not RisuAI', (key) => {
        const text = texts.get(key)
        expect(text).toBeDefined()
        expect(text).toContain('RisuTanium')
        expect(hasMention(text as string)).toBe(false)
    })

    test.each(UPSTREAM_WORDING_KEYS)('%s refers to upstream RisuAI', (key) => {
        const text = texts.get(key) as string
        expect(text).toBeDefined()
        expect(text).not.toContain('Risuai')
        expect(text).not.toContain('RisuTanium')
        const marker = key === 'saveMainFileLeftNotice' ? 'An upstream version of RisuAI' : 'upstream RisuAI'
        expect(text).toContain(marker)
    })

    test('exactly the allow-listed keys still contain a product-name mention', () => {
        const mentioning = [...texts].filter(([key, text]) => hasMention(text)).map(([key]) => key).sort()
        expect(mentioning).toEqual(MENTION_ALLOW_LIST)
    })

    // Compatibility guard: passes before and after the rename.
    test.each(UPSTREAM_NAMING_KEYS)('%s keeps upstream naming', (key) => {
        const text = texts.get(key) as string
        expect(text).toBeDefined()
        if (key === 'encryptedBackupRefused') {
            expect(text).toContain('risuai.xyz')
        } else {
            expect(text).toContain('upstream RisuAI')
        }
    })
})

describe.each(LOCALES_UNDER_GUARD)('product name in locale %s', (code) => {
    const texts = textsOf(LOCALES[code])

    test('own-product keys name RisuTanium', () => {
        const missing = OWN_PRODUCT_KEYS
            .filter((key) => texts.has(key))
            .filter((key) => !(texts.get(key) as string).includes('RisuTanium'))
        expect(missing).toEqual([])
    })

    test('keys outside the allow-list carry no product-name mention', () => {
        const offenders = [...texts]
            .filter(([key]) => !MENTION_ALLOW_LIST.includes(key))
            .filter(([key, text]) => hasMention(stripAllowed(text)))
            .map(([key]) => key)
        expect(offenders).toEqual([])
    })

    test('classicRisu carries no product-name mention', () => {
        const text = texts.get('classicRisu')
        if (text !== undefined) expect(hasMention(text)).toBe(false)
    })
})
