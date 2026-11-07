/**
 * The line format of a side section's `data.jsonl` (A3.4): one JSON object per line,
 * either `{"k": string, "j": JSON}` or `{"k": string, "t": tag, "b": base64}`.
 *
 * `j` is used only for a value that comes back from JSON exactly, so `-0`, `NaN`,
 * `undefined`, typed arrays and the like never travel as `j`. Anything else is written
 * under a tag by a codec of the injected registry; a value no codec takes fails the
 * export and names its key, because dropping it would lose data. The registry is
 * injected because the tag list is closed by the side stores' own stage.
 *
 * Reading skips a line whose tag the registry does not know and names its key, and
 * ignores fields it does not know. A line that is not JSON, has no string `k`, or has
 * neither `j` nor `t`, and a known tag with a payload that is not exact base64, are
 * damaged. When a line has both `j` and `t`, `j` is the value.
 */

export interface SideTagCodec {
    tag: string
    /** The bytes of `value` under this tag, or null when this codec does not take the value. */
    encode(value: unknown): Uint8Array | null
    decode(bytes: Uint8Array): unknown
}

export type SideTagRegistry = readonly SideTagCodec[]

export class RtbSideValueError extends Error {
    readonly key: string

    constructor(key: string) {
        super(`the side value for key ${JSON.stringify(key.length > 80 ? key.slice(0, 80) + '...' : key)} is neither JSON-exact nor taken by a tag codec`)
        this.name = 'RtbSideValueError'
        this.key = key
    }
}

const encoder = new TextEncoder()
const strictDecoder = new TextDecoder('utf-8', { fatal: true })

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

function pure(value: unknown, path: Set<object>): boolean {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return true
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) && !Object.is(value, -0)
    }
    if (typeof value !== 'object') {
        return false
    }
    if (path.has(value)) {
        return false
    }
    path.add(value)
    let ok = true
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length && ok; i++) {
            ok = pure(value[i], path)
        }
    } else if (isPlainObject(value) && Object.getOwnPropertySymbols(value).length === 0) {
        for (const key of Object.keys(value)) {
            if (!pure((value as Record<string, unknown>)[key], path)) {
                ok = false
                break
            }
        }
    } else {
        ok = false
    }
    path.delete(value)
    return ok
}

/** Whether `value` comes back equal from `JSON.parse(JSON.stringify(value))`. */
export function jsonRoundTrips(value: unknown): boolean {
    try {
        return pure(value, new Set<object>())
    } catch {
        return false
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let text = ''
    const step = 0x8000
    for (let at = 0; at < bytes.length; at += step) {
        text += String.fromCharCode(...bytes.subarray(at, at + step))
    }
    return btoa(text)
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function base64ToBytes(text: string): Uint8Array | null {
    if (text.length % 4 !== 0 || !BASE64.test(text)) {
        return null
    }
    let raw: string
    try {
        raw = atob(text)
    } catch {
        return null
    }
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) {
        out[i] = raw.charCodeAt(i)
    }
    return out
}

/** One line of a side section, including its newline. */
export function encodeSideLine(key: string, value: unknown, registry: SideTagRegistry = []): Uint8Array {
    if (jsonRoundTrips(value)) {
        return encoder.encode(`${JSON.stringify({ k: key, j: value })}\n`)
    }
    for (const codec of registry) {
        const bytes = codec.encode(value)
        if (bytes !== null) {
            return encoder.encode(`${JSON.stringify({ k: key, t: codec.tag, b: bytesToBase64(bytes) })}\n`)
        }
    }
    throw new RtbSideValueError(key)
}

export type SideLine =
    | { kind: 'value', key: string, value: unknown }
    | { kind: 'skipped', key: string, tag: string }
    | { kind: 'damaged', reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One line without its newline. */
export function decodeSideLine(text: string, registry: SideTagRegistry = []): SideLine {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return { kind: 'damaged', reason: 'the line is not JSON' }
    }
    if (!isRecord(parsed)) {
        return { kind: 'damaged', reason: 'the line is not a JSON object' }
    }
    const key = parsed.k
    if (typeof key !== 'string') {
        return { kind: 'damaged', reason: 'the line has no string k' }
    }
    if ('j' in parsed) {
        return { kind: 'value', key, value: parsed.j }
    }
    const tag = parsed.t
    if (typeof tag !== 'string') {
        return { kind: 'damaged', reason: `the line for key ${JSON.stringify(key)} has neither j nor t` }
    }
    const codec = registry.find((candidate) => candidate.tag === tag)
    if (!codec) {
        return { kind: 'skipped', key, tag }
    }
    const bytes = typeof parsed.b === 'string' ? base64ToBytes(parsed.b) : null
    if (bytes === null) {
        return { kind: 'damaged', reason: `the payload of key ${JSON.stringify(key)} is not exact base64` }
    }
    return { kind: 'value', key, value: codec.decode(bytes) }
}

export type SideLinesResult =
    | { kind: 'ok', values: { key: string, value: unknown }[], skipped: { key: string, tag: string }[] }
    | { kind: 'damaged', reason: string, line: number }

/** A whole section: lines split on newline, blank lines skipped, the first damaged line named by number. */
export function decodeSideLines(bytes: Uint8Array, registry: SideTagRegistry = []): SideLinesResult {
    let text: string
    try {
        text = strictDecoder.decode(bytes)
    } catch {
        return { kind: 'damaged', reason: 'the section is not UTF-8 text', line: 0 }
    }
    const values: { key: string, value: unknown }[] = []
    const skipped: { key: string, tag: string }[] = []
    const lines = text.split('\n')
    for (let n = 0; n < lines.length; n++) {
        const raw = lines[n].endsWith('\r') ? lines[n].slice(0, -1) : lines[n]
        if (raw.length === 0) {
            continue
        }
        const line = decodeSideLine(raw, registry)
        if (line.kind === 'damaged') {
            return { kind: 'damaged', reason: line.reason, line: n + 1 }
        }
        if (line.kind === 'skipped') {
            skipped.push({ key: line.key, tag: line.tag })
        } else {
            values.push({ key: line.key, value: line.value })
        }
    }
    return { kind: 'ok', values, skipped }
}
