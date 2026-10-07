import { getAppStore, pageStoreIsIndexedDb, pageStoreIsOpfsTransitional } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { getPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { isAppInitiatedReload } from 'src/ts/reloadGuard'
import { busyKinds } from '../memory/busyActions'
import { inlayMetaKey } from './inlayKeys'
import { dropInlayRender } from './inlayRenderCache'
import {
    hasAppInlay,
    inFlight,
    inlayAttachmentLimit,
    inlayBodyOf,
    InlayUnreadableError,
    isListedAppInlay,
    legacyInlayStore,
    listAppInlayKeys,
    readAppInlayRecord,
    withInlayLock,
    writeAppInlay,
    type InlayAsset,
    type InlayRecord,
} from './inlayStore'

/**
 * Copies the inlays of the old `inlay` LocalForage database into the app store,
 * in the background, once per browser.
 *
 * - The copy never changes or removes an old entry (the cleanup pass further
 *   down is what removes verified ones). Within one page a copy does
 *   not replace an inlay the app store already holds; two browsers sharing a Node
 *   server can both write one id, which only content-addressed ids reach and
 *   those carry the same content.
 * - An entry that cannot be copied for good is residue: it stays in the old
 *   store, readable and listed, and the copy still completes. That covers an id
 *   without a key, a value larger than `inlayAttachmentLimit()` (decided from
 *   its size before the body is read or stored, on every platform), a value
 *   that is neither a Blob nor a string, and a value that cannot be read from the
 *   old store or whose body cannot be read.
 *   Only a failure of the app store write leaves the copy unfinished for the
 *   next start, and repeated write failures end this start's copy; a quota
 *   failure or too little free space ends it at once.
 * - Completion is recorded with the residual ids; a recorded start lists and
 *   reads nothing.
 */

const DONE_KEY = 'inlayCopyDone'
const LOCK_NAME = 'risu-inlay-copy'
const MIB = 1024 * 1024
const MIN_HEADROOM_BYTES = 64 * MIB
const HEADROOM_FRACTION = 0.1
const MAX_CONSECUTIVE_FAILURES = 3

export interface InlayCopyEnvironment {
    /** Where the completion record is kept; `null` when there is no storage. */
    flags: Pick<Storage, 'getItem' | 'setItem'> | null
    /** The browser's storage estimate; `undefined` when it has none. */
    estimate: () => Promise<{ quota?: number, usage?: number } | undefined>
    /** Runs `work` unless another tab of this browser is copying; resolves `false` then. */
    withTabLock: (work: () => Promise<void>) => Promise<boolean>
}

export type InlayCopyOutcome =
    /** A recorded completion: nothing was listed. */
    | 'settled'
    /** The page is read-only, or the app store or the old store could not be used. */
    | 'not-run'
    /** Another tab is copying. */
    | 'busy'
    /** This start's copy ended early: a quota failure, too little room, or repeated write failures. */
    | 'stopped'
    /** Every entry is copied or residue, and completion is recorded. */
    | 'done'
    /** Some entry could not be written; the next start tries again. */
    | 'incomplete'

export function browserEnvironment(): InlayCopyEnvironment {
    return {
        flags: typeof localStorage === 'undefined' ? null : localStorage,
        estimate: async () => navigator.storage?.estimate?.(),
        withTabLock: async (work) => {
            const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
            if (!locks) {
                await work()
                return true
            }
            return await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
                if (lock === null) {
                    return false
                }
                await work()
                return true
            })
        },
    }
}

export function isQuotaError(error: unknown): boolean {
    if (error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)) {
        return error.name === 'QuotaExceededError' || /quota/i.test(error.message)
    }
    return false
}

function recordedDone(flags: InlayCopyEnvironment['flags']): boolean {
    try {
        const text = flags?.getItem(DONE_KEY) ?? null
        if (text === null) {
            return false
        }
        const record = JSON.parse(text) as { v?: number } | null
        return record !== null && record.v === 1
    } catch {
        return false
    }
}

function valueSize(value: InlayAsset): number | null {
    if (value.data instanceof Blob) {
        return value.data.size
    }
    // An upper bound on the UTF-8 bytes of the string.
    return typeof value.data === 'string' ? value.data.length * 3 : null
}

export async function hasRoom(env: InlayCopyEnvironment, size: number): Promise<boolean> {
    const estimate = await env.estimate()
    if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') {
        return true
    }
    const headroom = Math.max(MIN_HEADROOM_BYTES, estimate.quota * HEADROOM_FRACTION)
    return estimate.quota - estimate.usage - size >= headroom
}

type EntryOutcome = 'copied' | 'skipped' | 'residue' | 'failed' | 'no-room' | 'quota'

/** The ids this page copied into the app store; the cleanup pass leaves their old entries to a later start. */
const copiedThisPage = new Set<string>()

export function resetInlayCopyForTests(): void {
    copiedThisPage.clear()
}

async function copyEntry(store: ByteStore, id: string, checkRoom: ((size: number) => Promise<boolean>) | null): Promise<EntryOutcome> {
    return await withInlayLock(id, () => copyEntryLocked(store, id, checkRoom))
}

/** `copyEntry` for a caller that already holds `withInlayLock(id)`. */
async function copyEntryLocked(store: ByteStore, id: string, checkRoom: ((size: number) => Promise<boolean>) | null): Promise<EntryOutcome> {
    let value: InlayAsset | null | undefined
    try {
        value = await legacyInlayStore.getItem<InlayAsset | null>(id)
    } catch (error) {
        console.warn('An inlay could not be read from the old store and stays there:', error)
        return 'residue'
    }
    if (value === null || value === undefined) {
        return 'skipped'
    }
    if (inlayMetaKey(id) === null) {
        return 'residue'
    }
    const size = valueSize(value)
    if (size === null || size > inlayAttachmentLimit()) {
        return 'residue'
    }
    if (await hasAppInlay(store, id)) {
        return 'skipped'
    }
    if (checkRoom !== null && !(await checkRoom(size))) {
        return 'no-room'
    }
    try {
        // The old entry stays, so an object URL already rendered from it stays valid; the next render reads the app store record.
        await writeAppInlay(store, id, value, { revokeRendered: false })
    } catch (error) {
        if (error instanceof InlayUnreadableError) {
            console.warn('An inlay could not be read for copying and stays in the old store:', error)
            return 'residue'
        }
        if (isQuotaError(error)) {
            return 'quota'
        }
        console.warn('An inlay could not be copied:', error)
        return 'failed'
    }
    copiedThisPage.add(id)
    return 'copied'
}

/** Never rejects. */
export async function runInlayCopy(env: InlayCopyEnvironment = browserEnvironment()): Promise<InlayCopyOutcome> {
    try {
        if (recordedDone(env.flags)) {
            return 'settled'
        }
        const store = await getAppStore()
        if (await pageStoreIsOpfsTransitional()) {
            return 'not-run'
        }
        let outcome: InlayCopyOutcome = 'not-run'
        const ran = await env.withTabLock(async () => {
            outcome = await copyAll(store, env)
        })
        return ran ? outcome : 'busy'
    } catch (error) {
        console.warn('The inlay copy could not run:', error)
        return 'not-run'
    }
}

async function copyAll(store: ByteStore, env: InlayCopyEnvironment): Promise<InlayCopyOutcome> {
    let ids: string[]
    try {
        ids = await legacyInlayStore.keys()
    } catch (error) {
        console.warn('The old inlay store could not be listed:', error)
        return 'not-run'
    }
    const webStore = await pageStoreIsIndexedDb()
    const checkRoom = webStore ? (size: number) => hasRoom(env, size) : null
    const { keys: listed } = await listAppInlayKeys(store)
    const residual: string[] = []
    let incomplete = false
    let consecutiveFailures = 0
    for (const id of ids) {
        const metaKey = inlayMetaKey(id)
        if (metaKey !== null && listed.has(metaKey) && await isListedAppInlay(store, id, listed)) {
            continue
        }
        let result: EntryOutcome
        try {
            result = await copyEntry(store, id, checkRoom)
        } catch (error) {
            console.warn('An inlay could not be copied:', error)
            result = 'failed'
        }
        if (result === 'quota' || result === 'no-room') {
            return 'stopped'
        }
        if (result === 'residue') {
            residual.push(id)
        }
        if (result === 'failed') {
            incomplete = true
            consecutiveFailures++
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                return 'stopped'
            }
        } else {
            consecutiveFailures = 0
        }
    }
    if (incomplete) {
        return 'incomplete'
    }
    try {
        env.flags?.setItem(DONE_KEY, JSON.stringify({ v: 1, residual }))
    } catch (error) {
        console.warn('The inlay copy could not record its completion:', error)
    }
    return 'done'
}

/*
 * The cleanup pass: removes entries of the old store whose copy in the app
 * store is verified, in the background, on a start that did not itself copy
 * them.
 *
 * - An entry is removed only when the app store holds a record for the id, the
 *   record's body can be read, its actual length equals the record's length, and
 *   that length is the old value's own (the Blob's size, or the encoded length of
 *   the string). An old-only entry that can be copied is copied, never replacing
 *   anything, and left for a later start to remove, so no entry is removed on the
 *   page that copied it.
 * - Everything else stays and is recorded with its reason, so a start whose
 *   old store holds only recorded keys lists the keys and reads nothing.
 * - The pass stops for the start while a backup is saved or loaded (a backup
 *   lists the old store before the app store, and an id leaves the old store only
 *   once the app store holds it), when the page is about to reload, and on a quota
 *   or repeated write failure. It never makes a chat save fail.
 */

const UNRESOLVED_KEY = 'inlayOldStoreUnresolved'

export type InlayCleanupOutcome =
    /** Every old key is recorded or was copied by this page: nothing was read. */
    | 'settled'
    /** The page is read-only, or a store could not be used. */
    | 'not-run'
    /** Another tab is copying or cleaning. */
    | 'busy'
    /** A backup, a reload, a quota failure or repeated failures ended this start's pass. */
    | 'stopped'
    /** Every unrecorded old entry was removed, copied or recorded. */
    | 'done'

type CleanupStep =
    | { kind: 'deleted' | 'copied' | 'skipped' }
    | { kind: 'unresolved', reason: string }
    | { kind: 'stop' }
    | { kind: 'failed' }

function readUnresolved(flags: InlayCopyEnvironment['flags']): Map<string, string> {
    const found = new Map<string, string>()
    try {
        const text = flags?.getItem(UNRESOLVED_KEY) ?? null
        if (text !== null) {
            const record = JSON.parse(text) as { v?: number, ids?: Record<string, string> } | null
            if (record !== null && record.v === 1 && record.ids !== null && typeof record.ids === 'object') {
                for (const [id, reason] of Object.entries(record.ids)) {
                    found.set(id, String(reason))
                }
            }
        }
        const done = flags?.getItem(DONE_KEY) ?? null
        if (done !== null) {
            const marker = JSON.parse(done) as { v?: number, residual?: unknown } | null
            if (marker !== null && marker.v === 1 && Array.isArray(marker.residual)) {
                for (const id of marker.residual) {
                    if (typeof id === 'string' && !found.has(id)) {
                        found.set(id, 'residue')
                    }
                }
            }
        }
    } catch {
        // A record that cannot be read is treated as empty: its entries are examined again.
    }
    return found
}

function writeUnresolved(flags: InlayCopyEnvironment['flags'], unresolved: ReadonlyMap<string, string>): void {
    try {
        flags?.setItem(UNRESOLVED_KEY, JSON.stringify({ v: 1, ids: Object.fromEntries(unresolved) }))
    } catch (error) {
        console.warn('The inlay cleanup could not record its progress:', error)
    }
}

function backupOrReloadInProgress(): boolean {
    const kinds = busyKinds()
    return kinds.includes('backupSave') || kinds.includes('backupLoad') || isAppInitiatedReload()
}

/** The length of the body a record names, read from the store; `null` when the body is absent. */
async function storedBodyLength(store: ByteStore, record: InlayRecord): Promise<number | null> {
    const blob = await store.readBlob?.(record.body) ?? null
    if (blob !== null) {
        // A Blob handle's size comes from metadata; its first and last byte are read to prove the body is there.
        if (blob.size > 0) {
            await blob.slice(0, 1).arrayBuffer()
            await blob.slice(blob.size - 1).arrayBuffer()
        }
        return blob.size
    }
    const bytes = (await store.read(record.body)).bytes
    return bytes === null ? null : bytes.length
}

async function oldValueLength(value: InlayAsset): Promise<number | null> {
    if (value.data instanceof Blob) {
        return value.data.size
    }
    return (await inlayBodyOf(value.data))?.bytes.length ?? null
}

async function cleanEntryLocked(store: ByteStore, id: string, checkRoom: ((size: number) => Promise<boolean>) | null): Promise<CleanupStep> {
    if (copiedThisPage.has(id)) {
        return { kind: 'skipped' }
    }
    if (backupOrReloadInProgress()) {
        return { kind: 'stop' }
    }
    let value: InlayAsset | null | undefined
    try {
        value = await legacyInlayStore.getItem<InlayAsset | null>(id)
    } catch (error) {
        console.warn('An inlay could not be read from the old store and stays there:', error)
        return { kind: 'unresolved', reason: 'unreadable' }
    }
    if (value === null || value === undefined) {
        return { kind: 'skipped' }
    }
    if (inlayMetaKey(id) === null) {
        return { kind: 'unresolved', reason: 'unmappable' }
    }
    let record: InlayRecord | null
    try {
        record = await readAppInlayRecord(store, id)
    } catch (error) {
        console.warn('An inlay could not be looked up in the app store:', error)
        return { kind: 'failed' }
    }
    if (record === null) {
        const outcome = await copyEntryLocked(store, id, checkRoom)
        if (outcome === 'copied') {
            return { kind: 'copied' }
        }
        if (outcome === 'residue') {
            return { kind: 'unresolved', reason: 'residue' }
        }
        if (outcome === 'skipped') {
            return { kind: 'skipped' }
        }
        return outcome === 'failed' ? { kind: 'failed' } : { kind: 'stop' }
    }
    let bodyLength: number | null
    try {
        bodyLength = await storedBodyLength(store, record)
    } catch (error) {
        console.warn('The app store copy of an inlay could not be read, so its old entry stays:', error)
        return { kind: 'unresolved', reason: 'unreadable-copy' }
    }
    if (bodyLength === null || bodyLength !== record.len || bodyLength !== await oldValueLength(value)) {
        return { kind: 'unresolved', reason: 'length-mismatch' }
    }
    try {
        await inFlight(async () => { await legacyInlayStore.removeItem(id) })
    } catch (error) {
        console.warn('An old inlay entry could not be removed:', error)
        return { kind: 'failed' }
    }
    // The render is dropped without revoking its URL, so media already shown from the old entry keeps playing.
    dropInlayRender(id, false)
    return { kind: 'deleted' }
}

async function cleanOldStore(store: ByteStore, env: InlayCopyEnvironment): Promise<InlayCleanupOutcome> {
    let ids: string[]
    try {
        ids = await legacyInlayStore.keys()
    } catch (error) {
        console.warn('The old inlay store could not be listed:', error)
        return 'not-run'
    }
    const unresolved = readUnresolved(env.flags)
    // A recorded id that is absent from the old store is forgotten, so a later inlay with that id is examined.
    const listed = new Set(ids)
    let recorded = false
    for (const id of [...unresolved.keys()]) {
        if (!listed.has(id)) {
            unresolved.delete(id)
            recorded = true
        }
    }
    const candidates = ids.filter((id) => !unresolved.has(id) && !copiedThisPage.has(id))
    if (candidates.length === 0) {
        if (recorded) {
            writeUnresolved(env.flags, unresolved)
        }
        return 'settled'
    }
    const checkRoom = (await pageStoreIsIndexedDb()) ? (size: number) => hasRoom(env, size) : null
    let consecutiveFailures = 0
    try {
        for (const id of candidates) {
            if (backupOrReloadInProgress()) {
                return 'stopped'
            }
            let step: CleanupStep
            try {
                step = await withInlayLock(id, () => cleanEntryLocked(store, id, checkRoom))
            } catch (error) {
                console.warn('An old inlay entry could not be cleaned up:', error)
                step = { kind: 'failed' }
            }
            if (step.kind === 'stop') {
                return 'stopped'
            }
            if (step.kind === 'unresolved') {
                unresolved.set(id, step.reason)
                recorded = true
            }
            if (step.kind === 'failed') {
                consecutiveFailures++
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    return 'stopped'
                }
            } else {
                consecutiveFailures = 0
            }
        }
        return 'done'
    } finally {
        if (recorded) {
            writeUnresolved(env.flags, unresolved)
        }
    }
}

/** Never rejects. */
export async function runInlayOldStoreCleanup(env: InlayCopyEnvironment = browserEnvironment()): Promise<InlayCleanupOutcome> {
    try {
        const store = await getAppStore()
        if (await pageStoreIsOpfsTransitional() || getPageStorageMode().kind === 'read-only') {
            return 'not-run'
        }
        let outcome: InlayCleanupOutcome = 'not-run'
        const ran = await env.withTabLock(async () => {
            outcome = await cleanOldStore(store, env)
        })
        return ran ? outcome : 'busy'
    } catch (error) {
        console.warn('The inlay cleanup could not run:', error)
        return 'not-run'
    }
}

/** Starts the copy and, once it has ended, the cleanup pass; does not wait for either. */
export function startInlayCopy(): void {
    void runInlayCopy().then(() => runInlayOldStoreCleanup())
}
