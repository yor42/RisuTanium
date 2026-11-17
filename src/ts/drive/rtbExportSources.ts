/**
 * The inputs of an `.rtb` export that come from the page's stores and platform: the writer, the asset
 * and inlay sections and the platform label. Each reader works through an injected dependency record, so
 * a test drives it with fakes and the live record (`rtbExport.ts`) binds the real stores.
 *
 * Rules shared by the asset and inlay readers (they mirror the `.bin` export, so a value that one format
 * can read the other can read):
 *  - An entry that cannot be opened or read whole is left out and named (`unreadable`); the export goes on.
 *  - A network failure of a Node store (`ExportReadError`) never becomes an omission: it fails the export.
 *  - A body up to `bufferLimit` is collected before its entry is yielded, so a failure leaves no half entry.
 *    A larger body is streamed, and a failure after its entry began fails the export and names the entry.
 *  - Nothing here filters theme-pack archives: the closure's referenced set names every file that is carried.
 */
import { isNodeServer, isTauri } from 'src/ts/platform'
import type { ExportCancelToken } from '../exportCancel'
import { LocalWriter } from '../globalApi.svelte'
import type { ByteStore } from '../storage/store/contract'
import type { AssetReadResult, SizedAssetKey } from '../storage/tauriAssetBatch'
import { transportKind } from '../storage/tauriByteTransport'
import type { AssetsReferenced, InlaysReferenced } from '../storage/store2/rtb/referencedSet'
import { ExportAssetReader } from './assetBatchPipeline'
import { ExportAssetMissingError, openExportAssetPieces, type ExportAssetSource } from './assetPieces'
import { localBackupFileName } from './backupFileName'
import { BackupAssetChangedError, type ExportSession } from './exportShell'
import { ExportReadError, openInlay, type ExportableInlay, type PieceOpener } from './inlayBackupExport'
import type { AssetInput, InlayInput } from './rtb/rtbWriter'
import type { OmittedEntry } from './rtb/manifest'
import { DEFAULT_BUFFER_LIMIT, type ZipPiece } from './rtb/zip64Writer'
import type { AssetBatchLimits } from './assetBatchPipeline'

export type RtbExportProgress =
    | { phase: 'opening' }
    | { phase: 'saving' }
    | { phase: 'units', units: number }
    | { phase: 'side', section: string }
    | { phase: 'inlays', done: number, total: number }
    | { phase: 'assets', done: number, total: number }
    | { phase: 'finishing' }

// ---------------------------------------------------------------- platform

export type RtbPlatformId = 'android' | 'tauri-windows' | 'tauri-macos' | 'tauri-linux' | 'node' | 'web'

/** The device block of the manifest: `label` is an English constant written into the file, never a locale string. */
export interface RtbPlatform {
    platform: RtbPlatformId
    label: string
}

export interface RtbPlatformFacts {
    isTauri: boolean
    isNodeServer: boolean
    transport: string
    userAgent: string
}

export function platformOfFacts(facts: RtbPlatformFacts): RtbPlatform {
    if (facts.isTauri) {
        if (facts.transport === 'android') {
            return { platform: 'android', label: 'Android app' }
        }
        if (/Windows/.test(facts.userAgent)) {
            return { platform: 'tauri-windows', label: 'Windows app' }
        }
        if (/Macintosh|Mac OS X/.test(facts.userAgent)) {
            return { platform: 'tauri-macos', label: 'macOS app' }
        }
        return { platform: 'tauri-linux', label: 'Linux app' }
    }
    return facts.isNodeServer ? { platform: 'node', label: 'Hosted page' } : { platform: 'web', label: 'Browser' }
}

export function livePlatform(): RtbPlatform {
    return platformOfFacts({
        isTauri,
        isNodeServer,
        transport: isTauri ? transportKind() : '',
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    })
}

// ---------------------------------------------------------------- writer

/** `local-YYYYMMDD.rtb`, the device's local date. */
export function rtbBackupFileName(date: Date): string {
    return localBackupFileName(date).replace(/\.bin$/, '.rtb')
}

/**
 * The one call that opens an export writer. The session carries it at once, so a cancel that arrives while a
 * dialog is open reaches the writer. `null` means the person closed the save dialog.
 */
export async function openRtbWriter(session: ExportSession, fileName: string): Promise<LocalWriter | null> {
    const writer = new LocalWriter()
    session.writer = writer
    const opened = await writer.init('RisuTanium backup', ['rtb'], fileName, session.cancel)
    return opened ? writer : null
}

// ---------------------------------------------------------------- assets

export interface RtbAssetDeps {
    /** The sized listing where the batch commands answer; `null` where they do not or failed (the store's listing is used). */
    listSized(): Promise<SizedAssetKey[] | null>
    readBatch(keys: readonly string[]): Promise<AssetReadResult[]>
    readerLimits: Partial<AssetBatchLimits>
    /** The piece source of the page's store; `null` where only whole reads exist. */
    pieceSource(store: ByteStore): Promise<ExportAssetSource | null>
    /** A body up to this size is collected whole. */
    bufferLimit?: number
}

export interface RtbSectionContext {
    cancel: ExportCancelToken
    /** What the section left out as unreadable; the manifest names it. */
    lateOmitted: OmittedEntry[]
    onProgress: (event: RtbExportProgress) => void
}

const ASSET_PREFIX = 'assets/'

function writerKey(storeKey: string): string {
    return storeKey.startsWith(ASSET_PREFIX) ? storeKey.slice(ASSET_PREFIX.length) : storeKey
}

export interface AssetListing {
    keys: string[]
    /** Index-aligned with `keys`, or null when the store listing was used. */
    sized: SizedAssetKey[] | null
}

/** The assets the export carries: the store's listing, filtered by the referenced set in one step that keeps keys and sizes aligned. */
export async function listRtbAssets(store: ByteStore, deps: RtbAssetDeps, referenced: AssetsReferenced): Promise<AssetListing> {
    const sized = await deps.listSized()
    const keys = sized !== null ? sized.map((item) => item.key) : await store.list(ASSET_PREFIX)
    if (referenced.mode === 'all') {
        return { keys, sized }
    }
    const keep = keys.map((key) => referenced.holds(key))
    return {
        keys: keys.filter((_, index) => keep[index]),
        sized: sized === null ? null : sized.filter((_, index) => keep[index]),
    }
}

async function* once(bytes: Uint8Array): AsyncGenerator<ZipPiece> {
    yield bytes
}

function concatPieces(parts: readonly Uint8Array[], total: number): Uint8Array {
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

/** One asset read from its pieces: whole when it fits `bufferLimit`, else streamed. `null` when it cannot be read before its entry begins. */
async function assetFromPieces(key: string, source: ExportAssetSource, bufferLimit: number): Promise<AssetInput | null> {
    let opened: Awaited<ReturnType<typeof openExportAssetPieces>>
    try {
        opened = await openExportAssetPieces(key, source)
    } catch (error) {
        if (error instanceof ExportAssetMissingError) {
            return null
        }
        throw error
    }
    const { first, rest } = opened
    const total = first.total
    if (total <= bufferLimit) {
        try {
            const parts = [first.bytes]
            let length = first.bytes.length
            for (;;) {
                const next = await rest.next()
                if (next.done === true) {
                    break
                }
                parts.push(next.value.bytes)
                length += next.value.bytes.length
            }
            if (length !== total) {
                return null
            }
            return { key: writerKey(key), size: total, body: once(concatPieces(parts, total)) }
        } catch (error) {
            if (error instanceof ExportReadError) {
                throw error
            }
            return null
        } finally {
            await rest.return(undefined).catch(() => { })
        }
    }
    async function* streamed(): AsyncGenerator<ZipPiece> {
        try {
            yield first.bytes
            let written = first.bytes.length
            for (;;) {
                let next: IteratorResult<{ bytes: Uint8Array }, void>
                try {
                    next = await rest.next()
                } catch (error) {
                    throw new BackupAssetChangedError(key, error)
                }
                if (next.done === true) {
                    break
                }
                yield next.value.bytes
                written += next.value.bytes.length
            }
            if (written !== total) {
                throw new BackupAssetChangedError(key, new Error(`${written} of ${total} bytes were read`))
            }
        } finally {
            await rest.return(undefined).catch(() => { })
        }
    }
    return { key: writerKey(key), size: total, body: streamed() }
}

/**
 * The asset section: starts at its first pull, builds the batch reader over the filtered listing and closes it on
 * every exit of the generator, which the writer's `for await` triggers on a throw or a cancel.
 */
export async function* rtbAssetInputs(store: ByteStore, deps: RtbAssetDeps, referenced: AssetsReferenced, context: RtbSectionContext): AsyncGenerator<AssetInput> {
    const bufferLimit = deps.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    const listing = await listRtbAssets(store, deps, referenced)
    const total = listing.keys.length
    context.onProgress({ phase: 'assets', done: 0, total })
    const reader = listing.sized !== null ? new ExportAssetReader({ readBatch: deps.readBatch }, listing.sized, deps.readerLimits) : null
    try {
        const source = await deps.pieceSource(store)
        for (let i = 0; i < total; i++) {
            const key = listing.keys[i]
            context.cancel.throwIfCancelled()
            const taken = reader !== null ? await reader.take(i) : null
            let input: AssetInput | null
            if (taken?.kind === 'bytes') {
                input = { key: writerKey(key), size: taken.bytes.length, body: once(taken.bytes) }
            } else if (taken?.kind === 'missing') {
                input = null
            } else if (source !== null) {
                input = await assetFromPieces(key, source, bufferLimit)
            } else {
                let bytes: Uint8Array | null = null
                try {
                    bytes = (await store.read(key)).bytes
                } catch (error) {
                    console.error(error)
                }
                input = bytes === null ? null : { key: writerKey(key), size: bytes.length, body: once(bytes) }
            }
            if (input === null) {
                context.lateOmitted.push({ kind: 'asset', name: writerKey(key), reason: 'unreadable' })
            } else {
                yield input
            }
            context.onProgress({ phase: 'assets', done: i + 1, total })
        }
    } finally {
        await reader?.close()
    }
}

// ---------------------------------------------------------------- inlays

export interface RtbInlayOptions {
    streaming: boolean
    openPieces?: PieceOpener
    pieceBytes?: number
}

export interface RtbInlayDeps {
    /** The ids of the old browser store; a rejection marks the old store as unlisted. */
    legacyKeys(): Promise<string[]>
    appIds(store: ByteStore): Promise<string[]>
    open: typeof openInlay
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>
    options(): Promise<RtbInlayOptions>
    bufferLimit?: number
}

export interface RtbInlayState {
    oldStoreUnlisted: boolean
    /** Ids left out as `unsupported` by `openInlay`; the manifest names them `unreadable`. */
    unsupported: string[]
}

/** Inlay bodies above `bufferLimit` are read in pieces of this size. */
const INLAY_PIECE_BYTES = 4 * 1024 * 1024

type Prepared =
    | { kind: 'ready', input: InlayInput, source: ExportableInlay['source'] }
    | { kind: 'left-out', reason: 'unreadable' | 'unsupported' }

async function prepareInlay(store: ByteStore, deps: RtbInlayDeps, options: RtbInlayOptions, id: string, bufferLimit: number): Promise<Prepared> {
    for (const fromApp of [true, false]) {
        let inlay: ExportableInlay | 'unsupported' | null
        try {
            inlay = await deps.open(store, id, options.streaming, fromApp, options.openPieces, options.pieceBytes)
        } catch (error) {
            console.warn('An inlay could not be read:', error)
            inlay = null
        }
        if (inlay === null) {
            continue
        }
        if (inlay === 'unsupported') {
            return { kind: 'left-out', reason: 'unsupported' }
        }
        const record = { v: 1 as const, repr: inlay.repr, mime: inlay.mime, len: inlay.len, fields: inlay.fields, body: '' }
        const firstCount = Math.min(inlay.len, inlay.len <= bufferLimit ? inlay.len : INLAY_PIECE_BYTES)
        let first: Uint8Array
        try {
            first = await inlay.source.take(firstCount)
        } catch (error) {
            await inlay.source.close().catch(() => { })
            if (error instanceof ExportReadError) {
                throw error
            }
            console.warn('An inlay could not be read to its end and is left out of the backup:', error)
            continue
        }
        if (inlay.len <= bufferLimit) {
            await inlay.source.close().catch(() => { })
            return { kind: 'ready', input: { id, record, body: once(first) }, source: inlay.source }
        }
        const source = inlay.source
        const len = inlay.len
        async function* streamed(): AsyncGenerator<ZipPiece> {
            yield first
            let remaining = len - first.length
            while (remaining > 0) {
                const count = Math.min(remaining, INLAY_PIECE_BYTES)
                let piece: Uint8Array
                try {
                    piece = await source.take(count)
                } catch (error) {
                    if (error instanceof ExportReadError) {
                        throw error
                    }
                    throw new BackupAssetChangedError(id, error)
                }
                remaining -= count
                yield piece
            }
        }
        return { kind: 'ready', input: { id, record, body: streamed() }, source }
    }
    return { kind: 'left-out', reason: 'unreadable' }
}

/**
 * The inlay section: ids of the old store and the app store, de-duplicated and filtered by the referenced set. A
 * body that fits `bufferLimit` is read whole under the inlay's lock before its entry is yielded; a larger one is
 * streamed after the lock is released, and a change during that stream fails the export naming the inlay.
 */
export async function* rtbInlayInputs(store: ByteStore, deps: RtbInlayDeps, referenced: InlaysReferenced, state: RtbInlayState, context: RtbSectionContext): AsyncGenerator<InlayInput> {
    const bufferLimit = deps.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    let legacyIds: string[] = []
    try {
        legacyIds = await deps.legacyKeys()
    } catch (error) {
        console.warn('The old inlay store could not be listed:', error)
        state.oldStoreUnlisted = true
    }
    const appIds = await deps.appIds(store)
    const ids = [...new Set([...legacyIds, ...appIds])].filter((id) => referenced.mode === 'all' || referenced.includes(id))
    const options = await deps.options()
    context.onProgress({ phase: 'inlays', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        context.cancel.throwIfCancelled()
        const prepared = await deps.withLock(id, () => prepareInlay(store, deps, options, id, bufferLimit))
        if (prepared.kind === 'left-out') {
            if (prepared.reason === 'unsupported') {
                state.unsupported.push(id)
            }
            context.lateOmitted.push({ kind: 'inlay', name: id, reason: 'unreadable' })
        } else {
            try {
                yield prepared.input
            } finally {
                await prepared.source.close().catch(() => { })
            }
        }
        context.onProgress({ phase: 'inlays', done: i + 1, total: ids.length })
    }
}
