import { isTauri, isNodeServer } from "src/ts/platform"
import { DBState, selectedCharID } from "../stores.svelte"
import { get } from "svelte/store"
import { listStoredUnitNames } from "../storage/loadTimeListing"
import type { ReadResult, StoreCondition } from "../storage/store/contract"
import { getAppStore } from "../storage/store/appStore"
import { StoreDeleteManyError, StoreInvalidKeyError, StoreVersionConflictError } from "../storage/store/errors"
import { compress as fflateCompress, decompress as fflateDecompress } from "fflate"
import { alertConfirm } from "../alert"
import { language } from "src/lang"
import type { Database } from "../storage/database.svelte"
import { classifyColdDecodeFailure, classifyColdDecompressFailure, coldStorageHeader, getColdStorageAffectedCharacters, getColdStorageBackupName, isColdStorageBackupData, isRestorableColdStorageKey, listColdBackupRoots, listColdDataKeysFromDb, listInnerColdStorageKeys, matchColdStorageLoadErrorKey, mergeRetriedColdChatSideFields, type ColdBackupRoot, type ColdReadErrorKind, type PreLoadChatResult, type RetryLegacyColdChatLoadResult } from "./coldstorageData"
import { doingChat } from "./index.svelte"
import { isSafeColdStorageKey } from "./coldStorageKey"
import { coldUnitStoreKey, coldUnitStoreRefusal, legacyOpfsUnitName } from "./coldUnitLocation"
import { beginChokePoint } from "./memory/busyActions"
import { noteReadSize, noteRestoredBytes, readSizeOf } from "./memory/restoredBytes"

export {
    coldStorageHeader,
    getColdStorageBackupKey,
    getColdStorageBackupName,
    isColdStorageBackupData,
    listColdDataKeysFromDb
} from "./coldstorageData"
export type { ColdReadErrorKind, PreLoadChatResult, RetryLegacyColdChatLoadResult } from "./coldstorageData"

async function decompress(data:Uint8Array) {
    return new Promise<Uint8Array>((resolve, reject) => {
        fflateDecompress(data, (err, decompressed) => {
            if (err) {
                return reject(err)
            }
            resolve(decompressed)
        })
    })
}

/**
 * The value of unit `key`, or `null` for any failure (an unsafe key, an unread
 * or undecodable unit) and for an absent one. Reads exactly as
 * `readColdStorageItem` does.
 */
export async function getColdStorageItem(key:string) {
    try {
        const result = await readLocalColdStorageValue(key)
        return result.status === 'ok' ? result.value : null
    }
    catch (error) {
        return null
    }
}

/**
 * A three-way outcome for a cold-storage read (CHORE-07):
 *   - `'ok'`      -- the bytes were read and decoded. `value` may itself be
 *                    `null` (a plugin can legitimately store `null`) --
 *                    that is still `'ok'`, not `'missing'`.
 *   - `'missing'` -- the backend positively reported "no such item", per the
 *                    backend-specific rules below.
 *   - `'error'`   -- anything else: a transient I/O failure, a permission or
 *                    scope error, a store that cannot be opened, or a decode
 *                    (decompress/JSON.parse) failure. Every case that isn't
 *                    clearly "the item was never written" falls here on
 *                    purpose -- the whole point of this reader is that callers
 *                    must not treat an ambiguous failure as proof of data
 *                    loss. A failed read of the page's store is never retried
 *                    against the legacy OPFS file.
 *
 * An `'error'` may carry a `kind` that says why a repeated read cannot be
 * expected to succeed. `kind` selects the text shown to the user and the
 * result `preLoadChat` and `retryLegacyColdChatLoad` return (the legacy Retry
 * panel hides Retry for it). Every consumer that keeps, skips, deletes, counts
 * or retries data decides by `status` alone, so every `'error'` is treated
 * the same, except one: the manual clean-up (`storage/manualCleanup.ts`) also
 * reads `kind`, for the archived chats it follows and never for a blob. It
 * keeps a `'damaged'` chat and follows nothing from it; any other error stops
 * the run. The kinds:
 *   - `'unavailable'` -- the page has no storage for archived data: its byte
 *                        store cannot be opened (`AppStoreUnavailableError`).
 *                        A browser without `navigator.storage.getDirectory`
 *                        has no legacy unit files, so an absent unit there is
 *                        `'missing'`, not unavailable.
 *   - `'damaged'`     -- the key cannot be a storage name
 *                        (`isSafeColdStorageKey`) or the page's store refuses
 *                        it (`StoreInvalidKeyError`), so nothing was read, or
 *                        the bytes were obtained but do not decode: fflate
 *                        reported malformed or truncated input, or the
 *                        decompressed text is not JSON
 *                        (`classifyColdDecompressFailure`,
 *                        `classifyColdDecodeFailure`). Any other decode
 *                        failure has no kind.
 *
 * This reader does no shape validation of `value` -- it also serves whole
 * character blobs (`{character}`) and arbitrary plugin-stored values, so a
 * shape check does not belong here (see `preLoadChat`, which adds its own
 * shape check on top of this reader's `'ok'` result).
 */
export type ColdStorageReadResult =
    | { status: 'ok', value: any }
    | { status: 'missing' }
    | { status: 'error', error: unknown, kind?: ColdReadErrorKind }

type ColdStorageBytesResult =
    | { status: 'ok', bytes: Uint8Array }
    | { status: 'missing' }
    | { status: 'error', error: unknown, kind?: ColdReadErrorKind }

/**
 * Pure classification seam for the legacy OPFS unit files, with
 * `getDirectoryFn` injected. `missing` only for a `NotFoundError` thrown while
 * LOCATING OR OPENING THE FILE ITSELF -- i.e. from `getFileHandle(filename)` (called
 * without `{create: true}`, real OPFS's own way of saying "no such file")
 * or `getFile()` -- the name real OPFS's `DOMException` uses, and the name
 * this project's OPFS test mocks use. A `NotFoundError` thrown by
 * `getDirectoryFn()` itself (i.e. `navigator.storage.getDirectory()`) is
 * NOT about this file at all -- it would mean OPFS's root directory
 * couldn't be obtained, which says nothing about whether `filename` exists
 * -- so it (and every other error from either step, including
 * `TypeMismatchError` and `NotReadableError`) is `error`.
 */
export async function classifyOpfsColdRead(
    getDirectoryFn: () => Promise<{
        getFileHandle: (name: string) => Promise<{
            getFile: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>
        }>
    }>,
    filename: string,
): Promise<ColdStorageBytesResult> {
    let opfs: Awaited<ReturnType<typeof getDirectoryFn>>
    try {
        opfs = await getDirectoryFn()
    } catch (error) {
        return { status: 'error', error }
    }

    try {
        const file = await opfs.getFileHandle(filename)
        const f = await file.getFile()
        const buf = await f.arrayBuffer()
        return { status: 'ok', bytes: new Uint8Array(buf) }
    } catch (error) {
        if ((error as { name?: unknown })?.name === 'NotFoundError') {
            return { status: 'missing' }
        }
        return { status: 'error', error }
    }
}

/**
 * The version this page last read or wrote for each unit, for the stores that
 * enforce versions (the Node server). A write of a unit presents the version
 * recorded here, so a unit another device wrote in between is refused instead
 * of overwritten. A unit never read or written by this page, or deleted by it,
 * has no entry and is written unconditionally.
 */
const unitVersions = new Map<string, number>()

/**
 * Write stamps of the units this page has written or deleted. A stamp changes
 * when a write or delete of the unit starts and again when it ends, and has no
 * value while one is in flight, so two equal stamps of a key, with a read in
 * between, mean that no write of this page overlapped or followed that read.
 * One entry per unit written in this page session.
 */
const unitStamps = new Map<string, number>()
const unitWritesInFlight = new Map<string, number>()
let unitStampClock = 0

function beginUnitWrites(keys: readonly string[]): () => void {
    for (const key of keys) {
        unitStamps.set(key, ++unitStampClock)
        unitWritesInFlight.set(key, (unitWritesInFlight.get(key) ?? 0) + 1)
    }
    let ended = false
    return () => {
        if (ended) {
            return
        }
        ended = true
        for (const key of keys) {
            unitStamps.set(key, ++unitStampClock)
            const left = (unitWritesInFlight.get(key) ?? 1) - 1
            if (left <= 0) {
                unitWritesInFlight.delete(key)
            } else {
                unitWritesInFlight.set(key, left)
            }
        }
    }
}

/** The write stamp of unit `key`, or `null` while this page is writing or deleting it. A unit this page never wrote has stamp 0. */
export function getColdUnitStamp(key: string): number | null {
    return unitWritesInFlight.has(key) ? null : (unitStamps.get(key) ?? 0)
}

/** Whether the page's store holds unit `key`, without transferring the unit. Rejects when the store cannot say. */
export async function hasColdUnitInStore(key: string): Promise<boolean> {
    return await (await getAppStore()).has(coldUnitStoreKey(key))
}

/** Whether this page can hold legacy OPFS unit files at all: only the web build, and only in a browser that offers OPFS. */
function legacyOpfsAvailable(): boolean {
    return !isTauri && !isNodeServer && typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function readLocalColdStorageBytes(key: string): Promise<ColdStorageBytesResult> {
    // Decided before any backend is asked: a key the backends cannot hold may
    // read as an absent unit on one of them (a `/` on a POSIX desktop, an
    // over-long name on the Node server), and an absent unit is the one answer
    // callers treat as final: the data is gone, so acting on it (offering to
    // delete the chat, leaving the unit out of a backup) can lose nothing more.
    if (!isSafeColdStorageKey(key)) {
        return {
            status: 'error',
            kind: 'damaged',
            error: new Error('The archive key cannot be used as a storage name.'),
        }
    }
    // A key the page's store cannot hold was never stored there: damaged, not absent.
    const refusal = coldUnitStoreRefusal(key)
    if (refusal !== null) {
        return { status: 'error', kind: 'damaged', error: new Error(`The archive key cannot be stored here: ${refusal}`) }
    }
    let stored: ReadResult
    try {
        stored = await (await getAppStore()).read(coldUnitStoreKey(key))
    } catch (error) {
        // A key the page's store refuses can hold no unit, which is not the
        // same as an absent one.
        if (error instanceof StoreInvalidKeyError) {
            return { status: 'error', kind: 'damaged', error }
        }
        // A browser whose IndexedDB cannot be used offers this page no storage
        // for archived data; a repeated read cannot succeed. Matched by name,
        // not `instanceof`, so that a stand-in for the store selection module
        // that exports only `getAppStore` still works.
        if ((error as { name?: unknown } | null)?.name === 'AppStoreUnavailableError') {
            return { status: 'error', kind: 'unavailable', error }
        }
        // A failed read never falls through to the legacy copy: it could be an
        // older value of a unit the store holds.
        return { status: 'error', error }
    }
    if (stored.version !== null) {
        unitVersions.set(key, stored.version)
    }
    if (stored.bytes !== null) {
        return { status: 'ok', bytes: stored.bytes }
    }
    // Absent from the store. Only the web build has anywhere else to look, and a
    // browser without OPFS has no legacy file, so there the unit is absent. A
    // `getDirectory` that exists and rejects (a private-browsing mode, a
    // permission error) is a read error and keeps no kind.
    if (!legacyOpfsAvailable()) {
        return { status: 'missing' }
    }
    return await classifyOpfsColdRead(() => navigator.storage.getDirectory(), legacyOpfsUnitName(key))
}

/**
 * Decodes `bytes` into the stored value, telling a copy that does not decode
 * (`kind: 'damaged'`) from a decode that failed for another reason. The two
 * steps are judged separately: a decompress failure is damaged only by an
 * fflate data-format code (`classifyColdDecompressFailure`), and only the
 * `JSON.parse` step may also be recognised by its `SyntaxError` name
 * (`classifyColdDecodeFailure`).
 */
async function decodeColdStorageValue(bytes: Uint8Array): Promise<ColdStorageReadResult> {
    let decompressed: Uint8Array
    try {
        decompressed = await decompress(bytes)
    } catch (decompressError) {
        const kind = classifyColdDecompressFailure(decompressError)
        return kind ? { status: 'error', error: decompressError, kind } : { status: 'error', error: decompressError }
    }
    try {
        const result: ColdStorageReadResult = { status: 'ok', value: JSON.parse(new TextDecoder().decode(decompressed)) }
        noteReadSize(result, decompressed.length)
        return result
    } catch (parseError) {
        const kind = classifyColdDecodeFailure(parseError)
        return kind ? { status: 'error', error: parseError, kind } : { status: 'error', error: parseError }
    }
}

async function readLocalColdStorageValue(key: string): Promise<ColdStorageReadResult> {
    const bytesResult = await readLocalColdStorageBytes(key)
    if (bytesResult.status !== 'ok') {
        return bytesResult
    }
    return await decodeColdStorageValue(bytesResult.bytes)
}

/**
 * Three-way cold-storage reader (CHORE-07).
 * Classifies I/O and decoding only -- see `ColdStorageReadResult` above for
 * why there is no shape check here.
 *
 * `getColdStorageItem` above keeps the `null`-on-any-failure shape its
 * callers rely on; both are in `resolveUncleanableChars` in
 * `globalApi.svelte.ts`, which reads a stub's blob for the asset keep-set
 * scan and treats `null` as "no usable blob". `preLoadChat`, the
 * plugin-storage bridge (`v3.svelte.ts`), the manual clean-up
 * (`storage/manualCleanup.ts`), the backup collector
 * (`collectColdStorageBackupPayloads`) and the restore's final check in
 * `backuplocal.ts` use this reader instead.
 */
export async function readColdStorageItem(key: string): Promise<ColdStorageReadResult> {
    return await readLocalColdStorageValue(key)
}

async function compressColdStorageValue(value:any):Promise<Uint8Array | null> {
    try {
        const json = JSON.stringify(value)
        return await (new Promise<Uint8Array>((resolve, reject) => {
            fflateCompress(new TextEncoder().encode(json), (err, result) => {
                if (err) {
                    return reject(err)
                }
                resolve(result)
            })
        }))
    } catch (error) {
        console.error('Cold storage compression failed:', error)
        return null
    }
}

export async function setColdStorageItem(key:string, value:any):Promise<boolean> {
    // A key that cannot be a storage name is a failed write, decided before
    // anything is compressed or any backend is asked. The key itself is not
    // logged: it may be arbitrarily long.
    if(!isSafeColdStorageKey(key)){
        console.error('Cold storage write refused: the archive key cannot be used as a storage name.')
        return false
    }
    if (coldUnitStoreRefusal(key) !== null) {
        console.error('Cold storage write refused: the page store cannot hold this archive key.')
        return false
    }

    // The key only: a unit holds a whole character, and a console keeps every
    // logged object reachable for as long as it is open.
    console.log("setting cold storage item", key)

    const endInFlight = beginChokePoint('coldStorage')
    const endUnitWrite = beginUnitWrites([key])
    try {
        const compressed = await compressColdStorageValue(value)
        if(!compressed){
            return false
        }

        // Only the page's store is written, never a legacy OPFS file. On a store that
        // enforces versions the write presents the version this page last saw for
        // the unit, so a unit another device wrote in between is not overwritten.
        try {
            const store = await getAppStore()
            const known = unitVersions.get(key)
            const condition: StoreCondition = store.capabilities.conditionalWrites && known !== undefined
                ? { ifVersion: known }
                : 'unconditional'
            const { version } = await store.write(coldUnitStoreKey(key), compressed, condition)
            if (version === null) {
                unitVersions.delete(key)
            } else {
                unitVersions.set(key, version)
            }
            return true
        } catch (error) {
            if (error instanceof StoreVersionConflictError) {
                console.error('Cold storage write refused: the unit was changed by another writer since this page read it.')
            } else if (error instanceof StoreInvalidKeyError) {
                console.error('Cold storage write refused: the page store cannot hold this archive key.')
            } else {
                console.error('Cold storage write failed:', error)
            }
            return false
        }
    } finally {
        endUnitWrite()
        endInFlight()
    }
}

/**
 * Deletes units from the page's store and, on the web, their legacy OPFS files.
 * Returns the keys it could not delete. A unit is deleted only when both
 * deletions succeeded, and the legacy file goes first: when the file's removal
 * fails the store entry stays, and when the store's removal fails after the
 * file is gone the store still holds the newer value, so an older value is
 * never readable again. The caller has checked each key with
 * `isSafeColdStorageKey`. Deleting a unit forgets the version this page recorded
 * for it, so a later write of the same key is not refused for a version the
 * deletion has outdated.
 */
export async function deleteColdStorageUnits(keys: readonly string[]): Promise<{ key: string, error: unknown }[]> {
    const endUnitWrites = beginUnitWrites(keys)
    try {
        return await deleteColdStorageUnitsNow(keys)
    } finally {
        endUnitWrites()
    }
}

async function deleteColdStorageUnitsNow(keys: readonly string[]): Promise<{ key: string, error: unknown }[]> {
    const failed: { key: string, error: unknown }[] = []
    let removable = [...keys]
    if (legacyOpfsAvailable()) {
        let opfs: FileSystemDirectoryHandle | null = null
        try {
            opfs = await navigator.storage.getDirectory()
        } catch (error) {
            for (const key of removable) {
                failed.push({ key, error })
            }
            removable = []
        }
        if (opfs) {
            const remaining: string[] = []
            for (const key of removable) {
                try {
                    await opfs.removeEntry(legacyOpfsUnitName(key))
                    remaining.push(key)
                } catch (error) {
                    if ((error as { name?: unknown })?.name === 'NotFoundError') {
                        remaining.push(key)
                    } else {
                        failed.push({ key, error })
                    }
                }
            }
            removable = remaining
        }
    }
    if (removable.length === 0) {
        return failed
    }
    try {
        const store = await getAppStore()
        await store.deleteMany(removable.map((key) => ({ key: coldUnitStoreKey(key), condition: 'unconditional' as const })))
    } catch (error) {
        if (error instanceof StoreDeleteManyError) {
            const notRemoved = new Set(error.report.filter((entry) => entry.outcome !== 'removed').map((entry) => entry.key))
            for (const key of removable) {
                if (notRemoved.has(coldUnitStoreKey(key))) {
                    failed.push({ key, error })
                }
            }
        } else {
            for (const key of removable) {
                failed.push({ key, error })
            }
        }
    } finally {
        for (const key of removable) {
            unitVersions.delete(key)
        }
    }
    return failed
}

/** The names of the stored units, as the load-time listing sees them: the page store's and, on the web, the legacy OPFS files'. */
export async function listColdStorageItems():Promise<{items:string[]}> {
    return { items: await listStoredUnitNames() }
}

/**
 * The manual clean-up of unused cold-storage units and assets. The work lives
 * in `../storage/manualCleanup`, loaded on demand: that module reads this one,
 * and nothing that only stores or loads cold data needs it.
 */
export async function cleanColdStorage(){
    const { runManualCleanup } = await import("../storage/manualCleanup")
    await runManualCleanup()
}

export async function listColdDataKeys(db: Pick<Database, 'characters'|'pluginCustomStorage'> = DBState.db): Promise<string[]> {
    return listColdDataKeysFromDb(db)
}

export type ColdStorageBackupPayload = {
    key: string
    backupName: string
    encoded: Uint8Array
}

export type ColdStorageBackupCollection = {
    payloads: ColdStorageBackupPayload[]
    /** Keys the backup could not carry and the user must be told about. */
    missingKeys: string[]
    invalidKeys: string[]
    /** For each unavailable key, the display names of the characters whose live chats, stubs or archives led to it. */
    owners?: Map<string, string[]>
    /** Every key this collection carried or reported as unavailable. */
    settledKeys?: Set<string>
}

export type ColdStorageBackupCollectOptions = {
    /** Roots listed beforehand; listed from `db` when absent. */
    roots?: ColdBackupRoot[]
    /** Keys an earlier collection already settled; they are not read again. */
    settledKeys?: ReadonlySet<string>
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): boolean {
    let set = map.get(key)
    if (!set) {
        set = new Set()
        map.set(key, set)
    }
    if (set.has(value)) {
        return false
    }
    set.add(value)
    return true
}

/**
 * Carries every cold-storage unit the database refers to, and every unit
 * those units refer to in turn (each key read once, one parsed value held at
 * a time).
 *
 * A key reached by any pointer, stub, `coldStoragedChats` or plugin mapping
 * is a normal key: when its unit is absent or invalid, the key is reported. A
 * key reached only through legacy load-error text is left out silently when
 * its unit is absent, and reported when its unit exists but cannot be read or
 * is not chat or character shaped. A key found inside an archive or named by
 * load-error text that a restore could not place is never read: it is reported
 * when it was found as a pointer and left out when named by error text. The
 * keys the database itself points at are read as listed.
 */
export async function collectColdStorageBackupPayloads(
    db: Pick<Database, 'characters'|'pluginCustomStorage'> = DBState.db,
    options: ColdStorageBackupCollectOptions = {},
): Promise<ColdStorageBackupCollection> {
    const roots = options.roots ?? listColdBackupRoots(db)
    const alreadySettled = options.settledKeys

    const payloads: ColdStorageBackupPayload[] = []
    const queue: string[] = []
    const scheduled = new Set<string>()
    const normalKeys = new Set<string>()
    // Keys whose unit is searched for further references; plugin storage content is not.
    const searchable = new Set<string>()
    const unplaceable = new Set<string>()
    const absentKeys: string[] = []
    const invalidUnitKeys: string[] = []
    const unreadableKeys: string[] = []
    const rootOwners = new Map<string, Set<string>>()
    const references = new Map<string, string[]>()

    const schedule = (key: string) => {
        if (scheduled.has(key) || alreadySettled?.has(key)) {
            return
        }
        scheduled.add(key)
        queue.push(key)
    }

    for (const root of roots) {
        if (root.kind === 'errorText') {
            if (!isRestorableColdStorageKey(root.key)) {
                continue
            }
        } else {
            normalKeys.add(root.key)
        }
        if (root.kind !== 'plugin') {
            searchable.add(root.key)
        }
        if (root.owner) {
            addToSetMap(rootOwners, root.key, root.owner)
        }
        schedule(root.key)
    }

    for (let i = 0; i < queue.length; i++) {
        const key = queue[i]
        let result: ColdStorageReadResult
        try {
            result = await readColdStorageItem(key)
        } catch (error) {
            result = { status: 'error', error }
        }

        if (result.status === 'missing') {
            absentKeys.push(key)
            continue
        }
        if (result.status === 'error') {
            console.error(`Failed to read cold storage item ${key}:`, result.error)
            unreadableKeys.push(key)
            continue
        }

        const value = result.value
        const isSearchable = searchable.has(key)
        if (isSearchable && !isColdStorageBackupData(value)) {
            invalidUnitKeys.push(key)
            continue
        }

        payloads.push({
            key,
            backupName: getColdStorageBackupName(key),
            encoded: new TextEncoder().encode(JSON.stringify(value)),
        })

        if (!isSearchable) {
            continue
        }
        let inner: ReturnType<typeof listInnerColdStorageKeys> = []
        try {
            inner = listInnerColdStorageKeys(value)
        } catch (error) {
            console.error(`Failed to list the units referred to by cold storage item ${key}:`, error)
        }
        if (inner.length > 0) {
            references.set(key, inner.map((entry) => entry.key))
        }
        for (const entry of inner) {
            if (entry.kind === 'pointer') {
                normalKeys.add(entry.key)
            }
            if (isRestorableColdStorageKey(entry.key)) {
                searchable.add(entry.key)
                schedule(entry.key)
            } else if (entry.kind === 'pointer') {
                unplaceable.add(entry.key)
            }
        }
    }

    const missingKeys: string[] = []
    const invalidKeys: string[] = [...invalidUnitKeys]
    for (const key of absentKeys) {
        if (normalKeys.has(key)) {
            missingKeys.push(key)
        }
    }
    missingKeys.push(...unreadableKeys)
    for (const key of unplaceable) {
        if (!scheduled.has(key) && !alreadySettled?.has(key)) {
            missingKeys.push(key)
        }
    }

    const settledKeys = new Set<string>([...payloads.map((payload) => payload.key), ...missingKeys, ...invalidKeys])
    const owners = missingKeys.length + invalidKeys.length > 0
        ? resolveColdStorageOwners([...missingKeys, ...invalidKeys], rootOwners, references)
        : undefined

    return { payloads, missingKeys, invalidKeys, owners, settledKeys }
}

/**
 * The characters whose roots lead to each of `keys`, following the references
 * recorded while reading archives. Independent of the order keys were read in.
 */
function resolveColdStorageOwners(
    keys: string[],
    rootOwners: Map<string, Set<string>>,
    references: Map<string, string[]>,
): Map<string, string[]> {
    const reached = new Map<string, Set<string>>()
    for (const [key, names] of rootOwners) {
        reached.set(key, new Set(names))
    }
    const pending = Array.from(reached.keys())
    while (pending.length > 0) {
        const key = pending.pop() as string
        const names = reached.get(key)
        const children = references.get(key)
        if (!names || !children) {
            continue
        }
        for (const child of children) {
            let grew = false
            for (const name of names) {
                grew = addToSetMap(reached, child, name) || grew
            }
            if (grew) {
                pending.push(child)
            }
        }
    }

    const owners = new Map<string, string[]>()
    for (const key of keys) {
        const names = reached.get(key)
        if (names?.size) {
            owners.set(key, Array.from(names))
        }
    }
    return owners
}

export async function confirmIncompleteColdStorageOperation(
    db: Pick<Database, 'characters'>,
    unavailableKeys: Iterable<string>,
    operation: 'backup' | 'restore',
    ownersByKey?: ReadonlyMap<string, readonly string[]>,
): Promise<boolean> {
    const uniqueUnavailableKeys = Array.from(new Set(unavailableKeys))
    if (uniqueUnavailableKeys.length === 0) {
        return true
    }

    const affected = getColdStorageAffectedCharacters(db, uniqueUnavailableKeys, ownersByKey)
    const characterNames = affected.characterNames.join(', ')
    const message = operation === 'backup'
        ? language.errors.coldStorageIncompleteBackupConfirm(
            characterNames,
            uniqueUnavailableKeys.length,
            affected.unresolvedKeys.length,
        )
        : language.errors.coldStorageIncompleteRestoreConfirm(
            characterNames,
            uniqueUnavailableKeys.length,
            affected.unresolvedKeys.length,
        )

    return await alertConfirm(message)
}

/**
 * Restores the chat's archived messages into `chat.message` when its first
 * message is a live cold-storage pointer. The outcomes are `PreLoadChatResult`
 * (`coldstorageData.ts`); a read the reader reports as `kind: 'unavailable'` or
 * `'damaged'` resolves that value, a decoded value that is not a chat resolves
 * `'damaged'`, and any other failed read resolves `'error'`. None of them
 * mutates `chat.message` or rejects the returned promise (CHORE-07).
 */
export async function preLoadChat(characterIndex:number, chatIndex:number): Promise<PreLoadChatResult> {
    const chat = DBState.db?.characters?.[characterIndex]?.chats?.[chatIndex]

    if(!chat){
        return 'none'
    }

    // Capture the pointer string and this character's chaId up front -- the
    // chat proxy may be mutated (or entirely replaced), and the user may
    // switch to a different character altogether, while we `await` below.
    const pointer = chat.message?.[0]?.data
    if(typeof pointer !== 'string' || !pointer.startsWith(coldStorageHeader)){
        return 'none'
    }
    const coldDataKey = pointer.slice(coldStorageHeader.length)
    const chaId = DBState.db?.characters?.[characterIndex]?.chaId

    const result = await readColdStorageItem(coldDataKey)

    if(result.status === 'missing'){
        // Positively confirmed missing. Leave the pointer in place (no
        // mutation), the same as 'error', so the caller can show the firm
        // "could not be found" notice without risking a false positive from
        // a merely transient failure.
        console.error(`Cold storage data missing for key: ${coldDataKey}`)
        return 'missing'
    }

    if(result.status === 'error'){
        console.error(`Cold storage read failed for key: ${coldDataKey}`, result.error)
        return result.kind ?? 'error'
    }

    const coldData = result.value

    const isLegacyArray = Array.isArray(coldData)
    const isObjectBlob = !!coldData
        && typeof coldData === 'object'
        && Array.isArray((coldData as {message?:unknown}).message)

    if(!isLegacyArray && !isObjectBlob){
        // The read succeeded, but the data isn't in a shape this function
        // recognizes: a copy that cannot be a chat. Leave the pointer in
        // place (no mutation).
        console.error(`Cold storage data invalid for key: ${coldDataKey}`)
        return 'damaged'
    }

    // The chat may have moved on entirely while we were awaiting the read
    // (the user switched chats, or something else replaced message[0]) --
    // only apply the restored data if it is still the same live pointer.
    if(chat.message?.[0]?.data !== pointer){
        return 'none'
    }

    // The user may also have switched to a DIFFERENT CHARACTER entirely
    // while we were awaiting the read. A restore that lands on a
    // non-selected character is never tracked for saving, so a later
    // cleanup could delete this blob while the saved database still holds
    // the pointer (CHORE-07).
    // Compared by chaId, not by index alone, since the character array can
    // reorder between the capture above and this point.
    const selectedIndex = get(selectedCharID)
    if(DBState.db?.characters?.[selectedIndex]?.chaId !== chaId){
        return 'none'
    }

    // Keep anything appended to the chat while the read was in flight.
    const tail = chat.message.slice(1)

    if(isLegacyArray){
        chat.message = [...(coldData as typeof chat.message), ...tail]
    }
    else{
        const blob = coldData as {
            message: typeof chat.message
            hypaV2Data?: typeof chat.hypaV2Data
            hypaV3Data?: typeof chat.hypaV3Data
            scriptstate?: typeof chat.scriptstate
            localLore?: typeof chat.localLore
        }
        chat.message = [...blob.message, ...tail]
        chat.hypaV2Data = blob.hypaV2Data
        chat.hypaV3Data = blob.hypaV3Data
        chat.scriptstate = blob.scriptstate
        chat.localLore = blob.localLore
    }
    chat.lastDate = Date.now()
    noteRestoredBytes(chaId, readSizeOf(result))

    return 'ok'
}

/**
 * Retries the archived messages of a chat whose `message[0]` already holds the
 * legacy "could not be loaded" error text (`matchColdStorageLoadErrorKey`),
 * rather than a live `coldStorageHeader` pointer (CHORE-07). The outcomes are
 * `RetryLegacyColdChatLoadResult` (`coldstorageData.ts`), mapped from the read
 * as in `preLoadChat`; the side-field merge failure stays `'error'` because the
 * merge can fail from the live chat as well as from the stored data. Every
 * value except `'ok'` leaves the chat unmutated and the promise never rejects,
 * so nothing is lost.
 */
export async function retryLegacyColdChatLoad(characterIndex:number, chatIndex:number): Promise<RetryLegacyColdChatLoadResult> {
    const chat = DBState.db?.characters?.[characterIndex]?.chats?.[chatIndex]

    if(!chat){
        return 'none'
    }

    // Capture the exact error text and this character's chaId up front --
    // the chat proxy may be mutated or replaced, and the user may switch
    // characters, while we `await` below (mirrors preLoadChat's own
    // up-front capture).
    const errorText = chat.message?.[0]?.data
    const coldDataKey = matchColdStorageLoadErrorKey(errorText)
    if(!coldDataKey){
        return 'none'
    }
    const chaId = DBState.db?.characters?.[characterIndex]?.chaId

    if(get(doingChat) || chat.isStreaming){
        return 'busy'
    }

    const result = await readColdStorageItem(coldDataKey)

    // A send may have started while the read was in flight -- re-check
    // busy status after the await too.
    if(get(doingChat) || chat.isStreaming){
        return 'busy'
    }

    // The user may have switched to a DIFFERENT CHARACTER entirely while we
    // were awaiting the read. Compared by chaId, not index alone, since the
    // character array can reorder in between (mirrors preLoadChat's race
    // check, CHORE-07).
    const selectedIndex = get(selectedCharID)
    if(DBState.db?.characters?.[selectedIndex]?.chaId !== chaId){
        return 'none'
    }

    // Require the exact same chat object still sitting at chatIndex -- a
    // plugin could have replaced the character or reordered its chats
    // underneath us while we awaited the read.
    if(DBState.db?.characters?.[selectedIndex]?.chats?.[chatIndex] !== chat){
        return 'none'
    }

    // A double retry (or any other write) may already have changed
    // message[0] -- only apply this result if it's still the same error
    // text this call started with.
    if(chat.message?.[0]?.data !== errorText){
        return 'none'
    }

    if(result.status === 'missing'){
        console.error(`Cold storage retry: data missing for key: ${coldDataKey}`)
        return 'missing'
    }

    if(result.status === 'error'){
        console.error(`Cold storage retry: read failed for key: ${coldDataKey}`, result.error)
        return result.kind ?? 'error'
    }

    const coldData = result.value

    const isLegacyArray = Array.isArray(coldData)
    const isObjectBlob = !!coldData
        && typeof coldData === 'object'
        && Array.isArray((coldData as {message?:unknown}).message)

    if(!isLegacyArray && !isObjectBlob){
        console.error(`Cold storage retry: data invalid for key: ${coldDataKey}`)
        return 'damaged'
    }

    // Computed only now, from the same identity-checked chat object, after
    // the await -- drops the error-text message[0] and
    // keeps every message sent after it, by identity.
    const droppedErrorMessage = chat.message[0]
    const tail = chat.message.slice(1)

    if(isLegacyArray){
        // A legacy array blob never carried side fields in the first place
        // -- leave every live side field untouched (CHORE-07).
        chat.message = [...(coldData as typeof chat.message), ...tail]
    }
    else{
        const blob = coldData as {
            message: typeof chat.message
            hypaV2Data?: typeof chat.hypaV2Data
            hypaV3Data?: typeof chat.hypaV3Data
            scriptstate?: typeof chat.scriptstate
            localLore?: typeof chat.localLore
        }

        // Computed BEFORE any assignment to `chat` -- the shape check above
        // only confirms `blob.message` is an array; a side field can still
        // be malformed (e.g. a truthy, non-iterable `localLore` or
        // `hypaV3Data.summaries`), which throws inside the merge. Catching
        // it here, before `chat.message` (or anything else) is touched,
        // keeps the mutate-nothing contract for a bad blob.
        let merged: ReturnType<typeof mergeRetriedColdChatSideFields>
        try {
            merged = mergeRetriedColdChatSideFields(
                {
                    hypaV2Data: chat.hypaV2Data,
                    hypaV3Data: chat.hypaV3Data,
                    scriptstate: chat.scriptstate,
                    localLore: chat.localLore,
                },
                {
                    hypaV2Data: blob.hypaV2Data,
                    hypaV3Data: blob.hypaV3Data,
                    scriptstate: blob.scriptstate,
                    localLore: blob.localLore,
                },
                droppedErrorMessage?.chatId,
            )
        } catch (mergeError) {
            console.error(`Cold storage retry: side-field merge failed for key: ${coldDataKey}`, mergeError)
            return 'error'
        }

        chat.message = [...blob.message, ...tail]
        chat.hypaV2Data = merged.hypaV2Data
        chat.hypaV3Data = merged.hypaV3Data
        chat.scriptstate = merged.scriptstate
        chat.localLore = merged.localLore
    }
    chat.lastDate = Date.now()

    return 'ok'
}
