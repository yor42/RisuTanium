// Pure model of one Studio owner's history: the closed field union, the stored record shape with
// its strict guards, and every state transition (edit, undo, redo, revert, restore point, deleted
// items). It never reads a clock, a global or the live character: the live values reach it
// through a `LiveReader` snapshot, and the writes it decides on leave it as `WriteOp`s.

import { fingerprintElement, listFingerprintOf, mixElementHashes, type ElementHash, type ListElementHash } from './listFingerprint'
import { parseOwnerKey, type OwnerKey } from './ownerPhase'

// Typing in one field extends the open step while each write follows the previous one by less
// than this. The model never reads Date.now: callers pass `now`.
export const COALESCE_MS = 1000
export const MAX_DONE = 100
export const MAX_UNDONE = 100
export const MAX_DELETED = 50

// Injected into the service and the ack; the model itself only takes `now` values.
export interface HistoryClock {
    now(): number
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
}

// ---------------------------------------------------------------- field paths and values

export type CharacterField = 'desc' | 'hideChatIcon'
export type ChatField = 'note'
export type SetPath = CharacterField | ChatField
export type ListPath = 'alternateGreetings'
export type RestorePath = SetPath | ListPath

export const CHARACTER_SET_PATHS: readonly CharacterField[] = ['desc', 'hideChatIcon']
export const CHAT_SET_PATHS: readonly ChatField[] = ['note']
export const LIST_PATH: ListPath = 'alternateGreetings'
const RESTORE_PATH_ORDER: readonly RestorePath[] = ['desc', 'hideChatIcon', 'note', 'alternateGreetings']

// `had: false` is an absent optional key. Writing it deletes the key; it never assigns false or undefined.
export type FieldValue = { had: false } | { had: true; value: string | boolean }
export type FmValue = { had: false } | { had: true; value: number }

export function fieldValueEquals(a: FieldValue, b: FieldValue): boolean {
    if (!a.had || !b.had) {
        return a.had === b.had
    }
    return a.value === b.value
}

function fmValueEquals(a: FmValue, b: FmValue): boolean {
    if (!a.had || !b.had) {
        return a.had === b.had
    }
    return a.value === b.value
}

export type StepLabel =
    | { kind: 'field'; field: SetPath }
    | { kind: 'greetingAdd' }
    | { kind: 'greetingRemove' }
    | { kind: 'greetingEdit' }
    | { kind: 'restorePoint' }
    | { kind: 'revert'; toStepId: string }
    | { kind: 'restoreDeleted'; deletedId: string }

export type Op =
    | { op: 'set'; path: SetPath; before: FieldValue; after: FieldValue }
    | { op: 'listSet'; index: number; before: string; after: string }
    // `deletedId` marks an insert that consumes the deleted item with that id; a plain insert has none.
    | { op: 'listInsert'; index: number; value: string; deletedId?: string }
    // `deletedId` links a delete to its deleted item; a removal made by a restore or a revert has none.
    | { op: 'listRemove'; index: number; value: string; deletedId: string | null }
    // `chatId: null` stands for a chat without a unique id: the side effect happened by index and cannot be replayed.
    | { op: 'chatFm'; chatId: string | null; before: FmValue; after: FmValue }

// Fingerprints of the whole greeting list on the two sides of the step's list ops: `before` is the
// list its forward ops start from, `after` the list they produce.
export interface ListFingerprint {
    before: number
    after: number
}

export interface Step {
    id: string
    at: number
    label: StepLabel
    ops: Op[]
    // Present exactly when the stored ops hold a listInsert or listRemove and the list was known.
    listFingerprint?: ListFingerprint
}

export interface DeletedItem {
    id: string
    at: number
    index: number
    value: string
    sideChat: { chatId: string; before: FmValue } | null
}

export type RestoreValue = FieldValue | { list: string[] }

export interface RestoreField {
    before: RestoreValue
    last: RestoreValue
}

export interface RestorePoint {
    visitId: string
    at: number
    fields: Partial<Record<RestorePath, RestoreField>>
}

// The unit the store port saves.
export interface OwnerRecord {
    ownerKey: OwnerKey
    touchedAt: number
    done: Step[]
    undone: Step[]
    deleted: DeletedItem[]
    restore: RestorePoint | null
}

export function emptyRecord(ownerKey: OwnerKey, touchedAt: number): OwnerRecord {
    return { ownerKey, touchedAt, done: [], undone: [], deleted: [], restore: null }
}

// 16 random bytes, hex. crypto.randomUUID is secure-context only, getRandomValues is not.
export function createPageSession(getRandomValues: (bytes: Uint8Array) => Uint8Array): string {
    const bytes = getRandomValues(new Uint8Array(16))
    let out = ''
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0')
    }
    return out
}

export function stepIdFor(pageSession: string, counter: number): string {
    return `${pageSession}:${counter}`
}

// ---------------------------------------------------------------- strict guards (stored bytes)

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIndex(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

// A string or null; undefined when the value is neither.
function nullableString(value: unknown): string | null | undefined {
    if (value === null) {
        return null
    }
    return typeof value === 'string' ? value : undefined
}

function isSetPath(value: unknown): value is SetPath {
    return value === 'desc' || value === 'hideChatIcon' || value === 'note'
}

function parseFieldValue(path: SetPath, value: unknown): FieldValue | null {
    if (!isObject(value)) {
        return null
    }
    if (value.had === false) {
        return { had: false }
    }
    if (value.had !== true) {
        return null
    }
    if (path === 'hideChatIcon') {
        return typeof value.value === 'boolean' ? { had: true, value: value.value } : null
    }
    return typeof value.value === 'string' ? { had: true, value: value.value } : null
}

function parseFmValue(value: unknown): FmValue | null {
    if (!isObject(value)) {
        return null
    }
    if (value.had === false) {
        return { had: false }
    }
    return value.had === true && isFiniteNumber(value.value) ? { had: true, value: value.value } : null
}

function parseLabel(value: unknown): StepLabel | null {
    if (!isObject(value)) {
        return null
    }
    switch (value.kind) {
        case 'field':
            return isSetPath(value.field) ? { kind: 'field', field: value.field } : null
        case 'greetingAdd':
        case 'greetingRemove':
        case 'greetingEdit':
        case 'restorePoint':
            return { kind: value.kind }
        case 'revert':
            return typeof value.toStepId === 'string' ? { kind: 'revert', toStepId: value.toStepId } : null
        case 'restoreDeleted':
            return typeof value.deletedId === 'string' ? { kind: 'restoreDeleted', deletedId: value.deletedId } : null
        default:
            return null
    }
}

type OwnerKind = 'character' | 'chat'

function parseOp(value: unknown, kind: OwnerKind): Op | null {
    if (!isObject(value)) {
        return null
    }
    if (value.op === 'set') {
        if (!isSetPath(value.path)) {
            return null
        }
        const allowed = kind === 'chat' ? CHAT_SET_PATHS : CHARACTER_SET_PATHS
        if (!(allowed as readonly string[]).includes(value.path)) {
            return null
        }
        const before = parseFieldValue(value.path, value.before)
        const after = parseFieldValue(value.path, value.after)
        return before && after ? { op: 'set', path: value.path, before, after } : null
    }
    if (kind === 'chat') {
        return null
    }
    switch (value.op) {
        case 'listSet':
            return isIndex(value.index) && typeof value.before === 'string' && typeof value.after === 'string'
                ? { op: 'listSet', index: value.index, before: value.before, after: value.after }
                : null
        case 'listInsert':
            if (!isIndex(value.index) || typeof value.value !== 'string') {
                return null
            }
            // Absent on a plain insert. A present value must be a string; null is not a tag.
            if (value.deletedId === undefined) {
                return { op: 'listInsert', index: value.index, value: value.value }
            }
            return typeof value.deletedId === 'string'
                ? { op: 'listInsert', index: value.index, value: value.value, deletedId: value.deletedId }
                : null
        case 'listRemove': {
            const deletedId = nullableString(value.deletedId)
            if (!isIndex(value.index) || typeof value.value !== 'string' || deletedId === undefined) {
                return null
            }
            return { op: 'listRemove', index: value.index, value: value.value, deletedId }
        }
        case 'chatFm': {
            const chatId = nullableString(value.chatId)
            if (chatId === undefined) {
                return null
            }
            const before = parseFmValue(value.before)
            const after = parseFmValue(value.after)
            return before && after ? { op: 'chatFm', chatId, before, after } : null
        }
        default:
            return null
    }
}

function parseStep(value: unknown, kind: OwnerKind): Step | null {
    if (!isObject(value) || typeof value.id !== 'string' || !isFiniteNumber(value.at) || !Array.isArray(value.ops)) {
        return null
    }
    const label = parseLabel(value.label)
    if (!label) {
        return null
    }
    const ops: Op[] = []
    for (const raw of value.ops) {
        const op = parseOp(raw, kind)
        if (!op) {
            return null
        }
        ops.push(op)
    }
    // Absent on a step written before the field existed. Any other present value, and any value on a
    // chat owner, makes the record unreadable.
    if (value.listFingerprint === undefined) {
        return { id: value.id, at: value.at, label, ops }
    }
    const fingerprint = kind === 'chat' ? null : parseListFingerprint(value.listFingerprint)
    return fingerprint ? { id: value.id, at: value.at, label, ops, listFingerprint: fingerprint } : null
}

function isHash(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseListFingerprint(value: unknown): ListFingerprint | null {
    if (!isObject(value) || !isHash(value.before) || !isHash(value.after)) {
        return null
    }
    return { before: value.before, after: value.after }
}

function parseDeleted(value: unknown): DeletedItem | null {
    if (
        !isObject(value) ||
        typeof value.id !== 'string' ||
        !isFiniteNumber(value.at) ||
        !isIndex(value.index) ||
        typeof value.value !== 'string'
    ) {
        return null
    }
    if (value.sideChat === null) {
        return { id: value.id, at: value.at, index: value.index, value: value.value, sideChat: null }
    }
    if (!isObject(value.sideChat) || typeof value.sideChat.chatId !== 'string') {
        return null
    }
    const before = parseFmValue(value.sideChat.before)
    return before
        ? {
              id: value.id,
              at: value.at,
              index: value.index,
              value: value.value,
              sideChat: { chatId: value.sideChat.chatId, before },
          }
        : null
}

function parseRestoreValue(path: RestorePath, value: unknown): RestoreValue | null {
    if (path === LIST_PATH) {
        if (!isObject(value) || !Array.isArray(value.list)) {
            return null
        }
        return value.list.every((item) => typeof item === 'string') ? { list: [...(value.list as string[])] } : null
    }
    return parseFieldValue(path, value)
}

function parseRestore(value: unknown, kind: OwnerKind): RestorePoint | null {
    if (
        !isObject(value) ||
        typeof value.visitId !== 'string' ||
        !isFiniteNumber(value.at) ||
        !isObject(value.fields)
    ) {
        return null
    }
    const allowed: readonly RestorePath[] = kind === 'chat' ? ['note'] : ['desc', 'hideChatIcon', LIST_PATH]
    const fields: Partial<Record<RestorePath, RestoreField>> = {}
    for (const key of Object.keys(value.fields)) {
        if (!(allowed as readonly string[]).includes(key)) {
            return null
        }
        const path = key as RestorePath
        const raw = value.fields[key]
        if (!isObject(raw)) {
            return null
        }
        const before = parseRestoreValue(path, raw.before)
        const last = parseRestoreValue(path, raw.last)
        if (!before || !last) {
            return null
        }
        fields[path] = { before, last }
    }
    return { visitId: value.visitId, at: value.at, fields }
}

// Strict reader of the record fields. Anything outside the closed union (an unknown op or path,
// a wrong type, an owner key that differs from the expected one) makes the whole record unreadable.
export function parseOwnerRecord(value: unknown, ownerKey: OwnerKey): OwnerRecord | null {
    const parsedKey = parseOwnerKey(ownerKey)
    if (!parsedKey || !isObject(value) || value.ownerKey !== ownerKey || !isFiniteNumber(value.touchedAt)) {
        return null
    }
    if (!Array.isArray(value.done) || !Array.isArray(value.undone) || !Array.isArray(value.deleted)) {
        return null
    }
    const kind = parsedKey.kind
    const done: Step[] = []
    const undone: Step[] = []
    const deleted: DeletedItem[] = []
    for (const raw of value.done) {
        const step = parseStep(raw, kind)
        if (!step) {
            return null
        }
        done.push(step)
    }
    for (const raw of value.undone) {
        const step = parseStep(raw, kind)
        if (!step) {
            return null
        }
        undone.push(step)
    }
    for (const raw of value.deleted) {
        const item = parseDeleted(raw)
        if (!item || kind === 'chat') {
            return null
        }
        deleted.push(item)
    }
    let restore: RestorePoint | null = null
    if (value.restore !== null) {
        restore = parseRestore(value.restore, kind)
        if (!restore) {
            return null
        }
    }
    return { ownerKey, touchedAt: value.touchedAt, done, undone, deleted, restore }
}

// ---------------------------------------------------------------- live snapshot and replay planning

// The live values the plan checks its preconditions against. Studio supplies a reader over the
// live character; a plan reads each value once and then works on its own copy.
export interface LiveReader {
    field(path: SetPath): FieldValue
    greetings(): readonly string[] | null
    // The live `fmIndex` of the chat with this unique id, or null when no such chat is found.
    fmIndex(chatId: string): FmValue | null
}

export type WriteOp =
    | { op: 'set'; path: SetPath; value: FieldValue }
    | { op: 'listSet'; index: number; value: string }
    | { op: 'listInsert'; index: number; value: string }
    | { op: 'listRemove'; index: number }
    | { op: 'chatFm'; chatId: string; value: FmValue }

export interface RestoreWrite {
    path: RestorePath
    before: RestoreValue
    after: RestoreValue
}

// `unchanged` is returned by planRevert only: the revert's net effect is nothing. It is an in-memory
// result and is never stored or posted.
export type ModelRefusal = 'empty' | 'unknown' | 'precondition' | 'unchanged'

export interface StepPlan {
    ok: true
    label: StepLabel
    // The ops of the step this plan records (forward direction). For a replay these are the
    // original ops that applied, in the step's own order.
    ops: Op[]
    // The writes to hand to the one live write call, in execution order.
    writes: WriteOp[]
    restoreWrites: RestoreWrite[]
    // Deleted items consumed by this plan.
    deletedRemove: string[]
    skipped: number
    // True when a chat-side effect could not be replayed (the chat has no unique id).
    fmNotRestored: boolean
    // Revert only: list ops the revert did not apply because their step's list did not fit or the
    // per-op check failed. Absent when none.
    listSkipped?: number
    // Fingerprints of the live list before the plan's ops and, after them: a revert's final fill, or
    // for a whole expected-side replay the step's other-side fingerprint. They only let the commit or
    // the move reuse a hash the plan already holds; they are never stored or posted.
    liveListHash?: number
    afterListHash?: number
}

export type PlanResult =
    | StepPlan
    | { ok: false; reason: Exclude<ModelRefusal, 'unchanged'> }
    | { ok: false; reason: 'unchanged'; listSkipped?: number; fmNotRestored?: boolean }

interface Working {
    field(path: SetPath): FieldValue
    setField(path: SetPath, value: FieldValue): void
    list: string[] | null
    fm(chatId: string): FmValue | null
    setFm(chatId: string, value: FmValue): void
}

function makeWorking(live: LiveReader): Working {
    const fields = new Map<SetPath, FieldValue>()
    const fms = new Map<string, FmValue | null>()
    const greetings = live.greetings()
    return {
        field(path) {
            let value = fields.get(path)
            if (!value) {
                value = live.field(path)
                fields.set(path, value)
            }
            return value
        },
        setField(path, value) {
            fields.set(path, value)
        },
        list: greetings === null ? null : [...greetings],
        fm(chatId) {
            if (!fms.has(chatId)) {
                fms.set(chatId, live.fmIndex(chatId))
            }
            return fms.get(chatId) ?? null
        },
        setFm(chatId, value) {
            fms.set(chatId, value)
        },
    }
}

export function invertOp(op: Op): Op {
    switch (op.op) {
        case 'set':
            return { op: 'set', path: op.path, before: op.after, after: op.before }
        case 'listSet':
            return { op: 'listSet', index: op.index, before: op.after, after: op.before }
        case 'listInsert':
            return { op: 'listRemove', index: op.index, value: op.value, deletedId: op.deletedId ?? null }
        case 'listRemove':
            return op.deletedId === null
                ? { op: 'listInsert', index: op.index, value: op.value }
                : { op: 'listInsert', index: op.index, value: op.value, deletedId: op.deletedId }
        case 'chatFm':
            return { op: 'chatFm', chatId: op.chatId, before: op.after, after: op.before }
    }
}

type ApplyOutcome = { kind: 'applied'; write: WriteOp } | { kind: 'inert' } | { kind: 'failed' }

// Checks one forward op's precondition against the working copy and applies it there.
function applyForward(op: Op, working: Working): ApplyOutcome {
    switch (op.op) {
        case 'set':
            if (!fieldValueEquals(working.field(op.path), op.before)) {
                return { kind: 'failed' }
            }
            working.setField(op.path, op.after)
            return { kind: 'applied', write: { op: 'set', path: op.path, value: op.after } }
        case 'listSet':
            if (!working.list || working.list[op.index] !== op.before) {
                return { kind: 'failed' }
            }
            working.list[op.index] = op.after
            return { kind: 'applied', write: { op: 'listSet', index: op.index, value: op.after } }
        case 'listInsert':
            if (!working.list || op.index > working.list.length) {
                return { kind: 'failed' }
            }
            working.list.splice(op.index, 0, op.value)
            return { kind: 'applied', write: { op: 'listInsert', index: op.index, value: op.value } }
        case 'listRemove':
            if (!working.list || working.list[op.index] !== op.value) {
                return { kind: 'failed' }
            }
            working.list.splice(op.index, 1)
            return { kind: 'applied', write: { op: 'listRemove', index: op.index } }
        case 'chatFm': {
            if (op.chatId === null) {
                return { kind: 'inert' }
            }
            const current = working.fm(op.chatId)
            if (!current || !fmValueEquals(current, op.before)) {
                return { kind: 'failed' }
            }
            working.setFm(op.chatId, op.after)
            return { kind: 'applied', write: { op: 'chatFm', chatId: op.chatId, value: op.after } }
        }
    }
}

// What the restore point must learn from a set of forward ops. List ops collapse into one
// whole-array write because the restore point stores the whole greeting list.
export function deriveRestoreWrites(forwardOps: readonly Op[], greetingsBefore: readonly string[] | null): RestoreWrite[] {
    const byPath = new Map<SetPath, RestoreWrite>()
    let list: string[] | null = greetingsBefore === null ? null : [...greetingsBefore]
    let listTouched = false
    for (const op of forwardOps) {
        if (op.op === 'set') {
            const known = byPath.get(op.path)
            byPath.set(op.path, {
                path: op.path,
                before: known ? known.before : op.before,
                after: op.after,
            })
        } else if (op.op === 'listSet') {
            listTouched = true
            if (list) {
                list[op.index] = op.after
            }
        } else if (op.op === 'listInsert') {
            listTouched = true
            list?.splice(op.index, 0, op.value)
        } else if (op.op === 'listRemove') {
            listTouched = true
            list?.splice(op.index, 1)
        }
    }
    const writes: RestoreWrite[] = [...byPath.values()]
    if (listTouched && list && greetingsBefore) {
        writes.push({ path: LIST_PATH, before: { list: [...greetingsBefore] }, after: { list } })
    }
    return writes
}

function hasDeletedId(record: OwnerRecord, id: string): boolean {
    return record.deleted.some((item) => item.id === id)
}

// ---------------------------------------------------------------- list fingerprint decision

// Which side of a fingerprinted step the list is on. `none`: the step has no fingerprint (or the
// list cannot be read), so its list ops keep the per-op checks.
export type ListSide = 'expected' | 'other' | 'neither' | 'none'

function sideFromHash(fingerprint: ListFingerprint, direction: 'undo' | 'redo', hash: number): ListSide {
    const expected = direction === 'undo' ? fingerprint.after : fingerprint.before
    const other = direction === 'undo' ? fingerprint.before : fingerprint.after
    // Expected first: a step whose two sides are equal must still apply.
    if (hash === expected) {
        return 'expected'
    }
    return hash === other ? 'other' : 'neither'
}

export function listSideOf(step: Step, direction: 'undo' | 'redo', list: readonly unknown[] | null): ListSide {
    if (!step.listFingerprint || list === null) {
        return 'none'
    }
    return sideFromHash(step.listFingerprint, direction, listFingerprintOf(list))
}

function isListOp(op: Op): boolean {
    return op.op === 'listSet' || op.op === 'listInsert' || op.op === 'listRemove'
}

function hasInsertOrRemove(ops: readonly Op[]): boolean {
    return ops.some((op) => op.op === 'listInsert' || op.op === 'listRemove')
}

function listRestoreWrite(writes: readonly RestoreWrite[]): { before: string[]; after: string[] } | null {
    const write = writes.find((entry) => entry.path === LIST_PATH)
    return write && 'list' in write.before && 'list' in write.after ? { before: write.before.list, after: write.after.list } : null
}

// ---------------------------------------------------------------- list hash tracker

// Element hashes of a working list kept in step with its ops. An applied listSet or listInsert only
// marks its slot; a marked slot is hashed when the list is next hashed, so a run of edits to one
// slot costs one element hash. Never stored or posted; it lives inside one planRevert call.
export interface ListHashTracker {
    set(index: number): void
    insert(index: number): void
    remove(index: number): void
    // UTF-16 units that `hash` would have to read now. Hashes nothing.
    pendingUnits(list: readonly unknown[]): number
    // Equals `listFingerprintOf(list)` when the marks follow every change made to `list`.
    hash(list: readonly unknown[]): number
}

export function createListHashTracker(list: readonly unknown[], elementHash: ElementHash = fingerprintElement): ListHashTracker {
    const slots: (number | undefined)[] = []
    for (let i = 0; i < list.length; i++) {
        slots.push(elementHash(list[i]))
    }
    return {
        set(index) {
            slots[index] = undefined
        },
        insert(index) {
            slots.splice(index, 0, undefined)
        },
        remove(index) {
            slots.splice(index, 1)
        },
        pendingUnits(current) {
            let units = 0
            for (let i = 0; i < slots.length; i++) {
                if (slots[i] === undefined) {
                    const value = current[i]
                    units += typeof value === 'string' ? value.length : ('\u0000' + typeof value).length
                }
            }
            return units
        },
        hash(current) {
            const filled: number[] = new Array<number>(slots.length)
            for (let i = 0; i < slots.length; i++) {
                let element = slots[i]
                if (element === undefined) {
                    element = elementHash(current[i])
                    slots[i] = element
                }
                filled[i] = element
            }
            return mixElementHashes(filled)
        },
    }
}

// Hashing units one revert may spend on its step decisions. Once a decision would pass it, the
// rest of that revert decides by the per-op checks alone.
export const REVERT_HASH_BUDGET_UNITS = 500_000

// Replays the top step of `done` (undo) or `undone` (redo). Every op is checked against the live
// value it would overwrite; ops whose precondition fails are skipped, which keeps a value changed
// elsewhere. When nothing applies the replay is refused and the stacks stay as they are.
export function planReplay(record: OwnerRecord, direction: 'undo' | 'redo', live: LiveReader, hashFor?: ListElementHash): PlanResult {
    const stack = direction === 'undo' ? record.done : record.undone
    const step = stack[stack.length - 1]
    if (!step) {
        return { ok: false, reason: 'empty' }
    }
    const working = makeWorking(live)
    const greetingsBefore = working.list ? [...working.list] : null
    // One decision before any op runs, so the hash is of the list the plan starts from.
    const hash = step.listFingerprint && working.list !== null ? listFingerprintOf(working.list, hashFor?.(working.list)) : undefined
    const side: ListSide = step.listFingerprint && hash !== undefined ? sideFromHash(step.listFingerprint, direction, hash) : 'none'
    // Exact or nothing: a fingerprinted step whose list is not the side it was recorded at applies
    // no op, so no chat index or field lands against a list the step never described. The step
    // stays on its stack, so Undo stops at it until the list is repaired by hand or 100 newer
    // steps push the step out. Steps without a fingerprint keep the per-op checks. An expected-side
    // replay whose chat op fails stays partial: only the list witnesses a fingerprint.
    if (side === 'other' || side === 'neither') {
        return { ok: false, reason: 'precondition' }
    }
    const order = direction === 'undo' ? [...step.ops].reverse() : step.ops
    const applied: Op[] = []
    const executed: Op[] = []
    const writes: WriteOp[] = []
    const deletedRemove: string[] = []
    let skipped = 0
    let real = 0
    let fmNotRestored = false
    for (const original of order) {
        // A delete can be undone only while its deleted item is still listed: restoring the item
        // from History consumes it, so the two routes exclude each other. On the expected side the
        // list is the step's after list, so the inverse is a plain insert that consumes nothing.
        const plainUndo =
            direction === 'undo' && original.op === 'listRemove' && original.deletedId !== null && !hasDeletedId(record, original.deletedId)
        if (plainUndo && side !== 'expected') {
            skipped += 1
            continue
        }
        const forward = direction === 'undo' ? invertOp(original) : original
        if (side === 'none' && skipsOccupiedSlot(forward, working)) {
            skipped += 1
            continue
        }
        const outcome = applyForward(forward, working)
        if (outcome.kind === 'failed') {
            skipped += 1
            continue
        }
        applied.push(original)
        if (outcome.kind === 'inert') {
            fmNotRestored = true
            continue
        }
        real += 1
        executed.push(forward)
        writes.push(outcome.write)
        if (direction === 'undo' && original.op === 'listRemove' && original.deletedId !== null && !plainUndo) {
            deletedRemove.push(original.deletedId)
        }
    }
    if (real === 0) {
        return { ok: false, reason: 'precondition' }
    }
    if (direction === 'undo') {
        applied.reverse()
    }
    // Count list ops only: a chat op that failed must not cancel the shortcut.
    const whole = applied.filter(isListOp).length === step.ops.filter(isListOp).length
    return {
        ok: true,
        label: step.label,
        ops: applied,
        writes,
        restoreWrites: deriveRestoreWrites(executed, greetingsBefore),
        deletedRemove,
        skipped,
        fmNotRestored,
        ...(hash === undefined ? {} : { liveListHash: hash }),
        // On the expected side the live list is the side the step was recorded at; with every list op
        // applied it ends on the list the other side's fingerprint was taken from (invariant L6).
        ...(side === 'expected' && whole && step.listFingerprint
            ? { afterListHash: direction === 'undo' ? step.listFingerprint.before : step.listFingerprint.after }
            : {}),
    }
}

// An unfingerprinted insert whose slot already holds its value is skipped: the list there is
// already what the insert would produce, so inserting again would duplicate it.
function skipsOccupiedSlot(forward: Op, working: Working): boolean {
    return forward.op === 'listInsert' && working.list?.[forward.index] === forward.value
}

// The item a stored insert consumes: a tagged insert, or the insert of a Restore deleted step.
function consumedIdOf(label: StepLabel, op: Op): string | null {
    if (op.op !== 'listInsert') {
        return null
    }
    return label.kind === 'restoreDeleted' ? label.deletedId : (op.deletedId ?? null)
}

// The op a revert applies for one stored op. A delete whose reopen is in the same revert gets a
// plain insert, so the pair leaves no trace; a consumer's inverse removes with the item's id.
function revertForward(original: Op, pairsWithReopen: boolean, consumedId: string | null): Op {
    if (pairsWithReopen && original.op === 'listRemove') {
        return { op: 'listInsert', index: original.index, value: original.value }
    }
    if (consumedId !== null && original.op === 'listInsert') {
        return { op: 'listRemove', index: original.index, value: original.value, deletedId: consumedId }
    }
    return invertOp(original)
}

function trackAppliedOp(tracker: ListHashTracker, forward: Op): void {
    if (forward.op === 'listSet') {
        tracker.set(forward.index)
    } else if (forward.op === 'listInsert') {
        tracker.insert(forward.index)
    } else if (forward.op === 'listRemove') {
        tracker.remove(forward.index)
    }
}

// Both fingerprints of a list write from one element pass over `before`; `after` hashes only the
// slots the ops inserted or set. Two premises make the values equal the full hashes:
// L3: `after` is `before` with the list ops of `ops` applied in order, with the tracker's index and
//     splice semantics (every caller that passes no plan hashes derives its list write from `ops`).
// L6: stored list ops are exact: each op's recorded before/value is the value at its index along the
//     step's before -> after sequence, and every index was in range. A whole expected-side replay
//     relies on it through `afterListHash`, which takes the step's stored other-side fingerprint.
function listHashesAcross(before: readonly string[], ops: readonly Op[], after: readonly string[], hashFor?: ListElementHash): ListFingerprint {
    const tracker = createListHashTracker(before, hashFor?.(before))
    const beforeHash = tracker.hash(before)
    for (const op of ops) {
        trackAppliedOp(tracker, op)
    }
    return { before: beforeHash, after: tracker.hash(after) }
}

// One new step that undoes every step above `toStepId`, under the same per-op preconditions. A
// fingerprinted step is decided on the working list as the steps above it left it. `budgetUnits`
// is a test seam; callers use the default.
export function planRevert(record: OwnerRecord, toStepId: string, live: LiveReader, budgetUnits = REVERT_HASH_BUDGET_UNITS, hashFor?: ListElementHash): PlanResult {
    const index = record.done.findIndex((step) => step.id === toStepId)
    if (index < 0) {
        return { ok: false, reason: 'unknown' }
    }
    const above = record.done.slice(index + 1).reverse()
    if (above.length === 0) {
        return { ok: false, reason: 'empty' }
    }
    const working = makeWorking(live)
    const greetingsBefore = working.list ? [...working.list] : null
    const ops: Op[] = []
    const writes: WriteOp[] = []
    const deletedRemove: string[] = []
    let skipped = 0
    let fmNotRestored = false
    // Items that are listed at this point of the revert, and the position in `ops` of each removal
    // that re-opened one (a consumer undone), so a later delete's inverse can cancel it.
    const listed = new Set(record.deleted.map((item) => item.id))
    const listedAtStart = new Set(listed)
    const consumedValueOf = new Map<string, string>()
    let listSkipped = 0
    const reopened = new Map<string, number>()
    // A tracker exists when some reverted step inserts or removes: only then does the list's shape
    // change under the steps above. Its first pass is the revert's `before` hash.
    const list = working.list
    const tracker = list !== null && above.some((step) => hasInsertOrRemove(step.ops)) ? createListHashTracker(list, hashFor?.(list)) : null
    const liveListHash = tracker && list ? tracker.hash(list) : undefined
    let spent = 0
    let suspended = false
    // Set by the first fingerprinted step a hash decision puts off its expected side. Exact or stop:
    // from there on no older step decides by hash and no older step changes the list, because every
    // older list op would work against lifecycle state no step recorded. Description and other
    // fields still revert, and the chat's selected first message counts as one of them for a step
    // without a fingerprint. A budget suspension does not set it: a step without a fingerprint keeps
    // its per-op checks after a suspension, so on that route a repeated text can still be applied.
    let stopped = false
    for (const step of above) {
        let side: ListSide = 'none'
        const afterStop = stopped
        if (step.listFingerprint && tracker && list) {
            if (!suspended && !afterStop) {
                const need = tracker.pendingUnits(list)
                if (spent + need > budgetUnits) {
                    // Monotone: every later fingerprinted step of this revert skips its list ops. This
                    // stop is soft: steps without a fingerprint keep the per-op checks.
                    suspended = true
                } else {
                    spent += need
                    side = sideFromHash(step.listFingerprint, 'undo', tracker.hash(list))
                    if (side !== 'expected') {
                        stopped = true
                    }
                }
            }
            if (suspended || afterStop) {
                side = 'neither'
            }
        }
        for (const original of [...step.ops].reverse()) {
            if (side === 'none' && afterStop && isListOp(original)) {
                skipped += 1
                listSkipped += 1
                continue
            }
            if ((side === 'other' || side === 'neither') && isListOp(original)) {
                skipped += 1
                // On the other side the list already holds what the op would restore.
                if (side === 'neither') {
                    listSkipped += 1
                }
                continue
            }
            // A chat index points into the list its step's list ops map between: with the list on
            // neither side it is skipped with them. An inert op (no unique chat) keeps its own note.
            if (original.op === 'chatFm' && original.chatId !== null && side === 'neither') {
                skipped += 1
                continue
            }
            // A delete's inverse pairs with a reopen made earlier in this revert, or consumes the
            // listed item. An item that is neither is inserted back as a plain insert on the
            // expected side, where the fingerprint witnesses the inverse; a step without a
            // fingerprint skips it, as the item has been taken elsewhere.
            let deleteMode: 'pair' | 'consume' | 'plain' | null = null
            if (original.op === 'listRemove' && original.deletedId !== null) {
                deleteMode = reopened.has(original.deletedId) ? 'pair' : listed.has(original.deletedId) ? 'consume' : side === 'expected' ? 'plain' : null
                if (deleteMode === null) {
                    skipped += 1
                    continue
                }
            }
            const consumedId = consumedIdOf(step.label, original)
            const forward = revertForward(original, deleteMode === 'pair' || deleteMode === 'plain', consumedId)
            if (side === 'none' && skipsOccupiedSlot(forward, working)) {
                skipped += 1
                continue
            }
            const outcome = applyForward(forward, working)
            if (outcome.kind === 'failed') {
                skipped += 1
                if (isListOp(forward)) {
                    listSkipped += 1
                }
            } else if (outcome.kind === 'inert') {
                fmNotRestored = true
            } else {
                ops.push(forward)
                // Every applied list op is tracked, whichever path decided the step.
                if (tracker) {
                    trackAppliedOp(tracker, forward)
                }
                writes.push(outcome.write)
                // Only an applied op changes the lifecycle.
                if (original.op === 'listRemove' && original.deletedId !== null && deleteMode === 'pair') {
                    const position = reopened.get(original.deletedId)
                    const reopenedOp = position === undefined ? undefined : ops[position]
                    if (position !== undefined && reopenedOp && reopenedOp.op === 'listRemove') {
                        ops[position] = { op: 'listRemove', index: reopenedOp.index, value: reopenedOp.value, deletedId: null }
                    }
                    reopened.delete(original.deletedId)
                    listed.delete(original.deletedId)
                } else if (original.op === 'listRemove' && original.deletedId !== null && deleteMode === 'consume') {
                    listed.delete(original.deletedId)
                    deletedRemove.push(original.deletedId)
                    consumedValueOf.set(original.deletedId, original.value)
                } else if (consumedId !== null) {
                    reopened.set(consumedId, ops.length - 1)
                    listed.add(consumedId)
                }
            }
        }
    }
    if (ops.length === 0) {
        return { ok: false, reason: 'precondition' }
    }
    // Item effects are the change of the deleted set: an id consumed and produced again, or produced
    // while already listed, leaves the set as it was.
    const consumedNet = deletedRemove.filter((id) => !listed.has(id))
    const consumedValues = new Map<string, string>()
    for (const id of consumedNet) {
        const value = consumedValueOf.get(id)
        if (value !== undefined) {
            consumedValues.set(id, value)
        }
    }
    const producedValues = new Map<string, string>()
    for (const [id, position] of reopened) {
        const op = ops[position]
        if (!listedAtStart.has(id) && op && op.op === 'listRemove') {
            producedValues.set(id, op.value)
        }
    }
    const stored = revertStepOps(ops, greetingsBefore, working.list, consumedValues, producedValues)
    if (stored.length === 0) {
        return { ok: false, reason: 'unchanged', ...(listSkipped > 0 ? { listSkipped } : {}), ...(fmNotRestored ? { fmNotRestored } : {}) }
    }
    return {
        ok: true,
        label: { kind: 'revert', toStepId },
        ops: stored,
        writes,
        restoreWrites: deriveRestoreWrites(ops, greetingsBefore),
        deletedRemove: consumedNet,
        skipped,
        ...(listSkipped > 0 ? { listSkipped } : {}),
        fmNotRestored,
        // The final fill hashes only the slots the revert changed and is never budgeted.
        ...(tracker && list && liveListHash !== undefined ? { liveListHash, afterListHash: tracker.hash(list) } : {}),
    }
}

// Largest edit distance the shortest-edit-script search explores. A middle that differs by more
// is emitted as one positional run: same ops, each middle element stored once, bounded memory.
const MYERS_MAX_D = 1000

// Runs of the middle that differ between the two lists, from a shortest edit script (Myers):
// [beforeStart, beforeEnd, afterStart, afterEnd) in absolute indexes, in increasing order. Each
// round keeps only the window of the search frontier it can read back, so memory is quadratic in
// the distance, not in the list length.
function editHunks(a: readonly string[], b: readonly string[], start: number, aEnd: number, bEnd: number): [number, number, number, number][] {
    const n = aEnd - start
    const m = bEnd - start
    const limit = Math.min(n + m, MYERS_MAX_D)
    const offset = limit + 1
    const v = new Int32Array(2 * limit + 3)
    const trace: Int32Array[] = []
    let done = false
    for (let d = 0; d <= limit && !done; d++) {
        trace.push(v.slice(offset - d - 1, offset + d + 2))
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]) ? v[k + 1 + offset] : v[k - 1 + offset] + 1
            let y = x - k
            while (x < n && y < m && a[start + x] === b[start + y]) {
                x++
                y++
            }
            v[k + offset] = x
            if (x >= n && y >= m) {
                done = true
                break
            }
        }
    }
    if (!done) {
        return [[start, aEnd, start, bEnd]]
    }
    const matches: [number, number][] = []
    let x = n
    let y = m
    for (let d = trace.length - 1; d >= 0; d--) {
        const prev = trace[d]
        const k = x - y
        let prevX = 0
        let prevY = 0
        if (d > 0) {
            // prev holds the frontier from index -d - 1 on, so diagonal j sits at j + d + 1.
            const prevK = k === -d || (k !== d && prev[k - 1 + d + 1] < prev[k + 1 + d + 1]) ? k + 1 : k - 1
            prevX = prev[prevK + d + 1]
            prevY = prevX - prevK
        }
        while (x > prevX && y > prevY) {
            x--
            y--
            matches.push([x, y])
        }
        x = prevX
        y = prevY
    }
    matches.reverse()
    const hunks: [number, number, number, number][] = []
    let px = 0
    let py = 0
    for (const [mx, my] of [...matches, [n, m] as [number, number]]) {
        if (mx > px || my > py) {
            hunks.push([start + px, start + mx, start + py, start + my])
        }
        px = mx + 1
        py = my + 1
    }
    return hunks
}

// The ops a revert stores: its net change, not the chain of inverses it applied. One value op per
// field path and per chat; the list as the differing runs between the common prefix and suffix;
// each consumed or produced item as an insert and a removal of its value at the end of the list, a
// slot no equal value can occupy. Applied in order from `before` every op applies and the result is
// `after`.
function revertStepOps(
    applied: readonly Op[],
    before: readonly string[] | null,
    after: readonly string[] | null,
    consumed: ReadonlyMap<string, string>,
    produced: ReadonlyMap<string, string>,
): Op[] {
    const values = new Map<string, Op>()
    for (const op of applied) {
        if (op.op === 'set') {
            const key = 'set:' + op.path
            const first = values.get(key)
            values.set(key, first && first.op === 'set' ? { op: 'set', path: op.path, before: first.before, after: op.after } : op)
        } else if (op.op === 'chatFm' && op.chatId !== null) {
            const key = 'fm:' + op.chatId
            const first = values.get(key)
            values.set(key, first && first.op === 'chatFm' ? { op: 'chatFm', chatId: op.chatId, before: first.before, after: op.after } : op)
        }
    }
    const out: Op[] = []
    for (const op of values.values()) {
        if (op.op === 'set' ? !fieldValueEquals(op.before, op.after) : op.op === 'chatFm' && !fmValueEquals(op.before, op.after)) {
            out.push(op)
        }
    }
    if (before === null || after === null) {
        return out
    }
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) {
        start++
    }
    let end = 0
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
        end++
    }
    const fromEnd = before.length - end
    const toEnd = after.length - end
    const hunks = start === fromEnd && start === toEnd ? [] : editHunks(before, after, start, fromEnd, toEnd)
    for (const [x0, x1, y0, y1] of hunks) {
        const common = Math.min(x1 - x0, y1 - y0)
        for (let i = 0; i < common; i++) {
            if (before[x0 + i] !== after[y0 + i]) {
                out.push({ op: 'listSet', index: y0 + i, before: before[x0 + i], after: after[y0 + i] })
            }
        }
        for (let i = x1 - x0 - 1; i >= common; i--) {
            out.push({ op: 'listRemove', index: y0 + i, value: before[x0 + i], deletedId: null })
        }
        for (let i = common; i < y1 - y0; i++) {
            out.push({ op: 'listInsert', index: y0 + i, value: after[y0 + i] })
        }
    }
    const tail = after.length
    for (const [id, value] of consumed) {
        out.push({ op: 'listInsert', index: tail, value, deletedId: id })
        out.push({ op: 'listRemove', index: tail, value, deletedId: null })
    }
    for (const [id, value] of produced) {
        out.push({ op: 'listInsert', index: tail, value })
        out.push({ op: 'listRemove', index: tail, value, deletedId: id })
    }
    return out
}

function restoreValueEquals(a: RestoreValue, b: RestoreValue): boolean {
    if ('list' in a || 'list' in b) {
        if (!('list' in a) || !('list' in b) || a.list.length !== b.list.length) {
            return false
        }
        return a.list.every((item, i) => item === b.list[i])
    }
    return fieldValueEquals(a, b)
}

function currentRestoreValue(path: RestorePath, live: LiveReader): RestoreValue | null {
    if (path === LIST_PATH) {
        const list = live.greetings()
        return list === null ? null : { list: [...list] }
    }
    return live.field(path)
}

// Paths whose live value is neither the restore point's `last` nor already its `before`:
// something changed them outside Studio's history after the visit.
export function listChangedElsewhere(restore: RestorePoint, live: LiveReader): RestorePath[] {
    const out: RestorePath[] = []
    for (const path of RESTORE_PATH_ORDER) {
        const field = restore.fields[path]
        const current = field ? currentRestoreValue(path, live) : null
        if (field && current && !restoreValueEquals(current, field.last) && !restoreValueEquals(current, field.before)) {
            out.push(path)
        }
    }
    return out
}

// Ops that turn `from` into `to`: element rewrites, then removals from the end, then insertions.
function listDiffOps(from: readonly string[], to: readonly string[]): Op[] {
    const ops: Op[] = []
    const common = Math.min(from.length, to.length)
    for (let i = 0; i < common; i++) {
        if (from[i] !== to[i]) {
            ops.push({ op: 'listSet', index: i, before: from[i], after: to[i] })
        }
    }
    for (let i = from.length - 1; i >= common; i--) {
        ops.push({ op: 'listRemove', index: i, value: from[i], deletedId: null })
    }
    for (let i = common; i < to.length; i++) {
        ops.push({ op: 'listInsert', index: i, value: to[i] })
    }
    return ops
}

export interface RestorePlan extends StepPlan {
    changedElsewhere: RestorePath[]
}

export type RestorePlanResult = RestorePlan | Exclude<PlanResult, StepPlan>

// Restores every tracked field to its recorded `before`. A field whose live value is not the
// recorded `last` is changed elsewhere: it is restored too unless its path is in `keep`.
export function planRestorePoint(restore: RestorePoint | null, live: LiveReader, keep: ReadonlySet<RestorePath>): RestorePlanResult {
    if (!restore) {
        return { ok: false, reason: 'empty' }
    }
    const ops: Op[] = []
    const changedElsewhere = listChangedElsewhere(restore, live)
    const greetingsBefore = live.greetings() ? [...(live.greetings() as readonly string[])] : null
    for (const path of RESTORE_PATH_ORDER) {
        const field = restore.fields[path]
        if (!field) {
            continue
        }
        const current = currentRestoreValue(path, live)
        if (!current || restoreValueEquals(current, field.before)) {
            continue
        }
        if (!restoreValueEquals(current, field.last) && keep.has(path)) {
            continue
        }
        if (path === LIST_PATH) {
            if ('list' in current && 'list' in field.before) {
                ops.push(...listDiffOps(current.list, field.before.list))
            }
        } else if (!('list' in current) && !('list' in field.before)) {
            ops.push({ op: 'set', path, before: current, after: field.before })
        }
    }
    if (ops.length === 0) {
        return { ok: false, reason: 'precondition' }
    }
    const working = makeWorking(live)
    const writes: WriteOp[] = []
    for (const op of ops) {
        const outcome = applyForward(op, working)
        if (outcome.kind === 'applied') {
            writes.push(outcome.write)
        }
    }
    return {
        ok: true,
        label: { kind: 'restorePoint' },
        ops,
        writes,
        restoreWrites: deriveRestoreWrites(ops, greetingsBefore),
        deletedRemove: [],
        skipped: 0,
        fmNotRestored: false,
        changedElsewhere,
    }
}

// Inserts a deleted item back at its old position (or the end of a shorter list) as one new step.
export function planRestoreDeleted(record: OwnerRecord, deletedId: string, live: LiveReader): PlanResult {
    const item = record.deleted.find((entry) => entry.id === deletedId)
    const greetings = live.greetings()
    if (!item) {
        return { ok: false, reason: 'unknown' }
    }
    if (greetings === null) {
        return { ok: false, reason: 'precondition' }
    }
    const index = Math.min(item.index, greetings.length)
    const ops: Op[] = [{ op: 'listInsert', index, value: item.value }]
    if (item.sideChat) {
        const current = live.fmIndex(item.sideChat.chatId)
        if (current && fmValueEquals(current, { had: true, value: -1 })) {
            ops.push({
                op: 'chatFm',
                chatId: item.sideChat.chatId,
                before: { had: true, value: -1 },
                after: item.sideChat.before,
            })
        }
    }
    const working = makeWorking(live)
    const writes: WriteOp[] = []
    for (const op of ops) {
        const outcome = applyForward(op, working)
        if (outcome.kind === 'applied') {
            writes.push(outcome.write)
        }
    }
    return {
        ok: true,
        label: { kind: 'restoreDeleted', deletedId },
        ops,
        writes,
        restoreWrites: deriveRestoreWrites(ops, [...greetings]),
        deletedRemove: [deletedId],
        skipped: 0,
        fmNotRestored: false,
    }
}

// ---------------------------------------------------------------- state transitions

// The step that still accepts coalesced writes: the top of `done`, on one path.
export interface OpenStep {
    stepId: string
    key: string
    lastAt: number
}

export interface ModelState {
    record: OwnerRecord
    open: OpenStep | null
}

export function createModelState(record: OwnerRecord): ModelState {
    return { record, open: null }
}

// Undo, redo, blur, a visit close or a pause end coalescing.
export function closeOpenStep(state: ModelState): ModelState {
    return state.open === null ? state : { record: state.record, open: null }
}

// Restore-point bookkeeping. A restore point belongs to one visit: the first edit of a new visit
// replaces it. Within a visit, the first write to a path records its `before`, and every write
// updates `last`. A replay in another visit only refreshes `last` of fields already tracked.
export function noteRestoreWrites(
    restore: RestorePoint | null,
    visitId: string,
    at: number,
    writes: readonly RestoreWrite[],
    replaces: boolean,
): RestorePoint | null {
    if (writes.length === 0) {
        return restore
    }
    const sameVisit = restore !== null && restore.visitId === visitId
    let base: RestorePoint | null
    let addUnknown: boolean
    if (sameVisit) {
        base = restore
        addUnknown = true
    } else if (replaces) {
        base = { visitId, at, fields: {} }
        addUnknown = true
    } else {
        base = restore
        addUnknown = false
    }
    if (!base) {
        return null
    }
    const fields: Partial<Record<RestorePath, RestoreField>> = { ...base.fields }
    for (const write of writes) {
        const known = fields[write.path]
        if (known) {
            fields[write.path] = { before: known.before, last: write.after }
        } else if (addUnknown) {
            fields[write.path] = { before: write.before, last: write.after }
        }
    }
    return { visitId: base.visitId, at: base.at, fields }
}

function deletedFromOps(ops: readonly Op[], at: number): DeletedItem[] {
    const fm = ops.find((op): op is Extract<Op, { op: 'chatFm' }> => op.op === 'chatFm')
    const out: DeletedItem[] = []
    for (const op of ops) {
        if (op.op === 'listRemove' && op.deletedId !== null) {
            out.push({
                id: op.deletedId,
                at,
                index: op.index,
                value: op.value,
                sideChat: fm && fm.chatId !== null ? { chatId: fm.chatId, before: fm.before } : null,
            })
        }
    }
    return out
}

// The deleted-items entry for `id` as its delete step made it, so a re-listed item keeps its side
// chat. Once that step has left both stacks only the op itself is known.
function deletedEntryFor(record: OwnerRecord, id: string, op: { index: number; value: string }, at: number): DeletedItem {
    for (const stack of [record.done, record.undone]) {
        for (const step of stack) {
            if (step.label.kind !== 'greetingRemove') {
                continue
            }
            const entry = deletedFromOps(step.ops, step.at).find((item) => item.id === id)
            if (entry) {
                return entry
            }
        }
    }
    return { id, at, index: op.index, value: op.value, sideChat: null }
}

// The entries that applied forward ops list: a delete lists its own item; a removal that carries an
// id in any other step (a revert re-opening a consumer) re-lists the item as its delete made it.
// Ids already in `listed` are skipped, so no id is ever listed twice.
function producedItems(
    record: OwnerRecord,
    listed: readonly DeletedItem[],
    label: StepLabel,
    ops: readonly Op[],
    at: number,
): DeletedItem[] {
    const items: DeletedItem[] = []
    if (label.kind === 'greetingRemove') {
        items.push(...deletedFromOps(ops, at))
    } else {
        for (const op of ops) {
            if (op.op === 'listRemove' && op.deletedId !== null) {
                items.push(deletedEntryFor(record, op.deletedId, op, at))
            }
        }
    }
    return items.filter((item, i) => !listed.some((entry) => entry.id === item.id) && items.findIndex((other) => other.id === item.id) === i)
}

function capped<T>(items: T[], max: number): T[] {
    return items.length > max ? items.slice(items.length - max) : items
}

export interface StepCommit {
    id: string
    at: number
    visitId: string
    label: StepLabel
    ops: Op[]
    restoreWrites: readonly RestoreWrite[]
    // The path that identifies a coalescible edit; null for every other action.
    coalesceKey: string | null
    // True for an edit: the first edit of a new visit replaces the restore point.
    replacesRestore: boolean
    deletedRemove?: readonly string[]
    // Hashes the plan already made of the list before and after the ops (a revert); the commit
    // reuses them instead of hashing the restore write's lists again.
    liveListHash?: number
    afterListHash?: number
}

function mergeCoalesced(top: Step, next: Op[]): Op[] | null {
    if (top.ops.length !== 1 || next.length !== 1) {
        return null
    }
    const a = top.ops[0]
    const b = next[0]
    if (a.op === 'set' && b.op === 'set' && a.path === b.path) {
        return [{ op: 'set', path: a.path, before: a.before, after: b.after }]
    }
    if (a.op === 'listSet' && b.op === 'listSet' && a.index === b.index) {
        return [{ op: 'listSet', index: a.index, before: a.before, after: b.after }]
    }
    return null
}

// Records a landed action as a new step (or extends the open one) and clears the redo stack.
export function commitStep(state: ModelState, commit: StepCommit, hashFor?: ListElementHash): ModelState {
    const { record } = state
    const restore = noteRestoreWrites(record.restore, commit.visitId, commit.at, commit.restoreWrites, commit.replacesRestore)
    const removed = new Set(commit.deletedRemove ?? [])
    const top = record.done[record.done.length - 1]
    if (
        commit.coalesceKey !== null &&
        top &&
        state.open &&
        state.open.key === commit.coalesceKey &&
        state.open.stepId === top.id &&
        commit.at - state.open.lastAt < COALESCE_MS
    ) {
        const merged = mergeCoalesced(top, commit.ops)
        if (merged) {
            const done = record.done.slice(0, -1)
            done.push({ ...top, ops: merged })
            return {
                record: { ...record, touchedAt: commit.at, done, undone: [], restore },
                open: { stepId: top.id, key: commit.coalesceKey, lastAt: commit.at },
            }
        }
    }
    const step: Step = { id: commit.id, at: commit.at, label: commit.label, ops: commit.ops }
    const listWrite = hasInsertOrRemove(commit.ops) ? listRestoreWrite(commit.restoreWrites) : null
    if (listWrite) {
        if (commit.liveListHash !== undefined && commit.afterListHash !== undefined) {
            step.listFingerprint = { before: commit.liveListHash, after: commit.afterListHash }
        } else {
            const derived = listHashesAcross(listWrite.before, commit.ops, listWrite.after, hashFor)
            step.listFingerprint = {
                before: commit.liveListHash ?? derived.before,
                after: commit.afterListHash ?? derived.after,
            }
        }
    }
    const kept = record.deleted.filter((item) => !removed.has(item.id))
    const deleted = capped([...kept, ...producedItems(record, kept, commit.label, commit.ops, commit.at)], MAX_DELETED)
    return {
        record: {
            ...record,
            touchedAt: commit.at,
            done: capped([...record.done, step], MAX_DONE),
            undone: [],
            deleted,
            restore,
        },
        open: commit.coalesceKey === null ? null : { stepId: step.id, key: commit.coalesceKey, lastAt: commit.at },
    }
}

// Moves the replayed step between the stacks. The moved step carries only the ops that applied.
export function applyReplayMove(
    state: ModelState,
    direction: 'undo' | 'redo',
    plan: StepPlan,
    at: number,
    visitId: string,
    hashFor?: ListElementHash,
): ModelState {
    const { record } = state
    const from = direction === 'undo' ? record.done : record.undone
    const step = from[from.length - 1]
    if (!step) {
        return state
    }
    // Built from scratch: the old step's fingerprint describes lists the moved step no longer spans.
    const moved: Step = { id: step.id, at: step.at, label: step.label, ops: plan.ops }
    const listWrite = hasInsertOrRemove(plan.ops) ? listRestoreWrite(plan.restoreWrites) : null
    if (listWrite) {
        // `before` of the replay's write is the live list at plan time, `after` the list it produces.
        const live = plan.liveListHash ?? listFingerprintOf(listWrite.before, hashFor?.(listWrite.before))
        const produced = plan.afterListHash ?? listFingerprintOf(listWrite.after, hashFor?.(listWrite.after))
        moved.listFingerprint = direction === 'undo' ? { before: produced, after: live } : { before: live, after: produced }
    }
    const rest = from.slice(0, -1)
    let deleted = record.deleted
    if (direction === 'undo') {
        deleted = deleted.filter((item) => !plan.deletedRemove.includes(item.id))
        if (step.label.kind === 'restoreDeleted') {
            deleted = capped([...deleted, ...restoredItemFromOps(plan.ops, step.at, step.label.deletedId)], MAX_DELETED)
        } else {
            // Undoing an applied consumer gives its item back.
            const relisted: DeletedItem[] = []
            for (const op of plan.ops) {
                if (op.op === 'listInsert' && op.deletedId !== undefined && !deleted.some((item) => item.id === op.deletedId)) {
                    relisted.push(deletedEntryFor(record, op.deletedId, op, step.at))
                }
            }
            deleted = capped([...deleted, ...relisted], MAX_DELETED)
        }
    } else if (step.label.kind === 'restoreDeleted') {
        // Only an insert that applied consumes the item.
        const id = step.label.deletedId
        if (plan.ops.some((op) => op.op === 'listInsert')) {
            deleted = deleted.filter((item) => item.id !== id)
        }
    } else {
        const consumed = new Set<string>()
        for (const op of plan.ops) {
            if (op.op === 'listInsert' && op.deletedId !== undefined) {
                consumed.add(op.deletedId)
            }
        }
        deleted = deleted.filter((item) => !consumed.has(item.id))
        deleted = capped([...deleted, ...producedItems(record, deleted, step.label, plan.ops, step.at)], MAX_DELETED)
    }
    const restore = noteRestoreWrites(record.restore, visitId, at, plan.restoreWrites, false)
    const next: OwnerRecord =
        direction === 'undo'
            ? {
                  ...record,
                  touchedAt: at,
                  done: rest,
                  undone: capped([...record.undone, moved], MAX_UNDONE),
                  deleted,
                  restore,
              }
            : {
                  ...record,
                  touchedAt: at,
                  undone: rest,
                  done: capped([...record.done, moved], MAX_DONE),
                  deleted,
                  restore,
              }
    return { record: next, open: null }
}

// Undoing a restoreDeleted step makes the item restorable again.
function restoredItemFromOps(ops: readonly Op[], at: number, id: string): DeletedItem[] {
    const insert = ops.find((op): op is Extract<Op, { op: 'listInsert' }> => op.op === 'listInsert')
    if (!insert) {
        return []
    }
    const fm = ops.find((op): op is Extract<Op, { op: 'chatFm' }> => op.op === 'chatFm')
    return [
        {
            id,
            at,
            index: insert.index,
            value: insert.value,
            sideChat: fm && fm.chatId !== null ? { chatId: fm.chatId, before: fm.after } : null,
        },
    ]
}
