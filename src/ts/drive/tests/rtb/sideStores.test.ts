import { describe, test, expect } from 'vitest'
import { SIDE_SECTION_IDS, type SideSectionId } from 'src/ts/drive/rtb/entryNames'
import { getPluginPermissionKey } from 'src/ts/plugins/apiV3/pluginPermissionCache'
import { parseManifest } from 'src/ts/drive/rtb/manifest'
import { writeRtb, type SideInput, type SideRecord } from 'src/ts/drive/rtb/rtbWriter'
import { parseSectionTable, type SectionRow } from 'src/ts/drive/rtb/sections'
import { decideSideSection, decideSideSections, type SideAction } from 'src/ts/drive/rtb/sideDecision'
import { encodeSideLine } from 'src/ts/drive/rtb/sideLines'
import { SideLineSplitter } from 'src/ts/drive/rtb/sideStream'
import {
    GOOGLE_SEARCH_STORE,
    HYPA_VECTOR_STORE,
    IRIS_STORE,
    MCP_TOOL_CALLS_STORE,
    PLUGIN_PERMISSIONS_STORE,
    PLUGIN_SAFE_STORE,
    UI_PREFS_KEYS,
    type ForageStoreConfig,
} from 'src/ts/drive/rtb/sideStoreConfig'
import {
    applySideAction,
    readSideStore,
    readSideStores,
    RtbSideReadError,
    sideResultIsNamed,
    type SideBackends,
    type SideBodyReader,
    type SideRestoreResult,
} from 'src/ts/drive/rtb/sideStores'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// The shapes v3 writes: `${scriptHash}_${permission}` and `${pluginName}_${permission}_lastGrantTime`.
const GRANT_KEY = getPluginPermissionKey('3f2a9c', 'mainDom')
const LAST_GRANT_KEY = 'MyPlugin_mainDom_lastGrantTime'

// ---------------------------------------------------------------- fakes

class FakeForage {
    data = new Map<string, unknown>()
    clearCalls = 0
    setCalls = 0
    failKeys = false
    failClear = false
    failSetAt = 0
    failGet = new Set<string>()
    onGet: ((key: string) => void) | null = null

    async ready(): Promise<void> {}

    async keys(): Promise<string[]> {
        if (this.failKeys) {
            throw new Error('keys failed')
        }
        return [...this.data.keys()]
    }

    async getItem(key: string): Promise<unknown> {
        this.onGet?.(key)
        if (this.failGet.has(key)) {
            throw new Error('get failed')
        }
        return this.data.has(key) ? this.data.get(key) : null
    }

    async setItem(key: string, value: unknown): Promise<unknown> {
        this.setCalls++
        if (this.failSetAt === this.setCalls) {
            throw new Error('set failed')
        }
        this.data.set(key, value)
        return value
    }

    async clear(): Promise<void> {
        this.clearCalls++
        if (this.failClear) {
            throw new Error('clear failed')
        }
        this.data.clear()
    }
}

class FakeStorage {
    data = new Map<string, string>()
    removeCalls = 0
    removeFailAt = 0
    failEnumerate = false

    get length(): number {
        if (this.failEnumerate) {
            throw new Error('enumerate failed')
        }
        return this.data.size
    }

    key(index: number): string | null {
        return [...this.data.keys()][index] ?? null
    }

    getItem(key: string): string | null {
        return this.data.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.data.set(key, value)
    }

    removeItem(key: string): void {
        this.removeCalls++
        if (this.removeFailAt === this.removeCalls) {
            throw new Error('remove failed')
        }
        this.data.delete(key)
    }
}

interface Fakes {
    backends: SideBackends
    storage: FakeStorage
    forage(config: ForageStoreConfig): FakeForage
    configs: ForageStoreConfig[]
}

function makeFakes(): Fakes {
    const forages = new Map<string, FakeForage>()
    const storage = new FakeStorage()
    const configs: ForageStoreConfig[] = []
    const forage = (config: ForageStoreConfig): FakeForage => {
        const name = `${config.name}/${config.storeName ?? 'keyvaluepairs'}`
        let found = forages.get(name)
        if (found === undefined) {
            found = new FakeForage()
            forages.set(name, found)
        }
        return found
    }
    return {
        storage,
        configs,
        forage,
        backends: {
            forage: (config) => {
                configs.push(config)
                return forage(config) as unknown as LocalForage
            },
            local: () => storage as unknown as Storage,
        },
    }
}

const FORAGE_STORES: readonly { id: SideSectionId, config: ForageStoreConfig }[] = [
    { id: 'side.iris', config: IRIS_STORE },
    { id: 'side.google-search', config: GOOGLE_SEARCH_STORE },
    { id: 'side.hypa-vector', config: HYPA_VECTOR_STORE },
    { id: 'side.plugin-safe', config: PLUGIN_SAFE_STORE },
    { id: 'side.mcp-tool-calls', config: MCP_TOOL_CALLS_STORE },
]

// ---------------------------------------------------------------- helpers

function sectionText(records: readonly (readonly [string, unknown])[]): string {
    return records.map(([key, value]) => decoder.decode(encodeSideLine(key, value, RTB_SIDE_TAGS))).join('')
}

/** A reader that hands `text` to the sink in chunks of `step` bytes. */
function readerOf(text: string, step = 7): SideBodyReader {
    const bytes = encoder.encode(text)
    return async (sink) => {
        for (let at = 0; at < bytes.length; at += step) {
            await sink(bytes.slice(at, at + step))
        }
        return { ok: true }
    }
}

function row(id: SideSectionId): SectionRow {
    return { id, v: 1, required: false, prefix: `s/${id.slice(5)}/`, entries: 1, bytes: 0, meta: null }
}

function restore(id: SideSectionId): SideAction {
    return { kind: 'restore', id, row: row(id) }
}

async function collect(input: SideInput): Promise<SideRecord[]> {
    if ('unreadable' in input) {
        throw new Error('unreadable')
    }
    const out: SideRecord[] = []
    for await (const record of input.records) {
        out.push(record)
    }
    return out
}

function snapshot(fakes: Fakes, config: ForageStoreConfig): Map<string, unknown> {
    return new Map(fakes.forage(config).data)
}

// ---------------------------------------------------------------- reading

describe('reading the stores (T7, R)', () => {
    test('records come sorted with equal values', async () => {
        const fakes = makeFakes()
        const iris = fakes.forage(IRIS_STORE)
        iris.data.set('b', [{ speaker: 'a', text: 't', tip: undefined }])
        iris.data.set('a', { x: 1 })
        const records = await collect(await readSideStore('side.iris', fakes.backends))
        expect(records.map((r) => r.key)).toEqual(['a', 'b'])
        expect(records[0].value).toEqual({ x: 1 })
        expect(records[1].value).toStrictEqual([{ speaker: 'a', text: 't', tip: undefined }])
    })

    test('a failing key list makes the store unreadable', async () => {
        const fakes = makeFakes()
        fakes.forage(IRIS_STORE).failKeys = true
        expect(await readSideStore('side.iris', fakes.backends)).toEqual({ unreadable: true })
        fakes.storage.failEnumerate = true
        expect(await readSideStore('side.ui-prefs', fakes.backends)).toEqual({ unreadable: true })
        expect(await readSideStore('side.plugin-safe-ls', fakes.backends)).toEqual({ unreadable: true })
    })

    test('a value that cannot be read fails the export and names the store and key', async () => {
        const fakes = makeFakes()
        const iris = fakes.forage(IRIS_STORE)
        iris.data.set('a', 1)
        iris.data.set('b', 2)
        iris.failGet.add('b')
        const input = await readSideStore('side.iris', fakes.backends)
        const caught = await collect(input).catch((error: unknown) => error)
        expect(caught).toBeInstanceOf(RtbSideReadError)
        expect((caught as RtbSideReadError).id).toBe('side.iris')
        expect((caught as RtbSideReadError).key).toBe('b')
    })

    test('a key deleted after the key list was taken is absent from the records', async () => {
        const fakes = makeFakes()
        const iris = fakes.forage(IRIS_STORE)
        iris.data.set('a', 1)
        iris.data.set('b', 2)
        iris.onGet = (key) => {
            if (key === 'a') {
                iris.data.delete('b')
            }
        }
        const records = await collect(await readSideStore('side.iris', fakes.backends))
        expect(records.map((r) => r.key)).toEqual(['a'])
    })

    test('plugin-safe-ls carries the suffix of prefixed keys and ui-prefs only its allowlist', async () => {
        const fakes = makeFakes()
        fakes.storage.data.set('safe_plugin_b', '2')
        fakes.storage.data.set('safe_plugin_a', '1')
        fakes.storage.data.set('other', 'x')
        fakes.storage.data.set('risuChatShell.reducedMotion', 'true')
        fakes.storage.data.set('risuChatShell.reduceCardEffects', 'true')
        fakes.storage.data.set('risuChatShell.lowPower', 'true')
        fakes.storage.data.set('risuauth', 'secret')
        expect(await collect(await readSideStore('side.plugin-safe-ls', fakes.backends))).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])
        expect(await collect(await readSideStore('side.ui-prefs', fakes.backends))).toEqual([
            { key: 'risuChatShell.reduceCardEffects', value: 'true' },
            { key: 'risuChatShell.reducedMotion', value: 'true' },
        ])
    })

    test('permissions are exported as plain records', async () => {
        const fakes = makeFakes()
        const grants = fakes.forage(PLUGIN_PERMISSIONS_STORE)
        grants.data.set(GRANT_KEY, true)
        grants.data.set(LAST_GRANT_KEY, 1700000000000)
        expect(await collect(await readSideStore('side.plugin-permissions', fakes.backends))).toEqual([
            { key: GRANT_KEY, value: true },
            { key: LAST_GRANT_KEY, value: 1700000000000 },
        ])
    })
})

// ---------------------------------------------------------------- splitter

describe('the line splitter over chunk boundaries (T16, guard)', () => {
    test('chunking, CRLF and blank lines give the same lines; blank lines keep their numbers', () => {
        const text = `${sectionText([['a', 'é€😀'], ['b', 2]])}\r\n\n${sectionText([['c', 3]]).replace('\n', '\r\n')}`
        const whole = new SideLineSplitter(RTB_SIDE_TAGS)
        const expected = [...whole.push(encoder.encode(text)), ...whole.end()]
        expect(expected.map((l) => l.decoded.kind)).toEqual(['value', 'value', 'value'])
        expect(expected.map((l) => l.line)).toEqual([1, 2, 5])
        for (const step of [1, 2, 3, 5, 11]) {
            const split = new SideLineSplitter(RTB_SIDE_TAGS)
            const bytes = encoder.encode(text)
            const got = []
            for (let at = 0; at < bytes.length; at += step) {
                got.push(...split.push(bytes.slice(at, at + step)))
            }
            got.push(...split.end())
            expect(got).toEqual(expected)
        }
    })

    test('invalid UTF-8 is damaged at its line', () => {
        const split = new SideLineSplitter(RTB_SIDE_TAGS)
        const bytes = new Uint8Array([...encoder.encode('{"k":"a","j":1}\n'), 0xff, 0xfe, 0x0a])
        const lines = [...split.push(bytes), ...split.end()]
        expect(lines.map((l) => [l.line, l.decoded.kind])).toEqual([[1, 'value'], [2, 'damaged']])
    })
})

// ---------------------------------------------------------------- restoring

describe('restoring the localforage stores (T8, R)', () => {
    for (const { id, config } of FORAGE_STORES) {
        test(`${id}: old keys are gone and exactly the file's keys remain; an unknown tag is skipped and named`, async () => {
            const fakes = makeFakes()
            const store = fakes.forage(config)
            store.data.set('old', 'gone')
            const text = `${sectionText([['a', { n: 1 }], ['b', new Float32Array([1, 2])]])}{"k":"z","t":"zz9","b":"AA=="}\n`
            const result = await applySideAction(restore(id), readerOf(text), fakes.backends)
            expect(result).toEqual({ id, status: 'ok', written: 2, skipped: [{ key: 'z', why: 'unknown-tag', tag: 'zz9' }] })
            expect([...store.data.keys()].sort()).toEqual(['a', 'b'])
            expect(store.data.get('a')).toEqual({ n: 1 })
            expect(store.data.get('b')).toStrictEqual(new Float32Array([1, 2]))
            expect(sideResultIsNamed(result)).toBe(true)
        })
    }

    test('one backend instance serves the clear and every write of a section', async () => {
        for (const { id, config } of FORAGE_STORES) {
            const fakes = makeFakes()
            const records = Array.from({ length: 25 }, (_, i): [string, unknown] => [`key-${i}`, i])
            const result = await applySideAction(restore(id), readerOf(sectionText(records)), fakes.backends)
            expect(result).toMatchObject({ status: 'ok', written: 25 })
            expect(fakes.configs).toEqual([config])
        }
        const clearOnly = makeFakes()
        await applySideAction({ kind: 'clear', id: 'side.iris', status: 'absent' }, null, clearOnly.backends)
        expect(clearOnly.configs).toHaveLength(1)
    })

    test('reading a store creates one backend instance', async () => {
        const fakes = makeFakes()
        for (let i = 0; i < 10; i++) {
            fakes.forage(IRIS_STORE).data.set(`k${i}`, i)
        }
        expect(await collect(await readSideStore('side.iris', fakes.backends))).toHaveLength(10)
        expect(fakes.configs).toHaveLength(1)
    })

    test('the last of a duplicate key wins', async () => {
        const fakes = makeFakes()
        const result = await applySideAction(restore('side.iris'), readerOf(sectionText([['a', 1], ['a', 2]])), fakes.backends)
        expect(result).toMatchObject({ status: 'ok', written: 2 })
        expect(fakes.forage(IRIS_STORE).data.get('a')).toBe(2)
    })

    test('a present, empty section clears the store and writes nothing', async () => {
        const fakes = makeFakes()
        fakes.forage(IRIS_STORE).data.set('old', 1)
        const result = await applySideAction(restore('side.iris'), null, fakes.backends)
        expect(result).toEqual({ id: 'side.iris', status: 'ok', written: 0, skipped: [] })
        expect(fakes.forage(IRIS_STORE).data.size).toBe(0)
        expect(sideResultIsNamed(result)).toBe(false)
    })
})

describe('a failure in pass 1 leaves the store alone (T9, R)', () => {
    test('a line that is not JSON names the section and the line', async () => {
        const fakes = makeFakes()
        const store = fakes.forage(IRIS_STORE)
        store.data.set('old', 'kept')
        const before = snapshot(fakes, IRIS_STORE)
        const text = `${sectionText([['a', 1], ['b', 2]])}not json\n${sectionText([['c', 3]])}`
        const result = await applySideAction(restore('side.iris'), readerOf(text), fakes.backends)
        expect(result).toMatchObject({ id: 'side.iris', status: 'malformed', line: 3, conflict: false })
        expect(snapshot(fakes, IRIS_STORE)).toEqual(before)
        expect(store.clearCalls).toBe(0)
        expect(store.setCalls).toBe(0)
        expect(sideResultIsNamed(result)).toBe(true)
    })

    test('a failed entry read in pass 1 is malformed, the store is untouched', async () => {
        const fakes = makeFakes()
        const store = fakes.forage(IRIS_STORE)
        store.data.set('old', 'kept')
        const body: SideBodyReader = async (sink) => {
            await sink(encoder.encode(sectionText([['a', 1]])))
            return { ok: false, reason: 'crc mismatch' }
        }
        const result = await applySideAction(restore('side.iris'), body, fakes.backends)
        expect(result).toMatchObject({ status: 'malformed', line: null })
        expect(store.clearCalls).toBe(0)
        expect([...store.data.keys()]).toEqual(['old'])
    })

    test('a read that throws is malformed and untouched', async () => {
        const fakes = makeFakes()
        const store = fakes.forage(IRIS_STORE)
        const body: SideBodyReader = async () => {
            throw new Error('source failed')
        }
        const result = await applySideAction(restore('side.iris'), body, fakes.backends)
        expect(result).toMatchObject({ status: 'malformed' })
        expect(store.clearCalls).toBe(0)
    })

    test('a damaged line aborts the entry read promptly and is not reported as a read failure', async () => {
        const fakes = makeFakes()
        let chunksOffered = 0
        let sinkRejected = false
        const body: SideBodyReader = async (sink) => {
            const first = encoder.encode('not json\n')
            for (let i = 0; i < 1000; i++) {
                chunksOffered++
                try {
                    await sink(i === 0 ? first : encoder.encode('{"k":"a","j":1}\n'))
                } catch (error) {
                    sinkRejected = true
                    throw error
                }
            }
            return { ok: true }
        }
        const result = await applySideAction(restore('side.iris'), body, fakes.backends)
        expect(sinkRejected).toBe(true)
        expect(chunksOffered).toBe(1)
        expect(result).toMatchObject({ status: 'malformed', line: 1, reason: expect.not.stringContaining('could not be read') })
    })

    test('a reader that swallows the abort and reports a CRC failure still yields the named line', async () => {
        const fakes = makeFakes()
        const body: SideBodyReader = async (sink) => {
            try {
                await sink(encoder.encode('not json\n'))
            } catch {
                return { ok: false, reason: 'crc' }
            }
            return { ok: true }
        }
        const result = await applySideAction(restore('side.iris'), body, fakes.backends)
        expect(result).toMatchObject({ status: 'malformed', line: 1 })
        expect((result as { reason: string }).reason).not.toContain('crc')
    })
})

describe('store failures (T10, guard)', () => {
    test('a write that fails reports the phase, the count and the key', async () => {
        const fakes = makeFakes()
        fakes.forage(IRIS_STORE).failSetAt = 2
        const result = await applySideAction(restore('side.iris'), readerOf(sectionText([['a', 1], ['b', 2], ['c', 3]])), fakes.backends)
        expect(result).toMatchObject({ status: 'write-failed', phase: 'write', written: 1, key: 'b', message: 'set failed' })
        expect([...fakes.forage(IRIS_STORE).data.keys()]).toEqual(['a'])
    })

    test('a clear that fails leaves a one-operation store unchanged', async () => {
        const fakes = makeFakes()
        const store = fakes.forage(IRIS_STORE)
        store.data.set('old', 1)
        store.failClear = true
        const result = await applySideAction(restore('side.iris'), readerOf(sectionText([['a', 1]])), fakes.backends)
        expect(result).toMatchObject({ status: 'write-failed', phase: 'clear', written: 0, key: null })
        expect([...store.data.keys()]).toEqual(['old'])
    })

    test('a key-by-key clear that fails part way may have removed some keys', async () => {
        const fakes = makeFakes()
        fakes.storage.data.set('safe_plugin_a', '1')
        fakes.storage.data.set('safe_plugin_b', '2')
        fakes.storage.data.set('safe_plugin_c', '3')
        fakes.storage.removeFailAt = 2
        const result = await applySideAction(restore('side.plugin-safe-ls'), readerOf(sectionText([['x', 'y']])), fakes.backends)
        expect(result).toMatchObject({ status: 'write-failed', phase: 'clear', written: 0, key: null })
        expect([...fakes.storage.data.keys()]).toEqual(['safe_plugin_b', 'safe_plugin_c'])
        expect(fakes.storage.data.has('safe_plugin_x')).toBe(false)
    })
})

describe('plugin-safe-ls (T11, guard)', () => {
    test('suffixes are written under the prefix; other prefixed keys go, an unrelated key stays', async () => {
        const fakes = makeFakes()
        fakes.storage.data.set('safe_plugin_old', 'x')
        fakes.storage.data.set('foo', 'keep')
        const result = await applySideAction(restore('side.plugin-safe-ls'), readerOf(sectionText([['a', '1'], ['b', '2']])), fakes.backends)
        expect(result).toMatchObject({ status: 'ok', written: 2 })
        expect([...fakes.storage.data.entries()].sort()).toEqual([['foo', 'keep'], ['safe_plugin_a', '1'], ['safe_plugin_b', '2']])
    })

    test('a non-string value is malformed and the store is untouched', async () => {
        const fakes = makeFakes()
        fakes.storage.data.set('safe_plugin_old', 'x')
        const result = await applySideAction(restore('side.plugin-safe-ls'), readerOf(sectionText([['a', '1'], ['b', 5]])), fakes.backends)
        expect(result).toMatchObject({ status: 'malformed', line: 2 })
        expect([...fakes.storage.data.entries()]).toEqual([['safe_plugin_old', 'x']])
        expect(fakes.storage.removeCalls).toBe(0)
    })
})

describe('ui-prefs (T12, R)', () => {
    test('only allowlisted keys are written; others are skipped and named; missing ones are removed', async () => {
        const fakes = makeFakes()
        fakes.storage.data.set('risutanium.grid.sort', 'old')
        fakes.storage.data.set('risuSettings.lastPage', 'old')
        fakes.storage.data.set('risuauth', 'device-secret')
        fakes.storage.data.set('unrelated', 'stays')
        const text = sectionText([
            ['risutanium.grid.sort', 'name'],
            ['risuauth', 'from-file'],
            ['upstreamServicesAgreement', 'yes'],
            ['risuChatShell.lowPower', 'true'],
            ['risuChatShell.reducedMotion', 'true'],
            ['risuChatShell.reduceCardEffects', 'false'],
        ])
        const result = await applySideAction(restore('side.ui-prefs'), readerOf(text), fakes.backends)
        expect(result).toMatchObject({ status: 'ok', written: 3 })
        expect((result as Extract<SideRestoreResult, { status: 'ok' }>).skipped.map((s) => s.key)).toEqual(['risuauth', 'upstreamServicesAgreement', 'risuChatShell.lowPower'])
        expect(Object.fromEntries(fakes.storage.data)).toEqual({
            'risutanium.grid.sort': 'name',
            'risuauth': 'device-secret',
            'unrelated': 'stays',
            'risuChatShell.reducedMotion': 'true',
            'risuChatShell.reduceCardEffects': 'false',
        })
    })

    test('the allowlist holds both motion keys and none of the excluded classes', () => {
        expect(UI_PREFS_KEYS).toContain('risuChatShell.reducedMotion')
        expect(UI_PREFS_KEYS).toContain('risuChatShell.reduceCardEffects')
        for (const key of ['risuChatShell.lowPower', 'risuauth', 'accountst', 'upstreamServicesAgreement', 'risu-asset-read-token', 'risutanium.character.last']) {
            expect(UI_PREFS_KEYS).not.toContain(key)
        }
    })
})

describe('plugin permissions (T13, guard)', () => {
    const cases: [string, SideBodyReader | null][] = [
        ['grants present with a valid body', readerOf(sectionText([[GRANT_KEY, true]]))],
        ['a damaged line', readerOf('not json\n')],
        ['a failed entry read', async (sink) => {
            await sink(encoder.encode(sectionText([[GRANT_KEY, true]])))
            return { ok: false, reason: 'crc' }
        }],
        ['a read that throws', async () => {
            throw new Error('boom')
        }],
        ['an empty section', null],
    ]
    for (const [label, body] of cases) {
        test(`clears and writes nothing: ${label}`, async () => {
            const fakes = makeFakes()
            const store = fakes.forage(PLUGIN_PERMISSIONS_STORE)
            store.data.set(getPluginPermissionKey('old-hash', 'db'), true)
            store.data.set(LAST_GRANT_KEY, 5)
            const result = await applySideAction(restore('side.plugin-permissions'), body, fakes.backends)
            expect(result).toEqual({ id: 'side.plugin-permissions', status: 'ok', written: 0, skipped: [] })
            expect(store.data.size).toBe(0)
            expect(store.setCalls).toBe(0)
            expect(store.clearCalls).toBe(1)
        })
    }

    test('omitted or in conflict, the grants are still cleared and the result names it (MC-2047, R)', async () => {
        const seed = (): Fakes => {
            const fakes = makeFakes()
            fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set(GRANT_KEY, true)
            fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set(LAST_GRANT_KEY, 5)
            return fakes
        }
        const omitted = seed()
        const omittedAction = decideSideSection('side.plugin-permissions', [], [{ kind: 'side', name: 'side.plugin-permissions', reason: 'unreadable' }])
        expect(await applySideAction(omittedAction, null, omitted.backends)).toEqual({ id: 'side.plugin-permissions', status: 'omitted', reason: 'unreadable' })
        expect(omitted.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(0)

        const conflict = seed()
        const conflictAction = decideSideSection('side.plugin-permissions', [row('side.plugin-permissions')], [{ kind: 'side', name: 'side.plugin-permissions', reason: 'unreadable' }])
        expect(await applySideAction(conflictAction, readerOf(''), conflict.backends)).toMatchObject({ id: 'side.plugin-permissions', status: 'malformed', conflict: true })
        expect(conflict.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(0)

        const failing = seed()
        failing.forage(PLUGIN_PERMISSIONS_STORE).failClear = true
        expect(await applySideAction(omittedAction, null, failing.backends)).toMatchObject({ status: 'write-failed', phase: 'clear' })
        expect(failing.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(2)
    })

    test('every other section keeps leave: an omitted store is untouched', async () => {
        const fakes = makeFakes()
        fakes.forage(IRIS_STORE).data.set('mine', 1)
        const action = decideSideSection('side.iris', [], [{ kind: 'side', name: 'side.iris', reason: 'unreadable' }])
        await applySideAction(action, null, fakes.backends)
        expect(fakes.forage(IRIS_STORE).clearCalls).toBe(0)
        expect(fakes.forage(IRIS_STORE).data.size).toBe(1)
    })

    test('a failed clear is write-failed in the clear phase and the store is unchanged', async () => {
        const fakes = makeFakes()
        const store = fakes.forage(PLUGIN_PERMISSIONS_STORE)
        store.data.set(GRANT_KEY, true)
        store.failClear = true
        const result = await applySideAction(restore('side.plugin-permissions'), null, fakes.backends)
        expect(result).toMatchObject({ status: 'write-failed', phase: 'clear' })
        expect(store.data.size).toBe(1)
    })
})

describe('clear actions stay inside their store (T17, R)', () => {
    test('absent and newer clear each store and nothing else', async () => {
        for (const status of ['absent', 'newer'] as const) {
            for (const id of SIDE_SECTION_IDS as readonly SideSectionId[]) {
                const fakes = makeFakes()
                for (const { config } of FORAGE_STORES) {
                    fakes.forage(config).data.set('k', 1)
                }
                fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set('k', 1)
                fakes.storage.data.set('safe_plugin_a', '1')
                fakes.storage.data.set('risutanium.grid.sort', 'x')
                fakes.storage.data.set('unrelated', 'u')
                const action: SideAction = status === 'absent' ? { kind: 'clear', id, status } : { kind: 'clear', id, status, v: 2 }
                const result = await applySideAction(action, null, fakes.backends)
                expect(result).toEqual(status === 'absent' ? { id, status } : { id, status, v: 2 })
                const stores: Record<string, ForageStoreConfig> = Object.fromEntries([...FORAGE_STORES.map((s) => [s.id, s.config]), ['side.plugin-permissions', PLUGIN_PERMISSIONS_STORE]])
                for (const [otherId, config] of Object.entries(stores)) {
                    expect(fakes.forage(config).data.size).toBe(otherId === id ? 0 : 1)
                }
                expect(fakes.storage.data.has('safe_plugin_a')).toBe(id !== 'side.plugin-safe-ls')
                expect(fakes.storage.data.has('risutanium.grid.sort')).toBe(id !== 'side.ui-prefs')
                expect(fakes.storage.data.get('unrelated')).toBe('u')
            }
        }
    })

    test('plugin-safe omitted leaves its store while plugin-safe-ls is restored', async () => {
        const fakes = makeFakes()
        fakes.forage(PLUGIN_SAFE_STORE).data.set('safe_plugin_k', 'keep')
        const actions = decideSideSections([row('side.plugin-safe-ls')], [{ kind: 'side', name: 'side.plugin-safe', reason: 'unreadable' }])
        const safe = actions.find((a) => a.id === 'side.plugin-safe') as SideAction
        const ls = actions.find((a) => a.id === 'side.plugin-safe-ls') as SideAction
        expect(await applySideAction(safe, null, fakes.backends)).toEqual({ id: 'side.plugin-safe', status: 'omitted', reason: 'unreadable' })
        expect(await applySideAction(ls, readerOf(sectionText([['x', 'y']])), fakes.backends)).toMatchObject({ status: 'ok', written: 1 })
        expect(fakes.forage(PLUGIN_SAFE_STORE).data.get('safe_plugin_k')).toBe('keep')
        expect(fakes.storage.data.get('safe_plugin_x')).toBe('y')
    })

    test('a conflict leaves the store alone and is named as malformed', async () => {
        const fakes = makeFakes()
        fakes.forage(IRIS_STORE).data.set('old', 1)
        const action = decideSideSection('side.iris', [row('side.iris')], [{ kind: 'side', name: 'side.iris', reason: 'unreadable' }])
        const result = await applySideAction(action, readerOf(sectionText([['a', 1]])), fakes.backends)
        expect(result).toMatchObject({ status: 'malformed', conflict: true, line: null })
        expect(fakes.forage(IRIS_STORE).clearCalls).toBe(0)
        expect([...fakes.forage(IRIS_STORE).data.keys()]).toEqual(['old'])
    })
})

describe('a failure in pass 2 changes the store and is named (T27, R)', () => {
    function twoPhase(first: string, second: string, tail?: { ok: false, reason: string }): SideBodyReader {
        let call = 0
        return async (sink) => {
            call++
            await readerOf(call === 1 ? first : second)(sink)
            return tail !== undefined && call === 2 ? tail : { ok: true }
        }
    }
    const three = sectionText([['a', 1], ['b', 2], ['c', 3]])
    const two = sectionText([['a', 1], ['b', 2]])

    test('the entry is cut after line 2', async () => {
        const fakes = makeFakes()
        const result = await applySideAction(restore('side.iris'), twoPhase(three, two, { ok: false, reason: 'short read' }), fakes.backends)
        expect(result).toMatchObject({ id: 'side.iris', status: 'changed', written: 2 })
        expect([...fakes.forage(IRIS_STORE).data.keys()].sort()).toEqual(['a', 'b'])
        expect(sideResultIsNamed(result)).toBe(true)
    })

    test('line 3 is damaged in pass 2', async () => {
        const fakes = makeFakes()
        const result = await applySideAction(restore('side.iris'), twoPhase(three, `${two}broken\n`), fakes.backends)
        expect(result).toMatchObject({ status: 'changed', line: 3, written: 2 })
        expect([...fakes.forage(IRIS_STORE).data.keys()].sort()).toEqual(['a', 'b'])
    })

    test('fewer or more lines than pass 1 is changed', async () => {
        const fewer = await applySideAction(restore('side.iris'), twoPhase(three, two), makeFakes().backends)
        expect(fewer).toMatchObject({ status: 'changed', written: 2 })
        const more = await applySideAction(restore('side.iris'), twoPhase(two, three), makeFakes().backends)
        expect(more).toMatchObject({ status: 'changed', written: 2 })
    })

    test('a trailing blank line, in either pass or both, does not report changed', async () => {
        for (const [first, second] of [[two, `${two}\n\n`], [`${two}\n`, two], [`${two}\n\n`, `${two}\n`]]) {
            const result = await applySideAction(restore('side.iris'), twoPhase(first, second), makeFakes().backends)
            expect(result).toMatchObject({ status: 'ok', written: 2 })
        }
    })

    test('an unknown-tag line counts in both passes', async () => {
        const skip = '{"k":"z","t":"zz9","b":"AA=="}\n'
        const result = await applySideAction(restore('side.iris'), twoPhase(`${two}${skip}`, `${two}${skip}`), makeFakes().backends)
        expect(result).toMatchObject({ status: 'ok', written: 2 })
        const dropped = await applySideAction(restore('side.iris'), twoPhase(`${two}${skip}`, two), makeFakes().backends)
        expect(dropped).toMatchObject({ status: 'changed' })
    })
})

// ---------------------------------------------------------------- chain

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)

describe('real writer output round-trips (T19, R)', () => {
    async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
        for (const item of items) {
            yield item
        }
    }

    function seed(fakes: Fakes): void {
        fakes.forage(IRIS_STORE).data.set('current_dialogue', [{ speaker: 'Iris', text: 'hi', tip: undefined }])
        fakes.forage(GOOGLE_SEARCH_STORE).data.set('google-search-creds', { apiKey: 'k', searchEngineId: 'e' })
        fakes.forage(HYPA_VECTOR_STORE).data.set('vec-1', new Float32Array([0.25, -0, 1.5]))
        fakes.forage(HYPA_VECTOR_STORE).data.set('vec-2', { content: 'text', embedding: [0.5, 1] })
        fakes.forage(PLUGIN_SAFE_STORE).data.set('safe_plugin_p', new Map<unknown, unknown>([['a', new Set([1])]]))
        fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set(GRANT_KEY, true)
        fakes.forage(MCP_TOOL_CALLS_STORE).data.set('call-1', { when: new Date(1700000000000), n: 12n })
        fakes.storage.data.set('safe_plugin_ls', 'value')
        fakes.storage.data.set('risuChatShell.reducedMotion', 'true')
        fakes.storage.data.set('risuauth', 'never-carried')
    }

    async function exportBytes(sides: Record<string, SideInput>): Promise<Uint8Array> {
        const sink = new SegmentSink()
        await writeRtb({
            sink,
            clock: () => CREATED,
            keyEnv: { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + 5) & 255), now: () => CREATED },
            writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
            source: { device: { label: 'pc', platform: 'web' }, committedAt: CREATED - 1000, unsavedExcluded: false },
            store2: { units: iterate([]), root: ['t0', 40, 7], req: [], refs: [] },
            sides,
            sideTags: RTB_SIDE_TAGS,
        })
        return sink.toBytes()
    }

    async function restoreAll(bytes: Uint8Array, target: Fakes): Promise<SideRestoreResult[]> {
        const source = rangeSourceOfBytes(bytes)
        const walk = await readDirectory(source)
        const index = walk.index
        if (!index) {
            throw new Error('no index')
        }
        const entry = (name: string): number => {
            for (let i = 0; i < index.count; i++) {
                if (index.entry(i).name === name) {
                    return i
                }
            }
            throw new Error(`no entry ${name}`)
        }
        const parts: Uint8Array[] = []
        await readEntry(source, index, entry('manifest.json'), (chunk) => {
            parts.push(chunk.slice())
        })
        const manifest = parseManifest(Uint8Array.from(parts.flatMap((p) => [...p])))
        if (manifest.kind !== 'ok') {
            throw new Error('manifest')
        }
        const table = parseSectionTable(manifest.manifest.sections)
        if (table.kind !== 'ok') {
            throw new Error('table')
        }
        const results: SideRestoreResult[] = []
        for (const action of decideSideSections(table.rows, manifest.manifest.omitted)) {
            const body: SideBodyReader | null = action.kind === 'restore'
                ? (sink) => readEntry(source, index, entry(`s/${action.id.slice(5)}/data.jsonl`), sink).then((r): Awaited<ReturnType<SideBodyReader>> => ('finding' in r ? { ok: false, reason: r.finding.detail } : { ok: true }))
                : null
            results.push(await applySideAction(action, body, target.backends))
        }
        return results
    }

    test('fakes -> readSideStores -> writeRtb -> read back -> applySideAction gives equal stores', async () => {
        const source = makeFakes()
        seed(source)
        const bytes = await exportBytes(await readSideStores(source.backends))
        const target = makeFakes()
        target.forage(IRIS_STORE).data.set('stale', 1)
        target.storage.data.set('risuauth', 'device-token')
        const results = await restoreAll(bytes, target)
        expect(results.every((r) => r.status === 'ok' || r.status === 'absent')).toBe(true)
        for (const { config } of FORAGE_STORES) {
            expect(target.forage(config).data).toStrictEqual(source.forage(config).data)
        }
        expect(target.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(0)
        expect(target.storage.data.get('safe_plugin_ls')).toBe('value')
        expect(target.storage.data.get('risuChatShell.reducedMotion')).toBe('true')
        expect(target.storage.data.get('risuauth')).toBe('device-token')
    })

    test('an unreadable store is omitted and the target store is left alone', async () => {
        const source = makeFakes()
        seed(source)
        source.forage(IRIS_STORE).failKeys = true
        const bytes = await exportBytes(await readSideStores(source.backends))
        const target = makeFakes()
        target.forage(IRIS_STORE).data.set('mine', 'kept')
        const results = await restoreAll(bytes, target)
        expect(results.find((r) => r.id === 'side.iris')).toMatchObject({ status: 'omitted', reason: 'unreadable' })
        expect([...target.forage(IRIS_STORE).data.entries()]).toEqual([['mine', 'kept']])
        expect(target.forage(GOOGLE_SEARCH_STORE).data.get('google-search-creds')).toEqual({ apiKey: 'k', searchEngineId: 'e' })
    })
})
