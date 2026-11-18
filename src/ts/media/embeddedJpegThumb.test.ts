// @vitest-environment node

/**
 * The Exif thumbnail extractor. Fixtures are built byte by byte in the shape a
 * camera writes (JFIF, an Exif APP1 holding IFD0, an optional Exif sub-IFD and
 * IFD1 with a JPEG thumbnail, then the main frame), so each hostile variant
 * changes exactly one field. Every byte is synthetic.
 */
import { describe, expect, test } from 'vitest'
import {
    EMBEDDED_THUMB_SCAN_BYTES,
    extractEmbeddedJpegThumb,
    letterboxCrop,
    orientationTransform,
    orientedSize,
    scanEmbeddedJpegThumb,
    type EmbeddedThumb,
    type ExifOrientation,
} from './embeddedJpegThumb'

type Bytes = number[]

function put16(v: number, le: boolean): Bytes {
    return le ? [v & 255, (v >>> 8) & 255] : [(v >>> 8) & 255, v & 255]
}

function put32(v: number, le: boolean): Bytes {
    const be = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    return le ? be.reverse() : be
}

function seg(marker: number, payload: Bytes): Bytes {
    return [0xFF, marker, ...put16(payload.length + 2, false), ...payload]
}

interface ThumbOpts {
    w?: number
    h?: number
    /** The SOFn marker; null leaves the frame header out. */
    sof?: number | null
    app1?: boolean
    app2?: boolean
    app14?: boolean
}

/** A small JPEG shaped like a camera's Exif thumbnail, at least 64 bytes long. */
function buildThumb(o: ThumbOpts = {}): Bytes {
    const w = o.w ?? 160
    const h = o.h ?? 120
    const out: Bytes = [0xFF, 0xD8]
    if (o.app1) out.push(...seg(0xE1, [0x61, 0x62, 0x63, 0x64, 0x65, 0x66]))
    if (o.app2) out.push(...seg(0xE2, [0x49, 0x43, 0x43, 0x5F]))
    if (o.app14) out.push(...seg(0xEE, [0x41, 0x64, 0x6F, 0x62]))
    out.push(...seg(0xDB, [0x00, 0x01]))
    if (o.sof !== null) out.push(...seg(o.sof ?? 0xC0, [8, ...put16(h, false), ...put16(w, false), 1, 1, 0x11, 0]))
    out.push(...seg(0xDA, [1, 1, 0, 0, 0x3F, 0]))
    for (let i = 0; i < 40; i++) out.push(0x11)
    out.push(0xFF, 0xD9)
    return out
}

interface TiffOpts {
    le?: boolean
    magic?: number
    /** undefined gives 6; null leaves the tag out. */
    orientation?: number | null
    orientationType?: number
    thumb?: Bytes
    pixelDims?: [number, number] | null
    /** undefined gives 6; null leaves the tag out. */
    compression?: number | null
    ifd0Ptr?: number
    ifd0Count?: number
    ifd1Count?: number
    ifd1Next?: number
    subPtr?: number
    thumbOff?: number
    thumbLen?: number
    thumbLenType?: number
    thumbOffType?: number
    /** Also puts the thumbnail tags in IFD0, so an IFD1 that aliases IFD0 would parse. */
    ifd0Thumb?: boolean
}

function entry(tag: number, type: number, count: number, value: number, le: boolean): Bytes {
    return [...put16(tag, le), ...put16(type, le), ...put32(count, le),
        ...(type === 3 ? [...put16(value, le), 0, 0] : put32(value, le))]
}

function buildTiff(o: TiffOpts = {}): Bytes {
    const le = o.le ?? true
    const thumb = o.thumb ?? buildThumb()
    const orientation = o.orientation === undefined ? 6 : o.orientation
    const pixelDims = o.pixelDims ?? null
    const compression = o.compression === undefined ? 6 : o.compression

    const ifd0Entries = (orientation !== null ? 1 : 0) + (pixelDims ? 1 : 0) + (o.ifd0Thumb ? 2 : 0)
    const ifd0Size = 2 + 12 * ifd0Entries + 4
    const subOff = 8 + ifd0Size
    const subSize = pixelDims ? 2 + 24 + 4 : 0
    const ifd1Off = subOff + subSize
    const ifd1Entries = (compression !== null ? 1 : 0) + 2
    const dataOff = ifd1Off + 2 + 12 * ifd1Entries + 4

    const out: Bytes = [...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...put16(o.magic ?? 42, le), ...put32(o.ifd0Ptr ?? 8, le)]
    out.push(...put16(o.ifd0Count ?? ifd0Entries, le))
    if (orientation !== null) out.push(...entry(0x0112, o.orientationType ?? 3, 1, orientation, le))
    if (pixelDims) out.push(...entry(0x8769, 4, 1, o.subPtr ?? subOff, le))
    if (o.ifd0Thumb) {
        out.push(...entry(0x0201, 4, 1, dataOff, le), ...entry(0x0202, 4, 1, thumb.length, le))
    }
    out.push(...put32(o.ifd1Next ?? ifd1Off, le))
    if (pixelDims) {
        out.push(...put16(2, le), ...entry(0xA002, 3, 1, pixelDims[0], le), ...entry(0xA003, 3, 1, pixelDims[1], le), ...put32(0, le))
    }
    out.push(...put16(o.ifd1Count ?? ifd1Entries, le))
    if (compression !== null) out.push(...entry(0x0103, 3, 1, compression, le))
    out.push(...entry(0x0201, o.thumbOffType ?? 4, 1, o.thumbOff ?? dataOff, le))
    out.push(...entry(0x0202, o.thumbLenType ?? 4, 1, o.thumbLen ?? thumb.length, le))
    out.push(...put32(0, le))
    out.push(...thumb)
    return out
}

interface JpegOpts {
    tiff?: TiffOpts
    /** Raw TIFF bytes instead of `tiff`; null leaves the Exif segment out. */
    rawTiff?: Bytes | null
    /** The main frame size; undefined gives 6000x4000, null leaves the frame header out. */
    main?: [number, number] | null
    jfif?: boolean
    /** Count of empty APP2 segments before the Exif segment. */
    fillers?: number
    /** Count of 65537-byte APP2 segments before the Exif segment. */
    bigApps?: number
    xmpFirst?: boolean
    /** Fill bytes and length-less markers before the Exif segment. */
    fillAndStandalone?: boolean
}

interface BuiltJpeg {
    bytes: Uint8Array
    tiffStart: number
    tiffEnd: number
}

function buildJpeg(o: JpegOpts = {}): BuiltJpeg {
    const out: Bytes = [0xFF, 0xD8]
    if (o.jfif ?? true) out.push(...seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
    for (let i = 0; i < (o.fillers ?? 0); i++) out.push(...seg(0xE2, [0, 0]))
    for (let i = 0; i < (o.bigApps ?? 0); i++) out.push(...seg(0xE2, new Array<number>(65533).fill(0)))
    if (o.xmpFirst) out.push(...seg(0xE1, [...Array.from('http://ns.adobe.com/xap/1.0/\0', (c) => c.charCodeAt(0)), 1, 2, 3]))
    if (o.fillAndStandalone) out.push(0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xD3, 0xFF, 0xFF)
    let tiffStart = -1
    let tiffEnd = -1
    const tiff = o.rawTiff === undefined ? buildTiff(o.tiff) : o.rawTiff
    if (tiff !== null) {
        tiffStart = out.length + 4 + 6
        out.push(...seg(0xE1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]))
        tiffEnd = out.length
    }
    out.push(...seg(0xDB, [0, 1, 2, 3]))
    const main = o.main === undefined ? [6000, 4000] : o.main
    if (main !== null) out.push(...seg(0xC0, [8, ...put16(main[1], false), ...put16(main[0], false), 1, 1, 0x11, 0]))
    out.push(...seg(0xDA, [1, 1, 0, 0, 0x3F, 0]))
    for (let i = 0; i < 20; i++) out.push(0x22)
    out.push(0xFF, 0xD9)
    return { bytes: Uint8Array.from(out), tiffStart, tiffEnd }
}

function scanOf(o: JpegOpts = {}): EmbeddedThumb | null {
    return scanEmbeddedJpegThumb(buildJpeg(o).bytes)
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('embedded JPEG thumbnail extractor: a camera file', () => {
    test('little-endian: the thumbnail, its size, the orientation and the letterbox crop', () => {
        const r = scanOf()
        expect(r).not.toBeNull()
        expect(r!.width).toBe(160)
        expect(r!.height).toBe(120)
        expect(r!.orientation).toBe(6)
        expect(r!.crop).toEqual({ x: 0, y: 7, w: 160, h: 107 })
        expect(Array.from(r!.bytes)).toEqual(buildThumb())
    })

    test('big-endian gives the same result', () => {
        const le = scanOf()
        const be = scanOf({ tiff: { le: false } })
        expect(be).not.toBeNull()
        expect(be).toEqual(le)
    })

    test('the main frame size beats the Exif PixelX/YDimension; the Exif size is the fallback', () => {
        expect(scanOf({ main: [1000, 1000], tiff: { pixelDims: [6000, 4000] } })!.crop).toEqual({ x: 20, y: 0, w: 120, h: 120 })
        expect(scanOf({ main: null, tiff: { pixelDims: [6000, 4000] } })!.crop).toEqual({ x: 0, y: 7, w: 160, h: 107 })
        expect(scanOf({ main: null, tiff: { pixelDims: [6000, 4000], le: false } })!.crop).toEqual({ x: 0, y: 7, w: 160, h: 107 })
    })

    test('with no main size at all there is no crop', () => {
        expect(scanOf({ main: null })!.crop).toBeNull()
    })

    test('a main frame of the thumbnail aspect gives no crop', () => {
        expect(scanOf({ main: [4000, 3000] })!.crop).toBeNull()
    })

    test('an Exif sub-IFD that aliases IFD0 or IFD1 is ignored, the thumbnail stays', () => {
        for (const subPtr of [8, 1]) {
            const r = scanOf({ main: null, tiff: { pixelDims: [6000, 4000], subPtr } })
            expect(r).not.toBeNull()
            expect(r!.crop).toBeNull()
        }
    })

    test('orientation: 1..8 pass through; absent, out of range or the wrong type give 1', () => {
        for (let v = 1; v <= 8; v++) expect(scanOf({ tiff: { orientation: v } })!.orientation).toBe(v)
        expect(scanOf({ tiff: { orientation: null } })!.orientation).toBe(1)
        expect(scanOf({ tiff: { orientation: 0 } })!.orientation).toBe(1)
        expect(scanOf({ tiff: { orientation: 9 } })!.orientation).toBe(1)
        expect(scanOf({ tiff: { orientation: 6, orientationType: 4 } })!.orientation).toBe(1)
    })

    test('the thumbnail is a new array without its own APP1, and keeps APP2 and APP14', () => {
        const thumb = buildThumb({ app1: true, app2: true, app14: true })
        const built = buildJpeg({ tiff: { thumb } })
        const r = scanEmbeddedJpegThumb(built.bytes)!
        expect(Array.from(r.bytes)).toEqual(buildThumb({ app2: true, app14: true }))
        expect(r.bytes[0]).toBe(0xFF)
        expect(r.bytes[1]).toBe(0xD8)
        expect(r.bytes[2]).toBe(0xFF)
        expect(r.bytes.buffer).not.toBe(built.bytes.buffer)
        const before = Array.from(r.bytes)
        built.bytes.fill(0)
        expect(Array.from(r.bytes)).toEqual(before)
    })

    test('an XMP APP1 before the Exif APP1 is skipped', () => {
        expect(scanOf({ xmpFirst: true })).not.toBeNull()
    })

    test('fill bytes and length-less markers before the Exif segment are skipped', () => {
        expect(scanOf({ fillAndStandalone: true })).not.toBeNull()
    })

    test('the thumbnail frame may be baseline, extended sequential or progressive', () => {
        for (const sof of [0xC0, 0xC1, 0xC2]) {
            expect(scanOf({ tiff: { thumb: buildThumb({ sof }) } })).not.toBeNull()
        }
    })

    test('IFD1 JPEGInterchangeFormatLength may be a SHORT', () => {
        expect(scanOf({ tiff: { thumbLenType: 3 } })).not.toBeNull()
    })

    test('a missing Compression tag is accepted', () => {
        expect(scanOf({ tiff: { compression: null } })).not.toBeNull()
    })

    test('Exif within the scan budget is found; later is not', () => {
        expect(scanOf({ bigApps: 3 })).not.toBeNull()
        expect(scanOf({ bigApps: 4 })).toBeNull()
        const padded = new Uint8Array(EMBEDDED_THUMB_SCAN_BYTES + 4096)
        padded.set(buildJpeg({ bigApps: 3 }).bytes)
        expect(scanEmbeddedJpegThumb(padded)).not.toBeNull()
    })

    test('at most 64 outer segments are walked', () => {
        expect(scanOf({ fillers: 62 })).not.toBeNull()
        expect(scanOf({ fillers: 63 })).toBeNull()
    })
})

describe('embedded JPEG thumbnail extractor: hostile input gives null', () => {
    test('not a JPEG, too short, or no Exif', () => {
        expect(scanEmbeddedJpegThumb(new Uint8Array(0))).toBeNull()
        expect(scanEmbeddedJpegThumb(Uint8Array.from([0xFF, 0xD8]))).toBeNull()
        expect(scanEmbeddedJpegThumb(Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]))).toBeNull()
        expect(scanOf({ rawTiff: null })).toBeNull()
    })

    test('an unfinished Exif segment', () => {
        const b = buildJpeg()
        expect(scanEmbeddedJpegThumb(b.bytes.subarray(0, b.tiffEnd - 1))).toBeNull()
        expect(scanEmbeddedJpegThumb(b.bytes.subarray(0, b.tiffStart + 3))).toBeNull()
    })

    test('a segment length below 2', () => {
        const b = buildJpeg()
        const patched = Uint8Array.from(b.bytes)
        patched[b.tiffStart - 10 + 2] = 0
        patched[b.tiffStart - 10 + 3] = 1
        expect(scanEmbeddedJpegThumb(patched)).toBeNull()
    })

    test('a TIFF block under 8 bytes', () => {
        expect(scanOf({ rawTiff: [0x49, 0x49, 42, 0] })).toBeNull()
    })

    test('an unknown byte order or magic number', () => {
        const b = buildJpeg()
        const patched = Uint8Array.from(b.bytes)
        patched[b.tiffStart] = 0x58
        expect(scanEmbeddedJpegThumb(patched)).toBeNull()
        expect(scanOf({ tiff: { magic: 43 } })).toBeNull()
        expect(scanOf({ tiff: { magic: 42 << 8, le: false } })).toBeNull()
    })

    test('an IFD0 offset below 8 or past the block', () => {
        for (const ifd0Ptr of [0, 4, 7, 0xFFFFFF00, 0xFFFFFFFF]) expect(scanOf({ tiff: { ifd0Ptr } })).toBeNull()
    })

    test('an IFD with more than 512 entries, or entries past the block', () => {
        expect(scanOf({ tiff: { ifd0Count: 513 } })).toBeNull()
        expect(scanOf({ tiff: { ifd0Count: 65535 } })).toBeNull()
        expect(scanOf({ tiff: { ifd1Count: 513 } })).toBeNull()
        expect(scanOf({ tiff: { ifd1Count: 200 } })).toBeNull()
    })

    test('no IFD1, or an IFD1 offset that is below 8, past the block, or IFD0 itself', () => {
        for (const ifd1Next of [0, 4, 0xFFFFFFF0]) expect(scanOf({ tiff: { ifd1Next } })).toBeNull()
        expect(scanOf({ tiff: { ifd1Next: 8, ifd0Thumb: true } })).toBeNull()
        expect(scanOf({ tiff: { ifd0Thumb: true } })).not.toBeNull()
    })

    test('a thumbnail that is out of bounds, too small, or too early', () => {
        const len = buildThumb().length
        expect(scanOf({ tiff: { thumbLen: 0xFFFFFFF0 } })).toBeNull()
        expect(scanOf({ tiff: { thumbOff: 0xFFFFFFFF } })).toBeNull()
        expect(scanOf({ tiff: { thumbLen: len + 1 } })).toBeNull()
        expect(scanOf({ tiff: { thumbLen: 63 } })).toBeNull()
        expect(scanOf({ tiff: { thumbOff: 4 } })).toBeNull()
    })

    test('a thumbnail offset of the wrong type', () => {
        expect(scanOf({ tiff: { thumbOffType: 3 } })).toBeNull()
    })

    test('a Compression other than 6', () => {
        expect(scanOf({ tiff: { compression: 7 } })).toBeNull()
        expect(scanOf({ tiff: { compression: 1 } })).toBeNull()
    })

    test('a thumbnail that does not start FF D8 FF', () => {
        for (const at of [0, 1, 2]) {
            const thumb = buildThumb()
            thumb[at] = 0x00
            expect(scanOf({ tiff: { thumb } })).toBeNull()
        }
    })

    test('a thumbnail frame that decoders do not decode, or none, or an empty one', () => {
        for (const sof of [0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]) {
            expect(scanOf({ tiff: { thumb: buildThumb({ sof }) } })).toBeNull()
        }
        expect(scanOf({ tiff: { thumb: buildThumb({ sof: null }) } })).toBeNull()
        expect(scanOf({ tiff: { thumb: buildThumb({ w: 0 }) } })).toBeNull()
        expect(scanOf({ tiff: { thumb: buildThumb({ h: 0 }) } })).toBeNull()
    })

    test('a thumbnail whose segment runs past its end', () => {
        const thumb = buildThumb()
        thumb[5] = 0xFF
        thumb[4] = 0xFF
        expect(scanOf({ tiff: { thumb } })).toBeNull()
    })
})

describe('embedded JPEG thumbnail extractor: size caps', () => {
    const open = { main: null } as const

    test('a long side above 1024 or an aspect above 8:1 is refused', () => {
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 56, h: 65535 }) } })).toBeNull()
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 1025, h: 200 }) } })).toBeNull()
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 900, h: 100 }) } })).toBeNull()
    })

    test('1024x768 and 8:1 are accepted', () => {
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 1024, h: 768 }) } })).not.toBeNull()
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 800, h: 100 }) } })).not.toBeNull()
    })

    test('a short side under 56 is refused, 56 is accepted', () => {
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 40, h: 30 }) } })).toBeNull()
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 75, h: 55 }) } })).toBeNull()
        expect(scanOf({ ...open, tiff: { thumb: buildThumb({ w: 74, h: 56 }) } })).not.toBeNull()
    })

    test('a crop whose short side is under 56 is refused', () => {
        expect(scanOf({ main: [1600, 500] })).toBeNull()
        expect(scanOf({ main: [1600, 600] })).not.toBeNull()
    })
})

describe('embedded JPEG thumbnail extractor: the core never throws on mangled input', () => {
    function checkResult(r: EmbeddedThumb | null, inputLength: number): void {
        if (r === null) return
        expect(r.bytes.length).toBeLessThanOrEqual(inputLength)
        expect(r.bytes[0]).toBe(0xFF)
        expect(r.bytes[1]).toBe(0xD8)
        expect(r.width).toBeGreaterThan(0)
        expect(r.height).toBeGreaterThan(0)
        expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(1024)
        expect(r.orientation).toBeGreaterThanOrEqual(1)
        expect(r.orientation).toBeLessThanOrEqual(8)
        if (r.crop) {
            expect(r.crop.x).toBeGreaterThanOrEqual(0)
            expect(r.crop.y).toBeGreaterThanOrEqual(0)
            expect(r.crop.w).toBeGreaterThan(0)
            expect(r.crop.h).toBeGreaterThan(0)
            expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(r.width)
            expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(r.height)
        }
    }

    const fixtures: Uint8Array[] = [
        buildJpeg({ tiff: { pixelDims: [6000, 4000] } }).bytes,
        buildJpeg({ main: null, tiff: { le: false, pixelDims: [3000, 4000], thumb: buildThumb({ app1: true, app2: true, app14: true }) } }).bytes,
    ]

    test('every prefix length of two fixtures', () => {
        for (const full of fixtures) {
            expect(scanEmbeddedJpegThumb(full)).not.toBeNull()
            for (let n = 0; n <= full.length; n++) checkResult(scanEmbeddedJpegThumb(full.subarray(0, n)), n)
        }
    })

    test('200 seeded byte flips', () => {
        const rnd = mulberry32(0x5EED)
        for (let i = 0; i < 200; i++) {
            const copy = Uint8Array.from(fixtures[i % fixtures.length])
            const flips = 1 + Math.floor(rnd() * 3)
            for (let f = 0; f < flips; f++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256)
            checkResult(scanEmbeddedJpegThumb(copy), copy.length)
        }
    })

    test('the core surfaces an internal failure; the wrapper turns it into null', () => {
        const hostile = new Proxy(new Uint8Array(16), {
            get() {
                throw new RangeError('injected')
            },
        })
        expect(() => scanEmbeddedJpegThumb(hostile)).toThrow(RangeError)
        expect(extractEmbeddedJpegThumb(hostile)).toBeNull()
    })

    test('the wrapper returns what the core returns', () => {
        const bytes = buildJpeg().bytes
        expect(extractEmbeddedJpegThumb(bytes)).toEqual(scanEmbeddedJpegThumb(bytes))
        expect(extractEmbeddedJpegThumb(new Uint8Array(0))).toBeNull()
    })
})

describe('embedded JPEG thumbnail extractor: pure helpers', () => {
    test('orientedSize swaps the sides for orientations 5 to 8 only', () => {
        for (const o of [1, 2, 3, 4] as ExifOrientation[]) expect(orientedSize(3, 2, o)).toEqual({ w: 3, h: 2 })
        for (const o of [5, 6, 7, 8] as ExifOrientation[]) expect(orientedSize(3, 2, o)).toEqual({ w: 2, h: 3 })
    })

    test('orientationTransform maps the stored corners onto the oriented canvas, upright', () => {
        const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
        const w = 3
        const h = 2
        const expected: Record<number, [number, number][]> = {
            // stored corners (0,0) (w,0) (w,h) (0,h) land at these oriented points
            1: [[0, 0], [3, 0], [3, 2], [0, 2]],
            2: [[3, 0], [0, 0], [0, 2], [3, 2]],
            3: [[3, 2], [0, 2], [0, 0], [3, 0]],
            4: [[0, 2], [3, 2], [3, 0], [0, 0]],
            5: [[0, 0], [0, 3], [2, 3], [2, 0]],
            6: [[2, 0], [2, 3], [0, 3], [0, 0]],
            7: [[2, 3], [2, 0], [0, 0], [0, 3]],
            8: [[0, 3], [0, 0], [2, 0], [2, 3]],
        }
        for (let o = 1; o <= 8; o++) {
            const m = orientationTransform(o as ExifOrientation, w, h)
            const corners: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
            expect(corners.map(([x, y]) => apply(m, x, y).map((v) => v + 0))).toEqual(expected[o])
        }
    })

    test('letterboxCrop: the table', () => {
        expect(letterboxCrop(160, 120, 6000, 4000)).toEqual({ x: 0, y: 7, w: 160, h: 107 })
        expect(letterboxCrop(160, 120, 4000, 3000)).toBeNull()
        expect(letterboxCrop(160, 120, 134, 100)).toBeNull()
        expect(letterboxCrop(160, 120, 136, 100)).toEqual({ x: 0, y: 1, w: 160, h: 118 })
        expect(letterboxCrop(160, 120, 1600, 500)).toEqual({ x: 0, y: 35, w: 160, h: 50 })
        expect(letterboxCrop(160, 120, 1, 1)).toEqual({ x: 20, y: 0, w: 120, h: 120 })
        expect(letterboxCrop(160, 120, 9, 16)).toEqual({ x: 46, y: 0, w: 68, h: 120 })
    })
})
