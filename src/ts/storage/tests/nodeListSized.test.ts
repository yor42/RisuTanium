// @vitest-environment node
/**
 * `listSized` of the Node client store (the size source of the 100 MiB backup warning) over `/api/list-prefix?min-size`:
 * against the real `server/node/server.cjs` it answers the keys strictly larger than the bound with their sizes; on a
 * server that cannot answer (an older fork or upstream server sends the plain name list, or no route) it answers
 * `null`, which the backup reads as "nothing here can be larger". A refused token, a 5xx and a 400 are errors, never `null`.
 *
 * Tests of new behaviour (they cannot pass on a store without `listSized`): every test of the first block. The scripted block pins the fallbacks
 * and the shape checks of the new method.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { NodeHttpError, createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function plant(key: string, size: number): Promise<void> {
    await mkdir(fixture.saveDir, { recursive: true })
    await writeFile(join(fixture.saveDir, hexOfKey(key)), Buffer.alloc(size, 1))
}

function liveStore() {
    return createNodeHttpStore({ authHeader: () => fixture.authHeader(), baseUrl: fixture.baseUrl })
}

const bySize = (items: { key: string, size: number }[]) => [...items].sort((a, b) => a.key.localeCompare(b.key))

describe('listSized on the real server', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
    })

    test('answers the keys strictly larger than the bound, with their sizes, and only under the prefix', async () => {
        await plant('assets/small', 5)
        await plant('assets/edge', 10)
        await plant('assets/big', 20)
        await plant('other/huge', 99)
        const store = liveStore()
        expect(bySize(await store.listSized!('assets/', 10) ?? [])).toEqual([{ key: 'assets/big', size: 20 }])
    })

    test('a bound of zero answers every non-empty file and the exact bound is not named', async () => {
        await plant('assets/one', 1)
        await plant('assets/empty', 0)
        const store = liveStore()
        expect(bySize(await store.listSized!('assets/', 0) ?? [])).toEqual([{ key: 'assets/one', size: 1 }])
        expect(await store.listSized!('assets/', 1)).toEqual([])
    })

    test('an empty answer is an empty list, not null', async () => {
        await plant('assets/small', 3)
        expect(await liveStore().listSized!('assets/', 100)).toEqual([])
    })
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function scripted(answer: () => Response) {
    const calls: string[] = []
    const stub: FetchLike = async (url) => {
        calls.push(url)
        return answer()
    }
    return { store: createNodeHttpStore({ authHeader: async () => 'token', fetch: stub }), calls }
}

describe('listSized against other servers', () => {
    test('asks list-prefix with the hex of the prefix and the bound', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: [], sizes: [] }))
        await store.listSized!('assets/', 104857600)
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('assets/')}&min-size=104857600`])
    })

    test('a server that ignores min-size (plain name list, no sizes) answers null', async () => {
        const { store } = scripted(() => json({ success: true, content: ['assets/a', 'assets/b'] }))
        expect(await store.listSized!('assets/', 10)).toBeNull()
    })

    test('a missing route answers null and is not remembered as a missing route', async () => {
        const { store, calls } = scripted(() => new Response('Cannot GET', { status: 404 }))
        expect(await store.listSized!('assets/', 10)).toBeNull()
        expect(await store.listSized!('assets/', 10)).toBeNull()
        expect(calls).toHaveLength(2)
    })

    test('a server error (5xx) or a rejected request (400) rejects instead of answering null', async () => {
        for (const status of [400, 500, 502, 504]) {
            const { store } = scripted(() => new Response('failed', { status }))
            await expect(store.listSized!('assets/', 10)).rejects.toMatchObject({ name: 'NodeHttpError', status })
        }
    })

    test('sizes that do not match the names, or are not sizes, answer null', async () => {
        for (const body of [
            { success: true, content: ['assets/a'], sizes: [] },
            { success: true, content: ['assets/a'], sizes: ['9'] },
            { success: true, content: ['assets/a'], sizes: [-1] },
            { success: true, content: ['assets/a'], sizes: [1.5] },
            { success: true, content: [7], sizes: [9] },
            { success: false, content: ['assets/a'], sizes: [9] },
        ]) {
            const { store } = scripted(() => json(body))
            expect(await store.listSized!('assets/', 1)).toBeNull()
        }
    })

    test('names outside the prefix and sizes not above the bound in the answer are dropped, and a name sent twice keeps its larger size', async () => {
        const { store } = scripted(() => json({ success: true, content: ['assets/a', 'other/b', 'assets/c', 'assets/a'], sizes: [50, 90, 5, 70] }))
        expect(await store.listSized!('assets/', 10)).toEqual([{ key: 'assets/a', size: 70 }])
    })

    test.each([401, 403])('a refused request (%i) is an error, never null', async (status) => {
        const { store } = scripted(() => json({ success: false }, status))
        await expect(store.listSized!('assets/', 10)).rejects.toBeInstanceOf(NodeHttpError)
    })

    test('a negative or fractional bound is refused before any request', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: [], sizes: [] }))
        await expect(store.listSized!('assets/', -1)).rejects.toBeInstanceOf(RangeError)
        await expect(store.listSized!('assets/', 1.5)).rejects.toBeInstanceOf(RangeError)
        expect(calls).toEqual([])
    })
})
