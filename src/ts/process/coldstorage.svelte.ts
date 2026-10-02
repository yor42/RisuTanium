import {
    writeFile,
    BaseDirectory,
    readFile,
    mkdir,
    readDir,
    exists
} from "@tauri-apps/plugin-fs"
import { forageStorage } from "../globalApi.svelte"
import { isTauri, isNodeServer } from "src/ts/platform"
import { DBState, selectedCharID } from "../stores.svelte"
import { get } from "svelte/store"
import type { NodeStorage } from "../storage/nodeStorage"
import { compress as fflateCompress, decompress as fflateDecompress } from "fflate"
import { alertConfirm } from "../alert"
import { language } from "src/lang"
import type { Database } from "../storage/database.svelte"
import { classifyColdDecodeFailure, classifyColdDecompressFailure, coldStorageHeader, getColdStorageAffectedCharacters, getColdStorageBackupName, isColdStorageBackupData, isRestorableColdStorageKey, listColdBackupRoots, listColdDataKeysFromDb, listInnerColdStorageKeys, matchColdStorageLoadErrorKey, mergeRetriedColdChatSideFields, type ColdBackupRoot, type ColdReadErrorKind, type PreLoadChatResult, type RetryLegacyColdChatLoadResult } from "./coldstorageData"
import { doingChat } from "./index.svelte"
import { isSafeColdStorageKey } from "./coldStorageKey"

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

export async function getColdStorageItem(key:string) {

    // A key that cannot be a storage name reads as `null` before any backend
    // is asked, like every other failure of this reader.
    if(!isSafeColdStorageKey(key)){
        return null
    }

    if(isNodeServer){
        try {
            const storage = forageStorage.realStorage as NodeStorage
            const f = await storage.getItem('coldstorage/' + key)
            if(!f){
                return null
            }
            const text = new TextDecoder().decode(await decompress(new Uint8Array(f)))
            return JSON.parse(text)
        }
        catch (error) {
            return null
        }
    }
    else if(isTauri){
        try {
            const f = await readFile('./coldstorage/'+key+'.json', {
                baseDir: BaseDirectory.AppData
            })
            const text = new TextDecoder().decode(await decompress(new Uint8Array(f)))
            return JSON.parse(text)
        } catch (error) {
            return null
        }
    }
    else{
        //use opfs
        try {
            const opfs = await navigator.storage.getDirectory()
            const file = await opfs.getFileHandle('coldstorage_' + key+'.json')
            if(!file){
                return null
            }
            const d = await file.getFile()
            if(!d){
                return null
            }
            const buf = await d.arrayBuffer()
            const text = new TextDecoder().decode(await decompress(new Uint8Array(buf)))
            return JSON.parse(text)
        } catch (error) {
            return null
        }
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
 *                    scope error, a page with no storage for archived data, or
 *                    a decode (decompress/JSON.parse) failure. Every case that
 *                    isn't clearly "the item was never written" falls here on
 *                    purpose -- the whole point of this reader is that callers
 *                    must not treat an ambiguous failure as proof of data
 *                    loss.
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
 *   - `'unavailable'` -- OPFS branch only: the browser has no
 *                        `navigator.storage.getDirectory` at all. A
 *                        `getDirectory` that exists and rejects has no kind.
 *   - `'damaged'`     -- the key cannot be a storage name
 *                        (`isSafeColdStorageKey`), so no backend was asked,
 *                        or the bytes were obtained but do not decode: fflate
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
 * Pure classification seam for the Tauri backend, with `readFileFn` and
 * `existsFn` injected so this can be unit-tested without mocking
 * `@tauri-apps/plugin-fs` at the module level.
 *
 * `missing` only when `readFileFn` rejects with an error matching
 * `/\(os error 2\)/` **and** a follow-up `existsFn` call resolves `false`.
 * `exists()` is only ever consulted after a
 * matching read failure, never on a healthy read. An `exists()` throw --
 * e.g. a Tauri fs scope violation -- is `error`, not `missing`: it tells us
 * nothing about whether the file exists. Any other `readFileFn` error
 * (including `os error 3`, and Android's differently formatted errors) is
 * also `error` -- the safe direction.
 */
export async function classifyTauriColdRead(
    path: string,
    readFileFn: (path: string, opts: { baseDir: number }) => Promise<Uint8Array>,
    existsFn: (path: string, opts: { baseDir: number }) => Promise<boolean>,
): Promise<ColdStorageBytesResult> {
    try {
        const bytes = await readFileFn(path, { baseDir: BaseDirectory.AppData })
        return { status: 'ok', bytes }
    } catch (readError) {
        const message = String((readError as { message?: unknown })?.message ?? readError)
        if (!/\(os error 2\)/.test(message)) {
            return { status: 'error', error: readError }
        }
        try {
            const fileExists = await existsFn(path, { baseDir: BaseDirectory.AppData })
            return fileExists ? { status: 'error', error: readError } : { status: 'missing' }
        } catch (existsError) {
            return { status: 'error', error: existsError }
        }
    }
}

/**
 * Pure classification seam for the OPFS backend, with `getDirectoryFn`
 * injected. `missing` only for a `NotFoundError` thrown while LOCATING OR
 * OPENING THE FILE ITSELF -- i.e. from `getFileHandle(filename)` (called
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
 * Pure classification seam for the Node backend, with `getItemFn` injected.
 * `missing` only when `getItemFn` resolves `null`/`undefined` -- the
 * self-hosted Node server (`NodeStorage.getItem`) answers a missing file
 * with HTTP 200 and an empty body, which it already turns into `null`. Any
 * throw is `error`.
 */
export async function classifyNodeColdRead(
    getItemFn: (key: string) => Promise<Uint8Array | null | undefined>,
    storageKey: string,
): Promise<ColdStorageBytesResult> {
    try {
        const f = await getItemFn(storageKey)
        if (f === null || f === undefined) {
            return { status: 'missing' }
        }
        return { status: 'ok', bytes: new Uint8Array(f) }
    } catch (error) {
        return { status: 'error', error }
    }
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
    if (isNodeServer) {
        const storage = forageStorage.realStorage as NodeStorage
        return await classifyNodeColdRead((k) => storage.getItem(k), 'coldstorage/' + key)
    }
    if (isTauri) {
        return await classifyTauriColdRead('./coldstorage/' + key + '.json', readFile, exists)
    }
    // Only the absence of `getDirectory` itself says this page has no storage
    // for archived data. One that exists and rejects (a private-browsing mode,
    // a permission error) is a read error like any other and keeps no kind.
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
        return {
            status: 'error',
            kind: 'unavailable',
            error: new Error('This page offers no storage for archived data: navigator.storage.getDirectory is not available.'),
        }
    }
    return await classifyOpfsColdRead(() => navigator.storage.getDirectory(), 'coldstorage_' + key + '.json')
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
        return { status: 'ok', value: JSON.parse(new TextDecoder().decode(decompressed)) }
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

    // The key only: a unit holds a whole character, and a console keeps every
    // logged object reachable for as long as it is open.
    console.log("setting cold storage item", key)

    const compressed = await compressColdStorageValue(value)
    if(!compressed){
        return false
    }

    if(isNodeServer){
        try {
            const storage = forageStorage.realStorage as NodeStorage
            await storage.setItem('coldstorage/' + key, compressed)
            return true
        } catch (error) {
            console.error('Cold storage node write failed:', error)
            return false
        }
    }

    else if(isTauri){
        try {
            await mkdir('./coldstorage', { recursive: true, baseDir: BaseDirectory.AppData })
            await writeFile('./coldstorage/'+key+'.json', compressed, { baseDir: BaseDirectory.AppData })
            return true
        } catch (error) {
            console.error('Cold storage Tauri write failed:', error)
            return false
        }
    }
    else{
        //use opfs
        try {
            const opfs = await navigator.storage.getDirectory()
            const file = await opfs.getFileHandle('coldstorage_' + key+'.json', { create: true })
            const writable = await file.createWritable()
            await writable.write(compressed as any)
            await writable.close()
            return true
        } catch (error) {
            console.error('Cold storage OPFS write failed:', error)
            return false
        }
    }
}

export async function listColdStorageItems():Promise<{items:string[]}> {
    if(isNodeServer){
        const fullKeys = await (forageStorage.realStorage as NodeStorage).keys()
        const keys = fullKeys.filter(k => k.startsWith('coldstorage/')).map(k => k.replace('coldstorage/', ''))
        return {
            items: keys
        }
    }

    else if(isTauri){
        const entries = await readDir('./coldstorage', { baseDir: BaseDirectory.AppData })
        const keys = entries.filter(e => e.name.endsWith('.json')).map(e => e.name.slice(0, -5))
        return {
            items: keys
        }
    }
    else{
        const opfs = await navigator.storage.getDirectory()
        const entries = opfs.entries()
        const keys = []
        for await (const [name, handle] of entries) {
            if(name.startsWith('coldstorage_') && name.endsWith('.json')){
                keys.push(name.slice(12, -5))
            }
        }
        return {
            items: keys
        }
    }
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
