/**
 * The plugin file picker of `importPlugin` (src/ts/plugins/plugins.svelte.ts): one
 * file takes the single-file path exactly as before, two or more files get one
 * review, one write and one reload. Drives the REAL `importPlugin` against a plain
 * database object; picker, alerts and the TypeScript transpiler are mocks.
 * Labels: "feature" tests describe the batch behaviour and fail on the code before
 * it; "guard" tests pin behaviour that must be preserved. The single-file guards
 * pin the previous single-file behaviour (the previous body passes them with a
 * single-file picker stand-in). The decline guard passes on the previous logic as
 * well, because nothing is written there either way.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../storage/database.svelte'
import type { RisuPlugin } from './plugins.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    pick: vi.fn(),
    confirm: vi.fn(),
    error: vi.fn(),
    setDatabaseLite: vi.fn(),
    loadV3: vi.fn(),
    transpile: vi.fn(),
}))

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
    setDatabaseLite: h.setDatabaseLite,
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: h.confirm,
        alertError: h.error,
        alertPluginConfirm: vi.fn(async () => true),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('../alert')
})

vi.mock(import('../util'), () => ({
    selectFileByDom: h.pick,
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
    selectedCharID: writable(-1),
}) as unknown as typeof import('../stores.svelte'))

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
    loadV3Plugins: h.loadV3,
}) as unknown as typeof import('./apiV3/v3.svelte'))

vi.mock(import('./apiV3/transpiler'), () => ({
    pluginCodeTranspiler: h.transpile,
}) as unknown as typeof import('./apiV3/transpiler'))

//#endregion

import { importPlugin } from './plugins.svelte'
import { language } from '../../lang'

//#region fixtures and helpers

function installed(name: string, secret = '', extra: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, displayName: name, script: `//@name ${name}\n//@api 3.0\n// installed copy`, version: '3.0',
        arguments: { key: 'string' }, realArg: { key: secret }, customLink: [], argMeta: {}, enabled: true,
        ...extra,
    } as unknown as RisuPlugin
}

function installDb(plugins: RisuPlugin[]): RisuPlugin[] {
    const db = { plugins } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = db
    return db.plugins as unknown as RisuPlugin[]
}

const source = (name: string, extra = '') => `//@name ${name}\n//@api 3.0\n${extra}// incoming copy`
const ARG = '//@arg key string\n'
const file = (name: string, text: string) => new File([new TextEncoder().encode(text)], name)
const picked = (...files: File[]) => h.pick.mockResolvedValueOnce(files)
const reviewText = () => String(h.confirm.mock.calls[0]?.[0] ?? '')

beforeEach(() => {
    h.pick.mockReset()
    h.confirm.mockReset()
    h.error.mockReset()
    h.setDatabaseLite.mockReset()
    h.loadV3.mockReset()
    h.loadV3.mockResolvedValue(undefined)
    h.transpile.mockReset()
    h.transpile.mockImplementation(async (code: string) => code)
})

//#endregion

describe('the plugin picker with one file', () => {
    test('feature: asks the DOM picker for several js and ts files', async () => {
        installDb([])
        picked()
        await importPlugin()
        expect(h.pick).toHaveBeenCalledTimes(1)
        expect(h.pick).toHaveBeenCalledWith(['js', 'ts'], 'multiple')
    })

    test('guard: nothing picked is silent', async () => {
        const list = installDb([installed('A')])
        picked()
        await importPlugin()
        h.pick.mockResolvedValueOnce(null)
        await importPlugin()
        expect(h.confirm).not.toHaveBeenCalled()
        expect(h.error).not.toHaveBeenCalled()
        expect(h.setDatabaseLite).not.toHaveBeenCalled()
        expect(list).toHaveLength(1)
    })

    test('guard: a new plugin is added without a review, with one write and one reload', async () => {
        const list = installDb([installed('A')])
        picked(file('new.js', source('New')))
        await importPlugin()
        expect(h.confirm).not.toHaveBeenCalled()
        expect(list.map((p) => p.name)).toEqual(['A', 'New'])
        expect(h.setDatabaseLite).toHaveBeenCalledTimes(1)
        expect(h.loadV3).toHaveBeenCalledTimes(1)
    })

    test('guard: a duplicate name asks the duplicate question and replaces in place when confirmed', async () => {
        const list = installDb([installed('A'), installed('B', 'secret')])
        h.confirm.mockResolvedValueOnce(true)
        picked(file('b.js', source('B', ARG)))
        await importPlugin()
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(h.confirm).toHaveBeenCalledWith(language.duplicatePluginFoundUpdateIt)
        expect(list.map((p) => p.name)).toEqual(['A', 'B'])
        expect(list[1].script).toContain('incoming copy')
        expect(list[1].realArg).toEqual({ key: 'secret' })
    })

    test('guard: a refused duplicate writes nothing', async () => {
        installDb([installed('B')])
        h.confirm.mockResolvedValueOnce(false)
        picked(file('b.js', source('B')))
        await importPlugin()
        expect(h.setDatabaseLite).not.toHaveBeenCalled()
        expect(h.loadV3).not.toHaveBeenCalled()
    })

    test('guard: a TypeScript file whose transpile fails continues with the original text and reports the failure', async () => {
        const list = installDb([])
        h.transpile.mockRejectedValueOnce(new Error('boom'))
        picked(file('t.ts', source('Ts')))
        await importPlugin()
        expect(h.error).toHaveBeenCalledWith('Failed to transpile TypeScript code: boom')
        expect(list.map((p) => p.name)).toEqual(['Ts'])
        expect(list[0].script).toContain('incoming copy')
    })

    test('guard: a byte order mark at the start of any line is stripped', async () => {
        const list = installDb([])
        picked(file('bom.js', '﻿//@name Bom\n﻿//@api 3.0\n// body'))
        await importPlugin()
        expect(list.map((p) => p.name)).toEqual(['Bom'])
        expect(list[0].script).not.toContain('﻿')
    })

    test('guard: an empty file says the name is missing and does not reopen the picker', async () => {
        installDb([])
        picked(file('empty.js', ''))
        await importPlugin()
        expect(h.error).toHaveBeenCalledTimes(1)
        expect(String(h.error.mock.calls[0][0])).toContain('plugin name not found')
        expect(h.pick).toHaveBeenCalledTimes(1)
        expect(h.setDatabaseLite).not.toHaveBeenCalled()
    })

    test('guard: importPlugin with code never opens the picker, and an empty string still does', async () => {
        const list = installDb([])
        await importPlugin(source('FromCode'))
        expect(h.pick).not.toHaveBeenCalled()
        expect(list.map((p) => p.name)).toEqual(['FromCode'])
        picked()
        await importPlugin('')
        expect(h.pick).toHaveBeenCalledTimes(1)
    })
})

describe('the plugin picker with several files', () => {
    test('feature: one review lists new, updated and failed files, and Yes writes once and reloads once', async () => {
        const list = installDb([installed('A', 'secret-a', { enabled: false }), installed('B', 'secret-b')])
        h.confirm.mockResolvedValueOnce(true)
        picked(
            file('a.js', source('A', '//@version 2.0.0\n' + ARG)),
            file('n1.js', source('N1')),
            file('n2.js', source('N2')),
            file('bad.js', '// no header'),
        )
        await importPlugin()
        expect(h.confirm).toHaveBeenCalledTimes(1)
        const text = reviewText()
        expect(text).toContain('n1.js')
        expect(text).toContain('n2.js')
        expect(text).toContain('a.js')
        expect(text).toContain('bad.js: plugin name not found')
        expect(list.map((p) => p.name)).toEqual(['A', 'B', 'N1', 'N2'])
        expect(list[0].script).toContain('incoming copy')
        expect(list[0].realArg).toEqual({ key: 'secret-a' })
        expect(list[0].enabled).toBe(false)
        expect(list[1].script).toContain('installed copy')
        expect(list[2].enabled).toBe(true)
        expect(h.setDatabaseLite).toHaveBeenCalledTimes(1)
        expect(h.loadV3).toHaveBeenCalledTimes(1)
    })

    test('guard: No writes nothing and reloads nothing', async () => {
        const list = installDb([installed('A')])
        const before = JSON.stringify(list)
        h.confirm.mockResolvedValueOnce(false)
        picked(file('a.js', source('A')), file('n.js', source('N')))
        await importPlugin()
        expect(JSON.stringify(list)).toBe(before)
        expect(h.setDatabaseLite).not.toHaveBeenCalled()
        expect(h.loadV3).not.toHaveBeenCalled()
    })

    test('feature: when every file fails there is one summary, no review and no reload', async () => {
        installDb([])
        picked(file('x.js', '// nothing'), file('y.js', '//@name Old\n// no api line'))
        await importPlugin()
        expect(h.confirm).not.toHaveBeenCalled()
        expect(h.error).toHaveBeenCalledTimes(1)
        const text = String(h.error.mock.calls[0][0])
        expect(text).toContain(language.importFilesNotImported(2, 2, '').split('\n')[0])
        expect(text).toContain('x.js: plugin name not found')
        expect(text).toContain('y.js:')
        expect(h.setDatabaseLite).not.toHaveBeenCalled()
        expect(h.loadV3).not.toHaveBeenCalled()
    })

    test('feature: a name repeated in the batch counts once and the later file is listed as failed', async () => {
        const list = installDb([])
        h.confirm.mockResolvedValueOnce(true)
        picked(file('first.js', source('Same')), file('second.js', source('Same')), file('other.js', source('Other')))
        await importPlugin()
        expect(reviewText()).toContain(`second.js: ${language.pluginBatchRepeated}`)
        expect(list.map((p) => p.name)).toEqual(['Same', 'Other'])
    })

    test('feature: a TypeScript file that fails to transpile fails only that file and is never installed', async () => {
        const list = installDb([])
        h.confirm.mockResolvedValueOnce(true)
        h.transpile.mockRejectedValueOnce(new Error('boom'))
        picked(file('t.ts', source('Ts')), file('ok.js', source('Ok')))
        await importPlugin()
        expect(reviewText()).toContain(`t.ts: ${language.pluginBatchTranspileFailed('boom')}`)
        expect(h.error).not.toHaveBeenCalled()
        expect(list.map((p) => p.name)).toEqual(['Ok'])
    })

    test('feature: a file naming API 2.1 is refused with the API reason and not installed', async () => {
        const list = installDb([])
        h.confirm.mockResolvedValueOnce(true)
        picked(file('old.js', '//@name Old\n//@api 2.1\n'), file('ok.js', source('Ok')))
        await importPlugin()
        expect(reviewText()).toContain('old.js: Your plugin specifies API version 2.1')
        expect(list.map((p) => p.name)).toEqual(['Ok'])
    })

    test('feature: each review section is capped at 15 lines and then says how many more', async () => {
        installDb([])
        h.confirm.mockResolvedValueOnce(false)
        picked(...Array.from({ length: 18 }, (_, i) => file(`p${i}.js`, source(`P${i}`))))
        await importPlugin()
        const text = reviewText()
        expect(text).toContain('p14.js')
        expect(text).not.toContain('p15.js')
        expect(text).toContain(language.pluginBatchMore(3))
    })

    test('feature: plugins without a name and the list order survive, and a plugin removed during the review is added again', async () => {
        const unnamed = { script: 'u' } as unknown as RisuPlugin
        const list = installDb([unnamed, installed('A'), installed('B')])
        let release: (answer: boolean) => void = () => {}
        h.confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve }))
        picked(file('b.js', source('B')), file('n.js', source('N', ARG)))
        const done = importPlugin()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
        list.splice(2, 1)
        list.push(installed('N', 'kept', { enabled: false }))
        release(true)
        await done
        expect(list[0]).toBe(unnamed)
        expect(list.map((p) => p?.name)).toEqual([undefined, 'A', 'N', 'B'])
        const n = list.filter((p) => p?.name === 'N')
        expect(n).toHaveLength(1)
        expect(n[0].realArg).toEqual({ key: 'kept' })
        expect(n[0].enabled).toBe(false)
        expect(h.setDatabaseLite).toHaveBeenCalledTimes(1)
    })
})
