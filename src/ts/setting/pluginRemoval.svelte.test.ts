// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { pluginRemovalUndoAction, removePluginEntry } from './pluginRemoval'

function entry(name: string, over: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, script: '', version: '3.0', arguments: { mode: ['a', 'b'], note: 'string' }, realArg: { mode: 'b', note: 'kept' },
        customLink: [], argMeta: { note: { name: 'Note' } }, enabled: true, ...over,
    }
}

function install(plugins: RisuPlugin[], provider = ''): void {
    DBState.db = { plugins, currentPluginProvider: provider } as unknown as Database
}

beforeEach(() => {
    install([])
})

describe('removePluginEntry', () => {
    test('removes the entry, reports its index and clears the provider only when it was the chosen one', () => {
        install([entry('a'), entry('b'), entry('c')], 'b')
        const target = DBState.db.plugins[1]
        const removed = removePluginEntry(target)
        expect(removed).toEqual({ entry: target, index: 1, clearedProvider: true })
        expect(DBState.db.plugins.map((p) => p.name)).toEqual(['a', 'c'])
        expect(DBState.db.currentPluginProvider).toBe('')

        install([entry('a'), entry('b')], 'other')
        expect(removePluginEntry(DBState.db.plugins[0])?.clearedProvider).toBe(false)
        expect(DBState.db.currentPluginProvider).toBe('other')
    })

    test('an entry that is no longer listed is not removed', () => {
        install([entry('a')])
        expect(removePluginEntry(entry('a'))).toBeNull()
        expect(DBState.db.plugins).toHaveLength(1)
    })
})

describe('pluginRemovalUndoAction', () => {
    test('undo puts the identical entry back at its index with its saved values, once reloaded when enabled', async () => {
        install([entry('a'), entry('b'), entry('c')], 'b')
        const target = DBState.db.plugins[1]
        const before = JSON.stringify(target)
        const removed = removePluginEntry(target)!
        const reload = vi.fn(async () => { })

        const outcome = await pluginRemovalUndoAction(removed, reload).run()

        expect(outcome.ok).toBe(true)
        expect(DBState.db.plugins[1]).toBe(target)
        expect(JSON.stringify(DBState.db.plugins[1])).toBe(before)
        expect(DBState.db.plugins.map((p) => p.name)).toEqual(['a', 'b', 'c'])
        expect(DBState.db.currentPluginProvider).toBe('b')
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('a disabled entry is restored without a reload', async () => {
        install([entry('a', { enabled: false })])
        const removed = removePluginEntry(DBState.db.plugins[0])!
        const reload = vi.fn(async () => { })
        await pluginRemovalUndoAction(removed, reload).run()
        expect(DBState.db.plugins).toHaveLength(1)
        expect(reload).not.toHaveBeenCalled()
    })

    test('the provider is restored only when this removal cleared it and it is still empty', async () => {
        install([entry('a')], 'a')
        const removed = removePluginEntry(DBState.db.plugins[0])!
        DBState.db.currentPluginProvider = 'newer-choice'
        await pluginRemovalUndoAction(removed, async () => { }).run()
        expect(DBState.db.currentPluginProvider).toBe('newer-choice')

        install([entry('a')], 'other')
        const kept = removePluginEntry(DBState.db.plugins[0])!
        await pluginRemovalUndoAction(kept, async () => { }).run()
        expect(DBState.db.currentPluginProvider).toBe('other')
    })

    test('a plugin with the same name installed again refuses the undo and changes nothing', async () => {
        install([entry('a')])
        const removed = removePluginEntry(DBState.db.plugins[0])!
        DBState.db.plugins = [entry('a', { versionOfPlugin: '9.9.9' })]
        const outcome = await pluginRemovalUndoAction(removed, async () => { }).run()
        expect(outcome.ok).toBe(false)
        expect(outcome.text).toContain('a')
        expect(DBState.db.plugins).toHaveLength(1)
        expect(DBState.db.plugins[0].versionOfPlugin).toBe('9.9.9')
    })

    test('the index is clamped when the list got shorter', async () => {
        install([entry('a'), entry('b'), entry('c')])
        const removed = removePluginEntry(DBState.db.plugins[2])!
        DBState.db.plugins = [entry('x')]
        await pluginRemovalUndoAction(removed, async () => { }).run()
        expect(DBState.db.plugins.map((p) => p.name)).toEqual(['x', 'c'])
    })
})
