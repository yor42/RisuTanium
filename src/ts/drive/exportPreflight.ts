import { language } from "src/lang"
import { alertNormalWait } from "../alert"
import type { RisuModule } from "../process/modules"
import type { character } from "../storage/database.svelte"
import type { ByteStore } from "../storage/store/contract"
import { isKnownUri } from "../util"
import type { ExportAssetSource } from "./assetPieces"

/** An asset whose stored size is above this is large. Exactly this size is not. One number on every platform. */
export const LARGE_EXPORT_ASSET_BYTES = 64 * 1024 * 1024

/** The ZIP64 sentinel: an archive offset or an entry size that reaches it cannot be written without ZIP64. */
export const ZIP_SENTINEL = 0xFFFFFFFF

/**
 * Headroom kept below the sentinel when a CharX is estimated. The estimate cannot know the text metadata of a small
 * PNG (read only during the export), a size the page could not read, or what the image codec returns; the writer's
 * own backstop (`CharxTooLargeError`) covers whatever this margin does not.
 */
export const CHARX_HEADROOM_MARGIN = 64 * 1024 * 1024

/** Allowance for the codec: an asset at or below the large threshold is estimated at this multiple of its stored size. */
const SMALL_ASSET_GROWTH = 1.0625

/** The most `x_meta` JSON a large asset gets: `{"type": ...}` only. */
const META_JSON_BOUND = 32

const ZIP_LOCAL_HEADER = 30
const ZIP_DATA_DESCRIPTOR = 16
const ZIP_CENTRAL_RECORD = 46
const ZIP_END_RECORD = 22
const STORED_BLOCK_BYTES = 65536
const STORED_BLOCK_OVERHEAD = 5

export type ExportFormat = 'png' | 'json' | 'risum' | 'charx' | 'realm'

/** One asset an export reads, in the exact order the export loop reads it. */
export interface ExportAssetEntry {
    /** Position in the source list (the card's asset array, the vits key order or the module's asset array). */
    index: number
    key: string
    /** The name the user sees in a notice. */
    name: string
    /** The card portrait (`ccdefault:`): already read whole, so it is counted by the estimate and never size-checked. */
    portrait: boolean
}

export type PreflightResult =
    | { kind: 'ok', large: Map<string, number> }
    | { kind: 'refuse-large', names: string[] }
    | { kind: 'refuse-total', total: number }

export type PreflightOk = Extract<PreflightResult, { kind: 'ok' }>

export interface PreflightExtra {
    /** Bytes of the card portrait, counted once per occurrence (`ccdefault:` entry). */
    portraitBytes?: number
    /** Bytes of the portrait written in front of the archive by a `charxJpeg` export. */
    jpegPrefixBytes?: number
    /** An estimate of `card.json` and `module.risum` together; not a bound (the headroom margin and the backstop cover the rest). */
    metadataBytes?: number
}

/** The v3 asset fields the list reads. */
export interface ExportCardAsset {
    uri: string
    name: string
}

/**
 * The assets a card export reads, in the order its loops read them.
 *
 * A v2 export reads assets only from the vits files: the loops over emotions and additional assets find nothing
 * because `createBaseV2` leaves those fields out, so they are not listed (and those loops are left as they are). A v3
 * export reads `card.data.assets` (`v3Assets`) in order, skipping every known URI, with `ccdefault:` mapped to the
 * portrait unless the card is a PNG.
 */
export function listExportAssets(
    char: character,
    spec: 'v2' | 'v3',
    type: 'png' | 'json' | 'charx' | 'charxJpeg',
    v3Assets: ReadonlyArray<ExportCardAsset> = [],
): ExportAssetEntry[] {
    const entries: ExportAssetEntry[] = []
    if (spec === 'v2') {
        if (char.vits && char.ttsMode === 'vits') {
            const names = Object.keys(char.vits.files)
            for (let i = 0; i < names.length; i++) {
                entries.push({ index: i, key: char.vits.files[names[i]], name: names[i], portrait: false })
            }
        }
        return entries
    }
    for (let i = 0; i < v3Assets.length; i++) {
        const uri = v3Assets[i].uri
        const name = v3Assets[i].name || `asset_${i + 1}`
        if (uri === 'ccdefault:' && type !== 'png') {
            entries.push({ index: i, key: char.image, name, portrait: true })
        }
        else if (!isKnownUri(uri)) {
            entries.push({ index: i, key: uri, name, portrait: false })
        }
    }
    return entries
}

/** The assets `exportModuleLegacy` reads, in its loop order. */
export function listModuleAssets(module: RisuModule): ExportAssetEntry[] {
    const assets = module.assets ?? []
    return assets.map((asset, index) => ({ index, key: asset[1], name: asset[0] || `asset_${index + 1}`, portrait: false }))
}

/** Only a key under `assets/` is read through the byte store, so only it can be sized (and be large). */
function isSizableKey(key: string): boolean {
    return key.startsWith('assets/')
}

/**
 * The page's byte store, or `null` when it cannot be selected (sizes are then unknown, which is not large). The store
 * module is imported at call time rather than at the top of this file, so importing the preflight adds no module to the
 * import graph of its callers; the running app has it loaded already.
 */
export async function appStoreOrNull(): Promise<ByteStore | null> {
    try {
        const { getAppStore } = await import("../storage/store/appStore")
        return await getAppStore()
    } catch {
        return null
    }
}

function utf8Length(text: string): number {
    return new TextEncoder().encode(text).length
}

/**
 * Bytes an archive spends on one entry besides its data: the local header, the data descriptor, the central record,
 * the name in both, and the stored-block framing of its data. `nameBytes` is an upper bound of the entry path.
 */
function entryOverhead(nameBytes: number, dataBytes: number): number {
    return ZIP_LOCAL_HEADER + ZIP_DATA_DESCRIPTOR + ZIP_CENTRAL_RECORD + 2 * nameBytes
        + STORED_BLOCK_OVERHEAD * Math.ceil(dataBytes / STORED_BLOCK_BYTES)
}

/** An upper bound of the path of an asset entry (`assets/<kind>/<type>/<name>_<n>.<ext>`) from its display name. */
function assetPathBound(name: string): number {
    return 40 + Math.min(utf8Length(name.slice(0, 100)), 400) + 8 + 17
}

/** An upper bound of the path of the entry's `x_meta/<name>_<n>.json`. */
function metaPathBound(name: string): number {
    return 7 + Math.min(utf8Length(name.slice(0, 100)), 400) + 8 + 5
}

/**
 * The bytes a CharX of `entries` is expected to take, counted per occurrence: every entry at its stored size (a
 * non-large asset with the codec allowance), its type-only `x_meta`, the portrait once per occurrence, `card.json`
 * and `module.risum` as bounded by the caller, and the archive framing. A size that is not known counts as 0 and
 * the text metadata of a small PNG is not counted; the writer's backstop covers both.
 */
export function estimateCharxBytes(
    entries: ReadonlyArray<ExportAssetEntry>,
    sizes: ReadonlyMap<string, number | null>,
    extra: PreflightExtra,
): number {
    let total = ZIP_END_RECORD + (extra.jpegPrefixBytes ?? 0)
    const metadata = extra.metadataBytes ?? 0
    total += metadata + entryOverhead(utf8Length('card.json'), metadata) + entryOverhead(utf8Length('module.risum'), 0)
    for (const entry of entries) {
        let size: number
        if (entry.portrait) {
            size = extra.portraitBytes ?? 0
        }
        else {
            const stored = sizes.get(entry.key) ?? 0
            size = stored > LARGE_EXPORT_ASSET_BYTES ? stored : Math.ceil(stored * SMALL_ASSET_GROWTH)
        }
        total += size + entryOverhead(assetPathBound(entry.name), size)
        total += META_JSON_BOUND + entryOverhead(metaPathBound(entry.name), META_JSON_BOUND)
    }
    return total
}


/**
 * Sizes the assets of an export through the source its pieces would come from, and decides before anything opens.
 * A size that cannot be read is unknown, which counts as not large (the asset then takes the whole-read path). A PNG,
 * JSON, `.risum` or Realm export with any large asset is refused (`refuse-large`, names in list order, once each); a
 * CharX whose estimate reaches the headroom is refused (`refuse-total`); otherwise `ok` carries the size of every large
 * key, which a streaming write takes as the size it expects.
 */
export async function preflightExport(
    entries: ReadonlyArray<ExportAssetEntry>,
    format: ExportFormat,
    getStore: () => Promise<ByteStore | null>,
    extra: PreflightExtra = {},
): Promise<PreflightResult> {
    const sizable = entries.filter((entry) => !entry.portrait && isSizableKey(entry.key))
    const sizes = new Map<string, number | null>()
    if (sizable.length > 0) {
        // Imported at call time so that importing the preflight adds nothing to its callers' import graph; the app has it loaded already.
        const { assetStoredSize, exportAssetPieceSource } = await import("./assetPieces")
        const store = await getStore()
        let source: ExportAssetSource | null = null
        if (store !== null) {
            try {
                source = await exportAssetPieceSource(store)
            } catch {
                source = null
            }
        }
        for (const entry of sizable) {
            if (!sizes.has(entry.key)) {
                sizes.set(entry.key, await assetStoredSize(entry.key, source))
            }
        }
    }
    const large = new Map<string, number>()
    const names: string[] = []
    for (const entry of sizable) {
        const size = sizes.get(entry.key)
        if (size !== null && size !== undefined && size > LARGE_EXPORT_ASSET_BYTES) {
            large.set(entry.key, size)
            if (!names.includes(entry.name)) {
                names.push(entry.name)
            }
        }
    }
    if (format !== 'charx') {
        return large.size > 0 ? { kind: 'refuse-large', names } : { kind: 'ok', large }
    }
    const total = estimateCharxBytes(entries, sizes, extra)
    if (total >= ZIP_SENTINEL - CHARX_HEADROOM_MARGIN) {
        return { kind: 'refuse-total', total }
    }
    return { kind: 'ok', large }
}

/**
 * Shows the notice of a refusal and resolves once it is answered. Returns whether the export was refused, so a caller
 * stops with `if (await refuseExport(result)) { return ... }`. A Realm share has its own wording, which does not
 * suggest CharX.
 */
export async function refuseExport(result: PreflightResult, forRealm: boolean = false): Promise<boolean> {
    if (result.kind === 'ok') {
        return false
    }
    if (result.kind === 'refuse-total') {
        await alertNormalWait(language.exportCharxTooLarge(result.total))
    }
    else {
        await alertNormalWait(forRealm
            ? language.realmLargeAssetRefused(result.names)
            : language.exportLargeAssetNeedsCharx(result.names))
    }
    return true
}
