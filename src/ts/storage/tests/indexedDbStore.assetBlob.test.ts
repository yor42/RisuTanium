// @vitest-environment node
/**
 * The IndexedDB adapter keeps a Blob under a key in `assets/` as well as under an inlay body key
 * (`writeBlob`, `readBlob`, `readValue`, and `openWriter` as a Blob accumulator), against `fake-indexeddb`.
 * `fake-indexeddb/auto` is imported first, before LocalForage is evaluated. A pass is no evidence about a real
 * browser's Blob paging, quota or memory use.
 *
 * Titles say what a test pins: `reproducer` fails on the code before the change, `guard` holds before and after.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StoreInvalidKeyError, StoreNotBinaryError } from 'src/ts/storage/store/errors'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

const upstream = localforage.createInstance({ name: 'risuai' })

const BODY = 'inlays/b-clip.0123456789abcdef'

function bytesOf(...values: number[]): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(values)
}

function pattern(length: number, seed: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

async function bytesOfBlob(blob: Blob): Promise<number[]> {
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

/** The raw value IndexedDB holds under `key`, read on a plain connection of the test's own. */
async function rawStored(key: string): Promise<unknown> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('risuai')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        return await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction('keyvaluepairs', 'readonly').objectStore('keyvaluepairs').get(key)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    } finally {
        database.close()
    }
}

beforeEach(async () => {
    await upstream.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('writeBlob, readBlob and readValue on an asset key', () => {
    test('reproducer: a File written under assets/ is kept as a plain Blob without a type, and read returns its bytes', async () => {
        const store = createIndexedDbStore()
        const payload = pattern(600, 3)

        await store.writeBlob!('assets/x.png', new File([payload], 'x.png', { type: 'text/html' }), 'unconditional')

        const blob = await store.readBlob!('assets/x.png')
        expect(blob).not.toBeNull()
        expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
        expect(blob!.type).toBe('')
        expect(await bytesOfBlob(blob!)).toEqual(Array.from(payload))
        expect(Array.from((await store.read('assets/x.png')).bytes!)).toEqual(Array.from(payload))
        expect(Object.prototype.toString.call(await rawStored('assets/x.png'))).toBe('[object Blob]')
    })

    test('guard: an inlay body key keeps the type of the Blob it is given', async () => {
        const store = createIndexedDbStore()

        await store.writeBlob!(BODY, new Blob([bytesOf(1, 2)], { type: 'video/mp4' }), 'unconditional')

        expect((await store.readBlob!(BODY))!.type).toBe('video/mp4')
    })

    test('guard: any other key is refused and nothing is written', async () => {
        const store = createIndexedDbStore()

        for (const key of ['database/database.bin', 'inlays/m-clip', 'remotes/x']) {
            await expect(store.writeBlob!(key, new Blob(['x']), 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
            await expect(store.readValue!(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)
            expect(await store.has(key)).toBe(false)
        }
    })

    test('guard: the temporary name a picked file is saved under (assets/incoming-<uuid>) is accepted, readable, deletable and absent from list afterwards (passes before and after)', async () => {
        const store = createIndexedDbStore()
        const key = `assets/incoming-${crypto.randomUUID()}`
        const payload = pattern(300, 9)

        await store.writeBlob!(key, new File([payload], 'x.mp4'), 'unconditional')

        expect(await store.has(key)).toBe(true)
        expect(await bytesOfBlob((await store.readBlob!(key))!)).toEqual(Array.from(payload))
        expect(await store.list('assets/')).toEqual([key])
        await store.delete(key, 'unconditional')
        expect(await store.readBlob!(key)).toBeNull()
        expect(await store.list('assets/')).toEqual([])
    })

    test('reproducer: readValue gives the Blob for a Blob value, the bytes for a bytes value and null for no value, by one raw get each', async () => {
        const store = createIndexedDbStore()
        await store.writeBlob!('assets/blob.png', new Blob([bytesOf(5, 6, 7)]), 'unconditional')
        await store.write('assets/bytes.png', bytesOf(1, 2, 3), 'unconditional')
        const realGet = IDBObjectStore.prototype.get
        const gets: unknown[] = []
        vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
            gets.push(query)
            return realGet.call(this, query)
        })

        const blob = await store.readValue!('assets/blob.png')
        const bytes = await store.readValue!('assets/bytes.png')
        const absent = await store.readValue!('assets/absent.png')

        expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
        expect(await bytesOfBlob(blob as Blob)).toEqual([5, 6, 7])
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3])
        expect(absent).toBeNull()
        expect(gets).toEqual(['assets/blob.png', 'assets/bytes.png', 'assets/absent.png'])
    })

    test('guard: readValue gives a bytes value that was stored as a view over a larger buffer as exactly its own bytes', async () => {
        const store = createIndexedDbStore()
        const larger = pattern(40, 9)
        await upstream.setItem('assets/view.png', larger.subarray(10, 15))

        const value = await store.readValue!('assets/view.png') as Uint8Array

        expect(value.byteLength).toBe(5)
        expect(value.buffer.byteLength).toBe(5)
        expect(Array.from(value)).toEqual(Array.from(larger.subarray(10, 15)))
    })

    test('reproducer: an entry in LocalForage\'s encoded form is not a Blob to readBlob, and readValue returns its bytes like read does', async () => {
        const store = createIndexedDbStore()
        await upstream.setItem(BODY, { __local_forage_encoded_blob: true, data: 'AQID', type: 'audio/mpeg' })

        expect(await store.readBlob!(BODY)).toBeNull()
        expect(Array.from(await store.readValue!(BODY) as Uint8Array)).toEqual([1, 2, 3])
    })

    test('guard: data that is not binary rejects readValue like read, and readBlob still answers null', async () => {
        const store = createIndexedDbStore()
        await upstream.setItem('assets/flag.png', 'not bytes')

        await expect(store.readValue!('assets/flag.png')).rejects.toBeInstanceOf(StoreNotBinaryError)
        await expect(store.read('assets/flag.png')).rejects.toBeInstanceOf(StoreNotBinaryError)
        expect(await store.readBlob!('assets/flag.png')).toBeNull()
    })

    test('guard: a connection the browser closed (InvalidStateError opening the transaction) is replaced and the put is retried once', async () => {
        const store = createIndexedDbStore()
        await store.write('assets/seed.png', bytesOf(1), 'unconditional')
        const realTransaction = IDBDatabase.prototype.transaction
        let thrown = 0
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
            if (args[1] === 'readwrite' && thrown === 0) {
                thrown++
                throw new DOMException('The connection is closing.', 'InvalidStateError')
            }
            return realTransaction.apply(this, args)
        })

        await store.writeBlob!('assets/retried.png', new Blob([bytesOf(2, 3)]), 'unconditional')

        expect(thrown).toBe(1)
        expect(await bytesOfBlob((await store.readBlob!('assets/retried.png'))!)).toEqual([2, 3])
    })

    test('guard: any other failure to open the transaction is not retried and stores nothing', async () => {
        const store = createIndexedDbStore()
        await store.write('assets/seed.png', bytesOf(1), 'unconditional')
        const realTransaction = IDBDatabase.prototype.transaction
        let thrown = 0
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
            if (args[1] === 'readwrite' && thrown === 0) {
                thrown++
                throw new TypeError('not a connection problem')
            }
            return realTransaction.apply(this, args)
        })

        await expect(store.writeBlob!('assets/not-retried.png', new Blob([bytesOf(2, 3)]), 'unconditional')).rejects.toThrow('not a connection problem')

        expect(thrown).toBe(1)
        expect(await store.has('assets/not-retried.png')).toBe(false)
    })

    test('guard: a put whose transaction aborts rejects and the previous value is still read', async () => {
        const store = createIndexedDbStore()
        await store.write('assets/keep.png', bytesOf(4, 4, 4), 'unconditional')
        const realPut = IDBObjectStore.prototype.put
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
            const request = realPut.apply(this, args)
            this.transaction.abort()
            return request
        })

        await expect(store.writeBlob!('assets/keep.png', new Blob([bytesOf(9)]), 'unconditional')).rejects.toBeTruthy()

        vi.restoreAllMocks()
        expect(Array.from((await store.read('assets/keep.png')).bytes!)).toEqual([4, 4, 4])
        expect(await store.readBlob!('assets/keep.png')).toBeNull()
    })
})

describe('openWriter as a Blob accumulator', () => {
    test('reproducer: the pieces become one Blob under the final key, nothing exists under the name or the key before finish, and no other key is created', async () => {
        const store = createIndexedDbStore()
        const writer = store.openWriter!('assets/incoming-1')
        const payload = pattern(3000, 4)

        await writer.write(payload.subarray(0, 1000))
        await writer.write(payload.subarray(1000, 1001))
        await writer.write(payload.subarray(1001))
        expect(await store.list('assets/')).toEqual([])
        await writer.finish('assets/final.png')

        expect(await store.list('assets/')).toEqual(['assets/final.png'])
        const blob = await store.readBlob!('assets/final.png')
        expect(blob).not.toBeNull()
        expect(await bytesOfBlob(blob!)).toEqual(Array.from(payload))
    })

    test('reproducer: finish(finalKey) keeps a value the key already holds and discards the pieces', async () => {
        const store = createIndexedDbStore()
        await store.write('assets/final.png', bytesOf(7, 7), 'unconditional')
        const writer = store.openWriter!('assets/incoming-2')

        await writer.write(bytesOf(1, 2, 3))
        await writer.finish('assets/final.png')

        expect(Array.from((await store.read('assets/final.png')).bytes!)).toEqual([7, 7])
        expect(await store.readBlob!('assets/final.png')).toBeNull()
        expect(await store.list('assets/')).toEqual(['assets/final.png'])
    })

    test('reproducer: finish() without a key replaces the value under the key the writer was opened for', async () => {
        const store = createIndexedDbStore()
        await store.write('assets/target.png', bytesOf(7, 7), 'unconditional')
        const writer = store.openWriter!('assets/target.png')

        await writer.write(bytesOf(1, 2, 3))
        await writer.finish()

        expect(Array.from((await store.read('assets/target.png')).bytes!)).toEqual([1, 2, 3])
        expect(await bytesOfBlob((await store.readBlob!('assets/target.png'))!)).toEqual([1, 2, 3])
    })

    test('reproducer: abort leaves nothing behind, never rejects, and a write after it is refused', async () => {
        const store = createIndexedDbStore()
        const writer = store.openWriter!('assets/incoming-3')
        await writer.write(bytesOf(1, 2, 3))

        await writer.abort()
        await writer.abort()

        await expect(writer.write(bytesOf(4))).rejects.toBeTruthy()
        expect(await store.list('assets/')).toEqual([])
    })

    test('guard: pieces past the fold size are all kept in order', async () => {
        const store = createIndexedDbStore()
        const writer = store.openWriter!('assets/incoming-4')
        const piece = pattern(3 * 1024 * 1024, 2)
        const expected: number[] = []

        for (let index = 0; index < 4; index++) {
            const next = piece.map((value) => (value + index) & 255)
            await writer.write(next)
            expected.push(next[0], next[next.length - 1])
        }
        await writer.finish('assets/folded.png')

        const blob = (await store.readBlob!('assets/folded.png'))!
        expect(blob.size).toBe(4 * piece.length)
        const seen: number[] = []
        for (let index = 0; index < 4; index++) {
            const part = new Uint8Array(await blob.slice(index * piece.length, (index + 1) * piece.length).arrayBuffer())
            seen.push(part[0], part[part.length - 1])
        }
        expect(seen).toEqual(expected)
    })

    test('guard: a key outside assets/ is refused for the writer and for its final key', async () => {
        const store = createIndexedDbStore()

        expect(() => store.openWriter!('database/database.bin')).toThrow(StoreInvalidKeyError)
        const writer = store.openWriter!('assets/incoming-5')
        await writer.write(bytesOf(1))
        await expect(writer.finish('database/database.bin')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(await store.has('database/database.bin')).toBe(false)
    })
})
