// @vitest-environment happy-dom
/**
 * Retired V2.1 plugins: a V2.1 entry stays in the database as data and never runs.
 *
 * Invariants exercised here:
 * - `loadPlugins` runs no V2.1 script, makes no safety-check record, restores no archived character and never
 *   switches a V2.1 entry off, whatever the stored restore count holds.
 * - `togglePluginEnabled` leaves a V2.1 entry exactly as saved, while any other version still flips and reloads.
 * - A version 2 entry still reaches `loadV2Plugin` (the removal warning), the unload and the six set clears still
 *   precede the V3 loader, and an update that turns a V2.1 entry into a 3.0 one keeps `enabled` and loads it.
 *
 * Titles starting `reproducer:` fail on the pre-change code; `guard:` pins behaviour that holds before and after.
 * The V3 loader, the alert queue and the sandbox classes are mocks, so a pass says nothing about the native
 * sandbox.
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region module mocks

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hotReloading: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => { }),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertMd: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    requiresFullEncoderReload: { state: false },
    forageStorage: { realStorage: { setItem: vi.fn(), getItem: vi.fn(async () => null), keys: vi.fn(async () => []) } },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/plugins/pluginSafeClass'), () => ({
    SafeDocument: class { },
    SafeIdbFactory: class { },
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('src/ts/plugins/pluginSafeClass'))

const loadV3 = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => { }))

vi.mock(import('src/ts/plugins/apiV3/v3.svelte'), () => ({
    loadV3Plugins: loadV3,
}) as unknown as typeof import('src/ts/plugins/apiV3/v3.svelte'))

vi.mock(import('src/ts/plugins/apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('src/ts/plugins/apiV3/transpiler'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

//#endregion

import { importPlugin, loadPlugins, pluginV2, togglePluginEnabled } from 'src/ts/plugins/plugins.svelte'
import { carrySavedValues } from 'src/ts/plugins/pluginListMerge'
import { DBState } from 'src/ts/stores.svelte'
import * as alert from 'src/ts/alert'

function entry(script: string, version: RisuPlugin['version'] = '2.1', enabled = true): RisuPlugin {
    return { name: 'legacy', script, version, enabled, arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

function installDb(plugins: RisuPlugin[], characters: unknown[] = []): void {
    DBState.db = { botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins, pluginCustomStorage: {}, characters } as unknown as Database
}

const safetyKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('safety-'))

beforeEach(() => {
    localStorage.clear()
    pluginV2.providers.clear()
    pluginV2.unload.clear()
    pluginV2.loaded = false
    loadV3.mockReset()
    loadV3.mockImplementation(async () => { })
    vi.mocked(alert.alertNormal).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

describe('a V2.1 plugin never runs', () => {
    test('reproducer: the script of an enabled V2.1 entry registers no provider and leaves no safety record', async () => {
        installDb([entry("addProvider('v21ran', async () => ({ success: true, content: '' }))")])

        await loadPlugins()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(pluginV2.providers.has('v21ran')).toBe(false)
        expect(safetyKeys()).toEqual([])
    })

    test('reproducer: with two unfinished restores recorded and an archived character, the entry is left as saved and no notice is shown', async () => {
        const input = entry("addProvider('x', async () => ({}))")
        const before = JSON.stringify(input)
        localStorage.setItem('v21RestoreAllStrikes', '2')
        installDb([input], [{ type: 'character', name: 'Cold', chaId: 'c1', coldstorage: 'unit-1', chats: [] }])

        const outcome = await Promise.race([
            loadPlugins().then(() => 'done'),
            new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ])

        expect(outcome).toBe('done')
        expect(JSON.stringify(DBState.db.plugins[0])).toBe(before)
        expect(vi.mocked(alert.alertNormal)).not.toHaveBeenCalled()
    })

    test.each([false, true])('reproducer: toggling a V2.1 entry saved as enabled=%s leaves it as saved and loads nothing', async (enabled) => {
        const plugin = entry('', '2.1', enabled)
        installDb([plugin])

        await togglePluginEnabled(plugin)

        expect(plugin.enabled).toBe(enabled)
        expect(loadV3).not.toHaveBeenCalled()
    })

    test('guard: toggling a 3.0 entry still flips it and reloads the plugins', async () => {
        const plugin = entry('', '3.0', false)
        installDb([plugin])

        await togglePluginEnabled(plugin)

        expect(plugin.enabled).toBe(true)
        expect(loadV3).toHaveBeenCalled()
    })
})

describe('the other plugin versions are unchanged', () => {
    test('guard: an enabled version 2 entry logs the removal warning naming it, a V2.1 entry does not', async () => {
        installDb([{ ...entry('', 2), name: 'old2' }, { ...entry(''), name: 'new21' }])

        await loadPlugins()

        const warns = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]))
        expect(warns.some((text) => text.includes('Plugin 2.0 is removed') && text.includes('"old2"'))).toBe(true)
        expect(warns.some((text) => text.includes('"new21"'))).toBe(false)
    })

    test('guard: a reload runs the registered unloads and clears the six sets before the V3 loader', async () => {
        installDb([entry('', '3.0')])
        pluginV2.loaded = true
        const unload = vi.fn()
        pluginV2.unload.add(unload)
        pluginV2.providers.set('stale', async () => ({ success: true, content: '' }))
        let providersWhenV3Loaded = -1
        loadV3.mockImplementation(async () => { providersWhenV3Loaded = pluginV2.providers.size })

        await loadPlugins()

        expect(unload).toHaveBeenCalledTimes(1)
        expect(providersWhenV3Loaded).toBe(0)
    })

    test('guard: carrying saved values from a V2.1 entry to a 3.0 one keeps enabled, on and off', () => {
        expect((carrySavedValues(entry('', '2.1', true), entry('', '3.0', false)) as RisuPlugin).enabled).toBe(true)
        expect((carrySavedValues(entry('', '2.1', false), entry('', '3.0', true)) as RisuPlugin).enabled).toBe(false)
    })

    test('guard: an update of an enabled V2.1 entry with a 3.0 file hands the 3.0 plugin to the V3 loader', async () => {
        installDb([entry('')])

        await importPlugin('//@name legacy\n//@api 3.0\n//@version 1.0.0\nconsole.log("v3")', { isUpdate: true, originalPluginName: 'legacy' })

        await vi.waitFor(() => expect(loadV3).toHaveBeenCalled())
        const handed = loadV3.mock.calls[0][0] as RisuPlugin[]
        expect(handed.map((plugin) => [plugin.name, plugin.version, plugin.enabled])).toEqual([['legacy', '3.0', true]])
    })
})
