/**
 * Shared fixture for tests of surfaces that read whole avatar and chat images through the app-wide whole-read queue.
 *
 * It does not mock anything itself: a test file keeps its own `vi.mock` calls (they only hoist in the test file) and
 * wires them to this kit:
 *   - `isAndroidTransport` and `statStoredSize` read `androidTransport`;
 *   - the mocked `getFileSrc` calls `androidFileSrc`, which mirrors the Android "whole" path of the real one (it probes
 *     the size through the real `androidAssetSizeVerdict` and registers the URL with the real `rememberWholeReadUrl`
 *     only while the transport is Android);
 *   - `Image` is stubbed with `FakeImage`, which records the sources it was given and fires `load` or `error` on demand.
 * The skip record is the one `schedulePersist` writes, `{ v: THUMB_VERSION, skip: true }`, served through the thumbnail
 * store hook (`skipRecordStore`).
 *
 * "Exposed bytes" = the stored sizes of the URLs that are in flight: set as the source of a fake `Image` that has not
 * settled, or present in an `<img src>` or in a `style` of the mounted DOM without a settled read behind them.
 */
import { androidAssetSizeVerdict, rememberWholeReadUrl } from '../storage/assetUrlGate'
import { THUMB_ABORTED, THUMB_VERSION, type ThumbAborted } from './avatarThumb'
import { awaitQueuedWholeRead } from './queuedWholeRead'

export const MIB = 1024 * 1024
/** The queue's in-flight budget; one oversize file may run on its own. */
export const WHOLE_READ_BUDGET_BYTES = 64 * MIB

const URL_PREFIX = 'http://asset.localhost/'
export const urlOf = (key: string): string => `${URL_PREFIX}${key}`
const keyOfUrl = (url: string): string => (url.startsWith(URL_PREFIX) ? url.slice(URL_PREFIX.length) : url)

/** State the mocked transport and file source read. Reset it in `beforeEach`. */
export const androidTransport = { android: true, sizes: {} as Record<string, number> }

export function resetAndroidTransport(android = true): void {
    androidTransport.android = android
    androidTransport.sizes = {}
}

export function seedSizes(locs: string[], mib: number): void {
    for (const loc of locs) {
        androidTransport.sizes[loc] = mib * MIB
    }
}

/** The mocked `getFileSrc`: the Android "whole" path through the real size verdict and URL registry. */
export async function androidFileSrc(loc: string): Promise<string> {
    const url = urlOf(loc)
    if (androidTransport.android) {
        await androidAssetSizeVerdict(loc)
        rememberWholeReadUrl(url, loc)
    }
    return url
}

/** The thumbnail store hook of an animated avatar whose thumbnail was skipped. */
export const skipRecordStore = {
    getItem: async () => ({ v: THUMB_VERSION, skip: true as const }),
    setItem: async () => {},
    removeItem: async () => {},
    iterate: async () => {},
}

export class FakeImage {
    static all: FakeImage[] = []
    crossOrigin = ''
    settled = false
    private source = ''
    private listeners = new Map<string, Set<() => void>>()
    constructor() {
        FakeImage.all.push(this)
    }
    get src(): string { return this.source }
    set src(value: string) { this.source = value }
    addEventListener(type: string, listener: () => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set())
        }
        this.listeners.get(type)!.add(listener)
    }
    removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
    }
    fire(type: 'load' | 'error') {
        this.settled = true
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener()
        }
    }
}

/** The sources of the fake images that have not settled. */
export const unsettledSources = (): string[] => FakeImage.all.filter((image) => !image.settled).map((image) => image.src)

const CSS_URL = /url\(\s*["']?([^"')]*)["']?\s*\)/g

/** Every asset URL the mounted DOM uses: `<img src>` and `url(...)` in a `style` attribute. */
export function domUrls(root: ParentNode): string[] {
    const urls: string[] = []
    for (const image of Array.from(root.querySelectorAll('img'))) {
        const src = image.getAttribute('src')
        if (src) {
            urls.push(src)
        }
    }
    for (const element of Array.from(root.querySelectorAll('[style]'))) {
        for (const match of (element.getAttribute('style') ?? '').matchAll(CSS_URL)) {
            urls.push(match[1])
        }
    }
    return urls
}

/**
 * Bytes in flight: the unsettled fake images plus the DOM URLs whose read has not settled. `perElement` counts every
 * DOM use of a URL; by default a URL counts once, as a browser fetching one URL for several elements would.
 * `minBytes` leaves out the files below the queue's threshold, which are never held back.
 */
export function exposedBytes(root: ParentNode, options: { perElement?: boolean, minBytes?: number } = {}): number {
    const settledUrls = new Set(FakeImage.all.filter((image) => image.settled).map((image) => image.src))
    const inFlight: string[] = FakeImage.all.filter((image) => !image.settled).map((image) => image.src)
    for (const url of domUrls(root)) {
        if (!settledUrls.has(url)) {
            inFlight.push(url)
        }
    }
    const counted = options.perElement ? inFlight : [...new Set(inFlight)]
    let total = 0
    for (const url of counted) {
        const bytes = androidTransport.sizes[keyOfUrl(url)] ?? 0
        if (bytes >= (options.minBytes ?? 0)) {
            total += bytes
        }
    }
    return total
}

type MirrorType = 'plain' | 'css' | 'contain' | 'lgcss' | 'thumb' | 'thumbcss'

/**
 * A stand-in for `getCharImage` for tests that cannot load `characters.ts` (it imports half of the application). It follows
 * the same steps as the real one for a file whose thumbnail is skipped or missing: the hide-all-images placeholder, the empty
 * location, the abort gate, `getFileSrc` (the Android mirror above), the REAL `awaitQueuedWholeRead` when a signal is given,
 * and the type's wrapping. `util.wholeReadQueue.svelte.test.ts` loads the real function and checks that both return the same
 * results and queue the same reads, so this copy cannot drift unnoticed.
 */
export function createMirroredGetCharImage(hideAllImages: () => boolean) {
    return async function mirroredGetCharImage(loc: string, type: MirrorType, options?: { signal?: AbortSignal, onWholeReadQueued?: () => void }): Promise<string | null | ThumbAborted> {
        const wrapType = type === 'thumb' ? 'plain' : type === 'thumbcss' ? 'css' : type
        if (hideAllImages()) {
            return wrapType === 'plain' ? '/none.webp' : ''
        }
        if (!loc) {
            return wrapType === 'css' ? '' : null
        }
        if (options?.signal?.aborted) {
            return THUMB_ABORTED
        }
        const filesrc = await androidFileSrc(loc)
        if (filesrc && options?.signal) {
            const outcome = await awaitQueuedWholeRead(filesrc, options.signal)
            if (outcome === 'aborted') {
                return THUMB_ABORTED
            }
            if (outcome === 'queued') {
                options.onWholeReadQueued?.()
            }
        }
        if (wrapType === 'plain') {
            return filesrc
        }
        if (wrapType === 'css') {
            return `background: url("${filesrc}");background-size: cover;`
        }
        if (wrapType === 'lgcss') {
            return `background: url("${filesrc}");background-size: cover;height: 10.66rem;`
        }
        return `background: url("${filesrc}");background-size: contain;background-repeat: no-repeat;background-position: center;`
    }
}
