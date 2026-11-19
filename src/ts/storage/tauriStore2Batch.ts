import { invoke } from '@tauri-apps/api/core'
import { MEASURE } from '../process/memory/measureFlag'
import { bridgeReplyBytes, shouldBypassFrozenPagePaths, transportKind, type TransportKind } from './tauriByteTransport'

/**
 * The page's side of `read_store2_units` (`src-tauri/src/store2_batch.rs`): the store2 unit files of one `readUnits`
 * call in one raw reply, framed like `get_assets_batch` (`[u8 status][u32 LE length][bytes]`, one frame per key).
 *
 * The batch may only supply `ok` bytes. Every other outcome (missing, invalid, error, large, and any key this
 * function leaves out) is the caller's to read per key, so the result of a read is the one a per-key read gives:
 * the batch never decides `null` or a failure. A reply that is malformed in any way is discarded whole and no frame
 * of it is trusted. A `deferred` frame (the response budget ran out before it) is asked for again in the next call.
 */

/** The transports that read store2 units in batches. The single platform switch: nothing else tests the platform. */
export const STORE2_BATCH_TRANSPORTS: readonly TransportKind[] = ['android', 'desktop']

export function store2BatchTransport(kind: TransportKind): boolean {
    return STORE2_BATCH_TRANSPORTS.includes(kind)
}

const COMMAND = 'read_store2_units'
/** `STORE2_BATCH_MAX_KEYS` of `store2_batch.rs`. */
const MAX_KEYS = 256
/** Measurement builds only: `off` makes every read go per key, read on every call, so one APK serves both arms. */
const KNOB_KEY = 'risu-measure-store2-batch'

/** The batch calls since the last `takeStore2BatchStats`, as a measurement build counts them. */
export interface Store2BatchStats {
    /** `read_store2_units` invokes made, whatever they came to. */
    calls: number
    /** Keys of a batch that was taken and that ended up read per key. */
    fallbackKeys: number
    /** The invokes' own milliseconds added up. */
    ms: number
    /** Reads the knob turned off. */
    offCalls: number
}

function emptyStats(): Store2BatchStats {
    return { calls: 0, fallbackKeys: 0, ms: 0, offCalls: 0 }
}

let stats: Store2BatchStats = emptyStats()

/**
 * Measurement builds only (`MEASURE`): the counts since the last take, which clears them; `null` otherwise. The export
 * takes once at its start, so its phase note covers that export only.
 */
export function takeStore2BatchStats(): Store2BatchStats | null {
    if (!MEASURE) {
        return null
    }
    const taken = stats
    stats = emptyStats()
    return taken
}

/** What the batch needs of a frame: the bytes of an `ok` one, whether the key was deferred; any other status is left to the per-key read. */
export type Store2BatchFrame = { status: 'ok', bytes: Uint8Array } | { status: 'deferred' } | { status: 'other' }

/** The status bytes of `get_assets_batch`: ok, missing, invalid, error, large, deferred. A body is allowed on ok, invalid and error only. */
const STATUS_OK = 0
const STATUS_DEFERRED = 5
const STATUS_COUNT = 6
const BODILESS = new Set([1, 4, 5])

/**
 * Reads a `read_store2_units` reply for `count` keys, strictly as `parseReadFrames` reads a `get_assets_batch` reply
 * (it lives in a module that needs `window`, which the store layer does not): throws unless the reply is bytes, every
 * frame is whole, a bodiless status has no body, and nothing is left over. The bytes of an `ok` frame are a view of the reply.
 */
export function parseStore2BatchFrames(response: unknown, count: number): Store2BatchFrame[] {
    const bytes = bridgeReplyBytes(response)
    if (bytes === null) {
        throw new Error('read_store2_units returned something other than bytes')
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const frames: Store2BatchFrame[] = []
    let offset = 0
    for (let i = 0; i < count; i++) {
        if (bytes.length - offset < 5) {
            throw new Error('read_store2_units response ends inside a frame header')
        }
        const status = bytes[offset]
        const length = view.getUint32(offset + 1, true)
        offset += 5
        if (status >= STATUS_COUNT) {
            throw new Error('read_store2_units response has an unknown status')
        }
        if (length > bytes.length - offset) {
            throw new Error('read_store2_units response ends inside a frame body')
        }
        if (length !== 0 && BODILESS.has(status)) {
            throw new Error('read_store2_units response gives a bodiless status a body')
        }
        if (status === STATUS_OK) {
            frames.push({ status: 'ok', bytes: bytes.subarray(offset, offset + length) })
        } else {
            frames.push({ status: status === STATUS_DEFERRED ? 'deferred' : 'other' })
        }
        offset += length
    }
    if (offset !== bytes.length) {
        throw new Error('read_store2_units response has bytes after its last frame')
    }
    return frames
}

/** Read on every call and never cached, so a change of the knob takes effect on the next read. */
function store2BatchKnobOff(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(KNOB_KEY) === 'off'
    } catch {
        return false
    }
}

/**
 * Reads the units of `keys` in as few `read_store2_units` calls as the budget allows and answers the keys whose bytes it
 * read whole, each with its own buffer, or `null` when the batch is not taken (another transport, a hidden Android
 * page, the knob off). A key it leaves out is read per key by the caller. `checkAddressable` throws for a key the
 * store refuses; such a key is never sent, so its per-key read throws the store's own error.
 */
export async function readStore2UnitBatch(keys: readonly string[], checkAddressable: (key: string) => void): Promise<Map<string, Uint8Array> | null> {
    if (!store2BatchTransport(transportKind()) || shouldBypassFrozenPagePaths()) {
        return null
    }
    if (MEASURE && store2BatchKnobOff()) {
        stats.offCalls += 1
        return null
    }
    const sendable: string[] = []
    for (const key of keys) {
        try {
            checkAddressable(key)
            sendable.push(key)
        } catch {
            // Left for the per-key read, which throws the store's own error.
        }
    }
    const out = new Map<string, Uint8Array>()
    let pending = sendable
    let attempted = false
    // Each call that continues the loop answers at least one key, so the key count bounds the calls.
    for (let round = 0; round < sendable.length && pending.length > 0; round++) {
        if (round > 0 && shouldBypassFrozenPagePaths()) {
            break
        }
        const sent = pending.slice(0, MAX_KEYS)
        attempted = true
        const started = MEASURE ? performance.now() : 0
        if (MEASURE) {
            stats.calls += 1
        }
        let results: Store2BatchFrame[]
        try {
            results = parseStore2BatchFrames(await invoke<unknown>(COMMAND, { keys: sent }), sent.length)
        } catch {
            break
        } finally {
            if (MEASURE) {
                stats.ms += performance.now() - started
            }
        }
        const deferred: string[] = []
        let answered = false
        for (let i = 0; i < sent.length; i++) {
            const result = results[i]
            if (result.status === 'ok') {
                out.set(sent[i], new Uint8Array(result.bytes))
                answered = true
            } else if (result.status === 'deferred') {
                deferred.push(sent[i])
            } else {
                answered = true
            }
        }
        if (!answered) {
            break
        }
        pending = [...deferred, ...pending.slice(MAX_KEYS)]
    }
    if (MEASURE && attempted) {
        stats.fallbackKeys += sendable.length - out.size
    }
    return out
}
