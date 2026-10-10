import { describe, expect, test } from 'vitest'
import type { character, groupChat } from '../../storage/database.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import {
    buildIndex,
    createSearchCache,
    normalizeForSearch,
    parseQuery,
    searchIndex,
    slotKeys,
    type SearchStats,
} from '../characterSearch'

type Slot = character | groupChat

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): character {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as character
}

function makeStub(chaId: string, name: string, description: string, extra: Record<string, unknown> = {}): character {
    return makeCharacter(chaId, name, { creatorNotes: description, coldstorage: `unit-${chaId}`, ...extra })
}

/** Db positions of the live matches of `query`, in index order. */
function liveFor(characters: Slot[], query: string): number[] {
    const result = searchIndex(buildIndex(characters, createSearchCache()), parseQuery(query))
    return result.live.map((m) => m.index)
}

describe('normalizeForSearch and parseQuery (specification)', () => {
    test('composes decomposed Hangul, folds full-width Latin and lowercases', () => {
        expect(normalizeForSearch('한글'.normalize('NFD'))).toBe('한글')
        expect(normalizeForSearch('ＡＢＣ')).toBe('abc')
        expect(normalizeForSearch('Ab')).toBe('ab')
    })

    test('lowercasing does not depend on the locale: a plain capital I becomes a plain i', () => {
        expect(normalizeForSearch('TITLE')).toBe('title')
    })

    test('splits on whitespace, ideographic space and zero-width characters, and drops empty tokens', () => {
        expect(parseQuery('  John　Smith  ')).toEqual(['john', 'smith'])
        expect(parseQuery('a\u200Bb')).toEqual(['a', 'b'])
        expect(parseQuery('')).toEqual([])
        expect(parseQuery('   ')).toEqual([])
    })
})

describe('what an entry matches (specification)', () => {
    test('an empty query matches every non-hidden character', () => {
        const characters = [makeCharacter('a', 'Ann'), makeCharacter('§playground', 'assistant'), makeCharacter('b', 'Bob')]
        expect(liveFor(characters, '')).toEqual([0, 2])
    })

    test('the name match ignores spaces and case in both directions', () => {
        const characters = [makeCharacter('a', 'Ab'), makeCharacter('b', 'C d'), makeCharacter('c', 'John Smith')]
        expect(liveFor(characters, 'a b')).toEqual([0])
        expect(liveFor(characters, 'cd')).toEqual([1])
        expect(liveFor(characters, 'johnsmith')).toEqual([2])
        expect(liveFor(characters, 'JOHN smith')).toEqual([2])
    })

    test('every word must match somewhere, in any order', () => {
        const characters = [
            makeCharacter('a', 'John Smith', { creatorNotes: 'a baker' }),
            makeCharacter('b', 'John Doe', { creatorNotes: 'a baker' }),
        ]
        expect(liveFor(characters, 'smith john')).toEqual([0])
        expect(liveFor(characters, 'doe baker')).toEqual([1])
        expect(liveFor(characters, 'smith doe')).toEqual([])
    })

    test('words are not joined across fields or across words of the description', () => {
        const characters = [makeCharacter('a', 'Ann', { creatorNotes: 'the artist', tags: ['x'], creator: 'y' })]
        expect(liveFor(characters, 'eart')).toEqual([])
        expect(liveFor(characters, 'xy')).toEqual([])
    })

    test('a loaded individual character is searched by description, tags and creator', () => {
        const characters = [makeCharacter('a', 'Ann', { creatorNotes: 'dragon keeper', tags: ['fantasy', 'elf'], creator: 'Somebody' })]
        expect(liveFor(characters, 'dragon')).toEqual([0])
        expect(liveFor(characters, 'elf')).toEqual([0])
        expect(liveFor(characters, 'somebody')).toEqual([0])
    })

    test('an archived character and a group are searched by name and description only', () => {
        const characters: Slot[] = [
            makeStub('a', 'Ann', 'dragon keeper', { tags: ['fantasy'], creator: 'Somebody' }),
            makeCharacter('g', 'Group', { type: 'group', creatorNotes: 'band of heroes', tags: ['fantasy'], creator: 'Somebody' }),
        ]
        expect(liveFor(characters, 'dragon')).toEqual([0])
        expect(liveFor(characters, 'heroes')).toEqual([1])
        expect(liveFor(characters, 'fantasy')).toEqual([])
        expect(liveFor(characters, 'somebody')).toEqual([])
    })

    test('a zero-width character inside a description or tag does not hide the word', () => {
        const characters = [makeCharacter('a', 'Ann', { creatorNotes: 'dra\u200Bgon', tags: ['fan\uFEFFtasy'] })]
        expect(liveFor(characters, 'dragon')).toEqual([0])
        expect(liveFor(characters, 'fantasy')).toEqual([0])
    })

    test('a legacy or damaged slot never throws and is found by what it has', () => {
        const characters = [
            makeCharacter('a', 'Ann', { creatorNotes: undefined, tags: 'not-a-list', creator: 42 }),
            makeCharacter('b', 'Bob', { name: undefined }),
            makeStub('c', 'Cat', undefined as unknown as string),
        ]
        expect(liveFor(characters, 'ann')).toEqual([0])
        expect(liveFor(characters, 'cat')).toEqual([2])
        expect(liveFor(characters, '')).toEqual([0, 1, 2])
    })
})

describe('the description is the one a stub carries (specification and invariant)', () => {
    const english = '# `en`\nenglishword here\n# `ko`\nkoreanword here'
    const long = `${'word '.repeat(98)}edgeword tailword`

    test.each([
        ['englishword', true],
        ['koreanword', false],
    ])('the english section only: "%s" is %s', (word, expected) => {
        const source = makeCharacter('a', 'Ann', { creatorNotes: english })
        const stub = buildColdStub(source, 'unit-a', [])
        expect(liveFor([source], word)).toEqual(expected ? [0] : [])
        expect(liveFor([stub], word)).toEqual(expected ? [0] : [])
    })

    test('archiving cuts nothing the list did not already cut: a loaded character and its stub find the same words', () => {
        const source = makeCharacter('a', 'Ann', { creatorNotes: long })
        const stub = buildColdStub(source, 'unit-a', [])
        for (const word of ['word', 'edgeword', 'tailword']) {
            expect(liveFor([stub], word), word).toEqual(liveFor([source], word))
        }
        expect(liveFor([source], 'tailword')).toEqual([])
    })

    test('a surrogate pair at the cut is not half-kept', () => {
        const source = makeCharacter('a', 'Ann', { creatorNotes: `${'x'.repeat(499)}\u{1F600}tail` })
        const stub = buildColdStub(source, 'unit-a', [])
        expect(liveFor([source], 'tail')).toEqual(liveFor([stub], 'tail'))
    })
})

describe('partition by trash state (specification)', () => {
    test('live and trash lists are separate, hidden characters are in neither, and matched holds both', () => {
        const gone = 1_700_000_000_000
        const characters = [
            makeCharacter('a', 'Ann'),
            makeCharacter('b', 'Anna', { trashTime: gone }),
            makeCharacter('§temp', 'Ann temp', { trashTime: gone }),
            makeCharacter('c', 'Bob', { trashTime: gone }),
        ]
        const index = buildIndex(characters, createSearchCache())
        const result = searchIndex(index, parseQuery('ann'))
        expect(result.live).toEqual([{ index: 0, key: '["s","a",0]', chaId: 'a' }])
        expect(result.trash).toEqual([{ index: 1, key: '["s","b",0]', chaId: 'b' }])
        expect([...result.matched].sort()).toEqual([0, 1])
        expect(result.trashedTotal).toBe(2)
    })

    test('the unfiltered trash count is the same for every query', () => {
        const characters = [makeCharacter('a', 'Ann', { trashTime: 1 }), makeCharacter('b', 'Bob', { trashTime: 1 })]
        const index = buildIndex(characters, createSearchCache())
        expect(searchIndex(index, parseQuery('')).trashedTotal).toBe(2)
        expect(searchIndex(index, parseQuery('zzz')).trashedTotal).toBe(2)
        expect(searchIndex(index, parseQuery('zzz')).trash).toEqual([])
    })
})

describe('slot keys (invariant)', () => {
    const key = (chaId: string, occurrence: number): string => JSON.stringify(['s', chaId, occurrence])

    test('a slot is keyed by its chaId and the number of earlier slots with the same chaId', () => {
        const characters = [makeCharacter('a', 'One'), makeCharacter('b', 'Two'), makeCharacter('a', 'Three'), makeCharacter('a', 'Four')]
        expect(slotKeys(characters)).toEqual([key('a', 0), key('b', 0), key('a', 1), key('a', 2)])
    })

    test('a hidden system character has no key and is not counted', () => {
        const characters = [makeCharacter('§playground', 'assistant'), makeCharacter('a', 'One'), makeCharacter('§playground', 'again'), makeCharacter('a', 'Two')]
        expect(slotKeys(characters)).toEqual([null, key('a', 0), null, key('a', 1)])
    })

    test('trashed slots count towards the occurrence, so no list setting changes a key', () => {
        const characters = [makeCharacter('a', 'One', { trashTime: 1 }), makeCharacter('a', 'Two')]
        expect(slotKeys(characters)).toEqual([key('a', 0), key('a', 1)])
    })

    test('a chaId that is not a string counts as the empty id', () => {
        const characters = [makeCharacter('', 'One'), makeCharacter(undefined as unknown as string, 'Two'), makeCharacter(7 as unknown as string, 'Three')]
        expect(slotKeys(characters)).toEqual([key('', 0), key('', 1), key('', 2)])
    })

    test('a key survives a delete of an earlier slot, and a later holder of a shared chaId steps down', () => {
        const characters = [makeCharacter('a', 'One'), makeCharacter('b', 'Two'), makeCharacter('c', 'Three'), makeCharacter('a', 'Four')]
        const before = slotKeys(characters)
        characters.splice(1, 1)
        const after = slotKeys(characters)
        expect(after[1]).toBe(before[2])
        // The earlier holder of 'a' stays, so the later one keeps occurrence 1; deleting the earlier holder moves it to 0.
        expect(after[2]).toBe(before[3])
        characters.splice(0, 1)
        expect(slotKeys(characters)[1]).toBe(key('a', 0))
    })

    test('a rewritten chaId gives the slot a new key', () => {
        const characters = [makeCharacter('a', 'One')]
        characters[0].chaId = 'b'
        expect(slotKeys(characters)).toEqual([key('b', 0)])
    })

    test('buildIndex carries exactly the key of its slot, trashed or not', () => {
        const characters = [
            makeCharacter('a', 'One'),
            makeCharacter('§temp', 'hidden'),
            makeCharacter('a', 'Two', { trashTime: 1 }),
            makeCharacter('b', 'Three'),
            makeCharacter('a', 'Four'),
        ]
        const keys = slotKeys(characters)
        const index = buildIndex(characters, createSearchCache())
        expect(index.map((entry) => [entry.index, entry.key])).toEqual(
            keys.flatMap((slotKey, i) => (slotKey === null ? [] : [[i, slotKey]])),
        )
        const result = searchIndex(index, parseQuery(''))
        expect([...result.live, ...result.trash].map((match) => [match.index, match.key])).toEqual(
            expect.arrayContaining([[0, key('a', 0)], [2, key('a', 1)], [3, key('b', 0)], [4, key('a', 2)]]),
        )
    })

    test('a query never changes a key', () => {
        const characters = [makeCharacter('a', 'One'), makeCharacter('a', 'Two')]
        const index = buildIndex(characters, createSearchCache())
        expect(searchIndex(index, parseQuery('two')).live.map((match) => match.key)).toEqual([key('a', 1)])
    })
})

describe('index cache (invariant)', () => {
    function many(n: number): character[] {
        return Array.from({ length: n }, (_, i) => makeCharacter(`c${i}`, `Character ${i}`, { creatorNotes: `notes ${i}`, tags: ['t'], creator: 'cr' }))
    }

    test('a second build over unchanged characters normalises nothing', () => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const cache = createSearchCache(stats)
        const characters = many(1000)
        buildIndex(characters, cache)
        expect(stats.entriesNormalised).toBe(1000)
        buildIndex(characters, cache)
        expect(stats.entriesNormalised).toBe(1000)
    })

    test('renaming one of 1000 characters normalises exactly that character', () => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const cache = createSearchCache(stats)
        const characters = many(1000)
        buildIndex(characters, cache)
        characters[500].name = 'Renamed'
        buildIndex(characters, cache)
        expect(stats.entriesNormalised).toBe(1001)
    })

    test.each([
        ['creatorNotes', (c: character) => { c.creatorNotes = 'other' }],
        ['a tag', (c: character) => { c.tags = ['new'] }],
        ['creator', (c: character) => { c.creator = 'someone' }],
        ['coldstorage', (c: character) => { c.coldstorage = 'unit-x' }],
    ])('a change of %s is a cache miss for that character only', (_label, change) => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const cache = createSearchCache(stats)
        const characters = many(10)
        buildIndex(characters, cache)
        change(characters[3])
        buildIndex(characters, cache)
        expect(stats.entriesNormalised).toBe(11)
    })

    test('writes the search does not read (chats, lastInteraction, image) are cache hits', () => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const cache = createSearchCache(stats)
        const characters = many(10)
        buildIndex(characters, cache)
        characters[2].chats[0].message.push({ time: 1, data: 'hi', role: 'user' } as never)
        characters[2].lastInteraction = 5
        characters[2].image = 'assets/x.png'
        buildIndex(characters, cache)
        expect(stats.entriesNormalised).toBe(10)
    })

    test('flags and positions are read fresh on every build even when the strings are cached', () => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const cache = createSearchCache(stats)
        const characters = many(4)
        const first = buildIndex(characters, cache)
        expect(first.map((e) => e.index)).toEqual([0, 1, 2, 3])

        characters[1].trashTime = 99
        characters.splice(0, 1)
        characters[0].chaId = 'renamed-id'
        const second = buildIndex(characters, cache)
        expect(second.map((e) => e.index)).toEqual([0, 1, 2])
        expect(second[0].chaId).toBe('renamed-id')
        expect(second[0].trashed).toBe(true)
        expect(second[1].trashed).toBe(false)
        expect(stats.entriesNormalised).toBe(4)
    })

    test('searching an existing index normalises nothing', () => {
        const stats: SearchStats = { entriesNormalised: 0 }
        const index = buildIndex(many(100), createSearchCache(stats))
        const before = stats.entriesNormalised
        searchIndex(index, parseQuery('character 5'))
        searchIndex(index, parseQuery('notes'))
        expect(stats.entriesNormalised).toBe(before)
    })

    test('two caches never share state', () => {
        const characters = many(3)
        const a: SearchStats = { entriesNormalised: 0 }
        const b: SearchStats = { entriesNormalised: 0 }
        buildIndex(characters, createSearchCache(a))
        buildIndex(characters, createSearchCache(b))
        expect(a.entriesNormalised).toBe(3)
        expect(b.entriesNormalised).toBe(3)
    })
})
