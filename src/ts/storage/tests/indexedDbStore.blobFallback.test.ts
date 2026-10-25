// @vitest-environment node
/**
 * A browser that cannot keep a Blob in IndexedDB (`DataCloneError`, or an `UnknownError` of the put or its
 * transaction) makes the adapter's Blob writes reject with `StoreBlobUnsupportedError`, having stored nothing. The
 * piece writer answers it with the bytes whole, within `WEB_ASSET_LIMIT_BYTES`; above that bound
 * the error reaches the caller. Any other failure (a full disk, an abort) is never turned into this one and never
 * falls back. The bound is mocked to 1000 bytes so the fixtures stay small. `fake-indexeddb` stands in for the
 * browser's IndexedDB; the failures are injected on `IDBObjectStore.prototype.put`, which proves the mapping and the
 * fallback, not what any real browser raises.
 *
 * Titles say what a test pins: `reproducer` fails on the code before the change, `guard` holds before and after.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/storage/nodeBodyLimit'), async (importOriginal) => ({
    ...(await importOriginal()),
    WEB_ASSET_LIMIT_BYTES: 1000,
}))

import { StoreBlobUnsupportedError } from 'src/ts/storage/store/errors'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

const upstream = localforage.createInstance({ name: 'risuai' })

function isBlob(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Blob]'
}

function pattern(length: number, seed: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

type Failure = 'DataCloneError' | 'UnknownError' | 'QuotaExceededError'

/** Makes every put of a Blob fail the way the named browser error would; a put of anything else is untouched. */
function failBlobPuts(failure: Failure): { puts: () => number } {
    const realPut = IDBObjectStore.prototype.put
    let puts = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (!isBlob(value)) {
            return realPut.call(this, value, key)
        }
        puts++
        if (failure === 'DataCloneError') {
            throw new DOMException('The Blob could not be cloned.', 'DataCloneError')
        }
        const request = realPut.call(this, value, key)
        const transaction = this.transaction
        Object.defineProperty(transaction, 'error', { value: new DOMException('The transaction failed.', failure), configurable: true })
        transaction.abort()
        return request
    })
    return { puts: () => puts }
}

beforeEach(async () => {
    await upstream.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe.each<Failure>(['DataCloneError', 'UnknownError'])('a browser that raises %s for a Blob', (failure) => {
    test('reproducer: writeBlob rejects with StoreBlobUnsupportedError and stores nothing', async () => {
        const store = createIndexedDbStore()
        failBlobPuts(failure)

        await expect(store.writeBlob!('assets/a.png', new Blob([pattern(50, 1)]), 'unconditional')).rejects.toBeInstanceOf(StoreBlobUnsupportedError)

        expect(await store.has('assets/a.png')).toBe(false)
    })

    test('reproducer: the piece writer stores the bytes whole within the bound, readable through read and not a Blob', async () => {
        const store = createIndexedDbStore()
        const payload = pattern(900, 2)
        failBlobPuts(failure)
        const writer = store.openWriter!('assets/incoming-1')

        await writer.write(payload.subarray(0, 400))
        await writer.write(payload.subarray(400))
        await writer.finish('assets/final.png')

        expect(Array.from((await store.read('assets/final.png')).bytes!)).toEqual(Array.from(payload))
        expect(await store.readBlob!('assets/final.png')).toBeNull()
        expect(await store.list('assets/')).toEqual(['assets/final.png'])
    })

    test('reproducer: the piece writer above the bound rejects with the unsupported error and stores nothing', async () => {
        const store = createIndexedDbStore()
        failBlobPuts(failure)
        const writer = store.openWriter!('assets/incoming-2')

        await writer.write(pattern(600, 3))
        await writer.write(pattern(600, 4))
        await expect(writer.finish('assets/final.png')).rejects.toBeInstanceOf(StoreBlobUnsupportedError)

        expect(await store.list('assets/')).toEqual([])
    })

})

describe('a failure that is not a missing Blob capability', () => {
    test('guard: a quota failure of the put rejects as it is, from writeBlob and from the piece writer, with no whole-bytes fallback', async () => {
        const store = createIndexedDbStore()
        failBlobPuts('QuotaExceededError')

        await expect(store.writeBlob!('assets/q.png', new Blob([pattern(50, 7)]), 'unconditional')).rejects.toMatchObject({ name: 'QuotaExceededError' })
        const writer = store.openWriter!('assets/incoming-3')
        await writer.write(pattern(100, 8))
        const finished = writer.finish('assets/q2.png')
        await expect(finished).rejects.toMatchObject({ name: 'QuotaExceededError' })
        await expect(finished).rejects.not.toBeInstanceOf(StoreBlobUnsupportedError)

        expect(await store.list('assets/')).toEqual([])
    })

    test('guard: a put that succeeds is not touched by the fallback', async () => {
        const store = createIndexedDbStore()
        const writer = store.openWriter!('assets/incoming-4')

        await writer.write(pattern(300, 9))
        await writer.finish('assets/ok.png')

        expect(isBlob(await store.readBlob!('assets/ok.png'))).toBe(true)
    })
})
