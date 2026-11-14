/**
 * The ZIP feed and the piece queue of `CharXImporter` in `src/ts/process/processzip.ts`. fflate's `Unzip.push` recurses
 * about twice per entry of 31 bytes or more it finds in one pushed chunk, so a chunk holding many small entries
 * overflows the stack unless the importer feeds the reader in bounded slices (`charxLimits.feedSliceBytes`); and
 * `PieceQueue` joins the chunks it holds so that slicing does not shrink the pieces a streamed asset is written in.
 *
 * The real `processzip.ts` and the real fflate run against archives built by the real producers: `fflateZipArchive`
 * (descriptor framing), `CharXWriter` and `fflate.zipSync` (sized headers).
 *
 * Labels: a "reproducer" fails on the base, where a whole chunk is pushed to the reader; a "guard" passes before and
 * after; a "new rule" test pins the join of `PieceQueue` and fails on the base by design.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

const h = vi.hoisted(() => ({
    saved: [] as Array<{ id: string, length: number }>,
    pieceMode: false,
    pieceSaves: [] as Array<{ id: string, pieces: number[] }>,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    pieceStoreOrNull: vi.fn(async () => (h.pieceMode ? {} : null)),
    saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
        const hash = createHash('sha1')
        const lengths: number[] = []
        for await (const piece of pieces) {
            lengths.push(piece.length)
            hash.update(piece)
        }
        const id = hash.digest('hex')
        h.pieceSaves.push({ id, pieces: lengths })
        return id
    }),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        const id = createHash('sha1').update(data).digest('hex')
        h.saved.push({ id, length: data.length })
        return id
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

import { CharXImporter, CharXParseError, CharXWriter, PieceQueue, charxLimits, type EntryRoute, type EntryRouter } from 'src/ts/process/processzip'
import { ZIP_SIGNATURE_BLOB, fflateZipArchive, type ZipEntry } from './zipFixtures'

const MIB = 1024 * 1024
const enc = new TextEncoder()
const defaultLimits = { ...charxLimits }
const defaultFeedSlice = charxLimits.feedSliceBytes

function bytes(n: number, seed: number): Uint8Array {
    const a = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        a[i] = (x >> 16) & 0xff
    }
    return a
}
const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex')

function directory(z: Uint8Array) {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    let eocd = -1
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    return { eocd }
}

/** The end record states a directory one byte too large, so the directory is not trusted and every entry is still streamed. */
function untrusted(z: Uint8Array): Uint8Array {
    const c = z.slice()
    const { eocd } = directory(c)
    const dv = new DataView(c.buffer, c.byteOffset, c.byteLength)
    dv.setUint32(eocd + 12, dv.getUint32(eocd + 12, true) + 1, true)
    return c
}

function oneChunk(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(data)
            controller.close()
        },
    })
}

function chunked(data: Uint8Array, size: number): ReadableStream<Uint8Array> {
    let at = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (at >= data.length) {
                controller.close()
                return
            }
            controller.enqueue(data.slice(at, at + size))
            at += size
        },
    })
}

type Settled = { ok: true } | { ok: false, origin: string | undefined, entryName: string | undefined, limitBytes: number | undefined }
/** Runs parse() and done() to the end and reports how they ended, so a test asserts a value instead of catching a rejection. */
async function settle(importer: CharXImporter, data: Uint8Array | ReadableStream<Uint8Array>): Promise<Settled> {
    try {
        await importer.parse(data)
        await importer.done()
        return { ok: true }
    } catch (error) {
        if (error instanceof CharXParseError) {
            return { ok: false, origin: error.origin, entryName: error.entryName, limitBytes: error.limitBytes }
        }
        throw error
    }
}

const DROP: EntryRoute = { kind: 'drop', limitBytes: Infinity }
const dropAll: EntryRouter = () => DROP

/**
 * Wraps `fflate.Unzip.prototype.push` and records the length of every top-level call. The depth counter is lowered in
 * `finally`, so a RangeError out of the recursion still unwinds it.
 */
function spyOnPushes(): number[] {
    const pushes: number[] = []
    const original = fflate.Unzip.prototype.push
    let depth = 0
    vi.spyOn(fflate.Unzip.prototype, 'push').mockImplementation(function (this: fflate.Unzip, chunk: Uint8Array, final?: boolean) {
        if (depth === 0) {
            pushes.push(chunk.length)
        }
        depth++
        try {
            return original.call(this, chunk, final)
        } finally {
            depth--
        }
    })
    return pushes
}

beforeEach(() => {
    h.saved = []
    h.pieceMode = false
    h.pieceSaves = []
    Object.assign(charxLimits, defaultLimits)
    charxLimits.feedSliceBytes = defaultFeedSlice
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('many small entries in one chunk', () => {
    test('Z1 reproducer: 16,384 empty entries on the trusted path are all read', async () => {
        const entries: ZipEntry[] = []
        for (let i = 0; i < 16384; i++) entries.push([`a/${i.toString(36)}`, new Uint8Array(0), 0])
        const importer = new CharXImporter(dropAll)
        const result = await settle(importer, fflateZipArchive(entries))
        expect(result).toEqual({ ok: true })
        expect(Object.keys(importer.sizes).length).toBe(16384)
    })

    test('Z2 reproducer: 16,384 one-byte entries on the fallback path are all saved', async () => {
        const entries: ZipEntry[] = []
        for (let i = 0; i < 16384; i++) entries.push([`assets/${i}.png`, Uint8Array.from([i & 255]), 0])
        const importer = new CharXImporter()
        const result = await settle(importer, untrusted(fflateZipArchive(entries)))
        expect(result).toEqual({ ok: true })
        expect(Object.keys(importer.assets).length).toBe(16384)
    })

    test('Z3 reproducer: 40,000 one-byte entries in one stream chunk are all read', async () => {
        const z: fflate.Zippable = {}
        for (let i = 0; i < 40000; i++) z[`_${i.toString(36)}`] = [Uint8Array.from([1]), { level: 0 }]
        const importer = new CharXImporter(dropAll)
        const result = await settle(importer, oneChunk(fflate.zipSync(z)))
        expect(result).toEqual({ ok: true })
        expect(Object.keys(importer.sizes).length).toBe(40000)
    })
})

describe('slice size does not change what is imported', () => {
    const SLICES = [1, 7, 30, 31, 46, 4096, undefined]
    const asset = (() => {
        const a = new Uint8Array(3000)
        for (let i = 0; i < a.length; i++) a[i] = (i % 17) + 65
        return a
    })()
    const card = enc.encode('{"spec":"chara_card_v3","data":{"name":"Synthetic"}}')
    const moduleBytes = bytes(300, 5)

    async function cardA(): Promise<Uint8Array> {
        const parts: Uint8Array[] = []
        const writer = new CharXWriter({ write: async (chunk: Uint8Array) => { parts.push(chunk) }, close: async () => {} } as unknown as ConstructorParameters<typeof CharXWriter>[0])
        await writer.write('card.json', card)
        await writer.write('module.risum', moduleBytes)
        await writer.write('assets/deflated.png', asset, 6)
        await writer.write('assets/blob.bin', ZIP_SIGNATURE_BLOB, 0)
        await writer.write('assets/empty.bin', new Uint8Array(0))
        await writer.write('assets/sub/', new Uint8Array(0))
        await writer.end()
        return new Uint8Array(Buffer.concat(parts))
    }
    function cardB(blobLevel: 0 | 6): Uint8Array {
        return fflateZipArchive([
            ['card.json', card, 0],
            ['module.risum', moduleBytes, 0],
            ['assets/deflated.png', asset, 6],
            ['assets/blob.bin', ZIP_SIGNATURE_BLOB, blobLevel],
            ['assets/empty.bin', new Uint8Array(0), 0],
            ['assets/sub/', new Uint8Array(0), 0],
        ])
    }

    type Delivery = (archive: Uint8Array) => Uint8Array | ReadableStream<Uint8Array>
    const paths: Array<{ name: string, deliver: Delivery, blobLevel: 0 | 6 }> = [
        { name: 'trusted', deliver: (a) => a, blobLevel: 0 },
        { name: 'untrusted', deliver: (a) => untrusted(a), blobLevel: 6 },
        { name: 'stream', deliver: (a) => chunked(a, 5000), blobLevel: 6 },
    ]

    async function outcome(archive: Uint8Array, deliver: Delivery, slice: number | undefined) {
        h.saved = []
        charxLimits.feedSliceBytes = slice ?? defaultFeedSlice
        const importer = new CharXImporter()
        const result = await settle(importer, deliver(archive))
        return {
            result,
            cardData: importer.cardData,
            moduleData: importer.moduleData ? Array.from(importer.moduleData) : undefined,
            saved: h.saved.map((s) => s.id).sort(),
            assets: importer.assets,
            sizes: importer.sizes,
        }
    }

    for (const path of paths) {
        for (const producer of ['CharXWriter', 'fflateZipArchive']) {
            test(`Z4 guard (${path.name}, ${producer}): every slice size imports what the default does`, async () => {
                const archive = producer === 'CharXWriter' ? await cardA() : cardB(path.blobLevel)
                const reference = await outcome(archive, path.deliver, undefined)
                expect(reference.result).toEqual({ ok: true })
                expect(reference.cardData).toBe(new TextDecoder().decode(card))
                expect(reference.saved).toContain(sha1(asset))
                for (const slice of SLICES) {
                    expect(await outcome(archive, path.deliver, slice), `slice ${slice}`).toEqual(reference)
                }
            })
        }
    }

    test('Z5 guard: an archive cut inside card.json is refused with origin zip, on the fallback and stream paths', async () => {
        const cut = fflateZipArchive([['card.json', bytes(2000, 9), 0]]).subarray(0, 1000)
        expect(await settle(new CharXImporter(), cut.slice())).toMatchObject({ ok: false, origin: 'zip' })
        expect(await settle(new CharXImporter(), oneChunk(cut.slice()))).toMatchObject({ ok: false, origin: 'zip' })
    })
})

describe('the reader is fed in bounded slices', () => {
    test('Z6 diagnostic: a 3 MiB import pushes at most 16,384 bytes at a time', async () => {
        const pushes = spyOnPushes()
        const archive = fflateZipArchive([['assets/big.bin', bytes(3 * MIB, 3), 0]])
        const result = await settle(new CharXImporter(), archive)
        expect(result).toEqual({ ok: true })
        expect(pushes.length).toBeGreaterThan(0)
        expect(Math.max(...pushes)).toBeLessThanOrEqual(16384)
    })

    describe('Z7 guard: a size refusal partway through a chunk stops the feed', () => {
        const router: EntryRouter = (name) => name === 'aa-big.json' ? { kind: 'asset', limitBytes: 64 } : DROP
        const archive = (() => {
            const z: fflate.Zippable = { 'aa-big.json': [bytes(1000, 4), { level: 0 }] }
            for (let i = 0; i < 32768; i++) z[`f${i.toString(36)}`] = [Uint8Array.from([2]), { level: 0 }]
            return fflate.zipSync(z)
        })()

        test('as one stream chunk', async () => {
            const pushes = spyOnPushes()
            const result = await settle(new CharXImporter(router), oneChunk(archive.slice()))
            expect(result).toMatchObject({ ok: false, origin: 'size', entryName: 'aa-big.json' })
            expect(pushes.length).toBeLessThanOrEqual(2)
        })

        test('on the fallback path', async () => {
            const pushes = spyOnPushes()
            const result = await settle(new CharXImporter(router), untrusted(archive))
            expect(result).toMatchObject({ ok: false, origin: 'size', entryName: 'aa-big.json' })
            expect(pushes.length).toBeLessThanOrEqual(2)
        })
    })
})

describe('streamed assets keep large write pieces', () => {
    test('Z8 guard: a 6 MiB asset is written in at most 4 pieces and its bytes are unchanged', async () => {
        h.pieceMode = true
        const source = bytes(6 * MIB, 8)
        const archive = fflateZipArchive([['assets/big.bin', source, 0]])
        const result = await settle(new CharXImporter(), archive)
        expect(result).toEqual({ ok: true })
        expect(h.pieceSaves.length).toBe(1)
        expect(h.pieceSaves[0].pieces.reduce((a, b) => a + b, 0)).toBe(6 * MIB)
        expect(h.pieceSaves[0].id).toBe(sha1(source))
        expect(h.pieceSaves[0].pieces.length).toBeLessThanOrEqual(4)
    })
})

describe('PieceQueue', () => {
    function recorded() {
        const queued: number[] = []
        const released: number[] = []
        const queue = new PieceQueue((n) => { queued.push(n) }, (n) => { released.push(n) })
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
        const next = () => queue[Symbol.asyncIterator]().next()
        return { queue, queued, released, sum, next }
    }
    const filled = (n: number, value: number) => new Uint8Array(n).fill(value)

    test('Z9 (a) new rule: queued chunks are joined into one piece and released once', async () => {
        const { queue, released, next } = recorded()
        queue.push(filled(100, 1))
        queue.push(filled(200, 2))
        queue.push(filled(300, 3))
        const first = await next()
        expect(first.done).toBe(false)
        expect(first.value?.length).toBe(600)
        expect(first.value?.[99]).toBe(1)
        expect(first.value?.[100]).toBe(2)
        expect(first.value?.[599]).toBe(3)
        expect(released).toEqual([600])
    })

    test('Z9 (b) guard: one chunk larger than the cap is yielded whole', async () => {
        const { queue, next } = recorded()
        queue.push(filled(5 * MIB, 7))
        const first = await next()
        expect(first.value?.length).toBe(5 * MIB)
    })

    test('Z9 (c) new rule: four 1.5 MiB chunks give two pieces of 3 MiB, in order', async () => {
        const { queue, next } = recorded()
        for (let i = 1; i <= 4; i++) queue.push(filled(1.5 * MIB, i))
        const first = await next()
        const second = await next()
        expect([first.value?.length, second.value?.length]).toEqual([3 * MIB, 3 * MIB])
        expect(first.value?.[0]).toBe(1)
        expect(first.value?.[3 * MIB - 1]).toBe(2)
        expect(second.value?.[0]).toBe(3)
        expect(second.value?.[3 * MIB - 1]).toBe(4)
    })

    test('Z9 (c2) new rule: a join that reaches the cap exactly is taken', async () => {
        const { queue, next } = recorded()
        queue.push(filled(2 * MIB, 1))
        queue.push(filled(2 * MIB, 2))
        queue.push(filled(1, 3))
        const first = await next()
        const second = await next()
        expect([first.value?.length, second.value?.length]).toEqual([4 * MIB, 1])
    })

    test('Z9 (d) guard: after fail the next read throws', async () => {
        const { queue, next } = recorded()
        queue.push(filled(10, 1))
        const error = new Error('cut short')
        queue.fail(error)
        await expect(next()).rejects.toBe(error)
    })

    test('Z9 (e) guard: dispose after a join releases exactly what was queued', async () => {
        const { queue, queued, released, sum, next } = recorded()
        queue.push(filled(100, 1))
        queue.push(filled(200, 2))
        queue.push(filled(300, 3))
        await next()
        queue.push(filled(50, 4))
        queue.push(filled(70, 5))
        queue.dispose()
        expect(sum(queued)).toBe(720)
        expect(sum(released)).toBe(720)
        queue.push(filled(10, 6))
        queue.dispose()
        const after = await next()
        expect(after.done).toBe(true)
        expect(sum(queued)).toBe(720)
        expect(sum(released)).toBe(720)
    })

    test('Z9 (f) guard: fail after a partial join releases exactly what was queued', async () => {
        const { queue, queued, released, sum, next } = recorded()
        for (let i = 1; i <= 3; i++) queue.push(filled(1.5 * MIB, i))
        await next()
        const error = new Error('entry failed')
        queue.fail(error)
        expect(sum(queued)).toBe(4.5 * MIB)
        expect(sum(released)).toBe(4.5 * MIB)
        await expect(next()).rejects.toBe(error)
        queue.push(filled(10, 9))
        expect(sum(queued)).toBe(4.5 * MIB)
        expect(sum(released)).toBe(4.5 * MIB)
    })
})
