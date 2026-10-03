import { describe, expect, it } from 'vitest'
import crc32 from 'crc/crc32'
import { PngChunk, readTextChunkKey, type PngCardScan } from './pngChunk'
import { AppendableBuffer } from './byteBuffer'

// ---------------------------------------------------------------------------------------------
// Synthetic PNG builder (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ASSET = 'chara-ext-asset_'
const utf8 = (s: string) => new TextEncoder().encode(s)

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const t = utf8(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

const text = (key: string | Uint8Array, value: string) =>
    chunk('tEXt', concat([typeof key === 'string' ? utf8(key) : key, new U8([0]), utf8(value)]))
const raw = (type: string, n = 10) => chunk(type, new U8(n).fill(3))
const iend = () => chunk('IEND', new U8(0))
const filler = (n: number) => 'A'.repeat(n)
const card = (...chunks: Uint8Array[]) => concat([SIG, ...chunks])
const BOM = new U8([0xef, 0xbb, 0xbf])

// ---------------------------------------------------------------------------------------------
// The shared tEXt key decode
// ---------------------------------------------------------------------------------------------

describe('readTextChunkKey', () => {
    it('splits at the first NUL below index 70 and decodes the key with the default TextDecoder', () => {
        expect(readTextChunkKey(concat([utf8('chara'), new U8([0]), utf8('value')]))).toEqual({ key: 'chara', valueStart: 6 })
        expect(readTextChunkKey(concat([BOM, utf8('chara'), new U8([0]), utf8('v')]))).toEqual({ key: 'chara', valueStart: 9 })
    })

    it('finds a NUL at index 69 and not one at index 70', () => {
        expect(readTextChunkKey(concat([utf8('k'.repeat(69)), new U8([0]), utf8('v')]))?.key).toBe('k'.repeat(69))
        expect(readTextChunkKey(concat([utf8('k'.repeat(70)), new U8([0]), utf8('v')]))).toBeNull()
    })

    it('returns null for an empty body and for a body without a NUL', () => {
        expect(readTextChunkKey(new U8(0))).toBeNull()
        expect(readTextChunkKey(utf8('no terminator'))).toBeNull()
    })

    it('reads an empty key when the body starts with a NUL', () => {
        expect(readTextChunkKey(new U8([0, 65]))).toEqual({ key: '', valueStart: 1 })
    })
})

// ---------------------------------------------------------------------------------------------
// Count equivalence with the stream prereader (compatibility guard for the new scanCard API)
// ---------------------------------------------------------------------------------------------

const cards: Array<[string, Uint8Array]> = [
    ['no assets', card(raw('IHDR', 13), raw('IDAT', 40), text('chara', filler(200)), iend())],
    ['small assets', card(raw('IHDR', 13), text('chara', filler(120)), text(ASSET + ':0', filler(90)), text(ASSET + ':1', 'A'), text(ASSET + ':2', ''), iend())],
    ['large assets', card(raw('IHDR', 13), text('chara', filler(500)), text(ASSET + ':0', filler(100000)), text(ASSET + ':1', filler(70000)), iend())],
    ['keys of 69 and 70 bytes without NUL, empty key, empty body', card(
        raw('IHDR', 13), text('k'.repeat(69), 'x'), text('j'.repeat(70), 'y'),
        chunk('tEXt', utf8('x'.repeat(100))), text('', 'e'), chunk('tEXt', new U8(0)), iend(),
    )],
    ['BOM keys', card(raw('IHDR', 13), text(concat([BOM, utf8('chara')]), filler(60)), text(concat([BOM, utf8(ASSET + ':0')]), filler(60)), iend())],
    ['asset key with the NUL at index 69 and at index 70', card(text(ASSET + 'x'.repeat(53), 'v'), text(ASSET + 'x'.repeat(54), 'v'), iend())],
    ['trailing bytes after IEND', card(
        raw('IHDR', 13), text('chara', filler(40)), iend(),
        concat([utf8('\0\0\0\u0005tEXt' + ASSET + '\0zzzzz'), new U8(50)]),
    )],
    ['many IDAT', card(raw('IHDR', 13), ...Array.from({ length: 50 }, () => raw('IDAT', 100)), text(ASSET + ':0', filler(64)), iend())],
    ['small truncation card', card(raw('IHDR', 4), raw('IDAT', 3), text('chara', 'AB'), text(ASSET + ':0', 'CD'), iend())],
    ['no IEND', card(raw('IHDR', 13), text(ASSET + ':0', filler(40)), text(ASSET + ':1', filler(40)))],
    ['huge length on a tEXt header', concat([card(text(ASSET + ':0', 'a')), new U8([0xff, 0xff, 0xff, 0xff]), utf8('tEXt' + ASSET + ':1\0abc')])],
    ['huge length on an IDAT header', concat([card(text(ASSET + ':0', 'a')), new U8([0xff, 0xff, 0xff, 0xf0]), utf8('IDAT'), new U8(30)])],
]

// Larger than the default read window, so the walk crosses window edges in production sizes.
const BIG_ASSET = 120_000
const bigCard = card(raw('IHDR', 13), text('chara', filler(300)), text(ASSET + ':0', filler(BIG_ASSET)), text(ASSET + ':1', filler(BIG_ASSET)), text(ASSET + ':2', filler(BIG_ASSET)), iend())

async function prereaderCount(bytes: Uint8Array): Promise<number> {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let i = 0; i < bytes.length; i += 64) controller.enqueue(bytes.slice(i, i + 64))
            controller.close()
        },
    })
    let n = 0
    for await (const y of PngChunk.readGenerator(stream, {})) {
        if (!(y instanceof AppendableBuffer) && y.key.startsWith(ASSET)) n++
    }
    return n
}

function cutOffsets(bytes: Uint8Array): number[] {
    if (bytes.length < 2000) return Array.from({ length: bytes.length + 1 }, (_, i) => i)
    const picks = [...Array.from({ length: 120 }, (_, i) => i), bytes.length - 30, bytes.length - 13, bytes.length - 12, bytes.length - 5, bytes.length]
    for (let at = 8; at < bytes.length; at += 40_000) picks.push(at, at + 1, at + 7, at + 9)
    return [...new Set(picks.filter((x) => x >= 0 && x <= bytes.length))]
}

const WINDOWS: Array<number | undefined> = [undefined, 1, 7, 13, 78]
const fileOf = (bytes: Uint8Array) => new File([new U8(bytes)], 'card.png', { type: 'image/png' })

describe('PngChunk.scanCard asset count (compatibility guard)', () => {
    it.each(cards)('equals the stream prereader count at every cut, for Uint8Array and File with any window: %s', async (_name, bytes) => {
        for (const cut of cutOffsets(bytes)) {
            const truncated = bytes.subarray(0, cut)
            const expected = await prereaderCount(truncated)
            expect((await PngChunk.scanCard(new U8(truncated))).assetCount, `Uint8Array, cut ${cut}`).toBe(expected)
            for (const windowSize of WINDOWS) {
                const scan = await PngChunk.scanCard(fileOf(truncated), { windowSize })
                expect(scan.assetCount, `File, window ${windowSize ?? 'default'}, cut ${cut}`).toBe(expected)
            }
        }
    }, 120_000)

    it('equals the stream prereader count for a card larger than the default window', async () => {
        expect(bigCard.length).toBeGreaterThan(300 * 1024)
        for (const cut of cutOffsets(bigCard)) {
            const truncated = bigCard.subarray(0, cut)
            const expected = await prereaderCount(truncated)
            expect((await PngChunk.scanCard(fileOf(truncated))).assetCount, `File, default window, cut ${cut}`).toBe(expected)
            expect((await PngChunk.scanCard(new U8(truncated))).assetCount, `Uint8Array, cut ${cut}`).toBe(expected)
        }
    }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// The completeness rule, per chunk kind
// ---------------------------------------------------------------------------------------------

describe('PngChunk.scanCard completeness', () => {
    // sig | IHDR | IDAT | tEXt chara | tEXt asset 0 | IEND
    const parts = [raw('IHDR', 13), raw('IDAT', 40), text('chara', filler(30)), text(ASSET + ':0', filler(30)), iend()]
    const starts: number[] = []
    {
        let at = SIG.length
        for (const p of parts) {
            starts.push(at)
            at += p.length
        }
    }
    const full = card(...parts)
    const [, idatAt, charaAt, assetAt, iendAt] = starts
    const idatEnd = charaAt
    const assetEnd = iendAt

    type Expect = Partial<PngCardScan>
    const cases: Array<[string, Uint8Array, Expect]> = [
        ['a complete card', full, { cut: false, iendReached: true, hasCardData: true, assetCount: 1 }],
        ['trailing bytes after IEND are ignored', concat([full, utf8('garbage after the end')]), { cut: false, iendReached: true, hasCardData: true, assetCount: 1 }],
        ['IEND missing at a chunk boundary is complete', full.subarray(0, iendAt), { cut: false, iendReached: false, hasCardData: true, assetCount: 1 }],
        ['1 byte of an IEND header is complete', full.subarray(0, iendAt + 1), { cut: false, iendReached: false, hasCardData: true }],
        ['4 bytes of an IEND header are complete', full.subarray(0, iendAt + 4), { cut: false, iendReached: false, hasCardData: true }],
        ['7 bytes of an IEND header are complete', full.subarray(0, iendAt + 7), { cut: false, iendReached: false, hasCardData: true }],
        ['a whole IEND header with no CRC is complete', full.subarray(0, iendAt + 8), { cut: false, iendReached: true, hasCardData: true }],
        ['an IEND with a cut CRC is complete', full.subarray(0, iendAt + 10), { cut: false, iendReached: true, hasCardData: true }],
        ['1 stray byte that does not begin an IEND header is cut', concat([full.subarray(0, iendAt), new U8([1])]), { cut: true, iendReached: false, hasCardData: true }],
        ['7 stray bytes that do not begin an IEND header are cut', concat([full.subarray(0, iendAt), new U8([0, 0, 0, 0, 0x49, 0x45, 0x4f])]), { cut: true, hasCardData: true }],
        ['a cut inside the next chunk header after 4 bytes is cut', full.subarray(0, assetAt + 4), { cut: true, hasCardData: true, assetCount: 0 }],
        ['a cut in the CRC of the last tEXt chunk is complete', full.subarray(0, assetEnd - 2), { cut: false, hasCardData: true, assetCount: 1 }],
        ['a cut just before the CRC of the last tEXt chunk is complete', full.subarray(0, assetEnd - 4), { cut: false, hasCardData: true, assetCount: 1 }],
        ['a cut inside the body of a tEXt chunk is cut', full.subarray(0, assetEnd - 6), { cut: true, hasCardData: true, assetCount: 0 }],
        ['a cut inside the body of the card tEXt chunk is cut and has no card data', full.subarray(0, charaAt + 12), { cut: true, hasCardData: false }],
        ['a cut in the CRC of a non-tEXt chunk is cut', full.subarray(0, idatEnd - 2), { cut: true, hasCardData: false }],
        ['a cut in the body of a non-tEXt chunk is cut', full.subarray(0, idatAt + 12), { cut: true }],
        ['a complete PNG with no card data', card(raw('IHDR', 13), raw('IDAT', 40), text(ASSET + ':0', 'x'), iend()), { cut: false, iendReached: true, hasCardData: false, assetCount: 1 }],
        ['a ccv3 chunk counts as card data', card(raw('IHDR', 13), text('ccv3', 'x'), iend()), { cut: false, iendReached: true, hasCardData: true }],
        ['a BOM-prefixed chara key counts as card data', card(text(concat([BOM, utf8('chara')]), 'x'), iend()), { hasCardData: true }],
        ['a key that only starts with chara is not card data', card(text('charax', 'x'), iend()), { hasCardData: false }],
        ['fewer than 8 bytes is an empty walk', SIG.subarray(0, 5), { cut: false, iendReached: false, hasCardData: false, assetCount: 0 }],
        ['just the signature is an empty walk', SIG, { cut: false, iendReached: false, hasCardData: false, assetCount: 0 }],
    ]

    it('lays out the card as documented', () => {
        expect(starts.length).toBe(5)
        expect(full.length).toBe(iendAt + 12)
    })

    it.each(cases)('%s', async (_label, bytes, expected) => {
        expect(await PngChunk.scanCard(new U8(bytes)), 'Uint8Array').toMatchObject(expected)
        for (const windowSize of WINDOWS) {
            expect(await PngChunk.scanCard(fileOf(bytes), { windowSize }), `File, window ${windowSize ?? 'default'}`).toMatchObject(expected)
        }
    })

    it('gives the same result for a File and a Uint8Array at every cut of a card', async () => {
        for (let cut = 0; cut <= full.length; cut++) {
            const truncated = full.subarray(0, cut)
            const reference = await PngChunk.scanCard(new U8(truncated))
            for (const windowSize of WINDOWS) {
                expect(await PngChunk.scanCard(fileOf(truncated), { windowSize }), `window ${windowSize ?? 'default'}, cut ${cut}`).toEqual(reference)
            }
        }
    })

    it('reads each tEXt key prefix of a many-asset File without loading the bodies', async () => {
        // 50 assets of 20 KB: the walk reads headers and key prefixes, so the bytes loaded through windows stay far
        // below the file size.
        const assets = Array.from({ length: 50 }, (_, i) => text(ASSET + ':' + i, filler(20_000)))
        const bytes = card(raw('IHDR', 13), text('chara', 'x'), ...assets, iend())
        const file = fileOf(bytes)
        let loaded = 0
        const originalSlice = file.slice.bind(file)
        file.slice = ((start?: number, end?: number, type?: string) => {
            const part = originalSlice(start, end, type)
            loaded += part.size
            return part
        }) as typeof file.slice
        const scan = await PngChunk.scanCard(file, { windowSize: 1024 })
        expect(scan).toMatchObject({ assetCount: 50, cut: false, iendReached: true, hasCardData: true })
        expect(bytes.length).toBeGreaterThan(900_000)
        expect(loaded, 'bytes loaded through windows').toBeLessThan(bytes.length / 10)
    })
})
