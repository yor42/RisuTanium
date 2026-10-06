import { invoke } from '@tauri-apps/api/core'
import { type as osType } from '@tauri-apps/plugin-os'
import { isTauri } from '../platform'

/**
 * The page's side of the desktop asset commands: `put_assets_batch`,
 * `put_asset_single`, `get_assets_batch` and `list_assets_sized`. Every key is
 * a store key (`assets/<name>`), and the commands resolve it under the app data
 * directory themselves; no path is ever sent.
 *
 * Wire format of a write body: repeated frames
 * `[u32 LE keyLength][key UTF-8][u32 LE dataLength][data]`.
 * Wire format of a read response: one frame per requested key, in order,
 * `[u8 status][u32 LE length][bytes]`. Both parsers check every length against
 * the bytes that remain and require the whole response to be consumed.
 */

/** What one write frame came to: written, refused by the key rules, or failed. */
export type AssetPutResult =
    | { k: 'ok' }
    | { k: 'invalid'; reason: string }
    | { k: 'error'; message: string }

/** What one requested key came to in a batched read. */
export type AssetReadResult =
    | { status: 'ok'; bytes: Uint8Array }
    | { status: 'missing' }
    | { status: 'invalid'; reason: string }
    | { status: 'error'; message: string }

export interface AssetPutEntry {
    key: string
    data: Uint8Array
}

export interface SizedAssetKey {
    key: string
    size: number
}

/** The command refused the call because its body did not arrive as raw bytes; nothing was written. */
export class AssetBatchNotRawError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AssetBatchNotRawError'
    }
}

const NOT_RAW_PREFIX = 'not-raw:'
const MAX_U32 = 0xFFFFFFFF

/** Set once a write command reports that raw bodies do not reach it; batching stays off for the rest of the page. */
let rawBodiesUnavailable = false

/** Turns the batch path off for the rest of the page. */
export function markAssetBatchUnavailable(): void {
    rawBodiesUnavailable = true
}

/** Test seam: forgets what `markAssetBatchUnavailable` recorded. */
export function resetAssetBatchAvailabilityForTests(): void {
    rawBodiesUnavailable = false
}

/**
 * Whether the batched commands may be used: only inside the desktop app on
 * Windows, Linux or macOS, and only while raw bodies reach the commands. Any
 * failure to learn the operating system means "no".
 */
export function isAssetBatchAvailable(): boolean {
    if (!isTauri || rawBodiesUnavailable) {
        return false
    }
    try {
        const os = osType()
        return os === 'windows' || os === 'linux' || os === 'macos'
    } catch {
        return false
    }
}

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    const message = (error as { message?: unknown } | null | undefined)?.message
    return typeof message === 'string' ? message : String(error)
}

/** Whether `error` is the refusal of a body that did not arrive as raw bytes. */
export function isAssetBatchNotRawError(error: unknown): boolean {
    return error instanceof AssetBatchNotRawError || errorText(error).startsWith(NOT_RAW_PREFIX)
}

/** Records the refusal and rethrows it as the typed error; any other failure passes through. */
function rethrowCommandError(error: unknown): never {
    if (isAssetBatchNotRawError(error)) {
        markAssetBatchUnavailable()
        throw error instanceof AssetBatchNotRawError ? error : new AssetBatchNotRawError(errorText(error))
    }
    throw error
}

export function encodePutFrames(entries: readonly AssetPutEntry[]): Uint8Array {
    const encoder = new TextEncoder()
    const keys = entries.map((entry) => encoder.encode(entry.key))
    let total = 0
    for (let i = 0; i < entries.length; i++) {
        if (keys[i].length > MAX_U32 || entries[i].data.length > MAX_U32) {
            throw new RangeError('an asset frame is limited to 4 GiB')
        }
        total += 8 + keys[i].length + entries[i].data.length
    }
    const body = new Uint8Array(total)
    const view = new DataView(body.buffer)
    let offset = 0
    for (let i = 0; i < entries.length; i++) {
        view.setUint32(offset, keys[i].length, true)
        offset += 4
        body.set(keys[i], offset)
        offset += keys[i].length
        view.setUint32(offset, entries[i].data.length, true)
        offset += 4
        body.set(entries[i].data, offset)
        offset += entries[i].data.length
    }
    return body
}

function parsePutResult(value: unknown): AssetPutResult {
    if (typeof value === 'object' && value !== null) {
        const item = value as { k?: unknown; reason?: unknown; message?: unknown }
        if (item.k === 'ok') {
            return { k: 'ok' }
        }
        if (item.k === 'invalid' && typeof item.reason === 'string') {
            return { k: 'invalid', reason: item.reason }
        }
        if (item.k === 'error' && typeof item.message === 'string') {
            return { k: 'error', message: item.message }
        }
    }
    throw new Error('put_assets_batch returned an unreadable result')
}

/** Reads a batch response: one result per frame sent, in order. */
export function parsePutResults(value: unknown, expected: number): AssetPutResult[] {
    if (!Array.isArray(value) || value.length !== expected) {
        throw new Error('put_assets_batch returned a result list of the wrong length')
    }
    return value.map(parsePutResult)
}

/** Writes the entries in one call; the result list is in entry order. */
export async function writeAssetBatch(entries: readonly AssetPutEntry[]): Promise<AssetPutResult[]> {
    const body = encodePutFrames(entries)
    try {
        return parsePutResults(await invoke<unknown>('put_assets_batch', body), entries.length)
    } catch (error) {
        return rethrowCommandError(error)
    }
}

/** Writes one entry whose body is sent as it is, without framing; used for an entry too large to share a batch. */
export async function writeAssetSingle(entry: AssetPutEntry): Promise<AssetPutResult> {
    try {
        const result = await invoke<unknown>('put_asset_single', entry.data, {
            headers: { 'x-risu-key': encodeURIComponent(entry.key) },
        })
        return parsePutResult(result)
    } catch (error) {
        return rethrowCommandError(error)
    }
}

const READ_STATUSES = ['ok', 'missing', 'invalid', 'error'] as const

/** Reads a `get_assets_batch` response for `count` keys; throws unless every frame is whole and nothing is left over. */
export function parseReadFrames(response: unknown, count: number): AssetReadResult[] {
    let bytes: Uint8Array
    if (response instanceof ArrayBuffer) {
        bytes = new Uint8Array(response)
    } else if (response instanceof Uint8Array) {
        bytes = response
    } else {
        throw new Error('get_assets_batch returned something other than bytes')
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const results: AssetReadResult[] = []
    let offset = 0
    for (let i = 0; i < count; i++) {
        if (bytes.length - offset < 5) {
            throw new Error('get_assets_batch response ends inside a frame header')
        }
        const status = bytes[offset]
        const length = view.getUint32(offset + 1, true)
        offset += 5
        if (status >= READ_STATUSES.length) {
            throw new Error('get_assets_batch response has an unknown status')
        }
        if (length > bytes.length - offset) {
            throw new Error('get_assets_batch response ends inside a frame body')
        }
        const body = bytes.subarray(offset, offset + length)
        offset += length
        switch (READ_STATUSES[status]) {
            case 'ok':
                results.push({ status: 'ok', bytes: body })
                break
            case 'missing':
                if (length !== 0) {
                    throw new Error('get_assets_batch response gives a missing key a body')
                }
                results.push({ status: 'missing' })
                break
            case 'invalid':
                results.push({ status: 'invalid', reason: new TextDecoder().decode(body) })
                break
            case 'error':
                results.push({ status: 'error', message: new TextDecoder().decode(body) })
                break
        }
    }
    if (offset !== bytes.length) {
        throw new Error('get_assets_batch response has bytes after its last frame')
    }
    return results
}

/** Reads the keys in one call; the result list is in key order. */
export async function readAssetBatch(keys: readonly string[]): Promise<AssetReadResult[]> {
    return parseReadFrames(await invoke<unknown>('get_assets_batch', { keys }), keys.length)
}

/** The keys under `assets/` with their sizes, in the order the store lists them. */
export async function listAssetsSized(): Promise<SizedAssetKey[]> {
    const listing = await invoke<unknown>('list_assets_sized')
    if (!Array.isArray(listing)) {
        throw new Error('list_assets_sized returned something other than a list')
    }
    return listing.map((item): SizedAssetKey => {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string'
                || typeof item[1] !== 'number' || !Number.isSafeInteger(item[1]) || item[1] < 0) {
            throw new Error('list_assets_sized returned an unreadable item')
        }
        return { key: item[0], size: item[1] }
    })
}
