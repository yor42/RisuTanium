import type { JsonObject, JsonValue } from '../../blockFrame'
import { isJsonObject, sameJsonValue } from '../codec'
import type { ChatEntry, ShardEntry } from '../format'
import {
    changedRecords, fingerprintOf, isWholeEntry, mergeChatList, recordRefs, RECORD_CHAT_LIST, RECORD_VIEW,
    type RecordSide,
} from './units'

/**
 * The fast-forward's classifier. It decides, per record, what the page does with a change a peer committed: base is the
 * encoding the page acknowledged, mine is the live database, theirs is the peer's tree. Every function is pure over
 * plain JSON and entry values: it reads no store and writes nothing. A record both sides changed to different values
 * is never merged unless a rule below says how; it parks, and the page asks as it does today.
 */

/** What to do with one record. `keep` leaves this page's value; `take` and `merge` name the value to write. */
export type Decision<T> =
    | { kind: 'keep' }
    /** `defer` marks view state: the apply waits while a reply is being sent (deferral D1). */
    | { kind: 'take', value: T, defer?: boolean }
    | { kind: 'merge', value: T }
    | { kind: 'park', reason: string }

type Value = JsonValue | undefined

/** The three-way rule for one value: only the side that changed wins; both changed to different values park. */
export function threeWay<T extends Value>(base: T, mine: T, theirs: T): Decision<T> {
    if (sameJsonValue(theirs, base)) {
        return { kind: 'keep' }
    }
    if (sameJsonValue(mine, base)) {
        return { kind: 'take', value: theirs }
    }
    if (sameJsonValue(mine, theirs)) {
        return { kind: 'keep' }
    }
    return { kind: 'park', reason: 'both-changed' }
}

/** A field decision of `classifyConfig`: the value to write (undefined removes the field). */
export interface ConfigDecision {
    take: Map<string, Value>
    park: string[]
}

/**
 * Config, per top-level field: one side changed, that side; both changed equal, nothing; both changed differently,
 * park. `skip` names the fields that belong to a record with its own rule, so they are not decided here.
 */
export function classifyConfig(base: JsonObject, mine: JsonObject, theirs: JsonObject, skip: ReadonlySet<string> = new Set()): ConfigDecision {
    const names = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])
    const out: ConfigDecision = { take: new Map(), park: [] }
    for (const name of [...names].sort()) {
        if (skip.has(name)) {
            continue
        }
        const decision = threeWay<Value>(Object.hasOwn(base, name) ? base[name] : undefined, Object.hasOwn(mine, name) ? mine[name] : undefined,
            Object.hasOwn(theirs, name) ? theirs[name] : undefined)
        if (decision.kind === 'take') {
            out.take.set(name, decision.value)
        } else if (decision.kind === 'park') {
            out.park.push(name)
        }
    }
    return out
}

function numberOr0(value: Value): number {
    return typeof value === 'number' ? value : 0
}

/**
 * The statics value. Per key, `threeWay`; a key both sides changed to different numbers is theirs plus this page's
 * change since the base (an absent number counts as 0). A key both changed to anything else parks. A value that is
 * not an object on every side falls back to `threeWay` of the whole value.
 */
export function mergeStatics(base: Value, mine: Value, theirs: Value): Decision<Value> {
    if (!isJsonObject(base) || !isJsonObject(mine) || !isJsonObject(theirs)) {
        return threeWay(base, mine, theirs)
    }
    const names = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])
    const merged: JsonObject = {}
    for (const name of [...names].sort()) {
        const b = Object.hasOwn(base, name) ? base[name] : undefined
        const m = Object.hasOwn(mine, name) ? mine[name] : undefined
        const t = Object.hasOwn(theirs, name) ? theirs[name] : undefined
        let value: Value
        const decision = threeWay<Value>(b, m, t)
        if (decision.kind === 'keep') {
            value = m
        } else if (decision.kind === 'take') {
            value = decision.value
        } else if ([b, m, t].every(item => item === undefined || typeof item === 'number')) {
            value = numberOr0(t) + (numberOr0(m) - numberOr0(b))
        } else {
            return { kind: 'park', reason: `statics:${name}` }
        }
        if (value !== undefined) {
            Object.defineProperty(merged, name, { value, enumerable: true, writable: true, configurable: true })
        }
    }
    if (sameJsonValue(merged, mine)) {
        return { kind: 'keep' }
    }
    return sameJsonValue(merged, theirs) ? { kind: 'take', value: merged } : { kind: 'merge', value: merged }
}

/** The shard-entry fields that change often and move out of the character core (`ENTRY_MOVED_FIELDS`). */
export interface MovedFields {
    lastInteraction?: number
    trashTime?: number
    chatPage?: number
    firstMsgIndex?: number
}

/** What the page knows about the character a moved field belongs to. */
export interface MovedContext {
    /** The character is open here: the selection, the previous selection and its group members, a reply owner or a writing one. */
    inUse: boolean
    /** A reply is being written into this character, so its view state is applied after the send. */
    replyOwner: boolean
}

export interface MovedDecision {
    lastInteraction: Decision<number | undefined>
    trashTime: Decision<number | undefined>
    chatPage: Decision<number | undefined>
    firstMsgIndex: Decision<number | undefined>
}

/**
 * The moved fields of one entry.
 * - `lastInteraction`: the maximum of the two sides, once theirs changed it.
 * - `trashTime`: three-way; a change on an open character parks (stage 2).
 * - `chatPage`: theirs only, take (deferred while a reply is being written); both changed, this page's value stays
 *   (the last saved switch wins).
 * - `firstMsgIndex`: three-way.
 */
export function classifyMovedFields(base: MovedFields, mine: MovedFields, theirs: MovedFields, context: MovedContext): MovedDecision {
    const lastInteraction = ((): Decision<number | undefined> => {
        if (sameJsonValue(theirs.lastInteraction, base.lastInteraction)) {
            return { kind: 'keep' }
        }
        const max = mine.lastInteraction === undefined || theirs.lastInteraction === undefined
            ? mine.lastInteraction ?? theirs.lastInteraction
            : Math.max(mine.lastInteraction, theirs.lastInteraction)
        return Object.is(max, mine.lastInteraction) ? { kind: 'keep' } : { kind: 'take', value: max }
    })()
    const trashTime = ((): Decision<number | undefined> => {
        if (!sameJsonValue(theirs.trashTime, base.trashTime) && context.inUse) {
            return { kind: 'park', reason: 'trash-in-use' }
        }
        return threeWay(base.trashTime, mine.trashTime, theirs.trashTime)
    })()
    const chatPage = ((): Decision<number | undefined> => {
        if (sameJsonValue(theirs.chatPage, base.chatPage) || !sameJsonValue(mine.chatPage, base.chatPage)) {
            return { kind: 'keep' }
        }
        return { kind: 'take', value: theirs.chatPage, defer: context.replyOwner }
    })()
    return { lastInteraction, trashTime, chatPage, firstMsgIndex: threeWay(base.firstMsgIndex, mine.firstMsgIndex, theirs.firstMsgIndex) }
}

/** The moved fields an entry holds. */
export function movedFieldsOf(entry: ShardEntry): MovedFields {
    const out: MovedFields = {}
    for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const) {
        if (entry[name] !== undefined) {
            out[name] = entry[name]
        }
    }
    return out
}

function sameKey(a: readonly unknown[] | null, b: readonly unknown[] | null): boolean {
    return a === null || b === null ? a === b : a[0] === b[0]
}

function sameChats(a: readonly ChatEntry[], b: readonly ChatEntry[]): boolean {
    return a.length === b.length && a.every((chat, index) => {
        const other = b[index]
        const alt = chat.alt ?? []
        const otherAlt = other.alt ?? []
        return chat.cid === other.cid && sameKey(chat.core, other.core) && chat.chunks.length === other.chunks.length
            && chat.chunks.every((chunk, k) => sameKey(chunk, other.chunks[k]))
            && alt.length === otherAlt.length && alt.every((unit, k) => sameKey(unit, otherAlt[k]))
    })
}

/** Whether the two entries name different units: a Ref's key is the unit, so a different key is a different content. */
export function entryBodyChanged(a: ShardEntry, b: ShardEntry): boolean {
    return !(sameKey(a.core, b.core) && sameKey(a.lore, b.lore) && sameKey(a.scripts, b.scripts) && sameKey(a.al, b.al)
        && sameKey(a.il, b.il) && sameChats(a.chats, b.chats))
}

/** The entry fields other than the moved fields and the unit Refs: a stub shows them, a pass rewrites them from the live character. */
const ENTRY_OTHER_FIELDS = ['u', 'type', 'name', 'image', 'chaId', 'characters', 'creatorNotes', 'tags', 'creator', 'dsp'] as const

function entryOtherChanged(a: ShardEntry, b: ShardEntry): boolean {
    return ENTRY_OTHER_FIELDS.some(name => !sameJsonValue(a[name], b[name]))
}

export interface CharacterInput {
    /** The acknowledged entry and the peer's, null when the encoding holds none. */
    base: ShardEntry | null
    theirs: ShardEntry | null
    /** This page's character is what the acknowledged encoding holds, moved fields aside (`characterBodyMatches` is `clean`). */
    bodyClean: boolean
    inUse: boolean
    replyOwner: boolean
    /** The chaId is held by more than one slot. */
    shared: boolean
    /** The residency id test makes the id resident, so a stub would not stand for it. */
    resident: boolean
    /** This page's live moved fields. */
    mine: MovedFields
}

export type CharacterDecision =
    | { kind: 'keep' }
    /** The peer changed only the entry's moved fields: they are written on the live character, with no swap. */
    | { kind: 'fields', moved: MovedDecision }
    /** The peer changed the body: the character becomes the peer's stub, then the merged moved fields are written. */
    | { kind: 'install', moved: MovedDecision }
    | { kind: 'park', reason: string }

/** A character the peer changed (Ref differs), against this page's copy. */
export function classifyCharacter(input: CharacterInput): CharacterDecision {
    const { base, theirs } = input
    if (base === null || theirs === null) {
        return { kind: 'park', reason: 'no-entry' }
    }
    if (input.shared) {
        return { kind: 'park', reason: 'shared-id' }
    }
    const bodyChanged = entryBodyChanged(base, theirs)
    const baseMoved = movedFieldsOf(base)
    const theirsMoved = movedFieldsOf(theirs)
    if (!bodyChanged && entryOtherChanged(base, theirs)) {
        return { kind: 'park', reason: 'entry-fields' }
    }
    if (!bodyChanged && sameJsonValue(baseMoved, theirsMoved)) {
        return { kind: 'keep' }
    }
    const moved = classifyMovedFields(baseMoved, input.mine, theirsMoved, { inUse: input.inUse, replyOwner: input.replyOwner })
    const parked = Object.values(moved).find(decision => decision.kind === 'park')
    if (parked !== undefined) {
        return { kind: 'park', reason: parked.reason }
    }
    if (!bodyChanged) {
        return { kind: 'fields', moved }
    }
    if (input.inUse) {
        return { kind: 'park', reason: 'in-use' }
    }
    if (!input.bodyClean) {
        return { kind: 'park', reason: 'body-dirty' }
    }
    if (input.resident) {
        return { kind: 'park', reason: 'resident-id' }
    }
    // A stub holds no `chatPage` or `firstMsgIndex`, so an unsaved change of either here cannot survive the swap.
    if (input.mine.chatPage !== baseMoved.chatPage || input.mine.firstMsgIndex !== baseMoved.firstMsgIndex) {
        return { kind: 'park', reason: 'unsaved-view' }
    }
    return { kind: 'install', moved }
}

/** One character of the order: its id and the entity id `u` the acknowledged or peer's order gives it. */
export interface Member {
    chaId: string
    u: string
}

export type MembershipDecision =
    | { kind: 'keep' }
    /** The peer appended these characters: they are added as stubs, after the ones this page holds. */
    | { kind: 'append', members: Member[] }
    | { kind: 'park', reason: string }

/**
 * The character list. The peer's list is the base plus new distinct ids appended, every id of the base keeps its `u`
 * (a re-minted `u` is a different character), this page's list is the base's, and every appended id passes the
 * residency id test: that is `append`. The peer's list unchanged is `keep`. Anything else parks.
 */
export function classifyMembership(base: readonly Member[], mine: readonly Member[], theirs: readonly Member[], isResident: (chaId: string) => boolean): MembershipDecision {
    if (base.length === theirs.length && base.every((member, index) => member.chaId === theirs[index].chaId && member.u === theirs[index].u)) {
        return { kind: 'keep' }
    }
    if (mine.length !== base.length || mine.some((member, index) => member.chaId !== base[index].chaId)) {
        return { kind: 'park', reason: 'both-changed' }
    }
    if (theirs.length <= base.length || base.some((member, index) => member.chaId !== theirs[index].chaId || member.u !== theirs[index].u)) {
        return { kind: 'park', reason: 'not-append' }
    }
    const appended = theirs.slice(base.length)
    const seen = new Set(base.map(member => member.chaId))
    for (const member of appended) {
        if (seen.has(member.chaId)) {
            return { kind: 'park', reason: 'duplicate-id' }
        }
        seen.add(member.chaId)
        if (isResident(member.chaId)) {
            return { kind: 'park', reason: 'resident-id' }
        }
    }
    return { kind: 'append', members: appended }
}

/**
 * Whether the membership is inside the domain of the target merge: on each of the three sides every chaId is a
 * non-empty string held once. Outside it a chaId cannot name a character, so only `classifyMembership` decides.
 */
export function membershipInDomain(base: readonly Member[], live: readonly Member[], theirs: readonly Member[]): boolean {
    return [base, live, theirs].every(side => {
        const seen = new Set<string>()
        return side.every(member => {
            if (typeof member.chaId !== 'string' || member.chaId === '' || seen.has(member.chaId)) {
                return false
            }
            seen.add(member.chaId)
            return true
        })
    })
}

export type DomainMembershipDecision =
    | { kind: 'keep' }
    /** The peer inserted these characters (at any position) and removed others; `membershipTarget` places them. */
    | { kind: 'change', inserted: Member[] }
    | { kind: 'park', reason: string }

/**
 * The membership inside the domain. Theirs equal to base: `keep`. This page's list differing from base: `both-changed`.
 * Theirs restricted to the base's ids keeping the base's order and every `u` (a re-minted `u` is another character):
 * else `not-append`. An inserted resident id: `resident-id`. Otherwise `change`.
 */
export function mergeMembership(base: readonly Member[], mine: readonly Member[], theirs: readonly Member[], isResident: (chaId: string) => boolean): DomainMembershipDecision {
    if (base.length === theirs.length && base.every((member, index) => member.chaId === theirs[index].chaId && member.u === theirs[index].u)) {
        return { kind: 'keep' }
    }
    if (mine.length !== base.length || mine.some((member, index) => member.chaId !== base[index].chaId)) {
        return { kind: 'park', reason: 'both-changed' }
    }
    const baseIds = new Set(base.map(member => member.chaId))
    const kept = theirs.filter(member => baseIds.has(member.chaId))
    let at = 0
    for (const member of kept) {
        while (at < base.length && base[at].chaId !== member.chaId) {
            at++
        }
        if (at >= base.length || base[at].u !== member.u) {
            return { kind: 'park', reason: 'not-append' }
        }
        at++
    }
    const inserted = theirs.filter(member => !baseIds.has(member.chaId))
    if (inserted.some(member => isResident(member.chaId))) {
        return { kind: 'park', reason: 'resident-id' }
    }
    return { kind: 'change', inserted }
}

/**
 * The membership decision of a pass: inside the domain `mergeMembership`, outside it exactly `classifyMembership`, which
 * never yields a target, a placement or a removal.
 */
export function decideMembership(base: readonly Member[], live: readonly Member[], theirs: readonly Member[], isResident: (chaId: string) => boolean): MembershipDecision | DomainMembershipDecision {
    return membershipInDomain(base, live, theirs) ? mergeMembership(base, live, theirs, isResident) : classifyMembership(base, live, theirs, isResident)
}

/**
 * The chaId sequence the page holds after the merge: `mergeChatList` over the chaIds. `live` is this page's sequence
 * before the apply and `keep` the ids a delete-row answer keeps.
 */
export function membershipTarget(input: { base: readonly string[], live: readonly string[], theirs: readonly string[], keep?: ReadonlySet<string> }): string[] {
    return mergeChatList({ base: input.base, mine: input.live, theirs: input.theirs, ...(input.keep === undefined ? {} : { keep: input.keep }) })
}

export interface Insertion {
    chaId: string
    /** The chaId the new character goes before; it is a live member or an insertion placed earlier. Null: the end. */
    before: string | null
}

/**
 * The insertions that turn `liveAfterRemovals` into `target`, in reverse target order: each insertion's `before` is the
 * next chaId of the target, which is already present when the insertion is applied.
 */
export function placeInsertions(liveAfterRemovals: readonly string[], target: readonly string[]): Insertion[] {
    const present = new Set(liveAfterRemovals)
    const out: Insertion[] = []
    for (let index = target.length - 1; index >= 0; index--) {
        if (!present.has(target[index])) {
            out.push({ chaId: target[index], before: index + 1 < target.length ? target[index + 1] : null })
        }
    }
    return out
}

/** An entry of `characterOrder`: a character id, or a folder naming its characters in `data`. */
export type OrderEntry = string | { data?: readonly string[] }

export interface KeptCharacter {
    chaId: string
    /** The kept character's final slot is in the trash. */
    trashed: boolean
}

/**
 * `characterOrder` with every untrashed kept character that it names nowhere (top level or a folder) appended at the
 * top-level end: the entry `checkCharOrder` would push. A fast-forward runs no `checkCharOrder`, and the sidebar lists
 * only the ordered ids.
 */
export function completeOrder<T extends OrderEntry>(order: readonly T[], kept: readonly KeptCharacter[]): (T | string)[] {
    const named = new Set<string>()
    for (const entry of order) {
        if (typeof entry === 'string') {
            named.add(entry)
        } else {
            for (const id of entry.data ?? []) {
                named.add(id)
            }
        }
    }
    const out: (T | string)[] = [...order]
    for (const character of kept) {
        if (!character.trashed && !named.has(character.chaId)) {
            named.add(character.chaId)
            out.push(character.chaId)
        }
    }
    return out
}

export type DeleteEdit = 'edited' | 'unedited' | 'unknown'

export type EditedHere =
    /** A loaded slot: `mine` is the fresh entry's side, null when `freshEntry` was `unknown`. */
    | { slot: 'loaded', base: RecordSide, mine: RecordSide | null, liveTrashTime: number | undefined }
    /** An unloaded stub: `stubMatches` is whether it still shows its base entry. */
    | { slot: 'stub', stubMatches: boolean, baseTrashTime: number | undefined, liveTrashTime: number | undefined }

/**
 * Whether this page edited a character the peer removed. A loaded slot: some record other than `view` differs from the
 * base (a view-only change is not an edit); `lastInteraction` and a set or changed `trashTime` are not records, but a
 * `trashTime` cleared here (a restore) counts. A stub: it no longer shows its entry, or it was restored.
 */
export function editedForDelete(input: EditedHere): DeleteEdit {
    if (input.slot === 'stub') {
        return !input.stubMatches || (input.baseTrashTime !== undefined && input.liveTrashTime === undefined) ? 'edited' : 'unedited'
    }
    if (input.mine === null) {
        return 'unknown'
    }
    if (input.base.entry.trashTime !== undefined && input.liveTrashTime === undefined) {
        return 'edited'
    }
    const whole = isWholeEntry(input.base.entry, input.base.splitCore === true) || isWholeEntry(input.mine.entry, input.mine.splitCore === true)
    const changed = changedRecords(recordRefs(input.base.entry, { whole }), recordRefs(input.mine.entry, { whole }))
    changed.delete(RECORD_VIEW)
    return changed.size > 0 ? 'edited' : 'unedited'
}

/**
 * Whether the peer edited a character this page removed: some record other than `view` differs, an entry field
 * differs (conservative), or the peer cleared `trashTime` (a restore there). A peer change of only `view`,
 * `lastInteraction`, the lists or a set or changed `trashTime` is no edit.
 */
export function editedThereForDelete(base: RecordSide, theirs: RecordSide): boolean {
    if (base.entry.trashTime !== undefined && theirs.entry.trashTime === undefined) {
        return true
    }
    if (entryOtherChanged(base.entry, theirs.entry)) {
        return true
    }
    const whole = isWholeEntry(base.entry, base.splitCore === true) || isWholeEntry(theirs.entry, theirs.splitCore === true)
    const changed = changedRecords(recordRefs(base.entry, { whole }), recordRefs(theirs.entry, { whole }))
    changed.delete(RECORD_VIEW)
    return changed.size > 0
}

export type DeleteRowDecision =
    /** The peer's removal applies. */
    | { kind: 'remove' }
    /** This page's deletion stands. */
    | { kind: 'keep' }
    | { kind: 'row', row: 'deletedThere' | 'deletedHere' }
    | { kind: 'park', reason: 'not-append' | 'character-missing' }

export interface DeleteRowInput {
    /** `there`: the peer removed D. `here`: this page removed D and the peer still holds it. */
    side: 'there' | 'here'
    inDomain: boolean
    /** D's id is resident (decided from D's base entry), so no stub can stand for it. */
    resident: boolean
    /** `there` only: D is an unloaded stub here. */
    stub?: boolean
    /** `there`: `editedForDelete`. `here`: `edited` when `editedThereForDelete` holds, else `unedited`. */
    edited: DeleteEdit
    /** `here` only: the peer's entry for D differs from the base at all (used outside the domain). */
    changedAtAll?: boolean
}

/**
 * The delete-row table of the membership decision. Outside the domain no row exists: `there` parks `not-append`, `here`
 * parks `character-missing` when the peer changed D at all and otherwise keeps this page's deletion. A resident id has
 * no row either. A stub edited while unloaded parks, because the peer's tree holds no entry for it to carry. A loaded
 * slot whose freshness is unknown parks.
 */
export function decideDeleteRow(input: DeleteRowInput): DeleteRowDecision {
    if (input.side === 'here') {
        if (!input.inDomain) {
            return input.changedAtAll === true ? { kind: 'park', reason: 'character-missing' } : { kind: 'keep' }
        }
        if (input.edited !== 'edited') {
            return { kind: 'keep' }
        }
        return input.resident ? { kind: 'park', reason: 'character-missing' } : { kind: 'row', row: 'deletedHere' }
    }
    if (!input.inDomain) {
        return { kind: 'park', reason: 'not-append' }
    }
    if (input.edited === 'unedited') {
        return { kind: 'remove' }
    }
    if (input.resident || input.stub === true || input.edited === 'unknown') {
        return { kind: 'park', reason: 'not-append' }
    }
    return { kind: 'row', row: 'deletedThere' }
}

export type RecordConflictKind = 'both' | 'deletedThere' | 'deletedHere'

export type RecordDecision =
    /** Only the peer changed it (a removal included): write the peer's value. */
    | { id: string, kind: 'take' }
    /** This page changed it; `agreed` means the peer changed it to the same content, so there is no step to write. */
    | { id: string, kind: 'keep', agreed: boolean }
    /** Both changed the `chatList` or the `view`: `mergeChatList` or `decideView` decides. */
    | { id: string, kind: 'merge' }
    | { id: string, kind: 'conflict', conflict: RecordConflictKind }

export interface CharacterRecords {
    /** The character is one record. */
    whole: boolean
    mineChanged: ReadonlySet<string>
    theirsChanged: ReadonlySet<string>
    /** One decision per record either side changed, in record id order. */
    decisions: RecordDecision[]
}

/**
 * The per-record three-way of one character: base is the acknowledged entry, mine the entry a fresh encode of the live
 * character gives, theirs the peer's.
 * - only theirs changed: take; only mine changed: keep;
 * - both changed to the same content: keep, agreed;
 * - both changed: a conflict, a chat removed on one side and changed on the other included; the `chatList` and the
 *   `view` merge instead.
 */
export function classifyCharacterRecords(input: { base: RecordSide, mine: RecordSide, theirs: RecordSide }): CharacterRecords {
    const { base, mine, theirs } = input
    const whole = [base, mine, theirs].some(side => isWholeEntry(side.entry, side.splitCore === true))
    const baseRefs = recordRefs(base.entry, { whole })
    const mineRefs = recordRefs(mine.entry, { whole })
    const theirsRefs = recordRefs(theirs.entry, { whole })
    const mineChanged = changedRecords(baseRefs, mineRefs)
    const theirsChanged = changedRecords(baseRefs, theirsRefs)
    const decisions: RecordDecision[] = []
    for (const id of [...new Set([...mineChanged, ...theirsChanged])].sort()) {
        if (!mineChanged.has(id)) {
            decisions.push({ id, kind: 'take' })
        } else if (!theirsChanged.has(id)) {
            decisions.push({ id, kind: 'keep', agreed: false })
        } else if (fingerprintOf(mineRefs.get(id), mine.digestOf) === fingerprintOf(theirsRefs.get(id), theirs.digestOf)) {
            decisions.push({ id, kind: 'keep', agreed: true })
        } else if (id === RECORD_CHAT_LIST || id === RECORD_VIEW) {
            decisions.push({ id, kind: 'merge' })
        } else if (baseRefs.has(id) && !mineRefs.has(id)) {
            decisions.push({ id, kind: 'conflict', conflict: 'deletedHere' })
        } else if (baseRefs.has(id) && !theirsRefs.has(id)) {
            decisions.push({ id, kind: 'conflict', conflict: 'deletedThere' })
        } else {
            decisions.push({ id, kind: 'conflict', conflict: 'both' })
        }
    }
    return { whole, mineChanged, theirsChanged, decisions }
}

/** `characterOrder`, a sub-record of the order unit: it follows its own side, apart from the membership. */
export function classifyCharacterOrder(base: Value, mine: Value, theirs: Value): Decision<Value> {
    return threeWay(base, mine, theirs)
}

export interface TrashInput {
    base: { trashTime?: number, trashOrigins: Value, characterOrder: Value }
    mine: { trashTime?: number, trashOrigins: Value, characterOrder: Value }
    theirs: { trashTime?: number, trashOrigins: Value, characterOrder: Value }
    inUse: boolean
}

export interface TrashDecision {
    trashTime: Decision<number | undefined>
    trashOrigins: Decision<Value>
    characterOrder: Decision<Value>
}

/**
 * Trashing a character changes three records: its `trashTime` (a moved field), `trashOrigins` (a config field) and
 * `characterOrder`. Each follows its own rule, so a peer trash against an unsaved body edit here merges.
 */
export function classifyTrash(input: TrashInput): TrashDecision {
    const { base, mine, theirs } = input
    return {
        trashTime: classifyMovedFields({ trashTime: base.trashTime }, { trashTime: mine.trashTime }, { trashTime: theirs.trashTime }, { inUse: input.inUse, replyOwner: false }).trashTime,
        trashOrigins: threeWay(base.trashOrigins, mine.trashOrigins, theirs.trashOrigins),
        characterOrder: classifyCharacterOrder(base.characterOrder, mine.characterOrder, theirs.characterOrder),
    }
}
