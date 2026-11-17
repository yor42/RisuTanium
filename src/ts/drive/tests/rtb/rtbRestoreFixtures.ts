/**
 * Fixtures of the `.rtb` restore front half (CHORE-128 S11). Files are written by the product's own `writeRtb` over stores
 * encoded by store2's real encoder (`rtbWorld`); a later writer's rows are made by re-packing a real file through the
 * product's `Zip64Writer`.
 *
 * Producer-built: the container (`Zip64Writer`), every v1 entry's bytes and the v1 manifest content.
 * Hand-made (the later writer): the rows `repackRtb` adds, their entries, a row's raised `v`, extra manifest fields, and the
 * planted frames a test passes in `replace`.
 */
import { crc32 } from 'src/ts/storage/blockFrame'
import { SegmentSink } from './segmentSink'
import { readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import { RtbCouldNotReadError, type RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { writeRtb, type AssetInput, type InlayInput, type RtbSource, type SideInput } from 'src/ts/drive/rtb/rtbWriter'
import type { OmittedEntry } from 'src/ts/drive/rtb/manifest'
import { Zip64Writer, type ZipMethod, type ZipPiece } from 'src/ts/drive/rtb/zip64Writer'
import type { InlayRecord } from 'src/ts/process/files/inlayStore'
import { readUnit, refOfFrame, tailOfKey, UNIT_TYPE, type KeyEnv, type Manifest } from 'src/ts/storage/store2/format'
import type { RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

/** What a file is written from: the units of a store by full key, its manifest key and the rows its references fill. */
export type WorldLike = Pick<RtbWorld, 'store' | 'manifestKey' | 'refsByRow'>
import { rangeSourceOfBytes } from './sparseSource'

export const FILE_CREATED = Date.UTC(2026, 10, 1, 12, 0, 0)
export const FILE_COMMITTED = FILE_CREATED - 60_000

const ENV: KeyEnv = { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255), now: () => FILE_CREATED }
const encoder = new TextEncoder()

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

async function* pieces(bytes: Uint8Array): AsyncGenerator<ZipPiece> {
    yield bytes
}

export interface InlayFixture {
    id: string
    record: InlayRecord
    body: Uint8Array
}

export function inlayFixture(id: string, body: string, over: Partial<InlayRecord> = {}): InlayFixture {
    const bytes = encoder.encode(body)
    return { id, record: { v: 1, repr: 'blob', mime: 'image/png', len: bytes.length, body: `inlay-body/${id}`, fields: { name: `${id}.png` }, ...over }, body: bytes }
}

export interface RtbBuild {
    world: WorldLike
    /** Planted frames by full store key; null leaves a unit out of the file's blocks. */
    replace?: ReadonlyMap<string, Uint8Array | null>
    /** Asset bodies by key without the `assets/` folder. */
    assets?: Readonly<Record<string, Uint8Array>>
    inlays?: readonly InlayFixture[]
    sides?: Readonly<Record<string, SideInput>>
    omitted?: readonly OmittedEntry[]
    source?: Partial<RtbSource>
    /** The export time the manifest states (milliseconds). */
    createdAt?: number
    /** Tests only: the `meta.root` the file states, in place of the manifest unit's own Ref. */
    metaRoot?: readonly [string, number, number]
    /** Tests only: the `meta.req` copy. */
    req?: readonly string[]
}

export interface BuiltFile {
    bytes: Uint8Array
    root: readonly [string, number, number]
    /** Every unit of the file by tail. */
    frames: ReadonlyMap<string, Uint8Array>
}

/** The unit frames of a world by tail, with `replace` applied. */
export function framesOfWorld(world: WorldLike, replace?: ReadonlyMap<string, Uint8Array | null>): Map<string, Uint8Array> {
    const frames = new Map<string, Uint8Array>()
    for (const [key, bytes] of world.store) {
        const planted = replace?.get(key)
        if (planted === null) {
            continue
        }
        frames.set(tailOfKey(key), planted ?? bytes)
    }
    for (const [key, bytes] of replace ?? []) {
        if (bytes !== null && !world.store.has(key)) {
            frames.set(tailOfKey(key), bytes)
        }
    }
    return frames
}

/** An `.rtb` file of the real writer over `world`. */
export async function writeRtbFile(build: RtbBuild): Promise<BuiltFile> {
    const { world } = build
    const frames = framesOfWorld(world, build.replace)
    const manifestFrame = build.replace?.get(world.manifestKey) ?? world.store.get(world.manifestKey)
    if (manifestFrame === undefined || manifestFrame === null) {
        throw new Error('the world has no manifest frame')
    }
    const parsed = readUnit(manifestFrame, UNIT_TYPE.manifest)
    const req = parsed.status === 'ok' || parsed.status === 'stale' ? (parsed.value.body as Manifest).req : []
    const own = refOfFrame(world.manifestKey, manifestFrame)
    const root: readonly [string, number, number] = build.metaRoot ?? [own[0], own[1], own[2]]
    const sink = new SegmentSink()
    const assets: AssetInput[] = Object.entries(build.assets ?? {}).map(([key, bytes]) => ({ key, size: bytes.length, body: pieces(bytes) }))
    const inlays: InlayInput[] = (build.inlays ?? []).map((inlay) => ({ id: inlay.id, record: inlay.record, body: pieces(inlay.body) }))
    await writeRtb({
        sink,
        clock: () => build.createdAt ?? FILE_CREATED,
        keyEnv: ENV,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        source: { device: { label: 'Test device', platform: 'web' }, committedAt: FILE_COMMITTED, unsavedExcluded: false, ...build.source },
        store2: {
            units: iterate([...frames].map(([tail, frame]) => ({ tail, frame }))),
            root,
            req: build.req ?? [...req].filter((token) => token !== 'x-test'),
            refs: [...world.refsByRow.keys()],
        },
        assets: iterate(assets),
        inlays: iterate(inlays),
        sides: build.sides,
        omitted: build.omitted,
    })
    return { bytes: sink.toBytes(), root, frames }
}

// ---- the later writer: re-packing a real file ----

interface Packed {
    name: string
    method: ZipMethod
    bytes: Uint8Array
}

export interface Amend {
    /** Edits the manifest object before it is written again; rows are given their `entries` and `bytes` by `rows`. */
    manifest?: (manifest: Record<string, unknown>) => void
    /** Extra entries by name; the row that owns them must exist in the manifest (`manifest` adds it). */
    add?: readonly { name: string, bytes: Uint8Array, method?: ZipMethod }[]
    /** Entries whose bytes are replaced, by name. */
    replace?: Readonly<Record<string, Uint8Array>>
    /** Entries left out, by name. */
    remove?: readonly string[]
}

/**
 * Re-emits every entry of a real file through the product's `Zip64Writer` (same names, methods and order, `mimetype` first,
 * the manifest record first in the central directory), applying `amend`. The re-written manifest's rows get their
 * `entries` and `bytes` recomputed from the entries under each row's prefix.
 */
export async function repackRtb(base: Uint8Array, amend: Amend): Promise<Uint8Array> {
    const source = rangeSourceOfBytes(base)
    const walk = await readDirectory(source)
    if (walk.findings.length > 0 || !walk.index) {
        throw new Error('the base file does not read')
    }
    const index = walk.index
    const packed: { entry: Packed, offset: number }[] = []
    for (let i = 0; i < index.count; i++) {
        const entry = index.entry(i)
        const parts: Uint8Array[] = []
        const read = await readEntry(source, index, i, (chunk) => { parts.push(chunk.slice()) })
        if (!read.ok) {
            throw new Error(`the entry ${entry.name} does not read`)
        }
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
        let at = 0
        for (const part of parts) {
            bytes.set(part, at)
            at += part.length
        }
        packed.push({ entry: { name: entry.name, method: entry.method === 0 ? 0 : 8, bytes }, offset: entry.offset })
    }
    const ordered = packed.sort((a, b) => a.offset - b.offset).map((item) => item.entry)
        .filter((item) => !(amend.remove ?? []).includes(item.name))
        .map((item) => amend.replace !== undefined && item.name in amend.replace ? { ...item, bytes: amend.replace[item.name] } : item)
    for (const extra of amend.add ?? []) {
        ordered.splice(ordered.length - 1, 0, { name: extra.name, method: extra.method ?? 8, bytes: extra.bytes })
    }
    const manifestAt = ordered.findIndex((item) => item.name === 'manifest.json')
    const manifest = JSON.parse(new TextDecoder().decode(ordered[manifestAt].bytes)) as Record<string, unknown>
    amend.manifest?.(manifest)
    const rows = manifest.sections as { prefix: string, entries: number, bytes: number }[]
    for (const row of rows) {
        const under = ordered.filter((item) => item.name.startsWith(row.prefix))
        row.entries = under.length
        row.bytes = under.reduce((sum, item) => sum + item.bytes.length, 0)
    }
    ordered[manifestAt] = { name: 'manifest.json', method: 8, bytes: encoder.encode(JSON.stringify(manifest)) }

    const sink = new SegmentSink()
    const zip = new Zip64Writer({ sink, createdAt: FILE_CREATED })
    for (const item of ordered) {
        await zip.addBuffered(item.name, item.method, item.bytes, item.bytes.length)
    }
    await zip.finish({ firstCentral: 'manifest.json' })
    return sink.toBytes()
}

/**
 * A valid frame of the same length whose payload differs: `change` edits a copy of the payload, and the frame's payload
 * checksum is written again, so the frame is internally sound and only its parent's Ref no longer matches.
 */
export function reframedPayload(frame: Uint8Array, change: (payload: Uint8Array) => void): Uint8Array {
    const out = frame.slice()
    const payload = out.subarray(16, out.length - 4)
    change(payload)
    setU32(out, out.length - 4, crc32(payload))
    return out
}

function u16(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8)
}

function setU32(bytes: Uint8Array, at: number, value: number): void {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(at, value >>> 0, true)
}

/** Where the entry `name` lives: its local header, its compressed data and its central record. */
async function locate(bytes: Uint8Array, name: string): Promise<{ local: number, dataStart: number, dataLength: number, central: number }> {
    const walk = await readDirectory(rangeSourceOfBytes(bytes))
    if (!walk.index) {
        throw new Error('the file does not read')
    }
    const found = walk.index.find(name)
    if (found.length !== 1) {
        throw new Error(`${name} is not exactly one entry`)
    }
    const entry = walk.index.entry(found[0])
    const dataStart = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28)
    let central = walk.index.directoryOffset
    for (let i = 0; i < walk.index.count; i++) {
        const nameLength = u16(bytes, central + 28)
        const label = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength))
        if (label === name) {
            return { local: entry.offset, dataStart, dataLength: entry.compressedSize, central }
        }
        central += 46 + nameLength + u16(bytes, central + 30) + u16(bytes, central + 32)
    }
    throw new Error(`${name} has no central record`)
}

/** A copy of the file whose entry `name` states another CRC-32 in its local and central records. */
export async function withBrokenCrc(bytes: Uint8Array, name: string): Promise<Uint8Array> {
    const out = bytes.slice()
    const where = await locate(out, name)
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    setU32(out, where.local + 14, view.getUint32(where.local + 14, true) ^ 0xA5A5A5A5)
    setU32(out, where.central + 16, view.getUint32(where.central + 16, true) ^ 0xA5A5A5A5)
    return out
}

/** A copy of the file with bytes inside the entry's compressed data overwritten; the sizes are kept. */
export async function withBrokenDeflate(bytes: Uint8Array, name: string): Promise<Uint8Array> {
    const out = bytes.slice()
    const where = await locate(out, name)
    for (let i = 0; i < Math.min(8, where.dataLength); i++) {
        out[where.dataStart + i] = 0xFF
    }
    return out
}

/** The byte range of an entry's data, for assertions about what was read. */
export async function dataRangeOf(bytes: Uint8Array, name: string): Promise<{ start: number, end: number }> {
    const where = await locate(bytes, name)
    return { start: where.dataStart, end: where.dataStart + where.dataLength }
}

export interface ReadLog {
    source: RangeSource
    reads: { offset: number, length: number }[]
}

/** A range source over `bytes` that logs every read and can fail a chosen one as the product source does. */
export function loggedSource(bytes: Uint8Array, failWhen: (offset: number, length: number) => boolean = () => false): ReadLog {
    const reads: { offset: number, length: number }[] = []
    const source: RangeSource = {
        size: bytes.length,
        async read(offset, length) {
            reads.push({ offset, length })
            if (failWhen(offset, length)) {
                throw new RtbCouldNotReadError(`injected short read of ${length} bytes at ${offset}`, offset, length)
            }
            return bytes.slice(offset, offset + length)
        },
    }
    return { source, reads }
}
