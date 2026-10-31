// @vitest-environment node
/**
 * CharX import through the central directory (CHORE-394, `planDirectoryRead`, `DirectorySplice` and `#spliceStream` of
 * `src/ts/process/processzip.ts`). An archive in upstream's framing (flag bit 3 on every entry, a 16-byte data
 * descriptor after each) is read by its directory, so an asset whose bytes hold a zip signature is not cut short.
 *
 * Labels, per test title:
 * - (R) REGRESSION REPRODUCER: fails by assertion on the commit before the change (the asset is cut short, or the
 *   import is refused, or a bogus entry starts in a JPEG prefix, or a stored entry framed with a data descriptor is
 *   imported at the wrong length from an archive whose directory cannot be used).
 * - (G) COMPATIBILITY GUARD: holds before and after the change. The deflate fallback family pins, per input row, what a
 *   deflate-framed archive gives when its directory disagrees with it (MC-802: read as it always was); every case
 *   there also asserts the result is not 'layout'.
 * - (N) NEW BEHAVIOUR: has no counterpart before the change (an entry the directory does not list is skipped,
 *   MC-803; a header that changed after validation; a validation read that throws; the number of validation reads; how
 *   far the splice reads ahead of the importer; a clean archive whose stream ends at an entry boundary or in the
 *   directory, which the scanning reader imported as if it were complete; a stored entry with a data descriptor on the
 *   fallback path is refused with origin 'layout', MC-804 and MC-805).
 *   A stream that ends inside an entry is refused as a ZIP failure before and after, so that test is (G).
 *
 * The rows of 'validation reads of a picked File' (the picked File's planned windows) follow the same labels: (R) when
 * the row fails by assertion with the sources from before the change (too many reads, a read spanning a body, no
 * window formed), (G) when it holds before and after (a whole import, a changed header, an exact-gap layout).
 *
 * The check cannot fire for an entry the directory lists on the spliced path (the splice gives each its sizes), so for
 * these fixtures, which hold no unlisted local header, a 'layout' result proves the planner rejected the directory
 * and the file took the fallback.
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
    /** The plugin-fs fake behind a desktop source: the file it serves and what was asked of it. */
    desktop: { file: new Uint8Array(0) as Uint8Array, reads: 0, seeks: 0, bytes: 0 },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    open: vi.fn(async () => {
        let position = 0
        return {
            read: async (buffer: Uint8Array) => {
                h.desktop.reads++
                if (position >= h.desktop.file.length) return null
                const count = Math.min(buffer.byteLength, h.desktop.file.length - position)
                buffer.set(h.desktop.file.subarray(position, position + count), 0)
                position += count
                h.desktop.bytes += count
                return count
            },
            seek: async (offset: number) => {
                h.desktop.seeks++
                position = offset
                return position
            },
            stat: async () => ({ size: h.desktop.file.length, mtime: null }),
            close: async () => { },
        }
    }),
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
import { importSourceOfBytes, importSourceOfFile, openDesktopImportSource, RANGE_BATCH_MAX_RANGES, RangeBatchReader, type ImportSource } from 'src/ts/importSource'
import { CharXImporter, CharXParseError, CharXWriter, charxLimits, type CharxStreamOpened } from 'src/ts/process/processzip'
import { ZIP_SIGNATURE_BLOB } from './zipFixtures'

const MIB = 1024 * 1024
const CHUNKS = [1, 7, 29, 4096, MIB]

const originalLimits = { ...charxLimits }

beforeEach(() => {
    h.saved.clear()
    h.pieces = false
    vi.mocked(saveAssetFromPieces).mockClear()
    rangeCalls.length = 0
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
function nestedArchive(listed: boolean, kind: Kind = 'store'): { bytes: Uint8Array, outerData: Uint8Array } {
    const donor = upstreamArchive([['assets/other/inner.bin', random(200, 9), kind]])
    const donorLayout = layoutOf(donor)
    const outerData = donor.slice(0, donorLayout.directoryStart)
    const innerRecord = donor.slice(donorLayout.directoryStart, donorLayout.endRecord)
    const outer = upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, outerData, kind], [SMALL_NAME, SMALL_ASSET, 'deflate-6']])
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

type InputKind = 'bytes' | 'file' | 'chunked-file' | 'import-source' | 'batched-file'

/** The ranges of every `readRanges` call a 'batched-file' source made since the test began. */
const rangeCalls: Array<ReadonlyArray<readonly [number, number]>> = []

/**
 * A picked File whose window is 64 KiB with no gap, so that validation of a small fixture asks for a batch of several
 * segments, and whose `readRanges` is recorded in `rangeCalls`.
 */
function batchedFileSource(bytes: Uint8Array): ImportSource {
    const base = importSourceOfFile(new File([new Uint8Array(bytes)], 'card.charx'), 64 * 1024, 0)
    const readRanges = base.readRanges
    if (readRanges === undefined) {
        throw new Error('a picked File carries readRanges')
    }
    return { ...base, readRanges: async (ranges) => { rangeCalls.push(ranges); return await readRanges(ranges) } }
}

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
        case 'batched-file':
            return batchedFileSource(bytes)
    }
}

/** Every input kind; the two that give pieces of a chosen size are swept over `CHUNKS`. */
const INPUTS: Array<[label: string, kind: InputKind, chunk: number]> = [
    ['bytes', 'bytes', 0],
    ['file', 'file', 0],
    ...CHUNKS.map((chunk): [string, InputKind, number] => [`chunked-file ${chunk}`, 'chunked-file', chunk]),
    ...CHUNKS.map((chunk): [string, InputKind, number] => [`import-source ${chunk}`, 'import-source', chunk]),
    ['batched-file', 'batched-file', 0],
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

        test('(N) damaged: a descriptor CRC that differs from the central CRC (12 bytes) takes the fallback and is refused as a layout failure', async () => {
            const damaged = patched(clean, (view, layout) => {
                view.setUint8(layout.entries[1].bodyEnd, view.getUint8(layout.entries[1].bodyEnd) ^ 1)
            })
            // the clean archive is the (R) test above
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, damaged, chunk))
                expect(originOf(outcome), label).toBe('layout')
                expect(h.saved.size, label).toBe(0)
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

/**
 * The damages that make the directory disagree with the file. `centralMethod` is the method the "central method"
 * damage writes: the one that differs from the local method (8 for a stored entry, 0 for a deflate entry).
 */
const damagesFor = (centralMethod: number): Array<[string, (bytes: Uint8Array) => Uint8Array]> => [
    ['a central compressed size off by one', bytes => patched(bytes, (view, layout) => {
        const at = layout.entries[1].central + 20
        view.setUint32(at, view.getUint32(at, true) + 1, true)
    })],
    ['a central name that differs from the local name', bytes => patched(bytes, (view, layout) => {
        const at = layout.entries[1].central + 46 + layout.entries[1].nameLength - 1
        view.setUint8(at, view.getUint8(at) ^ 1)
    })],
    ['a central method that differs from the local method', bytes => patched(bytes, (view, layout) => {
        view.setUint16(layout.entries[1].central + 10, centralMethod, true)
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

/** The damage applied to an archive whose second and third entries use `kind`. */
const damagedArchive = (kind: Kind, damage: (bytes: Uint8Array) => Uint8Array) =>
    damage(upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, BLOB_ASSET, kind], ['assets/other/siq.bin', SMALL_ASSET, kind]]))

describe('a directory that disagrees with the file (MC-802, MC-804, MC-805)', () => {
    // Each damage is applied to a copy of the same archive; the planner rejects the directory, so the file takes the
    // fallback, where a stored entry with a descriptor is refused as 'layout'. The clean archive is the (R) test above.

    test.each(damagesFor(8))('(N) damaged: %s is refused as a layout failure, and nothing is saved', async (_label, damage) => {
        const bytes = damagedArchive('store', damage)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(originOf(outcome), label).toBe('layout')
            expect(h.saved.size, label).toBe(0)
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

    test('(N) damaged: a listed entry that lies inside another entry\'s data (overlap) is refused as a layout failure, and nothing is saved', async () => {
        const overlapping = nestedArchive(true)
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, overlapping.bytes, chunk))
            expect(originOf(outcome), label).toBe('layout')
            expect(h.saved.size, label).toBe(0)
        }
    })

    // The JPEG prefix holds a local header signature whose name and extra lengths read 0x1111 each, so the scanning
    // reader waits for header bytes the archive never supplies and starts no entry: the check never runs, here or before.
    test('(G) damaged: a wrong offset field on a JPEG-prefixed archive fails nowhere and saves nothing', async () => {
        const bytes = patched(standardArchive('store', BLOB_ASSET, JPEG_PREFIX), (view, layout) => {
            view.setUint32(layout.endRecord + 16, view.getUint32(layout.endRecord + 16, true) + 1, true)
        })
        for (const [label, inputKind, chunk] of INPUTS) {
            h.saved.clear()
            const outcome = await runImport(makeInput(inputKind, bytes, chunk))
            expect(outcome.failure, label).toBeUndefined()
            expect(savedEntry(outcome, SIG_NAME), label).toBeUndefined()
            expect(h.saved.size, label).toBe(0)
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

describe('a stored entry framed with a data descriptor on the fallback path (MC-804, MC-805)', () => {
    /** The archive with a complete bit-3-clear stored entry (zipSync framing) listed after the last listed entry. */
    function withListedClean(bytes: Uint8Array, tail: Uint8Array): Uint8Array {
        const layout = layoutOf(bytes)
        const donor = fflate.zipSync({ 'assets/other/tail.bin': [tail, { level: 0 }] })
        const donorLayout = layoutOf(donor)
        const local = donor.slice(0, donorLayout.directoryStart)
        const central = donor.slice(donorLayout.directoryStart, donorLayout.endRecord)
        new DataView(central.buffer).setUint32(42, layout.directoryStart - layout.zipStart, true)
        const out = joined(bytes.subarray(0, layout.directoryStart), local, bytes.subarray(layout.directoryStart, layout.endRecord), central, bytes.subarray(layout.endRecord))
        const view = new DataView(out.buffer)
        const end = layout.endRecord + local.length + central.length
        view.setUint16(end + 8, view.getUint16(end + 8, true) + 1, true)
        view.setUint16(end + 10, view.getUint16(end + 10, true) + 1, true)
        view.setUint32(end + 12, view.getUint32(end + 12, true) + central.length, true)
        view.setUint32(end + 16, view.getUint32(end + 16, true) + local.length, true)
        return out
    }

    /** The end record states one more entry than the directory holds, so the directory is not used. */
    const countPlusOne = (bytes: Uint8Array) => patched(bytes, (view, layout) => {
        view.setUint16(layout.endRecord + 8, view.getUint16(layout.endRecord + 8, true) + 1, true)
        view.setUint16(layout.endRecord + 10, view.getUint16(layout.endRecord + 10, true) + 1, true)
    })

    /** A stream of two pieces, cut `cut` bytes into the archive. */
    function twoPieceSource(bytes: Uint8Array, cut: number): ImportSource {
        return sourceOf(bytes, cut, {
            stream: () => {
                let step = 0
                return new ReadableStream<Uint8Array>({
                    pull(controller) {
                        if (step === 0) {
                            controller.enqueue(bytes.subarray(0, cut))
                        } else if (step === 1) {
                            controller.enqueue(bytes.subarray(cut))
                        } else {
                            controller.close()
                        }
                        step++
                    },
                })
            },
        })
    }

    describe('the last entry is stored, with 12-byte descriptors', () => {
        const clean = withShortDescriptors(upstreamArchive([['card.json', CARD, 'deflate-6'], [SMALL_NAME, SMALL_ASSET, 'deflate-6'], [SIG_NAME, BLOB_ASSET, 'store']]))
        const damages: Array<[string, (bytes: Uint8Array) => Uint8Array]> = [
            ['a wrong offset field', bytes => patched(bytes, (view, layout) => {
                view.setUint32(layout.endRecord + 16, view.getUint32(layout.endRecord + 16, true) + 1, true)
            })],
            ['an entry count that differs from the directory', countPlusOne],
            ['a central compressed size that disagrees', bytes => patched(bytes, (view, layout) => {
                const at = layout.entries[2].central + 20
                view.setUint32(at, view.getUint32(at, true) + 1, true)
            })],
        ]

        test('(G) the fixture: the undamaged twin is valid and imports whole through the splice', async () => {
            const files = fflate.unzipSync(clean)
            expect(same(files[SIG_NAME], BLOB_ASSET)).toBe(true)
            expect(same(files[SMALL_NAME], SMALL_ASSET)).toBe(true)
            const layout = layoutOf(clean)
            expect(layout.entries[2].bodyEnd + 12).toBe(layout.directoryStart)
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, clean, chunk))
                expect(importedWhole(outcome, SIG_NAME, BLOB_ASSET), label).toBe(true)
            }
        })

        test.each(damages)('(R) damaged by %s: the asset is not imported cut short, the file is refused as a layout failure', async (_label, damage) => {
            const bytes = damage(clean)
            for (const [label, inputKind, chunk] of INPUTS) {
                h.saved.clear()
                const outcome = await runImport(makeInput(inputKind, bytes, chunk))
                expect(originOf(outcome), label).toBe('layout')
                expect(savedEntry(outcome, SIG_NAME), label).toBeUndefined()
            }
        })
    })

    describe('a stored middle entry with 12-byte descriptors, then a listed entry that ends cleanly', () => {
        const MIDDLE = random(900, 78)
        const TAIL = random(300, 6)
        const clean = withListedClean(withShortDescriptors(upstreamArchive([['card.json', CARD, 'deflate-6'], [SIG_NAME, MIDDLE, 'store']])), TAIL)
        const damaged = countPlusOne(clean)
        // Boundaries inside the middle entry's descriptor (+5, +8), at the next header (+12) and inside it (+16).
        const CUTS = [5, 8, 12, 16]

        test('(G) the fixture: the undamaged twin is valid, and the cuts land inside the descriptor, at the next header and inside it', () => {
            const files = fflate.unzipSync(clean)
            expect(same(files[SIG_NAME], MIDDLE)).toBe(true)
            expect(same(files['assets/other/tail.bin'], TAIL)).toBe(true)
            const layout = layoutOf(clean)
            expect(layout.entries).toHaveLength(3)
            const view = new DataView(clean.buffer, clean.byteOffset, clean.byteLength)
            // the middle entry has a descriptor, the last entry has none
            expect(view.getUint16(layout.entries[1].local + 6, true) & 8).toBe(8)
            expect(view.getUint16(layout.entries[2].local + 6, true) & 8).toBe(0)
            expect(layout.entries[2].local).toBe(layout.entries[1].bodyEnd + 12)
            expect(CUTS.map(cut => layout.entries[1].bodyEnd + cut < layout.entries[2].local)).toEqual([true, true, false, false])
        })

        test('(G) the undamaged twin imports whole through the splice', async () => {
            h.saved.clear()
            const outcome = await runImport(makeInput('import-source', clean, 29))
            expect(importedWhole(outcome, SIG_NAME, MIDDLE)).toBe(true)
            expect(same(savedEntry(outcome, 'assets/other/tail.bin'), TAIL)).toBe(true)
        })

        test.each(CUTS)('(R) damaged, read in two pieces cut %i bytes after the middle body: refused as a layout failure, nothing saved', async (cut) => {
            // the damaged directory states one entry too many, so the boundaries come from the undamaged twin
            const layout = layoutOf(clean)
            h.saved.clear()
            const outcome = await runImport(twoPieceSource(damaged, layout.entries[1].bodyEnd + cut))
            expect(originOf(outcome)).toBe('layout')
            expect(savedEntry(outcome, SIG_NAME)).toBeUndefined()
            expect(h.saved.size).toBe(0)
        })
    })

    test('(N) a ReadableStream input with a stored entry and the standard 16-byte descriptor is refused as a layout failure', async () => {
        const bytes = standardArchive('store')
        const outcome = await runImport(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }))

        expect(originOf(outcome)).toBe('layout')
        expect(savedEntry(outcome, SIG_NAME)).toBeUndefined()
        expect(h.saved.size).toBe(0)
    })

    test('(N) an entry routed as drop is refused too, and an entry the same archive frames with a deflate method is not', async () => {
        const router = (name: string) => name === 'card.json'
            ? { kind: 'card' as const, limitBytes: MIB }
            : { kind: 'drop' as const, limitBytes: Infinity }
        const parseWith = async (bytes: Uint8Array) => {
            const importer = new CharXImporter(router)
            try {
                await importer.parse(bytes)
                await importer.done()
                return undefined
            } catch (error) {
                return error
            }
        }
        const dropped = random(100, 5)
        const stored = upstreamArchive([['card.json', CARD, 'deflate-6'], ['assets/other/drop.bin', dropped, 'store']])
        const deflated = upstreamArchive([['card.json', CARD, 'deflate-6'], ['assets/other/drop.bin', dropped, 'deflate-0']])

        // a valid directory is spliced, so the stored entry has its sizes and is read
        expect(await parseWith(stored)).toBeUndefined()
        expect(await parseWith(countPlusOne(deflated))).toBeUndefined()
        const failure = await parseWith(countPlusOne(stored))
        expect(failure).toBeInstanceOf(CharXParseError)
        expect((failure as CharXParseError).origin).toBe('layout')
    })

    // The deflate framing keeps the raw signatures but not a stored method, so the check never fires. Each row is what
    // the commit before MC-804 gave for that input: the family pins "read as it always was" (MC-802).
    describe('the same damages on a deflate-0 asset: read as before', () => {
        const damagedCases = (): Array<[string, Uint8Array, Uint8Array]> => {
            const cases: Array<[string, Uint8Array, Uint8Array]> = damagesFor(0).map(([label, damage]) => [label, damagedArchive('deflate-0', damage), BLOB_ASSET])
            const nested = nestedArchive(true, 'deflate-0')
            cases.push(['overlap', nested.bytes, nested.outerData])
            cases.push(['jpg wrong offset', patched(standardArchive('deflate-0', BLOB_ASSET, JPEG_PREFIX), (view, layout) => {
                view.setUint32(layout.endRecord + 16, view.getUint32(layout.endRecord + 16, true) + 1, true)
            }), BLOB_ASSET])
            cases.push(['12-byte CRC', patched(withShortDescriptors(standardArchive('deflate-0')), (view, layout) => {
                view.setUint8(layout.entries[1].bodyEnd, view.getUint8(layout.entries[1].bodyEnd) ^ 1)
            }), BLOB_ASSET])
            return cases
        }

        const ALL = 'all'
        const FAILS = 'origin=zip sig=none assets=0'
        const WHOLE_ROWS = 'bytes,file,chunked-file 4096,chunked-file 1048576,import-source 4096,import-source 1048576,batched-file'
        const EXPECTED: Array<[caseLabel: string, result: string, inputs: string]> = [
            ['a central compressed size off by one', FAILS, ALL],
            ['a central name that differs from the local name', FAILS, ALL],
            ['a central method that differs from the local method', FAILS, ALL],
            ['a central bit 3 that differs from the local bit 3', FAILS, ALL],
            ['a descriptor CRC that differs from the central CRC', FAILS, ALL],
            ['a descriptor compressed size that differs from the central one', FAILS, ALL],
            ['a central offset into the middle of another entry', FAILS, ALL],
            ['a directory entry listed twice, so two entries start at one offset', FAILS, ALL],
            ['overlap', 'origin=imported sig=273(whole) assets=3', WHOLE_ROWS],
            ['overlap', FAILS, 'chunked-file 1,chunked-file 7,chunked-file 29,import-source 1,import-source 7,import-source 29'],
            ['jpg wrong offset', 'origin=imported sig=none assets=0', ALL],
            ['12-byte CRC', FAILS, ALL],
        ]

        test('(G) every case gives what the commit before MC-804 gave, per input row, and never a layout failure', async () => {
            const actual: Array<[string, string, string]> = []
            for (const [caseLabel, bytes, expected] of damagedCases()) {
                const rows = new Map<string, string[]>()
                for (const [label, inputKind, chunk] of INPUTS) {
                    h.saved.clear()
                    const outcome = await runImport(makeInput(inputKind, bytes, chunk))
                    expect(originOf(outcome), `${caseLabel} ${label}`).not.toBe('layout')
                    const saved = savedEntry(outcome, SIG_NAME)
                    const result = `origin=${originOf(outcome) ?? 'imported'} sig=${saved === undefined ? 'none' : saved.length}${same(saved, expected) ? '(whole)' : ''} assets=${h.saved.size}`
                    rows.set(result, [...(rows.get(result) ?? []), label])
                }
                for (const [result, inputs] of rows) {
                    actual.push([caseLabel, result, inputs.length === INPUTS.length ? ALL : inputs.join(',')])
                }
            }
            expect(actual).toEqual(EXPECTED)
        }, 300_000)
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
        const bytes = upstreamArchive([['card.json', CARD, 'deflate-6'], [SMALL_NAME, first, 'deflate-0'], [SMALL_NAME, second, 'deflate-0']])
        const reference = await runImport(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }))
        h.saved.clear()
        const outcome = await runImport(bytes)

        expect(originOf(outcome)).toBe(originOf(reference))
        expect(same(savedEntry(outcome, SMALL_NAME), second)).toBe(true)
    })

    test('(G) a ReadableStream input is read as it comes: a clean archive imports, a signature asset is not read by the directory', async () => {
        const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
        // deflate-0 keeps the raw signatures and is not a stored method, so the layout check does not apply
        const clean = standardArchive('deflate-0', random(2000, 51))
        expect(importedWhole(await runImport(stream(clean)), SIG_NAME, random(2000, 51))).toBe(true)
        h.saved.clear()
        expect(importedWhole(await runImport(stream(standardArchive('deflate-0'))), SIG_NAME, BLOB_ASSET)).toBe(false)
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
        if (kind === 'file') {
            // a picked File reads the run of small bodies in one call: the whole archive is far inside one window
            expect(reads.length).toBeGreaterThanOrEqual(1)
            expect(reads.length).toBeLessThanOrEqual(3)
        } else {
            // the first header, every later boundary, and the last descriptor
            expect(reads.length).toBeGreaterThanOrEqual(bigEntries.length)
            expect(reads.length).toBeLessThanOrEqual(bigEntries.length + 1)
        }
        // no read takes a body: a read of the whole file or of an entry would be far over this
        for (const [start, end] of reads) {
            expect(end - start).toBeLessThan(kind === 'file' ? bytes.length : 1024)
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
        expect(reads.length).toBeGreaterThanOrEqual(kind === 'file' ? 1 : 3)
        expect(reads.length).toBeLessThanOrEqual(Math.ceil(packedEntries.length / 30) + 3)
        expect(readBytes).toBeLessThanOrEqual(bytes.length + 256 * 1024)
    })
})

describe('validation reads of a picked File', () => {
    const KIB = 1024
    /** The header bytes validation asks for beyond the fixed part and the name; the reader's own constant. */
    const HEADER_SLACK = 64

    /** The reads validation made: all but the tail read and the directory read. */
    function validationReadsOf(reads: Array<[number, number]>, bytes: Uint8Array): Array<[number, number]> {
        const layout = layoutOf(bytes)
        const tailStart = Math.max(0, bytes.length - (22 + 0xFFFF))
        return reads.filter(([start, end]) => !(start === tailStart && end === bytes.length) && !(start === layout.directoryStart && end === layout.endRecord))
    }

    /**
     * A File whose `slice` calls are listed. Its stream gives pieces of 64 KiB: a browser stream does, and fflate recurses
     * per entry within one piece. `slicesAtStream` is how many slices were taken when the import first streamed the file,
     * that is, the calls validation (and the tail and directory reads) made.
     */
    function listedFile(bytes: Uint8Array) {
        const reads: Array<[number, number]> = []
        const file = new File([new Uint8Array(bytes)], 'card.charx')
        const slice = file.slice.bind(file)
        const counters: { slicesAtStream: number | null } = { slicesAtStream: null }
        file.slice = ((start?: number, end?: number) => { reads.push([start ?? 0, end ?? bytes.length]); return slice(start, end) }) as File['slice']
        file.stream = (() => { counters.slicesAtStream ??= reads.length; return chunkedStream(bytes, 64 * KIB) }) as File['stream']
        return { file, reads, counters }
    }

    /** The validation reads of the same archive through a source that carries no window (the reads before the change). */
    async function unplannedReadsOf(bytes: Uint8Array): Promise<Array<[number, number]>> {
        const reads: Array<[number, number]> = []
        const base = importSourceOfBytes('card.charx', bytes)
        await runImport({ ...base, read: async (start, end) => { reads.push([start, end]); return base.read(start, end) }, stream: () => chunkedStream(bytes, 4096) })
        return validationReadsOf(reads, bytes)
    }

    function entriesOf(count: number, size: number, seed: number): Entry[] {
        return [['card.json', CARD, 'store'], ...Array.from({ length: count }, (_, i): Entry => [`assets/other/body${i}.bin`, random(size, seed + i), 'store'])]
    }

    function bytesRead(reads: Array<[number, number]>): number {
        return reads.reduce((total, [start, end]) => total + (end - start), 0)
    }

    /** The archive with a complete unlisted local entry of `size` data bytes in front of listed entry `before`. */
    function withSizedOrphan(bytes: Uint8Array, before: number, size: number): Uint8Array {
        const layout = layoutOf(bytes)
        const donor = fflate.zipSync({ 'assets/orphan.bin': [random(size, 5), { level: 0 }] })
        const orphan = donor.slice(0, layoutOf(donor).directoryStart)
        const at = layout.entries[before].local
        const out = joined(bytes.subarray(0, at), orphan, bytes.subarray(at))
        const view = new DataView(out.buffer)
        view.setUint32(layout.endRecord + orphan.length + 16, view.getUint32(layout.endRecord + orphan.length + 16, true) + orphan.length, true)
        let central = layout.directoryStart + orphan.length
        for (let i = 0; i < layout.entries.length; i++) {
            const offset = view.getUint32(central + 42, true)
            if (layout.zipStart + offset >= at) {
                view.setUint32(central + 42, offset + orphan.length, true)
            }
            central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
        }
        return out
    }

    function cardOfLength(length: number): Uint8Array {
        const empty = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'x', description: '' } })).length
        const card = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'x', description: 'a'.repeat(length - empty) } }))
        expect(card.length).toBe(length)
        return card
    }

    /**
     * An import of `bytes` through `sourceOf(file)` with the picked File's `Blob.prototype.arrayBuffer` calls counted.
     * A burst starts with a call begun while no other counted call is pending: a reader that awaits each read gives bursts
     * of one, and one that starts its reads together gives one burst. The tail read and the directory read (the first two
     * calls, awaited one after the other) and every call from the first `stream()` on are left out. `calls` holds the byte
     * length of each counted call and `slices` every `slice` of the File, in order.
     */
    async function importCounted(bytes: Uint8Array, makeSource: (file: File) => ImportSource) {
        const subject = listedFile(bytes)
        const stream = subject.file.stream.bind(subject.file)
        const all: Array<{ idle: boolean, length: number }> = []
        let streamedAt: number | null = null
        subject.file.stream = (() => { streamedAt ??= all.length; return stream() }) as File['stream']
        const original = Blob.prototype.arrayBuffer
        let pending = 0
        Blob.prototype.arrayBuffer = function (this: Blob) {
            all.push({ idle: pending === 0, length: this.size })
            pending++
            return original.call(this).finally(() => { pending-- })
        }
        let outcome: Outcome
        try {
            outcome = await runImport(makeSource(subject.file))
        } finally {
            Blob.prototype.arrayBuffer = original
        }
        expect(streamedAt).not.toBeNull()
        expect(all.slice(0, 2).map(call => call.idle)).toEqual([true, true])
        const counted = all.slice(2, streamedAt ?? 0)
        const bursts: number[] = []
        for (const call of counted) {
            if (call.idle) {
                bursts.push(1)
            } else {
                bursts[bursts.length - 1]++
            }
        }
        return { outcome, bursts, calls: counted.map(call => call.length), slices: validationReadsOf(subject.reads, bytes) }
    }

    describe('validation reads start together', () => {
        const WINDOW = 128 * KIB
        const GAP = 16 * KIB
        const picked = (file: File) => importSourceOfFile(file, WINDOW, GAP)

        test.each(['store', 'deflate-0'] as Kind[])('(R) 100 %s bodies longer than the gap are validated in one burst of four reads', async (kind) => {
            const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 100 }, (_, i): Entry => [`assets/other/body${i}.bin`, random(64 * KIB, 2000 + i), kind])]
            const bytes = upstreamArchive(entries)

            const { outcome, bursts, calls } = await importCounted(bytes, picked)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(100)
            expect(importedWhole(outcome, 'assets/other/body57.bin', entries[58][1])).toBe(true)
            expect(bursts).toEqual([4])
            expect(calls.reduce((total, length) => total + length, 0)).toBeLessThanOrEqual(WINDOW)
        })

        test('(R) twelve bodies of 4 MiB at the default sizes take at most two bursts of at most four reads', async () => {
            const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 12 }, (_, i): Entry => [`assets/other/body${i}.bin`, random(4 * MIB, 2200 + i), 'deflate-0'])]
            const bytes = upstreamArchive(entries)

            const { outcome, bursts } = await importCounted(bytes, file => importSourceOfFile(file))

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(12)
            expect(bursts.length).toBeLessThanOrEqual(2)
            for (const burst of bursts) {
                expect(burst).toBeLessThanOrEqual(4)
            }
        }, 60_000)

        test('(R) the fork\'s own export of 40 bodies of 64 KiB is validated in one burst of four reads', async () => {
            const chunks: Uint8Array[] = []
            const writer = new CharXWriter({ write: async (data: Uint8Array) => { chunks.push(data) }, close: async () => { } } as unknown as ConstructorParameters<typeof CharXWriter>[0])
            await writer.write('card.json', '{"spec":"chara_card_v3"}', 6)
            const bodies = Array.from({ length: 40 }, (_, i) => random(64 * KIB, 2300 + i))
            for (let i = 0; i < bodies.length; i++) {
                await writer.write(`assets/other/body${i}.bin`, bodies[i], 0)
            }
            await writer.end()
            const bytes = joined(...chunks)

            const { outcome, bursts } = await importCounted(bytes, picked)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(40)
            expect(importedWhole(outcome, 'assets/other/body21.bin', bodies[21])).toBe(true)
            expect(bursts).toEqual([4])
        })

        test('(R) alternating small and big bodies start at most one burst of at most four reads, and no more reads than a source without a window', async () => {
            const entries: Entry[] = [['card.json', CARD, 'store']]
            for (let i = 0; i < 12; i++) {
                entries.push([`assets/other/small${i}.bin`, random(8 * KIB, 300 + i), 'store'], [`assets/other/big${i}.bin`, random(144 * KIB, 400 + i), 'store'])
            }
            const bytes = upstreamArchive(entries)

            const { outcome, bursts, calls } = await importCounted(bytes, picked)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
            expect(bursts.length).toBeLessThanOrEqual(1)
            for (const burst of bursts) {
                expect(burst).toBeLessThanOrEqual(4)
            }
            expect(calls.length).toBeLessThanOrEqual((await unplannedReadsOf(bytes)).length)
        })

        test('(R) a body longer than the gap and a body longer than the window are never read, and the reads start together', async () => {
            // runs of small bodies are three segments: before the 64 KiB body, between it and the 512 KiB body, and after it
            const entries: Entry[] = [
                ['card.json', CARD, 'store'],
                ['assets/other/a1.bin', random(8 * KIB, 500), 'store'], ['assets/other/a2.bin', random(8 * KIB, 501), 'store'],
                ['assets/other/mid.bin', random(64 * KIB, 502), 'store'],
                ['assets/other/b1.bin', random(8 * KIB, 503), 'store'], ['assets/other/b2.bin', random(8 * KIB, 504), 'store'],
                ['assets/other/huge.bin', random(512 * KIB, 505), 'store'],
                ['assets/other/c1.bin', random(8 * KIB, 506), 'store'], ['assets/other/c2.bin', random(8 * KIB, 507), 'store'],
            ]
            const bytes = upstreamArchive(entries)
            const layout = layoutOf(bytes)

            const { outcome, bursts, slices } = await importCounted(bytes, picked)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
            // guard, passes before and after: no slice touches the inside of a body longer than the gap
            for (const name of ['assets/other/mid.bin', 'assets/other/huge.bin']) {
                const body = layout.entries.find(entry => entry.name === name)!
                for (const [start, end] of slices) {
                    expect(start < body.bodyEnd && end > body.bodyStart + HEADER_SLACK, `${name} ${start}-${end}`).toBe(false)
                }
            }
            expect(bursts).toEqual([3])
        })
    })

    test('(R) 60 stored entries of 40 KiB take at most three calls', async () => {
        const entries = entriesOf(60, 40 * KIB, 200)
        const bytes = upstreamArchive(entries)
        const subject = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(subject.file))
        const reads = validationReadsOf(subject.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
        expect(reads.length).toBeLessThanOrEqual(3)
    })

    test('(R) alternating small and big bodies cost no more calls than a source without a window, and never a wasted window', async () => {
        // the picked File's sizes at 1/64: window 8 MiB -> 128 KiB, gap 1 MiB -> 16 KiB, bodies 512 KiB / 9 MiB -> 8 KiB / 144 KiB
        const window = 128 * KIB
        const entries: Entry[] = [['card.json', CARD, 'store']]
        for (let i = 0; i < 12; i++) {
            entries.push([`assets/other/small${i}.bin`, random(8 * KIB, 300 + i), 'store'], [`assets/other/big${i}.bin`, random(144 * KIB, 400 + i), 'store'])
        }
        const bytes = upstreamArchive(entries)
        const windowed = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(windowed.file, window, 16 * KIB))
        const reads = validationReadsOf(windowed.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
        expect(reads.length).toBeLessThanOrEqual((await unplannedReadsOf(bytes)).length)
        expect(bytesRead(reads)).toBeLessThanOrEqual(2 * window)
    })

    test('(R) 4 bodies of 3 MiB: one small read per boundary, and no read spans a body', async () => {
        const bytes = upstreamArchive(entriesOf(4, 3 * MIB, 500))
        const subject = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(subject.file))
        const reads = validationReadsOf(subject.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(reads.length).toBe(5)
        for (const [start, end] of reads) {
            expect(end - start).toBeLessThan(3 * MIB)
        }
    })

    test('(G) bodies whose header is exactly the gap from the one before are read through together', async () => {
        const gap = 16 * KIB
        // the distance from one header\'s wanted end to the next header is the body plus the descriptor minus the slack
        const body = gap + HEADER_SLACK - 16
        const entries: Entry[] = [['card.json', cardOfLength(body), 'store'], ['assets/other/a.bin', random(body, 600), 'store'], ['assets/other/b.bin', random(body, 601), 'store']]
        const bytes = upstreamArchive(entries)
        const layout = layoutOf(bytes)
        expect(layout.entries[1].local - (layout.entries[0].local + 30 + layout.entries[0].nameLength + HEADER_SLACK)).toBe(gap)
        const subject = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(subject.file, 64 * KIB, gap))
        const reads = validationReadsOf(subject.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
        expect(reads.length).toBeLessThanOrEqual(2)
    })

    test('(R) local extras longer than the directory\'s do not carry a read through a body', async () => {
        const bodySize = 300 * KIB
        let bytes = upstreamArchive(entriesOf(4, bodySize, 700))
        for (let i = 1; i <= 4; i++) {
            bytes = withLocalExtra(bytes, i, 200)
        }
        const subject = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(subject.file, MIB, 16 * KIB))
        const reads = validationReadsOf(subject.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(4)
        expect(reads.length).toBeGreaterThan(0)
        for (const [start, end] of reads) {
            expect(end - start).toBeLessThanOrEqual(16 * KIB + 2 * 64 * KIB + HEADER_SLACK)
        }
    })

    // A short body ends within a read-ahead guess of the header before it: only a planned, exact descriptor read stays clear of the gap.
    test.each([
        [3, 2 * KIB],
        [7, 2 * KIB],
        [3, 40 * KIB],
        [7, 40 * KIB],
    ])('(G) an unlisted entry of %i MiB between listed bodies of %i bytes is not read, and the import is whole', async (orphanMiB, bodySize) => {
        const plain = upstreamArchive(entriesOf(5, bodySize, 800))
        const bytes = withSizedOrphan(plain, 3, orphanMiB * MIB)
        const subject = listedFile(bytes)

        const outcome = await runImport(importSourceOfFile(subject.file))
        const reads = validationReadsOf(subject.reads, bytes)

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(5)
        for (const [start, end] of reads) {
            expect(end - start).toBeLessThan(orphanMiB * MIB)
        }
        expect(reads.length).toBeLessThanOrEqual((await unplannedReadsOf(bytes)).length)
    })

    test('(N) validation builds one batch reader and its work grows with the ranges and the requests, not their product', async () => {
        const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 3000 }, (_, i): Entry => [`assets/other/tiny${i}.bin`, random(1024, 3000 + i), 'store'])]
        const bytes = upstreamArchive(entries)
        const subject = listedFile(bytes)
        const prototype = RangeBatchReader.prototype
        const original = prototype.read
        const readers = new Set<RangeBatchReader>()
        let requests = 0
        prototype.read = function (this: RangeBatchReader, start: number, end: number) {
            readers.add(this)
            requests++
            return original.call(this, start, end)
        }
        let outcome: Outcome
        try {
            outcome = await runImport(importSourceOfFile(subject.file, 64 * KIB, 16 * KIB))
        } finally {
            prototype.read = original
        }

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
        // the entry count of the fixture: one range per header, and the last entry's descriptor
        const ranges = entries.length + 1
        expect(requests).toBeGreaterThanOrEqual(entries.length)
        expect(readers.size).toBe(1)
        const [reader] = [...readers]
        expect(reader.steps).toBeGreaterThan(0)
        expect(reader.steps).toBeLessThanOrEqual(4 * (ranges + requests))
        // dozens of 64 KiB batches over about 3 MiB of headers and bodies
        expect(subject.counters.slicesAtStream).not.toBeNull()
        expect(subject.counters.slicesAtStream).toBeGreaterThanOrEqual(20)
        expect(RangeBatchReader.prototype.read).toBe(original)
    })
    /** The File as a source whose `read` and `readRanges` are recorded: the ranges of each `readRanges` call and each `read`. */
    function recordedSource(base: ImportSource) {
        const baseReadRanges = base.readRanges
        if (baseReadRanges === undefined) {
            throw new Error('a picked File carries readRanges')
        }
        const rangeBatches: Array<Array<[number, number]>> = []
        const reads: Array<[number, number]> = []
        const source: ImportSource = {
            ...base,
            read: async (start, end) => { reads.push([start, end]); return await base.read(start, end) },
            readRanges: async (ranges) => { rangeBatches.push(ranges.map(([start, end]): [number, number] => [start, end])); return await baseReadRanges(ranges) },
        }
        return { source, rangeBatches, reads }
    }

    const totalOf = (batch: Array<[number, number]>) => batch.reduce((total, [start, end]) => total + (end - start), 0)

    describe('batches of segments', () => {
        const WINDOW = 128 * KIB
        const GAP = 16 * KIB
        const bodies = (count: number, size: number, seed: number): Entry[] => [['card.json', CARD, 'store'], ...Array.from({ length: count }, (_, i): Entry => [`assets/other/body${i}.bin`, random(size, seed + i), 'store'])]

        test('(N) a batch that comes back one byte short is dropped, the rest of validation reads exactly, and the import is whole', async () => {
            const entries = bodies(100, 64 * KIB, 5000)
            const bytes = upstreamArchive(entries)
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file, WINDOW, GAP))
            const source: ImportSource = { ...recorded.source, readRanges: async (ranges) => {
                const parts = await recorded.source.readRanges!(ranges)
                parts[parts.length - 1] = parts[parts.length - 1].subarray(0, parts[parts.length - 1].length - 1)
                return parts
            } }

            const outcome = await runImport(source)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(100)
            expect(importedWhole(outcome, 'assets/other/body40.bin', entries[41][1])).toBe(true)
            expect(recorded.rangeBatches).toHaveLength(1)
            // every request after the short batch is its own exact read
            expect(validationReadsOf(recorded.reads, bytes).length).toBeGreaterThan(90)
        })

        test('(N) a batch that rejects is an input failure with its own message, and nothing is saved', async () => {
            const bytes = upstreamArchive(bodies(100, 64 * KIB, 5200))
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file, WINDOW, GAP))
            const source: ImportSource = { ...recorded.source, readRanges: async () => { throw new Error('the picker went away') } }

            const outcome = await runImport(source)

            expect(originOf(outcome)).toBe('input')
            expect((outcome.failure as Error).message).toBe('the picker went away')
            expect(h.saved.size).toBe(0)
        })

        test('(N) no read of the plan is over the window: 300 entries with names of 1 KiB', async () => {
            const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 300 }, (_, i): Entry => [`assets/other/${String(i).padStart(4, '0')}${'n'.repeat(1020)}.bin`, random(1024, 5400 + i), 'store'])]
            const bytes = upstreamArchive(entries)
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file, WINDOW, GAP))

            const outcome = await runImport(recorded.source)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(300)
            const sizes = [...recorded.rangeBatches.map(totalOf), ...validationReadsOf(recorded.reads, bytes).map(([start, end]) => end - start)]
            expect(sizes.length).toBeGreaterThanOrEqual(3)
            for (const size of sizes) {
                expect(size).toBeLessThanOrEqual(WINDOW)
            }
            expect(subject.counters.slicesAtStream).toBeGreaterThanOrEqual(3)
        })

        test('(N) a batch holds at most RANGE_BATCH_MAX_RANGES ranges: 600 segments (the card joins the first body) are 256, 256 and 88', async () => {
            const bytes = upstreamArchive(bodies(599, 20 * KIB, 5800))
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file, 8 * MIB, 0))

            const outcome = await runImport(recorded.source)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(599)
            expect(recorded.rangeBatches.map(batch => batch.length)).toEqual([RANGE_BATCH_MAX_RANGES, RANGE_BATCH_MAX_RANGES, 88])
        }, 30_000)

        test.each([16 * KIB, 0])('(G) 3000 entries of 16-byte bodies, whose header ranges overlap, are read in batches of at most the window (gap %i)', async (gap) => {
            const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 3000 }, (_, i): Entry => [`assets/other/t${i}.bin`, random(16, 6000 + i), 'store'])]
            const bytes = upstreamArchive(entries)
            let recorded: ReturnType<typeof recordedSource> | undefined

            const { outcome, calls } = await importCounted(bytes, file => {
                recorded = recordedSource(importSourceOfFile(file, 64 * KIB, gap))
                return recorded.source
            })

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(3000)
            for (const batch of recorded?.rangeBatches ?? []) {
                expect(totalOf(batch)).toBeLessThanOrEqual(64 * KIB)
            }
            for (const length of calls) {
                expect(length).toBeLessThanOrEqual(64 * KIB)
            }
        }, 30_000)

        test('(G) four entries with names longer than the window are read exactly, in no batch over the window, and the import is whole', async () => {
            const entries: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 4 }, (_, i): Entry => [`assets/other/${i}${'n'.repeat(4090)}.bin`, random(2 * KIB, 6400 + i), 'store'])]
            const bytes = upstreamArchive(entries)
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file, 4 * KIB, KIB))

            const outcome = await runImport(recorded.source)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(4)
            for (const batch of recorded.rangeBatches) {
                expect(totalOf(batch)).toBeLessThanOrEqual(4 * KIB)
            }
        })

        test('(N) an unlisted entry of 3 MiB between two listed bodies costs one batch and one exact read', async () => {
            const plain = upstreamArchive(entriesOf(5, 2 * KIB, 6800))
            const bytes = withSizedOrphan(plain, 3, 3 * MIB)
            const subject = listedFile(bytes)
            const recorded = recordedSource(importSourceOfFile(subject.file))

            const outcome = await runImport(recorded.source)

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(5)
            expect(recorded.rangeBatches).toHaveLength(1)
            expect(validationReadsOf(recorded.reads, bytes)).toHaveLength(1)
        })
    })

    describe('a batched picked File reaches the batch path on the fixtures of the decision rows', () => {
        const countPlusOne = (bytes: Uint8Array) => patched(bytes, (view, layout) => {
            view.setUint16(layout.endRecord + 8, view.getUint16(layout.endRecord + 8, true) + 1, true)
            view.setUint16(layout.endRecord + 10, view.getUint16(layout.endRecord + 10, true) + 1, true)
        })
        // 'reach': validation asked for a batch of at least two ranges. 'refused': the directory was refused before planning, so no batch.
        const FIXTURES: Array<[string, () => Uint8Array, 'reach' | 'refused']> = [
            ['a stored asset with signatures', () => standardArchive('store'), 'reach'],
            ['a deflate-0 asset with signatures', () => standardArchive('deflate-0'), 'reach'],
            ['a JPEG prefix', () => standardArchive('store', BLOB_ASSET, JPEG_PREFIX), 'reach'],
            ['12-byte descriptors', () => withShortDescriptors(standardArchive('store')), 'reach'],
            ['a long local extra', () => withLocalExtra(standardArchive('store'), 1, 200), 'reach'],
            ['an unlisted entry between listed ones', () => withOrphan(standardArchive('store'), 'between'), 'reach'],
            ['the clean twin of the overlap case', () => nestedArchive(false).bytes, 'reach'],
            ['a central compressed size off by one', () => damagedArchive('store', damagesFor(8)[0][1]), 'reach'],
            ['an entry count one too high', () => countPlusOne(standardArchive('store')), 'refused'],
        ]

        test.each(FIXTURES)('(N) %s', async (_label, build, category) => {
            const outcome = await runImport(makeInput('batched-file', build(), 0))

            expect(originOf(outcome)).not.toBe('input')
            if (category === 'reach') {
                expect(rangeCalls.length).toBeGreaterThanOrEqual(1)
                expect(rangeCalls.every(ranges => ranges.length >= 2)).toBe(true)
            } else {
                expect(rangeCalls).toHaveLength(0)
            }
        })
    })
    describe('across several windows', () => {
        // Bodies no larger than the gap, so the planner runs through them and validation reads whole windows.
        const WINDOW = 64 * KIB
        const GAP = 16 * KIB
        const entries = entriesOf(40, 4 * KIB, 1000)
        const bytes = upstreamArchive(entries)
        const layout = layoutOf(bytes)

        /** A validation read longer than this covers more than one header and its neighbours: a window fill. */
        const WINDOW_FILL = 8 * KIB

        function windowFillsOf(reads: Array<[number, number]>): Array<[number, number]> {
            return validationReadsOf(reads, bytes).filter(([start, end]) => end - start > WINDOW_FILL)
        }

        /** The first entry whose local header lies strictly inside a window fill, not at its start. */
        function entryInsideWindow(fills: Array<[number, number]>): number {
            return layout.entries.findIndex(entry => fills.some(([start, end]) => entry.local > start && entry.local + 30 + entry.nameLength <= end))
        }

        /** An import of the archive that makes the windows form; the fills it made are what the rows below aim at. */
        async function plainImport() {
            const subject = listedFile(bytes)
            const outcome = await runImport(importSourceOfFile(subject.file, WINDOW, GAP))
            return { subject, outcome, fills: windowFillsOf(subject.reads) }
        }

        test('(R) the windows form: validation reads more than one header at a time, in several windows, and no window exceeds W', async () => {
            const { subject, fills } = await plainImport()

            expect(fills.length).toBeGreaterThan(1)
            expect(validationReadsOf(subject.reads, bytes).length).toBeLessThan(entries.length / 2)
            for (const [start, end] of fills) {
                expect(end - start).toBeLessThanOrEqual(WINDOW)
            }
            expect(entryInsideWindow(fills)).toBeGreaterThan(0)
        })

        test('(R) a File of small bodies in several windows imports whole', async () => {
            const { outcome, fills } = await plainImport()

            expect(fills.length).toBeGreaterThan(1)
            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(entries.length - 1)
            expect(importedWhole(outcome, 'assets/other/body20.bin', entries[21][1])).toBe(true)
        })

        test('(G) a File of 12 MB at the default sizes imports whole in several windows', async () => {
            const big = entriesOf(12, MIB, 1100)
            const archive = upstreamArchive(big)
            const subject = listedFile(archive)

            const outcome = await runImport(importSourceOfFile(subject.file))

            expect(originOf(outcome) ?? 'imported').toBe('imported')
            expect(Object.keys(outcome.importer.assets)).toHaveLength(12)
            expect(importedWhole(outcome, 'assets/other/body11.bin', big[12][1])).toBe(true)
            expect(validationReadsOf(subject.reads, archive).length).toBeGreaterThanOrEqual(2)
        })

        test('(G) a header served from inside a window that changed between validation and the splice is a ZIP failure', async () => {
            const { fills } = await plainImport()
            const inside = entryInsideWindow(fills)
            expect(inside).toBeGreaterThan(0)
            const changed = new Uint8Array(bytes)
            changed[layout.entries[inside].local + 10] ^= 1
            const subject = listedFile(bytes)
            const source: ImportSource = { ...importSourceOfFile(subject.file, WINDOW, GAP), stream: () => chunkedStream(changed, 64 * KIB) }

            const outcome = await runImport(source)

            expect(originOf(outcome)).toBe('zip')
        })

        test('(R) a window fill that rejects is an input failure, and nothing is saved, whichever window it is', async () => {
            const { fills } = await plainImport()
            expect(fills.length).toBeGreaterThan(1)
            for (let which = 0; which < fills.length; which++) {
                const subject = listedFile(bytes)
                const base = importSourceOfFile(subject.file, WINDOW, GAP)
                let fillsSeen = 0
                let rejected = false
                const source: ImportSource = { ...base, read: async (start, end) => {
                    if (windowFillsOf([[start, end]]).length === 1 && fillsSeen++ === which) {
                        rejected = true
                        throw new Error('the picker went away ' + which)
                    }
                    return base.read(start, end)
                } }
                h.saved.clear()

                const outcome = await runImport(source)

                expect(rejected).toBe(true)
                expect(originOf(outcome)).toBe('input')
                expect((outcome.failure as Error).message).toBe('the picker went away ' + which)
                expect(h.saved.size).toBe(0)
            }
        })
    })
})

describe('sources without a window are read as before', () => {
    // Read counts and bytes recorded before the window existed. A picked File's window must not reach other sources.
    const RECORDED = { sixtyBytes: [58, 339051], mixedBytes: [6, 817826], sixtyDesktop: [59, 59, 2805087] }
    const sixty: Entry[] = [['card.json', CARD, 'store'], ...Array.from({ length: 60 }, (_, i): Entry => [`assets/other/body${i}.bin`, random(40 * 1024, 200 + i), 'store'])]
    const mixed: Entry[] = [['card.json', CARD, 'deflate-6'], ...Array.from({ length: 90 }, (_, i): Entry => [`assets/other/mixed${i}.bin`, random(8 * 1024, 80 + i), i % 3 === 2 ? 'deflate-6' : 'store'])]

    async function bytesSourceReads(entries: Entry[]) {
        const bytes = upstreamArchive(entries)
        const reads: Array<[number, number]> = []
        const base = importSourceOfBytes('card.charx', bytes)
        const outcome = await runImport({ ...base, read: async (start, end) => { reads.push([start, end]); return base.read(start, end) }, stream: () => chunkedStream(bytes, 4096) })
        expect(originOf(outcome) ?? 'imported').toBe('imported')
        return reads
    }

    test('(G) a byte source reads 60 entries of 40 KiB as it did', async () => {
        const reads = await bytesSourceReads(sixty)
        expect([reads.length, reads.reduce((total, [start, end]) => total + (end - start), 0)]).toEqual(RECORDED.sixtyBytes)
    })

    test('(G) a byte source reads 90 entries of 8 KiB, every third deflated, as it did', async () => {
        const reads = await bytesSourceReads(mixed)
        expect([reads.length, reads.reduce((total, [start, end]) => total + (end - start), 0)]).toEqual(RECORDED.mixedBytes)
    })

    test('(G) a desktop source reads 60 entries of 40 KiB as it did, and carries no window', async () => {
        const bytes = upstreamArchive(sixty)
        h.desktop.file = bytes
        h.desktop.reads = 0
        h.desktop.seeks = 0
        h.desktop.bytes = 0
        const source = await openDesktopImportSource('/mods/card.charx')
        const outcome = await runImport(source)
        await source.close()

        expect(originOf(outcome) ?? 'imported').toBe('imported')
        expect(source.windowBytes).toBeUndefined()
        // the plugin bytes are the whole stream plus validation's reads
        expect([h.desktop.reads, h.desktop.seeks, h.desktop.bytes]).toEqual(RECORDED.sixtyDesktop)
    })
})

describe('read-ahead of the spliced stream', () => {
    const ASSET = random(20_000, 7)
    // zipSync states the sizes in the local headers and writes no descriptor, so both readers end the stored asset by its size.
    const bytes = fflate.zipSync({ 'card.json': [CARD, { level: 6 }], [SIG_NAME]: [ASSET, { level: 0 }], [SMALL_NAME]: [SMALL_ASSET, { level: 6 }] })

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
