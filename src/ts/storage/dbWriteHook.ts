import { untrack } from 'svelte'
import { recordCaughtError } from '../caughtErrors'
import { markDbWrite } from './characterSaveMarks'
import type { DbWriteMark } from './characterSaveMarks'
import { checkWriteHookLive } from './dbWriteHookSelfCheck.svelte'
import { STATE_PATCH_ID, linkStateChild, recordOf, setStateWriteHook, stateRecords } from './svelteStatePatch'
import type { StateRecord, StateRecordLink, StateWriteKind } from './svelteStatePatch'

/**
 * The explicit write hook: every write to the reactive `DBState` tree reaches `onWrite`, which decides which save
 * unit it belongs to and reports it to the sink (`markDbWrite`). Not installed by this module's import; the page
 * calls `installDbWriteHook(DBState, { selectedChaId })` right after creating `DBState`.
 *
 * The model. The patched Svelte proxy (patches/svelte-5.57.3) keeps a record per state proxy and, on every store of
 * a proxy into another proxy, a link `(parent record, key)` on the child's record (`null` key for an array parent).
 * - Axiom L: every store of a proxy in a source of another proxy leaves a link on the child's record. Links are
 *   never removed. The patch's four link sites and this module's spread rule and whole-db/whole-list early link
 *   are the only places links are added.
 * - Axiom S: two proxies share a record only when both are arrays (a fresh array replaced an array under an object
 *   key). Every plain-object record, including the root, db and character records, belongs to exactly one proxy.
 *
 * Roles are facts about links: a record is db-role when linked `(root record, 'db')`, list-role when linked
 * `(db-role record, 'characters')`, and a character record when linked `(list-role record, null)`.
 *
 * Owner set. A write on a proxy marks the union, over every upward link path that stops at the root record, of what
 * each hop says: a hop from a list-role record adds that character; a hop from a db-role record under a key other
 * than `characters` adds `top:<key>`. A role never ends the walk; only the root record does. Sharing merges nodes
 * of the link graph, and a union over paths only grows when nodes merge, so these set-valued facts are safe on
 * shared records. A single-valued fact is safe only on a record axiom S never merges, which is why the one such
 * fact kept here, the character tag, sits on plain-object records only.
 *
 * Character id. `idOf(record)` returns `record.tag` and nothing else; no mark depends on garbage collection. The
 * tag is written at four events and read nowhere else:
 * 1. a new null-key link to a list-role record whose child is a plain object with a valid `chaId` (link callback);
 * 2. the tag pass over `db.characters`, at install and after every whole-db or whole-list write;
 * 3. the list rule: an index write into a list-role record whose stored value is a plain object with an untagged
 *    record reads `chaId` once, untracked, and tags it when valid;
 * 4. a `chaId` write through a plain-object proxy whose record is a character record.
 * A valid id is a non-empty string or a finite number. Arrays are never tagged; an array in a list slot takes the
 * logged per-write fallback.
 *
 * Residency install. `withQuietCharacterInstall` makes an index write of a character object into the list mark
 * nothing and schedule nothing while still tagging the value; a field write inside the scope marks as usual.
 * Install-time check. `installDbWriteHook` writes once to a throwaway `$state` and requires `onWrite` to see it; a
 * runtime that never calls the callback is recorded as `dbWriteHook.selfCheck`, and nothing is marked in its place.
 *
 * Known limits, accepted: a proxy reachable only through a raw (not yet proxied) container two or more levels deep
 * resolves to its former owners until a read through the new path links it (the placement of its character is still
 * marked); writes that bypass the proxy (descriptors read by `Object.getOwnPropertyDescriptor`, values stored by
 * `defineProperty` as raw objects) are not seen. Over-marking from never-removed links costs a save, never data.
 */

export interface DbWriteHookOptions {
    /** Receives a failure of the write or link callback, which never fails the write itself. */
    onError?: (error: unknown) => void
    /** The selected character's id, for the per-write fallback; `() => undefined` means the fallback only schedules. */
    selectedChaId: () => unknown
    /** Where marks go; `markDbWrite` by default. */
    sink?: (mark: DbWriteMark) => void
}

/** A record with more links than this is reported once per install (cost visibility; no mark depends on it). */
export const LINK_GROWTH_THRESHOLD = 64

type Owner = { kind: 'char', c: StateRecord } | { kind: 'top', key: string }

// Resolved at call time: modules that suites load with a partial `characterSaveMarks` mock (`coldCharacterRestore`,
// `stores.svelte`) import this one, and the import must not read the missing export.
const defaultSink = (mark: DbWriteMark): void => markDbWrite(mark)

let rootRec: StateRecord | null = null
let sink: (mark: DbWriteMark) => void = defaultSink
let onError: (error: unknown) => void = defaultOnError
let selectedChaId: () => unknown = () => undefined
let reportedLinkGrowth = false
let quiet = false
// Depth of `withQuietCharacterInstall` scopes; only an index write of a character into the list consults it.
let quietInstallDepth = 0
// The throwaway state proxy of the install-time self-check, set only while that check runs.
let selfCheckProbe: object | null = null
let selfCheckSeen = false
const reportedCauses = new Set<string>()
let writeDepth = 0
// One owner list and one visited set serve the outermost write; a write nested inside a mark allocates its own.
const sharedVisited = new Set<StateRecord>()
const sharedOwners: Owner[] = []

function defaultOnError(error: unknown): void {
    recordCaughtError('dbWriteHook ' + STATE_PATCH_ID, error)
}

function recOf(node: unknown): StateRecord | undefined {
    return typeof node === 'object' && node !== null ? stateRecords.get(node) : undefined
}

// Role predicates read links only and allocate nothing.
function isDb(rec: StateRecord): boolean {
    if (rec.r === rootRec && rec.k === 'db') return true
    const more = rec.more
    if (more !== null) for (let i = 0; i < more.length; i++) if (more[i].r === rootRec && more[i].k === 'db') return true
    return false
}
function isList(rec: StateRecord): boolean {
    if (rec.k === 'characters' && rec.r !== null && isDb(rec.r)) return true
    const more = rec.more
    if (more !== null) for (let i = 0; i < more.length; i++) if (more[i].k === 'characters' && isDb(more[i].r)) return true
    return false
}
function isCharRec(rec: StateRecord): boolean {
    if (rec.r !== null && isList(rec.r)) return true
    const more = rec.more
    if (more !== null) for (let i = 0; i < more.length; i++) if (isList(more[i].r)) return true
    return false
}
// A value that is already a proxy with a character record: a known character, so putting it in a slot is a move.
function underList(value: unknown): boolean {
    const rec = recOf(value)
    return rec !== undefined && isCharRec(rec)
}
function linkCount(rec: StateRecord): number {
    return rec.r === null ? 0 : rec.more === null ? 1 : 1 + rec.more.length
}

function isIndex(prop: PropertyKey): boolean {
    return typeof prop === 'string' && prop !== '' && String(Number(prop) >>> 0) === prop
}
function validId(id: unknown): id is string | number {
    return (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))
}
function isPlainObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
// The values the Svelte proxy itself wraps: plain objects and arrays.
function isPlain(value: unknown): value is object {
    if (typeof value !== 'object' || value === null) return false
    const proto: unknown = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === Array.prototype
}
function chaIdOf(value: unknown): unknown {
    return untrack(() => (value as { chaId?: unknown }).chaId)
}

function reportOnce(cause: string, error: Error): void {
    if (reportedCauses.has(cause)) return
    reportedCauses.add(cause)
    recordCaughtError('dbWriteHook.' + cause, error)
}

function collect(rec: StateRecord, out: Owner[], visited: Set<StateRecord>): void {
    if (visited.has(rec)) return
    visited.add(rec)
    if (!quiet && !reportedLinkGrowth) {
        const count = linkCount(rec)
        if (count > LINK_GROWTH_THRESHOLD) {
            reportedLinkGrowth = true
            reportOnce('linkGrowth', new Error('a state record holds ' + count + ' links'))
        }
    }
    if (rec.r !== null) walkLink(rec, rec.r, rec.k, out, visited)
    const more = rec.more
    if (more !== null) for (let i = 0; i < more.length; i++) walkLink(rec, more[i].r, more[i].k, out, visited)
}
function walkLink(child: StateRecord, parent: StateRecord, key: StateRecordLink['k'], out: Owner[], visited: Set<StateRecord>): void {
    if (parent === rootRec) return
    if (isList(parent)) out.push({ kind: 'char', c: child })
    if (key !== 'characters' && isDb(parent)) out.push({ kind: 'top', key: String(key) })
    collect(parent, out, visited)
}

function fallbackMark(cause: 'noCharId' | 'error'): void {
    let id: unknown
    try { id = selectedChaId() } catch { id = undefined }
    sink({ kind: 'fallback', cause, id })
}
function markOwner(owner: Owner): void {
    if (owner.kind === 'top') {
        sink({ kind: 'setting', key: owner.key })
        return
    }
    const id = owner.c.tag
    if (!validId(id)) {
        reportOnce('noCharId', new Error('a write under a character record that never had a usable chaId'))
        fallbackMark('noCharId')
        return
    }
    sink({ kind: 'owner', id })
}

// Link callback: a child was newly stored under a list-role record, so its record gets the character's id.
function onLink(child: object, childRec: StateRecord, parentRec: StateRecord): void {
    if (rootRec === null || Array.isArray(child) || !isList(parentRec)) return
    const id = chaIdOf(child)
    if (validId(id)) childRec.tag = id
}

function tagElements(list: unknown): void {
    if (!Array.isArray(list)) return
    untrack(() => {
        for (let i = 0; i < list.length; i++) {
            const element: unknown = list[i]
            if (!isPlainObject(element)) continue
            const rec = recOf(element)
            if (rec === undefined) continue
            const id = (element as { chaId?: unknown }).chaId
            if (validId(id)) rec.tag = id
        }
    })
}

function onWrite(kind: StateWriteKind, owner: object, prop: PropertyKey, value: unknown, stored: unknown): void {
    // The self-check's own write proves the callback is registered; it is never a database write.
    if (selfCheckProbe !== null && owner === selfCheckProbe) {
        selfCheckSeen = true
        return
    }
    if (rootRec === null) return
    try {
        // A write that makes a record the db or the list links it first; the tag pass then covers characters linked
        // before that moment.
        let tagList: unknown
        const ownerRec = recOf(owner)
        if ((kind === 0 || kind === 2) && typeof stored === 'object' && stored !== null) {
            if (ownerRec === rootRec && prop === 'db') {
                linkStateChild(stored, owner, 'db')
                tagList = value === stored ? untrack(() => (stored as { characters?: unknown }).characters) : (value as { characters?: unknown }).characters
            } else if (ownerRec !== undefined && prop === 'characters' && isDb(ownerRec)) {
                linkStateChild(stored, owner, 'characters')
                tagList = value === stored ? stored : value
            }
        }
        // Spread rule: a fresh plain value carried state proxies in its own data properties; link them one level
        // under the proxy that now holds the copy. Descriptors are read, so no trap and no getter runs.
        if (kind === 0 && stored !== value && isPlain(value) && typeof stored === 'object' && stored !== null) {
            const arrayValue = Array.isArray(value)
            for (const key of Object.keys(value)) {
                const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
                if (descriptor !== undefined && 'value' in descriptor) linkStateChild(descriptor.value, stored, arrayValue ? null : key)
            }
        }
        if (tagList !== undefined) tagElements(tagList)

        const rec = recOf(owner)
        if (rec === rootRec) {
            sink({ kind: 'root', prop: String(prop) })
            return
        }
        if (rec === undefined) return
        // A `chaId` write refreshes the tag of a character record. The character-record condition matters: a draft
        // renamed before placement must stay untagged, or the list rule below would take its placement for a move.
        if (prop === 'chaId' && kind !== 1 && validId(value) && !Array.isArray(owner) && isCharRec(rec)) rec.tag = value
        if (isDb(rec)) {
            sink(prop === 'characters' ? { kind: 'listWhole' } : { kind: 'setting', key: String(prop) })
        }
        if (isList(rec)) {
            // List rule. New versus moved is decided by the tag of the stored proxy's record: tagged is a known
            // character, so it is a move and nothing is marked for it; untagged or without a record is read once,
            // tagged when the id is valid, and its placement is marked.
            // A tagged value is placed without a character mark. That is safe because a list write schedules a
            // pass, every pass encodes the residents the previous encoding does not hold (saveEncoder
            // `unheldChaIds` through `planOf`), and the identity tracker in dbChangeEffects marks proxies it has
            // never seen. The residual is a proxy that was seen in the live list, edited while outside it, and put
            // back over a different live proxy with the same `chaId`: its unit is then carried from the other proxy.
            const object = (kind === 0 || kind === 2) && isIndex(prop) && typeof value === 'object' && value !== null
            const valueRec = object && isPlainObject(stored) ? recOf(stored) : undefined
            let placed = false
            let placedId: unknown
            if (object && (valueRec === undefined || valueRec.tag === undefined)) {
                placedId = chaIdOf(value)
                if (valueRec !== undefined && validId(placedId)) valueRec.tag = placedId
                placed = validId(placedId) || (kind === 0 && !underList(value))
            }
            // A residency install puts a character the store already holds into its slot: the value is known (tagged
            // above) and nothing is marked or scheduled for the placement itself.
            if (quietInstallDepth > 0 && object) return
            sink(placed ? { kind: 'placed', id: placedId } : { kind: 'listShape', prop: String(prop) })
        }

        const owners = writeDepth === 0 ? sharedOwners : []
        const visited = writeDepth === 0 ? sharedVisited : new Set<StateRecord>()
        writeDepth++
        try {
            owners.length = 0
            visited.clear()
            collect(rec, owners, visited)
            for (const o of owners) markOwner(o)
        } finally {
            writeDepth--
            owners.length = 0
            visited.clear()
        }
    } catch (error) {
        // The write already happened. Report the failure and still schedule a save for the selected character.
        try { onError(error) } catch { /* the error sink never fails a write */ }
        try { fallbackMark('error') } catch { /* nor does the fallback */ }
    }
}

/**
 * Registers the hook on `dbRoot`, the page's `$state` root object, and tags every character already linked under
 * `dbRoot.db.characters`. Call it before the first read of `DBState` so every record is linked as it is created.
 * Installing again replaces the previous registration.
 */
export function installDbWriteHook<T extends object>(dbRoot: T, options: DbWriteHookOptions): T {
    sink = options.sink ?? defaultSink
    onError = options.onError ?? defaultOnError
    selectedChaId = options.selectedChaId
    reportedLinkGrowth = false
    reportedCauses.clear()
    rootRec = recordOf(dbRoot)
    setStateWriteHook(onWrite, (error) => onError(error), onLink)
    tagElements(untrack(() => (dbRoot as { db?: { characters?: unknown } }).db?.characters))
    selfCheckDbWriteHook()
    return dbRoot
}

/**
 * Install-time check (SC1) that the patched runtime reaches the registered callback: one write to a throwaway
 * `$state` must be observed by `onWrite`. A hook that is not live is recorded as `dbWriteHook.selfCheck`; nothing
 * else changes (the effects safety net keeps running and no mark is invented). Returns whether the write was seen.
 */
export function selfCheckDbWriteHook(): boolean {
    selfCheckSeen = false
    return checkWriteHookLive(
        (probe) => { selfCheckProbe = probe },
        () => selfCheckSeen,
        () => { selfCheckProbe = null },
    )
}

/**
 * Runs `fn`, inside which an index write of a character object into the character list is not marked and schedules
 * nothing, though its value is still recorded as known (the character tag). Used only where a character the store
 * already holds is installed in its slot (the store2 residency load). Any other write inside the scope, a nested
 * field write of that character included, is marked as usual.
 */
export function withQuietCharacterInstall<T>(fn: () => T): T {
    quietInstallDepth++
    try {
        return fn()
    } finally {
        quietInstallDepth--
    }
}

/** Unregisters the hook. Writes are no longer reported; links the patch recorded stay. */
export function uninstallDbWriteHook(): void {
    setStateWriteHook(null)
    rootRec = null
}

/** A stable text label of a mark (`char:<id>`, `newChar:<id>`, `top:<key>`, ...), for tests and diagnostics. */
export function describeDbWriteMark(mark: DbWriteMark): string {
    switch (mark.kind) {
        case 'owner': return 'char:' + String(mark.id)
        case 'placed': return 'newChar:' + String(mark.id)
        case 'setting': return 'top:' + mark.key
        case 'listShape': return 'listShape:' + mark.prop
        case 'listWhole': return 'list:whole'
        case 'root': return 'root:' + mark.prop
        case 'fallback': return 'fallback:' + mark.cause
    }
}

/**
 * The owner labels (`char:<id>`, `top:<key>`) a write on `node` would mark, from links and tags only. It has no
 * side effect: nothing is marked, recorded or tagged. For tests and diagnostics.
 */
export function ownersOf(node: object): string[] {
    const owners: Owner[] = []
    const rec = recOf(node)
    quiet = true
    try {
        if (rec !== undefined) collect(rec, owners, new Set())
    } finally {
        quiet = false
    }
    return owners.map((o) => o.kind === 'top' ? 'top:' + o.key : 'char:' + String(o.c.tag))
}

/** How many links the patch holds for `node`'s record (0 when it has none). For tests and diagnostics. */
export function linkCountOf(node: object): number {
    const rec = recOf(node)
    return rec === undefined ? 0 : linkCount(rec)
}
