import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import {
    assembleChat, chatCoreFields, CHUNK_CAP_BYTES, CodecAssembleError, CodecInputError, messageListBytes, sealChunks, splitChat,
    storedMessage, TAIL_STATE_FIELDS, utf8Length,
} from '../../store2/codec'
import { canonicalJson, UNIT_TYPE, type ChatChunk, type ChatCore } from '../../store2/format'
import {
    bodyOf, dbWithCharacters, encodeWith, identitiesWhere, mulberry32, prosePool, roundTrip, sparseCharacter, unitOf, uuidLike, type Obj,
} from './codecFixtures'

const BASE = utf8Length(canonicalJson({ data: '', role: 'user', time: 1 }))

/** A message whose canonical JSON is exactly `BASE + extra` bytes. */
function sized(extra: number): JsonObject {
    return { role: 'user', data: 'x'.repeat(extra), time: 1 }
}

describe('chunk sealing', () => {
    test('messageListBytes is the byte length of the canonical message list', () => {
        const messages = [sized(10), sized(0), { role: 'char', data: 'héllo \u{1F600}', time: 2 }]
        expect(messageListBytes(messages)).toBe(new TextEncoder().encode(canonicalJson(messages)).length)
    })

    test('the cap is 131,072 bytes', () => {
        expect(CHUNK_CAP_BYTES).toBe(131_072)
    })

    test('a list of exactly the cap stays one chunk, one byte more seals', () => {
        const total = 131_072 - 3 - 2 * BASE
        const first = Math.floor(total / 2)
        const exact = [sized(first), sized(total - first)]
        expect(messageListBytes(exact)).toBe(131_072)
        expect(sealChunks(exact)).toHaveLength(1)
        const over = [sized(first), sized(total - first + 1)]
        expect(messageListBytes(over)).toBe(131_073)
        const chunks = sealChunks(over)
        expect(chunks).toHaveLength(2)
        expect(chunks.map(chunk => chunk.length)).toEqual([1, 1])
    })

    test('every chunk but a single oversized message stays within the cap, and order is kept', () => {
        const messages = Array.from({ length: 400 }, (_, i) => ({ role: 'user', data: 'w'.repeat(900 + (i % 7) * 100), time: i }))
        const chunks = sealChunks(messages)
        expect(chunks.length).toBeGreaterThan(2)
        for (const chunk of chunks) {
            expect(messageListBytes(chunk)).toBeLessThanOrEqual(CHUNK_CAP_BYTES)
        }
        expect(chunks.flat()).toEqual(messages)
    })

    test('a message larger than the cap gets a chunk of its own wherever it sits', () => {
        const huge = sized(CHUNK_CAP_BYTES + 10)
        const small = sized(20)
        expect(sealChunks([small, huge, small]).map(chunk => chunk.length)).toEqual([1, 1, 1])
        expect(sealChunks([huge, small]).map(chunk => chunk.length)).toEqual([1, 1])
        expect(sealChunks([small, small, huge]).map(chunk => chunk.length)).toEqual([2, 1])
        expect(sealChunks([huge])).toEqual([[huge]])
    })

    test('an empty chat is one empty chunk', () => {
        expect(sealChunks([])).toEqual([[]])
    })

    test('the cap is a parameter of the split', () => {
        const chat: JsonObject = { message: [sized(40), sized(40), sized(40)], name: 'c' }
        expect(splitChat(chat, 'chat').chunks).toHaveLength(1)
        expect(splitChat(chat, 'chat', BASE * 2 + 3 + 40 * 2 - 1).chunks).toHaveLength(3)
    })
})

describe('chat core and tail state', () => {
    const chat = (): JsonObject => ({
        message: [sized(5), sized(6), sized(7)],
        name: 'C', note: 'n', id: 'chat-1', localLore: [], hypaV3Data: { big: 1 }, bookmarks: ['b'],
        lastMemory: 'memory', scriptstate: { a: 1 }, suggestMessages: ['s'], lastDate: 99,
        isStreaming: true, activeStreamingDisplayOptimizationMode: 'strong', futureChatField: { keep: 'me' },
    })

    test('the core holds everything but the messages, the tail state and the volatile fields', () => {
        const core = chatCoreFields(chat())
        expect(Object.keys(core).sort()).toEqual(['bookmarks', 'futureChatField', 'hypaV3Data', 'id', 'localLore', 'name', 'note'])
        for (const name of TAIL_STATE_FIELDS) {
            expect(name in core).toBe(false)
        }
    })

    test('st is written in the last chunk only', () => {
        const messages = Array.from({ length: 6 }, (_, i) => sized(Math.floor(CHUNK_CAP_BYTES * 0.6) + i))
        const split = splitChat({ ...chat(), message: messages }, 'chat')
        expect(split.chunks.length).toBeGreaterThanOrEqual(3)
        split.chunks.forEach((chunk, index) => {
            expect('st' in chunk).toBe(index === split.chunks.length - 1)
        })
        const last = split.chunks[split.chunks.length - 1]
        expect(last.st).toEqual({ lastMemory: 'memory', scriptstate: { a: 1 }, suggestMessages: ['s'], lastDate: 99 })
    })

    test('an empty chat carries its state in its one empty chunk', () => {
        const split = splitChat({ ...chat(), message: [] }, 'chat')
        expect(split.chunks).toHaveLength(1)
        expect(split.chunks[0].msgs).toEqual([])
        expect(split.chunks[0].st).toBeDefined()
    })

    test('a chat with no per-send field has no st at all', () => {
        const split = splitChat({ message: [sized(3)], name: 'x' }, 'chat')
        expect('st' in split.chunks[0]).toBe(false)
    })

    test('assemble builds core, then st, then the messages', () => {
        const source = chat()
        const split = splitChat(source, 'chat')
        const built = assembleChat(split.core, split.chunks, 'chat')
        const { isStreaming, activeStreamingDisplayOptimizationMode, ...kept } = source
        expect(isStreaming).toBe(true)
        expect(activeStreamingDisplayOptimizationMode).toBe('strong')
        expect(built).toEqual(kept)
    })

    test('state written in a chunk other than the last is refused on assemble', () => {
        const core: ChatCore = { v: 1, f: {} }
        const chunks: ChatChunk[] = [{ v: 1, msgs: [], st: { lastDate: 1 } }, { v: 1, msgs: [] }]
        expect(() => assembleChat(core, chunks, 'chat')).toThrow(CodecAssembleError)
        expect(() => assembleChat(core, [], 'chat')).toThrow(CodecAssembleError)
    })

    test('every message field is stored, the chatId stamp and unknown fields included', () => {
        const message = { role: 'user', data: 'd', chatId: 'stamp', interrupted: true, futureMessageField: [1] }
        const stored = storedMessage(message)
        expect(stored).toEqual(message)
        expect(stored).not.toBe(message)
    })

    test('a bookmarked message keeps its chatId, so the bookmark still resolves after split and assemble', () => {
        const chat = {
            id: 'chat-1',
            name: 'c',
            bookmarks: ['stamp-b'],
            bookmarkNames: { 'stamp-b': 'Marked' },
            message: [
                { role: 'user', data: 'a', time: 1, chatId: 'stamp-a' },
                { role: 'char', data: 'b', time: 2, chatId: 'stamp-b' },
            ],
        } as JsonObject
        const { core, chunks } = splitChat(chat, 'chat')
        const assembled = assembleChat(core, chunks, 'chat')
        const bookmarks = assembled.bookmarks as string[]
        const names = assembled.bookmarkNames as Record<string, string>
        const messages = assembled.message as JsonObject[]
        const marked = messages.filter(message => bookmarks.includes(message.chatId as string))
        expect(marked.map(message => message.data)).toEqual(['b'])
        expect(names[marked[0].chatId as string]).toBe('Marked')
    })

    test('a message list that is not a list or holds a non-object is refused; an absent one is empty', () => {
        expect(() => splitChat({ message: 'text' }, 'chat')).toThrow(CodecInputError)
        expect(() => splitChat({ message: [1] }, 'chat')).toThrow(CodecInputError)
        expect(splitChat({ name: 'x' }, 'chat').chunks[0].msgs).toEqual([])
    })
})

describe('chats in the encoded tree', () => {
    function holder(chats: Obj[]): Obj {
        const rng = mulberry32(5)
        return sparseCharacter(rng, prosePool(rng, 5, 10, 40), 'holder', 'Holder', chats, [])
    }
    function entryOf(tree: ReturnType<typeof encodeWith>): { u: string, chats: { cid: string, core: unknown[], chunks: [string, number, number, number][] }[] } {
        const shards = tree.units.filter(unit => unit.type === UNIT_TYPE.shard).map(bodyOf)
        const entries = shards.flatMap(shard => shard.entries as unknown as { chats: never }[])
        expect(entries).toHaveLength(1)
        return entries[0] as never
    }

    test('chat entries keep the chat order and name the chat id; a missing id or an id held by several chats gets a position handle on every holder', () => {
        const rng = mulberry32(9)
        const chats: Obj[] = [
            { message: [], name: 'a', id: 'one' },
            { message: [], name: 'b' },
            { message: [], name: 'c', id: 'one' },
            { message: [], name: 'd', id: uuidLike(rng) },
        ]
        const tree = encodeWith(dbWithCharacters([holder(chats)]))
        const cids = entryOf(tree).chats.map(chat => chat.cid)
        expect(cids.slice(0, 3)).toEqual(['~0', '~1', '~2'])
        expect(cids[3]).toBe((chats[3] as { id: string }).id)
        const { assembled } = roundTrip(dbWithCharacters([holder(chats)]))
        expect(assembled.characters[0].chats.map(chat => chat.name)).toEqual(['a', 'b', 'c', 'd'])
        expect('id' in assembled.characters[0].chats[1]).toBe(false)
    })

    test('chunk tuples are oldest to newest and carry the unit Ref and the message count', () => {
        const messages = Array.from({ length: 30 }, (_, i) => sized(CHUNK_CAP_BYTES / 8 + i))
        const tree = encodeWith(dbWithCharacters([holder([{ message: messages, name: 'long', id: 'long' }])]))
        const entry = entryOf(tree)
        const tuples = entry.chats[0].chunks
        expect(tuples.length).toBeGreaterThan(2)
        const ids = identitiesWhere(tree, 'chat:').filter(id => id.includes(':chunk:'))
        expect(ids).toHaveLength(tuples.length)
        let counted = 0
        tuples.forEach((tuple, index) => {
            const unit = unitOf(tree, ids.find(id => id.endsWith(`:chunk:${index}`))!)
            expect(tuple.slice(0, 3)).toEqual(unit.ref)
            expect(tuple[3]).toBe((bodyOf(unit).msgs as unknown[]).length)
            counted += tuple[3]
        })
        expect(counted).toBe(30)
        expect(entry.chats[0].chunks.at(-1)?.[0]).toBe(unitOf(tree, ids.find(id => id.endsWith(`:chunk:${tuples.length - 1}`))!).ref[0])
    })

    test('an empty chat has one chunk with count 0, and st only in the last chunk of a longer chat', () => {
        const tree = encodeWith(dbWithCharacters([holder([
            { message: [], name: 'empty', id: 'e', lastDate: 5 },
            { message: Array.from({ length: 12 }, (_, i) => sized(CHUNK_CAP_BYTES / 5 + i)), name: 'long', id: 'l', scriptstate: { k: 1 } },
        ])]))
        const entry = entryOf(tree)
        expect(entry.chats[0].chunks).toHaveLength(1)
        expect(entry.chats[0].chunks[0][3]).toBe(0)
        const emptyChunk = bodyOf(unitOf(tree, `chat:${entry.u}:e:chunk:0`))
        expect(emptyChunk.msgs).toEqual([])
        expect(emptyChunk.st).toEqual({ lastDate: 5 })
        const longCount = entry.chats[1].chunks.length
        expect(longCount).toBeGreaterThan(2)
        for (let k = 0; k < longCount; k++) {
            expect('st' in bodyOf(unitOf(tree, `chat:${entry.u}:l:chunk:${k}`))).toBe(k === longCount - 1)
        }
    })
})
