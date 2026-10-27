import { isNodeServer } from "src/ts/platform"
import { pieceStoreOrNull } from "../globalApi.svelte"
import { getAppStoreKind } from "../storage/store/appStore"
import type { ByteStore } from "../storage/store/contract"
import { assetOrInlayBodyKeyViolation } from "../storage/store/keyRules"
import { isDesktopTransport, readRangedPieces, statStoredSize, transportKind } from "../storage/tauriByteTransport"
import { nodePieceOpener, openFirstPiece, type PieceOpener, type ReadPiece } from "./inlayBackupExport"

/**
 * Whether this page is the desktop app on its own files store, where an asset
 * above `CHUNK_MAX` is written and read in pieces and never as one value.
 */
export async function desktopStreamingUsable(): Promise<boolean> {
    if (!isDesktopTransport()) {
        return false
    }
    try {
        return await getAppStoreKind() === 'tauri'
    } catch {
        return false
    }
}

/**
 * Where an export reads an asset's pieces from. `node` selects the Node store's rules for the first piece
 * (see `writeAssetStreamed`); the desktop's source keeps its own.
 */
export interface AssetPieceSource {
    open: PieceOpener
    node: boolean
}

export const DESKTOP_PIECE_SOURCE: AssetPieceSource = { open: (key) => readRangedPieces(key), node: false }

/**
 * Piece size of an Android export's ranged reads. It bounds what one `read_range` reply holds at the renderer
 * (an ArrayBuffer, or a number array that costs several times the piece in JS memory) and sets the call count
 * (512 per GiB). It does not size the writer's calls: `TauriWriter` coalesces writes of up to its 4 MiB chunk into
 * one buffer, so the append calls stay at 4 MiB.
 */
export const ANDROID_EXPORT_PIECE_BYTES = 2 * 1024 * 1024

export const ANDROID_PIECE_SOURCE: AssetPieceSource = { open: (key) => readRangedPieces(key, ANDROID_EXPORT_PIECE_BYTES), node: false }

/**
 * The ranged piece source of an export on the app's own files store: the desktop's, or the Android one with
 * smaller pieces; `null` elsewhere. Unlike `desktopStreamingUsable`, which the restore keeps using, this also
 * answers on Android, so no asset above one piece is read whole through the store there (small assets still come
 * back whole in batch replies).
 */
export async function exportTauriPieceSource(): Promise<AssetPieceSource | null> {
    if (await desktopStreamingUsable()) {
        return DESKTOP_PIECE_SOURCE
    }
    if (transportKind() !== 'android') {
        return null
    }
    try {
        return await getAppStoreKind() === 'tauri' ? ANDROID_PIECE_SOURCE : null
    } catch {
        return null
    }
}

/**
 * The Node store when this page is served by the Node server and its recorded capability says the server takes
 * pieces (`pieceStoreOrNull` probes once if none is recorded); `null` keeps every whole-value path.
 */
export async function nodePieceStore(): Promise<ByteStore | null> {
    if (!isNodeServer) {
        return null
    }
    try {
        const store = await pieceStoreOrNull()
        return store !== null && store.readPieces !== undefined && store.piecesRecorded !== undefined ? store : null
    } catch {
        return null
    }
}

/** The Node page's asset piece source, or `null` where the whole-value paths stay. */
export async function nodeAssetPieceSource(): Promise<AssetPieceSource | null> {
    const store = await nodePieceStore()
    return store === null ? null : { open: nodePieceOpener(store), node: true }
}

/** The size of the slices a Blob-valued browser asset is exported in. */
export const WEB_BLOB_EXPORT_PIECE_BYTES = 4 * 1024 * 1024

/**
 * The browser store's piece source, or `null` for a store that does not offer `readValue`. One `readValue` loads the
 * asset once: a Blob is read in slices so its bytes are never held whole, bytes come as one piece, and an absent key
 * yields nothing (`missing`). A read that fails after the first piece raises `BackupAssetChangedError` in
 * `writeAssetStreamed`, so an asset is never silently left out of the file once its entry has begun.
 */
export function webBlobPieceSource(store: ByteStore): AssetPieceSource | null {
    const readValue = store.readValue?.bind(store)
    if (readValue === undefined) {
        return null
    }
    return {
        node: false,
        open: async function* (key: string): AsyncGenerator<ReadPiece, void, undefined> {
            if (assetOrInlayBodyKeyViolation(key) !== null) {
                // A key upstream wrote that the store can address but not create has no Blob form: read it whole.
                const { bytes } = await store.read(key)
                if (bytes !== null) {
                    yield { bytes, total: bytes.length }
                }
                return
            }
            const value = await readValue(key)
            if (value === null) {
                return
            }
            if (!(value instanceof Blob)) {
                yield { bytes: value, total: value.length }
                return
            }
            if (value.size === 0) {
                yield { bytes: new Uint8Array(0), total: 0 }
                return
            }
            for (let start = 0; start < value.size; start += WEB_BLOB_EXPORT_PIECE_BYTES) {
                const bytes = new Uint8Array(await value.slice(start, Math.min(start + WEB_BLOB_EXPORT_PIECE_BYTES, value.size)).arrayBuffer())
                yield { bytes, total: value.size }
            }
        },
    }
}

/**
 * The piece source an asset export reads through, with the kind of store it came from and that store, so the size
 * of an asset and its pieces always come from one choice.
 */
export interface ExportAssetSource {
    kind: 'tauri' | 'node' | 'web'
    pieces: AssetPieceSource
    store: ByteStore
}

/**
 * The source an asset export uses, in the order the backup export chooses: the app's files store, then the Node
 * server's pieces, then the browser store's `readValue`. `null` where none applies (OPFS and other stores without
 * `readValue`), which keeps the whole-read path.
 */
export async function exportAssetPieceSource(store: ByteStore): Promise<ExportAssetSource | null> {
    const tauri = await exportTauriPieceSource()
    if (tauri !== null) {
        return { kind: 'tauri', pieces: tauri, store }
    }
    const node = await nodeAssetPieceSource()
    if (node !== null) {
        return { kind: 'node', pieces: node, store }
    }
    const web = webBlobPieceSource(store)
    return web === null ? null : { kind: 'web', pieces: web, store }
}

/** The first piece of an asset could not be read: the key is absent or unreadable. An export never skips such an asset. */
export class ExportAssetMissingError extends Error {
    constructor(public readonly key: string, cause?: unknown) {
        super(`The asset ${key} could not be read for the export`, { cause })
        this.name = 'ExportAssetMissingError'
    }
}

/**
 * Opens `key` and awaits its first piece; the caller writes `first`, then every piece of `rest`. A missing or
 * unreadable first piece throws `ExportAssetMissingError`. On a Node source a first range that fails twice throws
 * `ExportReadError` instead (the network failed, not the value). The generator is closed whenever this throws.
 */
export async function openExportAssetPieces(
    key: string,
    source: ExportAssetSource,
): Promise<{ first: ReadPiece, rest: AsyncGenerator<ReadPiece, void, undefined> }> {
    if (source.kind === 'node') {
        const opened = await openFirstPiece(source.pieces.open, key)
        if (opened === null) {
            throw new ExportAssetMissingError(key)
        }
        if (opened.first.done === true) {
            await opened.pieces.return(undefined).catch(() => { })
            throw new ExportAssetMissingError(key)
        }
        return { first: opened.first.value, rest: opened.pieces }
    }
    const pieces = source.pieces.open(key)
    let first: IteratorResult<ReadPiece, void>
    try {
        first = await pieces.next()
    } catch (error) {
        await pieces.return(undefined).catch(() => { })
        throw new ExportAssetMissingError(key, error)
    }
    if (first.done === true) {
        throw new ExportAssetMissingError(key)
    }
    return { first: first.value, rest: pieces }
}

/**
 * The stored size of `key` through the same source its pieces will come from, or `null` when it is unknown: no
 * source, an absent key, or any error while sizing. The Tauri store answers from its file metadata; the browser
 * store from one `readValue` (a Blob's size, or the bytes' length); the Node store from its first piece, which is
 * then closed.
 */
export async function assetStoredSize(key: string, source: ExportAssetSource | null): Promise<number | null> {
    if (source === null) {
        return null
    }
    try {
        if (source.kind === 'tauri') {
            return await statStoredSize(key)
        }
        if (source.kind === 'web') {
            const readValue = source.store.readValue?.bind(source.store)
            if (readValue === undefined || assetOrInlayBodyKeyViolation(key) !== null) {
                return null
            }
            const value = await readValue(key)
            if (value === null) {
                return null
            }
            return value instanceof Blob ? value.size : value.length
        }
        const opened = await openFirstPiece(source.pieces.open, key)
        if (opened === null) {
            return null
        }
        try {
            return opened.first.done === true ? null : opened.first.value.total
        } finally {
            await opened.pieces.return(undefined).catch(() => { })
        }
    } catch {
        return null
    }
}
