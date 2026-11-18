import { invoke } from '@tauri-apps/api/core'
import { bridgeReplyBytes, shouldBypassFrozenPagePaths } from '../storage/tauriByteTransport'

/**
 * The page side of the native avatar preview (`avatar_preview` in
 * src-tauri). A file above the whole-read limit that no embedded thumbnail
 * covers is decoded and downscaled in Rust, keyed by its `assets/` key: no URL
 * and no path ever leave this module.
 *
 * Reply layout: `status u8 | w u32 LE | h u32 LE | rgba`. Status 0 carries
 * `w * h * 4` bytes of RGBA with both sides in 1..MAX_PREVIEW_SIDE; statuses
 * 1..5 (unsupported, too large, animated, malformed, deadline) carry no pixels
 * and `w = h = 0`.
 */

/** The longest side the native side may return. */
export const MAX_PREVIEW_SIDE = 2048

const REPLY_HEADER_BYTES = 9

/** The native refusals; each repeats identically for the same content, so the caller persists it. */
export type RefusalStatus = 1 | 2 | 3 | 4 | 5

export type NativeOutcome =
    | { kind: 'pixels', width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer> }
    | { kind: 'refused', status: RefusalStatus }
    /** Nothing was decided: cancelled, busy, I/O failure, hidden page, abandoned caller, malformed reply or timeout. Never stored. */
    | { kind: 'transient' }

const TRANSIENT: NativeOutcome = { kind: 'transient' }

/**
 * The longest the page waits for one native call, from the invoke. It exceeds
 * the native worst case (orphan wait, running-time deadline and the decoder's
 * last step), so a reply that matters, a persisted `Deadline` included, arrives
 * before it. After it the lane is free again and the call counts as transient;
 * a reply that comes later is ignored and the file is retried next session.
 */
export const NATIVE_HARD_CAP_MS = 30_000

/**
 * Pure. The outcome a reply encodes, or `null` when its length, status or
 * dimensions break the layout (the caller treats `null` as transient).
 */
export function parsePreviewReply(bytes: Uint8Array): NativeOutcome | null {
    if (bytes.length < REPLY_HEADER_BYTES) {
        return null
    }
    const status = bytes[0]
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(1, true)
    const height = view.getUint32(5, true)
    if (status === 0) {
        if (width < 1 || height < 1 || width > MAX_PREVIEW_SIDE || height > MAX_PREVIEW_SIDE) {
            return null
        }
        const rgbaBytes = width * height * 4
        if (bytes.length !== REPLY_HEADER_BYTES + rgbaBytes) {
            return null
        }
        const rgba = new Uint8ClampedArray(rgbaBytes)
        rgba.set(bytes.subarray(REPLY_HEADER_BYTES))
        return { kind: 'pixels', width, height, rgba }
    }
    if (status >= 1 && status <= 5) {
        if (width !== 0 || height !== 0 || bytes.length !== REPLY_HEADER_BYTES) {
            return null
        }
        return { kind: 'refused', status: status as RefusalStatus }
    }
    return null
}

type InvokeFn = (command: string, args: Record<string, unknown>) => Promise<unknown>

const realInvoke: InvokeFn = (command, args) => invoke<unknown>(command, args)

let currentInvoke: InvokeFn = realInvoke

export interface NativePreviewOptions {
    /** The short side the native decode scales to. */
    shortSide: number
    /** Read when the job reaches the front of the lane, never earlier. False means the caller has left and no native work starts. */
    stillWanted: () => boolean
}

interface LaneJob {
    key: string
    options: NativePreviewOptions
    resolve: (outcome: NativeOutcome) => void
}

// The native side decodes one file at a time and treats a second caller as
// proof that the previous page's job outlived it, so this page never has two
// calls in flight: jobs wait here in arrival order.
const lane: LaneJob[] = []
let laneBusy = false
/** Bumped by the test reset, so a call started before it neither frees the lane nor pumps afterwards. */
let laneEpoch = 0
let activeTimer: ReturnType<typeof setTimeout> | undefined
/** A page-random base below 2^51 plus a counter stays below 2^52, exact as a JSON number. */
const ticketBase = Math.floor(Math.random() * 2 ** 51)
let ticketCounter = 0

function nextTicket(): number {
    ticketCounter++
    return ticketBase + ticketCounter
}

function wanted(options: NativePreviewOptions): boolean {
    try {
        return options.stillWanted()
    } catch {
        // A broken getter must not start a native decode.
        return false
    }
}

function pumpLane() {
    while (!laneBusy && lane.length > 0) {
        const job = lane.shift()
        if (!job) {
            break
        }
        // A hidden Android page is frozen by the system and never receives a raw
        // reply of this size, so no job starts while it is hidden.
        if (!wanted(job.options) || shouldBypassFrozenPagePaths()) {
            job.resolve(TRANSIENT)
            continue
        }
        startJob(job)
    }
}

function startJob(job: LaneJob) {
    laneBusy = true
    const epoch = laneEpoch
    const ticket = nextTicket()
    let settled = false
    const settle = (outcome: NativeOutcome) => {
        if (settled) {
            return
        }
        settled = true
        clearTimeout(timer)
        job.resolve(outcome)
        if (epoch === laneEpoch) {
            laneBusy = false
            pumpLane()
        }
    }
    const timer = setTimeout(() => {
        if (settled) {
            return
        }
        // Nothing settled in time: stop the native job and give the lane back.
        void new Promise<unknown>((resolve) => resolve(currentInvoke('avatar_preview_cancel', { ticket }))).catch(() => {})
        settle(TRANSIENT)
    }, NATIVE_HARD_CAP_MS)
    activeTimer = timer
    new Promise<unknown>((resolve) => resolve(currentInvoke('avatar_preview', { key: job.key, shortSide: job.options.shortSide, ticket }))).then(
        (reply) => {
            const bytes = bridgeReplyBytes(reply)
            settle((bytes === null ? null : parsePreviewReply(bytes)) ?? TRANSIENT)
        },
        () => settle(TRANSIENT)
    )
}

/**
 * Asks the native side for a thumbnail-sized preview of `key`. Never rejects.
 * Calls run one at a time in arrival order.
 */
export function requestNativePreview(key: string, options: NativePreviewOptions): Promise<NativeOutcome> {
    return new Promise<NativeOutcome>((resolve) => {
        lane.push({ key, options, resolve })
        pumpLane()
    })
}

export const __avatarPreviewNativeTestHooks = {
    setInvoke(fn: InvokeFn) {
        currentInvoke = fn
    },
    reset() {
        clearTimeout(activeTimer)
        activeTimer = undefined
        for (const job of lane.splice(0)) {
            job.resolve(TRANSIENT)
        }
        laneBusy = false
        laneEpoch++
        currentInvoke = realInvoke
    },
    laneState() {
        return { busy: laneBusy, queued: lane.length }
    }
}
