// @vitest-environment happy-dom

/**
 * `ModuleSettings.svelte` over module stubs: share (both formats), convert to character and the editor load the body
 * before they use the module, use the loaded live module, stop with a message naming the module when the load fails,
 * and release every handle they acquired. The editor edits the live slot, finds that slot again when it saves, ignores
 * a second open while a load is pending, and the list rows, enable toggle and delete never load a body.
 *
 * Mounts the REAL `ModuleSettings.svelte` with the real `moduleUse.ts` and `moduleAcquire.ts` over a real `$state`
 * database. The loader is a test double that installs the body by replacing the stub slot. The editor form is a stub
 * that exposes the props it receives. Titles beginning "guard:" pin behaviour that must be preserved; every other test
 * is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

const h = vi.hoisted(() => ({
    select: '0',
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    exported: [] as { kind: string, module: unknown }[],
    menu: { props: null as null | { currentModule: Record<string, unknown> }, renders: 0 },
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertStore: writable({ type: 'none', msg: '' }),
        alertError: h.alertError,
        alertNormal: h.alertNormal,
        alertSelect: async () => h.select,
        alertConfirm: async () => true,
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
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/modules'), () => ({
    exportModule: vi.fn(async (module: unknown) => { h.exported.push({ kind: 'charx', module }) }),
    exportModuleLegacy: vi.fn(async (module: unknown) => { h.exported.push({ kind: 'legacy', module }) }),
    importModule: vi.fn(),
    refreshModules: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/mcp/mcp'), () => ({
    importMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/mcp'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertModuleToCharacter: vi.fn((module: RisuModule) => ({ name: module.name, lore: [...(module.lorebook ?? [])] })),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/tooltip'), () => ({
    tooltip: () => ({}),
}) as unknown as typeof import('src/ts/gui/tooltip'))

vi.mock('src/lib/Setting/Pages/Module/ModuleMenu.svelte', () => ({
    default: (_anchor: unknown, props: { currentModule: Record<string, unknown> }) => {
        h.menu.props = props
        h.menu.renders++
    },
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE, isModuleStub } from 'src/ts/storage/moduleStub'
import * as acquire from 'src/ts/storage/store2/moduleAcquire'
import ModuleSettings from './ModuleSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function stubOf(name: string, extra: Record<string, unknown> = {}): RisuModule {
    return { name, description: 'desc ' + name, id: 'id-' + name, [MODULE_STUB_KEY]: MODULE_STUB_VALUE, ...extra } as unknown as RisuModule
}

function bodyOf(name: string): RisuModule {
    return {
        name, description: 'desc ' + name, id: 'id-' + name,
        lorebook: [{ key: 'k', comment: 'c', content: 'entry of ' + name }],
    } as unknown as RisuModule
}

function residentOf(name: string): RisuModule {
    return bodyOf(name)
}

function installDb(modules: RisuModule[], enabled: string[] = []): void {
    DBState.db = { modules, enabledModules: enabled, moduleIntergration: '', characters: [] } as unknown as Database
}

/** A loader that installs `bodies[id]` into the slot of the stub it is asked for and returns that slot read back. */
function registerInstalling(bodies: Record<string, RisuModule>): ReturnType<typeof vi.fn> {
    const loader = vi.fn(async (handle: string) => {
        const id = handle.split('#')[0]
        const index = DBState.db.modules.findIndex((m) => m.id === id)
        DBState.db.modules[index] = bodies[id]
        return DBState.db.modules[index]
    })
    acquire.registerModuleLoader(loader)
    return loader
}

/** Wraps the real `acquireModule` so each release can be counted. */
function countReleases(): { acquired: number, released: number } {
    const counts = { acquired: 0, released: 0 }
    const real = acquire.acquireModule
    vi.spyOn(acquire, 'acquireModule').mockImplementation(async (id, signal) => {
        const result = await real(id, signal)
        if (!result) return result
        counts.acquired++
        return { module: result.module, release: () => { counts.released++; result.release() } }
    })
    return counts
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

async function unmountAll(): Promise<void> {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
}

/** The buttons of the row named `title`: globe, share, edit, remove (or the single convert button in conversion mode). */
function rowButtons(target: HTMLElement, title: string): HTMLButtonElement[] {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return Array.from(span.parentElement!.querySelectorAll('button')) as HTMLButtonElement[]
}

async function click(button: HTMLButtonElement): Promise<void> {
    button.click()
    await settle()
}

const GLOBE = 0
const SHARE = 1
const EDIT = 2
const REMOVE = 3

function conversionToggle(target: HTMLElement): HTMLButtonElement {
    const toggles = Array.from(target.querySelectorAll('div.flex.mr-2.mt-4 > button')) as HTMLButtonElement[]
    return toggles[1]
}

function editorOpen(target: HTMLElement): boolean {
    return target.textContent?.includes(language.editModule) ?? false
}

function saveButton(target: HTMLElement): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.editModule)
    if (!found) throw new Error('save button not found')
    return found as HTMLButtonElement
}

beforeEach(() => {
    h.select = '0'
    h.exported = []
    h.menu.props = null
    h.menu.renders = 0
    h.alertError.mockClear()
    h.alertNormal.mockClear()
})

afterEach(async () => {
    await unmountAll()
    acquire.unregisterModuleLoader()
    vi.restoreAllMocks()
})

//#endregion

describe('share of a module stub', () => {
    test.each([['0', 'charx'], ['1', 'legacy']])('share-exports-loaded-body: format %s exports the loaded body with no stub marker', async (select, kind) => {
        installDb([stubOf('Ma'), residentOf('Mb')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        h.select = select
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[SHARE])
        expect(h.exported).toHaveLength(1)
        const exported = h.exported[0].module as RisuModule
        expect(h.exported[0].kind).toBe(kind)
        expect(exported.lorebook?.length).toBe(1)
        expect(MODULE_STUB_KEY in exported).toBe(false)
        expect(JSON.stringify(exported)).not.toContain(MODULE_STUB_KEY)
    })

    test('a load failure exports nothing and names the module', async () => {
        installDb([stubOf('Ma')])
        acquire.registerModuleLoader(async () => { throw new Error('disk gone') })
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[SHARE])
        expect(h.exported).toHaveLength(0)
        expect(h.alertError).toHaveBeenCalledWith(language.moduleLoadFailed('Ma'))
    })

    test('guard: a resident module is exported as the row object', async () => {
        const row = residentOf('Mb')
        installDb([row])
        const target = mountModules()
        await click(rowButtons(target, 'Mb')[SHARE])
        expect(h.exported[0].module).toBe(DBState.db.modules[0])
    })

    test.each(['0', '1'])('release-skipped: share format %s releases the handle it acquired', async (select) => {
        installDb([stubOf('Ma')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const counts = countReleases()
        h.select = select
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[SHARE])
        expect(counts).toEqual({ acquired: 1, released: 1 })
    })
})

describe('convert to character of a module stub', () => {
    test('convert-uses-loaded-body: the pushed character holds the body entries', async () => {
        installDb([stubOf('Ma')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const counts = countReleases()
        const target = mountModules()
        await click(conversionToggle(target))
        await click(rowButtons(target, 'Ma')[0])
        const pushed = DBState.db.characters as unknown as { lore: { content: string }[] }[]
        expect(pushed).toHaveLength(1)
        expect(pushed[0].lore.map((l) => l.content)).toEqual(['entry of Ma'])
        expect(h.alertNormal).toHaveBeenCalledWith(language.successfullyConverted)
        expect(counts).toEqual({ acquired: 1, released: 1 })
    })

    test('a load failure pushes no character and shows no success message', async () => {
        installDb([stubOf('Ma')])
        const target = mountModules()
        await click(conversionToggle(target))
        await click(rowButtons(target, 'Ma')[0])
        expect(DBState.db.characters).toHaveLength(0)
        expect(h.alertNormal).not.toHaveBeenCalled()
        expect(h.alertError).toHaveBeenCalledWith(language.moduleLoadFailed('Ma'))
    })
})

describe('module editor over a module stub', () => {
    test('editor-opens-on-loaded-module: the form receives the live loaded module, not the stub', async () => {
        installDb([stubOf('Ma'), residentOf('Mb')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        expect(editorOpen(target)).toBe(true)
        const received = h.menu.props!.currentModule
        expect(isModuleStub(received)).toBe(false)
        expect(received.lorebook).toHaveLength(1)
        expect(received).toBe(DBState.db.modules[0])
    })

    test('guard: an edit through the form\'s bound object lands in the live slot', async () => {
        installDb([stubOf('Ma')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        h.menu.props!.currentModule.description = 'edited'
        flushSync()
        expect(DBState.db.modules[0].description).toBe('edited')
    })

    test('editor-load-failure-stays-closed: the editor stays closed, the failure names the module, the slot is unchanged', async () => {
        installDb([stubOf('Ma')])
        const slot = DBState.db.modules[0]
        acquire.registerModuleLoader(async () => { throw new Error('disk gone') })
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        expect(editorOpen(target)).toBe(false)
        expect(h.menu.renders).toBe(0)
        expect(h.alertError).toHaveBeenCalledWith(language.moduleLoadFailed('Ma'))
        expect(DBState.db.modules[0]).toBe(slot)
        expect(isModuleStub(DBState.db.modules[0])).toBe(true)
    })

    test('editor-ignores-second-click-while-loading: one load runs and one editor opens', async () => {
        installDb([stubOf('Ma')])
        let finish: (() => void) | undefined
        const loader = vi.fn(async (handle: string) => {
            await new Promise<void>((resolve) => { finish = resolve })
            DBState.db.modules[0] = bodyOf('Ma')
            return DBState.db.modules[0]
        })
        acquire.registerModuleLoader(loader)
        const counts = countReleases()
        const target = mountModules()
        const edit = rowButtons(target, 'Ma')[EDIT]
        edit.click()
        edit.click()
        await settle()
        expect(loader).toHaveBeenCalledTimes(1)
        finish!()
        await settle()
        expect(editorOpen(target)).toBe(true)
        expect(counts.acquired).toBe(1)
    })

    /** A loader that waits for `finish()` before it installs the body of `Ma`. */
    function registerDeferred(): { finish: () => void } {
        const gate: { finish: () => void } = { finish: () => {} }
        acquire.registerModuleLoader(async () => {
            await new Promise<void>((resolve) => { gate.finish = resolve })
            DBState.db.modules[0] = bodyOf('Ma')
            return DBState.db.modules[0]
        })
        return gate
    }

    test('destroy-during-load: a component destroyed while the load is pending opens nothing and releases the handle', async () => {
        installDb([stubOf('Ma')])
        const gate = registerDeferred()
        const counts = countReleases()
        const target = mountModules()
        rowButtons(target, 'Ma')[EDIT].click()
        await settle()
        await unmountAll()
        gate.finish()
        await settle()
        expect(counts).toEqual({ acquired: 1, released: 1 })
        expect(h.menu.renders).toBe(0)
    })

    test('create-during-load: the create form entered while the load is pending is not replaced by the editor', async () => {
        installDb([stubOf('Ma')])
        const gate = registerDeferred()
        const counts = countReleases()
        const target = mountModules()
        rowButtons(target, 'Ma')[EDIT].click()
        await settle()
        await click(Array.from(target.querySelectorAll('div.flex.mr-2.mt-4 > button'))[0] as HTMLButtonElement)
        expect(target.textContent).toContain(language.createModule)
        gate.finish()
        await settle()
        expect(target.textContent).toContain(language.createModule)
        expect(editorOpen(target)).toBe(false)
        expect(counts).toEqual({ acquired: 1, released: 1 })
    })

    test('a module that left the list during the load is not opened and its handle is released', async () => {
        installDb([stubOf('Ma'), residentOf('Mb')])
        const counts = countReleases()
        acquire.registerModuleLoader(async () => {
            DBState.db.modules.splice(0, 1)
            return bodyOf('Ma')
        })
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        expect(editorOpen(target)).toBe(false)
        expect(counts.acquired).toBe(1)
        expect(counts.released).toBe(1)
    })

    test('editor-save-refinds-slot: a slot removed above the edited module while the editor is open does not misdirect the save', async () => {
        installDb([residentOf('Ma'), stubOf('Mb'), residentOf('Mc'), residentOf('Md')])
        registerInstalling({ 'id-Mb': bodyOf('Mb') })
        const target = mountModules()
        await click(rowButtons(target, 'Mb')[EDIT])
        DBState.db.modules.splice(0, 1)
        flushSync()
        await click(saveButton(target))
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Mb', 'Mc', 'Md'])
        expect(DBState.db.modules[1].lorebook?.[0].content).toBe('entry of Mc')
    })

    test('a module deleted while the editor is open is not written back', async () => {
        installDb([residentOf('Ma'), residentOf('Mb'), residentOf('Mc')])
        const target = mountModules()
        await click(rowButtons(target, 'Mb')[EDIT])
        DBState.db.modules.splice(1, 1)
        flushSync()
        await click(saveButton(target))
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Ma', 'Mc'])
    })

    test('guard: saving an unchanged open editor keeps the module in its slot', async () => {
        installDb([residentOf('Ma'), residentOf('Mb')])
        const target = mountModules()
        await click(rowButtons(target, 'Mb')[EDIT])
        await click(saveButton(target))
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Ma', 'Mb'])
        expect(editorOpen(target)).toBe(false)
    })

    test('release-skipped: the editor releases its handle when it closes', async () => {
        installDb([stubOf('Ma')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const counts = countReleases()
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        expect(counts).toEqual({ acquired: 1, released: 0 })
        await click(saveButton(target))
        expect(counts).toEqual({ acquired: 1, released: 1 })
    })

    test('release-skipped: the editor releases its handle when the component is destroyed while it is open', async () => {
        installDb([stubOf('Ma')])
        registerInstalling({ 'id-Ma': bodyOf('Ma') })
        const counts = countReleases()
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[EDIT])
        await unmountAll()
        expect(counts).toEqual({ acquired: 1, released: 1 })
    })
})

describe('module list over a module stub', () => {
    test('guard: stub-row-renders-list-fields: name, description and the MCP icon come from the stub', () => {
        installDb([stubOf('Ma'), stubOf('Mm', { mcp: true })])
        const target = mountModules()
        const names = Array.from(target.querySelectorAll('span.text-lg')).map((s) => s.textContent?.trim())
        expect(names).toEqual(['Ma', 'Mm'])
        expect(target.textContent).toContain('desc Ma')
        const rowOf = (title: string) => Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)!.parentElement!
        expect(rowOf('Mm').firstElementChild?.tagName.toLowerCase()).toBe('svg')
        expect(rowOf('Ma').firstElementChild?.tagName.toLowerCase()).toBe('span')
    })

    test('guard: toggle-and-delete-do-not-load: enabling and removing a stub never call the loader', async () => {
        installDb([stubOf('Ma'), stubOf('Mb')])
        const loader = registerInstalling({})
        const target = mountModules()
        await click(rowButtons(target, 'Ma')[GLOBE])
        expect(DBState.db.enabledModules).toEqual(['id-Ma'])
        await click(rowButtons(target, 'Ma')[REMOVE])
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Mb'])
        expect(DBState.db.enabledModules).toEqual([])
        expect(loader).not.toHaveBeenCalled()
    })
})
