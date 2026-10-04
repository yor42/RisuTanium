// @vitest-environment happy-dom

/**
 * `ModuleSettings.svelte`: the list shows `db.modules` in array order (the search only
 * filters), and closing the module editor refreshes the open chat exactly once: through the
 * create or edit button, or by the component being destroyed while the editor is open.
 *
 * Mounts the REAL `ModuleSettings.svelte` over a real `$state` database; the editor form
 * is a stub. The refresh is observed as increments of the `ReloadGUIPointer` store. Titles
 * beginning "guard:" pin behaviour that must be preserved; "regression reproducer:" titles
 * fail against a list that sorts by name or an editor that closes without refreshing.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

const reload = vi.hoisted(() => ({ pointer: undefined as unknown as import('svelte/store').Writable<number> }))

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
    reload.pointer = writable(0)
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: reload.pointer,
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeModule(name: string): RisuModule {
    return { name, description: '', id: 'id-' + name } as RisuModule
}

function installDb(modules: RisuModule[]): void {
    DBState.db = { modules, enabledModules: [], moduleIntergration: '' } as unknown as Database
    reload.pointer.set(0)
}

interface Mounted { target: HTMLElement, app: Record<string, unknown>, unmounted: boolean }
let mounted: Mounted[] = []

function mountModules(): Mounted {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleSettings, { target, props: {} }) as unknown as Record<string, unknown>
    const entry = { target, app, unmounted: false }
    mounted.push(entry)
    flushSync()
    return entry
}

async function destroy(entry: Mounted): Promise<void> {
    entry.unmounted = true
    await unmount(entry.app as never)
    await settle()
}

const rowNames = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('span.text-lg')).map((s) => s.textContent?.trim())

/** The edit (pen) button of the row whose module is named `title`; it is the third button of a normal row. */
function editButton(target: HTMLElement, title: string): HTMLButtonElement {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return span.parentElement!.querySelectorAll('button')[2] as HTMLButtonElement
}

async function openEditor(target: HTMLElement, title: string): Promise<void> {
    editButton(target, title).click()
    await settle()
}

/** The create button of the footer toolbar (the first button after the list). */
async function openCreator(target: HTMLElement): Promise<void> {
    const toolbar = target.querySelector('div.flex.mr-2.mt-4') as HTMLElement
    ;(toolbar.querySelector('button') as HTMLButtonElement).click()
    await settle()
}

/** In an editor mode the only button on the page is the confirm button. */
async function confirmEditor(target: HTMLElement): Promise<void> {
    const buttons = target.querySelectorAll('button')
    expect(buttons.length).toBe(1)
    buttons[0].click()
    await settle()
}

afterEach(async () => {
    for (const m of mounted) {
        if (!m.unmounted) await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the modules list order', () => {
    test('regression reproducer: rows follow the array order, not the name order', () => {
        installDb([makeModule('B'), makeModule('A'), makeModule('C')])
        const { target } = mountModules()
        expect(rowNames(target)).toEqual(['B', 'A', 'C'])
    })

    test('guard: the search filters the rows and keeps the array order', async () => {
        installDb([makeModule('Bx'), makeModule('A'), makeModule('Cx')])
        const { target } = mountModules()
        const search = target.querySelector('input') as HTMLInputElement
        search.value = 'x'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(rowNames(target)).toEqual(['Bx', 'Cx'])
    })

    test('guard: the list never reorders db.modules', () => {
        installDb([makeModule('B'), makeModule('A')])
        mountModules()
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['B', 'A'])
    })
})

describe('the chat refresh when the module editor closes', () => {
    test('regression reproducer: closing the edit editor with its button refreshes once', async () => {
        installDb([makeModule('A'), makeModule('B')])
        const { target } = mountModules()
        await openEditor(target, 'B')
        expect(get(reload.pointer)).toBe(0)
        await confirmEditor(target)
        expect(get(reload.pointer)).toBe(1)
    })

    test('regression reproducer: closing the create editor with its button refreshes once', async () => {
        installDb([makeModule('A')])
        const { target } = mountModules()
        await openCreator(target)
        expect(get(reload.pointer)).toBe(0)
        await confirmEditor(target)
        expect(get(reload.pointer)).toBe(1)
    })

    test('regression reproducer: destroying the component while the edit editor is open refreshes once', async () => {
        installDb([makeModule('A'), makeModule('B')])
        const entry = mountModules()
        await openEditor(entry.target, 'A')
        await destroy(entry)
        expect(get(reload.pointer)).toBe(1)
    })

    test('regression reproducer: destroying the component while the create editor is open refreshes once', async () => {
        installDb([makeModule('A')])
        const entry = mountModules()
        await openCreator(entry.target)
        await destroy(entry)
        expect(get(reload.pointer)).toBe(1)
    })

    test('guard: destroying the component with no editor open does not refresh', async () => {
        installDb([makeModule('A')])
        const entry = mountModules()
        await destroy(entry)
        expect(get(reload.pointer)).toBe(0)
    })

    test('regression reproducer: closing the editor by its button and then destroying the component refreshes once in total', async () => {
        installDb([makeModule('A'), makeModule('B')])
        const entry = mountModules()
        await openEditor(entry.target, 'A')
        await confirmEditor(entry.target)
        await destroy(entry)
        expect(get(reload.pointer)).toBe(1)
    })
})
