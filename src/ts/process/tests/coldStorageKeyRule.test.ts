/**
 * The rule that decides whether a unit key may become a storage name
 * (`isSafeColdStorageKey` in `../coldStorageKey`) and the three functions that
 * turn a key into a storage location (`readColdStorageItem`,
 * `setColdStorageItem`, the legacy `getColdStorageItem` in
 * `../coldstorage.svelte`), run for real over the real fflate codec with only
 * the storage underneath replaced by stand-ins (an in-memory byte store for the
 * page's store, an OPFS directory for the legacy unit files). A pass here says
 * nothing about a real browser, Node server or Tauri file system.
 *
 * Pinned here:
 * - the rule accepts every key the app writes and rejects the shapes the
 *   backends cannot hold, and never throws;
 * - contract: for a rejected key neither the page store nor OPFS sees any call,
 *   a read is an error of kind `damaged`, a write is `false` and the legacy get
 *   is `null`;
 * - a key at the length limit and an `<uuid>_accessMeta` key still round-trip
 *   on every backend, in the page store and never in OPFS.
 * The contract tests do not reproduce the POSIX or Node defects behind the
 * rule: the regression reproducers for those are in `coldReadKinds.test.ts`.
 * The store's own refusal of a key the rule accepts is pinned in
 * `coldUnitsThroughStore.test.ts`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    /** Every storage call made by a stand-in, in order. */
    calls: [] as string[],
    /** The page store's content: `coldstorage/<key>` (`coldstorage/<key>.json` on the desktop). */
    store: new Map<string, Uint8Array>(),
    opfs: new Map<string, Uint8Array>(),
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => { h.calls.push('store.read ' + key); return h.store.get(key) ?? null },
        setItem: async (key, value) => { h.calls.push('store.write ' + key); h.store.set(key, value) },
        keys: async () => { h.calls.push('store.list'); return Array.from(h.store.keys()) },
        removeItem: async (key) => { h.calls.push('store.delete ' + key); h.store.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { getColdStorageItem, readColdStorageItem, setColdStorageItem } from '../coldstorage.svelte'
import { isSafeColdStorageKey, MAX_COLD_STORAGE_KEY_BYTES } from '../coldStorageKey'
import { readPluginStorageValue, writePluginStorageValue, type PluginColdStorageDb } from '../../plugins/apiV3/pluginColdStorage'

//#region stand-ins

type Backend = 'opfs' | 'node' | 'tauri'
const BACKENDS: Backend[] = ['opfs', 'node', 'tauri']

const opfsDirectory = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
        h.calls.push('opfs.getFileHandle ' + name)
        if (opts?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) { h.opfs.set(name, data) },
                        async close() {},
                    }
                },
            }
        }
        const bytes = h.opfs.get(name)
        if (!bytes) {
            throw Object.assign(new Error(`not found: ${name}`), { name: 'NotFoundError' })
        }
        return {
            async getFile() {
                return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }
            },
        }
    },
}

const opfsStorage = {
    getDirectory: async () => {
        h.calls.push('opfs.getDirectory')
        return opfsDirectory
    },
}

function selectBackend(backend: Backend): void {
    h.platform.isNodeServer = backend === 'node'
    h.platform.isTauri = backend === 'tauri'
}

beforeEach(() => {
    selectBackend('opfs')
    h.calls.length = 0
    h.store.clear()
    h.opfs.clear()
    Object.defineProperty(navigator, 'storage', { configurable: true, value: opfsStorage })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    vi.restoreAllMocks()
})

//#endregion

//#region fixtures

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'

/** A key of exactly `bytes` UTF-8 bytes built from `unit`, which must be `unitBytes` bytes long. */
function keyOfBytes(unit: string, unitBytes: number, bytes: number): string {
    return unit.repeat(Math.floor(bytes / unitBytes)) + 'a'.repeat(bytes % unitBytes)
}

const ACCEPTED_KEYS: Array<[string, string]> = [
    ['a random UUID', UUID],
    ['a UUID with the _accessMeta suffix upstream wrote', UUID + '_accessMeta'],
    ['a kebab-case fixture key', 'chat-unit-1'],
    ['a key of exactly 100 ASCII bytes', 'k'.repeat(MAX_COLD_STORAGE_KEY_BYTES)],
    ['a key of exactly 100 bytes made of 3-byte characters', keyOfBytes('€', 3, 100)],
    ['a key of exactly 100 bytes made of 4-byte characters', keyOfBytes('\u{1F600}', 4, 100)],
    ['a key with a space, a dot and non-Latin letters', 'a b.c-d_가'],
]

const FORBIDDEN_CHARACTERS = ['/', '\\', ':', '<', '>', '"', '|', '?', '*']

const REJECTED_KEYS: Array<[string, unknown]> = [
    ['the empty string', ''],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a colon', 'a:b'],
    ['a NUL character', 'a\u0000b'],
    ['a less-than sign', 'a<b'],
    ['a greater-than sign', 'a>b'],
    ['a double quote', 'a"b'],
    ['a pipe', 'a|b'],
    ['a question mark', 'a?b'],
    ['an asterisk', 'a*b'],
    ['a control character', 'a\u001fb'],
    ['a newline', 'a\nb'],
    ['a lone high surrogate', 'a\uD800b'],
    ['a lone low surrogate', 'a\uDC00b'],
    ['a trailing high surrogate', 'ab\uD83D'],
    ['a reversed surrogate pair', '\uDE00\uD83D'],
    ['101 ASCII bytes', 'k'.repeat(MAX_COLD_STORAGE_KEY_BYTES + 1)],
    ['34 three-byte characters (102 bytes)', '€'.repeat(34)],
    ['26 four-byte characters (104 bytes)', '\u{1F600}'.repeat(26)],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an array holding a slash key', ['a/b']],
    ['an array holding a valid key', ['a']],
    ['an object', { toString: () => 'a' }],
]

//#endregion

describe('isSafeColdStorageKey', () => {
    test.each(ACCEPTED_KEYS)('accepts %s', (_label, key) => {
        expect(isSafeColdStorageKey(key)).toBe(true)
    })

    test.each(REJECTED_KEYS)('rejects %s', (_label, key) => {
        expect(isSafeColdStorageKey(key)).toBe(false)
    })

    test('rejects every control character from U+0000 to U+001F and accepts U+0020', () => {
        for (let code = 0; code < 0x20; code++) {
            expect(isSafeColdStorageKey('a' + String.fromCharCode(code))).toBe(false)
        }
        expect(isSafeColdStorageKey('a b')).toBe(true)
    })

    test('rejects each forbidden character wherever it sits in the key', () => {
        for (const character of FORBIDDEN_CHARACTERS) {
            expect(isSafeColdStorageKey(character)).toBe(false)
            expect(isSafeColdStorageKey(character + 'abc')).toBe(false)
            expect(isSafeColdStorageKey('abc' + character)).toBe(false)
        }
    })

    test('accepts a well-formed surrogate pair and counts it as 4 bytes', () => {
        expect(isSafeColdStorageKey('\u{1F600}')).toBe(true)
        expect(isSafeColdStorageKey('\u{1F600}'.repeat(25))).toBe(true)
        expect(isSafeColdStorageKey('\u{1F600}'.repeat(25) + 'a')).toBe(false)
    })

    test('accepts every crypto.randomUUID() key and its _accessMeta form', () => {
        for (let i = 0; i < 200; i++) {
            const key = crypto.randomUUID()
            expect(isSafeColdStorageKey(key)).toBe(true)
            expect(isSafeColdStorageKey(key + '_accessMeta')).toBe(true)
        }
    })

    test('never throws, whatever it is given', () => {
        const hostile: unknown[] = [
            Symbol('s'),
            () => 'a',
            Object.create(null),
            new String('a'),
            new Proxy({}, { get() { throw new Error('trap') } }),
            'x'.repeat(1_000_000),
            '\uD800'.repeat(1_000_000),
            BigInt(1),
            NaN,
        ]
        for (const value of hostile) {
            expect(() => isSafeColdStorageKey(value)).not.toThrow()
            expect(isSafeColdStorageKey(value)).toBe(false)
        }
    })
})

describe('contract: a key the rule rejects reaches no backend', () => {
    for (const backend of BACKENDS) {
        describe(`on ${backend}`, () => {
            beforeEach(() => selectBackend(backend))

            test.each(REJECTED_KEYS)('%s: the read is an error of kind damaged and never rejects', async (_label, key) => {
                const result = await readColdStorageItem(key as string)

                expect(result.status).toBe('error')
                expect((result as { kind?: unknown }).kind).toBe('damaged')
                expect(result).toHaveProperty('error')
                expect(h.calls).toEqual([])
            })

            test.each(REJECTED_KEYS)('%s: the write resolves false', async (_label, key) => {
                expect(await setColdStorageItem(key as string, { message: [] })).toBe(false)
                expect(h.calls).toEqual([])
                expect(h.store.size + h.opfs.size).toBe(0)
            })

            test.each(REJECTED_KEYS)('%s: the legacy get resolves null', async (_label, key) => {
                expect(await getColdStorageItem(key as string)).toBeNull()
                expect(h.calls).toEqual([])
            })
        })
    }
})

describe('contract: a plugin slot mapped to a key the rule rejects', () => {
    test.each([
        ['a string holding a slash', 'a/b'],
        ['an array holding a slash key', ['a/b']],
    ])('%s: the plugin read throws, the plugin write throws and leaves the mapping alone, and no backend is called', async (_label, mapped) => {
        selectBackend('node')
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: mapped as string } } }

        await expect(readPluginStorageValue(db, 'k', readColdStorageItem)).rejects.toThrow('Failed to read plugin storage for key: k')
        await expect(writePluginStorageValue(db, () => db, 'k', 'value', setColdStorageItem, () => 'unused')).rejects.toThrow('Failed to write plugin storage for key: k')

        expect(db.pluginCustomStorage?._coldplugin?.k).toBe(mapped)
        expect(h.calls).toEqual([])
    })
})

describe('a key the rule accepts is stored and read as before', () => {
    for (const backend of BACKENDS) {
        describe(`on ${backend}`, () => {
            beforeEach(() => selectBackend(backend))

            test.each(ACCEPTED_KEYS)('%s round-trips through the write, the read and the legacy get', async (_label, key) => {
                const value = { message: [{ time: 1, data: 'archived', role: 'user' }] }

                expect(await setColdStorageItem(key, value)).toBe(true)
                expect(await readColdStorageItem(key)).toEqual({ status: 'ok', value })
                expect(await getColdStorageItem(key)).toEqual(value)
                expect(h.store.size).toBe(1)
                expect(h.opfs.size).toBe(0)
            })

            test('an accepted key that was never written is still missing', async () => {
                expect(await readColdStorageItem(UUID + '_accessMeta')).toEqual({ status: 'missing' })
                expect(await getColdStorageItem(UUID + '_accessMeta')).toBeNull()
            })
        })
    }
})
