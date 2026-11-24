// @vitest-environment happy-dom

/**
 * The classic Modules page's "make a character" mode. `convertModuleToCharacter` throws for an MCP module; the page
 * shows that message and pushes no character instead of ending in an unhandled rejection.
 *
 * Mounts the REAL `ModuleSettings.svelte` over a real `$state` database. The MCP row has the shape
 * `importMCPModule` stores. MOCKED: the alert, the conversion (it throws for an MCP module, as the real one does),
 * the global API, the module store helpers and the module menu.
 *
 * T9-CONVERT-MCP-CLASSIC is a regression reproducer (the throw was not caught). The ordinary conversion test is a
 * compatibility guard that passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

const h = vi.hoisted(() => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    checkCharOrder: vi.fn(),
    unhandled: [] as unknown[],
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertError: h.alertError,
        alertNormal: h.alertNormal,
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

vi.mock(import('src/ts/interchangeability'), async () => {
    const { language } = await import('src/lang')
    return {
        convertModuleToCharacter: vi.fn((m: RisuModule) => {
            if (m.mcp) throw new Error(language.errors.mcpModuleConversionUnsupported)
            return { chaId: 'made-' + m.id, name: m.name }
        }),
    } as unknown as typeof import('src/ts/interchangeability')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: h.checkCharOrder,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/tooltip'), () => ({
    tooltip: () => ({}),
}) as unknown as typeof import('src/ts/gui/tooltip'))

vi.mock('src/lib/Setting/Pages/Module/ModuleMenu.svelte', () => ({ default: () => {} }))

//#endregion

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import ModuleSettings from './ModuleSettings.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

/** The module `importMCPModule` stores for an `internal:dice` server. */
function mcpModule(): RisuModule {
    return {
        name: 'Dice',
        description: 'MCP from internal:dice',
        mcp: { url: 'internal:dice' },
        id: 'mcp-1',
        lorebook: [{ comment: 'MCP Info', content: '@@mcp', key: '', alwaysActive: true, secondkey: '', insertorder: 0, mode: 'normal', selective: false }],
    } as unknown as RisuModule
}

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []
const onUnhandled = (reason: unknown) => { h.unhandled.push(reason) }

beforeEach(() => {
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    h.checkCharOrder.mockReset()
    h.unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    DBState.db = {
        modules: [mcpModule(), { name: 'Plain', description: '', id: 'plain-1' } as RisuModule],
        enabledModules: [],
        moduleIntergration: '',
        characters: [],
    } as unknown as Database
})

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    for (const entry of mounted) {
        await unmount(entry.app as never)
        entry.target.remove()
    }
    mounted = []
})

async function mountInConvertMode(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moduleConvertMode}"]`)!.click()
    flushSync()
    return target
}

function convertButton(target: HTMLElement, title: string): HTMLButtonElement {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return span.parentElement!.querySelector<HTMLButtonElement>(`button[aria-label="${language.moduleConvertRow}"]`)!
}

describe('T9-CONVERT-MCP-CLASSIC: converting an MCP row', () => {
    test('shows the unsupported message, pushes no character and leaves no unhandled rejection', async () => {
        const target = await mountInConvertMode()
        convertButton(target, 'Dice').click()
        await settle()
        // An unhandled rejection is reported on a later turn of the event loop.
        await sleep(20)

        expect(h.alertError).toHaveBeenCalledWith(language.errors.mcpModuleConversionUnsupported)
        expect(DBState.db.characters).toHaveLength(0)
        expect(h.checkCharOrder).not.toHaveBeenCalled()
        expect(h.unhandled).toEqual([])
    })

    test('guard: an ordinary module still becomes a character, with the success message and one order check', async () => {
        const target = await mountInConvertMode()
        convertButton(target, 'Plain').click()
        await settle()

        expect(DBState.db.characters).toHaveLength(1)
        expect(DBState.db.characters[0]).toMatchObject({ chaId: 'made-plain-1', name: 'Plain' })
        expect(h.alertNormal).toHaveBeenCalledWith(language.successfullyConverted)
        expect(h.checkCharOrder).toHaveBeenCalledTimes(1)
        expect(h.alertError).not.toHaveBeenCalled()
    })
})
