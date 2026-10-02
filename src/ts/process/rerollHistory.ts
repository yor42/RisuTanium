import { v4 as uuidv4 } from 'uuid'
import type { Message } from '../storage/database.svelte'
import { readAt, writeAt, type Origin } from './chatOrigin'

/**
 * The reroll histories: for each chat, the alternatives ("pieces") of the
 * messages after one base, and a cursor on the piece on screen. At most
 * `MAX_HISTORIES` chats keep one; the least recently used is dropped first.
 * They live at module level, so they outlive a composer remount, and they are
 * never written to the database or the save.
 *
 * Every piece is the tail of its chat after the base. The base is identified
 * by its anchor, the message just before it, so inserting or removing messages
 * above the anchor does not move it; a null anchor means a base of 0 and only
 * that. A piece is a deep copy and carries an id on every message, because the
 * chat is checked against the shown piece by message identity before every move.
 */
const MAX_HISTORIES = 5

export interface RerollHistory {
    key: string
    anchor: string | null
    pieces: Message[][]
    cursor: number
    shownIds: string[]
}

/** What a reroll that regenerates leaves for `recordGeneration`. */
export interface RerollTicket {
    readonly history: RerollHistory
    readonly anchor: string | null
    /** The piece on screen was empty when the generation started, so its result takes that piece's place. */
    readonly replaceShown: boolean
}

const histories = new Map<string, RerollHistory>()

/** Test-only: forgets every history. Never called from production code. */
export function resetRerollHistoriesForTests(): void {
    histories.clear()
}

function keyOf(address: { chaId: string, chatId: string }): string {
    return `${address.chaId}\u0000${address.chatId}`
}

/** Marks `history` as the most recently used and drops the least recently used ones beyond the limit. */
function remember(history: RerollHistory): void {
    histories.delete(history.key)
    histories.set(history.key, history)
    while(histories.size > MAX_HISTORIES){
        const oldest = histories.keys().next().value
        if(oldest === undefined){
            break
        }
        histories.delete(oldest)
    }
}

function idsOf(piece: Message[]): string[] {
    return piece.map((message) => message.chatId as string)
}

function missingIdFrom(messages: Message[], from: number): boolean {
    for(let i = Math.max(from, 0); i < messages.length; i++){
        if(!messages[i].chatId){
            return true
        }
    }
    return false
}

function fillIdsFrom(messages: Message[], from: number): void {
    for(let i = Math.max(from, 0); i < messages.length; i++){
        if(!messages[i].chatId){
            messages[i].chatId = uuidv4()
        }
    }
}

/** The number of messages up to and including the anchor, or -1 when the anchor is not present exactly once. */
function baseAfterAnchor(anchor: string | null, messages: Message[]): number {
    if(anchor === null){
        return 0
    }
    let found = -1
    for(let i = 0; i < messages.length; i++){
        if(messages[i].chatId === anchor){
            if(found !== -1){
                return -1
            }
            found = i
        }
    }
    return found === -1 ? -1 : found + 1
}

function showsPiece(messages: Message[], base: number, ids: string[]): boolean {
    if(messages.length - base !== ids.length){
        return false
    }
    for(let i = 0; i < ids.length; i++){
        if(messages[base + i].chatId !== ids[i]){
            return false
        }
    }
    return true
}

/** The base of `history` in `messages`, or -1 when the chat does not show the piece the history last left on screen. */
function validBase(history: RerollHistory, messages: Message[]): number {
    const base = baseAfterAnchor(history.anchor, messages)
    if(base === -1 || !showsPiece(messages, base, history.shownIds)){
        return -1
    }
    return base
}

/**
 * Where a reroll cuts the chat. Counting from the end of the chat, it stops at
 * the last speaker's previous message (the nearest earlier message with the
 * same speaker as the chat's last message), or at the last user message,
 * whichever comes first, and keeps everything up to and including that message. Null when the chat is empty or
 * the count reaches the start of the chat without stopping.
 */
function rerollBase(messages: Message[]): number | null {
    let end = messages.length
    if(end === 0){
        return null
    }
    const saying = messages[end - 1].saying
    let quota = 2
    while(messages[end - 1].role !== 'user'){
        if(messages[end - 1].saying === saying){
            quota -= 1
            if(quota === 0){
                break
            }
        }
        end -= 1
        if(end === 0){
            return null
        }
    }
    return end
}

/** Ends the history of `origin`'s chat. */
export function resetRerollHistory(origin: Origin): void {
    histories.delete(keyOf(origin))
}

/**
 * Moves `origin`'s chat to the previous or the next stored piece. The messages
 * on screen after the base are first stored into the piece being left (in-place
 * edits included), then replaced by a copy of the target piece; nothing at or
 * before the base is written. A chat that does not show the piece the history
 * left on screen ends the history and is not written. Returns whether the
 * chat moved.
 */
export function stepRerollHistory(origin: Origin, direction: 'back' | 'forward'): boolean {
    const key = keyOf(origin)
    const history = histories.get(key)
    if(!history){
        return false
    }
    const target = direction === 'back' ? history.cursor - 1 : history.cursor + 1
    let verdict = 'stay' as 'invalid' | 'stay' | 'move'
    const resolved = readAt(origin, (ctx) => {
        if(validBase(history, ctx.chat.message) === -1){
            verdict = 'invalid'
        }
        else if(target >= 0 && target < history.pieces.length){
            verdict = 'move'
        }
    })
    if(!resolved){
        return false
    }
    if(verdict === 'invalid'){
        histories.delete(key)
        return false
    }
    if(verdict !== 'move'){
        return false
    }
    let moved = false
    writeAt(origin, (ctx) => {
        const messages = ctx.chat.message
        const base = validBase(history, messages)
        if(base === -1){
            return
        }
        history.pieces[history.cursor] = safeStructuredClone(messages.slice(base))
        const piece = safeStructuredClone(history.pieces[target])
        messages.splice(base, messages.length - base, ...piece)
        history.cursor = target
        history.shownIds = idsOf(piece)
        moved = true
    })
    if(moved){
        remember(history)
    }
    return moved
}

/**
 * Cuts `origin`'s chat back to the base a reroll regenerates from, and keeps
 * the messages it removed as the piece on screen of that chat's history: the
 * existing history when it has this same base and the chat still shows its
 * piece, otherwise a new history. Ids are given to the anchor and to the
 * removed messages before the single copy is taken, so the copy written back
 * and the stored piece carry the same ids. Returns null, writing nothing, when
 * the chat cannot be rerolled (gone, empty, or without a stopping point).
 */
export function beginRegeneration(origin: Origin): RerollTicket | null {
    const key = keyOf(origin)
    let rerollable = false
    readAt(origin, (ctx) => {
        rerollable = rerollBase(ctx.chat.message) !== null
    })
    if(!rerollable){
        return null
    }
    let ticket = null as RerollTicket | null
    writeAt(origin, (ctx) => {
        const messages = ctx.chat.message
        const base = rerollBase(messages)
        if(base === null){
            return
        }
        fillIdsFrom(messages, base - 1)
        const full: Message[] = safeStructuredClone(messages)
        const anchor = base > 0 ? full[base - 1].chatId as string : null
        const existing = histories.get(key)
        const sameBase = existing !== undefined && validBase(existing, full) === base
        const tail = full.splice(base)
        ctx.chat.message = full
        let history: RerollHistory
        if(existing !== undefined && sameBase){
            existing.pieces[existing.cursor] = tail
            existing.shownIds = idsOf(tail)
            history = existing
        }
        else{
            history = { key, anchor, pieces: [tail], cursor: 0, shownIds: idsOf(tail) }
        }
        remember(history)
        ticket = { history, anchor, replaceShown: tail.length === 0 }
    })
    return ticket
}

/**
 * The anchor a generation handed to `origin`'s chat is recorded against: the
 * id of the chat's last message (given one when it has none), or null for an
 * empty chat. Undefined when the chat cannot be resolved.
 */
export function anchorAtHandOff(origin: Origin): { anchor: string | null } | undefined {
    let found: { anchor: string | null } | undefined
    let needsId = false
    readAt(origin, (ctx) => {
        const messages = ctx.chat.message
        const last = messages[messages.length - 1]
        if(!last){
            found = { anchor: null }
        }
        else if(last.chatId){
            found = { anchor: last.chatId }
        }
        else{
            needsId = true
        }
    })
    if(needsId){
        writeAt(origin, (ctx) => {
            const messages = ctx.chat.message
            fillIdsFrom(messages, messages.length - 1)
            found = { anchor: messages[messages.length - 1].chatId as string }
        })
    }
    return found
}

/**
 * Records what a generation left after `anchor` in `origin`'s chat, whichever
 * way the generation settled. A reroll (given its `ticket`) stores the result
 * into the history the reroll began or reused (the ticket's history), an empty
 * result included; any other generation
 * that appended nothing records nothing, and one that appended starts a new
 * history. A reroll whose ticket's history is not the chat's current history
 * (it ended or was replaced during generation) records nothing. A generation after which the anchor is
 * not present exactly once records nothing and ends the chat's history. Messages without an id are
 * given one before they are copied.
 */
export function recordGeneration(origin: Origin, anchor: string | null, ticket?: RerollTicket): void {
    const key = keyOf(origin)
    let state = 'gone' as 'gone' | 'anchorLost' | 'empty' | 'ready'
    let needsIds = false
    readAt(origin, (ctx) => {
        const messages = ctx.chat.message
        const base = baseAfterAnchor(anchor, messages)
        if(base === -1){
            state = 'anchorLost'
        }
        else if(!ticket && messages.length === base){
            state = 'empty'
        }
        else{
            state = 'ready'
            needsIds = missingIdFrom(messages, base)
        }
    })
    if(state === 'anchorLost'){
        histories.delete(key)
        return
    }
    if(state !== 'ready'){
        return
    }
    let piece = null as Message[] | null
    const capture = needsIds ? writeAt : readAt
    capture(origin, (ctx) => {
        const messages = ctx.chat.message
        const base = baseAfterAnchor(anchor, messages)
        if(base === -1){
            return
        }
        fillIdsFrom(messages, base)
        piece = safeStructuredClone(messages.slice(base))
    })
    if(piece === null){
        return
    }
    if(ticket){
        const history = ticket.history
        if(histories.get(key) !== history){
            return
        }
        if(ticket.replaceShown){
            history.pieces[history.cursor] = piece
        }
        else{
            history.pieces.push(piece)
            history.cursor = history.pieces.length - 1
        }
        history.shownIds = idsOf(piece)
        remember(history)
        return
    }
    remember({ key, anchor, pieces: [piece], cursor: 0, shownIds: idsOf(piece) })
}
