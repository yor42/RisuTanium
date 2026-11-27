/**
 * The story pool is picked in one pass with a bounded top-k instead of sorting every story.
 *
 * Invariants exercised here:
 * - The pick is identical to the reference path (`recentCharacters` over the story entries, then the
 *   first entry per chaId up to `STORY_CAP`) for every input: duplicate chaIds spanning the cap, ties,
 *   Infinity (whose difference is NaN and falls to list order), -0, NaN, hidden, trashed and
 *   non-string chaIds.
 * - The pool is not sorted as a whole: no `Array.prototype.sort` call sees more than `STORY_CAP` items.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import { recentCharacters } from '../../../ts/chatShell/recentCharacters'
import { STORY_CAP, freezeStories, isStory, storyOrder } from './homeStories'

type Entry = Database['characters'][number]

function entry(chaId: unknown, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: String(chaId), chats: [], chatPage: 0, ...extra } as unknown as Entry
}

/** The path `storyEntries` took before the single pass, kept here as the reference. */
function referencePick(characters: ReadonlyArray<Entry>): Entry[] {
    const seen = new Set<string>()
    const picked: Entry[] = []
    for (const e of recentCharacters(characters.filter(isStory))) {
        if (seen.has(e.chaId)) {
            continue
        }
        seen.add(e.chaId)
        picked.push(e)
        if (picked.length === STORY_CAP) {
            break
        }
    }
    return picked
}

function labelled(chaId: string, lastInteraction: number, label: string): Entry {
    return entry(chaId, { lastInteraction, chats: [{ id: label, name: label, message: [], note: '', localLore: [] }] })
}

function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const TIMES: unknown[] = [1, 2, 3, 5, 5, 5, 9, 1e12, 8.7e15, Infinity, Infinity, 0, -0, NaN, -3, undefined, '7', null]
const IDS: unknown[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a', 'b', 'c', '§playground', undefined, 5, null]

function randomList(rand: () => number): Entry[] {
    const length = Math.floor(rand() * 40)
    const list: Entry[] = []
    for (let i = 0; i < length; i++) {
        const extra: Record<string, unknown> = { lastInteraction: TIMES[Math.floor(rand() * TIMES.length)], tag: i }
        if (rand() < 0.1) {
            extra.trashTime = 1
        }
        list.push(entry(IDS[Math.floor(rand() * IDS.length)], extra))
    }
    return list
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('storyEntries single pass', () => {
    test('differential: the same entries as the reference path over random lists', () => {
        const rand = mulberry32(508)
        let capped = 0
        let withDuplicateBeforeCap = 0
        for (let round = 0; round < 3000; round++) {
            const list = randomList(rand)
            const expected = referencePick(list)
            const actual = storyOrder(list)
            expect(actual).toEqual(expected.map((e) => e.chaId))
            if (expected.length === STORY_CAP) {
                capped++
            }
            const stories = list.filter(isStory).filter((c) => typeof c.chaId === 'string')
            if (stories.length > new Set(stories.map((c) => c.chaId)).size) {
                withDuplicateBeforeCap++
            }
        }
        // The generator must reach the cap and duplicates, or the comparison proves little.
        expect(capped).toBeGreaterThan(100)
        expect(withDuplicateBeforeCap).toBeGreaterThan(100)
    })

    test('which duplicate wins: the later time, and the earlier entry on a tie', () => {
        const list = [
            labelled('x', 5, 'first'),
            labelled('x', 5, 'second'),
            labelled('y', 5, 'older-y'),
            labelled('y', 9, 'newer-y'),
        ]
        expect(referencePick(list).map((e) => e.chats[0].name)).toEqual(['newer-y', 'first'])
        expect(freezeStories(list, 'unnamed').map((s) => s.chatLabel)).toEqual(['newer-y', 'first'])
    })

    test('a duplicate that sorts early does not take a slot: the seventh distinct chaId is not cut off by it', () => {
        const list = [
            entry('a', { lastInteraction: 100 }),
            entry('a', { lastInteraction: 99 }),
            entry('a', { lastInteraction: 98 }),
            entry('b', { lastInteraction: 90 }),
            entry('c', { lastInteraction: 80 }),
            entry('d', { lastInteraction: 70 }),
            entry('e', { lastInteraction: 60 }),
            entry('f', { lastInteraction: 50 }),
            entry('g', { lastInteraction: 40 }),
        ]
        expect(storyOrder(list)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    })

    test('Infinity ties fall to list order, -0 and NaN never enter, hidden and trashed are skipped', () => {
        const list = [
            entry('n', { lastInteraction: NaN }),
            entry('z', { lastInteraction: -0 }),
            entry('inf2', { lastInteraction: Infinity }),
            entry('inf1', { lastInteraction: Infinity }),
            entry('§playground', { lastInteraction: Infinity }),
            entry('trashed', { lastInteraction: Infinity, trashTime: 1 }),
            entry(undefined, { lastInteraction: Infinity }),
            entry('far', { lastInteraction: 8.7e15 }),
        ]
        expect(storyOrder(list)).toEqual(referencePick(list).map((e) => e.chaId))
        expect(storyOrder(list)).toEqual(['inf2', 'inf1', 'far'])
    })

    test('the pool is not sorted as a whole', () => {
        const list: Entry[] = []
        for (let i = 0; i < 200; i++) {
            list.push(entry(`c${i}`, { lastInteraction: 1000 + ((i * 37) % 200) }))
        }
        const sizes: number[] = []
        const nativeSort = Array.prototype.sort
        vi.spyOn(Array.prototype, 'sort').mockImplementation(function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
            sizes.push(this.length)
            return nativeSort.call(this, compare)
        })
        const order = storyOrder(list)
        expect(order).toHaveLength(STORY_CAP)
        expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(STORY_CAP)
    })
})
