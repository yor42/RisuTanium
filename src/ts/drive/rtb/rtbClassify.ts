/**
 * Classifies an `.rtb` file from its prefix, central directory and manifest (A6.2, A7 V).
 *
 * The outcomes and their precedence, strongest first:
 * - could not read: any short or failed read, wherever it happens;
 * - not an `.rtb`, or sealed / `RTBX` (newer, or damaged for a broken magic);
 * - a central-level container finding: damaged, unless the manifest can still be read
 *   and says `rtb` above 1, which is newer. That probe never accepts a file. It runs
 *   only when exactly one walked central record is named `manifest.json`; the walk
 *   stops at the first record it cannot parse, and a file whose end records cannot be
 *   found has no manifest to probe, so both stay damaged;
 * - with a clean directory: `rtb` above 1 (newer) before any other manifest check;
 *   then manifest and section-table damage and counts; then the newer outcomes the
 *   manifest alone decides (unknown required row, `refs`, `req`); then in-section
 *   damage, which applies only to known rows and so never turns a newer file into a
 *   damaged one.
 * Units, asset bodies, inlay pairs and side lines are read by later callers.
 */
import { MANIFEST_NAME, DEFAULT_MANIFEST_CAP, parseManifest, peekNewerRtb, type RtbManifest } from './manifest'
import { RtbCouldNotReadError, type RangeSource } from './rangeSource'
import { checkRefs, checkReqTokens } from './refsFingerprint'
import {
    checkKnownSectionEntries,
    checkSectionCounts,
    countOutsideEntries,
    isKnownRow,
    parseSectionTable,
    unknownOptionalRows,
    unknownRequiredRow,
    type SectionRow,
} from './sections'
import { sniffRtb } from './sniff'
import { checkLocalHeaders, readDirectory, readEntry, type ContainerFinding, type DirectoryWalk, type ZipIndex } from './zip64Reader'

export interface RtbNotice {
    /** Optional rows this reader does not know; their entries are not restored. */
    unknownOptionalRows: { id: string, v: number }[]
    /** Entries outside every prefix, ignored and counted. */
    outsideEntryCount: number
}

export type NewerReason =
    | { why: 'rtb', rtb: number }
    | { why: 'sealed', envelopeVersion: number }
    | { why: 'required-row', id: string, v: number }
    | { why: 'refs', refs: string[] }
    | { why: 'req', tokens: string[] }

export type RtbClassification =
    | { kind: 'ok', manifest: RtbManifest, rows: SectionRow[], index: ZipIndex, notice: RtbNotice }
    | { kind: 'newer', reason: NewerReason }
    | { kind: 'damaged', reason: string }
    | { kind: 'not-an-rtb' }
    | { kind: 'could-not-read', message: string }

export interface ClassifyOptions {
    /** Largest manifest, in uncompressed bytes, that is read at all. */
    manifestCap?: number
}

function damaged(reason: string): RtbClassification {
    return { kind: 'damaged', reason }
}

function findingReason(finding: ContainerFinding): string {
    return `container: ${finding.code}${finding.name === null ? '' : ` (${finding.name})`}: ${finding.detail}`
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

type ManifestBytes = { ok: true, bytes: Uint8Array } | { ok: false, reason: string }

/** The inflated, CRC-checked bytes of the one `manifest.json` record, or why they could not be had. */
async function readManifestBytes(source: RangeSource, index: ZipIndex, cap: number): Promise<ManifestBytes> {
    const found = index.find(MANIFEST_NAME)
    if (found.length !== 1) {
        return { ok: false, reason: found.length === 0 ? 'the file has no manifest.json' : 'the file has more than one manifest.json' }
    }
    const entry = index.entry(found[0])
    if (entry.uncompressedSize > cap) {
        return { ok: false, reason: `manifest.json declares ${entry.uncompressedSize} bytes, over the ${cap} byte limit` }
    }
    const parts: Uint8Array[] = []
    const result = await readEntry(source, index, found[0], (chunk) => {
        parts.push(chunk.slice())
    })
    if (result.ok === false) {
        return { ok: false, reason: findingReason(result.finding) }
    }
    return { ok: true, bytes: concat(parts) }
}

/** A central-level finding stands as damaged unless the manifest is readable and says `rtb` above 1. */
async function afterContainerFinding(source: RangeSource, walk: DirectoryWalk, cap: number): Promise<RtbClassification> {
    const standing = damaged(findingReason(walk.findings[0]))
    if (!walk.index) {
        return standing
    }
    const found = walk.index.find(MANIFEST_NAME)
    if (found.length !== 1) {
        return standing
    }
    const method = walk.index.entry(found[0]).method
    if (method !== 0 && method !== 8) {
        return standing
    }
    const manifest = await readManifestBytes(source, walk.index, cap)
    if (!manifest.ok) {
        return standing
    }
    const rtb = peekNewerRtb(manifest.bytes, cap)
    return rtb === null ? standing : { kind: 'newer', reason: { why: 'rtb', rtb } }
}

function isInAssetsOrInlays(index: ZipIndex, i: number): boolean {
    const name = index.nameBytes(i)
    return name.length > 1 && name[1] === 0x2F && (name[0] === 0x61 || name[0] === 0x69)
}

async function classifyUnguarded(source: RangeSource, cap: number): Promise<RtbClassification> {
    const sniffed = await sniffRtb(source)
    if (sniffed.kind === 'not-an-rtb') {
        return { kind: 'not-an-rtb' }
    }
    if (sniffed.kind === 'sealed') {
        return { kind: 'newer', reason: { why: 'sealed', envelopeVersion: sniffed.envelopeVersion } }
    }
    if (sniffed.kind === 'sealed-damaged') {
        return damaged('the file starts with RTBX but not with the full magic')
    }

    const walk = await readDirectory(source)
    if (walk.findings.length > 0 || !walk.index) {
        return afterContainerFinding(source, walk, cap)
    }
    const index = walk.index

    const manifestBytes = await readManifestBytes(source, index, cap)
    if (manifestBytes.ok === false) {
        return damaged(manifestBytes.reason)
    }
    const parsed = parseManifest(manifestBytes.bytes, { maxBytes: cap })
    if (parsed.kind === 'newer') {
        return { kind: 'newer', reason: { why: 'rtb', rtb: parsed.rtb } }
    }
    if (parsed.kind === 'damaged') {
        return damaged(`manifest: ${parsed.reason}`)
    }
    const manifest = parsed.manifest

    const table = parseSectionTable(manifest.sections)
    if (table.kind === 'damaged') {
        return damaged(`section table: ${table.reason}`)
    }
    const rows = table.rows

    const store2 = rows.find((row) => row.id === 'store2' && isKnownRow(row))
    const refs = store2?.meta && 'refs' in store2.meta ? checkRefs(store2.meta.refs) : null
    const req = store2?.meta && 'req' in store2.meta ? checkReqTokens(store2.meta.req) : null
    if (refs?.kind === 'damaged') {
        return damaged(`section table: ${refs.reason}`)
    }
    if (req?.kind === 'damaged') {
        return damaged(`section table: ${req.reason}`)
    }

    const countProblem = checkSectionCounts(rows, index)
    if (countProblem !== null) {
        return damaged(`section counts: ${countProblem}`)
    }
    const local = await checkLocalHeaders(source, index, (i) => !isInAssetsOrInlays(index, i))
    if (local.length > 0) {
        return damaged(findingReason(local[0]))
    }

    const required = unknownRequiredRow(rows)
    if (required) {
        return { kind: 'newer', reason: { why: 'required-row', id: required.id, v: required.v } }
    }
    if (refs?.kind === 'newer') {
        return { kind: 'newer', reason: { why: 'refs', refs: refs.refs } }
    }
    if (req?.kind === 'newer') {
        return { kind: 'newer', reason: { why: 'req', tokens: req.tokens } }
    }

    const entryProblem = checkKnownSectionEntries(rows, index)
    if (entryProblem !== null) {
        return damaged(`section entries: ${entryProblem}`)
    }

    return {
        kind: 'ok',
        manifest,
        rows,
        index,
        notice: {
            unknownOptionalRows: unknownOptionalRows(rows).map((row) => ({ id: row.id, v: row.v })),
            outsideEntryCount: countOutsideEntries(rows, index),
        },
    }
}

export async function classifyRtb(source: RangeSource, options: ClassifyOptions = {}): Promise<RtbClassification> {
    try {
        return await classifyUnguarded(source, options.manifestCap ?? DEFAULT_MANIFEST_CAP)
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return { kind: 'could-not-read', message: error.message }
        }
        throw error
    }
}
