import { describe, test, expect } from 'vitest'
import { RtbCouldNotReadError, rangeSourceFrom, type RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { V1_REF_STRINGS } from 'src/ts/drive/rtb/refsFingerprint'
import { classifyRtb, type RtbClassification } from 'src/ts/drive/rtb/rtbClassify'
import { RTB_MIMETYPE } from 'src/ts/drive/rtb/sniff'
import { Zip64Writer } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'
import { bytesSource, parseZip } from './zipTestParser'

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const encoder = new TextEncoder()
const ID_A = 'a'.repeat(26)

interface Entry {
    name: string
    body: string
    method?: 0 | 8
}

interface RowDef {
    id: string
    v?: number
    required?: boolean
    prefix: string
    meta?: Record<string, unknown>
}

type Json = Record<string, unknown>

function standardEntries(): Entry[] {
    return [
        { name: 'u/2/0.blk', body: 'block-two', method: 8 },
        { name: 'u/3/0.blk', body: 'block-three', method: 8 },
        { name: 'a/%46oo.png', body: 'png-bytes', method: 0 },
        { name: 'i/inlay-1.meta', body: '{"v":1}', method: 8 },
        { name: 'i/inlay-1.body', body: 'inlay-body', method: 0 },
        { name: 's/iris/data.jsonl', body: '{"k":"a","j":1}\n', method: 8 },
        { name: 'x/unknown/one', body: 'unknown-entry', method: 0 },
    ]
}

function standardDefs(): RowDef[] {
    return [
        { id: 'store2', prefix: 'u/', required: true, meta: { req: ['chat-alt'], refs: [...V1_REF_STRINGS], root: ['t', 1, 2], frameFmt: 1, units: 2 } },
        { id: 'assets', prefix: 'a/', required: true },
        { id: 'inlays', prefix: 'i/', required: true },
        { id: 'side.iris', prefix: 's/iris/' },
        { id: 'x-test.unknown', prefix: 'x/unknown/' },
    ]
}

interface FileOptions {
    entries?: Entry[]
    defs?: RowDef[]
    /** Applied to the rows after their counts are computed from the entries. */
    rows?: (rows: Json[]) => Json[]
    manifest?: (manifest: Json) => Json
    manifestBytes?: Uint8Array
}

async function buildFile(options: FileOptions = {}): Promise<Uint8Array> {
    const entries = options.entries ?? standardEntries()
    const defs = options.defs ?? standardDefs()
    const computed: Json[] = defs.map((def) => {
        const own = entries.filter((entry) => entry.name.startsWith(def.prefix))
        return {
            id: def.id,
            v: def.v ?? 1,
            required: def.required ?? false,
            prefix: def.prefix,
            entries: own.length,
            bytes: own.reduce((sum, entry) => sum + encoder.encode(entry.body).length, 0),
            ...(def.meta ? { meta: def.meta } : {}),
        }
    })
    const rows = options.rows ? options.rows(computed) : computed
    let manifest: Json = {
        rtb: 1,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        createdAt: 1700000000000,
        snapshot: { id: ID_A, parent: null, lineage: [] },
        source: { device: { label: 'pc', platform: 'web' }, committedAt: 1699999999000, unsavedExcluded: false },
        sections: rows,
        omitted: [],
    }
    if (options.manifest) {
        manifest = options.manifest(manifest)
    }
    const manifestBody = options.manifestBytes ?? encoder.encode(JSON.stringify(manifest))
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: 1024 })
    const mime = encoder.encode(RTB_MIMETYPE)
    await writer.addBuffered('mimetype', 0, mime, mime.length)
    for (const entry of entries) {
        const body = encoder.encode(entry.body)
        await writer.addBuffered(entry.name, entry.method ?? 0, body, body.length)
    }
    await writer.addBuffered('manifest.json', 8, manifestBody, manifestBody.length)
    await writer.finish({ firstCentral: 'manifest.json' })
    return sink.toBytes()
}

interface Layout {
    zip: ReturnType<typeof parseZip>
    starts: number[]
    directoryOffset: number
}

function layout(bytes: Uint8Array): Layout {
    const zip = parseZip(bytesSource(bytes))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const starts: number[] = []
    let at = zip.end.zip64End.directoryOffset
    for (let i = 0; i < zip.entries.length; i++) {
        starts.push(at)
        at += 46 + dv.getUint16(at + 28, true) + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true)
    }
    return { zip, starts, directoryOffset: zip.end.zip64End.directoryOffset }
}

function centralStart(l: Layout, name: string): number {
    const i = l.zip.entries.findIndex((entry) => entry.name === name)
    if (i < 0) {
        throw new Error(`no entry ${name}`)
    }
    return l.starts[i]
}

function localStart(l: Layout, name: string): number {
    const entry = l.zip.entries.find((candidate) => candidate.name === name)
    if (!entry) {
        throw new Error(`no entry ${name}`)
    }
    return entry.offset
}

function patched(bytes: Uint8Array, change: (dv: DataView, l: Layout) => void): Uint8Array {
    const l = layout(bytes)
    const copy = bytes.slice()
    change(new DataView(copy.buffer), l)
    return copy
}

function setMethod(dv: DataView, l: Layout, name: string, method: number, where: 'both' | 'central' = 'both'): void {
    dv.setUint16(centralStart(l, name) + 10, method, true)
    if (where === 'both') {
        dv.setUint16(localStart(l, name) + 8, method, true)
    }
}

function renameCentral(dv: DataView, l: Layout, from: string, to: string): void {
    if (from.length !== to.length) {
        throw new Error('a renamed central record keeps its name length')
    }
    const at = centralStart(l, from) + 46
    const bytes = encoder.encode(to)
    for (let i = 0; i < bytes.length; i++) {
        dv.setUint8(at + i, bytes[i])
    }
}

async function classify(bytes: Uint8Array, options?: { manifestCap?: number }): Promise<RtbClassification> {
    return classifyRtb(rangeSourceOfBytes(bytes), options)
}

function kindOf(result: RtbClassification): string {
    return result.kind
}

describe('a clean version 1 file', () => {
    test('is ok, with the parsed manifest, rows and index, and the unknown optional row in the notice', async () => {
        const result = await classify(await buildFile())
        expect(kindOf(result)).toBe('ok')
        if (result.kind !== 'ok') {
            return
        }
        expect(result.manifest.rtb).toBe(1)
        expect(result.rows.map((row) => row.id)).toEqual(['store2', 'assets', 'inlays', 'side.iris', 'x-test.unknown'])
        expect(result.index.count).toBe(1 + standardEntries().length + 1)
        expect(result.notice).toEqual({ unknownOptionalRows: [{ id: 'x-test.unknown', v: 1 }], outsideEntryCount: 0 })
    })
})

describe('the container and the prefix come first', () => {
    test('a file that is not an rtb', async () => {
        expect(kindOf(await classify(new Uint8Array(200).fill(0x41)))).toBe('not-an-rtb')
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: CREATED })
        await writer.addBuffered('other.txt', 0, encoder.encode('x'), 1)
        await writer.finish({})
        expect(kindOf(await classify(sink.toBytes()))).toBe('not-an-rtb')
    })

    test('RTBX with the full magic is newer, and the envelope version is reported', async () => {
        const bytes = new Uint8Array(100)
        bytes.set([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 0x03, 0x00])
        expect(await classify(bytes)).toEqual({ kind: 'newer', reason: { why: 'sealed', envelopeVersion: 3 } })
    })

    test('RTBX with another rest of the magic is damaged', async () => {
        const bytes = new Uint8Array(100)
        bytes.set([0x52, 0x54, 0x42, 0x58, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00])
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('a file whose end records are gone is damaged', async () => {
        const bytes = await buildFile()
        expect(kindOf(await classify(bytes.slice(0, bytes.length - 30)))).toBe('damaged')
    })

    test('a read that fails or comes back short is could-not-read, never damaged', async () => {
        const bytes = await buildFile()
        const failing: RangeSource = {
            size: bytes.length,
            read: async (offset, length) => {
                throw new RtbCouldNotReadError('gone', offset, length)
            },
        }
        expect(kindOf(await classifyRtb(failing))).toBe('could-not-read')
        const short = rangeSourceFrom({
            size: bytes.length,
            read: async (start, end) => bytes.subarray(start, Math.max(start, end - 1)),
        })
        expect(kindOf(await classifyRtb(short))).toBe('could-not-read')
    })
})

describe('T4 / T5lib / T6 / T14 the version rule from the manifest alone', () => {
    test('an unknown required row is newer and names the row', async () => {
        const bytes = await buildFile({
            entries: [...standardEntries(), { name: 'q/thing', body: 'q' }],
            defs: [...standardDefs(), { id: 'x-test.req', prefix: 'q/', required: true }],
        })
        expect(await classify(bytes)).toEqual({ kind: 'newer', reason: { why: 'required-row', id: 'x-test.req', v: 1 } })
    })

    test('an unknown required row plus a non-canonical u/ name in store2 v 1 is still newer', async () => {
        const entries = standardEntries().map((entry) => (entry.name === 'u/2/0.blk' ? { ...entry, name: 'u/2/00.blk' } : entry))
        const bytes = await buildFile({
            entries: [...entries, { name: 'q/thing', body: 'q' }],
            defs: [...standardDefs(), { id: 'x-test.req', prefix: 'q/', required: true }],
        })
        expect(kindOf(await classify(bytes))).toBe('newer')
    })

    test('an unknown optional row is ok, unread and named in the notice, even with a wrong CRC', async () => {
        const bytes = patched(await buildFile(), (dv, l) => {
            const at = centralStart(l, 'x/unknown/one')
            dv.setUint32(at + 16, dv.getUint32(at + 16, true) ^ 0xFFFF, true)
        })
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('ok')
        expect(result.kind === 'ok' && result.notice.unknownOptionalRows.map((row) => row.id)).toEqual(['x-test.unknown'])
    })

    test('side.iris at v 2 is an unknown optional row: ok, with a name outside the v1 grammar and a method 93 entry', async () => {
        const entries = standardEntries().map((entry) => (entry.name === 's/iris/data.jsonl' ? { ...entry, name: 's/iris/data.v2' } : entry))
        const defs = standardDefs().map((def) => (def.id === 'side.iris' ? { ...def, v: 2 } : def))
        const bytes = patched(await buildFile({ entries, defs }), (dv, l) => setMethod(dv, l, 's/iris/data.v2', 93))
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('ok')
        expect(result.kind === 'ok' && result.notice.unknownOptionalRows).toEqual([{ id: 'side.iris', v: 2 }, { id: 'x-test.unknown', v: 1 }])
    })

    test('store2 at v 2 is newer, also with names outside the v1 grammar under u/', async () => {
        const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, v: 2 } : def))
        const plain = await buildFile({ defs })
        expect(await classify(plain)).toEqual({ kind: 'newer', reason: { why: 'required-row', id: 'store2', v: 2 } })
        const entries = standardEntries().map((entry) => (entry.name === 'u/2/0.blk' ? { ...entry, name: 'u/2/0.blk2' } : entry))
        expect(kindOf(await classify(await buildFile({ defs, entries })))).toBe('newer')
    })

    test('a req token outside the known set is newer and is named', async () => {
        const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, meta: { ...def.meta, req: ['chat-alt', 'future-token'] } } : def))
        expect(await classify(await buildFile({ defs }))).toEqual({ kind: 'newer', reason: { why: 'req', tokens: ['future-token'] } })
    })

    test('a refs string the table lacks is newer and is named, also with a non-canonical name in a known section', async () => {
        const refs = [...V1_REF_STRINGS, '99:fixed.future']
        const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, meta: { ...def.meta, refs } } : def))
        expect(await classify(await buildFile({ defs }))).toEqual({ kind: 'newer', reason: { why: 'refs', refs: ['99:fixed.future'] } })
        const entries = standardEntries().map((entry) => (entry.name === 'u/2/0.blk' ? { ...entry, name: 'u/2/00.blk' } : entry))
        expect(kindOf(await classify(await buildFile({ defs, entries })))).toBe('newer')
    })

    test('a malformed refs string is damaged, even beside an unknown required row', async () => {
        const defs: RowDef[] = standardDefs().map((def) => (def.id === 'store2' ? { ...def, meta: { ...def.meta, refs: ['02:fixed.config'] } } : def))
        const bytes = await buildFile({
            entries: [...standardEntries(), { name: 'q/thing', body: 'q' }],
            defs: [...defs, { id: 'x-test.req', prefix: 'q/', required: true }],
        })
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('a count mismatch is damaged even beside an unknown required row', async () => {
        const bytes = await buildFile({
            entries: [...standardEntries(), { name: 'q/thing', body: 'q' }],
            defs: [...standardDefs(), { id: 'x-test.req', prefix: 'q/', required: true }],
            rows: (rows) => rows.map((row) => (row.id === 'assets' ? { ...row, entries: 5 } : row)),
        })
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('a missing reserved row is damaged', async () => {
        const missing = await buildFile({ defs: standardDefs().filter((def) => def.id !== 'inlays') })
        expect(kindOf(await classify(missing))).toBe('damaged')
    })

    test('a req value that is not a list of strings is damaged, even beside an unknown required row', async () => {
        for (const req of ['chat-alt', [1], null]) {
            const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, meta: { ...def.meta, req } } : def))
            expect(kindOf(await classify(await buildFile({ defs }))), JSON.stringify(req)).toBe('damaged')
            const bytes = await buildFile({
                entries: [...standardEntries(), { name: 'q/thing', body: 'q' }],
                defs: [...defs, { id: 'x-test.req', prefix: 'q/', required: true }],
            })
            expect(kindOf(await classify(bytes)), JSON.stringify(req)).toBe('damaged')
        }
    })

    test('the meta of a store2 row at a higher v belongs to that row and is not checked', async () => {
        const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, v: 2, meta: { req: 'not a list', refs: ['02:x', 7] } } : def))
        expect(await classify(await buildFile({ defs }))).toEqual({ kind: 'newer', reason: { why: 'required-row', id: 'store2', v: 2 } })
    })

    test('absent req and refs on the store2 row are accepted', async () => {
        const defs = standardDefs().map((def) => (def.id === 'store2' ? { ...def, meta: undefined } : def))
        expect(kindOf(await classify(await buildFile({ defs })))).toBe('ok')
    })
})

describe('T-rtb the manifest decides rtb before anything else', () => {
    test('rtb 2 with an otherwise unreadable manifest is newer', async () => {
        const bytes = await buildFile({ manifestBytes: encoder.encode(JSON.stringify({ rtb: 2, sections: 'x', writer: 5 })) })
        expect(await classify(bytes)).toEqual({ kind: 'newer', reason: { why: 'rtb', rtb: 2 } })
    })

    test.each([0, -1, 1.5, '1'])('rtb %j is damaged', async (rtb) => {
        const bytes = await buildFile({ manifest: (manifest) => ({ ...manifest, rtb }) })
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('a manifest over the cap is damaged whatever its rtb', async () => {
        const bytes = await buildFile({ manifest: (manifest) => ({ ...manifest, rtb: 2 }) })
        const size = layout(bytes).zip.entries.find((entry) => entry.name === 'manifest.json')!.uncompressedSize
        expect(kindOf(await classify(bytes, { manifestCap: size }))).toBe('newer')
        expect(kindOf(await classify(bytes, { manifestCap: size - 1 }))).toBe('damaged')
        const plain = await buildFile()
        const plainSize = layout(plain).zip.entries.find((entry) => entry.name === 'manifest.json')!.uncompressedSize
        expect(kindOf(await classify(plain, { manifestCap: plainSize }))).toBe('ok')
        expect(kindOf(await classify(plain, { manifestCap: plainSize - 1 }))).toBe('damaged')
    })
})

describe('T-rtbo precedence between a container finding and the version number', () => {
    const newerManifest = (manifest: Json): Json => ({ ...manifest, rtb: 2 })

    test('rtb 2 and an entry with method 12: newer', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => setMethod(dv, l, 'u/2/0.blk', 12))
        expect(await classify(bytes)).toEqual({ kind: 'newer', reason: { why: 'rtb', rtb: 2 } })
    })

    test('rtb 2 and a duplicate name other than the manifest: newer', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => renameCentral(dv, l, 'u/3/0.blk', 'u/2/0.blk'))
        expect(await classify(bytes)).toEqual({ kind: 'newer', reason: { why: 'rtb', rtb: 2 } })
    })

    test('rtb 2, a container finding and a wrong manifest CRC: damaged', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => {
            setMethod(dv, l, 'u/2/0.blk', 12)
            const at = centralStart(l, 'manifest.json')
            dv.setUint32(at + 16, dv.getUint32(at + 16, true) ^ 1, true)
        })
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('damaged')
        expect(result.kind === 'damaged' && result.reason).toMatch(/method/)
    })

    test('rtb 1 and a container finding: damaged, naming the first finding', async () => {
        const bytes = patched(await buildFile(), (dv, l) => setMethod(dv, l, 'u/2/0.blk', 12))
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('damaged')
        expect(result.kind === 'damaged' && result.reason).toMatch(/method/)
    })

    test('rtb 2, a container finding and two records named manifest.json: damaged', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => renameCentral(dv, l, 'x/unknown/one', 'manifest.json'))
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('rtb 2, a container finding and no manifest.json record: damaged', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => {
            renameCentral(dv, l, 'manifest.json', 'manifestXjson')
            setMethod(dv, l, 'u/2/0.blk', 12)
        })
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })

    test('rtb 2, a container finding and a manifest over the cap: damaged', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => setMethod(dv, l, 'u/2/0.blk', 12))
        expect(kindOf(await classify(bytes, { manifestCap: 10 }))).toBe('damaged')
    })

    test('a short read while the manifest is probed is could-not-read, not damaged', async () => {
        const bytes = patched(await buildFile({ manifest: newerManifest }), (dv, l) => setMethod(dv, l, 'u/2/0.blk', 12))
        const l = layout(bytes)
        const from = localStart(l, 'manifest.json')
        const inner = rangeSourceOfBytes(bytes)
        const source: RangeSource = {
            size: inner.size,
            read: async (offset, length) => {
                if (offset >= from && offset < l.directoryOffset) {
                    throw new RtbCouldNotReadError('cut', offset, length)
                }
                return inner.read(offset, length)
            },
        }
        expect(kindOf(await classifyRtb(source))).toBe('could-not-read')
    })

    test('the probe does not accept a file: a manifest with rtb 1 and a container finding stays damaged', async () => {
        const bytes = patched(await buildFile(), (dv, l) => renameCentral(dv, l, 'u/3/0.blk', 'u/2/0.blk'))
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })
})

describe('T-m93 / T-canon / T-outside entries of the known rows', () => {
    test('method 93 in a known section is damaged, in an unknown optional row it is accepted', async () => {
        const known = patched(await buildFile(), (dv, l) => setMethod(dv, l, 'u/2/0.blk', 93))
        expect(kindOf(await classify(known))).toBe('damaged')
        const unknown = patched(await buildFile(), (dv, l) => setMethod(dv, l, 'x/unknown/one', 93))
        expect(kindOf(await classify(unknown))).toBe('ok')
    })

    test.each([
        ['a store block with a leading zero', 'u/2/0.blk', 'u/2/00.blk'],
        ['a store block with type 256', 'u/2/0.blk', 'u/256/0.blk'],
        ['an asset with an upper-case letter', 'a/%46oo.png', 'a/Foo.png'],
        ['an asset with a bad escape', 'a/%46oo.png', 'a/%4'],
        ['an asset with a lower-case escape', 'a/%46oo.png', 'a/%66oo'],
        ['an inlay with a dot in the id part', 'i/inlay-1.meta', 'i/in.lay.meta'],
        ['an inlay that is neither meta nor body', 'i/inlay-1.meta', 'i/inlay-1.json'],
        ['a side entry that is not data.jsonl', 's/iris/data.jsonl', 's/iris/other.txt'],
    ])('%s is damaged', async (_label, from, to) => {
        const entries = standardEntries().map((entry) => (entry.name === from ? { ...entry, name: to } : entry))
        expect(kindOf(await classify(await buildFile({ entries })))).toBe('damaged')
    })

    test('a name under an unknown optional row is not held to a canonical form', async () => {
        const entries = standardEntries().map((entry) => (entry.name === 'x/unknown/one' ? { ...entry, name: 'x/unknown/Any Thing.v9' } : entry))
        expect(kindOf(await classify(await buildFile({ entries })))).toBe('ok')
    })

    test('a name outside every prefix is ignored and counted; mimetype and manifest.json are not outside', async () => {
        const entries = [...standardEntries(), { name: 'readme.txt', body: 'r' }, { name: 'extra/more.txt', body: 'm' }]
        const result = await classify(await buildFile({ entries }))
        expect(kindOf(result)).toBe('ok')
        expect(result.kind === 'ok' && result.notice.outsideEntryCount).toBe(2)
    })

    test('a non-ASCII name outside every prefix is damaged', async () => {
        const entries = [...standardEntries(), { name: 'café.txt', body: 'r' }]
        expect(kindOf(await classify(await buildFile({ entries })))).toBe('damaged')
    })
})

describe('T15 / T-se counts at file level', () => {
    test('a count that is off by one, for a known or an unknown row, is damaged', async () => {
        for (const id of ['store2', 'x-test.unknown', 'side.iris']) {
            const bytes = await buildFile({ rows: (rows) => rows.map((row) => (row.id === id ? { ...row, entries: (row.entries as number) + 1 } : row)) })
            expect(kindOf(await classify(bytes)), id).toBe('damaged')
            const bytesBytes = await buildFile({ rows: (rows) => rows.map((row) => (row.id === id ? { ...row, bytes: (row.bytes as number) - 1 } : row)) })
            expect(kindOf(await classify(bytesBytes)), id).toBe('damaged')
        }
    })

    test('a side row with entries 0 and no entry is present-empty, and so is one 0-byte data.jsonl', async () => {
        const without = standardEntries().filter((entry) => entry.name !== 's/iris/data.jsonl')
        expect(kindOf(await classify(await buildFile({ entries: without })))).toBe('ok')
        const empty = standardEntries().map((entry) => (entry.name === 's/iris/data.jsonl' ? { ...entry, body: '' } : entry))
        expect(kindOf(await classify(await buildFile({ entries: empty })))).toBe('ok')
    })
})

describe('T12m / T-canon seeds of golden 2 at file level', () => {
    test('unknown fields, an x-test platform, x-test omitted entries and an unknown optional row are accepted', async () => {
        const bytes = await buildFile({
            manifest: (manifest) => ({
                ...manifest,
                extraTop: [1],
                writer: { app: 'x', version: '1', build: 'b', extra: 1 },
                source: { device: { label: 'pc', platform: 'x-test', extra: 1 }, committedAt: 1, unsavedExcluded: true, extra: 1 },
                omitted: [{ kind: 'x-test', name: 'thing', reason: 'x-test' }, { kind: 'unit', name: 'u-aaaa', reason: 'damaged', extra: 1 }],
            }),
            rows: (rows) => rows.map((row) => ({ ...row, extraField: true })),
        })
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('ok')
        expect(result.kind === 'ok' && result.manifest.omitted.length).toBe(2)
    })
})

describe('the exact entry extent is checked where the entry is not read later', () => {
    test('an overlap through the local extra length is damaged in an unknown optional row', async () => {
        const bytes = patched(await buildFile(), (dv, l) => {
            dv.setUint16(localStart(l, 'x/unknown/one') + 28, 500, true)
        })
        const result = await classify(bytes)
        expect(kindOf(result)).toBe('damaged')
    })

    test('the same patch on an a/ entry is not looked at here: assets are read in the copy step', async () => {
        const bytes = patched(await buildFile(), (dv, l) => {
            dv.setUint16(localStart(l, 'a/%46oo.png') + 28, 500, true)
        })
        expect(kindOf(await classify(bytes))).toBe('ok')
    })

    test('a local name that differs from its central record is damaged for an entry outside a/ and i/', async () => {
        const bytes = patched(await buildFile(), (dv, l) => {
            const at = localStart(l, 'u/3/0.blk') + 30
            dv.setUint8(at + 2, 0x39)
        })
        expect(kindOf(await classify(bytes))).toBe('damaged')
    })
})
