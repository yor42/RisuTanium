// @vitest-environment happy-dom

/**
 * `PromptSettings.svelte` (Settings page 13) is reachable for a profile or preset that has no
 * prompt template: the field is then undefined (never set) or null (a preset applied without a
 * template). The page must treat that as an empty list, render the no-format message and write
 * nothing to the database on open, because assigning `[]` would flip the preset into template mode.
 *
 * Mounts the REAL page with the REAL `tokenizePreset` and `templateCheck` over a real `$state`
 * database. The heavy child components and the tokenizer are stubbed.
 *
 * MOCKED: `alert`, `stores.svelte`, `tokenizer`, `plugins.svelte`, `globalApi.svelte`, and the
 * child components that are not part of the empty state.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { PromptItem } from 'src/ts/process/prompt'
import { language } from 'src/lang'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(0),
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    return new Proxy({} as Record<string, unknown>, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
    tokenizerList: [],
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/PromptDataItem.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))

import PromptSettings from './PromptSettings.svelte'
import { DBState } from 'src/ts/stores.svelte'

let mounted: Record<string, unknown> | null = null
let caught: unknown[] = []

const onWindowError = (event: ErrorEvent) => {
    caught.push(event.error ?? event.message)
    event.preventDefault()
}
const onRejection = (event: PromiseRejectionEvent) => {
    caught.push(event.reason)
    event.preventDefault()
}
const onUncaught = (error: unknown) => {
    caught.push(error)
}

beforeEach(() => {
    caught = []
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onRejection)
    process.on('uncaughtException', onUncaught)
    process.on('unhandledRejection', onUncaught)
})

afterEach(async () => {
    if (mounted !== null) {
        await unmount(mounted as never)
    }
    mounted = null
    document.body.replaceChildren()
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onRejection)
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onUncaught)
    DBState.db = {} as unknown as Database
})

describe('PromptSettings: profile without a prompt template', () => {
    test.each([
        ['undefined', undefined],
        ['null', null],
    ])('a %s template mounts, shows the no-format message and stays unwritten', async (_label, value) => {
        DBState.db = { promptTemplate: value } as unknown as Database

        const holder = document.createElement('div')
        document.body.append(holder)
        expect(() => {
            mounted = mount(PromptSettings, { target: holder }) as unknown as Record<string, unknown>
            flushSync()
        }).not.toThrow()
        // Let the async tokenize calls settle so a late rejection reaches the listeners.
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(caught).toEqual([])
        expect(holder.textContent).toContain(language.settingsPage.noFormat)
        expect(DBState.db.promptTemplate).toBe(value)
    })

    test.each([
        ['undefined', undefined],
        ['null', null],
    ])('the open-all shortcut on a %s template throws nothing and stays unwritten', async (_label, value) => {
        DBState.db = { promptTemplate: value } as unknown as Database

        const holder = document.createElement('div')
        document.body.append(holder)
        mounted = mount(PromptSettings, { target: holder }) as unknown as Record<string, unknown>
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 50))

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, altKey: true, bubbles: true }))
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(caught).toEqual([])
        expect(DBState.db.promptTemplate).toBe(value)
    })

    test.each([
        ['undefined', undefined],
        ['null', null],
    ])('the open-all shortcut after the template becomes %s throws nothing', async (_label, value) => {
        const items: PromptItem[] = [
            { type: 'plain', type2: 'normal', text: 'a', role: 'user' },
            { type: 'plain', type2: 'normal', text: 'b', role: 'user' },
        ]
        DBState.db = { promptTemplate: items } as unknown as Database

        const holder = document.createElement('div')
        document.body.append(holder)
        mounted = mount(PromptSettings, { target: holder }) as unknown as Record<string, unknown>
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 50))

        // The first press opens every item, so the opened count no longer matches an empty list.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, altKey: true, bubbles: true }))
        flushSync()
        DBState.db.promptTemplate = value as unknown as PromptItem[]
        flushSync()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, altKey: true, bubbles: true }))
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(caught).toEqual([])
    })
})
