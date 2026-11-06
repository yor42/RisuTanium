// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FAVOURITES_KEY, UNREADABLE_KEY } from './toggleFavourites'
import { currentFavourites, syncFavourites, updateFavourites } from './toggleFavouritesStore.svelte'

const star = (k: string) => ({ s: 'prompt', k })

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(FAVOURITES_KEY)
    localStorage.removeItem(UNREADABLE_KEY)
    syncFavourites()
})

describe('shared favourites', () => {
    test('an update is visible to the next reader and stored', () => {
        updateFavourites({ type: 'add', ref: star('a') })
        expect(currentFavourites().items).toEqual([star('a')])
        expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual({ v: 1, items: [star('a')] })
    })

    test('a change made behind the shared copy is adopted by syncFavourites', () => {
        updateFavourites({ type: 'add', ref: star('a') })
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [star('b')] }))
        syncFavourites()
        expect(currentFavourites().items).toEqual([star('b')])
    })

    test('an update lands on the other tab\'s list, not on a stale copy', () => {
        updateFavourites({ type: 'add', ref: star('a') })
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [star('a'), star('theirs')] }))
        updateFavourites({ type: 'add', ref: star('mine') })
        expect(currentFavourites().items).toEqual([star('a'), star('theirs'), star('mine')])
    })

    test('an unwritable storage keeps the session list on the next sync', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        updateFavourites({ type: 'add', ref: star('a') })
        syncFavourites()
        expect(currentFavourites().items).toEqual([star('a')])
        // Leave the shared copy empty for the next case.
        vi.restoreAllMocks()
        updateFavourites({ type: 'remove', ref: star('a') })
    })

    test('an unreadable stored value is flagged and the session list survives a sync', () => {
        localStorage.setItem(FAVOURITES_KEY, '{"v":2,"items":[]}')
        localStorage.setItem(UNREADABLE_KEY, 'taken')
        syncFavourites()
        expect(currentFavourites()).toEqual({ items: [], unreadable: true })
        updateFavourites({ type: 'add', ref: star('a') })
        syncFavourites()
        expect(currentFavourites()).toEqual({ items: [star('a')], unreadable: true })
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe('{"v":2,"items":[]}')
    })
})
