// @vitest-environment node
/**
 * The size of the assets the manual clean-up offers to delete (`store2/sweep/assetSize.ts`): the source each store kind
 * offers, the rule that no asset body goes through `read`, the stop between names and the pace.
 *
 * What is a stand-in: the IndexedDB source is a memory byte store with a `readValue` double, and the Tauri probe is a `sizeOf`
 * double (it is not the native ranged read). The Node listing is the real `listSized` of `createNodeHttpStore` against the
 * real server process.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { SIZE_PACE_EVERY, sizeAssets } from 'src/ts/storage/store2/sweep/assetSize'
import { startNodeServer, type NodeServerFixture } from '../nodeServerFixture'

const servers: NodeServerFixture[] = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()))
})

const never = (): boolean => false

describe('the source of the size', () => {
    test('S1 indexeddb: the readValue sizes of a Blob and of bytes add up, and a vanished name counts 0', async () => {
        const store = createMemoryByteStore()
        const values = new Map<string, Blob | Uint8Array>([
            ['assets/a.png', new Blob([new Uint8Array(11)])],
            ['assets/b.png', new Uint8Array(4)],
        ])
        store.readValue = async key => values.get(key) ?? null

        const sized = await sizeAssets({ kind: 'indexeddb', store, names: ['a.png', 'b.png', 'gone.png'], shouldStop: never })

        expect(sized).toEqual({ status: 'sized', bytes: 15 })
    })

    test('S1 node: one real listSized answer sums the names, and a name the listing omits counts 0', async () => {
        const fixture = await startNodeServer()
        servers.push(fixture)
        const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
        await store.write('assets/a.png', new Uint8Array(3), 'unconditional')
        await store.write('assets/b.png', new Uint8Array(5), 'unconditional')
        await store.write('assets/other.png', new Uint8Array(100), 'unconditional')
        const listing = vi.spyOn(store, 'listSized')

        const sized = await sizeAssets({ kind: 'node', store, names: ['a.png', 'b.png', 'gone.png'], shouldStop: never })

        expect(sized).toEqual({ status: 'sized', bytes: 8 })
        expect(listing).toHaveBeenCalledTimes(1)
    })

    test('S1 tauri: the sizeOf probe is asked once per name with the assets key', async () => {
        const sizeOf = vi.fn(async (key: string) => (key === 'assets/gone.png' ? null : 7))

        const sized = await sizeAssets({ kind: 'tauri', store: createMemoryByteStore(), names: ['a.png', 'gone.png', 'b.png'], shouldStop: never, sizeOf })

        expect(sized).toEqual({ status: 'sized', bytes: 14 })
        expect(sizeOf.mock.calls.map(call => call[0])).toEqual(['assets/a.png', 'assets/gone.png', 'assets/b.png'])
    })

    test('S1 no source: a kind without one answers null, so does a source that rejects or answers null', async () => {
        const plain = createMemoryByteStore()
        plain.files.set('assets/a.png', new Uint8Array(3))
        const rejecting = createMemoryByteStore()
        rejecting.readValue = async () => { throw new Error('boom') }
        const nodeNull = createMemoryByteStore()
        nodeNull.listSized = async () => null

        expect(await sizeAssets({ kind: 'indexeddb', store: plain, names: ['a.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        expect(await sizeAssets({ kind: 'node', store: plain, names: ['a.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        expect(await sizeAssets({ kind: 'tauri', store: plain, names: ['a.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        expect(await sizeAssets({ kind: 'indexeddb', store: rejecting, names: ['a.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        expect(await sizeAssets({ kind: 'node', store: nodeNull, names: ['a.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        expect(await sizeAssets({ kind: 'tauri', store: plain, names: ['a.png'], shouldStop: never, sizeOf: async () => { throw new Error('boom') } })).toEqual({ status: 'sized', bytes: null })
    })
})

describe('no asset body is read', () => {
    test('S2: with the members present or absent, store.read is never asked for an asset', async () => {
        const store = createMemoryByteStore()
        store.files.set('assets/a.png', new Uint8Array(3))
        store.files.set('assets/b.png', new Uint8Array(4))
        store.readValue = async key => store.files.get(key) ?? null

        expect(await sizeAssets({ kind: 'indexeddb', store, names: ['a.png', 'b.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: 7 })
        store.readValue = undefined
        expect(await sizeAssets({ kind: 'indexeddb', store, names: ['a.png', 'b.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })
        store.listSized = undefined
        expect(await sizeAssets({ kind: 'node', store, names: ['a.png', 'b.png'], shouldStop: never })).toEqual({ status: 'sized', bytes: null })

        expect(store.reads.filter(key => key.startsWith('assets/'))).toEqual([])
    })
})

describe('stop and pace', () => {
    test('S3: a stop after name k ends the measurement with k probes made', async () => {
        const names = Array.from({ length: 10 }, (_, i) => `n${i}.png`)
        const sizeOf = vi.fn(async () => 1)

        const sized = await sizeAssets({ kind: 'tauri', store: createMemoryByteStore(), names, sizeOf, shouldStop: () => sizeOf.mock.calls.length >= 4 })

        expect(sized).toEqual({ status: 'stopped' })
        expect(sizeOf).toHaveBeenCalledTimes(4)
    })

    test('S3: a stop before the Node listing ends the measurement without listing', async () => {
        const store = createMemoryByteStore()
        const listing = vi.fn(async () => [])
        store.listSized = listing

        expect(await sizeAssets({ kind: 'node', store, names: ['a.png'], shouldStop: () => true })).toEqual({ status: 'stopped' })
        expect(listing).not.toHaveBeenCalled()
    })

    test('S3: pace is awaited every SIZE_PACE_EVERY names', async () => {
        const names = Array.from({ length: SIZE_PACE_EVERY * 2 + 50 }, (_, i) => `n${i}.png`)
        const pace = vi.fn(async () => { })
        const sizeOf = vi.fn(async () => 1)

        const sized = await sizeAssets({ kind: 'tauri', store: createMemoryByteStore(), names, sizeOf, pace, shouldStop: never })

        expect(sized).toEqual({ status: 'sized', bytes: names.length })
        expect(pace).toHaveBeenCalledTimes(2)
    })
})
