/**
 * Assembler of an `.rtb` v1 file: it takes the parts a caller has already gathered
 * (store2 frames, assets, inlays, side records, omissions) and writes the container.
 * It reads no store and touches no platform API; every byte goes to the injected sink.
 *
 * Local order (A1.2): `mimetype`, `u/`, `s/`, `i/`, `a/`, `manifest.json`, then the
 * central directory (the manifest record first) and the end records. The manifest is
 * last because `omitted` and the row counts are final only then. Row counts are taken
 * from what was written, not from what was offered.
 *
 * Names are unique by construction (counters, the injective asset and inlay name
 * encodings, caller-deduplicated sets). A duplicate the caller still supplies is caught
 * before the directory is written: the directory is walked by the product reader and any
 * finding fails the export, so a file its own reader would refuse is never finished.
 * Likewise a manifest above the size cap is never written.
 */
import { defaultKeyEnv, randomId26, type KeyEnv } from '../../storage/store2/format/keys'
import { FRAME_FMT } from '../../storage/store2/format/versions'
import type { InlayRecord } from '../../process/files/inlayStore'
import { assetEntryName } from './assetName'
import { MANIFEST_ENTRY, MIMETYPE_ENTRY, SETTINGS_DATA_ENTRY, SETTINGS_ID, SETTINGS_PREFIX, SIDE_SECTION_IDS, sideDataName } from './entryNames'
import { checkEntryPath } from './entryPath'
import { encodeInlayMeta, inlayEntryNames, RtbInlayNameError } from './inlayEntries'
import { DEFAULT_MANIFEST_CAP, type OmittedEntry } from './manifest'
import { RtbCouldNotReadError, type RangeSource } from './rangeSource'
import { checkRefs, checkReqTokens, normalizeRefs } from './refsFingerprint'
import { encodeSideLine, type SideTagRegistry } from './sideLines'
import { RTB_MIMETYPE } from './sniff'
import { groupBlocks, type BlockUnit } from './unitBlocks'
import { readDirectory } from './zip64Reader'
import { buildEndRecords } from './zip64Format'
import { DEFAULT_BUFFER_LIMIT, Zip64Writer, type ZipDirectoryView, type ZipPiece, type ZipSink } from './zip64Writer'

/** Longest entry name writer v1 emits; a longer one sends its item to `omitted` with reason `name`. */
export const MAX_WRITE_NAME_BYTES = 1024
/** Writer v1 keeps at most this many ancestors in `snapshot.lineage`, newest first. */
export const MAX_WRITE_LINEAGE = 32

export interface AssetInput {
    /** The store key without its `assets/` prefix. */
    key: string
    /** Exact body length; a body of another length fails the export. */
    size: number
    body: AsyncIterable<ZipPiece>
}

export interface InlayInput {
    id: string
    record: InlayRecord
    /** Exactly `record.len` bytes. */
    body: AsyncIterable<ZipPiece>
}

export interface SideRecord {
    key: string
    value: unknown
}

/** A side store: its records, or a mark that it could not be read (its section is then left out and named in `omitted`). */
export type SideInput =
    | { unreadable: true }
    | { records: AsyncIterable<SideRecord> }

export interface Store2Input {
    units: AsyncIterable<BlockUnit>
    /** The `[tail, bytes, crc]` of the root manifest unit. */
    root: readonly [string, number, number]
    /** The `req` tokens, a copy of the root manifest unit's. */
    req: readonly string[]
    /** The `<type>:<path>` strings of the refs-table rows the closure walk yielded; written sorted and without repeats. */
    refs: readonly string[]
}

/** What the walk learned once the last unit was handed over; see `Store2DeferredInput`. */
export interface Store2Summary {
    root: readonly [string, number, number]
    req: readonly string[]
    refs: readonly string[]
    /** Must equal the number of units the writer itself counted. */
    units: number
    omitted: readonly OmittedEntry[]
}

/**
 * Store2 input whose root, `req`, refs and omissions are known only after the units were
 * produced. `summary` is called exactly once, after the last unit and before the first
 * `s/` entry, so its values are final when the store2 row is written.
 */
export interface Store2DeferredInput {
    units: AsyncIterable<BlockUnit>
    summary: () => Store2Summary
}

export interface RtbSource {
    device: { label: string, platform: string }
    committedAt: number
    unsavedExcluded: boolean
}

/**
 * Called exactly once, when the manifest is built, after every section was written. Its `source` replaces the
 * input's, and its `omitted` follows the input's and the store2 summary's and precedes the writer's own.
 */
export type RtbLate = () => { source: RtbSource, omitted: readonly OmittedEntry[] }

interface RtbWriteBase {
    sink: ZipSink
    writer: { app: string, version: string, build: string }
    snapshot?: { parent: string | null, lineage: readonly string[] }
    /** Milliseconds; read once, at the start of the export. */
    clock?: () => number
    keyEnv?: KeyEnv
    store2: Store2Input | Store2DeferredInput
    assets?: AsyncIterable<AssetInput>
    inlays?: AsyncIterable<InlayInput>
    /** By section id (`side.iris` ...); an id that is absent is an empty store. */
    sides?: Readonly<Record<string, SideInput>>
    sideTags?: SideTagRegistry
    /** Omissions the caller already decided; the writer appends its own after them. */
    omitted?: readonly OmittedEntry[]
    bufferLimit?: number
    manifestCap?: number
    m6ZeroLocalSizes?: boolean
}

/** The source is required, unless `late` supplies it when the manifest is built. */
export type RtbWriteInput = RtbWriteBase & (
    | { source: RtbSource, late?: RtbLate }
    | { source?: RtbSource, late: RtbLate }
)

export interface WrittenRow {
    id: string
    v: 1
    required: boolean
    prefix: string
    entries: number
    bytes: number
    meta?: Record<string, unknown>
}

export interface WrittenManifest {
    rtb: 1
    writer: RtbWriteInput['writer']
    createdAt: number
    snapshot: { id: string, parent: string | null, lineage: string[] }
    source: RtbSource
    sections: WrittenRow[]
    omitted: OmittedEntry[]
}

export interface RtbWriteResult {
    manifest: WrittenManifest
    snapshotId: string
    createdAt: number
    /** Uncompressed manifest size. */
    manifestBytes: number
    /** Bytes sent to the sink. */
    length: number
}

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

/** Hands the pieces on and adds their lengths to `tally`, so a count is what was really written. */
async function* counted(pieces: AsyncIterable<ZipPiece>, tally: { length: number }): AsyncGenerator<ZipPiece> {
    for await (const piece of pieces) {
        tally.length += piece.length
        yield piece
    }
}

function nameProblem(name: string): boolean {
    return name.length > MAX_WRITE_NAME_BYTES || checkEntryPath(encoder.encode(name)) !== null
}

/**
 * A read-only view of the file as it will be once the directory and end records are
 * written. Only the directory and the end records are real; the bytes before them are
 * zeros, which the directory walk never inspects.
 */
function finishedTail(directory: ZipDirectoryView): RangeSource {
    const directoryEnd = directory.directoryOffset + directory.directorySize
    const end = buildEndRecords(directory.count, directory.directorySize, directory.directoryOffset, directoryEnd)
    const size = directoryEnd + end.length
    const pieces: { start: number, bytes: Uint8Array }[] = []
    let at = directory.directoryOffset
    for (const chunk of directory.chunks) {
        pieces.push({ start: at, bytes: chunk })
        at += chunk.length
    }
    pieces.push({ start: directoryEnd, bytes: end })
    return {
        size,
        async read(offset: number, length: number): Promise<Uint8Array> {
            if (offset < 0 || length < 0 || offset + length > size) {
                throw new RtbCouldNotReadError(`self-check read of ${length} bytes at ${offset} is outside the file`, offset, length)
            }
            const out = new Uint8Array(length)
            for (const piece of pieces) {
                const from = Math.max(offset, piece.start)
                const to = Math.min(offset + length, piece.start + piece.bytes.length)
                if (from < to) {
                    out.set(piece.bytes.subarray(from - piece.start, to - piece.start), from - offset)
                }
            }
            return out
        },
    }
}

async function selfCheck(directory: ZipDirectoryView): Promise<void> {
    const walk = await readDirectory(finishedTail(directory))
    if (walk.findings.length > 0 || !walk.index) {
        const first = walk.findings[0]
        const text = first ? `${first.code}${first.name === null ? '' : ` (${first.name})`}: ${first.detail}` : 'no index'
        throw new Error(`the central directory fails its own reader: ${text}`)
    }
    if (walk.index.count !== directory.count) {
        throw new Error(`the central directory holds ${walk.index.count} records, ${directory.count} were written`)
    }
}

/** The sorted, de-duplicated refs; an unknown ref or `req` token fails the export. */
function checkedRefs(rawRefs: readonly string[], req: readonly string[]): string[] {
    const refs = normalizeRefs(rawRefs)
    const refsCheck = checkRefs(refs)
    if (refsCheck.kind !== 'ok') {
        throw new RangeError(refsCheck.kind === 'damaged' ? refsCheck.reason : `meta.refs holds strings this build does not know: ${refsCheck.refs.join(', ')}`)
    }
    const reqCheck = checkReqTokens(req)
    if (reqCheck.kind !== 'ok') {
        throw new RangeError(reqCheck.kind === 'damaged' ? reqCheck.reason : `req holds tokens this build does not know: ${reqCheck.tokens.join(', ')}`)
    }
    return refs
}

async function writeSideSection(zip: Zip64Writer, name: string, records: AsyncIterable<SideRecord>, registry: SideTagRegistry, limit: number): Promise<number> {
    const iterator = records[Symbol.asyncIterator]()
    const held: Uint8Array[] = []
    let heldBytes = 0
    let exhausted = false
    let spill = false
    try {
        while (!spill) {
            const next = await iterator.next()
            if (next.done) {
                exhausted = true
                break
            }
            const line = encodeSideLine(next.value.key, next.value.value, registry)
            held.push(line)
            heldBytes += line.length
            spill = heldBytes > limit
        }
        if (!spill) {
            const joined = concat(held)
            await zip.addBuffered(name, 8, joined, joined.length)
            return joined.length
        }
        let written = 0
        const lines = async function* (): AsyncGenerator<Uint8Array> {
            for (const line of held) {
                written += line.length
                yield line
            }
            for (;;) {
                const next = await iterator.next()
                if (next.done) {
                    exhausted = true
                    return
                }
                const line = encodeSideLine(next.value.key, next.value.value, registry)
                written += line.length
                yield line
            }
        }
        await zip.addStreamed(name, 8, lines(), null)
        return written
    } finally {
        if (!exhausted) {
            await iterator.return?.()
        }
    }
}

export async function writeRtb(input: RtbWriteInput): Promise<RtbWriteResult> {
    const createdAt = (input.clock ?? Date.now)()
    const snapshotId = randomId26(input.keyEnv ?? defaultKeyEnv)
    const store2 = input.store2
    const eager = 'root' in store2 ? store2 : null
    const eagerRefs = eager ? checkedRefs(eager.refs, eager.req) : null
    const sides = input.sides ?? {}
    for (const id of Object.keys(sides)) {
        if (!SIDE_SECTION_IDS.includes(id)) {
            throw new RangeError(`${id} is not a side section of version 1`)
        }
    }

    const limit = input.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    const zip = new Zip64Writer({ sink: input.sink, createdAt, bufferLimit: input.bufferLimit, m6ZeroLocalSizes: input.m6ZeroLocalSizes })
    const own: OmittedEntry[] = []
    const rows: WrittenRow[] = []

    const mime = encoder.encode(RTB_MIMETYPE)
    await zip.addBuffered(MIMETYPE_ENTRY, 0, mime, mime.length)

    let blockEntries = 0
    let blockBytes = 0
    let unitCount = 0
    for await (const block of groupBlocks(store2.units)) {
        await zip.addBuffered(block.name, 8, block.bytes, block.bytes.length)
        blockEntries++
        blockBytes += block.bytes.length
        unitCount += block.units
    }
    let summaryOmitted: readonly OmittedEntry[] = []
    let storeMeta: { root: readonly [string, number, number], req: readonly string[], refs: readonly string[] }
    if (eager && eagerRefs) {
        storeMeta = { root: eager.root, req: eager.req, refs: eagerRefs }
    } else if ('summary' in store2) {
        const summary = store2.summary()
        const refs = checkedRefs(summary.refs, summary.req)
        if (summary.units !== unitCount) {
            throw new RangeError(`the summary counts ${summary.units} units, ${unitCount} were written`)
        }
        summaryOmitted = summary.omitted
        storeMeta = { root: summary.root, req: summary.req, refs }
    } else {
        throw new RangeError('store2 input has neither a root nor a summary')
    }
    rows.push({
        id: 'store2',
        v: 1,
        required: true,
        prefix: 'u/',
        entries: blockEntries,
        bytes: blockBytes,
        meta: { root: [...storeMeta.root], req: [...storeMeta.req], frameFmt: FRAME_FMT, units: unitCount, refs: storeMeta.refs },
    })

    const sideRows: WrittenRow[] = []
    for (const id of SIDE_SECTION_IDS) {
        const side = sides[id]
        if (side && 'unreadable' in side) {
            own.push({ kind: 'side', name: id, reason: 'unreadable' })
            continue
        }
        const name = sideDataName(id) as string
        let bytes: number
        if (side !== undefined && 'records' in side) {
            bytes = await writeSideSection(zip, name, side.records, input.sideTags ?? [], limit)
        } else {
            await zip.addBuffered(name, 8, EMPTY, 0)
            bytes = 0
        }
        sideRows.push({ id, v: 1, required: false, prefix: name.slice(0, name.lastIndexOf('/') + 1), entries: 1, bytes })
    }

    let inlayEntries = 0
    let inlayBytes = 0
    for await (const inlay of input.inlays ?? []) {
        const meta = encodeInlayMeta(inlay.id, inlay.record)
        let names: { metaName: string, bodyName: string } | null
        try {
            names = inlayEntryNames(inlay.id)
        } catch (error) {
            if (!(error instanceof RtbInlayNameError)) {
                throw error
            }
            names = null
        }
        if (names === null || nameProblem(names.metaName) || nameProblem(names.bodyName)) {
            own.push({ kind: 'inlay', name: inlay.id, reason: 'name' })
            continue
        }
        await zip.addBuffered(names.metaName, 8, meta, meta.length)
        const tally = { length: 0 }
        await zip.addStreamed(names.bodyName, 0, counted(inlay.body, tally), inlay.record.len)
        inlayEntries += 2
        inlayBytes += meta.length + tally.length
    }

    let assetEntries = 0
    let assetBytes = 0
    for await (const asset of input.assets ?? []) {
        let name: string | null
        try {
            name = assetEntryName(asset.key)
        } catch {
            name = null
        }
        if (name === null || nameProblem(name)) {
            own.push({ kind: 'asset', name: asset.key, reason: 'name' })
            continue
        }
        const tally = { length: 0 }
        await zip.addStreamed(name, 0, counted(asset.body, tally), asset.size)
        assetEntries++
        assetBytes += tally.length
    }

    rows.push(
        { id: 'assets', v: 1, required: true, prefix: 'a/', entries: assetEntries, bytes: assetBytes },
        { id: 'inlays', v: 1, required: true, prefix: 'i/', entries: inlayEntries, bytes: inlayBytes },
        ...sideRows,
    )

    const late = input.late?.()
    const source = late ? late.source : input.source
    if (!source) {
        throw new RangeError('the input names no source')
    }
    const omitted: OmittedEntry[] = [...(input.omitted ?? []), ...summaryOmitted, ...(late?.omitted ?? []), ...own]
    return finishWithManifest(zip, {
        writer: input.writer,
        createdAt,
        snapshotId,
        snapshot: input.snapshot,
        source,
        rows,
        omitted,
        manifestCap: input.manifestCap,
    })
}

/** The manifest, the central directory and the end records: the tail every writer of a file shares. */
async function finishWithManifest(zip: Zip64Writer, parts: {
    writer: RtbWriteInput['writer']
    createdAt: number
    snapshotId: string
    snapshot: RtbWriteInput['snapshot']
    source: RtbSource
    rows: WrittenRow[]
    omitted: OmittedEntry[]
    manifestCap: number | undefined
}): Promise<RtbWriteResult> {
    const manifest: WrittenManifest = {
        rtb: 1,
        writer: parts.writer,
        createdAt: parts.createdAt,
        snapshot: {
            id: parts.snapshotId,
            parent: parts.snapshot?.parent ?? null,
            lineage: (parts.snapshot?.lineage ?? []).slice(0, MAX_WRITE_LINEAGE),
        },
        source: parts.source,
        sections: parts.rows,
        omitted: parts.omitted,
    }
    const manifestBytes = encoder.encode(JSON.stringify(manifest))
    const cap = parts.manifestCap ?? DEFAULT_MANIFEST_CAP
    if (manifestBytes.length > cap) {
        throw new RangeError(`the manifest is ${manifestBytes.length} bytes, over the ${cap} byte limit`)
    }
    await zip.addBuffered(MANIFEST_ENTRY, 8, manifestBytes, manifestBytes.length)
    await zip.finish({ firstCentral: MANIFEST_ENTRY, validate: selfCheck })
    return { manifest, snapshotId: parts.snapshotId, createdAt: parts.createdAt, manifestBytes: manifestBytes.length, length: zip.position }
}

export interface SettingsWriteInput {
    sink: ZipSink
    writer: RtbWriteInput['writer']
    /** Milliseconds; read once, at the start of the export. */
    clock?: () => number
    keyEnv?: KeyEnv
    /** The carried settings, one record per key, written in the order given. */
    settings: AsyncIterable<SideRecord> | Iterable<SideRecord>
    /** The `side.ui-prefs` records; the row is written only when this is given. */
    uiPrefs?: AsyncIterable<SideRecord> | Iterable<SideRecord>
    source: RtbSource
    bufferLimit?: number
    manifestCap?: number
}

async function* asAsync<T>(items: AsyncIterable<T> | Iterable<T>): AsyncGenerator<T> {
    yield* items
}

/**
 * Writes a settings-only file: `mimetype`, `settings/data.jsonl`, the optional `s/ui-prefs/data.jsonl`, then the
 * manifest. Its section table holds the reserved `settings` row and no store2, assets or inlays row, so a reader
 * that does not know the row refuses the file as damaged before it writes anything.
 */
export async function writeSettingsRtb(input: SettingsWriteInput): Promise<RtbWriteResult> {
    const createdAt = (input.clock ?? Date.now)()
    const snapshotId = randomId26(input.keyEnv ?? defaultKeyEnv)
    const limit = input.bufferLimit ?? DEFAULT_BUFFER_LIMIT
    const zip = new Zip64Writer({ sink: input.sink, createdAt, bufferLimit: input.bufferLimit })
    const rows: WrittenRow[] = []

    const mime = encoder.encode(RTB_MIMETYPE)
    await zip.addBuffered(MIMETYPE_ENTRY, 0, mime, mime.length)

    const settingsBytes = await writeSideSection(zip, SETTINGS_DATA_ENTRY, asAsync(input.settings), [], limit)
    rows.push({ id: SETTINGS_ID, v: 1, required: true, prefix: SETTINGS_PREFIX, entries: 1, bytes: settingsBytes })

    if (input.uiPrefs !== undefined) {
        const name = sideDataName('side.ui-prefs') as string
        const bytes = await writeSideSection(zip, name, asAsync(input.uiPrefs), [], limit)
        rows.push({ id: 'side.ui-prefs', v: 1, required: false, prefix: name.slice(0, name.lastIndexOf('/') + 1), entries: 1, bytes })
    }

    return finishWithManifest(zip, {
        writer: input.writer,
        createdAt,
        snapshotId,
        snapshot: undefined,
        source: input.source,
        rows,
        omitted: [],
        manifestCap: input.manifestCap,
    })
}
