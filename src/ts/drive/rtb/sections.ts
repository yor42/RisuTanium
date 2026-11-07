/**
 * The section table of an `.rtb` manifest (A2.2-A2.4) and the per-section checks of
 * the central directory.
 *
 * A row is known when this reader knows its `id` at its `v`: the three required ids and
 * the eight side ids, all at `v` 1. Everything the manifest alone can decide is decided
 * here: row grammar, unique and non-nested prefixes, the reserved ids, the side prefixes
 * and the rule that an optional row never sits under `u/`, `a/` or `i/`. The checks of
 * entry names and methods apply to the entries of known rows only; an unknown optional
 * row gets its counts checked and nothing else.
 */
import {
    ASSETS_ID,
    INLAYS_ID,
    RESERVED_ROW_PREFIX,
    SIDE_SECTION_IDS,
    STORE2_ID,
    checkKnownEntryName,
    ownerOfName,
    sidePrefix,
} from './entryNames'
import type { ZipIndex } from './zip64Reader'

export interface SectionRow {
    id: string
    v: number
    required: boolean
    prefix: string
    /** Entry count under the prefix, as the producer wrote it. */
    entries: number
    /** Sum of the uncompressed sizes under the prefix, as the producer wrote it. */
    bytes: number
    /** Owned by the section; null when absent. */
    meta: Record<string, unknown> | null
}

export type SectionTableResult =
    | { kind: 'ok', rows: SectionRow[] }
    | { kind: 'damaged', reason: string }

const ROW_ID = /^[a-z0-9.-]{1,64}$/
const ROW_PREFIX = /^([a-z0-9.-]+\/)+$/
const RESERVED_IDS = [STORE2_ID, ASSETS_ID, INLAYS_ID]
const KNOWN_ROW_VERSION = 1
const SIDE_PREFIXES: readonly { id: string, prefix: string }[] = SIDE_SECTION_IDS.map((id) => ({ id, prefix: sidePrefix(id) as string }))
const FORBIDDEN_OPTIONAL_PREFIXES = ['u/', 'a/', 'i/']

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Whether this reader knows the row: its id at `v` 1. */
export function isKnownRow(row: SectionRow): boolean {
    return row.v === KNOWN_ROW_VERSION && (RESERVED_IDS.includes(row.id) || sidePrefix(row.id) !== null)
}

function damaged(reason: string): SectionTableResult {
    return { kind: 'damaged', reason }
}

function parseRow(raw: unknown, position: number): SectionRow | string {
    if (!isRecord(raw)) {
        return `section row ${position} is not an object`
    }
    const { id, v, required, prefix, entries, bytes, meta } = raw
    if (typeof id !== 'string' || !ROW_ID.test(id)) {
        return `section row ${position} has an id outside [a-z0-9.-]{1,64}`
    }
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
        return `section ${id} has a v that is not an integer of 1 or more`
    }
    if (typeof required !== 'boolean') {
        return `section ${id} has a required flag that is not a boolean`
    }
    if (typeof prefix !== 'string' || !ROW_PREFIX.test(prefix)) {
        return `section ${id} has a prefix outside ([a-z0-9.-]+/)+`
    }
    if (!isCount(entries) || !isCount(bytes)) {
        return `section ${id} has an entries or bytes value that is not a non-negative integer`
    }
    let rowMeta: Record<string, unknown> | null = null
    if (meta !== undefined) {
        if (!isRecord(meta)) {
            return `section ${id} has a meta that is not an object`
        }
        rowMeta = meta
    }
    return { id, v, required, prefix, entries, bytes, meta: rowMeta }
}

function prefixProblem(rows: readonly SectionRow[]): string | null {
    const byPrefix = new Map<string, string>()
    for (const row of rows) {
        const other = byPrefix.get(row.prefix)
        if (other !== undefined) {
            return `sections ${other} and ${row.id} share the prefix ${row.prefix}`
        }
        byPrefix.set(row.prefix, row.id)
    }
    for (const row of rows) {
        for (let slash = row.prefix.indexOf('/'); slash >= 0 && slash < row.prefix.length - 1; slash = row.prefix.indexOf('/', slash + 1)) {
            const outer = byPrefix.get(row.prefix.slice(0, slash + 1))
            if (outer !== undefined) {
                return `section ${row.id} has a prefix nested under the prefix of ${outer}`
            }
        }
    }
    return null
}

function ruleProblem(rows: readonly SectionRow[]): string | null {
    for (const id of RESERVED_IDS) {
        const row = rows.find((candidate) => candidate.id === id)
        if (!row) {
            return `the required section ${id} is missing`
        }
        if (!row.required) {
            return `the section ${id} is marked optional`
        }
        if (row.v === KNOWN_ROW_VERSION && row.prefix !== RESERVED_ROW_PREFIX[id]) {
            return `the section ${id} is not at its prefix ${RESERVED_ROW_PREFIX[id]}`
        }
    }
    for (const row of rows) {
        const own = sidePrefix(row.id)
        if (own !== null && row.v === KNOWN_ROW_VERSION && row.prefix !== own) {
            return `the section ${row.id} is not at its prefix ${own}`
        }
        if (row.required) {
            continue
        }
        for (const side of SIDE_PREFIXES) {
            if (side.id !== row.id && (row.prefix.startsWith(side.prefix) || side.prefix.startsWith(row.prefix))) {
                return `the optional section ${row.id} uses or nests with the prefix ${side.prefix} of ${side.id}`
            }
        }
        if (FORBIDDEN_OPTIONAL_PREFIXES.some((forbidden) => row.prefix.startsWith(forbidden))) {
            return `the optional section ${row.id} sits under ${row.prefix}`
        }
    }
    return null
}

/** Validates the raw `sections` list of a manifest: the A2.2 grammar, then the A2.3 and A2.4 rules. */
export function parseSectionTable(raw: unknown): SectionTableResult {
    if (!Array.isArray(raw)) {
        return damaged('sections is not a list')
    }
    const rows: SectionRow[] = []
    const ids = new Set<string>()
    for (const [position, item] of (raw as unknown[]).entries()) {
        const row = parseRow(item, position)
        if (typeof row === 'string') {
            return damaged(row)
        }
        if (ids.has(row.id)) {
            return damaged(`the section id ${row.id} appears twice`)
        }
        ids.add(row.id)
        rows.push(row)
    }
    const problem = prefixProblem(rows) ?? ruleProblem(rows)
    return problem === null ? { kind: 'ok', rows } : damaged(problem)
}

/** The first required row this reader does not know; the file is "made by a newer version" and the row is named. */
export function unknownRequiredRow(rows: readonly SectionRow[]): SectionRow | null {
    return rows.find((row) => row.required && !isKnownRow(row)) ?? null
}

/** Optional rows this reader does not know; they are never inflated and the notice names them. */
export function unknownOptionalRows(rows: readonly SectionRow[]): SectionRow[] {
    return rows.filter((row) => !row.required && !isKnownRow(row))
}

function prefixMap(rows: readonly SectionRow[]): Map<string, number> {
    const map = new Map<string, number>()
    rows.forEach((row, i) => map.set(row.prefix, i))
    return map
}

/** Compares each row's `entries` and `bytes` with the central directory, for known and unknown rows alike. */
export function checkSectionCounts(rows: readonly SectionRow[], index: ZipIndex): string | null {
    const map = prefixMap(rows)
    const entries = new Array<number>(rows.length).fill(0)
    const bytes = new Array<number>(rows.length).fill(0)
    for (let i = 0; i < index.count; i++) {
        const entry = index.entry(i)
        const owner = ownerOfName(entry.name, map)
        if (typeof owner === 'number') {
            entries[owner]++
            bytes[owner] += entry.uncompressedSize
        }
    }
    for (let r = 0; r < rows.length; r++) {
        if (entries[r] !== rows[r].entries) {
            return `section ${rows[r].id} says ${rows[r].entries} entries and the directory holds ${entries[r]}`
        }
        if (bytes[r] !== rows[r].bytes) {
            return `section ${rows[r].id} says ${rows[r].bytes} bytes and the directory holds ${bytes[r]}`
        }
    }
    return null
}

/** Canonical names and method 93, for the entries of known rows only. */
export function checkKnownSectionEntries(rows: readonly SectionRow[], index: ZipIndex): string | null {
    const map = prefixMap(rows)
    for (let i = 0; i < index.count; i++) {
        const entry = index.entry(i)
        const owner = ownerOfName(entry.name, map)
        if (typeof owner !== 'number' || !isKnownRow(rows[owner])) {
            continue
        }
        if (entry.method === 93) {
            return `${entry.name} uses compression method 93 in the known section ${rows[owner].id}`
        }
        const problem = checkKnownEntryName(rows[owner].id, entry.name)
        if (problem !== null) {
            return `${entry.name}: ${problem}`
        }
    }
    return null
}

/** Entries other than `mimetype` and `manifest.json` that lie outside every prefix; they are ignored and counted. */
export function countOutsideEntries(rows: readonly SectionRow[], index: ZipIndex): number {
    const map = prefixMap(rows)
    let outside = 0
    for (let i = 0; i < index.count; i++) {
        if (ownerOfName(index.name(i), map) === 'outside') {
            outside++
        }
    }
    return outside
}
