import { getImageType } from './imageType'

/**
 * The one rule for whether an image is animated and what the app does with it, shared by the
 * thumbnail path and the phone portrait shrink. Pure: no storage, no DOM.
 */

function readU32BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0
}

function chunkTypeAt(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function isGif(bytes: Uint8Array): boolean {
    return bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
}

function isPng(bytes: Uint8Array): boolean {
    return bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
}

function isApng(bytes: Uint8Array): boolean {
    let pos = 8
    while (pos + 8 <= bytes.length) {
        const length = readU32BE(bytes, pos)
        const type = chunkTypeAt(bytes, pos + 4)
        if (type === 'IDAT' || type === 'IEND') {
            return false
        }
        if (type === 'acTL') {
            return true
        }
        if (pos + 8 + length + 4 > bytes.length) {
            // Overrunning length: malformed, stop without deciding.
            return false
        }
        pos += 8 + length + 4
    }
    return false
}

function isRiffWebp(bytes: Uint8Array): boolean {
    return bytes.length >= 16 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
    if (bytes.length < 21) {
        return false
    }
    if (chunkTypeAt(bytes, 12) !== 'VP8X') {
        return false
    }
    return (bytes[20] & 0x02) !== 0
}

function isIsoBmff(bytes: Uint8Array): boolean {
    return bytes.length >= 12 && chunkTypeAt(bytes, 4) === 'ftyp'
}

function hasAvisBrand(bytes: Uint8Array): boolean {
    if (chunkTypeAt(bytes, 8) === 'avis') {
        return true
    }
    const boxSize = readU32BE(bytes, 0)
    const end = boxSize > 0 && boxSize <= bytes.length ? boxSize : bytes.length
    let pos = 16
    while (pos + 4 <= end) {
        if (chunkTypeAt(bytes, pos) === 'avis') {
            return true
        }
        pos += 4
    }
    return false
}

/** Pure and never throws, even on truncated or malformed input. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
    try {
        if (isGif(bytes)) {
            return true
        }
        if (isPng(bytes)) {
            return isApng(bytes)
        }
        if (isRiffWebp(bytes)) {
            return isAnimatedWebp(bytes)
        }
        if (isIsoBmff(bytes)) {
            return hasAvisBrand(bytes)
        }
        return false
    } catch {
        return false
    }
}

/** What the thumbnail path does with a file, decided from its first bytes (or
 *  from all of them). `undecided` only ever answers a prefix. */
export type ImageClass =
    | { kind: 'null' }
    | { kind: 'animated' }
    | { kind: 'unknown' }
    | { kind: 'still', mime: string }
    | { kind: 'undecided' }

type Animation = 'animated' | 'still' | 'undecided'

/** The shortest prefix every animation rule below can read: the VP8X flags
 *  byte of a WebP is at offset 20. */
const MIN_DECIDABLE_PREFIX = 21

function startsWithJpegSignature(bytes: Uint8Array): boolean {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/** `bytes` is a PNG. Same walk as `isApng`, but a prefix that ends, or a chunk
 *  that runs past it, before `IDAT`/`IEND` decides nothing. */
function pngAnimation(bytes: Uint8Array, whole: boolean): Animation {
    let pos = 8
    while (pos + 8 <= bytes.length) {
        const length = readU32BE(bytes, pos)
        const type = chunkTypeAt(bytes, pos + 4)
        if (type === 'IDAT' || type === 'IEND') {
            return 'still'
        }
        if (type === 'acTL') {
            return 'animated'
        }
        if (pos + 8 + length + 4 > bytes.length) {
            return whole ? 'still' : 'undecided'
        }
        pos += 8 + length + 4
    }
    return whole ? 'still' : 'undecided'
}

function prefixAnimation(bytes: Uint8Array): Animation {
    if (isGif(bytes)) {
        return 'animated'
    }
    if (isPng(bytes)) {
        return pngAnimation(bytes, false)
    }
    if (isRiffWebp(bytes)) {
        return isAnimatedWebp(bytes) ? 'animated' : 'still'
    }
    if (isIsoBmff(bytes)) {
        if (hasAvisBrand(bytes)) {
            return 'animated'
        }
        // A box that ends inside the prefix has been scanned in full; size 0
        // ("to end of file") and a size past the prefix have not.
        const boxSize = readU32BE(bytes, 0)
        return boxSize > 0 && boxSize <= bytes.length ? 'still' : 'undecided'
    }
    return 'still'
}

/**
 * Pure. Classifies a file from `bytes`, which is the whole file when `whole`
 * is true and otherwise its first bytes. On a whole file the answer matches
 * what `isAnimatedImage` and `getImageType` give together, with one rule
 * added: a buffer that starts `FF D8 FF` is a still JPEG whether or not it
 * ends in `FF D9`. A JPEG has no animated form, and files with data after the
 * end marker are common.
 */
export function classifyImage(bytes: Uint8Array, whole: boolean): ImageClass {
    if (whole && bytes.length < 12) {
        return { kind: 'null' }
    }
    if (startsWithJpegSignature(bytes)) {
        return { kind: 'still', mime: 'image/jpeg' }
    }
    if (!whole) {
        // Whether `FF D8` starts a JPEG cannot be told from a prefix, because
        // `getImageType` looks at the last two bytes.
        if ((bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) || bytes.length < MIN_DECIDABLE_PREFIX) {
            return { kind: 'undecided' }
        }
    }
    const animation: Animation = whole ? (isAnimatedImage(bytes) ? 'animated' : 'still') : prefixAnimation(bytes)
    if (animation === 'animated') {
        return { kind: 'animated' }
    }
    if (animation === 'undecided') {
        return { kind: 'undecided' }
    }
    const type = getImageType(bytes)
    if (type === 'Unknown') {
        return { kind: 'unknown' }
    }
    return { kind: 'still', mime: mimeForType(type) }
}

function mimeForType(type: ReturnType<typeof getImageType>): string {
    switch (type) {
        case 'JPEG': return 'image/jpeg'
        case 'PNG': return 'image/png'
        case 'WEBP': return 'image/webp'
        case 'BMP': return 'image/bmp'
        case 'AVIF': return 'image/avif'
        default: return 'application/octet-stream'
    }
}
