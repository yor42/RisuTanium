/**
 * The inlay export of a local backup over in-memory stores: no entry exceeds
 * `PART_DATA_MAX`, the parts of a large body are in order and whole, and a body
 * is read one part at a time. Synthetic data only.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { readAppInlayRecord, writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { PART_DATA_MAX, headerLengthOf, parseInlayEntryName, parseInlayHeader } from '../inlayBackupCodec'
import { writeInlaysToBackup, type InlayBackupSink } from '../inlayBackupExport'

/** What the old `inlay` database holds, and whether listing it fails. */
const legacy = vi.hoisted(() => ({ values: new Map<string, unknown>(), failKeys: false }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => legacy.values.get(key) ?? null),
            keys: vi.fn(async () => {
                if (legacy.failKeys) {
                    throw new Error('scratch: the old store is closed')
                }
                return [...legacy.values.keys()]
            }),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

const MIB = 1024 * 1024
/** A multiple of 251, so a body made of copies of one unit repeats the pattern `index % 251` end to end. */
const UNIT = 251 * 33_500

interface Written {
    name: string
    /** The data of the entry, as the pieces written for it. */
    pieces: Uint8Array[]
    length: number
}

function recordingSink(): { sink: InlayBackupSink, entries: Written[] } {
    const entries: Written[] = []
    let open: { entry: Written, expected: number } | null = null
    const sink: InlayBackupSink = {
        async writeBackup(name, data) {
            entries.push({ name, pieces: [data.slice()], length: data.length })
        },
        async writeBackupHeader(name, dataLength) {
            const entry: Written = { name, pieces: [], length: 0 }
            entries.push(entry)
            open = { entry, expected: dataLength }
        },
        async write(data) {
            if (open === null) {
                throw new Error('a body was written with no header')
            }
            open.entry.pieces.push(data.slice())
            open.entry.length += data.length
            if (open.entry.length === open.expected) {
                open = null
            }
        },
    }
    return { sink, entries }
}

function unitOf(): Uint8Array {
    const unit = new Uint8Array(UNIT)
    for (let i = 0; i < UNIT; i++) {
        unit[i] = i % 251
    }
    return unit
}

function patternedBlob(copies: number): Blob {
    const unit = unitOf()
    return new Blob(Array.from({ length: copies }, () => unit as unknown as Uint8Array<ArrayBuffer>), { type: 'video/mp4' })
}

/** The data of one written entry as one array. */
function dataOf(entry: Written): Uint8Array {
    const out = new Uint8Array(entry.length)
    let offset = 0
    for (const piece of entry.pieces) {
        out.set(piece, offset)
        offset += piece.length
    }
    return out
}

let store: MemoryByteStore

function putTo(target: ByteStore, id: string, value: InlayAsset): Promise<void> {
    return writeAppInlay(target, id, value)
}

beforeEach(() => {
    legacy.values.clear()
    legacy.failKeys = false
    store = createMemoryByteStore({ blobs: true })
    injectAppStore(store, 'indexeddb')
})

describe('the parts of a large inlay', () => {
    test('acceptance: an inlay of 200 MiB is written as ordered parts of at most PART_DATA_MAX, whole and read one part at a time', async () => {
        const copies = 25
        const blob = patternedBlob(copies)
        expect(blob.size).toBeGreaterThan(200 * MIB)
        await putTo(store, 'big', { name: 'big.mp4', ext: 'mp4', type: 'video', data: blob })
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, store, { streaming: false })

        expect(result).toEqual({ exported: 1, leftOut: [], oldStoreUnlisted: false })
        expect(entries).toHaveLength(4)
        for (const entry of entries) {
            expect(entry.length).toBeLessThanOrEqual(PART_DATA_MAX)
        }
        const hashes = new Set(entries.map((entry) => parseInlayEntryName(entry.name)!.hash))
        expect(hashes.size).toBe(1)
        expect(entries.map((entry) => parseInlayEntryName(entry.name)!.index)).toEqual([0, 1, 2, 3])

        const first = dataOf(entries[0])
        const headerLength = headerLengthOf(first.subarray(0, 4))!
        const header = parseInlayHeader(first.subarray(4, 4 + headerLength))!
        expect(header).toMatchObject({ id: 'big', repr: 'blob', mime: 'video/mp4', len: blob.size, parts: 4, fields: { name: 'big.mp4', ext: 'mp4', type: 'video' } })

        // Every byte of every part is the next byte of the body.
        let position = 0
        const bodyOf = [first.subarray(4 + headerLength), ...entries.slice(1).map(dataOf)]
        let wrong = 0
        for (const body of bodyOf) {
            for (let i = 0; i < body.length; i++, position++) {
                if (body[i] !== position % 251) {
                    wrong++
                }
            }
        }
        expect(position).toBe(blob.size)
        expect(wrong).toBe(0)

        const record = (await readAppInlayRecord(store, 'big'))!
        expect(store.reads).not.toContain(record.body)
        expect(store.blobReads).toContain(record.body)
    })

    test('acceptance: on a store without Blob support the body is read once and still split into parts', async () => {
        const bytesStore = createMemoryByteStore()
        injectAppStore(bytesStore, 'node')
        const body = new Uint8Array(70 * MIB)
        for (let i = 0; i < body.length; i += 4096) {
            body[i] = (i / 4096) % 251
        }
        await putTo(bytesStore, 'v', { name: 'v.mp4', ext: 'mp4', type: 'video', data: new Blob([body as unknown as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }) })
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, bytesStore, { streaming: false })

        expect(result.exported).toBe(1)
        expect(entries).toHaveLength(2)
        expect(entries.map((entry) => entry.length <= PART_DATA_MAX)).toEqual([true, true])
        const first = dataOf(entries[0])
        const headerLength = headerLengthOf(first.subarray(0, 4))!
        const rebuilt = new Uint8Array(body.length)
        const firstBody = first.subarray(4 + headerLength)
        rebuilt.set(firstBody, 0)
        rebuilt.set(dataOf(entries[1]), firstBody.length)
        expect(Buffer.compare(Buffer.from(rebuilt), Buffer.from(body))).toBe(0)
    })

    test('acceptance: a small inlay is one part of header and body', async () => {
        await putTo(store, 'small', { name: 's', ext: 'png', type: 'image', data: new Blob(['abc'], { type: 'image/png' }) })
        const { sink, entries } = recordingSink()

        await writeInlaysToBackup(sink, store, { streaming: false })

        expect(entries).toHaveLength(1)
        const data = dataOf(entries[0])
        const headerLength = headerLengthOf(data.subarray(0, 4))!
        expect(new TextDecoder().decode(data.subarray(4 + headerLength))).toBe('abc')
    })
})

describe('what an export leaves out', () => {
    test('acceptance: an inlay whose body cannot be read is named and the others are written', async () => {
        await putTo(store, 'bad', { name: 'b', ext: 'png', type: 'image', data: new Blob(['bad'], { type: 'image/png' }) })
        await putTo(store, 'good', { name: 'g', ext: 'png', type: 'image', data: new Blob(['good'], { type: 'image/png' }) })
        const bad = (await readAppInlayRecord(store, 'bad'))!
        store.failRead = (key) => (key === bad.body ? new Error('scratch: unreadable') : null)
        // No Blob to hand over for it, so the bytes are read.
        store.readBlob = async (key) => (key === bad.body ? null : (store.blobs.get(key) ?? null))
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, store, { streaming: false })

        expect(result).toEqual({ exported: 1, leftOut: [{ id: 'bad', reason: 'unreadable' }], oldStoreUnlisted: false })
        expect(entries).toHaveLength(1)
    })

    test('acceptance: an app store body that cannot be read is exported from the old store when that holds the id', async () => {
        await putTo(store, 'a', { name: 'app-copy', ext: 'png', type: 'image', data: new Blob(['app'], { type: 'image/png' }) })
        legacy.values.set('a', { name: 'old-copy', ext: 'png', type: 'image', data: new Blob(['old!'], { type: 'image/png' }) })
        const record = (await readAppInlayRecord(store, 'a'))!
        store.failRead = (key) => (key === record.body ? new Error('scratch: unreadable') : null)
        store.readBlob = async () => null
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, store, { streaming: false })

        expect(result).toEqual({ exported: 1, leftOut: [], oldStoreUnlisted: false })
        const data = dataOf(entries[0])
        const headerLength = headerLengthOf(data.subarray(0, 4))!
        expect(parseInlayHeader(data.subarray(4, 4 + headerLength))!.fields).toMatchObject({ name: 'old-copy' })
        expect(new TextDecoder().decode(data.subarray(4 + headerLength))).toBe('old!')
    })

    test('acceptance: an inlay unreadable in both stores is named', async () => {
        await putTo(store, 'a', { name: 'app-copy', ext: 'png', type: 'image', data: new Blob(['app'], { type: 'image/png' }) })
        const record = (await readAppInlayRecord(store, 'a'))!
        store.failRead = (key) => (key === record.body ? new Error('scratch: unreadable') : null)
        store.readBlob = async () => null
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, store, { streaming: false })

        expect(result.leftOut).toEqual([{ id: 'a', reason: 'unreadable' }])
        expect(entries).toEqual([])
    })

    test('acceptance: an old store that cannot be listed is reported, and the app store inlays are still written', async () => {
        await putTo(store, 'a', { name: 'a', ext: 'png', type: 'image', data: new Blob(['a'], { type: 'image/png' }) })
        legacy.failKeys = true
        const { sink, entries } = recordingSink()

        const result = await writeInlaysToBackup(sink, store, { streaming: false })

        expect(result).toEqual({ exported: 1, leftOut: [], oldStoreUnlisted: true })
        expect(entries).toHaveLength(1)
    })

    test('acceptance: the sink failing stops the export', async () => {
        await putTo(store, 'a', { name: 'a', ext: 'png', type: 'image', data: new Blob(['a'], { type: 'image/png' }) })
        const sink: InlayBackupSink = {
            writeBackup: async () => { throw new Error('scratch: the file cannot be written') },
            writeBackupHeader: async () => { throw new Error('scratch: the file cannot be written') },
            write: async () => { throw new Error('scratch: the file cannot be written') },
        }

        await expect(writeInlaysToBackup(sink, store, { streaming: false })).rejects.toThrow('cannot be written')
    })
})
