// Pure model of one Studio owner's history: the closed field union, the stored record shape with
// its strict guards, and every state transition (edit, undo, redo, revert, restore point, deleted
// items). It never reads a clock, a global or the live character: the live values reach it
// through a `LiveReader` snapshot, and the writes it decides on leave it as `WriteOp`s.

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
    | { op: 'listInsert'; index: number; value: string }
    // `deletedId` links a delete to its deleted item; a removal made by a restore or a revert has none.
    | { op: 'listRemove'; index: number; value: string; deletedId: string | null }
    // `chatId: null` stands for a chat without a unique id: the side effect happened by index and cannot be replayed.
    | { op: 'chatFm'; chatId: string | null; before: FmValue; after: FmValue }

export interface Step {
    id: string
    at: number
    label: StepLabel
    ops: Op[]
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
            return isIndex(value.index) && typeof value.value === 'string'
                ? { op: 'listInsert', index: value.index, value: value.value }
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
    return { id: value.id, at: value.at, label, ops }
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

export type ModelRefusal = 'empty' | 'unknown' | 'precondition'

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
}

export type PlanResult = StepPlan | { ok: false; reason: ModelRefusal }

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
            return { op: 'listRemove', index: op.index, value: op.value, deletedId: null }
        case 'listRemove':
            return { op: 'listInsert', index: op.index, value: op.value }
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

// Replays the top step of `done` (undo) or `undone` (redo). Every op is checked against the live
// value it would overwrite; ops whose precondition fails are skipped, which keeps a value changed
// elsewhere. When nothing applies the replay is refused and the stacks stay as they are.
export function planReplay(record: OwnerRecord, direction: 'undo' | 'redo', live: LiveReader): PlanResult {
    const stack = direction === 'undo' ? record.done : record.undone
    const step = stack[stack.length - 1]
    if (!step) {
        return { ok: false, reason: 'empty' }
    }
    const working = makeWorking(live)
    const greetingsBefore = working.list ? [...working.list] : null
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
        // from History consumes it, so the two routes exclude each other.
        if (direction === 'undo' && original.op === 'listRemove' && original.deletedId !== null && !hasDeletedId(record, original.deletedId)) {
            skipped += 1
            continue
        }
        const forward = direction === 'undo' ? invertOp(original) : original
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
        if (direction === 'undo' && original.op === 'listRemove' && original.deletedId !== null) {
            deletedRemove.push(original.deletedId)
        }
    }
    if (real === 0) {
        return { ok: false, reason: 'precondition' }
    }
    if (direction === 'undo') {
        applied.reverse()
    }
    return {
        ok: true,
        label: step.label,
        ops: applied,
        writes,
        restoreWrites: deriveRestoreWrites(executed, greetingsBefore),
        deletedRemove,
        skipped,
        fmNotRestored,
    }
}

// One new step that undoes every step above `toStepId`, under the same per-op preconditions.
export function planRevert(record: OwnerRecord, toStepId: string, live: LiveReader): PlanResult {
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
    for (const step of above) {
        for (const original of [...step.ops].reverse()) {
            if (original.op === 'listRemove' && original.deletedId !== null && !hasDeletedId(record, original.deletedId)) {
                skipped += 1
                continue
            }
            const forward = invertOp(original)
            const outcome = applyForward(forward, working)
            if (outcome.kind === 'failed') {
                skipped += 1
            } else if (outcome.kind === 'inert') {
                fmNotRestored = true
            } else {
                ops.push(forward)
                writes.push(outcome.write)
                if (original.op === 'listRemove' && original.deletedId !== null) {
                    deletedRemove.push(original.deletedId)
                }
            }
        }
    }
    if (ops.length === 0) {
        return { ok: false, reason: 'precondition' }
    }
    return {
        ok: true,
        label: { kind: 'revert', toStepId },
        ops,
        writes,
        restoreWrites: deriveRestoreWrites(ops, greetingsBefore),
        deletedRemove,
        skipped,
        fmNotRestored,
    }
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

export type RestorePlanResult = RestorePlan | { ok: false; reason: ModelRefusal }

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
export function commitStep(state: ModelState, commit: StepCommit): ModelState {
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
    const deleted = capped(
        [...record.deleted.filter((item) => !removed.has(item.id)), ...deletedFromOps(commit.ops, commit.at)],
        MAX_DELETED,
    )
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
): ModelState {
    const { record } = state
    const from = direction === 'undo' ? record.done : record.undone
    const step = from[from.length - 1]
    if (!step) {
        return state
    }
    const moved: Step = { ...step, ops: plan.ops }
    const rest = from.slice(0, -1)
    let deleted = record.deleted
    if (direction === 'undo') {
        deleted = deleted.filter((item) => !plan.deletedRemove.includes(item.id))
        if (step.label.kind === 'restoreDeleted') {
            deleted = capped([...deleted, ...restoredItemFromOps(plan.ops, step.at, step.label.deletedId)], MAX_DELETED)
        }
    } else if (step.label.kind === 'restoreDeleted') {
        const id = step.label.deletedId
        deleted = deleted.filter((item) => item.id !== id)
    } else {
        deleted = capped([...deleted, ...deletedFromOps(plan.ops, step.at)], MAX_DELETED)
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
