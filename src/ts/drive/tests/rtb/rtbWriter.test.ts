import { describe, test, expect } from 'vitest'
import { encodeFrame } from 'src/ts/storage/store2/format/frame'
import { KEY_ALPHABET, type KeyEnv } from 'src/ts/storage/store2/format/keys'
import { UNIT_TYPE } from 'src/ts/storage/store2/format/versions'
import type { InlayRecord } from 'src/ts/process/files/inlayStore'
import { decodeInlayMeta, pairInlayEntries } from 'src/ts/drive/rtb/inlayEntries'
import { parseManifest } from 'src/ts/drive/rtb/manifest'
import { V1_REF_STRINGS } from 'src/ts/drive/rtb/refsFingerprint'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { SIDE_SECTION_IDS, parseStoreBlockName } from 'src/ts/drive/rtb/entryNames'
import { writeRtb, type RtbWriteInput, type SideRecord } from 'src/ts/drive/rtb/rtbWriter'
import { decodeSideLines, type SideTagCodec } from 'src/ts/drive/rtb/sideLines'
import { decodeBlock } from 'src/ts/drive/rtb/unitBlocks'
import { readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import type { FillPiece } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'
import { bytesSource, parseZip } from './zipTestParser'

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const ENV: KeyEnv = { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + 5) & 255), now: () => CREATED }

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

async function* bodyOf(...parts: (string | Uint8Array | FillPiece)[]): AsyncGenerator<Uint8Array | FillPiece> {
    for (const part of parts) {
        yield typeof part === 'string' ? encoder.encode(part) : part
    }
}

async function* mustNotRun(): AsyncGenerator<Uint8Array> {
    throw new Error('the body of an omitted item was opened')
}

function baseInput(sink: SegmentSink, over: Partial<RtbWriteInput> = {}): RtbWriteInput {
    return {
        sink,
        clock: () => CREATED,
        keyEnv: ENV,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        source: { device: { label: 'pc', platform: 'web' }, committedAt: CREATED - 1000, unsavedExcluded: false },
        store2: { units: iterate([]), root: ['t0', 40, 7], req: [], refs: [] },
        ...over,
    }
}

async function write(over: Partial<RtbWriteInput> = {}): Promise<{ bytes: Uint8Array, sink: SegmentSink, result: Awaited<ReturnType<typeof writeRtb>> }> {
    const sink = new SegmentSink()
    const result = await writeRtb(baseInput(sink, over))
    return { bytes: sink.toBytes(), sink, result }
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

interface Opened {
    files: Map<string, Uint8Array>
    /** Entry names in local (offset) order. */
    localOrder: string[]
    /** Entry names in central order. */
    centralOrder: string[]
    methods: Map<string, number>
}

async function open(bytes: Uint8Array): Promise<Opened> {
    const source = rangeSourceOfBytes(bytes)
    const walk = await readDirectory(source)
    expect(walk.findings).toEqual([])
    const index = walk.index
    if (!index) {
        throw new Error('no index')
    }
    const files = new Map<string, Uint8Array>()
    const methods = new Map<string, number>()
    const centralOrder: string[] = []
    const offsets: { name: string, offset: number }[] = []
    for (let i = 0; i < index.count; i++) {
        const entry = index.entry(i)
        const parts: Uint8Array[] = []
        const read = await readEntry(source, index, i, (chunk) => {
            parts.push(chunk.slice())
        })
        expect(read.ok).toBe(true)
        files.set(entry.name, concat(parts))
        methods.set(entry.name, entry.method)
        centralOrder.push(entry.name)
        offsets.push({ name: entry.name, offset: entry.offset })
    }
    offsets.sort((a, b) => a.offset - b.offset)
    return { files, localOrder: offsets.map((o) => o.name), centralOrder, methods }
}

function manifestOf(opened: Opened): ReturnType<typeof JSON.parse> {
    return JSON.parse(decoder.decode(opened.files.get('manifest.json')))
}

function group(name: string): number {
    if (name === 'mimetype') {
        return 0
    }
    if (name === 'manifest.json') {
        return 5
    }
    const groups: Record<string, number> = { u: 1, s: 2, i: 3, a: 4 }
    return groups[name[0]] ?? -1
}

const F64: SideTagCodec = {
    tag: 'f64',
    encode: (value) => {
        if (typeof value !== 'number') {
            return null
        }
        const out = new Uint8Array(8)
        new DataView(out.buffer).setFloat64(0, value, true)
        return out
    },
    decode: (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true),
}

function inlayRecord(over: Partial<InlayRecord> = {}): InlayRecord {
    return { v: 1, repr: 'blob', mime: 'image/png', len: 8, body: 'inlays/b-x.0123456789abcdef', fields: { name: 'one.png' }, ...over }
}

function standardInput(): Partial<RtbWriteInput> {
    return {
        store2: {
            units: iterate([
                { tail: 'tail-a', frame: encodeFrame(UNIT_TYPE.shard, encoder.encode('shard-one')) },
                { tail: 'tail-b', frame: encodeFrame(UNIT_TYPE.lore, encoder.encode('lore-one')) },
                { tail: 'tail-c', frame: encodeFrame(UNIT_TYPE.shard, encoder.encode('shard-two')) },
            ]),
            root: ['tail-a', 41, 99],
            req: ['chat-alt'],
            refs: [...V1_REF_STRINGS].slice(0, 6),
        },
        assets: iterate([
            { key: 'Foo.png', size: 9, body: bodyOf('png-bytes') },
            { key: 'dir/x y', size: 3, body: bodyOf('abc') },
        ]),
        inlays: iterate([
            { id: 'inl-1', record: inlayRecord({ repr: 'blob', len: 8 }), body: bodyOf('body-one') },
            { id: 'inl-2', record: inlayRecord({ repr: 'string', mime: 'text/plain', len: 5, fields: { k: [1] } }), body: bodyOf('hello') },
            { id: 'inl-3', record: inlayRecord({ repr: 'string16', mime: 'text/plain', len: 4 }), body: bodyOf(Uint8Array.of(1, 0, 2, 0)) },
        ]),
        sides: {
            'side.iris': { records: iterate<SideRecord>([{ key: 'a', value: { x: 1 } }, { key: 'b', value: 'two' }]) },
            'side.google-search': { records: iterate<SideRecord>([{ key: 'neg', value: -0 }]) },
            'side.hypa-vector': { unreadable: true },
        },
        sideTags: [F64],
    }
}

describe('writeRtb with empty stores (T-asm, T40w, T10w, T-sew)', () => {
    test('the three reserved rows and the eight side sections are written, each side as one 0-byte deflated data.jsonl', async () => {
        const { bytes } = await write()
        const opened = await open(bytes)
        const manifest = manifestOf(opened)
        expect(manifest.sections.map((row: { id: string }) => row.id)).toEqual(['store2', 'assets', 'inlays', ...SIDE_SECTION_IDS])
        const byId = new Map<string, Record<string, unknown>>(manifest.sections.map((row: { id: string }) => [row.id, row]))
        for (const id of ['store2', 'assets', 'inlays']) {
            expect(byId.get(id)).toMatchObject({ v: 1, required: true, entries: 0, bytes: 0 })
        }
        for (const id of SIDE_SECTION_IDS) {
            expect(byId.get(id)).toMatchObject({ v: 1, required: false, entries: 1, bytes: 0, prefix: `s/${id.slice(5)}/` })
            const name = `s/${id.slice(5)}/data.jsonl`
            expect(opened.methods.get(name)).toBe(8)
            expect(opened.files.get(name)?.length).toBe(0)
        }
    })

    test('the file classifies ok with an empty notice', async () => {
        const { bytes } = await write()
        const classified = await classifyRtb(rangeSourceOfBytes(bytes))
        expect(classified.kind).toBe('ok')
        expect(classified.kind === 'ok' && classified.notice).toEqual({ unknownOptionalRows: [], outsideEntryCount: 0 })
    })

    test('the manifest parses with the reader and carries the injected clock, snapshot and source fields', async () => {
        const { bytes, result } = await write()
        const opened = await open(bytes)
        const parsed = parseManifest(opened.files.get('manifest.json') ?? new Uint8Array(0))
        expect(parsed.kind).toBe('ok')
        if (parsed.kind !== 'ok') {
            return
        }
        expect(parsed.manifest.rtb).toBe(1)
        expect(parsed.manifest.createdAt).toBe(CREATED)
        expect(parsed.manifest.snapshot.id).toMatch(new RegExp(`^[${KEY_ALPHABET}]{26}$`))
        expect(parsed.manifest.snapshot.id).toBe(result.snapshotId)
        expect(parsed.manifest.snapshot.parent).toBeNull()
        expect(parsed.manifest.snapshot.lineage).toEqual([])
        expect(parsed.manifest.source).toEqual({ device: { label: 'pc', platform: 'web' }, committedAt: CREATED - 1000, unsavedExcluded: false })
        expect(parsed.manifest.writer).toEqual({ app: 'risutanium', version: '1.0.0', build: 'test' })
        expect(parseZip(bytesSource(bytes)).entries[0].dosDate >> 9).toBe(2024 - 1980)
    })

    test('a lineage longer than 32 is cut to the 32 newest, and a parent is written', async () => {
        const ids = Array.from({ length: 40 }, (_, i) => `${KEY_ALPHABET[i % 32]}`.repeat(26))
        const { bytes } = await write({ snapshot: { parent: ids[0], lineage: ids } })
        const manifest = manifestOf(await open(bytes))
        expect(manifest.snapshot.parent).toBe(ids[0])
        expect(manifest.snapshot.lineage).toEqual(ids.slice(0, 32))
    })
})

describe('writeRtb with content (T-asm, T24w, T20, T-refsw)', () => {
    test('the local order is mimetype, u/, s/, i/, a/, manifest.json and the manifest is first in the central directory', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        expect(opened.localOrder[0]).toBe('mimetype')
        expect(opened.localOrder[opened.localOrder.length - 1]).toBe('manifest.json')
        const groups = opened.localOrder.map(group)
        expect(groups).toEqual([...groups].sort((a, b) => a - b))
        expect(groups).not.toContain(-1)
        expect(new Set(groups).size).toBe(6)
        expect(opened.centralOrder[0]).toBe('manifest.json')
    })

    test('methods: mimetype, a/ and i/*.body are stored; the manifest, u/, s/ and i/*.meta are deflated', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        for (const [name, method] of opened.methods) {
            const stored = name === 'mimetype' || name.startsWith('a/') || name.endsWith('.body')
            expect(method, name).toBe(stored ? 0 : 8)
        }
    })

    test('the file classifies ok and the manifest counts equal what is in the file', async () => {
        const { bytes } = await write(standardInput())
        const classified = await classifyRtb(rangeSourceOfBytes(bytes))
        expect(classified.kind).toBe('ok')
        const opened = await open(bytes)
        const manifest = manifestOf(opened)
        for (const row of manifest.sections as { prefix: string, entries: number, bytes: number }[]) {
            const own = [...opened.files].filter(([name]) => name.startsWith(row.prefix))
            expect(row.entries, row.prefix).toBe(own.length)
            expect(row.bytes, row.prefix).toBe(own.reduce((sum, [, data]) => sum + data.length, 0))
        }
    })

    test('store2: units are grouped by frame type into canonical blocks, and the row counts blocks and units', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        const names = [...opened.files.keys()].filter((name) => name.startsWith('u/'))
        expect(names.sort()).toEqual([`u/${UNIT_TYPE.shard}/0.blk`, `u/${UNIT_TYPE.lore}/0.blk`].sort())
        names.forEach((name) => expect(parseStoreBlockName(name)).not.toBeNull())
        const shard = decodeBlock(opened.files.get(`u/${UNIT_TYPE.shard}/0.blk`) ?? new Uint8Array(0))
        expect(shard.kind === 'ok' && shard.units.map((u) => u.tail)).toEqual(['tail-a', 'tail-c'])
        const manifest = manifestOf(opened)
        const store2 = manifest.sections.find((row: { id: string }) => row.id === 'store2')
        expect(store2.entries).toBe(2)
        expect(store2.meta).toEqual({
            root: ['tail-a', 41, 99],
            req: ['chat-alt'],
            frameFmt: 1,
            units: 3,
            refs: [...new Set([...V1_REF_STRINGS].slice(0, 6))].sort(),
        })
    })

    test('assets: a/ plus the escaped key, stored, with the bytes given', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        expect(decoder.decode(opened.files.get('a/%46oo.png'))).toBe('png-bytes')
        expect(decoder.decode(opened.files.get('a/dir%2Fx%20y'))).toBe('abc')
    })

    test('inlays: a deflated meta without body, a stored body, and the pair is canonical and sized', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        const infos = [...opened.files].filter(([name]) => name.startsWith('i/')).map(([name, data]) => ({ name, size: data.length }))
        const pairing = pairInlayEntries(infos)
        expect(pairing.kind).toBe('ok')
        if (pairing.kind !== 'ok') {
            return
        }
        expect(pairing.pairs.map((p) => p.id).sort()).toEqual(['inl-1', 'inl-2', 'inl-3'])
        const expected: Record<string, InlayRecord> = {
            'inl-1': inlayRecord({ repr: 'blob', len: 8 }),
            'inl-2': inlayRecord({ repr: 'string', mime: 'text/plain', len: 5, fields: { k: [1] } }),
            'inl-3': inlayRecord({ repr: 'string16', mime: 'text/plain', len: 4 }),
        }
        for (const pair of pairing.pairs) {
            const meta = decodeInlayMeta(opened.files.get(pair.metaName) ?? new Uint8Array(0), pair.bodySize)
            expect(meta.kind).toBe('ok')
            const want = expected[pair.id]
            expect(meta.kind === 'ok' && meta.meta).toEqual({ v: 1, repr: want.repr, mime: want.mime, len: want.len, fields: want.fields, unknown: {} })
        }
        expect(decoder.decode(opened.files.get('i/inl-1.body'))).toBe('body-one')
    })

    test('side sections: records are written as lines, an unreadable store is omitted with its row left out, the rest are empty', async () => {
        const { bytes } = await write(standardInput())
        const opened = await open(bytes)
        const manifest = manifestOf(opened)
        const ids = manifest.sections.map((row: { id: string }) => row.id)
        expect(ids).not.toContain('side.hypa-vector')
        expect(ids).toContain('side.ui-prefs')
        expect(manifest.omitted).toEqual([{ kind: 'side', name: 'side.hypa-vector', reason: 'unreadable' }])
        const iris = decodeSideLines(opened.files.get('s/iris/data.jsonl') ?? new Uint8Array(0), [F64])
        expect(iris.kind === 'ok' && iris.values).toEqual([{ key: 'a', value: { x: 1 } }, { key: 'b', value: 'two' }])
        const search = decodeSideLines(opened.files.get('s/google-search/data.jsonl') ?? new Uint8Array(0), [F64])
        expect(search.kind === 'ok' && Object.is(search.values[0].value, -0)).toBe(true)
        expect(opened.files.has('s/hypa-vector/data.jsonl')).toBe(false)
    })

    test('meta.refs is written sorted by the default string order and without repeats', async () => {
        const pool = V1_REF_STRINGS.filter((text) => text.startsWith('2:') || text.startsWith('10:') || text.startsWith('9:') || text.startsWith('15:'))
        expect(pool.length).toBeGreaterThan(3)
        const refs = [...pool].reverse().concat(pool[0], pool[1])
        const { bytes } = await write({ store2: { units: iterate([]), root: ['t', 1, 2], req: [], refs } })
        const written: string[] = manifestOf(await open(bytes)).sections[0].meta.refs
        expect(new Set(written)).toEqual(new Set(pool))
        expect(written.length).toBe(pool.length)
        for (let i = 1; i < written.length; i++) {
            expect(written[i - 1] < written[i]).toBe(true)
        }
        expect(written.indexOf(pool.find((t) => t.startsWith('10:')) as string)).toBeLessThan(written.indexOf(pool.find((t) => t.startsWith('2:')) as string))
    })

    test('a refs string that is malformed or that the table lacks, or an unknown req token, fails the export', async () => {
        for (const refs of [['02:x'], ['999:path'], ['9:no.such.path'], ['x']]) {
            await expect(write({ store2: { units: iterate([]), root: ['t', 1, 2], req: [], refs } })).rejects.toThrow()
        }
        await expect(write({ store2: { units: iterate([]), root: ['t', 1, 2], req: ['future-token'], refs: [] } })).rejects.toThrow()
    })
})

describe('writeRtb names and omissions (T24w)', () => {
    test('a name of 1,024 bytes is written and a name of 1,025 bytes goes to omitted with reason name', async () => {
        const fits = 'k'.repeat(1022)
        const tooLong = 'k'.repeat(1023)
        const { bytes } = await write({
            assets: iterate([
                { key: fits, size: 1, body: bodyOf('x') },
                { key: tooLong, size: 1, body: mustNotRun() },
                { key: 'ok', size: 1, body: bodyOf('y') },
            ]),
        })
        const opened = await open(bytes)
        expect(opened.files.has(`a/${fits}`)).toBe(true)
        expect(opened.files.has(`a/${tooLong}`)).toBe(false)
        const manifest = manifestOf(opened)
        expect(manifest.omitted).toEqual([{ kind: 'asset', name: tooLong, reason: 'name' }])
        expect(manifest.sections.find((row: { id: string }) => row.id === 'assets').entries).toBe(2)
        expect((await classifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('ok')
    })

    test('an inlay id with no store key and an asset key that is not well-formed text are omitted by name', async () => {
        const longId = 'x'.repeat(300)
        const { bytes } = await write({
            inlays: iterate([{ id: longId, record: inlayRecord(), body: mustNotRun() }]),
            assets: iterate([{ key: 'bad\uD800key', size: 1, body: mustNotRun() }, { key: '', size: 1, body: mustNotRun() }]),
        })
        const manifest = manifestOf(await open(bytes))
        expect(manifest.omitted).toEqual([
            { kind: 'inlay', name: longId, reason: 'name' },
            { kind: 'asset', name: 'bad\uD800key', reason: 'name' },
            { kind: 'asset', name: '', reason: 'name' },
        ])
        expect((await classifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('ok')
    })

    test('omitted entries from the caller come first, then the writer\'s, in the order met', async () => {
        const caller = [{ kind: 'unit', name: 'tail-x', reason: 'damaged' }]
        const { bytes } = await write({
            omitted: caller,
            sides: { 'side.iris': { unreadable: true } },
            assets: iterate([{ key: 'k'.repeat(2000), size: 1, body: mustNotRun() }]),
        })
        expect(manifestOf(await open(bytes)).omitted).toEqual([
            caller[0],
            { kind: 'side', name: 'side.iris', reason: 'unreadable' },
            { kind: 'asset', name: 'k'.repeat(2000), reason: 'name' },
        ])
    })
})

describe('writeRtb inlay record version (T20v)', () => {
    test('an input record carrying v 2 fails the export with an error naming its inlay id', async () => {
        const wrongVersion: number = 2
        const odd = { ...inlayRecord(), v: wrongVersion } as unknown as InlayRecord
        await expect(write({ inlays: iterate([{ id: 'the-odd-inlay', record: odd, body: bodyOf('body-one') }]) })).rejects.toThrow(/the-odd-inlay/)
    })

    test('a record with v 1 is written with meta v 1', async () => {
        const { bytes } = await write({ inlays: iterate([{ id: 'fine', record: inlayRecord(), body: bodyOf('body-one') }]) })
        const opened = await open(bytes)
        expect(JSON.parse(decoder.decode(opened.files.get('i/fine.meta'))).v).toBe(1)
    })

    test('a body that does not have the record\'s len fails the export, longer or shorter', async () => {
        await expect(write({ inlays: iterate([{ id: 'a', record: inlayRecord({ len: 8 }), body: bodyOf('body-one-and-more') }]) })).rejects.toThrow()
        await expect(write({ inlays: iterate([{ id: 'a', record: inlayRecord({ len: 8 }), body: bodyOf('short') }]) })).rejects.toThrow()
    })
})

describe('writeRtb self-check and caps (T-asm, T-mcap)', () => {
    test('a duplicate input fails at finish and no directory is written', async () => {
        const sink = new SegmentSink()
        await expect(writeRtb(baseInput(sink, {
            assets: iterate([{ key: 'dup', size: 1, body: bodyOf('a') }, { key: 'dup', size: 1, body: bodyOf('b') }]),
        }))).rejects.toThrow(/duplicate/)
        const tail = sink.length >= 22 ? sink.read(sink.length - 22, 4) : new Uint8Array(4)
        expect(Array.from(tail)).not.toEqual([0x50, 0x4B, 0x05, 0x06])
    })

    test('two inlays with one id fail at finish too', async () => {
        await expect(write({
            inlays: iterate([
                { id: 'same', record: inlayRecord(), body: bodyOf('body-one') },
                { id: 'same', record: inlayRecord(), body: bodyOf('body-one') },
            ]),
        })).rejects.toThrow(/duplicate/)
    })

    test('a manifest over the cap fails the export before the manifest or the directory is written', async () => {
        const first = await write()
        const exact = first.result.manifestBytes
        const ok = await write({ manifestCap: exact })
        expect(ok.result.manifestBytes).toBe(exact)

        const sink = new SegmentSink()
        await expect(writeRtb(baseInput(sink, { manifestCap: exact - 1 }))).rejects.toThrow(/manifest/)
        const everything = sink.toBytes()
        expect(decoder.decode(everything)).not.toContain('manifest.json')
        expect(Array.from(everything.subarray(everything.length - 22, everything.length - 18))).not.toEqual([0x50, 0x4B, 0x05, 0x06])
    })

    test('an omitted list that pushes the manifest over the cap fails the export', async () => {
        const omitted = Array.from({ length: 50 }, (_, i) => ({ kind: 'unit', name: `tail-${i}`, reason: 'damaged' }))
        await expect(write({ omitted, manifestCap: 1500 })).rejects.toThrow(/manifest/)
    })

    test('an unknown side id in the input is refused', async () => {
        await expect(write({ sides: { 'side.nope': { records: iterate<SideRecord>([]) } } })).rejects.toThrow()
    })

    test('a side value no codec can write fails the export and names the key', async () => {
        await expect(write({ sides: { 'side.iris': { records: iterate<SideRecord>([{ key: 'broken-key', value: undefined }]) } } })).rejects.toThrow(/broken-key/)
    })

    test('a unit tail used twice fails the export', async () => {
        const frame = encodeFrame(UNIT_TYPE.shard, encoder.encode('x'))
        await expect(write({ store2: { units: iterate([{ tail: 'same', frame }, { tail: 'same', frame }]), root: ['t', 1, 2], req: [], refs: [] } })).rejects.toThrow(/same/)
    })
})

describe('writeRtb entry forms', () => {
    test('a body above the buffer limit is a descriptor entry and a smaller one is not; the file still classifies ok', async () => {
        const big = 'z'.repeat(5000)
        const lines: SideRecord[] = Array.from({ length: 200 }, (_, i) => ({ key: `key-${i}`, value: { n: i, pad: 'p'.repeat(20) } }))
        const { bytes } = await write({
            bufferLimit: 1024,
            assets: iterate([{ key: 'big', size: big.length, body: bodyOf(big) }, { key: 'small', size: 3, body: bodyOf('abc') }]),
            sides: {
                'side.iris': { records: iterate(lines) },
                'side.ui-prefs': { records: iterate<SideRecord>([{ key: 'a', value: 1 }]) },
            },
        })
        const zip = parseZip(bytesSource(bytes))
        const flagsOf = (name: string) => zip.entries.find((entry) => entry.name === name)?.flags ?? -1
        expect(flagsOf('a/big') & 8).toBe(8)
        expect(flagsOf('a/small') & 8).toBe(0)
        expect(flagsOf('s/iris/data.jsonl') & 8).toBe(8)
        expect(flagsOf('s/ui-prefs/data.jsonl') & 8).toBe(0)
        const opened = await open(bytes)
        const iris = decodeSideLines(opened.files.get('s/iris/data.jsonl') ?? new Uint8Array(0), [])
        expect(iris.kind === 'ok' && iris.values.length).toBe(200)
        expect((await classifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('ok')
    })

    test('a side section above the buffer limit is written while its records are still being read', async () => {
        const events: string[] = []
        async function* records(): AsyncGenerator<SideRecord> {
            for (let i = 0; i < 100; i++) {
                events.push('pull')
                yield { key: `key-${i}`, value: { n: i, pad: 'p'.repeat(40) } }
            }
        }
        const sink = new SegmentSink()
        const watched = {
            write: (chunk: Uint8Array) => {
                events.push('write')
                sink.write(chunk)
            },
        }
        await writeRtb(baseInput(sink, { sink: watched, bufferLimit: 1024, sides: { 'side.iris': { records: records() } } }))
        const firstPull = events.indexOf('pull')
        const lastPull = events.lastIndexOf('pull')
        expect(events.slice(firstPull, lastPull).includes('write')).toBe(true)
    })

    test('the same input written twice gives the same bytes', async () => {
        const first = await write(standardInput())
        const second = await write(standardInput())
        expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes))
    })
})
