/**
 * The creator notes re-encode (T2-CN-1, T2-CN-PAR, T2-CN-FP). The literal table holds the strings the classic editor's
 * parse and encode produce for each edit, written out by hand: no expectation of it is computed by the module under
 * test. The parity and fixed-point tests compare the module with a copy of MultiLangInput's script logic over the real
 * util functions (classicMultiLang.test-helpers.ts).
 */
import { describe, expect, test, vi } from 'vitest'

// util's module graph reads the database, the stores and the native layer at load; parse and encode need none of them.
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, selIdState: { selId: 0 }, selectedCharID: writable(0) } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({ markCharacterForSave: vi.fn() }) as unknown as typeof import('src/ts/storage/characterSaveMarks'))
vi.mock(import('src/ts/process/modules'), () => ({ getModuleToggles: () => '' }) as unknown as typeof import('src/ts/process/modules'))

import { encodeMultilangString, languageCodes, parseMultilangString, toLangName } from '../../util'
import { classicMount, classicSession, classicSettled } from './classicMultiLang.test-helpers'
import { encodeNote, languageName, notesLanguages, parseNote, withLanguageBody } from './creatorNotesLanguages'

// [input, tab, typed body, expected written string]
const ROWS: readonly (readonly [string, string, string, string])[] = [
    ['\n# `en`\nhello\n# `ko`\nannyeong', 'ko', 'annyeong!', '\n# `en`\nhello\n# `ko`\nannyeong!'],
    ['my plain upstream note', 'ko', 'K', '\n# `en`\nmy plain upstream note\n# `ko`\nK'],
    ['my plain upstream note', 'en', 'E', '\n# `en`\nE'],
    ['', 'ko', 'K', '\n# `en`\n \n# `ko`\nK'],
    ['intro\n# `en`\na', 'en', 'b', '\n# `en`\nb'],
    ['intro\n# `ko`\nk', 'ko', 'k2', '\n# `ko`\nk2\n# `en`\nintro\n'],
    ['# `en`\na\n# `ko`\nk', 'ko', 'k2', '\n# `en`\na\n# `ko`\nk2'],
    ['\n# `ko`\nk', 'en', 'E', '\n# `ko`\nk\n# `en`\nE'],
    ['\n# `en`\nfirst\n# `en`\nsecond', 'en', 'secondX', '\n# `en`\nsecondX'],
    ['\n# `en`\nfirst\n# `ko`\nk\n# `en`\nsecond', 'ko', 'K', '\n# `en`\nsecond\n# `ko`\nK'],
    ['\n# `en`\nhello\n# `ko`\nannyeong', 'en', '', '\n# `en`\n \n# `ko`\nannyeong'],
    ['\n# `en`\nhello\n# `ko`\nannyeong', 'ko', '', '\n# `en`\nhello'],
    ['\n# `ko`\nk\n# `en`\ne', 'ko', '', '\n# `en`\ne'],
    ['\n# `en`\nhello\n# `ko`\nannyeong', 'ja', 'J', '\n# `en`\nhello\n# `ko`\nannyeong\n# `ja`\nJ'],
    ['\n# `en`\ne\n# `ja`\nj\n# `ko`\nk', 'ja', '', '\n# `en`\ne\n# `ko`\nk'],
    ['intro\n# `en`\na\n# `ko`\nk', 'ko', 'K', '\n# `en`\na\n# `ko`\nK'],
]

describe('T2-CN-1: withLanguageBody writes the literal string of each edit', () => {
    test.each(ROWS)('%j, tab %s, typed %j', (input, lang, body, expected) => {
        expect(withLanguageBody(input, lang, body)).toBe(expected)
    })
})

describe('T2-CN-1: notesLanguages is classic\'s starting map', () => {
    test('untagged text is the EN section when there is no en section, and is not a language otherwise', () => {
        expect(notesLanguages('plain')).toEqual({ en: 'plain' })
        expect(Object.keys(notesLanguages('\n# `ko`\nk\n# `en`\ne'))).toEqual(['ko', 'en'])
        expect(Object.keys(notesLanguages('intro\n# `ko`\nk'))).toEqual(['ko', 'en'])
        expect(notesLanguages('intro\n# `en`\na')).toEqual({ en: 'a' })
    })

    test('a duplicated header reads as its last occurrence, at the first occurrence\'s position', () => {
        const languages = notesLanguages('\n# `en`\nfirst\n# `ko`\nk\n# `en`\nsecond')
        expect(languages).toEqual({ en: 'second', ko: 'k' })
        expect(Object.keys(languages)).toEqual(['en', 'ko'])
    })
})

// Notes whose classic map survives encode and parse: the strings classic and Studio then treat alike.
const FIXTURES: readonly (readonly [string, string])[] = [
    ['plain upstream note', 'my plain upstream note'],
    ['encode-made', encodeMultilangString({ en: 'hello', ko: 'annyeong' })],
    ['untagged text before en', 'intro\n# `en`\na'],
    ['untagged text before ko only', 'intro\n# `ko`\nk'],
    ['header at index 0', '# `en`\na\n# `ko`\nk'],
    ['ko only', '\n# `ko`\nk'],
    ['ko before en', '\n# `ko`\nk\n# `en`\ne'],
    ['duplicate headers', '\n# `en`\nfirst\n# `en`\nsecond'],
    ['duplicate headers with ko between', '\n# `en`\nfirst\n# `ko`\nk\n# `en`\nsecond'],
    ['untagged text and two sections', 'intro\n# `en`\na\n# `ko`\nk'],
]

function roundTrips(text: string): boolean {
    const languages = notesLanguages(text)
    const reparsed = parseMultilangString(encodeMultilangString(languages))
    delete reparsed.xx
    return JSON.stringify(reparsed) === JSON.stringify(languages)
}

const EDITS: readonly (readonly [string, string])[] = [['en', 'E'], ['ko', 'K'], ['ja', 'J'], ['en', '']]

describe('T2-CN-PAR: a Studio edit equals the string the classic editor leaves for the same typing', () => {
    test.each(FIXTURES)('%s: the precondition holds', (_name, text) => {
        expect(roundTrips(text)).toBe(true)
    })

    for (const [name, text] of FIXTURES) {
        test.each(EDITS)(`${name}: tab %s typed %j`, (lang, body) => {
            expect(withLanguageBody(text, lang, body)).toBe(classicSession(text, lang, body))
        })
    }

    // Classic writes a header-only section while the emptied tab is selected; a section after it then reads as part of
    // the emptied one. Studio removes the emptied section at once, so the strings agree only where nothing follows it.
    test('an emptied last non-EN tab leaves the string classic leaves once that tab is left', () => {
        let compared = 0
        for (const [, text] of FIXTURES) {
            if (Object.keys(notesLanguages(text)).at(-1) !== 'ko') continue
            compared += 1
            expect(withLanguageBody(text, 'ko', ''), text).toBe(classicSettled(text, 'ko', ''))
        }
        expect(compared).toBeGreaterThan(0)
    })

    test('an emptied non-EN tab that another section follows is removed, where classic would leave a header-only section', () => {
        const text = '\n# `ko`\nk\n# `en`\ne'
        expect(withLanguageBody(text, 'ko', '')).toBe('\n# `en`\ne')
        expect(classicSettled(text, 'ko', '')).not.toBe('\n# `en`\ne')
    })
})

describe('T2-CN-FP: classic\'s mount over a Studio write writes it unchanged', () => {
    test.each(ROWS)('the output of %j, tab %s, typed %j', (input, lang, body, expected) => {
        const written = withLanguageBody(input, lang, body)
        expect(written).toBe(expected)
        expect(classicMount(written)).toBe(written)
    })

    test.each(FIXTURES)('every edit of %s leaves a string with no untagged text, an en section and no header-only section', (_name, text) => {
        for (const [lang, body] of [...EDITS, ['ko', '']] as const) {
            const written = withLanguageBody(text, lang, body)
            expect(classicMount(written), `${lang}:${body}`).toBe(written)
            const languages = parseMultilangString(written)
            expect(languages.xx.trim(), `${lang}:${body}`).toBe('')
            expect(languages.en, `${lang}:${body}`).not.toBeUndefined()
            expect(written, `${lang}:${body}`).not.toMatch(/# `[^`]+`\n(?=\n# `|$)/)
        }
    })
})

describe('the module\'s own parse, encode and language name equal the functions of util', () => {
    const STRINGS = [
        '', 'plain', '\n# `en`\nhello', 'intro\n# `ko`\nk', '# `en`\na\n# `ko`\nk', '\n# `en`\nfirst\n# `en`\nsecond', '\n# `en`\n',
        'a\n# `b` c', '\n# `en`\nhello\r\n# `ko`\r\nannyeong', '# `x`\n\n# `y`\nz', '\n# `en`\n \n# `ko`\nannyeong', '# ``\nno code',
    ]

    test.each(STRINGS)('parse of %j', (text) => {
        const own = parseNote(text)
        const real = parseMultilangString(text)
        expect(own).toEqual(real)
        expect(Object.keys(own)).toEqual(Object.keys(real))
    })

    test.each([[{}], [{ en: 'a' }], [{ xx: 'intro', en: 'a', ko: 'k' }], [{ ko: 'k', en: '' }], [{ xx: '', en: 'a' }]])('encode of %j', (map) => {
        expect(encodeNote(map)).toBe(encodeMultilangString(map))
    })

    test('the name of a language is the one toLangName gives, for every code the add menu lists', () => {
        for (const code of [...languageCodes, 'xx', 'zz', 'not a code!']) {
            expect(languageName(code), code).toBe(toLangName(code) ?? code)
        }
    })
})