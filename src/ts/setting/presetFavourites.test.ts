// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest'
import type { botPreset } from 'src/ts/storage/database.svelte'
import { FAVOURITES_KEY, favouriteRows, parseFavourites, serializeFavourites } from 'src/ts/chatShell/toggleFavourites'
import { currentFavourites, syncFavourites } from 'src/ts/chatShell/toggleFavouritesStore.svelte'
import type { PanelSource } from 'src/ts/chatShell/togglePanel'
import { PRESET_FAVOURITE_SOURCE, isPresetFavourite, presetFavouriteRef, togglePresetFavourite } from './presetFavourites'

/** A prompt source with one toggle row, as the panel builds it. */
const promptSource: PanelSource = {
    id: 'prompt',
    kind: 'prompt',
    name: 'Prompt',
    detail: '',
    items: [{ type: 'row', uid: 'prompt#0', key: 'tone', label: 'Tone', kind: 'check', options: [] }],
}

function storedItems(): unknown {
    const raw = localStorage.getItem(FAVOURITES_KEY)
    const parsed = parseFavourites(raw)
    return parsed.status === 'ok' ? parsed.items : null
}

beforeEach(() => {
    localStorage.clear()
    syncFavourites()
})

describe('A12 preset favourites ride the device-local favourites list', () => {
    test('a toggle writes {s:"preset",k:id} to the CHORE-566 key and a second toggle removes it', () => {
        const db = { botPresets: [{ name: 'a', id: 'id-a' }, { name: 'b', id: 'id-b' }] as botPreset[] }
        expect(togglePresetFavourite(db, 1)).toBe(true)
        expect(storedItems()).toEqual([{ s: PRESET_FAVOURITE_SOURCE, k: 'id-b' }])
        expect(isPresetFavourite(currentFavourites().items, 'id-b')).toBe(true)
        expect(isPresetFavourite(currentFavourites().items, 'id-a')).toBe(false)
        expect(togglePresetFavourite(db, 1)).toBe(false)
        expect(storedItems()).toEqual([])
    })

    test('a star follows its preset through a reorder, because it is keyed by id', () => {
        const db = { botPresets: [{ name: 'a', id: 'id-a' }, { name: 'b', id: 'id-b' }] as botPreset[] }
        togglePresetFavourite(db, 1)
        db.botPresets.reverse()
        expect(isPresetFavourite(currentFavourites().items, db.botPresets[0].id)).toBe(true)
        expect(isPresetFavourite(currentFavourites().items, db.botPresets[1].id)).toBe(false)
    })

    test('a preset without an id gets one when it is starred (a database write)', () => {
        const db = { botPresets: [{ name: 'a' }] as botPreset[] }
        expect(togglePresetFavourite(db, 0)).toBe(true)
        const id = db.botPresets[0].id
        expect(typeof id).toBe('string')
        expect(storedItems()).toEqual([presetFavouriteRef(id as string)])
    })

    test('an index that names no preset changes nothing', () => {
        const db = { botPresets: [] as botPreset[] }
        expect(togglePresetFavourite(db, 0)).toBeNull()
        expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull()
    })

    test('guard: a stored list holding a preset star parses ok, and the toggle panel shows only its own stars', () => {
        const items = [presetFavouriteRef('id-a'), { s: 'prompt', k: 'tone' }]
        const parsed = parseFavourites(serializeFavourites(items))
        expect(parsed).toEqual({ status: 'ok', items })
        if (parsed.status !== 'ok') throw new Error('unreadable')
        expect(favouriteRows([promptSource], parsed.items).map((row) => row.ref)).toEqual([{ s: 'prompt', k: 'tone' }])
    })

    test('the favourites are never part of the database object', () => {
        const db = { botPresets: [{ name: 'a', id: 'id-a' }] as botPreset[] }
        togglePresetFavourite(db, 0)
        expect(Object.keys(db)).toEqual(['botPresets'])
        expect(Object.keys(db.botPresets[0]).sort()).toEqual(['id', 'name'])
    })
})
