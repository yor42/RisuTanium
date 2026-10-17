import type { Database } from '../../database.svelte'
import { LEGACY_MAIN_FILE_KEY } from '../../blockKeys'
import { fingerprintMainFile } from '../../mainFileFingerprint'
import type { ByteStore } from '../../store/contract'
import { StoreNotBinaryError } from '../../store/errors'
import type { Store2Backend, Store2Read } from '../backend/types'
import type { BlockedReason } from '../bootActive'
import type { ListDerivation } from '../codec/types'
import { firstLifeInstall, installBuilt, type BuiltInstall, type FirstLifeGrant, type FirstLifeResult } from '../firstLife'
import { defaultKeyEnv, encodeUnit, refOfFrame, UNIT_TYPE, type KeyEnv, type LegacyList } from '../format'
import { LegacyListBuilder } from '../lists/legacyList'
import type { ListParams } from '../lists/params'
import type { ForeignClearHook } from '../owner'
import { runExit, type ExitResult } from '../recovery'
import { planWholeTreeInstall } from './install'
import type { LenientLegacyDecode, SkippedLegacyEntry } from './lenient'
import { legacyPluginRefs } from './refs'
import {
    LegacyReadError, readLegacyUnit, resolveLegacyTree, type IncompleteItem, type LegacyEntryReader, type ResolveOptions,
} from './resolve'
import { createLegacyStoreReader, type ColdUnitRead } from './storeReader'
import { collectLegacyColdKeys } from './walk'

/**
 * The conversion of a legacy profile into a store2 tree (plan v3.4 amendment 7, MC-299 items 1, 2, 7, 8 and 10): decode
 * the old main file strictly, fall back to the numbered backups newest first, resolve every cold-storage pointer, ask
 * about what could not be brought in, list the old files so none is deleted on a partial answer, and install the tree
 * through the shared installer, under a first-life marker or a fenced recovery-exit marker (`ConvertEntry`).
 *
 * Invariants:
 *  - Nothing is written before every question is answered. The first write is then the marker on the first-life entry
 *    and the fence on the `exit` entry. Every refusal, decline and read failure before it leaves the store as it was.
 *  - The old files are never written, renamed or deleted here. The new tree names them (`fixed.legacyKeep`) so a later
 *    deletion can see which of them it has fully read.
 *  - A file the conversion did not read to its end is listed `unreadable`, never `ok`: a keep set trusts an `ok` file's
 *    references. The main file is `unreadable` whenever the tree came from a backup or from the lenient decode, because
 *    a file that did not decode strictly may hold references nobody read.
 *  - At most one decoded old file is held at a time while the list is built; a file's references are collected as its
 *    units are read, and the tree is dropped before the next file is decoded.
 */

/** The decoders, the strict one for the default path and the lenient one for "convert without these". */
export interface LegacyDecoders {
    strict(bytes: Uint8Array): Promise<Database>
    lenient(bytes: Uint8Array): Promise<LenientLegacyDecode>
}

/** The real decoders, loaded on first use: a page that never converts does not load the save decoder. */
const defaultDecoders: LegacyDecoders = {
    strict: async (bytes) => (await import('../../risuSave')).decodeRisuSave(bytes, { strict: true }) as Promise<Database>,
    lenient: async (bytes) => (await import('./lenient')).decodeLegacyLenient(bytes),
}

/**
 * How the install gets its marker. `first-life`: the unfenced marker of a boot-row grant. `exit`: a fenced recovery
 * exit over `commitRead`, the compare basis of the marker; `foreignClear` is the question for another owner's standing
 * marker. Either way the marker is written only after every question has been answered.
 */
export type ConvertEntry =
    | { kind: 'first-life', grant: FirstLifeGrant }
    | { kind: 'exit', commitRead: Store2Read, foreignClear?: ForeignClearHook | null }

export interface ConvertRequest {
    /** The page's byte store: the old files are read from it and never written to it. */
    store: ByteStore
    /** The numbered backups, newest first, without pruning anything. */
    listBackupTimes: () => Promise<number[]>
    /** The three-way cold-unit reader of the page. */
    readColdStorageItem: (key: string) => Promise<ColdUnitRead>
    backend: Store2Backend
    entry: ConvertEntry
    /** The marker's owner. */
    owner: string
    lists: ListDerivation
    env?: KeyEnv
    decoders?: LegacyDecoders
    resolve?: ResolveOptions
    listParams?: Partial<ListParams>
}

export interface ConvertHooks {
    /** What the resolve could not bring in. `false` declines: nothing is written. */
    confirmIncomplete(items: readonly IncompleteItem[]): Promise<boolean>
}

export interface ConvertStrictHooks extends ConvertHooks {
    /** The main file did not decode strictly and this numbered backup (its time) did: converting from it is the person's choice, asked before anything else. `false` declines: nothing is written. */
    confirmFromBackup(backup: number): Promise<boolean>
}

export interface ConvertWithoutHooks extends ConvertHooks {
    /** The blocks the lenient decode left out, each named. `false` declines: nothing is written. */
    confirmSkipped(skipped: readonly SkippedLegacyEntry[]): Promise<boolean>
}

export type ConvertResult =
    | {
        status: 'installed'
        manifestKey: string
        flushed: boolean | undefined
        /** The numbered backup the tree came from, when the main file did not decode strictly. */
        fromBackup: number | null
    }
    /** The user declined a question; nothing was written. */
    | { status: 'declined' }
    /** The main file and every numbered backup failed the strict decode; nothing was written. "Convert without these" is the user's next choice. */
    | { status: 'all-failed', backupsTried: readonly number[] }
    /** The marker or the final write did not land and the store may have moved: classify the boot again. */
    | { status: 'reclassify' }
    /** Nothing more is attempted this boot. A marker or staged units it left are the next boot's to classify. */
    | { status: 'blocked', reason: BlockedReason, detail: string }
    /** An `exit` entry only: the fenced exit did not end `marked`. Every question was answered first. No marker landed, except that after `unknown` it may have. */
    | { status: 'exit', exit: Exclude<ExitResult, { status: 'marked' }> }

type ConvertOrigin =
    | { kind: 'main' }
    | { kind: 'backup', backup: number }
    | { kind: 'lenient' }

interface DecodedSource {
    /** The decoded tree; dropped (set to null) as soon as nothing reads it any more. */
    tree: Database | null
    /** The fingerprint of the file the tree was decoded from: the `convertedFrom` of the install. */
    fingerprint: string
    origin: ConvertOrigin
}

function backupKey(time: number): string {
    return `database/dbbackup-${time}.bin`
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** A result that is not the all-failed one: the lenient route has no strict decode left to fail. */
type SettledResult = Exclude<ConvertResult, { status: 'all-failed' }>

function blocked(reason: BlockedReason, detail: string): SettledResult {
    return { status: 'blocked', reason, detail }
}

/** The bytes of `key`; null when the file is absent or the store holds it but cannot hand it out as bytes. Any other failure rejects. */
async function readBytes(store: ByteStore, key: string): Promise<Uint8Array | null> {
    try {
        return (await store.read(key)).bytes
    } catch (error) {
        if (error instanceof StoreNotBinaryError) {
            return null
        }
        throw error
    }
}

/**
 * A strict decode that failed because the store could not be read (`RisuSaveReadError`: a remote file the save points at)
 * says nothing about the file, so it is not a failed decode and no other copy may stand in for it. Matched by name because
 * the save decoder is loaded lazily.
 */
function isStorageReadFailure(error: unknown): boolean {
    if (!(error instanceof Error) || error.name !== 'RisuSaveReadError') {
        return false
    }
    // A remote file the store holds but cannot hand out as bytes, or whose key it refuses, fails the same way every time: it is a file that does not decode, not a store that failed.
    const cause = (error as { cause?: unknown }).cause
    return !(cause instanceof Error && (cause.name === 'StoreNotBinaryError' || cause.name === 'StoreInvalidKeyError'))
}

/** The tree `bytes` decode to strictly; null when they do not decode. A storage read failure during the decode rejects. */
async function strictTreeOf(decoders: LegacyDecoders, bytes: Uint8Array | null): Promise<Database | null> {
    if (bytes === null) {
        return null
    }
    try {
        return await decoders.strict(bytes)
    } catch (error) {
        if (isStorageReadFailure(error)) {
            throw error
        }
        return null
    }
}

/**
 * The strict reading of the profile: the main file, then each numbered backup newest first, one decoded at a time. A
 * decode failure moves on to the next copy; a failure of the storage read itself rejects, because nothing is known about
 * the copy that could not be read. `{ tried }` when none decodes. No raw bytes are kept past the choice of a source: only
 * the fingerprint of the file converted from.
 */
async function readStrictSource(request: ConvertRequest, decoders: LegacyDecoders): Promise<{ source: DecodedSource } | { tried: number[] }> {
    let mainBytes = await readBytes(request.store, LEGACY_MAIN_FILE_KEY)
    const main = await strictTreeOf(decoders, mainBytes)
    if (main !== null && mainBytes !== null) {
        return { source: { tree: main, fingerprint: fingerprintMainFile(mainBytes), origin: { kind: 'main' } } }
    }
    mainBytes = null
    const tried: number[] = []
    for (const time of await request.listBackupTimes()) {
        tried.push(time)
        let bytes = await readBytes(request.store, backupKey(time))
        const tree = await strictTreeOf(decoders, bytes)
        if (tree !== null && bytes !== null) {
            return { source: { tree, fingerprint: fingerprintMainFile(bytes), origin: { kind: 'backup', backup: time } } }
        }
        bytes = null
    }
    return { tried }
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Adds one old file to the list: its own tree, then every cold unit its chain reaches and every plugin value, each
 * scanned as it is read. A failure at any point lists the file `unreadable` and never escapes.
 */
async function listFile(builder: LegacyListBuilder, key: string, tree: Database, reader: LegacyEntryReader): Promise<void> {
    let scan
    try {
        scan = builder.beginFile(key, tree)
    } catch {
        return
    }
    try {
        await collectLegacyColdKeys([tree], reader, (_unit, value) => {
            scan.coldValue(value)
            const character = isRecord(value) ? value.character : undefined
            if (isRecord(character)) {
                scan.coldCharacter(character)
            }
        })
        for (const ref of legacyPluginRefs(tree)) {
            const read = await readLegacyUnit(reader, ref.key, 'plugin')
            if (read.status === 'unparsable') {
                throw new LegacyReadError(ref.key, 'plugin', new Error('A plugin value is not JSON, so the references it holds are unknown.'))
            }
            if (read.status === 'ok') {
                scan.coldValue(read.value)
            }
        }
    } catch {
        scan.fail()
    }
}

/** The legacy list of every old file present, or the reason the backups cannot be enumerated. */
async function buildLegacyList(
    request: ConvertRequest, decoders: LegacyDecoders, reader: LegacyEntryReader, source: DecodedSource,
): Promise<{ list: LegacyList } | { reason: BlockedReason, detail: string }> {
    const builder = new LegacyListBuilder(request.listParams)
    if (source.origin.kind === 'main' && source.tree !== null) {
        await listFile(builder, LEGACY_MAIN_FILE_KEY, source.tree, reader)
    } else {
        builder.addUnreadable(LEGACY_MAIN_FILE_KEY)
    }
    // Only one decoded old file is held from here on.
    source.tree = null
    let times: number[]
    try {
        times = await request.listBackupTimes()
    } catch (error) {
        return { reason: 'backups-unlistable', detail: messageOf(error) }
    }
    for (const time of times) {
        const key = backupKey(time)
        let tree: Database | null = null
        try {
            tree = await strictTreeOf(decoders, await readBytes(request.store, key))
        } catch {
            tree = null
        }
        if (tree === null) {
            builder.addUnreadable(key)
            continue
        }
        await listFile(builder, key, tree, reader)
    }
    return { list: builder.build() }
}

/** The install request with the legacy list as one more unit and the manifest's `legacyKeep` naming it. */
function withLegacyKeep(install: BuiltInstall, list: LegacyList): BuiltInstall {
    return {
        ...install,
        newUnits: install.newUnits + 1,
        async build(context) {
            const built = await install.build(context)
            const key = context.mint.unit()
            const bytes = encodeUnit(UNIT_TYPE.legacyList, list)
            built.units.push({ key, bytes })
            built.manifest.body.fixed.legacyKeep = {
                unit: refOfFrame(key, bytes),
                v: list.v,
                files: list.files.map(file => ({ key: file.key, status: file.status })),
            }
            return built
        },
    }
}

function resultOfInstall(result: FirstLifeResult, origin: ConvertOrigin): SettledResult {
    switch (result.status) {
        case 'installed':
            return {
                status: 'installed',
                manifestKey: result.manifestKey,
                flushed: result.flushed,
                fromBackup: origin.kind === 'backup' ? origin.backup : null,
            }
        case 'abandoned':
            return { status: 'reclassify' }
        case 'not-marked':
            return resultOfMarker(result.marker)
        case 'unknown':
            return blocked('install-unknown', result.cause.message)
        case 'invalid':
            return blocked('install-invalid', result.problem.kind)
        case 'upload-failed':
        case 'failed':
            return blocked(`install-${result.status}`, result.cause.message)
    }
}

/** A marker that did not land. A conflict, an abandonment, a lost response and a store that is no longer empty mean a peer moved first or the write may have landed. */
function resultOfMarker(marker: Extract<FirstLifeResult, { status: 'not-marked' }>['marker']): SettledResult {
    switch (marker.status) {
        case 'conflict':
        case 'abandoned':
        case 'unknown':
            return { status: 'reclassify' }
        case 'refused':
            return marker.reason === 'store-not-empty'
                ? { status: 'reclassify' }
                : blocked('presence-unknown', 'The store2 listing failed before the conversion marker was written.')
        case 'failed':
            return blocked('marker-failed', marker.cause.message)
    }
}

/**
 * The marker and the install, on the request's entry. The `exit` entry reaches `runExit` only from here, after every
 * question: a fence or marker is written only for an answer already given. A fenced marker that landed is installed by
 * the same `installBuilt` as a first-life one; any other exit outcome is passed through, with nothing of the install written.
 */
async function installOnEntry(
    request: ConvertRequest, install: BuiltInstall,
): Promise<FirstLifeResult | Extract<ConvertResult, { status: 'exit' }>> {
    const { entry } = request
    if (entry.kind === 'first-life') {
        return firstLifeInstall(request.backend, entry.grant, install, { owner: request.owner, env: request.env })
    }
    const env: KeyEnv = { ...defaultKeyEnv, ...request.env }
    const exit = await runExit(request.backend, entry.commitRead, { kind: 'convert' }, { owner: request.owner, env, foreignClear: entry.foreignClear })
    if (exit.status !== 'marked') {
        return { status: 'exit', exit }
    }
    return installBuilt({ backend: request.backend, env, marked: exit }, install)
}

/** Steps 4 to 7 of the conversion over a decoded source: resolve, ask, list, install. */
async function convertDecoded(request: ConvertRequest, hooks: ConvertHooks, decoders: LegacyDecoders, source: DecodedSource): Promise<SettledResult> {
    const reader = createLegacyStoreReader(request.readColdStorageItem)
    if (source.tree === null) {
        return blocked('convert-read-failed', 'The decoded tree is gone.')
    }
    let resolved
    try {
        resolved = await resolveLegacyTree(source.tree, reader, request.resolve)
    } catch (error) {
        if (error instanceof LegacyReadError) {
            return blocked('convert-read-failed', error.message)
        }
        throw error
    }
    if (resolved.incomplete.length > 0 && !(await hooks.confirmIncomplete(resolved.incomplete))) {
        return { status: 'declined' }
    }
    const listed = await buildLegacyList(request, decoders, reader, source)
    if ('reason' in listed) {
        return blocked(listed.reason, listed.detail)
    }
    const plan = await planWholeTreeInstall(resolved.database, {
        lists: request.lists,
        env: request.env,
        convertedFrom: source.fingerprint,
    })
    const result = await installOnEntry(request, withLegacyKeep(plan, listed.list))
    if (result.status === 'exit') {
        return result
    }
    return resultOfInstall(result, source.origin)
}

/**
 * The default conversion: the strict decode of the main file, else of the newest numbered backup that decodes. Every
 * later question (what could not be brought in) is asked through `hooks` before the marker.
 */
export async function convertLegacyProfile(request: ConvertRequest, hooks: ConvertStrictHooks): Promise<ConvertResult> {
    const decoders = request.decoders ?? defaultDecoders
    let read
    try {
        read = await readStrictSource(request, decoders)
    } catch (error) {
        return blocked('convert-read-failed', messageOf(error))
    }
    if ('tried' in read) {
        return { status: 'all-failed', backupsTried: read.tried }
    }
    if (read.source.origin.kind === 'backup' && !(await hooks.confirmFromBackup(read.source.origin.backup))) {
        return { status: 'declined' }
    }
    return convertDecoded(request, hooks, decoders, read.source)
}

/**
 * "Convert without these": the user-chosen exit when nothing decodes strictly. The lenient decode of the main file
 * leaves out each block it cannot use; every one is named to the user before the marker.
 */
export async function convertLegacyWithout(request: ConvertRequest, hooks: ConvertWithoutHooks): Promise<SettledResult> {
    const decoders = request.decoders ?? defaultDecoders
    let bytes: Uint8Array | null
    try {
        bytes = await readBytes(request.store, LEGACY_MAIN_FILE_KEY)
    } catch (error) {
        return blocked('convert-read-failed', messageOf(error))
    }
    if (bytes === null) {
        return blocked('convert-main-unreadable', 'The main file is absent or cannot be read as bytes.')
    }
    let decoded: LenientLegacyDecode
    try {
        decoded = await decoders.lenient(bytes)
    } catch (error) {
        return blocked('convert-lenient-failed', messageOf(error))
    }
    const fingerprint = fingerprintMainFile(bytes)
    bytes = null
    // Asked even when nothing was skipped: the strict decode failed, so the person agrees to a lenient read.
    if (!(await hooks.confirmSkipped(decoded.skipped))) {
        return { status: 'declined' }
    }
    return convertDecoded(request, hooks, decoders, { tree: decoded.tree, fingerprint, origin: { kind: 'lenient' } })
}
