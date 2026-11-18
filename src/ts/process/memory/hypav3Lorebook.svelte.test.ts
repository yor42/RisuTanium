/**
 * HypaV3 summaries to and from the open chat's lorebook. Every test here is an acceptance test of a new
 * module: it cannot fail on a base without the module for an assertion reason, so its red evidence is the
 * mutant kill list, not a pre-fix run. (G) marks a guard of pre-existing behavior that may pass before and
 * after the feature. Fixtures have the shapes the real producers make: summaries as the memory run creates
 * them, lorebook entries as the lorebook UI creates them (plain entry, folder, "active in this chat" link).
 *
 * MOCKED: `stores.svelte` (a `$state` database), the alert module and `characterSaveMarks` (spies). The
 * write-hook test installs the real explicit write hook on that `$state` root with a sink spy.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, loreBook } from 'src/ts/storage/database.svelte'
import type { SerializableSummary } from './hypav3'
import type { OpenAIChat } from '../index.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
    markDbWrite: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

import { DBState } from 'src/ts/stores.svelte'
import { alertConfirm, alertNormal } from 'src/ts/alert'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { describeDbWriteMark, installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { findResumeIndex } from './hypaResume'
import {
    exportSummariesToChatLore,
    importChatLoreAsSummaries,
    planLoreImport,
    planSummaryExport,
} from './hypav3Lorebook'

//#region fixtures

const commentOf = (n: number): string => `S#${n}`

/** A summary as the memory run creates it, with tags added the way the tag manager adds them. */
function summary(text: string, over: Partial<SerializableSummary> = {}): SerializableSummary {
    return { text, chatMemos: [], isImportant: false, categoryId: undefined, tags: [], ...over }
}

/** A plain lorebook entry as `addLorebook` makes it. */
function entry(content: string, over: Partial<loreBook> = {}): loreBook {
    return { key: '', comment: '', content, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, ...over }
}

function folder(id: string): loreBook {
    return entry('', { key: 'folder:' + id, mode: 'folder', id })
}

/** An "active in this chat" link as `activateLocally` makes it. */
function link(id: string): loreBook {
    return entry('', { key: 'folder:' + id, mode: 'child', alwaysActive: true, id })
}

type ChatFixture = {
    id: string
    message: { chatId: string }[]
    localLore: loreBook[]
    hypaV3Data?: {
        summaries: SerializableSummary[]
        categories?: { id: string; name: string }[]
        metrics?: {
            lastImportantSummaries: number[]
            lastRecentSummaries: number[]
            lastSimilarSummaries: number[]
            lastRandomSummaries: number[]
        }
    }
}

function installDb(chat: Partial<ChatFixture> = {}): void {
    const full: ChatFixture = {
        id: 'chat',
        message: [],
        localLore: [],
        hypaV3Data: { summaries: [], categories: [{ id: '', name: 'Unclassified' }] },
        ...chat,
    }
    DBState.db = { characters: [{ chaId: 'c0', name: 'c0', chatPage: 0, chats: [full] }] } as unknown as Database
}

function target() {
    const char = DBState.db.characters[0]
    return { char, chat: char.chats[0] }
}

//#endregion

beforeEach(() => {
    vi.mocked(alertConfirm).mockReset().mockResolvedValue(true)
    vi.mocked(alertNormal).mockReset()
    vi.mocked(markCharacterForSave).mockReset()
})

afterEach(() => {
    uninstallDbWriteHook()
})

describe('planSummaryExport', () => {
    const categories = [{ id: '', name: 'Unclassified' }, { id: 'cat_1', name: 'Places' }]

    test('E1 key is the trimmed tags then the category name; every other field is as mapped', () => {
        const data = { summaries: [summary('The harbor.', { tags: ['harbor', ' Mina '], categoryId: 'cat_1' })], categories }
        const { entries, skipped } = planSummaryExport(data, [], commentOf)
        expect(skipped).toBe(0)
        expect(entries).toEqual([{
            key: 'harbor, Mina, Places', secondkey: '', insertorder: 100, comment: 'S#1',
            content: 'The harbor.', mode: 'normal', alwaysActive: false, selective: false,
        }])
    })

    test('E2 no tags and no category, or the uncategorized id, gives an empty key and not always active', () => {
        const data = { summaries: [summary('a'), summary('b', { categoryId: '' })], categories }
        const { entries } = planSummaryExport(data, [], commentOf)
        expect(entries.map((e) => [e.key, e.alwaysActive])).toEqual([['', false], ['', false]])
    })

    test('E3 blank and repeated keywords are dropped; a category id missing from the list adds nothing', () => {
        const data = {
            summaries: [
                summary('a', { tags: ['  ', 'Places', 'x', ' x'], categoryId: 'cat_1' }),
                summary('b', { tags: ['y'], categoryId: 'cat_9' }),
            ],
            categories,
        }
        const { entries } = planSummaryExport(data, [], commentOf)
        expect(entries.map((e) => e.key)).toEqual(['Places, x', 'y'])
    })

    test('E4 only new entries are returned; existing lore is not part of the plan', () => {
        const existing = [entry('old one'), entry('old two')]
        const { entries } = planSummaryExport({ summaries: [summary('new')], categories }, existing, commentOf)
        expect(entries.map((e) => e.content)).toEqual(['new'])
    })

    test('E5 an existing entry with the same trimmed text is skipped and counted', () => {
        const { entries, skipped } = planSummaryExport({ summaries: [summary('text'), summary('other')], categories }, [entry('  text\n')], commentOf)
        expect(entries.map((e) => e.content)).toEqual(['other'])
        expect(skipped).toBe(1)
    })

    test('E6 two summaries with the same text export once', () => {
        const { entries, skipped } = planSummaryExport({ summaries: [summary('same'), summary(' same ')], categories }, [], commentOf)
        expect(entries).toHaveLength(1)
        expect(skipped).toBe(1)
    })

    test('E7 a summary with blank text is neither exported nor counted', () => {
        const { entries, skipped } = planSummaryExport({ summaries: [summary(''), summary('  \n')], categories }, [], commentOf)
        expect(entries).toEqual([])
        expect(skipped).toBe(0)
    })

    test('E8 the comment numbers the summary by its position, including skipped ones', () => {
        const { entries } = planSummaryExport({ summaries: [summary('a'), summary('b')], categories }, [entry('a')], commentOf)
        expect(entries.map((e) => e.comment)).toEqual(['S#2'])
    })
})

describe('planLoreImport', () => {
    // compatibility guard: passes before and after (an imported summary has no creation time)
    test('imported summaries carry no creation time', () => {
        const result = planLoreImport([entry('The harbor.', { key: 'harbor' }), entry('Second', { key: 'x' })], [])
        expect(result.summaries).toHaveLength(2)
        for (const s of result.summaries) expect('createdAt' in s).toBe(false)
    })

    test('I1 an entry becomes a summary with verbatim text, no memos, not important, tags from its keys, no category', () => {
        const result = planLoreImport([entry('The harbor.', { key: 'harbor, Mina' }), entry('Second', { key: 'x' })], [])
        expect(result.skipped).toBe(0)
        expect(result.summaries).toEqual([
            { text: 'The harbor.', chatMemos: [], isImportant: false, tags: ['harbor', 'Mina'] },
            { text: 'Second', chatMemos: [], isImportant: false, tags: ['x'] },
        ])
        expect('categoryId' in result.summaries[0]).toBe(false)
        expect(result.summaries[0].chatMemos).not.toBe(result.summaries[1].chatMemos)
        expect(result.summaries[0].tags).not.toBe(result.summaries[1].tags)
    })

    test('I3 folders, links and entries without text are ignored; an entry inside a folder is taken', () => {
        const result = planLoreImport([folder('f1'), link('l1'), entry('   '), entry('inside', { folder: 'folder:f1' })], [])
        expect(result.summaries.map((s) => s.text)).toEqual(['inside'])
        expect(result.skipped).toBe(0)
    })

    test('I3b a folder or link entry is ignored by its mode even when it carries text', () => {
        const result = planLoreImport([folder('f1'), link('l1')].map((e) => ({ ...e, content: 'text' })), [])
        expect(result.summaries).toEqual([])
        expect(result.skipped).toBe(0)
    })

    test('I4 text already present as a summary, or earlier in the batch, is skipped and counted', () => {
        const result = planLoreImport([entry(' have '), entry('new'), entry('new\n')], [summary('have')])
        expect(result.summaries.map((s) => s.text)).toEqual(['new'])
        expect(result.skipped).toBe(2)
    })

    test('I5 regex-mode keys keep a comma inside /pattern/flags (the real splitLoreKeys)', () => {
        const result = planLoreImport([entry('t', { key: '/a,b/i, c', useRegex: true })], [])
        expect(result.summaries[0].tags).toEqual(['/a,b/i', 'c'])
    })
})

describe('round trip', () => {
    const categories = [{ id: '', name: 'Unclassified' }, { id: 'cat_1', name: 'Places' }]

    test('C3 export then import adds nothing; import then export adds nothing', () => {
        const summaries = [summary('one', { tags: ['a'] }), summary('two', { categoryId: 'cat_1' })]
        const exported = planSummaryExport({ summaries, categories }, [], commentOf).entries
        expect(planLoreImport(exported, summaries).summaries).toEqual([])

        const lore = [entry('three', { key: 'k' })]
        const imported = planLoreImport(lore, []).summaries
        expect(planSummaryExport({ summaries: imported, categories }, lore, commentOf).entries).toEqual([])
    })
})

describe('resume points', () => {
    const chats: OpenAIChat[] = [
        { role: 'user', content: 'a', memo: 'm1' },
        { role: 'assistant', content: 'b', memo: 'm2' },
        { role: 'user', content: 'c', memo: 'm3' },
    ]

    function memoSets(list: SerializableSummary[]): string[][] {
        return list.map((s) => s.chatMemos)
    }

    test('C1 (G) the fork resume point is the same after an import (pre-existing function; empty memo sets add nothing)', () => {
        const existing = [summary('s1', { chatMemos: ['m1', 'm2'] })]
        const before = findResumeIndex(chats, memoSets(existing))
        const imported = planLoreImport([entry('x'), entry('y')], existing).summaries
        expect(findResumeIndex(chats, memoSets([...imported, ...existing]))).toBe(before)
        expect(before).toBe(1)
    })

    test('C1b (G) with no existing summary the fork resume point stays -1', () => {
        const imported = planLoreImport([entry('x')], []).summaries
        expect(findResumeIndex(chats, memoSets(imported))).toBe(-1)
    })

    test('C2 (G) upstream resumes from the last memo of the last summary: with an existing summary holding memos it is unchanged by the import', async () => {
        installDb({ hypaV3Data: { summaries: [summary('s1', { chatMemos: ['m1', 'm2'] })] }, localLore: [entry('x'), entry('y')] })
        const { char, chat } = target()
        const lastMemo = (): string | undefined => [...chat.hypaV3Data!.summaries.at(-1)!.chatMemos].at(-1)
        const before = lastMemo()
        await importChatLoreAsSummaries(char, chat)
        expect(chat.hypaV3Data!.summaries).toHaveLength(3)
        expect(lastMemo()).toBe(before)
        expect(before).toBe('m2')
    })

    test('C2b (G) with no existing summary the last summary has no memo, which upstream matches to the first memo-less chat', async () => {
        installDb({ localLore: [entry('x')] })
        const { char, chat } = target()
        await importChatLoreAsSummaries(char, chat)
        const lastMemo = [...chat.hypaV3Data!.summaries.at(-1)!.chatMemos].at(-1)
        expect(lastMemo).toBeUndefined()
        // The upstream rule: findIndex(chat.memo === lastMemo). A memo-less greeting matches; chats with memos do not.
        expect(chats.findIndex((c) => c.memo === lastMemo)).toBe(-1)
        expect([{ role: 'assistant', content: 'hi' } as OpenAIChat, ...chats].findIndex((c) => c.memo === lastMemo)).toBe(0)
    })
})

describe('export runner', () => {
    test('R1 confirm yes: the entries are appended after the existing ones, the character is marked once, the done text is shown', async () => {
        installDb({
            localLore: [entry('old')],
            hypaV3Data: { summaries: [summary('s1', { tags: ['t'] }), summary('s2')], categories: [{ id: '', name: 'Unclassified' }] },
        })
        const { char, chat } = target()
        const oldEntry = chat.localLore[0]
        expect(await exportSummariesToChatLore(char, chat)).toBe(2)
        expect(chat.localLore.map((e) => e.content)).toEqual(['old', 's1', 's2'])
        expect(chat.localLore[0]).toBe(oldEntry)
        expect(chat.localLore[1].key).toBe('t')
        expect(markCharacterForSave).toHaveBeenCalledTimes(1)
        expect(markCharacterForSave).toHaveBeenCalledWith('c0')
        expect(alertNormal).toHaveBeenCalledWith(fillLang(language.hypaV3Modal.exportToLorebookDone, { count: 2 }))
    })

    test('R1b a chat whose lorebook is not an array gets a new array', async () => {
        installDb({ localLore: undefined, hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        await exportSummariesToChatLore(char, chat)
        expect(chat.localLore.map((e) => e.content)).toEqual(['s1'])
    })

    test('R3 the chat or the character removed while the dialog is open: nothing is written or marked', async () => {
        for (const remove of [
            () => { DBState.db.characters[0].chats = [] },
            () => { DBState.db.characters = [] },
        ]) {
            installDb({ hypaV3Data: { summaries: [summary('s1')] } })
            const { char, chat } = target()
            vi.mocked(alertConfirm).mockImplementationOnce(async () => { remove(); return true })
            await exportSummariesToChatLore(char, chat)
            expect(chat.localLore).toEqual([])
            expect(markCharacterForSave).not.toHaveBeenCalled()
            expect(alertNormal).not.toHaveBeenCalled()
        }
    })

    test('R4 a matching entry added while the dialog is open is not duplicated; the done count is the recomputed one', async () => {
        installDb({ hypaV3Data: { summaries: [summary('s1'), summary('s2')] } })
        const { char, chat } = target()
        vi.mocked(alertConfirm).mockImplementationOnce(async () => { chat.localLore.push(entry('s1')); return true })
        await exportSummariesToChatLore(char, chat)
        expect(chat.localLore.map((e) => e.content)).toEqual(['s1', 's2'])
        expect(alertNormal).toHaveBeenCalledWith(fillLang(language.hypaV3Modal.exportToLorebookDone, { count: 1 }))
    })

    test('R5 confirm no: nothing is written, marked or announced', async () => {
        installDb({ hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        expect(await exportSummariesToChatLore(char, chat)).toBe(0)
        expect(chat.localLore).toEqual([])
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('R6 nothing new: the Nothing text is shown without a confirm, a write or a mark', async () => {
        installDb({ localLore: [entry('s1')], hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        expect(await exportSummariesToChatLore(char, chat)).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertNormal).toHaveBeenCalledWith(language.hypaV3Modal.exportToLorebookNothing)
        expect(chat.localLore).toHaveLength(1)
        expect(markCharacterForSave).not.toHaveBeenCalled()
    })

    test('R7 no chat, or no summary data: returns without a dialog', async () => {
        installDb({ hypaV3Data: undefined })
        const { char, chat } = target()
        expect(await exportSummariesToChatLore(char, undefined)).toBe(0)
        expect(await exportSummariesToChatLore(char, chat)).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('R8 the skipped note is part of the confirm only when something is skipped', async () => {
        installDb({ localLore: [entry('s1')], hypaV3Data: { summaries: [summary('s1'), summary('s2')] } })
        let { char, chat } = target()
        await exportSummariesToChatLore(char, chat)
        const withNote = vi.mocked(alertConfirm).mock.calls[0][0]
        expect(withNote).toContain(fillLang(language.hypaV3Modal.lorebookTransferSkippedNote, { skipped: 1 }))
        expect(withNote).toContain(fillLang(language.hypaV3Modal.exportToLorebookConfirm, { count: 1 }))

        installDb({ hypaV3Data: { summaries: [summary('s1')] } })
        ;({ char, chat } = target())
        await exportSummariesToChatLore(char, chat)
        const withoutNote = vi.mocked(alertConfirm).mock.calls[1][0]
        expect(withoutNote).toBe(fillLang(language.hypaV3Modal.exportToLorebookConfirm, { count: 1 }))
    })
})

describe('import runner', () => {
    const metrics = () => ({
        lastImportantSummaries: [0],
        lastRecentSummaries: [1, 0],
        lastSimilarSummaries: [1],
        lastRandomSummaries: [],
    })

    test('R2 confirm yes: new summaries go before the existing ones, which stay the same objects; the character is marked once', async () => {
        installDb({
            localLore: [entry('x', { key: 'k' }), entry('y')],
            hypaV3Data: { summaries: [summary('s1', { chatMemos: ['m1'] }), summary('s2', { chatMemos: ['m2'] })] },
        })
        const { char, chat } = target()
        const [first, second] = chat.hypaV3Data!.summaries
        expect(await importChatLoreAsSummaries(char, chat)).toBe(2)
        const list = chat.hypaV3Data!.summaries
        expect(list.map((s) => s.text)).toEqual(['x', 'y', 's1', 's2'])
        expect(list[2]).toBe(first)
        expect(list[3]).toBe(second)
        expect(first.chatMemos).toEqual(['m1'])
        expect(markCharacterForSave).toHaveBeenCalledTimes(1)
        expect(markCharacterForSave).toHaveBeenCalledWith('c0')
        expect(alertNormal).toHaveBeenCalledWith(fillLang(language.hypaV3Modal.importFromLorebookDone, { count: 2 }))
    })

    test('I7 the metrics indices shift by the number added and name the same summaries', async () => {
        installDb({
            localLore: [entry('x'), entry('y')],
            hypaV3Data: { summaries: [summary('s1'), summary('s2')], metrics: metrics() },
        })
        const { char, chat } = target()
        const data = chat.hypaV3Data!
        const textsOf = (key: keyof ReturnType<typeof metrics>): string[] => data.metrics![key].map((i) => data.summaries[i].text)
        const before = (['lastImportantSummaries', 'lastRecentSummaries', 'lastSimilarSummaries', 'lastRandomSummaries'] as const).map(textsOf)
        await importChatLoreAsSummaries(char, chat)
        const after = (['lastImportantSummaries', 'lastRecentSummaries', 'lastSimilarSummaries', 'lastRandomSummaries'] as const).map(textsOf)
        expect(after).toEqual(before)
        expect(data.metrics!.lastRecentSummaries).toEqual([3, 2])
    })

    test('I8 metrics undefined: the import adds the summaries and does not throw', async () => {
        installDb({ localLore: [entry('x')], hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        await expect(importChatLoreAsSummaries(char, chat)).resolves.toBe(1)
        expect(chat.hypaV3Data!.summaries.map((s) => s.text)).toEqual(['x', 's1'])
        expect(chat.hypaV3Data!.metrics).toBeUndefined()
    })

    test('R3i the chat removed while the dialog is open: nothing is written or marked', async () => {
        installDb({ localLore: [entry('x')], hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        vi.mocked(alertConfirm).mockImplementationOnce(async () => { DBState.db.characters[0].chats = []; return true })
        await importChatLoreAsSummaries(char, chat)
        expect(chat.hypaV3Data!.summaries.map((s) => s.text)).toEqual(['s1'])
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('R4i a matching summary added while the dialog is open is not duplicated', async () => {
        installDb({ localLore: [entry('x'), entry('y')], hypaV3Data: { summaries: [] } })
        const { char, chat } = target()
        vi.mocked(alertConfirm).mockImplementationOnce(async () => { chat.hypaV3Data!.summaries.push(summary('x')); return true })
        await importChatLoreAsSummaries(char, chat)
        expect(chat.hypaV3Data!.summaries.map((s) => s.text)).toEqual(['y', 'x'])
        expect(alertNormal).toHaveBeenCalledWith(fillLang(language.hypaV3Modal.importFromLorebookDone, { count: 1 }))
    })

    test('R5i confirm no: nothing is written, marked or announced', async () => {
        installDb({ localLore: [entry('x')], hypaV3Data: { summaries: [] } })
        const { char, chat } = target()
        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        expect(await importChatLoreAsSummaries(char, chat)).toBe(0)
        expect(chat.hypaV3Data!.summaries).toEqual([])
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('R6i nothing new: the Nothing text is shown without a confirm, a write or a mark', async () => {
        installDb({ localLore: [folder('f'), entry('s1')], hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        expect(await importChatLoreAsSummaries(char, chat)).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertNormal).toHaveBeenCalledWith(language.hypaV3Modal.importFromLorebookNothing)
        expect(markCharacterForSave).not.toHaveBeenCalled()
    })

    test('R7i no chat, or no summary data: returns without a dialog', async () => {
        installDb({ hypaV3Data: undefined })
        const { char, chat } = target()
        expect(await importChatLoreAsSummaries(char, undefined)).toBe(0)
        expect(await importChatLoreAsSummaries(char, chat)).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('R8i the skipped note is part of the confirm only when something is skipped', async () => {
        installDb({ localLore: [entry('s1'), entry('x')], hypaV3Data: { summaries: [summary('s1')] } })
        const { char, chat } = target()
        await importChatLoreAsSummaries(char, chat)
        expect(vi.mocked(alertConfirm).mock.calls[0][0]).toBe(
            fillLang(language.hypaV3Modal.importFromLorebookConfirm, { count: 1 })
            + '\n' + fillLang(language.hypaV3Modal.lorebookTransferSkippedNote, { skipped: 1 }),
        )

        installDb({ localLore: [entry('x')], hypaV3Data: { summaries: [] } })
        const second = target()
        await importChatLoreAsSummaries(second.char, second.chat)
        expect(vi.mocked(alertConfirm).mock.calls[1][0]).toBe(fillLang(language.hypaV3Modal.importFromLorebookConfirm, { count: 1 }))
    })
})

describe('saving through the real write hook', () => {
    function hookedMarks(): string[] {
        const marks: string[] = []
        installDbWriteHook(DBState, {
            sink: (mark) => { marks.push(describeDbWriteMark(mark)) },
            onError: (error) => { marks.push('error:' + String(error)) },
            selectedChaId: () => undefined,
        })
        return marks
    }

    test('S8 export (a push to localLore) and import (an unshift on summaries) each mark the owning character without the explicit mark', async () => {
        const marks = hookedMarks()
        installDb({
            localLore: [entry('from lore')],
            hypaV3Data: { summaries: [summary('s1')], metrics: { lastImportantSummaries: [0], lastRecentSummaries: [], lastSimilarSummaries: [], lastRandomSummaries: [] } },
        })
        const { char, chat } = target()

        marks.length = 0
        await exportSummariesToChatLore(char, chat)
        expect(chat.localLore.map((e) => e.content)).toEqual(['from lore', 's1'])
        expect(marks).toContain('char:c0')

        marks.length = 0
        // The lore now also holds the exported entry, which equals summary s1 and is skipped.
        await importChatLoreAsSummaries(char, chat)
        expect(chat.hypaV3Data!.summaries.map((s) => s.text)).toEqual(['from lore', 's1'])
        expect(marks).toContain('char:c0')
        expect(marks.filter((m) => m.startsWith('error:'))).toEqual([])
    })
})
