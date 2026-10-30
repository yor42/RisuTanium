/**
 * The device-local private-network toggle of plugins, cards and MCP: where it lives, that it defaults
 * to off, and that a stored value the build cannot read is kept and never written.
 *
 * The byte store is the in-memory test store; nothing here says anything about the native store.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore, ReadResult } from 'src/ts/storage/store/contract'
import { createMemoryByteStore } from '../../process/files/tests/memoryByteStore'
import { indexedDbCreatableViolation, nodeCreatableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'

const h = vi.hoisted(() => ({
    store: null as ByteStore | null,
}))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => h.store,
}))

const KEY = 'consent/native-private-network.json'
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function newPage(store: ByteStore): Promise<typeof import('../privateNetworkConsent')> {
    vi.resetModules()
    h.store = store
    return await import('../privateNetworkConsent')
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('key placement', () => {
    test('guard: the key is creatable on every store and outside every listed or swept prefix', async () => {
        expect(tauriCreatableViolation(KEY)).toBeNull()
        expect(nodeCreatableViolation(KEY)).toBeNull()
        expect(indexedDbCreatableViolation(KEY)).toBeNull()
        for (const prefix of ['assets/', 'remotes/', 'blocks/', 'database/', 'coldstorage/', 'inlays/', 'store2/']) {
            expect(KEY.startsWith(prefix)).toBe(false)
        }
        expect((await newPage(createMemoryByteStore())).NATIVE_PRIVATE_NETWORK_KEY).toBe(KEY)
    })
})

describe('a readable store', () => {
    test('guard: absent means off and nothing is written by reading', async () => {
        const store = createMemoryByteStore()
        const page = await newPage(store)
        expect(await page.getAllowPrivate()).toBe(false)
        expect(store.writes).toEqual([])
    })

    test('enabling writes v1 and a fresh page reads it; disabling writes false', async () => {
        const store = createMemoryByteStore()
        const first = await newPage(store)
        expect(await first.setAllowPrivate(true)).toEqual({ persisted: true })
        expect(JSON.parse(text(store.files.get(KEY)!))).toEqual({ v: 1, allowPrivate: true })

        const second = await newPage(store)
        expect(await second.getAllowPrivate()).toBe(true)

        expect(await second.setAllowPrivate(false)).toEqual({ persisted: true })
        expect(JSON.parse(text(store.files.get(KEY)!))).toEqual({ v: 1, allowPrivate: false })
        expect(await second.getAllowPrivate()).toBe(false)
    })

    test('the value is read from the store on every call, so another tab\'s change is seen', async () => {
        const store = createMemoryByteStore()
        const page = await newPage(store)
        expect(await page.getAllowPrivate()).toBe(false)
        store.files.set(KEY, new TextEncoder().encode('{"v":1,"allowPrivate":true}'))
        expect(await page.getAllowPrivate()).toBe(true)
    })
})

describe('a stored value the build cannot read is kept', () => {
    test.each([
        ['bytes that do not parse', 'not json {'],
        ['a newer format', '{"v":2,"allowPrivate":true}'],
        ['a wrong shape', '{"v":1,"allowPrivate":"yes"}'],
        ['a zero-length file', ''],
    ])('%s: reads as off, is never overwritten, and the choice holds in memory only', async (_label, seed) => {
        const store = createMemoryByteStore()
        const seeded = new TextEncoder().encode(seed)
        store.files.set(KEY, seeded.slice())
        const page = await newPage(store)

        expect(await page.getAllowPrivate()).toBe(false)
        expect(await page.setAllowPrivate(true)).toEqual({ persisted: false })
        expect(await page.getAllowPrivate()).toBe(true)

        expect(Array.from(store.files.get(KEY)!)).toEqual(Array.from(seeded))
        expect(store.writes).toEqual([])
    })

    test('a read that throws: off, nothing written, and a fresh page with a working read sees the stored value', async () => {
        const inner = createMemoryByteStore()
        const stored = new TextEncoder().encode('{"v":1,"allowPrivate":true}')
        inner.files.set(KEY, stored.slice())
        let failuresLeft = 1
        let writeCalls = 0
        const flaky: ByteStore = {
            ...inner,
            async read(key: string): Promise<ReadResult> {
                if (failuresLeft > 0) {
                    failuresLeft--
                    throw new Error('read refused')
                }
                return await inner.read(key)
            },
            async write(key, bytes, condition) {
                writeCalls++
                return await inner.write(key, bytes, condition)
            },
        }
        const page = await newPage(flaky)

        expect(await page.getAllowPrivate()).toBe(false)
        expect(await page.setAllowPrivate(false)).toEqual({ persisted: false })
        expect(writeCalls).toBe(0)
        expect(Array.from(inner.files.get(KEY)!)).toEqual(Array.from(stored))

        const fresh = await newPage(flaky)
        expect(await fresh.getAllowPrivate()).toBe(true)
    })
})
