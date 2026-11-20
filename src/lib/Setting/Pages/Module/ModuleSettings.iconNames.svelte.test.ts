// @vitest-environment jsdom

/**
 * `ModuleSettings.svelte` list mode: every icon-only control has an accessible name, every
 * Lucide glyph is hidden from assistive technology, state toggles expose their state and the
 * classic screen uses scheme tokens instead of Tailwind default palette classes. Mounts the REAL
 * `ModuleSettings.svelte` over a real `$state` database; the editor form is a stub.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/modules'), () => ({
    exportModule: vi.fn(),
    exportModuleLegacy: vi.fn(),
    importModule: vi.fn(),
    refreshModules: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/mcp/mcp'), () => ({
    importMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/mcp'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/tooltip'), () => ({
    tooltip: () => ({}),
}) as unknown as typeof import('src/ts/gui/tooltip'))

vi.mock('src/lib/Setting/Pages/Module/ModuleMenu.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ModuleSettings from './ModuleSettings.svelte'

//#region helpers

const EXCEPTIONS = [/^text-amber-500$/, /^text-violet-500$/]

function makeModule(name: string, extra: Partial<RisuModule> = {}): RisuModule {
    return { name, description: '', id: 'id-' + name, ...extra } as RisuModule
}

function installDb(): void {
    DBState.db = {
        modules: [
            makeModule('A'),
            makeModule('B', { namespace: 'ns1' }),
            makeModule('C', { mcp: { url: 'https://mcp.invalid' } }),
        ],
        enabledModules: ['id-A'],
        moduleIntergration: 'ns0, ns1',
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountModules(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function rowButtons(target: HTMLElement, title: string): HTMLButtonElement[] {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return Array.from(span.parentElement!.querySelectorAll('button'))
}

function toolbarButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('div.flex.mr-2.mt-4 button'))
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('ModuleSettings accessible names', () => {
    test('regression reproducer: every row and toolbar control is named and every glyph is hidden', () => {
        installDb()
        const target = mountModules()
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the search field is named by the search label', () => {
        installDb()
        const target = mountModules()
        const search = target.querySelector('input[type="text"]') as HTMLInputElement
        expect(controlName(search)).toBe(language.search)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the controls carry the meaning-bearing names', () => {
        installDb()
        const target = mountModules()
        for (const title of ['A', 'B', 'C']) {
            expect(rowButtons(target, title).map(controlName)).toEqual([
                language.enableGlobal, language.download, language.edit, language.remove,
            ])
        }
        expect(toolbarButtons(target).map(controlName)).toEqual([
            language.createModule, language.moduleConvertMode, language.moduleImportMcp, language.import,
        ])
    })

    test('regression reproducer: the conversion row button is named after its action', () => {
        installDb()
        const target = mountModules()
        toolbarButtons(target)[1].click()
        flushSync()
        expect(unnamedControls(target)).toEqual([])
        expect(rowButtons(target, 'A').map(controlName)).toEqual([language.moduleConvertRow])
        expect(rowButtons(target, 'A')[0].className).toContain('text-violet-500')
        expect(toolbarButtons(target)[1].getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: the MCP row share and edit buttons are disabled placeholders', () => {
        installDb()
        const target = mountModules()
        const [, share, edit] = rowButtons(target, 'C')
        expect(share.disabled).toBe(true)
        expect(edit.disabled).toBe(true)
        expect(rowButtons(target, 'A')[1].disabled).toBe(false)
    })
})

describe('ModuleSettings state and colour', () => {
    test('regression reproducer: the globe exposes the global state with a ring cue and the integrated state has a description', () => {
        installDb()
        const target = mountModules()
        const on = rowButtons(target, 'A')[0]
        expect(on.getAttribute('aria-pressed')).toBe('true')
        for (const cls of ['bg-selected', 'ring-1', 'ring-borderc']) {
            expect(on.classList.contains(cls)).toBe(true)
        }
        const integrated = rowButtons(target, 'B')[0]
        expect(integrated.getAttribute('aria-pressed')).toBe('false')
        expect(integrated.classList.contains('text-amber-500')).toBe(true)
        expect(integrated.classList.contains('ring-current')).toBe(true)
        expect(controlDescription(integrated)).toBe(language.moduleOnByIntegration)
        const off = rowButtons(target, 'C')[0]
        expect(off.getAttribute('aria-pressed')).toBe('false')
        expect(controlDescription(off)).toBe('')
        expect(off.classList.contains('hover:text-textcolor')).toBe(true)
    })

    test('regression reproducer: the remove hover uses the danger token', () => {
        installDb()
        const target = mountModules()
        expect(rowButtons(target, 'A')[3].classList.contains('hover:text-draculared')).toBe(true)
    })

    test('regression reproducer: no Tailwind default palette class remains outside the documented exceptions', () => {
        installDb()
        const target = mountModules()
        expect(paletteClasses(target, { allow: EXCEPTIONS })).toEqual([])
        toolbarButtons(target)[1].click()
        flushSync()
        expect(paletteClasses(target, { allow: EXCEPTIONS })).toEqual([])
    })
})
