import {
    writeFile,
    BaseDirectory,
    readFile,
    exists,
    mkdir
} from "@tauri-apps/plugin-fs"
import { changeFullscreen, checkNullish, sleep, sleepForever } from "./util"
import { markAppInitiatedReload } from "./reloadGuard"
import { openUrlOnWeb } from "./openUrlWeb"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { v4 as uuidv4, v4 } from 'uuid';
import { get } from "svelte/store";
import { flushSync } from "svelte";
import { open } from '@tauri-apps/plugin-shell'
import streamSaver from 'streamsaver';
import { type Database, defaultSdDataFunc, getDatabase, appVer, getCurrentCharacter, type character, type groupChat, type Chat, appSubVer } from "./storage/database.svelte";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { checkRisuUpdate } from "./update";
import { MobileGUI, botMakerMode, loadedStore, DBState, LoadingStatusState, selIdState, ReloadGUIPointer, bodyIntercepterStore, savingStoppedReason, frozenSaveKeysStore, type FrozenSaveKeyInfo } from "./stores.svelte";
import { loadPlugins } from "./plugins/plugins.svelte";
import { alertConfirm, alertError, alertMd, alertSelect, alertToast, waitAlert } from "./alert";
import { hasher } from "./parser/parser.svelte";
import { characterURLImport, hubURL } from "./characterCards";
import { defaultJailbreak, defaultMainPrompt, oldJailbreak, oldMainPrompt } from "./storage/defaultPrompts";
import { encodeRisuSaveLegacy, RisuSaveEncoder, type toSaveType } from "./storage/risuSave";
import { registerDbChangeEffects } from "./storage/dbChangeEffects.svelte";
import { installCharacterSaveMarks } from "./storage/characterSaveMarks";
import { AutoStorage } from "./storage/autoStorage";
import { createStorageTabLocks } from "./storage/storageTabLocks";
import { noteMainFileBytes } from "./storage/mainFileRecord";
import { getAppStore, writeMainFile } from "./storage/store/appStore";
import { StoreInvalidKeyError, StoreVersionConflictError } from "./storage/store/errors";
import { updateAnimationSpeed } from "./gui/animation";
import { updateColorScheme, updateTextThemeAndCSS } from "./gui/colorscheme";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from '@tauri-apps/api/event'
import { language } from "src/lang";
import { startObserveDom } from "./observer.svelte";
import { updateGuisize } from "./gui/guisize";
import { updateLorebooks } from "./characters";
import { isHiddenSystemCharacter } from "./hiddenCharacters";
import { initMobileGesture } from "./hotkey";
import { fetch as TauriHTTPFetch } from '@tauri-apps/plugin-http';
import { moduleUpdate } from "./process/modules";
import { getColdStorageItem } from "./process/coldstorage.svelte";
import { isTauri, isNodeServer } from "./platform";
import { isLocalNetworkUrl } from "./network/localNetwork";
import { decodeProxyJobWsChunk, formatProxyStreamErrorMessage, parseProxyJobWsEvent } from "./network/proxyJobWs";
import { getNodeServerProxyAuth } from "./storage/nodeStorage";
import { getMultiTabAction, isRevisionAwareBackend, nextAutoReloadHistory, resolvePromptChoice, resolveRevisionAwarePromptChoice, readAutoReloadHistory, writeAutoReloadHistory, shouldRetainOtherTabSavedSignal, type AutoReloadHistory } from "./storage/multiTabReload";
import { hasLocalDrafts } from "./localDrafts";
import { draftContentOrphanGate } from "./draftContentOrphanGate";

export const forageStorage = new AutoStorage()

const appWindow = isTauri ? getCurrentWebviewWindow() : null

interface fetchLog {
    body: string
    header: string
    response: string
    success: boolean,
    date: string
    url: string
    responseType?: string
    chatId?: string
    status?: number
}

let fetchLog: fetchLog[] = []

export async function downloadFile(name: string, dat: Uint8Array | ArrayBuffer | string) {
    if (typeof (dat) === 'string') {
        dat = Buffer.from(dat, 'utf-8')
    }
    const data = new Uint8Array(dat)
    const downloadURL = (data: string, fileName: string) => {
        const a = document.createElement('a')
        a.href = data
        a.download = fileName
        document.body.appendChild(a)
        a.style.display = 'none'
        a.click()
        a.remove()
    }

    if (isTauri) {
        await writeFile(name, data, { baseDir: BaseDirectory.Download })
    }
    else {
        const blob = new Blob([data], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)

        downloadURL(url, name)

        setTimeout(() => {
            URL.revokeObjectURL(url)
        }, 10000)


    }
}

type FileCacheEntry = {
    status: 'loading' | 'done' | 'missing'
    // AV-3: plain-HTTP 'done' entries store the finished,
    // full `data:image/png;base64,...` string here, built once inside the
    // loading producer in getFileSrc, instead of raw bytes that got
    // re-encoded into a fresh string on every call. Every cache hit, the
    // oversized memo included, returns this exact string object as-is — no
    // caller re-concatenates it — so every caller served from the same cache
    // entry or memo slot gets the same string object, instead of each holder
    // (a DOM attribute, CSS, or any other consumer) building its own copy.
    // Whether that also avoids a browser engine flattening its own copy of a
    // rope/ConsString per holder is plausible but not verified against Blink.
    // A caller that arrives after an eviction, re-read, or an orphaned
    // attempt still gets a different string object than an earlier caller
    // did. Service-worker 'done'/'missing' entries never set this and cost 0
    // bytes in the accounting below.
    src?: string
    // Set only while status === 'loading'. All callers that find an in-flight entry
    // await this SAME promise object directly rather than polling the Map — polling
    // is what let a concurrent waiter observe a stale/evicted entry after the
    // producer finished. Awaiting the promise sidesteps the Map entirely for the
    // result itself; the Map is only touched afterward, for caching/eviction.
    promise?: Promise<FileCacheEntry>
}

// The `data:image/png;base64,` wrapper every successful plain-HTTP getFileSrc
// result carries (the function-level catch below still returns '' on error,
// not this prefix). `FileCacheEntry.src` and the oversized memo's `src` both
// store the FULL string including this prefix (see FileCacheEntry.src above)
// — it is never concatenated on a per-call basis, so a caller served from the
// same cache entry or memo slot as an earlier caller gets back the exact same
// string object. The byte budget below still sizes only the actual encoded
// payload, so fileCacheEntryCost (below) subtracts this constant-length
// prefix back out of the cost.
const FILE_CACHE_SRC_PREFIX = 'data:image/png;base64,'

// Bounded LRU cache, keyed by asset location. On the non-Tauri/non-service-worker
// path this holds the already-encoded `data:` string of every asset resolved via
// getFileSrc, bounded by both an entry-count cap and a byte budget below, so long
// sessions can't hold an unbounded amount of encoded asset data in memory.
const FILE_CACHE_DEFAULT_MAX_ENTRIES = 200
// Mutable only so the test-only seam (__fileCacheTestHooks.setLimits) can shrink
// it for a test and restore it afterward; production code never changes it.
let FILE_CACHE_MAX_ENTRIES = FILE_CACHE_DEFAULT_MAX_ENTRIES
// AV-3 budget: total bytes of encoded payload the cache may
// hold across all entries (see fileCacheEntryCost — the shared prefix on each
// `src` is excluded). Service-worker, loading and missing entries cost 0.
const FILE_CACHE_DEFAULT_MAX_BYTES = 64 * 1024 * 1024
let fileCacheMaxBytes = FILE_CACHE_DEFAULT_MAX_BYTES
// Running total of every cached entry's cost (see fileCacheEntryCost), kept in
// sync by fileCacheSet/fileCacheDelete below — the only two functions allowed
// to mutate `fileCache` during normal operation (the test-only
// __fileCacheTestHooks.reset() below is the one exception: it calls
// fileCache.clear() directly and zeroes this counter to match) — so it never
// drifts from a recomputed sum (see __fileCacheTestHooks.stats, which asserts
// exactly that in tests).
let fileCacheBytes = 0
const fileCache = new Map<string, FileCacheEntry>()

// AV-3: the most recent oversized `getFileSrc` result
// (one whose cost, see fileCacheEntryCost, exceeds fileCacheMaxBytes). Oversized
// results are never committed to the budgeted `fileCache` map above, but
// without this one-slot memo a caller that re-requests the same oversized loc
// repeatedly (e.g. a streaming re-parse) would re-read and re-encode it every
// time. Holds at most one entry, replaced whenever a new oversized result
// arrives, and never counted toward fileCacheBytes/fileCacheMaxBytes. `src`
// here is the full string too, returned as-is, same as a cached entry's.
let oversizedMemo: { loc: string, src: string } | null = null

// The byte cost of one cache entry for budget purposes: `src.length` MINUS
// the constant-length `FILE_CACHE_SRC_PREFIX` every `src` carries, so the
// budget tracks only the encoded payload, not the prefix shared by every
// entry. Entries with no `src` (service-worker, loading, missing) cost 0.
function fileCacheEntryCost(entry: FileCacheEntry): number {
    return entry.src ? entry.src.length - FILE_CACHE_SRC_PREFIX.length : 0
}

// Every mutation of `fileCache` during normal operation must go through one
// of these two helpers so `fileCacheBytes` can never drift from the Map's
// actual contents. The one exception is __fileCacheTestHooks.reset(), which
// clears the whole Map and zeroes the counter together, so no drift is
// possible there either.
function fileCacheSet(loc: string, entry: FileCacheEntry) {
    fileCache.set(loc, entry)
    fileCacheBytes += fileCacheEntryCost(entry)
}

function fileCacheDelete(loc: string) {
    const existing = fileCache.get(loc)
    if (!existing) {
        return
    }
    fileCacheBytes -= fileCacheEntryCost(existing)
    fileCache.delete(loc)
}

// Test-only seam for AV-3. Not used by any production code path.
// Lets a test shrink the cache's limits, reset it between cases (the module
// otherwise has no way to clear `fileCache`), and read both the running byte
// total and one recomputed from the Map, so tests can assert the two never
// drift apart.
export const __fileCacheTestHooks = {
    setLimits(limits: { maxEntries?: number, maxBytes?: number }) {
        if (typeof limits.maxEntries === 'number') {
            FILE_CACHE_MAX_ENTRIES = limits.maxEntries
        }
        if (typeof limits.maxBytes === 'number') {
            fileCacheMaxBytes = limits.maxBytes
        }
    },
    reset() {
        fileCache.clear()
        FILE_CACHE_MAX_ENTRIES = FILE_CACHE_DEFAULT_MAX_ENTRIES
        fileCacheMaxBytes = FILE_CACHE_DEFAULT_MAX_BYTES
        fileCacheBytes = 0
        oversizedMemo = null
    },
    stats() {
        let recomputedBytes = 0
        for (const entry of fileCache.values()) {
            recomputedBytes += fileCacheEntryCost(entry)
        }
        return {
            entries: fileCache.size,
            bytes: fileCacheBytes,
            recomputedBytes,
        }
    },
}

function touchFileCache(loc: string, entry: FileCacheEntry) {
    // Map iteration order is insertion order; delete-then-set moves this key to the
    // end, which doubles as a cheap recency marker for the LRU eviction below.
    fileCacheDelete(loc)
    fileCacheSet(loc, entry)

    const overBudget = () => fileCache.size > FILE_CACHE_MAX_ENTRIES || fileCacheBytes > fileCacheMaxBytes

    // Walk oldest-to-newest and evict the oldest entries that aren't still
    // in-flight, until neither the count cap nor the byte budget is exceeded. A
    // single slow/stuck load must not block eviction of everything behind it,
    // so this scans past 'loading' entries instead of stopping at the first one.
    for (const [key, candidate] of fileCache) {
        if (!overBudget()) {
            break
        }
        if (candidate.status === 'loading') {
            continue
        }
        fileCacheDelete(key)
    }
    // If every remaining entry is still 'loading' (e.g. many stalled requests at
    // once), the pass above evicts nothing and the count cap could otherwise be
    // exceeded without bound. Fall back to evicting the oldest in-flight entries
    // too — this is safe because every caller already awaits its entry's
    // `promise` directly (see getFileSrc), not a Map lookup, so removing the Map
    // slot doesn't affect anyone already waiting on it. It only means a
    // brand-new caller for that same key won't find this attempt and will start
    // a fresh one instead of joining it — which is exactly why the completion
    // side below only ever commits a result back into the Map if its own entry
    // is still the one present, so an orphaned old attempt can never clobber a
    // newer retry. This fallback loops on the COUNT condition only: loading
    // entries hold no bytes (see fileCacheSet), so evicting one can never bring
    // the byte total down, and looping on the byte condition here would spin
    // forever whenever the remaining entries are all still loading.
    for (const key of fileCache.keys()) {
        if (fileCache.size <= FILE_CACHE_MAX_ENTRIES) {
            break
        }
        fileCacheDelete(key)
    }
}

let checkedPaths: string[] = []

/**
 * Asset keys that `saveAsset` or a restore wrote, or tried to write, in this
 * page load. A key is added before its I/O starts and stays whatever the
 * outcome, so a sweep that consults it never deletes an asset that a caller is
 * about to reference.
 */
const assetsWrittenThisPage = new Set<string>()

/** Records `key` as written in this page load. Call it before the write starts. */
export function noteAssetWrittenThisPage(key: string): void {
    assetsWrittenThisPage.add(key)
}

/** Every key `saveAsset` or a restore wrote, or tried to write, in this page load. */
export function listAssetsWrittenThisPage(): string[] {
    return Array.from(assetsWrittenThisPage)
}

/** Whether `saveAsset` or a restore wrote, or tried to write, `key` in this page load. */
export function wasAssetWrittenThisPage(key: string): boolean {
    return assetsWrittenThisPage.has(key)
}

/**
 * The bytes of `loc` for a URL built outside Tauri. A key the store cannot
 * address holds nothing, so it reads as absent; any other failure propagates.
 */
async function readBytesForUrl(loc: string): Promise<Uint8Array | null> {
    try {
        return (await (await getAppStore()).read(loc)).bytes
    } catch (error) {
        if (error instanceof StoreInvalidKeyError) {
            return null
        }
        throw error
    }
}

/**
 * Gets the source URL of a file.
 *
 * On Tauri an asset URL comes from the store's `urlFor`, from the key alone, so
 * no byte is read; elsewhere the bytes come from the store and are handed to
 * the service worker or encoded into a data URL.
 *
 * @param {string} loc - The location of the file.
 * @returns {Promise<string>} - A promise that resolves to the source URL of the file, or `''` when none can be made.
 */
export async function getFileSrc(loc: string) {
    if (isTauri) {
        if (loc.startsWith('assets')) {
            try {
                const store = await getAppStore()
                if (store.urlFor === undefined) {
                    throw new Error('The desktop store offers no URL for a file.')
                }
                return await store.urlFor(loc)
            } catch (error) {
                console.error(error)
                return ''
            }
        }
        return convertFileSrc(loc)
    }
    try {
        if (usingSw) {
            const encoded = Buffer.from(loc, 'utf-8').toString('hex')
            const existing = fileCache.get(loc)

            // Retry (start a fresh resolution) for: no entry yet, or an earlier attempt
            // that settled 'missing' (a transient local-storage miss that may now have
            // resolved). An in-flight 'loading' entry is awaited directly below instead
            // of retried. A settled 'done' entry needs nothing further.
            const shouldStart = !existing || existing.status === 'missing'

            if (shouldStart) {
                const loadingEntry: FileCacheEntry = { status: 'loading' }
                const promise = (async (): Promise<FileCacheEntry> => {
                    try {
                        const hasCache: boolean = (await (await fetch("/sw/check/" + encoded)).json()).able
                        if (hasCache) {
                            return { status: 'done' }
                        }
                        const f = await readBytesForUrl(loc)
                        if (f && f.byteLength > 0) {
                            await fetch("/sw/register/" + encoded, {
                                method: "POST",
                                body: f as any
                            })
                            await sleep(10)
                            return { status: 'done' }
                        }
                        // No local copy to register yet — don't memoize this as resolved,
                        // so a later call for the same asset (once it exists locally) can
                        // retry instead of being stuck with a permanently-blank image.
                        return { status: 'missing' }
                    } catch (error) {
                        return { status: 'missing' }
                    }
                })()
                loadingEntry.promise = promise
                touchFileCache(loc, loadingEntry)
                const resolved = await promise
                // Only commit if this attempt's entry is still the one in the cache —
                // it may have been evicted (see touchFileCache) and superseded by a
                // newer retry for the same key while this was in flight.
                if (fileCache.get(loc) === loadingEntry) {
                    touchFileCache(loc, resolved)
                }
            }
            else if (existing.status === 'loading' && existing.promise) {
                await existing.promise
            }
            return "/sw/img/" + encoded
        }
        else {
            const existing = fileCache.get(loc)
            let resolved: FileCacheEntry

            if (!existing) {
                // AV-3: an oversized result from a
                // previous call for this exact loc is never committed to the
                // budgeted cache below, so check the one-slot memo before
                // starting a fresh read — otherwise a caller that repeatedly
                // re-requests the same oversized asset (e.g. a streaming
                // re-parse) would re-read and re-encode it every time.
                if (oversizedMemo && oversizedMemo.loc === loc) {
                    return oversizedMemo.src
                }
                const loadingEntry: FileCacheEntry = { status: 'loading' }
                const promise = (async (): Promise<FileCacheEntry> => {
                    // Built once here, inside the shared producer, so every
                    // concurrent or later caller for this loc reuses this same
                    // read and this same encode, and every caller served from
                    // the same cache entry or memo slot gets the same string
                    // object instead of each re-encoding or re-concatenating
                    // its own copy on every call. `src` is
                    // the FULL `data:image/png;base64,...` string, prefix
                    // included — every return path below hands it out as-is,
                    // never rebuilding it per call. A caller that arrives
                    // after this entry is evicted or superseded by a retry
                    // still gets a different string than an earlier caller.
                    const f = await readBytesForUrl(loc)
                    const src = FILE_CACHE_SRC_PREFIX + Buffer.from(f ?? new Uint8Array()).toString('base64')
                    return { status: 'done', src }
                })()
                loadingEntry.promise = promise
                touchFileCache(loc, loadingEntry)
                try {
                    resolved = await promise
                    // Only commit if this attempt's entry is still the one in the
                    // cache — it may have been evicted and superseded by a newer
                    // retry for the same key while this was in flight.
                    if (fileCache.get(loc) === loadingEntry) {
                        if (resolved.src !== undefined && fileCacheEntryCost(resolved) > fileCacheMaxBytes) {
                            // Oversized: don't let one asset evict the entire
                            // budgeted cache. Remove the loading placeholder and
                            // memoize the result on the side instead.
                            fileCacheDelete(loc)
                            oversizedMemo = { loc, src: resolved.src }
                        } else {
                            touchFileCache(loc, resolved)
                        }
                    }
                } catch (error) {
                    // Don't leave this entry stuck at 'loading' forever for other
                    // callers — remove it (if it's still the current one) so a future
                    // call can retry — then let the failure propagate to this caller
                    // exactly as it would have without any caching (caught by the
                    // function-level catch below).
                    if (fileCache.get(loc) === loadingEntry) {
                        fileCacheDelete(loc)
                    }
                    throw error
                }
            }
            else if (existing.status === 'loading' && existing.promise) {
                // Await the SAME promise the original caller is waiting on, rather
                // than re-reading the Map — the entry could otherwise be evicted (or
                // its promise could reject) between this check and a later read.
                resolved = await existing.promise
            }
            else {
                // Bump recency on a cache hit without changing its contents.
                touchFileCache(loc, existing)
                resolved = existing
            }
            // `src` was already built once, inside the producer above (or by
            // whichever call originally populated this entry) — every caller
            // just returns this exact string, matching the pre-AV-3 code's
            // output exactly (a missing file's empty buffer encodes to the
            // empty string, same as the pre-AV-3 code's
            // `resolved?.data ?? new Uint8Array()`) without rebuilding it per
            // call.
            return resolved?.src ?? FILE_CACHE_SRC_PREFIX
        }
    } catch (error) {
        console.error(error)
        return ''
    }
}

/**
 * The bytes under `key` in the page's store. A key with no value rejects on
 * Tauri and resolves `null` elsewhere, and a key the store cannot address counts
 * as absent there; callers and plugins observe both. Off Tauri the result is a
 * `Buffer` over the stored bytes, without a copy.
 *
 * The `null` of the platforms that return one is typed away on purpose: the
 * callers were written against `Uint8Array`, and the ones that need the absent
 * case test for a falsy value.
 */
async function readAssetBytes(key: string): Promise<Uint8Array> {
    const store = await getAppStore()
    let bytes: Uint8Array | null
    try {
        bytes = (await store.read(key)).bytes
    } catch (error) {
        if (!isTauri && error instanceof StoreInvalidKeyError) {
            return null as unknown as Uint8Array
        }
        throw error
    }
    if (bytes === null) {
        if (isTauri) {
            throw new Error(`The asset ${JSON.stringify(key)} does not exist.`)
        }
        return null as unknown as Uint8Array
    }
    return isTauri ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Reads an image file and returns its data.
 *
 * @param {string} data - The path to the image file.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the image file.
 */
export async function readImage(data: string) {
    if (isTauri && !data.startsWith('assets')) {
        // A path the caller names, not an asset key: the store only holds keys.
        return await readFile(data)
    }
    return await readAssetBytes(data)
}

/**
 * Saves an asset file with the given data, custom ID, and file name.
 * 
 * @param {Uint8Array} data - The data of the asset file; an ArrayBuffer or another typed-array view is taken as it is. Any other value rejects with a TypeError.
 * @param {string} [customId=''] - The custom ID for the asset file.
 * @param {string} [fileName=''] - The name of the asset file. Its extension (the part after the last dot) is kept when it is 1 to 16 ASCII letters or digits, and is `png` otherwise.
 * @returns {Promise<string>} - A promise that resolves to the path of the saved asset file.
 */
export async function saveAsset(data: Uint8Array | ArrayBuffer | ArrayBufferView, customId: string = '', fileName: string = '') {
    const bytes = assetBytesOf(data)
    let id = ''
    if (customId !== '') {
        id = customId
    }
    else {
        try {
            id = await hasher(bytes)
        } catch (error) {
            id = uuidv4()
        }
    }
    let fileExtension: string = 'png'
    if (fileName) {
        const candidate = fileName.split('.').pop() ?? ''
        if (ASSET_EXTENSION.test(candidate)) {
            fileExtension = candidate
        }
    }
    const key = `assets/${id}.${fileExtension}`
    // Before any I/O, so a sweep that runs while this save is in flight, or
    // after it failed, still leaves the key alone.
    noteAssetWrittenThisPage(key)
    const store = await getAppStore()
    // A name is a content hash (or a fresh UUID), so an existing file holds
    // these bytes already. Replacing it would rename over a file the web view
    // may hold open. Only the desktop store checks a key without a scan.
    if (isTauri && await store.has(key)) {
        return key
    }
    await store.write(key, bytes, 'unconditional')
    return key
}

/** What follows the last dot of an asset's file name: short and plain, so the key stays one path segment on every platform. */
const ASSET_EXTENSION = /^[A-Za-z0-9]{1,16}$/

/**
 * The bytes of a value handed to `saveAsset`: a `Uint8Array`, an `ArrayBuffer`
 * or any other view over one, taken as they are without a copy. Anything else is
 * a programming error and is refused before a key is made.
 */
function assetBytesOf(data: unknown): Uint8Array {
    if (data instanceof Uint8Array) {
        return data
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    }
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
        return new Uint8Array(data as ArrayBuffer)
    }
    throw new TypeError(`An asset is saved from an ArrayBuffer or a typed array, not a value of type ${Object.prototype.toString.call(data).slice(8, -1)}.`)
}

/**
 * Loads an asset file with the given ID.
 * 
 * @param {string} id - The ID of the asset file to load.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the loaded asset file.
 */
export async function loadAsset(id: string) {
    return await readAssetBytes(id)
}

let lastSave = ''
let lastBackupWriteTime = 0
// Every autosave writes the full database again anyway; writing a full extra
// numbered backup copy on every single cycle too (autosave debounces at
// 500ms) accelerates quota exhaustion on web for little added safety-net
// value over a much lower write rate. This only throttles how often a NEW
// backup snapshot is taken — the primary database.bin write is unaffected.
const DB_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000
const DB_BACKUP_KEY_PREFIX = 'database/dbbackup-'
export let saving = $state({
    state: false
})

function isQuotaExceededError(error: unknown): boolean {
    return error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || (error as any).code === 22 || (error as any).code === 1014)
}

/**
 * Saves the current state of the database.
 * 
 * @returns {Promise<void>} - A promise that resolves when the database has been saved.
 */
export let requiresFullEncoderReload = $state({
    state: false
})
/**
 * A minimal async mutex serializing writes to the shared `database/database.bin`
 * key between saveDb()'s autosave loop and any other direct writer (currently
 * LoadLocalBackup()'s restore write, `loadInternalBackup` (drive/internalBackup.ts)'s
 * snapshot write, and the exclusive storage-migration lock's holders below,
 * such as the copy back from OPFS at startup). LoadLocalBackup()'s
 * restore write and the internal-backup load's write acquire this directly only
 * on Tauri or when Web Locks aren't supported; on an ordinary web build their
 * exclusive storage lock already holds this internally for the same reason (see
 * `acquireExclusiveStorageMigrationLock` below) and the write must NOT acquire
 * it a second time. A boolean "is someone
 * else writing" flag checked once before encoding is NOT sufficient — the flag
 * can flip true after the check but before the write actually lands, letting a
 * stale autosave clobber a just-completed restore. Acquiring this lock actually
 * blocks a second acquirer until the first releases, so ordering is always
 * correct regardless of the exact interleaving. Not releasing after a
 * successful acquire (as LoadLocalBackup()'s restore write and the
 * internal-backup load's write deliberately do not) permanently blocks every later acquirer — the desired behavior once a
 * restore has committed and a reload is imminent: nothing from this now-stale
 * JS context should ever write this key again.
 */
class AsyncMutex {
    private queue: Promise<void> = Promise.resolve()
    async acquire(): Promise<() => void> {
        let release: () => void
        const willRelease = new Promise<void>((resolve) => { release = resolve })
        const previous = this.queue
        this.queue = this.queue.then(() => willRelease)
        await previous
        return release
    }
}
export const dbWriteLock = new AsyncMutex()

/**
 * Production's single storage tab locks instance (see
 * `storageTabLocks.ts`'s single-instance rule) — built against
 * `navigator.locks` and `dbWriteLock` above, the same write mutex `saveDb()`
 * and `LoadLocalBackup()`'s restore write take. `AutoStorage` defaults to
 * this instance too.
 */
const storageTabLocks = createStorageTabLocks(
    typeof navigator === 'undefined' ? undefined : navigator.locks,
    dbWriteLock
)

/** Resolves once this tab's own shared presence lock has actually been granted. */
export const tabPresenceLockAcquired: Promise<void> = storageTabLocks.tabPresenceLockAcquired

/**
 * Whether this page's storage tab locks were built against a defined lock
 * manager, i.e. whether Web Locks are actually available in this browser.
 * See `storageTabLocks.ts`'s `locksSupported` for the full contract —
 * callers MUST compare this with `=== false`, never with a falsy check.
 */
export const locksSupported = storageTabLocks.locksSupported

/**
 * Attempts to acquire the storage tab lock in EXCLUSIVE mode, for a
 * storage-backend migration. See `storageTabLocks.ts`'s
 * `acquireExclusiveStorageMigrationLock` for the full contract and its
 * load-bearing ordering; internally also acquires `dbWriteLock` — callers
 * must NOT separately acquire it themselves.
 */
export const acquireExclusiveStorageMigrationLock = storageTabLocks.acquireExclusiveStorageMigrationLock

/**
 * Takes a fresh reading of this tab's storage epoch. See
 * `storageTabLocks.ts`'s `recordStorageEpoch` for the full contract.
 */
export const recordStorageEpoch = storageTabLocks.recordStorageEpoch

export interface BootSaveSequenceOptions {
    tracker: toSaveType
    installMarks: (opts: { tracker: toSaveType, schedule: () => void }) => void
    init: () => Promise<void>
    createRealScheduler: () => (markDirty?: boolean) => void
}

/**
 * Installs character-save marks with a scheduler that only records "pending" while
 * `encoder.init` (a seconds-long window at 1000 characters, ledger row 61) is
 * still running, then create and swap in the real scheduler
 * (`saveTimeoutExecute`) and flush once if a mark arrived during that window.
 * `saveTimeout` (the `let` `saveTimeoutExecute` reads) and
 * `saveTimeoutExecute` itself are both declared in saveDb() before this
 * function is even called, so there is no TDZ window here to worry about.
 * What the pending/real split actually does: it makes sure a mark made while
 * `init` is still running is recorded (`tracker` gets the mark either way,
 * since it's written directly by the mark call, not by either scheduler) and
 * that exactly one save gets requested for it once `init` finishes, instead
 * of a debounced write firing mid-`init` against a database `encoder.init()`
 * hasn't finished encoding yet -- the save loop itself hasn't started at that
 * point regardless, so no debounced write could fire during this window even
 * without the split. The pending scheduler exists to turn "a mark arrived
 * during init" into a single deferred `realSchedule(true)` call once `init`
 * completes, rather than to prevent an otherwise-possible premature write.
 */
export async function bootSaveSequence(opts: BootSaveSequenceOptions): Promise<void> {
    let pendingSave = false
    opts.installMarks({ tracker: opts.tracker, schedule: () => { pendingSave = true } })
    await opts.init()
    const realSchedule = opts.createRealScheduler()
    opts.installMarks({ tracker: opts.tracker, schedule: () => realSchedule() })
    if (pendingSave) {
        realSchedule(true)
    }
}

export interface PrepareSaveIterationOptions {
    tracker: toSaveType
    encoder: RisuSaveEncoder
    reloadFlag: { state: boolean }
    reinitEncoder: () => Promise<RisuSaveEncoder>
    getDatabase: () => Database
    /**
     * Called right after the snapshot is taken, before the live tracker is
     * trimmed -- saveDb() uses it to reset `dirtySinceLastSave` at that exact
     * point.
     */
    onSnapshotTaken?: () => void
    /**
     * Called once, right after `reinitEncoder()` throws and the snapshot has
     * been folded back into the live tracker via `mergeUnsavedChanges` --
     * before the error is rethrown. That merge-back means nothing is lost,
     * but saveDb() still needs a signal that this iteration failed to reload
     * so it can flag itself dirty again for a retry (a multi-tab auto-reload
     * must not treat this tab as clean and silently discard its edits by
     * reloading out from under it). saveDb() wires this to
     * `dirtySinceLastSave = true`.
     */
    onSnapshotRestored?: () => void
}

export interface PrepareSaveIterationResult {
    encoder: RisuSaveEncoder
    toSave: toSaveType
}

/**
 * Prepares one save iteration: the snapshot-and-trim of the live tracker, the
 * full-reload branch (`requiresFullEncoderReload`), and the post-reload
 * filter documented further down that keeps a full reload from
 * double-encoding a character already marked before this same iteration
 * started.
 *
 * The snapshot and trim run BEFORE `reinitEncoder()`: `reinitEncoder()` can
 * take seconds at 1000 characters (ledger row 61), so an edit made to a
 * character IN PLACE while it's running (same proxy `init()` already
 * recorded) and marked during that window must land in the live tracker,
 * behind the sticky front, entirely outside what the snapshot already
 * captured -- never in the snapshot, so the post-reload filter below can
 * never mistake it for something this reload already encoded.
 */
export async function prepareSaveIteration(opts: PrepareSaveIterationOptions): Promise<PrepareSaveIterationResult> {
    let encoder = opts.encoder

    const toSave = safeStructuredClone(opts.tracker)
    opts.onSnapshotTaken?.()

    // Trim/reset the live tracker right away, so edits made by effects while this
    // write is in flight accumulate fresh (rather than being clobbered by a naive
    // post-write reset that doesn't know about them). If this attempt doesn't end
    // up persisting `toSave` — because it bails out below or the write throws —
    // saveDb()'s mergeUnsavedChanges folds it back in without discarding anything
    // newer.
    opts.tracker.character = opts.tracker.character.length === 0 ? [] : [opts.tracker.character[0]]
    opts.tracker.chat = opts.tracker.chat.length === 0 ? [] : [opts.tracker.chat[0]]
    opts.tracker.botPreset = false
    opts.tracker.modules = false
    opts.tracker.loadouts = false
    opts.tracker.plugins = false
    opts.tracker.pluginCustomStorage = false

    if (opts.reloadFlag.state) {
        // Cleared BEFORE the await, not after: if something racing this
        // reload (e.g. removeChar(), or a backup
        // load) sets the flag again WHILE `reinitEncoder()` is still running,
        // clearing it here first means that later write always wins -- a
        // post-await `= false` would instead clobber it back to false and
        // silently swallow the request for another full reload.
        opts.reloadFlag.state = false
        try {
            encoder = await opts.reinitEncoder()
        } catch (error) {
            // Something requested a reload during this failed attempt (or the
            // reload itself was never satisfied) -- restore the flag so the
            // next iteration still reloads instead of silently treating this
            // as handled.
            opts.reloadFlag.state = true
            // The snapshot/trim above already ran, so a throw here must not
            // silently drop `toSave`. Fold it back into the live tracker --
            // same rule saveDb()'s own catch uses for a failed write --
            // before propagating, so the caller's existing catch still has
            // nothing extra to merge.
            mergeUnsavedChanges(opts.tracker, toSave)
            // An additional signal for saveDb()'s `dirtySinceLastSave`: the
            // merge-back above already makes sure nothing is lost, but
            // saveDb() still needs to know
            // this iteration failed to reload so a later multi-tab
            // auto-reload doesn't treat this tab as clean and reload out
            // from under its restored edits.
            opts.onSnapshotRestored?.()
            throw error
        }

        // Filter the SNAPSHOT taken above (never the live tracker): drop ids
        // whose CURRENT proxy this reload's own `init()` just encoded, since
        // the reload already wrote their latest state as of init. A mark
        // added WHILE `reinitEncoder()` was still running -- e.g. an
        // in-place edit to a character on the very proxy `init()` already
        // recorded -- was never part of this snapshot (it landed in the
        // live tracker, behind the sticky front, after the trim above), so
        // it can never be wrongly dropped here for "already being encoded"
        // when its edit actually happened after that encode.
        // take (not read): releases the fresh encoder's references to the
        // character objects it just encoded once this filter is done with
        // them.
        const encodedProxies = encoder.takeEncodedCharacterProxies()
        const db = opts.getDatabase()
        // Built once per call instead of re-scanning `db.characters` for
        // every id below (three separate O(N) scans over a potentially
        // 1000+-character array otherwise -- ledger row 61). Entries with a
        // falsy/missing chaId are skipped, same as the `.find`/`.some` calls
        // this replaces, which could never match such an entry either.
        const charactersById = new Map<string, character | groupChat>()
        for (const c of db?.characters ?? []) {
            if (c?.chaId) {
                charactersById.set(c.chaId, c)
            }
        }
        toSave.character = toSave.character.filter((chaId) => {
            const char = charactersById.get(chaId)
            return !(char && encodedProxies.has(char))
        })

        // Fold any such mark into `toSave` so THIS save iteration still picks
        // it up -- then re-trim the live tracker back down to just its
        // (possibly new) sticky front now that the rest has been captured
        // here. Also put these through the same presence filter as the
        // no-reload branch below (one consistent rule, chosen over branch-
        // dependent exceptions): a reload's own `init()` above already
        // rebuilds every character present in `db` regardless, so this is
        // harmless/a no-op safety net for the reload path specifically.
        //
        // The actual rule: "an id in `toSave.character` is always present in
        // `db.characters`" is FALSE. Without a reload this iteration, only
        // present ids ever reach `set()` -- the no-reload branch below
        // filters on exactly that. After a reload, the snapshot filter above
        // deliberately does NOT presence-filter: an id absent from
        // `db.characters` (e.g. a
        // character the backup load just deleted) is deliberately KEPT in
        // `toSave.character` (S11 asserts this). In THAT case it's a no-op:
        // the fresh encoder's own `init()` never had a block for an id
        // absent from the db it just built from, so `set()`'s "probably
        // deleted characters" branch has nothing to delete either way.
        // Making the post-reload snapshot presence-filter too was considered
        // (it would make the rule uniform across both branches) but rejected
        // for a narrower race instead: `removeChar()` (or a similar splice)
        // can remove a character from `db.characters` WHILE `reinitEncoder()`
        // is still running, AFTER its `init()` already encoded that
        // character's block. Presence-filtering here would drop that id from
        // `toSave` too, and `set()` (risuSave.ts) would then never see it in
        // `toSave.character` to run its delete branch -- leaving the block
        // `init()` just made for a character that no longer exists sitting
        // in the encoded output. Keeping the id unfiltered instead lets
        // `set()`'s delete branch remove that now-stale block.
        for (const chaId of opts.tracker.character.slice(1)) {
            if (!toSave.character.includes(chaId) && charactersById.has(chaId)) {
                toSave.character.push(chaId)
            }
        }
        opts.tracker.character = opts.tracker.character.length === 0 ? [] : [opts.tracker.character[0]]
    } else {
        // Without a reload this iteration, `RisuSaveEncoder.set()`
        // (risuSave.ts) can't tell a
        // genuinely removed character apart from an id that's merely stale
        // in `toSave.character` for some unrelated reason -- its "probably
        // deleted characters" branch deletes the block outright either way.
        // Filtering `toSave.character` down to ids still present in the
        // current db, before `set()` ever sees them, is what keeps that
        // delete branch from ever running without a reload. Contract: every
        // INTENTIONAL character removal must set `requiresFullEncoderReload`
        // so it's handled by the reload branch above instead.
        const db = opts.getDatabase()
        // Built once per call instead of an O(N) `.some()` scan over
        // `db.characters` for every id (ledger row 61) -- only presence is
        // needed here, so a Set of ids is enough. Falsy/missing chaId
        // entries are skipped, same as the `.some()` call this replaces,
        // which could never match such an entry either.
        const presentIds = new Set<string>()
        for (const c of db?.characters ?? []) {
            if (c?.chaId) {
                presentIds.add(c.chaId)
            }
        }
        toSave.character = toSave.character.filter((chaId) => presentIds.has(chaId))
    }

    return { encoder, toSave }
}

/**
 * Merges a snapshot of a tracker back into the live tracker, without discarding
 * whatever the live tracker has accumulated since the snapshot was taken (e.g.
 * from edits made while a write was in flight). Used whenever a save attempt
 * captured `toSave` but didn't end up persisting it, so nothing pending gets
 * silently dropped. Pure — takes the live tracker explicitly instead of closing
 * over saveDb()'s `changeTracker`, so it can be driven directly by tests
 * (S14).
 */
export function mergeUnsavedChanges(liveTracker: toSaveType, toSave: toSaveType): void {
    for (const chaId of toSave.character) {
        if (!liveTracker.character.includes(chaId)) {
            liveTracker.character.push(chaId)
        }
    }
    for (const pair of toSave.chat) {
        if (!liveTracker.chat.some(([c, ch]) => c === pair[0] && ch === pair[1])) {
            liveTracker.chat.push(pair)
        }
    }
    liveTracker.botPreset ||= toSave.botPreset
    liveTracker.modules ||= toSave.modules
    liveTracker.loadouts ||= toSave.loadouts
    liveTracker.plugins ||= toSave.plugins
    liveTracker.pluginCustomStorage ||= toSave.pluginCustomStorage
}

/**
 * Builds a fresh encoder for a full reload -- the one shared hand-over both
 * `saveDb()` and its tests use, so a reload keeps a block the guard in
 * `risuSave.ts` already kept, instead of losing it to a fresh, empty
 * encoder. Passes the encoder being replaced into `init()`'s `previous`
 * option, so `init()` decides, key by key, from its own fresh pass over
 * `db`, whether to carry a block forward.
 */
export async function reloadSaveEncoder(previousEncoder: RisuSaveEncoder, db: Database, opts: { compression: boolean }): Promise<RisuSaveEncoder> {
    const freshEncoder = new RisuSaveEncoder()
    await freshEncoder.init(db, {
        compression: opts.compression,
        skipRemoteSavingOnCharacters: false,
        previous: previousEncoder
    })
    return freshEncoder
}

// chaId keys this page load has already warned about via console.warn while
// duplicated. A key is removed once it leaves the encoder's frozen set, so a
// later, separate duplicate on the same id warns again.
const warnedFrozenKeys = new Set<string>()

// The entries `publishFrozenSaveIndicator` last wrote to `frozenSaveKeysStore`,
// so a pass that changes nothing about which keys are frozen (the common
// case: no key frozen at all) does not re-set the store and re-notify every
// subscriber.
let lastPublishedFrozenSaveKeys: FrozenSaveKeyInfo[] = []

/** Same chaId keys, and for each the same names in the same order. */
function frozenSaveKeysEqual(a: FrozenSaveKeyInfo[], b: FrozenSaveKeyInfo[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    const namesByKeyInB = new Map(b.map((entry) => [entry.chaId, entry.names]))
    for (const entry of a) {
        const names = namesByKeyInB.get(entry.chaId)
        if (!names || names.length !== entry.names.length) {
            return false
        }
        for (let i = 0; i < names.length; i++) {
            if (names[i] !== entry.names[i]) {
                return false
            }
        }
    }
    return true
}

/**
 * Publishes which characters are currently held by a duplicated chaId to
 * `frozenSaveKeysStore`, for `SavePopupIcon.svelte`'s indicator, and warns
 * once per key per episode via `console.warn`, re-arming once that key
 * resolves. Called after every encode pass that can change which keys are
 * frozen: boot's `init()`, a reload's `init()`, and every `set()` in the save
 * loop below. Only writes the store when its content actually changes --
 * same keys, same names -- so an ordinary pass with nothing frozen does not
 * re-notify every subscriber. Never writes `alertStore` or shows an alert --
 * that only happens from the indicator's own click handler.
 */
export function publishFrozenSaveIndicator(encoder: RisuSaveEncoder, db: Database): void {
    const frozen = encoder.getFrozenKeys()
    if (frozen.size === 0) {
        if (warnedFrozenKeys.size > 0) {
            warnedFrozenKeys.clear()
        }
        if (lastPublishedFrozenSaveKeys.length > 0) {
            lastPublishedFrozenSaveKeys = []
            frozenSaveKeysStore.set([])
        }
        return
    }
    for (const key of warnedFrozenKeys) {
        if (!frozen.has(key)) {
            warnedFrozenKeys.delete(key)
        }
    }
    const namesByKey = new Map<string, string[]>()
    for (const c of db?.characters ?? []) {
        // Matched by `String(chaId)`, the same coercion the encoder counts
        // holders by, so this agrees with which keys `frozen` actually holds.
        const id = String(c?.chaId)
        if (frozen.has(id)) {
            const names = namesByKey.get(id) ?? []
            names.push(c?.name || id)
            namesByKey.set(id, names)
        }
    }
    const entries: FrozenSaveKeyInfo[] = []
    for (const key of frozen) {
        const names = namesByKey.get(key) ?? []
        entries.push({ chaId: key, names })
        if (!warnedFrozenKeys.has(key)) {
            warnedFrozenKeys.add(key)
            console.warn(`RisuAI: saving is paused for a duplicated id (${key}): ${names.join(', ')}`)
        }
    }
    if (!frozenSaveKeysEqual(entries, lastPublishedFrozenSaveKeys)) {
        lastPublishedFrozenSaveKeys = entries
        frozenSaveKeysStore.set(entries)
    }
}

/**
 * The save loop's idle-pass seam (called verbatim whenever `!changed`):
 * while any key is frozen, re-counts its current holders from `chaId` alone
 * -- no other field is read, and nothing is read at all when no key is
 * frozen -- so a duplicate resolved without setting a save mark (e.g.
 * permanently deleting the trashed copy) still gets exactly one save once it
 * drops to fewer than two holders. Once that save runs, the key leaves the
 * encoder's frozen set, so the next idle pass asks for nothing further.
 */
export function checkFrozenKeysForResolution(encoder: RisuSaveEncoder, db: Database): boolean {
    const frozen = encoder.getFrozenKeys()
    if (frozen.size === 0) {
        return false
    }
    const holderCounts = new Map<string, number>()
    for (const key of frozen) {
        holderCounts.set(key, 0)
    }
    for (const c of db?.characters ?? []) {
        // Counted by `String(chaId)`, the same coercion the encoder's own
        // holder count applies, so this agrees with the encoder on what is
        // duplicated.
        const id = String(c?.chaId)
        if (holderCounts.has(id)) {
            holderCounts.set(id, (holderCounts.get(id) ?? 0) + 1)
        }
    }
    let shouldSave = false
    for (const count of holderCounts.values()) {
        if (count < 2) {
            shouldSave = true
        }
    }
    return shouldSave
}

/**
 * Releases any orphan draft-content registration whose cap has elapsed, by
 * forwarding to
 * `draftContentOrphanGate.sweepExpiredRegistrations`. `now` is injectable
 * (defaulting to `Date.now()`) so a test can pin this function's own body
 * without depending on real wall-clock time.
 *
 * `saveDb()`'s own `while (true)` loop calls this once per pass, at a fixed
 * point, unconditionally -- not folded into `prepareSaveIteration`, which
 * only runs once the loop has something to save, because this sweep must
 * keep running on every idle pass regardless. That loop itself is not
 * something a test can drive; only this function's own body is directly
 * testable in isolation.
 */
export function sweepDraftRegistrations(now: number = Date.now()): void {
    draftContentOrphanGate.sweepExpiredRegistrations(now)
}

export async function saveDb() {
    let changed = false
    let otherTabSaved = false
    let dirtySinceLastSave = false
    let lastPromptAt: number | null = null
    const multiTabStorage = (() => {
        try { return window.sessionStorage } catch { return null }
    })()
    let autoReloadHistory: AutoReloadHistory = readAutoReloadHistory(multiTabStorage)
    const sessionID = v4()
    let channel: BroadcastChannel
    if (window.BroadcastChannel) {
        channel = new BroadcastChannel('risu-db')
    }
    if (channel) {
        channel.onmessage = (ev) => {
            if (ev.data === sessionID) {
                return
            }
            otherTabSaved = true
        }
    }

    const changeTracker: toSaveType = {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false
    }

    let encoder = new RisuSaveEncoder()

    const debounceTime = 500; // 500 milliseconds
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    function saveTimeoutExecute(markDirty = true) {
        if (markDirty) {
            dirtySinceLastSave = true
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
            changed = true;
        }, debounceTime);
    }

    // Character-save marks (CHORE-01) are installed
    // BEFORE `encoder.init`, which can take seconds at 1000 characters (ledger
    // row 61) while the UI is already live (bootstrap.ts un-awaits saveDb()
    // after loadedStore.set(true)). A mark made during that window is kept
    // either way, via characterSaveMarks' own pre-install queue -- see
    // bootSaveSequence's own comment for what this two-phase install
    // (pending, then real) actually buys: coalescing any save requests made
    // during init into a single deferred one, once init completes.
    await bootSaveSequence({
        tracker: changeTracker,
        installMarks: installCharacterSaveMarks,
        init: () => encoder.init(getDatabase(), {
            compression: false
        }),
        createRealScheduler: () => saveTimeoutExecute
    })
    try {
        publishFrozenSaveIndicator(encoder, getDatabase())
    } catch (error) {
        // Must never stop boot or the save loop that follows it.
        console.error('Failed to publish the frozen-save indicator:', error)
    }

    $effect.root(() => {
        registerDbChangeEffects({
            tracker: changeTracker,
            markChanged: saveTimeoutExecute,
            // Seeds the identity tracker's WeakSet with exactly the character
            // proxies the `encoder.init` above encoded, so a whole-db/element
            // replacement that happened DURING that init window isn't treated
            // as "already seen" the first time this effect runs.
            // take (not read): registerDbChangeEffects only ever needs this
            // once, at registration, and taking here releases the encoder's
            // own references to these boot-time character objects.
            // registerDbChangeEffects then releases its own copy (`opts.seed
            // = undefined`) once it has built the WeakSet from it -- between
            // the two releases, nothing here is left holding every boot-time
            // character strongly reachable for the app's whole lifetime.
            seed: encoder.takeEncodedCharacterProxies()
        })
    })

    let savetrys = 0
    let lastDbData = new Uint8Array(0)
    let quotaWarningShown = false
    // Shown once per ongoing conflict episode, not once per retry — a
    // version conflict keeps recurring every attempt until the user
    // reloads (see the catch block below), so without this the toast would
    // otherwise repeat every ~1s forever. Reset back to false on a
    // successful write, so a LATER, separate conflict episode still alerts.
    let conflictAlertShown = false
    // Consecutive post-commit ancillary failures (the numbered backup write and
    // getDbBackups's pruning) across separate save attempts. Deliberately NOT `savetrys`:
    // that counter also gates the pre-commit retry/re-commit path (see the
    // catch block below), and folding post-commit failures into it would let a
    // run of post-commit failures masquerade as an active pre-commit retry
    // storm, or vice versa. Reset to 0 only when a full iteration completes
    // without error, so a persistently broken backup write or pruning step
    // still eventually escalates instead of degrading silently forever, the
    // same guarantee `savetrys` gives the pre-commit path on its own.
    let postCommitFailStreak = 0
    const POST_COMMIT_ESCALATE_THRESHOLD = 5
    // Logs a post-commit ancillary failure and, once per consecutive-failure
    // streak (not once per iteration), escalates it to the user via
    // alertError. Only ever called from the `primaryCommitted` branches below
    // -- pre-commit failures keep using the existing `savetrys`-based
    // classification, unchanged.
    function notePostCommitAncillaryFailure(error: unknown) {
        postCommitFailStreak += 1
        console.error(error)
        if (postCommitFailStreak === POST_COMMIT_ESCALATE_THRESHOLD) {
            alertError(error instanceof Error ? error : String(error))
        }
    }
    await sleep(1000)
    while (true) {
        // Releases any orphan draft-content registration whose
        // cap has elapsed. Runs every iteration of this loop -- roughly every
        // ~500ms once idle (see the `if (!changed)` branch below) -- rather
        // than on a per-record timer, so there is no timer to leak. This only
        // ever removes a `localDrafts` registration, never a `draftContents`
        // record; the record stays bounded solely by its own LRU cap.
        // Extracted to `sweepDraftRegistrations` (see its own comment) so
        // this call is a named seam rather than dead-looking code.
        sweepDraftRegistrations()
        if (otherTabSaved) {
            // Consumed, never latched: a later foreign save is always re-evaluated.
            // A message arriving while the modal below is awaited simply sets this
            // again and is handled on the next iteration.
            otherTabSaved = false
            const now = Date.now()
            const hasLocalDraft = hasLocalDrafts()
            const action = getMultiTabAction({
                dirty: dirtySinceLastSave,
                now,
                history: autoReloadHistory,
                lastPromptAt,
                hasLocalDraft
            })
            if (shouldRetainOtherTabSavedSignal({ action, dirty: dirtySinceLastSave, hasLocalDraft })) {
                // A local draft is blocking this reload/prompt while the tab is
                // otherwise clean. There may be no further peer broadcast before the
                // user commits that draft, so keep this signal alive instead of
                // leaving it consumed -- otherwise the `if (otherTabSaved)` guard
                // above would simply be skipped once the tab does go dirty, and the
                // loop would write straight past the conflict prompt below.
                otherTabSaved = true
            }
            if (action === 'auto-reload') {
                autoReloadHistory = nextAutoReloadHistory(autoReloadHistory, now)
                // Only reload if we could actually record that we did. The burst cap
                // lives in sessionStorage, so when storage is unavailable every fresh
                // page would read an empty history and reload again on the next peer
                // save — an unbounded reload loop. Staying put instead is lossless
                // here, because this branch is only reached when the tab is clean.
                if (writeAutoReloadHistory(multiTabStorage, autoReloadHistory)) {
                    markAppInitiatedReload()
                    location.reload()
                    await sleepForever()
                }
            }
            if (action === 'prompt') {
                lastPromptAt = now
                saving.state = false
                if (isRevisionAwareBackend({ isNodeServer })) {
                    // On the self-hosted Node server, this tab's
                    // known revision is now stale precisely because the other tab's
                    // save just landed -- and that revision is deliberately never
                    // refreshed by a refused write (see appStore.ts). So a "save mine"
                    // option here is not a real choice: it would 409 pre-commit on
                    // every single retry. Only offer what can actually happen --
                    // reload to pick up the current server data, or stay and park this
                    // tab (it stops trying to save, and those edits stay unsaved until
                    // it reloads).
                    const choice = resolveRevisionAwarePromptChoice(await alertSelect(
                        [language.otherTabSavedConflictReload, language.otherTabSavedConflictStay],
                        language.otherTabSavedConflictTitle
                    ))
                    if (choice === 'reload') {
                        markAppInitiatedReload()
                        location.reload()
                        await sleepForever()
                    }
                    // choice === 'stay': there is no save-mine path on this backend, so
                    // falling through to the normal save loop would immediately retry with
                    // the now-stale `if-match-revision`, 409 pre-commit, and surface a
                    // second, differently-worded conflict alert before parking anyway (see
                    // the pre-commit version-conflict handling below). Instead, park
                    // this tab right here, quietly: stop attempting to save and never
                    // re-prompt on this page load. The user's edits stay on screen, untouched
                    // and unsaved, until they reload -- exactly what "stay" told them.
                    // (`saving.state` is already `false` from above this if-block.)
                    savingStoppedReason.set('stay')
                    await sleepForever()
                } else {
                    const choice = resolvePromptChoice(await alertSelect(
                        [language.otherTabSavedSaveMine, language.otherTabSavedDiscardMine],
                        language.otherTabSavedTitle
                    ))
                    if (choice === 'reload') {
                        markAppInitiatedReload()
                        location.reload()
                        await sleepForever()
                    }
                    if (choice === 'flush') {
                        // "Save mine": once this write lands, this tab's data IS the
                        // newest committed state -- reloading would just re-read its
                        // own write and gain nothing, while a reload here would risk
                        // destroying edits landing during the write window instead.
                        // Just let the normal save loop pick this up and stay put.
                        changed = true
                    }
                }
            }
        }
        if (!changed) {
            // While any chaId is frozen against a save-file rewrite, this
            // asks the loop to run a pass even without a save mark, so a
            // duplicate resolved by a change that sets no mark of its own
            // (e.g. permanently deleting the trashed copy) still gets saved.
            // A failure here must never stop the loop -- it just falls back
            // to the ordinary sleep-and-continue idle pass.
            let resolvedDuplicate = false
            try {
                resolvedDuplicate = checkFrozenKeysForResolution(encoder, getDatabase())
            } catch (error) {
                console.error('Frozen-key resolution check failed:', error)
            }
            if (resolvedDuplicate) {
                changed = true
            } else {
                await sleep(500)
                continue
            }
        }

        saving.state = true
        changed = false
        // Declared outside the try block (and left null until actually assigned) so the
        // catch handler can safely check whether a snapshot was taken this iteration
        // before attempting to merge it back — an error thrown before that assignment
        // (e.g. during encoder re-init) must not itself throw inside the catch.
        let toSave: toSaveType | null = null
        let primaryCommitted = false
        try {

            const prepared = await prepareSaveIteration({
                tracker: changeTracker,
                encoder,
                reloadFlag: requiresFullEncoderReload,
                reinitEncoder: async () => {
                    const freshEncoder = await reloadSaveEncoder(encoder, getDatabase(), {
                        compression: false
                    })
                    try {
                        publishFrozenSaveIndicator(freshEncoder, getDatabase())
                    } catch (error) {
                        // Must never fail the reload itself, or this would be
                        // treated as a failed write and retried forever.
                        console.error('Failed to publish the frozen-save indicator:', error)
                    }
                    return freshEncoder
                },
                getDatabase,
                onSnapshotTaken: () => { dirtySinceLastSave = false },
                // A failed reload already gets its snapshot folded back into
                // the live tracker (nothing is lost), but that alone doesn't
                // tell this outer scope the attempt failed -- without this,
                // a peer tab's broadcast could see `dirtySinceLastSave` still
                // false from the `onSnapshotTaken` reset above and reload
                // this tab out from under its restored, still-unsaved edits.
                onSnapshotRestored: () => { dirtySinceLastSave = true }
            })
            encoder = prepared.encoder
            toSave = prepared.toSave

            let db = getDatabase()
            if (!db.characters) {
                mergeUnsavedChanges(changeTracker, toSave)
                await sleep(1000)
                continue
            }

            await encoder.set(db, toSave)
            try {
                publishFrozenSaveIndicator(encoder, db)
            } catch (error) {
                // Must never fail this write, or it would be treated as a
                // failed write and retried forever.
                console.error('Failed to publish the frozen-save indicator:', error)
            }
            const encoded = encoder.encode()
            if (!encoded) {
                mergeUnsavedChanges(changeTracker, toSave)
                await sleep(1000)
                continue
            }
            const dbData = new Uint8Array(encoded)
            // Best-effort, non-blocking heads-up before storage actually fills up —
            // browser storage has no other quota signal until a write starts failing.
            if (!isTauri && !quotaWarningShown && navigator.storage?.estimate) {
                try {
                    const { quota, usage } = await navigator.storage.estimate()
                    if (quota && (quota - (usage ?? 0)) < dbData.byteLength * 2) {
                        quotaWarningShown = true
                        alertToast('Your browser storage is running low — saves may start failing soon. Consider freeing up space (delete old chats/characters or old backups).')
                    }
                } catch (error) {
                    // estimate() is best-effort only; a failure here must not block saving.
                }
            }
            const shouldWriteBackup = (Date.now() - lastBackupWriteTime) > DB_BACKUP_MIN_INTERVAL_MS
            // Acquired before the write and held through it (not just checked-then-acted
            // on) so a concurrent direct writer to this same key (LoadLocalBackup()'s
            // restore write, the internal-backup load's write) can never interleave with this write — see AsyncMutex/dbWriteLock above.
            const releaseWriteLock = await dbWriteLock.acquire()
            try {
                await writeMainFile(dbData)
            } finally {
                releaseWriteLock()
            }
            // Reached only when the write above did not throw, so the record
            // never claims bytes storage does not hold.
            noteMainFileBytes(dbData)
            // The primary database write has landed. Everything after this point
            // (backup write, getDbBackups) is best-effort and must never be
            // able to resurrect and re-commit this payload — see the catch below.
            primaryCommitted = true
            if (channel) {
                try {
                    channel.postMessage(sessionID)
                } catch (error) {
                    // A failed notification must never fail a save that succeeded.
                    console.error(error)
                }
            }
            if (shouldWriteBackup) {
                // A new name per write, so nothing can be overwritten and the
                // write needs no condition.
                await (await getAppStore()).write(`database/dbbackup-${(Date.now() / 100).toFixed()}.bin`, dbData, 'unconditional')
                lastBackupWriteTime = Date.now()
                // The backups only grow with a backup write, so only then are
                // they pruned.
                await getDbBackups()
            }

            savetrys = 0
            conflictAlertShown = false
            // A full iteration -- primary write, backup write, and getDbBackups
            // (the steps above that can actually throw) -- completed without
            // error, so this is a genuinely clean cycle: reset the consecutive
            // post-commit failure streak.
            postCommitFailStreak = 0
            await sleep(500)
        } catch (error) {
            // `primaryCommitted` separates two independent concerns: (1) whether
            // it's safe to retry — restore the tracker, mark `changed`, and loop
            // back to re-encode/re-write — and (2) how to classify and report the
            // error to the user. Only (1) depends on
            // `primaryCommitted`: retrying after the primary write already landed
            // would re-commit an already-committed payload and could overwrite a peer
            // tab that has since flushed its own state in response to our broadcast —
            // the race this flag exists to prevent. But the error itself is exactly as
            // real either way — a quota or other failure in a backup write or in
            // getDbBackups() (its pruning delete) is just as actionable to the
            // user as one in the primary write — so classification always runs below,
            // regardless of `primaryCommitted`. This can't turn into a toast-spam loop: the
            // conflict branches already gate on `conflictAlertShown` (a one-shot until
            // the next successful write), and since `changed` is never set on the
            // post-commit path, there is no tight retry loop for the quota/generic
            // branches to spam from either — classification only runs again here when
            // a genuinely new edit triggers another save attempt.
            if (!primaryCommitted) {
                savetrys += 1
                // The write failed after the tracker was already trimmed above, so fold
                // `toSave` back in — merged with whatever's accumulated since — instead of
                // losing it. `toSave` (this outer, saveDb()-local variable) is only set
                // once prepareSaveIteration() has fully returned; a throw from inside it
                // (e.g. reinitEncoder() failing mid-reload) never reaches that assignment,
                // but prepareSaveIteration() already merges its own in-flight snapshot
                // back into the live tracker itself before propagating such an error, AND
                // calls `onSnapshotRestored` (wired above to `dirtySinceLastSave = true`)
                // -- so this branch's own merge only has something left to do when
                // `toSave` WAS assigned (the failure happened after prepareSaveIteration()
                // returned, e.g. encoder.set()/encode()/the write itself throwing).
                // `dirtySinceLastSave` is still set unconditionally right below,
                // belt-and-braces: this attempt failed either way, and a multi-tab
                // auto-reload must never mistake a failed attempt for a clean tab just
                // because this particular failure happened to leave `toSave` unset.
                if (toSave) {
                    mergeUnsavedChanges(changeTracker, toSave)
                }
                dirtySinceLastSave = true
                changed = true
            } else {
                // Primary write already succeeded and was already broadcast; only
                // ancillary best-effort work (backup writes, getDbBackups)
                // failed. Do NOT restore the tracker or set `changed` — see the
                // reasoning above.
                savetrys = 0
            }
            // Only the main-file write can raise the store's conflict: it is the one
            // conditional write here. Remote character blocks, the numbered backup
            // and the prune are unconditional, and nothing else in this try goes
            // through the Node client.
            if (error instanceof StoreVersionConflictError) {
                // This device's local data is out of date with the self-hosted
                // Node server — another writer has saved this key since this
                // device last read it. Deliberately not treated as a transient
                // failure worth blindly retrying: encoding and writing the same
                // (still-stale) local state again would just resend the same
                // version the server already rejected once, and it will
                // keep rejecting it every subsequent attempt too — that's the
                // correct, expected behavior (protecting the other writer's
                // newer data), not a bug to route around. The only real
                // resolution today is reloading (picking up the server's current
                // data fresh), which this alert says explicitly, since silently
                // "queuing" the failed edit and reloading would discard it — see
                // Agents/Reports/06-conflict-resolution-design-feasibility.md.
                //
                // That reasoning only holds pre-commit. If `primaryCommitted` is
                // true, this device's write already landed and was already
                // broadcast to other tabs, so a conflict raised afterwards came from
                // ancillary best-effort work; the backup steps cannot raise one in
                // this build, and the branch stays for any conditional ancillary
                // write that is added. There is no
                // stale local write to protect here, so claiming the save failed
                // and parking the tab would be wrong — it would reintroduce "one
                // bad ancillary event permanently disables saving" for a save that
                // actually succeeded.
                if (primaryCommitted) {
                    if (!conflictAlertShown) {
                        conflictAlertShown = true
                        alertToast('Your latest changes were saved. A background backup step could not complete because of a conflict on the self-hosted server; this does not affect your saved data.')
                    }
                    notePostCommitAncillaryFailure(error)
                    await sleep(500)
                } else {
                    if (!conflictAlertShown) {
                        conflictAlertShown = true
                        alertToast('Your local data conflicts with a newer version on the self-hosted server — your latest changes could not be saved. Reload the app to get the current data (unsynced local changes will be lost).')
                    }
                    console.error(error)
                    // Actually stop retrying, not just stop re-alerting: a short
                    // sleep-then-loop here would re-encode and resend the exact
                    // same rejected state on every iteration forever. Reload is
                    // the only real resolution today, so park this loop
                    // indefinitely instead. Deliberately `sleepForever()`, not
                    // `sleep(hugeNumber)`: a millisecond count large enough to
                    // look like "forever" still resolves eventually and
                    // silently resumes sending the known-stale write, while
                    // `sleepForever()` never resolves at all, so only a reload
                    // (which discards this pending await along with all other
                    // JS state) can end it.
                    saving.state = false
                    savingStoppedReason.set('node-conflict')
                    await sleepForever()
                }
            }
            else if (isQuotaExceededError(error)) {
                // A distinct, actionable message instead of the generic retry path —
                // "retrying" is misleading here, since retrying the exact same write
                // won't succeed until the user actually frees up space.
                alertToast('Your browser storage is full — free up space (delete old chats, characters, or backups) and try again. Your latest edits could not be saved.')
                // Post-commit, `changed` was deliberately left false above, so there is
                // nothing queued to retry — just yield back to the idle poll at the top
                // of the loop instead of the longer pre-commit retry backoff.
                if (primaryCommitted) {
                    notePostCommitAncillaryFailure(error)
                } else {
                    console.error(error)
                }
                await sleep(primaryCommitted ? 500 : 5000)
            }
            else {
                if (primaryCommitted) {
                    // Ancillary failure with nothing more specific to classify.
                    // notePostCommitAncillaryFailure logs it and escalates via
                    // alertError once this becomes a persistent streak, instead of
                    // degrading silently forever. Nothing is queued to retry (see
                    // above), so this deliberately skips the "retrying…" toast
                    // below, which would be misleading — no retry is actually
                    // happening.
                    notePostCommitAncillaryFailure(error)
                    await sleep(500)
                } else {
                    if (savetrys === 1) {
                        alertToast('Failed to save data, retrying…')
                    }
                    if (savetrys > 4) {
                        alertError(error)
                    }
                    else {
                        console.error(error)
                    }
                    await sleep(1000)
                }
            }
        }

        saving.state = false
    }
}

/**
 * Retrieves the database backups.
 * 
 * @returns {Promise<number[]>} - A promise that resolves to an array of backup timestamps.
 */
export async function getDbBackups() {
    const store = await getAppStore()
    const backups: { key: string, time: number }[] = []
    for (const key of await store.list(DB_BACKUP_KEY_PREFIX)) {
        // Only `dbbackup-<digits>.bin` is a numbered backup; any other name
        // that shares the prefix is not this app's and is left alone.
        const match = /^(\d+)\.bin$/.exec(key.slice(DB_BACKUP_KEY_PREFIX.length))
        if (match) {
            backups.push({ key, time: Number(match[1]) })
        }
    }
    backups.sort((a, b) => b.time - a.time)
    while (backups.length > 20) {
        // Unconditional: another tab removing the same oldest backup first is
        // not an error, and a backup is never overwritten, so there is no newer
        // value of it to protect.
        await store.delete(backups.pop().key, 'unconditional')
    }
    return backups.map((backup) => backup.time)
}

let usingSw = false

export function setUsingSw(value: boolean) {
    usingSw = value
}

/**
 * Reports whether `getFileSrc(loc)` would take the plain-HTTP branch (the one
 * that reads+encodes through `fileCache` above) right now, without calling it.
 * Must mirror getFileSrc's own branch conditions exactly — this is a
 * synchronous snapshot of the same two checks getFileSrc makes before its
 * first await, so a caller (parser.svelte.ts's getFileSrcCached) can decide,
 * in the same tick, whether to route through its own permanent cache or
 * call getFileSrc directly every time.
 */
export function isPlainHttpFileSrc(loc: string): boolean {
    return !isTauri && !usingSw
}

/**
 * Retrieves fetch data for a given chat ID.
 * 
 * @param {string} id - The chat ID to search for in the fetch log.
 * @returns {fetchLog | null} - The fetch log entry if found, otherwise null.
 */
export function getFetchData(id: string) {
    for (const log of fetchLog) {
        if (log.chatId === id) {
            return log;
        }
    }
    return null;
}

const knownHostes = ["localhost", "127.0.0.1", "0.0.0.0"];
const webLocalNetworkBlockedMessage = "웹에서는 사설망 직접 호출 불가. Tauri 또는 LAN Node self-host 사용";
const defaultProxyJobHeartbeatSec = 15;

function getProxy2Url() {
    return !isTauri && !isNodeServer ? `${hubURL}/proxy2` : `/proxy2`;
}

function getProxyStreamJobBaseUrl() {
    return isNodeServer ? '' : `${hubURL}`;
}

function buildTimeoutSignal(originalSignal?: AbortSignal, timeoutMs?: number) {
    if (!timeoutMs || timeoutMs <= 0) {
        return {
            signal: originalSignal,
            cleanup: () => { /* no-op */ }
        };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (originalSignal) {
        if (originalSignal.aborted) {
            controller.abort();
        }
        else {
            originalSignal.addEventListener('abort', onAbort, { once: true });
        }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
            originalSignal?.removeEventListener('abort', onAbort);
        }
    };
}

/**
 * Interface representing the arguments for the global fetch function.
 * 
 * @interface GlobalFetchArgs
 * @property {boolean} [plainFetchForce] - Whether to force plain fetch.
 * @property {any} [body] - The body of the request.
 * @property {{ [key: string]: string }} [headers] - The headers of the request.
 * @property {boolean} [rawResponse] - Whether to return the raw response.
 * @property {'POST' | 'GET'} [method] - The HTTP method to use.
 * @property {AbortSignal} [abortSignal] - The abort signal to cancel the request.
 * @property {string} [chatId] - The chat ID associated with the request.
 */
export interface GlobalFetchArgs {
    plainFetchForce?: boolean;
    plainFetchDeforce?: boolean;
    body?: any;
    headers?: { [key: string]: string };
    rawResponse?: boolean;
    method?: 'POST' | 'GET';
    abortSignal?: AbortSignal;
    chatId?: string;
    interceptor?: string;
    requestTimeoutMs?: number;
    networkRoute?: 'auto' | 'local_network';
}

/**
 * Interface representing the result of the global fetch function.
 * 
 * @interface GlobalFetchResult
 * @property {boolean} ok - Whether the request was successful.
 * @property {any} data - The data returned from the request.
 * @property {{ [key: string]: string }} headers - The headers returned from the request.
 */
interface GlobalFetchResult {
    ok: boolean;
    data: any;
    headers: { [key: string]: string };
    status: number;
}

/**
 * Adds a fetch log entry.
 * 
 * @param {Object} arg - The arguments for the fetch log entry.
 * @param {any} arg.body - The body of the request.
 * @param {{ [key: string]: string }} [arg.headers] - The headers of the request.
 * @param {any} arg.response - The response from the request.
 * @param {boolean} arg.success - Whether the request was successful.
 * @param {string} arg.url - The URL of the request.
 * @param {string} [arg.resType] - The response type.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {number} - The index of the added fetch log entry.
 */
export function addFetchLog(arg: {
    body: any,
    headers?: { [key: string]: string },
    response: any,
    success: boolean,
    url: string,
    resType?: string,
    chatId?: string,
    status?: number
}): number {
    fetchLog.unshift({
        body: typeof (arg.body) === 'string' ? arg.body : JSON.stringify(arg.body, null, 2),
        header: JSON.stringify(arg.headers ?? {}, null, 2),
        response: typeof (arg.response) === 'string' ? arg.response : JSON.stringify(arg.response, null, 2),
        responseType: arg.resType ?? 'json',
        success: arg.success,
        date: (new Date()).toLocaleTimeString(),
        url: arg.url,
        chatId: arg.chatId,
        status: arg.status
    });
    return 0;
}

/**
 * Performs a global fetch request.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} [arg={}] - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
export async function globalFetch(url: string, arg: GlobalFetchArgs = {}): Promise<GlobalFetchResult> {
    try {
        const db = getDatabase();
        if (arg.abortSignal?.aborted) { return { ok: false, data: 'aborted', headers: {}, status: 400 }; }

        const urlHost = new URL(url).hostname
        const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
        const forcePlainFetch = ((knownHostes.includes(urlHost) && !isTauri) || db.usePlainFetch || arg.plainFetchForce) && !arg.plainFetchDeforce && !useLocalNetworkRoute

        if (useLocalNetworkRoute && !isTauri && !isNodeServer) {
            return { ok: false, headers: {}, status: 400, data: webLocalNetworkBlockedMessage };
        }

        if (knownHostes.includes(urlHost) && !isTauri && !isNodeServer) {
            return { ok: false, headers: {}, status: 400, data: 'You are trying local request on web version. This is not allowed due to browser security policy. Use the desktop version instead, or use a tunneling service like ngrok and set the CORS to allow all.' };
        }

        if(arg.interceptor){
            for (const interceptor of bodyIntercepterStore) {
                try {
                    arg.body = await interceptor.callback(arg.body, arg.interceptor) || arg.body
                }
                catch (e) {
                    console.error(e)
                }
            }
        }

        const timeoutSignal = buildTimeoutSignal(arg.abortSignal, arg.requestTimeoutMs)
        const requestArg = timeoutSignal.signal === arg.abortSignal
            ? arg
            : { ...arg, abortSignal: timeoutSignal.signal }

        try {
            if (useLocalNetworkRoute) {
                if (isTauri) {
                    return await fetchWithTauri(url, requestArg);
                }
                return await fetchWithProxy(url, requestArg);
            }
            if (forcePlainFetch) {
                return await fetchWithPlainFetch(url, requestArg);
            }
            //userScriptFetch is provided by userscript
            if (window.userScriptFetch) {
                return await fetchWithUSFetch(url, requestArg);
            }
            if (isTauri) {
                return await fetchWithTauri(url, requestArg);
            }
            return await fetchWithProxy(url, requestArg);
        } finally {
            timeoutSignal.cleanup();
        }

    } catch (error) {
        console.error(error);
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Adds a fetch log entry in the global fetch log.
 * 
 * @param {any} response - The response data.
 * @param {boolean} success - Indicates if the fetch was successful.
 * @param {string} url - The URL of the fetch request.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 */
function addFetchLogInGlobalFetch(response: any, success: boolean, url: string, arg: GlobalFetchArgs, status?: number) {
    try {
        fetchLog.unshift({
            body: JSON.stringify(arg.body, null, 2),
            header: JSON.stringify(arg.headers ?? {}, null, 2),
            response: JSON.stringify(response, null, 2),
            success: success,
            date: (new Date()).toLocaleTimeString(),
            url: url,
            chatId: arg.chatId,
            status: status
        })
    }
    catch {
        fetchLog.unshift({
            body: JSON.stringify(arg.body, null, 2),
            header: JSON.stringify(arg.headers ?? {}, null, 2),
            response: `${response}`,
            success: success,
            date: (new Date()).toLocaleTimeString(),
            url: url,
            chatId: arg.chatId,
            status: status
        })
    }

    if (fetchLog.length > 20) {
        fetchLog.pop()
    }
}

/**
 * Performs a fetch request using plain fetch.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithPlainFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await fetch(new URL(url), { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.ok && response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using userscript provided fetch.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithUSFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await userScriptFetch(url, { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.ok && response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using Tauri.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithTauri(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await TauriHTTPFetch(new URL(url), { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using a proxy.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithProxy(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const furl = getProxy2Url();
        arg.headers ??= {};
        arg.headers["Content-Type"] ??= arg.body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json";
        const nodeProxyAuth = isNodeServer ? await getNodeServerProxyAuth() : null;
        const headers = {
            "risu-header": encodeURIComponent(JSON.stringify(arg.headers)),
            "risu-url": encodeURIComponent(url),
            "Content-Type": arg.body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json",
            ...(arg.requestTimeoutMs && { "risu-timeout-ms": Math.max(1, Math.floor(arg.requestTimeoutMs)).toString() }),
            ...(nodeProxyAuth && { "risu-auth": nodeProxyAuth }),
            ...(DBState?.db?.requestLocation && { "risu-location": DBState.db.requestLocation }),
        };

        const body = arg.body instanceof URLSearchParams ? arg.body.toString() : JSON.stringify(arg.body);

        const response = await fetch(furl, { body, headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const isSuccess = response.ok && response.status >= 200 && response.status < 300;

        if (arg.rawResponse) {
            const data = new Uint8Array(await response.arrayBuffer());
            addFetchLogInGlobalFetch("Uint8Array Response", isSuccess, url, arg, response.status);
            return { ok: isSuccess, data, headers: Object.fromEntries(response.headers), status: response.status };
        }

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            addFetchLogInGlobalFetch(data, isSuccess, url, arg, response.status);
            return { ok: isSuccess, data, headers: Object.fromEntries(response.headers), status: response.status };
        } catch (error) {
            const errorMsg = text.startsWith('<!DOCTYPE') ? "Responded HTML. Is your URL, API key, and password correct?" : text;
            addFetchLogInGlobalFetch(text, false, url, arg, response.status);
            return { ok: false, data: errorMsg, headers: Object.fromEntries(response.headers), status: response.status };
        }
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Regular expression to match backslashes.
 * 
 * @constant {RegExp}
 */
const re = /\\/g;

/**
 * Gets the basename of a given path.
 * 
 * @param {string} data - The path to get the basename from.
 * @returns {string} - The basename of the path.
 */
export function getBasename(data: string) {
    const splited = data.replace(re, '/').split('/');
    const lasts = splited[splited.length - 1];
    return lasts;
}

/**
 * Resolves each character to the full data `getUncleanablesSync` should
 * scan for asset references, swapping in a cold-stored character's own
 * blob when it is readable and matches. Used by `buildAssetKeepSet`
 * (CHORE-07 stage 7a).
 *
 * `opts.swallowErrors` controls what happens when a `cha.coldstorage` read
 * throws:
 * - `false`: the read is awaited with no try/catch around it, so a throw
 *   rejects this function immediately, before any later character is
 *   scanned. No current `getColdStorageItem` (`coldstorage.svelte.ts`)
 *   backend actually does this -- Node, Tauri and OPFS each swallow their
 *   own read errors into a `null` return -- so this stays a defensive
 *   guard rather than a reachable path today. Nothing in this module
 *   currently calls this function with `false`.
 * - `true` (`buildAssetKeepSet`'s own behaviour): the read is wrapped in a
 *   try/catch, and a throw is recorded by setting `complete = false`
 *   instead of rejecting, so the boot-time asset sweep can still finish
 *   scanning the rest of the characters and skip deleting anything rather
 *   than crash.
 *
 * Independent of that flag, `complete` is also false whenever a read
 * resolves but is falsy, or its `character.chaId` does not match
 * `cha.chaId` (the existing check below) -- neither of those is a throw,
 * so both flag values reach this same branch. In every case where a full
 * character could not be substituted, `cha` itself (the stub) is still
 * what gets scanned.
 */
async function resolveUncleanableChars(db: Database, opts: { swallowErrors: boolean }): Promise<{
    chars: (character|groupChat)[]
    complete: boolean
}> {
    let chars: (character|groupChat)[] = []
    let complete = true
    if (db.characters) {
        for(let cha of db.characters){
            if(cha?.coldstorage){
                if(opts.swallowErrors){
                    try {
                        const coldData = await getColdStorageItem(cha.coldstorage!)
                        if(coldData?.character && coldData.character.chaId === cha.chaId){
                            cha = coldData.character
                        }
                        else{
                            complete = false
                        }
                    } catch (error) {
                        complete = false
                    }
                }
                else{
                    const coldData = await getColdStorageItem(cha.coldstorage!)
                    if(coldData?.character && coldData.character.chaId === cha.chaId){
                        cha = coldData.character
                    }
                    else{
                        complete = false
                    }
                }
            }
            chars.push(cha)
        }
    }

    return { chars, complete }
}

/**
 * Builds the keep-set the boot-time asset sweep (`cleanChunks`'s
 * `sweepTauriAssets` / `sweepForageAssetKey`, `src/ts/storage/assetSweep.ts`)
 * uses to decide what NOT to delete (CHORE-07 stage 7a).
 *
 * A `cha.coldstorage` read that throws here does NOT reject this function:
 * it is swallowed and reported as `complete: false`, the same as a falsy
 * read or a chaId mismatch (see `resolveUncleanableChars`), so the
 * boot-time sweep can finish scanning every character. The sweeps
 * (`sweepTauriAssets` / `sweepForageAssetKey`) skip deleting anything when
 * `complete` is explicitly `false`.
 */
export async function buildAssetKeepSet(db: Database): Promise<{ uncleanable: Set<string>, complete: boolean }> {
    const { chars, complete } = await resolveUncleanableChars(db, { swallowErrors: true })
    const uncleanable = new Set(getUncleanablesSync(db, { chars }))
    return { uncleanable, complete }
}

/**
 * Retrieves uncleanable resources from the database, by basename.
 *
 * @param {Database} db - The database to retrieve uncleanable resources from.
 * @returns {Promise<string[]>} - An array of uncleanable resources.
 */
export function getUncleanablesSync(db: Database, options?:{
    chars: (character|groupChat)[],
}) {
    const uncleanable = new Set<string>();

    /**
     * Adds a resource to the uncleanable list if it is not already included.
     *
     * @param {string} data - The resource to add.
     */
    function addUncleanable(data: string) {
        if (!data) {
            return;
        }
        if (data === '') {
            return;
        }
        uncleanable.add(getBasename(data));
    }

    addUncleanable(db.customBackground);
    addUncleanable(db.userIcon);
    // These are asset-path fields (populated by saveAsset()), not the adjacent
    // base64 fields — see Agents/Roadmap.md Phase 1, item 1. NAIImgConfig's
    // `reference_image_multiple` is deliberately not included here: nothing
    // currently populates it via saveAsset(), so it holds no asset reference
    // to protect.
    addUncleanable(db.NAIImgConfig?.image);
    addUncleanable(db.NAIImgConfig?.character_image);
    addUncleanable(db.wavespeedImage?.reference_image);
    const chars = options?.chars ?? db.characters

    for (let cha of chars) {
        if (cha.image) {
            addUncleanable(cha.image);
        }
        if (cha.emotionImages) {
            for (const em of cha.emotionImages) {
                addUncleanable(em[1]);
            }
        }
        // additionalAssets/vits are declared on BOTH `character` and `groupChat`
        // (the latter's fields are unused by any current write path — see
        // Agents/Roadmap.md Phase 0.5 — but are still real fields on the type), so
        // they're protected here unconditionally rather than being skipped for
        // groups: if anything ever does populate them on a group chat, the boot-time
        // GC sweep below must not delete the referenced asset out from under it.
        if (cha.additionalAssets) {
            for (const em of cha.additionalAssets) {
                addUncleanable(em[1]);
            }
        }
        if (cha.vits) {
            const keys = Object.keys(cha.vits.files);
            for (const key of keys) {
                const vit = cha.vits.files[key];
                addUncleanable(vit);
            }
        }
        // TTS reads this asset back directly with no fallback (src/ts/process/tts.ts),
        // so its deletion is real functional data loss, not just a stale preview.
        // Present on both `character` and `groupChat` (the latter typed `any`, same
        // "lazy hack for typechecking" category as vits/additionalAssets above), so
        // protected unconditionally for the same reason those are.
        addUncleanable(cha.gptSoVitsConfig?.ref_audio_data?.assetId);
        if (cha.type !== 'group') {
            if (cha.ccAssets) {
                for (const asset of cha.ccAssets) {
                    addUncleanable(asset.uri);
                }
            }
        }
    }

    if (db.modules) {
        for (const module of db.modules) {
            const assets = module.assets
            if (assets) {
                for (const asset of assets) {
                    addUncleanable(asset[1])
                }
            }
            if(module.icon){
                addUncleanable(module.icon)
            }
        }
    }

    if (db.personas) {
        db.personas.map((v) => {
            addUncleanable(v.icon);

            if(v.embeddedModule){
                const assets = v.embeddedModule.assets
                if (assets) {
                    for (const asset of assets) {
                        addUncleanable(asset[1])
                    }
                }
                if(v.embeddedModule.icon){
                    addUncleanable(v.embeddedModule.icon)
                }
            }
        });
    }

    if (db.characterOrder) {
        db.characterOrder.forEach((item) => {
            if (typeof item === 'object' && 'imgFile' in item) {
                addUncleanable(item.imgFile);
            }
        })
    }
    return Array.from(uncleanable);
}


/**
 * Checks and updates the character order in the database.
 * Ensures that all characters are properly ordered and removes any invalid entries.
 */
export function checkCharOrder() {
    DBState.db.characterOrder = DBState.db.characterOrder ?? []
    const ordered = new Set<string>()
    for (let i = 0; i < DBState.db.characterOrder.length; i++) {
        const folder = DBState.db.characterOrder[i]
        if (typeof (folder) !== 'string' && folder) {
            for (const f of folder.data) {
                ordered.add(f)
            }
        }
        if (typeof (folder) === 'string') {
            ordered.add(folder)
        }
    }

    const charIdSet = new Set<string>()

    for (let i = 0; i < DBState.db.characters.length; i++) {
        const char = DBState.db.characters[i]
        const charId = char.chaId
        if (!char.trashTime) {
            charIdSet.add(charId)
        }
        if (!ordered.has(charId)) {
            if (!isHiddenSystemCharacter(char) && !char.trashTime) {
                DBState.db.characterOrder.push(charId)
            }
        }
    }


    for (let i = 0; i < DBState.db.characterOrder.length; i++) {
        const data = DBState.db.characterOrder[i]
        if (typeof (data) !== 'string') {
            if (!data) {
                DBState.db.characterOrder.splice(i, 1)
                i--;
                continue
            }
            if (data.data.length === 0) {
                DBState.db.characterOrder.splice(i, 1)
                i--;
                continue
            }
            for (let i2 = 0; i2 < data.data.length; i2++) {
                const data2 = data.data[i2]
                if (!charIdSet.has(data2)) {
                    data.data.splice(i2, 1)
                    i2--;
                }
            }
            DBState.db.characterOrder[i] = data
        }
        else {
            if (!charIdSet.has(data)) {
                DBState.db.characterOrder.splice(i, 1)
                i--;
            }
        }
    }
}

/**
 * Retrieves the request log as a formatted string.
 * 
 * @returns {string} The formatted request log.
 */
export function getRequestLog() {
    let logString = ''
    const b = '\n\`\`\`json\n'
    const bend = '\n\`\`\`\n'

    for (const log of fetchLog) {
        logString += `## ${log.date}\n\n* Request URL\n\n${b}${log.url}${bend}\n\n* Request Body\n\n${b}${log.body}${bend}\n\n* Request Header\n\n${b}${log.header}${bend}\n\n`
            + `* Response Body\n\n${b}${log.response}${bend}\n\n* Response Success\n\n${b}${log.success}${bend}\n\n`
    }
    return logString
}

/**
 * Retrieves the fetch logs array.
 *
 * @returns {fetchLog[]} The fetch logs array.
 */
export function getFetchLogs() {
    return fetchLog
}

/**
 * Opens a URL in the appropriate environment: on Tauri, the shell plugin's
 * own scheme allowlist decides what `open` will actually launch; on the web,
 * `openUrlOnWeb` opens http(s) in a new, opener-less tab, hands mailto:/tel:
 * to the OS from the current tab, and refuses every other scheme.
 *
 * @param {string} url - The URL to open.
 */
export function openURL(url: string) {
    if (isTauri) {
        // The warning never includes the URL: OAuth URLs carry state and PKCE values.
        try {
            open(url).catch(() => {
                console.warn('openURL: the system could not open the link')
            })
        }
        catch {
            console.warn('openURL: the system could not open the link')
        }
    }
    else {
        openUrlOnWeb(url, window)
    }
}

/**
 * Converts FormData to a URL-encoded string.
 * 
 * @param {FormData} formData - The FormData to convert.
 * @returns {string} The URL-encoded string.
 */
function formDataToString(formData: FormData): string {
    const params: string[] = [];

    for (const [name, value] of formData.entries()) {
        params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value.toString())}`);
    }

    return params.join('&');
}

/**
 * A writer class for Tauri environment.
 */
export class TauriWriter {
    path: string
    firstWrite: boolean = true

    /**
     * Creates an instance of TauriWriter.
     * 
     * @param {string} path - The file path to write to.
     */
    constructor(path: string) {
        this.path = path
    }

    /**
     * Writes data to the file.
     * 
     * @param {Uint8Array} data - The data to write.
     */
    async write(data: Uint8Array) {
        await writeFile(this.path, data, {
            append: !this.firstWrite
        })
        this.firstWrite = false
    }

    /**
     * Closes the writer. (No operation for TauriWriter)
     */
    async close() {
        // do nothing
    }
}


/**
 * Class representing a local writer.
 */
export class LocalWriter {
    writer: WritableStreamDefaultWriter | TauriWriter

    /**
     * Initializes the writer.
     * 
     * @param {string} [name='Binary'] - The name of the file.
     * @param {string[]} [ext=['bin']] - The file extensions.
     * @returns {Promise<boolean>} - A promise that resolves to a boolean indicating success.
     */
    async init(name = 'Binary', ext = ['bin']): Promise<boolean> {
        if (isTauri) {
            const filePath = await save({
                filters: [{
                    name: name,
                    extensions: ext
                }]
            });
            if (!filePath) {
                return false
            }
            this.writer = new TauriWriter(filePath)
            return true
        }
        const writableStream = streamSaver.createWriteStream(name + '.' + ext[0])
        this.writer = writableStream.getWriter()
        return true
    }

    /**
     * Writes backup data to the file.
     * 
     * @param {string} name - The name of the backup.
     * @param {Uint8Array} data - The data to write.
     * @throws {Error} When the name or the data does not fit the 32-bit length fields.
     */
    async writeBackup(name: string, data: Uint8Array): Promise<void> {
        const encodedName = new TextEncoder().encode(getBasename(name))
        // A length past u32 would wrap and yield an entry no reader can parse.
        if (encodedName.byteLength > 0xFFFFFFFF || data.byteLength > 0xFFFFFFFF) {
            throw new Error(`Backup entry "${name}" is too large to store (a single backup entry is limited to 4 GiB).`)
        }
        const nameLength = new Uint32Array([encodedName.byteLength])
        await this.writer.write(new Uint8Array(nameLength.buffer))
        await this.writer.write(encodedName)
        const dataLength = new Uint32Array([data.byteLength])
        await this.writer.write(new Uint8Array(dataLength.buffer))
        await this.writer.write(data)
    }

    /**
     * Writes data to the file.
     * 
     * @param {Uint8Array} data - The data to write.
     */
    async write(data: Uint8Array): Promise<void> {
        await this.writer.write(data)
    }

    /**
     * Closes the writer.
     */
    async close(): Promise<void> {
        await this.writer.close()
    }
}

export { AppendableBuffer, VirtualWriter } from './byteBuffer'

/**
 * Index for fetch operations.
 * @type {number}
 */
let fetchIndex = 0

/**
 * Stores native fetch data.
 * @type {{ [key: string]: StreamedFetchChunk[] }}
 */
let nativeFetchData: { [key: string]: StreamedFetchChunk[] } = {}

/**
 * Interface representing a streamed fetch chunk data.
 * @interface
 */
interface StreamedFetchChunkData {
    type: 'chunk',
    body: string,
    id: string
}

/**
 * Interface representing a streamed fetch header data.
 * @interface
 */
interface StreamedFetchHeaderData {
    type: 'headers',
    body: { [key: string]: string },
    id: string,
    status: number
}

/**
 * Interface representing a streamed fetch end data.
 * @interface
 */
interface StreamedFetchEndData {
    type: 'end',
    id: string
}

/**
 * Type representing a streamed fetch chunk.
 * @typedef {StreamedFetchChunkData | StreamedFetchHeaderData | StreamedFetchEndData} StreamedFetchChunk
 */
type StreamedFetchChunk = StreamedFetchChunkData | StreamedFetchHeaderData | StreamedFetchEndData

/**
 * Interface representing a streamed fetch plugin.
 * @interface
 */
interface StreamedFetchPlugin {
    /**
     * Performs a streamed fetch operation.
     * @param {Object} options - The options for the fetch operation.
     * @param {string} options.id - The ID of the fetch operation.
     * @param {string} options.url - The URL to fetch.
     * @param {string} options.body - The body of the fetch request.
     * @param {{ [key: string]: string }} options.headers - The headers of the fetch request.
     * @returns {Promise<{ error: string, success: boolean }>} - The result of the fetch operation.
     */
    streamedFetch(options: { id: string, url: string, body: string, headers: { [key: string]: string } }): Promise<{ "error": string, "success": boolean }>;

    /**
     * Adds a listener for the specified event.
     * @param {string} eventName - The name of the event.
     * @param {(data: StreamedFetchChunk) => void} listenerFunc - The function to call when the event is triggered.
     */
    addListener(eventName: 'streamed_fetch', listenerFunc: (data: StreamedFetchChunk) => void): void;
}

/**
 * Indicates whether streamed fetch listening is active.
 * @type {boolean}
 */
let streamedFetchListening = false

/**
 * The streamed fetch plugin instance.
 * @type {StreamedFetchPlugin | undefined}
 */
let capStreamedFetch: StreamedFetchPlugin | undefined

if (isTauri) {
    listen('streamed_fetch', (event) => {
        try {
            const parsed = JSON.parse(event.payload as string)
            const id = parsed.id
            nativeFetchData[id]?.push(parsed)
        } catch (error) {
            console.error(error)
        }
    }).then((v) => {
        streamedFetchListening = true
    })
}

/**
 * Pipes the fetch log to a readable stream.
 * @param {number} fetchLogIndex - The index of the fetch log.
 * @param {ReadableStream<Uint8Array>} readableStream - The readable stream to pipe.
 * @returns {ReadableStream<Uint8Array>} - The new readable stream.
 */
const pipeFetchLog = (fetchLogIndex: number, readableStream: ReadableStream<Uint8Array>) => {
    
    const splited = readableStream.tee();
    
    (async () => {
        const text = await (new Response(splited[0])).text()
        fetchLog[fetchLogIndex].response = text
    })()
    
    return splited[1]
}

async function fetchViaProxyJobWs(url: string, arg: {
    body: Uint8Array,
    headers?: { [key: string]: string },
    method: "POST" | "GET" | "PUT" | "DELETE",
    signal?: AbortSignal,
    requestTimeoutMs?: number,
    chatId?: string,
    fetchLogIndex?: number | null
}): Promise<Response> {
    const auth = await getNodeServerProxyAuth();

    const requestSignal = arg.signal;
    const baseUrl = getProxyStreamJobBaseUrl();

    let jobId = '';
    const createRes = await fetch(`${baseUrl}/proxy-stream-jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'risu-auth': auth
        },
        body: JSON.stringify({
            url,
            method: arg.method,
            headers: arg.headers ?? {},
            bodyBase64: Buffer.from(arg.body).toString('base64'),
            timeoutMs: arg.requestTimeoutMs,
            heartbeatSec: defaultProxyJobHeartbeatSec
        }),
        signal: requestSignal
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Proxy stream job creation failed: ${createRes.status} ${errText}`);
    }

    const created = await createRes.json() as { jobId?: string };
    if (!created.jobId) {
        throw new Error('Proxy stream job creation returned no jobId');
    }
    jobId = created.jobId;

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/proxy-stream-jobs/${encodeURIComponent(jobId)}/ws?risu-auth=${encodeURIComponent(auth)}`;

    let headersReady = false;
    let status = 200;
    let responseHeaders: HeadersInit = { 'content-type': 'text/event-stream' };
    let settled = false;
    let resolveHeaders: () => void = () => {};
    const waitHeaders = new Promise<void>((resolve) => {
        resolveHeaders = resolve;
    });
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();

    const ws = new WebSocket(wsUrl);
    const readable = new ReadableStream<Uint8Array>({
        start(controller) {
            streamController = controller;
        },
        cancel() {
            try {
                ws.close();
            } catch {
                // no-op
            }
        }
    });
    const pipedReadable = arg.fetchLogIndex != null ? pipeFetchLog(arg.fetchLogIndex, readable) : readable;

    const ensureHeadersReady = () => {
        if (!headersReady) {
            headersReady = true;
            resolveHeaders();
        }
    };

    const closeAndEnd = () => {
        if (settled) {
            return;
        }
        settled = true;
        if (streamController) {
            try {
                streamController.close();
            } catch {
                // no-op
            }
        }
        try {
            ws.close();
        } catch {
            // no-op
        }
    };

    ws.onmessage = (event) => {
        const parsed = parseProxyJobWsEvent(typeof event.data === 'string' ? event.data : '');
        if (!parsed || !streamController) {
            return;
        }
        switch (parsed.type) {
            case 'job_accepted':
            case 'ping':
                return;
            case 'upstream_headers':
                status = parsed.status;
                responseHeaders = parsed.headers ?? {};
                ensureHeadersReady();
                return;
            case 'chunk':
                ensureHeadersReady();
                streamController.enqueue(decodeProxyJobWsChunk(parsed.dataBase64));
                return;
            case 'error': {
                status = parsed.status ?? 502;
                responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
                ensureHeadersReady();
                const msg = formatProxyStreamErrorMessage(parsed.status, parsed.message);
                streamController.enqueue(encoder.encode(msg));
                closeAndEnd();
                return;
            }
            case 'done':
                ensureHeadersReady();
                closeAndEnd();
                return;
        }
    };

    ws.onerror = () => {
        if (!streamController) {
            return;
        }
        status = 502;
        responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
        ensureHeadersReady();
        streamController.enqueue(encoder.encode('Proxy WebSocket stream error'));
        closeAndEnd();
    };

    ws.onclose = () => {
        if (!headersReady) {
            status = 502;
            responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
            ensureHeadersReady();
        }
        closeAndEnd();
    };

    const abortHandler = () => {
        status = 499;
        responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
        ensureHeadersReady();
        if (streamController && !settled) {
            streamController.enqueue(encoder.encode('Aborted'));
        }
        void fetch(`${baseUrl}/proxy-stream-jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            headers: {
                'risu-auth': auth
            }
        }).catch(() => {});
        closeAndEnd();
    };
    if (requestSignal?.aborted) {
        abortHandler();
    }
    else {
        requestSignal?.addEventListener('abort', abortHandler, { once: true });
    }

    await waitHeaders;
    requestSignal?.removeEventListener('abort', abortHandler);
    return new Response(pipedReadable, {
        status,
        headers: new Headers(responseHeaders)
    });
}

/**
 * Fetches data from a given URL using native fetch or through a proxy.
 * @param {string} url - The URL to fetch data from.
 * @param {Object} arg - The arguments for the fetch request.
 * @param {string} arg.body - The body of the request.
 * @param {Object} [arg.headers] - The headers of the request.
 * @param {string} [arg.method="POST"] - The HTTP method of the request.
 * @param {AbortSignal} [arg.signal] - The signal to abort the request.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the response body, headers, and status.
 * @returns {ReadableStream<Uint8Array>} body - The response body as a readable stream.
 * @returns {Headers} headers - The response headers.
 * @returns {number} status - The response status code.
 * @throws {Error} - Throws an error if the request is aborted or if there is an error in the response.
 */
export async function fetchNative(url: string, arg: {
    body?: string | Uint8Array | ArrayBuffer,
    headers?: { [key: string]: string },
    method?: "POST" | "GET" | "PUT" | "DELETE",
    signal?: AbortSignal,
    chatId?: string
    interceptor?: string
    logFetch?: boolean
    requestTimeoutMs?: number
    networkRoute?: 'auto' | 'local_network'
}): Promise<Response> {

    const useInterceptor = !!arg.interceptor
    console.log(arg.body, 'body')
    if (arg.body === undefined && (arg.method === 'POST' || arg.method === 'PUT')) {
        throw new Error('Body is required for POST and PUT requests')
    }

    arg.method = arg.method ?? 'POST'

    let headers = arg.headers ?? {}
    let realBody: Uint8Array

    if (arg.method === 'GET' || arg.method === 'DELETE') {
        realBody = undefined
    }
    else if (typeof arg.body === 'string') {
        let body: string = arg.body
        if(useInterceptor) {
            for (const interceptor of bodyIntercepterStore) {
                try {
                    body = await interceptor.callback(body, arg.interceptor) || body
                }
                catch (e) {
                    console.error(e)
                }
            }
        }
        realBody = new TextEncoder().encode(body)
    }
    else if (arg.body instanceof Uint8Array) {
        realBody = arg.body
    }
    else if (arg.body instanceof ArrayBuffer) {
        realBody = new Uint8Array(arg.body)
    }
    else {
        throw new Error('Invalid body type')
    }

    const db = getDatabase()
    const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
    if (useLocalNetworkRoute && !isTauri && !isNodeServer) {
        throw new Error(webLocalNetworkBlockedMessage)
    }
    let throughProxy = (!isTauri) && (!isNodeServer) && (!db.usePlainFetch)
    if (useLocalNetworkRoute) {
        if (isNodeServer) {
            throughProxy = true
        }
        else if (isTauri) {
            throughProxy = false
        }
    }
    const timeoutSignal = buildTimeoutSignal(arg.signal, arg.requestTimeoutMs)
    const requestSignal = timeoutSignal.signal
    const shouldLogFetch = arg.logFetch ?? true
    let fetchLogIndex: number | null = null
    if (shouldLogFetch) {
        fetchLogIndex = addFetchLog({
            body: new TextDecoder().decode(realBody),
            headers: arg.headers,
            response: 'Streamed Fetch',
            success: true,
            url: url,
            resType: 'stream',
            chatId: arg.chatId,
        })
    }
    try {
        if (window.userScriptFetch && !throughProxy) {
            return await window.userScriptFetch(url, {
            body: realBody as any,
            headers: headers,
            method: arg.method,
            signal: requestSignal
        })
        }
        else if (isTauri) {
        fetchIndex++
        if (requestSignal && requestSignal.aborted) {
            throw new Error('aborted')
        }
        if (fetchIndex >= 100000) {
            fetchIndex = 0
        }
        let fetchId = fetchIndex.toString().padStart(5, '0')
        nativeFetchData[fetchId] = []
        let resolved = false

        let error = ''
        while (!streamedFetchListening) {
            await sleep(100)
        }
        if (isTauri) {
            invoke('streamed_fetch', {
                id: fetchId,
                url: url,
                headers: JSON.stringify(headers),
                body: realBody ? Buffer.from(realBody).toString('base64') : '',
                method: arg.method,
                timeout_secs: arg.requestTimeoutMs ? Math.max(1, Math.ceil(arg.requestTimeoutMs / 1000)) : undefined
            }).then((res) => {
                try {
                    const parsedRes = JSON.parse(res as string)
                    if (!parsedRes.success) {
                        error = parsedRes.body
                        resolved = true
                    }
                } catch (e) {
                    // Error properties (message/name/stack) are non-enumerable, so
                    // JSON.stringify(e) returns "{}" and discards the real cause.
                    error = e instanceof Error
                        ? (e.message || e.name || 'streamed_fetch parse failed')
                        : String(e)
                    resolved = true
                }
            })
        }
        else if (capStreamedFetch) {
            capStreamedFetch.streamedFetch({
                id: fetchId,
                url: url,
                headers: headers,
                body: realBody ? Buffer.from(realBody).toString('base64') : '',
            }).then((res) => {
                if (!res.success) {
                    error = res.error
                    resolved = true
                }
            })
        }

        let resHeaders: { [key: string]: string } = null
        let status = 400

        const tauriReadableStream = new ReadableStream<Uint8Array>({
            async start(controller) {
                while (!resolved || nativeFetchData[fetchId].length > 0) {
                    if (nativeFetchData[fetchId].length > 0) {
                        const data = nativeFetchData[fetchId].shift()
                        if (data.type === 'chunk') {
                            const chunk = Buffer.from(data.body, 'base64')
                            controller.enqueue(chunk as unknown as Uint8Array)
                        }
                        if (data.type === 'headers') {
                            resHeaders = data.body
                            status = data.status
                        }
                        if (data.type === 'end') {
                            resolved = true
                        }
                    }
                    await sleep(10)
                }
                controller.close()
            }
        })

        let readableStream = tauriReadableStream
        if (shouldLogFetch && fetchLogIndex !== null) {
            readableStream = pipeFetchLog(fetchLogIndex, tauriReadableStream)
        }

        while (resHeaders === null && !resolved) {
            await sleep(10)
        }

        if (resHeaders === null) {
            resHeaders = {}
        }

        if (error !== '') {
            throw new Error(error)
        }

        return new Response(readableStream, {
            headers: new Headers(resHeaders),
            status: status
        })


    }
    else if (throughProxy) {
        const useProxyJobWs = isNodeServer
            && arg.interceptor === 'openai_streaming'
            && arg.method === 'POST'
            && useLocalNetworkRoute;
        const nodeProxyAuth = isNodeServer ? await getNodeServerProxyAuth() : null;

        if (useProxyJobWs) {
            try {
                return await fetchViaProxyJobWs(url, {
                    body: realBody,
                    headers,
                    method: arg.method,
                    signal: requestSignal,
                    requestTimeoutMs: arg.requestTimeoutMs,
                    chatId: arg.chatId,
                    fetchLogIndex
                });
            } catch (wsErr) {
                console.warn('[ProxyJobWS] fallback to /proxy2 due to error:', wsErr);
            }
        }

        const r = await fetch(getProxy2Url(), {
            body: realBody as any,
            headers: {
                "risu-header": encodeURIComponent(JSON.stringify(headers)),
                "risu-url": encodeURIComponent(url),
                "Content-Type": "application/json",
                ...(arg.requestTimeoutMs && { "risu-timeout-ms": Math.max(1, Math.floor(arg.requestTimeoutMs)).toString() }),
                ...(nodeProxyAuth ? { "risu-auth": nodeProxyAuth } : {}),
                ...(DBState?.db?.requestLocation && { "risu-location": DBState.db.requestLocation }),
            },
            method: arg.method,
            signal: requestSignal
        })

        return new Response(r.body, {
            headers: r.headers,
            status: r.status
        })
    }
    else {
        return await fetch(url, {
            body: realBody as any,
            headers: headers,
            method: arg.method,
            signal: requestSignal,
        })
    }
    } finally {
        timeoutSignal.cleanup()
    }
}

/**
 * Converts a ReadableStream of Uint8Array to a text string.
 * 
 * @param {ReadableStream<Uint8Array>} stream - The readable stream to convert.
 * @returns {Promise<string>} A promise that resolves to the text content of the stream.
 */
export function textifyReadableStream(stream: ReadableStream<Uint8Array>) {
    return new Response(stream).text()
}

/**
 * Toggles the fullscreen mode of the document.
 * If the document is currently in fullscreen mode, it exits fullscreen.
 * If the document is not in fullscreen mode, it requests fullscreen with navigation UI hidden.
 */
export function toggleFullscreen() {
    const fullscreenElement = document.fullscreenElement
    fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({
        navigationUI: "hide"
    })
}

/**
 * Removes non-Latin characters from a string, replaces multiple spaces with a single space, and trims the string.
 * 
 * @param {string} data - The input string to be processed.
 * @returns {string} The processed string with non-Latin characters removed, multiple spaces replaced by a single space, and trimmed.
 */
export function trimNonLatin(data: string) {
    return data.replace(/[^\x00-\x7F]/g, "")
        .replace(/ +/g, ' ')
        .trim()
}

/**
 * A class that provides a blank writer implementation.
 * 
 * This class is used to provide a no-op implementation of a writer, making it compatible with other writer interfaces.
 */
export class BlankWriter {
    constructor() {
    }

    /**
     * Initializes the writer.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     */
    async init() {
        //do nothing, just to make compatible with other writer
    }

    /**
     * Writes data to the writer.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     * 
     * @param {string} key - The key associated with the data.
     * @param {Uint8Array|string} data - The data to be written.
     */
    async write(key: string, data: Uint8Array | string) {
        //do nothing, just to make compatible with other writer
    }

    /**
     * Ends the writing process.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     */
    async end() {
        //do nothing, just to make compatible with other writer
    }
}

/**
 * A debugging class for performance measurement.
*/

export class PerformanceDebugger {
    kv: { [key: string]: number[] } = {}
    startTime: number
    endTime: number

    /**
     * Starts the timing measurement.
    */
    start() {
        this.startTime = performance.now()
    }

    /**
     * Ends the timing measurement and records the time difference.
     * 
     * @param {string} key - The key to associate with the recorded time.
    */
    endAndRecord(key: string) {
        this.endTime = performance.now()
        if (!this.kv[key]) {
            this.kv[key] = []
        }
        this.kv[key].push(this.endTime - this.startTime)
    }

    /**
     * Ends the timing measurement, records the time difference, and starts a new timing measurement.
     * 
     * @param {string} key - The key to associate with the recorded time.
    */
    endAndRecordAndStart(key: string) {
        this.endAndRecord(key)
        this.start()
    }

    /**
     * Logs the average time for each key to the console.
    */
    log() {
        let table: { [key: string]: number } = {}

        for (const key in this.kv) {
            table[key] = this.kv[key].reduce((a, b) => a + b, 0) / this.kv[key].length
        }


        console.table(table)
    }

    combine(other: PerformanceDebugger) {
        for (const key in other.kv) {
            if (!this.kv[key]) {
                this.kv[key] = []
            }
            this.kv[key].push(...other.kv[key])
        }
    }
}

export function getLanguageCodes() {
    let languageCodes: {
        code: string
        name: string
    }[] = []

    for (let i = 0x41; i <= 0x5A; i++) {
        for (let j = 0x41; j <= 0x5A; j++) {
            languageCodes.push({
                code: String.fromCharCode(i) + String.fromCharCode(j),
                name: ''
            })
        }
    }

    languageCodes = languageCodes.map(v => {
        return {
            code: v.code.toLocaleLowerCase(),
            name: new Intl.DisplayNames([
                DBState.db.language === 'cn' ? 'zh' : DBState.db.language
            ], {
                type: 'language',
                fallback: 'none'
            }).of(v.code)
        }
    }).filter((a) => {
        return a.name
    }).sort((a, b) => a.name.localeCompare(b.name))

    return languageCodes
}

export function getVersionString(): string {
    let versionString = appVer
    if(appSubVer) {
        versionString += '-' + appSubVer
    }
    if (import.meta.env.VITE_RISU_NIGHTLY_BUILD === 'TRUE') {
        versionString = 'Nightly Build ' + import.meta.env.VITE_RISU_BUILD_TIME
    }
    return versionString
}

export function toGetter<T extends object>(
    getterFn: () => T,
    args?: {
        //blocks this.children from being accessed
        restrictChildren:string[]
    }
): T {

    const dummyTarget = () => { };

    return new Proxy(dummyTarget, {
        get(target, prop, receiver) {

            const realInstance = getterFn();
            
            if (args?.restrictChildren && args.restrictChildren.includes(prop as string)) {
                throw new Error(`Access to property '${String(prop)}' is restricted`);
            }

            if (realInstance === null || realInstance === undefined) {
                return (realInstance as any)[prop];
            }

            const value = Reflect.get(realInstance as object, prop);

            if (typeof value === 'function') {
                return value.bind(realInstance);
            }

            return value;
        },

        set(target, prop, value, receiver) {

            if(args?.restrictChildren && args.restrictChildren.includes(prop as string)) {
                throw new Error(`Access to property '${String(prop)}' is restricted`);
            }
            const realInstance = getterFn();
            return Reflect.set(realInstance as object, prop, value, receiver);
        },

        has(target, prop) {
            const realInstance = getterFn();
            return Reflect.has(realInstance as object, prop);
        },

        ownKeys(target) {
            const realInstance = getterFn();
            return Reflect.ownKeys(realInstance as object);
        },

        construct(target, argArray, newTarget) {
            const realInstance = getterFn() as any;
            return new realInstance(...argArray);
        },

        deleteProperty(target, prop) {
            const realInstance = getterFn();
            return Reflect.deleteProperty(realInstance as object, prop);
        },

        getPrototypeOf() {
            const realInstance = getterFn();
            return Reflect.getPrototypeOf(realInstance as object);
        }
    }) as unknown as T;
}

const countriesWithAiLaw = new Set<string>([

    // EU
    // AI Act
    // https://artificialintelligenceact.eu/
    
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "EL",
    "GR",
    "HU",
    "IE",
    "IT",
    "LV",
    "LT",
    "LU",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",

    //China 
    //Measures for Labeling of AI-Generated Synthetic Content
    // 关于印发《人工智能生成合成内容标识办法》的通知 
    // https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
    "CN",

    //Although CN Law doesn't apply, just in case
    "HK",
    "MO",

    //TW isn't under mainland china jurisdiction
    //de facto, de jure in TW law, unlike HK and MO,
    //So we don't include it for now
    //"TW", 

    // Republic of Korea
    // AI Basic Act
    // 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법
    // https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5%20%EB%B0%9C%EC%A0%84%EA%B3%BC%20%EC%8B%A0%EB%A2%B0%20%EA%B8%B0%EB%B0%98%20%EC%A1%B0%EC%84%B1%20%EB%93%B1%EC%97%90%20%EA%B4%80%ED%95%9C%20%EA%B8%B0%EB%B3%B8%EB%B2%95/(20676,20250121)
    "KR",

    // Vietnam
    // Digital Tech Law
    // Luật Công nghệ số
    "VN",

])

export function aiLawApplies(): boolean {

    //TODO: implement actual logic
    //lets now assume it always applies
    //so we don't have legal issues later

    return true
}

export function aiWatermarkingLawApplies(): boolean {

    //TODO: implement actual logic
    //lets now assume it is false for now,
    //becuase very few countries have it for now
    return false
}

export const chatFoldedState = $state<{
    data: null| {
        targetCharacterId: string,
        targetChatId: string,
        targetMessageId: string,
    }
}>({
    data: null
})

//Since its exported, we cannot use $derived here
export let chatFoldedStateMessageIndex = $state({
    index: -1
})

$effect.root(() => {
    $effect(() => {
        if(!chatFoldedState.data){
            return
        }
        const char = DBState.db.characters[selIdState.selId]
        const chat = char.chats[char.chatPage]
        if(chatFoldedState.data.targetCharacterId !== char.chaId){
            chatFoldedState.data = null
        }
        if(chatFoldedState.data.targetChatId !== chat.id){
            chatFoldedState.data = null
        }
    })

    $effect(() => {
        if(chatFoldedState.data === null){
            chatFoldedStateMessageIndex.index = -1
            return
        }
        const char = DBState.db.characters[selIdState.selId]
        const chat = char.chats[char.chatPage]
        const messageIndex = chat.message.findIndex((v) => {
            return chatFoldedState.data?.targetMessageId === v.chatId
        })
        if(messageIndex === -1){
            console.warn('Target message for folding id' + chatFoldedState.data?.targetMessageId + ' not found')
            chatFoldedStateMessageIndex.index = -1
            return
        }
        chatFoldedStateMessageIndex.index = messageIndex
    })
})

export function foldChatToMessage(targetMessageIdOrIndex: string | number) {
    let targetMessageId = ''
    if (typeof targetMessageIdOrIndex === 'number') {
        const char = getCurrentCharacter()
        const chat = char.chats[char.chatPage]
        const message = chat.message[targetMessageIdOrIndex]
        targetMessageId = message.chatId
    }
    else{
        targetMessageId = targetMessageIdOrIndex
    }
    const char = getCurrentCharacter()
    const chat = char.chats[char.chatPage]
    chatFoldedState.data = {
        targetCharacterId: char.chaId,
        targetChatId: chat.id,
        targetMessageId: targetMessageId,
    }
}

export function changeChatTo(IdOrIndex: string | number) {
    let index = -1
    if (typeof IdOrIndex === 'number') {
        index = IdOrIndex
    }

    if (typeof IdOrIndex === 'string') {
        const currentCharacter = getCurrentCharacter()
        index = currentCharacter.chats.findIndex((v) => {
            return v.id === IdOrIndex
        })
    }

    if(index === -1){
        return
    }

    DBState.db.characters[selIdState.selId].chatPage = index
    // Flush before bumping so the bump fans its reparse out over the new
    // (usually much smaller) window instead of the outgoing one. This flush
    // only guarantees that a write the flush itself must
    // observe has already landed if it happened before this call; that is
    // why `reorderChatsKeepingCurrent` assigns `chara.chats` before calling
    // this function, not after. Writes that instead depend on the switch
    // having happened belong after this call, as they always did: e.g.
    // `foldChatToMessage(...)` must run after `changeChatTo(...)` at the
    // branch-link button, not before, or it would read the outgoing chat's
    // id and the fold would silently never happen.
    // `changeChatTo` is a shared helper with 17 call sites, and this
    // `flushSync()` is a global drain of all pending Svelte work, not just
    // this chat window. No current caller reaches it from inside an effect
    // or another flush -- that is what makes it safe today, and a future
    // caller must not break that property without rechecking that the flush
    // is still safe there.
    flushSync()
    ReloadGUIPointer.set(Math.random())
}

/**
 * Resolves where the currently-open chat ends up after a reorder. Returns
 * the index of the SAME chat object (by identity) in `newChats`, not
 * `currentPage` re-read against `newChats` -- the page index means a
 * different chat once the array has been permuted, but the object identity
 * survives the reorder and is what must be looked up. Returns -1 when the
 * chat is no longer present. That is not handled specially: `changeChatTo`'s
 * existing early return skips writing `chatPage`, so the user is left on
 * whatever chat now occupies the stale page index.
 */
export function resolveReorderedChatIndex(oldChats: Chat[], newChats: Chat[], currentPage: number): number {
    return newChats.indexOf(oldChats[currentPage])
}

/**
 * Reorders a character or group chat's chats while keeping the user on the
 * same chat, then switches to it. The order of the three steps is the entire
 * point: `chara.chats` must already be the reordered array before
 * `changeChatTo` runs, because `changeChatTo` flushes synchronously, and the
 * target index is only meaningful against the new array.
 */
export function reorderChatsKeepingCurrent(chara: character | groupChat, newChats: Chat[], currentPage: number): void {
    const target = resolveReorderedChatIndex(chara.chats, newChats, currentPage)
    chara.chats = newChats
    changeChatTo(target)
}

export function createChatCopyName(originalName: string,type:'Copy'|'Branch'): string {
    let name = originalName.replaceAll(/\(((Copy|Branch)( \d+)?)\)$/g, '').trim()
    let copyIndex = 1
    let newName = `${name} (${type})`
    const char = getCurrentCharacter()
    while (char.chats.find((v) => v.name === newName)) {
        copyIndex++
        newName = `${name} (${type} ${copyIndex})`
    }
    return newName
}
