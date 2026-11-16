import type { JsonObject, JsonValue } from '../../blockFrame'
import { isJsonObject, sameJsonValue } from '../codec'
import type { ChatEntry, ShardEntry } from '../format'

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
