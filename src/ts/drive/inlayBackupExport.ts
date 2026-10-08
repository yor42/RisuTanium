import type { ByteStore } from '../storage/store/contract'
import { readRangedPieces } from '../storage/tauriByteTransport'
import {
    fieldsOf,
    inlayBodyOf,
    legacyInlayStore,
    listAppInlayKeys,
    readAppInlayRecord,
    withInlayLock,
    type InlayAsset,
    type InlayRecord,
} from '../process/files/inlayStore'
import {
    FIRST_PART_BODY_MAX,
    PART_DATA_MAX,
    encodeInlayHeader,
    inlayEntryName,
    inlayIdHash,
    partsFor,
    type InlayEntryHeader,
} from './inlayBackupCodec'

/**
 * The inlays of a full local backup: every id readable through `getInlayAsset`
 * at the time of the export, from the app store and from this browser's old
 * inlay store, each written once as `partsFor(len)` entries of at most
 * `PART_DATA_MAX` data bytes (see `inlayBackupCodec.ts`).
 *
 * - An id held by both stores is written once, from the app store, which is
 *   also what a reader of that id sees first.
 * - The old store's keys are listed before the app store's ids, so an old entry
 *   removed after the first listing is still found in the app store by the
 *   second.
 * - Each part is read whole before its entry header is written, so a body that
 *   disappears or changes size leaves no half-written entry. An inlay that
 *   cannot be read to its end is left out and named; it never stops the backup.
 *   A failure of the writer does stop it: the file is unusable.
 * - At most one part of one inlay is held at a time, except on a store that
 *   cannot read a range, where the whole body of one inlay is.
 */

export interface InlayBackupSink {
    writeBackup(name: string, data: Uint8Array): Promise<void>
    writeBackupHeader(name: string, dataLength: number): Promise<void>
    write(data: Uint8Array): Promise<void>
}

export type InlayLeftOutReason =
    /** The id's value cannot be read, or its body changed or vanished while it was read. */
    | 'unreadable'
    /** The value is not a Blob or a string, or its header does not fit part 0. */
    | 'unsupported'

export interface InlayExportResult {
    exported: number
    leftOut: { id: string, reason: InlayLeftOutReason }[]
    /** The old inlay store could not be listed, so inlays only it holds are not in the backup. */
    oldStoreUnlisted: boolean
}

export interface InlayExportOptions {
    /** Read an app-store body in ranged pieces (the desktop files store). */
    streaming: boolean
    onProgress?: (done: number, total: number) => void
}

/** The body of an inlay was not what its record promised. */
class InlayBodyChangedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'InlayBodyChangedError'
    }
}

/** A body read front to back: each `take` returns the next `count` bytes or throws. */
interface BodySource {
    take(count: number): Promise<Uint8Array>
    close(): Promise<void>
}

class BytesSource implements BodySource {
    private position = 0
    constructor(private readonly bytes: Uint8Array) { }
    async take(count: number): Promise<Uint8Array> {
        if (this.position + count > this.bytes.length) {
            throw new InlayBodyChangedError('The inlay body is shorter than its record says')
        }
        const part = this.bytes.subarray(this.position, this.position + count)
        this.position += count
        return part
    }
    async close(): Promise<void> { }
}

class BlobSource implements BodySource {
    private position = 0
    constructor(private readonly blob: Blob) { }
    async take(count: number): Promise<Uint8Array> {
        const part = new Uint8Array(await this.blob.slice(this.position, this.position + count).arrayBuffer())
        if (part.length !== count) {
            throw new InlayBodyChangedError('The inlay body is shorter than its record says')
        }
        this.position += count
        return part
    }
    async close(): Promise<void> { }
}

class RangedSource implements BodySource {
    private readonly pieces: AsyncGenerator<{ bytes: Uint8Array, total: number }, void, undefined>
    private carry: Uint8Array = new Uint8Array(0)
    private checked = false
    constructor(key: string, private readonly expectedLength: number) {
        this.pieces = readRangedPieces(key)
    }
    async take(count: number): Promise<Uint8Array> {
        const out = new Uint8Array(count)
        let filled = 0
        while (filled < count) {
            if (this.carry.length === 0) {
                const next = await this.pieces.next()
                if (next.done === true) {
                    throw new InlayBodyChangedError('The inlay body is shorter than its record says')
                }
                if (!this.checked) {
                    this.checked = true
                    if (next.value.total !== this.expectedLength) {
                        throw new InlayBodyChangedError('The inlay body has another length than its record says')
                    }
                }
                this.carry = next.value.bytes
                continue
            }
            const used = Math.min(this.carry.length, count - filled)
            out.set(this.carry.subarray(0, used), filled)
            this.carry = this.carry.subarray(used)
            filled += used
        }
        return out
    }
    async close(): Promise<void> {
        await this.pieces.return(undefined)
    }
}

interface ExportableInlay {
    repr: InlayRecord['repr']
    mime: string
    fields: Record<string, unknown>
    len: number
    source: BodySource
}

/**
 * The inlay `id` ready to be written, from the app store (`fromApp`) when it holds the id with a body of the
 * length its record says, or from the old store; `null` when that store does not hold it now.
 */
async function openInlay(store: ByteStore, id: string, streaming: boolean, fromApp: boolean): Promise<ExportableInlay | 'unsupported' | null> {
    const record = fromApp ? await readAppInlayRecord(store, id) : null
    if (fromApp) {
        if (record === null || !await store.has(record.body)) {
            return null
        }
        if (streaming) {
            return { repr: record.repr, mime: record.mime, fields: record.fields, len: record.len, source: new RangedSource(record.body, record.len) }
        }
        const blob = await store.readBlob?.(record.body) ?? null
        if (blob !== null && blob.size === record.len) {
            return { repr: record.repr, mime: record.mime, fields: record.fields, len: record.len, source: new BlobSource(blob) }
        }
        const bytes = (await store.read(record.body)).bytes
        if (bytes === null || bytes.length !== record.len) {
            return null
        }
        return { repr: record.repr, mime: record.mime, fields: record.fields, len: record.len, source: new BytesSource(bytes) }
    }
    const value = await legacyInlayStore.getItem<InlayAsset | null>(id)
    if (value === null || value === undefined) {
        return null
    }
    if (value.data instanceof Blob) {
        return { repr: 'blob', mime: value.data.type, fields: fieldsOf(value), len: value.data.size, source: new BlobSource(value.data) }
    }
    const body = await inlayBodyOf(value.data)
    if (body === null) {
        return 'unsupported'
    }
    return { repr: body.repr, mime: body.mime, fields: fieldsOf(value), len: body.bytes.length, source: new BytesSource(body.bytes) }
}

/** `retry` is a body that could not be read before anything of the inlay was written, so another copy may be tried. */
async function writeOneInlay(sink: InlayBackupSink, id: string, inlay: ExportableInlay): Promise<'written' | 'retry' | InlayLeftOutReason> {
    const header: InlayEntryHeader = { v: 1, id, repr: inlay.repr, mime: inlay.mime, fields: inlay.fields, len: inlay.len, parts: partsFor(inlay.len) }
    const headerBytes = encodeInlayHeader(header)
    if (headerBytes === null) {
        return 'unsupported'
    }
    const hash = await inlayIdHash(id)
    let remaining = inlay.len
    for (let index = 0; index < header.parts; index++) {
        const count = Math.min(remaining, index === 0 ? FIRST_PART_BODY_MAX : PART_DATA_MAX)
        let body: Uint8Array
        try {
            body = await inlay.source.take(count)
        } catch (error) {
            console.warn('An inlay could not be read to its end and is left out of the backup:', error)
            return index === 0 ? 'retry' : 'unreadable'
        }
        remaining -= count
        const name = inlayEntryName(hash, index)
        if (index === 0) {
            const prefix = new Uint8Array(4 + headerBytes.length)
            new DataView(prefix.buffer).setUint32(0, headerBytes.length, true)
            prefix.set(headerBytes, 4)
            await sink.writeBackupHeader(name, prefix.length + body.length)
            await sink.write(prefix)
            await sink.write(body)
        } else {
            await sink.writeBackup(name, body)
        }
    }
    return 'written'
}

async function exportOne(sink: InlayBackupSink, store: ByteStore, id: string, streaming: boolean): Promise<'written' | InlayLeftOutReason> {
    // The app store copy first, then the old store: the order `getInlayAsset` reads in.
    for (const fromApp of [true, false]) {
        let inlay: ExportableInlay | 'unsupported' | null
        try {
            inlay = await openInlay(store, id, streaming, fromApp)
        } catch (error) {
            console.warn('An inlay could not be read:', error)
            inlay = null
        }
        if (inlay === null) {
            continue
        }
        if (inlay === 'unsupported') {
            return 'unsupported'
        }
        let outcome: 'written' | 'retry' | InlayLeftOutReason
        try {
            outcome = await writeOneInlay(sink, id, inlay)
        } finally {
            await inlay.source.close().catch(() => { })
        }
        if (outcome !== 'retry') {
            return outcome
        }
    }
    console.warn('An inlay could not be read and is left out of the backup:', id)
    return 'unreadable'
}

/**
 * Writes every inlay of both stores into the backup. Rejects only when the app
 * store cannot be listed or the sink fails; an inlay that cannot be read is
 * returned in `leftOut`. An old store that cannot be listed counts as holding
 * none, and the result says so in `oldStoreUnlisted`.
 */
export async function writeInlaysToBackup(sink: InlayBackupSink, store: ByteStore, options: InlayExportOptions): Promise<InlayExportResult> {
    let legacyIds: string[] = []
    let oldStoreUnlisted = false
    try {
        legacyIds = await legacyInlayStore.keys()
    } catch (error) {
        console.warn('The old inlay store could not be listed:', error)
        oldStoreUnlisted = true
    }
    const { ids: appIds } = await listAppInlayKeys(store)
    const ids = [...new Set([...legacyIds, ...appIds])]
    const result: InlayExportResult = { exported: 0, leftOut: [], oldStoreUnlisted }
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        options.onProgress?.(i + 1, ids.length)
        const outcome = await withInlayLock(id, () => exportOne(sink, store, id, options.streaming))
        if (outcome === 'written') {
            result.exported++
        } else {
            result.leftOut.push({ id, reason: outcome })
        }
    }
    return result
}
