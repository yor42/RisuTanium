/**
 * The progress of an attached audio or video file's write: `writeAppInlay` hands the
 * callback to the store's `writeBlob`, and `postInlayAsset` turns the store's reports
 * into `{ name, written, total }` after an initial report of 0 bytes. A refused file
 * reports nothing, nothing is reported after the write settles, and a callback that
 * throws never changes the stored value. The memory store's `writeBlob` is wrapped to
 * report the way the Tauri store does; the Tauri store itself is covered in its own tests.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../../memory/busyActions'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import { postInlayAsset, type InlayAsset, type InlayWriteProgress } from '../inlays'
import { readAppInlay, withInlayLock, writeAppInlay } from '../inlayStore'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            keys: vi.fn(async () => []),
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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('src/ts/util'))

//#endregion

let store: MemoryByteStore

beforeEach(() => {
    resetBusyActionsForTest()
    store = createMemoryByteStore({ blobs: true })
    injectAppStore(store, 'indexeddb')
})

/** Makes the store's `writeBlob` call its progress callback with `steps`, the way a store that reports does, and then store the Blob. */
function reportingStore(steps: Array<[number, number]>): void {
    const stored = store.writeBlob!.bind(store)
    store.writeBlob = async (key, blob, condition, onProgress) => {
        for (const [written, total] of steps) {
            onProgress?.(written, total)
        }
        return await stored(key, blob, condition)
    }
}

function videoValue(size: number): InlayAsset {
    return { name: 'clip.mp4', ext: 'mp4', type: 'video', data: new Blob([new Uint8Array(size)]) } as InlayAsset
}

describe('writeAppInlay progress', () => {
    // Regression reproducer: the option was not forwarded to the store before.
    test('hands onProgress to the store writeBlob, which reports through it', async () => {
        reportingStore([[3, 7]])
        const reports: Array<[number, number]> = []

        await withInlayLock('prog-1', async () => {
            await writeAppInlay(store, 'prog-1', videoValue(7), { onProgress: (written, total) => { reports.push([written, total]) } })
        })

        expect(reports).toEqual([[3, 7]])
        expect(store.blobWrites).toHaveLength(1)
    })

    // Compatibility guard: passes before and after; no option means no callback reaches the store.
    test('without onProgress the store gets no callback', async () => {
        const seen: unknown[] = []
        const stored = store.writeBlob!.bind(store)
        store.writeBlob = async (key, blob, condition, onProgress) => {
            seen.push(onProgress)
            return await stored(key, blob, condition)
        }

        await withInlayLock('prog-2', async () => {
            await writeAppInlay(store, 'prog-2', videoValue(7))
        })

        expect(seen).toEqual([undefined])
    })
})

describe('postInlayAsset progress', () => {
    // Regression reproducer: nothing was reported before.
    test('reports 0 after the size check, then each report of the store, and nothing after it settles', async () => {
        reportingStore([[4, 10], [10, 10]])
        const reports: InlayWriteProgress[] = []
        let settled = false
        const late: InlayWriteProgress[] = []

        const posting = postInlayAsset({ name: 'clip.mp4', data: new Blob([new Uint8Array(10)]) }, (progress) => {
            (settled ? late : reports).push(progress)
        })
        void posting.then(() => { settled = true }, () => { settled = true })
        const id = await posting
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(id).toBe('fixed-uuid')
        expect(reports).toEqual([
            { name: 'clip.mp4', written: 0, total: 10 },
            { name: 'clip.mp4', written: 4, total: 10 },
            { name: 'clip.mp4', written: 10, total: 10 },
        ])
        expect(late).toEqual([])
        expect((await readAppInlay('fixed-uuid'))?.name).toBe('clip.mp4')
    })

    // Compatibility guard: passes before and after (a refused file never reached a write).
    test('a refused file reports nothing and writes nothing', async () => {
        const reports: InlayWriteProgress[] = []
        const over = { name: 'clip.mp4', data: { byteLength: 1024 * 1024 * 1024 + 1 } as unknown as Uint8Array }

        const result = await postInlayAsset(over, (progress) => { reports.push(progress) })

        expect(result).toMatchObject({ refused: 'too-large', name: 'clip.mp4' })
        expect(reports).toEqual([])
        expect(store.writes).toEqual([])
    })

    // Compatibility guard: passes before and after (the callback was never called before).
    test('a callback that throws, at the first report and at the store reports, still stores the value', async () => {
        reportingStore([[4, 10], [10, 10]])

        const id = await postInlayAsset({ name: 'clip.mp4', data: new Blob([new Uint8Array(10)]) }, () => {
            throw new Error('progress callback failure')
        })

        expect(id).toBe('fixed-uuid')
        expect(store.blobWrites).toHaveLength(1)
        expect((await readAppInlay('fixed-uuid'))?.name).toBe('clip.mp4')
    })
})
