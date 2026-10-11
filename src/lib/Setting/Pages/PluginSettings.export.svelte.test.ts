// @vitest-environment happy-dom

/**
 * `PluginSettings.svelte`'s per-plugin export button downloads the script of the plugin on
 * its own row, under that plugin's sanitised `.js` name, and nothing else. Mounts the REAL
 * `PluginSettings.svelte` over a real `$state` database; `downloadFile` is a recording mock.
 * Every test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region module mocks

const downloadMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: downloadMock,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
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
    loadPlugins: vi.fn(),
    togglePluginEnabled: vi.fn(),
    updatePlugin: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/developMode'), () => ({
    hotReloadPluginFiles: vi.fn(),
}) as unknown as typeof import('src/ts/plugins/apiV3/developMode'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import PluginSettings from './PluginSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The row title differs from the plugin name, so a file name taken from the display name is caught. */
const shown = (name: string) => 'Shown ' + name

function plugin(name: string, script: string): RisuPlugin {
    return {
        name, displayName: shown(name), script, version: '3.0', arguments: {}, realArg: { key: 'secret-' + name },
        customLink: [], argMeta: {}, enabled: true,
    } as unknown as RisuPlugin
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPlugins(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PluginSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

async function clickExport(target: HTMLElement, name: string): Promise<void> {
    const span = Array.from(target.querySelectorAll('div.font-bold span')).find((s) => s.textContent?.trim() === shown(name))
    if (!span) throw new Error('row not found: ' + name)
    const button = span.closest('div.flex.gap-2')!.querySelector('button[aria-label="Export"]') as HTMLButtonElement | null
    if (!button) throw new Error('no export button on row: ' + name)
    button.click()
    await sleep(20)
    flushSync()
}

beforeEach(() => {
    downloadMock.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('a plugin export button', () => {
    test('downloads the script of its own row under the plugin name with a .js extension', async () => {
        DBState.db = {
            plugins: [plugin('A', 'script-a'), plugin('B/x', 'script-b'), plugin('C', 'script-c')],
        } as unknown as Database
        const target = mountPlugins()
        await clickExport(target, 'B/x')
        expect(downloadMock).toHaveBeenCalledTimes(1)
        expect(downloadMock).toHaveBeenCalledWith('Bx.js', 'script-b')
    })

    test('carries no saved setting value', async () => {
        DBState.db = { plugins: [plugin('A', 'script-a')] } as unknown as Database
        const target = mountPlugins()
        await clickExport(target, 'A')
        expect(JSON.stringify(downloadMock.mock.calls)).not.toContain('secret-A')
    })
})
