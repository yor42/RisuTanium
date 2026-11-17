import { isMobile } from '../platform'
import { decode, type Decoded } from '../chatCardImage'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES, androidWholeReadQueue, wholeReadBytesOfUrl, type InFlightGrant } from '../storage/assetUrlGate'
import { classifyImage } from './imageClass'

/**
 * Shows a character portrait at display size on a phone. A still portrait is shrunk once to fit the
 * screen's long side in device pixels (rounded up to a 256 px step), re-encoded as WebP with alpha and
 * served through an object URL. Animated, unknown and undecidable images keep the original URL.
 * Nothing here is persisted; object URLs and blobs live in memory only.
 */

/** A screen whose smaller side is under this many CSS pixels is a phone. */
const PHONE_SMALL_SIDE_CSS_PX = 600
const MAX_SIDE_STEP = 256
const PORTRAIT_SNIFF_BYTES = 1024 * 1024
const WEBP_QUALITY = 0.9

/** Time one shrink job may spend on its own work before it settles as "use the original". */
export const PORTRAIT_JOB_TIMEOUT_MS = 15000

export interface PortraitScreenFacts {
    mobile: boolean
    width: number
    height: number
    dpr: number
}

/**
 * Pure. The long side, in pixels, a phone portrait is shrunk to, or null when the screen is not a phone.
 * Rounding up to a step keeps small DPR differences from creating new cache keys.
 */
export function phonePortraitMaxSide(facts: PortraitScreenFacts): number | null {
    if (!facts.mobile) return null
    if (!(facts.width > 0) || !(facts.height > 0) || !(facts.dpr > 0)) return null
    if (Math.min(facts.width, facts.height) >= PHONE_SMALL_SIDE_CSS_PX) return null
    return Math.ceil(Math.max(facts.width, facts.height) * facts.dpr / MAX_SIDE_STEP) * MAX_SIDE_STEP
}

/** Reads the live screen on every call; reads no reactive state. */
export function currentPortraitMaxSide(): number | null {
    if (typeof window === 'undefined' || !window.screen) return null
    return phonePortraitMaxSide({
        mobile: isMobile,
        width: window.screen.width,
        height: window.screen.height,
        dpr: window.devicePixelRatio || 1,
    })
}

/**
 * Pure. The size that fits `maxSide` on its long side, or null when the image already fits, so it is never
 * enlarged and the original is used.
 */
export function fitWithin(width: number, height: number, maxSide: number): { w: number, h: number } | null {
    if (!(width > 0) || !(height > 0)) return null
    const longSide = Math.max(width, height)
    if (longSide <= maxSide) return null
    const scale = maxSide / longSide
    return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

export function revokePortraitUrl(url: string): void {
    URL.revokeObjectURL(url)
}

export type ShrinkOutcome =
    | { kind: 'shrunk', url: string, width: number, height: number, bytes: number }
    | { kind: 'original' }
    | { kind: 'cancelled' }

export interface PortraitContext {
    imageSmoothingQuality: ImageSmoothingQuality
    drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}

export interface PortraitCanvas {
    width: number
    height: number
    getContext(kind: '2d'): PortraitContext | null
    toBlob(callback: BlobCallback, type?: string, quality?: number): void
}

export interface PortraitDeps {
    fetch(src: string, init: { signal: AbortSignal }): Promise<{ ok: boolean, blob(): Promise<Blob> }>
    decode(blob: Blob, signal: AbortSignal, options: ImageBitmapOptions): Promise<Decoded | null>
    createCanvas(width: number, height: number): PortraitCanvas
    encode(canvas: PortraitCanvas, type: string, quality: number): Promise<Blob | null>
    createObjectURL(blob: Blob): string
}

export const browserDeps: PortraitDeps = {
    fetch: (src, init) => fetch(src, init),
    decode: (blob, signal, options) => decode(blob, signal, options),
    createCanvas: (width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
    },
    encode: (canvas, type, quality) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality)),
    createObjectURL: (blob) => URL.createObjectURL(blob),
}

interface Job {
    src: string
    maxSide: number
    signal: AbortSignal
    deps: PortraitDeps
    resolve: (outcome: ShrinkOutcome) => void
    state: 'queued' | 'running' | 'done'
    scope: AbortController
    timer: ReturnType<typeof setTimeout> | undefined
    releases: (() => void)[]
    onAbort: () => void
}

const queue: Job[] = []
let running: Job | null = null

function armTimer(job: Job): void {
    clearTimeout(job.timer)
    job.timer = setTimeout(() => finish(job, { kind: 'original' }), PORTRAIT_JOB_TIMEOUT_MS)
}

/** Marks a stage's return: every stage either finishes its job or waits for one dependency. */
const STEP: unique symbol = Symbol('portraitStep')
type Step = typeof STEP

/** The only exit of a job: runs once, releases everything it opened, frees the slot and pumps. */
function finish(job: Job, outcome: ShrinkOutcome): Step {
    if (job.state === 'done') return STEP
    job.state = 'done'
    clearTimeout(job.timer)
    job.timer = undefined
    job.signal.removeEventListener('abort', job.onAbort)
    job.scope.abort()
    for (const release of job.releases.splice(0)) {
        try {
            release()
        } catch {
            // A release that throws must not keep the slot.
        }
    }
    job.resolve(outcome)
    if (running === job) {
        running = null
        pump()
    }
    return STEP
}

function pump(): void {
    if (running !== null) return
    const next = queue.shift()
    if (next === undefined) return
    running = next
    next.state = 'running'
    try {
        start(next)
    } catch {
        finish(next, { kind: 'original' })
    }
}

type PortraitResponse = Awaited<ReturnType<PortraitDeps['fetch']>>

const drop = (): void => {}

/**
 * A job is finished from outside, by its caller's abort, by its timer or by the reset seam, at any moment
 * between two stages and never inside one: a stage is synchronous. `after` is the only place that resumes a
 * job. It checks that the job is still running and calls the stage in the same synchronous step, so no
 * dependency is called, no resource is taken and no object URL is created for a finished job. A value that
 * arrives for a finished job goes to its `discard` and no further. A stage never awaits and is called only
 * by `after` (or by `pump` for the first one); the `Step` return type enforces that a stage is not `async`
 * and always finishes or waits. An await or a promise hop between the check and a dependency call would let
 * a finish run in between. A dependency already started when its job finishes cannot be stopped from here:
 * a decode or an encode has no cancel, so only its result is discarded and its native work may overlap the
 * next job's.
 */
function after<T>(job: Job, pending: Promise<T>, discard: (late: T) => void, stage: (value: T) => Step): Step {
    void pending.then(
        (value) => {
            if (job.state !== 'running') {
                try {
                    discard(value)
                } catch {
                    // A discard that throws must not break the driver.
                }
                return
            }
            try {
                stage(value)
            } catch {
                finish(job, { kind: 'original' })
            }
        },
        () => {
            finish(job, { kind: 'original' })
        },
    )
    return STEP
}

// The wait for the whole-read budget is outside the time bound: it ends when another holder's own settle
// timer frees the budget, or when the caller aborts. No timer runs during the wait.
function start(job: Job): Step {
    const wholeBytes = isAndroidTransport() ? wholeReadBytesOfUrl(job.src) : undefined
    if (wholeBytes !== undefined && wholeBytes >= ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES) {
        return after(job, androidWholeReadQueue().acquire(wholeBytes), (late) => late.release(), (grant) => onGrant(job, grant))
    }
    return beginFetch(job)
}

function onGrant(job: Job, grant: InFlightGrant): Step {
    job.releases.push(() => grant.release())
    return beginFetch(job)
}

function beginFetch(job: Job): Step {
    armTimer(job)
    return after(job, job.deps.fetch(job.src, { signal: job.scope.signal }), drop, (response) => onResponse(job, response))
}

function onResponse(job: Job, response: PortraitResponse): Step {
    if (!response.ok) return finish(job, { kind: 'original' })
    return after(job, response.blob(), drop, (blob) => onBlob(job, blob))
}

function onBlob(job: Job, blob: Blob): Step {
    if (blob.size === 0) return finish(job, { kind: 'original' })
    return after(job, blob.slice(0, PORTRAIT_SNIFF_BYTES).arrayBuffer(), drop, (prefix) => onPrefix(job, blob, prefix))
}

function onPrefix(job: Job, blob: Blob, prefix: ArrayBuffer): Step {
    const cls = classifyImage(new Uint8Array(prefix), blob.size <= PORTRAIT_SNIFF_BYTES)
    if (cls.kind !== 'still') return finish(job, { kind: 'original' })
    // A null decode is a failed one or an abort; after an abort the job is already finished and its stage never runs.
    return after(job, job.deps.decode(blob, job.scope.signal, { imageOrientation: 'from-image' }), (late) => late?.release(), (decoded) => onDecoded(job, decoded))
}

function onDecoded(job: Job, decoded: Decoded | null): Step {
    if (decoded === null) return finish(job, { kind: 'original' })
    job.releases.push(() => decoded.release())
    const target = fitWithin(decoded.width, decoded.height, job.maxSide)
    if (target === null) return finish(job, { kind: 'original' })

    const canvas = job.deps.createCanvas(target.w, target.h)
    job.releases.push(() => {
        canvas.width = 0
        canvas.height = 0
    })
    const context = canvas.getContext('2d')
    if (!context) return finish(job, { kind: 'original' })
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, 0, 0, target.w, target.h)

    return after(job, job.deps.encode(canvas, 'image/webp', WEBP_QUALITY), drop, (encoded) => onEncoded(job, target, encoded))
}

function onEncoded(job: Job, target: { w: number, h: number }, encoded: Blob | null): Step {
    if (encoded === null || encoded.size === 0) return finish(job, { kind: 'original' })
    // Nothing sits between the URL and the finish, so a job that creates a URL always delivers it.
    const url = job.deps.createObjectURL(encoded)
    return finish(job, { kind: 'shrunk', url, width: target.w, height: target.h, bytes: encoded.size })
}

/**
 * Shrinks the portrait at `src` to fit `maxSide`, one job at a time in arrival order. Never rejects. A job
 * that does not finish within `PORTRAIT_JOB_TIMEOUT_MS` of its own work settles as `original` and the queue
 * moves on; an abort settles it as `cancelled` at once, and a job still queued never calls a dependency.
 * Every late value is released. The wait for the Android whole-read budget is not counted in the bound: it
 * ends through the other holders' settle timers or through the caller's abort, so a holder of that budget
 * without a timer would stall this queue. Aborting a fetch frees the JS side only; a native handler that
 * keeps reading is outside this module's control. A decode or an encode already started when a job finishes
 * cannot be stopped either: only its result is discarded, so its native work may overlap the next job's.
 */
export function shrinkPortrait(src: string, maxSide: number, signal: AbortSignal, deps: PortraitDeps = browserDeps): Promise<ShrinkOutcome> {
    if (signal.aborted) return Promise.resolve({ kind: 'cancelled' })
    return new Promise<ShrinkOutcome>((resolve) => {
        const job: Job = {
            src,
            maxSide,
            signal,
            deps,
            resolve,
            state: 'queued',
            scope: new AbortController(),
            timer: undefined,
            releases: [],
            onAbort: () => {
                if (job.state === 'queued') {
                    const index = queue.indexOf(job)
                    if (index >= 0) queue.splice(index, 1)
                    job.state = 'done'
                    resolve({ kind: 'cancelled' })
                    return
                }
                finish(job, { kind: 'cancelled' })
            },
        }
        signal.addEventListener('abort', job.onAbort, { once: true })
        queue.push(job)
        pump()
    })
}

/** Test seam: cancels every queued job without calling a dependency, finishes the running one and clears the slot. */
export function resetPortraitQueueForTest(): void {
    for (const job of queue.splice(0)) {
        job.state = 'done'
        job.signal.removeEventListener('abort', job.onAbort)
        job.resolve({ kind: 'cancelled' })
    }
    if (running !== null) finish(running, { kind: 'cancelled' })
    running = null
}
