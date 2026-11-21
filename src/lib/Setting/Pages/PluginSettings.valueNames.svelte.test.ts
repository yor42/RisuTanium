// @vitest-environment jsdom

/**
 * `PluginSettings.svelte` argument value controls: the option select and the number input of a plugin
 * argument are named by the argument's visible label span through `aria-labelledby`, with ids that are
 * unique per plugin row and argument. Mounts the REAL page over a real `$state` database with the real
 * shared inputs; mocks are those of `PluginSettings.names.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hotReloading: [] as string[],
        selIdState: { selId: 0 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    checkPluginUpdate: vi.fn(async () => ({ version: '2' })),
    createBlankPlugin: vi.fn(),
    importPlugin: vi.fn(),
    loadPlugins: vi.fn(),
    togglePluginEnabled: vi.fn(),
    updatePlugin: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/developMode'), () => ({
    hotReloadPluginFiles: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/apiV3/developMode'))

vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { DBState } from 'src/ts/stores.svelte'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import PluginSettings from './PluginSettings.svelte'

function plugin(name: string, extra: Partial<RisuPlugin>): RisuPlugin {
    return {
        name,
        displayName: name,
        script: '',
        version: 3,
        customLink: [],
        enabled: true,
        ...extra,
    } as unknown as RisuPlugin
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function render(plugins: RisuPlugin[]): Promise<HTMLElement> {
    DBState.db = { plugins, currentPluginProvider: '', hotkeys: [], longPressToPopupEditor: false } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PluginSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    for (const row of Array.from(target.querySelectorAll<HTMLElement>('div[role="button"]'))) {
        row.click()
        flushSync()
    }
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('PluginSettings argument value controls are named', () => {
    test('option select and number input take the argument label from argMeta', async () => {
        const target = await render([plugin('p', {
            arguments: { mode: ['a', 'b'], count: 'int' },
            realArg: { mode: 'a', count: 1 },
            argMeta: { mode: { name: 'Mode label' }, count: { name: 'Count label' } },
        } as unknown as Partial<RisuPlugin>)])
        check(target, [{ name: 'Mode label' }, { name: 'Count label' }])
    })

    test('an argument without argMeta is named by its key', async () => {
        const target = await render([plugin('p', {
            arguments: { mode: ['a', 'b'], count: 'int' },
            realArg: { mode: 'a', count: 1 },
            argMeta: {},
        } as unknown as Partial<RisuPlugin>)])
        check(target, [{ name: 'mode' }, { name: 'count' }])
    })

    test('text, textarea, checkbox and radio arguments sit between the value controls without adding or pairing a toggle', async () => {
        const target = await render([plugin('p', {
            arguments: { first: ['a', 'b'], note: 'string', body: 'string', flag: 'int', pick: 'int', last: 'int' },
            realArg: { first: 'a', note: '', body: '', flag: '0', pick: 1, last: 2 },
            argMeta: {
                first: { name: 'First label' },
                note: { name: 'Note label' },
                body: { name: 'Body label', textarea: true },
                flag: { name: 'Flag label', checkbox: '1' },
                pick: { name: 'Pick label', radio: 'One|1,Two|2' },
                last: { name: 'Last label' },
            },
        } as unknown as Partial<RisuPlugin>)])
        check(target, [{ name: 'First label' }, { name: 'Last label' }])
    })

    test('two open plugin rows give each value control its own naming span', async () => {
        const target = await render([
            plugin('p1', {
                arguments: { mode: ['a', 'b'] },
                realArg: { mode: 'a' },
                argMeta: { mode: { name: 'Mode one' } },
            } as unknown as Partial<RisuPlugin>),
            plugin('p2', {
                arguments: { mode: ['a', 'b'], count: 'int' },
                realArg: { mode: 'a', count: 1 },
                argMeta: { mode: { name: 'Mode two' }, count: { name: 'Count two' } },
            } as unknown as Partial<RisuPlugin>),
        ])
        check(target, [{ name: 'Mode one' }, { name: 'Mode two' }, { name: 'Count two' }])
    })
})
