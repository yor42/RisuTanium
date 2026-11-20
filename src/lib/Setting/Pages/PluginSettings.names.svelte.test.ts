// @vitest-environment jsdom

/**
 * `PluginSettings.svelte`: every icon-only control has an accessible name and a hidden glyph, the
 * power toggle exposes its state, the argument fields are named by their visible labels, and the
 * warning, update and hot-reload badge use scheme tokens instead of Tailwind palette classes. Mounts
 * the REAL page over a real `$state` database with the real shared inputs; the plugin runtime is a
 * stub (mocks of `PluginSettings.v21.svelte.test.ts`) and the highlighter, size and hotkey modules are
 * mocks of `TextAreaInput.ime.svelte.test.ts`. Plugins are built like the loader's output: a numeric
 * version, an `arguments` map of type names or option arrays, a `realArg` map and `argMeta`.
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
        hotReloading: ['hot'] as string[],
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
import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PluginSettings from './PluginSettings.svelte'

function plugin(name: string, extra: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name,
        displayName: name,
        script: '',
        version: 3,
        arguments: { note: 'string', body: 'string', mode: ['a', 'b'] },
        realArg: { note: '', body: '', mode: 'a' },
        argMeta: { note: { name: 'Note label' }, body: { name: 'Body label', textarea: true } },
        customLink: [],
        enabled: true,
        ...extra,
    } as unknown as RisuPlugin
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function render(plugins: RisuPlugin[], openFirst: boolean): Promise<HTMLElement> {
    DBState.db = { plugins, currentPluginProvider: '', hotkeys: [], longPressToPopupEditor: false } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PluginSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    if (openFirst) {
        ;(target.querySelector('div[role="button"]') as HTMLElement).click()
        flushSync()
    }
    return target
}

function rowButtons(target: HTMLElement, rowIndex: number): HTMLButtonElement[] {
    const row = target.querySelectorAll('div.flex.gap-2[role="button"]')[rowIndex]
    return Array.from(row.querySelectorAll(':scope > button'))
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PluginSettings accessible names', () => {
    test('regression reproducer: the V2 warning, update, export, settings, power and remove buttons carry their names', async () => {
        const target = await render([plugin('hot', { version: 2, updateURL: 'https://u.invalid' } as Partial<RisuPlugin>)], false)
        expect(rowButtons(target, 0).map(controlName)).toEqual([
            language.settingsPage.warning,
            language.pluginInstallUpdate,
            language.export,
            language.pluginSettingsFile.button,
            language.enable,
            language.remove,
        ])
    })

    test('regression reproducer: the toolbar buttons are named and the glyphs are hidden', async () => {
        const target = await render([plugin('hot', { version: 2, updateURL: 'https://u.invalid' } as Partial<RisuPlugin>)], false)
        const toolbar = Array.from(target.querySelectorAll('div.text-textcolor2.mt-2 > button'))
        expect(toolbar.map(controlName)).toEqual([language.pluginsPage.add, language.pluginsPage.devTools])
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the power toggle exposes enabled and disabled state', async () => {
        const target = await render([plugin('on'), plugin('off', { enabled: false })], false)
        const power = (index: number) => rowButtons(target, index).find((b) => controlName(b) === language.enable)
        expect(power(0)?.getAttribute('aria-pressed')).toBe('true')
        expect(power(1)?.getAttribute('aria-pressed')).toBe('false')
    })

    test('regression reproducer: a link without hover text is named by its URL', async () => {
        const target = await render([plugin('p', { customLink: [{ link: 'https://link.invalid/x' }] } as unknown as Partial<RisuPlugin>)], false)
        const anchor = target.querySelector<HTMLElement>('a[href="https://link.invalid/x"]')!
        expect(controlName(anchor)).toBe('https://link.invalid/x')
        expect(unnamedControls(target)).toEqual([])
    })

    test('regression reproducer: the argument fields are named by their labels', async () => {
        const target = await render([plugin('p')], true)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const fields = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        const byName = (label: string) => fields.find((el) => controlName(el) === label)!
        expect(controlDescription(byName('Note label')).startsWith('Note label')).toBe(true)
        expect(controlDescription(byName('Body label')).startsWith('Body label')).toBe(true)
    })

    test('regression reproducer: scheme tokens replace the palette classes and the hot badge is a neutral badge', async () => {
        const target = await render([plugin('hot', { version: 2, updateURL: 'https://u.invalid' } as Partial<RisuPlugin>)], false)
        expect(paletteClasses(target)).toEqual([])
        const badge = target.querySelector('span.text-sm.rounded-sm.ml-2') as HTMLElement
        expect(badge.classList.contains('bg-darkbutton')).toBe(true)
        expect(badge.classList.contains('text-textcolor')).toBe(true)
        const warning = rowButtons(target, 0)[0]
        expect(warning.classList.contains('text-draculared')).toBe(true)
        expect(rowButtons(target, 0)[2].classList.contains('hover:text-textcolor')).toBe(true)
    })
})
