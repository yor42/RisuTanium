// @vitest-environment happy-dom

/**
 * `ModuleSettings.svelte`'s remove button removes the module the user aimed at, and only
 * that module, however the module list changes while its confirmation is open; the
 * module's id leaves `enabledModules` only when no remaining module holds that id.
 *
 * Mounts the REAL `ModuleSettings.svelte` over a real `$state` database. The alert confirm
 * is a mock the test holds open and answers. Titles beginning "guard:" pin behaviour that
 * must be preserved before and after the change; every other test is a regression
 * reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeModule(name: string, id = 'id-' + name): RisuModule {
    return { name, description: '', id } as RisuModule
}

function installDb(modules: RisuModule[], enabled: string[] = []): void {
    DBState.db = { modules, enabledModules: enabled, moduleIntergration: '' } as unknown as Database
}

/** The list is shown in array order, so the fixtures list modules in the order the assertions expect. */
const names = () => DBState.db.modules.map((m) => m.name)

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

/** The remove (trash) button of the row whose module is named `title`. */
function remove(target: HTMLElement, title: string): HTMLButtonElement {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    const buttons = Array.from(span.parentElement!.querySelectorAll('button')) as HTMLButtonElement[]
    return buttons[buttons.length - 1]
}

async function clickRemove(target: HTMLElement, title: string): Promise<void> {
    remove(target, title).click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    confirms.pending.length = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const four = () => [makeModule('Ma'), makeModule('Mb'), makeModule('Mc'), makeModule('Md')]

//#endregion

describe('a module remove', () => {
    test('guard: with nothing else changing, the confirmed module is removed and no other', async () => {
        installDb(four())
        const target = mountModules()
        await clickRemove(target, 'Mb')
        await answer(true)
        expect(names()).toEqual(['Ma', 'Mc', 'Md'])
    })

    test('guard: the removed module\'s id leaves enabledModules and the others stay', async () => {
        installDb(four(), ['id-Mb', 'id-Mc'])
        const target = mountModules()
        await clickRemove(target, 'Mb')
        await answer(true)
        expect(DBState.db.enabledModules).toEqual(['id-Mc'])
    })

    test('guard: refusing the confirmation removes nothing', async () => {
        installDb(four(), ['id-Mb'])
        const target = mountModules()
        await clickRemove(target, 'Mb')
        await answer(false)
        expect(names()).toEqual(['Ma', 'Mb', 'Mc', 'Md'])
        expect(DBState.db.enabledModules).toEqual(['id-Mb'])
    })

    test('a module removed above it while the confirmation is open does not change which module is removed', async () => {
        installDb(four(), ['id-Mc'])
        const target = mountModules()
        await clickRemove(target, 'Mc')
        DBState.db.modules.splice(0, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['Mb', 'Md'])
        expect(DBState.db.enabledModules).toEqual([])
    })

    test('a module inserted above it while the confirmation is open does not change which module is removed', async () => {
        installDb(four())
        const target = mountModules()
        await clickRemove(target, 'Mc')
        DBState.db.modules.unshift(makeModule('A-new'))
        flushSync()
        await answer(true)
        expect(names()).toEqual(['A-new', 'Ma', 'Mb', 'Md'])
    })

    test('two pending removes of the same module remove it once', async () => {
        installDb(four())
        const target = mountModules()
        await clickRemove(target, 'Mb')
        await clickRemove(target, 'Mb')
        expect(confirms.pending.length).toBe(2)
        await answer(true)
        await answer(true)
        expect(names()).toEqual(['Ma', 'Mc', 'Md'])
    })

    test('a module removed by something else while its confirmation is open leaves every other module and the enabled list alone', async () => {
        installDb(four(), ['id-Mb', 'id-Mc'])
        const target = mountModules()
        await clickRemove(target, 'Mb')
        DBState.db.modules.splice(1, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['Ma', 'Mc', 'Md'])
        expect(DBState.db.enabledModules).toEqual(['id-Mb', 'id-Mc'])
    })

    test('the last row, removed by something else while its confirmation is open, takes no other module with it', async () => {
        installDb(four())
        const target = mountModules()
        await clickRemove(target, 'Md')
        DBState.db.modules.splice(3, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['Ma', 'Mb', 'Mc'])
    })

    test('a module id shared with a module that stays remains in enabledModules', async () => {
        installDb([makeModule('Ma', 'shared'), makeModule('Mb', 'shared'), makeModule('Mc')], ['shared'])
        const target = mountModules()
        await clickRemove(target, 'Ma')
        await answer(true)
        expect(names()).toEqual(['Mb', 'Mc'])
        expect(DBState.db.enabledModules).toEqual(['shared'])
    })
})
