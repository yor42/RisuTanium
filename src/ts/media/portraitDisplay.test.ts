// @vitest-environment happy-dom

/**
 * The phone policy, the size rule and one shrink job end to end with fake dependencies. Unit guards of a
 * new module: they have no pre-fix base and earn their evidence through the mutants that must fail them.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Decoded } from '../chatCardImage'
import { currentPortraitMaxSide, fitWithin, phonePortraitMaxSide, resetPortraitQueueForTest, shrinkPortrait, type PortraitCanvas, type PortraitDeps } from './portraitDisplay'

const platform = vi.hoisted(() => ({ mobile: false }))

vi.mock('../platform', () => ({
    get isMobile() {
        return platform.mobile
    },
}))

afterEach(() => {
    platform.mobile = false
    resetPortraitQueueForTest()
    vi.useRealTimers()
})

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

/** A PNG chunk the way an encoder writes it: length, type, data, CRC over type and data. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

const realPng = new Uint8Array(readFileSync('public/sample/rika.png'))
const IHDR_END = 8 + 12 + 13

/** The real PNG with `extra` chunks inserted straight after IHDR. */
function pngWith(extra: Uint8Array): Blob {
    return new Blob([concat([realPng.subarray(0, IHDR_END), extra, realPng.subarray(IHDR_END)])])
}

function textChunk(size: number): Uint8Array {
    const data = new Uint8Array(size)
    data.set(new TextEncoder().encode('Comment\0'))
    data.fill(0x61, 8)
    return pngChunk('tEXt', data)
}

function fakeCanvas(): PortraitCanvas & { draws: number[][] } {
    const draws: number[][] = []
    const context = {
        imageSmoothingQuality: 'low' as ImageSmoothingQuality,
        drawImage: (_source: CanvasImageSource, ...rest: number[]) => {
            draws.push(rest)
        },
    }
    return { width: 0, height: 0, draws, getContext: () => context, toBlob: () => {} }
}

function fakeDecoded(width: number, height: number): Decoded & { release: Mock<() => void> } {
    return { source: document.createElement('canvas'), width, height, release: vi.fn<() => void>() }
}

interface Rig {
    deps: PortraitDeps
    fetch: ReturnType<typeof vi.fn>
    decode: ReturnType<typeof vi.fn>
    encode: ReturnType<typeof vi.fn>
    createObjectURL: ReturnType<typeof vi.fn>
    canvases: ReturnType<typeof fakeCanvas>[]
    decoded: ReturnType<typeof fakeDecoded>
}

function rig(options: { blob?: Blob, width?: number, height?: number } = {}): Rig {
    const decoded = fakeDecoded(options.width ?? 4096, options.height ?? 6144)
    const canvases: ReturnType<typeof fakeCanvas>[] = []
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => options.blob ?? new Blob([realPng]) }))
    const decode = vi.fn(async () => decoded)
    const encode = vi.fn(async () => new Blob([new Uint8Array(10)]))
    const createObjectURL = vi.fn(() => 'blob:shrunk')
    const deps: PortraitDeps = {
        fetch: fetchMock,
        decode,
        createCanvas: (width, height) => {
            const canvas = fakeCanvas()
            canvas.width = width
            canvas.height = height
            canvases.push(canvas)
            return canvas
        },
        encode,
        createObjectURL,
    }
    return { deps, fetch: fetchMock, decode, encode, createObjectURL, canvases, decoded }
}

describe('phonePortraitMaxSide', () => {
    test('P1: only a mobile screen whose smaller side is under 600 CSS px is a phone', () => {
        expect(phonePortraitMaxSide({ mobile: false, width: 412, height: 846, dpr: 3.5 })).toBeNull()
        expect(phonePortraitMaxSide({ mobile: true, width: 800, height: 1280, dpr: 2 })).toBeNull()
        expect(phonePortraitMaxSide({ mobile: true, width: 412, height: 846, dpr: 3.5 })).toBe(3072)
    })

    test('P2: nearby device pixel ratios fall in the same 256 px bucket', () => {
        const a = phonePortraitMaxSide({ mobile: true, width: 412, height: 846, dpr: 2.625 })
        const b = phonePortraitMaxSide({ mobile: true, width: 412, height: 846, dpr: 2.7 })
        expect(a).toBe(b)
        expect(a).toBe(2304)
    })

    test('currentPortraitMaxSide is null where the UA is not mobile (the test environment)', () => {
        expect(currentPortraitMaxSide()).toBeNull()
    })

    test('currentPortraitMaxSide is null on a phone-sized screen when the platform is not mobile', () => {
        vi.stubGlobal('screen', { width: 412, height: 846 })
        vi.stubGlobal('devicePixelRatio', 3.5)
        try {
            expect(currentPortraitMaxSide()).toBeNull()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('currentPortraitMaxSide reads the platform flag, the live screen and the pixel ratio', () => {
        platform.mobile = true
        vi.stubGlobal('screen', { width: 412, height: 846 })
        vi.stubGlobal('devicePixelRatio', 3.5)
        try {
            expect(currentPortraitMaxSide()).toBe(3072)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('fitWithin', () => {
    test('never enlarges and scales the long side', () => {
        expect(fitWithin(1000, 1500, 3072)).toBeNull()
        expect(fitWithin(3072, 100, 3072)).toBeNull()
        expect(fitWithin(4096, 6144, 3072)).toEqual({ w: 2048, h: 3072 })
        expect(fitWithin(6144, 4096, 3072)).toEqual({ w: 3072, h: 2048 })
    })
})

describe('shrinkPortrait', () => {
    test('P3: an image within the max side keeps the original, releases the decode and draws nothing', async () => {
        const r = rig({ width: 1000, height: 1500 })
        const outcome = await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        expect(outcome).toEqual({ kind: 'original' })
        expect(r.decoded.release).toHaveBeenCalledTimes(1)
        expect(r.canvases).toHaveLength(0)
    })

    test('P4: a large still is drawn at the fitted size, encoded as WebP, decoded with the orientation option and released', async () => {
        const r = rig()
        const outcome = await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        expect(outcome).toEqual({ kind: 'shrunk', url: 'blob:shrunk', width: 2048, height: 3072, bytes: 10 })
        expect(r.decode.mock.calls[0][2]).toEqual({ imageOrientation: 'from-image' })
        expect(r.canvases[0].draws[0]).toEqual([0, 0, 2048, 3072])
        expect(r.encode.mock.calls[0][1]).toBe('image/webp')
        expect(r.decoded.release).toHaveBeenCalledTimes(1)
        expect(r.canvases[0].width).toBe(0)
        expect(r.canvases[0].height).toBe(0)
    })

    describe('P5: every failure keeps the original and releases what was opened', () => {
        test('fetch rejects', async () => {
            const r = rig()
            r.fetch.mockRejectedValue(new Error('network'))
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        })

        test('response is not ok', async () => {
            const r = rig()
            r.fetch.mockResolvedValue({ ok: false, blob: async () => new Blob([]) })
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
            expect(r.decode).not.toHaveBeenCalled()
        })

        test('decode rejects', async () => {
            const r = rig()
            r.decode.mockRejectedValue(new Error('decode'))
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        })

        test('decode gives null', async () => {
            const r = rig()
            r.decode.mockResolvedValue(null)
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        })

        test('the canvas has no 2d context: the decode is released and the canvas zeroed', async () => {
            const r = rig()
            const noContext = fakeCanvas()
            noContext.getContext = () => null
            r.deps.createCanvas = (width, height) => {
                noContext.width = width
                noContext.height = height
                return noContext
            }
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
            expect(r.decoded.release).toHaveBeenCalledTimes(1)
            expect(noContext.width).toBe(0)
        })

        test('encode gives null: the decode is released and the canvas zeroed', async () => {
            const r = rig()
            r.encode.mockResolvedValue(null)
            expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
            expect(r.createObjectURL).not.toHaveBeenCalled()
            expect(r.decoded.release).toHaveBeenCalledTimes(1)
            expect(r.canvases[0].width).toBe(0)
        })
    })
})

describe('sniff before the shrink', () => {
    async function outcomeFor(blob: Blob) {
        const r = rig({ blob })
        const outcome = await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        return { outcome, r }
    }

    test('S1: the real still is shrunk', async () => {
        const { outcome } = await outcomeFor(new Blob([realPng]))
        expect(outcome.kind).toBe('shrunk')
    })

    test('S1: animated, unknown and undecidable files keep the original and are never decoded', async () => {
        const acTL = pngChunk('acTL', new Uint8Array(8))
        const webp = new Uint8Array(readFileSync('public/bg.webp'))
        const animatedWebp = webp.slice()
        animatedWebp[20] |= 0x02
        const gif = new TextEncoder().encode('GIF89a' + '\0'.repeat(30))
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000"></svg>')
        const avis = new Uint8Array(32)
        avis.set([0, 0, 0, 24], 0)
        avis.set(new TextEncoder().encode('ftypavis'), 4)
        const cases: [string, Blob][] = [
            ['apng', pngWith(acTL)],
            ['animated webp', new Blob([animatedWebp])],
            ['gif', new Blob([gif])],
            ['svg', new Blob([svg])],
            ['avif sequence', new Blob([avis])],
        ]
        for (const [name, blob] of cases) {
            const { outcome, r } = await outcomeFor(blob)
            expect(outcome, name).toEqual({ kind: 'original' })
            expect(r.decode, name).not.toHaveBeenCalled()
        }
    })

    test('S2: a PNG with 200 KiB of metadata before IDAT is still shrunk', async () => {
        const { outcome } = await outcomeFor(pngWith(textChunk(200 * 1024)))
        expect(outcome.kind).toBe('shrunk')
    })

    test('S3: a PNG whose IDAT starts beyond the 1 MiB prefix cannot be decided and keeps the original', async () => {
        const { outcome, r } = await outcomeFor(pngWith(textChunk(1100 * 1024)))
        expect(outcome).toEqual({ kind: 'original' })
        expect(r.decode).not.toHaveBeenCalled()
    })

    test('S3: a whole file within the prefix is decided on all its bytes', async () => {
        const small = concat([
            realPng.subarray(0, IHDR_END),
            textChunk(900 * 1024),
            pngChunk('IDAT', new Uint8Array(16)),
            pngChunk('IEND', new Uint8Array(0)),
        ])
        expect(small.length).toBeLessThan(1024 * 1024)
        const { outcome } = await outcomeFor(new Blob([small]))
        expect(outcome.kind).toBe('shrunk')
    })
})
