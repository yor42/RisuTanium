// @vitest-environment node

/**
 * The sidebar-item Undo: removal copies the item before reassigning the list, and the restore re-reads the
 * live list, refuses when the id is back, clamps the original index and reassigns instead of mutating.
 *
 * MOCKED: `DBState` is a `$state` stand-in with a plain `customSidebarItems` array, so the list is a reactive
 * proxy as in the application. The language module and `fillLang` are real.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CustomSideBarItem, Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { removeSidebarItem, sidebarItemUndoAction } from './sidebarItemUndo'

// Items shaped as the dialog's Add buttons push them.
function entry(id: string, label: string, type: CustomSideBarItem['type'] = 'model'): CustomSideBarItem {
    return { id, type, subType: 'none', label }
}

function ids(): string[] {
    return DBState.db.customSidebarItems.map((item) => item.id)
}

beforeEach(() => {
    DBState.db = { customSidebarItems: [entry('a', 'Model'), entry('b', 'Presets', 'preset'), entry('c', 'Model')] } as unknown as Database
})

describe('removeSidebarItem', () => {
    test('removes by id, returns a copy and the index, and reassigns the list', () => {
        const before = DBState.db.customSidebarItems
        const removed = removeSidebarItem('b')

        expect(removed).toEqual({ item: entry('b', 'Presets', 'preset'), index: 1 })
        expect(ids()).toEqual(['a', 'c'])
        expect(DBState.db.customSidebarItems).not.toBe(before)
        expect(before).toHaveLength(3)
    })

    test('returns null and changes nothing when the id is absent', () => {
        const before = DBState.db.customSidebarItems
        expect(removeSidebarItem('zzz')).toBeNull()
        expect(DBState.db.customSidebarItems).toBe(before)
    })

    test('the returned item is a copy that later changes to the list entry do not reach', () => {
        const original = DBState.db.customSidebarItems[1]
        const removed = removeSidebarItem('b')
        original.label = 'Changed after removal'

        expect(removed?.item.label).toBe('Presets')
    })
})

describe('sidebarItemUndoAction', () => {
    test('uses a per-item action id and the language failure text', () => {
        const action = sidebarItemUndoAction(entry('b', 'Presets'), 1)
        expect(action.id).toBe('sidebar-item:b')
        expect(action.failedText).toBe(language.othersUi.sidebarItemUndoFailed)
    })

    test('restores at the original index with the same fields and reassigns the list', async () => {
        const removed = removeSidebarItem('b')!
        const action = sidebarItemUndoAction(removed.item, removed.index)
        const afterRemoval = DBState.db.customSidebarItems

        const outcome = await action.run()

        expect(outcome).toEqual({ ok: true, text: fillLang(language.othersUi.sidebarItemRestored, { name: 'Presets' }) })
        expect(ids()).toEqual(['a', 'b', 'c'])
        expect(DBState.db.customSidebarItems[1]).toEqual(entry('b', 'Presets', 'preset'))
        expect(DBState.db.customSidebarItems).not.toBe(afterRemoval)
        expect(afterRemoval).toHaveLength(2)
    })

    test('refuses and leaves the list alone when the id is back', async () => {
        const removed = removeSidebarItem('b')!
        const action = sidebarItemUndoAction(removed.item, removed.index)
        DBState.db.customSidebarItems.push(entry('b', 'Presets', 'preset'))
        const before = DBState.db.customSidebarItems

        const outcome = await action.run()

        expect(outcome).toEqual({ ok: false, text: fillLang(language.othersUi.sidebarItemUndoRefused, { name: 'Presets' }) })
        expect(DBState.db.customSidebarItems).toBe(before)
        expect(ids()).toEqual(['a', 'c', 'b'])
    })

    test('clamps the index when the list has shrunk since the removal', async () => {
        const removed = removeSidebarItem('c')!
        expect(removed.index).toBe(2)
        const action = sidebarItemUndoAction(removed.item, removed.index)
        DBState.db.customSidebarItems = [entry('a', 'Model')]

        await action.run()

        expect(ids()).toEqual(['a', 'c'])
    })

    test('the restored item is independent of the removed proxy and of the later mutation of the original', async () => {
        const original = DBState.db.customSidebarItems[1]
        const removed = removeSidebarItem('b')!
        const action = sidebarItemUndoAction(removed.item, removed.index)
        original.label = 'Mutated'
        removed.item.label = 'Mutated copy'

        await action.run()

        expect(DBState.db.customSidebarItems[1].label).toBe('Presets')
    })

    test('a second run after a success refuses, so a repeated press cannot duplicate the row', async () => {
        const removed = removeSidebarItem('b')!
        const action = sidebarItemUndoAction(removed.item, removed.index)

        await action.run()
        const second = await action.run()

        expect(second.ok).toBe(false)
        expect(ids()).toEqual(['a', 'b', 'c'])
    })
})
