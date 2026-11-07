/**
 * `recentCharacters` (`recentCharacters.ts`): the characters the new shell's
 * sidebar strip offers, most recently used first.
 *
 * Invariants exercised here:
 * - Hidden system characters, trashed characters and entries without a string
 *   `chaId` are never offered; groups are kept (a tap opens the old shell).
 * - Order is `lastInteraction` descending with a missing time last, stable
 *   for ties; archived stubs qualify without being read.
 */
import { describe, test, expect } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { recentCharacters } from './recentCharacters'

type Entry = Database['characters'][number]

function entry(chaId: unknown, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: String(chaId), chats: [], chatPage: 0, ...extra } as unknown as Entry
}

function ids(list: Entry[]): string[] {
    return list.map((c) => c.chaId)
}

describe('recentCharacters', () => {
    test('TA8: most recent interaction first, a missing time last, ties keep list order', () => {
        const list = [
            entry('old', { lastInteraction: 1 }),
            entry('none'),
            entry('new', { lastInteraction: 9 }),
            entry('tieA', { lastInteraction: 5 }),
            entry('tieB', { lastInteraction: 5 }),
        ]

        expect(ids(recentCharacters(list))).toEqual(['new', 'tieA', 'tieB', 'old', 'none'])
    })

    test('TA8: trashed, hidden system and id-less entries are dropped', () => {
        const list = [
            entry('keep', { lastInteraction: 1 }),
            entry('trashed', { lastInteraction: 9, trashTime: 123 }),
            entry('§playground', { lastInteraction: 9 }),
            entry('§temp', { lastInteraction: 9 }),
            entry(undefined, { lastInteraction: 9 }),
            entry(42, { lastInteraction: 9 }),
        ]

        expect(ids(recentCharacters(list))).toEqual(['keep'])
    })

    test('TA8: groups are kept and ordered with the rest', () => {
        const list = [
            entry('plain', { lastInteraction: 1 }),
            entry('grp', { type: 'group', lastInteraction: 2 }),
        ]

        expect(ids(recentCharacters(list))).toEqual(['grp', 'plain'])
    })

    test('TA8: an archived stub qualifies by its own fields', () => {
        const list = [
            entry('warm', { lastInteraction: 1 }),
            entry('cold', { lastInteraction: 5, coldstorage: 'unit-cold' }),
        ]

        expect(ids(recentCharacters(list))).toEqual(['cold', 'warm'])
    })

    test('does not reorder or mutate its input', () => {
        const list = [entry('a', { lastInteraction: 1 }), entry('b', { lastInteraction: 2 })]

        recentCharacters(list)

        expect(ids(list)).toEqual(['a', 'b'])
    })
})
