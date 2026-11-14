// @vitest-environment happy-dom

/**
 * Two defects the legacy `PluginSettings.svelte` shared with the new Plugins page, fixed in both:
 * - a select argument showed the letter "a" for every option instead of the option itself;
 * - the starter-template choice built an anchor that was never clicked, so nothing downloaded; it now goes
 *   through `downloadFile`, which also works on Tauri and Android.
 *
 * Mounts the REAL `PluginSettings.svelte` over a real `$state` database; the runtime, the alert functions,
 * `fetch` and `downloadFile` are mocks. Titles beginning "reproducer:" fail on the pre-fix page.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region module mocks

const mocks = vi.hoisted(() => ({
    select: vi.fn(async (_items: string[]) => '1'),
    download: vi.fn(async (_name: string, _data: Uint8Array) => true),
    error: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: mocks.select,
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertError: mocks.error,
    alertMd: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: mocks.download,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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
    loadPlugins: vi.fn(async () => { }),
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(plugins: RisuPlugin[]): HTMLElement {
    DBState.db = { plugins, currentPluginProvider: '' } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ target, app: mount(PluginSettings, { target, props: {} }) as unknown as Record<string, unknown> })
    flushSync()
    return target
}

beforeEach(() => {
    mocks.select.mockClear()
    mocks.download.mockClear()
    mocks.error.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer })))
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.unstubAllGlobals()
})

describe('a select argument of the legacy page', () => {
    test('reproducer: each option shows its own text', async () => {
        const target = render([{
            name: 'p', displayName: 'p', script: '', version: '3.0', arguments: { mode: ['low', 'high'] }, realArg: { mode: 'low' },
            customLink: [], argMeta: {}, enabled: true,
        } as unknown as RisuPlugin])
        ;(target.querySelector('div[role="button"]') as HTMLElement).click()
        await settle()

        expect(Array.from(target.querySelectorAll('option')).map((option) => option.textContent?.trim())).toEqual(['low', 'high'])
    })
})

describe('the starter template choice of the legacy page', () => {
    test('reproducer: choosing the template hands the fetched bytes to downloadFile', async () => {
        const target = render([])
        const buttons = target.querySelectorAll<HTMLButtonElement>('div.text-textcolor2.mt-2 button')
        buttons[1].click()
        await settle()

        expect(mocks.download).toHaveBeenCalledTimes(1)
        const [name, data] = mocks.download.mock.calls[0]
        expect(name).toBe('plugin_starter.7z')
        expect(Array.from(data)).toEqual([7, 8, 9])
        expect(mocks.error).not.toHaveBeenCalled()
    })

    test('a failed fetch is reported and nothing is downloaded', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })))
        const target = render([])
        target.querySelectorAll<HTMLButtonElement>('div.text-textcolor2.mt-2 button')[1].click()
        await settle()

        expect(mocks.download).not.toHaveBeenCalled()
        expect(mocks.error).toHaveBeenCalledTimes(1)
    })
})
