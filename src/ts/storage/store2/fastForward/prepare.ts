import { v4 } from 'uuid'
import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database, character, groupChat } from '../../database.svelte'
import {
    assembleChatEntry, assembleCharacter, characterBodyMatches, configFields, DERIVED_COLD_FIELDS, ENTRY_MOVED_FIELDS, freshEntry, isColdStub, isJsonObject,
    LORE_FIELDS, overlayStub, pickFields, plainObject, readCheckedUnit, readObjectField, sameJsonValue, SCRIPT_FIELDS, stubFromEntry, toPlainJson,
    unitDigest, VOLATILE_CHARACTER_FIELDS, VOLATILE_CHAT_FIELDS,
    type FreshEntry, type ListDerivation, type PreviousEncoding, type VerdictOptions,
} from '../codec'
import { encodeUnit, keyOfRef, readUnit, UNIT_TYPE, type ChatEntry, type ContentBody, type KeyEnv, type Ref, type ShardEntry, type UnitType } from '../format'
import type { StoredTree } from '../previousOfTree'
import { checkedBytes, registerEntityUnits } from '../previousOfTree'
import { residentSetOf } from '../residencyPolicy'
import {
    classifyCharacter, classifyCharacterOrder, classifyCharacterRecords, classifyConfig, classifyMembership, classifyMovedFields, completeOrder, decideDeleteRow,
    editedForDelete, editedThereForDelete, membershipInDomain, membershipTarget, mergeMembership, mergeStatics, movedFieldsOf, placeInsertions,
    type KeptCharacter, type Member, type MovedFields, type OrderEntry, type RecordDecision,
} from './delta'
import type { DeferClass } from './defer'
import type { GuardEntry } from './guard'
import type { EntityUnit } from './read'
import { makeChatCopy } from './chatCopy'
import {
    answerFor, decideSwitch, PERSONA_OPS, PERSONA_RECORD_FIELDS, PRESET_RECORD_FIELDS, valueFingerprint,
    type ConflictAnswers, type ConflictChoice, type ConflictRecord, type SwitchOps, type SwitchSide,
} from './records'
import {
    chatRecordId, decideView, fingerprintOf, isWholeEntry, mergeChatList, RECORD_CHAT_LIST, RECORD_CORE, RECORD_LORE, RECORD_SCRIPTS, RECORD_VIEW, RECORD_WHOLE,
    recordRefs, changedRecords, type RecordSide,
} from './units'

/**
 * The synchronous middle of the fast-forward: from the acknowledged encoding (base), the live database (mine) and the
 * peer's tree (theirs) it decides every record and builds the steps that write the result. Nothing here writes: a park
 * or a throw leaves the database as it was. Every value written is a copy, so the database never aliases the
 * acknowledged encoding's bodies.
 */

type Value = JsonValue | undefined
type Slot = character | groupChat

/** What a send is writing: the characters it may write into and, by owner, the chats it writes. */
export interface WritingSet {
    chars: ReadonlySet<string>
    chats: ReadonlyMap<string, ReadonlySet<string>>
}

/** What the fast-forward needs from the page, supplied lazily so the boot dispatch imports no page module. */
export interface FastForwardHost {
    /** The characters open here: the selection, the previous selection with its group members. */
    inUse(): ReadonlySet<string>
    /** A reply is being written into this character. */
    writing(chaId: string): boolean
    /** What registered work is writing now (the wait rule's set). */
    writingTargets(): WritingSet
    /** A busy action or a choke point is in flight (deferral D2). */
    busy(): boolean
    /** A send is running (deferral D1). */
    sending(): boolean
    /** Runs `fn` so that installing a character object the store holds raises no save mark. */
    installQuietly<T>(fn: () => T): T
    /** Forgets what the page keeps about a loaded character object that is being replaced. */
    forgetLoaded(slot: character | groupChat): void
    /** Marks a character for the next save pass. */
    mark(chaId: string): void
    /** The selected character's index, -1 for none. */
    selection(): number
    /** Selects the character at `index`, -1 for none. */
    select(index: number): void
    /** The preset record's operations, bound to the page's own `setPreset` and `presetFromWorkingSettings`. */
    presetOps(): SwitchOps
}

export interface PrepareInput {
    db: Database
    old: PreviousEncoding
    target: StoredTree
    next: PreviousEncoding
    host: FastForwardHost
    replyOwners: ReadonlySet<string>
    env: KeyEnv
    lists: ListDerivation
    /** Tests only: replaces the fresh encode of a live character (detection and the oracle). */
    fresh?: (slot: Slot, options: VerdictOptions) => FreshEntry | 'unknown'
    /**
     * The page can ask: a record both sides changed is collected into a `conflict` result. Without it the first
     * conflict parks with its `legacy` reason, as it did before the dialog.
     */
    collect?: boolean
    /** The answers of a resolution; each applies only while its fingerprints still match. */
    answers?: ConflictAnswers
    /** Tests only: the id a keep-both chat copy gets. */
    newId?: () => string
}

/** One write of the apply, with the undo that restores it and the check that its result is what was decided. */
export interface Step {
    apply(): () => void
    verify(): boolean
    /** Run once after every step applied and verified, the oracle passed and the encoder moved. */
    after?: () => void
}

/** The records a send is writing that the peer changed: the whole fast-forward waits until none of them is written. */
export interface WaitOn {
    chars: string[]
    chats: Array<[string, string]>
}

export type Prepared =
    | { kind: 'park', reason: string }
    /** Units of changed characters that the decision needs and the tree's source does not hold yet. */
    | { kind: 'need', units: EntityUnit[], reason: 'entity-late' }
    /** Records both sides changed and no answer covers: nothing is applied, the person is asked. */
    | { kind: 'conflict', conflicts: ConflictRecord[], waits: WaitOn | null, reason: string }
    | {
        kind: 'ready', defers: ReadonlySet<DeferClass>, steps: Step[], guard: GuardEntry[]
        /** Set when a theirs-changed record lies in what a send writes. */
        waits: WaitOn | null
        /** Run after the steps verified: false (or a throw) is a violation that undoes them. */
        oracle: Array<() => boolean>
        /** An answer kept both versions of a record that is not a chat: the peer's tree enters `retained`. */
        restorePoint: boolean
    }

function isSlotObject(value: JsonObject): value is JsonObject & Slot {
    return typeof value.chaId === 'string'
}

/** The field of `db` as plain JSON. */
function liveField(db: Database, name: string): Value {
    return toPlainJson(Reflect.get(db, name))
}

function fieldStep(db: Database, name: string, value: Value): Step {
    const expected = value === undefined ? undefined : structuredClone(value)
    return {
        apply() {
            const had = Object.hasOwn(db, name)
            const before: unknown = Reflect.get(db, name)
            if (expected === undefined) {
                Reflect.deleteProperty(db, name)
            } else {
                Reflect.set(db, name, structuredClone(expected))
            }
            return () => {
                if (had) {
                    Reflect.set(db, name, before)
                } else {
                    Reflect.deleteProperty(db, name)
                }
            }
        },
        verify: () => sameJsonValue(liveField(db, name), expected),
    }
}

/** Writes a moved field on a live character or stub; a value of undefined removes it. */
function movedStep(slot: Slot, name: string, value: number | undefined): Step {
    return {
        apply() {
            const had = Object.hasOwn(slot, name)
            const before: unknown = Reflect.get(slot, name)
            if (value === undefined) {
                Reflect.deleteProperty(slot, name)
            } else {
                Reflect.set(slot, name, value)
            }
            return () => {
                if (had) {
                    Reflect.set(slot, name, before)
                } else {
                    Reflect.deleteProperty(slot, name)
                }
            }
        },
        verify: () => Reflect.get(slot, name) === value,
    }
}

function stringList(value: Value): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function entriesOf(encoding: PreviousEncoding): Map<string, ShardEntry> {
    const out = new Map<string, ShardEntry>()
    for (const shard of encoding.objects?.shards ?? []) {
        for (const entry of shard.entries) {
            out.set(entry.u, entry)
        }
    }
    return out
}

function membersOf(order: ContentBody | undefined, entries: ReadonlyMap<string, ShardEntry>): Member[] | null {
    if (order === undefined) {
        return null
    }
    const members: Member[] = []
    for (const u of stringList(order.chars)) {
        const entry = entries.get(u)
        if (entry === undefined) {
            return null
        }
        members.push({ chaId: entry.chaId, u })
    }
    return members
}

function slotChaId(slot: Slot): string {
    return String(Reflect.get(slot, 'chaId') ?? '')
}

function liveMoved(slot: Slot): MovedFields {
    const out: MovedFields = {}
    for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const) {
        const value: unknown = Reflect.get(slot, name)
        if (typeof value === 'number') {
            out[name] = value
        }
    }
    return out
}

/** The stub's fields that a stub shows from its entry equal the entry's (what `overlayStub` would write back). */
function stubMatchesEntry(slot: Slot, entry: ShardEntry): boolean {
    if (!isColdStub(slot) || Reflect.get(slot, 'coldstorage') !== entry.u) {
        return false
    }
    const overlaid = overlayStub(entry, slot)
    return ['name', 'image', 'chaId', 'creatorNotes', 'tags', 'creator', 'characters'].every(name => sameJsonValue(Reflect.get(overlaid, name), Reflect.get(entry, name)))
}

function stubProjectionMatches(slot: Slot, entry: ShardEntry, moved: MovedFields): boolean {
    const built = stubFromEntry(entry)
    return ['name', 'image', 'chaId', 'creatorNotes', 'coldstorage', 'tags', 'creator', 'characters'].every(name => sameJsonValue(toPlainJson(Reflect.get(slot, name)), built[name]))
        && Reflect.get(slot, 'lastInteraction') === moved.lastInteraction && Reflect.get(slot, 'trashTime') === moved.trashTime
}

/** The identities of the units `entry` names, as the acknowledged encoding registers them. */
function identitiesOfEntry(entry: ShardEntry): Map<string, string> {
    const out = new Map<string, string>()
    registerEntityUnits(entry, (identity, _type, ref) => { out.set(identity, keyOfRef(ref)) })
    return out
}

function unitEntries(old: PreviousEncoding, entry: ShardEntry, theirs: ShardEntry): GuardEntry[] {
    const target = identitiesOfEntry(theirs)
    const out: GuardEntry[] = []
    for (const [identity, key] of identitiesOfEntry(entry)) {
        const held = old.units.get(identity)
        if (held?.digest !== undefined && target.get(identity) !== key) {
            out.push({ kind: 'unit', identity, digest: held.digest })
        }
    }
    return out
}

function sameKeyLists(a: readonly Ref[] | undefined, b: readonly Ref[] | undefined): boolean {
    return (a ?? []).length === (b ?? []).length && (a ?? []).every((ref, index) => keyOfRef(ref) === keyOfRef((b ?? [])[index]))
}

function sideOf(config: JsonObject, listName: string, idName: string, list: readonly JsonValue[] | undefined, fields: readonly string[]): SwitchSide {
    const held = config[listName]
    const own: readonly JsonValue[] = Array.isArray(held) ? held : []
    return { list: list ?? own, id: config[idName], working: pickFields(config, fields) }
}

/**
 * Inserts the stub `stub` before the live slot `before` (at the end when `before` is null), addressed by identity at
 * apply time. A `before` that is not live, once replacement by an earlier stub install is followed, inserts nothing and its verify is false, so check A undoes the journal.
 */
export function insertionStep(db: Database, host: FastForwardHost, stub: Slot, before: Slot | null, replacedBy?: ReadonlyMap<Slot, Slot>): Step {
    return {
        apply() {
            const characters = db.characters
            const at = before === null ? characters.length : characters.indexOf(replacedBy?.get(before) ?? before)
            if (at < 0) {
                return () => { }
            }
            host.installQuietly(() => { characters.splice(at, 0, stub) })
            return () => {
                host.installQuietly(() => {
                    const held = characters.indexOf(stub)
                    if (held >= 0) {
                        characters.splice(held, 1)
                    }
                })
            }
        },
        verify: () => db.characters.indexOf(stub) >= 0,
    }
}

/** Checks that the live chaId sequence is the membership target: a misplaced insertion fails check A. */
export function orderVerifyStep(db: Database, target: readonly string[]): Step {
    return {
        apply: () => () => { },
        verify: () => sameJsonValue(db.characters.map(slotChaId), [...target]),
    }
}
// ---- the unit path: a loaded character the peer changed, merged record by record ----

type Wanted = ReadonlyMap<string, Value>

/** Writes `list` into the live array `live` in place: elements that differ are replaced, the length follows. The undo restores the elements by reference. */
function writeArray(live: unknown[], list: readonly JsonValue[]): () => void {
    const before = live.slice()
    for (let index = 0; index < list.length; index++) {
        if (index >= live.length) {
            live.push(structuredClone(list[index]))
        } else if (!sameJsonValue(toPlainJson(live[index]), list[index])) {
            live[index] = structuredClone(list[index])
        }
    }
    if (live.length > list.length) {
        live.splice(list.length)
    }
    return () => {
        live.length = 0
        for (const item of before) {
            live.push(item)
        }
    }
}

/** Writes the keys of `wanted` that differ into `live` (undefined removes a key); `message` is written in place. The undo restores the prior values by reference. */
function writeValues(live: object, wanted: Wanted): () => void {
    const undos: Array<() => void> = []
    for (const [key, value] of wanted) {
        const current: unknown = Reflect.get(live, key)
        if (sameJsonValue(toPlainJson(current), value)) {
            continue
        }
        if (key === 'message' && Array.isArray(current) && Array.isArray(value)) {
            undos.push(writeArray(current, value))
            continue
        }
        const had = Object.hasOwn(live, key)
        const before: unknown = current
        if (value === undefined) {
            Reflect.deleteProperty(live, key)
        } else {
            Reflect.set(live, key, structuredClone(value))
        }
        undos.push(() => {
            if (had) {
                Reflect.set(live, key, before)
            } else {
                Reflect.deleteProperty(live, key)
            }
        })
    }
    return () => {
        for (const undo of undos.reverse()) {
            undo()
        }
    }
}

function valuesMatch(live: object, wanted: Wanted): boolean {
    for (const [key, value] of wanted) {
        if (!sameJsonValue(toPlainJson(Reflect.get(live, key)), value)) {
            return false
        }
    }
    return true
}

function valuesStep(live: object, wanted: Wanted): Step {
    return {
        apply: () => writeValues(live, wanted),
        verify: () => valuesMatch(live, wanted),
    }
}

const CORE_SKIP = new Set<string>(['chats', ...LORE_FIELDS, ...SCRIPT_FIELDS, ...DERIVED_COLD_FIELDS, ...VOLATILE_CHARACTER_FIELDS, 'lastInteraction', 'trashTime', 'chatPage'])
const WHOLE_SKIP = new Set<string>(['chats', ...DERIVED_COLD_FIELDS, ...VOLATILE_CHARACTER_FIELDS, 'lastInteraction', 'trashTime'])

/** The values a taken core writes: its fields and `firstMsgIndex`, and an undefined for each live core field it lacks. */
function coreWanted(slot: Slot, fields: JsonObject, firstMsgIndex: number): Map<string, Value> {
    const wanted = new Map<string, Value>(Object.entries(fields))
    wanted.set('firstMsgIndex', firstMsgIndex)
    for (const key of Object.keys(slot)) {
        if (!CORE_SKIP.has(key) && !wanted.has(key)) {
            wanted.set(key, undefined)
        }
    }
    return wanted
}

function bagWanted(slot: Slot, names: readonly string[], fields: JsonObject | null): Map<string, Value> {
    const wanted = new Map<string, Value>()
    for (const name of names) {
        wanted.set(name, fields !== null && Object.hasOwn(fields, name) ? fields[name] : undefined)
    }
    return wanted
}

function wholeWanted(slot: Slot, assembled: JsonObject): Map<string, Value> {
    const wanted = new Map<string, Value>()
    for (const [key, value] of Object.entries(assembled)) {
        if (!WHOLE_SKIP.has(key)) {
            wanted.set(key, value)
        }
    }
    for (const key of Object.keys(slot)) {
        if (!WHOLE_SKIP.has(key) && !wanted.has(key)) {
            wanted.set(key, undefined)
        }
    }
    return wanted
}

function chatWanted(chat: object, assembled: JsonObject): Map<string, Value> {
    const wanted = new Map<string, Value>(Object.entries(assembled))
    for (const key of Object.keys(chat)) {
        if (!(VOLATILE_CHAT_FIELDS as readonly string[]).includes(key) && !wanted.has(key)) {
            wanted.set(key, undefined)
        }
    }
    return wanted
}

function chatsOf(slot: Slot): unknown[] {
    const chats: unknown = Reflect.get(slot, 'chats')
    return Array.isArray(chats) ? chats : []
}

function chatIdOf(chat: unknown): string | undefined {
    const id: unknown = typeof chat === 'object' && chat !== null ? Reflect.get(chat, 'id') : undefined
    return typeof id === 'string' ? id : undefined
}

/** One place of the merged chat list: the live chat it keeps (taken content written into it) or the chat that is new here. */
interface ChatPlace {
    existing: object | null
    wanted: JsonObject | null
}

/**
 * The chat list of a character after the merge. A surviving chat object keeps its identity (content is written into
 * it); a chat new here is a copy of the peer's; a chat the merge dropped leaves the array. The `chats` array is
 * rearranged in place.
 */
function chatsStep(slot: Slot, places: readonly ChatPlace[]): Step {
    const writes = places.map(place => place.existing !== null && place.wanted !== null ? chatWanted(place.existing, place.wanted) : null)
    const fresh = places.map(place => place.existing === null && place.wanted !== null ? structuredClone(place.wanted) : null)
    return {
        apply() {
            const chats = chatsOf(slot)
            const before = chats.slice()
            const undos: Array<() => void> = []
            places.forEach((place, index) => {
                const wanted = writes[index]
                if (place.existing !== null && wanted !== null) {
                    undos.push(writeValues(place.existing, wanted))
                }
            })
            const ordered = places.map((place, index) => place.existing ?? fresh[index])
            const same = ordered.length === chats.length && ordered.every((chat, index) => chat === chats[index])
            if (!same) {
                chats.length = 0
                for (const chat of ordered) {
                    chats.push(chat)
                }
            }
            return () => {
                chats.length = 0
                for (const chat of before) {
                    chats.push(chat)
                }
                for (const undo of undos.reverse()) {
                    undo()
                }
            }
        },
        verify() {
            const chats = chatsOf(slot)
            return chats.length === places.length && places.every((place, index) => {
                const wanted = writes[index]
                if (place.existing !== null) {
                    return chats[index] === place.existing && (wanted === null || valuesMatch(place.existing, wanted))
                }
                return sameJsonValue(toPlainJson(chats[index]), fresh[index] ?? undefined)
            })
        },
    }
}

/** The units one record of an entry names. */
function unitsOfRecord(entry: ShardEntry, id: string): EntityUnit[] {
    const chatUnits = (chat: ChatEntry): EntityUnit[] => [
        { ref: chat.core, type: UNIT_TYPE.chatCore },
        ...chat.chunks.map((ref): EntityUnit => ({ ref, type: UNIT_TYPE.chatChunk })),
        ...(chat.alt ?? []).map((ref): EntityUnit => ({ ref, type: UNIT_TYPE.chatAlt })),
    ]
    const out: EntityUnit[] = []
    if (id === RECORD_CORE || id === RECORD_WHOLE) {
        out.push({ ref: entry.core, type: UNIT_TYPE.characterCore })
    }
    if ((id === RECORD_LORE || id === RECORD_WHOLE) && entry.lore !== null) {
        out.push({ ref: entry.lore, type: UNIT_TYPE.lore })
    }
    if ((id === RECORD_SCRIPTS || id === RECORD_WHOLE) && entry.scripts !== null) {
        out.push({ ref: entry.scripts, type: UNIT_TYPE.scripts })
    }
    if (id === RECORD_WHOLE) {
        entry.chats.forEach(chat => out.push(...chatUnits(chat)))
    } else if (id.startsWith('chat:')) {
        const chat = entry.chats.find(candidate => chatRecordId(candidate.cid) === id)
        if (chat !== undefined) {
            out.push(...chatUnits(chat))
        }
    }
    return out
}

/** Whether the core unit holds an absent list or a moved field in `f`, so the entry alone cannot describe the character. */
function coreSplit(source: { get(key: string): Uint8Array | undefined }, ref: Ref): boolean {
    const bytes = checkedBytes(source, ref)
    if (bytes === undefined) {
        return false
    }
    const parsed = readUnit(bytes, UNIT_TYPE.characterCore)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        return false
    }
    const body = parsed.value.body as { f?: object, a?: readonly unknown[] }
    return (body.a?.length ?? 0) > 0 || Object.keys(body.f ?? {}).some(name => (ENTRY_MOVED_FIELDS as readonly string[]).includes(name))
}

function digestsOf(units: ReadonlyMap<string, { key: string, digest?: string }>): Map<string, string> {
    const out = new Map<string, string>()
    for (const unit of units.values()) {
        if (unit.digest !== undefined) {
            out.set(unit.key, unit.digest)
        }
    }
    return out
}

/** The record an entity unit belongs to, by its identity; null for the asset and inlay lists. */
function recordOfIdentity(identity: string, u: string): string | null {
    const own = `char:${u}:`
    if (identity.startsWith(own)) {
        const part = identity.slice(own.length)
        return part === 'core' ? RECORD_CORE : part === 'lore' ? RECORD_LORE : part === 'scripts' ? RECORD_SCRIPTS : null
    }
    const chat = `chat:${u}:`
    if (identity.startsWith(chat)) {
        const match = /^(.*):(core|chunk:\d+|alt:\d+)$/.exec(identity.slice(chat.length))
        return match === null ? null : chatRecordId(match[1])
    }
    return null
}

function sameTokenList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

interface UnitContext {
    db: Database
    old: PreviousEncoding
    next: PreviousEncoding
    target: StoredTree
    host: FastForwardHost
    env: KeyEnv
    lists: ListDerivation
    fresh: (slot: Slot, options: VerdictOptions) => FreshEntry | 'unknown'
    replyOwners: ReadonlySet<string>
    writing: WritingSet
    baseDigests: Map<string, string>
    theirsDigests: Map<string, string>
    collect: boolean
    answers: ConflictAnswers | undefined
    newId: () => string
}

type UnitResult =
    | { kind: 'park', reason: string }
    | { kind: 'need', units: EntityUnit[] }
    | { kind: 'wait', waits: WaitOn }
    | { kind: 'conflict', conflicts: ConflictRecord[] }
    | { kind: 'ok', steps: Step[], guard: GuardEntry[], oracle: Array<() => boolean>, defers: DeferClass[], marked: boolean, restore: boolean }

/** The fingerprint of a whole character: every record's content, by id. */
function entryFingerprint(entry: ShardEntry, digestOf: ((key: string) => string | undefined) | undefined, splitCore: boolean): string {
    const refs = recordRefs(entry, { splitCore })
    return valueFingerprint([...refs].map(([id, tokens]) => [id, fingerprintOf(tokens, digestOf)]))
}

/** A conflict row of a delete: two choices, and the edited version preselected (the person never loses an edit by pressing Apply). */
function deleteRow(input: { id: string, label: ConflictRecord['label'], row: 'deletedThere' | 'deletedHere', fingerprint: ConflictRecord['fingerprint'], legacy: string }): ConflictRecord {
    return {
        id: input.id, label: input.label, choices: ['mine', 'theirs'], keepBoth: null,
        preselect: input.row === 'deletedThere' ? 'mine' : 'theirs', fingerprint: input.fingerprint, legacy: input.legacy,
    }
}

/**
 * A loaded character the peer changed. Each record (core, lore, scripts, chat, chat list, view) is decided from
 * what this page changed against the acknowledged encoding and what the peer changed; taken content is written into
 * the live objects, which keep their identity. A record both sides changed differently is a conflict and parks.
 */
function unitPath(ctx: UnitContext, slot: Slot, baseEntry: ShardEntry, theirsEntry: ShardEntry, mineMoved: MovedFields, replyOwner: boolean): UnitResult {
    const chaId = slotChaId(slot)
    const where = `character ${theirsEntry.u}`
    const mine = ctx.fresh(slot, { env: ctx.env, lists: ctx.lists, previous: ctx.old })
    if (mine === 'unknown') {
        return { kind: 'park', reason: 'character:unknown' }
    }
    const theirsSplit = coreSplit(ctx.target.source, theirsEntry.core)
    const baseSide: RecordSide = { entry: baseEntry, digestOf: key => ctx.baseDigests.get(key) }
    const mineSide: RecordSide = { entry: mine.entry, splitCore: mine.splitCore, digestOf: key => mine.digests.get(key) ?? ctx.baseDigests.get(key) }
    const theirsSide: RecordSide = { entry: theirsEntry, splitCore: theirsSplit, digestOf: key => ctx.theirsDigests.get(key) }
    const records = classifyCharacterRecords({ base: baseSide, mine: mineSide, theirs: theirsSide })
    const whole = records.whole

    // The units the decision reads: every unit of a record the peer changed, and the lists the peer's entry changed.
    const need: EntityUnit[] = []
    for (const id of records.theirsChanged) {
        need.push(...unitsOfRecord(theirsEntry, id))
    }
    if (keyOfRef(theirsEntry.al) !== keyOfRef(baseEntry.al)) {
        need.push({ ref: theirsEntry.al, type: UNIT_TYPE.assetList })
    }
    if (theirsEntry.il !== null && (baseEntry.il === null || keyOfRef(theirsEntry.il) !== keyOfRef(baseEntry.il))) {
        need.push({ ref: theirsEntry.il, type: UNIT_TYPE.inlayList })
    }
    const missing = need.filter(unit => checkedBytes(ctx.target.source, unit.ref) === undefined)
    if (missing.length > 0) {
        return { kind: 'need', units: missing }
    }

    // The wait rule: a record the peer changed that a send writes waits for the send, whatever it was decided to be.
    const sending = ctx.writing.chars.has(chaId) || ctx.replyOwners.has(chaId)
    const waits: WaitOn = { chars: [], chats: [] }
    for (const id of records.theirsChanged) {
        if (id.startsWith('chat:') && ctx.writing.chats.get(chaId)?.has(id.slice('chat:'.length)) === true) {
            waits.chats.push([chaId, id.slice('chat:'.length)])
        } else if (sending && (id === RECORD_CORE || id === RECORD_LORE || id === RECORD_SCRIPTS || id === RECORD_WHOLE)) {
            waits.chars.push(chaId)
        }
    }
    if (waits.chars.length > 0 || waits.chats.length > 0) {
        return { kind: 'wait', waits }
    }
    // Every record both sides changed is a row; an answer whose fingerprints still match settles it.
    const mineRefs = recordRefs(mine.entry, { whole })
    const theirsRefs = recordRefs(theirsEntry, { whole })
    const characterName = String(Reflect.get(slot, 'name') ?? '')
    const chatNameOf = (cid: string): string => {
        const live = chatsOf(slot).find(chat => chatIdOf(chat) === cid)
        const liveName: unknown = typeof live === 'object' && live !== null ? Reflect.get(live, 'name') : undefined
        if (typeof liveName === 'string') {
            return liveName
        }
        const chatEntry = theirsEntry.chats.find(candidate => candidate.cid === cid)
        const assembled = chatEntry === undefined ? null : assembleChatEntry(chatEntry, ctx.target.source, `${where} chat ${cid}`)
        return isJsonObject(assembled) && typeof assembled.name === 'string' ? assembled.name : cid
    }
    const recordOf = (decision: Extract<RecordDecision, { kind: 'conflict' }>): ConflictRecord => {
        const isChat = decision.id.startsWith('chat:')
        const fingerprint = {
            mine: fingerprintOf(mineRefs.get(decision.id), mineSide.digestOf),
            theirs: fingerprintOf(theirsRefs.get(decision.id), theirsSide.digestOf),
        }
        const legacy = `conflict:char:${chaId}:${decision.id}`
        if (isChat && decision.conflict !== 'both') {
            const cid = decision.id.slice('chat:'.length)
            return deleteRow({
                id: `char:${chaId}:${decision.id}:${decision.conflict}`, row: decision.conflict, fingerprint, legacy,
                label: { kind: decision.conflict === 'deletedThere' ? 'chatDeletedThere' : 'chatDeletedHere', character: characterName, chat: chatNameOf(cid) },
            })
        }
        return {
            id: `char:${chaId}:${decision.id}`,
            label: isChat
                ? { kind: 'chat', character: characterName, chat: chatNameOf(decision.id.slice('chat:'.length)) }
                : { kind: decision.id === RECORD_LORE ? 'lore' : decision.id === RECORD_SCRIPTS ? 'scripts' : decision.id === RECORD_WHOLE ? 'whole' : 'core', character: characterName },
            choices: ['mine', 'theirs', 'both'], keepBoth: isChat ? 'copy' : 'restore-point', preselect: 'both', fingerprint, legacy,
        }
    }
    const resolved = new Map<string, ConflictChoice>()
    const asked: ConflictRecord[] = []
    for (const decision of records.decisions) {
        if (decision.kind !== 'conflict') {
            continue
        }
        const record = recordOf(decision)
        if (!ctx.collect) {
            return { kind: 'park', reason: record.legacy }
        }
        const choice = answerFor(ctx.answers, record)
        if (choice === undefined) {
            asked.push(record)
        } else {
            resolved.set(decision.id, choice)
        }
    }
    if (asked.length > 0) {
        return { kind: 'conflict', conflicts: asked }
    }

    const steps: Step[] = []
    const defers: DeferClass[] = ['d2']
    const taken = new Map<string, true>()
    // Chats an answer keeps in the list (a removed chat that the edited side keeps), and chats whose version here becomes a copy.
    const keepCids = new Set<string>()
    const copies: string[] = []
    let restore = false
    for (const decision of records.decisions) {
        if (decision.kind === 'take') {
            taken.set(decision.id, true)
            continue
        }
        if (decision.kind !== 'conflict') {
            continue
        }
        const choice = resolved.get(decision.id)
        const isChat = decision.id.startsWith('chat:')
        const cid = decision.id.slice('chat:'.length)
        if (decision.conflict === 'deletedThere' && isChat) {
            if (choice === 'mine') {
                keepCids.add(cid)
            } else {
                taken.set(decision.id, true)
            }
        } else if (decision.conflict === 'deletedHere' && isChat) {
            if (choice === 'theirs') {
                keepCids.add(cid)
                taken.set(decision.id, true)
            }
        } else if (choice === 'theirs' || (choice === 'both' && isChat)) {
            taken.set(decision.id, true)
        }
        if (choice === 'both') {
            if (isChat) {
                copies.push(cid)
            } else {
                restore = true
            }
        }
    }
    const baseCids = baseEntry.chats.map(chat => chat.cid)
    const mineCids = mine.entry.chats.map(chat => chat.cid)
    const theirsCids = theirsEntry.chats.map(chat => chat.cid)
    let final: string[] = mineCids

    if (whole) {
        if (taken.has(RECORD_WHOLE)) {
            const assembled = assembleCharacter(theirsEntry, ctx.target.source)
            steps.push(valuesStep(slot, wholeWanted(slot, assembled)))
            const chatJson = Array.isArray(assembled.chats) ? assembled.chats : []
            const live = chatsOf(slot)
            steps.push(chatsStep(slot, chatJson.map((chat, index): ChatPlace => {
                const existing: unknown = live[index]
                return { existing: typeof existing === 'object' && existing !== null ? existing : null, wanted: isJsonObject(chat) ? chat : null }
            })))
            steps.push(movedStep(slot, 'chatPage', theirsEntry.chatPage))
        }
    } else {
        if (taken.has(RECORD_CORE)) {
            const body = readCheckedUnit(ctx.target.source, theirsEntry.core, UNIT_TYPE.characterCore, `${where} core`) as ContentBody
            steps.push(valuesStep(slot, coreWanted(slot, readObjectField(body, 'f', `${where} core`), theirsEntry.firstMsgIndex)))
        }
        if (taken.has(RECORD_LORE)) {
            const fields = theirsEntry.lore === null ? null
                : readObjectField(readCheckedUnit(ctx.target.source, theirsEntry.lore, UNIT_TYPE.lore, `${where} lore`) as ContentBody, 'f', `${where} lore`)
            steps.push(valuesStep(slot, bagWanted(slot, LORE_FIELDS, fields)))
        }
        if (taken.has(RECORD_SCRIPTS)) {
            const fields = theirsEntry.scripts === null ? null
                : readObjectField(readCheckedUnit(ctx.target.source, theirsEntry.scripts, UNIT_TYPE.scripts, `${where} scripts`) as ContentBody, 'f', `${where} scripts`)
            steps.push(valuesStep(slot, bagWanted(slot, SCRIPT_FIELDS, fields)))
        }
        const chatTaken = [...taken.keys()].some(id => id.startsWith('chat:'))
        if (chatTaken || records.theirsChanged.has(RECORD_CHAT_LIST) || keepCids.size > 0 || copies.length > 0) {
            final = mergeChatList({ base: baseCids, mine: mineCids, theirs: theirsCids, keep: keepCids })
            const live = chatsOf(slot)
            const places = final.map((cid): ChatPlace => {
                const existing = live.find(chat => chatIdOf(chat) === cid)
                const chatEntry = theirsEntry.chats.find(candidate => candidate.cid === cid)
                const take = taken.has(chatRecordId(cid)) || existing === undefined
                const wanted = take && chatEntry !== undefined ? assembleChatEntry(chatEntry, ctx.target.source, `${where} chat ${cid}`) : null
                return { existing: typeof existing === 'object' && existing !== null ? existing : null, wanted: isJsonObject(wanted) ? wanted : null }
            })
            // Keep both: this page's version of each chat becomes a copy at the top of the owner's list; the original id holds the peer's.
            const names = new Set<string>(places.map((place) => {
                const name: unknown = place.wanted !== null ? place.wanted.name : place.existing !== null ? Reflect.get(place.existing, 'name') : undefined
                return typeof name === 'string' ? name : ''
            }))
            const copyPlaces: ChatPlace[] = []
            for (const cid of copies) {
                const original = toPlainJson(live.find(chat => chatIdOf(chat) === cid))
                if (!isJsonObject(original)) {
                    return { kind: 'park', reason: `conflict:char:${chaId}:chat:${cid}` }
                }
                const copy = makeChatCopy(original, names, ctx.newId())
                names.add(String(copy.name))
                copyPlaces.push({ existing: null, wanted: copy })
            }
            steps.push(chatsStep(slot, [...copyPlaces, ...places]))
            final = [...copyPlaces.map(place => String(place.wanted?.id)), ...final]
        }
        if (records.theirsChanged.has(RECORD_CHAT_LIST) || records.theirsChanged.has(RECORD_VIEW) || copies.length > 0 || keepCids.size > 0) {
            const view = decideView({
                baseList: baseCids, mineList: mineCids, theirsList: theirsCids,
                base: baseEntry.chatPage, mine: mine.entry.chatPage, theirs: theirsEntry.chatPage, final, replyOwner,
            })
            if (view.defer) {
                defers.push('d1')
            }
            if (view.chatPage !== mine.entry.chatPage) {
                steps.push(movedStep(slot, 'chatPage', view.chatPage))
            }
        }
    }

    // The moved fields that follow their own rule: the larger `lastInteraction`, the three-way `trashTime` (a trash against an edit merges).
    const moved = classifyMovedFields(movedFieldsOf(baseEntry), mineMoved, movedFieldsOf(theirsEntry), { inUse: false, replyOwner })
    for (const name of ['lastInteraction', 'trashTime'] as const) {
        const decision = moved[name]
        if (decision.kind === 'take' || decision.kind === 'merge') {
            steps.push(movedStep(slot, name, decision.value))
        }
    }

    // Guard entries: only the units of the records taken from the peer.
    const guard: GuardEntry[] = []
    const theirsIdentities = identitiesOfEntry(theirsEntry)
    for (const [identity, key] of identitiesOfEntry(baseEntry)) {
        const record = recordOfIdentity(identity, baseEntry.u)
        const held = ctx.old.units.get(identity)
        if (record !== null && held?.digest !== undefined && theirsIdentities.get(identity) !== key && (taken.has(whole ? RECORD_WHOLE : record))) {
            guard.push({ kind: 'unit', identity, digest: held.digest })
        }
    }

    // The oracle: a fresh encode of the live character over the peer's tree names the peer's units for every taken record.
    // A kept chat or a keep-both copy makes the list differ from the peer's on purpose, so the list is not compared then.
    const listDiffers = keepCids.size > 0 || copies.length > 0
    const checked = [...taken.keys()].filter(id => id !== RECORD_VIEW && !(listDiffers && id === RECORD_CHAT_LIST))
    const oracle = [(): boolean => {
        const after = ctx.fresh(slot, { env: ctx.env, lists: ctx.lists, previous: ctx.next })
        if (after === 'unknown') {
            return false
        }
        const got = recordRefs(after.entry, { whole })
        const want = recordRefs(theirsEntry, { whole })
        return checked.every(id => sameTokenList(got.get(id), want.get(id)))
    }]

    // Marked: a record kept from this page, and the owner of a keep-both copy, must be written by the next pass.
    const unresolved = changedRecords(recordRefs(baseEntry, { whole }), recordRefs(mine.entry, { whole })).size > 0
    return { kind: 'ok', steps, guard, oracle, defers, marked: unresolved || copies.length > 0, restore }
}

const UNIT_PATH_REASONS: readonly string[] = ['in-use', 'body-dirty', 'resident-id', 'unsaved-view', 'trash-in-use']

export function prepareFastForward(input: PrepareInput): Prepared {
    const { db, old, target, next, host } = input
    const baseObjects = old.objects
    const nextObjects = next.objects
    const baseConfig = baseObjects?.config
    const theirsConfig = nextObjects?.config
    if (baseObjects === undefined || nextObjects === undefined || baseConfig === undefined || theirsConfig === undefined
        || baseObjects.manifest === undefined || nextObjects.manifest === undefined) {
        return { kind: 'park', reason: 'no-base' }
    }
    const steps: Step[] = []
    const guard: GuardEntry[] = []
    const defers = new Set<DeferClass>()
    const needDefer = (wanted: DeferClass): void => {
        defers.add(wanted)
    }
    const parked = (reason: string): Prepared => ({ kind: 'park', reason })
    const mineConfig = configFields(db)
    const digestCache: { base?: Map<string, string>, theirs?: Map<string, string> } = {}
    const baseDigests = (): Map<string, string> => digestCache.base ??= digestsOf(old.units)
    const theirsDigests = (): Map<string, string> => digestCache.theirs ??= digestsOf(next.units)

    // Config, outside the two switchable records.
    const recordFields = new Set<string>([
        ...PRESET_RECORD_FIELDS, 'botPresetsId', 'personas', 'selectedPersona', ...PERSONA_RECORD_FIELDS,
    ])
    const config = classifyConfig(baseConfig, mineConfig, theirsConfig, recordFields)
    const collect = input.collect === true
    const conflicts: ConflictRecord[] = []
    /** Set when an answer keeps both versions of a record that is not a chat: the peer's tree enters `retained`. */
    let restorePoint = false
    /** A conflict row: the answer that still matches, a park where the page cannot ask, or the row that asks. */
    const settle = (record: ConflictRecord): { kind: 'park' } | { kind: 'asked' } | { kind: 'answered', choice: ConflictChoice } => {
        if (!collect) {
            return { kind: 'park' }
        }
        const choice = answerFor(input.answers, record)
        if (choice === undefined) {
            conflicts.push(record)
            return { kind: 'asked' }
        }
        return { kind: 'answered', choice }
    }
    const takeField = (name: string, value: Value): void => {
        steps.push(fieldStep(db, name, value))
        guard.push({ kind: 'field', path: name, before: Object.hasOwn(baseConfig, name) ? baseConfig[name] : undefined, expected: value })
    }
    for (const name of config.park) {
        const mineValue = Object.hasOwn(mineConfig, name) ? mineConfig[name] : undefined
        const theirsValue = Object.hasOwn(theirsConfig, name) ? theirsConfig[name] : undefined
        const record: ConflictRecord = {
            id: `config:${name}`, label: { kind: 'setting', name }, choices: ['mine', 'theirs', 'both'], keepBoth: 'restore-point', preselect: 'both',
            fingerprint: { mine: valueFingerprint(mineValue), theirs: valueFingerprint(theirsValue) }, legacy: `config:${name}`,
        }
        const verdict = settle(record)
        if (verdict.kind === 'park') {
            return parked(record.legacy)
        }
        if (verdict.kind === 'answered') {
            if (verdict.choice === 'theirs') {
                takeField(name, theirsValue)
            } else if (verdict.choice === 'both') {
                restorePoint = true
            }
        }
    }
    for (const [name, value] of config.take) {
        takeField(name, value)
    }

    // The two switchable records, each decided whole.
    const records: Array<{ ops: SwitchOps, list: string, id: string, fields: readonly string[], baseList: readonly JsonValue[] | undefined, theirsList: readonly JsonValue[] | undefined, unitIdentities: boolean }> = [
        {
            ops: host.presetOps(), list: 'botPresets', id: 'botPresetsId', fields: PRESET_RECORD_FIELDS,
            baseList: baseObjects.presets, theirsList: nextObjects.presets, unitIdentities: true,
        },
        { ops: PERSONA_OPS, list: 'personas', id: 'selectedPersona', fields: PERSONA_RECORD_FIELDS, baseList: undefined, theirsList: undefined, unitIdentities: false },
    ]
    for (const record of records) {
        const names = [record.id, ...record.fields, ...(record.unitIdentities ? [] : [record.list])]
        const sideFields = record.unitIdentities ? record.fields : PERSONA_RECORD_FIELDS
        const base = sideOf(baseConfig, record.list, record.id, record.baseList, sideFields)
        const theirs = sideOf(theirsConfig, record.list, record.id, record.theirsList, sideFields)
        const presetKeysChanged = record.unitIdentities && !sameKeyLists(baseObjects.manifest.fixed.presets, nextObjects.manifest.fixed.presets)
        const changed = presetKeysChanged || !sameJsonValue(base.id, theirs.id) || !sameJsonValue(base.working, theirs.working)
            || (!record.unitIdentities && !sameJsonValue(base.list, theirs.list))
        if (!changed) {
            continue
        }
        if (record.unitIdentities && (record.baseList === undefined || record.theirsList === undefined)) {
            return parked('no-base-presets')
        }
        const mineList = record.unitIdentities
            ? (Array.isArray(db.botPresets) ? db.botPresets.map(item => toPlainJson(item) ?? null) : [])
            : sideOf(mineConfig, record.list, record.id, undefined, sideFields).list
        const mine: SwitchSide = { list: mineList, id: mineConfig[record.id], working: pickFields(mineConfig, sideFields) }
        const decision = decideSwitch(base, mine, theirs, record.ops)
        let value: SwitchSide
        if (decision.kind === 'park') {
            const rowId = record.unitIdentities ? 'presets' : 'personas'
            const row: ConflictRecord = {
                id: rowId, label: { kind: rowId }, choices: ['mine', 'theirs', 'both'], keepBoth: 'restore-point', preselect: 'both',
                fingerprint: {
                    mine: valueFingerprint({ list: [...mine.list], id: mine.id ?? null, working: mine.working }),
                    theirs: valueFingerprint({ list: [...theirs.list], id: theirs.id ?? null, working: theirs.working }),
                },
                legacy: `${record.list}:${decision.reason}`,
            }
            const verdict = settle(row)
            if (verdict.kind === 'park') {
                return parked(row.legacy)
            }
            if (verdict.kind === 'asked') {
                continue
            }
            if (verdict.choice === 'both') {
                restorePoint = true
            }
            if (verdict.choice !== 'theirs') {
                continue
            }
            value = theirs
        } else if (decision.kind === 'take') {
            value = decision.value
        } else {
            continue
        }
        needDefer('d1')
        steps.push(fieldStep(db, record.list, [...value.list]))
        steps.push(fieldStep(db, record.id, value.id))
        for (const name of sideFields) {
            steps.push(fieldStep(db, name, Object.hasOwn(value.working, name) ? value.working[name] : undefined))
        }
        for (const name of names) {
            const before = Object.hasOwn(baseConfig, name) ? baseConfig[name] : undefined
            const expected = Object.hasOwn(theirsConfig, name) ? theirsConfig[name] : undefined
            if (!sameJsonValue(before, expected)) {
                guard.push({ kind: 'field', path: name, before, expected })
            }
        }
        if (record.unitIdentities) {
            nextObjects.manifest.fixed.presets.forEach((ref, index) => {
                const held = old.units.get(`preset:${index}`)
                if (held?.digest !== undefined && held.key !== keyOfRef(ref)) {
                    guard.push({ kind: 'unit', identity: `preset:${index}`, digest: held.digest })
                }
            })
        }
    }

    // Task presets are not taken.
    if (!sameKeyLists(baseObjects.manifest.fixed.taskPresets, nextObjects.manifest.fixed.taskPresets)) {
        return parked('task-presets')
    }

    // Statics, by key.
    if (old.units.get('statics')?.key !== next.units.get('statics')?.key) {
        const decision = mergeStatics(baseObjects.statics?.value, liveField(db, 'statics'), nextObjects.statics?.value)
        if (decision.kind === 'park') {
            return parked(decision.reason)
        }
        if (decision.kind === 'take' || decision.kind === 'merge') {
            steps.push(fieldStep(db, 'statics', decision.value))
            const held = old.units.get('statics')
            if (decision.kind === 'take' && held?.digest !== undefined) {
                guard.push({ kind: 'unit', identity: 'statics', digest: held.digest })
            }
        }
    }

    // Loadouts, whole.
    if (old.units.get('loadouts')?.key !== next.units.get('loadouts')?.key) {
        const bytes = checkedBytes(target.source, target.manifest.fixed.loadouts)
        const parsed = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.loadouts)
        const items = parsed !== null && (parsed.status === 'ok' || parsed.status === 'stale') ? (parsed.value.body as ContentBody).items : undefined
        const mineItems = (Array.isArray(db.loadouts) ? db.loadouts : []).map(item => toPlainJson(item) ?? null)
        const heldDigest = old.units.get('loadouts')?.digest
        if (!Array.isArray(items) || heldDigest === undefined) {
            return parked('loadouts')
        }
        let takeLoadouts = true
        if (unitDigest(encodeUnit(UNIT_TYPE.loadouts, { v: 1, items: mineItems })) !== heldDigest) {
            const row: ConflictRecord = {
                id: 'loadouts', label: { kind: 'loadouts' }, choices: ['mine', 'theirs', 'both'], keepBoth: 'restore-point', preselect: 'both',
                fingerprint: { mine: valueFingerprint(mineItems), theirs: valueFingerprint(items) }, legacy: 'loadouts',
            }
            const verdict = settle(row)
            if (verdict.kind === 'park') {
                return parked(row.legacy)
            }
            takeLoadouts = verdict.kind === 'answered' && verdict.choice === 'theirs'
            if (verdict.kind === 'answered' && verdict.choice === 'both') {
                restorePoint = true
            }
        }
        if (takeLoadouts) {
            steps.push(fieldStep(db, 'loadouts', items))
            guard.push({ kind: 'unit', identity: 'loadouts', digest: heldDigest })
        }
    }
    // The order: characterOrder by its own rule, membership in its domain.
    const baseEntries = entriesOf(old)
    const theirsEntries = entriesOf(next)
    const baseOrder = baseObjects.order
    const theirsOrder = nextObjects.order
    const order = classifyCharacterOrder(baseOrder.characterOrder, liveField(db, 'characterOrder'), theirsOrder.characterOrder)
    if (order.kind === 'park') {
        return parked('character-order')
    }
    // The order value after the decision: a kept character that the order names nowhere is appended below (`completeOrder`).
    let orderValue: Value = order.kind === 'take' || order.kind === 'merge' ? order.value : liveField(db, 'characterOrder')
    let orderWritten = order.kind === 'take' || order.kind === 'merge'
    const keptCharacters: KeptCharacter[] = []
    const baseMembers = membersOf(baseOrder, baseEntries)
    const theirsMembers = membersOf(theirsOrder, theirsEntries)
    if (baseMembers === null || theirsMembers === null) {
        return parked('order')
    }
    const slots: Slot[] = Array.isArray(db.characters) ? db.characters : []
    const seen = new Map<string, number>()
    const mineMembers: Member[] = slots.map((slot) => {
        const chaId = slotChaId(slot)
        const occurrence = seen.get(chaId) ?? 0
        seen.set(chaId, occurrence + 1)
        return { chaId, u: old.entities.get(`${chaId}#${occurrence}`) ?? '' }
    })
    // The residency id test applies whether or not archiving is on: a stub stands for an id only when the id is usable and unshared.
    const residentU = residentSetOf({ entries: [...theirsEntries.values()], config: { ...theirsConfig, archiveCharacters: true }, plugins: [] })
    const residentChaIds = new Set([...theirsEntries.values()].filter(entry => residentU.has(entry.u)).map(entry => entry.chaId))
    // A removed character's residency is that of its own acknowledged entry, which the peer's entries no longer hold.
    const residentBase = residentSetOf({ entries: [...baseEntries.values()], config: { ...baseConfig, archiveCharacters: true }, plugins: [] })
    const fresh = input.fresh ?? freshEntry
    const writing = host.writingTargets()
    const waits: WaitOn = { chars: [], chats: [] }
    const sendingSet = (chaId: string): boolean => writing.chars.has(chaId) || input.replyOwners.has(chaId)
    const membershipSteps: Step[] = []
    const removedSlots = new Set<Slot>()
    const replacedBy = new Map<Slot, Slot>()
    const oracle: Array<() => boolean> = []
    const needUnits: EntityUnit[] = []
    const marked: string[] = []
    /** The characters this page removed whose peer-side change a row already decided (collect mode). */
    const handledHere = new Set<string>()
    let ordered: string[] | null = null
    const inDomain = membershipInDomain(baseMembers, mineMembers, theirsMembers)
    if (!inDomain) {
        const membership = classifyMembership(baseMembers, mineMembers, theirsMembers, chaId => residentChaIds.has(chaId))
        if (membership.kind === 'park') {
            return parked(`membership:${membership.reason}`)
        }
        if (membership.kind === 'append') {
            needDefer('d2')
            for (const member of membership.members) {
                const entry = theirsEntries.get(member.u)
                if (entry === undefined) {
                    return parked('membership:no-entry')
                }
                const stub = stubFromEntry(entry)
                steps.push({
                    apply() {
                        const characters = db.characters
                        host.installQuietly(() => {
                            if (isSlotObject(stub)) {
                                characters.push(stub)
                            }
                        })
                        const index = characters.length - 1
                        return () => { host.installQuietly(() => { characters.splice(index, 1) }) }
                    },
                    verify: () => isColdStub(db.characters[db.characters.length - 1]) && Reflect.get(db.characters[db.characters.length - 1], 'coldstorage') === entry.u,
                })
            }
        }
    } else {
        const membership = mergeMembership(baseMembers, mineMembers, theirsMembers, chaId => residentChaIds.has(chaId))
        if (membership.kind === 'park') {
            return parked(`membership:${membership.reason}`)
        }
        // The characters an answer keeps in the list: a character the peer removed that this page edited (keep mine), and one
        // this page removed that the peer edited (keep theirs).
        const keep = new Set<string>()
        const removals: Slot[] = []
        if (collect) {
            // A character this page removed and the peer changed: a row when the peer edited it, else the deletion stands.
            for (const [u, theirsEntry] of theirsEntries) {
                const baseEntry = baseEntries.get(u)
                if (baseEntry === undefined || sameJsonValue(baseEntry, theirsEntry) || mineMembers.some(member => member.u === u)) {
                    continue
                }
                handledHere.add(u)
                const row = decideDeleteRow({
                    side: 'here', inDomain: true, resident: residentBase.has(u),
                    edited: editedThereForDelete({ entry: baseEntry }, { entry: theirsEntry }) ? 'edited' : 'unedited',
                })
                if (row.kind === 'park') {
                    return parked(row.reason)
                }
                if (row.kind !== 'row') {
                    continue
                }
                const verdict = settle(deleteRow({
                    id: `char:${baseEntry.chaId}:deletedHere`, row: 'deletedHere', legacy: `conflict:char:${baseEntry.chaId}:deletedHere`,
                    label: { kind: 'deletedHere', character: baseEntry.name },
                    fingerprint: { mine: 'absent', theirs: entryFingerprint(theirsEntry, key => theirsDigests().get(key), false) },
                }))
                if (verdict.kind === 'answered' && verdict.choice === 'theirs') {
                    keep.add(baseEntry.chaId)
                    keptCharacters.push({ chaId: baseEntry.chaId, trashed: theirsEntry.trashTime !== undefined })
                }
            }
        }
        if (membership.kind === 'change') {
            needDefer('d2')
            const initial = new Set(membershipTarget({ base: baseMembers.map(member => member.chaId), live: mineMembers.map(member => member.chaId), theirs: theirsMembers.map(member => member.chaId) }))
            for (const [index, member] of mineMembers.entries()) {
                if (initial.has(member.chaId)) {
                    continue
                }
                const slot = slots[index]
                const baseEntry = baseEntries.get(member.u)
                if (baseEntry === undefined) {
                    return parked('membership:no-entry')
                }
                if (sendingSet(member.chaId)) {
                    waits.chars.push(member.chaId)
                    continue
                }
                const stub = isColdStub(slot)
                const liveTrashTime = liveMoved(slot).trashTime
                let edited
                if (stub) {
                    edited = editedForDelete({ slot: 'stub', stubMatches: stubMatchesEntry(slot, baseEntry), baseTrashTime: baseEntry.trashTime, liveTrashTime })
                } else {
                    const here = fresh(slot, { env: input.env, lists: input.lists, previous: old })
                    edited = editedForDelete({ slot: 'loaded', base: { entry: baseEntry }, mine: here === 'unknown' ? null : { entry: here.entry, splitCore: here.splitCore }, liveTrashTime })
                }
                const row = decideDeleteRow({ side: 'there', inDomain: true, resident: residentBase.has(member.u), stub, edited })
                if (row.kind === 'park') {
                    return parked(`membership:${row.reason}`)
                }
                if (row.kind === 'row') {
                    const here = fresh(slot, { env: input.env, lists: input.lists, previous: old })
                    const verdict = settle(deleteRow({
                        id: `char:${member.chaId}:deletedThere`, row: 'deletedThere', legacy: `conflict:char:${member.chaId}:deletedThere`,
                        label: { kind: 'deletedThere', character: String(Reflect.get(slot, 'name') ?? '') },
                        fingerprint: {
                            mine: here === 'unknown' ? 'unknown' : entryFingerprint(here.entry, key => here.digests.get(key) ?? baseDigests().get(key), here.splitCore),
                            theirs: 'absent',
                        },
                    }))
                    if (verdict.kind === 'park') {
                        return parked(`conflict:char:${member.chaId}:deletedThere`)
                    }
                    if (verdict.kind === 'asked') {
                        continue
                    }
                    if (verdict.choice !== 'theirs') {
                        keep.add(member.chaId)
                        keptCharacters.push({ chaId: member.chaId, trashed: liveTrashTime !== undefined })
                        marked.push(member.chaId)
                        continue
                    }
                }
                removals.push(slot)
            }
        }
        if (membership.kind === 'change' || keep.size > 0) {
            needDefer('d2')
            const target = membershipTarget({
                base: baseMembers.map(member => member.chaId), live: mineMembers.map(member => member.chaId), theirs: theirsMembers.map(member => member.chaId), keep,
            })
            ordered = target
            const inTarget = new Set(target)
            const remaining = mineMembers.map(member => member.chaId).filter(chaId => inTarget.has(chaId))
            for (const slot of [...removals].reverse()) {
                removedSlots.add(slot)
                membershipSteps.push({
                    apply() {
                        const characters = db.characters
                        const at = characters.indexOf(slot)
                        if (at < 0) {
                            return () => { }
                        }
                        host.installQuietly(() => { characters.splice(at, 1) })
                        return () => { host.installQuietly(() => { characters.splice(at, 0, slot) }) }
                    },
                    verify: () => db.characters.indexOf(slot) < 0,
                    after: () => host.forgetLoaded(slot),
                })
            }
            const stubs = new Map<string, Slot>()
            for (const placement of placeInsertions(remaining, target)) {
                const member = theirsMembers.find(candidate => candidate.chaId === placement.chaId)
                const entry = member === undefined ? undefined : theirsEntries.get(member.u)
                if (entry === undefined) {
                    return parked('membership:no-entry')
                }
                const stub = stubFromEntry(entry)
                if (!isSlotObject(stub)) {
                    return parked('membership:no-entry')
                }
                stubs.set(placement.chaId, stub)
                const beforeSlot = placement.before === null ? null : stubs.get(placement.before) ?? (slots.find((_, at) => mineMembers[at].chaId === placement.before) ?? null)
                membershipSteps.push(insertionStep(db, host, stub, beforeSlot, replacedBy))
            }
            membershipSteps.push(orderVerifyStep(db, target))
        }
    }

    // The characters the peer changed.
    const heldBy = new Map<string, number>()
    for (const entry of baseEntries.values()) {
        heldBy.set(entry.chaId, (heldBy.get(entry.chaId) ?? 0) + 1)
    }
    const inUseSet = host.inUse()
    for (const [u, theirsEntry] of theirsEntries) {
        const baseEntry = baseEntries.get(u)
        if (baseEntry === undefined || sameJsonValue(baseEntry, theirsEntry)) {
            continue
        }
        const index = mineMembers.findIndex(member => member.u === u)
        if (index < 0) {
            if (!inDomain) {
                return parked('character-missing')
            }
            if (handledHere.has(u)) {
                continue
            }
            // This page removed the character: the removal stands unless the peer edited it.
            const row = decideDeleteRow({
                side: 'here', inDomain: true, resident: residentBase.has(u),
                edited: editedThereForDelete({ entry: baseEntry }, { entry: theirsEntry }) ? 'edited' : 'unedited',
            })
            if (row.kind === 'park') {
                return parked(row.reason)
            }
            if (row.kind === 'row') {
                return parked(`conflict:char:${baseEntry.chaId}:${row.row}`)
            }
            continue
        }
        const slot = slots[index]
        const chaId = slotChaId(slot)
        const stub = isColdStub(slot)
        // A stub holds placeholders for the two view fields, so what it stands for is the entry's.
        const baseMoved = movedFieldsOf(baseEntry)
        const mineMoved: MovedFields = stub
            ? { ...liveMoved(slot), chatPage: baseMoved.chatPage, firstMsgIndex: baseMoved.firstMsgIndex }
            : liveMoved(slot)
        const bodyClean = stub
            ? stubMatchesEntry(slot, baseEntry)
            : characterBodyMatches(slot, { env: input.env, lists: input.lists, previous: old }) === 'clean'
        const replyOwner = input.replyOwners.has(chaId)
        const decision = classifyCharacter({
            base: baseEntry, theirs: theirsEntry, bodyClean,
            inUse: inUseSet.has(chaId) || replyOwner || host.writing(chaId), replyOwner,
            shared: (heldBy.get(baseEntry.chaId) ?? 0) > 1, resident: residentU.has(u), mine: mineMoved,
        })
        if (decision.kind === 'park') {
            // A loaded character that is open, edited, resident or showing an unsaved view is merged record by record.
            if (stub || !UNIT_PATH_REASONS.includes(decision.reason)) {
                return parked(`character:${decision.reason}`)
            }
            const result = unitPath({
                db, old, next, target, host, env: input.env, lists: input.lists, fresh, replyOwners: input.replyOwners, writing,
                baseDigests: baseDigests(), theirsDigests: theirsDigests(), collect, answers: input.answers, newId: input.newId ?? v4,
            }, slot, baseEntry, theirsEntry, mineMoved, replyOwner)
            switch (result.kind) {
                case 'park':
                    return parked(result.reason)
                case 'need':
                    needUnits.push(...result.units)
                    break
                case 'conflict':
                    conflicts.push(...result.conflicts)
                    break
                case 'wait':
                    waits.chars.push(...result.waits.chars)
                    waits.chats.push(...result.waits.chats)
                    break
                case 'ok':
                    steps.push(...result.steps)
                    guard.push(...result.guard)
                    oracle.push(...result.oracle)
                    result.defers.forEach(needDefer)
                    if (result.marked) {
                        marked.push(chaId)
                    }
                    restorePoint ||= result.restore
                    break
            }
            continue
        }
        if (decision.kind === 'keep') {
            continue
        }
        const movedOf = (name: 'lastInteraction' | 'trashTime' | 'chatPage' | 'firstMsgIndex'): { value: number | undefined, wrote: boolean } => {
            const moved = decision.moved[name]
            if (moved.kind === 'take' || moved.kind === 'merge') {
                if (moved.kind === 'take' && moved.defer === true) {
                    needDefer('d1')
                }
                return { value: moved.value, wrote: true }
            }
            return { value: mineMoved[name], wrote: false }
        }
        if (decision.kind === 'fields') {
            for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const) {
                const { value, wrote } = movedOf(name)
                if (wrote && !(stub && (name === 'chatPage' || name === 'firstMsgIndex'))) {
                    steps.push(movedStep(slot, name, value))
                }
            }
            continue
        }
        needDefer('d2')
        const finalMoved: MovedFields = { lastInteraction: movedOf('lastInteraction').value, trashTime: movedOf('trashTime').value }
        const replacement = stubFromEntry(theirsEntry)
        if (!isSlotObject(replacement)) {
            return parked('character:no-chaid')
        }
        replacedBy.set(slot, replacement)
        guard.push(...unitEntries(old, baseEntry, theirsEntry))
        steps.push({
            apply() {
                const characters = db.characters
                const at = characters.indexOf(slot)
                if (at < 0) {
                    return () => { }
                }
                host.installQuietly(() => { characters[at] = replacement })
                for (const name of ['lastInteraction', 'trashTime'] as const) {
                    if (finalMoved[name] === undefined) {
                        Reflect.deleteProperty(replacement, name)
                    } else {
                        Reflect.set(replacement, name, finalMoved[name])
                    }
                }
                return () => {
                    const held = characters.indexOf(replacement)
                    if (held >= 0) {
                        host.installQuietly(() => { characters[held] = slot })
                    }
                }
            },
            verify() {
                const at = db.characters.indexOf(replacement)
                return at >= 0 && stubProjectionMatches(db.characters[at], theirsEntry, finalMoved)
            },
            after: () => host.forgetLoaded(slot),
        })
    }
    if (needUnits.length > 0) {
        return { kind: 'need', units: [...new Map(needUnits.map(unit => [keyOfRef(unit.ref), unit])).values()], reason: 'entity-late' }
    }
    const waitsOrNull = waits.chars.length > 0 || waits.chats.length > 0 ? waits : null
    if (conflicts.length > 0) {
        return { kind: 'conflict', conflicts, waits: waitsOrNull, reason: conflicts[0].legacy }
    }
    // A character an answer keeps and that `characterOrder` names nowhere returns at the top-level end, as `checkCharOrder` would put it.
    if (keptCharacters.length > 0 && Array.isArray(orderValue)) {
        const named: OrderEntry[] = orderValue.map(entry => typeof entry === 'string' ? entry : { data: isJsonObject(entry) && Array.isArray(entry.data) ? stringList(entry.data) : [] })
        const appended = completeOrder(named, keptCharacters).slice(named.length).filter((entry): entry is string => typeof entry === 'string')
        if (appended.length > 0) {
            orderValue = [...orderValue, ...appended]
            orderWritten = true
        }
    }
    if (orderWritten) {
        steps.push(fieldStep(db, 'characterOrder', orderValue))
    }
    steps.push(...membershipSteps)
    const selected = host.selection()
    const selectedSlot: Slot | undefined = selected >= 0 ? slots[selected] : undefined
    if (selectedSlot !== undefined && (removedSlots.size > 0 || ordered !== null || replacedBy.size > 0)) {
        steps.push({
            apply: () => () => { },
            verify: () => true,
            after() {
                if (removedSlots.has(selectedSlot)) {
                    host.select(-1)
                    return
                }
                const at = db.characters.indexOf(replacedBy.get(selectedSlot) ?? selectedSlot)
                if (at >= 0 && at !== host.selection()) {
                    host.select(at)
                }
            },
        })
    }
    if (marked.length > 0) {
        steps.push({
            apply: () => () => { },
            verify: () => true,
            after: () => marked.forEach(chaId => host.mark(chaId)),
        })
    }
    return {
        kind: 'ready', defers, steps, guard, oracle, waits: waitsOrNull, restorePoint,
    }
}
