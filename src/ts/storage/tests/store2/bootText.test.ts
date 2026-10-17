// @vitest-environment node
/**
 * The boot screens as data (`store2/ui/bootText.ts`): which buttons each screen has and in what order, what each stands
 * for, where initial focus goes, how a name from the user's data is shown, and what each blocked reason says. The
 * builders are pure, so nothing here needs a DOM. Labels: new behaviour. The mutants named in each test were run by hand
 * and the test goes red against them.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { BLOCKED_REASONS, type BlockedReason, type Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import type { Staging } from 'src/ts/storage/store2/owner'
import type { SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import type { IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import {
    BLOCKED_TABLE, BOOT_LANGUAGES, backupDate, blockedScreen, bootLanguage, confirmConvertScreen, confirmConvertWithoutScreen,
    confirmFlaggedOpenScreen, confirmFromBackupScreen, confirmIncompleteScreen, declinedScreen, displayName, flaggedLists,
    foreignMarkerScreen, incompleteList, noticeText, offerScreen, skippedList, stoppedScreen, tooNewScreen,
    type BootQuestion,
} from 'src/ts/storage/store2/ui/bootText'

beforeEach(() => {
    changeLanguage('en')
})

function keysOf(question: BootQuestion<unknown>): string[] {
    return question.model.buttons.map((button) => button.key)
}

describe('every question: buttons in DOM order, what each stands for, and where focus goes', () => {
    const skipped: SkippedLegacyEntry[] = [{ name: 'cha-1', kind: 'character', reason: 'x' }]
    const incomplete: IncompleteItem[] = [{ kind: 'character', chaId: 'c1', name: 'Ann', key: 'k', reason: 'missing' }]
    const flagged: FlaggedItem[] = [{ kind: 'character-part', chaId: 'c1', part: 'core', key: 'k', why: 'damaged', name: 'Ann' }]
    const marker: Staging = { owner: 'o', prefix: 'p', startedAt: 1_700_000_000_000, label: 'convert' }

    const table: [string, BootQuestion<unknown>, string[], Record<string, unknown>, string | null][] = [
        ['confirmConvert', confirmConvertScreen(), ['convertNo', 'convertYes'], { convertNo: false, convertYes: true }, 'convertNo'],
        ['declined', declinedScreen(true), ['declinedConvert', 'declinedImport'], { declinedConvert: 'convert', declinedImport: 'import' }, null],
        ['confirmFromBackup', confirmFromBackupScreen(17_000_000_000), ['fromBackupNo', 'fromBackupYes'], { fromBackupNo: 'decline', fromBackupYes: 'convert' }, 'fromBackupNo'],
        ['confirmConvertWithout', confirmConvertWithoutScreen(skipped), ['withoutNo', 'withoutYes'], { withoutNo: 'decline', withoutYes: 'convert' }, 'withoutNo'],
        ['confirmIncomplete', confirmIncompleteScreen(incomplete), ['incompleteNo', 'incompleteYes'], { incompleteNo: false, incompleteYes: true }, 'incompleteNo'],
        ['confirmFlaggedOpen', confirmFlaggedOpenScreen(flagged), ['flaggedDecline', 'flaggedContinue', 'flaggedEarlier'], { flaggedDecline: 'decline', flaggedContinue: 'continue', flaggedEarlier: 'earlier' }, 'flaggedDecline'],
        ['foreignMarker', foreignMarkerScreen(marker), ['foreignWait', 'foreignClear'], { foreignWait: 'wait', foreignClear: 'clear' }, 'foreignWait'],
    ]

    test.each(table)('%s', (_name, question, keys, answers, focus) => {
        expect(keysOf(question)).toEqual(keys)
        expect(question.answers).toEqual(answers)
        expect(question.model.focus).toBe(focus)
        for (const button of question.model.buttons) {
            expect(button.label.trim(), button.key).not.toBe('')
        }
    })

    test('initial focus never lands on an answer that writes: it is the first button, whose answer is the refusal', () => {
        const refusals: unknown[] = [false, 'decline', 'wait']
        for (const [name, question, , , focus] of table) {
            if (focus === null) {
                continue
            }
            expect(focus, name).toBe(question.model.buttons[0].key)
            expect(refusals, name).toContain(question.answers[focus])
        }
    })

    test('the declined screen has no import button until the page can act on it, and focus goes to the heading either way', () => {
        const without = declinedScreen(false)
        expect(keysOf(without)).toEqual(['declinedConvert'])
        expect(without.answers).toEqual({ declinedConvert: 'convert' })
        expect(without.model.focus).toBeNull()
        expect(declinedScreen(true).model.focus).toBeNull()
    })

    test('the declined screen offers the backup-file sentence only when the page can act on it, and its convert button opens the question again', () => {
        const t = language.store2Boot
        expect(declinedScreen(false).model.paragraphs).toEqual([t.declinedBody])
        expect(declinedScreen(true).model.paragraphs).toEqual([t.declinedBodyWithImport])
        expect(t.declinedBody).not.toMatch(/backup/i)
        expect(t.declinedBodyWithImport).toMatch(/restore a backup file/)
        expect(t.declinedConvert).toBe('Convert…')
        expect(declinedScreen(false).model.buttons[0].label).toBe('Convert…')
    })

    test('the Not now answer of the convert question is the default and is the one that writes nothing (W3-Q8)', () => {
        const question = confirmConvertScreen()
        expect(question.model.focus).toBe('convertNo')
        expect(question.answers.convertNo).toBe(false)
        expect(question.model.paragraphs).toContain(language.store2Boot.convertMemoryNote)
        expect(question.model.paragraphs[0]).toBe(language.store2Boot.convertBody)
        expect(language.store2Boot.convertBody).toContain('Keep RisuTanium open in only one tab or window until the copy finishes.')
        expect(language.store2Boot.convertBody).not.toMatch(/data folder/i)
    })

    test('the stopped and standing-marker texts promise nothing about the next start, and no text says "greeting"', () => {
        const t = languageEnglish.store2Boot
        const strings = Object.values(t).filter((value): value is string => typeof value === 'string')
        const built = [
            t.fromBackupBody('d'), t.incompleteCharacterLine('n', 'r'), t.incompleteChatLine('n', 1, 'r'), t.incompletePluginLine('s', 'r'),
            t.flaggedPartLine('p', 's'), t.flaggedChatPosition(1), t.flaggedChatId('i'), t.flaggedChatLine('c', 's', 2),
            t.foreignBody('o', 'w'), t.offerBody(1, 'd'), t.noticeConvertedFromBackup('d'),
        ]
        expect(strings.length).toBeGreaterThan(50)
        expect([...strings, ...built].join('\n')).not.toMatch(/greeting/i)
        expect(language.store2Boot.stoppedBody).not.toMatch(/next start|next time/i)
        expect(language.store2Boot.blockedStanding).not.toMatch(/next start|next time/i)
    })
})

describe('dates', () => {
    test('a numbered backup is named by its time in tenths of a second', () => {
        expect(backupDate(17_000_000_000)).toBe(new Date(17_000_000_000 * 100).toLocaleString())
        expect(confirmFromBackupScreen(17_000_000_000).model.paragraphs[0]).toBe(language.store2Boot.fromBackupBody(new Date(1_700_000_000_000).toLocaleString()))
    })

    test('the foreign marker names its operation and its start time (milliseconds)', () => {
        const screen = foreignMarkerScreen({ owner: 'o', prefix: 'p', startedAt: 1_700_000_000_000, label: 'convert' })
        expect(screen.model.paragraphs[0]).toBe(language.store2Boot.foreignBody(language.store2Boot.foreignOpConvert, new Date(1_700_000_000_000).toLocaleString()))
    })

    test.each(['convert', 'seed', 'import', 'restore', 'recovery', 'bulk'] as const)('every operation label has its own words: %s', (label) => {
        const body = foreignMarkerScreen({ owner: 'o', prefix: 'p', startedAt: 0, label }).model.paragraphs[0]
        expect(body).not.toContain('undefined')
    })
})

describe('the name rule: the name when there is one, otherwise the id and "(name unavailable)"', () => {
    test.each([
        ['Ann', 'c1', 'Ann'],
        ['', 'c1', 'c1 (name unavailable)'],
        ['   ', 'c1', 'c1 (name unavailable)'],
        [undefined, 'c1', 'c1 (name unavailable)'],
        [null, 'c1', 'c1 (name unavailable)'],
        ['', '', '(name unavailable)'],
    ])('name %j with id %j shows %j', (name, id, shown) => {
        expect(displayName(name, id)).toBe(shown)
    })

    test('a skipped character shows its id and "(name unavailable)"; another skipped block shows a readable label, never its internal name', () => {
        const t = language.store2Boot
        const list = skippedList([
            { name: 'cha-lost', kind: 'character', reason: 'x' },
            { name: 'preset', kind: 'presets', reason: 'x' },
            { name: 'modules', kind: 'modules', reason: 'x' },
            { name: 'loadouts', kind: 'loadouts', reason: 'x' },
            { name: 'plugins', kind: 'plugins', reason: 'x' },
            { name: 'pluginStorage', kind: 'pluginStorage', reason: 'x' },
            { name: 'config', kind: 'ignored', reason: 'x' },
            { name: 'blk-7', kind: 'other', reason: 'x' },
        ])
        expect(list.items).toEqual([
            'cha-lost (name unavailable)', t.skippedPresets, t.skippedModules, t.skippedLoadouts, t.skippedPlugins,
            t.skippedPluginStorage, t.skippedConfig, t.skippedOther,
        ])
        for (const internal of ['preset', 'pluginStorage', 'config', 'blk-7']) {
            expect(list.items.join('\n')).not.toContain(internal)
        }
    })

    test('a skipped block of a kind the screen has no label for gets the generic label, not its name', () => {
        const unknown = { name: 'secret-internal', kind: 'future-kind', reason: 'x' } as unknown as SkippedLegacyEntry
        expect(skippedList([unknown]).items).toEqual([language.store2Boot.skippedOther])
    })

    test('names are kept exactly: a separator, markup or a newline inside a name changes nothing and nothing is joined', () => {
        const names = ['a || b', '<b>bold</b>', 'line one\nline two', '{{char}}']
        const items = incompleteList(names.map((name, index): IncompleteItem => ({ kind: 'character', chaId: `c${index}`, name, key: 'k', reason: 'missing' }))).items
        expect(items).toHaveLength(names.length)
        names.forEach((name, index) => {
            expect(items[index]).toBe(language.store2Boot.incompleteCharacterLine(name, language.store2Boot.reasonMissing))
            expect(items[index]).toContain(name)
        })
    })

    test('a long list is shown whole: 200 entries stay 200 in every list kind', () => {
        const skipped = Array.from({ length: 200 }, (_, i): SkippedLegacyEntry => ({ name: `cha-${i}`, kind: 'character', reason: 'x' }))
        const incomplete = Array.from({ length: 200 }, (_, i): IncompleteItem => ({ kind: 'character', chaId: `c${i}`, name: `N${i}`, key: 'k', reason: 'missing' }))
        const flagged = Array.from({ length: 200 }, (_, i): FlaggedItem => ({ kind: 'character-part', chaId: `c${i}`, part: 'core', key: 'k', why: 'missing', name: `N${i}` }))
        expect(skippedList(skipped).items).toHaveLength(200)
        expect(incompleteList(incomplete).items).toHaveLength(200)
        expect(flaggedLists(flagged)).toHaveLength(200)
        expect(confirmConvertWithoutScreen(skipped).model.lists[0].items).toHaveLength(200)
    })

    test('the without screen with nothing named says so instead of showing an empty list', () => {
        const model = confirmConvertWithoutScreen([]).model
        expect(model.lists).toEqual([])
        expect(model.paragraphs).toContain(language.store2Boot.withoutNothingNamed)
    })
})

describe('flagged items are grouped by character, then chat', () => {
    function chat(chaId: string, chatId: string, part: 'core' | 'chunk', why: 'missing' | 'damaged', name = 'Ann'): FlaggedItem {
        return { kind: 'chat', chaId, chatId, part, key: `${chaId}/${chatId}/${part}`, why, name }
    }

    test('positional ids show as the chat position, stable ids as ids, and several parts of one chat are one row with a count', () => {
        const lists = flaggedLists([
            chat('c1', '~1', 'core', 'damaged'),
            chat('c1', '~1', 'chunk', 'damaged'),
            chat('c1', 'abc-123', 'core', 'missing'),
            { kind: 'character-part', chaId: 'c1', part: 'lore', key: 'k', why: 'missing', name: 'Ann' },
        ])
        const text = language.store2Boot
        expect(lists).toEqual([{
            heading: 'Ann',
            items: [
                text.flaggedPartLine(text.flaggedPartLore, text.flaggedMissing),
                text.flaggedChatLine(text.flaggedChatPosition(2), text.flaggedDamaged, 2),
                text.flaggedChatLine(text.flaggedChatId('abc-123'), text.flaggedMissing, 1),
            ],
        }])
    })

    test('two characters make two lists; a character with no name is its id and "(name unavailable)"', () => {
        const lists = flaggedLists([chat('c1', '~0', 'core', 'missing', 'Ann'), chat('c2', '~0', 'core', 'missing', '')])
        expect(lists.map((list) => list.heading)).toEqual(['Ann', 'c2 (name unavailable)'])
    })

    test('a chat with mixed damaged and missing parts says damaged or missing', () => {
        const [list] = flaggedLists([chat('c1', '~0', 'core', 'missing'), chat('c1', '~0', 'chunk', 'damaged')])
        expect(list.items).toEqual([language.store2Boot.flaggedChatLine(language.store2Boot.flaggedChatPosition(1), language.store2Boot.flaggedBoth, 2)])
        const [mixed] = flaggedLists([
            { kind: 'character-part', chaId: 'c1', part: 'core', key: 'a', why: 'missing', name: 'Ann' },
            { kind: 'character-part', chaId: 'c1', part: 'core', key: 'b', why: 'damaged', name: 'Ann' },
        ])
        expect(mixed.items).toEqual([language.store2Boot.flaggedPartLine(language.store2Boot.flaggedPartCore, language.store2Boot.flaggedBoth)])
    })

    test('a "~" id without a position is shown as an id, not as chat NaN', () => {
        const [list] = flaggedLists([chat('c1', '~x', 'core', 'missing')])
        expect(list.items[0]).toBe(language.store2Boot.flaggedChatLine(language.store2Boot.flaggedChatId('~x'), language.store2Boot.flaggedMissing, 1))
    })
})

describe('bootLanguage', () => {
    test.each([
        ['zh-TW', 'zh-Hant'],
        ['zh-HK', 'zh-Hant'],
        ['zh-Hant', 'zh-Hant'],
        ['zh-Hant-CN', 'zh-Hant'],
        ['zh-hant-tw', 'zh-Hant'],
        ['zh-CN', 'cn'],
        ['zh-Hans', 'cn'],
        ['zh', 'cn'],
        ['de-AT', 'de'],
        ['ko-KR', 'ko'],
        ['es', 'es'],
        ['vi-VN', 'vi'],
        ['en-GB', 'en'],
        ['fr-FR', 'en'],
        ['', 'en'],
        [undefined, 'en'],
        [null, 'en'],
    ])('%j is %j', (tag, expected) => {
        expect(bootLanguage(tag)).toBe(expected)
    })

    test('the list of usable languages is exactly the languages changeLanguage has a branch for', () => {
        for (const code of BOOT_LANGUAGES) {
            changeLanguage(code)
            if (code === 'en') {
                expect(language, code).toBe(languageEnglish)
            } else {
                expect(language, code).not.toBe(languageEnglish)
            }
        }
        changeLanguage('fr')
        expect(language).toBe(languageEnglish)
        expect([...BOOT_LANGUAGES].sort()).toEqual(['cn', 'de', 'en', 'es', 'ko', 'vi', 'zh-Hant'])
    })
})

describe('blocked reasons', () => {
    const REASSURED: BlockedReason[] = [
        'no-backend', 'commit-key-unreadable', 'commit-unreadable', 'tree-unreadable', 'main-file-unknown', 'backups-unlistable',
        'store2-profile-unwritable', 'no-profile-unwritable', 'first-life-refused', 'assemble-failed', 'convert-read-failed',
        'convert-main-unreadable', 'convert-lenient-failed', 'presence-unknown', 'marker-failed',
    ]

    test('every reason has an entry, and the table has no entry the union does not', () => {
        expect(Object.keys(BLOCKED_TABLE).sort()).toEqual([...BLOCKED_REASONS].sort())
        expect(BLOCKED_REASONS).toHaveLength(24)
    })

    test.each(BLOCKED_REASONS)('%s: "Nothing was changed." appears only where the reason is before-write and the boot cannot have written', (reason) => {
        const model = blockedScreen({ reason, detail: 'the disk said no', mayHaveWritten: false })
        const reassured = model.paragraphs.includes(language.store2Boot.blockedNothingChanged)
        expect(reassured).toBe(REASSURED.includes(reason))
        expect(model.paragraphs[0].trim()).not.toBe('')
        expect(model.details).toContain(reason)
        expect(model.details).toContain('the disk said no')
        expect(model.buttons.map((button) => button.key)).toEqual(['reload'])
        expect(model.focus).toBe('reload')
    })

    test.each(REASSURED)('%s: when the boot may have written, no reason carries "Nothing was changed."', (reason) => {
        const model = blockedScreen({ reason, detail: 'x', mayHaveWritten: true })
        expect(model.paragraphs).not.toContain(language.store2Boot.blockedNothingChanged)
        expect(model.paragraphs).toHaveLength(1)
    })

    test('the install reasons say the setup started and did not finish, and never reassure', () => {
        for (const reason of ['install-unknown', 'install-invalid', 'install-failed', 'install-upload-failed'] as const) {
            const model = blockedScreen({ reason, detail: '', mayHaveWritten: false })
            expect(model.paragraphs).toEqual([language.store2Boot.blockedInstall])
        }
        expect(language.store2Boot.blockedInstall).toBe('Setting up the new storage started but did not finish. Nothing was deleted. RisuTanium decides what to do the next time it starts.')
    })

    test('a reason the converter reports outside the union is unclassified and says it cannot tell what was written', () => {
        const model = blockedScreen({ reason: 'unclassified', detail: 'weird', mayHaveWritten: false })
        expect(model.paragraphs).toEqual([language.store2Boot.blockedUnknown])
    })
})

describe('terminal screens and notices', () => {
    test('the stopped, offer and too-new screens each have one Reload button; only the offer screen focuses the heading', () => {
        expect(stoppedScreen().buttons).toEqual([{ key: 'reload', label: language.store2Boot.reload }])
        expect(stoppedScreen().focus).toBe('reload')
        expect(tooNewScreen().focus).toBe('reload')
        const offer = offerScreen([100, 300, 200])
        expect(offer.buttons.map((button) => button.key)).toEqual(['reload'])
        expect(offer.focus).toBeNull()
        expect(offer.paragraphs[0]).toBe(language.store2Boot.offerBody(3, backupDate(300)))
        expect(offer.paragraphs[0]).toContain('3 backup files')
    })

    test('the offer screen says "1 backup file" for a single backup', () => {
        const body = offerScreen([300]).paragraphs[0]
        expect(body).toContain('1 backup file ')
        expect(body).not.toContain('backup files')
    })

    test('every notice the dispatch raises has its text, except the one that ends the boot', () => {
        const notices: Store2BootNotice[] = [
            { name: 'seeded' },
            { name: 'cleanup-blocked' },
            { name: 'reflush-failed', detail: 'd' },
            { name: 'flush-unconfirmed' },
            { name: 'server-capability', detail: 'd' },
            { name: 'backend-unavailable', detail: 'd' },
            { name: 'converted-from-backup', backup: 17_000_000_000 },
        ]
        const texts = notices.map((notice) => noticeText(notice))
        expect(texts.every((text) => typeof text === 'string' && text.length > 0)).toBe(true)
        expect(new Set(texts).size).toBe(notices.length)
        expect(noticeText({ name: 'too-new', source: 'tree', detail: 'd' })).toBeNull()
        expect(texts[6]).toContain(backupDate(17_000_000_000))
    })

    test('the seeded notice tells the person an empty profile was created (W3-Q4)', () => {
        expect(noticeText({ name: 'seeded' })).toBe(language.store2Boot.noticeSeeded)
        expect(language.store2Boot.noticeSeeded).toMatch(/new empty profile/)
    })
})
