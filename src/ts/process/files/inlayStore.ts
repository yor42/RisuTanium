import localforage from 'localforage'
import { language } from 'src/lang'
import { getAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreBlobUnsupportedError } from 'src/ts/storage/store/errors'
import { WEB_ASSET_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'
import { isWellFormedUtf16 } from 'src/ts/storage/store/keyRules'
import { storeAssetLimitBytes } from 'src/ts/storage/assetLimit'
import { isAndroidTransport } from 'src/ts/storage/tauriByteTransport'
import { beginChokePoint } from '../memory/busyActions'
import { dropInlayRender } from './inlayRenderCache'
import {
    INLAY_BODY_PREFIX,
    INLAY_PREFIX,
    inlayBodyKey,
    inlayIdFromBodyKey,
    inlayIdFromMetaKey,
    inlayMetaKey,
    newBodyToken,
} from './inlayKeys'

export type InlayAsset = {
    data: string | Blob
    /** File extension */
    ext: string
    height?: number
    name: string
    type: 'image' | 'video' | 'audio' | 'signature'
    width?: number
}

/** The old LocalForage database inlays were kept in. */
export const legacyInlayStore = localforage.createInstance({
    name: 'inlay',
    storeName: 'inlay'
})

/** An id that has no key in the app store. */
export class InlayKeyError extends Error {
    constructor(id: string) {
        super(`The inlay id cannot be stored: ${JSON.stringify(id.length > 80 ? id.slice(0, 80) + '...' : id)}`)
        this.name = 'InlayKeyError'
    }
}

/** The inlay record kept under a metadata key. `fields` is everything of the value except its data. */
export interface InlayRecord {
    v: 1
    /** How `data` is restored: a Blob of `mime`, a UTF-8 string, or a UTF-16LE string (a string that is not well-formed UTF-16, so it cannot be UTF-8 encoded). */
    repr: 'blob' | 'string' | 'string16'
    mime: string
    /** Byte length of the body. */
    len: number
    /** Key of the body. */
    body: string
    fields: Record<string, unknown>
}

/** The listing form of an inlay: its fields without the data, and its size when known. */
export type InlaySummary = Omit<InlayAsset, 'data'> & { size: number | null }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Every write and delete counts as in flight, so the page is not reloaded under it. */
export async function inFlight<T>(work: () => Promise<T>): Promise<T> {
    const endInFlight = beginChokePoint('inlay')
    try {
        return await work()
    } finally {
        endInFlight()
    }
}

/** The largest inlay body the page's selected store accepts. */
export function inlayWriteLimit(): number {
    return storeAssetLimitBytes()
}

const MIB = 1024 * 1024

/**
 * The largest video inlay Android takes. A large video there is played from the file through the store's
 * URL (Range reads), and a video the store cannot deliver that way is withheld above the whole-read
 * limit instead of being read whole. The constant stays apart from `inlayLimits.attachmentBytes` so that a
 * later rise of the attachment bound does not raise Android video without a device proof.
 */
export const ANDROID_VIDEO_INLAY_LIMIT_BYTES = 1024 * MIB

/** Mutable only so that tests can use small fixtures. */
export const inlayLimits = {
    // the largest audio or video file a user can attach
    attachmentBytes: 1024 * MIB,
}

/**
 * The largest inlay a user can attach or a copy or restore can store, in bytes: 1 GiB, and never
 * more than the page's store accepts for one body. An Android video is further bounded by
 * `ANDROID_VIDEO_INLAY_LIMIT_BYTES`, which equals the attachment bound today. An old inlay
 * above the limit is not copied on any platform, so the copy never makes a copy of a body
 * that large. Pass the inlay's type when it is known.
 */
export function inlayAttachmentLimit(type?: InlayAsset['type']): number {
    const limit = Math.min(inlayLimits.attachmentBytes, inlayWriteLimit())
    return type === 'video' && isAndroidTransport() ? Math.min(limit, ANDROID_VIDEO_INLAY_LIMIT_BYTES) : limit
}

/** The body of an inlay value could not be read, so it cannot be stored; trying again will not help. */
export class InlayUnreadableError extends Error {
    constructor(cause: unknown) {
        super(`The inlay body could not be read: ${cause instanceof Error ? cause.message : String(cause)}`)
        this.name = 'InlayUnreadableError'
        this.cause = cause
    }
}

const idTails = new Map<string, Promise<void>>()

/** Runs `work` after every earlier call for the same id has settled; the app store does not order calls on a key. */
export async function withInlayLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const before = idTails.get(id) ?? Promise.resolve()
    const run = before.then(work, work)
    const tail = run.then(() => undefined, () => undefined)
    idTails.set(id, tail)
    try {
        return await run
    } finally {
        if (idTails.get(id) === tail) {
            idTails.delete(id)
        }
    }
}

const inlaysWrittenThisPage = new Set<string>()

function noteInlayWritten(id: string): void {
    inlaysWrittenThisPage.add(id)
}

/** Whether `writeAppInlay` was entered for `id` on this page, whatever its outcome; the set only grows. */
export function inlayWrittenThisPage(id: string): boolean {
    return inlaysWrittenThisPage.has(id)
}

/** Empties the set of written ids; for tests only. */
export function resetInlaysWrittenForTests(): void {
    inlaysWrittenThisPage.clear()
}

function stringToBytes(text: string): { repr: 'string' | 'string16', bytes: Uint8Array } {
    if (isWellFormedUtf16(text)) {
        return { repr: 'string', bytes: encoder.encode(text) }
    }
    const bytes = new Uint8Array(text.length * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < text.length; i++) {
        view.setUint16(i * 2, text.charCodeAt(i), true)
    }
    return { repr: 'string16', bytes }
}

/** The string a `string` or `string16` body holds. */
export function bytesToString(repr: 'string' | 'string16', bytes: Uint8Array): string {
    if (repr === 'string') {
        return decoder.decode(bytes)
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let text = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        text += String.fromCharCode(view.getUint16(i, true))
    }
    return text
}

/** The body bytes of `data` and how to restore them, or `null` when `data` is neither a Blob nor a string. */
export async function inlayBodyOf(data: unknown): Promise<{ repr: InlayRecord['repr'], mime: string, bytes: Uint8Array } | null> {
    if (data instanceof Blob) {
        return { repr: 'blob', mime: data.type, bytes: new Uint8Array(await data.arrayBuffer()) }
    }
    if (typeof data === 'string') {
        return { ...stringToBytes(data), mime: '' }
    }
    return null
}

export function fieldsOf(value: object): Record<string, unknown> {
    const fields: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(value)) {
        if (name !== 'data') {
            fields[name] = field
        }
    }
    return fields
}

function parseRecord(bytes: Uint8Array | null): InlayRecord | null {
    if (bytes === null || bytes.length === 0) {
        return null
    }
    try {
        const record = JSON.parse(decoder.decode(bytes)) as Partial<InlayRecord> | null
        if (record === null || typeof record !== 'object' || record.v !== 1) {
            return null
        }
        if (record.repr !== 'blob' && record.repr !== 'string' && record.repr !== 'string16') {
            return null
        }
        if (typeof record.mime !== 'string' || typeof record.body !== 'string' || !record.body.startsWith(INLAY_BODY_PREFIX)) {
            return null
        }
        if (typeof record.len !== 'number' || !Number.isInteger(record.len) || record.len < 0) {
            return null
        }
        if (record.fields === null || typeof record.fields !== 'object' || Array.isArray(record.fields)) {
            return null
        }
        return record as InlayRecord
    } catch {
        return null
    }
}

async function readRecord(store: ByteStore, id: string): Promise<InlayRecord | null> {
    const key = inlayMetaKey(id)
    if (key === null) {
        return null
    }
    return parseRecord((await store.read(key)).bytes)
}

/** The parsed metadata record of the inlay `id`, or `null` when it is absent, damaged or has no key. Rejects when the store fails. */
export async function readAppInlayRecord(store: ByteStore, id: string): Promise<InlayRecord | null> {
    return await readRecord(store, id)
}

/**
 * The inlay `id` with its body read as bytes, or `null` when it is absent, incomplete, damaged or has no key.
 * `known` is a record the caller just read, used for the first attempt. A body that is gone or has another
 * length may belong to a write that replaced it after the metadata was read, so the metadata is read once
 * more before giving up. Never throws.
 */
export async function readAppInlayBody(store: ByteStore, id: string, known: InlayRecord | null = null): Promise<InlayAsset | null> {
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const record = attempt === 0 && known !== null ? known : await readRecord(store, id)
            if (record === null) {
                return null
            }
            const body = (await store.read(record.body)).bytes
            if (body === null || body.length !== record.len) {
                continue
            }
            const data = record.repr === 'blob' ? new Blob([body as BlobPart], { type: record.mime }) : bytesToString(record.repr, body)
            return { ...record.fields, data } as unknown as InlayAsset
        }
        return null
    } catch (error) {
        console.warn('An inlay could not be read from the app store:', error)
        return null
    }
}

/** The inlay `id` in the app store, or `null` when it is absent, incomplete, damaged or has no key. Never throws. */
export async function readAppInlay(id: string): Promise<InlayAsset | null> {
    try {
        return await readAppInlayBody(await getAppStore(), id)
    } catch (error) {
        console.warn('An inlay could not be read from the app store:', error)
        return null
    }
}

/** Whether the inlay `id` is in the app store with its metadata parsed and its body present. Never throws. */
export async function hasAppInlay(store: ByteStore, id: string): Promise<boolean> {
    try {
        const record = await readRecord(store, id)
        return record !== null && await store.has(record.body)
    } catch {
        return false
    }
}

/** Whether the inlay id has parsing metadata and a body among the listed keys. Reads the metadata only. Never throws. */
export async function isListedAppInlay(store: ByteStore, id: string, listed: ReadonlySet<string>): Promise<boolean> {
    try {
        const record = await readRecord(store, id)
        return record !== null && listed.has(record.body)
    } catch {
        return false
    }
}

/**
 * Writes `value` as the inlay `id`: a new body key first, the metadata second
 * (the commit point), the replaced body last. A reader sees the old inlay or the
 * new one, never old metadata with a new body. Throws `InlayKeyError` for an id
 * without a key and `InlayUnreadableError` when the value's body cannot be read.
 *
 * A Blob is handed to a store that offers `writeBlob` as it is, so the body is
 * never copied into memory; any other store, and a string, gets bytes.
 * `options.textRepr` says that a Blob body holds the bytes of a string inlay
 * (`string`: UTF-8, `string16`: UTF-16LE): the record then keeps that `repr` and
 * an empty `mime`, so the inlay reads back as the string it was, while the
 * bytes still travel as a Blob and are not decoded and encoded again.
 * `options.onProgress` receives the progress of a Blob body handed to a store's
 * `writeBlob`; a store that takes bytes reports none.
 *
 * The caller holds `withInlayLock(id)`. The render cached for `id` is dropped
 * once the metadata commits and before the replaced body is deleted, and again
 * on every way out, so no cached URL points at a body that is gone. With
 * `revokeRendered` false the dropped render's object URL stays valid.
 */
export async function writeAppInlay(store: ByteStore, id: string, value: object & { data?: unknown }, options: { revokeRendered?: boolean, textRepr?: 'string' | 'string16', onProgress?: (doneBytes: number, totalBytes: number) => void } = {}): Promise<void> {
    const metaKey = inlayMetaKey(id)
    const bodyKey = inlayBodyKey(id, newBodyToken())
    if (metaKey === null || bodyKey === null) {
        throw new InlayKeyError(id)
    }
    noteInlayWritten(id)
    const revoke = options.revokeRendered ?? true
    let prepared: PreparedBody | null
    try {
        const named = (value as { name?: unknown }).name
        prepared = await prepareBody(store, value.data, options.textRepr, typeof named === 'string' ? named : '', options.onProgress)
    } catch (error) {
        throw new InlayUnreadableError(error)
    }
    if (prepared === null) {
        throw new TypeError('An inlay holds a Blob or a string.')
    }
    const body: PreparedBody = prepared
    let replaced: InlayRecord | null = null
    try {
        replaced = await readRecord(store, id)
    } catch {
        replaced = null
    }
    const record: InlayRecord = { v: 1, repr: body.repr, mime: body.mime, len: body.len, body: bodyKey, fields: fieldsOf(value) }
    await inFlight(async () => {
        try {
            await body.put(bodyKey)
            try {
                await store.write(metaKey, encoder.encode(JSON.stringify(record)), 'unconditional')
            } catch (error) {
                await store.delete(bodyKey, 'unconditional').catch(() => { })
                throw error
            }
            dropInlayRender(id, revoke)
            if (replaced !== null && replaced.body !== bodyKey) {
                await store.delete(replaced.body, 'unconditional').catch(() => { })
            }
        } finally {
            dropInlayRender(id, revoke)
        }
    })
}

interface PreparedBody {
    repr: InlayRecord['repr']
    mime: string
    len: number
    /** Stores the body under `key`. */
    put: (key: string) => Promise<unknown>
}

/**
 * The body of `data` ready to store, or `null` when `data` is neither a Blob nor a string. A Blob bound
 * for a store that takes Blobs is probed with a one-byte read, so a Blob the browser cannot read is
 * refused here as unreadable and not by the store as a failed write; its bytes are not read otherwise.
 */
async function prepareBody(store: ByteStore, data: unknown, textRepr?: 'string' | 'string16', fileName: string = '', onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<PreparedBody | null> {
    const writeBlob = store.writeBlob?.bind(store)
    if (data instanceof Blob && writeBlob !== undefined) {
        if (data.size > 0) {
            await data.slice(0, 1).arrayBuffer()
        }
        const blob = data
        // A browser that cannot keep a Blob gets the body as bytes within the bound a whole value has always had; the
        // readers of an inlay body already accept a bytes body. A larger body is refused with the message that names the
        // file and that bound, not the store's own text.
        const put = async (key: string): Promise<unknown> => {
            try {
                return await writeBlob(key, blob, 'unconditional', onProgress)
            } catch (error) {
                if (!(error instanceof StoreBlobUnsupportedError)) {
                    throw error
                }
                if (blob.size > WEB_ASSET_LIMIT_BYTES) {
                    throw new Error(language.assetFileTooLargeForBrowserStorage(fileName !== '' ? fileName : 'unnamed file', Math.floor(WEB_ASSET_LIMIT_BYTES / (1024 * 1024))), { cause: error })
                }
                return await store.write(key, new Uint8Array(await blob.arrayBuffer()), 'unconditional')
            }
        }
        return { repr: textRepr ?? 'blob', mime: textRepr === undefined ? data.type : '', len: data.size, put }
    }
    const body = await inlayBodyOf(data)
    if (body === null) {
        return null
    }
    if (data instanceof Blob && textRepr !== undefined) {
        return { repr: textRepr, mime: '', len: body.bytes.length, put: (key) => store.write(key, body.bytes, 'unconditional') }
    }
    return { repr: body.repr, mime: body.mime, len: body.bytes.length, put: (key) => store.write(key, body.bytes, 'unconditional') }
}

/** Removes the inlay `id` from the app store: the metadata first, then the body. */
export async function removeAppInlay(store: ByteStore, id: string): Promise<void> {
    const metaKey = inlayMetaKey(id)
    if (metaKey === null) {
        return
    }
    await inFlight(async () => {
        let record: InlayRecord | null = null
        try {
            record = await readRecord(store, id)
        } catch {
            record = null
        }
        await store.delete(metaKey, 'unconditional')
        if (record !== null) {
            await store.delete(record.body, 'unconditional')
        }
    })
}

/** Why `removeUnusedAppInlay` left an inlay: a stop condition, a changed database or a write by this page. */
export type InlayVeto = 'stop' | 'changed' | 'written'

export type RemoveUnusedInlayResult =
    | { status: 'removed', bodies: number, bodyFailures: number, foreignBody: boolean }
    | { status: 'kept', reason: 'unreadable' }
    | { status: 'kept', reason: 'vetoed', veto: InlayVeto }

/**
 * Removes the inlay `id` for a deleting pass: the metadata first (the commit point, so a live metadata never names a
 * missing body), then the body the record names, then the other bodies listed for the id. The caller holds
 * `withInlayLock(id)`. `mayDelete` runs synchronously after the metadata is read and right before the metadata delete,
 * with no await between them; a veto leaves every key. A metadata that is absent, damaged or of a newer version is
 * kept. A failed metadata delete throws before any body is touched; a failed body delete is counted and the rest go
 * on. A record whose body is not one of this id's bodies never has that body deleted. The render cached for `id` is
 * dropped (and its object URL revoked) only once the metadata delete succeeded; an inlay that is kept keeps its
 * render, which a staged attachment's preview may still show.
 */
export async function removeUnusedAppInlay(store: ByteStore, id: string, listedBodies: readonly string[], mayDelete: () => InlayVeto | null): Promise<RemoveUnusedInlayResult> {
    const metaKey = inlayMetaKey(id)
    if (metaKey === null) {
        return { status: 'kept', reason: 'unreadable' }
    }
    return await inFlight(async (): Promise<RemoveUnusedInlayResult> => {
        let record: InlayRecord | null
        try {
            record = await readRecord(store, id)
        } catch {
            record = null
        }
        if (record === null) {
            return { status: 'kept', reason: 'unreadable' }
        }
        const veto = mayDelete()
        if (veto !== null) {
            return { status: 'kept', reason: 'vetoed', veto }
        }
        await store.delete(metaKey, 'unconditional')
        dropInlayRender(id)
        let bodies = 0
        let bodyFailures = 0
        let foreignBody = false
        const remove = async (key: string): Promise<void> => {
            try {
                await store.delete(key, 'unconditional')
                bodies++
            } catch {
                bodyFailures++
            }
        }
        if (inlayIdFromBodyKey(record.body) === id) {
            await remove(record.body)
        } else {
            foreignBody = true
        }
        for (const key of listedBodies) {
            if (key !== record.body) {
                await remove(key)
            }
        }
        return { status: 'removed', bodies, bodyFailures, foreignBody }
    })
}

/** One listing of the app store's inlay folder: the ids whose metadata is listed, and every listed key. */
export async function listAppInlayKeys(store: ByteStore): Promise<{ ids: string[], keys: Set<string> }> {
    const keys = new Set(await store.list(INLAY_PREFIX))
    const ids: string[] = []
    for (const key of keys) {
        const id = inlayIdFromMetaKey(key)
        if (id !== null) {
            ids.push(id)
        }
    }
    return { ids, keys }
}

/** The size of the bytes a base64 data URI string stands for, estimated from its length. */
export function decodedTextSize(length: number): number {
    return Math.floor(length * 0.75)
}

/** The size of the file an app-store record stands for: a string body is estimated, any other keeps its length. */
export function inlayRecordSize(record: InlayRecord): number {
    return record.repr === 'string' ? decodedTextSize(record.len) : record.len
}

/** The summary of the inlay `id` in the app store when its metadata parses and its body is among the `listed` keys; no body is read. Its size is `inlayRecordSize`, as `getInlaySummary` reports. */
export async function summarizeAppInlay(store: ByteStore, id: string, listed: ReadonlySet<string>): Promise<InlaySummary | null> {
    try {
        const record = await readRecord(store, id)
        if (record === null || !listed.has(record.body)) {
            return null
        }
        return { ...(record.fields as unknown as Omit<InlayAsset, 'data'>), size: inlayRecordSize(record) }
    } catch {
        return null
    }
}
