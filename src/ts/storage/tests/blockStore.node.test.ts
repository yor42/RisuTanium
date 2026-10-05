// @vitest-environment node
/**
 * The commit owner on the real `server/node/server.cjs` (a child process) through
 * the real Node adapter: revisions, 409s and tombstones are the server's own.
 * Fault injection is a fetch wrapper that lets a request reach the server and
 * then drops the response.
 */
import { readdir } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { HEAD_KEY, characterBlockKey, rootKey } from 'src/ts/storage/blockKeys'
import { createNodeHeadSwap, parseHead } from 'src/ts/storage/headSwap'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { characterBlock, makeOwner, makeSet, seedStore, textOf, withBlock, withCharacter, withoutBlock } from './blockStoreHarness'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

beforeEach(async () => {
    await fixture.clearKeys()
})

interface Drop {
    /** The request whose response is dropped after the server has handled it. */
    match(path: string, headers: Record<string, string>): boolean
    times: number
}

function nodeStore(drops: Drop[] = []): ByteStore {
    const droppingFetch: FetchLike = async (url, init) => {
        const response = await fetch(url, init)
        const path = url.slice(fixture.baseUrl.length)
        const drop = drops.find((candidate) => candidate.times > 0 && candidate.match(path, (init?.headers ?? {}) as Record<string, string>))
        if (drop !== undefined) {
            drop.times--
            throw new TypeError('network error after the server answered')
        }
        return response
    }
    return createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader(), fetch: droppingFetch })
}

function writesTo(key: string): Drop['match'] {
    return (path, headers) => path === '/api/write' && headers['file-path'] === hexOfKey(key)
}

const BASE = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'] })

describe('invariant 4 on the real server', () => {
    test('A\'s write lands then throws; B writes the key; A retries on the old revision and parks, B\'s bytes intact', async () => {
        const drops: Drop[] = []
        const storeA = nodeStore(drops)
        const generation = await seedStore(storeA, BASE)
        const a = makeOwner(storeA)
        await a.owner.load()
        const key = characterBlockKey(generation, 'alice')
        drops.push({ match: writesTo(key), times: 1 })
        const mine = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","by":"a"}'))
        await expect(a.owner.commitSave(mine)).rejects.toBeInstanceOf(TypeError)

        const peer = nodeStore()
        const current = await peer.read(key)
        const peerBytes = characterBlock('alice', '{"chaId":"alice","by":"b"}')
        await peer.write(key, peerBytes, { ifVersion: current.version as number })

        const retry = await a.owner.commitSave(mine)
        expect(retry).toEqual({ kind: 'conflict', key })
        expect(textOf((await peer.read(key)).bytes)).toContain('"by":"b"')
    })

    test('two devices: after B commits anything, A\'s next save parks (MC-159)', async () => {
        const storeA = nodeStore()
        const generation = await seedStore(storeA, BASE)
        const a = makeOwner(storeA)
        const b = makeOwner(nodeStore())
        await a.owner.load()
        await b.owner.load()
        expect(await b.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","by":"b"}')))).toMatchObject({ kind: 'committed' })
        const result = await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","by":"a"}')))
        expect(result).toEqual({ kind: 'conflict', key: rootKey(generation) })
    })
})

describe('invariant 8 on the real server', () => {
    test('an orphan own key saves after the character is restored', async () => {
        const store = nodeStore()
        const generation = await seedStore(store, BASE)
        const orphan = characterBlockKey(generation, 'zed')
        await store.write(orphan, characterBlock('zed', '{"chaId":"zed","old":true}'), { ifVersion: 0 })
        const { owner } = makeOwner(store)
        await owner.load()
        const result = await owner.commitSave(withCharacter(BASE, 'zed', '{"chaId":"zed","restored":true}'))
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        expect(textOf((await store.read(orphan)).bytes)).toContain('restored')
        const reload = await makeOwner(store).owner.load()
        expect(reload.kind).toBe('loaded')
    })

    test('a character deleted and re-created saves on the server\'s tombstone revision', async () => {
        const input = makeSet({ characters: [{ chaId: '§playground' }] })
        const store = nodeStore()
        const generation = await seedStore(store, input)
        const { owner } = makeOwner(store)
        await owner.load()
        expect(await owner.commitSave(withoutBlock(input, '§playground'))).toMatchObject({ kind: 'committed' })
        const key = characterBlockKey(generation, '§playground')
        const gone = await store.read(key)
        expect(gone.bytes).toBeNull()
        expect(gone.version).toBeGreaterThan(0)
        const again = await owner.commitSave(withCharacter(withoutBlock(input, '§playground'), '§playground', '{"chaId":"§playground","again":1}'))
        expect(again).toMatchObject({ kind: 'committed', wrote: true })
        expect(textOf((await store.read(key)).bytes)).toContain('again')
    })

    test('a 255-byte chaId is stored under a key the server accepts', async () => {
        const long = 'é'.repeat(127)
        const input = makeSet({ characters: [{ chaId: long }] })
        const store = nodeStore()
        await seedStore(store, input)
        const { owner } = makeOwner(store)
        const loaded = await owner.load()
        expect(loaded.kind).toBe('loaded')
        expect(await owner.commitSave(withBlock(input, long, characterBlock(long, '{"v":2}')))).toMatchObject({ kind: 'committed', wrote: true })
    })
})

describe('the flip on the real server (invariants H and U)', () => {
    test('two converters racing against an empty server: exactly one wins, in every trial', async () => {
        for (let trial = 0; trial < 12; trial++) {
            await fixture.clearKeys()
            const a = makeOwner(nodeStore())
            const b = makeOwner(nodeStore())
            const results = await Promise.all([
                a.owner.replaceWholeState(withCharacter(BASE, 'from-a'), { requireAbsentHead: true }),
                b.owner.replaceWholeState(withCharacter(BASE, 'from-b'), { requireAbsentHead: true }),
            ])
            expect(results.map((result) => result.kind).sort(), `trial ${trial}`).toEqual(['lost', 'won'])
            const winner = results[0].kind === 'won' ? 'from-a' : 'from-b'
            const loaded = await makeOwner(nodeStore()).owner.load()
            expect(loaded.kind === 'loaded' && loaded.loaded.directory.includes(winner), `trial ${trial}`).toBe(true)
        }
    })

    test('the head write lands and its response is dropped: the owner finds its generation, keeps it and deletes the old one', async () => {
        const drops: Drop[] = []
        const store = nodeStore(drops)
        const oldGeneration = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        drops.push({ match: writesTo(HEAD_KEY), times: 1 })
        const result = await owner.replaceWholeState(withCharacter(BASE, 'carol'))
        expect(result).toMatchObject({ kind: 'won', previous: { state: 'deleted', generation: oldGeneration } })
        expect(await store.list(`blocks/${oldGeneration}/`)).toEqual([])
        const reload = await makeOwner(nodeStore()).owner.load()
        expect(reload.kind === 'loaded' && reload.loaded.directory.includes('carol')).toBe(true)
    })

    test('the head write lands, the response is dropped and the head cannot be read: nothing is deleted, the write lock stays closed, a reload loads the new state', async () => {
        const drops: Drop[] = []
        const store = nodeStore(drops)
        const oldGeneration = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        const headWrite: Drop = { match: writesTo(HEAD_KEY), times: 1 }
        drops.push(headWrite)
        drops.push({ match: (path, headers) => headWrite.times === 0 && path === '/api/read' && headers['file-path'] === hexOfKey(HEAD_KEY), times: 99 })
        const result = await owner.replaceWholeState(withCharacter(BASE, 'carol'))
        expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'unreadable' })
        expect(owner.isClosed()).toBe(true)
        expect((await store.list(`blocks/${oldGeneration}/`)).length).toBeGreaterThan(5)
        const reload = await makeOwner(nodeStore()).owner.load()
        expect(reload.kind === 'loaded' && reload.loaded.directory.includes('carol')).toBe(true)
    })

    test('the head write fails before it lands: could not be confirmed, nothing deleted', async () => {
        const store = nodeStore()
        const oldGeneration = await seedStore(store, BASE)
        const failing = createNodeHttpStore({
            baseUrl: fixture.baseUrl,
            authHeader: () => fixture.authHeader(),
            fetch: async (url, init) => {
                if (url.endsWith('/api/write') && (init?.headers as Record<string, string>)['file-path'] === hexOfKey(HEAD_KEY)) {
                    throw new TypeError('connection refused')
                }
                return await fetch(url, init)
            },
        })
        const { owner } = makeOwner(failing)
        await owner.load()
        const result = await owner.replaceWholeState(withCharacter(BASE, 'carol'))
        expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'unchanged' })
        expect((await store.list(`blocks/${oldGeneration}/`)).length).toBeGreaterThan(5)
        const head = parseHead((await store.read(HEAD_KEY)).bytes as Uint8Array)
        expect(head).toMatchObject({ status: 'ok', record: { current: oldGeneration } })
    })

    test('the real head swap loses on a 409 and the head keeps the winner', async () => {
        const store = nodeStore()
        const swap = createNodeHeadSwap(store)
        const absent = await swap.read()
        const winner = new TextEncoder().encode('{"current":"000000000001-00000001"}')
        const loser = new TextEncoder().encode('{"current":"000000000002-00000002"}')
        expect(await swap.swap(absent, winner)).toBe('won')
        expect(await swap.swap(absent, loser)).toBe('lost')
        expect((await store.read(HEAD_KEY)).bytes).toEqual(winner)
    })
})

describe('the loader on the real server (invariant Q)', () => {
    test('load() leaves every file on the server as it was, kept and leftover generations included', async () => {
        const store = nodeStore()
        await seedStore(store, BASE)
        await store.write('blocks/000000000001-00000001/root', characterBlock('x'), 'unconditional')
        await store.write('blocks/000000000001-00000001/kept', new Uint8Array([1]), 'unconditional')
        await store.write('blocks/000000000002-00000002/root', characterBlock('x'), 'unconditional')
        const before = (await readdir(fixture.saveDir)).sort()
        const stats = await Promise.all(before.map(async (name) => (await import('node:fs/promises')).stat(`${fixture.saveDir}/${name}`).then((stat) => `${name}:${stat.size}:${stat.mtimeMs}`)))
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('loaded')
        const after = (await readdir(fixture.saveDir)).sort()
        const statsAfter = await Promise.all(after.map(async (name) => (await import('node:fs/promises')).stat(`${fixture.saveDir}/${name}`).then((stat) => `${name}:${stat.size}:${stat.mtimeMs}`)))
        expect(after).toEqual(before)
        expect(statsAfter).toEqual(stats)
    })
})
