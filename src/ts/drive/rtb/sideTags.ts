/**
 * The closed tag list of side sections (A3.4, M13): the single tag `sv1`, which carries
 * any structured-clone-like value that is not JSON-exact (undefined, NaN, -0, bigint,
 * Date, RegExp, Map, Set, binary buffers and views, Blob and File).
 *
 * Payload: a u32 little-endian `J`, then `J` bytes of UTF-8 JSON (the value tree), then
 * the binary region. A tree node is a JSON string, boolean, null, finite number other
 * than -0, or an array of nodes; every other node is an object with a `"$"` kind.
 * Binary ranges `{o, n}` are consumed in walk order, each exactly once, so the decoded
 * binary is at most the region. The JSON of the tree is held to the same depth and node
 * bounds as a line. Objects are built with own properties, so a `__proto__` key stays
 * data. The tag list and this grammar freeze with the first writer that ships them; a
 * new type is a new tag.
 */
import {
    RtbSideBoundsError,
    SIDE_VALUE_MAX_DEPTH,
    SIDE_VALUE_MAX_NODES,
    scanSideJson,
    type SideTagCodec,
    type SideTagRegistry,
} from './sideLines'

export const SV1_TAG = 'sv1'

/** A payload this build cannot decode; `decodeSideLine` reports the line as damaged. */
export class RtbSideTagPayloadError extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'RtbSideTagPayloadError'
    }
}

/** A Blob or File read into memory, ready for the `sv1` encoder. */
export class SideBlobValue {
    readonly type: string
    readonly bytes: Uint8Array
    readonly file: { name: string, lastModified: number } | null

    constructor(type: string, bytes: Uint8Array, file: { name: string, lastModified: number } | null) {
        this.type = type
        this.bytes = bytes
        this.file = file
    }
}

const MAX_BIGINT_DIGITS = 4096
const MAX_DATE_MS = 8.64e15
const textEncoder = new TextEncoder()
const strictDecoder = new TextDecoder('utf-8', { fatal: true })
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
const BIGINT_TEXT = /^-?[0-9]+$/

type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array

interface TypedKind {
    name: string
    proto: object
    size: number
    make(buffer: ArrayBuffer): TypedArray
}

const TYPED_KINDS: readonly TypedKind[] = [
    { name: 'Int8Array', proto: Int8Array.prototype, size: 1, make: (b) => new Int8Array(b) },
    { name: 'Uint8Array', proto: Uint8Array.prototype, size: 1, make: (b) => new Uint8Array(b) },
    { name: 'Uint8ClampedArray', proto: Uint8ClampedArray.prototype, size: 1, make: (b) => new Uint8ClampedArray(b) },
    { name: 'Int16Array', proto: Int16Array.prototype, size: 2, make: (b) => new Int16Array(b) },
    { name: 'Uint16Array', proto: Uint16Array.prototype, size: 2, make: (b) => new Uint16Array(b) },
    { name: 'Int32Array', proto: Int32Array.prototype, size: 4, make: (b) => new Int32Array(b) },
    { name: 'Uint32Array', proto: Uint32Array.prototype, size: 4, make: (b) => new Uint32Array(b) },
    { name: 'Float32Array', proto: Float32Array.prototype, size: 4, make: (b) => new Float32Array(b) },
    { name: 'Float64Array', proto: Float64Array.prototype, size: 8, make: (b) => new Float64Array(b) },
    { name: 'BigInt64Array', proto: BigInt64Array.prototype, size: 8, make: (b) => new BigInt64Array(b) },
    { name: 'BigUint64Array', proto: BigUint64Array.prototype, size: 8, make: (b) => new BigUint64Array(b) },
]

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setOwn(target: object, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function hasOwn(target: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(target, key)
}

// ---------------------------------------------------------------- encoder

/** The value cannot travel under `sv1`; the encoder answers null. */
class Unsupported extends Error {}

interface EncodeState {
    parts: Uint8Array[]
    cursor: number
    nodes: number
}

function isIndexKey(key: string, length: number): boolean {
    const n = Number(key)
    return Number.isInteger(n) && n >= 0 && n < length && String(n) === key
}

function take(state: EncodeState, bytes: Uint8Array): { o: number, n: number } {
    const range = { o: state.cursor, n: bytes.length }
    state.parts.push(bytes)
    state.cursor += bytes.length
    return range
}

function viewBytes(view: ArrayBufferView): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

function encodeNode(value: unknown, depth: number, path: Set<object>, state: EncodeState): unknown {
    state.nodes++
    if (state.nodes > SIDE_VALUE_MAX_NODES) {
        throw new RtbSideBoundsError(`the value holds more than ${SIDE_VALUE_MAX_NODES} nodes`)
    }
    // The walk only keeps the recursion shallow; `depth` is the JSON level of this node, a
    // primitive adds no level of its own, and the exact bound is the scan of the finished JSON.
    if (depth > SIDE_VALUE_MAX_DEPTH + 1) {
        throw new RtbSideBoundsError(`the value nests deeper than ${SIDE_VALUE_MAX_DEPTH} levels`)
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return value
    }
    if (value === undefined) {
        return { $: 'u' }
    }
    if (typeof value === 'number') {
        if (Number.isFinite(value) && !Object.is(value, -0)) {
            return value
        }
        return { $: 'n', v: Object.is(value, -0) ? '-0' : String(value) }
    }
    if (typeof value === 'bigint') {
        const text = value.toString()
        if (text.replace('-', '').length > MAX_BIGINT_DIGITS) {
            throw new RtbSideBoundsError(`a bigint is longer than ${MAX_BIGINT_DIGITS} digits`)
        }
        return { $: 'bi', v: text }
    }
    if (typeof value !== 'object') {
        throw new Unsupported()
    }
    if (value instanceof SideBlobValue) {
        const range = take(state, value.bytes)
        return value.file === null
            ? { $: 'blob', t: value.type, o: range.o, n: range.n }
            : { $: 'file', t: value.type, nm: value.file.name, lm: value.file.lastModified, o: range.o, n: range.n }
    }
    const proto = Object.getPrototypeOf(value)
    if (proto === Date.prototype) {
        const time = (value as Date).getTime()
        return { $: 'd', v: Number.isFinite(time) ? time : null }
    }
    if (proto === RegExp.prototype) {
        const pattern = value as RegExp
        return { $: 're', s: pattern.source, f: pattern.flags }
    }
    if (proto === ArrayBuffer.prototype) {
        const range = take(state, new Uint8Array(value as ArrayBuffer))
        return { $: 'ab', o: range.o, n: range.n }
    }
    if (proto === DataView.prototype) {
        const range = take(state, viewBytes(value as DataView))
        return { $: 'dv', o: range.o, n: range.n }
    }
    const typed = TYPED_KINDS.find((kind) => kind.proto === proto)
    if (typed !== undefined) {
        if (typed.size > 1 && !LITTLE_ENDIAN) {
            throw new Unsupported()
        }
        const range = take(state, viewBytes(value as TypedArray))
        return { $: 'ta', c: typed.name, o: range.o, n: range.n }
    }
    if (path.has(value)) {
        throw new Unsupported()
    }
    path.add(value)
    try {
        if (proto === Map.prototype) {
            const entries: unknown[] = []
            for (const [k, v] of value as Map<unknown, unknown>) {
                entries.push([encodeNode(k, depth + 3, path, state), encodeNode(v, depth + 3, path, state)])
            }
            return { $: 'm', v: entries }
        }
        if (proto === Set.prototype) {
            const members: unknown[] = []
            for (const member of value as Set<unknown>) {
                members.push(encodeNode(member, depth + 2, path, state))
            }
            return { $: 's', v: members }
        }
        if (Array.isArray(value)) {
            if (Object.getOwnPropertySymbols(value).length > 0) {
                throw new Unsupported()
            }
            for (const key of Object.keys(value)) {
                if (!isIndexKey(key, value.length)) {
                    throw new Unsupported()
                }
            }
            const items: unknown[] = []
            for (let i = 0; i < value.length; i++) {
                if (i in value) {
                    items.push(encodeNode(value[i], depth + 1, path, state))
                } else {
                    state.nodes++
                    if (state.nodes > SIDE_VALUE_MAX_NODES) {
                        throw new RtbSideBoundsError(`the value holds more than ${SIDE_VALUE_MAX_NODES} nodes`)
                    }
                    items.push({ $: 'h' })
                }
            }
            return items
        }
        if ((proto === Object.prototype || proto === null) && Object.getOwnPropertySymbols(value).length === 0) {
            const fields: Record<string, unknown> = {}
            for (const key of Object.keys(value)) {
                setOwn(fields, key, encodeNode((value as Record<string, unknown>)[key], depth + 2, path, state))
            }
            return { $: 'o', v: fields }
        }
        throw new Unsupported()
    } finally {
        path.delete(value)
    }
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function encodeSv1(value: unknown): Uint8Array | null {
    const state: EncodeState = { parts: [], cursor: 0, nodes: 0 }
    let tree: unknown
    try {
        tree = encodeNode(value, 1, new Set<object>(), state)
    } catch (error) {
        if (error instanceof Unsupported) {
            return null
        }
        throw error
    }
    const text = JSON.stringify(tree)
    const scan = scanSideJson(text)
    if (!scan.ok) {
        throw new RtbSideBoundsError(scan.reason)
    }
    const json = textEncoder.encode(text)
    const head = new Uint8Array(4)
    new DataView(head.buffer).setUint32(0, json.length, true)
    return concat([head, json, ...state.parts], 4 + json.length + state.cursor)
}

// ---------------------------------------------------------------- decoder

interface DecodeState {
    region: Uint8Array
    cursor: number
}

function fail(reason: string): never {
    throw new RtbSideTagPayloadError(reason)
}

function takeRange(node: Record<string, unknown>, state: DecodeState): Uint8Array<ArrayBuffer> {
    const { o, n } = node
    if (typeof o !== 'number' || typeof n !== 'number' || !Number.isSafeInteger(o) || !Number.isSafeInteger(n) || o < 0 || n < 0) {
        fail('a binary range is not a pair of non-negative integers')
    }
    if (o !== state.cursor) {
        fail('the binary ranges are not contiguous in walk order')
    }
    if (o + n > state.region.length) {
        fail('a binary range runs past the region')
    }
    state.cursor += n
    // A copy, so the result is aligned and owns its buffer.
    const copy = new Uint8Array(n)
    copy.set(state.region.subarray(o, o + n))
    return copy
}

function stringField(node: Record<string, unknown>, key: string): string {
    const value = node[key]
    if (typeof value !== 'string') {
        fail(`the field ${key} is not a string`)
    }
    return value
}

function decodeNode(node: unknown, state: DecodeState): unknown {
    if (node === null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
        return node
    }
    if (Array.isArray(node)) {
        const out: unknown[] = new Array(node.length)
        for (let i = 0; i < node.length; i++) {
            const item: unknown = node[i]
            if (isRecord(item) && hasOwn(item, '$') && item.$ === 'h') {
                continue
            }
            out[i] = decodeNode(item, state)
        }
        return out
    }
    if (!isRecord(node) || !hasOwn(node, '$') || typeof node.$ !== 'string') {
        return fail('a node is an object without a kind')
    }
    switch (node.$) {
        case 'o': {
            const fields = node.v
            if (!isRecord(fields)) {
                return fail('an object node has no object value')
            }
            const out: Record<string, unknown> = {}
            for (const key of Object.keys(fields)) {
                setOwn(out, key, decodeNode(fields[key], state))
            }
            return out
        }
        case 'u':
            return undefined
        case 'n': {
            switch (node.v) {
                case 'NaN': return NaN
                case 'Infinity': return Infinity
                case '-Infinity': return -Infinity
                case '-0': return -0
                default: return fail('a number node holds an unknown value')
            }
        }
        case 'bi': {
            const text = stringField(node, 'v')
            if (text.replace('-', '').length > MAX_BIGINT_DIGITS || !BIGINT_TEXT.test(text)) {
                return fail('a bigint node is not a bounded decimal')
            }
            return BigInt(text)
        }
        case 'd': {
            const time = node.v
            if (time === null) {
                return new Date(NaN)
            }
            if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time) > MAX_DATE_MS) {
                return fail('a date node is out of range')
            }
            return new Date(time)
        }
        case 're': {
            try {
                return new RegExp(stringField(node, 's'), stringField(node, 'f'))
            } catch (error) {
                if (error instanceof RtbSideTagPayloadError) {
                    throw error
                }
                return fail('a RegExp node is not a valid pattern')
            }
        }
        case 'm': {
            const entries = node.v
            if (!Array.isArray(entries)) {
                return fail('a Map node has no entry list')
            }
            const out = new Map<unknown, unknown>()
            for (const entry of entries as unknown[]) {
                if (!Array.isArray(entry) || entry.length !== 2) {
                    return fail('a Map entry is not a pair')
                }
                const key = decodeNode(entry[0], state)
                out.set(key, decodeNode(entry[1], state))
            }
            return out
        }
        case 's': {
            const members = node.v
            if (!Array.isArray(members)) {
                return fail('a Set node has no member list')
            }
            const out = new Set<unknown>()
            for (const member of members as unknown[]) {
                out.add(decodeNode(member, state))
            }
            return out
        }
        case 'ab':
            return takeRange(node, state).buffer
        case 'ta': {
            const kind = TYPED_KINDS.find((candidate) => candidate.name === node.c)
            if (kind === undefined) {
                return fail('a typed array node names an unknown type')
            }
            if (kind.size > 1 && !LITTLE_ENDIAN) {
                return fail('this host cannot read a multi-byte typed array')
            }
            const bytes = takeRange(node, state)
            if (bytes.length % kind.size !== 0) {
                return fail('a typed array range is not a whole number of elements')
            }
            return kind.make(bytes.buffer as ArrayBuffer)
        }
        case 'dv':
            return new DataView(takeRange(node, state).buffer as ArrayBuffer)
        case 'blob': {
            const type = stringField(node, 't')
            return new Blob([takeRange(node, state)], { type })
        }
        case 'file': {
            const type = stringField(node, 't')
            const name = stringField(node, 'nm')
            const modified = node.lm
            if (typeof modified !== 'number' || !Number.isFinite(modified)) {
                return fail('a File node has no finite lastModified')
            }
            const bytes = takeRange(node, state)
            return typeof File === 'function'
                ? new File([bytes], name, { type, lastModified: modified })
                : new Blob([bytes], { type })
        }
        default:
            return fail(`a node has the unknown kind ${JSON.stringify(node.$)}`)
    }
}

function decodeSv1(bytes: Uint8Array): unknown {
    if (bytes.length < 4) {
        fail('the payload is shorter than its header')
    }
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
    if (jsonLength > bytes.length - 4) {
        fail('the JSON length runs past the payload')
    }
    let text: string
    try {
        text = strictDecoder.decode(bytes.subarray(4, 4 + jsonLength))
    } catch {
        return fail('the JSON is not UTF-8')
    }
    const scan = scanSideJson(text)
    if (!scan.ok) {
        return fail(scan.reason)
    }
    let tree: unknown
    try {
        tree = JSON.parse(text)
    } catch {
        return fail('the JSON does not parse')
    }
    const state: DecodeState = { region: bytes.subarray(4 + jsonLength), cursor: 0 }
    const value = decodeNode(tree, state)
    if (state.cursor !== state.region.length) {
        fail('the binary region holds bytes no range names')
    }
    return value
}

const SV1_CODEC: SideTagCodec = { tag: SV1_TAG, encode: encodeSv1, decode: decodeSv1 }

/** The closed v1 tag list: the only registry a side section is written or read with. */
export const RTB_SIDE_TAGS: SideTagRegistry = Object.freeze([SV1_CODEC])

// ---------------------------------------------------------------- Blob and File

async function readBlob(blob: Blob): Promise<SideBlobValue> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const file = typeof File === 'function' && blob instanceof File
        ? { name: blob.name, lastModified: blob.lastModified }
        : null
    return new SideBlobValue(blob.type, bytes, file)
}

async function prepareNode(value: unknown, depth: number, path: Set<object>): Promise<unknown> {
    if (typeof value !== 'object' || value === null) {
        return value
    }
    if (typeof Blob === 'function' && value instanceof Blob) {
        return await readBlob(value)
    }
    if (depth > SIDE_VALUE_MAX_DEPTH || path.has(value)) {
        return value
    }
    path.add(value)
    try {
        if (Array.isArray(value)) {
            let out: unknown[] | null = null
            for (let i = 0; i < value.length; i++) {
                if (!(i in value)) {
                    continue
                }
                const next = await prepareNode(value[i], depth + 1, path)
                if (next !== value[i]) {
                    out ??= value.slice()
                    out[i] = next
                }
            }
            return out ?? value
        }
        const proto = Object.getPrototypeOf(value)
        if (proto === Map.prototype) {
            const entries: [unknown, unknown][] = []
            let changed = false
            for (const [k, v] of value as Map<unknown, unknown>) {
                const nk = await prepareNode(k, depth + 1, path)
                const nv = await prepareNode(v, depth + 1, path)
                changed ||= nk !== k || nv !== v
                entries.push([nk, nv])
            }
            return changed ? new Map(entries) : value
        }
        if (proto === Set.prototype) {
            const members: unknown[] = []
            let changed = false
            for (const member of value as Set<unknown>) {
                const next = await prepareNode(member, depth + 1, path)
                changed ||= next !== member
                members.push(next)
            }
            return changed ? new Set(members) : value
        }
        if (proto === Object.prototype || proto === null) {
            const source = value as Record<string, unknown>
            const keys = Object.keys(source)
            let changed = false
            const next: unknown[] = []
            for (const key of keys) {
                const prepared = await prepareNode(source[key], depth + 1, path)
                changed ||= prepared !== source[key]
                next.push(prepared)
            }
            if (!changed) {
                return value
            }
            const out: Record<string, unknown> = Object.create(proto)
            keys.forEach((key, index) => setOwn(out, key, next[index]))
            return out
        }
        return value
    } finally {
        path.delete(value)
    }
}

/**
 * `value` with every Blob and File, at any depth (object fields, array items, Map keys
 * and values, Set members), replaced by a `SideBlobValue`. A path that holds none is
 * returned as the same object, so only the paths that hold one are copied.
 */
export function prepareSideValue(value: unknown): Promise<unknown> {
    return prepareNode(value, 1, new Set<object>())
}
