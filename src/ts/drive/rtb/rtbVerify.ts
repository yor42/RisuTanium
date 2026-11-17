/**
 * The verification half of a `.rtb` restore (CHORE-128 S11, V): everything about a file that can be decided without
 * writing, in the order of the restore's checks. It reads only through a `RangeSource` and imports no page, store or UI code.
 *
 * The outcomes and their precedence:
 *  - could not read: a short or failed read, wherever it happens, beats everything;
 *  - not an `.rtb`, sealed (`RTBX`), and the container, manifest and section findings are `classifyRtb`'s;
 *  - in the units pass and the closure walk, any newer finding beats any damaged finding: the pass records the first of
 *    each and finishes before it decides, because a newer writer may have changed what an older reader sees as damage;
 *  - otherwise the first finding in step order wins.
 *
 * The units pass reads each `u/` block once. Of each unit it keeps a few numbers (`TailInfo`) and, for a parent, the
 * references it names; the frame and the body are dropped before the next unit.
 */
import { checkRtbManifestReq, classifyRtbUnitAlone } from '../../storage/store2/rtb/unitCheck'
import { edgesOfBody, verifyClosure, type ClosureEdge, type ClosureTail } from '../../storage/store2/rtb/closureVerify'
import { omittedTailsOf } from '../../storage/store2/rtb/restoreBuild'
import { WALK_PARENT_TYPES } from '../../storage/store2/rtb/rows'
import { FRAME_FMT } from '../../storage/store2/format/versions'
import { isKnownUnitType, UNIT_TYPE, type Ref } from '../../storage/store2/format'
import { decodeInlayMeta, pairInlayEntries, type InlayPair } from './inlayEntries'
import { sideDataName } from './entryNames'
import type { RtbManifest } from './manifest'
import { RtbCouldNotReadError, type RangeSource } from './rangeSource'
import { classifyRtb, type NewerReason, type RtbNotice } from './rtbClassify'
import type { SectionRow } from './sections'
import { decideSideSections, type SideAction } from './sideDecision'
import { decodeBlock } from './unitBlocks'
import { readEntry, type ZipIndex } from './zip64Reader'

/** A block over this many uncompressed bytes is damaged (A3.1). */
export const BLOCK_MAX_BYTES = 1024 * 1024 * 1024

/** Side sections are read through only when their restore items total at most this many bytes. */
export const SIDE_PRECHECK_CAP_BYTES = 64 * 1024 * 1024

export interface VerifyOptions {
    manifestCap?: number
    /** Test seam: the cap on the side sections' total bytes. */
    sideCheckCapBytes?: number
    /** Called as the units pass advances, with a whole percent of the blocks read. */
    onProgress?: (percent: number) => void
}

/** What made the file newer, structured so the refusal can name it. */
export type NewerItem =
    | { why: 'rtb', rtb: number }
    | { why: 'required-row', id: string, v: number }
    | { why: 'refs', refs: string[] }
    | { why: 'req', tokens: string[] }
    | { why: 'unit', reason: string }

export interface TailInfo extends ClosureTail {
    /** The `ZipIndex` entry number of the `u/` block that holds the unit. */
    block: number
}

export interface Store2Plan {
    root: Ref
    /** The root unit's `req`. */
    req: readonly string[]
    /** The store2 row's uncompressed bytes. */
    bytes: number
    blocks: Uint32Array
    tails: ReadonlyMap<string, TailInfo>
    reachable: number
    omitted: readonly { tail: string, row: string }[]
    unreadableLists: readonly { tail: string, type: number, reason: string }[]
}

export interface SidePlanItem {
    action: SideAction
    precheck: 'ok' | 'corrupt' | 'not-checked'
    reason: string | null
}

export interface VerifiedRtb {
    manifest: RtbManifest
    rows: SectionRow[]
    index: ZipIndex
    notice: RtbNotice
    store2: Store2Plan
    inlays: InlayPair[]
    side: SidePlanItem[]
}

export type RtbVerdict =
    | { kind: 'ok', verified: VerifiedRtb }
    | { kind: 'not-an-rtb' }
    | { kind: 'encrypted' }
    | { kind: 'newer', item: NewerItem }
    | { kind: 'damaged', reason: string }
    | { kind: 'could-not-read', message: string }

function newerItemOf(reason: NewerReason): NewerItem | null {
    switch (reason.why) {
        case 'sealed':
            return null
        case 'rtb':
            return { why: 'rtb', rtb: reason.rtb }
        case 'required-row':
            return { why: 'required-row', id: reason.id, v: reason.v }
        case 'refs':
            return { why: 'refs', refs: reason.refs }
        case 'req':
            return { why: 'req', tokens: reason.tokens }
    }
}

function parseRoot(row: SectionRow): Ref | null {
    const root = row.meta?.root
    if (!Array.isArray(root) || root.length !== 3) {
        return null
    }
    const [tail, bytes, crc] = root as unknown[]
    if (typeof tail !== 'string' || tail.length < 1 || tail.length > 255 || !/^[\x00-\x7F]+$/.test(tail)) {
        return null
    }
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
        return null
    }
    if (typeof crc !== 'number' || !Number.isInteger(crc) || crc < 0 || crc > 0xFFFFFFFF) {
        return null
    }
    return [tail, bytes, crc]
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function entriesUnder(index: ZipIndex, first: number, second: number): number[] {
    const found: number[] = []
    for (let i = 0; i < index.count; i++) {
        const name = index.nameBytes(i)
        if (name.length > 1 && name[0] === first && name[1] === second) {
            found.push(i)
        }
    }
    return found
}

function frameCrc(frame: Uint8Array): number {
    return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(frame.length - 4, true)
}

interface UnitsPass {
    tails: Map<string, TailInfo>
    edges: Map<string, readonly ClosureEdge[]>
    unreadableLists: { tail: string, type: number, reason: string }[]
    req: readonly string[]
    newer: NewerItem | null
    damaged: string | null
    units: number
}

/** The units pass: every block once, the first newer and the first damaged finding kept, the pass always finished. */
async function readUnits(source: RangeSource, index: ZipIndex, blocks: readonly number[], root: Ref, onProgress?: (percent: number) => void): Promise<UnitsPass> {
    const pass: UnitsPass = { tails: new Map(), edges: new Map(), unreadableLists: [], req: [], newer: null, damaged: null, units: 0 }
    const newer = (item: NewerItem): void => {
        pass.newer ??= item
    }
    const damaged = (reason: string): void => {
        pass.damaged ??= reason
    }
    const seenTails = new Set<string>()
    for (const [position, block] of blocks.entries()) {
        onProgress?.(Math.floor((position * 100) / blocks.length))
        const entry = index.entry(block)
        if (entry.uncompressedSize > BLOCK_MAX_BYTES) {
            damaged(`${entry.name} declares ${entry.uncompressedSize} bytes, over the ${BLOCK_MAX_BYTES} byte limit`)
            continue
        }
        const bytes = new Uint8Array(entry.uncompressedSize)
        let at = 0
        const read = await readEntry(source, index, block, (chunk) => {
            bytes.set(chunk, at)
            at += chunk.length
        })
        if (read.ok === false) {
            damaged(`${entry.name}: ${read.finding.code}: ${read.finding.detail}`)
            continue
        }
        const decoded = decodeBlock(bytes, seenTails)
        if (decoded.kind === 'damaged') {
            damaged(`${entry.name}: ${decoded.reason}`)
            continue
        }
        for (const unit of decoded.units) {
            pass.units++
            if (unit.tail === root[0] && unit.type === UNIT_TYPE.manifest) {
                const req = checkRtbManifestReq(unit.frame)
                if (req.status === 'ok') {
                    pass.req = req.req
                } else if (req.status === 'newer') {
                    newer(req.token === undefined ? { why: 'unit', reason: req.reason } : { why: 'req', tokens: [req.token] })
                } else {
                    damaged(`The root unit ${unit.tail}: ${req.reason}`)
                }
            }
            const alone = classifyRtbUnitAlone(unit.tail, unit.type, unit.frame)
            const cls = alone.cls
            if (cls.status === 'newer') {
                newer({ why: 'unit', reason: `${unit.tail}: ${cls.reason}` })
                continue
            }
            if (cls.status === 'damaged') {
                damaged(`The unit ${unit.tail}: ${cls.reason}`)
                continue
            }
            if (cls.status === 'missing') {
                damaged(`The unit ${unit.tail} cannot be checked.`)
                continue
            }
            if (!isKnownUnitType(unit.type)) {
                continue
            }
            const info: TailInfo = { type: unit.type, length: unit.frame.length, crc: frameCrc(unit.frame), items: alone.items, block }
            pass.tails.set(unit.tail, info)
            if (cls.status === 'unreadable-list') {
                pass.unreadableLists.push({ tail: unit.tail, type: unit.type, reason: cls.reason })
                continue
            }
            if (unit.tail === root[0] || WALK_PARENT_TYPES.has(info.type)) {
                try {
                    pass.edges.set(unit.tail, edgesOfBody(info.type, cls.body))
                } catch (error) {
                    if (!(error instanceof TypeError)) {
                        throw error
                    }
                    damaged(`The unit ${unit.tail}: ${error.message}`)
                }
            }
        }
    }
    return pass
}

async function readInlayMetas(source: RangeSource, index: ZipIndex, pairs: readonly InlayPair[]): Promise<string | null> {
    for (const pair of pairs) {
        const found = index.find(pair.metaName)
        if (found.length !== 1) {
            return `${pair.metaName} is not exactly one entry`
        }
        const parts: Uint8Array[] = []
        const read = await readEntry(source, index, found[0], (chunk) => {
            parts.push(chunk.slice())
        })
        if (read.ok === false) {
            return `${pair.metaName}: ${read.finding.code}: ${read.finding.detail}`
        }
        const meta = decodeInlayMeta(concat(parts), pair.bodySize)
        if (meta.kind === 'damaged') {
            return `${pair.metaName}: ${meta.reason}`
        }
    }
    return null
}

/** The side items: a restore item's data entry is read through when the restore items total at most `cap` bytes. */
async function planSide(source: RangeSource, index: ZipIndex, rows: readonly SectionRow[], manifest: RtbManifest, cap: number): Promise<SidePlanItem[]> {
    const actions = decideSideSections(rows, manifest.omitted)
    let total = 0
    for (const action of actions) {
        if (action.kind === 'restore') {
            total += action.row.bytes
        }
    }
    const items: SidePlanItem[] = []
    for (const action of actions) {
        if (action.kind !== 'restore' || total > cap) {
            items.push({ action, precheck: 'not-checked', reason: null })
            continue
        }
        const found = index.find(sideDataName(action.id) as string)
        if (found.length !== 1) {
            items.push({ action, precheck: 'corrupt', reason: `${action.id} has no single data entry` })
            continue
        }
        const read = await readEntry(source, index, found[0], () => { })
        items.push(read.ok === false
            ? { action, precheck: 'corrupt', reason: `${read.finding.code}: ${read.finding.detail}` }
            : { action, precheck: 'ok', reason: null })
    }
    return items
}

async function verifyUnguarded(source: RangeSource, options: VerifyOptions): Promise<RtbVerdict> {
    const classified = await classifyRtb(source, options.manifestCap === undefined ? {} : { manifestCap: options.manifestCap })
    switch (classified.kind) {
        case 'could-not-read':
            return { kind: 'could-not-read', message: classified.message }
        case 'not-an-rtb':
            return { kind: 'not-an-rtb' }
        case 'damaged':
            return { kind: 'damaged', reason: classified.reason }
        case 'newer': {
            const item = newerItemOf(classified.reason)
            return item === null ? { kind: 'encrypted' } : { kind: 'newer', item }
        }
        case 'ok':
            break
    }
    const { manifest, rows, index, notice } = classified

    const row = rows.find((candidate) => candidate.id === 'store2')
    const root = row === undefined ? null : parseRoot(row)
    if (row === undefined || root === null) {
        return { kind: 'damaged', reason: 'the store2 section has no usable meta.root' }
    }

    const blocks = entriesUnder(index, 0x75, 0x2F)
    const pass = await readUnits(source, index, blocks, root, options.onProgress)
    if (pass.newer !== null) {
        return { kind: 'newer', item: pass.newer }
    }
    if (pass.damaged !== null) {
        return { kind: 'damaged', reason: pass.damaged }
    }

    const omitted = omittedTailsOf(manifest.omitted)
    const closure = verifyClosure({ root, tails: pass.tails, edges: pass.edges, omitted })
    if (closure.ok === false) {
        return { kind: 'damaged', reason: closure.reason }
    }
    if (row.meta?.units !== undefined && row.meta.units !== pass.units) {
        console.warn(`The store2 section says ${String(row.meta.units)} units and the file holds ${pass.units}.`)
    }
    if (row.meta?.frameFmt !== undefined && row.meta.frameFmt !== FRAME_FMT) {
        console.warn(`The store2 section says frame format ${String(row.meta.frameFmt)}; this build writes ${FRAME_FMT}.`)
    }

    const names = entriesUnder(index, 0x69, 0x2F).map((i) => ({ name: index.name(i), size: index.entry(i).uncompressedSize }))
    const paired = pairInlayEntries(names)
    if (paired.kind === 'damaged') {
        return { kind: 'damaged', reason: paired.reason }
    }
    const metaProblem = await readInlayMetas(source, index, paired.pairs)
    if (metaProblem !== null) {
        return { kind: 'damaged', reason: metaProblem }
    }

    const side = await planSide(source, index, rows, manifest, options.sideCheckCapBytes ?? SIDE_PRECHECK_CAP_BYTES)

    return {
        kind: 'ok',
        verified: {
            manifest,
            rows,
            index,
            notice,
            store2: {
                root,
                req: pass.req,
                bytes: row.bytes,
                blocks: Uint32Array.from(blocks),
                tails: pass.tails,
                reachable: closure.reachable,
                omitted: closure.omitted,
                unreadableLists: pass.unreadableLists,
            },
            inlays: paired.pairs,
            side,
        },
    }
}

export async function verifyRtb(source: RangeSource, options: VerifyOptions = {}): Promise<RtbVerdict> {
    try {
        return await verifyUnguarded(source, options)
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return { kind: 'could-not-read', message: error.message }
        }
        throw error
    }
}
