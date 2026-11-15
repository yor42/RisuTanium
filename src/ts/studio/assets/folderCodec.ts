// The asset-folder document of one owner, and the rules that write it. Pure: a write takes the stored value as it
// is and returns entry-level ops; nothing here reads or writes an owner.
//
// The document is `{ v: 1, additional: { order, of } }`, stored under `ASSET_FOLDER_KEY` (assetOwnerKeys.ts) in
// `character.extentions` and on `RisuModule`. `of` holds `[name as written, folder]` pairs; no folded key is persisted
// in the document or in an op. Names are folded at read time with the engine fold (`assetPoolKey`), folder names are
// compared with a locale-independent fold (`folderNameKey`).
//
// Reading. A type-valid v1 value is normalised on read, first wins: folder names are trimmed, and an empty name, a
// "No folder" and a repeat are not listed; of several entries that fold alike the first is the view entry and the
// others are shadowed (ignored); an entry whose folder is not listed shows in "No folder". A value this build cannot
// read (an unknown `v`, a bad shape, an unknown key) reads as "no folders" and is never overwritten: an explicit
// folder action on it is refused, a row-carried rule returns no ops, and the stored value stays byte for byte.
//
// Writing. Every rule returns ops of two shapes only, `assetFolderSet {name, before, after}` (one raw entry as a
// field value) and `assetFolderOrder {before, after}` (raw order arrays), and obeys the composition rule: a step holds
// at most one `assetFolderSet` per fold key and at most one `assetFolderOrder`, entry ops first; `name` is the stored
// name of the key's view entry, else the name as written; `before` is that entry's raw field value; no op has `before`
// equal to `after`. One internal planner builds every step, so a second intent for a key replaces that op's `after`.
// The ops apply in order through `applyFolderOps`, and their inverses in reverse give a read-equal value (byte-equal
// for an absent input and for a single-entry input without shadowed entries).
//
// Standing rules. 1. Version 1 is frozen once merged. 2. Every later build reads every earlier `v`, upgrading in
// memory with no eager rewrite. 3. The engine never reads the folder document.

export const FOLDER_DOC_VERSION = 1

/** The folder the UI calls "No folder". A folder may not take this name, whatever the case. */
const NO_FOLDER_NAME = 'no folder'

export interface AssetFolderDoc {
    v: 1
    additional: {
        /** Folder names in display order. */
        order: string[]
        /** `[name as written, folder]` pairs. Pairs, not a record, so a name such as `__proto__` is safe. */
        of: [string, string][]
    }
}

/**
 * The engine's fold of an asset name: the parser, the `<img src>` lookup and the pool maps all key by
 * `name.toLocaleLowerCase()`. Folder entries, duplicate pools and reference comparisons use the same fold.
 */
export function assetPoolKey(name: string): string {
    return name.toLocaleLowerCase()
}

/** The comparison of folder names: trimmed and lowercased without a locale, so it never changes between devices. */
export function folderNameKey(name: string): string {
    return name.trim().toLowerCase()
}

export type FolderRead =
    /** Nothing stored. */
    | { state: 'absent', doc: AssetFolderDoc }
    /** `doc` is the view: the listed folders, and the view entries that show in a listed folder. */
    | { state: 'ok', doc: AssetFolderDoc }
    /** Stored but unreadable by this build. `doc` is empty; writes are refused and the stored value is kept. */
    | { state: 'unreadable', doc: AssetFolderDoc }

export function emptyFolderDoc(): AssetFolderDoc {
    return { v: FOLDER_DOC_VERSION, additional: { order: [], of: [] } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type RawRead =
    | { state: 'absent' | 'ok', raw: AssetFolderDoc }
    | { state: 'unreadable' }

/** The structural check of a v1 value, with no normalisation: the raw arrays are copied as stored. */
function parseRaw(value: unknown): RawRead {
    if (value === undefined || value === null) {
        return { state: 'absent', raw: emptyFolderDoc() }
    }
    if (!isPlainObject(value) || value.v !== FOLDER_DOC_VERSION) {
        return { state: 'unreadable' }
    }
    for (const key of Object.keys(value)) {
        if (key !== 'v' && key !== 'additional') {
            return { state: 'unreadable' }
        }
    }
    const additional = value.additional
    if (!isPlainObject(additional)) {
        return { state: 'unreadable' }
    }
    for (const key of Object.keys(additional)) {
        if (key !== 'order' && key !== 'of') {
            return { state: 'unreadable' }
        }
    }
    const order = additional.order
    const of = additional.of
    if (!Array.isArray(order) || !Array.isArray(of)) {
        return { state: 'unreadable' }
    }
    const raw = emptyFolderDoc()
    for (const folder of order) {
        if (typeof folder !== 'string') {
            return { state: 'unreadable' }
        }
        raw.additional.order.push(folder)
    }
    for (const pair of of) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
            return { state: 'unreadable' }
        }
        raw.additional.of.push([pair[0], pair[1]])
    }
    return { state: 'ok', raw }
}

interface ViewEntry {
    /** The stored name of the view entry. */
    name: string
    /** The stored folder, as written. */
    rawFolder: string
    /** The listed folder it shows in, or null for "No folder". */
    folder: string | null
}

interface FolderView {
    order: string[]
    /** The view entry of each fold key: the first raw pair that folds to it. */
    entries: Map<string, ViewEntry>
}

function viewOf(raw: AssetFolderDoc): FolderView {
    const order: string[] = []
    const listed = new Set<string>()
    for (const item of raw.additional.order) {
        const name = item.trim()
        const key = folderNameKey(name)
        if (name === '' || key === NO_FOLDER_NAME || listed.has(key)) {
            continue
        }
        listed.add(key)
        order.push(name)
    }
    const entries = new Map<string, ViewEntry>()
    for (const [name, rawFolder] of raw.additional.of) {
        const key = assetPoolKey(name)
        if (!entries.has(key)) {
            const folderKey = folderNameKey(rawFolder)
            entries.set(key, { name, rawFolder, folder: order.find((folder) => folderNameKey(folder) === folderKey) ?? null })
        }
    }
    return { order, entries }
}

/** Reads the stored value as the view the UI and the rules act on. */
export function readFolderDoc(value: unknown): FolderRead {
    const read = parseRaw(value)
    if (read.state === 'unreadable') {
        return { state: 'unreadable', doc: emptyFolderDoc() }
    }
    if (read.state === 'absent') {
        return { state: 'absent', doc: emptyFolderDoc() }
    }
    const view = viewOf(read.raw)
    const of: [string, string][] = []
    for (const entry of view.entries.values()) {
        if (entry.folder !== null) {
            of.push([entry.name, entry.folder])
        }
    }
    return { state: 'ok', doc: { v: FOLDER_DOC_VERSION, additional: { order: view.order, of } } }
}

/** The folder of an asset name in a view, or null for "No folder". */
export function folderOf(doc: AssetFolderDoc, name: string): string | null {
    const key = assetPoolKey(name)
    for (const [entryName, folder] of doc.additional.of) {
        if (assetPoolKey(entryName) === key) {
            return folder
        }
    }
    return null
}

/** A raw entry as an op sees it: no entry, or the stored folder string. */
export type FolderFieldValue = { had: false } | { had: true, value: string }

export interface FolderSetOp {
    kind: 'assetFolderSet'
    /** The stored name of the key's view entry, else the name as written. */
    name: string
    before: FolderFieldValue
    after: FolderFieldValue
}

export interface FolderOrderOp {
    kind: 'assetFolderOrder'
    /** The raw order; absent reads as `[]`. */
    before: string[]
    after: string[]
}

export type FolderOp = FolderSetOp | FolderOrderOp

export type FolderRefusal =
    /** The stored document is from a newer version: "Folders from a newer version; not changed". */
    | 'newerVersion'
    | 'emptyName'
    /** The name is "No folder" in some case. */
    | 'noFolderName'
    /** Another folder already has the name, ignoring case. */
    | 'nameTaken'
    | 'unknownFolder'

export type FolderWriteResult =
    | { ok: true, ops: FolderOp[] }
    | { ok: false, reason: FolderRefusal }

const NEWER_VERSION: FolderWriteResult = { ok: false, reason: 'newerVersion' }

function fieldValuesEqual(a: FolderFieldValue, b: FolderFieldValue): boolean {
    return a.had ? b.had && a.value === b.value : !b.had
}

function copyFieldValue(value: FolderFieldValue): FolderFieldValue {
    return value.had ? { had: true, value: value.value } : { had: false }
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i])
}

interface Loaded {
    raw: AssetFolderDoc
    view: FolderView
}

/** The raw document and its view, or null when the stored value is unreadable. */
function load(stored: unknown): Loaded | null {
    const read = parseRaw(stored)
    return read.state === 'unreadable' ? null : { raw: read.raw, view: viewOf(read.raw) }
}

function findFolder(view: FolderView, name: string): number {
    const key = folderNameKey(name)
    return view.order.findIndex((folder) => folderNameKey(folder) === key)
}

/** A folder name as stored: trimmed, not empty, not "No folder". */
function checkFolderName(raw: string): { name: string } | { reason: FolderRefusal } {
    const name = raw.trim()
    if (name === '') {
        return { reason: 'emptyName' }
    }
    if (folderNameKey(name) === NO_FOLDER_NAME) {
        return { reason: 'noFolderName' }
    }
    return { name }
}

/** One entry's wish: the name goes into `folder`, or into "No folder" with `null`. */
export interface FolderEntryIntent {
    name: string
    folder: string | null
}

/** The entry ops of a step: one per fold key, a later intent replacing the `after` of the earlier one. */
function planEntryOps(raw: AssetFolderDoc, intents: readonly FolderEntryIntent[]): FolderSetOp[] {
    const entries = viewOf(raw).entries
    const planned = new Map<string, FolderSetOp>()
    for (const intent of intents) {
        const key = assetPoolKey(intent.name)
        const after: FolderFieldValue = intent.folder === null ? { had: false } : { had: true, value: intent.folder }
        const known = planned.get(key)
        if (known) {
            known.after = after
            continue
        }
        const entry = entries.get(key)
        planned.set(key, {
            kind: 'assetFolderSet',
            name: entry ? entry.name : intent.name,
            before: entry ? { had: true, value: entry.rawFolder } : { had: false },
            after,
        })
    }
    return [...planned.values()].filter((op) => !fieldValuesEqual(op.before, op.after))
}

/** The order op of a step: none when the raw order already is `after`. */
function planOrderOps(raw: AssetFolderDoc, after: readonly string[]): FolderOrderOp[] {
    if (sameStrings(raw.additional.order, after)) {
        return []
    }
    return [{ kind: 'assetFolderOrder', before: raw.additional.order.slice(), after: after.slice() }]
}

/** Adds an empty folder at the end of the order. */
export function createFolder(stored: unknown, rawName: string): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    const checked = checkFolderName(rawName)
    if ('reason' in checked) {
        return { ok: false, reason: checked.reason }
    }
    if (findFolder(loaded.view, checked.name) >= 0) {
        return { ok: false, reason: 'nameTaken' }
    }
    return { ok: true, ops: planOrderOps(loaded.raw, [...loaded.view.order, checked.name]) }
}

/**
 * Renames a folder; its rows keep it. A rename to a name another folder has, ignoring case, is refused. A rename
 * that only changes the case of the folder's own name is allowed. Every view entry in the folder gets an op, whether
 * or not a row has that name.
 */
export function renameFolder(stored: unknown, from: string, rawTo: string): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    const checked = checkFolderName(rawTo)
    if ('reason' in checked) {
        return { ok: false, reason: checked.reason }
    }
    const index = findFolder(loaded.view, from)
    if (index < 0) {
        return { ok: false, reason: 'unknownFolder' }
    }
    const clash = findFolder(loaded.view, checked.name)
    if (clash >= 0 && clash !== index) {
        return { ok: false, reason: 'nameTaken' }
    }
    const old = loaded.view.order[index]
    const intents: FolderEntryIntent[] = []
    for (const entry of loaded.view.entries.values()) {
        if (entry.folder === old) {
            intents.push({ name: entry.name, folder: checked.name })
        }
    }
    const after = loaded.view.order.slice()
    after[index] = checked.name
    return { ok: true, ops: [...planEntryOps(loaded.raw, intents), ...planOrderOps(loaded.raw, after)] }
}

/** Deletes a folder: its rows move to "No folder". A row is never deleted. */
export function deleteFolder(stored: unknown, name: string): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    const index = findFolder(loaded.view, name)
    if (index < 0) {
        return { ok: false, reason: 'unknownFolder' }
    }
    const old = loaded.view.order[index]
    const intents: FolderEntryIntent[] = []
    for (const entry of loaded.view.entries.values()) {
        if (entry.folder === old) {
            intents.push({ name: entry.name, folder: null })
        }
    }
    const after = loaded.view.order.slice()
    after.splice(index, 1)
    return { ok: true, ops: [...planEntryOps(loaded.raw, intents), ...planOrderOps(loaded.raw, after)] }
}

/** Reorders the folders. `order` must hold exactly the folders now listed, each once. */
export function reorderFolders(stored: unknown, order: readonly string[]): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    const present = loaded.view.order
    if (order.length !== present.length || !order.every((folder) => present.includes(folder)) || new Set(order).size !== order.length) {
        return { ok: false, reason: 'unknownFolder' }
    }
    return { ok: true, ops: planOrderOps(loaded.raw, order) }
}

/**
 * Sets the folder of several names in one step, with no check of the folders named: the caller passes listed folder
 * names. Names that fold alike make one op.
 */
export function setFolderEntries(stored: unknown, intents: readonly FolderEntryIntent[]): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    return { ok: true, ops: planEntryOps(loaded.raw, intents) }
}

/** Puts asset names into one folder, or into "No folder" with `null`. The folder must be listed. */
export function moveManyToFolder(stored: unknown, assetNames: readonly string[], folder: string | null): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return NEWER_VERSION
    }
    let target: string | null = null
    if (folder !== null) {
        const index = findFolder(loaded.view, folder)
        if (index < 0) {
            return { ok: false, reason: 'unknownFolder' }
        }
        target = loaded.view.order[index]
    }
    return { ok: true, ops: planEntryOps(loaded.raw, assetNames.map((name) => ({ name, folder: target }))) }
}

/** Puts an asset name into a folder, or into "No folder" with `null`. The folder must be listed. */
export function moveToFolder(stored: unknown, assetName: string, folder: string | null): FolderWriteResult {
    return moveManyToFolder(stored, [assetName], folder)
}

/**
 * The folder rules of a rename. The new name takes the old name's folder unless it already has one; the old entry
 * is dropped when no row of the old name remains. A case-only rename changes no entry, since both names fold alike.
 * `oldRowsLeft` counts the rows whose pool key is the old name's, after the rename. An unreadable document gives no
 * ops: the rename goes on and the stored value is kept.
 */
export function carryFolderOnRename(stored: unknown, oldName: string, newName: string, oldRowsLeft: number): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return { ok: true, ops: [] }
    }
    const oldKey = assetPoolKey(oldName)
    const newKey = assetPoolKey(newName)
    if (oldKey === newKey) {
        return { ok: true, ops: [] }
    }
    const oldFolder = loaded.view.entries.get(oldKey)?.folder ?? null
    const newFolder = loaded.view.entries.get(newKey)?.folder ?? null
    const intents: FolderEntryIntent[] = []
    if (oldFolder !== null && newFolder === null) {
        intents.push({ name: newName, folder: oldFolder })
    }
    if (oldRowsLeft === 0) {
        intents.push({ name: oldName, folder: null })
    }
    return { ok: true, ops: planEntryOps(loaded.raw, intents) }
}

export interface FolderDropName {
    name: string
    /** The rows whose pool key is this name's, after the removal. */
    rowsLeft: number
}

/**
 * A removal or a merge that leaves no row of a name drops that name's entry: one op per fold key, from the first
 * name of the key. An unreadable document gives no ops.
 */
export function dropFolderEntries(stored: unknown, names: readonly FolderDropName[]): FolderWriteResult {
    const loaded = load(stored)
    if (!loaded) {
        return { ok: true, ops: [] }
    }
    const intents: FolderEntryIntent[] = []
    const seen = new Set<string>()
    for (const { name, rowsLeft } of names) {
        const key = assetPoolKey(name)
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        if (rowsLeft === 0) {
            intents.push({ name, folder: null })
        }
    }
    return { ok: true, ops: planEntryOps(loaded.raw, intents) }
}

export type ApplyFolderOpsResult =
    /** `doc` is a new document, or null when the result is empty and the key is removed. */
    | { ok: true, doc: AssetFolderDoc | null }
    /** The op at `index` did not match the value it met. */
    | { ok: false, index: number }

function applyToRaw(raw: AssetFolderDoc, op: FolderOp): boolean {
    if (op.kind === 'assetFolderOrder') {
        if (!sameStrings(raw.additional.order, op.before)) {
            return false
        }
        raw.additional.order = op.after.slice()
        return true
    }
    const key = assetPoolKey(op.name)
    const first = raw.additional.of.findIndex((pair) => assetPoolKey(pair[0]) === key)
    const current: FolderFieldValue = first >= 0 ? { had: true, value: raw.additional.of[first][1] } : { had: false }
    if (!fieldValuesEqual(current, op.before)) {
        return false
    }
    const rest = raw.additional.of.filter((pair) => assetPoolKey(pair[0]) !== key)
    if (op.after.had) {
        rest.splice(first >= 0 ? first : rest.length, 0, [op.name, op.after.value])
    }
    raw.additional.of = rest
    return true
}

/**
 * Applies ops in order to a stored value, which must be absent or type-valid v1; anything else fails at index 0. An
 * absent value applies as an empty document. Each op must find the value its `before` names, else the call fails at
 * that index. An empty result is `null`, so the caller removes the key.
 */
export function applyFolderOps(stored: unknown, ops: readonly FolderOp[]): ApplyFolderOpsResult {
    const read = parseRaw(stored)
    if (read.state === 'unreadable') {
        return { ok: false, index: 0 }
    }
    const raw = read.raw
    for (let index = 0; index < ops.length; index++) {
        if (!applyToRaw(raw, ops[index])) {
            return { ok: false, index }
        }
    }
    return { ok: true, doc: raw.additional.order.length === 0 && raw.additional.of.length === 0 ? null : raw }
}

export function applyFolderOp(stored: unknown, op: FolderOp): ApplyFolderOpsResult {
    return applyFolderOps(stored, [op])
}

/** Whether the stored value already holds the op's `after`: the first alike raw entry, or the raw order. */
export function folderOpAtTarget(stored: unknown, op: FolderOp): boolean {
    const read = parseRaw(stored)
    if (read.state === 'unreadable') {
        return false
    }
    if (op.kind === 'assetFolderOrder') {
        return sameStrings(read.raw.additional.order, op.after)
    }
    const key = assetPoolKey(op.name)
    const entry = read.raw.additional.of.find((pair) => assetPoolKey(pair[0]) === key)
    return fieldValuesEqual(entry ? { had: true, value: entry[1] } : { had: false }, op.after)
}

/** The op that undoes `op`: `before` and `after` swapped. */
export function invertFolderOp(op: FolderOp): FolderOp {
    if (op.kind === 'assetFolderOrder') {
        return { kind: 'assetFolderOrder', before: op.after.slice(), after: op.before.slice() }
    }
    return { kind: 'assetFolderSet', name: op.name, before: copyFieldValue(op.after), after: copyFieldValue(op.before) }
}
