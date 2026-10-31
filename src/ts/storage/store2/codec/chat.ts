import type { JsonObject, JsonValue } from '../../blockFrame'
import { canonicalJson, isAltRecord, type AltRecord, type ChatAltUnit, type ChatChunk, type ChatCore } from '../format'
import { defineOwn, isJsonObject, listOrEmpty, omitFields, pickFields, utf8Length } from './normalize'
import { CodecAssembleError, CodecInputError } from './types'

/**
 * Chats: a chat core (type 7) plus message chunks (type 8). The chunks are the
 * unit of change, so an appended message rewrites only the last one. The
 * alternatives of a chat (`alt`) are units of their own (type 25), so no reader
 * can take an alternative record for a message or the other way round.
 */

/**
 * Writer parameter, not format: a chunk is sealed once adding the next message
 * would take the canonical JSON of its message list above this many bytes.
 */
export const CHUNK_CAP_BYTES = 131_072

/**
 * Writer parameter, not format: the chat fields that change on a send and so
 * travel with the last chunk (`st`) instead of the chat core.
 */
export const TAIL_STATE_FIELDS = ['lastMemory', 'scriptstate', 'suggestMessages', 'lastDate'] as const

/** Volatile chat fields, never stored. */
export const VOLATILE_CHAT_FIELDS = ['isStreaming', 'activeStreamingDisplayOptimizationMode'] as const

/**
 * Whether `value` is a list of alternative records (the empty list included). A value of any other shape is not
 * interpreted: it stays a core field, travels unchanged and sets no token.
 */
export function isWellFormedAlt(value: JsonValue | undefined): value is AltRecord[] {
    return Array.isArray(value) && value.every(record => isAltRecord(record))
}

/**
 * The chat fields the core holds: all but the messages, the tail state, the volatile fields and a well-formed `alt`
 * (the empty list included, which therefore encodes like an absent one).
 */
export function chatCoreFields(chat: JsonObject): JsonObject {
    const omitted: string[] = ['message', ...TAIL_STATE_FIELDS, ...VOLATILE_CHAT_FIELDS]
    if (isWellFormedAlt(chat.alt)) {
        omitted.push('alt')
    }
    return omitFields(chat, omitted)
}

/** The per-send fields of a chat that it has, or undefined when it has none. */
export function tailState(chat: JsonObject): JsonObject | undefined {
    const state = pickFields(chat, TAIL_STATE_FIELDS)
    return Object.keys(state).length === 0 ? undefined : state
}

/** One message as stored: every field, known or not, including the `chatId` stamp that chat bookmarks refer to. */
export function storedMessage(message: JsonObject): JsonObject {
    return omitFields(message, [])
}

/** The messages of a chat as stored; an absent or null list is empty. */
export function chatMessages(chat: JsonObject, where: string): JsonObject[] {
    return listOrEmpty(chat.message, `${where}.message`).map((message, index) => {
        if (!isJsonObject(message as JsonValue)) {
            throw new CodecInputError(`${where}.message[${index}] is not an object.`)
        }
        return storedMessage(message as JsonObject)
    })
}

/** Bytes of the canonical JSON of `[m1,...,mn]`, the size a chunk is capped by. */
export function messageListBytes(messages: readonly JsonObject[]): number {
    let bytes = 2
    messages.forEach((message, index) => {
        bytes += utf8Length(canonicalJson(message)) + (index > 0 ? 1 : 0)
    })
    return bytes
}

/**
 * Splits `messages` into chunks, oldest first, in order and without splitting a
 * message. A chunk is sealed before the message that would take its list above
 * `cap`; a message that alone exceeds the cap gets a chunk of its own. An empty
 * chat gives one empty chunk, so every chat has at least one.
 */
export function sealChunks(messages: readonly JsonObject[], cap: number = CHUNK_CAP_BYTES): JsonObject[][] {
    const chunks: JsonObject[][] = []
    let current: JsonObject[] = []
    let size = 2
    for (const message of messages) {
        const length = utf8Length(canonicalJson(message))
        const added = length + (current.length > 0 ? 1 : 0)
        if (current.length > 0 && size + added > cap) {
            chunks.push(current)
            current = []
            size = 2
        }
        size += length + (current.length > 0 ? 1 : 0)
        current.push(message)
    }
    chunks.push(current)
    return chunks
}

export interface SplitChat {
    core: ChatCore
    chunks: ChatChunk[]
    /** The alternatives units, oldest record first; none when the chat has no alternatives. */
    alt: ChatAltUnit[]
}

/** The chat core, chunk bodies and alternatives units of `chat` (a plain JSON object). `st` is written in the last chunk only. */
export function splitChat(chat: JsonObject, where: string, cap: number = CHUNK_CAP_BYTES): SplitChat {
    const groups = sealChunks(chatMessages(chat, where), cap)
    const st = tailState(chat)
    const chunks: ChatChunk[] = groups.map((msgs, index) => {
        const body: ChatChunk = { v: 1, msgs }
        if (index === groups.length - 1 && st !== undefined) {
            body.st = st
        }
        return body
    })
    return { core: { v: 1, f: chatCoreFields(chat) }, chunks, alt: splitAlt(chat, cap) }
}

/** The alternatives of `chat` sealed like its messages, in list order; a missing, empty or malformed `alt` gives none. */
function splitAlt(chat: JsonObject, cap: number): ChatAltUnit[] {
    if (!isWellFormedAlt(chat.alt) || chat.alt.length === 0) {
        return []
    }
    const records = chat.alt.map(record => omitFields(record, []))
    // Every record passed `isAltRecord`, and `sealChunks` keeps the objects it is given.
    return sealChunks(records, cap).map((recs): ChatAltUnit => ({ v: 1, recs: recs as AltRecord[] }))
}

/**
 * The chat the core, its chunks (oldest first) and its alternatives units describe:
 * `{ ...core.f, ...tail.st, message, alt }`. `alt` is defined only when there are units; a core that also holds an
 * `alt` field is inconsistent, because the writer takes a well-formed one out of the core.
 */
export function assembleChat(core: ChatCore, chunks: readonly ChatChunk[], where: string, alt: readonly ChatAltUnit[] = []): JsonObject {
    if (chunks.length === 0) {
        throw new CodecAssembleError(`${where} has no chunk.`)
    }
    if (alt.length > 0 && Object.hasOwn(core.f, 'alt')) {
        throw new CodecAssembleError(`${where}: alternatives are held both in the core and in their own units.`)
    }
    const message: JsonObject[] = []
    chunks.forEach((chunk, index) => {
        if (chunk.st !== undefined && index !== chunks.length - 1) {
            throw new CodecAssembleError(`${where}: a chunk other than the last carries per-send state.`)
        }
        for (const item of chunk.msgs) {
            message.push(item)
        }
    })
    const chat: JsonObject = {}
    for (const key of Object.keys(core.f)) {
        defineOwn(chat, key, core.f[key])
    }
    const st = chunks[chunks.length - 1].st
    if (st !== undefined) {
        for (const key of Object.keys(st)) {
            defineOwn(chat, key, st[key])
        }
    }
    defineOwn(chat, 'message', message)
    if (alt.length > 0) {
        defineOwn(chat, 'alt', alt.flatMap(unit => unit.recs))
    }
    return chat
}
