// @vitest-environment jsdom
/**
 * Device-local favourite toggles (UI-S1b stage E1, CHORE-566): the stored format, the change rules and the MC-350 rules
 * for a value this build cannot read. Guards by construction: the module is new.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    FAVOURITES_KEY,
    UNREADABLE_KEY,
    applyFavouriteChange,
    changeFavourites,
    favouriteRows,
    favouriteUid,
    isShowing,
    parseFavourites,
    readFavourites,
    serializeFavourites,
    type FavouriteRef,
} from './toggleFavourites'
import type { PanelItem, PanelSource, PanelSourceKind, PanelValueRow } from './togglePanel'

const row = (uid: string, key: string): PanelValueRow => ({ type: 'row', uid, key, label: key, kind: 'check', options: [] })
const source = (id: string, kind: PanelSourceKind, name: string, items: PanelItem[]): PanelSource => ({ id, kind, name, detail: '', items })
const ref = (s: string, k: string): FavouriteRef => ({ s, k })
const stored = (items: FavouriteRef[]): string => JSON.stringify({ v: 1, items })
const written = (): FavouriteRef[] => JSON.parse(localStorage.getItem(FAVOURITES_KEY)!).items

beforeEach(() => {
    localStorage.removeItem(FAVOURITES_KEY)
    localStorage.removeItem(UNREADABLE_KEY)
})
afterEach(() => {
    vi.restoreAllMocks()
})

describe('stored format', () => {
    test('absent reads as no stars', () => {
        expect(parseFavourites(null)).toEqual({ status: 'ok', items: [] })
    })

    test('the value a writer produces reads back, source and key both kept', () => {
        const items = [ref('prompt', 'tone'), ref('module:m1', 'deck'), ref('character:c1', 'plain')]
        expect(parseFavourites(stored(items))).toEqual({ status: 'ok', items })
        expect(JSON.parse(serializeFavourites(items))).toEqual({ v: 1, items })
    })

    test('a duplicate star is read once', () => {
        expect(parseFavourites(stored([ref('prompt', 'a'), ref('prompt', 'a')]))).toEqual({ status: 'ok', items: [ref('prompt', 'a')] })
    })

    test.each([
        ['broken JSON', '{"v":1,'],
        ['a later format', JSON.stringify({ v: 2, items: [] })],
        ['no version', JSON.stringify({ items: [] })],
        ['items not a list', JSON.stringify({ v: 1, items: {} })],
        ['an item without its source', JSON.stringify({ v: 1, items: [{ k: 'a' }] })],
        ['an item without its key', JSON.stringify({ v: 1, items: [{ s: 'prompt' }] })],
        ['a bare string', '"x"'],
        ['null', 'null'],
    ])('%s is unreadable, never trimmed', (_name, raw) => {
        expect(parseFavourites(raw)).toEqual({ status: 'unreadable' })
    })
})

describe('change rules', () => {
    const base = [ref('prompt', 'a'), ref('module:m', 'b'), ref('prompt', 'c')]

    test('add goes last and is idempotent; remove drops it; both leave the input alone', () => {
        const input = [ref('prompt', 'a')]
        expect(applyFavouriteChange(input, { type: 'add', ref: ref('prompt', 'z') })).toEqual([ref('prompt', 'a'), ref('prompt', 'z')])
        expect(applyFavouriteChange(input, { type: 'add', ref: ref('prompt', 'a') })).toEqual(input)
        expect(applyFavouriteChange(base, { type: 'remove', ref: ref('module:m', 'b') })).toEqual([ref('prompt', 'a'), ref('prompt', 'c')])
        expect(input).toEqual([ref('prompt', 'a')])
    })

    test('the same key under another source is another star', () => {
        const list = applyFavouriteChange([ref('prompt', 'a')], { type: 'add', ref: ref('module:m', 'a') })
        expect(list).toEqual([ref('prompt', 'a'), ref('module:m', 'a')])
    })

    test('move swaps with the neighbour and stops at the ends', () => {
        const all = () => true
        expect(applyFavouriteChange(base, { type: 'move', ref: ref('module:m', 'b'), by: -1, visible: all })).toEqual([ref('module:m', 'b'), ref('prompt', 'a'), ref('prompt', 'c')])
        expect(applyFavouriteChange(base, { type: 'move', ref: ref('prompt', 'a'), by: -1, visible: all })).toEqual(base)
        expect(applyFavouriteChange(base, { type: 'move', ref: ref('prompt', 'c'), by: 1, visible: all })).toEqual(base)
    })

    test('move steps over a hidden star and leaves it where it is', () => {
        const visible = (candidate: FavouriteRef) => candidate.s !== 'module:m'
        const result = applyFavouriteChange(base, { type: 'move', ref: ref('prompt', 'c'), by: -1, visible })
        expect(result).toEqual([ref('prompt', 'c'), ref('module:m', 'b'), ref('prompt', 'a')])
    })

    test('a star that is not in the list cannot be moved or removed', () => {
        expect(applyFavouriteChange(base, { type: 'remove', ref: ref('prompt', 'nope') })).toEqual(base)
        expect(applyFavouriteChange(base, { type: 'move', ref: ref('prompt', 'nope'), by: 1, visible: () => true })).toEqual(base)
    })
})

describe('changeFavourites against device storage', () => {
    test('a change is applied to what storage holds now, so another tab\'s star is kept', () => {
        localStorage.setItem(FAVOURITES_KEY, stored([ref('prompt', 'a')]))
        const shown = readFavourites().items
        // Another tab stars something after this tab last read.
        localStorage.setItem(FAVOURITES_KEY, stored([ref('prompt', 'a'), ref('prompt', 'other-tab')]))
        const view = changeFavourites({ type: 'add', ref: ref('prompt', 'mine') }, shown)
        expect(view.items).toEqual([ref('prompt', 'a'), ref('prompt', 'other-tab'), ref('prompt', 'mine')])
        expect(written()).toEqual(view.items)
    })

    test('the first star on an empty device writes version 1', () => {
        const view = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        expect(view).toEqual({ items: [ref('prompt', 'a')], unreadable: false })
        expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual({ v: 1, items: [ref('prompt', 'a')] })
    })

    test.each([
        ['broken JSON', '{"v":1,'],
        ['a later format', JSON.stringify({ v: 2, items: [{ s: 'prompt', k: 'x' }], extra: true })],
    ])('%s: the bytes are copied once to the side key before the first write', (_name, raw) => {
        localStorage.setItem(FAVOURITES_KEY, raw)
        expect(readFavourites()).toEqual({ items: [], unreadable: true })
        const view = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        expect(localStorage.getItem(UNREADABLE_KEY)).toBe(raw)
        expect(written()).toEqual([ref('prompt', 'a')])
        expect(view).toEqual({ items: [ref('prompt', 'a')], unreadable: false })
        // The next change reads the new list as ordinary data and does not copy again.
        changeFavourites({ type: 'add', ref: ref('prompt', 'b') }, view.items)
        expect(localStorage.getItem(UNREADABLE_KEY)).toBe(raw)
    })

    test('an occupied side key is never overwritten and the unreadable bytes stay: stars are session only', () => {
        const raw = JSON.stringify({ v: 2, items: [] })
        localStorage.setItem(FAVOURITES_KEY, raw)
        localStorage.setItem(UNREADABLE_KEY, 'an earlier copy')
        const view = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        expect(localStorage.getItem(UNREADABLE_KEY)).toBe('an earlier copy')
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(raw)
        expect(view).toEqual({ items: [ref('prompt', 'a')], unreadable: true })
        // The session list is the base of the next change.
        const next = changeFavourites({ type: 'add', ref: ref('prompt', 'b') }, view.items)
        expect(next.items).toEqual([ref('prompt', 'a'), ref('prompt', 'b')])
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(raw)
    })

    test('a storage that refuses the copy leaves the unreadable bytes alone', () => {
        const raw = '{"v":1,'
        localStorage.setItem(FAVOURITES_KEY, raw)
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        const view = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        expect(view).toEqual({ items: [ref('prompt', 'a')], unreadable: true })
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(raw)
        expect(localStorage.getItem(UNREADABLE_KEY)).toBeNull()
    })

    test('an unwritable storage keeps the change for the session', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        expect(changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, []).items).toEqual([ref('prompt', 'a')])
    })

    test('an unwritable storage keeps every earlier session star across changes', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        const first = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        const second = changeFavourites({ type: 'add', ref: ref('prompt', 'b') }, first.items)
        expect(second.items).toEqual([ref('prompt', 'a'), ref('prompt', 'b')])
        const third = changeFavourites({ type: 'remove', ref: ref('prompt', 'a') }, second.items)
        expect(third.items).toEqual([ref('prompt', 'b')])
    })

    test('an unreadable storage keeps every earlier session star across changes', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        const first = changeFavourites({ type: 'add', ref: ref('prompt', 'a') }, [])
        const second = changeFavourites({ type: 'add', ref: ref('prompt', 'b') }, first.items)
        expect(second.items).toEqual([ref('prompt', 'a'), ref('prompt', 'b')])
    })

    test('a storage that cannot be read gives an empty list and does not throw', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        expect(readFavourites()).toEqual({ items: [], unreadable: false })
    })
})

describe('favouriteRows', () => {
    const model = {
        sources: [
            source('prompt', 'prompt', 'Prompt', [row('prompt#0', 'tone'), row('prompt#1', 'scene')]),
            source('module:m1', 'module', 'Cards', [
                row('module:m1#0', 'deck'),
                { type: 'group', uid: 'module:m1#1', label: 'Extras', children: [row('module:m1#2', 'inner')] },
            ]),
            source('character:c1', 'character', 'Character', [row('character:c1#0', 'plain')]),
        ],
    }

    test('rows come back in star order with a distinct uid, and a group row names its group', () => {
        const rows = favouriteRows(model.sources, [ref('character:c1', 'plain'), ref('module:m1', 'inner'), ref('prompt', 'tone')])
        expect(rows.map((entry) => entry.row.key)).toEqual(['plain', 'inner', 'tone'])
        expect(rows.map((entry) => entry.group)).toEqual([null, 'Extras', null])
        expect(rows[0].row.uid).toBe(favouriteUid('character:c1#0'))
        expect(rows[1].row.uid).toBe(favouriteUid('module:m1#2'))
        expect(rows[1].row.uid).not.toBe('module:m1#2')
    })

    test('a star whose source is not in use, or whose key is gone, is left out of the view and nowhere else', () => {
        const items = [ref('module:gone', 'deck'), ref('prompt', 'removed'), ref('prompt', 'tone')]
        expect(favouriteRows(model.sources, items).map((entry) => entry.ref)).toEqual([ref('prompt', 'tone')])
        expect(items).toHaveLength(3)
        expect(isShowing(model.sources, ref('module:gone', 'deck'))).toBe(false)
        expect(isShowing(model.sources, ref('prompt', 'tone'))).toBe(true)
    })

    test('the same key in two sources is two stars with their own rows', () => {
        const twin = {
            sources: [
                source('prompt', 'prompt', 'Prompt', [row('prompt#0', 'shared')]),
                source('module:m', 'module', 'M', [row('module:m#0', 'shared')]),
            ],
        }
        const rows = favouriteRows(twin.sources, [ref('module:m', 'shared')])
        expect(rows).toHaveLength(1)
        expect(rows[0].source.id).toBe('module:m')
    })
})
