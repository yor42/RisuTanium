// @vitest-environment node
/**
 * CharX import through the central directory (CHORE-394, `planDirectoryRead`, `DirectorySplice` and `#spliceStream` of
 * `src/ts/process/processzip.ts`). An archive in upstream's framing (flag bit 3 on every entry, a 16-byte data
 * descriptor after each) is read by its directory, so an asset whose bytes hold a zip signature is not cut short.
 *
 * Labels, per test title:
 * - (R) REGRESSION REPRODUCER: fails by assertion on the commit before the change (the asset is cut short, or the
 *   import is refused, or a bogus entry starts in a JPEG prefix).
 * - (G) COMPATIBILITY GUARD: holds before and after the change. A "(G) damaged ..." test pins that the file is read
 *   as it always was when the directory disagrees with it (MC-802); its clean twin is the (R) test next to it.
 * - (N) NEW BEHAVIOUR: has no counterpart before the change (an entry the directory does not list is skipped,
 *   MC-803; a header that changed after validation; a validation read that throws; the number of validation reads; how
 *   far the splice reads ahead of the importer; a clean archive whose stream ends at an entry boundary or in the
 *   directory, which the scanning reader imported as if it were complete).
 *   A stream that ends inside an entry is refused as a ZIP failure before and after, so that test is (G).
 *
 * The importer runs for real on `Uint8Array`, `File`, a `File` whose stream gives pieces of a chosen size
 * ('chunked-file') and an `ImportSource`, at piece sizes 1, 7, 29, 4096 and 1 MiB; the asset writes, the alerts and the
 * store selection are replaced. The fixtures are written like the real producer: fflate's streaming `Zip` with
 * `ZipPassThrough` (STORE) and `ZipDeflate` entries, which sets bit 3 and writes a descriptor for every entry. A pass
 * here says nothing about a native file source or a real store.
 */
import * as fflate from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    saved: new Map<string, Uint8Array>(),
    pieces: false,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

// The real `util` reads the Tauri window at import time when `isTauri` is on.
vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max }
        async acquire() {
            if (this.available > 0) {
                this.available -= 1
                return
            }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        release() {
            const next = this.waiting.shift()
            if (next) {
                next()
                return
            }
            this.available += 1
        }
    }
    return {
        Semaphore,
        asBuffer: (a: unknown) => a,
        sleep: vi.fn(async () => { }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    pieceStoreOrNull: vi.fn(async () => (h.pieces ? {} : null)),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        const id = 'saved-' + h.saved.size
        h.saved.set(id, data.slice())
        return id
    }),
    saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
        const parts: Uint8Array[] = []
        for await (const piece of pieces) {
            parts.push(piece.slice())
        }
        const id = 'saved-' + h.saved.size
        h.saved.set(id, new Uint8Array(Buffer.concat(parts)))
        return id
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

import { saveAssetFromPieces } from 'src/ts/globalApi.svelte'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { CharXImporter, CharXParseError, CharXWriter, charxLimits, type CharxStreamOpened } from 'src/ts/process/processzip'
import { ZIP_SIGNATURE_BLOB } from './zipFixtures'

const MIB = 1024 * 1024
const CHUNKS = [1, 7, 29, 4096, MIB]

const originalLimits = { ...charxLimits }

beforeEach(() => {
    h.saved.clear()
    h.pieces = false
    vi.mocked(saveAssetFromPieces).mockClear()
})

afterEach(() => {
    Object.assign(charxLimits, originalLimits)
    vi.restoreAllMocks()
})

//#region fixtures

/** Pseudo-random bytes from a seed: the same bytes on every run, and nothing a deflater shrinks. */
function random(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = (seed * 2654435761) >>> 0 || 1
    for (let i = 0; i < length; i++) {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        out[i] = state >>> 24
    }
    return out
}

function joined(...parts: Uint8Array[]): Uint8Array {
    return new Uint8Array(Buffer.concat(parts))
}

const SIGNATURES = {
    descriptor: Uint8Array.from([0x50, 0x4b, 0x07, 0x08]),
    local: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    central: Uint8Array.from([0x50, 0x4b, 0x01, 0x02]),
}

/** A binary asset with `signature` in the middle of random bytes. */
function assetHolding(signature: Uint8Array, seed = 1, around = 1500): Uint8Array {
    return joined(random(around, seed), signature, random(around, seed + 100))
}

const BLOB_ASSET = assetHolding(ZIP_SIGNATURE_BLOB)
const SMALL_ASSET = random(500, 3)
const CARD = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'x' } }))

/** The bytes of a JPEG that precede an archive; they hold a local header signature, which a scanning reader starts an entry at. */
const JPEG_PREFIX = joined(
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
    Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]),
    new Uint8Array(40).fill(0x11),
    Uint8Array.from([0xff, 0xd9]),
)

type Kind = 'store' | 'deflate-0' | 'deflate-6'
type Entry = [name: string, data: Uint8Array, kind: Kind]

/** An archive as upstream writes it: a streaming `Zip`, so every entry has bit 3 and a data descriptor. `prefix` goes in front. */
function upstreamArchive(entries: Entry[], prefix?: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = []
    let failure: Error | undefined
    const zip = new fflate.Zip((error, data) => {
        if (error) {
            failure ??= error
            return
        }
        chunks.push(data.slice())
    })
    for (const [name, data, kind] of entries) {
        const file = kind === 'store' ? new fflate.ZipPassThrough(name) : new fflate.ZipDeflate(name, { level: kind === 'deflate-0' ? 0 : 6 })
        zip.add(file)
        file.push(data, true)
    }
    zip.end()
    if (failure) {
        throw failure
    }
    return joined(...(prefix ? [prefix, ...chunks] : chunks))
}

const SIG_NAME = 'assets/other/sig.bin'
const SMALL_NAME = 'assets/other/small.bin'

function standardArchive(kind: Kind, asset: Uint8Array = BLOB_ASSET, prefix?: Uint8Array): Uint8Array {
    return upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, asset, kind], [SMALL_NAME, SMALL_ASSET, 'deflate-6']], prefix)
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
    return Buffer.from(haystack).includes(Buffer.from(needle))
}

/** Where the entries of an archive are, found by its own directory (the end record is the last one in the input). */
function layoutOf(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let endRecord = -1
    for (let i = bytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            endRecord = i
            break
        }
    }
    if (endRecord < 0) {
        throw new Error('no end record')
    }
    const count = view.getUint16(endRecord + 10, true)
    const directoryStart = endRecord - view.getUint32(endRecord + 12, true)
    const zipStart = directoryStart - view.getUint32(endRecord + 16, true)
    const entries: Array<{ name: string, central: number, local: number, localOffset: number, nameLength: number, extraLength: number, compressedSize: number, bodyStart: number, bodyEnd: number }> = []
    let at = directoryStart
    for (let i = 0; i < count; i++) {
        const nameLength = view.getUint16(at + 28, true)
        const localOffset = view.getUint32(at + 42, true)
        const local = zipStart + localOffset
        const extraLength = view.getUint16(local + 28, true)
        const compressedSize = view.getUint32(at + 20, true)
        const bodyStart = local + 30 + view.getUint16(local + 26, true) + extraLength
        entries.push({
            name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
            central: at,
            local,
            localOffset,
            nameLength,
            extraLength,
            compressedSize,
            bodyStart,
            bodyEnd: bodyStart + compressedSize,
        })
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    }
    return { endRecord, directoryStart, zipStart, entries }
}

type Layout = ReturnType<typeof layoutOf>

/** A copy of the archive after `change` has patched it. */
function patched(bytes: Uint8Array, change: (view: DataView, layout: Layout) => void): Uint8Array {
    const copy = new Uint8Array(bytes)
    change(new DataView(copy.buffer), layoutOf(copy))
    return copy
}

/**
 * The archive with a complete local entry the directory does not list, written as `zipSync` writes an entry (no
 * descriptor). 'before' puts it in front of the archive, 'between' between the first two listed entries and 'after'
 * after the last one; the directory's offsets are made to agree with the move.
 */
function withOrphan(bytes: Uint8Array, where: 'before' | 'between' | 'after'): Uint8Array {
    const layout = layoutOf(bytes)
    const donor = fflate.zipSync({ 'assets/orphan.bin': [random(300, 5), { level: 0 }] })
    const orphan = donor.slice(0, layoutOf(donor).directoryStart)
    const at = where === 'before' ? 0 : where === 'after' ? layout.directoryStart : layout.entries[1].local
    const out = joined(bytes.subarray(0, at), orphan, bytes.subarray(at))
    const view = new DataView(out.buffer)
    const endRecord = layout.endRecord + orphan.length
    if (where !== 'before') {
        view.setUint32(endRecord + 16, view.getUint32(endRecord + 16, true) + orphan.length, true)
    }
    if (where === 'between') {
        let central = layout.directoryStart + orphan.length
        for (let i = 0; i < layout.entries.length; i++) {
            const offset = view.getUint32(central + 42, true)
            if (layout.zipStart + offset >= at) {
                view.setUint32(central + 42, offset + orphan.length, true)
            }
            central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
        }
    }
    return out
}

/**
 * An archive whose second entry holds a complete entry (a header, a body and a descriptor, signatures included) as its
 * data. With `listed`, the directory also lists the inner entry, at the offset where it lies inside the outer body:
 * every check but the overlap passes for it. The outer entry is framed as upstream writes it: an outer entry without a
 * descriptor is read the same with or without the plan, so no outcome would tell the two apart.
 */
function nestedArchive(listed: boolean): { bytes: Uint8Array, outerData: Uint8Array } {
    const donor = upstreamArchive([['assets/other/inner.bin', random(200, 9), 'store']])
    const donorLayout = layoutOf(donor)
    const outerData = donor.slice(0, donorLayout.directoryStart)
    const innerRecord = donor.slice(donorLayout.directoryStart, donorLayout.endRecord)
    const outer = upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, outerData, 'store'], [SMALL_NAME, SMALL_ASSET, 'deflate-6']])
    if (!listed) {
        return { bytes: outer, outerData }
    }
    const layout = layoutOf(outer)
    const bytes = joined(outer.subarray(0, layout.endRecord), innerRecord, outer.subarray(layout.endRecord))
    const view = new DataView(bytes.buffer)
    view.setUint32(layout.endRecord + 42, layout.entries[1].bodyStart - layout.zipStart, true)
    const endRecord = layout.endRecord + innerRecord.length
    view.setUint16(endRecord + 8, layout.entries.length + 1, true)
    view.setUint16(endRecord + 10, layout.entries.length + 1, true)
    view.setUint32(endRecord + 12, view.getUint32(endRecord + 12, true) + innerRecord.length, true)
    return { bytes, outerData }
}

/**
 * The archive with the signature of every data descriptor removed, so each descriptor is the 12 bytes (CRC, sizes) that
 * the format also allows. Offsets in the directory are made to agree with the shorter entries.
 */
function withShortDescriptors(bytes: Uint8Array): Uint8Array {
    const layout = layoutOf(bytes)
    const parts: Uint8Array[] = []
    let at = 0
    for (const entry of layout.entries) {
        expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(entry.bodyEnd, true)).toBe(0x08074b50)
        parts.push(bytes.subarray(at, entry.bodyEnd))
        at = entry.bodyEnd + 4
    }
    parts.push(bytes.subarray(at))
    const out = joined(...parts)
    const view = new DataView(out.buffer)
    const removed = 4 * layout.entries.length
    const directoryStart = layout.directoryStart - removed
    let central = directoryStart
    for (let i = 0; i < layout.entries.length; i++) {
        view.setUint32(central + 42, view.getUint32(central + 42, true) - 4 * i, true)
        central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
    }
    view.setUint32(layout.endRecord - removed + 16, directoryStart - layout.zipStart, true)
    return out
}

/** The archive with `length` zero bytes of extra field added to the local header of entry `index` (the directory's extra stays empty). */
function withLocalExtra(bytes: Uint8Array, index: number, length: number): Uint8Array {
    const layout = layoutOf(bytes)
    const entry = layout.entries[index]
    const at = entry.local + 30 + entry.nameLength
    const out = joined(bytes.subarray(0, at), new Uint8Array(length), bytes.subarray(at))
    const view = new DataView(out.buffer)
    view.setUint16(entry.local + 28, entry.extraLength + length, true)
    let central = layout.directoryStart + length
    for (let i = 0; i < layout.entries.length; i++) {
        if (i > index) {
            view.setUint32(central + 42, view.getUint32(central + 42, true) + length, true)
        }
        central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
    }
    view.setUint32(layout.endRecord + length + 16, layout.directoryStart + length - layout.zipStart, true)
    return out
}

/** A forward stream over `bytes` in pieces of `size`. A piece is a view of `bytes`, as a source's own array would be. */
function chunkedStream(bytes: Uint8Array, size: number, failAfterPieces?: number, failure?: Error): ReadableStream<Uint8Array> {
    let at = 0
    let pieces = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (failAfterPieces !== undefined && pieces >= failAfterPieces) {
                controller.error(failure)
                return
            }
            if (at >= bytes.length) {
                controller.close()
                return
            }
            controller.enqueue(bytes.subarray(at, at + size))
            at += size
            pieces++
        },
    })
}

type InputKind = 'bytes' | 'file' | 'chunked-file' | 'import-source'

/** `over` replaces members of the `ImportSource`; `size` and `read` stay those of `bytes` unless it says otherwise. */
function sourceOf(bytes: Uint8Array, chunk: number, over: Partial<ImportSource> = {}): ImportSource {
    return { ...importSourceOfBytes('card.charx', bytes), stream: () => chunkedStream(bytes, chunk), ...over }
}

function makeInput(kind: InputKind, bytes: Uint8Array, chunk: number): Uint8Array | File | ImportSource {
    switch (kind) {
        case 'bytes':
            return bytes
        case 'file':
            return new File([new Uint8Array(bytes)], 'card.charx')
        case 'chunked-file': {
            const file = new File([new Uint8Array(bytes)], 'card.charx')
            file.stream = () => chunkedStream(bytes, chunk) as ReturnType<File['stream']>
            return file
        }
        case 'import-source':
            return sourceOf(bytes, chunk)
    }
}

/** Every input kind; the two that give pieces of a chosen size are swept over `CHUNKS`. */
const INPUTS: Array<[label: string, kind: InputKind, chunk: number]> = [
    ['bytes', 'bytes', 0],
    ['file', 'file', 0],
    ...CHUNKS.map((chunk): [string, InputKind, number] => [`chunked-file ${chunk}`, 'chunked-file', chunk]),
    ...CHUNKS.map((chunk): [string, InputKind, number] => [`import-source ${chunk}`, 'import-source', chunk]),
]

type Outcome = { importer: CharXImporter, failure?: unknown }

async function runImport(input: Uint8Array | File | ImportSource | ReadableStream<Uint8Array>): Promise<Outcome> {
    const importer = new CharXImporter()
    try {
        await importer.parse(input)
        await importer.done()
        return { importer }
    } catch (error) {
        return { importer, failure: error }
    }
}

function originOf(outcome: Outcome): string | undefined {
    return outcome.failure instanceof CharXParseError ? outcome.failure.origin : outcome.failure === undefined ? undefined : String(outcome.failure)
}

function savedEntry(outcome: Outcome, name: string): Uint8Array | undefined {
    const id = outcome.importer.assets[name]
    return id === undefined ? undefined : h.saved.get(id)
}

function same(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a !== undefined && Buffer.from(a).equals(Buffer.from(b))
}

/** The import succeeded and `name` came out byte for byte. */
function importedWhole(outcome: Outcome, name: string, expected: Uint8Array): boolean {
    return outcome.failure === undefined && same(savedEntry(outcome, name), expected)
}

//#endregion

describe('fixtures', () => {
    test.each(['store', 'deflate-0', 'deflate-6'] as Kind[])('(G) %s: upstream framing sets bit 3 and a descriptor follows every entry', (kind) => {
        const bytes = standardArchive(kind)
        const layout = layoutOf(bytes)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        for (const entry of layout.entries) {
            expect(view.getUint16(entry.local + 6, true) & 8).toBe(8)
            expect(view.getUint32(entry.local + 18, true)).toBe(0)
            expect(view.getUint32(entry.bodyEnd, true)).toBe(0x08074b50)
        }
    })

    // A deflate level above 0 writes Huffman blocks, so the asset's signatures are not raw in the archive and the
    // scanning reader is not cut short by them; only the stored kinds can hold a signature the scan finds.
    test.each([['store', true], ['deflate-0', true], ['deflate-6', false]] as Array<[Kind, boolean]>)('(G) %s: the asset\'s signatures are raw in the archive: %s', (kind, raw) => {
        const bytes = standardArchive(kind)
        const entry = layoutOf(bytes).entries[1]
        for (const signature of Object.values(SIGNATURES)) {
            expect(contains(bytes.subarray(entry.bodyStart, entry.bodyEnd), signature)).toBe(raw)
        }
    })
})

describe('an upstream-framed asset that holds zip signatures', () => {
    for (const kind of ['store', 'deflate-0', 'deflate-6'] as Kind[]) {
        describe(kind, () => {
            // deflate-6 holds no raw signature, so it passes before the change too
            const label = kind === 'deflate-6' ? '(G)' : '(R)'
            test.each(INPUTS)(`${label} %s: imports whole and leaves the input as it was`, async (_label, inputKind, chunk) => {
                const bytes = standardArchive(kind)
                const before = new Uint8Array(bytes)
                const outcome = await runImport(makeInput(inputKind, bytes, chunk))

                expect(originOf(outcome) ?? 'imported').toBe('imported')
                expect(same(savedEntry(outcome, SIG_NAME), BLOB_ASSET)).toBe(true)
                expect(same(savedEntry(outcome, SMALL_NAME), SMALL_ASSET)).toBe(true)
                expect(new TextDecoder().decode(new TextEncoder().encode(outcome.importer.cardData ?? ''))).toBe(new TextDecoder().decode(CARD))
                expect(same(bytes, before)).toBe(true)
            })
        })
    }

    test.each(Object.entries(SIGNATURES))('(R) a %s signature alone, STORE, chunked-file at every piece size', async (_label, signature) => {
        const asset = assetHolding(signature, 11)
        const bytes = standardArchive('store', asset)
        for (const chunk of CHUNKS) {
            h.saved.clear()
            const outcome = await runImport(makeInput('chunked-file', bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, asset), `piece size ${chunk}`).toBe(true)
        }
    })

    test.each(INPUTS)('(R) a JPEG prefix that holds a local header signature starts no entry: %s', async (_label, inputKind, chunk) => {
        const bytes = standardArchive('store', BLOB_ASSET, JPEG_PREFIX)
        const outcome = await runImport(makeInput(inputKind, bytes, chunk))

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets).sort()).toEqual([SIG_NAME, SMALL_NAME])
        expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET)).toBe(true)
    })

    test('(G) a signature-free upstream archive imports on every input, byte for byte', async () => {
        const asset = random(3000, 21)
        const bytes = standardArchive('deflate-6', asset)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, asset), label).toBe(true)
        }
    })
})

describe('an archive framed as the ZIP format also allows', () => {
    describe('data descriptors without the signature (12 bytes)', () => {
        const clean = withShortDescriptors(standardArchive('store'))

        test('(G) the fixture: every descriptor is the 12 bytes the directory states', () => {
            const layout = layoutOf(clean)
            const view = new DataView(clean.buffer, clean.byteOffset, clean.byteLength)
            expect(layout.entries).toHaveLength(3)
            for (const [i, entry] of layout.entries.entries()) {
                const central = entry.central
                expect(view.getUint32(entry.bodyEnd, true)).toBe(view.getUint32(central + 16, true))
                expect(view.getUint32(entry.bodyEnd + 4, true)).toBe(view.getUint32(central + 20, true))
                expect(view.getUint32(entry.bodyEnd + 8, true)).toBe(view.getUint32(central + 24, true))
                // the next header (or the directory) follows at once
                const next = i + 1 < layout.entries.length ? layout.entries[i + 1].local : layout.directoryStart
                expect(next).toBe(entry.bodyEnd + 12)
            }
            expect(contains(clean.subarray(layout.entries[1].bodyStart, layout.entries[1].bodyEnd), SIGNATURES.descriptor)).toBe(true)
        })

        test.each(INPUTS)('(R) %s: a signature asset imports whole', async (_label, inputKind, chunk) => {
            const outcome = await runImport(makeInput(inputKind, clean, chunk))

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET)).toBe(true)
            expect(importedWhole(outcome, SMALL_NAME, SMALL_ASSET)).toBe(true)
        })

        test('(G) damaged: a descriptor CRC that differs from the central CRC (12 bytes) is read as it always was', async () => {
            const damaged = patched(clean, (view, layout) => {
                view.setUint8(layout.entries[1].bodyEnd, view.getUint8(layout.entries[1].bodyEnd) ^ 1)
            })
            // the clean archive is the (R) test above
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, damaged, chunk))
                expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(false)
            }
        })
    })

    describe('a local extra field longer than the first header read covers', () => {
        // The first read takes the header with the directory's extra length and 64 bytes more; 200 bytes of local extra
        // over an empty directory extra is past it, so the header takes a second read.
        const EXTRA = 200
        const base = standardArchive('store')

        test.each([0, 1, 2])('(R) entry %i carries the long extra: a signature asset imports whole', async (index) => {
            const bytes = withLocalExtra(base, index, EXTRA)
            expect(layoutOf(bytes).entries[index].extraLength).toBe(EXTRA)
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, bytes, chunk))
                expect(originOf(outcome) ?? 'imported', label).toBe('imported')
                expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(true)
                expect(importedWhole(outcome, SMALL_NAME, SMALL_ASSET), label).toBe(true)
            }
        })
    })
})

describe('an asset past the piece threshold on a store that writes in pieces', () => {
    const BIG_ASSET = joined(random(2 * MIB, 31), ZIP_SIGNATURE_BLOB, random(2 * MIB, 32), SIGNATURES.descriptor, random(MIB + 100, 33), SIGNATURES.central)

    test.each([['file', 'file', 0], ['import-source 1 MiB', 'import-source', MIB], ['import-source 4096', 'import-source', 4096]] as Array<[string, InputKind, number]>)(
        '(R) %s: imports whole through the piece path with the backlog engaged',
        async (_label, inputKind, chunk) => {
            h.pieces = true
            charxLimits.backlogBytes = 256 * 1024
            expect(BIG_ASSET.length).toBeGreaterThan(charxLimits.streamAfterBytes)
            const bytes = upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, BIG_ASSET, 'store']])
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(same(savedEntry(outcome, SIG_NAME), BIG_ASSET)).toBe(true)
            // the asset went through the piece queue
            expect(saveAssetFromPieces).toHaveBeenCalledTimes(1)
        },
        120_000,
    )
})

describe('a directory that disagrees with the file (MC-802): the file is read as it always was', () => {
    // Each damage is applied to a copy of the same archive; with the damage the signature asset is not imported whole.
    // The clean archive is the (R) test above.
    const damages: Array<[string, (bytes: Uint8Array) => Uint8Array]> = [
        ['a central compressed size off by one', bytes => patched(bytes, (view, layout) => {
            const at = layout.entries[1].central + 20
            view.setUint32(at, view.getUint32(at, true) + 1, true)
        })],
        ['a central name that differs from the local name', bytes => patched(bytes, (view, layout) => {
            const at = layout.entries[1].central + 46 + layout.entries[1].nameLength - 1
            view.setUint8(at, view.getUint8(at) ^ 1)
        })],
        ['a central method that differs from the local method', bytes => patched(bytes, (view, layout) => {
            view.setUint16(layout.entries[1].central + 10, 8, true)
        })],
        ['a central bit 3 that differs from the local bit 3', bytes => patched(bytes, (view, layout) => {
            const at = layout.entries[1].central + 8
            view.setUint16(at, view.getUint16(at, true) & ~8, true)
        })],
        ['a descriptor CRC that differs from the central CRC', bytes => patched(bytes, (view, layout) => {
            view.setUint8(layout.entries[1].bodyEnd + 4, view.getUint8(layout.entries[1].bodyEnd + 4) ^ 1)
        })],
        ['a descriptor compressed size that differs from the central one', bytes => patched(bytes, (view, layout) => {
            view.setUint8(layout.entries[1].bodyEnd + 8, view.getUint8(layout.entries[1].bodyEnd + 8) ^ 1)
        })],
        ['a central offset into the middle of another entry', bytes => patched(bytes, (view, layout) => {
            view.setUint32(layout.entries[2].central + 42, layout.entries[1].localOffset + 10, true)
        })],
        ['a directory entry listed twice, so two entries start at one offset', bytes => patched(bytes, (view, layout) => {
            // the second record becomes a copy of the first: the same name, offset and sizes (both names have one length)
            const [first, second] = [layout.entries[1], layout.entries[2]]
            const length = 46 + first.nameLength
            expect(second.nameLength).toBe(first.nameLength)
            new Uint8Array(view.buffer).copyWithin(second.central, first.central, first.central + length)
        })],
    ]

    test.each(damages)('(G) damaged: %s', async (_label, damage) => {
        const bytes = damage(upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, BLOB_ASSET, 'store'], ['assets/other/siq.bin', SMALL_ASSET, 'store']]))
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(false)
        }
    })

    test('(R) the clean twin of the overlap case: an entry whose data holds a whole entry imports whole', async () => {
        const clean = nestedArchive(false)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const twin = await runImport(makeInput(inputKind, clean.bytes, chunk))
            expect(importedWhole(twin, SIG_NAME, clean.outerData), label).toBe(true)
        }
    })

    test('(G) damaged: a listed entry that lies inside another entry\'s data (overlap)', async () => {
        const overlapping = nestedArchive(true)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, overlapping.bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, overlapping.outerData), label).toBe(false)
        }
    })

    test('(G) damaged: a wrong offset field on a JPEG-prefixed archive', async () => {
        const bytes = patched(standardArchive('store', BLOB_ASSET, JPEG_PREFIX), (view, layout) => {
            view.setUint32(layout.endRecord + 16, view.getUint32(layout.endRecord + 16, true) + 1, true)
        })
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(false)
        }
    })

    test('(G) damaged: a local compressed size that differs from the central one on a bit-3-clear entry', async () => {
        // zipSync writes the sizes in the local header and no descriptor
        const clean = fflate.zipSync({ 'card.json': [CARD, { level: 6 }], [SIG_NAME]: [BLOB_ASSET, { level: 0 }], [SMALL_NAME]: [SMALL_ASSET, { level: 0 }] })
        const damaged = patched(clean, (view, layout) => {
            const at = layout.entries[1].local + 18
            view.setUint32(at, view.getUint32(at, true) - 1, true)
        })
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const twin = await runImport(makeInput(inputKind, clean, chunk))
            expect(importedWhole(twin, SIG_NAME, BLOB_ASSET), `${label} clean`).toBe(true)
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, damaged, chunk))
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(false)
        }
    })
})

describe('an entry the directory does not list (MC-803)', () => {
    const base = standardArchive('store')

    test.each(['before', 'between', 'after'] as const)('(N) an orphan %s the listed entries is skipped, and every listed entry imports whole', async (where) => {
        const bytes = withOrphan(base, where)
        expect(contains(bytes, new TextEncoder().encode('assets/orphan.bin'))).toBe(true)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(originOf(outcome) ?? 'imported', label).toBe('imported')
            expect(Object.keys(outcome.importer.assets).sort(), label).toEqual([SIG_NAME, SMALL_NAME])
            expect(same(savedEntry(outcome, SIG_NAME), BLOB_ASSET), label).toBe(true)
        }
    })
})

describe('the splice\'s own failures and the source\'s', () => {
    // No signature in the asset: where the stream ends is then the only thing that can go wrong, on any reader.
    const bytes = standardArchive('store', random(3000, 71))
    const layout = layoutOf(bytes)
    const last = layout.entries[layout.entries.length - 1]

    async function endsAt(cut: number) {
        for (const chunk of [29, 4096]) {
            h.saved.clear()
            const outcome = await runImport(sourceOf(bytes, chunk, { stream: () => chunkedStream(bytes.subarray(0, cut), chunk) }))
            expect(originOf(outcome), `piece size ${chunk}`).toBe('zip')
        }
    }

    test('(G) a stream that ends inside the last entry is a ZIP failure', async () => {
        await endsAt(last.bodyStart + 100)
    })

    test.each([
        ['right after the last entry, before the directory', layout.directoryStart],
        ['inside the directory', layout.directoryStart + 20],
        ['right before the end record', layout.endRecord],
    ])('(N) a stream that ends %s is a ZIP failure', async (_label, cut) => {
        await endsAt(cut)
    })

    test('(N) a header that changed between validation and the splice is a ZIP failure', async () => {
        const changed = new Uint8Array(bytes)
        changed[layout.entries[1].local + 10] ^= 1
        for (const chunk of CHUNKS) {
            const outcome = await runImport(sourceOf(bytes, chunk, { stream: () => chunkedStream(changed, chunk) }))
            expect(originOf(outcome), `piece size ${chunk}`).toBe('zip')
        }
    })

    test('(N) a validation read that throws is an input failure with its message', async () => {
        let calls = 0
        const base = importSourceOfBytes('card.charx', bytes)
        // the tail and the directory are the first two reads; the next is validation's
        const source: ImportSource = { ...base, read: async (start, end) => {
            if (++calls > 2) {
                throw new Error('the disk went away')
            }
            return base.read(start, end)
        } }
        const outcome = await runImport(source)

        expect(originOf(outcome)).toBe('input')
        expect((outcome.failure as Error).message).toBe('the disk went away')
        expect(h.saved.size).toBe(0)
    })

    test('(G) a stream read that throws is an input failure with its message', async () => {
        const failure = new Error('the stream broke')
        // no signature in the asset: the stream's own failure is the first thing that goes wrong, on any reader
        const clean = standardArchive('store', random(3000, 71))
        const outcome = await runImport(sourceOf(clean, 1000, { stream: () => chunkedStream(clean, 1000, 2, failure) }))

        expect(originOf(outcome)).toBe('input')
        expect((outcome.failure as Error).message).toBe('the stream broke')
    })
})

describe('compatibility', () => {
    const KEEPER = () => {
        const arrays: Uint8Array[] = []
        return { arrays, writer: { write: async (data: Uint8Array) => { arrays.push(data) }, close: async () => { } }, bytes: () => joined(...arrays) }
    }
    type Target = ConstructorParameters<typeof CharXWriter>[0]

    test('(G) the fork\'s own C1 export (sizes in the headers, an empty entry with a descriptor) imports whole', async () => {
        const out = KEEPER()
        const writer = new CharXWriter(out.writer as unknown as Target)
        await writer.write('card.json', '{"spec":"chara_card_v3"}', 6)
        await writer.write(SIG_NAME, BLOB_ASSET, 0)
        await writer.write('assets/other/empty.bin', new Uint8Array(0), 0)
        await writer.write(SMALL_NAME, SMALL_ASSET, 6)
        await writer.end()
        const bytes = out.bytes()
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(true)
            expect(same(savedEntry(outcome, 'assets/other/empty.bin'), new Uint8Array(0)), label).toBe(true)
            expect(importedWhole(outcome, SMALL_NAME, SMALL_ASSET), label).toBe(true)
        }
    })

    test('(G) the fork\'s own C2 export (a streamed STORE entry in two passes) imports whole', async () => {
        const out = KEEPER()
        const writer = new CharXWriter(out.writer as unknown as Target)
        const open = async (): Promise<CharxStreamOpened> => {
            const pieces = [BLOB_ASSET.subarray(0, 1000), BLOB_ASSET.subarray(1000, 2200), BLOB_ASSET.subarray(2200)]
            const [first, ...others] = pieces
            return {
                first: { bytes: first, total: BLOB_ASSET.length },
                rest: (async function* () {
                    for (const bytes of others) {
                        yield { bytes, total: BLOB_ASSET.length }
                    }
                })(),
            }
        }
        await writer.write('card.json', '{"spec":"chara_card_v3"}', 6)
        await writer.writeStream(SIG_NAME, open, BLOB_ASSET.length, undefined, { name: 'blob' })
        await writer.end()
        const bytes = out.bytes()
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(true)
        }
    })

    test('(G) an empty last entry (zipSync, STORE) imports', async () => {
        const bytes = fflate.zipSync({ 'card.json': [CARD, { level: 6 }], [SMALL_NAME]: [SMALL_ASSET, { level: 0 }], 'assets/other/empty.bin': [new Uint8Array(0), { level: 0 }] })
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(originOf(outcome) ?? 'imported', label).toBe('imported')
            expect(same(savedEntry(outcome, 'assets/other/empty.bin'), new Uint8Array(0)), label).toBe(true)
            expect(same(savedEntry(outcome, SMALL_NAME), SMALL_ASSET), label).toBe(true)
        }
    })

    test('(G) an upstream-framed empty last entry and an empty middle entry import', async () => {
        const last = upstreamArchive([['card.json', CARD, 'deflate-6'], [SMALL_NAME, SMALL_ASSET, 'store'], ['assets/other/empty.bin', new Uint8Array(0), 'store']])
        const middle = upstreamArchive([['card.json', CARD, 'deflate-6'], ['assets/other/empty.bin', new Uint8Array(0), 'store'], [SMALL_NAME, SMALL_ASSET, 'store']])
        for (const bytes of [last, middle]) {
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, bytes, chunk))
                expect(originOf(outcome) ?? 'imported', label).toBe('imported')
                expect(same(savedEntry(outcome, 'assets/other/empty.bin'), new Uint8Array(0)), label).toBe(true)
                expect(same(savedEntry(outcome, SMALL_NAME), SMALL_ASSET), label).toBe(true)
            }
        }
    })

    test('(G) duplicate names: the entry saved last is the one kept, as the stream gives them', async () => {
        const first = random(200, 41)
        const second = random(300, 42)
        const bytes = upstreamArchive([['card.json', CARD, 'deflate-6'], [SMALL_NAME, first, 'store'], [SMALL_NAME, second, 'store']])
        const reference = await runImport(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }))
        h.saved.clear()
        const outcome = await runImport(bytes)

        expect(originOf(outcome)).toBe(originOf(reference))
        expect(same(savedEntry(outcome, SMALL_NAME), second)).toBe(true)
    })

    test('(G) a ReadableStream input is read as it comes: a clean archive imports, a signature asset is not read by the directory', async () => {
        const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
        const clean = standardArchive('store', random(2000, 51))
        expect(importedWhole(await runImport(stream(clean)), SIG_NAME, random(2000, 51))).toBe(true)
        h.saved.clear()
        expect(importedWhole(await runImport(stream(standardArchive('store'))), SIG_NAME, BLOB_ASSET)).toBe(false)
    })

    test('(G) the asset limit refuses an entry the directory lists above it before an entry is read', async () => {
        charxLimits.assetBytes = 1000
        const bytes = standardArchive('store')
        const reads: Array<[number, number]> = []
        let streams = 0
        const base = importSourceOfBytes('card.charx', bytes)
        const outcome = await runImport({
            ...base,
            read: async (start, end) => { reads.push([start, end]); return base.read(start, end) },
            stream: () => { streams++; return chunkedStream(bytes, 4096) },
        })

        expect(outcome.failure).toBeInstanceOf(CharXParseError)
        expect(originOf(outcome)).toBe('size')
        expect(streams).toBe(0)
        // only the tail and the directory were read
        expect(reads.length).toBeLessThanOrEqual(2)
        expect(h.saved.size).toBe(0)
    })
})

describe('validation reads', () => {
    /** The reads validation made: all but the tail read (the input's last 64 KiB and the end record) and the directory read. */
    function validationReads(reads: Array<[number, number]>, layout: Layout, size: number): Array<[number, number]> {
        const tailStart = Math.max(0, size - (22 + 0xFFFF))
        return reads.filter(([start, end]) => !(start === tailStart && end === size) && !(start === layout.directoryStart && end === layout.endRecord))
    }

    // A card.json past the window skip: every body is larger than 16 KiB, so each boundary is one small read.
    const BIG_CARD = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'x', description: 'a'.repeat(17 * 1024 + 200) } }))
    const bigEntries: Entry[] = [
        ['card.json', BIG_CARD, 'store'],
        ...Array.from({ length: 6 }, (_, i): Entry => [`assets/other/big${i}.bin`, random(17 * 1024 + 200, 60 + i), 'store']),
    ]
    const packedEntries: Entry[] = [
        ['card.json', CARD, 'deflate-6'],
        ...Array.from({ length: 90 }, (_, i): Entry => [`assets/other/packed${i}.bin`, random(8 * 1024, 80 + i), 'store']),
    ]

    function recorder(bytes: Uint8Array) {
        const reads: Array<[number, number]> = []
        let streams = 0
        const base = importSourceOfBytes('card.charx', bytes)
        const source: ImportSource = {
            ...base,
            read: async (start, end) => { reads.push([start, end]); return base.read(start, end) },
            stream: () => { streams++; return chunkedStream(bytes, 4096) },
        }
        return { source, reads, streams: () => streams }
    }

    function countingFile(bytes: Uint8Array) {
        const reads: Array<[number, number]> = []
        const file = new File([new Uint8Array(bytes)], 'card.charx')
        const slice = file.slice.bind(file)
        file.slice = ((start?: number, end?: number) => { reads.push([start ?? 0, end ?? bytes.length]); return slice(start, end) }) as File['slice']
        return { file, reads }
    }

    test.each(['import-source', 'file'])('(N) %s: bodies larger than 16 KiB take at most one small read per boundary', async (kind) => {
        const bytes = upstreamArchive(bigEntries)
        const layout = layoutOf(bytes)
        const subject = kind === 'file' ? countingFile(bytes) : recorder(bytes)
        const outcome = await runImport(kind === 'file' ? (subject as ReturnType<typeof countingFile>).file : (subject as ReturnType<typeof recorder>).source)
        const reads = validationReads(subject.reads, layout, bytes.length)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(bigEntries.length - 1)
        // the first header, every later boundary, and the last descriptor
        expect(reads.length).toBeGreaterThanOrEqual(bigEntries.length)
        expect(reads.length).toBeLessThanOrEqual(bigEntries.length + 1)
        // no read takes a body: a read of the whole file or of an entry would be far over this
        for (const [start, end] of reads) {
            expect(end - start).toBeLessThan(1024)
        }
        if (kind === 'import-source') {
            // the bodies come only from the stream
            expect((subject as ReturnType<typeof recorder>).streams()).toBe(1)
        }
    })

    test.each(['import-source', 'file'])('(N) %s: packed small entries share windows and read the file about once', async (kind) => {
        const bytes = upstreamArchive(packedEntries)
        const layout = layoutOf(bytes)
        const subject = kind === 'file' ? countingFile(bytes) : recorder(bytes)
        const outcome = await runImport(kind === 'file' ? (subject as ReturnType<typeof countingFile>).file : (subject as ReturnType<typeof recorder>).source)
        const reads = validationReads(subject.reads, layout, bytes.length)
        const readBytes = reads.reduce((total, [start, end]) => total + (end - start), 0)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(packedEntries.length - 1)
        // one 256 KiB window per 30 entries, with a few reads for the first header and the last descriptor
        expect(reads.length).toBeGreaterThanOrEqual(3)
        expect(reads.length).toBeLessThanOrEqual(Math.ceil(packedEntries.length / 30) + 3)
        expect(readBytes).toBeLessThanOrEqual(bytes.length + 256 * 1024)
    })
})

describe('read-ahead of the spliced stream', () => {
    const ASSET = random(20_000, 7)
    const bytes = upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, ASSET, 'store'], [SMALL_NAME, SMALL_ASSET, 'deflate-6']])

    /**
     * Imports `bytes` from a stream of 4096-byte pieces while the save of the big asset takes nothing, so its queued bytes
     * hold the importer at the backlog. Returns how often the source was pulled by then. `spliced` gives the stream through
     * an `ImportSource` (the plan applies); otherwise it is the importer's `ReadableStream` input, which is read as it is.
     */
    async function pullsWhileHeld(spliced: boolean): Promise<number> {
        h.saved.clear()
        h.pieces = true
        charxLimits.streamAfterBytes = 1000
        charxLimits.backlogBytes = 1000
        let release: () => void = () => { }
        const gate = new Promise<void>(resolve => { release = resolve })
        vi.mocked(saveAssetFromPieces).mockImplementationOnce(async (pieces: AsyncIterable<Uint8Array>) => {
            await gate
            const parts: Uint8Array[] = []
            for await (const piece of pieces) {
                parts.push(piece.slice())
            }
            const id = 'saved-' + h.saved.size
            h.saved.set(id, new Uint8Array(Buffer.concat(parts)))
            return id
        })
        let pulls = 0
        let at = 0
        const stream = () => new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++
                if (at >= bytes.length) {
                    controller.close()
                    return
                }
                controller.enqueue(bytes.subarray(at, at + 4096))
                at += 4096
            },
        })
        const importer = new CharXImporter()
        const parsing = importer.parse(spliced ? sourceOf(bytes, 4096, { stream }) : stream())

        await new Promise<void>(resolve => setTimeout(resolve, 150))
        const pulled = pulls
        release()
        await parsing
        await importer.done()
        expect(same(savedEntry({ importer }, SIG_NAME), ASSET)).toBe(true)
        return pulled
    }

    test('(N) while the backlog holds the importer, the spliced source is read no further ahead than a stream read as it is', async () => {
        const direct = await pullsWhileHeld(false)
        const spliced = await pullsWhileHeld(true)

        // the importer is held before the archive is read through, so the read-ahead is what the pulls show
        expect(Math.ceil(bytes.length / 4096)).toBeGreaterThan(direct + 2)
        expect(spliced).toBeLessThanOrEqual(direct)
    })
})
