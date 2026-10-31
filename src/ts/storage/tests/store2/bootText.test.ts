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
    BLOCKED_TABLE, BOOT_LANGUAGES, backupDate, blockedBeforeWrite, blockedScreen, bootLanguage, confirmConvertScreen, confirmConvertWithoutScreen,
    confirmFlaggedOpenScreen, confirmFromBackupScreen, confirmIncompleteScreen, declinedScreen, displayName, flaggedLists,
    foreignMarkerScreen, incompleteList, noticeText, offerScreen, pickButtonKey, pickedManifestKey, recoveryBlockedBeforeWriteScreen,
    recoveryChangedScreen, recoveryCheckingScreen, recoveryFreshScreen, recoveryInstalledScreen, recoveryInstallScreen,
    recoveryNoticeScreen, recoveryOffersScreen, recoveryOlderBackupScreen, recoveryPickScreen, recoveryRestoreScreen, recoveryUnconfirmedScreen, recoveryUnexpectedScreen,
    recoveryTooNewScreen, recoveryWaitScreen, recoveryWorkingScreen, skippedList, stoppedScreen, tooNewScreen,
    type BootQuestion, type BootScreenModel, type RecoveryNotice,
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

    test('a skipped chats entry has its own label: neither the generic one nor its internal name', () => {
        const list = skippedList([{ name: 'characters[0].chats', kind: 'chats', reason: 'x' }])

        expect(list.items).toEqual([language.store2Boot.skippedChats])
        expect(language.store2Boot.skippedChats).toBe('Chats that could not be read')
        expect(language.store2Boot.skippedChats).not.toBe(language.store2Boot.skippedOther)
        expect(list.items.join('\n')).not.toContain('characters[0]')
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
    function chat(chaId: string, chatId: string, part: 'core' | 'chunk' | 'alt', why: 'missing' | 'damaged', name = 'Ann'): FlaggedItem {
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

    test('a chat whose only flags are alternatives says its conversation is intact; any other flag on the chat uses the plain line (new-rule guard)', () => {
        const text = language.store2Boot
        const [alone] = flaggedLists([chat('c1', '~0', 'alt', 'damaged'), chat('c1', '~0', 'alt', 'missing')])
        expect(alone.items).toEqual([text.flaggedChatAltLine(text.flaggedChatPosition(1), text.flaggedBoth)])
        expect(alone.items[0]).toContain('conversation itself is intact')
        const [mixed] = flaggedLists([chat('c1', '~0', 'alt', 'damaged'), chat('c1', '~0', 'chunk', 'damaged')])
        expect(mixed.items).toEqual([text.flaggedChatLine(text.flaggedChatPosition(1), text.flaggedDamaged, 2)])
        const [separate] = flaggedLists([chat('c1', '~0', 'alt', 'damaged'), chat('c1', '~1', 'core', 'damaged')])
        expect(separate.items).toEqual([
            text.flaggedChatAltLine(text.flaggedChatPosition(1), text.flaggedDamaged),
            text.flaggedChatLine(text.flaggedChatPosition(2), text.flaggedDamaged, 1),
        ])
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
        expect(BLOCKED_REASONS).not.toContain('unclassified')
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
})

describe('terminal screens and notices', () => {
    test('the stopped and too-new screens each have one Reload button', () => {
        expect(stoppedScreen().buttons).toEqual([{ key: 'reload', label: language.store2Boot.reload }])
        expect(stoppedScreen().focus).toBe('reload')
        expect(tooNewScreen().focus).toBe('reload')
    })

    test('the offer screen (MC-299 3, B3-Q2) has two acting buttons, focuses the heading and never claims a main file existed', () => {
        const offer = offerScreen([100, 300, 200])
        expect(offer.model.buttons).toEqual([
            { key: 'offerRestoreNewest', label: language.store2Boot.offerRestoreNewest(backupDate(300)) },
            { key: 'offerImport', label: language.store2Boot.offerImport },
        ])
        expect(offer.answers).toEqual({ offerRestoreNewest: 'restore-newest', offerImport: 'import' })
        expect(offer.model.focus).toBeNull()
        expect(offer.model.paragraphs[0]).toBe(language.store2Boot.offerBody(3, backupDate(300)))
        expect(offer.model.paragraphs[0]).toContain('3 backup files')
        expect(offer.model.paragraphs.join(' ')).not.toMatch(/main (save )?file (could not|was)/i)
    })

    test('the offer screen says "1 backup file" for a single backup', () => {
        const body = offerScreen([300]).model.paragraphs[0]
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
            { name: 'archive-enabled' },
            { name: 'restored-from-backup', backup: 17_000_000_000, newest: 17_000_000_000 },
            { name: 'restored-from-backup', backup: 16_000_000_000, newest: 17_000_000_000 },
        ]
        const texts = notices.map((notice) => noticeText(notice))
        expect(texts.every((text) => typeof text === 'string' && text.length > 0)).toBe(true)
        expect(new Set(texts).size).toBe(notices.length)
        expect(noticeText({ name: 'too-new', source: 'tree', detail: 'd' })).toBeNull()
        expect(texts[6]).toContain(backupDate(17_000_000_000))
        // MC-299 8: a restore names the backup used, and an older one is named as a fallback from the newest.
        expect(texts[8]).toContain(backupDate(17_000_000_000))
        expect(texts[9]).toContain(backupDate(16_000_000_000))
        expect(texts[9]).toContain(backupDate(17_000_000_000))
        expect(texts[8]).not.toMatch(/main save file could not be read/)
    })

    test('the archiving notice is the text the block store\'s boot pass has always shown, with no string of its own', () => {
        expect(noticeText({ name: 'archive-enabled' })).toBe(language.archiveCharactersNotice(language.settings, language.advancedSettings, language.coldStorage))
    })

    test('the seeded notice tells the person an empty profile was created (W3-Q4)', () => {
        expect(noticeText({ name: 'seeded' })).toBe(language.store2Boot.noticeSeeded)
        expect(language.store2Boot.noticeSeeded).toMatch(/new empty profile/)
    })
})

describe('the recovery screens', () => {
    const text = () => language.store2Boot
    const MANIFEST = 'store2/m-0000a1234567890123456789ab'

    test('the saved versions are rows keyed by their store key; every other key is not a row', () => {
        expect(pickedManifestKey(pickButtonKey(MANIFEST))).toBe(MANIFEST)
        expect(pickedManifestKey('recoveryShowOlder')).toBeNull()
        const model = recoveryOffersScreen({ shown: [MANIFEST, 'store2/zzz'], hasOlder: true, listFailed: null, offers: { convert: true, freshStart: true } })
        expect(model.rows?.map((row) => row.key)).toEqual([pickButtonKey(MANIFEST), pickButtonKey('store2/zzz')])
        expect(model.rows?.[1].label).toBe(text().recoverySavedUnknownTime)
        expect(model.rows?.[0].label).toMatch(/^Saved /)
        expect(model.focus).toBeNull()
    })

    test('the offers appear only when the controller offers them, in a fixed order, and a failed listing says so', () => {
        const all = recoveryOffersScreen({ shown: [], hasOlder: true, listFailed: null, offers: { convert: true, freshStart: true } })
        expect(all.buttons.map((button) => button.key)).toEqual(['recoveryShowOlder', 'recoveryConvertOffer', 'recoveryFreshOffer'])
        const none = recoveryOffersScreen({ shown: [], hasOlder: false, listFailed: null, offers: { convert: false, freshStart: false } })
        expect(none.buttons).toEqual([])
        expect(none.paragraphs).toContain(text().recoveryNoCandidates)
        const failed = recoveryOffersScreen({ shown: [], hasOlder: false, listFailed: 'the listing failed', offers: { convert: false, freshStart: true } })
        expect(failed.paragraphs).toContain(text().recoveryListFailed)
        expect(failed.paragraphs).not.toContain(text().recoveryNoCandidates)
        expect(failed.details).toBe('the listing failed')
    })

    test('the restore-newest offer replaces the convert offer, and the import button follows it (B3-Q6)', () => {
        const restore = recoveryOffersScreen({ shown: [], hasOlder: false, listFailed: null, offers: { convert: true, restoreNewest: true, import: true, freshStart: true } })
        expect(restore.buttons.map((button) => button.key)).toEqual(['recoveryRestoreOffer', 'recoveryImportOffer', 'recoveryFreshOffer'])
        const convert = recoveryOffersScreen({ shown: [], hasOlder: false, listFailed: null, offers: { convert: true, restoreNewest: false, import: true, freshStart: false } })
        expect(convert.buttons.map((button) => button.key)).toEqual(['recoveryConvertOffer', 'recoveryImportOffer'])
    })

    test('the restore confirmation names the newest backup, never claims a main file existed, and has Cancel first and focused', () => {
        const question = recoveryRestoreScreen(17_000_000_000, false)
        expect(keysOf(question)).toEqual(['recoveryCancel', 'recoveryRestoreGo'])
        expect(question.model.focus).toBe('recoveryCancel')
        expect(question.model.title).toContain(backupDate(17_000_000_000))
        expect(question.model.paragraphs.join(' ')).not.toMatch(/main save file could not be read/)
    })

    test('the restore confirmation says "no main save file" only when that is known, and the older-backup question names both dates', () => {
        expect(recoveryRestoreScreen(17_000_000_000, false).model.paragraphs.join(' ')).toContain('no main save file')
        expect(recoveryRestoreScreen(17_000_000_000, null).model.paragraphs.join(' ')).not.toContain('no main save file')
        const older = recoveryOlderBackupScreen(17_000_000_000, 16_000_000_000)
        expect(keysOf(older)).toEqual(['recoveryCancel', 'recoveryOlderGo'])
        expect(older.model.focus).toBe('recoveryCancel')
        const shown = JSON.stringify(older.model)
        expect(shown).toContain(backupDate(17_000_000_000))
        expect(shown).toContain(backupDate(16_000_000_000))
    })

    test('every confirmation has Cancel first and focused, and only the second button agrees', () => {
        const questions: [string, BootQuestion<boolean>, string][] = [
            ['pick', recoveryPickScreen(MANIFEST), 'recoveryPickGo'],
            ['install', recoveryInstallScreen({ checked: true, missingImages: 0, missingInlays: 0, unknownLists: 0 }, null), 'recoveryInstallGo'],
            ['fresh', recoveryFreshScreen(), 'recoveryFreshGo'],
        ]
        for (const [name, question, go] of questions) {
            expect(keysOf(question), name).toEqual(['recoveryCancel', go])
            expect(question.model.focus, name).toBe('recoveryCancel')
            expect(question.answers, name).toEqual({ recoveryCancel: false, [go]: true })
        }
        expect(recoveryPickScreen(MANIFEST).model.paragraphs).toEqual([text().recoveryPickBody])
        expect(recoveryFreshScreen().model.paragraphs).toEqual([text().recoveryFreshBody])
    })

    test('the checking screen has Skip from its first frame, nothing else, and focus on the heading', () => {
        const model = recoveryCheckingScreen()
        expect(model.buttons).toEqual([{ key: 'recoveryCheckSkip', label: text().recoveryCheckSkip }])
        expect(model.focus).toBeNull()
        expect(model.paragraphs).toEqual([text().recoveryChecking])
    })

    describe('the install confirmation in its states', () => {
        test('counted: exact images, "up to" inlays, and no uncertainty sentence when every list was read', () => {
            const model = recoveryInstallScreen({ checked: true, missingImages: 3, missingInlays: 2, unknownLists: 0 }, null).model
            expect(model.paragraphs).toEqual([text().recoveryInstallBody, '3 images this version refers to could not be found.', 'Up to 2 inlays this version refers to could not be found.'])
        })

        test('counted with nothing missing says so, in words', () => {
            const model = recoveryInstallScreen({ checked: true, missingImages: 0, missingInlays: 0, unknownLists: 0 }, null).model
            expect(model.paragraphs.slice(1)).toEqual([text().recoveryMissingImages(0), text().recoveryMissingInlays(0)])
            expect(text().recoveryMissingImages(1)).toBe('1 image this version refers to could not be found.')
            expect(text().recoveryMissingInlays(1)).toBe('Up to 1 inlay this version refers to could not be found.')
        })

        test('counted with lists that could not be checked adds the sentence and says the counts may be incomplete', () => {
            const model = recoveryInstallScreen({ checked: true, missingImages: 1, missingInlays: 1, unknownLists: 4 }, null).model
            expect(model.paragraphs.slice(-2)).toEqual([text().recoveryUnknownLists(4), text().recoveryCountsPartial])
        })

        test('skipped: only the skipped sentence, never the could-not-check one; no number is shown', () => {
            const model = recoveryInstallScreen({ checked: false, unknownLists: 0 }, 'skipped').model
            expect(model.paragraphs).toEqual([text().recoveryInstallBody, text().recoveryCountsSkipped])
            expect(model.paragraphs.join(' ')).not.toMatch(/\d/)
        })

        test('could not check: only the could-not-check sentence, no number, and install is still the second button', () => {
            const question = recoveryInstallScreen({ checked: false, unknownLists: 0 }, 'list-failed')
            expect(question.model.paragraphs).toEqual([text().recoveryInstallBody, text().recoveryCountsUnchecked])
            expect(question.model.paragraphs.join(' ')).not.toMatch(/\d/)
            expect(question.answers.recoveryInstallGo).toBe(true)
            // An unchecked result with no recorded cause is told as a failure, never as a skip.
            expect(recoveryInstallScreen({ checked: false, unknownLists: 0 }, null).model.paragraphs).not.toContain(text().recoveryCountsSkipped)
        })

        test('unchecked with lists that could not be checked names them but does not call the (absent) counts incomplete', () => {
            const model = recoveryInstallScreen({ checked: false, unknownLists: 2 }, 'list-failed').model
            expect(model.paragraphs).toContain(text().recoveryUnknownLists(2))
            expect(model.paragraphs).not.toContain(text().recoveryCountsPartial)
        })
    })

    test('the ended screens have Reload as their only button, focus on it, and the texts the design names', () => {
        const ended: [string, BootScreenModel, string[]][] = [
            ['changed', recoveryChangedScreen(), ['This profile may have been changed somewhere else. Reload to continue.']],
            ['unexpected', recoveryUnexpectedScreen('boom'), [text().recoveryUnexpected]],
            ['unconfirmed', recoveryUnconfirmedScreen(), [text().recoveryUnknown]],
            ['wait', recoveryWaitScreen(), [text().recoveryWaitBody]],
            ['too new', recoveryTooNewScreen(), [text().recoveryTooNewBody]],
        ]
        for (const [name, model, paragraphs] of ended) {
            expect(model.buttons.map((button) => button.key), name).toEqual(['reload'])
            expect(model.focus, name).toBe('reload')
            expect(model.paragraphs, name).toEqual(paragraphs)
        }
        expect(recoveryUnexpectedScreen('boom').details).toContain('boom')
        expect(text().recoveryUnexpected).not.toMatch(/nothing was changed/i)
        expect(text().recoveryUnknown).not.toMatch(/nothing was changed/i)
        for (const body of [text().recoveryWaitBody, text().recoveryTooNewBody]) {
            expect(body).not.toMatch(/nothing was changed|changed nothing/i)
        }
        expect(recoveryWaitScreen().title).toBe(text().recoveryStoppedTitle)
        expect(recoveryTooNewScreen().title).toBe(text().tooNewTitle)
    })

    test('the working and installed screens have no button', () => {
        expect(recoveryWorkingScreen().buttons).toEqual([])
        expect(recoveryInstalledScreen().buttons).toEqual([])
    })

    test('the notice screens: Back first and focused, and Try again only where a retry is safe', () => {
        const retryable: RecoveryNotice[] = [{ kind: 'fence-not-durable' }, { kind: 'fence-failed' }, { kind: 'exit-failed' }, { kind: 'install-failed', detail: 'd' }]
        for (const notice of retryable) {
            const question = recoveryNoticeScreen(notice)
            expect(keysOf(question), notice.kind).toEqual(['recoveryBack', 'recoveryRetry'])
            expect(question.model.focus, notice.kind).toBe('recoveryBack')
        }
        const final: RecoveryNotice[] = [
            { kind: 'not-offered', reason: 'listing-failed', detail: 'd' },
            { kind: 'problem', problem: { kind: 'missing', keys: ['k'] }, markerStands: false },
        ]
        for (const notice of final) {
            expect(keysOf(recoveryNoticeScreen(notice)), notice.kind).toEqual(['recoveryBack'])
        }
    })

    test('a problem names its kind, adds that the profile stays in recovery only when a marker stands, and lists keys in English', () => {
        const missing = { kind: 'missing', keys: Array.from({ length: 25 }, (_, index) => `store2/u-${index}`) } as const
        const standing = recoveryNoticeScreen({ kind: 'problem', problem: missing, markerStands: true }).model
        expect(standing.paragraphs).toEqual([text().recoveryProblemMissing, text().recoveryStaysInRecovery])
        expect(standing.details).toContain('store2/u-0')
        expect(standing.details).toContain('and 5 more')
        const none = recoveryNoticeScreen({ kind: 'problem', problem: { kind: 'damaged', key: 'store2/u-x', reason: 'bad frame' }, markerStands: false }).model
        expect(none.paragraphs).toEqual([text().recoveryProblemDamaged])
        expect(none.details).toContain('bad frame')
    })

    test('a stop before the marker names its reason and that this step wrote nothing, and never "Nothing was changed"', () => {
        const model = recoveryBlockedBeforeWriteScreen({ reason: 'convert-read-failed', detail: 'x' }).model
        expect(model.paragraphs).toEqual([text().blockedRead, text().recoveryStepNothingWritten])
        expect(model.paragraphs).not.toContain(text().blockedNothingChanged)
        expect(model.buttons.map((button) => button.key)).toEqual(['recoveryBack'])
    })

    test('whether a reason is a before-write one is read from the table, one answer per reason', () => {
        for (const reason of BLOCKED_REASONS) {
            expect(blockedBeforeWrite(reason), reason).toBe(BLOCKED_TABLE[reason].beforeWrite)
        }
        expect(blockedBeforeWrite('convert-read-failed')).toBe(true)
        expect(blockedBeforeWrite('install-failed')).toBe(false)
    })
})
