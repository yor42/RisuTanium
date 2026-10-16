import { invoke } from '@tauri-apps/api/core'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreRegistrationTimeoutError, StoreStaleGenerationError, type DeleteReportEntry } from './store/errors'
import { ABORT_CHUNKED_COMMAND, bytesToBase64, CHUNK_ID_HEADER, CHUNK_KEY_HEADER, CHUNK_LAST_HEADER, CHUNK_MAX, CHUNK_OFFSET_HEADER, CHUNK_DURABLE_HEADER, readFlushed, shouldChunkWrite, transportKind, WRITE_CHUNK_BYTES } from './tauriByteTransport'

/**
 * The page's side of the Rust generation gate (`src-tauri/src/store2_gate.rs`):
 * registration, the whole-key write of `store2-commit` and `store2-fence`, and the
 * removal of `store2/` keys and the fence. Every write and removal carries the
 * generation the page was issued, and the native side refuses a stale one before
 * touching the disk.
 *
 * The write mirrors `writeFileDurable`: on desktop a body of `CHUNK_MAX` or less is
 * one raw call, and if the command refuses a body that did not arrive raw
 * (`not-raw:`, nothing written) the write goes through the chunk commands for the
 * rest of the page. On Android, and on desktop above `CHUNK_MAX`, the write is a
 * series of chunks into a temp file; the generation is on every chunk, only the last
 * one decides, and the gated chunk commands take no final key.
 *
 * A gated call is always durable and its answer carries `flushed`; an answer that
 * does not is reported as not flushed, never as flushed.
 */

export const STORE2_REGISTER_COMMAND = 'store2_register_page'
export const STORE2_WRITE_TOP_RAW_COMMAND = 'store2_write_top_raw'
export const STORE2_WRITE_TOP_CHUNK_COMMAND = 'store2_write_top_chunk'
export const STORE2_WRITE_TOP_CHUNK_RAW_COMMAND = 'store2_write_top_chunk_raw'
export const STORE2_REMOVE_COMMAND = 'store2_remove'

/** The request header that carries the generation of a gated raw call. */
export const GATE_GENERATION_HEADER = 'x-risu-gen'

const STALE_PREFIX = 'stale-generation:'
const TIMEOUT_PREFIX = 'registration-timeout:'
const KEY_PREFIX = 'gate-key-refused:'
const NOT_RAW_PREFIX = 'not-raw:'

/** Set once `store2_write_top_raw` refuses a body that did not arrive raw; whole-key writes go as chunks for the rest of the page. */
let rawTopUnavailable = false

/** Test seam: forgets that raw bodies were refused. */
export function resetGateTransportForTests(): void {
    rawTopUnavailable = false
}

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

function afterPrefix(text: string, prefix: string): string {
    return text.slice(prefix.length).trim()
}

/**
 * The typed error of a gate refusal, or the original rejection: any other failure
 * may have been applied and keeps the caller's unknown-outcome handling.
 */
function gateErrorOf(error: unknown, subject: string): unknown {
    const text = errorText(error)
    if (text.startsWith(STALE_PREFIX)) {
        return new StoreStaleGenerationError(afterPrefix(text, STALE_PREFIX))
    }
    if (text.startsWith(TIMEOUT_PREFIX)) {
        return new StoreRegistrationTimeoutError(afterPrefix(text, TIMEOUT_PREFIX))
    }
    if (text.startsWith(KEY_PREFIX)) {
        return new StoreInvalidKeyError(subject, afterPrefix(text, KEY_PREFIX))
    }
    return error
}

function randomWriteId(): string {
    const random = crypto.getRandomValues(new Uint8Array(8))
    let id = ''
    for (const byte of random) {
        id += byte.toString(16).padStart(2, '0')
    }
    return id
}

/** Issues this page's generation. A timeout is a `StoreRegistrationTimeoutError`; any other rejection is the command's own. */
export async function registerPageGeneration(): Promise<number> {
    let answer: unknown
    try {
        answer = await invoke<unknown>(STORE2_REGISTER_COMMAND)
    } catch (error) {
        throw gateErrorOf(error, '')
    }
    if (typeof answer !== 'number' || !Number.isSafeInteger(answer) || answer < 1) {
        throw new Error('store2_register_page returned an unreadable generation')
    }
    return answer
}

/** One chunk of a gated write. Resolves with the flush status the command answered, `undefined` when it answered none. */
async function sendChunk(
    key: string,
    generation: number,
    id: string,
    offset: number,
    piece: Uint8Array,
    last: boolean,
    raw: boolean,
): Promise<boolean | undefined> {
    if (raw && !rawTopUnavailable) {
        try {
            return readFlushed(await invoke<unknown>(STORE2_WRITE_TOP_CHUNK_RAW_COMMAND, piece, {
                headers: {
                    [CHUNK_KEY_HEADER]: encodeURIComponent(key),
                    [CHUNK_ID_HEADER]: id,
                    [CHUNK_OFFSET_HEADER]: String(offset),
                    [CHUNK_LAST_HEADER]: last ? '1' : '0',
                    // The shared header parser requires it; a gated write is always durable.
                    [CHUNK_DURABLE_HEADER]: '1',
                    [GATE_GENERATION_HEADER]: String(generation),
                },
            }))
        } catch (error) {
            if (!errorText(error).startsWith(NOT_RAW_PREFIX)) {
                throw error
            }
            // Refused before any disk access: the same chunk goes again as base64.
            rawTopUnavailable = true
        }
    }
    return readFlushed(await invoke<unknown>(STORE2_WRITE_TOP_CHUNK_COMMAND, {
        gen: generation, key, id, offset, data: bytesToBase64(piece), last,
    }))
}

async function writeChunks(generation: number, key: string, bytes: Uint8Array): Promise<boolean> {
    const android = transportKind() === 'android'
    const chunkBytes = android ? WRITE_CHUNK_BYTES : CHUNK_MAX
    const id = randomWriteId()
    let allFlushed = true
    let offset = 0
    try {
        do {
            const piece = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length))
            const last = offset + piece.length >= bytes.length
            const status = await sendChunk(key, generation, id, offset, piece, last, !android)
            allFlushed &&= status === true
            offset += piece.length
        } while (offset < bytes.length)
    } catch (error) {
        const typed = gateErrorOf(error, key)
        if (!(typed instanceof StoreStaleGenerationError) && offset > 0) {
            // A refused chunk already removed the temp file; any other failure leaves it for the command to drop.
            try {
                await invoke<void>(ABORT_CHUNKED_COMMAND, { key, id })
            } catch {
                // The leftover temp is removed by the boot sweep.
            }
        }
        throw typed
    }
    return allFlushed
}

/**
 * Writes `bytes` to `key` (`store2-commit` or `store2-fence`) under `generation` and
 * resolves with whether every directory flush succeeded. A `StoreStaleGenerationError`
 * means nothing was applied; any other rejection may have been.
 */
export async function writeTopKey(generation: number, key: string, bytes: Uint8Array): Promise<boolean> {
    if (shouldChunkWrite(bytes.length) || rawTopUnavailable) {
        return await writeChunks(generation, key, bytes)
    }
    try {
        const answer = await invoke<unknown>(STORE2_WRITE_TOP_RAW_COMMAND, bytes, {
            headers: {
                [CHUNK_KEY_HEADER]: encodeURIComponent(key),
                [GATE_GENERATION_HEADER]: String(generation),
            },
        })
        return readFlushed(answer) === true
    } catch (error) {
        if (errorText(error).startsWith(NOT_RAW_PREFIX)) {
            rawTopUnavailable = true
            return await writeChunks(generation, key, bytes)
        }
        throw gateErrorOf(error, key)
    }
}

function reportOf(keys: readonly string[], answer: unknown): DeleteReportEntry[] {
    if (!Array.isArray(answer) || answer.length !== keys.length) {
        throw new Error('store2_remove returned an unreadable result')
    }
    return answer.map((item: unknown, index): DeleteReportEntry => {
        const entry = item as { key?: unknown, outcome?: unknown, error?: unknown } | null
        if (typeof entry !== 'object' || entry === null || entry.key !== keys[index]) {
            throw new Error('store2_remove returned an unreadable result')
        }
        if (entry.outcome === 'removed') {
            return { key: keys[index], outcome: 'removed' }
        }
        if (entry.outcome === 'failed') {
            return { key: keys[index], outcome: 'failed', error: new Error(typeof entry.error === 'string' ? entry.error : 'the removal failed') }
        }
        throw new Error('store2_remove returned an unreadable result')
    })
}

/**
 * Removes `keys` under one hold of the gate. Resolves when every key is removed,
 * otherwise rejects with a `StoreDeleteManyError` holding the per-key report (a
 * key the command refused as not removable through the gate is
 * `StoreInvalidKeyError`, and nothing was removed). A `StoreStaleGenerationError`
 * means nothing was removed.
 */
export async function removeTopKeys(generation: number, keys: readonly string[]): Promise<void> {
    let answer: unknown
    try {
        answer = await invoke<unknown>(STORE2_REMOVE_COMMAND, { gen: generation, keys: [...keys] })
    } catch (error) {
        throw gateErrorOf(error, keys.join(', '))
    }
    const report = reportOf(keys, answer)
    if (report.some((entry) => entry.outcome !== 'removed')) {
        throw new StoreDeleteManyError(report)
    }
}
