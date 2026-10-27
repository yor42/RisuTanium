/**
 * The inlay restore over a file another app opened (`binFileOfSource`) and over a picked `File`.
 *
 * Source-backed parts are lazy: the collector reads only the headers while the walk goes on, and `finish` reads the parts
 * of one inlay at a time. A read that fails or comes back short means the file changed, as for a `File` whose snapshot went
 * stale: the restore stops (`changed`) and the inlay is not written.
 *
 * Labels: reproducer (red against the named mutant), guard (passes with or without the change), feature (new behaviour).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { InlayRestoreCollector, listOversizedInlays } from 'src/ts/drive/inlayBackupImport'
import { inlayEntryName, inlayIdHash } from 'src/ts/drive/inlayBackupCodec'
import { readAppInlayBody } from 'src/ts/process/files/inlayStore'
import { binFileOfSource } from 'src/ts/drive/binFileSource'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import type { BackupIndexEntry, BinFile } from 'src/ts/drive/backupContainer'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

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

let store: MemoryByteStore

beforeEach(() => {
    store = createMemoryByteStore()
    injectAppStore(store, 'tauri')
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

interface Read {
    start: number
    end: number
}

/** A source over `bytes` that records its reads and lets a test fail or shorten the ones it picks. */
function recordingSource(bytes: Uint8Array, fault?: (read: Read, index: number) => 'throw' | 'short' | null): { source: ImportSource, reads: Read[] } {
    const inner = importSourceOfBytes('backup.bin', bytes)
    const reads: Read[] = []
    const source: ImportSource = {
        ...inner,
        read: async (start, end) => {
            const index = reads.length
            reads.push({ start, end })
            const mode = fault?.({ start, end }, index) ?? null
            if (mode === 'throw') {
                throw new Error('scratch: the provider failed')
            }
            const got = await inner.read(start, end)
            return mode === 'short' ? got.subarray(0, Math.max(0, got.length - 1)) : got
        },
    }
    return { source, reads }
}

interface Part {
    name: string
    /** The part entry's data: for part 0 the header prefix, header and body slice; otherwise the body slice. */
    data: Uint8Array
}

/** The parts of an inlay whose body is `bodies` joined, one part entry per element. */
async function inlayParts(id: string, bodies: Uint8Array[]): Promise<{ hash: string, parts: Part[], body: Uint8Array, headerLength: number }> {
    const hash = await inlayIdHash(id)
    const len = bodies.reduce((sum, body) => sum + body.length, 0)
    const header = new TextEncoder().encode(JSON.stringify({
        v: 1, id, repr: 'blob', mime: 'image/x', fields: { name: id, ext: 'bin', type: 'image' }, len, parts: bodies.length,
    }))
    const prefix = new Uint8Array(4)
    new DataView(prefix.buffer).setUint32(0, header.length, true)
    const parts = bodies.map((body, index): Part => ({
        name: inlayEntryName(hash, index),
        data: index === 0 ? concat([prefix, header, body]) : body,
    }))
    return { hash, parts, body: concat(bodies), headerLength: header.length }
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

interface Laid {
    bytes: Uint8Array
    entries: BackupIndexEntry[]
    /** Where each part's data lies in the file. */
    dataAt: { start: number, length: number }[]
}

/** The part entries framed as a `.bin` (name length, name, data length, data), after a leading filler entry. */
function lay(parts: Part[]): Laid {
    const chunks: Uint8Array[] = []
    const entries: BackupIndexEntry[] = []
    const dataAt: { start: number, length: number }[] = []
    let offset = 0
    for (const part of parts) {
        const nameBytes = new TextEncoder().encode(part.name)
        const header = new Uint8Array(8 + nameBytes.length)
        const view = new DataView(header.buffer)
        view.setUint32(0, nameBytes.length, true)
        header.set(nameBytes, 4)
        view.setUint32(4 + nameBytes.length, part.data.length, true)
        entries.push({ headerOffset: offset, nameLength: nameBytes.length, dataLength: part.data.length, headerLength: header.length })
        dataAt.push({ start: offset + header.length, length: part.data.length })
        chunks.push(header, part.data)
        offset += header.length + part.data.length
    }
    return { bytes: concat(chunks), entries, dataAt }
}

async function collect(file: BinFile, laid: Laid, parts: Part[], hash: string, collector = new InlayRestoreCollector(1024)): Promise<{ collector: InlayRestoreCollector, added: ('ok' | 'unreadable')[] }> {
    const added: ('ok' | 'unreadable')[] = []
    for (const [index, part] of parts.entries()) {
        const at = laid.dataAt[index]
        added.push(await collector.add(part.name, hash, index, file.slice(at.start, at.start + at.length)))
    }
    return { collector, added }
}

async function storedBody(id: string): Promise<Uint8Array | null> {
    const asset = await readAppInlayBody(store, id)
    return asset === null ? null : new Uint8Array(await (asset.data as Blob).arrayBuffer())
}

const BODIES = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8, 9, 10])]

describe('an inlay restored from a source-backed file', () => {
    test('feature: parts are written with the bytes a File restore writes, and the fields are equal', async () => {
        const made = await inlayParts('src-inlay', BODIES)
        const laid = lay(made.parts)

        const fromFile = await collect(new File([laid.bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'), laid, made.parts, made.hash)
        const fileResult = await fromFile.collector.finish(store)
        const fileBody = await storedBody('src-inlay')

        const otherStore = createMemoryByteStore()
        injectAppStore(otherStore, 'tauri')
        const { source } = recordingSource(laid.bytes)
        const fromSource = await collect(binFileOfSource(source), laid, made.parts, made.hash)
        const sourceResult = await fromSource.collector.finish(otherStore)
        const sourceAsset = await readAppInlayBody(otherStore, 'src-inlay')

        expect(fileResult).toEqual({ written: 1, skipped: [], changed: false })
        expect(sourceResult).toEqual({ written: 1, skipped: [], changed: false })
        expect(fileBody).toEqual(made.body)
        expect(new Uint8Array(await (sourceAsset!.data as Blob).arrayBuffer())).toEqual(made.body)
        expect({ ...sourceAsset, data: null }).toEqual({ ...(await readAppInlayBody(store, 'src-inlay')), data: null })
    })

    // Reproducer against the plan-as-written mutant that reads parts at `add` (the collector would hold every part until
    // `finish`): the body reads must not happen before `finish`, and each is one part long.
    test('reproducer: only headers are read until finish, then each part is read once by itself', async () => {
        const made = await inlayParts('lazy-inlay', BODIES)
        const laid = lay(made.parts)
        const { source, reads } = recordingSource(laid.bytes)

        const { collector } = await collect(binFileOfSource(source), laid, made.parts, made.hash)
        const headerEnd = laid.dataAt[0].start + 4 + made.headerLength
        expect(reads.length).toBeGreaterThan(0)
        for (const read of reads) {
            expect(read.end).toBeLessThanOrEqual(headerEnd)
        }
        const before = reads.length

        await collector.finish(store)

        expect(reads.slice(before).map((read) => read.end - read.start)).toEqual([BODIES[0].length, BODIES[1].length])
    })

    // Reproducer against the mutant without the S1 length checks in `add`: a header that comes back short was read as a
    // damaged inlay, skipped as `invalid`, instead of stopping the restore.
    test('reproducer: a short read of the part-0 length bytes is unreadable, not an invalid inlay', async () => {
        const made = await inlayParts('short-len', BODIES)
        const laid = lay(made.parts)
        const { source } = recordingSource(laid.bytes, (read) => read.start === laid.dataAt[0].start && read.end - read.start === 4 ? 'short' : null)

        const { added } = await collect(binFileOfSource(source), laid, made.parts, made.hash)

        expect(added[0]).toBe('unreadable')
    })

    test('reproducer: a short read of the part-0 header is unreadable, not an invalid inlay', async () => {
        const made = await inlayParts('short-header', BODIES)
        const laid = lay(made.parts)
        const { source } = recordingSource(laid.bytes, (read) => read.start === laid.dataAt[0].start + 4 ? 'short' : null)

        const { added } = await collect(binFileOfSource(source), laid, made.parts, made.hash)

        expect(added[0]).toBe('unreadable')
    })

    test('reproducer: a failed header read is unreadable', async () => {
        const made = await inlayParts('throw-header', BODIES)
        const laid = lay(made.parts)
        const { source } = recordingSource(laid.bytes, (read) => read.start === laid.dataAt[0].start + 4 ? 'throw' : null)

        const { added } = await collect(binFileOfSource(source), laid, made.parts, made.hash)

        expect(added[0]).toBe('unreadable')
    })

    // Reproducers against the mutant without the per-part `try` / length check in `writeGroup`.
    test.each([
        ['part 0 body read fails', 0, 'throw'],
        ['part 0 body read is short', 0, 'short'],
        ['part 1 body read fails', 1, 'throw'],
        ['part 1 body read is short', 1, 'short'],
    ] as const)('reproducer: %s -> the restore reports the file changed and the inlay is not written', async (_label, partIndex, mode) => {
        const made = await inlayParts('body-fault', BODIES)
        const laid = lay(made.parts)
        let armed = false
        const at = laid.dataAt[partIndex]
        const bodyStart = partIndex === 0 ? at.start + 4 + made.headerLength : at.start
        const { source } = recordingSource(laid.bytes, (read) => armed && read.start === bodyStart ? mode : null)
        const { collector, added } = await collect(binFileOfSource(source), laid, made.parts, made.hash)
        expect(added).toEqual(['ok', 'ok'])
        armed = true

        const result = await collector.finish(store)

        expect(result.changed).toBe(true)
        expect(result.written).toBe(0)
        expect(await readAppInlayBody(store, 'body-fault')).toBeNull()
    })

    test('guard: a File-backed inlay is written whole with the same bytes (the Blob branch is unchanged)', async () => {
        const made = await inlayParts('file-inlay', BODIES)
        const laid = lay(made.parts)

        const { collector } = await collect(new File([laid.bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'), laid, made.parts, made.hash)
        const result = await collector.finish(store)

        expect(result).toEqual({ written: 1, skipped: [], changed: false })
        expect(await storedBody('file-inlay')).toEqual(made.body)
    })

    test('feature: the oversize listing over a source names the same inlays as over a File', async () => {
        const made = await inlayParts('big-inlay', BODIES)
        const laid = lay(made.parts)
        const asFile = await listOversizedInlays(new File([laid.bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'), laid.entries, 5)
        const asSource = await listOversizedInlays(binFileOfSource(recordingSource(laid.bytes).source), laid.entries, 5)

        expect(asFile).toEqual([{ hash: made.hash, id: 'big-inlay', limit: 5 }])
        expect(asSource).toEqual(asFile)
    })
})
