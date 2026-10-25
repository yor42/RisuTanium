// @vitest-environment node
/**
 * In a browser whose LocalForage Blob-support probe answers false (an old Chrome), LocalForage's `setItem` turns a
 * Blob into a base64 string in memory before storing it. The adapter's Blob writes use a raw put instead, so the
 * Blob is stored as the Blob it is. This file is separate because LocalForage caches the probe's answer per module
 * instance: the user agent below is set before LocalForage is first evaluated and stays for the whole file.
 * `fake-indexeddb` stands in for the browser's IndexedDB; a pass says nothing about a real old browser.
 *
 * Titles say what a test pins: `reproducer` fails on the code before the change, `guard` holds before and after.
 */
import { vi } from 'vitest'

vi.hoisted(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 Chrome/42.0' }, configurable: true })
    // LocalForage's encoder (reached only when the probe says no Blobs) needs a FileReader; Node has none.
    ;(globalThis as { FileReader?: unknown }).FileReader = class {
        result: string | null = null
        onloadend: ((event: { target: unknown }) => void) | null = null
        onerror: ((error: unknown) => void) | null = null
        readAsBinaryString(blob: Blob): void {
            blob.arrayBuffer().then((buffer) => {
                this.result = Buffer.from(buffer).toString('latin1')
                this.onloadend?.({ target: this })
            }, (error) => this.onerror?.(error))
        }
    }
})

import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { beforeEach, describe, expect, test } from 'vitest'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

const upstream = localforage.createInstance({ name: 'risuai' })

const BODY = 'inlays/b-clip.0123456789abcdef'

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

function isEncoded(value: unknown): boolean {
    return typeof value === 'object' && value !== null && (value as { __local_forage_encoded_blob?: unknown }).__local_forage_encoded_blob === true
}

beforeEach(async () => {
    await upstream.clear()
})

describe('a browser whose LocalForage probe says it cannot store Blobs', () => {
    test('guard: the seam works: LocalForage setItem of a Blob stores an encoded object here', async () => {
        await upstream.setItem(BODY, new Blob([Uint8Array.from([1, 2, 3])]))

        expect(isEncoded(await rawStored(BODY))).toBe(true)
    })

    test('reproducer: writeBlob stores a real Blob under an asset key and under an inlay body key, never an encoded object', async () => {
        const store = createIndexedDbStore()

        await store.writeBlob!('assets/a.png', new Blob([Uint8Array.from([4, 5, 6])]), 'unconditional')
        await store.writeBlob!(BODY, new Blob([Uint8Array.from([7, 8, 9])], { type: 'audio/mpeg' }), 'unconditional')

        for (const key of ['assets/a.png', BODY]) {
            const stored = await rawStored(key)
            expect(isEncoded(stored)).toBe(false)
            expect(Object.prototype.toString.call(stored)).toBe('[object Blob]')
            expect(Object.prototype.toString.call(await store.readBlob!(key))).toBe('[object Blob]')
        }
        expect(Array.from((await store.read('assets/a.png')).bytes!)).toEqual([4, 5, 6])
        expect(Array.from((await store.read(BODY)).bytes!)).toEqual([7, 8, 9])
    })

    test('reproducer: an accumulated asset is stored as a real Blob, never an encoded object', async () => {
        const store = createIndexedDbStore()
        const writer = store.openWriter!('assets/incoming-probe')

        await writer.write(Uint8Array.from([1, 1]))
        await writer.write(Uint8Array.from([2, 2]))
        await writer.finish('assets/acc.png')

        const stored = await rawStored('assets/acc.png')
        expect(isEncoded(stored)).toBe(false)
        expect(Object.prototype.toString.call(stored)).toBe('[object Blob]')
        expect(Array.from((await store.read('assets/acc.png')).bytes!)).toEqual([1, 1, 2, 2])
    })
})
