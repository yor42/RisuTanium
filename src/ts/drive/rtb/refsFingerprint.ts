/**
 * The `meta.req` copy and the `meta.refs` fingerprint of the `store2` row (A2.5, A2.6).
 *
 * `meta.refs` lists the refs-table rows that yielded a Ref in the file's closure walk,
 * as `<type decimal>:<path>`. A reader answers membership for every string: a string
 * the table lacks was written by a later build and makes the file newer; a string that
 * does not have the form is damaged. Order and repeats are not refused on read; the
 * writer sorts by the default string order and removes repeats.
 *
 * `checkReqTokens` looks at the `meta.req` copy only. The authority is the `req` of the
 * root manifest unit, which a caller that reads that unit checks with the same function.
 */
import { REFS_TABLE } from '../../storage/store2/format/refsOf'
import { KNOWN_REQ, UNIT_TYPE } from '../../storage/store2/format/versions'

/** The rows the closure walk never reports: the three commit rows and the legacy keep set. */
const WALK_SKIPS: ReadonlySet<string> = new Set<string>([`${UNIT_TYPE.manifest}:fixed.legacyKeep.unit`])

/** The strings a version 1 closure walk can list: 28 of the 32 table rows. */
export const V1_REF_STRINGS: readonly string[] = REFS_TABLE
    .filter((row) => row.type !== UNIT_TYPE.commit)
    .map((row) => `${row.type}:${row.path}`)
    .filter((text) => !WALK_SKIPS.has(text))

/** A decimal type of 1-255 without leading zeros, `:`, and a non-empty path. */
const REF_STRING = /^([1-9][0-9]{0,2}):.+$/

function isWellFormedRef(text: string): boolean {
    const match = REF_STRING.exec(text)
    return match !== null && Number(match[1]) <= 255
}

export type RefsResult =
    | { kind: 'ok' }
    | { kind: 'newer', refs: string[] }
    | { kind: 'damaged', reason: string }

export interface RefsOptions {
    /** The strings this reader knows; defaults to `V1_REF_STRINGS`. */
    table?: readonly string[]
    /** Old spellings of renamed rows; a renamed path keeps its string as an alias. */
    aliases?: readonly string[]
}

export function checkRefs(refs: unknown, options: RefsOptions = {}): RefsResult {
    if (!Array.isArray(refs)) {
        return { kind: 'damaged', reason: 'meta.refs is not a list' }
    }
    const known = new Set<string>([...(options.table ?? V1_REF_STRINGS), ...(options.aliases ?? [])])
    const newer: string[] = []
    for (const item of refs as unknown[]) {
        if (typeof item !== 'string' || !isWellFormedRef(item)) {
            return { kind: 'damaged', reason: 'meta.refs holds an entry that is not <type>:<path>' }
        }
        if (!known.has(item) && !newer.includes(item)) {
            newer.push(item)
        }
    }
    return newer.length > 0 ? { kind: 'newer', refs: newer } : { kind: 'ok' }
}

/** The writer form of a refs list: sorted by the default string order, without repeats. */
export function normalizeRefs(refs: readonly string[]): string[] {
    return [...new Set(refs)].sort()
}

export type ReqResult =
    | { kind: 'ok' }
    | { kind: 'newer', tokens: string[] }
    | { kind: 'damaged', reason: string }

export function checkReqTokens(tokens: unknown, known: ReadonlySet<string> = KNOWN_REQ): ReqResult {
    if (!Array.isArray(tokens)) {
        return { kind: 'damaged', reason: 'req is not a list' }
    }
    const unknownTokens: string[] = []
    for (const token of tokens as unknown[]) {
        if (typeof token !== 'string') {
            return { kind: 'damaged', reason: 'req holds a token that is not a string' }
        }
        if (!known.has(token) && !unknownTokens.includes(token)) {
            unknownTokens.push(token)
        }
    }
    return unknownTokens.length > 0 ? { kind: 'newer', tokens: unknownTokens } : { kind: 'ok' }
}
