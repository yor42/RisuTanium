import { isAndroidTransport, statStoredSize } from './tauriByteTransport'

/**
 * Above this stored size the Android asset protocol is not asked for a whole
 * read: tauri answers a request without a Range header by reading the entire
 * file, and the WebView copies that body into one Java array. A change of this
 * value changes what a persisted thumbnail skip means, so it needs a
 * `THUMB_VERSION` bump in the same change.
 */
export const ANDROID_WHOLE_READ_URL_LIMIT_BYTES = 64 * 1024 * 1024

/**
 * What an asset URL is for. A `media` element sends Range requests, so the
 * protocol never reads the file whole for it; every other use (an image, a CSS
 * background, a fetch, markup of unknown purpose) is `whole`.
 */
export type AssetUse = 'media' | 'whole'

/** What an asset list row shows for a file: a `video` or `audio` element, an `image`, a name-and-icon box (`icon`), or nothing. */
export type AssetListElement = 'video' | 'audio' | 'icon' | 'image' | 'none'

/** Media that no list previews as an image or as an element: shown as a name-and-icon box. */
const ICON_ONLY_EXTENSIONS: ReadonlySet<string> = new Set([
    'mov', 'mkv', 'avi', 'm4v', 'm4p', 'webm', 'ogv', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus',
])

/** The image extensions a list with `knownImagesOnly` previews. */
const KNOWN_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'webp', 'jpeg', 'jpg', 'gif'])

/**
 * The one decision of what a list row renders for extension `ext`, compared in
 * lower case. The list requests a URL for exactly the elements this names
 * (`assetListUse`), so the element and the kind of URL cannot drift apart. An
 * unknown extension is an `image`, as the lists always rendered it; with
 * `knownImagesOnly` only the known image extensions are, and the rest is `none`.
 */
export function assetListElement(ext: string | undefined, options: { knownImagesOnly?: boolean } = {}): AssetListElement {
    const lower = (ext ?? '').toLowerCase()
    if (lower === 'mp4') {
        return 'video'
    }
    if (lower === 'mp3') {
        return 'audio'
    }
    if (options.knownImagesOnly === true) {
        return KNOWN_IMAGE_EXTENSIONS.has(lower) ? 'image' : 'none'
    }
    return ICON_ONLY_EXTENSIONS.has(lower) ? 'icon' : 'image'
}

/** The `AssetUse` of the URL a row showing `element` needs; `null` when it needs none. */
export function assetListUse(element: AssetListElement): AssetUse | null {
    if (element === 'video' || element === 'audio') {
        return 'media'
    }
    return element === 'image' ? 'whole' : null
}

/** The URL a list row received, with the asset path and use it was made for. */
export type RowAssetUrl = { path: string, use: AssetUse, url: string }

/** Whether `entry` was made for exactly `path` and `use`, the asset and use the row now names. */
export function isRowAssetUrlCurrent(entry: RowAssetUrl | undefined, path: string | undefined, use: AssetUse | null): entry is RowAssetUrl {
    return entry !== undefined && use !== null && entry.path === path && entry.use === use
}

/**
 * The URL a list row may show: `undefined` (nothing is rendered) until a URL
 * made for the row's current `path` and `use` has arrived. A row index that now
 * names another asset or use never shows the URL of the previous occupant, which
 * could be the media URL of a file above the whole-read limit.
 */
export function rowAssetUrl(entry: RowAssetUrl | undefined, path: string | undefined, use: AssetUse | null): string | undefined {
    return isRowAssetUrlCurrent(entry, path, use) ? entry.url : undefined
}

/**
 * Stores `entry` at row `index` only while the row still names the entry's path
 * and use (`wantedPath`, `wantedUse` read at settle time), so a late or
 * out-of-order resolution cannot replace the URL of what the row shows now.
 */
export function storeRowAssetUrl(entries: (RowAssetUrl | undefined)[], index: number, entry: RowAssetUrl, wantedPath: string | undefined, wantedUse: AssetUse | null): void {
    if (isRowAssetUrlCurrent(entry, wantedPath, wantedUse)) {
        entries[index] = entry
    }
}

/** `within`: a URL may be made. `over`: the stored size is known and above the limit. `unknown`: the size could not be read. */
export type AssetSizeVerdict = 'within' | 'over' | 'unknown'

const MAX_CACHED_SIZES = 20000

const storedSizes = new Map<string, number>()

/** Marks `key` as the most recently used entry of `map`; a missing key stays missing. */
function touchEntry<V>(map: Map<string, V>, key: string): V | undefined {
    const value = map.get(key)
    if (value !== undefined) {
        map.delete(key)
        map.set(key, value)
    }
    return value
}

/** Stores `key` as the most recent entry of `map`; at `cap` entries the least recently used one goes first. */
function putEntry<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
    map.delete(key)
    while (map.size >= cap) {
        const oldest = map.keys().next()
        if (oldest.done) {
            break
        }
        map.delete(oldest.value)
    }
    map.set(key, value)
}

const sizeProbes = new Map<string, Promise<number | null>>()
const reportedFailures = new Set<string>()

/**
 * The stored size of `key`, or `null` when it cannot be read. Concurrent callers
 * share one probe. A failure is never cached, and a probe whose key was released
 * while it ran does not write its size back.
 */
function probeStoredSize(key: string): Promise<number | null> {
    const known = touchEntry(storedSizes, key)
    if (known !== undefined) {
        return Promise.resolve(known)
    }
    const running = sizeProbes.get(key)
    if (running !== undefined) {
        return running
    }
    const probe: Promise<number | null> = (async () => {
        let size: number
        try {
            size = await statStoredSize(key)
        } catch (error) {
            if (sizeProbes.get(key) === probe) {
                sizeProbes.delete(key)
            }
            if (!reportedFailures.has(key)) {
                reportedFailures.add(key)
                console.error(error)
            }
            return null
        }
        if (sizeProbes.get(key) === probe) {
            sizeProbes.delete(key)
            putEntry(storedSizes, key, size, MAX_CACHED_SIZES)
        }
        return size
    })()
    sizeProbes.set(key, probe)
    return probe
}

/**
 * The verdict on `key`'s stored size on Android; `within` everywhere else,
 * where no probe is made.
 */
export async function androidAssetSizeVerdict(key: string): Promise<AssetSizeVerdict> {
    if (!isAndroidTransport()) {
        return 'within'
    }
    const size = await probeStoredSize(key)
    if (size === null) {
        return 'unknown'
    }
    return size > ANDROID_WHOLE_READ_URL_LIMIT_BYTES ? 'over' : 'within'
}

/**
 * Whether the URL of `key` must not be made for `use`. True for a `whole` use
 * on Android when the stored size is above the limit or cannot be read: an
 * unknown size must not risk the Java heap.
 */
export async function androidWithholdsUrl(key: string, use: AssetUse): Promise<boolean> {
    if (use === 'media') {
        return false
    }
    return (await androidAssetSizeVerdict(key)) !== 'within'
}

/**
 * What a list of previews may ask the Android asset protocol to read whole at
 * once. Every whole read puts one Java array of the file's size in the WebView
 * heap and the requests of a list run in parallel, so the sum of what one list
 * admits stays at or under this.
 */
export const ANDROID_LIST_WHOLE_READ_BUDGET_BYTES = 64 * 1024 * 1024

/** The admissions of one list: one budget per run of the list's effect. */
export interface WholeReadBudget {
    /**
     * Whether the whole read of `key` fits in what is left. Decisions are made
     * strictly in call order, so a caller that calls in row order gets the first
     * rows that fit. Never rejects; a size that cannot be read is `false`.
     */
    admit(key: string): Promise<boolean>
}

/**
 * A budget of `budgetBytes` for one run of a list. Off Android every key is
 * admitted without a probe. On Android a key whose stored size is unknown or
 * above `ANDROID_WHOLE_READ_URL_LIMIT_BYTES` is refused and not counted (the
 * per-file gate withholds it anyway); any other key is admitted when its size
 * fits in what is left, and each call counts, a repeated key included, because
 * each row loads its own image.
 */
export function createWholeReadBudget(budgetBytes: number = ANDROID_LIST_WHOLE_READ_BUDGET_BYTES): WholeReadBudget {
    let admitted = 0
    // Each decision waits for the previous one; probes themselves still run in parallel.
    let previous: Promise<unknown> = Promise.resolve()
    return {
        admit(key: string): Promise<boolean> {
            if (!isAndroidTransport()) {
                return Promise.resolve(true)
            }
            const probe = probeStoredSize(key)
            const decision = previous.then(async () => {
                const size = await probe
                if (size === null || size > ANDROID_WHOLE_READ_URL_LIMIT_BYTES || admitted + size > budgetBytes) {
                    return false
                }
                admitted += size
                return true
            })
            previous = decision.catch(() => false)
            return decision.catch(() => false)
        },
    }
}

/**
 * A chat image of at least this stored size loads through the app-wide in-flight
 * queue (`createInFlightByteGate`) instead of as soon as the browser asks.
 */
export const ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES = 8 * 1024 * 1024

/** What the chat images that are being read may take in total from the WebView's Java heap. */
export const ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES = 64 * 1024 * 1024

/** The attribute that holds the real `src` of a chat image whose load waits for the queue. Only the sanitizer's hook sets it. */
export const DEFERRED_IMAGE_SRC_ATTRIBUTE = 'data-risu-deferred-src'

/** The `src` a deferred image shows meanwhile: an empty vector image, so the image is a pending image to the layout. */
export const DEFERRED_IMAGE_PLACEHOLDER_SRC = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='0'%20height='0'/%3E"

const MAX_WHOLE_READ_URLS = 20000

/** The asset key behind each whole-read URL `getFileSrc` made on Android, so markup that holds only the URL can learn the stored size. */
const wholeReadUrlKeys = new Map<string, string>()

/**
 * Records that `url` was made for the whole read of `key`. The size is not
 * stored here: it is read from the size cache at lookup, so a deleted asset
 * (`forgetStoredAssetSizes`) stops being known at once.
 */
export function rememberWholeReadUrl(url: string, key: string): void {
    putEntry(wholeReadUrlKeys, url, key, MAX_WHOLE_READ_URLS)
}

/**
 * The stored size of the file `url` reads whole, or `undefined` when the URL or
 * its size is not known (the image is then not deferred). A hit keeps both
 * entries recent, so a size the chat keeps asking about is not aged out by the
 * probes of lists.
 */
export function wholeReadBytesOfUrl(url: string): number | undefined {
    const key = touchEntry(wholeReadUrlKeys, url)
    if (key === undefined) {
        return undefined
    }
    return touchEntry(storedSizes, key)
}

/** One admission to the in-flight queue; `release` is idempotent. */
export interface InFlightGrant {
    release(): void
}

/** The queue of whole reads that are in flight at once. */
export interface InFlightByteGate {
    /**
     * Resolves when `bytes` may be read: when the sum in flight plus `bytes` is
     * within the budget, or when nothing is in flight (so one file larger than the
     * budget still loads). Grants are strictly first in, first out.
     */
    acquire(bytes: number): Promise<InFlightGrant>
}

/** A queue that keeps the sum of the grants it holds within `budgetBytes`, plus one grant when it was empty. */
export function createInFlightByteGate(budgetBytes: number): InFlightByteGate {
    let inFlight = 0
    let holders = 0
    const waiting: { bytes: number, grant: (grant: InFlightGrant) => void }[] = []

    const pump = () => {
        for (;;) {
            const head = waiting[0]
            if (head === undefined || (holders > 0 && inFlight + head.bytes > budgetBytes)) {
                return
            }
            waiting.shift()
            inFlight += head.bytes
            holders++
            let released = false
            head.grant({
                release() {
                    if (released) {
                        return
                    }
                    released = true
                    inFlight -= head.bytes
                    holders--
                    pump()
                },
            })
        }
    }

    return {
        acquire(bytes: number): Promise<InFlightGrant> {
            return new Promise((resolve) => {
                waiting.push({ bytes, grant: resolve })
                pump()
            })
        },
    }
}

/** Forgets what is known about `keys` (a deleted asset), including a probe still running. */
export function forgetStoredAssetSizes(keys: Iterable<string>): void {
    for (const key of keys) {
        storedSizes.delete(key)
        sizeProbes.delete(key)
        reportedFailures.delete(key)
    }
}

/** Test seam: forgets every cached size, running probe and reported failure. */
export function resetAssetUrlGateForTest(): void {
    storedSizes.clear()
    sizeProbes.clear()
    reportedFailures.clear()
    wholeReadUrlKeys.clear()
}
