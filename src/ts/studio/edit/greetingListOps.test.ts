// @vitest-environment jsdom
// The pure builders of move, swap and append-many: the chat-follow tables (B1), the ops and writes each builder
// emits, the refusals, and the stale-index pin shared with the single add (B7, B7b).
import { describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'
import { firstMessageOf } from 'src/ts/process/firstMessage'
import { applyCharacterWrites, buildGreetingAdd, createLiveReader, type LiveTarget } from './studioSetters'
import { buildGreetingAppendMany, buildGreetingMove, buildGreetingSwap, fmAfterMove, fmAfterSwap } from './greetingListOps'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

interface LiveChat {
    id?: string
    note: string
    fmIndex?: number
}

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage?: unknown
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        firstMessage: 'M',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: '', fmIndex: -1 }],
        chatPage: 0,
        ...overrides,
    }
}

function targetOf(live: LiveCharacter): LiveTarget {
    return { character: live as unknown as character, chat: null }
}

function readerOf(live: LiveCharacter) {
    return createLiveReader(targetOf(live))
}

describe('B1: the chat-follow tables', () => {
    test('fmAfterMove: from < to, from > to, the moved entry, between, outside and the default', () => {
        // Move 1 to 3 over [a b c d e]: b leaves its slot, c d shift left.
        expect(fmAfterMove(1, 1, 3)).toBe(3)
        expect(fmAfterMove(2, 1, 3)).toBe(1)
        expect(fmAfterMove(3, 1, 3)).toBe(2)
        expect(fmAfterMove(0, 1, 3)).toBe(0)
        expect(fmAfterMove(4, 1, 3)).toBe(4)
        // Move 3 to 1: d lands on 1, b c shift right.
        expect(fmAfterMove(3, 3, 1)).toBe(1)
        expect(fmAfterMove(1, 3, 1)).toBe(2)
        expect(fmAfterMove(2, 3, 1)).toBe(3)
        expect(fmAfterMove(0, 3, 1)).toBe(0)
        expect(fmAfterMove(4, 3, 1)).toBe(4)
        expect(fmAfterMove(-1, 1, 3)).toBe(-1)
    })

    test('fmAfterSwap: the default goes to the slot, the slot goes to the default, others stay', () => {
        expect(fmAfterSwap(-1, 2)).toBe(2)
        expect(fmAfterSwap(2, 2)).toBe(-1)
        expect(fmAfterSwap(0, 2)).toBe(0)
    })
})

describe('buildGreetingMove', () => {
    test('emits a remove without a deleted id, an insert in post-removal coordinates and the chat op', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 0 }] })
        const built = buildGreetingMove(0, 2, targetOf(live), readerOf(live))
        expect(built).toMatchObject({
            ok: true,
            label: { kind: 'greetingMove' },
            coalesceKey: null,
            pageFm: null,
            ops: [
                { op: 'listRemove', index: 0, value: 'g0', deletedId: null },
                { op: 'listInsert', index: 2, value: 'g0' },
                { op: 'chatFm', chatId: 'c1', before: { had: true, value: 0 }, after: { had: true, value: 2 } },
            ],
            writes: [{ op: 'listRemove', index: 0 }, { op: 'listInsert', index: 2, value: 'g0' }, { op: 'chatFm', chatId: 'c1', value: { had: true, value: 2 } }],
        })
        if (built.ok) {
            applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
        }
        expect(live.alternateGreetings).toEqual(['g1', 'g2', 'g0'])
        expect(live.chats[0].fmIndex).toBe(2)
    })

    test('adds no chat op when the chat shows the default or a stale index', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 7 }] })
        const built = buildGreetingMove(0, 2, targetOf(live), readerOf(live))
        expect(built.ok && built.ops.map((op) => op.op)).toEqual(['listRemove', 'listInsert'])
    })

    test('refuses an out-of-range index and an unreadable list, and reports an identical slot as unchanged', () => {
        const live = makeCharacter()
        expect(buildGreetingMove(3, 0, targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildGreetingMove(0, 3, targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildGreetingMove(-1, 0, targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildGreetingMove(1, 1, targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'unchanged' })
        const broken = makeCharacter()
        ;(broken as unknown as { alternateGreetings: unknown }).alternateGreetings = undefined
        expect(buildGreetingMove(0, 1, targetOf(broken), readerOf(broken))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a context chat without a unique id records chatId null and goes through pageFm', () => {
        const live = makeCharacter({ chats: [{ note: '', fmIndex: 1 }] })
        const built = buildGreetingMove(1, 0, targetOf(live), readerOf(live))
        expect(built).toMatchObject({ ok: true, pageFm: 0, ops: [{ op: 'listRemove' }, { op: 'listInsert' }, { op: 'chatFm', chatId: null }] })
        expect(built.ok && built.writes.map((write) => write.op)).toEqual(['listRemove', 'listInsert'])
    })
})

describe('buildGreetingSwap', () => {
    test('exchanges main and the entry and moves the chat from the default to the slot', () => {
        const live = makeCharacter()
        const built = buildGreetingSwap(1, targetOf(live), readerOf(live))
        expect(built).toMatchObject({
            ok: true,
            label: { kind: 'greetingSwap' },
            coalesceKey: null,
            ops: [
                { op: 'set', path: 'firstMessage', before: { had: true, value: 'M' }, after: { had: true, value: 'g1' } },
                { op: 'listSet', index: 1, before: 'g1', after: 'M' },
                { op: 'chatFm', chatId: 'c1', before: { had: true, value: -1 }, after: { had: true, value: 1 } },
            ],
        })
        const before = firstMessageOf(live as unknown as character, live.chats[0])
        if (built.ok) {
            applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
        }
        expect(live.firstMessage).toBe('g1')
        expect(live.alternateGreetings).toEqual(['g0', 'M', 'g2'])
        expect(firstMessageOf(live as unknown as character, live.chats[0])).toBe(before)
    })

    test('a stale stored index reads as the default: the chat follows into the slot and keeps its first message', () => {
        for (const stored of [7, -4, 1.5]) {
            const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: stored }] })
            const before = firstMessageOf(live as unknown as character, live.chats[0])
            const built = buildGreetingSwap(1, targetOf(live), readerOf(live))
            expect(built.ok && built.ops[2]).toMatchObject({ op: 'chatFm', chatId: 'c1', before: { had: true, value: stored }, after: { had: true, value: 1 } })
            if (built.ok) {
                applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
            }
            expect(live.chats[0].fmIndex).toBe(1)
            expect(firstMessageOf(live as unknown as character, live.chats[0])).toBe(before)
        }
    })

    test('a chat on the swapped slot goes back to the default', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] })
        const built = buildGreetingSwap(1, targetOf(live), readerOf(live))
        expect(built.ok && built.ops[2]).toMatchObject({ op: 'chatFm', after: { had: true, value: -1 } })
    })

    test('a chat on another slot gets no chat op', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 0 }] })
        const built = buildGreetingSwap(1, targetOf(live), readerOf(live))
        expect(built.ok && built.ops.map((op) => op.op)).toEqual(['set', 'listSet'])
    })

    test('without a unique chat id the chat moves by page index', () => {
        const live = makeCharacter({ chats: [{ note: '', fmIndex: -1 }] })
        const built = buildGreetingSwap(2, targetOf(live), readerOf(live))
        expect(built).toMatchObject({ ok: true, pageFm: 2, ops: [{ op: 'set' }, { op: 'listSet' }, { op: 'chatFm', chatId: null }] })
        if (built.ok) {
            applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
        }
        expect(live.chats[0].fmIndex).toBe(2)
    })

    test('the same text on both sides is unchanged; a missing slot or an unreadable list is a precondition failure', () => {
        const same = makeCharacter({ firstMessage: 'g1' })
        expect(buildGreetingSwap(1, targetOf(same), readerOf(same))).toEqual({ ok: false, reason: 'unchanged' })
        const live = makeCharacter()
        expect(buildGreetingSwap(3, targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        const broken = makeCharacter()
        ;(broken as unknown as { alternateGreetings: unknown }).alternateGreetings = null
        expect(buildGreetingSwap(0, targetOf(broken), readerOf(broken))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a non-string entry in the list is a precondition failure', () => {
        // A corrupted saved list is the only way to hold a non-string entry; the cast models that one fixture value.
        const corrupt = makeCharacter({ alternateGreetings: ['g0', 5 as unknown as string, 'g2'] })
        expect(buildGreetingSwap(1, targetOf(corrupt), readerOf(corrupt))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('an absent or non-string firstMessage is a precondition failure (the set is emitted directly)', () => {
        const absent = makeCharacter({ firstMessage: undefined })
        expect(buildGreetingSwap(0, targetOf(absent), readerOf(absent))).toEqual({ ok: false, reason: 'precondition' })
        const numeric = makeCharacter({ firstMessage: 5 })
        expect(buildGreetingSwap(0, targetOf(numeric), readerOf(numeric))).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('B7 and B7b: append-many and the stale pin', () => {
    test('B7 appends in order at the end with the open chat unchanged', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] })
        const built = buildGreetingAppendMany(['a', 'b', 'c'], targetOf(live), readerOf(live))
        expect(built).toMatchObject({
            ok: true,
            label: { kind: 'greetingAddMany', count: 3 },
            coalesceKey: null,
            pageFm: null,
            ops: [
                { op: 'listInsert', index: 3, value: 'a' },
                { op: 'listInsert', index: 4, value: 'b' },
                { op: 'listInsert', index: 5, value: 'c' },
            ],
        })
        expect(built.ok && built.ops).toHaveLength(3)
        if (built.ok) {
            applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
        }
        expect(live.alternateGreetings).toEqual(['g0', 'g1', 'g2', 'a', 'b', 'c'])
        expect(live.chats[0].fmIndex).toBe(1)
    })

    test('B7 empty input, a non-string value and an unreadable list are precondition failures', () => {
        const live = makeCharacter()
        expect(buildGreetingAppendMany([], targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildGreetingAppendMany(['a', 5 as unknown as string], targetOf(live), readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
        const broken = makeCharacter()
        ;(broken as unknown as { alternateGreetings: unknown }).alternateGreetings = undefined
        expect(buildGreetingAppendMany(['a'], targetOf(broken), readerOf(broken))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('B7b a chat storing fmIndex at the length is pinned to -1 by the append', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 3 }] })
        const default_ = firstMessageOf(live as unknown as character, live.chats[0])
        const built = buildGreetingAppendMany(['a', 'b'], targetOf(live), readerOf(live))
        expect(built).toMatchObject({ ok: true, ops: [{ op: 'listInsert' }, { op: 'listInsert' }, { op: 'chatFm', chatId: 'c1', before: { had: true, value: 3 }, after: { had: true, value: -1 } }] })
        if (built.ok) {
            applyCharacterWrites(live as unknown as character, built.writes, built.pageFm)
        }
        expect(firstMessageOf(live as unknown as character, live.chats[0])).toBe(default_)
    })

    test('B7b the single add pins the same way, and by page index without a unique id', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 3 }] })
        const built = buildGreetingAdd(readerOf(live), targetOf(live))
        expect(built).toMatchObject({ ok: true, ops: [{ op: 'listInsert', index: 3 }, { op: 'chatFm', chatId: 'c1', after: { had: true, value: -1 } }] })
        const idless = makeCharacter({ chats: [{ note: '', fmIndex: 9 }] })
        const byIndex = buildGreetingAdd(readerOf(idless), targetOf(idless))
        expect(byIndex).toMatchObject({ ok: true, pageFm: -1, ops: [{ op: 'listInsert' }, { op: 'chatFm', chatId: null }] })
    })

    test('B7b a chat inside the list, on the default or on a non-integer index is not pinned', () => {
        for (const fmIndex of [0, 2, -1, 1.5, -4]) {
            const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex }] })
            const built = buildGreetingAppendMany(['a'], targetOf(live), readerOf(live))
            expect(built.ok && built.ops.map((op) => op.op)).toEqual(['listInsert'])
        }
    })

    test('B7b a chat storing a non-integer or NaN fmIndex at or above the length is not pinned', () => {
        for (const fmIndex of [3.5, 4.5, Number.NaN]) {
            const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex }] })
            const appended = buildGreetingAppendMany(['a'], targetOf(live), readerOf(live))
            expect(appended).toMatchObject({ ok: true, pageFm: null })
            expect(appended.ok && appended.ops.map((op) => op.op)).toEqual(['listInsert'])
            const added = buildGreetingAdd(readerOf(live), targetOf(live))
            expect(added).toMatchObject({ ok: true, pageFm: null })
            expect(added.ok && added.ops.map((op) => op.op)).toEqual(['listInsert'])
        }
    })

    test('B7b a character with no chats builds the bare insert without a chat op or a throw', () => {
        const empty = makeCharacter({ chats: [] })
        // `chats` can be missing on a corrupted record; the cast models that one fixture value.
        const missing = makeCharacter({ chats: undefined as unknown as LiveChat[] })
        for (const live of [empty, missing]) {
            const appended = buildGreetingAppendMany(['a'], targetOf(live), readerOf(live))
            expect(appended.ok && appended.ops.map((op) => op.op)).toEqual(['listInsert'])
            const added = buildGreetingAdd(readerOf(live), targetOf(live))
            expect(added.ok && added.ops.map((op) => op.op)).toEqual(['listInsert'])
        }
    })

    test('the single add without a target builds the bare insert', () => {
        const live = makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 3 }] })
        const built = buildGreetingAdd(readerOf(live))
        expect(built.ok && built.ops).toEqual([{ op: 'listInsert', index: 3, value: '' }])
    })
})
