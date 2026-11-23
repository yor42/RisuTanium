// Pure model of one Studio owner's history: the field registry's tables, the stored record shape with
// its strict guards, and every state transition (edit, undo, redo, revert, restore point, deleted
// items). It never reads a clock, a global or the live character: the live values reach it
// through a `LiveReader` snapshot, and the writes it decides on leave it as `WriteOp`s.

import { applyFolderOps, folderOpAtTarget, invertFolderOp, type FolderFieldValue, type FolderOp } from '../assets/folderCodec'
import type { AssetArrayName } from '../assets/mergePreview'
import { scanReferences } from '../assets/referenceScan'
import { parseTargetPath, TEXT_TARGET } from '../assets/referenceTargets'
import type { JsonValue } from '../../storage/blockFrame'
import { sameJsonValue, toPlainJson } from '../../storage/store2/codec/normalize'
import { factsOf, isHeldBy, registryPaths } from './fieldAccess'
import { FIELD_SPECS, type SetPath } from './fieldRegistry'
import { fingerprintElement, listFingerprintOf, mixElementHashes, type ElementHash, type ListElementHash } from './listFingerprint'
import { parseStoredOwnerKey, type OwnerKey, type ParsedOwnerKey, type StoredOwnerKey } from './ownerPhase'
import { SESSION_OWNER_KINDS, type SessionOwnerKind, type SessionOwnerKindSpec } from './sessionKinds'

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

export type { SetPath }
export type ListPath = 'alternateGreetings'
export type RestorePath = SetPath | ListPath
export type OwnerKind = ParsedOwnerKey['kind']

const REGISTRY_PATHS: readonly SetPath[] = registryPaths()

// The one table of the set paths each owner kind accepts, derived from the field registry: a kind's row is the
// registered paths whose holders include it, in registry order. The `set` acceptance of `parseOp`, `isOpAllowedFor`
// and the restore table all derive from it; nothing else decides which set paths an owner kind accepts. A record
// holding a `set` op on a path outside its kind's row is refused whole. A session kind's row is the set paths its
// table entry names.
type SessionRows = { readonly [K in SessionOwnerKind]: readonly SetPath[] }
function isSessionRows(rows: Readonly<Record<string, readonly SetPath[]>>): rows is SessionRows {
    return Object.keys(SESSION_OWNER_KINDS).every((kind) => Object.hasOwn(rows, kind))
}
function sessionSetRows(): SessionRows {
    const rows: Record<string, readonly SetPath[]> = {}
    for (const [kind, spec] of Object.entries<SessionOwnerKindSpec>(SESSION_OWNER_KINDS)) {
        rows[kind] = [...spec.setPaths]
    }
    // Built from the same table the type derives from, so every kind has its row.
    if (!isSessionRows(rows)) {
        throw new Error('A session kind has no set row.')
    }
    return rows
}
const SESSION_SET_ROWS: SessionRows = sessionSetRows()
export const SET_PATHS_BY_KIND: { readonly [K in OwnerKind]: readonly SetPath[] } = {
    ...SESSION_SET_ROWS,
    character: REGISTRY_PATHS.filter((path) => isHeldBy(path, 'character')),
    chat: REGISTRY_PATHS.filter((path) => isHeldBy(path, 'chat')),
    module: REGISTRY_PATHS.filter((path) => isHeldBy(path, 'module')),
}
export const LIST_PATH: ListPath = 'alternateGreetings'
// The paths a restore point may hold per owner kind: every set path, plus the greeting list for a character. A
// session kind's restore row equals its set row.
export const RESTORE_PATHS_BY_KIND: { readonly [K in OwnerKind]: readonly RestorePath[] } = {
    ...SESSION_SET_ROWS,
    character: [...SET_PATHS_BY_KIND.character, LIST_PATH],
    chat: SET_PATHS_BY_KIND.chat,
    module: SET_PATHS_BY_KIND.module,
}
export const CHARACTER_SET_PATHS: readonly SetPath[] = SET_PATHS_BY_KIND.character
export const CHAT_SET_PATHS: readonly SetPath[] = SET_PATHS_BY_KIND.chat
export const RESTORE_PATH_ORDER: readonly RestorePath[] = [...REGISTRY_PATHS, LIST_PATH]
// The set paths whose value is a boolean; every other set path carries text.
export const BOOLEAN_SET_PATHS: readonly SetPath[] = REGISTRY_PATHS.filter((path) => factsOf(path).value === 'bool')
export function isBooleanSetPath(path: SetPath): boolean {
    return factsOf(path).value === 'bool'
}
// The owner text fields (the character's and the module's `backgroundEmbedding`) whose whole value a set op carries:
// the merge-recording rule (an explicit list, not derived from the registry). A target addresses a nested field with
// `/` where its path has a `.`.
export type TextFieldPath =
    | 'desc'
    | 'firstMessage'
    | 'exampleMessage'
    | 'systemPrompt'
    | 'replaceGlobalNote'
    | 'additionalText'
    | 'personality'
    | 'scenario'
    | 'depth_prompt.prompt'
    | 'defaultVariables'
    | 'translatorNote'
    | 'backgroundEmbedding'
export const TEXT_FIELD_PATHS: readonly TextFieldPath[] = [
    'desc',
    'firstMessage',
    'exampleMessage',
    'systemPrompt',
    'replaceGlobalNote',
    'additionalText',
    'personality',
    'scenario',
    'depth_prompt.prompt',
    'defaultVariables',
    'translatorNote',
    'backgroundEmbedding',
]

// `had: false` is an absent optional key. Writing it deletes the key; it never assigns false or undefined.
// `had: 'foreign'` is a present value of another type than the path's, as plain JSON; only a path whose facts carry
// `keepForeign` reads or records it. Writing it puts the stored value back.
export type FieldValue = { had: false } | { had: true; value: string | boolean } | { had: 'foreign'; value: JsonValue }
export type FmValue = { had: false } | { had: true; value: number }

export function fieldValueEquals(a: FieldValue, b: FieldValue): boolean {
    if (a.had !== b.had) {
        return false
    }
    if (a.had === false || b.had === false) {
        return true
    }
    if (a.had === 'foreign' || b.had === 'foreign') {
        return sameJsonValue(a.value, b.value)
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
    | { kind: 'greetingMove' }
    | { kind: 'greetingSwap' }
    | { kind: 'greetingAddMany'; count: number }
    | { kind: 'restorePoint' }
    | { kind: 'revert'; toStepId: string }
    | { kind: 'restoreDeleted'; deletedId: string }
    | { kind: 'assetDelete'; count: number; name: string | null }
    | { kind: 'assetRemoveExtras'; count: number; name: string }
    | { kind: 'assetMerge'; from: string; to: string }
    | { kind: 'assetRename'; from: string; to: string }
    | { kind: 'assetMove'; count: number; folder: string | null }
    | { kind: 'folderRename'; from: string; to: string }
    | { kind: 'folderDelete'; name: string }
    | { kind: 'assetAdd'; count: number }
    | { kind: 'folderCreate'; name: string }
    | { kind: 'folderReorder' }

// Asset ops carry fresh plain copies of their rows and lists, never a live array or proxy. `count` is the
// number of tuples element-wise equal to `tuple` in the array before the op. They carry no deleted-item id:
// an asset step creates, consumes and re-lists no History deleted item.
export type AssetOp =
    | { op: 'assetRowRemove'; array: AssetArrayName; index: number; tuple: string[]; count: number }
    | { op: 'assetRowInsert'; array: AssetArrayName; index: number; tuple: string[]; count: number }
    | { op: 'assetRowSet'; array: AssetArrayName; index: number; before: string[]; after: string[] }
    | { op: 'assetFolderSet'; name: string; before: FolderFieldValue; after: FolderFieldValue }
    | { op: 'assetFolderOrder'; before: string[]; after: string[] }

// `target` is a registry path of the owner's texts (`desc`, `alternateGreetings/<i>`, `lore/<i>/content`, ...).
export type TextEditOp = { op: 'textEdit'; target: string; offset: number; from: string; to: string }

export type Op =
    | { op: 'set'; path: SetPath; before: FieldValue; after: FieldValue }
    | { op: 'listSet'; index: number; before: string; after: string }
    // `deletedId` marks an insert that consumes the deleted item with that id; a plain insert has none.
    | { op: 'listInsert'; index: number; value: string; deletedId?: string }
    // `deletedId` links a delete to its deleted item; a removal made by a restore or a revert has none.
    | { op: 'listRemove'; index: number; value: string; deletedId: string | null }
    // `chatId: null` stands for a chat without a unique id: the side effect happened by index and cannot be replayed.
    | { op: 'chatFm'; chatId: string | null; before: FmValue; after: FmValue }
    | AssetOp
    | TextEditOp

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
    return typeof value === 'string' && Object.hasOwn(FIELD_SPECS, value)
}

function parseFieldValue(path: SetPath, value: unknown): FieldValue | null {
    if (!isObject(value)) {
        return null
    }
    if (value.had === false) {
        return { had: false }
    }
    const facts = factsOf(path)
    const isBool = facts.value === 'bool'
    if (value.had === 'foreign') {
        // A foreign reading exists only on a `keepForeign` path, holds a present value that is not of the path's type
        // (a value of that type is malformed here), and is never `undefined`. It is read as plain JSON, a fresh copy.
        const plain = facts.keepForeign === true ? toPlainJson(value.value) : undefined
        return plain !== undefined && typeof plain !== (isBool ? 'boolean' : 'string') ? { had: 'foreign', value: plain } : null
    }
    if (value.had !== true) {
        return null
    }
    if (isBool) {
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

// The labels added with the folder and add steps carry exactly their listed fields: an extra field is a refusal.
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key))
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
        case 'greetingMove':
        case 'greetingSwap':
        case 'restorePoint':
            return { kind: value.kind }
        case 'greetingAddMany':
            return hasOnlyKeys(value, ['kind', 'count']) && isCount(value.count) && value.count >= 1
                ? { kind: 'greetingAddMany', count: value.count }
                : null
        case 'revert':
            return typeof value.toStepId === 'string' ? { kind: 'revert', toStepId: value.toStepId } : null
        case 'restoreDeleted':
            return typeof value.deletedId === 'string' ? { kind: 'restoreDeleted', deletedId: value.deletedId } : null
        case 'assetDelete': {
            const name = nullableString(value.name)
            return isCount(value.count) && name !== undefined ? { kind: 'assetDelete', count: value.count, name } : null
        }
        case 'assetRemoveExtras':
            return isCount(value.count) && typeof value.name === 'string'
                ? { kind: 'assetRemoveExtras', count: value.count, name: value.name }
                : null
        case 'assetMerge':
        case 'assetRename':
        case 'folderRename':
            return typeof value.from === 'string' && typeof value.to === 'string'
                ? { kind: value.kind, from: value.from, to: value.to }
                : null
        case 'assetMove': {
            const folder = nullableString(value.folder)
            return isCount(value.count) && folder !== undefined ? { kind: 'assetMove', count: value.count, folder } : null
        }
        case 'folderDelete':
            return typeof value.name === 'string' ? { kind: 'folderDelete', name: value.name } : null
        case 'assetAdd':
            return hasOnlyKeys(value, ['kind', 'count']) && isCount(value.count) ? { kind: 'assetAdd', count: value.count } : null
        case 'folderCreate':
            return hasOnlyKeys(value, ['kind', 'name']) && typeof value.name === 'string' ? { kind: 'folderCreate', name: value.name } : null
        case 'folderReorder':
            return hasOnlyKeys(value, ['kind']) ? { kind: 'folderReorder' } : null
        default:
            return null
    }
}

// Rule K, defined once: whether an owner of this kind may hold the op. `parseOp` applies it after the shape checks,
// and the service refuses a build whose op fails it before anything is written, so a landed write is always one
// the owner's own record reads back.
export function isOpAllowedFor(kind: OwnerKind, op: Op): boolean {
    switch (op.op) {
        case 'set':
            return SET_PATHS_BY_KIND[kind].includes(op.path)
        case 'listSet':
        case 'listInsert':
        case 'listRemove':
        case 'chatFm':
            return kind === 'character'
        case 'assetRowRemove':
        case 'assetRowInsert':
        case 'assetRowSet':
        case 'assetFolderSet':
        case 'assetFolderOrder':
        case 'textEdit':
            return kind === 'character' || kind === 'module'
    }
}

// The set paths of an owner kind that carry text: its row of the table minus the boolean paths.
export function textPathsFor(kind: OwnerKind): readonly SetPath[] {
    return SET_PATHS_BY_KIND[kind].filter((path) => !isBooleanSetPath(path))
}

const ASSET_ARRAYS: readonly string[] = ['additionalAssets', 'emotionImages', 'assets']

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isAssetArray(value: unknown): value is AssetArrayName {
    return typeof value === 'string' && ASSET_ARRAYS.includes(value)
}

// A fresh plain copy of a string array, or null when the value is not one.
function parseStringArray(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...(value as string[])] : null
}

function parseFolderField(value: unknown): FolderFieldValue | null {
    if (!isObject(value)) {
        return null
    }
    if (value.had === false) {
        return { had: false }
    }
    return value.had === true && typeof value.value === 'string' ? { had: true, value: value.value } : null
}

// The asset ops and `textEdit`; undefined when `value.op` is none of them.
function parseAssetOp(value: Record<string, unknown>): Op | null | undefined {
    switch (value.op) {
        case 'assetRowRemove':
        case 'assetRowInsert': {
            const tuple = parseStringArray(value.tuple)
            if (!isAssetArray(value.array) || !isIndex(value.index) || !tuple || !isCount(value.count)) {
                return null
            }
            return { op: value.op, array: value.array, index: value.index, tuple, count: value.count }
        }
        case 'assetRowSet': {
            const before = parseStringArray(value.before)
            const after = parseStringArray(value.after)
            if (!isAssetArray(value.array) || !isIndex(value.index) || !before || !after) {
                return null
            }
            return { op: 'assetRowSet', array: value.array, index: value.index, before, after }
        }
        case 'assetFolderSet': {
            const before = parseFolderField(value.before)
            const after = parseFolderField(value.after)
            return typeof value.name === 'string' && before && after ? { op: 'assetFolderSet', name: value.name, before, after } : null
        }
        case 'assetFolderOrder': {
            const before = parseStringArray(value.before)
            const after = parseStringArray(value.after)
            return before && after ? { op: 'assetFolderOrder', before, after } : null
        }
        // A merge step recorded as one `textEdit` per occurrence, first message and alternates included, stays readable and
        // replays unbound. Nothing converts such a step; the bound-step rule only covers the whole-value shape builders
        // write now.
        case 'textEdit':
            return typeof value.target === 'string' &&
                TEXT_TARGET.test(value.target) &&
                isIndex(value.offset) &&
                typeof value.from === 'string' &&
                typeof value.to === 'string'
                ? { op: 'textEdit', target: value.target, offset: value.offset, from: value.from, to: value.to }
                : null
        default:
            return undefined
    }
}

// The shape of one op, whatever the owner kind; null when it is outside the closed union.
function parseOpShape(value: unknown): Op | null {
    if (!isObject(value)) {
        return null
    }
    if (value.op === 'set') {
        if (!isSetPath(value.path)) {
            return null
        }
        const before = parseFieldValue(value.path, value.before)
        const after = parseFieldValue(value.path, value.after)
        return before && after ? { op: 'set', path: value.path, before, after } : null
    }
    const asset = parseAssetOp(value)
    if (asset !== undefined) {
        return asset
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

function parseOp(value: unknown, kind: OwnerKind): Op | null {
    const op = parseOpShape(value)
    return op && isOpAllowedFor(kind, op) ? op : null
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
    const fingerprint = kind !== 'character' ? null : parseListFingerprint(value.listFingerprint)
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
    const allowed: readonly RestorePath[] = RESTORE_PATHS_BY_KIND[kind]
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
export function parseOwnerRecord(value: unknown, ownerKey: StoredOwnerKey): OwnerRecord | null {
    const parsedKey = parseStoredOwnerKey(ownerKey)
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
        if (!item || kind !== 'character') {
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
    // The owner's rows of one asset array, or null when it cannot be read. Absent on a reader that serves
    // no asset ops, which then cannot apply or recognise one.
    assetRows?(array: AssetArrayName): readonly (readonly string[])[] | null
    // The owner's stored folder value, undefined when absent.
    folderValue?(): unknown
    // The text at a registry path, or null for anything not rewritable at read time. The three text fields
    // (`desc`, `firstMessage`, `exampleMessage`) are read through `field`, so this serves every other text path.
    text?(target: string): string | null
}

export type WriteOp =
    | { op: 'set'; path: SetPath; value: FieldValue }
    | { op: 'listSet'; index: number; value: string }
    | { op: 'listInsert'; index: number; value: string }
    | { op: 'listRemove'; index: number }
    | { op: 'chatFm'; chatId: string; value: FmValue }
    // An asset write is the op itself. A text write carries the whole value the plan computed: a text field is a
    // `set`, an alternate first message entry a `listSet`, every other registry text a `textSet`. Never stored or posted.
    | AssetOp
    | { op: 'textSet'; target: string; value: string }

export interface RestoreWrite {
    path: RestorePath
    before: RestoreValue
    after: RestoreValue
}

// `unchanged` is returned by planRevert only: the revert's net effect is nothing. It is an in-memory
// result and is never stored or posted. `pairSplit`: a step that changed the first message together with the alternate
// first messages would land only one of the two, so it stops whole (the bound-step rule).
export type ModelRefusal = 'empty' | 'unknown' | 'precondition' | 'unchanged' | 'pairSplit'

// Why a greeting-list skip happened, from the side of a fingerprinted step the live list was on: `neither` is a list
// changed elsewhere, `other` a list that already holds the step's result (an earlier save may not have finished).
// In memory only: never stored, never posted, never part of a committed step.
export type ListSkipReason = 'neither' | 'other'

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
    // Why the list ops were skipped, when the hash decision of a fingerprinted step says so. A replay sets it on an
    // `already` move over side `other`; a revert sets it only when every skipped list op was skipped at or after its
    // hash stop. Absent otherwise.
    listReason?: ListSkipReason
    // Revert only: steps left whole because they changed the first message together with the alternate first
    // messages and one of the two no longer fits. Absent when none.
    pairSkipped?: number
    // Fingerprints of the live list before the plan's ops and, after them: a revert's final fill, or
    // for a whole expected-side replay the step's other-side fingerprint. They only let the commit or
    // the move reuse a hash the plan already holds; they are never stored or posted.
    liveListHash?: number
    afterListHash?: number
    // Replay only: every change of the step is already in the state the replay would produce, so nothing is
    // written and the step moves to the other list with `ops` by reference.
    already?: 'undo' | 'redo'
    // Replay only: the step can no longer be replayed here and is removed from its list instead of moved.
    dropStep?: true
    // Revert only: asset rows whose file is gone and that the revert did not re-insert.
    goneRows?: string[]
    // Restore of a deleted item only: the page write for an open chat without a unique id. In memory only, never stored.
    pageFm?: number
    // Replay only: the registry targets of the step's text ops that were skipped because the live text had moved on and
    // does not already hold the result (`firstMessage`, `desc`, `exampleMessage`, `alternateGreetings/<i>` or a registry
    // path), unique and in the step's own order. Absent when none. In memory only, never stored or posted; it changes no
    // verdict and no branch of the replay.
    notRestored?: string[]
}

export type PlanResult =
    | StepPlan
    | { ok: false; reason: Exclude<ModelRefusal, 'unchanged'>; listReason?: ListSkipReason }
    | { ok: false; reason: 'unchanged'; listSkipped?: number; listReason?: ListSkipReason; pairSkipped?: number; fmNotRestored?: boolean; goneRows?: string[] }

interface Working {
    field(path: SetPath): FieldValue
    setField(path: SetPath, value: FieldValue): void
    list: string[] | null
    fm(chatId: string): FmValue | null
    setFm(chatId: string, value: FmValue): void
    // Copies of the live asset rows, read once per array; null when unreadable.
    rows(array: AssetArrayName): string[][] | null
    // The stored folder value as the step's earlier ops left it. `readable` is false without a reader.
    folder(): { readable: boolean; value: unknown }
    setFolder(value: unknown): void
    text(target: string): string | null
    setText(target: string, value: string): void
}

function makeWorking(live: LiveReader): Working {
    const fields = new Map<SetPath, FieldValue>()
    const fms = new Map<string, FmValue | null>()
    const arrays = new Map<AssetArrayName, string[][] | null>()
    const texts = new Map<string, string | null>()
    let folderState: { readable: boolean; value: unknown } | null = null
    const greetings = live.greetings()
    return {
        rows(array) {
            if (!arrays.has(array)) {
                const rows = live.assetRows ? live.assetRows(array) : null
                arrays.set(array, rows === null ? null : rows.map((row) => [...row]))
            }
            return arrays.get(array) ?? null
        },
        folder() {
            if (!folderState) {
                folderState = live.folderValue ? { readable: true, value: live.folderValue() } : { readable: false, value: undefined }
            }
            return folderState
        },
        setFolder(value) {
            folderState = { readable: true, value }
        },
        text(target) {
            if (!texts.has(target)) {
                texts.set(target, live.text ? live.text(target) : null)
            }
            return texts.get(target) ?? null
        },
        setText(target, value) {
            texts.set(target, value)
        },
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
        case 'assetRowRemove':
            return { op: 'assetRowInsert', array: op.array, index: op.index, tuple: [...op.tuple], count: op.count - 1 }
        case 'assetRowInsert':
            return { op: 'assetRowRemove', array: op.array, index: op.index, tuple: [...op.tuple], count: op.count + 1 }
        case 'assetRowSet':
            return { op: 'assetRowSet', array: op.array, index: op.index, before: [...op.after], after: [...op.before] }
        case 'assetFolderSet':
        case 'assetFolderOrder':
            return fromFolderOp(invertFolderOp(toFolderOp(op)))
        case 'textEdit':
            return { op: 'textEdit', target: op.target, offset: op.offset, from: op.to, to: op.from }
    }
}

// Only a path under `assets/` names a file in the byte store; any other row path is put back as it was, never probed (MC-1833).
export function isStoredAssetPath(path: string): boolean {
    return path.startsWith('assets/')
}

// The asset paths a replay of `steps` may put a row over: the path of every row it inserts, and the new path of a row
// it re-points. Each step's ops are walked as the replay applies them (inverted for an undo or a revert). Sorted, unique.
export function assetPathsReplayMayInsert(steps: readonly Step[], direction: 'undo' | 'redo'): string[] {
    const paths = new Set<string>()
    for (const step of steps) {
        for (const stored of step.ops) {
            const op = direction === 'undo' ? invertOp(stored) : stored
            if (op.op === 'assetRowInsert' && typeof op.tuple[1] === 'string' && isStoredAssetPath(op.tuple[1])) {
                paths.add(op.tuple[1])
            } else if (op.op === 'assetRowSet' && op.after[1] !== op.before[1] && typeof op.after[1] === 'string' && isStoredAssetPath(op.after[1])) {
                paths.add(op.after[1])
            }
        }
    }
    return [...paths].sort()
}

// The folder codec's own op shape (`kind`) and this model's (`op`) carry the same fields.
function toFolderOp(op: Extract<Op, { op: 'assetFolderSet' | 'assetFolderOrder' }>): FolderOp {
    return op.op === 'assetFolderSet'
        ? { kind: 'assetFolderSet', name: op.name, before: op.before, after: op.after }
        : { kind: 'assetFolderOrder', before: op.before, after: op.after }
}

function fromFolderOp(op: FolderOp): Extract<Op, { op: 'assetFolderSet' | 'assetFolderOrder' }> {
    return op.kind === 'assetFolderSet'
        ? { op: 'assetFolderSet', name: op.name, before: op.before, after: op.after }
        : { op: 'assetFolderOrder', before: [...op.before], after: [...op.after] }
}

// How a `textEdit` target is read and written: one of the owner's text fields, an entry of the first message list, or
// any other registry text (served by the live reader). Null when the path is no registry address at all. Every
// classification of a target goes through `parseTargetPath`, so a path is one kind everywhere. `routeOf` is the one
// router: the history replay (`textWriteFor`), Update-All (`writeOpFor`) and the character text writer's skip
// (`textFieldOf`) all ask it, so no target is both written as a `set` and skipped as a `textSet`.
type TextRoute = { kind: 'field'; path: TextFieldPath } | { kind: 'greeting'; index: number } | { kind: 'text' }

function routeOf(target: string): TextRoute | null {
    // The owner kind is not known here: a module-only path parses as a module path, and the reader of the
    // owner that does not hold the path refuses it.
    const parsed = parseTargetPath('character', target) ?? parseTargetPath('module', target)
    if (parsed === null) {
        return null
    }
    if ('greeting' in parsed) {
        return { kind: 'greeting', index: parsed.greeting }
    }
    if (!('trigger' in parsed) && !('entry' in parsed)) {
        const candidate = 'nested' in parsed ? `${parsed.nested}.${parsed.field}` : parsed.field
        const path = TEXT_FIELD_PATHS.find((entry) => entry === candidate)
        if (path !== undefined) {
            return { kind: 'field', path }
        }
    }
    return { kind: 'text' }
}

// The text field a registry target is, null for every other target (including a field path written with a dot).
export function textFieldOf(target: string): TextFieldPath | null {
    const route = routeOf(target)
    return route !== null && route.kind === 'field' ? route.path : null
}

function greetingEntryOf(target: string): number | null {
    const route = routeOf(target)
    return route !== null && route.kind === 'greeting' ? route.index : null
}

function tupleEquals(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i])
}

function countOf(rows: readonly (readonly string[])[], tuple: readonly string[]): number {
    let count = 0
    for (const row of rows) {
        if (tupleEquals(row, tuple)) {
            count += 1
        }
    }
    return count
}

// The registry target that addresses a text field path: the dotted path with its one dot as a slash.
function textTargetOfField(path: TextFieldPath): string {
    return path.replace('.', '/')
}

// The registry target of a value op that changes a text: a `textEdit`'s target, a text field's `set`, an alternate
// first message's `listSet`. Null for every op that is not a text change (rows, folders, other fields, chat indexes).
function textTargetOfOp(op: Op): string | null {
    if (op.op === 'textEdit') {
        return op.target
    }
    if (op.op === 'set') {
        const path = TEXT_FIELD_PATHS.find((entry) => entry === op.path)
        return path === undefined ? null : textTargetOfField(path)
    }
    return op.op === 'listSet' ? `alternateGreetings/${op.index}` : null
}

// The text a `textEdit` reads and writes: the field for a text field, the list entry for a first message, the owner's
// registry text otherwise. Null when it cannot be read, which includes a target outside the registry.
function textOf(target: string, working: Working): string | null {
    const route = routeOf(target)
    if (route === null) {
        return null
    }
    if (route.kind === 'field') {
        const field = working.field(route.path)
        return field.had && typeof field.value === 'string' ? field.value : null
    }
    if (route.kind === 'greeting') {
        const value = working.list ? working.list[route.index] : undefined
        return typeof value === 'string' ? value : null
    }
    return working.text(target)
}

function storeText(target: string, text: string, working: Working): void {
    const route = routeOf(target)
    if (route === null) {
        return
    }
    if (route.kind === 'field') {
        working.setField(route.path, { had: true, value: text })
    } else if (route.kind === 'greeting') {
        if (working.list) {
            working.list[route.index] = text
        }
    } else {
        working.setText(target, text)
    }
}

// Whether `text` holds `span` at `offset` as a whole reference name: the text there equals `span`, and the scanner, run
// on the whole text with the target as its path, reads an unflagged reference of either kind whose name span is exactly
// `[offset, offset + span.length)`. It is the same question the merge planner asked when it chose the place, so replay
// cannot drift from the scanner. Every `textEdit` of every step goes through this one check, whichever label the step
// carries: only a merge, or a revert that crossed one, stores a `textEdit`.
// - C1: a `textEdit` applies at its offset only while this holds for its `from`.
// - C2: the "already holds the result" test is the same check with `to`.
// - C3: anything else is left as it is; an undo or redo lists it, a revert counts it as skipped.
// - C4: replay changes no character outside a whole scanned reference name.
// - L1, accepted limitation: a place is known by its offset and its whole name only, so a reference with the same name
//   at the same offset counts as the same place, whichever occurrence, type word or kind it now is.
function spanHoldsAt(text: string, offset: number, span: string, target: string): boolean {
    if (text.slice(offset, offset + span.length) !== span) {
        return false
    }
    return (['asset', 'emotion'] as const).some((kind) =>
        scanReferences(text, kind, target).some((reference) => reference.flag === undefined && reference.offset === offset && reference.length === span.length),
    )
}

// The one splice: it computes a whole value on the plan's working copy, and the writes carry that value.
function spliceText(text: string, edit: { offset: number; from: string; to: string }): string {
    return text.slice(0, edit.offset) + edit.to + text.slice(edit.offset + edit.from.length)
}

// The write that lands a text target's whole new value: the one target-to-write decision.
export function textWriteFor(target: string, next: string): WriteOp {
    const route = routeOf(target)
    if (route !== null && route.kind === 'field') {
        return { op: 'set', path: route.path, value: { had: true, value: next } }
    }
    if (route !== null && route.kind === 'greeting') {
        return { op: 'listSet', index: route.index, value: next }
    }
    return { op: 'textSet', target, value: next }
}

// The text fields' values as the owner holds them now, for the restore point to learn from a `textEdit`.
export type TextBefore = Partial<Record<TextFieldPath, string>>

export function textBeforeOf(field: (path: TextFieldPath) => FieldValue, paths: readonly TextFieldPath[] = TEXT_FIELD_PATHS): TextBefore {
    const out: TextBefore = {}
    for (const path of paths) {
        const value = field(path)
        if (value.had && typeof value.value === 'string') {
            out[path] = value.value
        }
    }
    return out
}

// The writes of an asset build's ops as the owner write applies them: every `textEdit`, `set` and `listSet` is checked
// against a working copy of the live owner and lands as its whole value (the rest of the plan's edits of one target
// follow the running value); an asset op is its own write; any other op writes nothing here. Null when a value op
// cannot apply, so the caller refuses before anything is written. A merge step holds `set` and `listSet` for its first
// message and alternates, so dropping them here would record a step whose writes never landed.
export function assetStepWrites(ops: readonly Op[], live: LiveReader): WriteOp[] | null {
    const working = makeWorking(live)
    const writes: WriteOp[] = []
    for (const op of ops) {
        if (op.op === 'textEdit' || op.op === 'set' || op.op === 'listSet') {
            const outcome = applyForward(op, working)
            if (outcome.kind !== 'applied') {
                return null
            }
            writes.push(outcome.write)
        } else if (op.op === 'assetRowRemove' || op.op === 'assetRowInsert' || op.op === 'assetRowSet' || op.op === 'assetFolderSet' || op.op === 'assetFolderOrder') {
            writes.push(op)
        }
    }
    return writes
}

type ApplyOutcome = { kind: 'applied'; write: WriteOp } | { kind: 'inert' } | { kind: 'failed' }

// The ops whose precondition is a value comparison. `applyForward` and the revert's bound-step pre-decision both
// ask this one function, so the non-mutating check cannot drift from the op loop.
type ValueOp = Extract<Op, { op: 'set' | 'listSet' | 'textEdit' }>

function forwardPreconditionHolds(op: ValueOp, working: Working): boolean {
    switch (op.op) {
        case 'set':
            return fieldValueEquals(working.field(op.path), op.before)
        case 'listSet':
            return !!working.list && working.list[op.index] === op.before
        case 'textEdit': {
            const text = textOf(op.target, working)
            return text !== null && spanHoldsAt(text, op.offset, op.from, op.target)
        }
    }
}

// Checks one forward op's precondition against the working copy and applies it there.
function applyForward(op: Op, working: Working): ApplyOutcome {
    switch (op.op) {
        case 'set':
            if (!forwardPreconditionHolds(op, working)) {
                return { kind: 'failed' }
            }
            working.setField(op.path, op.after)
            return { kind: 'applied', write: { op: 'set', path: op.path, value: op.after } }
        case 'listSet':
            if (!forwardPreconditionHolds(op, working) || !working.list) {
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
        case 'assetRowRemove': {
            const rows = working.rows(op.array)
            if (!rows || countOf(rows, op.tuple) !== op.count || !rows[op.index] || !tupleEquals(rows[op.index], op.tuple)) {
                return { kind: 'failed' }
            }
            rows.splice(op.index, 1)
            return { kind: 'applied', write: { ...op, tuple: [...op.tuple] } }
        }
        case 'assetRowInsert': {
            const rows = working.rows(op.array)
            if (!rows || countOf(rows, op.tuple) !== op.count || op.index > rows.length) {
                return { kind: 'failed' }
            }
            rows.splice(op.index, 0, [...op.tuple])
            return { kind: 'applied', write: { ...op, tuple: [...op.tuple] } }
        }
        case 'assetRowSet': {
            const rows = working.rows(op.array)
            if (!rows || !rows[op.index] || !tupleEquals(rows[op.index], op.before)) {
                return { kind: 'failed' }
            }
            rows[op.index] = [...op.after]
            return { kind: 'applied', write: { ...op, before: [...op.before], after: [...op.after] } }
        }
        case 'assetFolderSet':
        case 'assetFolderOrder': {
            const folder = working.folder()
            if (!folder.readable) {
                return { kind: 'failed' }
            }
            const result = applyFolderOps(folder.value, [toFolderOp(op)])
            if (!result.ok) {
                return { kind: 'failed' }
            }
            working.setFolder(result.doc ?? undefined)
            return { kind: 'applied', write: fromFolderOp(toFolderOp(op)) }
        }
        case 'textEdit': {
            const text = textOf(op.target, working)
            if (text === null || !forwardPreconditionHolds(op, working)) {
                return { kind: 'failed' }
            }
            const next = spliceText(text, op)
            storeText(op.target, next, working)
            return { kind: 'applied', write: textWriteFor(op.target, next) }
        }
    }
}

// Whether the working copy positively holds what `op` produces, for an op that failed to apply. An
// unreadable value is never at the target.
function holdsResultOf(op: Op, working: Working): boolean {
    switch (op.op) {
        case 'set':
            return fieldValueEquals(working.field(op.path), op.after)
        case 'listSet':
            return !!working.list && working.list[op.index] === op.after
        case 'listInsert':
            return false
        case 'listRemove':
            return !!working.list && !working.list.includes(op.value)
        case 'chatFm': {
            if (op.chatId === null) {
                return false
            }
            const current = working.fm(op.chatId)
            return !!current && fmValueEquals(current, op.after)
        }
        case 'assetRowRemove':
        case 'assetRowInsert': {
            const rows = working.rows(op.array)
            return !!rows && countOf(rows, op.tuple) === (op.op === 'assetRowRemove' ? op.count - 1 : op.count + 1)
        }
        case 'assetRowSet': {
            const rows = working.rows(op.array)
            return !!rows && !!rows[op.index] && tupleEquals(rows[op.index], op.after)
        }
        case 'assetFolderSet':
        case 'assetFolderOrder': {
            const folder = working.folder()
            return folder.readable && folderOpAtTarget(folder.value, toFolderOp(op))
        }
        case 'textEdit': {
            const text = textOf(op.target, working)
            return text !== null && spanHoldsAt(text, op.offset, op.to, op.target)
        }
    }
}

// What the restore point must learn from a set of forward ops. List ops collapse into one
// whole-array write because the restore point stores the whole greeting list.
// `textBefore` holds the text fields' values before the ops (the plan carries them); without a field's value a
// `textEdit` on that field contributes nothing. A `textEdit` on a first message entry splices that entry of the list copy.
export function deriveRestoreWrites(
    forwardOps: readonly Op[],
    greetingsBefore: readonly string[] | null,
    textBefore?: TextBefore,
): RestoreWrite[] {
    const byPath = new Map<SetPath, RestoreWrite>()
    let list: string[] | null = greetingsBefore === null ? null : [...greetingsBefore]
    let listTouched = false
    for (const op of forwardOps) {
        if (op.op === 'textEdit') {
            const textField = textFieldOf(op.target)
            if (textField !== null) {
                const known = byPath.get(textField)
                const start = textBefore?.[textField]
                const current = known ? (known.after as FieldValue) : start === undefined ? null : ({ had: true, value: start } as FieldValue)
                if (current && current.had && typeof current.value === 'string') {
                    const before: FieldValue = known ? (known.before as FieldValue) : current
                    byPath.set(textField, { path: textField, before, after: { had: true, value: spliceText(current.value, op) } })
                }
                continue
            }
            const greeting = greetingEntryOf(op.target)
            if (greeting !== null) {
                listTouched = true
                if (list && typeof list[greeting] === 'string') {
                    list[greeting] = spliceText(list[greeting], op)
                }
            }
            continue
        }
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

// A greeting-list op: a list op, or a `textEdit` on an entry of the greeting list. One predicate serves the
// unreadable-list gate of a replay and the side and stop rules of a revert.
function touchesGreetingList(op: Op): boolean {
    return isListOp(op) || (op.op === 'textEdit' && greetingEntryOf(op.target) !== null)
}

function hasInsertOrRemove(ops: readonly Op[]): boolean {
    return ops.some((op) => op.op === 'listInsert' || op.op === 'listRemove')
}

// ---------------------------------------------------------------- bound-step rule

// A step that changed the first message together with the alternate first messages lands both or stops whole, in an
// undo, a redo and a revert alike. The rule keys on the step's ops, never on its label. This block is its one definition:
// `planReplay` and `planRevert` decide a step through `boundVerdict` and restate nothing.
//
// The group is the `set` ops on `firstMessage` plus every op on the alternate list (`touchesGreetingList`). A `chatFm` op is never in the group: a
// skipped chat index never stops a step. The list half (L) is whether the alternate list takes the step's change, the
// first message half (F) whether the field does:
//
//   L \ F        passes   holds   neither
//   applies      apply    stop    stop
//   in place     stop     today   stop
//   neither      stop     stop    stop
//
// `apply` runs the step's ops, `today` leaves them to the existing nothing-to-apply rules, `stop` lands none of them.
type ListHalf = 'applies' | 'inPlace' | 'neither'
type FirstMessageHalf = 'passes' | 'holds' | 'neither'
type BoundVerdict = 'apply' | 'today' | 'stop'
type GroupOutcome = 'applied' | 'kept' | 'failed'

interface BoundGroup {
    fmSets: Extract<Op, { op: 'set' }>[]
    listOps: Op[]
}

function boundGroupOf(ops: readonly Op[]): BoundGroup | null {
    const fmSets: Extract<Op, { op: 'set' }>[] = []
    for (const op of ops) {
        if (op.op === 'set' && op.path === 'firstMessage') {
            fmSets.push(op)
        }
    }
    const listOps = ops.filter(touchesGreetingList)
    return fmSets.length > 0 && listOps.length > 0 ? { fmSets, listOps } : null
}

// The entry of the alternate list a group op changes. Null for an insert or a remove, which shift entries.
function entryIndexOf(op: Op): number | null {
    if (op.op === 'listSet') {
        return op.index
    }
    return op.op === 'textEdit' ? greetingEntryOf(op.target) : null
}

// The list half of a step without a fingerprint, from what each group op did. A step that holds an insert or a remove
// (recorded while the list could not be read) or two ops on one entry cannot be decided per entry: neither.
function unfingerprintedListHalf(listOps: readonly Op[], outcomeOf: (op: Op) => GroupOutcome): ListHalf {
    if (hasInsertOrRemove(listOps)) {
        return 'neither'
    }
    const entries = new Set<number>()
    for (const op of listOps) {
        const entry = entryIndexOf(op)
        if (entry === null || entries.has(entry)) {
            return 'neither'
        }
        entries.add(entry)
    }
    const outcomes = listOps.map(outcomeOf)
    if (outcomes.every((outcome) => outcome === 'applied')) {
        return 'applies'
    }
    return outcomes.every((outcome) => outcome === 'kept') ? 'inPlace' : 'neither'
}

// Two first message values in one step have no single list half to agree with.
function boundListHalf(group: BoundGroup, list: ListHalf): ListHalf {
    return group.fmSets.length > 1 ? 'neither' : list
}

function boundVerdict(list: ListHalf, firstMessage: FirstMessageHalf): BoundVerdict {
    if (list === 'applies' && firstMessage === 'passes') {
        return 'apply'
    }
    return list === 'inPlace' && firstMessage === 'holds' ? 'today' : 'stop'
}

function firstMessageHalfOf(outcome: GroupOutcome): FirstMessageHalf {
    return outcome === 'applied' ? 'passes' : outcome === 'kept' ? 'holds' : 'neither'
}

// What a revert would do with one stored op, without changing the working copy: the inverse applies, is already in
// place, or fails. The checks are the ones the op loop makes.
function revertOutcomeOf(original: Op, working: Working): GroupOutcome {
    const forward = invertOp(original)
    if (forward.op !== 'set' && forward.op !== 'listSet' && forward.op !== 'textEdit') {
        return 'failed'
    }
    if (forwardPreconditionHolds(forward, working)) {
        return 'applied'
    }
    return holdsResultOf(forward, working) ? 'kept' : 'failed'
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
export function planReplay(
    record: OwnerRecord,
    direction: 'undo' | 'redo',
    live: LiveReader,
    hashFor?: ListElementHash,
    // Asset rows (by their path, `tuple[1]`) whose file is gone: a forward insert of one is left out, in either direction.
    goneRows?: ReadonlySet<string>,
): PlanResult {
    const stack = direction === 'undo' ? record.done : record.undone
    const step = stack[stack.length - 1]
    if (!step) {
        return { ok: false, reason: 'empty' }
    }
    const working = makeWorking(live)
    const rowsAndText = holdsRowsAndText(step)
    const greetingsBefore = working.list ? [...working.list] : null
    // One decision before any op runs, so the hash is of the list the plan starts from.
    const hash = step.listFingerprint && working.list !== null ? listFingerprintOf(working.list, hashFor?.(working.list)) : undefined
    const side: ListSide = step.listFingerprint && hash !== undefined ? sideFromHash(step.listFingerprint, direction, hash) : 'none'
    // Exact or nothing: a fingerprinted step whose list is not the side it was recorded at applies
    // no op, so no chat index or field lands against a list the step never described. The step
    // stays on its stack, so Undo stops at it until the list is repaired by hand or 100 newer
    // steps push the step out. Steps without a fingerprint keep the per-op checks. An expected-side
    // replay whose chat op fails stays partial: only the list witnesses a fingerprint.
    if (side === 'neither') {
        return { ok: false, reason: 'precondition', listReason: 'neither' }
    }
    // A step that holds a greeting-list op is refused whole when the list cannot be read, with or
    // without a fingerprint, so no chat index or field lands against a list nobody could check.
    if (working.list === null && step.ops.some(touchesGreetingList)) {
        return { ok: false, reason: 'precondition' }
    }
    const order = direction === 'undo' ? [...step.ops].reverse() : step.ops
    const applied: Op[] = []
    const executed: Op[] = []
    const writes: WriteOp[] = []
    const deletedRemove: string[] = []
    const kept: Op[] = []
    let skipped = 0
    let real = 0
    let consumed = 0
    let unverifiable = 0
    let failed = 0
    let fmNotRestored = false
    const goneSeen = new Set<string>()
    const skippedText = new Set<Op>()
    // Read before the loop: the working copy's text fields move as the ops apply.
    const targeted = new Set<TextFieldPath>()
    for (const op of step.ops) {
        const textField = op.op === 'textEdit' ? textFieldOf(op.target) : null
        if (textField !== null) {
            targeted.add(textField)
        }
    }
    const textBefore = textBeforeOf((path) => working.field(path), [...targeted])
    for (const original of order) {
        // A delete can be undone only while its deleted item is still listed: restoring the item
        // from History consumes it, so the two routes exclude each other. On the expected side the
        // list is the step's after list, so the inverse is a plain insert that consumes nothing.
        const plainUndo =
            direction === 'undo' && original.op === 'listRemove' && original.deletedId !== null && !hasDeletedId(record, original.deletedId)
        if (plainUndo && side !== 'expected') {
            // The list is readable here: the item is gone from History, so its removal cannot be undone.
            consumed += 1
            skipped += 1
            continue
        }
        const forward = direction === 'undo' ? invertOp(original) : original
        // A row whose file is gone is never re-inserted, whichever step direction produced the insert. A step that holds rows
        // and texts is refused whole instead: its texts would name a row that stays absent. Nothing has been written yet.
        if (forward.op === 'assetRowInsert' && goneRows?.has(forward.tuple[1])) {
            if (rowsAndText) {
                return { ok: false, reason: 'precondition' }
            }
            goneSeen.add(forward.tuple[1])
            skipped += 1
            continue
        }
        // Side `other`: the list already holds what a list op would produce.
        if (side === 'other' && isListOp(original)) {
            kept.push(original)
            continue
        }
        if (original.op === 'chatFm' && original.chatId === null) {
            kept.push(original)
            applied.push(original)
            fmNotRestored = true
            continue
        }
        if (side === 'none' && skipsOccupiedSlot(forward, working)) {
            skipped += 1
            if (direction === 'undo') {
                unverifiable += 1
            } else {
                failed += 1
            }
            continue
        }
        if (side === 'other') {
            // Past the list ops, a step on side `other` only moves: nothing is applied to a list the step
            // did not describe.
            if (holdsResultOf(forward, working)) {
                kept.push(original)
            } else {
                failed += 1
                skipped += 1
            }
            continue
        }
        const outcome = applyForward(forward, working)
        if (outcome.kind === 'failed') {
            skipped += 1
            // On the expected side a failed list op stays failed: the fingerprint witnesses the list.
            const atTarget = !(side === 'expected' && isListOp(original)) && !(side === 'none' && forward.op === 'listInsert') && holdsResultOf(forward, working)
            if (atTarget) {
                kept.push(original)
            } else if (rowsAndText && isAssetRowOp(forward)) {
                // The rows and the texts of such a step name each other: texts restored over rows that cannot be, or
                // the reverse, would leave names no row holds. Nothing has been written yet, so the whole replay stops here.
                return { ok: false, reason: 'precondition' }
            } else {
                failed += 1
                skippedText.add(original)
            }
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
    // The bound-step rule runs on the recorded outcomes of this trial run, so a stop lands nothing: the writes leave
    // only through the result. On the expected side the list half applies only when every group list op did.
    const group = boundGroupOf(step.ops)
    if (group !== null) {
        const appliedSet = new Set(applied)
        const keptSet = new Set(kept)
        const outcomeOf = (op: Op): GroupOutcome => (appliedSet.has(op) ? 'applied' : keptSet.has(op) ? 'kept' : 'failed')
        const list = boundListHalf(
            group,
            side === 'expected'
                ? group.listOps.every((op) => appliedSet.has(op)) ? 'applies' : 'neither'
                : side === 'other'
                  ? 'inPlace'
                  : unfingerprintedListHalf(group.listOps, outcomeOf),
        )
        if (boundVerdict(list, firstMessageHalfOf(outcomeOf(group.fmSets[0]))) === 'stop') {
            return { ok: false, reason: 'pairSplit' }
        }
    }
    if (real === 0) {
        // Nothing applied: the step moves when every change is already in place (R1), is dropped when the
        // only changes that did not apply cannot be replayed here (R1c), and is refused otherwise (R2).
        const inPlace = kept.length - kept.filter((op) => op.op === 'chatFm' && op.chatId === null).length
        const unreplayable = consumed + unverifiable + goneSeen.size
        if (failed > 0 || (inPlace === 0 && unreplayable === 0)) {
            return { ok: false, reason: 'precondition' }
        }
        const items: string[] = []
        if (direction === 'undo') {
            for (const op of kept) {
                if (op.op === 'listRemove' && op.deletedId !== null && hasDeletedId(record, op.deletedId)) {
                    items.push(op.deletedId)
                }
            }
        }
        const keptOps = step.ops.filter((op) => kept.includes(op))
        return {
            ok: true,
            label: step.label,
            ops: unreplayable > 0 ? keptOps : step.ops,
            writes: [],
            restoreWrites: [],
            deletedRemove: items,
            skipped: 0,
            fmNotRestored: false,
            ...(unreplayable > 0 ? { dropStep: true as const } : { already: direction }),
            ...(unreplayable === 0 && side === 'other' ? { listReason: 'other' as const } : {}),
            ...(goneSeen.size > 0 ? { goneRows: [...goneSeen].sort() } : {}),
        }
    }
    if (direction === 'undo') {
        applied.reverse()
    }
    // Count list ops only: a chat op that failed must not cancel the shortcut.
    const whole = applied.filter(isListOp).length === step.ops.filter(isListOp).length
    // The text places a partial replay left as they were: collected from the ops that failed and do not already hold the
    // result, in the step's own order. It only reports; no branch above reads it.
    const notRestored: string[] = []
    for (const op of step.ops) {
        const target = skippedText.has(op) ? textTargetOfOp(op) : null
        if (target !== null && !notRestored.includes(target)) {
            notRestored.push(target)
        }
    }
    return {
        ok: true,
        label: step.label,
        ops: applied,
        writes,
        restoreWrites: deriveRestoreWrites(executed, greetingsBefore, textBefore),
        deletedRemove,
        skipped,
        fmNotRestored,
        ...(notRestored.length > 0 && listsLeftTexts(step) ? { notRestored } : {}),
        ...(goneSeen.size > 0 ? { goneRows: [...goneSeen].sort() } : {}),
        ...(hash === undefined ? {} : { liveListHash: hash }),
        // On the expected side the live list is the side the step was recorded at; with every list op
        // applied it ends on the list the other side's fingerprint was taken from (invariant L6).
        ...(side === 'expected' && whole && step.listFingerprint
            ? { afterListHash: direction === 'undo' ? step.listFingerprint.before : step.listFingerprint.after }
            : {}),
    }
}

function isAssetRowOp(op: Op): boolean {
    return op.op === 'assetRowInsert' || op.op === 'assetRowRemove' || op.op === 'assetRowSet'
}

// A step whose ops hold an asset row op and a text op (`textEdit`, a text field's `set`, an alternate's `listSet`): its
// rows and its texts are replayed together or not at all, in an undo, a redo and a revert alike. A merge holds both, and
// so does the revert step that crossed one; the rule keys on the ops, never on the label.
function holdsRowsAndText(step: Step): boolean {
    return step.ops.some(isAssetRowOp) && step.ops.some((op) => textTargetOfOp(op) !== null)
}

// Whether a replay names the places it left: a step that holds a `textEdit` (only a merge, or a revert that crossed
// one, stores it) or rows together with a text. Other steps keep the plain skipped count.
function listsLeftTexts(step: Step): boolean {
    return holdsRowsAndText(step) || step.ops.some((op) => op.op === 'textEdit')
}

// Whether reverting a step that holds rows and a text would meet a row op that fails and is not already at its target, or
// a row insert whose file is gone (it would be left out while the texts returned to its name). The check runs the step's
// row ops on a copy of the working rows, so the working copy is not touched.
function rowOpsStop(step: Step, working: Working, goneRows?: ReadonlySet<string>): boolean {
    const copies = new Map<AssetArrayName, string[][] | null>()
    const trial: Working = {
        ...working,
        rows(array) {
            if (!copies.has(array)) {
                const rows = working.rows(array)
                copies.set(array, rows === null ? null : rows.map((row) => [...row]))
            }
            return copies.get(array) ?? null
        },
    }
    for (const original of [...step.ops].reverse()) {
        const forward = invertOp(original)
        if (!isAssetRowOp(forward)) {
            continue
        }
        if (forward.op === 'assetRowInsert' && goneRows?.has(forward.tuple[1])) {
            return true
        }
        if (applyForward(forward, trial).kind === 'failed' && !holdsResultOf(forward, trial)) {
            return true
        }
    }
    return false
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

// The target a revert stores a chain for: an asset array, the folder document, or a registry text other than
// the three text fields (`desc`, `firstMessage`, `exampleMessage`: a `set` carries them) and a greeting entry
// (the list hunks carry it). Null for every other op.
type TargetKey = { kind: 'rows'; array: AssetArrayName } | { kind: 'folder' } | { kind: 'text'; target: string }

// The text a revert's maps use to tell targets apart; the typed key is what the snapshot reads.
function targetKeyText(key: TargetKey): string {
    switch (key.kind) {
        case 'rows':
            return 'rows:' + key.array
        case 'folder':
            return 'folder'
        case 'text':
            return 'text:' + key.target
    }
}

function targetKeyOf(op: Op): TargetKey | null {
    switch (op.op) {
        case 'assetRowRemove':
        case 'assetRowInsert':
        case 'assetRowSet':
            return { kind: 'rows', array: op.array }
        case 'assetFolderSet':
        case 'assetFolderOrder':
            return { kind: 'folder' }
        case 'textEdit': {
            const route = routeOf(op.target)
            return route !== null && route.kind !== 'text' ? null : { kind: 'text', target: op.target }
        }
        default:
            return null
    }
}

function snapshotOf(key: TargetKey, working: Working): string {
    switch (key.kind) {
        case 'folder':
            return JSON.stringify(working.folder().value ?? null)
        case 'rows':
            return JSON.stringify(working.rows(key.array))
        case 'text':
            return JSON.stringify(working.text(key.target))
    }
}

function trackAppliedOp(tracker: ListHashTracker, forward: Op): void {
    if (forward.op === 'textEdit') {
        const greeting = greetingEntryOf(forward.target)
        if (greeting !== null) {
            tracker.set(greeting)
        }
    } else if (forward.op === 'listSet') {
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
export function planRevert(
    record: OwnerRecord,
    toStepId: string,
    live: LiveReader,
    budgetUnits = REVERT_HASH_BUDGET_UNITS,
    hashFor?: ListElementHash,
    // Asset rows (by their path, `tuple[1]`) whose file is gone: a re-insert of one is not applied.
    goneRows?: ReadonlySet<string>,
): PlanResult {
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
    // Per asset array, the folder document and each registry text the revert touches: the value before its
    // first applied op, so a target that ends where it started stores and writes nothing. `writeTargets`
    // names the target of each entry of `writes`.
    const startOf = new Map<string, { key: TargetKey; start: string }>()
    const writeTargets: (string | null)[] = []
    const goneSeen = new Set<string>()
    let failedOther = 0
    const reopened = new Map<string, number>()
    // A tracker exists when some reverted step inserts or removes: only then does the list's shape
    // change under the steps above. Its first pass is the revert's `before` hash.
    const list = working.list
    const tracker = list !== null && above.some((step) => hasInsertOrRemove(step.ops)) ? createListHashTracker(list, hashFor?.(list)) : null
    const liveListHash = tracker && list ? tracker.hash(list) : undefined
    let spent = 0
    let suspended = false
    // Set when a stopped step's skipped list ops shift indexes: by the first fingerprinted step a hash
    // decision puts off its expected side, or by a bound-step stop of a step that holds an insert or a
    // remove. Exact or stop: from there on no older step decides by hash and no older step changes the
    // list, because every older list op would work against lifecycle state no step recorded.
    // Description and other fields still revert, and the chat's selected first message counts as one of
    // them for a step without a fingerprint. A budget suspension alone does not set it: a step without a
    // fingerprint keeps its per-op checks after a suspension, so on that route a repeated text can still
    // be applied. A bound-step stop skipping only `listSet` ops shifts no index and leaves it unchanged.
    let stopped = false
    // The side of the revert's hash stop, and the list ops counted before it. The reason is shown only when the hash
    // stop is the first cause and every counted list skip came at or after it: from the stop on, each list op is
    // skipped because the list is on that side. Bound-step stops, suspensions and per-op failures give no reason.
    let hashStop: ListSkipReason | null = null
    let skippedBeforeHashStop = 0
    let pairSkipped = 0
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
                        // `none` cannot occur here: the step has a fingerprint and the list is readable.
                        hashStop = side === 'none' ? null : side
                        skippedBeforeHashStop = listSkipped
                    }
                }
            }
            if (suspended || afterStop) {
                side = 'neither'
            }
        }
        // A step that holds rows and texts, and whose row ops cannot all be reverted, is left whole, like a bound step that
        // cannot replay (the bound-step stop below): its texts are never reverted over rows that stay as they are, and
        // older steps still revert. A revert with nothing else to apply refuses. Its skipped list ops count as skipped, and
        // a skipped insert or remove leaves every older list op working against a list the step would have reshaped, so
        // it stops them exactly as a stopped bound step does.
        if (holdsRowsAndText(step) && rowOpsStop(step, working, goneRows)) {
            skipped += step.ops.length
            failedOther += 1
            listSkipped += step.ops.filter(touchesGreetingList).length
            if (hasInsertOrRemove(step.ops)) {
                stopped = true
            }
            continue
        }
        // The bound-step rule, decided before any op of the step runs. A fingerprinted step takes its list half from
        // the side (a side that stayed `none` means the list could not be read: neither); a step without one from
        // `afterStop`, else from non-mutating checks of its ops.
        const group = boundGroupOf(step.ops)
        if (group !== null) {
            const list = boundListHalf(
                group,
                step.listFingerprint
                    ? side === 'expected'
                        ? 'applies'
                        : side === 'other'
                          ? 'inPlace'
                          : 'neither'
                    : afterStop
                      ? 'neither'
                      : unfingerprintedListHalf(group.listOps, (op) => revertOutcomeOf(op, working)),
            )
            if (boundVerdict(list, firstMessageHalfOf(revertOutcomeOf(group.fmSets[0], working))) === 'stop') {
                skipped += step.ops.length
                if (list !== 'inPlace') {
                    listSkipped += group.listOps.length
                }
                pairSkipped += 1
                if (hasInsertOrRemove(step.ops)) {
                    stopped = true
                }
                continue
            }
        }
        for (const original of [...step.ops].reverse()) {
            if (side === 'none' && afterStop && touchesGreetingList(original)) {
                skipped += 1
                listSkipped += 1
                continue
            }
            if ((side === 'other' || side === 'neither') && touchesGreetingList(original)) {
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
            if (forward.op === 'assetRowInsert' && goneRows?.has(forward.tuple[1])) {
                goneSeen.add(forward.tuple[1])
                skipped += 1
                continue
            }
            const targetKey = targetKeyOf(forward)
            const targetText = targetKey === null ? null : targetKeyText(targetKey)
            if (targetKey !== null && targetText !== null && !startOf.has(targetText)) {
                startOf.set(targetText, { key: targetKey, start: snapshotOf(targetKey, working) })
            }
            const textField = forward.op === 'textEdit' ? textFieldOf(forward.target) : null
            const fieldBeforeOp = textField === null ? null : working.field(textField)
            const outcome = applyForward(forward, working)
            if (outcome.kind === 'failed') {
                skipped += 1
                failedOther += 1
                if (touchesGreetingList(forward)) {
                    listSkipped += 1
                }
            } else if (outcome.kind === 'inert') {
                fmNotRestored = true
            } else {
                writeTargets.push(targetText)
                // A text field edit is stored as the net `set` of the field, with the rest of the field ops.
                ops.push(
                    textField !== null && fieldBeforeOp
                        ? { op: 'set', path: textField, before: fieldBeforeOp, after: working.field(textField) }
                        : forward,
                )
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
    const gone = goneSeen.size > 0 ? { goneRows: [...goneSeen].sort() } : {}
    const reason = hashStop !== null && skippedBeforeHashStop === 0 && listSkipped > 0 ? { listReason: hashStop } : {}
    if (ops.length === 0) {
        // Nothing applied: a pair stop with no other failure refuses with its own reason, which wins over the
        // gone-rows note (nothing was changed). A revert whose only failures are re-inserts of gone rows lands
        // nothing but names them; any other failure refuses.
        if (pairSkipped > 0 && failedOther === 0) {
            return { ok: false, reason: 'pairSplit' }
        }
        if (goneSeen.size > 0 && failedOther === 0) {
            return { ok: false, reason: 'unchanged', ...gone, ...(listSkipped > 0 ? { listSkipped } : {}), ...reason, ...(fmNotRestored ? { fmNotRestored } : {}) }
        }
        return { ok: false, reason: 'precondition' }
    }
    // A target that ends where it started drops out of the stored ops and of the writes.
    const netZero = new Set<string>()
    for (const [text, { key, start }] of startOf) {
        if (snapshotOf(key, working) === start) {
            netZero.add(text)
        }
    }
    if (netZero.size > 0) {
        const kept: WriteOp[] = []
        writes.forEach((write, at) => {
            const key = writeTargets[at]
            if (key === null || !netZero.has(key)) {
                kept.push(write)
            }
        })
        writes.length = 0
        writes.push(...kept)
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
    const stored = revertStepOps(ops, greetingsBefore, working.list, consumedValues, producedValues, netZero)
    if (stored.length === 0) {
        return {
            ok: false,
            reason: 'unchanged',
            ...gone,
            ...(listSkipped > 0 ? { listSkipped } : {}),
            ...reason,
            ...(pairSkipped > 0 ? { pairSkipped } : {}),
            ...(fmNotRestored ? { fmNotRestored } : {}),
        }
    }
    return {
        ok: true,
        label: { kind: 'revert', toStepId },
        ops: stored,
        writes,
        restoreWrites: deriveRestoreWrites(ops, greetingsBefore),
        deletedRemove: consumedNet,
        ...gone,
        skipped,
        ...(listSkipped > 0 ? { listSkipped } : {}),
        ...reason,
        ...(pairSkipped > 0 ? { pairSkipped } : {}),
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
    netZero: ReadonlySet<string>,
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
    // Chains of the asset and text targets, in applied order, after the value ops, hunks and pairs. The
    // chain applies op by op from the value the target had at the start.
    const chains: Op[] = []
    const chainFor = (): void => {
        const order: string[] = []
        const byTarget = new Map<string, Op[]>()
        for (const op of applied) {
            const target = targetKeyOf(op)
            const key = target === null ? null : targetKeyText(target)
            if (key === null || netZero.has(key)) {
                continue
            }
            const chain = byTarget.get(key)
            if (chain) {
                chain.push(op)
            } else {
                byTarget.set(key, [op])
                order.push(key)
            }
        }
        for (const key of order) {
            chains.push(...(byTarget.get(key) ?? []))
        }
    }
    chainFor()
    if (before === null || after === null) {
        return [...out, ...chains]
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
    return [...out, ...chains]
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

// The stored first-message index of the chat that shows an alternative after the entry at `d` is removed: main stays
// main, a removal after the shown entry leaves it, the shown entry itself sends the chat to main, an earlier removal
// moves it down one. `e` is the effective index (-1 for the default first message).
export function fmAfterRemove(e: number, d: number): number {
    if (e === -1 || d > e) {
        return e
    }
    return d === e ? -1 : e - 1
}

// Raw-integer follow of an insert at `i`: an integer stored value at or past `i` moves up by one. -1, other negatives,
// non-integers and absent stay; a stale value stays stale (v + 1 is past the new end).
export function fmAfterInsert(v: number, i: number): number {
    return Number.isInteger(v) && v >= i ? v + 1 : v
}

// The open chat a restore follows: by its unique id, or, for a chat without one, by the stored value the service read
// (the commit then writes it by page index).
export type RestoreContext = { chatId: string } | { chatId: null; fm: FmValue }

// Inserts a deleted item back at its old position (or the end of a shorter list) as one new step. Only the open chat
// (`context`) is adjusted, with at most one chatFm: it follows its text through the insert (a stored integer at or past
// the insert index moves up one), or, when it is the chat the delete reset to main and still reads -1, it goes back
// to the value the delete recorded. Every other chat is left as it is.
export function planRestoreDeleted(record: OwnerRecord, deletedId: string, live: LiveReader, context: RestoreContext | null): PlanResult {
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
    let pageFm: number | undefined
    // A chat that no longer exists (null) gets no op.
    const current = context === null ? null : 'fm' in context ? context.fm : live.fmIndex(context.chatId)
    if (context !== null && current !== null) {
        const sideChat = item.sideChat
        if (current.had && fmAfterInsert(current.value, index) !== current.value) {
            const next = fmAfterInsert(current.value, index)
            ops.push({ op: 'chatFm', chatId: context.chatId, before: current, after: { had: true, value: next } })
            if (context.chatId === null) {
                pageFm = next
            }
        } else if (
            context.chatId !== null &&
            sideChat?.chatId === context.chatId &&
            fmValueEquals(current, { had: true, value: -1 }) &&
            !(sideChat.before.had && Number.isInteger(sideChat.before.value) && sideChat.before.value > item.index)
        ) {
            // The reset branch needs a delete that reset the chat to main; a record from a delete that re-indexed
            // (before past the item's index) must not send the chat back to its old, now different, entry.
            ops.push({ op: 'chatFm', chatId: context.chatId, before: current, after: sideChat.before })
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
        ...(pageFm === undefined ? {} : { pageFm }),
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
    if (plan.already !== undefined) {
        // Nothing was written, so the step still spans the lists it was recorded on: the fingerprint
        // carries over, else a later replay would take the per-op path and refuse a legitimate re-insert.
        if (step.listFingerprint) {
            moved.listFingerprint = step.listFingerprint
        }
    } else if (listWrite) {
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
            const id = step.label.deletedId
            deleted = deleted.some((item) => item.id === id)
                ? deleted
                : capped([...deleted, ...restoredItemFromOps(plan.ops, step.at, id)], MAX_DELETED)
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
    if (plan.dropStep) {
        // The step leaves its list and goes nowhere; the deleted bookkeeping above is the move's.
        const next: OwnerRecord =
            direction === 'undo'
                ? { ...record, touchedAt: at, done: rest, deleted, restore }
                : { ...record, touchedAt: at, undone: rest, deleted, restore }
        return { record: next, open: null }
    }
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
