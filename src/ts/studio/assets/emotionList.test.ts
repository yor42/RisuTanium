import { describe, expect, test } from 'vitest'
import type { character, groupChat } from '../../storage/database.svelte'
import { hashPath } from './assetFixtures.test-helpers'
import { emotionFinderRows, emotionMergeSource, emotionMatchesFilter, emotionNameRefused, emotionRowsOf, focusAfterRemoval, pickedAfter } from './emotionList'

const pA = hashPath('a', 'png')
const pB = hashPath('b', 'png')
const pM = hashPath('m', 'mp4')

describe('emotionRowsOf', () => {
    test('P1: carries the stored index, keys rows by occurrence and path, and shows images as thumbnails and other files as tiles', () => {
        const rows = emotionRowsOf([['happy', pA], ['sad', pA], ['clip', pM], ['plain', 'assets/noext']])
        expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3])
        expect(rows.map((row) => row.key)).toEqual([`0:${pA}`, `1:${pA}`, `0:${pM}`, '0:assets/noext'])
        expect(rows.map((row) => row.shown)).toEqual(['thumb', 'thumb', 'tile', 'tile'])
        expect(rows.map((row) => row.ext)).toEqual(['png', 'png', 'mp4', ''])
        expect(rows.map((row) => row.name)).toEqual(['happy', 'sad', 'clip', 'plain'])
    })

    test('P1: a missing list has no rows, and a gif name over a png path is still a thumbnail by the path', () => {
        expect(emotionRowsOf(undefined)).toEqual([])
        expect(emotionRowsOf([['wave.gif', pA]])[0]).toMatchObject({ ext: 'png', shown: 'thumb' })
    })

    test('P1: finder rows of filtered rows keep their stored indexes and carry no folder', () => {
        const rows = emotionRowsOf([['happy', pA], ['sad', pB], ['hat', pA], ['smile', pB]])
        const shown = rows.filter((row) => emotionMatchesFilter(row, 's'))
        expect(emotionFinderRows(shown)).toEqual([
            { name: 'sad', path: pB, index: 1, folder: null },
            { name: 'smile', path: pB, index: 3, folder: null },
        ])
    })
})

describe('emotionMatchesFilter', () => {
    test('P2: an empty query keeps every row; a query matches the name only, in any case, and never the path', () => {
        const row = { name: 'Happy' }
        expect(emotionMatchesFilter(row, '')).toBe(true)
        expect(emotionMatchesFilter(row, 'hap')).toBe(true)
        expect(emotionMatchesFilter(row, 'APP')).toBe(true)
        expect(emotionMatchesFilter(row, 'sad')).toBe(false)
        expect(emotionMatchesFilter({ name: 'happy' }, 'assets')).toBe(false)
    })
})

describe('focusAfterRemoval', () => {
    test('P3: the next surviving row, else the previous, else the list itself', () => {
        expect(focusAfterRemoval(['a', 'b', 'c'], ['b', 'c'], 'a')).toBe('b')
        expect(focusAfterRemoval(['a', 'b', 'c'], ['a', 'c'], 'b')).toBe('c')
        expect(focusAfterRemoval(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b')
        expect(focusAfterRemoval(['a'], [], 'a')).toBe('container')
    })

    test('P3: nothing removed, or no row that held focus, moves nothing', () => {
        expect(focusAfterRemoval(['a', 'b'], ['a', 'b'], 'a')).toBeNull()
        expect(focusAfterRemoval(['a', 'b', 'c'], ['a', 'c'], null)).toBeNull()
    })

    test('P3: a focused key that still exists after the removal (rows over one file shift) names the row now at its old place', () => {
        // The first of three rows over one file is removed: the keys that remain are the first two of the old ones.
        expect(focusAfterRemoval(['0:p', '1:p', '2:p'], ['0:p', '1:p'], '0:p')).toBe('0:p')
        // The last of them is the one that went: its key is gone and the previous row takes focus.
        expect(focusAfterRemoval(['0:p', '1:p', '2:p'], ['0:p', '1:p'], '2:p')).toBe('1:p')
        expect(focusAfterRemoval(['x', '0:p', '1:p'], ['x', '0:p'], '0:p')).toBe('0:p')
    })
})

describe('emotionNameRefused', () => {
    test('P5: only a blank name is refused; padding, braces and case are stored as typed', () => {
        for (const blank of ['', ' ', '\t\n']) expect(emotionNameRefused(blank)).toBe(true)
        for (const kept of [' sad ', '::', '}}', 'Happy']) expect(emotionNameRefused(kept)).toBe(false)
    })
})

describe('pickedAfter', () => {
    test('P6: keeps the ticks whose key still names a row, and none when no row is left', () => {
        const picked: Record<string, true> = { '0:pA': true, '1:pA': true, '0:pZ': true }
        expect(pickedAfter(picked, ['0:pA'])).toEqual({ '0:pA': true })
        expect(pickedAfter(picked, [])).toEqual({})
    })
})

describe('emotionMergeSource', () => {
    const owner = (extra: Record<string, unknown> = {}): character => ({ chaId: 'A', type: 'character', name: 'Ann', chats: [], ...extra }) as unknown as character
    const sourceOver = (characters: (character | groupChat)[], settings: Record<string, unknown> = {}) => {
        const db = { characters, ...settings }
        return { db, source: emotionMergeSource({ chaId: 'A', db: () => db }) }
    }
    const query = { kind: 'emotion' as const, names: ['calm'] }

    test('P4: a character owner has no module rows, no enabling count and is never enabled everywhere', async () => {
        const { source } = sourceOver([owner()])
        expect(source.modules()).toEqual([])
        expect(source.enabledEverywhere()).toBe(false)
        expect(await source.countCharacters(query, new AbortController().signal)).toEqual({ state: 'done', characters: [], archivedCharacters: 0 })
    })

    test('P4: the owner is the live character at every call; a missing, group or private one gives none', () => {
        const live = owner()
        const { db, source } = sourceOver([live])
        expect(source.targetOwner()).toEqual({ kind: 'character', source: live })
        expect(source.targetOwner()?.source).toBe(live)
        // Replaced after the source was built: the next call reads the replacement, not a copy kept from before.
        const next = owner({ desc: 'later' })
        db.characters = [next]
        expect(source.targetOwner()?.source).toBe(next)
        db.characters = []
        expect(source.targetOwner()).toBeNull()
        db.characters = [owner({ type: 'group' })]
        expect(source.targetOwner()).toBeNull()
        db.characters = [owner({ license: 'private' })]
        expect(source.targetOwner()).toBeNull()
    })

    test('P4: settings default to 4 and off, and follow the database; a character name falls back to its id', () => {
        const { db, source } = sourceOver([owner()])
        expect(source.settings()).toEqual({ assetMaxDifference: 4, legacyMediaFindings: false, newImageHandlingBeta: false })
        Object.assign(db, { assetMaxDifference: 7, legacyMediaFindings: true, newImageHandlingBeta: true })
        expect(source.settings()).toEqual({ assetMaxDifference: 7, legacyMediaFindings: true, newImageHandlingBeta: true })
        expect(source.characterName('A')).toBe('Ann')
        expect(source.characterName('Z')).toBe('Z')
    })

    test('P4: chats are counted from the live character', async () => {
        const chat = { message: [{ data: 'a {{emotion::calm}} b' }], localLore: [] }
        const { source } = sourceOver([owner({ chats: [chat] })])
        const result = await source.countChats(query, new AbortController().signal)
        expect(result).toMatchObject({ state: 'done', chats: 1 })
    })
})
