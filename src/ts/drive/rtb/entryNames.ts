/**
 * Entry names of an `.rtb` file (A1.4, A3.1-A3.4): which section owns a name, and the
 * canonical name forms of the sections version 1 knows.
 *
 * A canonical form is held only to an entry of a known row (its id and `v` together,
 * never its prefix): an unknown optional row gets the path rules and its counts, and
 * nothing else.
 */
import { decodeInlayId, encodeInlayId } from '../../process/files/inlayKeys'
import { ASSET_PREFIX, unescAssetName } from './assetName'

export const MIMETYPE_ENTRY = 'mimetype'
export const MANIFEST_ENTRY = 'manifest.json'

export const STORE2_ID = 'store2'
export const ASSETS_ID = 'assets'
export const INLAYS_ID = 'inlays'

/** The three required rows and the prefix each owns at `v` 1. */
export const RESERVED_ROW_PREFIX: Readonly<Record<string, string>> = {
    [STORE2_ID]: 'u/',
    [ASSETS_ID]: ASSET_PREFIX,
    [INLAYS_ID]: 'i/',
}

const SIDE_NAMES = ['iris', 'google-search', 'hypa-vector', 'plugin-safe', 'plugin-safe-ls', 'plugin-permissions', 'mcp-tool-calls', 'ui-prefs'] as const

/** The eight optional side sections of version 1 (`side.<name>`, prefix `s/<name>/`). */
export const SIDE_SECTION_IDS: readonly string[] = SIDE_NAMES.map((name) => `side.${name}`)

const SIDE_NAME_SET: ReadonlySet<string> = new Set<string>(SIDE_NAMES)

/** The prefix a version 1 side id owns, or null for any other id. */
export function sidePrefix(id: string): string | null {
    if (!id.startsWith('side.')) {
        return null
    }
    const name = id.slice('side.'.length)
    return SIDE_NAME_SET.has(name) ? `s/${name}/` : null
}

const STORE_BLOCK = /^u\/([1-9][0-9]{0,2})\/(0|[1-9][0-9]{0,14})\.blk$/

/** `u/<type>/<seq>.blk` with a decimal type of 1-255 and a seq from 0, neither with leading zeros. */
export function parseStoreBlockName(name: string): { type: number, seq: number } | null {
    const match = STORE_BLOCK.exec(name)
    if (!match) {
        return null
    }
    const type = Number(match[1])
    return type >= 1 && type <= 255 ? { type, seq: Number(match[2]) } : null
}

export function storeBlockName(type: number, seq: number): string {
    return `u/${type}/${seq}.blk`
}

export type InlayPart = 'meta' | 'body'

/** `i/<enc>.meta` or `i/<enc>.body` where `enc` is the canonical encoding of an inlay id and holds no dot. */
export function parseInlayEntryName(name: string): { id: string, enc: string, part: InlayPart } | null {
    if (!name.startsWith('i/')) {
        return null
    }
    const dot = name.lastIndexOf('.')
    if (dot < 0) {
        return null
    }
    const suffix = name.slice(dot + 1)
    if (suffix !== 'meta' && suffix !== 'body') {
        return null
    }
    const enc = name.slice('i/'.length, dot)
    if (enc.length === 0 || enc.includes('.')) {
        return null
    }
    const id = decodeInlayId(enc)
    return id === null ? null : { id, enc, part: suffix }
}

export function inlayEntryName(id: string, part: InlayPart): string | null {
    const enc = encodeInlayId(id)
    return enc === null ? null : `i/${enc}.${part}`
}

/** The single entry a side section holds. */
export function sideDataName(id: string): string | null {
    const prefix = sidePrefix(id)
    return prefix === null ? null : `${prefix}data.jsonl`
}

/**
 * Why `name` is not a canonical name of the known row `rowId`, or null when it is.
 * Only called for an entry of a row the reader knows.
 */
export function checkKnownEntryName(rowId: string, name: string): string | null {
    if (rowId === STORE2_ID) {
        return parseStoreBlockName(name) === null ? 'the name is not u/<type>/<seq>.blk' : null
    }
    if (rowId === ASSETS_ID) {
        return name.startsWith(ASSET_PREFIX) && unescAssetName(name.slice(ASSET_PREFIX.length)) !== null
            ? null
            : 'the name is not a/ plus a canonical escaped key'
    }
    if (rowId === INLAYS_ID) {
        return parseInlayEntryName(name) === null ? 'the name is not i/<enc>.meta or i/<enc>.body' : null
    }
    const data = sideDataName(rowId)
    if (data !== null) {
        return name === data ? null : `the name is not ${data}`
    }
    return null
}

/** Which row owns an entry: a row index, `root` for `mimetype` and `manifest.json`, or `outside` for any other name. */
export function ownerOfName(name: string, rowIndexByPrefix: ReadonlyMap<string, number>): number | 'root' | 'outside' {
    if (name === MIMETYPE_ENTRY || name === MANIFEST_ENTRY) {
        return 'root'
    }
    for (let slash = name.indexOf('/'); slash >= 0; slash = name.indexOf('/', slash + 1)) {
        const row = rowIndexByPrefix.get(name.slice(0, slash + 1))
        if (row !== undefined) {
            return row
        }
    }
    return 'outside'
}
