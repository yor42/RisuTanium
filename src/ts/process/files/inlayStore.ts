import localforage from 'localforage'
import { getAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { isWellFormedUtf16 } from 'src/ts/storage/store/keyRules'
import { isNodeServer } from 'src/ts/platform'
import { NODE_BODY_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'
import { beginChokePoint } from '../memory/busyActions'
import { dropInlayRender } from './inlayRenderCache'
import {
    INLAY_BODY_PREFIX,
    INLAY_PREFIX,
    inlayBodyKey,
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

/** The largest value one write to the app store accepts. */
export function inlayWriteLimit(): number {
    return isNodeServer ? NODE_BODY_LIMIT_BYTES : Number.POSITIVE_INFINITY
}

const MIB = 1024 * 1024

/** Mutable only so that tests can use small fixtures. */
export const inlayLimits = {
    // the largest audio or video file a user can attach
    attachmentBytes: 200 * MIB,
}

/**
 * The largest audio or video file a user can attach, in bytes: 200 MiB, and never
 * more than one write to the store accepts. An old inlay above it is not copied
 * on any platform, so the copy never makes a copy of a body that large.
 */
export function inlayAttachmentLimit(): number {
    return Math.min(inlayLimits.attachmentBytes, inlayWriteLimit())
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
 *
 * The caller holds `withInlayLock(id)`. The render cached for `id` is dropped
 * once the metadata commits and before the replaced body is deleted, and again
 * on every way out, so no cached URL points at a body that is gone. With
 * `revokeRendered` false the dropped render's object URL stays valid.
 */
export async function writeAppInlay(store: ByteStore, id: string, value: object & { data?: unknown }, options: { revokeRendered?: boolean } = {}): Promise<void> {
    const metaKey = inlayMetaKey(id)
    const bodyKey = inlayBodyKey(id, newBodyToken())
    if (metaKey === null || bodyKey === null) {
        throw new InlayKeyError(id)
    }
    const revoke = options.revokeRendered ?? true
    let prepared: PreparedBody | null
    try {
        prepared = await prepareBody(store, value.data)
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
async function prepareBody(store: ByteStore, data: unknown): Promise<PreparedBody | null> {
    const writeBlob = store.writeBlob?.bind(store)
    if (data instanceof Blob && writeBlob !== undefined) {
        if (data.size > 0) {
            await data.slice(0, 1).arrayBuffer()
        }
        return { repr: 'blob', mime: data.type, len: data.size, put: (key) => writeBlob(key, data, 'unconditional') }
    }
    const body = await inlayBodyOf(data)
    if (body === null) {
        return null
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

/** The summary of the inlay `id` in the app store when its metadata parses and its body is among the `listed` keys; no body is read. */
export async function summarizeAppInlay(store: ByteStore, id: string, listed: ReadonlySet<string>): Promise<InlaySummary | null> {
    try {
        const record = await readRecord(store, id)
        if (record === null || !listed.has(record.body)) {
            return null
        }
        return { ...(record.fields as unknown as Omit<InlayAsset, 'data'>), size: record.len }
    } catch {
        return null
    }
}
