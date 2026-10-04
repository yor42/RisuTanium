// @vitest-environment happy-dom

/**
 * The `/?` help of the REAL `processMultiCommand` (`./command`).
 *
 * Invariants pinned here:
 *  - in English the help text shown is exactly the fixed block of command names, argument
 *    syntax and descriptions below;
 *  - in every locale the help has the English line structure: the same number of lines,
 *    identical `#` command-heading lines, and identical `/...` example commands, so a
 *    translation can change descriptions and the "Example:" label but never command syntax;
 *  - with Korean selected, the help passed to the alert is Korean.
 *
 * `alertMd`, the parser, generation, the trigger engine and the database are fakes.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'

const alertMdMock = vi.hoisted(() => vi.fn())
const dbBox = vi.hoisted(() => ({ db: { characters: [] as unknown[] } }))

vi.mock(import('../alert'), () => ({
    alertInput: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}) as unknown as typeof import('../alert'))

vi.mock(import('./tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('./tts'))

vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('./index.svelte'), () => ({
    doingChat: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    sendChat: vi.fn(),
}) as unknown as typeof import('./index.svelte'))

vi.mock(import('./lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(),
}) as unknown as typeof import('./lorebook.svelte'))

vi.mock(import('./triggers'), () => ({
    runTrigger: vi.fn(),
}) as unknown as typeof import('./triggers'))

vi.mock(import('./generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
}) as unknown as typeof import('./generationOwnership.svelte'))

vi.mock(import('../stores.svelte'), () => ({
    get DBState() { return dbBox },
    selectedCharID: { subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('../storage/database.svelte'))

import { changeLanguage } from 'src/lang'
import { languageChinese } from 'src/lang/cn'
import { languageChineseTraditional } from 'src/lang/zh-Hant'
import { languageEnglish } from 'src/lang/en'
import { languageGerman } from 'src/lang/de'
import { languageKorean } from 'src/lang/ko'
import { languageSpanish } from 'src/lang/es'
import { languageVietnamese } from 'src/lang/vi'
import { processMultiCommand } from './command'

/** The English help as a fixed block, one entry per line, including the leading and trailing indentation lines. */
const ENGLISH_HELP_LINES = [
    "",
    "            # /input [text]",
    "            - Show input dialog",
    "            - Return input text",
    "            - Example: /input Hello World",
    "            # /echo [text]",
    "            - Show alert dialog",
    "            - Return input text",
    "            - Example: /echo Hello World",
    "            # /popup [text]",
    "            - Show alert dialog",
    "            - Return input text",
    "            - Example: /popup Hello World",
    "            # /pass [text]",
    "            - Return input text",
    "            - Example: /pass Hello World",
    "            # /buttons [labels]",
    "            - Show select dialog",
    "            - Return selected label",
    "            - Example: /buttons Yes§No",
    "            # /speak [text]",
    "            - Speak text",
    "            - Example: /speak Hello World",
    "            # /send [text]",
    "            - Send text to chat",
    "            - Example: /send Hello World",
    "            # /sendas [text]",
    "            - Send text to chat as character",
    "            - Example: /sendas Hello World",
    "            # /comment [text]",
    "            - Add comment to chat",
    "            - Example: /comment Hello World",
    "            # /cut [index]",
    "            - Cut chat message",
    "            - Example: /cut 1",
    "            # /del [size]",
    "            - Delete chat message",
    "            - Example: /del 1",
    "            # /len [array]",
    "            - Return length of array",
    "            - Example: /len Hello§World",
    "            # /setvar key=[key] [value]",
    "            - Set variable",
    "            - Example: /setvar key=hello world",
    "            # /addvar key=[key] [value]",
    "            - Add value to variable",
    "            - Example: /addvar key=damage 10",
    "            # /getvar key=[key]",
    "            - Get variable",
    "            - Example: /getvar key=damage",
    "            # /trigger [name]",
    "            - Run trigger",
    "            # /?",
    "            - Show help",
    "            ",
]
const ENGLISH_HELP = ENGLISH_HELP_LINES.join('\n')

const locales = {
    cn: languageChinese,
    de: languageGerman,
    es: languageSpanish,
    ko: languageKorean,
    vi: languageVietnamese,
    'zh-Hant': languageChineseTraditional,
} satisfies Record<string, { slashCommandHelp: string }>

async function shownHelp(): Promise<string> {
    dbBox.db = {
        characters: [{
            chaId: 'char-a', name: 'Alpha', type: 'character', chatPage: 0,
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }], characters: [],
        }],
    }
    alertMdMock.mockClear()
    const pipe = await processMultiCommand('/?', { origin: { chaId: 'char-a', chatId: 'chat-a' } })
    expect(pipe).toBe('help')
    expect(alertMdMock).toHaveBeenCalledTimes(1)
    return alertMdMock.mock.calls[0][0] as string
}

const linesOf = (text: string) => text.split('\n')
const isHeading = (line: string) => line.trim().startsWith('#')
const exampleTail = (line: string) => {
    const at = line.indexOf('/')
    return at === -1 ? null : line.slice(at)
}

afterEach(() => {
    changeLanguage('en')
})

describe('/? help text', () => {
    test('guard: English shows the exact fixed help block', async () => {
        expect(await shownHelp()).toBe(ENGLISH_HELP)
    })

    test('guard: the English help lists every command heading, each with an example line except /trigger and /?', () => {
        const lines = linesOf(languageEnglish.slashCommandHelp)
        const headings = lines.filter(isHeading).map((l) => l.trim())
        expect(headings).toEqual([
            '# /input [text]', '# /echo [text]', '# /popup [text]', '# /pass [text]', '# /buttons [labels]',
            '# /speak [text]', '# /send [text]', '# /sendas [text]', '# /comment [text]', '# /cut [index]',
            '# /del [size]', '# /len [array]', '# /setvar key=[key] [value]', '# /addvar key=[key] [value]',
            '# /getvar key=[key]', '# /trigger [name]', '# /?',
        ])
        expect(lines.filter((l) => l.includes('Example:')).length).toBe(headings.length - 2)
    })

    test('regression reproducer: Korean selected, /? passes the Korean help to the alert', async () => {
        changeLanguage('ko')
        const shown = await shownHelp()
        expect(shown).toBe(languageKorean.slashCommandHelp)
        expect(shown).toContain('- 입력 대화상자를 표시합니다')
        expect(shown).toContain('- 예시: /input Hello World')
        expect(shown).not.toContain('Show input dialog')
    })
})

describe('/? help syntax parity across locales', () => {
    for (const [code, locale] of Object.entries(locales)) {
        describe(code, () => {
            const english = linesOf(languageEnglish.slashCommandHelp)
            const translated = linesOf(locale.slashCommandHelp)

            test('guard: has the English line count', () => {
                expect(translated.length).toBe(english.length)
            })

            test('guard: every # heading line is identical to English', () => {
                for (let i = 0; i < english.length; i++) {
                    if (isHeading(english[i]) || isHeading(translated[i] ?? '')) {
                        expect(translated[i]).toBe(english[i])
                    }
                }
            })

            test('guard: the /... tail of every example line is identical to English', () => {
                const exampleIndexes = english.map((l, i) => (l.includes('Example:') ? i : -1)).filter((i) => i >= 0)
                expect(exampleIndexes.length).toBeGreaterThan(10)
                for (const i of exampleIndexes) {
                    expect(exampleTail(translated[i] ?? '')).toBe(exampleTail(english[i]))
                }
            })

            test('guard: a non-example, non-heading line keeps its indentation and "- " bullet', () => {
                for (let i = 0; i < english.length; i++) {
                    if (isHeading(english[i])) continue
                    const prefix = english[i].match(/^\s*(- )?/)![0]
                    expect(translated[i].startsWith(prefix)).toBe(true)
                }
            })
        })
    }
})