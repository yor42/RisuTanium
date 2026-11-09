// The messages between the main-thread proxy and the worker host of the Studio history store, and the
// token rules both sides share. This module is imported by the main realm, so it holds no format logic:
// no serializer, planner, eviction function or database access, and only types from the port.
//
// An entry (a step, a deleted item or the restore point) is identified across the thread by a token. The
// proxy gives every entry object it sees a token once (`m<n>`); the worker gives the entries of a loaded
// record theirs (`w<n>`). A token stands for one object: an entry the model replaces is a new object and
// gets a new token, which is how the worker's adapter tells a changed entry from an unchanged one.

import type { DeletedItem, RestorePoint, Step } from './historyModel'
import type { OwnerKey } from './ownerPhase'
import type { LoadResult, OpenResult, SaveResult } from './studioHistoryStore'

export type Tok = string

export function proxyToken(counter: number): Tok {
    return `m${counter}`
}

export function workerToken(counter: number): Tok {
    return `w${counter}`
}

// An entry that crosses the thread: its kind, its token and the object itself.
export type PutEntry =
    | { k: 's'; tok: Tok; value: Step }
    | { k: 'd'; tok: Tok; value: DeletedItem }
    | { k: 'r'; tok: Tok; value: RestorePoint }

export interface OpenMessage {
    t: 'open'
    seq: number
}

export interface LoadMessage {
    t: 'load'
    seq: number
    owner: OwnerKey
}

// A path into an entry: object keys and array indexes.
export type EditKey = string | number

// One change to a base entry. Without a mode, the value replaces the value at the path, which must exist in
// the base. In `'add'` mode, the value is stored under a key the parent does not have yet.
export type Edit = [path: EditKey[], value: unknown, mode?: 'add']

// A changed step or restore point sent as the differences from an entry the worker already holds: `base` is
// the token of that entry, and `edits` list only the subtrees that are not the base's own.
export interface DeltaEntry {
    k: 's' | 'r'
    tok: Tok
    base: Tok
    edits: Edit[]
}

// `ownerKey` is the record's own key, forwarded apart from `owner` because the planners key on the
// record's and the eviction keys on `owner`. The four lists give the record's order; `put` holds the
// entries whose tokens the worker does not hold for this owner yet and that have no base to be sent
// against, and `delta` holds the others.
export interface SaveMessage {
    t: 'save'
    seq: number
    owner: OwnerKey
    ownerKey: OwnerKey
    touchedAt: number
    protect: OwnerKey[]
    done: Tok[]
    undone: Tok[]
    deleted: Tok[]
    restore: Tok | null
    put: PutEntry[]
    delta: DeltaEntry[]
}

export type ToWorker = OpenMessage | LoadMessage | SaveMessage

// The tokens of a loaded record, in record order.
export interface LoadTokens {
    done: Tok[]
    undone: Tok[]
    deleted: Tok[]
    restore: Tok | null
}

// `mirrorLost` answers a save that named a token the worker does not hold: nothing was written, and the
// proxy must post every entry of that owner next time.
export type SaveReply = SaveResult | { kind: 'unwritable'; mirrorLost: true }

export type FromWorker =
    | { t: 'ack'; seq: number; op: 'open'; reply: OpenResult }
    | { t: 'ack'; seq: number; op: 'load'; reply: LoadResult; tokens: LoadTokens | null }
    | { t: 'ack'; seq: number; op: 'save'; reply: SaveReply }
    // The adapter's connection closed (`versionchange` or `close`).
    | { t: 'closed' }
    // The worker cannot go on (a message it could not read).
    | { t: 'fatal' }

// ---------------------------------------------------------------- the delta codec
//
// A pure structural diff of two entries and its inverse. Nothing here knows the format: it sees objects,
// arrays and primitives. `applyEdits(base, diffEntry(next, base))` has the same keys, in the same order, and
// the same values as `next`, and an edit that does not fit its base throws, so a base that is not the one
// the edits were made against is never silently accepted.

// The deepest path a diff descends to. Model entries nest five levels at most; a node at this depth is
// sent whole.
export const MAX_DELTA_DEPTH = 8

type Container = Record<string, unknown> | unknown[]

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// The shape of a field value (`{ had }` or `{ had, value }`). A field value is replaced whole, so a step's
// `after` and the restore point's `last` stay one shared object in the message.
function isFieldValueShaped(keys: readonly string[]): boolean {
    return (keys.length === 1 && keys[0] === 'had') || (keys.length === 2 && keys[0] === 'had' && keys[1] === 'value')
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, at) => key === b[at])
}

function isStrictPrefix(prefix: readonly string[], keys: readonly string[]): boolean {
    return prefix.length < keys.length && prefix.every((key, at) => key === keys[at])
}

function diffNode(path: EditKey[], next: unknown, base: unknown, depth: number, out: Edit[]): void {
    if (next === base) {
        return
    }
    if (depth < MAX_DELTA_DEPTH) {
        if (Array.isArray(next) && Array.isArray(base) && next.length === base.length) {
            next.forEach((item: unknown, at) => diffNode([...path, at], item, base[at], depth + 1, out))
            return
        }
        if (isPlainObject(next) && isPlainObject(base)) {
            const nextKeys = Object.keys(next)
            const baseKeys = Object.keys(base)
            if (!isFieldValueShaped(nextKeys) && !isFieldValueShaped(baseKeys)) {
                if (sameKeys(nextKeys, baseKeys)) {
                    nextKeys.forEach((key) => diffNode([...path, key], next[key], base[key], depth + 1, out))
                    return
                }
                // Key growth at the end: the base's keys keep their order and the new keys come after them, so
                // appending the added keys in this order gives the next object's key order.
                const added = nextKeys.slice(baseKeys.length)
                if (isStrictPrefix(baseKeys, nextKeys) && !added.includes('__proto__')) {
                    baseKeys.forEach((key) => diffNode([...path, key], next[key], base[key], depth + 1, out))
                    added.forEach((key) => out.push([[...path, key], next[key], 'add']))
                    return
                }
            }
        }
    }
    out.push([path, next])
}

// The edits that turn `base` into `next`, or null when the roots are not plain objects with the same keys in
// the same order (the entry then travels whole). A root never grows keys.
export function diffEntry(next: object, base: object): Edit[] | null {
    if (!isPlainObject(next) || !isPlainObject(base)) {
        return null
    }
    const nextKeys = Object.keys(next)
    if (!sameKeys(nextKeys, Object.keys(base))) {
        return null
    }
    const out: Edit[] = []
    nextKeys.forEach((key) => diffNode([key], next[key], base[key], 1, out))
    return out
}

function copyContainer(value: unknown): Container {
    if (Array.isArray(value)) {
        return value.slice()
    }
    if (isPlainObject(value)) {
        return { ...value }
    }
    throw new Error('delta path does not lead through a container')
}

// Whether the container has the slot as its own: an array's by index, an object's by string key.
function hasSlot(container: Container, key: EditKey): boolean {
    return Array.isArray(container)
        ? typeof key === 'number' && Object.hasOwn(container, key)
        : typeof key === 'string' && Object.hasOwn(container, key)
}

function slotValue(container: Container, key: EditKey): unknown {
    if (Array.isArray(container)) {
        return typeof key === 'number' ? container[key] : undefined
    }
    return typeof key === 'string' ? container[key] : undefined
}

function setSlot(container: Container, key: EditKey, value: unknown): void {
    if (Array.isArray(container)) {
        if (typeof key === 'number') {
            container[key] = value
        }
    } else if (typeof key === 'string') {
        container[key] = value
    }
}

// Applies the edits to copies: the base is never mutated, each container on an edit path is copied once per
// call, and every untouched subtree is shared with the base. Throws on an edit that does not fit.
export function applyEdits<T extends object>(base: T, edits: readonly Edit[]): T {
    const copies = new Set<object>()
    const root = copyContainer(base)
    copies.add(root)
    // The container under the key, copied into its parent on first use and reused after that.
    const descend = (parent: Container, key: EditKey): Container => {
        const child = slotValue(parent, key)
        if (typeof child === 'object' && child !== null && copies.has(child)) {
            return child as Container
        }
        const copy = copyContainer(child)
        copies.add(copy)
        setSlot(parent, key, copy)
        return copy
    }
    for (const edit of edits) {
        const path: unknown = edit[0]
        const value: unknown = edit[1]
        const mode: unknown = edit[2]
        if (!Array.isArray(path) || path.length === 0 || (mode !== undefined && mode !== 'add')) {
            throw new Error('malformed delta edit')
        }
        let parent = root
        for (const key of path.slice(0, -1) as EditKey[]) {
            if (!hasSlot(parent, key)) {
                throw new Error('delta path is not in the base')
            }
            parent = descend(parent, key)
        }
        const last = path[path.length - 1] as EditKey
        if (mode === 'add') {
            if (Array.isArray(parent) || typeof last !== 'string' || last === '__proto__' || Object.hasOwn(parent, last)) {
                throw new Error('delta add does not fit its parent')
            }
            parent[last] = value
        } else {
            if (!hasSlot(parent, last)) {
                throw new Error('delta path is not in the base')
            }
            setSlot(parent, last, value)
        }
    }
    return root as T
}

interface Tagged {
    t?: unknown
    seq?: unknown
    op?: unknown
}

function tagged(data: unknown): Tagged | null {
    return typeof data === 'object' && data !== null ? data : null
}

// The message boundary. Only the tags are checked here. Any other malformation is an exception of that one
// message: the host's handler answers it as a failure, and the proxy answers the matching pending call as
// failed.
export function parseToWorker(data: unknown): ToWorker | null {
    const message = tagged(data)
    if (!message || typeof message.seq !== 'number') {
        return null
    }
    if (message.t === 'open' || message.t === 'load' || message.t === 'save') {
        return data as ToWorker
    }
    return null
}

export function parseFromWorker(data: unknown): FromWorker | null {
    const message = tagged(data)
    if (!message) {
        return null
    }
    if (message.t === 'closed' || message.t === 'fatal') {
        return data as FromWorker
    }
    if (message.t === 'ack' && typeof message.seq === 'number' && (message.op === 'open' || message.op === 'load' || message.op === 'save')) {
        return data as FromWorker
    }
    return null
}
