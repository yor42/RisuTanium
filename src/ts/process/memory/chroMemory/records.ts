import type { OpenAIChat } from '../../index.svelte'

export const FIRST_MESSAGE_ID = '#first'

/** What the message loop keeps for one sent message: references only, no computation. */
export interface CapturedMessage {
    msg: { chatId?: string, role: 'user' | 'char', data: string }
    chatIndex: number
    name: string
    preWrap: string
    /** The message text reference at capture; the record hashes this, not a later `msg.data`. */
    data: string
}

export interface FirstMessageSource {
    chat: OpenAIChat
    preWrap: string
    raw: string
}

export interface SendCapture {
    /** A Map.set and one assignment of `newest`; nothing else. */
    add(chat: OpenAIChat, ref: CapturedMessage): void
    readonly refs: ReadonlyMap<OpenAIChat, CapturedMessage>
    readonly newest: CapturedMessage | null
}

export function createSendCapture(): SendCapture {
    const refs = new Map<OpenAIChat, CapturedMessage>()
    let newest: CapturedMessage | null = null
    return {
        add(chat, ref) {
            refs.set(chat, ref)
            newest = ref
        },
        refs,
        get newest() {
            return newest
        },
    }
}

export interface MessageRecord {
    chatId: string
    index: number
    role: 'user' | 'char'
    name: string
    rawHash: string
    preWrap: string
}

/** Two independent 32-bit lanes (FNV-1a and a cyrb-style mix) plus the length: a collision between different texts is negligible. */
export function rawHash(data: string): string {
    let h1 = 0x811c9dc5
    let a = 0xdeadbeef
    let b = 0x41c6ce57
    for (let i = 0; i < data.length; i++) {
        const unit = data.charCodeAt(i)
        h1 = Math.imul(h1 ^ unit, 0x01000193) >>> 0
        a = Math.imul(a ^ unit, 2654435761)
        b = Math.imul(b ^ unit, 1597334677)
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
    const h2 = ((b >>> 0) ^ (a >>> 0)) >>> 0
    return `${data.length}:${h1.toString(16)}:${h2.toString(16)}`
}

const hashMemo = new WeakMap<object, { data: string, hash: string }>()

/** Reuses the stored hash while the key was last hashed from this same text; weak keys keep no message alive. */
export function rawHashOf(key: object, data: string): string {
    const entry = hashMemo.get(key)
    if (entry && entry.data === data) return entry.hash
    const hash = rawHash(data)
    hashMemo.set(key, { data, hash })
    return hash
}

const THOUGHTS = /<Thoughts>(.+?)<\/Thoughts>/gms
const ASSET_PROMPT = /\{\{asset_?prompt::(.+?)\}\}/gmsiu

/** The message loop's text after its two later removals; the sent content minus the speaker wrap. */
export function recordTextOf(preWrap: string): string {
    return preWrap.replace(THOUGHTS, '').replace(ASSET_PROMPT, '')
}

export function recordOf(ref: CapturedMessage, userName: string): MessageRecord {
    return {
        chatId: ref.msg.chatId ?? '',
        index: ref.chatIndex,
        role: ref.msg.role,
        name: ref.msg.role === 'char' ? ref.name : userName,
        rawHash: rawHashOf(ref.msg, ref.data),
        preWrap: ref.preWrap,
    }
}

export function firstRecordOf(src: FirstMessageSource, charName: string): MessageRecord {
    return {
        chatId: FIRST_MESSAGE_ID,
        index: -1,
        role: 'char',
        name: charName,
        rawHash: rawHash(src.raw),
        preWrap: src.preWrap,
    }
}
