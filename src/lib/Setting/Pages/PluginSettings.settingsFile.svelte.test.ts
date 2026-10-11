// @vitest-environment happy-dom

/**
 * `PluginSettings.svelte`'s per-plugin settings-file button exports and imports the saved values
 * of the plugin on its own row, however the plugin list changes while a dialog is open.
 *
 * Mounts the REAL `PluginSettings.svelte` over a real `$state` database. The alert functions are
 * explicit mocks the test holds open and answers; the file picker, `downloadFile` and
 * `loadPlugins` are recording mocks. New feature, so every test here is a compatibility guard or
 * behaviour pin: the evidence that they bite is the named mutant run in the report.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region module mocks

const dialogs = vi.hoisted(() => {
    const selects: Array<{ settle: (answer: string) => void }> = []
    const confirms: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        selects,
        confirms,
        select: (): Promise<string> => new Promise<string>((settle) => { selects.push({ settle }) }),
        confirm: (message: string): Promise<boolean> => new Promise<boolean>((settle) => { confirms.push({ message, settle }) }),
        normal: vi.fn(),
        error: vi.fn(),
        pick: vi.fn(async (): Promise<{ name: string, data: Uint8Array } | null> => null),
        download: vi.fn(async (_name: string, _data: string) => {}),
        load: vi.fn(async () => {}),
    }
})

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: dialogs.select,
    alertConfirm: dialogs.confirm,
    alertNormal: dialogs.normal,
    alertError: dialogs.error,
    alertMd: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: dialogs.pick,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: dialogs.download,
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
    loadPlugins: dialogs.load,
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

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

const shown = (name: string) => 'Shown ' + name
const buttonLabel = 'Plugin settings file'

function plugin(name: string, over: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, displayName: shown(name), script: '', version: '3.0',
        arguments: { key: 'string', size: 'int' },
        realArg: { key: 'old-' + name, size: 3 },
        customLink: [], argMeta: {}, enabled: true,
        ...over,
    } as unknown as RisuPlugin
}

function installDb(plugins: RisuPlugin[]): void {
    DBState.db = { plugins, currentPluginProvider: '' } as unknown as Database
}

const fileOf = (values: Record<string, unknown>, name: string) => async () => ({
    name: 'f.json',
    data: new TextEncoder().encode(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name, values } })),
})

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

function rowButton(target: HTMLElement, name: string): HTMLButtonElement | null {
    const span = Array.from(target.querySelectorAll('div.font-bold span')).find((s) => s.textContent?.trim() === shown(name))
    if (!span) throw new Error('row not found: ' + name)
    return span.closest('div.flex.gap-2')!.querySelector(`button[aria-label="${buttonLabel}"]`)
}

async function click(target: HTMLElement, name: string): Promise<void> {
    const button = rowButton(target, name)
    if (!button) throw new Error('no settings button on row: ' + name)
    button.click()
    await settle()
}

async function choose(answer: '0' | '1' | '2'): Promise<void> {
    const next = dialogs.selects.shift()
    if (!next) throw new Error('no select is open')
    next.settle(answer)
    await settle()
}

async function answer(value: boolean): Promise<string> {
    const next = dialogs.confirms.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
    return next.message
}

const plugins = () => DBState.db.plugins

beforeEach(() => {
    dialogs.selects.length = 0
    dialogs.confirms.length = 0
    dialogs.normal.mockClear()
    dialogs.error.mockClear()
    dialogs.pick.mockReset()
    dialogs.pick.mockResolvedValue(null)
    dialogs.download.mockReset()
    dialogs.download.mockResolvedValue(undefined)
    dialogs.load.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the settings-file button', () => {
    test('guard: a plugin with no visible argument, or API V1, has no button', () => {
        installDb([
            plugin('Plain', { arguments: {} }),
            plugin('Hidden', { arguments: { hidden_token: 'string' } }),
            plugin('Old', { version: 1 as unknown as RisuPlugin['version'] }),
            plugin('Has'),
        ])
        const target = mountPlugins()
        expect(rowButton(target, 'Plain')).toBeNull()
        expect(rowButton(target, 'Hidden')).toBeNull()
        expect(rowButton(target, 'Old')).toBeNull()
        expect(rowButton(target, 'Has')).not.toBeNull()
        expect(rowButton(target, 'Has')!.getAttribute('title')).toBe(buttonLabel)
    })
})

describe('export', () => {
    test('declining the plain-text warning downloads nothing', async () => {
        installDb([plugin('A'), plugin('B')])
        const target = mountPlugins()
        await click(target, 'B')
        await choose('0')
        await answer(false)
        expect(dialogs.download).not.toHaveBeenCalled()
    })

    test('a confirmed export on the second row downloads that row, once', async () => {
        installDb([plugin('A'), plugin('B')])
        const target = mountPlugins()
        await click(target, 'B')
        await choose('0')
        await answer(true)
        expect(dialogs.download).toHaveBeenCalledTimes(1)
        const [fileName, content] = dialogs.download.mock.calls[0]
        expect(fileName).toBe('B.settings.json')
        expect(JSON.parse(content).plugin.values.key).toBe('old-B')
    })

    test('a failing download is reported as an error and not as a success', async () => {
        installDb([plugin('A')])
        dialogs.download.mockRejectedValue(new Error('disk full'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('0')
        await answer(true)
        expect(dialogs.error).toHaveBeenCalledTimes(1)
        expect(dialogs.normal).not.toHaveBeenCalled()
    })

    test('a reorder while the choice is open still exports the clicked plugin', async () => {
        installDb([plugin('A'), plugin('B')])
        const target = mountPlugins()
        await click(target, 'B')
        plugins().reverse()
        flushSync()
        await choose('0')
        await answer(true)
        expect(JSON.parse(dialogs.download.mock.calls[0][1]).plugin.name).toBe('B')
    })

    test('a reorder while the warning is open still exports the clicked plugin', async () => {
        installDb([plugin('A'), plugin('B')])
        const target = mountPlugins()
        await click(target, 'B')
        await choose('0')
        plugins().reverse()
        flushSync()
        await answer(true)
        expect(JSON.parse(dialogs.download.mock.calls[0][1]).plugin.name).toBe('B')
    })

    test('a removal while the warning is open exports nothing and says so', async () => {
        installDb([plugin('A'), plugin('B')])
        const target = mountPlugins()
        await click(target, 'B')
        await choose('0')
        plugins().splice(1, 1)
        flushSync()
        await answer(true)
        expect(dialogs.download).not.toHaveBeenCalled()
        expect(dialogs.error).toHaveBeenCalledTimes(1)
    })
})

describe('import', () => {
    test('a matching file writes only its row and leaves enabled and identity alone', async () => {
        const a = plugin('A')
        const b = plugin('B', { enabled: false })
        installDb([a, b])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'B'))
        const target = mountPlugins()
        const before = plugins()[1]
        await click(target, 'B')
        await choose('1')
        await answer(true)
        expect(plugins()[1]).toBe(before)
        expect(plugins()[1].realArg).toEqual({ key: 'new', size: 3 })
        expect(plugins()[0].realArg).toEqual({ key: 'old-A', size: 3 })
        expect(plugins()[1].enabled).toBe(false)
        expect(dialogs.load).not.toHaveBeenCalled()
        expect(dialogs.normal).toHaveBeenCalledTimes(1)
    })

    test('an enabled target reloads the plugins once', async () => {
        installDb([plugin('A')])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        await answer(true)
        expect(dialogs.load).toHaveBeenCalledTimes(1)
    })

    test('a failing reload keeps the write and reports an error', async () => {
        installDb([plugin('A')])
        dialogs.load.mockRejectedValueOnce(new Error('boom'))
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        await answer(true)
        expect(plugins()[0].realArg.key).toBe('new')
        expect(dialogs.error).toHaveBeenCalledTimes(1)
        expect(dialogs.normal).not.toHaveBeenCalled()
    })

    test('a file with nothing new changes nothing and asks nothing', async () => {
        installDb([plugin('A')])
        dialogs.pick.mockImplementation(fileOf({ key: 'old-A' }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        expect(dialogs.confirms.length).toBe(0)
        expect(dialogs.load).not.toHaveBeenCalled()
        expect(dialogs.normal).toHaveBeenCalledTimes(1)
    })

    test('declining the replace confirmation writes nothing', async () => {
        installDb([plugin('A')])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        await answer(false)
        expect(plugins()[0].realArg.key).toBe('old-A')
    })

    test('declining a name mismatch writes nothing', async () => {
        installDb([plugin('A')])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'Other'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        await answer(false)
        expect(dialogs.confirms.length).toBe(0)
        expect(plugins()[0].realArg.key).toBe('old-A')
    })

    test('no file picked, a bad file and an oversized file write nothing', async () => {
        installDb([plugin('A')])
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        expect(dialogs.error).not.toHaveBeenCalled()

        dialogs.pick.mockResolvedValue({ name: 'f.json', data: new TextEncoder().encode('nope') })
        await click(target, 'A')
        await choose('1')
        expect(dialogs.error).toHaveBeenCalledTimes(1)

        dialogs.pick.mockResolvedValue({ name: 'f.json', data: new Uint8Array(1_048_577) })
        await click(target, 'A')
        await choose('1')
        expect(dialogs.error).toHaveBeenCalledTimes(2)
        expect(plugins()[0].realArg.key).toBe('old-A')
    })

    test('a reorder while the choice is open still imports into the clicked plugin', async () => {
        installDb([plugin('A'), plugin('B')])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'B'))
        const target = mountPlugins()
        await click(target, 'B')
        plugins().reverse()
        flushSync()
        await choose('1')
        await answer(true)
        const byName = (n: string) => plugins().find((p) => p.name === n)!
        expect(byName('B').realArg.key).toBe('new')
        expect(byName('A').realArg.key).toBe('old-A')
    })

    test('a removal while the replace confirmation is open writes and reloads nothing', async () => {
        installDb([plugin('A'), plugin('B')])
        dialogs.pick.mockImplementation(fileOf({ key: 'new' }, 'B'))
        const target = mountPlugins()
        await click(target, 'B')
        await choose('1')
        plugins().splice(1, 1)
        flushSync()
        await answer(true)
        expect(plugins().map((p) => p.realArg.key)).toEqual(['old-A'])
        expect(dialogs.error).toHaveBeenCalledTimes(1)
        expect(dialogs.load).not.toHaveBeenCalled()
    })

    test('a key the plugin changed during the confirmation is not overwritten unless it was listed', async () => {
        installDb([plugin('A', { realArg: { key: 'old-A', size: 3 } })])
        dialogs.pick.mockImplementation(fileOf({ key: 'file-key', size: 3 }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        plugins()[0].realArg.size = 50
        flushSync()
        await answer(true)
        expect(plugins()[0].realArg).toEqual({ key: 'file-key', size: 50 })
    })

    test('every listed key changed by the plugin during the confirmation: nothing written, no reload', async () => {
        installDb([plugin('A')])
        dialogs.pick.mockImplementation(fileOf({ key: 'file-key' }, 'A'))
        const target = mountPlugins()
        await click(target, 'A')
        await choose('1')
        plugins()[0].realArg.key = 'file-key'
        flushSync()
        await answer(true)
        expect(dialogs.load).not.toHaveBeenCalled()
        expect(dialogs.normal).toHaveBeenCalledTimes(1)
    })
})
