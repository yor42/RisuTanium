import type { JsonObject, JsonValue } from '../../blockFrame'
import { canonicalJson, type ChatChunk, type ChatCore } from '../format'
import { defineOwn, isJsonObject, listOrEmpty, omitFields, pickFields, utf8Length } from './normalize'
import { CodecAssembleError, CodecInputError } from './types'

/**
 * Chats: a chat core (type 7) plus message chunks (type 8). The chunks are the
 * unit of change, so an appended message rewrites only the last one.
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

/** The chat fields the core holds: all but the messages, the tail state and the volatile fields. */
export function chatCoreFields(chat: JsonObject): JsonObject {
    return omitFields(chat, ['message', ...TAIL_STATE_FIELDS, ...VOLATILE_CHAT_FIELDS])
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
}

/** The chat core and chunk bodies of `chat` (a plain JSON object). `st` is written in the last chunk only. */
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
    return { core: { v: 1, f: chatCoreFields(chat) }, chunks }
}

/** The chat the core and its chunks (oldest first) describe: `{ ...core.f, ...tail.st, message }`. */
export function assembleChat(core: ChatCore, chunks: readonly ChatChunk[], where: string): JsonObject {
    if (chunks.length === 0) {
        throw new CodecAssembleError(`${where} has no chunk.`)
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
    return chat
}
