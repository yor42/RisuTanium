// @vitest-environment node
/**
 * The head's compare-and-swap per adapter. The IndexedDB cases run against
 * `fake-indexeddb`: they show the transaction logic (one read-write
 * transaction, a failed compare aborts, exactly one of two racing swaps wins)
 * and say nothing about a real browser's cross-tab behaviour, which was
 * measured separately. `fake-indexeddb/auto` is imported before LocalForage is
 * first evaluated because LocalForage captures `indexedDB` when it loads.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HEAD_KEY } from 'src/ts/storage/blockKeys'
import { createMutexHeadSwap, createNodeHeadSwap, encodeHead, parseHead, sameHeadBytes, sameHeadRead, type HeadRead, type HeadSwap } from 'src/ts/storage/headSwap'
import { createIndexedDbHeadSwap, createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import { createFakeStore, makeOwner, makeSet, seedStore } from './blockStoreHarness'

const A = encodeHead({ current: '000000000001-0000000a' })
const B = encodeHead({ current: '000000000002-0000000b' })
const C = encodeHead({ current: '000000000003-0000000c' })

const ABSENT: HeadRead = { kind: 'absent', version: null }
const NOT_BINARY: HeadRead = { kind: 'not-binary' }

function bytesRead(bytes: Uint8Array): HeadRead {
    return { kind: 'bytes', bytes, version: null }
}

describe('head records', () => {
    test('a head encodes and parses back, with and without a fingerprint', () => {
        expect(parseHead(encodeHead({ current: '000000000001-0000000a' }))).toEqual({ status: 'ok', record: { current: '000000000001-0000000a' } })
        expect(parseHead(encodeHead({ current: '000000000001-0000000a', convertedFrom: 'x' }))).toEqual({ status: 'ok', record: { current: '000000000001-0000000a', convertedFrom: 'x' } })
    })

    test('a head carries the conversion time beside the fingerprint and parses it back', () => {
        const record = { current: '000000000001-0000000a', convertedFrom: 'x', convertedAt: 1_700_000_000_123 }
        expect(parseHead(encodeHead(record))).toEqual({ status: 'ok', record })
        expect(new TextDecoder().decode(encodeHead({ current: '000000000001-0000000a' }))).toBe('{"current":"000000000001-0000000a"}')
    })

    test.each([
        '',
        'nope',
        '[]',
        '{"current":1}',
        '{"current":"not-a-generation"}',
        '{"current":"000000000001-0000000a","convertedFrom":3}',
        '{"current":"000000000001-0000000a","convertedAt":"yesterday"}',
        '{"current":"000000000001-0000000a","convertedAt":-1}',
    ])('%j is not a head', (text) => {
        expect(parseHead(new TextEncoder().encode(text)).status).toBe('invalid')
    })

    test('sameHeadBytes treats absent as only equal to absent', () => {
        expect(sameHeadBytes(null, null)).toBe(true)
        expect(sameHeadBytes(null, A)).toBe(false)
        expect(sameHeadBytes(A, A.slice())).toBe(true)
        expect(sameHeadBytes(A, B)).toBe(false)
    })

    test('sameHeadRead tells absent, bytes and not-binary apart, and compares bytes by content', () => {
        expect(sameHeadRead(ABSENT, ABSENT)).toBe(true)
        expect(sameHeadRead(NOT_BINARY, NOT_BINARY)).toBe(true)
        expect(sameHeadRead(bytesRead(A), bytesRead(A.slice()))).toBe(true)
        expect(sameHeadRead(bytesRead(A), bytesRead(B))).toBe(false)
        expect(sameHeadRead(ABSENT, NOT_BINARY)).toBe(false)
        expect(sameHeadRead(ABSENT, bytesRead(new Uint8Array(0)))).toBe(false)
        expect(sameHeadRead(NOT_BINARY, bytesRead(new Uint8Array(0)))).toBe(false)
    })
})

async function raceOnce(first: HeadSwap, second: HeadSwap): Promise<string[]> {
    const [a, b] = await Promise.all([first.read(), second.read()])
    const outcomes = await Promise.all([first.swap(a, A), second.swap(b, B)])
    return outcomes
}

describe('the in-process mutex swap (desktop files)', () => {
    test('of two converters racing against an absent head exactly one wins, however often it is run', async () => {
        for (let i = 0; i < 50; i++) {
            const store = createFakeStore({ versioned: false })
            const outcomes = await raceOnce(createMutexHeadSwap(store), createMutexHeadSwap(store))
            expect(outcomes.slice().sort()).toEqual(['lost', 'won'])
        }
    })

    test('a swap against what was read replaces the head, and a swap against something older is lost without changing it', async () => {
        const store = createFakeStore({ versioned: false })
        const swap = createMutexHeadSwap(store)
        expect(await swap.swap(await swap.read(), A)).toBe('won')
        const stale = ABSENT
        expect(await swap.swap(stale, B)).toBe('lost')
        expect(store.peek(HEAD_KEY)).toEqual(A)
        expect(await swap.swap(await swap.read(), C)).toBe('won')
        expect(store.peek(HEAD_KEY)).toEqual(C)
    })

    test('a failing write is an unknown outcome (a rejection), and releases the mutex', async () => {
        const store = createFakeStore({ versioned: false })
        const swap = createMutexHeadSwap(store)
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })
        await expect(swap.swap(await swap.read(), A)).rejects.toThrow()
        expect(await swap.swap(await swap.read(), B)).toBe('won')
    })
})

describe('the Node swap (revision)', () => {
    test('of two converters racing against an absent head exactly one wins', async () => {
        for (let i = 0; i < 20; i++) {
            const store = createFakeStore({ versioned: true })
            const outcomes = await raceOnce(createNodeHeadSwap(store), createNodeHeadSwap(store))
            expect(outcomes.slice().sort()).toEqual(['lost', 'won'])
        }
    })

    test('a swap needs the revision the read reported', async () => {
        const store = createFakeStore({ versioned: true })
        await expect(createNodeHeadSwap(store).swap(ABSENT, A)).rejects.toBeInstanceOf(TypeError)
    })

    test('an absent head that was written and deleted still swaps on the tombstone\'s revision', async () => {
        const store = createFakeStore({ versioned: true })
        const swap = createNodeHeadSwap(store)
        await store.write(HEAD_KEY, A, 'unconditional')
        await store.delete(HEAD_KEY, 'unconditional')
        const read = await swap.read()
        expect(read.kind).toBe('absent')
        expect(read.kind === 'absent' && read.version).toBeGreaterThan(0)
        expect(await swap.swap(read, B)).toBe('won')
    })
})

describe('the IndexedDB swap on the raw connection', () => {
    // The unrelated key makes the database exist; a profile without the database is covered in headSwap.freshProfile.test.ts.
    beforeEach(async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.clear()
        await forage.setItem('unrelated', new Uint8Array([1]))
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('reads an absent head, swaps against it, and the store reads the value back in its own form', async () => {
        const swap = createIndexedDbHeadSwap()
        const first = await swap.read()
        expect(first).toEqual(ABSENT)
        expect(await swap.swap(first, A)).toBe('won')
        expect(await swap.read()).toEqual(bytesRead(A))
        const viaStore = await createIndexedDbStore().read(HEAD_KEY)
        expect(viaStore.bytes).toEqual(A)
    })

    test('of two connections racing against an absent head exactly one wins, in every one of 100 trials', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        const one = createIndexedDbHeadSwap()
        const two = createIndexedDbHeadSwap()
        const wins = [0, 0]
        for (let trial = 0; trial < 100; trial++) {
            await forage.removeItem(HEAD_KEY)
            const [readOne, readTwo] = await Promise.all([one.read(), two.read()])
            const [first, second] = await Promise.all([one.swap(readOne, A), two.swap(readTwo, B)])
            expect([first, second].sort(), `trial ${trial}`).toEqual(['lost', 'won'])
            wins[first === 'won' ? 0 : 1]++
        }
        expect(wins[0] + wins[1]).toBe(100)
    })

    test('a swap against a head that changed since the read is lost and leaves the value alone', async () => {
        const swap = createIndexedDbHeadSwap()
        const other = createIndexedDbHeadSwap()
        const stale = await swap.read()
        expect(await other.swap(await other.read(), B)).toBe('won')
        expect(await swap.swap(stale, A)).toBe('lost')
        expect(await swap.read()).toEqual(bytesRead(B))
    })

    test('a transaction that aborts for another reason is an unknown outcome (a rejection)', async () => {
        const swap = createIndexedDbHeadSwap()
        const read = await swap.read()
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError')
        })
        await expect(swap.swap(read, A)).rejects.toBeDefined()
        vi.restoreAllMocks()
        expect(await swap.read()).toEqual(ABSENT)
    })

    test('a connection the browser closed is replaced once', async () => {
        const swap = createIndexedDbHeadSwap()
        const read = await swap.read()
        const real = IDBDatabase.prototype.transaction
        let failures = 0
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
            if (failures++ === 0) {
                throw new DOMException('closing', 'InvalidStateError')
            }
            return real.apply(this, args)
        })
        expect(await swap.swap(read, A)).toBe('won')
    })

    test('a head stored as something that is not bytes reads as not-binary, and a swap against any other expectation leaves it alone', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, 'a string')
        const swap = createIndexedDbHeadSwap()
        expect(await swap.read()).toEqual(NOT_BINARY)
        expect(await swap.swap(ABSENT, A)).toBe('lost')
        expect(await swap.swap(bytesRead(B), A)).toBe('lost')
        expect(await forage.getItem(HEAD_KEY)).toBe('a string')
    })

    test('a swap that expects a not-binary head replaces it', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, 'a string')
        const swap = createIndexedDbHeadSwap()
        const read = await swap.read()
        expect(await swap.swap(read, A)).toBe('won')
        expect(await swap.read()).toEqual(bytesRead(A))
    })

    test('a stored number, boolean or object is a not-binary head as well', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        const swap = createIndexedDbHeadSwap()
        for (const value of [7, true, { current: 'x' }]) {
            await forage.setItem(HEAD_KEY, value)
            expect(await swap.read()).toEqual(NOT_BINARY)
        }
    })

    test.each([null, undefined])('a head entry stored as %s is a not-binary head, never an absent one', async (value) => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, value)
        expect(await forage.keys()).toContain(HEAD_KEY)
        const swap = createIndexedDbHeadSwap()
        expect(await swap.read()).toEqual(NOT_BINARY)
        expect(await swap.swap(ABSENT, A)).toBe('lost')
        expect(await forage.keys()).toContain(HEAD_KEY)
        expect(await swap.read()).toEqual(NOT_BINARY)
        expect(await swap.swap(NOT_BINARY, A)).toBe('won')
        expect(await swap.read()).toEqual(bytesRead(A))
    })

    test('a swap that expects a not-binary head loses once the head holds bytes', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, 'a string')
        const swap = createIndexedDbHeadSwap()
        const read = await swap.read()
        await forage.setItem(HEAD_KEY, B)
        expect(await swap.swap(read, A)).toBe('lost')
        expect(await swap.read()).toEqual(bytesRead(B))
    })

    test('a swap that expects a not-binary head loses once the head is gone', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, 'a string')
        const swap = createIndexedDbHeadSwap()
        const read = await swap.read()
        await forage.removeItem(HEAD_KEY)
        expect(await swap.swap(read, A)).toBe('lost')
        expect(await swap.read()).toEqual(ABSENT)
    })

    test('two owners on two connections: one converts, the other loses', async () => {
        // The block store itself runs on the in-memory store here; only the head goes through IndexedDB.
        const store = createFakeStore({ versioned: false })
        const input = makeSet({ characters: [{ chaId: 'alice' }] })
        const one = makeOwner(store, { headSwap: createIndexedDbHeadSwap() })
        const two = makeOwner(store, { headSwap: createIndexedDbHeadSwap() })
        const results = await Promise.all([
            one.owner.replaceWholeState(input, { requireAbsentHead: true }),
            two.owner.replaceWholeState(input, { requireAbsentHead: true }),
        ])
        expect(results.map((result) => result.kind).sort()).toEqual(['lost', 'won'])
    })
})

describe('the head has one writer (invariant H)', () => {
    test('every write of the head key is a swap, and a plain write of it by the owner is refused', async () => {
        const store = createFakeStore({ versioned: true })
        const wonSwaps: number[] = []
        const inner = createNodeHeadSwap(store)
        const counting: HeadSwap = {
            read: inner.read,
            swap: async (expected, next) => {
                const outcome = await inner.swap(expected, next)
                if (outcome === 'won') {
                    wonSwaps.push(1)
                }
                return outcome
            },
        }
        const input = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }], packed: ['bob'] })
        const { owner } = makeOwner(store, { headSwap: counting })
        await owner.seedEmptyProfile(input)
        await owner.readCommitted()
        await owner.commitSave(makeSet({ characters: [{ chaId: 'alice' }] }))
        await owner.replaceWholeState(input)
        await owner.inventory()
        await owner.readCommitted()
        const headWrites = store.ops.filter((op) => op.kind === 'write' && op.key === HEAD_KEY)
        expect(headWrites.length).toBe(wonSwaps.length)
        expect(headWrites.length).toBe(2)
        for (const write of headWrites) {
            expect(write.kind === 'write' && write.condition).toMatchObject({ ifVersion: expect.any(Number) })
        }
        const writeThroughOwner = (owner as unknown as { put(key: string, bytes: Uint8Array, condition: 'unconditional'): Promise<unknown> }).put.bind(owner)
        await expect(writeThroughOwner(HEAD_KEY, A, 'unconditional')).rejects.toMatchObject({ name: 'BlockOwnerStateError' })
        expect(store.ops.filter((op) => op.kind === 'write' && op.key === HEAD_KEY).length).toBe(2)
    })

    test('a swap seeded only through seedStore leaves the head readable by the other adapters\' swaps', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, makeSet())
        const read = await createMutexHeadSwap(store).read()
        expect(read.kind).toBe('bytes')
    })
})
