// @vitest-environment happy-dom

/**
 * The reactive side of the character search: the debounce of the typed query
 * and the shared result that follows `db.characters`. A write the search reads
 * (length, chaId, trashTime, type, coldstorage, name, creatorNotes, tags,
 * creator) updates the result in the same flush; a write it does not read
 * (chats, lastInteraction, image) walks nothing.
 *
 * MOCKED: `src/ts/stores.svelte` (only `DBState`, a real `$state` object) and
 * `isHiddenSystemCharacter`, wrapped over the real module to count calls (each
 * pass over `db.characters` makes one call per slot). The clock is faked for
 * `setTimeout`/`clearTimeout` only.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../storage/database.svelte'

const { hiddenCalls } = vi.hoisted(() => ({ hiddenCalls: { n: 0 } }))

vi.mock(import('../../hiddenCharacters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        isHiddenSystemCharacter: (char: { chaId?: string } | null | undefined) => {
            hiddenCalls.n++
            return actual.isHiddenSystemCharacter(char)
        },
    }
})

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../stores.svelte')
})

import { DBState } from '../../stores.svelte'
import { createCharacterSearch, createDebouncedValue, type CharacterSearch } from '../characterSearch.svelte'
import type { SearchStats } from '../characterSearch'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

function setCharacters(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

let query = $state('')
let cleanups: (() => void)[] = []

function within<T>(body: () => T): T {
    let value!: T
    cleanups.push(
        $effect.root(() => {
            value = body()
        }),
    )
    flushSync()
    return value
}

function type(value: string): void {
    query = value
    flushSync()
}

function elapse(ms: number): void {
    vi.advanceTimersByTime(ms)
    flushSync()
}

function liveIndices(search: CharacterSearch): number[] {
    return search.live.map((m) => m.index)
}

beforeEach(() => {
    query = ''
    hiddenCalls.n = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup()
    }
    cleanups = []
    vi.useRealTimers()
})

describe('createDebouncedValue', () => {
    test('starts with the source value at once', () => {
        query = 'start'
        const debounced = within(() => createDebouncedValue(() => query, 150))
        expect(debounced.value).toBe('start')
    })

    test('a change lands once, 150 ms after the last keystroke of a burst', () => {
        const debounced = within(() => createDebouncedValue(() => query, 150))
        type('a')
        elapse(100)
        type('ab')
        elapse(100)
        type('abc')
        elapse(149)
        expect(debounced.value).toBe('')
        elapse(1)
        expect(debounced.value).toBe('abc')
    })

    test('an empty or whitespace-only value applies at once and cancels the pending one', () => {
        const debounced = within(() => createDebouncedValue(() => query, 150))
        type('ab')
        elapse(150)
        expect(debounced.value).toBe('ab')
        type('abc')
        elapse(50)
        type('')
        expect(debounced.value).toBe('')
        elapse(1000)
        expect(debounced.value).toBe('')
        type('abc')
        elapse(150)
        type('  ')
        expect(debounced.value).toBe('  ')
    })

    test('destroying the owner clears the pending timer', () => {
        within(() => createDebouncedValue(() => query, 150))
        type('ab')
        expect(vi.getTimerCount()).toBe(1)
        for (const cleanup of cleanups) {
            cleanup()
        }
        cleanups = []
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('createCharacterSearch: results follow the query and the database', () => {
    test('the result is empty-query complete at creation and narrows after the debounce', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([0, 1])
        expect(search.searching).toBe(false)
        type('bob')
        expect(liveIndices(search)).toEqual([0, 1])
        elapse(150)
        expect(liveIndices(search)).toEqual([1])
        expect(search.searching).toBe(true)
    })

    // Feature test: the property does not exist before the windowed lists, which reset their scroll position when it changes.
    test('query is the typed query as it landed: it follows the debounce, and clearing lands at once', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const search = within(() => createCharacterSearch(() => query))
        expect(search.query).toBe('')
        type('bo')
        expect(search.query).toBe('')
        elapse(149)
        expect(search.query).toBe('')
        elapse(1)
        expect(search.query).toBe('bo')
        type('')
        expect(search.query).toBe('')
    })

    test('a query present at creation applies without waiting', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        query = 'ann'
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([0])
    })

    test('the result object reads lazily: a holder of the object sees later results', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const search = within(() => createCharacterSearch(() => query))
        const holder = search
        type('ann')
        elapse(150)
        expect(liveIndices(holder)).toEqual([0])
        expect([...holder.matched]).toEqual([0])
    })

    test.each([
        ['name', (c: CharacterFixture) => { c.name = 'Zed' }],
        ['creatorNotes', (c: CharacterFixture) => { c.creatorNotes = 'zed' }],
        ['a pushed tag', (c: CharacterFixture) => { (c as { tags: string[] }).tags.push('zed') }],
        ['creator', (c: CharacterFixture) => { (c as { creator: string }).creator = 'zed' }],
    ])('a write to %s is searched in the same flush', (_label, write) => {
        setCharacters([makeCharacter('a', 'Ann', { tags: [], creator: '' }), makeCharacter('b', 'Bob', { tags: [], creator: '' })])
        query = 'zed'
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([])
        write(DBState.db.characters[1])
        flushSync()
        expect(liveIndices(search)).toEqual([1])
    })

    test('archiving (coldstorage) drops tags and creator from the searched text', () => {
        setCharacters([makeCharacter('a', 'Ann', { tags: ['zed'], creator: '' })])
        query = 'zed'
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([0])
        DBState.db.characters[0].coldstorage = 'unit-a'
        flushSync()
        expect(liveIndices(search)).toEqual([])
    })

    test('turning a character into a group drops tags and creator from the searched text', () => {
        setCharacters([makeCharacter('a', 'Ann', { tags: ['zed'], creator: '' })])
        query = 'zed'
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([0])
        ;(DBState.db.characters[0] as { type: string }).type = 'group'
        flushSync()
        expect(liveIndices(search)).toEqual([])
    })

    test('trash and restore move a match between the lists and carry the current chaId', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Anna')])
        query = 'ann'
        const search = within(() => createCharacterSearch(() => query))
        DBState.db.characters[0].trashTime = 5
        flushSync()
        expect(search.live).toEqual([{ index: 1, chaId: 'b' }])
        expect(search.trash).toEqual([{ index: 0, chaId: 'a' }])
        expect(search.trashedTotal).toBe(1)
        DBState.db.characters[0].trashTime = undefined
        DBState.db.characters[0].chaId = 'a2'
        flushSync()
        expect(search.live).toEqual([
            { index: 0, chaId: 'a2' },
            { index: 1, chaId: 'b' },
        ])
        expect(search.trash).toEqual([])
    })

    test('deleting a lower character re-indexes, and adding one appears', () => {
        setCharacters([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])
        query = 'cat'
        const search = within(() => createCharacterSearch(() => query))
        expect(liveIndices(search)).toEqual([2])
        DBState.db.characters.splice(0, 1)
        flushSync()
        expect(liveIndices(search)).toEqual([1])
        DBState.db.characters.push(makeCharacter('d', 'Cat two'))
        flushSync()
        expect(liveIndices(search)).toEqual([1, 2])
    })

    test('a hidden system character is in no list', () => {
        setCharacters([makeCharacter('§playground', 'assistant'), makeCharacter('§temp', 'assistant', { trashTime: 4 })])
        const search = within(() => createCharacterSearch(() => query))
        expect(search.live).toEqual([])
        expect(search.trash).toEqual([])
        expect(search.trashedTotal).toBe(0)
    })
})

describe('createCharacterSearch: what a write costs', () => {
    function many(n: number): CharacterFixture[] {
        return Array.from({ length: n }, (_, i) => makeCharacter(`c${i}`, `Character ${i}`))
    }

    test('a chat in progress (a pushed message, lastInteraction, image) rebuilds nothing', () => {
        setCharacters(many(200))
        const stats: SearchStats = { entriesNormalised: 0 }
        const search = within(() => createCharacterSearch(() => query, { stats }))
        const before = search.live
        hiddenCalls.n = 0
        stats.entriesNormalised = 0
        ;(DBState.db.characters[7].chats[0].message as unknown[]).push({ time: 1, data: 'hi', role: 'user' })
        DBState.db.characters[7].lastInteraction = Date.now()
        DBState.db.characters[7].image = 'assets/x.png'
        flushSync()
        // Deriveds are lazy: reading the result is what would rebuild a stale index.
        expect(search.live).toBe(before)
        expect(hiddenCalls.n).toBe(0)
        expect(stats.entriesNormalised).toBe(0)
    })

    test('a landed keystroke walks nothing', () => {
        setCharacters(many(200))
        const search = within(() => createCharacterSearch(() => query))
        expect(search.live.length).toBe(200)
        hiddenCalls.n = 0
        type('character 1')
        elapse(150)
        expect(search.live.length).toBeGreaterThan(0)
        expect(search.live.length).toBeLessThan(200)
        expect(hiddenCalls.n).toBe(0)
    })

    test('renaming one of 1000 characters walks the list once and normalises that character only', () => {
        setCharacters(many(1000))
        const stats: SearchStats = { entriesNormalised: 0 }
        const search = within(() => createCharacterSearch(() => query, { stats }))
        expect(search.live.length).toBe(1000)
        hiddenCalls.n = 0
        stats.entriesNormalised = 0
        DBState.db.characters[500].name = 'Renamed'
        flushSync()
        expect(search.live.length).toBe(1000)
        expect(hiddenCalls.n).toBe(1000)
        expect(stats.entriesNormalised).toBe(1)
    })
})
