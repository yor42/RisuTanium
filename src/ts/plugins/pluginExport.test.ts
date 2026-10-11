/**
 * The plugin export seam (src/ts/plugins/pluginExport.ts): the file name is a safe `.js` name,
 * the content is exactly the stored script, and that content re-imports through the REAL
 * `importPlugin` with the same metadata. Every module `plugins.svelte.ts` imports is mocked
 * purely so it loads (the set of `importPluginUpdateTarget.svelte.test.ts`). Titles beginning
 * "guard:" pin behaviour that holds before and after any change; the others are regression
 * reproducers for the behaviour they name.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../storage/database.svelte'
import type { RisuPlugin } from './plugins.svelte'

//#region module mocks

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

vi.mock(import('../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../platform'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn(),
        alertPluginConfirm: vi.fn(async () => true),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('../alert')
})

vi.mock(import('../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../util'))

vi.mock(import('../globalApi.svelte'), () => ({
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
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../stores.svelte'), () => ({
    DBState: { db: {} },
    hotReloading: [] as string[],
    pluginAlertModalStore: writable(null),
    selectedCharID: writable(-1),
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('./pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('./pluginSafety'))

vi.mock(import('./pluginSafeClass'), () => ({
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
}) as unknown as typeof import('./pluginSafeClass'))

vi.mock(import('./apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('./apiV3/v3.svelte'))

vi.mock(import('./apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('./apiV3/transpiler'))

//#endregion

import { importPlugin } from './plugins.svelte'
import { pluginExportFile, pluginExportFileName, pluginFileBaseName } from './pluginExport'

const source = [
    '//@name Round Trip',
    '//@display-name Round Trip Display',
    '//@api 3.0',
    '//@version 1.2.3',
    '//@arg api_key string',
    '//@arg size int',
    'Risuai.log("hi");',
].join('\n')

function installDb(plugins: RisuPlugin[]): RisuPlugin[] {
    const db = { plugins } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = db
    return db.plugins as unknown as RisuPlugin[]
}

beforeEach(() => {
    installDb([])
})

describe('pluginExportFileName', () => {
    test('guard: an ordinary name gets the .js extension', () => {
        expect(pluginExportFileName('My Plugin')).toBe('My Plugin.js')
    })

    test('path separators are removed, so the name cannot leave the download folder', () => {
        const name = pluginExportFileName('a/b\\c')
        expect(name).toBe('abc.js')
        expect(name).not.toMatch(/[/\\]/)
    })

    test('characters invalid on Windows and Android file systems are removed', () => {
        expect(pluginExportFileName('a<b>c:d"e|f?g*h\u0001i')).toBe('abcdefghi.js')
    })

    test('an empty, blank or all-invalid name falls back to a fixed base name', () => {
        expect(pluginExportFileName('')).toBe('plugin.js')
        expect(pluginExportFileName(undefined)).toBe('plugin.js')
        expect(pluginExportFileName('   ')).toBe('plugin.js')
        expect(pluginExportFileName('///')).toBe('plugin.js')
    })

    test('guard: exact file names for a table of names, pinned from the pre-refactor function', () => {
        const table: Array<[string | undefined, string]> = [
            ['My Plugin', 'My Plugin.js'],
            ['a/b', 'ab.js'],
            ['name.', 'name.js'],
            ['', 'plugin.js'],
            [undefined, 'plugin.js'],
            ['CON', '_CON.js'],
            ['a\u0001b\u001fc', 'abc.js'],
            ['플러그인 プラグイン', '플러그인 プラグイン.js'],
        ]
        for (const [input, expected] of table) {
            expect(pluginExportFileName(input)).toBe(expected)
            expect(pluginFileBaseName(input) + '.js').toBe(expected)
        }
    })

    test('trailing dots and spaces, which Windows drops, are removed', () => {
        expect(pluginExportFileName('name. . ')).toBe('name.js')
    })

    test('a name Windows reserves is made usable', () => {
        expect(pluginExportFileName('CON')).toBe('_CON.js')
    })
})

describe('exporting a plugin script', () => {
    test('the content is exactly the stored script and carries no saved setting value', async () => {
        const list = installDb([])
        await importPlugin(source)
        list[0].realArg = { api_key: 'sk-secret-value', size: 5 }
        const file = pluginExportFile(list[0])
        expect(file.content).toBe(source)
        expect(file.content).not.toContain('sk-secret-value')
        expect(file.fileName).toBe('Round Trip.js')
    })

    test('the exported content re-imports with the same name, display name, arguments and version', async () => {
        const list = installDb([])
        await importPlugin(source)
        const original = list[0]
        const file = pluginExportFile(original)

        const again = installDb([])
        await importPlugin(file.content)

        expect(again.length).toBe(1)
        expect(again[0].name).toBe(original.name)
        expect(again[0].displayName).toBe(original.displayName)
        expect(again[0].arguments).toEqual(original.arguments)
        expect(again[0].versionOfPlugin).toBe(original.versionOfPlugin)
        expect(again[0].version).toBe(original.version)
        expect(again[0].script).toBe(original.script)
        expect(original.versionOfPlugin).toBe('1.2.3')
        expect(Object.keys(original.arguments)).toEqual(['api_key', 'size'])
    })
})
