// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { currentSlots, syncSlots, updateSlots } from './slotsStore.svelte'

const KEY = 'risuChatShell.actionSlots'
afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(KEY)
    syncSlots()
})

describe('shared action slots', () => {
    test('an update is visible to the next reader and stored', () => {
        updateSlots({ order: ['copy', 'edit', 'delete'], pinned: ['copy'] })
        expect(currentSlots().pinned).toEqual(['copy'])
        expect(JSON.parse(localStorage.getItem(KEY)!).order).toEqual(['copy', 'edit', 'delete'])
    })

    test('a change made behind the shared copy is adopted by syncSlots', () => {
        updateSlots({ order: ['edit', 'delete'], pinned: ['edit'] })
        localStorage.setItem(KEY, JSON.stringify({ order: ['delete', 'edit'], pinned: ['delete'] }))
        syncSlots()
        expect(currentSlots().pinned).toEqual(['delete'])
    })

    test('an unwritable storage keeps the session layout on the next sync', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        updateSlots({ order: ['copy', 'edit', 'delete'], pinned: ['copy'] })
        syncSlots()
        expect(currentSlots().pinned).toEqual(['copy'])
    })
})
