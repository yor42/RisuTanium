import { refsOfWith, UNIT_TYPE, type Ref, type Shard, type UnitBody, type UnitType } from '../format'
import { PATH_TYPES } from '../recoveryPick'
import { O3_ROWS, rowId, WALK_PARENT_TYPES, WALK_TABLE } from './rows'

/**
 * The reference integrity of the store2 section of a `.rtb` file, judged before anything is written (CHORE-128 S11).
 *
 * The restore's unit pass reads every unit once and keeps only what is needed to judge the closure: for each tail its type,
 * framed length, checksum and, for a chat chunk or an alternatives unit, its item count (`ClosureTail`), and for each
 * parent unit the edges it names (`ClosureEdge`). `verifyClosure` then walks from the file's root and checks every edge the
 * way `planRestore` and the export walk defend it, so a file that passes here cannot trip those defences:
 *  - the edge's tail is in the file with the same type, length and checksum, and all edges to one tail agree;
 *  - a counted child (type 8 or 25) whose tail is present holds exactly the number of items the edge states, and the
 *    stated count is a number;
 *  - a tail is missing only when the file lists it as omitted and every edge that names it sits at an `O3_ROWS` row; an
 *    omitted tail that the file holds is damaged.
 * It is pure and holds no frame.
 */

/** What the unit pass kept of one unit. */
export interface ClosureTail {
    type: UnitType
    /** The framed length. */
    length: number
    crc: number
    /** Messages of a chat chunk, records of an alternatives unit; null for every other type. */
    items: number | null
}

/** One reference of a parent unit. `count` is the Ref's fourth element as the parent's body holds it. */
export interface ClosureEdge {
    tail: string
    bytes: number
    crc: number
    count: Ref[3]
    /** `<parent type>:<path>`, as `O3_ROWS` and the manifest's `meta.refs` spell it. */
    row: string
    childType: UnitType
}

export interface ClosureInput {
    /** `meta.root` of the store2 row. */
    root: Ref
    tails: ReadonlyMap<string, ClosureTail>
    /** The edges of each parent unit (and of the root) by its tail. */
    edges: ReadonlyMap<string, readonly ClosureEdge[]>
    /** The tails the file's `omitted` list excuses. */
    omitted: ReadonlySet<string>
}

export type ClosureVerdict =
    | { ok: true, reachable: number, omitted: { tail: string, row: string }[] }
    | { ok: false, reason: string }

const COUNTED_PATHS: ReadonlySet<string> = new Set(['entries[].chats[].chunks[]', 'entries[].chats[].alt[]'])
const O3: ReadonlySet<string> = new Set(O3_ROWS)

function isCounted(type: UnitType): boolean {
    return type === UNIT_TYPE.chatChunk || type === UNIT_TYPE.chatAlt
}

/**
 * The edges of a parsed parent. The counted rows of a shard are read from the typed body, where the schema parser has
 * already required an integer count; every other row comes from the one walk table. A position the table gains without a
 * type, or a malformed reference position, throws `TypeError`.
 */
export function edgesOfBody(type: UnitType, body: UnitBody): ClosureEdge[] {
    const edges: ClosureEdge[] = []
    for (const target of refsOfWith(WALK_TABLE, type, body)) {
        if (type === UNIT_TYPE.shard && COUNTED_PATHS.has(target.path)) {
            continue
        }
        const childType: UnitType | undefined = PATH_TYPES[target.path]
        if (childType === undefined) {
            throw new TypeError(`No unit type is known for the reference position ${target.path}.`)
        }
        if (target.bytes === null || target.crc === null) {
            throw new TypeError(`${target.path}: a walked position holds a length and a checksum.`)
        }
        edges.push({ tail: target.tail, bytes: target.bytes, crc: target.crc, count: undefined, row: rowId({ type, path: target.path }), childType })
    }
    if (type === UNIT_TYPE.shard) {
        const chunkRow = rowId({ type, path: 'entries[].chats[].chunks[]' })
        const altRow = rowId({ type, path: 'entries[].chats[].alt[]' })
        for (const entry of (body as Shard).entries) {
            for (const chat of entry.chats) {
                for (const ref of chat.chunks) {
                    edges.push({ tail: ref[0], bytes: ref[1], crc: ref[2], count: ref[3], row: chunkRow, childType: UNIT_TYPE.chatChunk })
                }
                for (const ref of chat.alt ?? []) {
                    edges.push({ tail: ref[0], bytes: ref[1], crc: ref[2], count: ref[3], row: altRow, childType: UNIT_TYPE.chatAlt })
                }
            }
        }
    }
    return edges
}

interface Seen {
    type: UnitType
    bytes: number
    crc: number
    row: string
    allO3: boolean
}

function damaged(reason: string): ClosureVerdict {
    return { ok: false, reason }
}

export function verifyClosure(input: ClosureInput): ClosureVerdict {
    const { root, tails, edges, omitted } = input
    const rootInfo = tails.get(root[0])
    if (rootInfo === undefined) {
        return damaged(`The root unit ${root[0]} is not in the file.`)
    }
    if (rootInfo.type !== UNIT_TYPE.manifest || rootInfo.length !== root[1] || rootInfo.crc !== root[2]) {
        return damaged(`The root unit ${root[0]} is not the manifest unit that meta.root names.`)
    }

    const seen = new Map<string, Seen>()
    const reached = new Set<string>([root[0]])
    const parents: string[] = [root[0]]
    while (parents.length > 0) {
        const parent = parents.pop() as string
        for (const edge of edges.get(parent) ?? []) {
            const o3 = O3.has(edge.row)
            const known = seen.get(edge.tail)
            if (known !== undefined) {
                if (known.type !== edge.childType || known.bytes !== edge.bytes || known.crc !== edge.crc) {
                    return damaged(`The unit ${edge.tail} is named with a different type, length or checksum at ${edge.row} and at ${known.row}.`)
                }
                known.allO3 = known.allO3 && o3
            } else {
                seen.set(edge.tail, { type: edge.childType, bytes: edge.bytes, crc: edge.crc, row: edge.row, allO3: o3 })
            }
            const info = tails.get(edge.tail)
            if (info === undefined) {
                if (!omitted.has(edge.tail)) {
                    return damaged(`The unit ${edge.tail} named at ${edge.row} is not in the file.`)
                }
                continue
            }
            if (omitted.has(edge.tail)) {
                return damaged(`The unit ${edge.tail} is listed as omitted but the file holds it.`)
            }
            if (info.type !== edge.childType || info.length !== edge.bytes || info.crc !== edge.crc) {
                return damaged(`The unit ${edge.tail} named at ${edge.row} does not match its reference.`)
            }
            if (isCounted(edge.childType) && (typeof edge.count !== 'number' || edge.count !== info.items)) {
                return damaged(`The unit ${edge.tail} named at ${edge.row} holds a different number of items than its reference says.`)
            }
            if (!reached.has(edge.tail)) {
                reached.add(edge.tail)
                if (WALK_PARENT_TYPES.has(edge.childType)) {
                    parents.push(edge.tail)
                }
            }
        }
    }

    const left: { tail: string, row: string }[] = []
    for (const [tail, info] of seen) {
        if (!omitted.has(tail)) {
            continue
        }
        if (!info.allO3) {
            return damaged(`The unit ${tail} is listed as omitted but is named at ${info.row}, which is not a row where a unit may be left out.`)
        }
        left.push({ tail, row: info.row })
    }
    return { ok: true, reachable: reached.size, omitted: left }
}
