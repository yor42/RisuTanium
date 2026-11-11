// The frozen contract between the Studio history service and its device store: the two ports, the
// v1 stored layout (a header, an index and one entry per step under one owner/generation key range),
// its strict writers and readers, the size rule, and the pure pieces of the save transaction (load
// classification, the S4 decision, the planners, the per-owner cap and the eviction plan) that the
// memory double and the IndexedDB adapter both use. Nothing here touches a database.

import {
    parseOwnerRecord,
    type DeletedItem,
    type OwnerRecord,
    type RestorePoint,
    type Step,
} from './historyModel'
import { isOwnerKey, type Expectation, type OwnerKey } from './ownerPhase'

// Default cap on the counted stored bytes of the whole store; Gate N1 fixes the shipped number.
export const CAP_BYTES = 4 * 1024 * 1024

// Each owner keeps at most this share of the store, so two owners always fit together and two
// alternately edited owners never evict each other. The ratio exists only here.
export function ownerCapFor(capBytes: number): number {
    return Math.floor(capBytes / 2)
}

export const OWNER_CAP_BYTES = ownerCapFor(CAP_BYTES)

// ---------------------------------------------------------------- ports

export type OpenResult = 'ok' | 'unavailable'

export type LoadResult =
    | { kind: 'absent' }
    | { kind: 'ok'; record: OwnerRecord }
    | { kind: 'unreadable' }
    | { kind: 'keptUnreadable' }
    | { kind: 'failed' }

export type SaveResult =
    | { kind: 'ok'; asided: boolean; trimmed: boolean }
    | { kind: 'unwritable' }
    | { kind: 'kept' }
    | { kind: 'notLoaded' }

// Never throws or rejects. `save` never mutates `record`. `save` writes nothing and answers
// `unwritable` when `record` breaks the id rule: every id is a non-empty string, step ids are unique
// across `done` and `undone`, and deleted ids are unique. `trimmed: true` means the stored copy was
// cut to the per-owner cap.
export interface StudioHistoryStore {
    open(): Promise<OpenResult>
    load(owner: OwnerKey): Promise<LoadResult>
    save(owner: OwnerKey, record: OwnerRecord, protect: ReadonlySet<OwnerKey>): Promise<SaveResult>
    // Fires once when the connection gets `versionchange` or `close`. After it fires, `save` and
    // `load` answer `unwritable` and `failed` without touching the database.
    onClosed(callback: () => void): void
}

export type ClaimResult = 'granted' | 'held' | 'unsupported' | 'failed'

// Never throws or rejects. A granted claim is held until the page ends.
export interface StudioClaimPort {
    tryClaim(chaId: string): Promise<ClaimResult>
}

// ---------------------------------------------------------------- layout (v1)

// Keys:
//   h:<owner>                          the header (what the eviction reads)
//   xh:<owner>                         the aside marker: a copy of a foreign header
//   e:<L>:<owner>|<gen>|<part>         owner data; L is the owner key's length in decimal
// <part> is `i` (the index), `s:<id>` (a step), `d:<id>` (a deleted item) or `r` (the restore point).
// Steps and deleted items have separate kinds because a deleted item's id can equal a step id.
// Any other prefix belongs to another build and is never read, written, evicted or counted. A build
// that writes a header, an index or an entry of another version writes all three of that version in
// one transaction under a fresh gen, or uses new prefixes. A change to the entry data a reader
// accepts is a new version.
// An optional, additive step field (such as a step's `listFingerprint`) keeps v1: a v1 reader that
// does not know it drops it when it rebuilds the step, and an absent field means the behaviour from
// before the field existed. The field is omitted when absent, never written as undefined or null.
export const HEADER_PREFIX = 'h:'
export const ASIDE_MARK_PREFIX = 'xh:'
export const ENTRY_PREFIX = 'e:'

export const INDEX_PART = 'i'
export const RESTORE_PART = 'r'

// Pinned v1 format, not tunable policy: a stored header's `size` is checked against these when an
// owner is read, so a later build that changes any of them must read v1 data with v1's sizing or
// follow the format rule above.
export const ENTRY_OVERHEAD = 144
export const OWNER_OVERHEAD = 512

export function headerKey(owner: OwnerKey): string {
    return HEADER_PREFIX + owner
}

export function asideMarkKey(owner: OwnerKey): string {
    return ASIDE_MARK_PREFIX + owner
}

export function ownerPrefix(owner: OwnerKey): string {
    return `${ENTRY_PREFIX}${owner.length}:${owner}|`
}

export function genPrefix(owner: OwnerKey, gen: string): string {
    return `${ownerPrefix(owner)}${gen}|`
}

export function stepPart(id: string): string {
    return `s:${id}`
}

export function deletedPart(id: string): string {
    return `d:${id}`
}

export function entryKey(owner: OwnerKey, gen: string, part: string): string {
    return genPrefix(owner, gen) + part
}

// A half-open key range [lower, upper): every key that starts with the prefix.
export interface KeyBounds {
    lower: string
    upper: string
}

export function prefixBounds(prefix: string): KeyBounds {
    const last = prefix.length - 1
    return { lower: prefix, upper: prefix.slice(0, last) + String.fromCharCode(prefix.charCodeAt(last) + 1) }
}

// `h:` excludes `xh:`.
export const HEADER_BOUNDS: KeyBounds = prefixBounds(HEADER_PREFIX)

export function ownerBounds(owner: OwnerKey): KeyBounds {
    return prefixBounds(ownerPrefix(owner))
}

export function genBounds(owner: OwnerKey, gen: string): KeyBounds {
    return prefixBounds(genPrefix(owner, gen))
}

export function inBounds(key: string, bounds: KeyBounds): boolean {
    return key >= bounds.lower && key < bounds.upper
}

export interface StoredHeader {
    wid: string
    gen: string
    ownerKey: OwnerKey
    size: number
    touchedAt: number
}

// One row of the index: an entry's id and the string length of its stored value.
export type IndexRow = [id: string, n: number]

export interface IndexLists {
    done: IndexRow[]
    undone: IndexRow[]
    deleted: IndexRow[]
    restore: number | null
}

export type EntryKind = 's' | 'd' | 'r'

export function serializeHeader(header: StoredHeader): string {
    return JSON.stringify({
        v: 1,
        wid: header.wid,
        gen: header.gen,
        ownerKey: header.ownerKey,
        size: header.size,
        touchedAt: header.touchedAt,
    })
}

export function serializeIndex(ownerKey: OwnerKey, wid: string, lists: IndexLists): string {
    return JSON.stringify({
        v: 1,
        wid,
        ownerKey,
        done: lists.done,
        undone: lists.undone,
        deleted: lists.deleted,
        restore: lists.restore,
    })
}

export function serializeEntry(kind: EntryKind, ownerKey: OwnerKey, data: Step | DeletedItem | RestorePoint): string {
    return JSON.stringify({ v: 1, k: kind, ownerKey, data })
}

// Counted bytes of one entry: its value in UTF-16, its key (owner key and id appear in the key and
// in the index) and a fixed allowance for the rest of the key, the gen and the index row.
export function entrySize(n: number, idLength: number, ownerKeyLength: number): number {
    return 2 * n + 2 * (ownerKeyLength + 2 * idLength) + ENTRY_OVERHEAD
}

export function ownerSizeOf(lists: IndexLists, ownerKeyLength: number): number {
    let size = OWNER_OVERHEAD
    for (const [id, n] of lists.done) {
        size += entrySize(n, id.length, ownerKeyLength)
    }
    for (const [id, n] of lists.undone) {
        size += entrySize(n, id.length, ownerKeyLength)
    }
    for (const [id, n] of lists.deleted) {
        size += entrySize(n, id.length, ownerKeyLength)
    }
    if (lists.restore !== null) {
        size += entrySize(lists.restore, 0, ownerKeyLength)
    }
    return size
}

function parseJson(text: unknown): Record<string, unknown> | null {
    if (typeof text !== 'string') {
        return null
    }
    try {
        const value: unknown = JSON.parse(text)
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

// Strict header reader. With `expectedOwner`, the header must name exactly that owner.
export function readHeader(text: unknown, expectedOwner?: string): StoredHeader | null {
    const value = parseJson(text)
    if (!value || value.v !== 1 || typeof value.wid !== 'string' || typeof value.ownerKey !== 'string') {
        return null
    }
    const { gen, size, touchedAt } = value
    if (typeof gen !== 'string' || gen === '' || gen.includes('|')) {
        return null
    }
    const ownerKey = value.ownerKey
    if (!isOwnerKey(ownerKey) || (expectedOwner !== undefined && ownerKey !== expectedOwner)) {
        return null
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
        return null
    }
    if (typeof touchedAt !== 'number' || !Number.isFinite(touchedAt)) {
        return null
    }
    return { wid: value.wid, gen, ownerKey, size, touchedAt }
}

// Reads the `h:` range with each header's own key: a header whose value names another owner than
// its key is unparsable, counts nothing and is never deleted. `raw` keeps every value by key.
export function readHeaders(
    keys: readonly unknown[],
    values: readonly unknown[],
): { headers: StoredHeader[]; raw: Map<string, unknown> } {
    const headers: StoredHeader[] = []
    const raw = new Map<string, unknown>()
    keys.forEach((key, index) => {
        if (typeof key !== 'string' || !key.startsWith(HEADER_PREFIX)) {
            return
        }
        raw.set(key, values[index])
        const header = readHeader(values[index], key.slice(HEADER_PREFIX.length))
        if (header) {
            headers.push(header)
        }
    })
    return { headers, raw }
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function readRows(value: unknown): IndexRow[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const rows: IndexRow[] = []
    for (const row of value) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !isCount(row[1])) {
            return null
        }
        rows.push([row[0], row[1]])
    }
    return rows
}

// The id rule: every id is a non-empty string, step ids are unique across `done` and `undone`,
// and deleted ids are unique.
function idsObeyRule(steps: readonly string[], deleted: readonly string[]): boolean {
    const seenSteps = new Set<string>()
    for (const id of steps) {
        if (typeof id !== 'string' || id === '' || seenSteps.has(id)) {
            return false
        }
        seenSteps.add(id)
    }
    const seenDeleted = new Set<string>()
    for (const id of deleted) {
        if (typeof id !== 'string' || id === '' || seenDeleted.has(id)) {
            return false
        }
        seenDeleted.add(id)
    }
    return true
}

export function recordObeysIdRule(record: OwnerRecord): boolean {
    return idsObeyRule(
        [...record.done.map((step) => step.id), ...record.undone.map((step) => step.id)],
        record.deleted.map((item) => item.id),
    )
}

// Strict index reader: `v` 1, the header's write id and the owner, the id rule, and counts.
function readIndex(text: unknown, owner: OwnerKey, wid: string): IndexLists | null {
    const value = parseJson(text)
    if (!value || value.v !== 1 || value.wid !== wid || value.ownerKey !== owner) {
        return null
    }
    const done = readRows(value.done)
    const undone = readRows(value.undone)
    const deleted = readRows(value.deleted)
    if (!done || !undone || !deleted) {
        return null
    }
    const restore = value.restore === null ? null : isCount(value.restore) ? value.restore : undefined
    if (restore === undefined) {
        return null
    }
    if (!idsObeyRule([...done, ...undone].map((row) => row[0]), deleted.map((row) => row[0]))) {
        return null
    }
    return { done, undone, deleted, restore }
}

// The strict reader of one entry's value: `v` 1, the kind of its key part, the owner, and for a
// step or a deleted item its own id equal to the key's.
function readEntryData(text: string, kind: EntryKind, owner: OwnerKey, id: string | null): unknown {
    const value = parseJson(text)
    if (!value || value.v !== 1 || value.k !== kind || value.ownerKey !== owner) {
        return undefined
    }
    const data = value.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return undefined
    }
    if (id !== null && (data as { id?: unknown }).id !== id) {
        return undefined
    }
    return data
}

// ---------------------------------------------------------------- baseline

// What this instance last loaded or wrote for one owner: the generation, the write id of its header
// and, per stored part, the record object it came from and the stored value's length. A part is
// unchanged when the record still holds that same object (the model never edits one in place).
export interface BaselinePart {
    ref: object
    n: number
}

export interface Baseline {
    wid: string
    gen: string
    parts: Map<string, BaselinePart>
}

export interface StoredOwner {
    header: StoredHeader
    record: OwnerRecord
    // Its refs are the objects inside `record`, the one the service keeps as its own.
    baseline: Baseline
}

function baselineOf(header: StoredHeader, record: OwnerRecord, lists: IndexLists): Baseline {
    const parts = new Map<string, BaselinePart>()
    lists.done.forEach(([id, n], index) => parts.set(stepPart(id), { ref: record.done[index], n }))
    lists.undone.forEach(([id, n], index) => parts.set(stepPart(id), { ref: record.undone[index], n }))
    lists.deleted.forEach(([id, n], index) => parts.set(deletedPart(id), { ref: record.deleted[index], n }))
    if (lists.restore !== null && record.restore !== null) {
        parts.set(RESTORE_PART, { ref: record.restore, n: lists.restore })
    }
    return { wid: header.wid, gen: header.gen, parts }
}

// Reads one owner's generation: the header passes, the range holds exactly the index and one key
// per listed entry, every length equals its `n`, the stored size matches the index and the assembled
// record passes the model's guards. Any failure returns null; that owner is never counted, deleted
// or overwritten. It does not check the size against the owner cap: a later build may change the ratio.
export function readOwner(
    owner: OwnerKey,
    headerText: unknown,
    keys: readonly unknown[],
    values: readonly unknown[],
): StoredOwner | null {
    const header = readHeader(headerText, owner)
    if (!header || keys.length !== values.length) {
        return null
    }
    const prefix = genPrefix(owner, header.gen)
    const byPart = new Map<string, string>()
    for (let at = 0; at < keys.length; at++) {
        const key = keys[at]
        const value = values[at]
        if (typeof key !== 'string' || !key.startsWith(prefix) || typeof value !== 'string') {
            return null
        }
        byPart.set(key.slice(prefix.length), value)
    }
    const indexText = byPart.get(INDEX_PART)
    const lists = indexText === undefined ? null : readIndex(indexText, owner, header.wid)
    if (!lists) {
        return null
    }
    const expectedCount = 1 + lists.done.length + lists.undone.length + lists.deleted.length + (lists.restore === null ? 0 : 1)
    if (byPart.size !== expectedCount || header.size !== ownerSizeOf(lists, owner.length)) {
        return null
    }
    const read = (part: string, n: number, kind: EntryKind, id: string | null): unknown => {
        const text = byPart.get(part)
        if (text === undefined || text.length !== n) {
            return undefined
        }
        return readEntryData(text, kind, owner, id)
    }
    const collect = (rows: IndexRow[], kind: 's' | 'd'): unknown[] | null => {
        const out: unknown[] = []
        for (const [id, n] of rows) {
            const data = read(kind === 's' ? stepPart(id) : deletedPart(id), n, kind, id)
            if (data === undefined) {
                return null
            }
            out.push(data)
        }
        return out
    }
    const done = collect(lists.done, 's')
    const undone = collect(lists.undone, 's')
    const deleted = collect(lists.deleted, 'd')
    if (!done || !undone || !deleted) {
        return null
    }
    let restore: unknown = null
    if (lists.restore !== null) {
        restore = read(RESTORE_PART, lists.restore, 'r', null)
        if (restore === undefined) {
            return null
        }
    }
    const record = parseOwnerRecord({ ownerKey: owner, touchedAt: header.touchedAt, done, undone, deleted, restore }, owner)
    if (!record) {
        return null
    }
    return { header, record, baseline: baselineOf(header, record, lists) }
}

// ---------------------------------------------------------------- load classification

export interface LoadClassification {
    result: LoadResult
    expectation: Expectation
    // The baseline this instance holds for the owner after the load; null when it holds none.
    baseline: Baseline | null
}

export type HeaderStep =
    | { kind: 'classified'; classification: LoadClassification }
    // The header passes: the generation's entries must be read next.
    | { kind: 'readEntries'; header: StoredHeader }

// Batch 1 of a load: the header value (undefined when the key is absent) and whether `xh:` exists.
export function classifyHeader(owner: OwnerKey, headerValue: unknown, asidePresent: boolean): HeaderStep {
    if (headerValue === undefined) {
        return { kind: 'classified', classification: { result: { kind: 'absent' }, expectation: { kind: 'none' }, baseline: null } }
    }
    const header = readHeader(headerValue, owner)
    if (!header) {
        return { kind: 'classified', classification: unreadableClassification(asidePresent) }
    }
    return { kind: 'readEntries', header }
}

function unreadableClassification(asidePresent: boolean): LoadClassification {
    return {
        result: { kind: asidePresent ? 'keptUnreadable' : 'unreadable' },
        expectation: { kind: 'foreign' },
        baseline: null,
    }
}

// Batch 2 of a load, once the header passed: the entries of the header's generation, as read.
export function classifyLoad(
    owner: OwnerKey,
    headerValue: unknown,
    asidePresent: boolean,
    keys: readonly unknown[],
    values: readonly unknown[],
): LoadClassification {
    const step = classifyHeader(owner, headerValue, asidePresent)
    if (step.kind === 'classified') {
        return step.classification
    }
    const stored = readOwner(owner, headerValue, keys, values)
    if (!stored) {
        return unreadableClassification(asidePresent)
    }
    return {
        result: { kind: 'ok', record: stored.record },
        expectation: { kind: 'wid', wid: stored.header.wid },
        baseline: stored.baseline,
    }
}

// ---------------------------------------------------------------- S4: the save decision

export type HeaderRead =
    | { kind: 'absent' }
    | { kind: 'passes'; header: StoredHeader; value: unknown }
    | { kind: 'fails'; value: unknown }

export function readOwnHeader(owner: OwnerKey, value: unknown): HeaderRead {
    if (value === undefined) {
        return { kind: 'absent' }
    }
    const header = readHeader(value, owner)
    return header ? { kind: 'passes', header, value } : { kind: 'fails', value }
}

export type SaveDecision =
    | { kind: 'notLoaded' }
    | { kind: 'kept' }
    // The stored state is the one this instance last loaded or wrote, and its baseline agrees.
    | { kind: 'delta' }
    // A full rewrite under a fresh gen. `staleGen` is the stored gen to delete when the match was
    // inconsistent with the baseline; null otherwise (nothing in the owner's range is touched).
    | { kind: 'full'; staleGen: string | null }
    // Foreign or unreadable bytes: copy the stored header to `xh:` once, then a full rewrite.
    | { kind: 'aside'; headerValue: unknown }

export function decideSave(
    headerRead: HeaderRead,
    asideTaken: boolean,
    expectation: Expectation | undefined,
    baseline: Baseline | null,
): SaveDecision {
    if (!expectation) {
        return { kind: 'notLoaded' }
    }
    if (headerRead.kind === 'absent') {
        return { kind: 'full', staleGen: null }
    }
    if (headerRead.kind === 'passes' && expectation.kind === 'wid' && headerRead.header.wid === expectation.wid) {
        const { header } = headerRead
        if (baseline && baseline.wid === header.wid && baseline.gen === header.gen) {
            return { kind: 'delta' }
        }
        return { kind: 'full', staleGen: header.gen }
    }
    return asideTaken ? { kind: 'kept' } : { kind: 'aside', headerValue: headerRead.value }
}

// ---------------------------------------------------------------- planners

export type WriteRequest =
    | { op: 'put'; key: string; value: unknown }
    | { op: 'delete'; key: string }
    | { op: 'deleteRange'; lower: string; upper: string }

interface KeptEntry {
    part: string
    ref: object
    n: number
    // The serialized value to put; null when the entry is unchanged against the baseline.
    text: string | null
}

interface WalkedOwner {
    done: KeptEntry[]
    undone: KeptEntry[]
    deleted: KeptEntry[]
    restore: KeptEntry | null
    trimmed: boolean
    size: number
}

// The keep walk. Priority order: the restore point, then `deleted`, `undone` and `done`, each newest
// to oldest. It adds up the entry sizes and stops at the first entry for which the owner's size would
// pass `ownerCap`: that entry and everything after it are dropped. That is the oldest `done` first,
// then `undone`, `deleted` and the restore point, because every size is positive. `memo` holds the
// lengths of entries that were measured but not kept, so a repeated save does not measure them again.
function walkOwner(record: OwnerRecord, baseline: Baseline | null, ownerCap: number, memo: WeakMap<object, number>): WalkedOwner {
    const ownerKey = record.ownerKey
    const ownerKeyLength = ownerKey.length
    let size = OWNER_OVERHEAD
    let stopped = false
    let trimmed = false

    function take(kind: EntryKind, ref: Step | DeletedItem | RestorePoint, part: string, idLength: number): KeptEntry | null {
        if (stopped) {
            trimmed = true
            return null
        }
        const prior = baseline?.parts.get(part)
        // Unchanged: the baseline holds this very object, so its stored value is what would be put.
        const unchanged = prior !== undefined && prior.ref === ref
        let n: number
        let text: string | null = null
        if (unchanged) {
            n = prior.n
        } else {
            const remembered = memo.get(ref)
            if (remembered === undefined) {
                text = serializeEntry(kind, ownerKey, ref)
                n = text.length
            } else {
                n = remembered
            }
        }
        const counted = entrySize(n, idLength, ownerKeyLength)
        if (size + counted > ownerCap) {
            stopped = true
            trimmed = true
            memo.set(ref, n)
            return null
        }
        if (!unchanged && text === null) {
            text = serializeEntry(kind, ownerKey, ref)
            n = text.length
        }
        size += entrySize(n, idLength, ownerKeyLength)
        return { part, ref, n, text }
    }

    const restore = record.restore === null ? null : take('r', record.restore, RESTORE_PART, 0)
    const deleted: KeptEntry[] = []
    for (let at = record.deleted.length - 1; at >= 0; at--) {
        const item = record.deleted[at]
        const kept = take('d', item, deletedPart(item.id), item.id.length)
        if (kept) {
            deleted.push(kept)
        }
    }
    const undone: KeptEntry[] = []
    for (let at = record.undone.length - 1; at >= 0; at--) {
        const step = record.undone[at]
        const kept = take('s', step, stepPart(step.id), step.id.length)
        if (kept) {
            undone.push(kept)
        }
    }
    const done: KeptEntry[] = []
    for (let at = record.done.length - 1; at >= 0; at--) {
        const step = record.done[at]
        const kept = take('s', step, stepPart(step.id), step.id.length)
        if (kept) {
            done.push(kept)
        }
    }
    // Oldest first, the order the index lists and the record keep.
    return { done: done.reverse(), undone: undone.reverse(), deleted: deleted.reverse(), restore, trimmed, size }
}

export interface PlannedSave {
    // Entry deletes, entry puts, the index and, last, the header.
    requests: WriteRequest[]
    header: StoredHeader
    baseline: Baseline
    trimmed: boolean
}

function keptParts(walked: WalkedOwner): KeptEntry[] {
    return [...walked.done, ...walked.undone, ...walked.deleted, ...(walked.restore ? [walked.restore] : [])]
}

function finishPlan(
    record: OwnerRecord,
    walked: WalkedOwner,
    wid: string,
    gen: string,
    requests: WriteRequest[],
): PlannedSave {
    const owner = record.ownerKey
    const rows = (entries: KeptEntry[]): IndexRow[] =>
        entries.map((entry) => [entry.part.slice(2), entry.n] as IndexRow)
    const lists: IndexLists = {
        done: rows(walked.done),
        undone: rows(walked.undone),
        deleted: rows(walked.deleted),
        restore: walked.restore ? walked.restore.n : null,
    }
    for (const entry of keptParts(walked)) {
        if (entry.text !== null) {
            requests.push({ op: 'put', key: entryKey(owner, gen, entry.part), value: entry.text })
        }
    }
    const header: StoredHeader = { wid, gen, ownerKey: owner, size: walked.size, touchedAt: record.touchedAt }
    requests.push({ op: 'put', key: entryKey(owner, gen, INDEX_PART), value: serializeIndex(owner, wid, lists) })
    requests.push({ op: 'put', key: headerKey(owner), value: serializeHeader(header) })
    const parts = new Map<string, BaselinePart>()
    for (const entry of keptParts(walked)) {
        parts.set(entry.part, { ref: entry.ref, n: entry.n })
    }
    return { requests, header, baseline: { wid, gen, parts }, trimmed: walked.trimmed }
}

// A full rewrite under the fresh gen `wid`: every kept entry is put, whatever the baseline was.
// `staleGen` is the stored gen to range-delete first (the match-inconsistent case), else null.
export function planFull(
    record: OwnerRecord,
    wid: string,
    ownerCap: number,
    memo: WeakMap<object, number>,
    staleGen: string | null = null,
): PlannedSave {
    const walked = walkOwner(record, null, ownerCap, memo)
    const requests: WriteRequest[] = []
    if (staleGen !== null) {
        const bounds = genBounds(record.ownerKey, staleGen)
        requests.push({ op: 'deleteRange', lower: bounds.lower, upper: bounds.upper })
    }
    return finishPlan(record, walked, wid, wid, requests)
}

// A patch into the baseline's gen: only the entries whose object differs from the baseline are put,
// the baseline parts that are no longer kept are deleted, and the index and header go last.
export function planDelta(
    record: OwnerRecord,
    baseline: Baseline,
    wid: string,
    ownerCap: number,
    memo: WeakMap<object, number>,
): PlannedSave {
    const walked = walkOwner(record, baseline, ownerCap, memo)
    const kept = new Set(keptParts(walked).map((entry) => entry.part))
    const requests: WriteRequest[] = []
    for (const part of baseline.parts.keys()) {
        if (!kept.has(part)) {
            requests.push({ op: 'delete', key: entryKey(record.ownerKey, baseline.gen, part) })
        }
    }
    return finishPlan(record, walked, wid, baseline.gen, requests)
}

// The stored (trimmed) size of `record` at the store cap `cap`; with `Infinity` the untrimmed size.
export function storedSizeOf(record: OwnerRecord, ownerKey: OwnerKey, cap: number): number {
    return planFull({ ...record, ownerKey }, 'sizing', ownerCapFor(cap), new WeakMap()).header.size
}

// ---------------------------------------------------------------- eviction (S5)

// Owners to delete so that the counted total fits `cap`. The owner being written counts once, by
// its new size; owners in `protect` count but are never picked. Candidates go oldest `touchedAt`
// first, ties by key. When no candidate remains the loop stops and the write proceeds over the cap.
export function evictionPlan(
    headers: readonly StoredHeader[],
    written: OwnerKey,
    newSize: number,
    cap: number,
    protect: ReadonlySet<OwnerKey>,
): StoredHeader[] {
    let total = newSize
    for (const header of headers) {
        if (header.ownerKey !== written) {
            total += header.size
        }
    }
    const candidates = headers
        .filter((header) => header.ownerKey !== written && !protect.has(header.ownerKey))
        .sort((a, b) => a.touchedAt - b.touchedAt || (a.ownerKey < b.ownerKey ? -1 : a.ownerKey > b.ownerKey ? 1 : 0))
    const picked: StoredHeader[] = []
    for (const candidate of candidates) {
        if (total <= cap) {
            break
        }
        picked.push(candidate)
        total -= candidate.size
    }
    return picked
}

// ---------------------------------------------------------------- the whole save, as pure data

export interface PrepareSaveInput {
    owner: OwnerKey
    record: OwnerRecord
    protect: ReadonlySet<OwnerKey>
    expectation: Expectation | undefined
    baseline: Baseline | null
    ownHeader: HeaderRead
    // Every header of the `h:` range that passed its reader (the owner's own included).
    headers: readonly StoredHeader[]
    asideTaken: boolean
    // The store cap; the owner cap is derived from it.
    cap: number
    memo: WeakMap<object, number>
    // Called only when a write plan is made; yields a fresh write id.
    nextWid: () => string
}

export type PreparedSave =
    | { kind: 'result'; result: SaveResult }
    | {
          kind: 'write'
          // Victim deletes, the `xh:` put, entry deletes, entry puts, the index, the header last.
          requests: WriteRequest[]
          wid: string
          baseline: Baseline
          asided: boolean
          trimmed: boolean
      }

// Decides and plans one save without touching a database. On an id-rule breach nothing is planned.
export function prepareSave(input: PrepareSaveInput): PreparedSave {
    const { owner, record } = input
    if (!input.expectation) {
        return { kind: 'result', result: { kind: 'notLoaded' } }
    }
    if (!recordObeysIdRule(record)) {
        return { kind: 'result', result: { kind: 'unwritable' } }
    }
    const decision = decideSave(input.ownHeader, input.asideTaken, input.expectation, input.baseline)
    if (decision.kind === 'notLoaded' || decision.kind === 'kept') {
        return { kind: 'result', result: { kind: decision.kind } }
    }
    const wid = input.nextWid()
    const ownerCap = ownerCapFor(input.cap)
    const plan =
        decision.kind === 'delta' && input.baseline
            ? planDelta(record, input.baseline, wid, ownerCap, input.memo)
            : planFull(record, wid, ownerCap, input.memo, decision.kind === 'full' ? decision.staleGen : null)
    const requests: WriteRequest[] = []
    for (const victim of evictionPlan(input.headers, owner, plan.header.size, input.cap, input.protect)) {
        requests.push({ op: 'delete', key: headerKey(victim.ownerKey) })
        const bounds = genBounds(victim.ownerKey, victim.gen)
        requests.push({ op: 'deleteRange', lower: bounds.lower, upper: bounds.upper })
    }
    if (decision.kind === 'aside') {
        requests.push({ op: 'put', key: asideMarkKey(owner), value: decision.headerValue })
    }
    requests.push(...plan.requests)
    return {
        kind: 'write',
        requests,
        wid,
        baseline: plan.baseline,
        asided: decision.kind === 'aside',
        trimmed: plan.trimmed,
    }
}
