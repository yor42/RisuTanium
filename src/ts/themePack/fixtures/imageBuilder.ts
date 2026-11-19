// Test and golden-generator builder of the icon images a theme pack may carry (not part of the app bundle).
//
// PNG and APNG files are written chunk by chunk with a real CRC-32 and a real zlib IDAT (fflate `zlibSync`), so a reader
// walks the same structure an encoder produces. The WebP fixtures are real encoder output (libwebp through sharp 0.34.5,
// a 24x16 image: lossy `VP8 `, lossless `VP8L`, lossy with alpha `VP8X`+`ALPH`+`VP8 `, and a two-frame animation with
// `VP8X`, `ANIM` and two `ANMF` chunks); the `ALPH` payload has an odd size, so the walk must honour the RIFF pad byte.
// The hand-assembled WebP helpers write the RIFF container to its specification for the header cases no encoder emits.
import { zlibSync } from 'fflate'
import { concat, crc32, utf8 } from './packBuilder'

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

function u32be(value: number): Uint8Array {
    return Uint8Array.of((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
}

function u32le(value: number): Uint8Array {
    return Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF)
}

/** One PNG chunk: length, type, data and the CRC-32 over type and data. */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array(0)): Uint8Array {
    const body = concat(utf8(type), data)
    return concat(u32be(data.length), body, u32be(crc32(body)))
}

export function ihdrData(width: number, height: number): Uint8Array {
    // 8-bit RGBA, no interlace.
    return concat(u32be(width), u32be(height), Uint8Array.of(8, 6, 0, 0, 0))
}

/** The pixel rows of a width x height RGBA image (a deterministic gradient), each with the filter byte 0, zlib-compressed. */
function idatData(width: number, height: number): Uint8Array {
    const rows = new Uint8Array(height * (1 + width * 4))
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 4)
        for (let x = 0; x < width; x++) {
            const at = row + 1 + x * 4
            rows[at] = (x * 7) & 0xFF
            rows[at + 1] = (y * 11) & 0xFF
            rows[at + 2] = 0x80
            rows[at + 3] = 0xFF
        }
    }
    return zlibSync(rows)
}

export interface PngOptions {
    /** The size the IHDR declares when it differs from the pixel data (a header claiming a decode bomb, a zero side). */
    readonly declaredWidth?: number
    readonly declaredHeight?: number
    /** Chunks written between IHDR and the first IDAT. */
    readonly beforeIdat?: readonly Uint8Array[]
    /** Chunks written between the last IDAT and IEND. */
    readonly afterIdat?: readonly Uint8Array[]
}

/** A real still PNG of `width` x `height` pixels. */
export function pngBytes(width: number, height: number, options: PngOptions = {}): Uint8Array {
    return concat(
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdrData(options.declaredWidth ?? width, options.declaredHeight ?? height)),
        ...(options.beforeIdat ?? []),
        pngChunk('IDAT', idatData(width, height)),
        ...(options.afterIdat ?? []),
        pngChunk('IEND'),
    )
}

/** An `acTL` chunk for two frames, looping forever. */
export function actlChunk(): Uint8Array {
    return pngChunk('acTL', concat(u32be(2), u32be(0)))
}

function fctlChunk(sequence: number, width: number, height: number): Uint8Array {
    return pngChunk('fcTL', concat(u32be(sequence), u32be(width), u32be(height), u32be(0), u32be(0), Uint8Array.of(0, 100, 0, 10, 0, 0)))
}

/**
 * A two-frame APNG written as the format defines it: IHDR, acTL, fcTL, IDAT, fcTL, fdAT, IEND. With `actl: 'after'` the
 * acTL chunk instead follows the image data, so a check that stops at the first IDAT is caught.
 */
export function apngBytes(width: number, height: number, actl: 'before' | 'after' = 'before'): Uint8Array {
    const data = idatData(width, height)
    const parts: Uint8Array[] = [PNG_SIGNATURE, pngChunk('IHDR', ihdrData(width, height))]
    if (actl === 'before') {
        parts.push(actlChunk())
    }
    parts.push(fctlChunk(0, width, height), pngChunk('IDAT', data))
    if (actl === 'after') {
        parts.push(actlChunk())
    }
    parts.push(fctlChunk(1, width, height), pngChunk('fdAT', concat(u32be(2), data)), pngChunk('IEND'))
    return concat(...parts)
}

/** `bytes` grown to exactly `total` bytes by a `tEXt` chunk before IEND; throws when it is already too large for that. */
export function padPngTo(bytes: Uint8Array, total: number): Uint8Array {
    const iend = bytes.length - 12
    const room = total - bytes.length - 12
    if (room < 0) {
        throw new Error(`a ${bytes.length}-byte PNG cannot be padded to ${total}`)
    }
    return concat(bytes.subarray(0, iend), pngChunk('tEXt', new Uint8Array(room)), bytes.subarray(iend))
}

//#region WebP

function fromBase64(text: string): Uint8Array {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** libwebp lossy, 24x16, one `VP8 ` chunk. */
export const WEBP_LOSSY = fromBase64('UklGRnIAAABXRUJQVlA4IGYAAAAQBACdASoYABAAPrVOoUmnJKOhMAgA4BaJbDuAGMeQswjkoCK+pwP3gAD+4h/x3/7Vav02f/49PHBnPZkSovB5+TDej8wlnEOxsRrnshO2OZDQgwlzM65EDeZ3QiA7dbUMC/DQAAA=')
/** libwebp lossless, 24x16, one `VP8L` chunk. */
export const WEBP_LOSSLESS = fromBase64('UklGRi4AAABXRUJQVlA4TCIAAAAvF8ADALkyRPQ/dhHR/wCRtk0d3L/jwcNRGMCYAKoeqP8E')
/** libwebp lossy with a translucent alpha plane, 24x16: `VP8X`, an odd-sized `ALPH`, `VP8 `. */
export const WEBP_ALPHA = fromBase64('UklGRqIAAABXRUJQVlA4WAoAAAAQAAAAFwAADwAAQUxQSBUAAAABD/Ct/4iIICQg/F/rgW5BRP8DmwEAVlA4IGYAAAAQBACdASoYABAAPrVOoUmnJKOhMAgA4BaJbDuAGMeQswjkoCK+pwP3gAD+4h/x3/7Vav02f/49PHBnPZkSovB5+TDej8wlnEOxsRrnshO2OZDQgwlzM65EDeZ3QiA7dbUMC/DQAAA=')
/** libwebp animation, 24x16, two frames: `VP8X` (animation flag), `ANIM`, `ANMF`, `ANMF`. */
export const WEBP_ANIMATED = fromBase64('UklGRiABAABXRUJQVlA4WAoAAAACAAAAFwAADwAAQU5JTQYAAAD/////AABBTk1GfgAAAAAAAAAAABcAAA8AAGQAAAJWUDggZgAAABAEAJ0BKhgAEAA+tU6hSacko6EwCADgFolsO4AYx5C0KOSgIr6nA/eAAP7iH/Hf/tVq/TZ//j08cGc9mRKi8Hn1JBh3HahgBAgBka57ITtjmQ0IMJczoxVou7Kz6h2eiY23PcwAAEFOTUZuAAAAAAAAAAAAFwAADwAAZAAAAFZQOCBWAAAANAMAnQEqGAAQAD61TJ5JgwCAAAFoloO4AYx5AAd/3S/yAAD+u4oBVopYrX/4WbPlmz/0nfRpf/Qr6X/vfh+rd/V0aQ3q144M57MiVF3xrqJzXK1gAAA=')

/** One RIFF chunk: fourcc, little-endian size, payload and, for an odd size, the pad byte that is not counted in the size. */
export function riffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
    return concat(utf8(fourcc), u32le(payload.length), payload, new Uint8Array(payload.length & 1))
}

/** A RIFF/WEBP file over `chunks`; `sizeDelta` is added to the declared RIFF size (a lying header). */
export function riffWebp(chunks: readonly Uint8Array[], sizeDelta = 0): Uint8Array {
    const body = concat(utf8('WEBP'), ...chunks)
    return concat(utf8('RIFF'), u32le(body.length + sizeDelta), body)
}

/** A `VP8 ` key-frame chunk header of the given size (no real image data follows the header). */
export function vp8Chunk(width: number, height: number): Uint8Array {
    const payload = new Uint8Array(10)
    payload.set([0x10, 0x04, 0x00, 0x9D, 0x01, 0x2A], 0)
    payload[6] = width & 0xFF
    payload[7] = (width >>> 8) & 0x3F
    payload[8] = height & 0xFF
    payload[9] = (height >>> 8) & 0x3F
    return riffChunk('VP8 ', payload)
}

/** A `VP8L` chunk header: the signature byte and the 14-bit width-1 and height-1 fields. */
export function vp8lChunk(width: number, height: number): Uint8Array {
    const payload = new Uint8Array(5)
    payload[0] = 0x2F
    payload.set(u32le(((width - 1) & 0x3FFF) | (((height - 1) & 0x3FFF) << 14)), 1)
    return riffChunk('VP8L', payload)
}

/** A `VP8X` chunk: the flag byte and the 24-bit canvas width-1 and height-1. */
export function vp8xChunk(width: number, height: number, flags = 0): Uint8Array {
    const payload = new Uint8Array(10)
    payload[0] = flags
    payload.set(u32le(width - 1).subarray(0, 3), 4)
    payload.set(u32le(height - 1).subarray(0, 3), 7)
    return riffChunk('VP8X', payload)
}

//#endregion
