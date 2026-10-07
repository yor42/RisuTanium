import { getAppStore, pageStoreIsIndexedDb, pageStoreIsOpfsTransitional } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { inlayMetaKey } from './inlayKeys'
import {
    hasAppInlay,
    inlayAttachmentLimit,
    InlayUnreadableError,
    isListedAppInlay,
    legacyInlayStore,
    listAppInlayKeys,
    withInlayLock,
    writeAppInlay,
    type InlayAsset,
} from './inlayStore'

/**
 * Copies the inlays of the old `inlay` LocalForage database into the app store,
 * in the background, once per browser.
 *
 * - The old entry is never changed or removed here. Within one page a copy does
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

function browserEnvironment(): InlayCopyEnvironment {
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

function isQuotaError(error: unknown): boolean {
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

async function hasRoom(env: InlayCopyEnvironment, size: number): Promise<boolean> {
    const estimate = await env.estimate()
    if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') {
        return true
    }
    const headroom = Math.max(MIN_HEADROOM_BYTES, estimate.quota * HEADROOM_FRACTION)
    return estimate.quota - estimate.usage - size >= headroom
}

type EntryOutcome = 'copied' | 'skipped' | 'residue' | 'failed' | 'no-room' | 'quota'

async function copyEntry(store: ByteStore, id: string, checkRoom: ((size: number) => Promise<boolean>) | null): Promise<EntryOutcome> {
    return await withInlayLock(id, async () => {
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
        return 'copied'
    })
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

/** Starts the copy and does not wait for it. */
export function startInlayCopy(): void {
    void runInlayCopy()
}
