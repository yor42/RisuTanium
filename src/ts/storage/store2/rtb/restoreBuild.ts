import type { UnitWrite } from '../backend/types'
import type { BuildContext, BuiltCommit } from '../commit'
import {
    encodeUnit, readUnit, refOfFrame, refsOfWith, unionReq, UNIT_TYPE,
    type Manifest, type Ref, type RefRow, type UnitBody, type UnitType,
} from '../format'
import { PATH_TYPES, withReplacedRefs } from '../recoveryPick'
import { O3_ROWS, WALK_PARENT_TYPES, WALK_TABLE } from './rows'

/**
 * The store2 section of a `.rtb` file turned into a commit request (restore, CHORE-128 S4).
 *
 * `planRestore` reads the verified frames of the file once: it walks `WALK_TABLE` from the exported manifest, post-order,
 * collects every distinct tail the walk reaches and parses each parent once. It writes nothing and holds no key. The
 * request's `build` is then pure over that plan, so a commit that calls it again on a retry gets the same content under
 * keys no earlier attempt was offered:
 *  - every unit gets a key of the attempt's mint (`shard()` for a shard, `unit()` for the rest, `manifest()` last);
 *  - a unit without a walkable Ref (a leaf, or a layout 2 module index root) is copied as its stored frame, never
 *    encoded again, so a frame another writer laid out differently keeps its bytes and its checksum;
 *  - a parent is framed again after its children, with `withReplacedRefs` over the same table, so only the walkable
 *    positions change (elements 0-2 of a Ref, the rest kept) and a Ref-shaped value anywhere else is data;
 *  - an omitted unit's Ref is removed from its list, and a list that this empties loses its field, as the writer leaves it;
 *  - the manifest keeps every field of the backup, known or not, except the four a device owns: `fixed.legacyKeep` (the
 *    attempt's, else the target's), `req` (the union with the target's), `seq` and `createdAt` (the attempt's).
 *
 * The defences below stand behind the validation that ran before the plan; a file that passed it cannot trip them.
 */

export type RestoreFailureKind =
    /** A tail the walk reaches has no frame and is not omitted. */
    | 'missing-frame'
    /** An omitted tail is named at a row that is not one of `O3_ROWS`. */
    | 'omitted-outside-o3'
    /** An omitted tail has a frame in the file. */
    | 'omitted-tail-present'
    /** Refs to one tail disagree on type, length or checksum. */
    | 'conflict'
    /** A frame the walk needs to read does not parse. */
    | 'unreadable'

export class RtbRestoreError extends Error {
    constructor(readonly kind: RestoreFailureKind, message: string, readonly tail?: string, readonly row?: string) {
        super(message)
        this.name = 'RtbRestoreError'
    }
}

/** An entry of the file's `omitted` list as far as the restore reads it. */
export interface OmittedEntry {
    kind: string
    name: string
    reason: string
}

/**
 * The tails the file leaves out. Only a unit entry with the reason `damaged` excuses a missing Ref; an entry of another or an
 * unknown kind or reason excuses nothing, so a file from a newer writer cannot widen what a restore drops.
 */
export function omittedTailsOf(entries: readonly OmittedEntry[]): Set<string> {
    return new Set(entries.filter(entry => entry.kind === 'unit' && entry.reason === 'damaged').map(entry => entry.name))
}

/** What the restoring device owns of the new manifest. On a boot restore `legacyKeep` is null: the old-file keep is the boot's own step. */
export interface RestoreTarget {
    legacyKeep: Manifest['fixed']['legacyKeep']
    req: readonly string[]
}

export interface RestorePlanInput {
    /** The verified frames of the file's store2 section by tail, the manifest included. */
    frames: ReadonlyMap<string, Uint8Array>
    /** The Ref of the exported manifest (`meta.root`). */
    root: Ref
    omitted: ReadonlySet<string>
    target: RestoreTarget
    /** Tests only: the rows to walk and rewrite in place of `WALK_TABLE`. */
    table?: readonly RefRow[]
}

export interface RestoreRequest {
    /** The units the commit writes, the manifest included. */
    newUnits: number
    build(context: BuildContext): BuiltCommit
}

interface Seen {
    type: UnitType
    bytes: number
    crc: number
    /** The first row that named the tail. */
    row: string
    /** Whether every row that named the tail so far is an O3 row. */
    allO3: boolean
}

interface Planned {
    tail: string
    type: UnitType
    frame: Uint8Array
    /** The body to rewrite when the unit names further units; null for a unit copied as its stored frame. */
    parent: UnitBody | null
}

function parseFrame(tail: string, frame: Uint8Array, type: UnitType): UnitBody {
    const parsed = readUnit(frame, type)
    if (parsed.status === 'ok' || parsed.status === 'stale') {
        return parsed.value.body
    }
    throw new RtbRestoreError('unreadable', `The unit ${tail} cannot be read: ${parsed.reason}`, tail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Removes from the list at `segments` (`refsOf` path syntax) every Ref whose tail is in `omitted`; a list this empties is deleted. */
function dropOmitted(node: unknown, segments: readonly string[], index: number, omitted: ReadonlySet<string>): void {
    if (!isRecord(node)) {
        return
    }
    const segment = segments[index]
    const each = segment.endsWith('[]')
    const field = each ? segment.slice(0, -2) : segment
    const child = node[field]
    if (child === null || child === undefined) {
        return
    }
    if (index === segments.length - 1) {
        if (!each || !Array.isArray(child)) {
            throw new TypeError(`"${field}" is not a list of references.`)
        }
        const kept: unknown[] = (child as unknown[]).filter(item => !(Array.isArray(item) && omitted.has(String(item[0]))))
        if (kept.length === child.length) {
            return
        }
        if (kept.length === 0) {
            delete node[field]
        } else {
            node[field] = kept
        }
        return
    }
    if (!each) {
        dropOmitted(child, segments, index + 1, omitted)
        return
    }
    if (!Array.isArray(child)) {
        throw new TypeError(`"${field}" is not a list.`)
    }
    for (const item of child as unknown[]) {
        dropOmitted(item, segments, index + 1, omitted)
    }
}

/** A copy of `body` without the Refs of omitted units at the O3 rows of `type`. */
function withoutOmitted<T extends UnitBody>(type: UnitType, body: T, omitted: ReadonlySet<string>): T {
    if (omitted.size === 0) {
        return body
    }
    const copy = structuredClone(body)
    const prefix = `${type}:`
    for (const id of O3_ROWS) {
        if (id.startsWith(prefix)) {
            dropOmitted(copy, id.slice(prefix.length).split('.'), 0, omitted)
        }
    }
    return copy
}

export function planRestore(input: RestorePlanInput): RestoreRequest {
    const table = input.table ?? WALK_TABLE
    const { frames, omitted } = input
    const rootTail = input.root[0]
    const rootFrame = frames.get(rootTail)
    if (rootFrame === undefined) {
        throw new RtbRestoreError('missing-frame', `The exported manifest ${rootTail} has no frame in the file.`, rootTail)
    }
    const rootBody = parseFrame(rootTail, rootFrame, UNIT_TYPE.manifest) as Manifest

    const seen = new Map<string, Seen>()
    const order: Planned[] = []
    const visit = (type: UnitType, body: UnitBody): void => {
        for (const target of refsOfWith(table, type, body)) {
            const childType = PATH_TYPES[target.path]
            if (childType === undefined) {
                throw new TypeError(`No unit type is known for the reference position ${target.path}.`)
            }
            const row = `${type}:${target.path}`
            const o3 = O3_ROWS.includes(row)
            const known = seen.get(target.tail)
            if (known !== undefined) {
                if (known.type !== childType || known.bytes !== target.bytes || known.crc !== target.crc) {
                    throw new RtbRestoreError('conflict', `The unit ${target.tail} is named with a different type, length or checksum at ${row} and at ${known.row}.`, target.tail, row)
                }
                known.allO3 = known.allO3 && o3
                continue
            }
            seen.set(target.tail, { type: childType, bytes: target.bytes as number, crc: target.crc as number, row, allO3: o3 })
            if (omitted.has(target.tail)) {
                continue
            }
            const frame = frames.get(target.tail)
            if (frame === undefined) {
                throw new RtbRestoreError('missing-frame', `The unit ${target.tail} named at ${row} has no frame in the file.`, target.tail, row)
            }
            if (WALK_PARENT_TYPES.has(childType)) {
                const childBody = parseFrame(target.tail, frame, childType)
                visit(childType, childBody)
                // A parent that names nothing walkable (a layout 2 module index root) is copied as its stored frame.
                const names = refsOfWith(table, childType, childBody).length > 0
                order.push({ tail: target.tail, type: childType, frame, parent: names ? childBody : null })
            } else {
                order.push({ tail: target.tail, type: childType, frame, parent: null })
            }
        }
    }
    visit(UNIT_TYPE.manifest, rootBody)

    for (const [tail, info] of seen) {
        if (!omitted.has(tail)) {
            continue
        }
        if (!info.allO3) {
            throw new RtbRestoreError('omitted-outside-o3', `The unit ${tail} is listed as omitted but is named at ${info.row}, which is not a row where a unit may be left out.`, tail, info.row)
        }
        if (frames.has(tail)) {
            throw new RtbRestoreError('omitted-tail-present', `The unit ${tail} is listed as omitted but the file holds it.`, tail, info.row)
        }
    }

    return {
        newUnits: order.length + 1,
        build(context) {
            const { mint } = context
            const refs = new Map<string, Ref>()
            const units: UnitWrite[] = []
            for (const unit of order) {
                const key = unit.type === UNIT_TYPE.shard ? mint.shard() : mint.unit()
                const bytes = unit.parent === null
                    ? unit.frame
                    : encodeUnit(unit.type, withReplacedRefs(unit.type, withoutOmitted(unit.type, unit.parent, omitted), refs, table))
                refs.set(unit.tail, refOfFrame(key, bytes))
                units.push({ key, bytes })
            }
            const rewritten = withReplacedRefs(UNIT_TYPE.manifest, withoutOmitted(UNIT_TYPE.manifest, rootBody, omitted), refs, table)
            // The attempt's keep wins (a save-mine over a base that does not name the planned manifest), then the target's by value.
            const keep = context.legacyKeep !== undefined ? context.legacyKeep : input.target.legacyKeep
            const body: Manifest = {
                ...rewritten,
                req: unionReq(rewritten.req, input.target.req),
                seq: context.seq,
                createdAt: context.now,
                fixed: { ...rewritten.fixed, legacyKeep: structuredClone(keep) },
            }
            return { units, manifest: { key: mint.manifest(), body } }
        },
    }
}
