// @vitest-environment happy-dom

/**
 * The Plugins page of the Settings shell, mounted for real over a real `$state` database: a retired plugin
 * (API 2.1, 2 or 1) is data only and stays byte-equal through every action the page offers; a 3.0 plugin shows
 * its version and access lines and a labelled switch; the update check runs once when the page opens and at
 * most once a day; removal confirms, then offers an undo that restores the identical entry; typed arguments
 * save on blur, Enter or teardown and an invalid number is refused; the settings-file import and the starter
 * download work from the page.
 *
 * MOCKED: the plugin runtime (`plugins.svelte`), the alert functions, `stores.svelte`, the toast host (the posted
 * undo actions are run by the test), `downloadFile`, the file picker and `fetch`. A pass says nothing about the
 * native save picker or the real update transport.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuPlugin } from '../../ts/plugins/plugins.svelte'
import type { UndoToastInit } from '../../ts/toast/toastHost.svelte'

//#region module mocks

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(async (_message: string) => true),
    select: vi.fn(async (_items: string[]) => '2'),
    error: vi.fn(),
    notify: vi.fn(),
    pick: vi.fn(async (): Promise<{ name: string, data: Uint8Array } | null> => null),
    download: vi.fn(async (_name: string, _data: unknown) => true),
    toggle: vi.fn(async (_plugin: unknown) => { }),
    load: vi.fn(async () => { }),
    update: vi.fn(async (_plugin: unknown) => true),
    undoToast: vi.fn(),
    toast: vi.fn(),
}))

vi.mock(import('../../ts/alert'), () => ({
    alertConfirm: mocks.confirm,
    alertSelect: mocks.select,
    alertError: mocks.error,
    alertNormal: mocks.notify,
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../ts/alert'))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hotReloading: [] as string[],
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/plugins/plugins.svelte'), () => ({
    importPlugin: vi.fn(),
    loadPlugins: mocks.load,
    togglePluginEnabled: mocks.toggle,
    updatePlugin: mocks.update,
}) as unknown as typeof import('../../ts/plugins/plugins.svelte'))

vi.mock(import('../../ts/plugins/apiV3/developMode'), () => ({
    hotReloadPluginFiles: vi.fn(),
}) as unknown as typeof import('../../ts/plugins/apiV3/developMode'))

vi.mock(import('../../ts/toast/toastHost.svelte'), () => ({
    postUndoToast: mocks.undoToast,
    postToast: mocks.toast,
}) as unknown as typeof import('../../ts/toast/toastHost.svelte'))

vi.mock(import('../../ts/globalApi.svelte'), () => ({
    downloadFile: mocks.download,
}) as unknown as typeof import('../../ts/globalApi.svelte'))

vi.mock(import('../../ts/util'), () => ({
    selectSingleFile: mocks.pick,
}) as unknown as typeof import('../../ts/util'))

//#endregion

import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import { PLUGIN_UPDATE_CHECK_KEY } from '../../ts/plugins/pluginUpdateCheck'
import { DBState } from '../../ts/stores.svelte'
import PluginsShellPage from './PluginsShellPage.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function plugin(name: string, over: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, displayName: 'Shown ' + name, script: '', version: '3.0', arguments: {}, realArg: {},
        customLink: [], argMeta: {}, enabled: true, ...over,
    }
}

function installDb(plugins: RisuPlugin[], provider = ''): void {
    DBState.db = { plugins, currentPluginProvider: provider } as unknown as Database
}

/** The start of a plugin file as the update probe reads it: header lines first. */
const head = (version: string) => `//@name X\n//@api 3.0\n//@version ${version}\n\ncode()`

function stubFetch(answers: Record<string, { status: number, version?: string }>) {
    const fetchMock = vi.fn(async (url: string) => {
        const answer = answers[url] ?? { status: 404 }
        return {
            ok: answer.status >= 200 && answer.status < 300,
            status: answer.status,
            text: async () => head(answer.version ?? '1.0.0'),
            arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
        }
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(): Mounted {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const entry = { target, app: mount(PluginsShellPage, { target, props: {} }) as unknown as Record<string, unknown> }
    mounted.push(entry)
    flushSync()
    return entry
}

async function unmountOne(entry: Mounted): Promise<void> {
    await unmount(entry.app as never)
    entry.target.remove()
    mounted = mounted.filter((m) => m !== entry)
}

const item = (target: HTMLElement, name: string) => target.querySelector<HTMLElement>(`[data-plugin="${name}"]`)!
const part = <T extends HTMLElement = HTMLElement>(root: HTMLElement, name: string) => root.querySelector<T>(`[data-part="${name}"]`)
const strip = (target: HTMLElement) => part(target, 'plugins-results')!.textContent ?? ''

beforeEach(() => {
    localStorage.clear()
    for (const mock of Object.values(mocks)) mock.mockClear()
    mocks.confirm.mockImplementation(async () => true)
    mocks.select.mockImplementation(async () => '2')
    mocks.pick.mockImplementation(async () => null)
    mocks.update.mockImplementation(async () => true)
    stubFetch({})
})

afterEach(async () => {
    for (const entry of [...mounted]) await unmountOne(entry)
    vi.unstubAllGlobals()
})

//#endregion

describe('a retired plugin row', () => {
    test.each([['2.1', 'API V2.1'], [2, 'API V2'], [1, 'API V1']] as const)('guard: API %s lists with the retired line and a disabled switch, and its saved data stays byte-equal through every action', async (version, api) => {
        installDb([
            plugin('old', { version, enabled: true, updateURL: 'https://example.invalid/old.js', versionOfPlugin: '1.0.0', arguments: { k: 'string' }, realArg: { k: 'v' } }),
            plugin('live'),
        ])
        const before = JSON.stringify(DBState.db.plugins)
        stubFetch({ 'https://example.invalid/old.js': { status: 200, version: '2.0.0' } })

        const { target } = render()
        await settle()
        const row = item(target, 'old')
        const sw = part<HTMLButtonElement>(row, 'plugin-switch')!

        expect(row.textContent).toContain('Shown old')
        expect(part(row, 'plugin-access')!.textContent).toContain(api)
        expect(sw.disabled).toBe(true)
        expect(sw.getAttribute('role')).toBe('switch')
        expect(sw.getAttribute('aria-checked')).toBe('false')
        expect(sw.getAttribute('aria-describedby')).toBe(part(row, 'plugin-access')!.id)
        expect(part(row, 'plugin-settings-file')).toBeNull()
        expect(part(row, 'plugin-settings-toggle')).toBeNull()
        expect(JSON.stringify(DBState.db.plugins)).toBe(before)

        part<HTMLButtonElement>(target, 'plugins-check')!.click()
        await settle()
        sw.click()
        await settle()

        // happy-dom may drop a click on a disabled button; the handler itself also refuses a non-runnable plugin.
        expect(mocks.toggle).not.toHaveBeenCalled()
        expect(JSON.stringify(DBState.db.plugins)).toBe(before)
    })
})

describe('a 3.0 plugin row', () => {
    test('behaviour: it shows the version and access lines and its switch toggles through togglePluginEnabled', async () => {
        installDb([plugin('p', { versionOfPlugin: '1.2.0', allowedIPC: ['a', 'b'], enabled: false })])
        const { target } = render()
        const row = item(target, 'p')
        const sw = part<HTMLButtonElement>(row, 'plugin-switch')!

        expect(part(row, 'plugin-version')!.textContent).toBe('v1.2.0 · API 3.0')
        expect(part(row, 'plugin-access')!.textContent).toContain(language.pluginsPage.accessLimited)
        expect(part(row, 'plugin-ipc')!.textContent).toBe(fillLang(language.pluginsPage.accessIpc, { count: 2 }))
        expect(sw.getAttribute('role')).toBe('switch')
        expect(sw.getAttribute('aria-checked')).toBe('false')
        expect(sw.getAttribute('aria-label')).toBe('Shown p')
        expect(sw.disabled).toBe(false)
        expect(target.querySelectorAll('[role="button"] button').length).toBe(0)

        sw.click()
        await settle()

        expect(mocks.toggle).toHaveBeenCalledTimes(1)
        expect(mocks.toggle.mock.calls[0][0]).toBe(DBState.db.plugins[0])
    })

    test('behaviour: the switch reflects the saved enabled state', async () => {
        installDb([plugin('p', { enabled: true }), plugin('q', { enabled: false })])
        const { target } = render()
        expect(part(item(target, 'p'), 'plugin-switch')!.getAttribute('aria-checked')).toBe('true')
        expect(part(item(target, 'q'), 'plugin-switch')!.getAttribute('aria-checked')).toBe('false')
    })
})

describe('the update check', () => {
    const urls = { 'https://example.invalid/good.js': { status: 200, version: '1.0.0' }, 'https://example.invalid/bad.js': { status: 500 } }

    function checkable(): RisuPlugin[] {
        return [
            plugin('good', { updateURL: 'https://example.invalid/good.js', versionOfPlugin: '1.0.0' }),
            plugin('bad', { updateURL: 'https://example.invalid/bad.js', versionOfPlugin: '1.0.0', displayName: 'Bad One' }),
        ]
    }

    test('behaviour: the first open checks once per address, a re-render does not, and a failure is named', async () => {
        installDb(checkable())
        const fetchMock = stubFetch(urls)
        const { target } = render()
        await settle()

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(strip(target)).toContain(fillLang(language.pluginsPage.resultFailed, { count: 1, names: 'Bad One' }))

        DBState.db.plugins[0].realArg = { touched: 1 }
        flushSync()
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('behaviour: a reopen within a day shows the stored result without fetching; Check now fetches again and updates the record', async () => {
        installDb(checkable())
        const first = stubFetch(urls)
        const open = render()
        await settle()
        expect(first).toHaveBeenCalledTimes(2)
        await unmountOne(open)

        const second = stubFetch({ ...urls, 'https://example.invalid/bad.js': { status: 200, version: '1.0.0' } })
        const reopened = render()
        await settle()
        expect(second).not.toHaveBeenCalled()
        expect(strip(reopened.target)).toContain('Bad One')

        part<HTMLButtonElement>(reopened.target, 'plugins-check')!.click()
        await settle()

        expect(second).toHaveBeenCalledTimes(2)
        expect(strip(reopened.target)).toContain(language.pluginsPage.resultAllCurrent)
        expect(strip(reopened.target)).not.toContain('Bad One')
        expect(JSON.parse(localStorage.getItem(PLUGIN_UPDATE_CHECK_KEY)!).outcomes.every((o: { kind: string }) => o.kind === 'current')).toBe(true)
    })

    test('behaviour: a stale record (over a day old) is checked again on open', async () => {
        installDb(checkable())
        localStorage.setItem(PLUGIN_UPDATE_CHECK_KEY, JSON.stringify({ checkedAt: Date.now() - 25 * 60 * 60 * 1000, outcomes: [] }))
        const fetchMock = stubFetch(urls)
        render()
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('behaviour: with no update address there is no check button and no fetch', async () => {
        installDb([plugin('plain')])
        const fetchMock = stubFetch({})
        const { target } = render()
        await settle()
        expect(part(target, 'plugins-check')).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('behaviour: a newer version shows a chip and Update confirms then updates; a failed update shows an error toast', async () => {
        installDb([plugin('up', { updateURL: 'https://example.invalid/up.js', versionOfPlugin: '1.0.0' })])
        stubFetch({ 'https://example.invalid/up.js': { status: 200, version: '2.0.0' } })
        const { target } = render()
        await settle()
        const row = item(target, 'up')

        expect(part(row, 'plugin-update-chip')!.textContent).toBe(fillLang(language.pluginsPage.updateChip, { version: '2.0.0' }))

        part<HTMLButtonElement>(row, 'plugin-update')!.click()
        await settle()
        expect(mocks.confirm).toHaveBeenCalledWith(language.pluginUpdateFoundInstallIt)
        expect(mocks.update).toHaveBeenCalledTimes(1)
        expect(mocks.toast).not.toHaveBeenCalled()

        mocks.update.mockImplementation(async () => false)
        part<HTMLButtonElement>(row, 'plugin-update')!.click()
        await settle()
        expect(mocks.toast).toHaveBeenCalledTimes(1)
        expect((mocks.toast.mock.calls[0][0] as { kind: string }).kind).toBe('error')
    })
})

describe('removing a plugin', () => {
    test('behaviour: yes removes the plugin and offers an undo that restores the identical entry and the provider', async () => {
        installDb([plugin('a'), plugin('b', { realArg: { k: 'saved' } }), plugin('c')], 'b')
        const target = DBState.db.plugins[1]
        const before = JSON.stringify(target)
        const { target: root } = render()

        part<HTMLButtonElement>(item(root, 'b'), 'plugin-remove')!.click()
        await settle()

        expect(mocks.confirm).toHaveBeenCalledWith(fillLang(language.pluginsPage.removeConfirm, { name: 'Shown b' }))
        expect(DBState.db.plugins.map((p) => p.name)).toEqual(['a', 'c'])
        expect(DBState.db.currentPluginProvider).toBe('')
        expect(mocks.load).toHaveBeenCalledTimes(1)
        expect(mocks.undoToast).toHaveBeenCalledTimes(1)

        const posted = mocks.undoToast.mock.calls[0][0] as UndoToastInit
        expect(posted.text).toBe(fillLang(language.pluginsPage.removed, { name: 'Shown b' }))
        const outcome = await posted.action.run()

        expect(outcome.ok).toBe(true)
        expect(DBState.db.plugins[1]).toBe(target)
        expect(JSON.stringify(DBState.db.plugins[1])).toBe(before)
        expect(DBState.db.currentPluginProvider).toBe('b')
    })

    test('behaviour: no leaves everything as it was', async () => {
        installDb([plugin('a')])
        mocks.confirm.mockImplementation(async () => false)
        const { target } = render()

        part<HTMLButtonElement>(item(target, 'a'), 'plugin-remove')!.click()
        await settle()

        expect(DBState.db.plugins).toHaveLength(1)
        expect(mocks.undoToast).not.toHaveBeenCalled()
        expect(mocks.load).not.toHaveBeenCalled()
    })
})

describe('the arguments panel', () => {
    function withArgs(): RisuPlugin {
        return plugin('args', {
            arguments: { text: 'string', note: 'string', count: 'int', mode: ['low', 'high'] },
            realArg: { text: 'start', note: 'n0', count: 5, mode: 'low' },
            argMeta: { note: { textarea: '1' } },
        })
    }

    async function open(): Promise<{ root: HTMLElement, entry: Mounted }> {
        installDb([withArgs()])
        const entry = render()
        part<HTMLButtonElement>(item(entry.target, 'args'), 'plugin-settings-toggle')!.click()
        await settle()
        return { root: item(entry.target, 'args'), entry }
    }

    /** The field a visible label points at, the way a screen reader resolves it. */
    function field(root: HTMLElement, label: string): HTMLInputElement {
        const named = Array.from(root.querySelectorAll('label')).find((l) => l.textContent === label)
        if (!named) throw new Error('no label ' + label)
        return root.querySelector<HTMLInputElement>('#' + CSS.escape(named.htmlFor))!
    }

    function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }

    test('behaviour: select options show their own text and the disclosure is expanded', async () => {
        const { root } = await open()
        expect(Array.from(root.querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual(['low', 'high'])
        expect(part(root, 'plugin-settings-toggle')!.getAttribute('aria-expanded')).toBe('true')
    })

    test('behaviour: typing alone writes nothing; blur and Enter write; a textarea ignores Enter', async () => {
        const { root } = await open()
        const text = field(root, 'text')
        const note = field(root, 'note') as unknown as HTMLTextAreaElement

        type(text, 'typed')
        expect(DBState.db.plugins[0].realArg.text).toBe('start')
        text.dispatchEvent(new Event('blur'))
        expect(DBState.db.plugins[0].realArg.text).toBe('typed')

        type(text, 'entered')
        text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(DBState.db.plugins[0].realArg.text).toBe('entered')

        type(note, 'line1')
        note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(DBState.db.plugins[0].realArg.note).toBe('n0')
        note.dispatchEvent(new Event('blur'))
        expect(DBState.db.plugins[0].realArg.note).toBe('line1')
    })

    test('behaviour: an uncommitted draft is written when the page is torn down', async () => {
        const { root, entry } = await open()
        type(field(root, 'text'), 'late')
        expect(DBState.db.plugins[0].realArg.text).toBe('start')

        await unmountOne(entry)

        expect(DBState.db.plugins[0].realArg.text).toBe('late')
    })

    test('behaviour: a number saves as a number; an invalid one is refused, shown again as stored and explained', async () => {
        const { root } = await open()
        const count = field(root, 'count')

        type(count, '12')
        count.dispatchEvent(new Event('blur'))
        expect(DBState.db.plugins[0].realArg.count).toBe(12)

        type(count, 'abc')
        count.dispatchEvent(new Event('blur'))
        await settle()
        expect(DBState.db.plugins[0].realArg.count).toBe(12)
        expect(count.value).toBe('12')
        expect(part(root, 'plugin-arg-invalid')!.textContent).toBe(language.pluginsPage.numberInvalid)

        type(count, '13')
        await settle()
        expect(part(root, 'plugin-arg-invalid')!.textContent).toBe('')
    })

    test('behaviour: focusing and leaving a field without typing writes nothing and shows no error', async () => {
        installDb([plugin('args', {
            arguments: { five: 'int', empty: 'int', word: 'string' },
            realArg: { five: '5', empty: '', word: 'w' },
        })])
        const entry = render()
        part<HTMLButtonElement>(item(entry.target, 'args'), 'plugin-settings-toggle')!.click()
        await settle()
        const root = item(entry.target, 'args')

        for (const label of ['five', 'empty', 'word']) {
            const el = field(root, label)
            el.dispatchEvent(new Event('focus'))
            el.dispatchEvent(new Event('blur'))
        }
        await settle()

        expect(DBState.db.plugins[0].realArg).toEqual({ five: '5', empty: '', word: 'w' })
        expect(field(root, 'five').value).toBe('5')
        expect(field(root, 'empty').value).toBe('')
        expect(Array.from(root.querySelectorAll('[data-part="plugin-arg-invalid"]')).map((n) => n.textContent)).toEqual(['', ''])
    })
})

describe('the settings-file import and the starter template', () => {
    test('behaviour: an import offers one undo with the replaced count, and Undo restores the previous values', async () => {
        installDb([plugin('s', { arguments: { key: 'string' }, realArg: { key: 'old' }, enabled: false })])
        const { target } = render()
        mocks.select.mockImplementation(async () => '1')
        mocks.pick.mockImplementation(async () => ({
            name: 'f.json',
            data: new TextEncoder().encode(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name: 's', values: { key: 'new' } } })),
        }))

        part<HTMLButtonElement>(item(target, 's'), 'plugin-settings-file')!.click()
        await settle()

        expect(DBState.db.plugins[0].realArg.key).toBe('new')
        expect(mocks.undoToast).toHaveBeenCalledTimes(1)
        expect(mocks.notify).not.toHaveBeenCalled()
        const posted = mocks.undoToast.mock.calls[0][0] as UndoToastInit
        expect(posted.text).toContain('Updated 1 value(s) of "s"')

        const outcome = await posted.action.run()
        expect(outcome.ok).toBe(true)
        expect(DBState.db.plugins[0].realArg.key).toBe('old')
    })

    test('behaviour: an undo after a later edit is refused and keeps the later value', async () => {
        installDb([plugin('s', { arguments: { key: 'string' }, realArg: { key: 'old' }, enabled: false })])
        const { target } = render()
        mocks.select.mockImplementation(async () => '1')
        mocks.pick.mockImplementation(async () => ({
            name: 'f.json',
            data: new TextEncoder().encode(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name: 's', values: { key: 'new' } } })),
        }))
        part<HTMLButtonElement>(item(target, 's'), 'plugin-settings-file')!.click()
        await settle()
        DBState.db.plugins[0].realArg.key = 'later'

        const outcome = await (mocks.undoToast.mock.calls[0][0] as UndoToastInit).action.run()

        expect(outcome.ok).toBe(false)
        expect(DBState.db.plugins[0].realArg.key).toBe('later')
    })

    test('behaviour: the starter template downloads through downloadFile', async () => {
        installDb([])
        const fetchMock = stubFetch({ '/plugin_start.7z': { status: 200 } })
        const { target } = render()
        mocks.select.mockImplementation(async () => '1')

        part<HTMLButtonElement>(target, 'plugins-dev')!.click()
        await settle()

        expect(fetchMock).toHaveBeenCalledWith('/plugin_start.7z')
        expect(mocks.download).toHaveBeenCalledTimes(1)
        expect(mocks.download.mock.calls[0][0]).toBe('plugin_starter.7z')
        expect(mocks.error).not.toHaveBeenCalled()
    })

    test('behaviour: a failed starter fetch is reported and nothing is downloaded', async () => {
        installDb([])
        stubFetch({})
        const { target } = render()
        mocks.select.mockImplementation(async () => '1')

        part<HTMLButtonElement>(target, 'plugins-dev')!.click()
        await settle()

        expect(mocks.download).not.toHaveBeenCalled()
        expect(mocks.error).toHaveBeenCalledWith(language.pluginsPage.starterFailed)
    })

    test('behaviour: the empty list says so', async () => {
        installDb([])
        const { target } = render()
        expect(target.textContent).toContain(language.noPlugins)
    })
})
