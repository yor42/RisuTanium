import { afterEach, describe, expect, it, vi } from 'vitest'
import crc32 from 'crc/crc32'
import { PngChunk, StreamWindow } from './pngChunk'
import { AppendableBuffer } from './byteBuffer'

// The real Uint8Array, captured before any test replaces the global with a counting wrapper.
const RealU8 = Uint8Array

// ---------------------------------------------------------------------------------------------
// Synthetic PNG builder (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type ChunkSpec = { type: string, body: Uint8Array, crc?: number[] }

function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0
    for (const p of parts) total += p.length
    const out = new RealU8(total)
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

const ascii = (s: string) => new RealU8(Array.from(s, (c) => c.charCodeAt(0)))
const utf8 = (s: string) => new TextEncoder().encode(s)

function encodeChunk(spec: ChunkSpec): Uint8Array {
    const type = ascii(spec.type)
    const len = new RealU8(4)
    new DataView(len.buffer).setUint32(0, spec.body.length)
    let crc = spec.crc
    if (!crc) {
        const value = crc32(Buffer.from(concat([type, spec.body])))
        crc = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
    }
    return concat([len, type, spec.body, new RealU8(crc)])
}

const text = (key: string | Uint8Array, value: string | Uint8Array, crc?: number[]): ChunkSpec => ({
    type: 'tEXt',
    body: concat([typeof key === 'string' ? utf8(key) : key, new RealU8([0]), typeof value === 'string' ? utf8(value) : value]),
    crc,
})
const raw = (type: string, body: Uint8Array | number[], crc?: number[]): ChunkSpec => ({ type, body: new RealU8(body), crc })
const iend = (): ChunkSpec => raw('IEND', [])

type Card = {
    bytes: Uint8Array
    /** start offset of each chunk, in file order */
    starts: number[]
    /** number of tEXt chunks in the card */
    texts: number
    /** length of the trimmed output a complete read returns: signature plus every non-tEXt chunk up to and including IEND */
    trimmedLength: number
}

function buildCard(specs: ChunkSpec[], trailing: Uint8Array = new RealU8(0)): Card {
    const parts: Uint8Array[] = [new RealU8(SIGNATURE)]
    const starts: number[] = []
    let at = SIGNATURE.length
    let trimmedLength = SIGNATURE.length
    let texts = 0
    let ended = false
    for (const spec of specs) {
        const enc = encodeChunk(spec)
        starts.push(at)
        parts.push(enc)
        at += enc.length
        if (!ended) {
            if (spec.type === 'tEXt') texts++
            else trimmedLength += enc.length
            if (spec.type === 'IEND') ended = true
        }
    }
    parts.push(trailing)
    return { bytes: concat(parts), starts, texts, trimmedLength }
}

/** Deterministic base64-alphabet filler of exactly `length` characters. */
function filler(length: number, seed = 1): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let state = seed >>> 0
    const chars = new Array<string>(length)
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        chars[i] = alphabet[state >>> 26]
    }
    return chars.join('')
}

const ihdr = () => raw('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
const idat = (n = 40) => raw('IDAT', Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff))

// ---------------------------------------------------------------------------------------------
// Inputs and chunkings
// ---------------------------------------------------------------------------------------------

type Plan =
    | { kind: 'fixed', size: number }
    | { kind: 'cuts', at: number[] }

function pieces(length: number, plan: Plan): Array<[number, number]> {
    const bounds: number[] = [0]
    if (plan.kind === 'fixed') {
        for (let p = plan.size; p < length; p += plan.size) bounds.push(p)
    } else {
        for (const p of [...plan.at].sort((a, b) => a - b)) {
            if (p > bounds[bounds.length - 1] && p < length) bounds.push(p)
        }
    }
    bounds.push(length)
    const out: Array<[number, number]> = []
    for (let i = 0; i + 1 < bounds.length; i++) out.push([bounds[i], bounds[i + 1]])
    return out
}

/**
 * A stream of independent chunk buffers (each chunk owns its ArrayBuffer, as network chunks do). With `noise`, an empty
 * chunk and an `undefined` value precede every real chunk.
 */
function streamOf(bytes: Uint8Array, plan: Plan, noise = false): ReadableStream<Uint8Array> {
    const items: Array<Uint8Array | undefined> = []
    for (const [a, b] of pieces(bytes.length, plan)) {
        if (noise) items.push(new RealU8(0), undefined)
        items.push(new RealU8(bytes.subarray(a, b)))
    }
    let next = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (next >= items.length) {
                controller.close()
                return
            }
            controller.enqueue(items[next++] as Uint8Array)
        },
    })
}

const fileOf = (bytes: Uint8Array) => new File([new RealU8(bytes)], 'card.png', { type: 'image/png' })

// ---------------------------------------------------------------------------------------------
// Running the generator
// ---------------------------------------------------------------------------------------------

type Item = { key: string, value: string } | { trimmed: string }
type Outcome = { items: Item[], error: string | null }

const hex = (u8: Uint8Array) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('hex')

async function run(input: File | Uint8Array | ReadableStream<Uint8Array>, options: { returnTrimed?: boolean }): Promise<Outcome> {
    const items: Item[] = []
    let error: string | null = null
    try {
        for await (const y of PngChunk.readGenerator(input, options)) {
            if (y instanceof AppendableBuffer) items.push({ trimmed: hex(y.buffer) })
            else items.push({ key: y.key, value: y.value })
        }
    } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
    return { items, error }
}

// ---------------------------------------------------------------------------------------------
// R1: copy volume is linear in the file size
// ---------------------------------------------------------------------------------------------

// Bytes copied per file byte allowed in one pass. The Uint8Array branch and the stream window both copy about 2 bytes
// per file byte (one copy of each chunk's range, plus the value slice for tEXt bodies or the trimmed output for other
// chunks). 5 leaves headroom and still rejects a window that copies everything it holds on every read.
const MAX_COPIED_PER_FILE_BYTE = 5
// Growth allowed in copied-per-file-byte when the asset count quadruples. A linear pass is flat (about 1.0); a window
// that copies everything it retains on every read grows with the amount retained.
const MAX_GROWTH_ON_QUADRUPLING = 1.2
const BASE_ASSETS = 10
const ASSET_CHARS = 1_000_000
const STREAM_CHUNK = 64 * 1024

type CopyCounter = { copied: number, restore: () => void }

/** Counts bytes copied through slice, set, and the Uint8Array constructor taking a view or array. */
function installCopyCounter(): CopyCounter {
    const typedProto = Object.getPrototypeOf(RealU8.prototype) as { slice: (...a: number[]) => Uint8Array, set: (...a: unknown[]) => void }
    const origSlice = typedProto.slice
    const origSet = typedProto.set
    const origBufferSlice = ArrayBuffer.prototype.slice
    const counter: CopyCounter = { copied: 0, restore: () => {} }

    typedProto.slice = function (this: Uint8Array, ...args: number[]) {
        const out = origSlice.apply(this, args)
        counter.copied += out.byteLength
        return out
    }
    typedProto.set = function (this: Uint8Array, source: ArrayLike<number>, ...rest: unknown[]) {
        counter.copied += source.length
        return origSet.call(this, source, ...rest)
    }
    ArrayBuffer.prototype.slice = function (this: ArrayBuffer, ...args: number[]) {
        const out = origBufferSlice.apply(this, args as [number, number])
        counter.copied += out.byteLength
        return out
    }
    const Counting: typeof Uint8Array = new Proxy(RealU8, {
        construct(target, args, newTarget) {
            const out = Reflect.construct(target, args, newTarget === Counting ? target : newTarget)
            if (ArrayBuffer.isView(args[0]) || Array.isArray(args[0])) counter.copied += out.byteLength
            return out
        },
    })
    vi.stubGlobal('Uint8Array', Counting)

    counter.restore = () => {
        vi.unstubAllGlobals()
        typedProto.slice = origSlice
        typedProto.set = origSet
        ArrayBuffer.prototype.slice = origBufferSlice
    }
    return counter
}

let activeCounter: CopyCounter | null = null
afterEach(() => {
    activeCounter?.restore()
    activeCounter = null
})

function assetCard(assets: number): Card {
    const value = filler(ASSET_CHARS)
    const specs: ChunkSpec[] = [ihdr(), idat(), text('chara', filler(300, 9))]
    for (let i = 0; i < assets; i++) specs.push(text(`chara-ext-asset_:${i}`, value))
    specs.push(iend())
    return buildCard(specs)
}

async function copiedPerFileByte(assets: number, kind: 'stream' | 'file'): Promise<number> {
    const card = assetCard(assets)
    const input = kind === 'stream' ? streamOf(card.bytes, { kind: 'fixed', size: STREAM_CHUNK }) : fileOf(card.bytes)
    const counter = installCopyCounter()
    activeCounter = counter
    let seen = 0
    for await (const y of PngChunk.readGenerator(input, { returnTrimed: true })) {
        if (!(y instanceof AppendableBuffer) && y.key.startsWith('chara-ext-asset_')) seen++
    }
    counter.restore()
    activeCounter = null
    expect(seen).toBe(assets)
    return counter.copied / card.bytes.length
}

describe('PngChunk.readGenerator copy volume (regression reproducer)', () => {
    it.each(['stream', 'file'] as const)(
        'copies a small constant multiple of the file size, flat as the asset count quadruples: %s input',
        async (kind) => {
            const base = await copiedPerFileByte(BASE_ASSETS, kind)
            const quadrupled = await copiedPerFileByte(BASE_ASSETS * 4, kind)
            expect(base, `bytes copied per file byte at ${BASE_ASSETS} assets`).toBeLessThanOrEqual(MAX_COPIED_PER_FILE_BYTE)
            expect(quadrupled, `bytes copied per file byte at ${BASE_ASSETS * 4} assets`).toBeLessThanOrEqual(MAX_COPIED_PER_FILE_BYTE)
            expect(quadrupled / base, 'growth of copied-per-file-byte when assets quadruple').toBeLessThanOrEqual(MAX_GROWTH_ON_QUADRUPLING)
        },
    )
})

// ---------------------------------------------------------------------------------------------
// G1: differential equivalence with the Uint8Array branch
// ---------------------------------------------------------------------------------------------

const cards: Array<[string, () => Card]> = [
    ['no assets', () => buildCard([ihdr(), idat(), text('chara', filler(200, 2)), iend()])],
    ['small assets', () => buildCard([
        ihdr(), idat(), text('chara', filler(120, 3)),
        text('chara-ext-asset_:0', filler(90, 4)), text('chara-ext-asset_:1', filler(1, 5)), text('chara-ext-asset_:2', ''),
        iend(),
    ])],
    ['large assets', () => buildCard([
        ihdr(), idat(2000), text('chara', filler(500, 6)),
        text('chara-ext-asset_:0', filler(100_000, 7)), text('chara-ext-asset_:1', filler(70_000, 8)),
        iend(),
    ])],
    ['tEXt keys of 69 and 70 bytes, no NUL, empty key, empty body', () => buildCard([
        ihdr(), idat(),
        text('k'.repeat(69), 'sixty-nine'),
        text('j'.repeat(70), 'seventy'),
        { type: 'tEXt', body: utf8('x'.repeat(100)) },
        text('', 'empty key'),
        { type: 'tEXt', body: new RealU8(0) },
        iend(),
    ])],
    ['tEXt key with a UTF-8 BOM', () => buildCard([
        ihdr(), idat(),
        text(concat([new RealU8([0xef, 0xbb, 0xbf]), utf8('chara')]), filler(60, 10)),
        text(concat([new RealU8([0xef, 0xbb, 0xbf]), utf8('chara-ext-asset_:0')]), filler(60, 11)),
        iend(),
    ])],
    ['chara and ccv3 both present', () => buildCard([
        ihdr(), idat(), text('chara', filler(80, 12)), text('ccv3', filler(95, 13)), text('chara-ext-asset_:0', filler(30, 14)), iend(),
    ])],
    ['non-tEXt ancillary chunks between tEXt chunks', () => buildCard([
        ihdr(), raw('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]), text('chara', filler(50, 15)),
        raw('tIME', [7, 232, 10, 3, 1, 2, 3]), raw('iTXt', Array.from({ length: 30 }, (_, i) => i + 1)),
        text('chara-ext-asset_:0', filler(70, 16)),
        raw('zTXt', Array.from({ length: 20 }, (_, i) => 200 - i)), idat(300), iend(),
    ])],
    ['many small IDAT chunks', () => buildCard([
        ihdr(), ...Array.from({ length: 300 }, () => idat(100)), text('chara', filler(64, 17)), text('chara-ext-asset_:0', filler(64, 18)), iend(),
    ])],
    ['multi-byte UTF-8 values', () => buildCard([
        ihdr(), idat(), text('chara', 'héllo 한국어 \u{1f600}'), text('chara-ext-asset_:0', 'é'.repeat(40)), iend(),
    ])],
    ['trailing bytes after IEND', () => buildCard(
        [ihdr(), idat(), text('chara', filler(40, 19)), iend()],
        concat([ascii('\0\0\0\u0005tEXtchara\0zzzzz'), new RealU8(50).fill(0x55)]),
    )],
]

function cutPlans(card: Card): Array<[string, Plan]> {
    const at = (offset: number) => card.starts.map((s) => s + offset)
    const iendStart = card.starts[card.starts.length - 1]
    return [
        ['cut inside every length field', { kind: 'cuts', at: at(2) }],
        ['cut inside every type field', { kind: 'cuts', at: at(6) }],
        ['cut one byte into every body', { kind: 'cuts', at: at(9) }],
        ['cut inside every CRC', { kind: 'cuts', at: at(13) }],
        ['cut inside IEND', { kind: 'cuts', at: [iendStart + 5, iendStart + 10] }],
    ]
}

describe('PngChunk.readGenerator equivalence with the Uint8Array branch (compatibility guard)', () => {
    it.each(cards)('stream and File input yield the same items and trimmed bytes for any chunking: %s', async (_name, build) => {
        const card = build()
        const small = card.bytes.length <= 4096
        const plans: Array<[string, Plan, boolean]> = [
            ['7-byte chunks', { kind: 'fixed', size: 7 }, false],
            ['64 KB chunks', { kind: 'fixed', size: STREAM_CHUNK }, false],
            ['whole file in one chunk', { kind: 'fixed', size: card.bytes.length }, false],
            ['7-byte chunks with empty and undefined reads', { kind: 'fixed', size: 7 }, true],
            ...cutPlans(card).map(([label, plan]): [string, Plan, boolean] => [label, plan, false]),
            ['cut inside every body with empty and undefined reads', { kind: 'cuts', at: card.starts.map((s) => s + 9) }, true],
        ]
        if (small) plans.unshift(['1-byte chunks', { kind: 'fixed', size: 1 }, false])

        for (const returnTrimed of [true, false]) {
            const reference = await run(new RealU8(card.bytes), { returnTrimed })
            expect(reference.error, 'Uint8Array branch error').toBeNull()
            expect(reference.items.filter((i) => 'key' in i).length, 'tEXt yields of the Uint8Array branch').toBe(card.texts)
            if (returnTrimed) {
                const last = reference.items[reference.items.length - 1]
                expect(last, 'trimmed result is the last yield').toHaveProperty('trimmed')
                expect((last as { trimmed: string }).trimmed.length / 2, 'trimmed length').toBe(card.trimmedLength)
            }
            for (const [label, plan, noise] of plans) {
                const outcome = await run(streamOf(card.bytes, plan, noise), { returnTrimed })
                expect(outcome, `stream, ${label}, returnTrimed=${returnTrimed}`).toEqual(reference)
            }
            expect(await run(fileOf(card.bytes), { returnTrimed }), `File, returnTrimed=${returnTrimed}`).toEqual(reference)
        }
    })
})

// ---------------------------------------------------------------------------------------------
// G2: truncated input on the stream branch
// ---------------------------------------------------------------------------------------------

describe('PngChunk.readGenerator truncated streams (compatibility guard)', () => {
    // sig(8) | IHDR 4-byte body (8..23) | IDAT 3-byte body (24..38) | tEXt chara=AB (39..58)
    // | tEXt chara-ext-asset_:0=CD (59..91) | IEND (92..103)
    const truncCard = () => buildCard([
        raw('IHDR', [1, 2, 3, 4], [0xa1, 0xa1, 0xa1, 0xa1]),
        raw('IDAT', [5, 6, 7], [0xb2, 0xb2, 0xb2, 0xb2]),
        text('chara', 'AB', [0xc3, 0xc3, 0xc3, 0xc3]),
        text('chara-ext-asset_:0', 'CD', [0xd4, 0xd4, 0xd4, 0xd4]),
        { type: 'IEND', body: new RealU8(0), crc: [0xae, 0x42, 0x60, 0x82] },
    ])

    it('lays out the truncation card as documented', () => {
        const card = truncCard()
        expect(card.starts).toEqual([8, 24, 39, 59, 92])
        expect(card.bytes.length).toBe(104)
    })

    const SIG_HEX = '89504e470d0a1a0a'
    const IHDR_HEX = '00000004' + '49484452' + '01020304' + 'a1a1a1a1'
    const IDAT_HEX = '00000003' + '49444154' + '050607' + 'b2b2b2b2'
    const IEND_HEX = '00000000' + '49454e44' + 'ae426082'
    const CHARA: Item = { key: 'chara', value: 'AB' }
    const ASSET: Item = { key: 'chara-ext-asset_:0', value: 'CD' }
    const EMPTY: Item = { key: '', value: '' }

    const cases: Array<{ title: string, cut: number, items: Item[] }> = [
        { title: 'a complete card yields both tEXt chunks and the trimmed PNG with every non-tEXt chunk verbatim', cut: 104,
            items: [CHARA, ASSET, { trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX + IEND_HEX }] },
        { title: 'a 5-byte file ends with an empty trimmed result and no other yield', cut: 5,
            items: [{ trimmed: '' }] },
        { title: 'a cut inside IDAT drops that chunk from the trimmed result and ends without error', cut: 33,
            items: [{ trimmed: SIG_HEX + IHDR_HEX }] },
        { title: 'a cut inside the CRC of a non-tEXt chunk drops that chunk from the trimmed result', cut: 37,
            items: [{ trimmed: SIG_HEX + IHDR_HEX }] },
        { title: 'a cut inside a chunk length field ends the read; chunks before it are kept and the cut chunk is not yielded', cut: 41,
            items: [{ trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
        { title: 'a cut inside a chunk type field ends the read the same way as a cut inside the length field', cut: 45,
            items: [{ trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
        { title: 'a tEXt body cut right after its key yields an empty key and value, never a partial value', cut: 85,
            items: [CHARA, EMPTY, { trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
        { title: 'a tEXt body cut short by the end of the stream yields an empty key and value, never a partial value', cut: 87,
            items: [CHARA, EMPTY, { trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
        { title: 'a cut inside the CRC of the last tEXt chunk still yields that tEXt chunk in full, since tEXt CRCs are not read', cut: 90,
            items: [CHARA, ASSET, { trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
        { title: 'a card with no IEND yields its tEXt chunks and a trimmed result without IEND, without error', cut: 92,
            items: [CHARA, ASSET, { trimmed: SIG_HEX + IHDR_HEX + IDAT_HEX }] },
    ]

    it.each(cases)('$title', async ({ cut, items }) => {
        const card = truncCard()
        const truncated = card.bytes.subarray(0, cut)
        const expected: Outcome = { items, error: null }
        expect(await run(streamOf(truncated, { kind: 'fixed', size: truncated.length }), { returnTrimed: true }), 'whole-file chunk').toEqual(expected)
        expect(await run(streamOf(truncated, { kind: 'fixed', size: 3 }), { returnTrimed: true }), '3-byte chunks').toEqual(expected)
        expect(await run(fileOf(truncated), { returnTrimed: true }), 'File').toEqual(expected)
    })
})

// ---------------------------------------------------------------------------------------------
// G3: a stream that rejects
// ---------------------------------------------------------------------------------------------

describe('PngChunk.readGenerator rejecting streams (compatibility guard)', () => {
    const card = buildCard([text('chara', 'eA=='), text('chara-ext-asset_:0', 'QUJD'.repeat(100)), iend()])

    function failingStream(failure: Error): ReadableStream<Uint8Array> {
        let sent = false
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!sent) {
                    // The signature and the whole first tEXt chunk, then the failure.
                    controller.enqueue(new RealU8(card.bytes.subarray(0, 8 + 12 + 'chara'.length + 1 + 4)))
                    sent = true
                    return
                }
                controller.error(failure)
            },
        })
    }

    it.each([
        ['main pass with returnTrimed', { returnTrimed: true }],
        ['prereader-style pass without options', {}],
    ] as const)('yields what came before the failure and then rejects with the same error: %s', async (_label, options) => {
        const failure = new TypeError('network error')
        const items: Array<{ key: string, value: string } | AppendableBuffer> = []
        let caught: unknown = null
        try {
            for await (const y of PngChunk.readGenerator(failingStream(failure), options)) items.push(y)
        } catch (e) {
            caught = e
        }
        expect(caught).toBe(failure)
        expect(items).toEqual([{ key: 'chara', value: 'eA==' }])
    })
})

// ---------------------------------------------------------------------------------------------
// G4: trimmed result
// ---------------------------------------------------------------------------------------------

describe('PngChunk.readGenerator trimmed result (compatibility guard)', () => {
    it('is an AppendableBuffer whose buffer is an exactly-sized fresh copy', async () => {
        const card = buildCard([ihdr(), idat(500), text('chara', filler(100, 20)), text('chara-ext-asset_:0', filler(3000, 21)), iend()])
        let trimmed: AppendableBuffer | null = null
        for await (const y of PngChunk.readGenerator(streamOf(card.bytes, { kind: 'fixed', size: 64 }), { returnTrimed: true })) {
            if (y instanceof AppendableBuffer) trimmed = y
        }
        expect(trimmed).toBeInstanceOf(AppendableBuffer)
        const first = trimmed!.buffer
        const second = trimmed!.buffer
        expect(first.byteLength).toBe(card.trimmedLength)
        expect(first.buffer.byteLength).toBe(card.trimmedLength)
        expect(first.buffer).not.toBe(second.buffer)
        first.fill(0)
        expect(second.some((b) => b !== 0)).toBe(true)
    })
})

// ---------------------------------------------------------------------------------------------
// Memory: the stream window holds only the reads that a later slice can still need
// ---------------------------------------------------------------------------------------------

describe('StreamWindow retention', () => {
    // Four reads of 10 bytes each, holding the byte values 0..39 at absolute offsets 0..39.
    function fortyBytes(): StreamWindow {
        const bytes = new RealU8(Array.from({ length: 40 }, (_, i) => i))
        return new StreamWindow(streamOf(bytes, { kind: 'fixed', size: 10 }).getReader())
    }

    it('holds every read until release, then only the reads that end after the released offset', async () => {
        const window = fortyBytes()
        await window.slice(0, 40)
        expect(window.bufferedBytes).toBe(40)

        window.release(25) // reads [0,10) and [10,20) end at or before 25; [20,30) does not
        expect(window.bufferedBytes).toBe(20)

        window.release(30) // [20,30) ends exactly at 30
        expect(window.bufferedBytes).toBe(10)

        window.release(40)
        expect(window.bufferedBytes).toBe(0)
    })

    it('returns the right bytes for a slice that starts at the released offset', async () => {
        const window = fortyBytes()
        await window.slice(0, 25)
        window.release(25)
        expect(Array.from(await window.slice(25, 33))).toEqual([25, 26, 27, 28, 29, 30, 31, 32])
        expect(window.bufferedBytes).toBe(20) // reads [20,30) and [30,40)
    })

    it('keeps a read that straddles the released offset', async () => {
        const window = fortyBytes()
        await window.slice(0, 40)
        window.release(15)
        expect(window.bufferedBytes).toBe(30)
        expect(Array.from(await window.slice(15, 22))).toEqual([15, 16, 17, 18, 19, 20, 21])
    })
})

// ---------------------------------------------------------------------------------------------
// A tEXt body that runs past the end of the input never yields a partial value, on any input kind
// ---------------------------------------------------------------------------------------------

describe('PngChunk.readGenerator cut tEXt bodies', () => {
    const card = () => buildCard([text('chara', 'AB'), text('chara-ext-asset_:0', 'CDEFGH'), iend()])
    const CHARA: Item = { key: 'chara', value: 'AB' }
    const EMPTY: Item = { key: '', value: '' }

    // The second tEXt body is "chara-ext-asset_:0", a NUL, then "CDEFGH": 25 bytes after an 8-byte header.
    async function expectEmptyItemOnEveryInput(bodyOffset: number) {
        const full = card()
        const truncated = full.bytes.subarray(0, full.starts[1] + 8 + bodyOffset)
        const expected: Outcome = { items: [CHARA, EMPTY], error: null }
        expect(await run(new RealU8(truncated), {}), 'Uint8Array').toEqual(expected)
        expect(await run(fileOf(truncated), {}), 'File').toEqual(expected)
        expect(await run(streamOf(truncated, { kind: 'fixed', size: 5 }), {}), 'stream').toEqual(expected)
    }

    it.each([
        ['right after the key terminator', 19],
        ['inside the value', 22],
        ['one byte before the end of the value', 24],
    ])('never yields a partial value on any input kind: cut %s (regression reproducer)', async (_label, bodyOffset) => {
        await expectEmptyItemOnEveryInput(bodyOffset)
    })

    it.each([
        ['right after the length and type', 0],
        ['inside the key', 5],
    ])('yields an empty key and value on every input kind: cut %s (compatibility guard)', async (_label, bodyOffset) => {
        await expectEmptyItemOnEveryInput(bodyOffset)
    })

    it('yields the whole value when only the CRC of the tEXt chunk is cut (compatibility guard)', async () => {
        const full = card()
        const truncated = full.bytes.subarray(0, full.starts[2] - 2)
        const expected: Outcome = { items: [CHARA, { key: 'chara-ext-asset_:0', value: 'CDEFGH' }], error: null }
        expect(await run(new RealU8(truncated), {})).toEqual(expected)
        expect(await run(fileOf(truncated), {})).toEqual(expected)
    })
})

describe('PngChunk.readGenerator memory', () => {
    it('keeps the bytes held by the stream window near one asset, not the file size', async () => {
        const assets = 8
        const card = assetCard(assets)
        let maxHeld = 0
        const originalSlice = StreamWindow.prototype.slice
        const spy = vi.spyOn(StreamWindow.prototype, 'slice').mockImplementation(async function (this: StreamWindow, start: number, end: number) {
            const out = await originalSlice.call(this, start, end)
            maxHeld = Math.max(maxHeld, this.bufferedBytes)
            return out
        })
        try {
            let seen = 0
            const input = streamOf(card.bytes, { kind: 'fixed', size: STREAM_CHUNK })
            for await (const y of PngChunk.readGenerator(input, { returnTrimed: true })) {
                if (!(y instanceof AppendableBuffer) && y.key.startsWith('chara-ext-asset_')) seen++
            }
            expect(seen).toBe(assets)
        } finally {
            spy.mockRestore()
        }
        // One asset chunk plus its framing and the stream reads on either side of it.
        const bound = ASSET_CHARS + 4 * STREAM_CHUNK
        expect(card.bytes.length).toBeGreaterThan(assets * ASSET_CHARS)
        expect(maxHeld, 'the window was observed holding a whole asset chunk').toBeGreaterThanOrEqual(ASSET_CHARS)
        expect(maxHeld, 'largest number of bytes held by the window').toBeLessThanOrEqual(bound)
    })
})
