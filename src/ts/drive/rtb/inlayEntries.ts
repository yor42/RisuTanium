/**
 * Inlay entries of an `.rtb` file (A3.3): `i/<enc>.meta`, a deflated `InlayRecord`
 * without its body key, and `i/<enc>.body`, the stored data, where `enc` is the
 * canonical `encodeInlayId` form of the id.
 *
 * The meta `v` is a format field frozen at `RTB_INLAY_META_V`. It is written from
 * that constant and never from the record: a record whose own `v` differs was made
 * for a different meta shape, and writing it under the old number would let an older
 * reader restore it wrongly, so the export fails and names the inlay. On read, any
 * other `v` is damaged. Fields of the meta this version does not know are kept.
 */
import type { InlayRecord } from '../../process/files/inlayStore'
import { inlayEntryName, parseInlayEntryName } from './entryNames'

export const RTB_INLAY_META_V = 1

export class RtbInlayVersionError extends Error {
    readonly id: string

    constructor(id: string, v: unknown) {
        super(`the inlay ${JSON.stringify(id.length > 80 ? id.slice(0, 80) + '...' : id)} has record version ${JSON.stringify(v)}, but this writer writes meta version ${RTB_INLAY_META_V}`)
        this.name = 'RtbInlayVersionError'
        this.id = id
    }
}

export class RtbInlayNameError extends Error {
    constructor(id: string) {
        super(`the inlay id ${JSON.stringify(id.length > 80 ? id.slice(0, 80) + '...' : id)} has no entry name`)
        this.name = 'RtbInlayNameError'
    }
}

const encoder = new TextEncoder()
const strictDecoder = new TextDecoder('utf-8', { fatal: true })
const REPRS: readonly string[] = ['blob', 'string', 'string16']

/** The deflated-entry bytes of the meta of `record`; `id` is named if the version is wrong. */
export function encodeInlayMeta(id: string, record: InlayRecord): Uint8Array {
    if ((record.v as unknown) !== RTB_INLAY_META_V) {
        throw new RtbInlayVersionError(id, record.v)
    }
    const meta: Record<string, unknown> = { v: RTB_INLAY_META_V }
    for (const key of Object.keys(record)) {
        if (key !== 'v' && key !== 'body') {
            meta[key] = (record as unknown as Record<string, unknown>)[key]
        }
    }
    return encoder.encode(JSON.stringify(meta))
}

export interface InlayMeta {
    v: 1
    repr: InlayRecord['repr']
    mime: string
    len: number
    fields: Record<string, unknown>
    /** Top-level fields this version does not know, kept as read. */
    unknown: Record<string, unknown>
}

export type InlayMetaResult =
    | { kind: 'ok', meta: InlayMeta }
    | { kind: 'damaged', reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRepr(value: unknown): value is InlayRecord['repr'] {
    return typeof value === 'string' && REPRS.includes(value)
}

/** Reads a meta; when `bodySize` is given, `len` must equal it. */
export function decodeInlayMeta(bytes: Uint8Array, bodySize?: number): InlayMetaResult {
    let value: unknown
    try {
        value = JSON.parse(strictDecoder.decode(bytes))
    } catch {
        return { kind: 'damaged', reason: 'the inlay meta is not UTF-8 JSON' }
    }
    if (!isRecord(value)) {
        return { kind: 'damaged', reason: 'the inlay meta is not a JSON object' }
    }
    if (value.v !== RTB_INLAY_META_V) {
        return { kind: 'damaged', reason: `the inlay meta version is ${JSON.stringify(value.v)}, not ${RTB_INLAY_META_V}` }
    }
    const { repr, mime, len, fields } = value
    if (!isRepr(repr)) {
        return { kind: 'damaged', reason: 'the inlay meta repr is not blob, string or string16' }
    }
    if (typeof mime !== 'string') {
        return { kind: 'damaged', reason: 'the inlay meta mime is not a string' }
    }
    if (typeof len !== 'number' || !Number.isSafeInteger(len) || len < 0) {
        return { kind: 'damaged', reason: 'the inlay meta len is not a non-negative integer' }
    }
    if (!isRecord(fields)) {
        return { kind: 'damaged', reason: 'the inlay meta fields are not an object' }
    }
    if (bodySize !== undefined && len !== bodySize) {
        return { kind: 'damaged', reason: `the inlay meta len is ${len} but the body is ${bodySize} bytes` }
    }
    const unknown: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
        if (key !== 'v' && key !== 'repr' && key !== 'mime' && key !== 'len' && key !== 'fields') {
            unknown[key] = value[key]
        }
    }
    return { kind: 'ok', meta: { v: RTB_INLAY_META_V, repr, mime, len, fields, unknown } }
}

export interface InlayEntryInfo {
    name: string
    /** Uncompressed size. */
    size: number
}

export interface InlayPair {
    id: string
    enc: string
    metaName: string
    bodyName: string
    bodySize: number
}

export type InlayPairing =
    | { kind: 'ok', pairs: InlayPair[] }
    | { kind: 'damaged', reason: string }

/** Names of the `.meta` and `.body` entries of `id`; throws when the id has no entry name. */
export function inlayEntryNames(id: string): { metaName: string, bodyName: string } {
    const metaName = inlayEntryName(id, 'meta')
    const bodyName = inlayEntryName(id, 'body')
    if (metaName === null || bodyName === null) {
        throw new RtbInlayNameError(id)
    }
    return { metaName, bodyName }
}

/** Pairs the entries under `i/`: exactly one canonical `.meta` and one `.body` per id. */
export function pairInlayEntries(entries: Iterable<InlayEntryInfo>): InlayPairing {
    const metas = new Map<string, string>()
    const bodies = new Map<string, { name: string, size: number }>()
    const encById = new Map<string, string>()
    for (const entry of entries) {
        const parsed = parseInlayEntryName(entry.name)
        if (parsed === null) {
            return { kind: 'damaged', reason: `${entry.name} is not a canonical inlay entry name` }
        }
        const holder = parsed.part === 'meta' ? metas : bodies
        if (holder.has(parsed.id)) {
            return { kind: 'damaged', reason: `${entry.name} appears twice` }
        }
        if (parsed.part === 'meta') {
            metas.set(parsed.id, entry.name)
        } else {
            bodies.set(parsed.id, { name: entry.name, size: entry.size })
        }
        encById.set(parsed.id, parsed.enc)
    }
    const pairs: InlayPair[] = []
    for (const [id, enc] of encById) {
        const metaName = metas.get(id)
        const body = bodies.get(id)
        if (metaName === undefined || body === undefined) {
            return { kind: 'damaged', reason: `the inlay ${enc} has ${metaName === undefined ? 'no .meta' : 'no .body'}` }
        }
        pairs.push({ id, enc, metaName, bodyName: body.name, bodySize: body.size })
    }
    return { kind: 'ok', pairs }
}
