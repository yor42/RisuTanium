/**
 * The restore side of the inlay limits: the collector and the oversize listing apply the limit of each inlay's type,
 * so an Android video above 200 MiB is left out as too large and the notice carries the 200 MiB that applied, while
 * other inlays follow the store's limit. Headers claim large lengths over small bodies; no large buffer exists.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { inlayAttachmentLimit } from '../inlayStore'
import { InlayRestoreCollector, listOversizedInlays } from 'src/ts/drive/inlayBackupImport'
import { inlayEntryName, inlayIdHash, partsFor } from 'src/ts/drive/inlayBackupCodec'
import type { BackupIndexEntry } from 'src/ts/drive/backupContainer'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'

const h = vi.hoisted(() => ({ os: 'windows' as string }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn(), keys: vi.fn(async () => []) }) },
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
const GIB = 1024 * MIB

let store: MemoryByteStore

beforeEach(() => {
    h.os = 'android'
    store = createMemoryByteStore()
    injectAppStore(store, 'tauri')
})

/** Part 0 of an inlay of `type` whose header claims `claimed` bytes; the body it carries is `body`. */
async function part0(id: string, type: string, claimed: number, body = new Uint8Array(8)): Promise<{ name: string, hash: string, data: Blob }> {
    const hash = await inlayIdHash(id)
    const header = new TextEncoder().encode(JSON.stringify({
        v: 1, id, repr: 'blob', mime: `${type}/x`, fields: { name: id, ext: 'bin', type }, len: claimed, parts: partsFor(claimed),
    }))
    const prefix = new Uint8Array(4)
    new DataView(prefix.buffer).setUint32(0, header.length, true)
    return { name: inlayEntryName(hash, 0), hash, data: new Blob([prefix, header, body]) }
}

describe('the collector applies the limit of the inlay type', () => {
    // Reproducer: the collector took one number, so a video above 200 MiB was admitted on Android once the limit rose to 1 GiB.
    test('an Android video above 200 MiB is left out as too large, naming the 200 MiB that applied', async () => {
        const collector = new InlayRestoreCollector(inlayAttachmentLimit)
        const video = await part0('video-1', 'video', 200 * MIB + 1)
        await collector.add(video.name, video.hash, 0, video.data)
        const result = await collector.finish(store)
        expect(result.skipped).toEqual([{ label: 'video-1', reason: 'tooLarge', limit: 200 * MIB }])
    })

    test('an Android audio inlay of the same size is not left out as too large', async () => {
        const collector = new InlayRestoreCollector(inlayAttachmentLimit)
        const audio = await part0('audio-1', 'audio', 200 * MIB + 1)
        await collector.add(audio.name, audio.hash, 0, audio.data)
        const result = await collector.finish(store)
        expect(result.skipped.map((skipped) => skipped.reason)).not.toContain('tooLarge')
    })

    // Guard: passes before and after for the plain number form.
    test('a video above the store limit is left out with the store limit on any platform', async () => {
        h.os = 'windows'
        const collector = new InlayRestoreCollector(inlayAttachmentLimit)
        const video = await part0('video-2', 'video', GIB + 1)
        await collector.add(video.name, video.hash, 0, video.data)
        const result = await collector.finish(store)
        expect(result.skipped).toEqual([{ label: 'video-2', reason: 'tooLarge', limit: GIB }])
    })

    test('a plain number limit still bounds every type', async () => {
        const collector = new InlayRestoreCollector(4)
        const image = await part0('image-1', 'image', 5)
        await collector.add(image.name, image.hash, 0, image.data)
        const result = await collector.finish(store)
        expect(result.skipped).toEqual([{ label: 'image-1', reason: 'tooLarge', limit: 4 }])
    })
})

describe('the oversize listing applies the limit of the inlay type', () => {
    test('an Android video above 200 MiB is listed with that limit; an audio inlay of the same size is not', async () => {
        const video = await part0('video-3', 'video', 200 * MIB + 1)
        const audio = await part0('audio-3', 'audio', 200 * MIB + 1)
        const bytes: Uint8Array[] = []
        const entries: BackupIndexEntry[] = []
        let offset = 0
        for (const item of [video, audio]) {
            const nameBytes = new TextEncoder().encode(item.name)
            const data = new Uint8Array(await item.data.arrayBuffer())
            const header = new Uint8Array(4 + nameBytes.length + 4)
            const view = new DataView(header.buffer)
            view.setUint32(0, nameBytes.length, true)
            header.set(nameBytes, 4)
            view.setUint32(4 + nameBytes.length, data.length, true)
            entries.push({ headerOffset: offset, nameLength: nameBytes.length, dataLength: data.length, headerLength: header.length })
            bytes.push(header, data)
            offset += header.length + data.length
        }
        const file = new Blob(bytes as unknown as BlobPart[])
        expect(await listOversizedInlays(file, entries, inlayAttachmentLimit)).toEqual([
            { hash: video.hash, id: 'video-3', limit: 200 * MIB },
        ])
    })
})
