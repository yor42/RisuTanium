import localforage from 'localforage'
import { readImage } from '../globalApi.svelte'
import { getImageType } from './imageType'
import { DBState } from '../stores.svelte'
import type { Database, folder } from '../storage/database.svelte'
import { asBuffer } from '../util'
import { isNodeServer, isTauri } from '../platform'
import { getAppStore } from '../storage/store/appStore'
import { readTauriHeader, readUrlHeader, type ImageHeader } from './avatarThumbHeader'

/**
 * Small cached thumbnails for the 56px list avatars (grid, mobile list,
 * sidebar). Where a thumbnail exists, the lists draw it instead of holding
 * the full-size bitmap, so a baseline NovelAI-sized portrait (832x1216,
 * several MB decoded) costs a few KB and a one-time decode instead of paying
 * its full bitmap size on every list render.
 */

export const THUMB_SHORT_SIDE = 168
/** Bump whenever the size, format or scaling policy changes; older records
 *  then count as absent instead of being served stale. */
export const THUMB_VERSION = 1

type ThumbRecord = { v: number, src: string } | { v: number, skip: true }
type GenResult = { src: string } | { skip: true } | null
/** Public generator shape used by tests: no cleanup plumbing to inject. */
type Generator = (loc: string) => Promise<GenResult>
type ReadImageFn = (loc: string) => Promise<Uint8Array | null | undefined>

interface ThumbStoreLike {
    getItem(key: string): Promise<unknown>
    setItem(key: string, value: unknown): Promise<unknown>
    removeItem(key: string): Promise<void>
    iterate(callback: (value: unknown, key: string) => void): Promise<void>
}

interface GenContext {
    /** Lets the real generator register one cleanup the queue's timeout can
     *  call immediately, since a hung header read or decode may never reach
     *  its own `finally`. The function must release everything the task has
     *  opened so far and everything it opens later. If the task has already
     *  timed out by the time this is called, `fn` runs immediately instead of
     *  waiting to be invoked later. */
    setCleanup(fn: () => void): void
    /** True once this task's own timeout has already fired. The generator
     *  checks this after each await so a header read, whole read or decode
     *  that was still in flight at timeout doesn't go on to draw and encode
     *  the image for a caller nobody is waiting on any more. */
    isCancelled(): boolean
}

type FullGenerator = (loc: string, ctx: GenContext) => Promise<GenResult>

const DEFAULT_CONCURRENCY = 2
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MEMO_MAX_ENTRIES = 1000
const DEFAULT_MEMO_MAX_BYTES = 16 * 1024 * 1024
/** Bounds a single `getItem`/`setItem` call, separate from `timeoutMs`
 *  (which bounds the whole read-decode-draw pipeline), so a hung IndexedDB
 *  open or transaction can't hold a store call - or the concurrency slot
 *  `persistRecord` is awaited under - open indefinitely. */
const DEFAULT_STORE_TIMEOUT_MS = 5000

let concurrency = DEFAULT_CONCURRENCY
let timeoutMs = DEFAULT_TIMEOUT_MS
let memoMaxEntries = DEFAULT_MEMO_MAX_ENTRIES
let memoMaxBytes = DEFAULT_MEMO_MAX_BYTES
let storeTimeoutMs = DEFAULT_STORE_TIMEOUT_MS

/** Sentinel returned by `withStoreTimeout` when the timeout wins the race;
 *  a rejection from the underlying call still propagates normally. */
const STORE_TIMEOUT = Symbol('avatarThumb-store-timeout')

/** Races a store call against `storeTimeoutMs`. On timeout resolves to
 *  `STORE_TIMEOUT` while leaving the original call to settle in the
 *  background (its `.then` here still "handles" it, so a later rejection
 *  never surfaces as unhandled). A genuine rejection is not converted to a
 *  timeout - it still rejects, so existing error handling is unchanged. */
function withStoreTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof STORE_TIMEOUT> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(STORE_TIMEOUT), ms)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (err) => {
                clearTimeout(timer)
                reject(err)
            }
        )
    })
}

// ---------------------------------------------------------------------------
// Store: a cache, not data. Losing it only costs regeneration, so every
// failure path below falls back to "the thumbnail feature is off" instead of
// surfacing an error.
// ---------------------------------------------------------------------------

let realStore: ThumbStoreLike | null | undefined
let storeOverride: ThumbStoreLike | null = null

function getStore(): ThumbStoreLike | null {
    if (storeOverride) {
        return storeOverride
    }
    if (realStore === undefined) {
        try {
            // Pinning the driver keeps bulk thumbnails out of localStorage
            // when IndexedDB is unavailable, rather than silently degrading.
            realStore = localforage.createInstance({
                name: 'risuThumb',
                storeName: 'avatarThumb',
                driver: localforage.INDEXEDDB
            }) as unknown as ThumbStoreLike
        } catch {
            realStore = null
        }
    }
    return realStore
}

async function readStoreRecord(loc: string): Promise<{ kind: 'src', src: string } | { kind: 'skip' } | { kind: 'miss' }> {
    const store = getStore()
    if (!store) {
        return { kind: 'miss' }
    }
    const raw = await withStoreTimeout(store.getItem(loc), storeTimeoutMs)
    if (raw === STORE_TIMEOUT) {
        // A hung read counts as a miss rather than blocking the caller.
        return { kind: 'miss' }
    }
    if (!raw || typeof raw !== 'object') {
        return { kind: 'miss' }
    }
    const rec = raw as Partial<{ v: number, src: string, skip: true }>
    if (rec.v !== THUMB_VERSION) {
        return { kind: 'miss' }
    }
    if (rec.skip) {
        return { kind: 'skip' }
    }
    if (typeof rec.src === 'string') {
        return { kind: 'src', src: rec.src }
    }
    return { kind: 'miss' }
}

async function persistRecord(loc: string, record: ThumbRecord): Promise<void> {
    const store = getStore()
    if (!store) {
        return
    }
    try {
        // A timeout (like a rejection) is simply ignored here: the caller
        // already has the generated src regardless of whether this write
        // ever lands.
        await withStoreTimeout(store.setItem(loc, record), storeTimeoutMs)
    } catch {
        // Best-effort: a full quota or a broken store must not take away the
        // thumbnail already generated for this call.
    }
}

// ---------------------------------------------------------------------------
// In-memory memo (LRU by insertion order) and in-flight dedupe.
// ---------------------------------------------------------------------------

const memo = new Map<string, string | null>()
let memoBytes = 0
const inFlight = new Map<string, Promise<string | null>>()

function memoValueBytes(value: string | null): number {
    return value ? value.length : 0
}

function memoize(loc: string, value: string | null) {
    if (memo.has(loc)) {
        memoBytes -= memoValueBytes(memo.get(loc) ?? null)
        memo.delete(loc)
    }
    memo.set(loc, value)
    memoBytes += memoValueBytes(value)
    while (memo.size > 0 && (memo.size > memoMaxEntries || memoBytes > memoMaxBytes)) {
        const oldestKey = memo.keys().next().value
        if (oldestKey === undefined) {
            break
        }
        memoBytes -= memoValueBytes(memo.get(oldestKey) ?? null)
        memo.delete(oldestKey)
    }
}

// ---------------------------------------------------------------------------
// Queue: concurrency-limited, LIFO (the icon still on screen shouldn't wait
// behind ones already scrolled past), with a per-task timeout.
// ---------------------------------------------------------------------------

interface QueueTask {
    loc: string
    resolve: (value: string | null) => void
}

const queue: QueueTask[] = []
let running = 0

function pump() {
    while (running < concurrency && queue.length > 0) {
        const task = queue.pop()
        if (!task) {
            break
        }
        running++
        void runTask(task)
    }
}

async function runTask(task: QueueTask) {
    let settled = false
    let cancelled = false
    let cleanupFn: (() => void) | null = null

    // Frees the slot and resolves exactly once, whichever of "timeout" or
    // "generator settled" happens first. The other path becomes a no-op via
    // `settled`, so the concurrency slot can never be double-freed.
    const finishAndFree = (value: string | null) => {
        if (settled) {
            return
        }
        settled = true
        running--
        task.resolve(value)
        pump()
    }

    const timer = setTimeout(() => {
        cancelled = true
        try {
            cleanupFn?.()
        } catch {
            // best-effort cleanup only
        }
        finishAndFree(null)
    }, timeoutMs)

    const ctx: GenContext = {
        setCleanup(fn) {
            cleanupFn = fn
            if (settled) {
                // A generator that registers its cleanup after the timeout
                // already fired must still release what it opened: running
                // `fn` here keeps a late registration from leaking a blob
                // URL, an image or a request instead of dropping the cleanup.
                try {
                    fn()
                } catch {
                    // best-effort cleanup only
                }
            }
        },
        isCancelled() {
            return cancelled
        }
    }

    try {
        const result = await currentGenerator(task.loc, ctx)
        clearTimeout(timer)
        if (settled) {
            // Already timed out: a late result is neither stored nor memoized.
            return
        }
        if (result === null) {
            // Transient failure: not stored, not memoized, so the next
            // request retries.
            finishAndFree(null)
        }
        else if ('skip' in result) {
            await persistRecord(task.loc, { v: THUMB_VERSION, skip: true })
            memoize(task.loc, null)
            finishAndFree(null)
        }
        else {
            await persistRecord(task.loc, { v: THUMB_VERSION, src: result.src })
            memoize(task.loc, result.src)
            finishAndFree(result.src)
        }
    } catch {
        clearTimeout(timer)
        finishAndFree(null)
    }
}

function enqueueGeneration(loc: string): Promise<string | null> {
    if (!ensureReadbackAllowed()) {
        return Promise.resolve(null)
    }
    return new Promise<string | null>((resolve) => {
        queue.push({ loc, resolve })
        pump()
    })
}

// ---------------------------------------------------------------------------
// Public lookup.
// ---------------------------------------------------------------------------

async function resolveThumb(loc: string): Promise<string | null> {
    try {
        const record = await readStoreRecord(loc)
        if (record.kind === 'src') {
            memoize(loc, record.src)
            return record.src
        }
        if (record.kind === 'skip') {
            memoize(loc, null)
            return null
        }
    } catch {
        // A broken store read must not reject the caller; it also can't be
        // trusted enough to attempt generation this call.
        return null
    }
    return enqueueGeneration(loc)
}

/**
 * Resolves a cached (or freshly generated) list-avatar thumbnail for `loc`,
 * or `null` when the caller should fall back to the full-size path. Never
 * rejects, and reads no reactive state before its first await so it stays
 * safe to call from a Svelte `{@const}`.
 */
export async function getAvatarThumbSrc(loc: string): Promise<string | null> {
    if (memo.has(loc)) {
        return memo.get(loc) ?? null
    }
    const existing = inFlight.get(loc)
    if (existing) {
        return existing
    }
    const promise = resolveThumb(loc).finally(() => {
        inFlight.delete(loc)
    })
    inFlight.set(loc, promise)
    return promise
}

/** Only local `assets/` locs are eligible, never more aggressive than the
 *  existing full-size path. */
export function isThumbEligible(loc: string): boolean {
    return loc.startsWith('assets/')
}

// ---------------------------------------------------------------------------
// Canvas readback guard: some fingerprinting-resistant browsers return
// altered pixel data from getImageData, which would make a stored "thumbnail"
// garbage. Checked once per session, before the first generation attempt.
// ---------------------------------------------------------------------------

let readbackChecked = false
let readbackAllowed = true
let readbackCheckFn: () => boolean = defaultReadbackCheck

function ensureReadbackAllowed(): boolean {
    if (!readbackChecked) {
        readbackChecked = true
        try {
            readbackAllowed = readbackCheckFn()
        } catch {
            readbackAllowed = false
        }
    }
    return readbackAllowed
}

function defaultReadbackCheck(): boolean {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = 4
        canvas.height = 4
        const c2d = canvas.getContext('2d')
        if (!c2d) {
            return false
        }
        const expected = new Uint8ClampedArray(4 * 4 * 4)
        for (let i = 0; i < 16; i++) {
            expected[i * 4] = (i * 17) % 256
            expected[i * 4 + 1] = (i * 53) % 256
            expected[i * 4 + 2] = (i * 97) % 256
            expected[i * 4 + 3] = 255
        }
        c2d.putImageData(new ImageData(expected.slice(), 4, 4), 0, 0)
        const actual = c2d.getImageData(0, 0, 4, 4).data
        for (let i = 0; i < expected.length; i++) {
            if (actual[i] !== expected[i]) {
                return false
            }
        }
        return true
    } catch {
        return false
    }
}

// ---------------------------------------------------------------------------
// Pure format sniffing, exported for tests.
// ---------------------------------------------------------------------------

function readU32BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0
}

function chunkTypeAt(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function isGif(bytes: Uint8Array): boolean {
    return bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
}

function isPng(bytes: Uint8Array): boolean {
    return bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
}

function isApng(bytes: Uint8Array): boolean {
    let pos = 8
    while (pos + 8 <= bytes.length) {
        const length = readU32BE(bytes, pos)
        const type = chunkTypeAt(bytes, pos + 4)
        if (type === 'IDAT' || type === 'IEND') {
            return false
        }
        if (type === 'acTL') {
            return true
        }
        if (pos + 8 + length + 4 > bytes.length) {
            // Overrunning length: malformed, stop without deciding.
            return false
        }
        pos += 8 + length + 4
    }
    return false
}

function isRiffWebp(bytes: Uint8Array): boolean {
    return bytes.length >= 16 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
    if (bytes.length < 21) {
        return false
    }
    if (chunkTypeAt(bytes, 12) !== 'VP8X') {
        return false
    }
    return (bytes[20] & 0x02) !== 0
}

function isIsoBmff(bytes: Uint8Array): boolean {
    return bytes.length >= 12 && chunkTypeAt(bytes, 4) === 'ftyp'
}

function hasAvisBrand(bytes: Uint8Array): boolean {
    if (chunkTypeAt(bytes, 8) === 'avis') {
        return true
    }
    const boxSize = readU32BE(bytes, 0)
    const end = boxSize > 0 && boxSize <= bytes.length ? boxSize : bytes.length
    let pos = 16
    while (pos + 4 <= end) {
        if (chunkTypeAt(bytes, pos) === 'avis') {
            return true
        }
        pos += 4
    }
    return false
}

/** Pure and never throws, even on truncated or malformed input. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
    try {
        if (isGif(bytes)) {
            return true
        }
        if (isPng(bytes)) {
            return isApng(bytes)
        }
        if (isRiffWebp(bytes)) {
            return isAnimatedWebp(bytes)
        }
        if (isIsoBmff(bytes)) {
            return hasAvisBrand(bytes)
        }
        return false
    } catch {
        return false
    }
}

/** What the thumbnail path does with a file, decided from its first bytes (or
 *  from all of them). `undecided` only ever answers a prefix. */
export type ImageClass =
    | { kind: 'null' }
    | { kind: 'animated' }
    | { kind: 'unknown' }
    | { kind: 'still', mime: string }
    | { kind: 'undecided' }

type Animation = 'animated' | 'still' | 'undecided'

/** The shortest prefix every animation rule below can read: the VP8X flags
 *  byte of a WebP is at offset 20. */
const MIN_DECIDABLE_PREFIX = 21

function startsWithJpegSignature(bytes: Uint8Array): boolean {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/** `bytes` is a PNG. Same walk as `isApng`, but a prefix that ends, or a chunk
 *  that runs past it, before `IDAT`/`IEND` decides nothing. */
function pngAnimation(bytes: Uint8Array, whole: boolean): Animation {
    let pos = 8
    while (pos + 8 <= bytes.length) {
        const length = readU32BE(bytes, pos)
        const type = chunkTypeAt(bytes, pos + 4)
        if (type === 'IDAT' || type === 'IEND') {
            return 'still'
        }
        if (type === 'acTL') {
            return 'animated'
        }
        if (pos + 8 + length + 4 > bytes.length) {
            return whole ? 'still' : 'undecided'
        }
        pos += 8 + length + 4
    }
    return whole ? 'still' : 'undecided'
}

function prefixAnimation(bytes: Uint8Array): Animation {
    if (isGif(bytes)) {
        return 'animated'
    }
    if (isPng(bytes)) {
        return pngAnimation(bytes, false)
    }
    if (isRiffWebp(bytes)) {
        return isAnimatedWebp(bytes) ? 'animated' : 'still'
    }
    if (isIsoBmff(bytes)) {
        if (hasAvisBrand(bytes)) {
            return 'animated'
        }
        // A box that ends inside the prefix has been scanned in full; size 0
        // ("to end of file") and a size past the prefix have not.
        const boxSize = readU32BE(bytes, 0)
        return boxSize > 0 && boxSize <= bytes.length ? 'still' : 'undecided'
    }
    return 'still'
}

/**
 * Pure. Classifies a file from `bytes`, which is the whole file when `whole`
 * is true and otherwise its first bytes. On a whole file the answer matches
 * what `isAnimatedImage` and `getImageType` give together, with one rule
 * added: a buffer that starts `FF D8 FF` is a still JPEG whether or not it
 * ends in `FF D9`. A JPEG has no animated form, and files with data after the
 * end marker are common.
 */
export function classifyImage(bytes: Uint8Array, whole: boolean): ImageClass {
    if (whole && bytes.length < 12) {
        return { kind: 'null' }
    }
    if (startsWithJpegSignature(bytes)) {
        return { kind: 'still', mime: 'image/jpeg' }
    }
    if (!whole) {
        // Whether `FF D8` starts a JPEG cannot be told from a prefix, because
        // `getImageType` looks at the last two bytes.
        if ((bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) || bytes.length < MIN_DECIDABLE_PREFIX) {
            return { kind: 'undecided' }
        }
    }
    const animation: Animation = whole ? (isAnimatedImage(bytes) ? 'animated' : 'still') : prefixAnimation(bytes)
    if (animation === 'animated') {
        return { kind: 'animated' }
    }
    if (animation === 'undecided') {
        return { kind: 'undecided' }
    }
    const type = getImageType(bytes)
    if (type === 'Unknown') {
        return { kind: 'unknown' }
    }
    return { kind: 'still', mime: mimeForType(type) }
}

/** Pure. `null` when the short side is already at or under `shortSide`, since
 *  the full-size path then costs no more than a thumbnail would. */
export function thumbDimensions(w: number, h: number, shortSide: number): { w: number, h: number } | null {
    if (!(w > 0) || !(h > 0)) {
        return null
    }
    if (Math.min(w, h) <= shortSide) {
        return null
    }
    const scale = shortSide / Math.min(w, h)
    return {
        w: Math.max(1, Math.round(w * scale)),
        h: Math.max(1, Math.round(h * scale))
    }
}

// ---------------------------------------------------------------------------
// Real generator.
// ---------------------------------------------------------------------------

let currentReadImage: ReadImageFn = readImage

function mimeForType(type: ReturnType<typeof getImageType>): string {
    switch (type) {
        case 'JPEG': return 'image/jpeg'
        case 'PNG': return 'image/png'
        case 'WEBP': return 'image/webp'
        case 'BMP': return 'image/bmp'
        case 'AVIF': return 'image/avif'
        default: return 'application/octet-stream'
    }
}

/** Everything one task has opened and must release if the queue's timeout
 *  fires: the header request and every image or blob URL. `own` runs a
 *  release at once when the task has already timed out, so a resource opened
 *  after the timeout is not leaked. */
interface TaskScope {
    signal: AbortSignal
    isCancelled(): boolean
    own(release: () => void): void
    release(): void
}

/** Registers the scope's single cleanup with the queue synchronously, before
 *  the task's first await. */
function makeTaskScope(ctx: GenContext): TaskScope {
    const controller = new AbortController()
    const releases: Array<() => void> = []
    const release = () => {
        controller.abort()
        for (const fn of releases.splice(0)) {
            try {
                fn()
            } catch {
                // best-effort cleanup only
            }
        }
    }
    ctx.setCleanup(release)
    return {
        signal: controller.signal,
        isCancelled: () => ctx.isCancelled(),
        own(fn) {
            if (ctx.isCancelled()) {
                try {
                    fn()
                } catch {
                    // best-effort cleanup only
                }
                return
            }
            releases.push(fn)
        },
        release,
    }
}

/** Set once, for the rest of the page's life, when decoding from the URL
 *  failed for an avatar that the whole read then decoded. The page then
 *  takes the whole read for every avatar. */
let urlDecodeOff = false

/** The asset URL of `loc` from the store, or `null` when the store cannot
 *  make one. */
async function assetUrlFor(loc: string): Promise<string | null> {
    try {
        const store = await getAppStore()
        if (store.urlFor === undefined) {
            return null
        }
        return await store.urlFor(loc)
    } catch {
        return null
    }
}

/** The start of the file without reading the file, on the platforms that can
 *  (Node-hosted pages and Tauri). `null` means "read the whole file". */
async function readHeader(loc: string, scope: TaskScope): Promise<{ header: ImageHeader, url: string | null } | null> {
    try {
        if (isTauri) {
            const header = await readTauriHeader(loc)
            return header === null ? null : { header, url: null }
        }
        if (isNodeServer) {
            const url = await assetUrlFor(loc)
            if (url === null) {
                return null
            }
            const header = await readUrlHeader(url, scope.signal)
            return header === null ? null : { header, url }
        }
    } catch {
        // fall through to the whole read
    }
    return null
}

/** Reads the whole file, classifies it as a whole file and decodes it from a
 *  `Blob`. `decoded` is true when the decode step ran to a result. */
async function generateFromBytes(loc: string, scope: TaskScope): Promise<{ result: GenResult, decoded: boolean }> {
    const bytes = await currentReadImage(loc)
    if (scope.isCancelled()) {
        // The queue's timeout already resolved the caller with null while
        // this read was still pending; decoding and drawing the full image
        // now would just be unbounded work outside the concurrency limit.
        return { result: null, decoded: false }
    }
    if (!bytes) {
        return { result: null, decoded: false }
    }
    const cls = classifyImage(bytes, true)
    if (cls.kind === 'animated' || cls.kind === 'unknown') {
        return { result: { skip: true }, decoded: false }
    }
    if (cls.kind !== 'still') {
        return { result: null, decoded: false }
    }
    const result = await currentRenderThumb({ kind: 'bytes', bytes, mime: cls.mime }, scope)
    return { result, decoded: result !== null }
}

/**
 * Where the first 64 KiB can be read without the whole file (Node-hosted
 * pages, Tauri), animation is decided from it and a still is decoded from the
 * asset URL, so no JS copy of the file is made. Everything else, and every
 * failure of that path, reads the whole file and decodes it from a `Blob`.
 */
async function realGenerate(loc: string, ctx: GenContext): Promise<GenResult> {
    const scope = makeTaskScope(ctx)
    try {
        let urlFailed = false
        if (!urlDecodeOff) {
            const probe = await readHeader(loc, scope)
            if (scope.isCancelled()) {
                return null
            }
            if (probe !== null) {
                const cls = classifyImage(probe.header.bytes, probe.header.whole)
                if (cls.kind === 'null') {
                    return null
                }
                if (cls.kind === 'animated' || cls.kind === 'unknown') {
                    return { skip: true }
                }
                if (cls.kind === 'still') {
                    const url = probe.url ?? await assetUrlFor(loc)
                    if (scope.isCancelled()) {
                        return null
                    }
                    if (url !== null) {
                        try {
                            return await currentRenderThumb({ kind: 'url', url }, scope)
                        } catch {
                            if (scope.isCancelled()) {
                                return null
                            }
                            urlFailed = true
                        }
                    }
                }
            }
        }
        const outcome = await generateFromBytes(loc, scope)
        if (urlFailed && outcome.decoded) {
            urlDecodeOff = true
        }
        return outcome.result
    } finally {
        scope.release()
    }
}

/** What the render step decodes: a URL the page can load directly, or the
 *  file's bytes wrapped in a same-origin blob: URL. */
type RenderSource =
    | { kind: 'url', url: string }
    | { kind: 'bytes', bytes: Uint8Array, mime: string }
type RenderThumbFn = (source: RenderSource, scope: TaskScope) => Promise<GenResult>

/** Load, draw and export: decodes the source, scales it to the thumbnail size
 *  and encodes it. Rejects when the image fails to load, decode or export, so
 *  the caller can try another path. Split from `realGenerate` so tests can
 *  drive the classification and the reads without a canvas. */
async function renderThumb(source: RenderSource, scope: TaskScope): Promise<GenResult> {
    const img = new Image()
    let objectUrl: string | null = null
    if (source.kind === 'bytes') {
        // A same-origin blob: URL, so the asset protocol's cross-origin
        // behaviour never reaches the canvas.
        objectUrl = URL.createObjectURL(new Blob([asBuffer(source.bytes)], { type: source.mime }))
    } else {
        // Loaded with CORS, so a response the page may not read fails to load
        // instead of tainting the canvas.
        img.crossOrigin = 'anonymous'
    }
    let cleaned = false
    const cleanup = () => {
        if (cleaned) {
            return
        }
        cleaned = true
        if (objectUrl !== null) {
            URL.revokeObjectURL(objectUrl)
        }
        img.src = ''
    }
    scope.own(cleanup)

    let canvas: HTMLCanvasElement | null = null
    try {
        if (scope.isCancelled()) {
            return null
        }
        img.src = source.kind === 'url' ? source.url : (objectUrl ?? '')
        await img.decode()
        if (scope.isCancelled()) {
            return null
        }
        const dims = thumbDimensions(img.naturalWidth, img.naturalHeight, THUMB_SHORT_SIDE)
        if (!dims) {
            return { skip: true }
        }
        canvas = document.createElement('canvas')
        canvas.width = dims.w
        canvas.height = dims.h
        const c2d = canvas.getContext('2d')
        if (!c2d) {
            return null
        }
        c2d.imageSmoothingQuality = 'high'
        c2d.drawImage(img, 0, 0, dims.w, dims.h)
        let dataUrl = canvas.toDataURL('image/webp', 0.85)
        if (!dataUrl.startsWith('data:image/webp')) {
            // WebKit historically has no WebP encoder; PNG keeps alpha too.
            dataUrl = canvas.toDataURL('image/png')
        }
        return { src: dataUrl }
    }
    finally {
        // Zeroing releases the backing pixel buffer even when drawImage or
        // toDataURL throws, not only on the success path above.
        if (canvas) {
            canvas.width = 0
            canvas.height = 0
        }
        cleanup()
    }
}

let currentRenderThumb: RenderThumbFn = renderThumb
let currentGenerator: FullGenerator = realGenerate

// ---------------------------------------------------------------------------
// Boot sweep: independent of `cleanChunks`, touches only this store.
// ---------------------------------------------------------------------------

/** Full `loc` keys worth keeping: every character/group image, plus folder
 *  images from `characterOrder`. Cold-storage stubs and trashed characters
 *  both keep their `image` field, so no cold read is needed here. */
export function buildThumbKeepSet(db: Database): Set<string> {
    const keep = new Set<string>()
    const characters = db?.characters ?? []
    for (const c of characters) {
        if (c && c.image) {
            keep.add(c.image)
        }
    }
    const order = db?.characterOrder ?? []
    for (const entry of order) {
        if (entry && typeof entry !== 'string') {
            const imgFile = (entry as folder).imgFile
            if (imgFile) {
                keep.add(imgFile)
            }
        }
    }
    return keep
}

/** Deletes records whose key is not in `keep`, or whose `v` is stale. Never
 *  throws: a wrong keep-set can only delete thumbnails, which regenerate. */
export async function sweepAvatarThumbs(keep: Set<string>): Promise<void> {
    const store = getStore()
    if (!store) {
        return
    }
    const stale: string[] = []
    try {
        await store.iterate((value, key) => {
            const rec = value as Partial<ThumbRecord> | null | undefined
            if (!rec || rec.v !== THUMB_VERSION || !keep.has(key)) {
                stale.push(key)
            }
        })
    } catch {
        return
    }
    for (const key of stale) {
        try {
            await store.removeItem(key)
        } catch {
            // best-effort
        }
    }
}

/** Called once at boot, detached from `cleanChunks`. Reads the DB, builds
 *  the keep-set and sweeps, all guarded so a bad snapshot can't affect boot
 *  or the existing asset sweeps. */
export async function startAvatarThumbSweep(): Promise<void> {
    try {
        const keep = buildThumbKeepSet(DBState.db)
        await sweepAvatarThumbs(keep)
    } catch {
        // best-effort background maintenance
    }
}

// ---------------------------------------------------------------------------
// Test hooks.
// ---------------------------------------------------------------------------

export const __avatarThumbTestHooks = {
    setStore(store: ThumbStoreLike | null) {
        storeOverride = store
    },
    setGenerator(fn: Generator) {
        currentGenerator = (loc) => fn(loc)
    },
    setReadImage(fn: ReadImageFn) {
        currentReadImage = fn
    },
    setRenderThumb(fn: RenderThumbFn) {
        currentRenderThumb = fn
    },
    setReadbackCheck(fn: () => boolean) {
        readbackCheckFn = fn
        readbackChecked = false
    },
    setLimits(limits: { concurrency?: number, timeoutMs?: number, storeTimeoutMs?: number, memoMaxEntries?: number, memoMaxBytes?: number }) {
        if (limits.concurrency !== undefined) {
            concurrency = limits.concurrency
        }
        if (limits.timeoutMs !== undefined) {
            timeoutMs = limits.timeoutMs
        }
        if (limits.storeTimeoutMs !== undefined) {
            storeTimeoutMs = limits.storeTimeoutMs
        }
        if (limits.memoMaxEntries !== undefined) {
            memoMaxEntries = limits.memoMaxEntries
        }
        if (limits.memoMaxBytes !== undefined) {
            memoMaxBytes = limits.memoMaxBytes
        }
    },
    reset() {
        memo.clear()
        memoBytes = 0
        inFlight.clear()
        queue.length = 0
        running = 0
        readbackChecked = false
        readbackAllowed = true
        readbackCheckFn = defaultReadbackCheck
        currentGenerator = realGenerate
        currentReadImage = readImage
        currentRenderThumb = renderThumb
        urlDecodeOff = false
        storeOverride = null
        concurrency = DEFAULT_CONCURRENCY
        timeoutMs = DEFAULT_TIMEOUT_MS
        storeTimeoutMs = DEFAULT_STORE_TIMEOUT_MS
        memoMaxEntries = DEFAULT_MEMO_MAX_ENTRIES
        memoMaxBytes = DEFAULT_MEMO_MAX_BYTES
    },
    stats() {
        return {
            memoEntries: memo.size,
            memoBytes,
            inFlight: inFlight.size,
            running,
            queued: queue.length
        }
    }
}
