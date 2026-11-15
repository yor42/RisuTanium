import { describe, expect, test, vi } from 'vitest'
import type { RisuPlugin } from './plugins.svelte'
import {
    checkPluginUpdates,
    PLUGIN_UPDATE_CHECK_KEY,
    pluginUpdateVersion,
    probePluginUpdate,
    readUpdateRecord,
    runPluginUpdateCheck,
    shouldAutoCheck,
    summarizeUpdateRecord,
    writeUpdateRecord,
    type UpdateFetcher,
    type UpdateRecord,
    type UpdateRecordStorage,
} from './pluginUpdateCheck'

const HOUR = 60 * 60 * 1000

/** The start of a real plugin file: the header block comes first, then code the range request cuts off. */
function pluginFileHead(version: string): string {
    return [
        '//@name Sample',
        '//@display-name Sample Plugin',
        '//@api 3.0',
        `//@version ${version}`,
        '//@update-url https://example.invalid/sample.js',
        '',
        'Risuai.log("hello")',
    ].join('\n')
}

function respond(status: number, body: string): ReturnType<UpdateFetcher> {
    return Promise.resolve({ status, text: async () => body })
}

function plugin(name: string, over: Partial<RisuPlugin> = {}): RisuPlugin {
    return { name, script: '', version: '3.0', arguments: {}, realArg: {}, customLink: [], argMeta: {}, versionOfPlugin: '1.0.0', updateURL: `https://example.invalid/${name}.js`, ...over }
}

function mapStorage(): UpdateRecordStorage & { map: Map<string, string> } {
    const map = new Map<string, string>()
    return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) } }
}

describe('probePluginUpdate', () => {
    test('a newer header version is an update; an equal or older one is current', async () => {
        const p = plugin('a', { versionOfPlugin: '1.2.0' })
        expect(await probePluginUpdate(p, () => respond(200, pluginFileHead('1.3.0')))).toEqual({ kind: 'update', version: '1.3.0' })
        expect(await probePluginUpdate(p, () => respond(200, pluginFileHead('1.2.0')))).toEqual({ kind: 'current' })
        expect(await probePluginUpdate(p, () => respond(200, pluginFileHead('1.1.9')))).toEqual({ kind: 'current' })
    })

    test('a non-2xx answer, a throw and a header without a version are failures', async () => {
        const p = plugin('a')
        expect(await probePluginUpdate(p, () => respond(404, pluginFileHead('9.0.0')))).toEqual({ kind: 'failed' })
        expect(await probePluginUpdate(p, () => Promise.reject(new Error('offline')))).toEqual({ kind: 'failed' })
        expect(await probePluginUpdate(p, () => respond(200, '//@name Sample\n//@api 3.0\n'))).toEqual({ kind: 'failed' })
    })

    test('the request is a ranged GET to the update address', async () => {
        const fetcher = vi.fn<UpdateFetcher>(() => respond(206, pluginFileHead('1.0.0')))
        await probePluginUpdate(plugin('a'), fetcher)
        expect(fetcher).toHaveBeenCalledWith('https://example.invalid/a.js', { method: 'GET', headers: { Range: 'bytes=0-512' } })
    })

    test('a plugin without an update address is never fetched', async () => {
        const fetcher = vi.fn<UpdateFetcher>()
        await probePluginUpdate(plugin('a', { updateURL: undefined }), fetcher)
        expect(fetcher).not.toHaveBeenCalled()
    })
})

describe('checkPluginUpdates', () => {
    test('probes only entries with an update address, once each, and stamps the time', async () => {
        const fetcher = vi.fn<UpdateFetcher>(() => respond(200, pluginFileHead('2.0.0')))
        const list = [plugin('a'), plugin('b', { updateURL: undefined }), plugin('c', { version: '2.1', displayName: 'Old C' })]
        const record = await checkPluginUpdates(list, { fetcher, now: () => 1234 })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(record.checkedAt).toBe(1234)
        expect(record.outcomes.map((o) => [o.name, o.label, o.kind])).toEqual([['a', 'a', 'update'], ['c', 'Old C', 'update']])
    })

    test('the plugin list is left byte-equal', async () => {
        const list = [plugin('a'), plugin('c', { version: '2.1', enabled: true })]
        const before = JSON.stringify(list)
        await checkPluginUpdates(list, { fetcher: () => respond(200, pluginFileHead('2.0.0')), now: () => 1 })
        expect(JSON.stringify(list)).toBe(before)
    })
})

describe('shouldAutoCheck', () => {
    const record = (checkedAt: number): UpdateRecord => ({ checkedAt, outcomes: [] })

    test('no record checks; under 24 hours does not; 24 hours does; a future time counts as stale', () => {
        const now = 100 * HOUR
        expect(shouldAutoCheck(null, now)).toBe(true)
        expect(shouldAutoCheck(record(now - 23 * HOUR), now)).toBe(false)
        expect(shouldAutoCheck(record(now - 24 * HOUR), now)).toBe(true)
        expect(shouldAutoCheck(record(now + HOUR), now)).toBe(true)
    })
})

describe('the stored record', () => {
    const record: UpdateRecord = { checkedAt: 5, outcomes: [{ name: 'a', label: 'A', kind: 'update', version: '2.0.0' }, { name: 'b', label: 'B', kind: 'failed' }] }

    test('a written record reads back', () => {
        const storage = mapStorage()
        writeUpdateRecord(storage, record)
        expect(storage.map.has(PLUGIN_UPDATE_CHECK_KEY)).toBe(true)
        expect(readUpdateRecord(storage)).toEqual(record)
    })

    test('corrupt data of every shape reads as no record without throwing', () => {
        for (const text of ['{', 'null', '[]', '{"checkedAt":"x","outcomes":[]}', '{"checkedAt":1,"outcomes":{}}', '{"checkedAt":1,"outcomes":[{"name":"a"}]}', '{"checkedAt":1,"outcomes":[{"name":"a","label":"A","kind":"update"}]}']) {
            const storage = mapStorage()
            storage.map.set(PLUGIN_UPDATE_CHECK_KEY, text)
            expect(readUpdateRecord(storage)).toBeNull()
        }
    })

    test('a storage that throws reads as no record and a refused write is swallowed', () => {
        const broken: UpdateRecordStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }
        expect(readUpdateRecord(broken)).toBeNull()
        expect(() => writeUpdateRecord(broken, record)).not.toThrow()
    })
})

describe('summarizeUpdateRecord', () => {
    const record: UpdateRecord = {
        checkedAt: 1,
        outcomes: [
            { name: 'up', label: 'Up', kind: 'update', version: '2.0.0' },
            { name: 'bad', label: 'Bad', kind: 'failed' },
            { name: 'ok', label: 'Ok', kind: 'current' },
            { name: 'gone', label: 'Gone', kind: 'failed' },
        ],
    }

    test('names the failures by display name, counts updates and drops removed plugins', () => {
        const installed = [plugin('up'), plugin('bad', { displayName: 'Bad Plugin' }), plugin('ok')]
        expect(summarizeUpdateRecord(record, installed)).toEqual({ failed: ['Bad Plugin'], updates: 1, allCurrent: false })
    })

    test('all-current shows only when something was checked and nothing failed or is newer', () => {
        expect(summarizeUpdateRecord(record, [plugin('ok')]).allCurrent).toBe(true)
        expect(summarizeUpdateRecord(record, [plugin('ok'), plugin('bad')]).allCurrent).toBe(false)
        expect(summarizeUpdateRecord(record, [plugin('ok'), plugin('up')]).allCurrent).toBe(false)
        expect(summarizeUpdateRecord(record, []).allCurrent).toBe(false)
        expect(summarizeUpdateRecord(null, [plugin('ok')])).toEqual({ failed: [], updates: 0, allCurrent: false })
    })

    test('an update stops counting once the installed version has caught up', () => {
        const installed = [plugin('up', { versionOfPlugin: '2.0.0' })]
        expect(summarizeUpdateRecord(record, installed)).toEqual({ failed: [], updates: 0, allCurrent: true })
        expect(pluginUpdateVersion(record, installed[0])).toBeNull()
        expect(pluginUpdateVersion(record, plugin('up', { versionOfPlugin: '1.0.0' }))).toBe('2.0.0')
    })
})

describe('runPluginUpdateCheck', () => {
    test('two runs that overlap share one fetch per address and the record is stored', async () => {
        const storage = mapStorage()
        const fetcher = vi.fn<UpdateFetcher>(() => respond(200, pluginFileHead('1.0.0')))
        const list = [plugin('a'), plugin('b')]
        const deps = { fetcher, now: () => 9, storage }
        const [first, second] = await Promise.all([runPluginUpdateCheck(list, deps), runPluginUpdateCheck(list, deps)])
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(second).toBe(first)
        expect(readUpdateRecord(storage)?.checkedAt).toBe(9)
        await runPluginUpdateCheck(list, deps)
        expect(fetcher).toHaveBeenCalledTimes(4)
    })
})
