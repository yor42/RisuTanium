/**
 * `importPlugin` (src/ts/plugins/plugins.svelte.ts) replaces the plugin that has the
 * imported plugin's name when the user confirms the duplicate prompt, wherever that
 * plugin is in the list when the confirmation is answered. Drives the REAL `importPlugin`
 * against a plain database object; the alert confirm is a mock the test holds open and
 * answers. Every other module `plugins.svelte.ts` imports is mocked purely so the module
 * loads (the set of `pluginSetDatabaseSaveMarks.svelte.test.ts`). Titles beginning
 * "guard:" pin behaviour that must be preserved before and after the change; every other
 * test is a regression reproducer for the behaviour it names.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
        alertError: vi.fn(),
        alertPluginConfirm: vi.fn(async () => true),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('../../alert')
})

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} },
    hotReloading: [] as string[],
    pluginAlertModalStore: writable(null),
    selectedCharID: writable(-1),
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('../apiV3/v3.svelte'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

//#endregion

import { importPlugin } from '../plugins.svelte'

//#region fixtures and helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installed(name: string, secret = ''): RisuPlugin {
    return {
        name, displayName: name, script: `//@name ${name}\n//@api 3.0\n// installed copy`, version: '3.0',
        arguments: { key: 'string' }, realArg: { key: secret }, customLink: [], argMeta: {}, enabled: true,
    } as unknown as RisuPlugin
}

function installDb(plugins: RisuPlugin[]): RisuPlugin[] {
    const db = { plugins } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = db
    return db.plugins as unknown as RisuPlugin[]
}

const source = (name: string) => `//@name ${name}\n//@api 3.0\n// incoming copy`
const scriptOf = (list: RisuPlugin[], name: string) => list.find((p) => p.name === name)?.script ?? ''

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await sleep(20)
}

beforeEach(() => {
    confirms.pending.length = 0
})

//#endregion

describe('importing a plugin whose name is already installed', () => {
    test('guard: a confirmed import replaces the installed copy in place and leaves the other plugins and their arguments alone', async () => {
        const list = installDb([installed('A', 'secret-a'), installed('B', 'secret-b'), installed('C', 'secret-c')])
        const done = importPlugin(source('B'))
        await sleep(20)
        expect(confirms.pending.length).toBe(1)
        await answer(true)
        await done
        expect(list.map((p) => p.name)).toEqual(['A', 'B', 'C'])
        expect(scriptOf(list, 'B')).toContain('incoming copy')
        expect(list[0].realArg).toEqual({ key: 'secret-a' })
        expect(list[2].realArg).toEqual({ key: 'secret-c' })
    })

    test('guard: refusing the prompt leaves every plugin as it was', async () => {
        const list = installDb([installed('A'), installed('B')])
        const done = importPlugin(source('B'))
        await sleep(20)
        await answer(false)
        await done
        expect(list.map((p) => scriptOf(list, p.name))).toEqual([installed('A').script, installed('B').script])
    })

    test('guard: a plugin with a new name is added without a prompt', async () => {
        const list = installDb([installed('A')])
        await importPlugin(source('New'))
        expect(confirms.pending.length).toBe(0)
        expect(list.map((p) => p.name)).toEqual(['A', 'New'])
    })

    test('a plugin removed above the installed copy while the prompt is open does not make the import overwrite another plugin', async () => {
        const list = installDb([installed('A', 'secret-a'), installed('B', 'secret-b'), installed('C', 'secret-c')])
        const done = importPlugin(source('B'))
        await sleep(20)
        list.splice(0, 1)
        await answer(true)
        await done
        expect(list.map((p) => p.name)).toEqual(['B', 'C'])
        expect(scriptOf(list, 'B')).toContain('incoming copy')
        expect(list[1].script).toContain('installed copy')
        expect(list[1].realArg).toEqual({ key: 'secret-c' })
    })

    test('a plugin inserted above the installed copy while the prompt is open does not make the import overwrite another plugin', async () => {
        const list = installDb([installed('A'), installed('B'), installed('C', 'secret-c')])
        const done = importPlugin(source('B'))
        await sleep(20)
        list.unshift(installed('Z', 'secret-z'))
        await answer(true)
        await done
        expect(list.map((p) => p.name)).toEqual(['Z', 'A', 'B', 'C'])
        expect(scriptOf(list, 'B')).toContain('incoming copy')
        expect(list[0].realArg).toEqual({ key: 'secret-z' })
        expect(list[1].script).toContain('installed copy')
    })

    test('an installed copy removed while the prompt is open leaves the other plugins alone and the import is added as new', async () => {
        const list = installDb([installed('A', 'secret-a'), installed('B'), installed('C', 'secret-c')])
        const done = importPlugin(source('B'))
        await sleep(20)
        list.splice(1, 1)
        await answer(true)
        await done
        expect(list.map((p) => p.name)).toEqual(['A', 'C', 'B'])
        expect(list[1].realArg).toEqual({ key: 'secret-c' })
        expect(scriptOf(list, 'B')).toContain('incoming copy')
    })
})
