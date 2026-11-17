import { keyOfTail, type Ref, type ShardEntry } from '../format'

/**
 * The fast-forward's records. A character is a set of records, each decided on its own: `core` (with `firstMsgIndex`),
 * `lore`, `scripts`, one `chat:<cid>` per chat, `chatList` (the cid sequence) and `view` (the shown chat, by id). A
 * character whose records cannot be told apart by an id is one `whole` record. Every function is pure over entries and
 * plain values: it reads no store and writes nothing.
 */

export const RECORD_CORE = 'core'
export const RECORD_LORE = 'lore'
export const RECORD_SCRIPTS = 'scripts'
export const RECORD_CHAT_LIST = 'chatList'
export const RECORD_VIEW = 'view'
export const RECORD_WHOLE = 'whole'

/** The record id of one chat. */
export function chatRecordId(cid: string): string {
    return `chat:${cid}`
}

/** What one side of a three-way knows about a character: its entry and how to look up a unit's digest by store key. */
export interface RecordSide {
    entry: ShardEntry
    /** The core unit holds an absent list or a moved field in `f`, which the entry alone cannot show. */
    splitCore?: boolean
    /** The digest of the unit stored under `key`; undefined when the side does not know it. */
    digestOf?: (key: string) => string | undefined
}

/** A handle that stands for a position, not for a chat: an empty id or a `~index` handle. */
function isPositionalCid(cid: string): boolean {
    return cid === '' || cid.startsWith('~')
}

/** Whether the character is one record: a positional handle, a repeated chat id or a split core. */
export function isWholeEntry(entry: ShardEntry, splitCore = false): boolean {
    if (splitCore) {
        return true
    }
    const seen = new Set<string>()
    for (const chat of entry.chats) {
        if (isPositionalCid(chat.cid) || seen.has(chat.cid)) {
            return true
        }
        seen.add(chat.cid)
    }
    return false
}

function refToken(ref: Ref | null): string {
    return ref === null ? 'null' : `k:${ref[0]}`
}

function countedRefToken(ref: Ref): string[] {
    return [refToken(ref), `m:${String(ref[3])}`]
}

function chatTokens(chat: ShardEntry['chats'][number]): string[] {
    const alt = chat.alt ?? []
    return [refToken(chat.core), `n:${chat.chunks.length}`, ...chat.chunks.flatMap(countedRefToken), `a:${alt.length}`, ...alt.flatMap(countedRefToken)]
}

function viewToken(entry: ShardEntry): string {
    const shown = entry.chats[entry.chatPage]
    return shown === undefined ? 'v:\u0000' : `v:${shown.cid}`
}

export interface RecordsOptions {
    /** The core unit is split: the character is one record. */
    splitCore?: boolean
    /** Force the one-record shape (another side of the same three-way is one). */
    whole?: boolean
}

/**
 * The Ref-key list of every record of an entry. A list holds the keys of the units the record names and its shape
 * (counts, null-ness), so a deleted trailing chunk or a cleared alternatives list changes it. A record the entry does
 * not have is absent from the map.
 */
export function recordRefs(entry: ShardEntry, options: RecordsOptions = {}): Map<string, string[]> {
    const out = new Map<string, string[]>()
    const chatList = entry.chats.map(chat => `c:${chat.cid}`)
    if (options.whole === true || isWholeEntry(entry, options.splitCore === true)) {
        out.set(RECORD_WHOLE, [
            refToken(entry.core), `f:${entry.firstMsgIndex}`, refToken(entry.lore), refToken(entry.scripts),
            ...entry.chats.flatMap(chat => [`c:${chat.cid}`, ...chatTokens(chat)]), `p:${entry.chatPage}`,
        ])
        return out
    }
    out.set(RECORD_CORE, [refToken(entry.core), `f:${entry.firstMsgIndex}`])
    out.set(RECORD_LORE, [refToken(entry.lore)])
    out.set(RECORD_SCRIPTS, [refToken(entry.scripts)])
    for (const chat of entry.chats) {
        out.set(chatRecordId(chat.cid), chatTokens(chat))
    }
    out.set(RECORD_CHAT_LIST, chatList)
    out.set(RECORD_VIEW, [viewToken(entry)])
    return out
}

function sameTokens(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    if (a === undefined || b === undefined) {
        return a === b
    }
    return a.length === b.length && a.every((token, index) => token === b[index])
}

/** The record ids whose Ref-key lists differ between two maps, one side lacking a record included. */
export function changedRecords(a: ReadonlyMap<string, readonly string[]>, b: ReadonlyMap<string, readonly string[]>): Set<string> {
    const out = new Set<string>()
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        if (!sameTokens(a.get(id), b.get(id))) {
            out.add(id)
        }
    }
    return out
}

/**
 * A record's content fingerprint: its Ref-key list with each unit key replaced by the unit's digest, so two sides that
 * hold the same content under different keys agree. A key whose digest is not known stands for itself. An absent
 * record has its own fingerprint.
 */
export function fingerprintOf(tokens: readonly string[] | undefined, digestOf?: (key: string) => string | undefined): string {
    if (tokens === undefined) {
        return 'absent'
    }
    return JSON.stringify(tokens.map(token => {
        if (!token.startsWith('k:')) {
            return token
        }
        const digest = digestOf?.(keyOfTail(token.slice(2)))
        return digest === undefined ? token : `d:${digest}`
    }))
}

/**
 * The merged sequence of ids of a list that holds each id at most once.
 * - Set: the ids all three sides hold, the ids mine or theirs added (copies included) and the ids in `keep`. An id of
 *   base that a side lacks and that is not in `keep` is removed.
 * - Order: mine's sequence when mine reordered the ids all three share (also when theirs did, MC-2055), else theirs'.
 * - An id the backbone lacks goes before its nearest successor, in the other side's sequence, that is already placed,
 *   else at the end; ids before one successor keep their order.
 */
export function mergeChatList(input: { base: readonly string[], mine: readonly string[], theirs: readonly string[], keep?: ReadonlySet<string> }): string[] {
    const { base, mine, theirs } = input
    const keep = input.keep ?? new Set<string>()
    const inBase = new Set(base)
    const inMine = new Set(mine)
    const inTheirs = new Set(theirs)
    const wanted = new Set<string>()
    for (const id of [...mine, ...theirs]) {
        if (inBase.has(id) ? (inMine.has(id) && inTheirs.has(id)) : true) {
            wanted.add(id)
        }
    }
    for (const id of keep) {
        wanted.add(id)
    }
    const common = new Set(base.filter(id => inMine.has(id) && inTheirs.has(id)))
    const baseCommon = base.filter(id => common.has(id))
    const reordered = (side: readonly string[]): boolean => {
        const seen = side.filter(id => common.has(id))
        return seen.length !== baseCommon.length || seen.some((id, index) => id !== baseCommon[index])
    }
    const mineBackbone = reordered(mine)
    const backbone = mineBackbone ? mine : theirs
    const other = mineBackbone ? theirs : mine
    const result = backbone.filter(id => wanted.has(id))
    const placed = new Set(result)
    const missing = [...wanted].filter(id => !placed.has(id))
    const missingSet = new Set(missing)
    const sequence = other.filter(id => missingSet.has(id))
    for (let index = sequence.length - 1; index >= 0; index--) {
        const id = sequence[index]
        let at = result.length
        for (let next = other.indexOf(id) + 1; next < other.length; next++) {
            const position = result.indexOf(other[next])
            if (position !== -1) {
                at = position
                break
            }
        }
        result.splice(at, 0, id)
        placed.add(id)
    }
    for (const id of missing) {
        if (!placed.has(id)) {
            result.push(id)
        }
    }
    return result
}

export interface ViewInput {
    baseList: readonly string[]
    mineList: readonly string[]
    theirsList: readonly string[]
    /** The `chatPage` of each side. */
    base: number
    mine: number
    theirs: number
    /** The merged chat id sequence. */
    final: readonly string[]
    /** A reply is being written into this character, so a switch to theirs' view waits until it ends. */
    replyOwner?: boolean
}

export interface ViewDecision {
    chatPage: number
    /** The choice is theirs' view and a reply is being written: the apply waits (deferral D1). */
    defer: boolean
}

/**
 * The shown chat after a merge, decided by id. Theirs unchanged: this page's; only theirs switched: theirs'; both
 * switched: this page's. A chosen id the merge removed falls to theirs' id when it survives, else to the first chat.
 * An index out of range is a value of its own.
 */
export function decideView(input: ViewInput): ViewDecision {
    const b = input.baseList[input.base]
    const m = input.mineList[input.mine]
    const t = input.theirsList[input.theirs]
    let chosen: string | undefined
    let defer = false
    if (t === b) {
        chosen = m
    } else if (m === b) {
        chosen = t
        defer = input.replyOwner === true
    } else {
        chosen = m
    }
    let index = chosen === undefined ? -1 : input.final.indexOf(chosen)
    if (index === -1) {
        index = t === undefined ? -1 : input.final.indexOf(t)
        defer = false
    }
    return { chatPage: Math.max(index, 0), defer }
}
