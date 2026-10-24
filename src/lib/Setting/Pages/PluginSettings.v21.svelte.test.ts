// @vitest-environment happy-dom

/**
 * A V2.1 row of `PluginSettings.svelte` is data only: it names the plugin and the API change it needs, its power
 * button is disabled, it offers no argument editor and no settings-file button, and it can still be removed.
 *
 * Mounts the REAL `PluginSettings.svelte` over a real `$state` database. The plugin runtime (`plugins.svelte.ts`) is a
 * stub that records `loadPlugins`; the alert confirm answers true. Titles beginning "reproducer:" fail on the
 * pre-change component; "guard:" pins behaviour that holds before and after. The toggle test asserts the `disabled`
 * attribute only: the refusal itself is proven in `pluginV21Retired.svelte.test.ts`, because happy-dom's click
 * handling of disabled buttons would prove browser semantics rather than this code.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region module mocks

const loadPluginsMock = vi.hoisted(() => vi.fn())

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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    checkPluginUpdate: vi.fn(async () => undefined),
    createBlankPlugin: vi.fn(),
    importPlugin: vi.fn(),
    loadPlugins: loadPluginsMock,
    togglePluginEnabled: vi.fn(),
    updatePlugin: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/developMode'), () => ({
    hotReloadPluginFiles: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/apiV3/developMode'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import PluginSettings from './PluginSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function plugin(version: RisuPlugin['version']): RisuPlugin {
    return {
        name: 'p', displayName: 'p', script: '', version, arguments: { mode: ['a', 'b'], note: 'string' }, realArg: {},
        customLink: [], argMeta: {}, enabled: true,
    } as unknown as RisuPlugin
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function render(version: RisuPlugin['version'], open: boolean): Promise<HTMLElement> {
    DBState.db = { plugins: [plugin(version)], currentPluginProvider: '' } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PluginSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    if (open) {
        await toggleRow(target)
    }
    return target
}

async function toggleRow(target: HTMLElement): Promise<void> {
    ;(target.querySelector('div[role="button"]') as HTMLElement).click()
    await settle()
}

const controlCount = (target: HTMLElement) => target.querySelectorAll('select, input, textarea').length
const settingsFileButton = (target: HTMLElement) => target.querySelector(`button[aria-label="${language.pluginSettingsFile.button}"]`)
const versionWarning = language.pluginVersionWarn.replace('{{plugin_version}}', 'API V2.1').replace('{{required_version}}', 'API V3')

beforeEach(() => {
    loadPluginsMock.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('a V2.1 plugin row', () => {
    test('reproducer: it shows the version warning, has no warning triangle and its only disabled button is the power button', async () => {
        const target = await render('2.1', false)

        expect(target.textContent).toContain(versionWarning)
        expect(target.querySelector('button.text-yellow-400')).toBeNull()
        expect(target.querySelectorAll('button[disabled]').length).toBe(1)
    })

    test('reproducer: an opened row renders no argument control and no settings-file button', async () => {
        const target = await render('2.1', true)

        expect(controlCount(target)).toBe(0)
        expect(settingsFileButton(target)).toBeNull()
    })

    test('guard: an opened 3.0 row with the same arguments still renders them and the settings-file button', async () => {
        const target = await render('3.0', true)

        expect(target.querySelectorAll('select').length).toBe(1)
        expect(target.querySelectorAll('input').length).toBeGreaterThanOrEqual(1)
        expect(settingsFileButton(target)).not.toBeNull()
    })

    test('guard: a version 2 row keeps its warning triangle', async () => {
        const target = await render(2, false)

        expect(target.querySelector('button.text-yellow-400')).not.toBeNull()
    })

    // happy-dom does not reproduce the browser's select write-back (`option:checked` answers null there), so this
    // cannot observe that mechanism. The hidden-argument test above is the protection: with no editor rendered, no UI
    // path can write `realArg`.
    test('guard: opening and closing the row leaves the saved entry unchanged (happy-dom cannot observe a select write-back)', async () => {
        const target = await render('2.1', true)
        const before = JSON.stringify(plugin('2.1'))

        await toggleRow(target)

        expect(JSON.stringify(DBState.db.plugins[0])).toBe(before)
    })

    test('guard: the remove button asks for confirmation, removes the entry and reloads the plugins once', async () => {
        const target = await render('2.1', false)
        const title = target.querySelector('div.font-bold span') as HTMLElement
        const buttons = Array.from(title.closest('div.flex.gap-2')!.querySelectorAll('button')) as HTMLButtonElement[]

        buttons[buttons.length - 1].click()
        await settle()

        expect(DBState.db.plugins).toEqual([])
        expect(loadPluginsMock).toHaveBeenCalledTimes(1)
    })
})
