// The optional raster icon of a theme pack: what a still PNG or WebP header says about its size, the install-time check of
// the icon a manifest names, and the render-time loader that re-judges the stored bytes before anything decodes them.
// The bytes are hostile: only headers are read here, never pixel data, and a header that cannot be read fails closed.
import { rangeSourceFrom } from '../drive/rtb/rangeSource'
import { readVerifiedFile, type IntakeRefusal, type VerifiedPack } from './intake'
import { PACK_ICON_KEY } from './packRefs'
import { SNIFF_BYTES, sniffPackFile } from './sniff'

/** The largest icon file, in bytes. Far below the size at which the store keeps an asset in pieces, so an icon is always stored as bytes. */
export const PACK_ICON_MAX_BYTES = 262144
/** The largest icon side, in pixels. */
export const PACK_ICON_MAX_SIDE = 512

export type IconMime = 'image/png' | 'image/webp'
export interface IconHeader {
    width: number
    height: number
    /** True for an animated PNG or WebP: such an icon is refused. */
    animated: boolean
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
/** A bound on the chunk walk, so a file of many tiny chunks ends. */
const MAX_CHUNKS = 4096

function ascii(bytes: Uint8Array, at: number, length: number): string {
    let text = ''
    for (let i = 0; i < length; i++) {
        text += String.fromCharCode(bytes[at + i])
    }
    return text
}

function u32be(bytes: Uint8Array, at: number): number {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function u32le(bytes: Uint8Array, at: number): number {
    return ((bytes[at + 3] << 24) | (bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]) >>> 0
}

function u24le(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
}

function u16le(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8)
}

function inspectPng(bytes: Uint8Array): IconHeader | null {
    if (bytes.length < 33) {
        return null
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) {
            return null
        }
    }
    if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') {
        return null
    }
    const width = u32be(bytes, 16)
    const height = u32be(bytes, 20)
    if (width === 0 || height === 0) {
        return null
    }
    // Any `acTL` chunk, before or after the image data, makes the file animated. A chunk that runs past the end, or more
    // chunks than the bound, means the walk cannot vouch for the file.
    let animated = false
    let at = 8
    for (let count = 0; at < bytes.length; count++) {
        if (count >= MAX_CHUNKS || at + 12 > bytes.length) {
            return null
        }
        const length = u32be(bytes, at)
        const next = at + 12 + length
        if (next > bytes.length) {
            return null
        }
        if (ascii(bytes, at + 4, 4) === 'acTL') {
            animated = true
        }
        at = next
    }
    return { width, height, animated }
}

/** The dimensions a `VP8 ` or `VP8L` image chunk gives, from its payload start `p` and size; null when it cannot be read. */
function stillSize(bytes: Uint8Array, fourcc: string, p: number, size: number): { width: number; height: number } | null {
    if (fourcc === 'VP8 ') {
        if (size < 10 || bytes[p + 3] !== 0x9D || bytes[p + 4] !== 0x01 || bytes[p + 5] !== 0x2A) {
            return null
        }
        const width = u16le(bytes, p + 6) & 0x3FFF
        const height = u16le(bytes, p + 8) & 0x3FFF
        return width === 0 || height === 0 ? null : { width, height }
    }
    if (size < 5 || bytes[p] !== 0x2F) {
        return null
    }
    const bits = u32le(bytes, p + 1)
    return { width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1 }
}

function inspectWebp(bytes: Uint8Array): IconHeader | null {
    if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32le(bytes, 4) !== bytes.length - 8) {
        return null
    }
    let canvas: { width: number; height: number } | null = null
    let flagAnimated = false
    let animated = false
    let still: { width: number; height: number } | null = null
    let at = 12
    for (let count = 0; at + 8 <= bytes.length; count++) {
        if (count >= MAX_CHUNKS) {
            return null
        }
        const fourcc = ascii(bytes, at, 4)
        const size = u32le(bytes, at + 4)
        const p = at + 8
        if (p + size > bytes.length) {
            return null
        }
        if (count === 0) {
            if (fourcc === 'VP8X') {
                if (size < 10) {
                    return null
                }
                flagAnimated = (bytes[p] & 0x02) !== 0
                canvas = { width: u24le(bytes, p + 4) + 1, height: u24le(bytes, p + 7) + 1 }
            } else if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
                const only = stillSize(bytes, fourcc, p, size)
                return only === null ? null : { ...only, animated: false }
            } else {
                return null
            }
        } else if (fourcc === 'ANIM' || fourcc === 'ANMF') {
            animated = true
        } else if ((fourcc === 'VP8 ' || fourcc === 'VP8L') && still === null) {
            still = stillSize(bytes, fourcc, p, size)
            if (still === null) {
                return null
            }
        }
        // Chunks are padded to an even size: an odd payload is followed by one pad byte that is not part of the next header.
        at = p + size + (size & 1)
    }
    if (canvas === null) {
        return null
    }
    if (flagAnimated || animated) {
        return { ...canvas, animated: true }
    }
    if (still === null || still.width !== canvas.width || still.height !== canvas.height) {
        return null
    }
    return { ...canvas, animated: false }
}

/**
 * The size and animation of a PNG or WebP from its header chunks, or null when the bytes are not that format, are
 * truncated, or give a zero side. It never reads pixel data.
 */
export function inspectIcon(bytes: Uint8Array, mime: IconMime): IconHeader | null {
    return mime === 'image/png' ? inspectPng(bytes) : inspectWebp(bytes)
}

const ICON_PATH = /^images\/[A-Za-z0-9._-]+\.(png|webp)$/

export type IconCheck = { ok: true; bytes: Uint8Array; ext: 'png' | 'webp' } | { ok: false; refusal: IntakeRefusal }

function refuse(refusal: IntakeRefusal): IconCheck {
    return { ok: false, refusal }
}

/**
 * Judges the icon a manifest names, over the archive bytes the intake accepted. On success the returned bytes are the
 * exact bytes judged, which the install stores; nothing is read again afterwards. A refusal names why.
 */
export async function checkPackIcon(packBytes: Uint8Array, pack: VerifiedPack, path: string): Promise<IconCheck> {
    if (!ICON_PATH.test(path)) {
        return refuse({ code: 'iconType' })
    }
    const file = pack.files.get(path)
    if (file === undefined) {
        return refuse({ code: 'iconMissing' })
    }
    if (file.size > PACK_ICON_MAX_BYTES) {
        return refuse({ code: 'iconTooLarge', limitBytes: PACK_ICON_MAX_BYTES })
    }
    const source = rangeSourceFrom({ size: packBytes.length, read: async (start, end) => packBytes.subarray(start, end) })
    const read = await readVerifiedFile(source, pack, path)
    if (read.ok === false) {
        return refuse(read.refusal)
    }
    if (read.mime !== 'image/png' && read.mime !== 'image/webp') {
        return refuse({ code: 'iconType' })
    }
    const header = inspectIcon(read.bytes, read.mime)
    if (header === null) {
        return refuse({ code: 'iconUnreadable' })
    }
    if (header.width > PACK_ICON_MAX_SIDE || header.height > PACK_ICON_MAX_SIDE) {
        return refuse({ code: 'iconDimensions', limitPx: PACK_ICON_MAX_SIDE })
    }
    if (header.animated) {
        return refuse({ code: 'iconAnimated' })
    }
    return { ok: true, bytes: read.bytes, ext: read.mime === 'image/png' ? 'png' : 'webp' }
}

/** Reads the stored bytes of an asset key; null when there are none. The page passes its asset store's read. */
export type ReadStoredBytes = (key: string) => Promise<Uint8Array | null>

/**
 * The stored icon of a record as a Blob, or null. The stored bytes are judged again here, whatever install did: the key
 * form (checked before anything is read, so a record cannot point the reader at a user's asset), the size cap, the type the
 * bytes show against the key's extension, and the header (each side 1-512, still). Only bytes that pass reach a decoder;
 * anything else, including a read that fails, leaves the tile on its pattern.
 */
export async function loadPackIconBlob(key: string, read: ReadStoredBytes): Promise<Blob | null> {
    const match = PACK_ICON_KEY.exec(key)
    if (match === null) {
        return null
    }
    const mime: IconMime = match[1] === 'png' ? 'image/png' : 'image/webp'
    try {
        const bytes = await read(key)
        if (bytes === null || bytes.length > PACK_ICON_MAX_BYTES || sniffPackFile(bytes.subarray(0, SNIFF_BYTES)) !== mime) {
            return null
        }
        const header = inspectIcon(bytes, mime)
        if (header === null || header.animated || header.width > PACK_ICON_MAX_SIDE || header.height > PACK_ICON_MAX_SIDE) {
            return null
        }
        return new Blob([bytes.slice()], { type: mime })
    } catch {
        return null
    }
}
