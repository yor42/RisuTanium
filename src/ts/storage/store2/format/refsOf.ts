import { STORE2_PREFIX } from '../../store/keyRules'
import { UNIT_TYPE, UNIT_TYPE_IDS, type UnitType } from './versions'

/**
 * Every position at which a unit body names another unit. GC mark, recovery,
 * keep-set walks and codec validation all enumerate references through this one
 * table, so a position missing here is missing everywhere; the tests drop each
 * row in turn and require a guard to fail.
 *
 * Path syntax: `.` descends into a field, a trailing `[]` visits every element
 * of a list, and a null or absent value on the way is skipped.
 */

/** `ref`: a `[tail, bytes, crc]` tuple. `key`: a full store key (the commit key names manifests this way). */
export type RefMode = 'ref' | 'key'

export interface RefRow {
    type: UnitType
    path: string
    mode: RefMode
}

/**
 * What a reference resolves to. A `key` position has no length or CRC to check,
 * so `bytes` and `crc` are null and `byKey` is true: a GC mark takes `tail` as
 * live and reads that manifest, and a tree read verifies it by its own frame.
 */
export interface RefTarget {
    path: string
    tail: string
    bytes: number | null
    crc: number | null
    byKey: boolean
}

export const REFS_TABLE: readonly RefRow[] = [
    { type: UNIT_TYPE.commit, path: 'current.key', mode: 'key' },
    { type: UNIT_TYPE.commit, path: 'retained[].key', mode: 'key' },
    { type: UNIT_TYPE.commit, path: 'pins[].key', mode: 'key' },

    { type: UNIT_TYPE.manifest, path: 'shards[]', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.config', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.configAl', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.il', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.statics', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.order', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.loadouts', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.moduleIndex', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.presets[]', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.plugins[]', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.pluginStorage.refs[]', mode: 'ref' },
    { type: UNIT_TYPE.manifest, path: 'fixed.legacyKeep.unit', mode: 'ref' },

    { type: UNIT_TYPE.shard, path: 'entries[].core', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].lore', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].scripts', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].al', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].il', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].chats[].core', mode: 'ref' },
    { type: UNIT_TYPE.shard, path: 'entries[].chats[].chunks[]', mode: 'ref' },

    { type: UNIT_TYPE.moduleIndex, path: 'entries[].unit', mode: 'ref' },
    { type: UNIT_TYPE.moduleIndex, path: 'entries[].al', mode: 'ref' },
    { type: UNIT_TYPE.moduleIndex, path: 'entries[].il', mode: 'ref' },

    { type: UNIT_TYPE.pluginStorageBucket, path: 'entries[].ref', mode: 'ref' },
]

/** Unit types that name no other unit. The fence record and the deletion snapshot name keys inline, which are not references. */
export const UNITS_WITHOUT_REFS: readonly UnitType[] = UNIT_TYPE_IDS.filter(
    type => !REFS_TABLE.some(row => row.type === type),
)

function visit(node: unknown, segments: readonly string[], index: number, row: RefRow, out: RefTarget[]): void {
    if (node === null || node === undefined) {
        return
    }
    if (index === segments.length) {
        out.push(targetOf(node, row))
        return
    }
    const segment = segments[index]
    const each = segment.endsWith('[]')
    const field = each ? segment.slice(0, -2) : segment
    if (typeof node !== 'object' || Array.isArray(node)) {
        throw new TypeError(`${row.path}: expected an object before "${field}".`)
    }
    const child = (node as Record<string, unknown>)[field]
    if (!each) {
        visit(child, segments, index + 1, row, out)
        return
    }
    if (child === null || child === undefined) {
        return
    }
    if (!Array.isArray(child)) {
        throw new TypeError(`${row.path}: "${field}" is not a list.`)
    }
    for (const item of child) {
        visit(item, segments, index + 1, row, out)
    }
}

function targetOf(value: unknown, row: RefRow): RefTarget {
    if (row.mode === 'key') {
        if (typeof value !== 'string' || !value.startsWith(STORE2_PREFIX)) {
            throw new TypeError(`${row.path}: expected a store2 key.`)
        }
        return { path: row.path, tail: value.slice(STORE2_PREFIX.length), bytes: null, crc: null, byKey: true }
    }
    if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'number' || typeof value[2] !== 'number') {
        throw new TypeError(`${row.path}: expected a [tail, bytes, crc] tuple.`)
    }
    return { path: row.path, tail: value[0], bytes: value[1], crc: value[2], byKey: false }
}

/** `refsOf` over an explicit table; the tests use it to run a table with one row removed. */
export function refsOfWith(table: readonly RefRow[], type: UnitType, body: object): RefTarget[] {
    const out: RefTarget[] = []
    for (const row of table) {
        if (row.type === type) {
            visit(body, row.path.split('.'), 0, row, out)
        }
    }
    return out
}

/** Every unit `body` (of `type`) names, from the one schema table. */
export function refsOf(type: UnitType, body: object): RefTarget[] {
    return refsOfWith(REFS_TABLE, type, body)
}
