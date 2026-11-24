// The object-list op family of the Studio history: the shapes `objInsert`, `objRemove`, `objSet` and `propSet`, the
// obj deleted item and the obj and prop labels, as stored; their strict parsers; and the pure helpers every
// route shares (canonical JSON, anchors, identities, tag runs, inversion). It is part of the stored format: every
// shape here is refused whole by a reader that does not know it, and every function is total, so a list holding
// non-objects, cycles or bigints never throws. Every list-dependent rule reads the tables of `objectLists.ts`.

import type { JsonObject, JsonValue } from '../../storage/blockFrame'
import { isJsonObject, sameJsonValue, toPlainJson } from '../../storage/store2/codec/normalize'
import type { LiveReader } from './historyModel'
import { fingerprintElement } from './listFingerprint'
import {
    OBJ_LIST_ANCHOR_EXCLUDED,
    OBJ_LIST_FIELDS,
    OBJ_LIST_HOLDERS,
    OBJ_LIST_IDENTITY,
    OBJ_LIST_MESSAGES,
    OBJ_LIST_ASSET_PREFIX,
    OBJ_PROPS,
    type ObjFieldKind,
    type ObjIdentityRow,
    type ObjListFieldsRow,
    type ObjListName,
    type PropName,
} from './objectLists'

// A list name, tables and every message key share the list names; a replaced table that drops one is a defect.
function checkTables(): void {
    const names = Object.keys(OBJ_LIST_FIELDS).sort().join(',')
    const tables: Record<string, object> = {
        OBJ_LIST_HOLDERS,
        OBJ_LIST_IDENTITY,
        OBJ_LIST_ANCHOR_EXCLUDED,
        OBJ_LIST_ASSET_PREFIX,
        OBJ_LIST_MESSAGES,
    }
    for (const [name, table] of Object.entries(tables)) {
        if (Object.keys(table).sort().join(',') !== names) {
            throw new Error(`The object list table ${name} does not hold the lists of OBJ_LIST_FIELDS.`)
        }
    }
    for (const [prop, row] of Object.entries<{ readonly journal: string }>(OBJ_PROPS)) {
        if (!Object.hasOwn(OBJ_LIST_FIELDS, row.journal)) {
            throw new Error(`The object prop ${prop} names a journal list that does not exist.`)
        }
    }
}
checkTables()

// ---------------------------------------------------------------- types

export type ObjEntry = JsonObject
export type ObjValue = string | number | boolean | null | ObjEntry
export type ObjFieldValue = { had: false } | { had: true; value: ObjValue }
export type PropValue = { had: false } | { had: true; value: ObjEntry }
export type IdentityKind = 'id' | 'folderKey' | 'content'
// Positive integers; the key set is exactly the entry's identity kinds.
export type IdentityCounts = Partial<Record<IdentityKind, number>>

// `deletedId` marks a run of ops that lists (remove) or consumes (insert) the deleted item with that id.
export type ObjInsertOp = { op: 'objInsert'; list: ObjListName; index: number; entry: ObjEntry; counts: IdentityCounts; deletedId?: string }
export type ObjRemoveOp = { op: 'objRemove'; list: ObjListName; index: number; entry: ObjEntry; counts: IdentityCounts; deletedId?: string }
export type ObjSetOp = {
    op: 'objSet'
    list: ObjListName
    index: number
    field: string
    before: ObjFieldValue
    after: ObjFieldValue
    anchorBefore: number
    anchorAfter: number
}
export type PropSetOp = { op: 'propSet'; prop: PropName; before: PropValue; after: PropValue }
export type ObjFamilyOp = ObjInsertOp | ObjRemoveOp | ObjSetOp | PropSetOp

// The writes a plan hands to a host writer. Never stored or posted.
export type ObjWrite =
    | { op: 'objInsert'; list: ObjListName; index: number; entry: ObjEntry }
    | { op: 'objRemove'; list: ObjListName; index: number }
    | { op: 'objSet'; list: ObjListName; index: number; field: string; value: ObjFieldValue }
    | { op: 'propSet'; prop: PropName; value: PropValue }

export interface ObjItemEntry {
    index: number
    entry: ObjEntry
    counts: IdentityCounts
}
// One deleted item holds every row one delete removed, ascending by original index. It has no `value`, `index` or
// `sideChat` key, so a reader that only knows greeting items refuses it.
export interface ObjDeletedItem {
    id: string
    at: number
    list: ObjListName
    entries: ObjItemEntry[]
}
// An item as a plan builds it; the model stamps `at`.
export interface ObjItemDraft {
    id: string
    list: ObjListName
    entries: ObjItemEntry[]
}
export interface ObjEffect {
    list: ObjItemDraft[]
    consume: string[]
}

export type ObjAction =
    | 'add'
    | 'delete'
    | 'edit'
    | 'move'
    | 'duplicate'
    | 'import'
    | 'folderCreate'
    | 'folderRename'
    | 'folderDelete'
    | 'folderActive'
    | 'bulkActive'
    | 'newId'
    | 'link'
    | 'unlink'
const OBJ_ACTIONS: readonly string[] = [
    'add',
    'delete',
    'edit',
    'move',
    'duplicate',
    'import',
    'folderCreate',
    'folderRename',
    'folderDelete',
    'folderActive',
    'bulkActive',
    'newId',
    'link',
    'unlink',
]
function isObjAction(value: unknown): value is ObjAction {
    return typeof value === 'string' && OBJ_ACTIONS.includes(value)
}
export type ObjLabel = { kind: 'obj'; list: ObjListName; action: ObjAction; name: string | null; count?: number; field?: string }
export type PropLabel = { kind: 'prop'; prop: PropName }

export function isObjFamilyOp(op: { op: string }): op is ObjFamilyOp {
    return op.op === 'objInsert' || op.op === 'objRemove' || op.op === 'objSet' || op.op === 'propSet'
}

export function isObjListName(value: unknown): value is ObjListName {
    return typeof value === 'string' && Object.hasOwn(OBJ_LIST_FIELDS, value)
}

export function isPropName(value: unknown): value is PropName {
    return typeof value === 'string' && Object.hasOwn(OBJ_PROPS, value)
}

// ---------------------------------------------------------------- canonical form, anchors, identities

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emitCanonical(value: JsonValue): string {
    if (Array.isArray(value)) {
        return '[' + value.map(emitCanonical).join(',') + ']'
    }
    if (typeof value === 'object' && value !== null) {
        const keys = Object.keys(value).sort()
        return '{' + keys.map((key) => JSON.stringify(key) + ':' + emitCanonical(value[key])).join(',') + '}'
    }
    return JSON.stringify(value)
}

// The JSON text of the value as plain JSON with every object's keys sorted, or null when the value has no JSON form
// (a bigint, a cycle, nothing at all). Never throws. The text is emitted directly, never through a sorted object built
// by assignment, so an own `__proto__` key stays a key.
export function canonicalJson(value: unknown): string | null {
    try {
        const plain = toPlainJson(value)
        return plain === undefined ? null : emitCanonical(plain)
    } catch {
        return null
    }
}

// A shallow copy of `source` without the named top-level keys, by own-key iteration so `__proto__` stays a key.
function withoutKeys(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
        if (!keys.includes(key)) {
            Object.defineProperty(copy, key, { value: source[key], enumerable: true, writable: true, configurable: true })
        }
    }
    return copy
}

function excludedKeysOf(list: ObjListName): readonly string[] {
    const row: readonly string[] = OBJ_LIST_ANCHOR_EXCLUDED[list]
    return row
}

// The canonical JSON of a row as the anchor and the content identity see it: a plain object without the list's
// excluded keys, any other value whole.
function anchoredCanonical(list: ObjListName, element: unknown): string | null {
    return canonicalJson(isPlainObject(element) ? withoutKeys(element, excludedKeysOf(list)) : element)
}

// The fingerprint of the canonical form of one row; null when the row has no JSON form. Null equals nothing: every
// comparison is `a !== null && a === b`.
export function entryAnchor(list: ObjListName, element: unknown): number | null {
    const text = anchoredCanonical(list, element)
    return text === null ? null : fingerprintElement(text)
}

export type Identities = Partial<Record<IdentityKind, string>>

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

// The identities a row holds, or null for a non-object, which holds none. An empty id counts as no id.
export function identitiesOf(list: ObjListName, element: unknown): Identities | null {
    if (!isPlainObject(element)) {
        return null
    }
    const row: ObjIdentityRow = OBJ_LIST_IDENTITY[list]
    const found: Identities = {}
    const id = row.id === null || !Object.hasOwn(element, row.id) ? undefined : element[row.id]
    if (nonEmptyString(id)) {
        found.id = id
    }
    const folderKey = row.folder !== null && element[row.folder.whenField] === row.folder.equals ? element[row.folder.key] : undefined
    if (nonEmptyString(folderKey)) {
        found.folderKey = folderKey
    }
    if (found.id === undefined && found.folderKey === undefined && row.content) {
        const text = anchoredCanonical(list, element)
        if (text !== null) {
            found.content = text
        }
    }
    return found
}

const IDENTITY_ORDER: readonly IdentityKind[] = ['id', 'folderKey', 'content']

// The kinds an entry holds, in the fixed order `id`, `folderKey`, `content`.
export function identityKindsOf(list: ObjListName, entry: ObjEntry): IdentityKind[] {
    const found = identitiesOf(list, entry)
    return found === null ? [] : IDENTITY_ORDER.filter((kind) => found[kind] !== undefined)
}

// A per-plan cache: each row's identities are computed once, so a plan hashes a row's canonical JSON at most once.
export type RowFacts = WeakMap<object, { identities: Identities | null }>

// How many plain-object rows hold `value` as their identity of `kind`. Non-objects hold none.
export function holdersOf(rows: readonly unknown[], list: ObjListName, kind: IdentityKind, value: string, facts: RowFacts): number {
    let total = 0
    for (const row of rows) {
        if (!isPlainObject(row)) {
            continue
        }
        let fact = facts.get(row)
        if (fact === undefined) {
            fact = { identities: identitiesOf(list, row) }
            facts.set(row, fact)
        }
        if (fact.identities?.[kind] === value) {
            total += 1
        }
    }
    return total
}

// ---------------------------------------------------------------- field values

export function objValueEquals(a: ObjFieldValue, b: ObjFieldValue): boolean {
    return a.had === b.had && (a.had === false || b.had === false || sameJsonValue(a.value, b.value))
}

export function propValueEquals(a: PropValue, b: PropValue): boolean {
    return a.had === b.had && (a.had === false || b.had === false || sameJsonValue(a.value, b.value))
}

function fieldKindOf(list: ObjListName, field: string): ObjFieldKind | null {
    const row: ObjListFieldsRow = OBJ_LIST_FIELDS[list]
    return Object.hasOwn(row.fields, field) ? row.fields[field] : null
}

// `value` as an `ObjValue`, or null for nothing and for an array.
function asObjValue(plain: JsonValue | undefined): ObjValue | null {
    if (plain === undefined || Array.isArray(plain)) {
        return null
    }
    return plain
}

// The stored value of one field. A missing own key (or one holding `undefined`) reads `{ had: false }`; null means
// unreadable (a bigint, a cycle, an array). The kind is not checked here.
export function readObjField(element: Record<string, unknown>, field: string): ObjFieldValue | null {
    if (!Object.hasOwn(element, field)) {
        return { had: false }
    }
    try {
        const plain = toPlainJson(element[field])
        if (plain === undefined) {
            return { had: false }
        }
        const value = asObjValue(plain)
        return value === null && plain !== null ? null : { had: true, value }
    } catch {
        return null
    }
}

// `had: false` always fits; a present value must be of the field's kind.
export function fieldValueFits(list: ObjListName, field: string, value: ObjFieldValue): boolean {
    const kind = fieldKindOf(list, field)
    if (kind === null) {
        return false
    }
    if (!value.had) {
        return true
    }
    const stored = value.value
    switch (kind) {
        case 'text':
            return typeof stored === 'string'
        case 'number':
            return typeof stored === 'number' && Number.isFinite(stored)
        case 'bool':
            return typeof stored === 'boolean'
        case 'object':
            return isPlainObject(stored)
        case 'numberOrNull':
            return stored === null || (typeof stored === 'number' && Number.isFinite(stored))
    }
}

// The field is settable (not label-only, not unknown) and no refusal rule of the list matches the row.
export function isFieldSettable(list: ObjListName, field: string, element: Record<string, unknown>): boolean {
    if (fieldKindOf(list, field) === null) {
        return false
    }
    const row: ObjListFieldsRow = OBJ_LIST_FIELDS[list]
    return !row.refused.some((rule) => rule.field === field && element[rule.whenField] === rule.equals)
}

// ---------------------------------------------------------------- inversion and tag runs

// A new object; `entry` is shared, since ops are immutable once built.
export function invertObjOp(op: ObjFamilyOp): ObjFamilyOp {
    switch (op.op) {
        case 'objInsert':
            return {
                op: 'objRemove',
                list: op.list,
                index: op.index,
                entry: op.entry,
                counts: op.counts,
                ...(op.deletedId === undefined ? {} : { deletedId: op.deletedId }),
            }
        case 'objRemove':
            return {
                op: 'objInsert',
                list: op.list,
                index: op.index,
                entry: op.entry,
                counts: op.counts,
                ...(op.deletedId === undefined ? {} : { deletedId: op.deletedId }),
            }
        case 'objSet':
            return {
                op: 'objSet',
                list: op.list,
                index: op.index,
                field: op.field,
                before: op.after,
                after: op.before,
                anchorBefore: op.anchorAfter,
                anchorAfter: op.anchorBefore,
            }
        case 'propSet':
            return { op: 'propSet', prop: op.prop, before: op.after, after: op.before }
    }
}

// The list whose visit journal an op belongs to.
export function journalListOf(op: ObjFamilyOp): ObjListName {
    if (op.op === 'propSet') {
        const journal: string = OBJ_PROPS[op.prop].journal
        // `checkTables` guarantees the journal names a list.
        return journal as ObjListName
    }
    return op.list
}

// The last index of the run that starts at the tagged `objInsert` or `objRemove` at `i`: consecutive ops of the same
// kind with the same `deletedId`. The scan stops at the first op that differs in kind or tag (an untagged op, an op of
// the other kind, an `objSet` or a `propSet`); it never looks for a matching op further on.
export function tagRunEnd(ops: readonly ObjFamilyOp[], i: number): number {
    const first = ops[i]
    if ((first.op !== 'objInsert' && first.op !== 'objRemove') || first.deletedId === undefined) {
        return i
    }
    let end = i
    while (end + 1 < ops.length) {
        const next = ops[end + 1]
        if (next.op !== first.op || next.deletedId !== first.deletedId) {
            break
        }
        end += 1
    }
    return end
}

// A tagged remove run records each row at its original position, so its indexes must strictly descend.
export function removeRunDescends(ops: readonly ObjFamilyOp[], i: number, end: number): boolean {
    for (let k = i; k < end; k++) {
        const a = ops[k]
        const b = ops[k + 1]
        if (a.op !== 'objRemove' || b.op !== 'objRemove' || !(b.index < a.index)) {
            return false
        }
    }
    return true
}

// ---------------------------------------------------------------- strict parsers

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key))
}

function isIndex(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isHash(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

// A fresh plain copy of an object, or null when the value is not a plain object or has no JSON form.
function parsePlainObject(value: unknown): ObjEntry | null {
    if (!isPlainObject(value)) {
        return null
    }
    try {
        const plain = toPlainJson(value)
        return plain !== undefined && isJsonObject(plain) ? plain : null
    } catch {
        return null
    }
}

// `counts` must hold exactly the entry's identity kinds, each a positive integer.
function parseCounts(list: ObjListName, entry: ObjEntry, value: unknown): IdentityCounts | null {
    if (!isPlainObject(value) || !hasOnlyKeys(value, IDENTITY_ORDER)) {
        return null
    }
    const kinds = identityKindsOf(list, entry)
    const given = Object.keys(value)
    if (given.length !== kinds.length || !kinds.every((kind) => Object.hasOwn(value, kind))) {
        return null
    }
    const counts: IdentityCounts = {}
    for (const kind of kinds) {
        const count = value[kind]
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
            return null
        }
        counts[kind] = count
    }
    return counts
}

function parseObjFieldValue(list: ObjListName, field: string, value: unknown): ObjFieldValue | null {
    if (!isPlainObject(value)) {
        return null
    }
    if (value.had === false) {
        return hasOnlyKeys(value, ['had']) ? { had: false } : null
    }
    if (value.had !== true || !hasOnlyKeys(value, ['had', 'value']) || !Object.hasOwn(value, 'value')) {
        return null
    }
    let plain: JsonValue | undefined
    try {
        plain = toPlainJson(value.value)
    } catch {
        return null
    }
    const stored = asObjValue(plain)
    if (stored === null && plain !== null) {
        return null
    }
    const parsed: ObjFieldValue = { had: true, value: stored }
    return fieldValueFits(list, field, parsed) ? parsed : null
}

function parsePropValue(value: unknown): PropValue | null {
    if (!isPlainObject(value)) {
        return null
    }
    if (value.had === false) {
        return hasOnlyKeys(value, ['had']) ? { had: false } : null
    }
    if (value.had !== true || !hasOnlyKeys(value, ['had', 'value'])) {
        return null
    }
    const plain = parsePlainObject(value.value)
    return plain === null ? null : { had: true, value: plain }
}

// The strict shape of one stored obj-family op, or null. The owner kind that may hold it is decided elsewhere.
export function parseObjOp(value: unknown): ObjFamilyOp | null {
    if (!isPlainObject(value)) {
        return null
    }
    switch (value.op) {
        case 'objInsert':
        case 'objRemove': {
            if (!hasOnlyKeys(value, ['op', 'list', 'index', 'entry', 'counts', 'deletedId']) || !isObjListName(value.list) || !isIndex(value.index)) {
                return null
            }
            // Absent, or a string; null (a refusal) for anything else.
            const deletedId = value.deletedId === undefined ? undefined : typeof value.deletedId === 'string' ? value.deletedId : null
            if (deletedId === null) {
                return null
            }
            const entry = parsePlainObject(value.entry)
            const counts = entry === null ? null : parseCounts(value.list, entry, value.counts)
            if (entry === null || counts === null) {
                return null
            }
            const tag = deletedId === undefined ? {} : { deletedId }
            return value.op === 'objInsert'
                ? { op: 'objInsert', list: value.list, index: value.index, entry, counts, ...tag }
                : { op: 'objRemove', list: value.list, index: value.index, entry, counts, ...tag }
        }
        case 'objSet': {
            if (
                !hasOnlyKeys(value, ['op', 'list', 'index', 'field', 'before', 'after', 'anchorBefore', 'anchorAfter']) ||
                !isObjListName(value.list) ||
                !isIndex(value.index) ||
                typeof value.field !== 'string' ||
                fieldKindOf(value.list, value.field) === null ||
                !isHash(value.anchorBefore) ||
                !isHash(value.anchorAfter)
            ) {
                return null
            }
            // A field outside the list's settable table (`id`, `mode`, `bookVersion`, label-only names) is refused.
            const before = parseObjFieldValue(value.list, value.field, value.before)
            const after = parseObjFieldValue(value.list, value.field, value.after)
            return before === null || after === null
                ? null
                : {
                      op: 'objSet',
                      list: value.list,
                      index: value.index,
                      field: value.field,
                      before,
                      after,
                      anchorBefore: value.anchorBefore,
                      anchorAfter: value.anchorAfter,
                  }
        }
        case 'propSet': {
            if (!hasOnlyKeys(value, ['op', 'prop', 'before', 'after']) || !isPropName(value.prop)) {
                return null
            }
            const before = parsePropValue(value.before)
            const after = parsePropValue(value.after)
            return before === null || after === null ? null : { op: 'propSet', prop: value.prop, before, after }
        }
        default:
            return null
    }
}

// The strict shape of one stored obj deleted item, or null. Whether the owner kind holds the list is decided elsewhere.
export function parseObjItem(value: unknown): ObjDeletedItem | null {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'at', 'list', 'entries'])) {
        return null
    }
    if (typeof value.id !== 'string' || !isFiniteNumber(value.at) || !isObjListName(value.list) || !Array.isArray(value.entries) || value.entries.length === 0) {
        return null
    }
    const entries: ObjItemEntry[] = []
    for (const raw of value.entries as unknown[]) {
        if (!isPlainObject(raw) || !hasOnlyKeys(raw, ['index', 'entry', 'counts']) || !isIndex(raw.index)) {
            return null
        }
        const entry = parsePlainObject(raw.entry)
        const counts = entry === null ? null : parseCounts(value.list, entry, raw.counts)
        if (entry === null || counts === null || (entries.length > 0 && raw.index <= entries[entries.length - 1].index)) {
            return null
        }
        entries.push({ index: raw.index, entry, counts })
    }
    return { id: value.id, at: value.at, list: value.list, entries }
}

// The strict shape of one stored obj or prop label, or null.
export function parseObjLabel(value: Record<string, unknown>): ObjLabel | PropLabel | null {
    if (value.kind === 'prop') {
        return hasOnlyKeys(value, ['kind', 'prop']) && isPropName(value.prop) ? { kind: 'prop', prop: value.prop } : null
    }
    if (value.kind !== 'obj' || !hasOnlyKeys(value, ['kind', 'list', 'action', 'name', 'count', 'field'])) {
        return null
    }
    if (!isObjListName(value.list) || !isObjAction(value.action)) {
        return null
    }
    const name = value.name === null ? null : typeof value.name === 'string' ? value.name : undefined
    if (name === undefined) {
        return null
    }
    const label: ObjLabel = { kind: 'obj', list: value.list, action: value.action, name }
    if (value.count !== undefined) {
        if (!isIndex(value.count)) {
            return null
        }
        label.count = value.count
    }
    if (value.field !== undefined) {
        const row: ObjListFieldsRow = OBJ_LIST_FIELDS[value.list]
        if (typeof value.field !== 'string' || !(Object.hasOwn(row.fields, value.field) || row.labelOnly.includes(value.field))) {
            return null
        }
        label.field = value.field
    }
    return label
}

// The owner kinds that hold a list through `OBJ_LIST_HOLDERS`, the stored kinds only (session kinds join in the model).
export function storedHolderKindsOf(list: ObjListName): ('character' | 'chat' | 'module')[] {
    const row: Partial<Record<'character' | 'chat' | 'module', string>> = OBJ_LIST_HOLDERS[list]
    return (['character', 'chat', 'module'] as const).filter((kind) => row[kind] !== undefined)
}

// ---------------------------------------------------------------- drafts and completion

// What a builder emits. The service completes a draft against the live lists (counts, anchors, before values), so a
// builder cannot record a wrong count or anchor.
export type ObjDraft =
    | { op: 'objInsert'; list: ObjListName; index: number; entry: object; deletedId?: string }
    | { op: 'objRemove'; list: ObjListName; index: number; deletedId?: string }
    | { op: 'objSet'; list: ObjListName; index: number; field: string; after: ObjFieldValue }
    | { op: 'propSet'; prop: PropName; after: PropValue }

function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

// A shallow copy of the row with one field set or removed. Own-key iteration keeps an own `__proto__` key a key.
function withField(element: Record<string, unknown>, field: string, value: ObjFieldValue): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    let placed = false
    for (const key of Object.keys(element)) {
        if (key === field) {
            placed = true
            if (value.had) {
                defineOwn(next, key, value.value)
            }
            continue
        }
        defineOwn(next, key, element[key])
    }
    if (!placed && value.had) {
        defineOwn(next, field, value.value)
    }
    return next
}

// The field value as plain JSON, or null when it has no JSON form.
function plainFieldValue(value: ObjFieldValue): ObjFieldValue | null {
    if (!value.had) {
        return { had: false }
    }
    try {
        const plain = toPlainJson(value.value)
        const next = asObjValue(plain)
        return next === null && plain !== null ? null : { had: true, value: next }
    } catch {
        return null
    }
}

function plainPropValue(value: PropValue): PropValue | null {
    if (!value.had) {
        return { had: false }
    }
    const plain = parsePlainObject(value.value)
    return plain === null ? null : { had: true, value: plain }
}

export type ObjCompletion = { ok: true; ops: ObjFamilyOp[] } | { ok: false; reason: 'precondition' | 'unchanged' }

// Completes builder drafts into stored ops on a working copy of the live lists (shallow list copies, one read per
// list). It checks live preconditions only: range, readable row, settable field, value kinds and anchors. The stored
// shape is checked by the strict parser (Rule K), which completion deliberately does not repeat. A row whose stored
// value is not its field's kind is refused for `objSet`; inserts and removes carry such values untouched. Never throws.
export function completeObjOps(drafts: readonly ObjDraft[], live: LiveReader): ObjCompletion {
    const lists = new Map<ObjListName, unknown[] | null>()
    const props = new Map<PropName, PropValue | null>()
    const facts: RowFacts = new WeakMap()
    const listOf = (name: ObjListName): unknown[] | null => {
        if (!lists.has(name)) {
            const rows = live.objList?.(name) ?? null
            lists.set(name, rows === null ? null : rows.slice())
        }
        return lists.get(name) ?? null
    }
    const propOf = (name: PropName): PropValue | null => {
        if (!props.has(name)) {
            props.set(name, live.prop?.(name) ?? null)
        }
        return props.get(name) ?? null
    }
    const countsAfter = (list: ObjListName, rows: readonly unknown[], entry: ObjEntry): IdentityCounts => {
        const counts: IdentityCounts = {}
        const identities = identitiesOf(list, entry)
        for (const kind of identityKindsOf(list, entry)) {
            const value = identities?.[kind]
            counts[kind] = value === undefined ? 0 : holdersOf(rows, list, kind, value, facts)
        }
        return counts
    }
    const ops: ObjFamilyOp[] = []
    for (const draft of drafts) {
        if (draft.op === 'propSet') {
            if (!isPropName(draft.prop)) {
                return { ok: false, reason: 'precondition' }
            }
            const before = propOf(draft.prop)
            const after = plainPropValue(draft.after)
            if (before === null || after === null) {
                return { ok: false, reason: 'precondition' }
            }
            if (propValueEquals(before, after)) {
                continue
            }
            props.set(draft.prop, after)
            ops.push({ op: 'propSet', prop: draft.prop, before, after })
            continue
        }
        if (!isObjListName(draft.list)) {
            return { ok: false, reason: 'precondition' }
        }
        const rows = listOf(draft.list)
        if (rows === null) {
            return { ok: false, reason: 'precondition' }
        }
        switch (draft.op) {
            case 'objInsert': {
                const entry = parsePlainObject(draft.entry)
                // The range check is deliberately not an integer check: the strict op parse (Rule K) refuses a
                // non-integer index, so that parse is what keeps such an op out of a record.
                if (entry === null || !(draft.index >= 0 && draft.index <= rows.length)) {
                    return { ok: false, reason: 'precondition' }
                }
                rows.splice(draft.index, 0, entry)
                ops.push({
                    op: 'objInsert',
                    list: draft.list,
                    index: draft.index,
                    entry,
                    counts: countsAfter(draft.list, rows, entry),
                    ...(draft.deletedId === undefined ? {} : { deletedId: draft.deletedId }),
                })
                break
            }
            case 'objRemove': {
                const row = rows[draft.index]
                const entry = isPlainObject(row) ? parsePlainObject(row) : null
                if (entry === null) {
                    return { ok: false, reason: 'precondition' }
                }
                // Holders before the removal, this row included.
                const counts = countsAfter(draft.list, rows, entry)
                rows.splice(draft.index, 1)
                ops.push({
                    op: 'objRemove',
                    list: draft.list,
                    index: draft.index,
                    entry,
                    counts,
                    ...(draft.deletedId === undefined ? {} : { deletedId: draft.deletedId }),
                })
                break
            }
            case 'objSet': {
                const row = rows[draft.index]
                if (!isPlainObject(row) || !isFieldSettable(draft.list, draft.field, row)) {
                    return { ok: false, reason: 'precondition' }
                }
                const before = readObjField(row, draft.field)
                const after = plainFieldValue(draft.after)
                // A stored value of another kind than the field's (MC-4090), or an `after` of one, is refused.
                if (before === null || after === null || !fieldValueFits(draft.list, draft.field, before) || !fieldValueFits(draft.list, draft.field, after)) {
                    return { ok: false, reason: 'precondition' }
                }
                if (objValueEquals(before, after)) {
                    continue
                }
                const next = withField(row, draft.field, after)
                const anchorBefore = entryAnchor(draft.list, row)
                const anchorAfter = entryAnchor(draft.list, next)
                if (anchorBefore === null || anchorAfter === null) {
                    return { ok: false, reason: 'precondition' }
                }
                rows[draft.index] = next
                ops.push({ op: 'objSet', list: draft.list, index: draft.index, field: draft.field, before, after, anchorBefore, anchorAfter })
                break
            }
        }
    }
    return ops.length === 0 ? { ok: false, reason: 'unchanged' } : { ok: true, ops }
}

// ---------------------------------------------------------------- the planner

export type ObjFailure =
    | { kind: 'tag'; run: 'insert' | 'remove'; deletedId: string; at: number }
    | { kind: 'count'; list: ObjListName; at: number }
    // `list` is null for a property op. Covers an anchor, range, field, unreadable row, property and run order failure.
    | { kind: 'changed'; list: ObjListName | null; at: number }

export type ObjPlan =
    | { ok: true; writes: ObjWrite[]; executed: ObjFamilyOp[]; effect: ObjEffect }
    | { ok: false; failure: ObjFailure }

function runRemoves(ops: readonly ObjFamilyOp[], i: number, end: number): ObjItemEntry[] {
    const entries: ObjItemEntry[] = []
    for (let k = end; k >= i; k--) {
        const op = ops[k]
        if (op.op === 'objRemove') {
            entries.push({ index: op.index, entry: op.entry, counts: op.counts })
        }
    }
    return entries
}

// The first op of a tagged remove run that does not descend, as an index into `ops`.
function firstNonDescending(ops: readonly ObjFamilyOp[], i: number, end: number): number {
    for (let k = i; k < end; k++) {
        const a = ops[k]
        const b = ops[k + 1]
        if (a.op !== 'objRemove' || b.op !== 'objRemove' || !(b.index < a.index)) {
            return k + 1
        }
    }
    return i
}

// Plans the ops of one step on working copies of the live lists, all or nothing: a refusal leaves the live arrays
// untouched and no write is returned. Tagged runs (consecutive same-kind ops with one `deletedId`) list or consume a
// deleted item as a unit when `tags` is set; with `tags` off they apply with no listing check and no effect (the
// witness plan of `already`). A tagged remove run must strictly descend, so every recorded index is the row's original
// position; that holds on every route and with or without tags.
export function planObjStep(ops: readonly ObjFamilyOp[], live: LiveReader, listed: ReadonlySet<string>, tags = true): ObjPlan {
    const lists = new Map<ObjListName, unknown[] | null>()
    const props = new Map<PropName, PropValue | null>()
    const listing = new Set(listed)
    const runItems = new Map<string, ObjItemDraft>()
    const writes: ObjWrite[] = []
    const facts: RowFacts = new WeakMap()
    const listOf = (name: ObjListName): unknown[] | null => {
        if (!lists.has(name)) {
            const rows = live.objList?.(name) ?? null
            lists.set(name, rows === null ? null : rows.slice())
        }
        return lists.get(name) ?? null
    }
    const propOf = (name: PropName): PropValue | null => {
        if (!props.has(name)) {
            props.set(name, live.prop?.(name) ?? null)
        }
        return props.get(name) ?? null
    }
    const applyOne = (op: ObjFamilyOp, at: number): ObjFailure | null => {
        switch (op.op) {
            case 'objInsert': {
                const rows = listOf(op.list)
                // Not an integer check: the strict op parse (Rule K) is what refuses a non-integer index, in a
                // stored record and in a completed op alike.
                if (rows === null || !(op.index >= 0 && op.index <= rows.length)) {
                    return { kind: 'changed', list: op.list, at }
                }
                rows.splice(op.index, 0, op.entry)
                const identities = identitiesOf(op.list, op.entry)
                for (const kind of identityKindsOf(op.list, op.entry)) {
                    const value = identities?.[kind]
                    // At most the recorded holders: a holder gone elsewhere is fine, a new one is not.
                    if (value === undefined || holdersOf(rows, op.list, kind, value, facts) > (op.counts[kind] ?? 0)) {
                        return { kind: 'count', list: op.list, at }
                    }
                }
                writes.push({ op: 'objInsert', list: op.list, index: op.index, entry: op.entry })
                return null
            }
            case 'objRemove': {
                const rows = listOf(op.list)
                const row = rows?.[op.index]
                // A non-object is never removed.
                if (rows === null || !isPlainObject(row)) {
                    return { kind: 'changed', list: op.list, at }
                }
                const anchor = entryAnchor(op.list, row)
                if (anchor === null || anchor !== entryAnchor(op.list, op.entry)) {
                    return { kind: 'changed', list: op.list, at }
                }
                rows.splice(op.index, 1)
                writes.push({ op: 'objRemove', list: op.list, index: op.index })
                return null
            }
            case 'objSet': {
                const rows = listOf(op.list)
                const row = rows?.[op.index]
                if (rows === null || !isPlainObject(row) || !isFieldSettable(op.list, op.field, row)) {
                    return { kind: 'changed', list: op.list, at }
                }
                const anchor = entryAnchor(op.list, row)
                const current = readObjField(row, op.field)
                if (anchor === null || anchor !== op.anchorBefore || current === null || !objValueEquals(current, op.before)) {
                    return { kind: 'changed', list: op.list, at }
                }
                rows[op.index] = withField(row, op.field, op.after)
                writes.push({ op: 'objSet', list: op.list, index: op.index, field: op.field, value: op.after })
                return null
            }
            case 'propSet': {
                const current = propOf(op.prop)
                if (current === null || !propValueEquals(current, op.before)) {
                    return { kind: 'changed', list: null, at }
                }
                props.set(op.prop, op.after)
                writes.push({ op: 'propSet', prop: op.prop, value: op.after })
                return null
            }
        }
    }
    let i = 0
    while (i < ops.length) {
        const op = ops[i]
        if ((op.op === 'objInsert' || op.op === 'objRemove') && op.deletedId !== undefined) {
            const end = tagRunEnd(ops, i)
            const id = op.deletedId
            const run = op.op === 'objInsert' ? 'insert' : 'remove'
            if (run === 'remove' && !removeRunDescends(ops, i, end)) {
                return { ok: false, failure: { kind: 'changed', list: op.list, at: firstNonDescending(ops, i, end) } }
            }
            if (tags && (run === 'insert' ? !listing.has(id) : listing.has(id))) {
                return { ok: false, failure: { kind: 'tag', run, deletedId: id, at: i } }
            }
            for (let k = i; k <= end; k++) {
                const member = ops[k]
                if (member.op === 'propSet' || member.op === 'objSet' || member.list !== op.list) {
                    return { ok: false, failure: { kind: 'changed', list: op.list, at: k } }
                }
                const failure = applyOne(member, k)
                if (failure !== null) {
                    return { ok: false, failure }
                }
            }
            if (tags) {
                if (run === 'remove') {
                    listing.add(id)
                    runItems.set(id, { id, list: op.list, entries: runRemoves(ops, i, end) })
                } else {
                    listing.delete(id)
                }
            }
            i = end + 1
            continue
        }
        const failure = applyOne(op, i)
        if (failure !== null) {
            return { ok: false, failure }
        }
        i += 1
    }
    return {
        ok: true,
        writes,
        executed: [...ops],
        effect: {
            list: [...runItems.values()].filter((item) => listing.has(item.id) && !listed.has(item.id)),
            consume: [...listed].filter((id) => !listing.has(id)),
        },
    }
}

// The listing effect the forward ops would have on `listed`, without touching a list: what an `already` replay
// carries. A remove run lists its item only when that id is unlisted, an insert run consumes only a listed id, and an
// id that already holds is left as it is and never rebuilt. Null when a tagged remove run does not strictly descend
// or mixes lists (the caller then refuses).
export function listingEffectOf(forwardOps: readonly ObjFamilyOp[], listed: ReadonlySet<string>): ObjEffect | null {
    const listing = new Set(listed)
    const items = new Map<string, ObjItemDraft>()
    let i = 0
    while (i < forwardOps.length) {
        const op = forwardOps[i]
        if ((op.op === 'objInsert' || op.op === 'objRemove') && op.deletedId !== undefined) {
            const end = tagRunEnd(forwardOps, i)
            const id = op.deletedId
            for (let k = i; k <= end; k++) {
                const member = forwardOps[k]
                if (member.op !== op.op || member.list !== op.list) {
                    return null
                }
            }
            if (op.op === 'objRemove') {
                if (!removeRunDescends(forwardOps, i, end)) {
                    return null
                }
                if (!listing.has(id)) {
                    listing.add(id)
                    items.set(id, { id, list: op.list, entries: runRemoves(forwardOps, i, end) })
                }
            } else {
                listing.delete(id)
            }
            i = end + 1
            continue
        }
        i += 1
    }
    return {
        list: [...items.values()].filter((item) => listing.has(item.id) && !listed.has(item.id)),
        consume: [...listed].filter((id) => !listing.has(id)),
    }
}

// The effect of two plans run one after the other (the second planned against the listing the first left).
export function mergeObjEffects(first: ObjEffect, second: ObjEffect): ObjEffect {
    const consumedLater = new Set(second.consume)
    const listedFirst = new Set(first.list.map((item) => item.id))
    return {
        list: [...first.list.filter((item) => !consumedLater.has(item.id)), ...second.list],
        consume: [...new Set([...first.consume, ...second.consume.filter((id) => !listedFirst.has(id))])],
    }
}

// ---------------------------------------------------------------- the visit journal and its line

export interface ObjJournalEntry {
    readonly ops: readonly ObjFamilyOp[]
}

// The ops that revert a list of journal entries (oldest first): newest entry first, each entry's ops reversed and
// inverted.
export function lineOpsOf(entries: readonly ObjJournalEntry[]): ObjFamilyOp[] {
    const out: ObjFamilyOp[] = []
    for (let e = entries.length - 1; e >= 0; e--) {
        const ops = entries[e].ops
        for (let k = ops.length - 1; k >= 0; k--) {
            out.push(invertObjOp(ops[k]))
        }
    }
    return out
}

// Appends one plan's ops of one list to the journal. Two consecutive single-op entries on one row field (or one
// property) merge into one entry with the first `before` and the last `after`; a merge that nets out removes the
// entry. It changes the journal array only and always builds a new op object: the record's steps share the plan's op
// objects, so an op is never mutated in place. No clock and no step cap are read.
export function journalAppend(journal: ObjJournalEntry[], ops: readonly ObjFamilyOp[]): void {
    if (ops.length === 0) {
        return
    }
    const last = journal.at(-1)
    if (ops.length === 1 && last && last.ops.length === 1) {
        const a = last.ops[0]
        const b = ops[0]
        let merged: ObjFamilyOp | null = null
        if (a.op === 'objSet' && b.op === 'objSet' && a.list === b.list && a.index === b.index && a.field === b.field && a.anchorAfter === b.anchorBefore && objValueEquals(a.after, b.before)) {
            merged = {
                op: 'objSet',
                list: a.list,
                index: a.index,
                field: a.field,
                before: a.before,
                after: b.after,
                anchorBefore: a.anchorBefore,
                anchorAfter: b.anchorAfter,
            }
        } else if (a.op === 'propSet' && b.op === 'propSet' && a.prop === b.prop && propValueEquals(a.after, b.before)) {
            merged = { op: 'propSet', prop: a.prop, before: a.before, after: b.after }
        }
        if (merged !== null) {
            const nets = merged.op === 'objSet' ? objValueEquals(merged.before, merged.after) : merged.op === 'propSet' && propValueEquals(merged.before, merged.after)
            if (nets) {
                journal.pop()
            } else {
                journal[journal.length - 1] = { ops: [merged] }
            }
            return
        }
    }
    journal.push({ ops })
}
