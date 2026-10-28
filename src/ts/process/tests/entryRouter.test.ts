/**
 * The entry router of `CharXImporter` in `src/ts/process/processzip.ts`: a route names what the importer does with an
 * entry (`card`, `module`, `asset`, `text` or `drop`) and the size limit that applies to it, and the importer records
 * the retained bytes of `text` entries (`texts`) and the size of every entry (`sizes`).
 *
 * The real `processzip.ts` and the real fflate run against synthetic archives built here. The fflate parser is wrapped
 * only to count the entries that were started: an entry that is not started keeps its compressed bytes in the parser.
 *
 * Labels: a "reproducer" fails on the base commit, where the importer ignores a router argument; the "guard" (G-ROUTE)
 * pins the routing of an importer built without a router and passes before and after.
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

const h = vi.hoisted(() => ({
    saved: [] as Array<{ id: string, length: number }>,
    saveCalls: 0,
    /** names of the entries whose start() was called */
    starts: [] as string[],
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
    pieceStoreOrNull: vi.fn(async () => null),
    saveAssetFromPieces: vi.fn(async () => { throw new Error('not used') }),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.saveCalls++
        const id = createHash('sha1').update(data).digest('hex')
        h.saved.push({ id, length: data.length })
        return id
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>()
    class Unzip extends actual.Unzip {
        #wrapped = false
        push(chunk: Uint8Array, final?: boolean) {
            if (!this.#wrapped && this.onfile) {
                this.#wrapped = true
                const original = this.onfile
                this.onfile = (file) => {
                    const start = file.start.bind(file)
                    file.start = () => { h.starts.push(file.name); start() }
                    original(file)
                }
            }
            super.push(chunk, final)
        }
    }
    return { ...actual, Unzip }
})

import { CharXImporter, CharXParseError, charxLimits, type EntryRoute, type EntryRouter } from 'src/ts/process/processzip'

const MIB = 1024 * 1024
const enc = new TextEncoder()
const defaultLimits = { ...charxLimits }

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

function stored(files: Record<string, Uint8Array>): Uint8Array {
    const z: fflate.Zippable = {}
    for (const [name, data] of Object.entries(files)) z[name] = [data, { level: 0 }]
    return fflate.zipSync(z)
}

function directory(z: Uint8Array) {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    let eocd = -1
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    const count = dv.getUint16(eocd + 10, true)
    let at = dv.getUint32(eocd + 16, true)
    const entries: Array<{ name: string, header: number }> = []
    for (let i = 0; i < count; i++) {
        const nameLen = dv.getUint16(at + 28, true)
        entries.push({ name: new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen)), header: dv.getUint32(at + 42, true) })
        at += 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true)
    }
    return { eocd, entries }
}

/** The end record states a directory one byte too large, so the directory is not trusted and every entry is still streamed. */
function untrusted(z: Uint8Array): Uint8Array {
    const c = z.slice()
    const { eocd } = directory(c)
    const dv = new DataView(c.buffer, c.byteOffset, c.byteLength)
    dv.setUint32(eocd + 12, dv.getUint32(eocd + 12, true) + 1, true)
    return c
}

/** The local header of `name` declares `size` as its uncompressed size. */
function declareSize(z: Uint8Array, name: string, size: number): Uint8Array {
    const c = z.slice()
    new DataView(c.buffer, c.byteOffset, c.byteLength).setUint32(directory(z).entries.find((e) => e.name === name)!.header + 22, size, true)
    return c
}

/** Every occurrence of the name `from` (local header and central record) becomes `to`, which has the same length. */
function renameKey(z: Uint8Array, from: string, to: string): Uint8Array {
    const c = z.slice()
    const a = enc.encode(from)
    for (let i = 0; i + a.length <= c.length; i++) {
        if (a.every((byte, j) => c[i + j] === byte)) c.set(enc.encode(to), i)
    }
    return c
}

type Settled = { ok: true } | { ok: false, origin: string | undefined, entryName: string | undefined, limitBytes: number | undefined }
/** Runs parse() and done() to the end and reports how they ended, so a test asserts a value instead of catching a rejection. */
async function settle(importer: CharXImporter, data: Uint8Array): Promise<Settled> {
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
const routerOf = (table: Record<string, EntryRoute>): EntryRouter => (name) => table[name] ?? DROP

beforeEach(() => {
    h.saved = []
    h.saveCalls = 0
    h.starts = []
    Object.assign(charxLimits, defaultLimits)
})

describe('custom routers', () => {
    const TEXT = enc.encode('{"text":true}')
    const OTHER = enc.encode('{"other":true}')
    const IMAGE = bytes(1000, 1)
    const BIG = bytes(3 * MIB, 2)
    const files = () => ({ 'big.bin': BIG, 'dir/': new Uint8Array(0), 'a.json': TEXT, 'b.png': IMAGE, 'c.json': OTHER })
    const table: Record<string, EntryRoute> = {
        'a.json': { kind: 'text', limitBytes: 1000 },
        'b.png': { kind: 'asset', limitBytes: 10 * MIB },
    }

    test('P1 (i) reproducer: texts holds exactly the bytes of the text-routed entries', async () => {
        const importer = new CharXImporter(routerOf(table))
        await settle(importer, stored(files()))
        expect(importer.texts).toEqual({ 'a.json': TEXT })
    })

    test('P1 (ii) reproducer: sizes holds the decoded size of every entry, dropped and empty ones included', async () => {
        const importer = new CharXImporter(routerOf(table))
        await settle(importer, stored(files()))
        expect(importer.sizes).toEqual({ 'big.bin': BIG.length, 'dir/': 0, 'a.json': TEXT.length, 'b.png': IMAGE.length, 'c.json': OTHER.length })
    })

    test('P1 (iii) reproducer: only asset-routed entries are saved', async () => {
        const importer = new CharXImporter(routerOf(table))
        await settle(importer, stored(files()))
        expect(Object.keys(importer.assets)).toEqual(['b.png'])
        expect(h.saved.map((s) => s.id)).toEqual([sha1(IMAGE)])
    })

    test('P1 (iv) reproducer: every entry is started, a dropped 3 MiB one before a text entry included', async () => {
        const importer = new CharXImporter(routerOf(table))
        await settle(importer, stored(files()))
        expect(h.starts.sort()).toEqual(Object.keys(files()).sort())
        expect(importer.texts).toEqual({ 'a.json': TEXT })
    })

    test('P1 (v) reproducer: a router with only text and drop routes saves nothing', async () => {
        const importer = new CharXImporter(routerOf({ 'a.json': { kind: 'text', limitBytes: 1000 } }))
        const result = await settle(importer, stored(files()))
        expect(result).toEqual({ ok: true })
        expect(importer.texts).toEqual({ 'a.json': TEXT })
        expect(h.saveCalls).toBe(0)
        expect(importer.assets).toEqual({})
    })

    test('P1 (vi) reproducer: a text route refuses above its limit', async () => {
        const importer = new CharXImporter(routerOf({ 'a.json': { kind: 'text', limitBytes: 5 } }))
        const result = await settle(importer, stored(files()))
        expect(result).toMatchObject({ ok: false, origin: 'size', entryName: 'a.json', limitBytes: 5 })
    })

    test.each(['trusted directory', 'untrusted directory'] as const)('P1 (vi) reproducer: a drop route with an infinite limit accepts an entry over the lowered asset limit (%s)', async (variant) => {
        charxLimits.assetBytes = 2 * MIB
        const z = stored(files())
        const importer = new CharXImporter(routerOf({}))
        const result = await settle(importer, variant === 'trusted directory' ? z : untrusted(z))
        expect(result).toEqual({ ok: true })
        expect(importer.sizes['big.bin']).toBe(BIG.length)
    })

    test('P1 (vi) reproducer: a drop route with a finite limit refuses above it', async () => {
        const importer = new CharXImporter(routerOf({ 'big.bin': { kind: 'drop', limitBytes: 1 * MIB } }))
        const result = await settle(importer, stored(files()))
        expect(result).toMatchObject({ ok: false, origin: 'size', entryName: 'big.bin', limitBytes: 1 * MIB })
    })

    // Default limits throughout: with a lowered asset limit the base's own routing would refuse the patched header
    // and the test would end in a rejection instead of a failed assertion.
    describe('P1 (vii) reproducer: sizes is the maximum of the declared and the decoded size over every copy of a name', () => {
        const SMALL = bytes(1000, 3)
        const FILLER = bytes(Math.round(1.5 * MIB), 4)

        test('the local header declares more than the entry holds', async () => {
            const z = declareSize(stored({ 'a.png': bytes(1000, 5), 'filler.bin': FILLER, 'b.png': SMALL }), 'b.png', 3 * MIB)
            for (const data of [z, untrusted(z)]) {
                const importer = new CharXImporter(routerOf({}))
                const result = await settle(importer, data)
                expect(result).toEqual({ ok: true })
                expect(importer.sizes).toEqual({ 'a.png': 1000, 'filler.bin': FILLER.length, 'b.png': 3 * MIB })
            }
        })

        test('the oversize copy of a duplicated name comes first', async () => {
            const z = renameKey(stored({ 'a.png': bytes(1000, 5), 'filler.bin': FILLER, 'b.png': bytes(3 * MIB, 6), 'B.png': SMALL }), 'B.png', 'b.png')
            for (const data of [z, untrusted(z)]) {
                const importer = new CharXImporter(routerOf({}))
                const result = await settle(importer, data)
                expect(result).toEqual({ ok: true })
                expect(importer.sizes).toEqual({ 'a.png': 1000, 'filler.bin': FILLER.length, 'b.png': 3 * MIB })
            }
        })
    })
})

describe('the default router', () => {
    const CARD = '{"card":1}'
    const MODULE = enc.encode('module bytes')
    const files = () => ({
        'card.json': enc.encode(CARD),
        'module.risum': MODULE,
        'assets/a.png': bytes(500, 1),
        'x_meta/info.json': enc.encode('{"ignored":1}'),
        'sub/card.json': enc.encode('{"ignored":2}'),
        'Card.json': enc.encode('{"ignored":3}'),
        'x.JSON': bytes(300, 2),
        'a/module.risum': bytes(200, 3),
        'dir/': new Uint8Array(0),
    })

    test('G-ROUTE guard (passes before and after): an importer built without a router routes entries as it always did', async () => {
        const importer = new CharXImporter()
        const result = await settle(importer, stored(files()))
        expect(result).toEqual({ ok: true })
        expect(importer.cardData).toBe(CARD)
        expect(importer.moduleData).toEqual(MODULE)
        expect(Object.keys(importer.assets).sort()).toEqual(['a/module.risum', 'assets/a.png', 'dir/', 'x.JSON'])
    })

    test('G-ROUTE guard (passes before and after): an ignored JSON entry keeps the asset limit', async () => {
        charxLimits.assetBytes = 2 * MIB
        const importer = new CharXImporter()
        const result = await settle(importer, stored({ 'card.json': enc.encode(CARD), 'x_meta/info.json': bytes(3 * MIB, 4) }))
        expect(result).toEqual({ ok: false, origin: 'size', entryName: 'x_meta/info.json', limitBytes: 2 * MIB })
    })
})
