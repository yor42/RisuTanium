/**
 * The Exif thumbnail a camera JPEG carries in its first bytes, found without
 * decoding the file. Both entry points are pure and linear in the prefix
 * length. `scanEmbeddedJpegThumb` is the core and never catches: a bounds bug
 * in it surfaces as an exception. `extractEmbeddedJpegThumb` is the production
 * wrapper and turns any exception into `null`.
 *
 * Every offset read from the file is untrusted. A result is returned only when
 * the thumbnail is a baseline, extended sequential or progressive JPEG whose bytes lie inside the
 * Exif block, whose size is within the caps below, and whose cropped short side
 * is usable.
 */

/** How many leading bytes of a file the scan looks at. */
export const EMBEDDED_THUMB_SCAN_BYTES = 262144

/** Larger embedded thumbnails are not the camera's small preview. */
export const MAX_EMBEDDED_THUMB_LONG_SIDE = 1024

/** Thumbnails whose (cropped) short side is smaller are not worth showing. */
export const MIN_EMBEDDED_THUMB_SHORT_SIDE = 56

const MAX_EMBEDDED_THUMB_ASPECT = 8
const MAX_OUTER_SEGMENTS = 64
const MAX_IFD_ENTRIES = 512
const MIN_THUMB_BYTES = 64
const TYPE_SHORT = 3
const TYPE_LONG = 4

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface EmbeddedCrop {
    x: number
    y: number
    w: number
    h: number
}

export interface EmbeddedThumb {
    /** A new array: SOI, the thumbnail's segments minus APP1, then its scan data. */
    bytes: Uint8Array
    /** The thumbnail's stored (unrotated) size. */
    width: number
    height: number
    /** The main image's Exif Orientation; the thumbnail shares the stored pixel order. */
    orientation: ExifOrientation
    /** The part of the stored thumbnail that matches the main image's framing, or null for all of it. */
    crop: EmbeddedCrop | null
}

type Matrix = [number, number, number, number, number, number]

interface Size {
    w: number
    h: number
}

/** The size after the orientation is applied: orientations 5 to 8 swap the sides. */
export function orientedSize(width: number, height: number, orientation: ExifOrientation): Size {
    return orientation >= 5 ? { w: height, h: width } : { w: width, h: height }
}

/**
 * The canvas `setTransform` arguments that draw a stored `width`×`height`
 * image upright under the Exif orientation, into an `orientedSize` canvas.
 */
export function orientationTransform(orientation: ExifOrientation, width: number, height: number): Matrix {
    switch (orientation) {
        case 2: return [-1, 0, 0, 1, width, 0]
        case 3: return [-1, 0, 0, -1, width, height]
        case 4: return [1, 0, 0, -1, 0, height]
        case 5: return [0, 1, 1, 0, 0, 0]
        case 6: return [0, 1, -1, 0, height, 0]
        case 7: return [0, -1, -1, 0, height, width]
        case 8: return [0, -1, 1, 0, 0, width]
        default: return [1, 0, 0, 1, 0, 0]
    }
}

/**
 * The centred rectangle of the main image's aspect inside a `tw`×`th`
 * thumbnail (the camera letterboxes a thumbnail whose aspect differs), or null
 * when the aspects agree within 1%.
 */
export function letterboxCrop(tw: number, th: number, mw: number, mh: number): EmbeddedCrop | null {
    const thumbAspect = tw / th
    const mainAspect = mw / mh
    if (Math.abs(thumbAspect - mainAspect) / mainAspect <= 0.01) return null
    let w = tw
    let h = th
    if (mainAspect < thumbAspect) {
        w = Math.min(tw, Math.max(1, Math.round(th * mainAspect)))
    } else {
        h = Math.min(th, Math.max(1, Math.round(tw / mainAspect)))
    }
    return { x: Math.round((tw - w) / 2), y: Math.round((th - h) / 2), w, h }
}

function u16(b: Uint8Array, off: number, le: boolean): number {
    return le ? b[off] | (b[off + 1] << 8) : (b[off] << 8) | b[off + 1]
}

function u32(b: Uint8Array, off: number, le: boolean): number {
    return (le
        ? b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)
        : (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0
}

/** SOFn markers: every frame header, which excludes DHT (C4), JPG (C8) and DAC (CC). */
function isSof(marker: number): boolean {
    return marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
}

/** Only baseline, extended sequential and progressive frames: the decoders browsers ship decode these. */
function isDecodableSof(marker: number): boolean {
    return marker === 0xC0 || marker === 0xC1 || marker === 0xC2
}

interface IfdEntry {
    tag: number
    type: number
    count: number
    /** The 4-byte value field read as the entry's own type (SHORT or LONG), else -1. */
    value: number
}

interface Ifd {
    entries: IfdEntry[]
    next: number
}

/** Reads one IFD after checking its bounds against the TIFF block. */
function readIfd(t: Uint8Array, off: number, le: boolean): Ifd | null {
    if (off < 8 || off + 2 > t.length) return null
    const n = u16(t, off, le)
    if (n > MAX_IFD_ENTRIES || off + 2 + 12 * n + 4 > t.length) return null
    const entries: IfdEntry[] = []
    for (let i = 0; i < n; i++) {
        const e = off + 2 + 12 * i
        const type = u16(t, e + 2, le)
        entries.push({
            tag: u16(t, e, le),
            type,
            count: u32(t, e + 4, le),
            value: type === TYPE_SHORT ? u16(t, e + 8, le) : type === TYPE_LONG ? u32(t, e + 8, le) : -1,
        })
    }
    return { entries, next: u32(t, off + 2 + 12 * n, le) }
}

function findEntry(ifd: Ifd, tag: number): IfdEntry | undefined {
    return ifd.entries.find((e) => e.tag === tag)
}

interface SanitizedThumb {
    bytes: Uint8Array
    width: number
    height: number
}

/** Validates the thumbnail's frame and rebuilds it without its APP1 segments. */
function sanitizeThumb(thumb: Uint8Array): SanitizedThumb | null {
    if (thumb.length < 3 || thumb[0] !== 0xFF || thumb[1] !== 0xD8 || thumb[2] !== 0xFF) return null
    const chunks: Uint8Array[] = [thumb.subarray(0, 2)]
    let width = 0
    let height = 0
    let pos = 2
    for (let seg = 0; seg < MAX_OUTER_SEGMENTS; seg++) {
        while (pos + 1 < thumb.length && thumb[pos] === 0xFF && thumb[pos + 1] === 0xFF) pos++
        if (pos + 2 > thumb.length || thumb[pos] !== 0xFF) return null
        const marker = thumb[pos + 1]
        if (marker === 0x00 || marker === 0xD9 || marker === 0xD8) return null
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            chunks.push(thumb.subarray(pos, pos + 2))
            pos += 2
            continue
        }
        if (pos + 4 > thumb.length) return null
        const length = u16(thumb, pos + 2, false)
        const segEnd = pos + 2 + length
        if (length < 2 || segEnd > thumb.length) return null
        if (isSof(marker)) {
            if (width > 0 || !isDecodableSof(marker) || length < 8) return null
            height = u16(thumb, pos + 5, false)
            width = u16(thumb, pos + 7, false)
            if (width === 0 || height === 0) return null
        }
        if (marker === 0xDA) {
            if (width === 0) return null
            chunks.push(thumb.subarray(pos))
            let total = 0
            for (const c of chunks) total += c.length
            const bytes = new Uint8Array(total)
            let at = 0
            for (const c of chunks) {
                bytes.set(c, at)
                at += c.length
            }
            return { bytes, width, height }
        }
        if (marker !== 0xE1) chunks.push(thumb.subarray(pos, segEnd))
        pos = segEnd
    }
    return null
}

interface OuterScan {
    /** The Exif TIFF block, a view into the prefix. */
    tiff: Uint8Array | null
    /** The main frame's stored size from its first SOF, when the walk reached it. */
    main: Size | null
}

/** Walks the outer marker segments: finds the first Exif APP1 and the main frame header. */
function walkOuter(prefix: Uint8Array): OuterScan {
    let tiff: Uint8Array | null = null
    let main: Size | null = null
    let pos = 2
    for (let seg = 0; seg < MAX_OUTER_SEGMENTS; seg++) {
        while (pos + 1 < prefix.length && prefix[pos] === 0xFF && prefix[pos + 1] === 0xFF) pos++
        if (pos + 2 > prefix.length || prefix[pos] !== 0xFF) break
        const marker = prefix[pos + 1]
        if (marker === 0x00) break
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            pos += 2
            continue
        }
        if (marker === 0xD9 || marker === 0xDA) break
        if (pos + 4 > prefix.length) break
        const length = u16(prefix, pos + 2, false)
        const segEnd = pos + 2 + length
        if (length < 2 || segEnd > prefix.length) break
        if (isSof(marker)) {
            if (length >= 8) {
                const h = u16(prefix, pos + 5, false)
                const w = u16(prefix, pos + 7, false)
                if (w > 0 && h > 0) main = { w, h }
            }
            break
        }
        if (marker === 0xE1 && tiff === null && length >= 8
            && prefix[pos + 4] === 0x45 && prefix[pos + 5] === 0x78 && prefix[pos + 6] === 0x69
            && prefix[pos + 7] === 0x66 && prefix[pos + 8] === 0 && prefix[pos + 9] === 0) {
            tiff = prefix.subarray(pos + 10, segEnd)
        }
        pos = segEnd
    }
    return { tiff, main }
}

/** The Exif sub-IFD's PixelXDimension and PixelYDimension, when they are usable. */
function exifPixelSize(t: Uint8Array, le: boolean, subOff: number, ifd0Off: number, ifd1Off: number): Size | null {
    if (subOff === ifd0Off || subOff === ifd1Off) return null
    const sub = readIfd(t, subOff, le)
    if (sub === null) return null
    const px = findEntry(sub, 0xA002)
    const py = findEntry(sub, 0xA003)
    if (!px || !py || px.value <= 0 || py.value <= 0) return null
    return { w: px.value, h: py.value }
}

/**
 * Finds a usable Exif thumbnail in the first bytes of a JPEG. Does not catch:
 * any exception it throws is a defect in this function.
 */
export function scanEmbeddedJpegThumb(prefix: Uint8Array): EmbeddedThumb | null {
    const data = prefix.length > EMBEDDED_THUMB_SCAN_BYTES ? prefix.subarray(0, EMBEDDED_THUMB_SCAN_BYTES) : prefix
    if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return null
    const { tiff: t, main } = walkOuter(data)
    if (t === null || t.length < 8) return null

    let le: boolean
    if (t[0] === 0x49 && t[1] === 0x49) le = true
    else if (t[0] === 0x4D && t[1] === 0x4D) le = false
    else return null
    if (u16(t, 2, le) !== 42) return null
    const ifd0Off = u32(t, 4, le)
    const ifd0 = readIfd(t, ifd0Off, le)
    if (ifd0 === null) return null

    const orientationEntry = findEntry(ifd0, 0x0112)
    let orientation: ExifOrientation = 1
    if (orientationEntry && orientationEntry.type === TYPE_SHORT && orientationEntry.count === 1
        && orientationEntry.value >= 1 && orientationEntry.value <= 8) {
        orientation = orientationEntry.value as ExifOrientation
    }

    const ifd1Off = ifd0.next
    if (ifd1Off === 0 || ifd1Off === ifd0Off) return null
    const ifd1 = readIfd(t, ifd1Off, le)
    if (ifd1 === null) return null

    const compression = findEntry(ifd1, 0x0103)
    if (compression && (compression.type !== TYPE_SHORT || compression.value !== 6)) return null
    const offEntry = findEntry(ifd1, 0x0201)
    const lenEntry = findEntry(ifd1, 0x0202)
    if (!offEntry || offEntry.type !== TYPE_LONG) return null
    if (!lenEntry || (lenEntry.type !== TYPE_LONG && lenEntry.type !== TYPE_SHORT)) return null
    const tOff = offEntry.value
    const tLen = lenEntry.value
    if (tOff < 8 || tLen < MIN_THUMB_BYTES || tOff + tLen > t.length) return null

    const thumb = sanitizeThumb(t.subarray(tOff, tOff + tLen))
    if (thumb === null) return null
    const long = Math.max(thumb.width, thumb.height)
    const short = Math.min(thumb.width, thumb.height)
    if (long > MAX_EMBEDDED_THUMB_LONG_SIDE || long > MAX_EMBEDDED_THUMB_ASPECT * short) return null

    let mainSize = main
    if (mainSize === null) {
        const exifPtr = findEntry(ifd0, 0x8769)
        if (exifPtr && exifPtr.type === TYPE_LONG) {
            mainSize = exifPixelSize(t, le, exifPtr.value, ifd0Off, ifd1Off)
        }
    }
    const crop = mainSize === null ? null : letterboxCrop(thumb.width, thumb.height, mainSize.w, mainSize.h)
    const shortAfter = crop === null ? short : Math.min(crop.w, crop.h)
    if (shortAfter < MIN_EMBEDDED_THUMB_SHORT_SIDE) return null
    return { bytes: thumb.bytes, width: thumb.width, height: thumb.height, orientation, crop }
}

/** Production entry point: `null` for no usable thumbnail and for any internal failure. */
export function extractEmbeddedJpegThumb(prefix: Uint8Array): EmbeddedThumb | null {
    try {
        return scanEmbeddedJpegThumb(prefix)
    } catch {
        return null
    }
}
