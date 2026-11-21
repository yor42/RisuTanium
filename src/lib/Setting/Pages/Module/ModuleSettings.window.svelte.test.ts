// @vitest-environment jsdom

/**
 * `ModuleSettings.svelte` with a large library: only the rows near the scroller's view are in the
 * page, the search still reaches every module, and the band follows whichever element really
 * scrolls the list (the page in the settings shell, the list itself in the legacy settings page).
 *
 * Mounts the REAL component over a real `$state` database with the window host's test geometry:
 * the scroller is a 600 px band at the top of the viewport and the list's top is moved by hand to
 * stand for a scroll. "regression reproducer:" titles fail against the list that mounted every row.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

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
import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import ModuleSettings from './ModuleSettings.svelte'

//#region helpers

const ROWS = 300
const VIEW_PX = 600

let frames: (() => void)[] = []
/** How far the list has scrolled past the top of the band, in px. */
let scrolled = 0
let listTops: Set<Element> = new Set()

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

/** Lets the host's microtask read run, then the frames it scheduled. */
async function settle(): Promise<void> {
    flushSync()
    await Promise.resolve()
    flushSync()
    runFrames()
}

function makeModules(count: number): RisuModule[] {
    return Array.from({ length: count }, (_, i) => ({ name: `m${i}`, description: '', id: `id-${i}` }) as RisuModule)
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

/**
 * Mounts the list inside `outer`, a scroll container. `bounded` stands for the legacy settings page
 * (the list's parent is the scroll container); otherwise a plain block sits between them, as the
 * settings shell's view does, and the list grows to its content.
 */
async function mountIn(bounded: boolean): Promise<{ outer: HTMLElement, target: HTMLElement }> {
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    document.body.appendChild(outer)
    let target = outer
    if (!bounded) {
        target = document.createElement('div')
        outer.appendChild(target)
    }
    const app = mount(ModuleSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target: outer, app })
    await settle()
    return { outer, target }
}

const rowNames = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('span.text-lg')).map((s) => s.textContent?.trim())

beforeEach(() => {
    frames = []
    scrolled = 0
    listTops = new Set()
    setWindowGeometryForTests({
        // The segment's element (role=list) sits `scrolled` px above the band; every scroller is the band.
        rectOf: (element) => {
            if (element.getAttribute('role') === 'list') {
                listTops.add(element)
                return { top: -scrolled, height: 0 }
            }
            return { top: 0, height: VIEW_PX }
        },
        viewport: () => VIEW_PX,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => { frames = frames.filter((frame) => frame !== callback) }
        },
    })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    setWindowGeometryForTests(undefined)
    document.body.innerHTML = ''
})

//#endregion

describe('the windowed modules list', () => {
    test('regression reproducer: a library of 300 modules mounts only the rows near the view', async () => {
        DBState.db = { modules: makeModules(ROWS), enabledModules: [], moduleIntergration: '' } as unknown as Database
        const { outer } = await mountIn(false)
        const names = rowNames(outer)
        expect(names[0]).toBe('m0')
        expect(names.length).toBeGreaterThan(0)
        expect(names.length).toBeLessThan(40)
        const first = outer.querySelector('[data-window-key]') as HTMLElement
        expect(first.getAttribute('aria-setsize')).toBe(String(ROWS))
    })

    test('regression reproducer: the search reaches a module far down the list', async () => {
        DBState.db = { modules: makeModules(ROWS), enabledModules: [], moduleIntergration: '' } as unknown as Database
        const { outer } = await mountIn(false)
        expect(rowNames(outer)).not.toContain('m287')
        const search = outer.querySelector('input') as HTMLInputElement
        search.value = 'm287'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(rowNames(outer)).toEqual(['m287'])
    })

    test('regression reproducer: in the settings shell the page scroller moves the band', async () => {
        DBState.db = { modules: makeModules(ROWS), enabledModules: [], moduleIntergration: '' } as unknown as Database
        const { outer } = await mountIn(false)
        const list = outer.querySelector('[role=list]')!.parentElement as HTMLElement
        scrolled = 77 * 200
        // The list grows to its content in the shell, so a scroll event on it would never fire.
        list.dispatchEvent(new Event('scroll'))
        await settle()
        expect(rowNames(outer)).not.toContain('m200')
        outer.dispatchEvent(new Event('scroll'))
        await settle()
        expect(rowNames(outer)).toContain('m200')
        expect(rowNames(outer)).not.toContain('m0')
    })

    test('guard (killed by a scroller-rule mutant): in the legacy settings page the list scrolls itself', async () => {
        DBState.db = { modules: makeModules(ROWS), enabledModules: [], moduleIntergration: '' } as unknown as Database
        const { outer } = await mountIn(true)
        const list = outer.querySelector('[role=list]')!.parentElement as HTMLElement
        scrolled = 77 * 200
        list.dispatchEvent(new Event('scroll'))
        await settle()
        expect(rowNames(outer)).toContain('m200')
    })

    test('guard: two modules sharing an id both get a row', async () => {
        DBState.db = {
            modules: [{ name: 'first', description: '', id: 'same' }, { name: 'second', description: '', id: 'same' }],
            enabledModules: [],
            moduleIntergration: '',
        } as unknown as Database
        const { outer } = await mountIn(false)
        expect(rowNames(outer)).toEqual(['first', 'second'])
    })
})
