/**
 * The story shelf's pool, current chat, snapshot and live resolution
 * (`homeStories.ts`).
 *
 * Invariants exercised here:
 * - The pool is the live, visible characters with a numeric `lastInteraction`
 *   above 0, most recent first, at most six, groups and archived stubs included.
 * - A card names the chat that opens (`chatPage`, else the first chat), and an
 *   archived entry's `chats` is never read.
 * - `freezeStories` copies strings only; `resolveFrozen` keeps the frozen order,
 *   drops removed entries and lets the live archived state gate the text.
 */
import { describe, test, expect } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import type { ShardEntry } from '../../../ts/storage/store2/format'
import { stubFromEntry } from '../../../ts/storage/store2/codec/stub'
import { buildColdStub } from '../../../ts/process/tests/coldStubFixture'
import { coldStorageHeader } from '../../../ts/process/coldstorageData'
import { STORY_CAP, currentChat, freezeStories, isStory, resolveFrozen, storyOrder } from './homeStories'

type Entry = Database['characters'][number]
type Chat = Entry['chats'][number]

function chat(name: string, texts: string[] = [], extra: Record<string, unknown> = {}): Chat {
    return {
        id: `id-${name}`,
        name,
        message: texts.map((data, i) => ({ role: i % 2 === 0 ? 'char' : 'user', data, time: 1000 + i })),
        note: '',
        localLore: [],
        ...extra,
    } as unknown as Chat
}

function entry(chaId: unknown, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: String(chaId), chats: [chat(`Chat-${String(chaId)}`, [`Line ${String(chaId)}`])], chatPage: 0, ...extra } as unknown as Entry
}

function ids(list: Entry[]): string[] {
    return list.map((c) => c.chaId)
}

/** The probe makes any read of the stub's placeholder chats fail loudly. */
function withChatsProbe<T extends object>(stub: T): T {
    Object.defineProperty(stub, 'chats', { get: () => { throw new Error('stub chats read') }, configurable: true })
    return stub
}

function coldStub(chaId: string, lastInteraction: number): Entry {
    return buildColdStub(entry(chaId, { lastInteraction }) as never, `unit-${chaId}`, []) as unknown as Entry
}

describe('isStory', () => {
    test('S3a-U1 rows: only a number above 0 qualifies', () => {
        expect(isStory(entry('a', { lastInteraction: 5 }))).toBe(true)
        expect(isStory(entry('a', { lastInteraction: Infinity }))).toBe(true)
        expect(isStory(entry('a', { lastInteraction: 8.7e15 }))).toBe(true)
        expect(isStory(entry('a', { lastInteraction: 0 }))).toBe(false)
        expect(isStory(entry('a', { lastInteraction: -3 }))).toBe(false)
        expect(isStory(entry('a', { lastInteraction: NaN }))).toBe(false)
        expect(isStory(entry('a', { lastInteraction: '5' }))).toBe(false)
        expect(isStory(entry('a'))).toBe(false)
        expect(isStory(null)).toBe(false)
        expect(isStory(undefined)).toBe(false)
    })
})

describe('storyOrder', () => {
    test('S3a-U1: the pool excludes non-stories, trashed, hidden and duplicate entries; groups stay', () => {
        const list = [
            entry('zero', { lastInteraction: 0 }),
            entry('undef'),
            entry('nan', { lastInteraction: NaN }),
            entry('str', { lastInteraction: '5' }),
            entry('c1', { lastInteraction: 1 }),
            entry('c2', { lastInteraction: 2 }),
            entry('c3', { lastInteraction: 3 }),
            entry('trashed', { lastInteraction: 99, trashTime: 5 }),
            entry('§playground', { lastInteraction: 98 }),
            entry('grp', { type: 'group', lastInteraction: 6 }),
            entry('c4', { lastInteraction: 4 }),
            entry('c5', { lastInteraction: 5 }),
            entry('c4', { lastInteraction: 4 }),
        ]
        expect(storyOrder(list)).toEqual(['grp', 'c5', 'c4', 'c3', 'c2', 'c1'])
    })

    test('S3a-U1b: a NaN time does not disturb the order of the others', () => {
        const list = [
            entry('a', { lastInteraction: 3000 }),
            entry('b', { lastInteraction: 1000 }),
            entry('c', { lastInteraction: NaN }),
            entry('d', { lastInteraction: 2000 }),
        ]
        expect(storyOrder(list)).toEqual(['a', 'd', 'b'])
    })

    test('S3a-U1b: Infinity and out-of-range times stay stories, ordered by position', () => {
        const list = [
            entry('a', { lastInteraction: 5 }),
            entry('inf', { lastInteraction: Infinity }),
            entry('far', { lastInteraction: 8.7e15 }),
        ]
        expect(storyOrder(list)).toEqual(['inf', 'far', 'a'])
    })

    test('S3a-U2: the cap is six and a short pool stays short', () => {
        const eight = Array.from({ length: 8 }, (_, i) => entry(`s${i + 1}`, { lastInteraction: (8 - i) * 1000 }))
        expect(STORY_CAP).toBe(6)
        expect(storyOrder(eight)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6'])
        expect(storyOrder(eight.slice(0, 3))).toEqual(['s1', 's2', 's3'])
    })

    test('S3a-U3: archived stubs from both real producers qualify by their lastInteraction', () => {
        const fromBuilder = coldStub('built', 500)
        const shard = {
            u: 'unit-shard', type: 'character', name: 'shard', chaId: 'shard', creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
            lastInteraction: 900, tags: [], creator: '', chats: [{}],
        } as unknown as ShardEntry
        const fromShard = stubFromEntry(shard) as unknown as Entry
        expect(storyOrder([fromBuilder, entry('warm', { lastInteraction: 100 }), fromShard])).toEqual(['shard', 'built', 'warm'])
    })
})

describe('currentChat', () => {
    test('S3a-U4: chatPage picks the chat, an invalid page falls back to the first, no chats gives null', () => {
        const chats = [chat('old', ['x']), chat('newer', ['y'], { lastDate: 99 }), chat('third')]
        chats[1].message[0].time = 99999
        expect(currentChat(entry('a', { chats, chatPage: 1 }))?.name).toBe('newer')
        expect(currentChat(entry('a', { chats, chatPage: 9 }))?.name).toBe('old')
        expect(currentChat(entry('a', { chats, chatPage: -1 }))?.name).toBe('old')
        expect(currentChat(entry('a', { chats: [] }))).toBeNull()
        expect(currentChat(entry('a', { chats: undefined }))).toBeNull()
    })

    test('S3a-U5: an archived entry returns null without reading its chats', () => {
        const stub = withChatsProbe(coldStub('p', 10))
        expect(() => currentChat(stub)).not.toThrow()
        expect(currentChat(stub)).toBeNull()
    })
})

describe('freezeStories', () => {
    test('S3a-U11: records hold the label and snippet as strings', () => {
        const list = [
            entry('w', { lastInteraction: 9, chats: [chat('C', ['L'])] }),
            entry('unnamed', { lastInteraction: 8, chats: [chat('', ['M'])] }),
            entry('none', { lastInteraction: 7, chats: [] }),
        ]
        expect(freezeStories(list, 'UNNAMED')).toEqual([
            { chaId: 'w', chatLabel: 'C', snippet: 'L' },
            { chaId: 'unnamed', chatLabel: 'UNNAMED', snippet: 'M' },
            { chaId: 'none', chatLabel: null, snippet: '' },
        ])
    })

    test('S3a-U11: an archived entry is frozen without reading its chats', () => {
        const stub = withChatsProbe(coldStub('arch', 10))
        expect(freezeStories([stub], 'UNNAMED')).toEqual([{ chaId: 'arch', chatLabel: null, snippet: '' }])
    })

    test('S3a-U11: a chat whose first message is the cold header keeps its name and has no snippet', () => {
        const cold = chat('C', [`${coldStorageHeader}unit-1`, 'tail'])
        const list = [entry('a', { lastInteraction: 1, chats: [cold] })]
        expect(freezeStories(list, 'UNNAMED')).toEqual([{ chaId: 'a', chatLabel: 'C', snippet: '' }])
    })

    test('S3a-U11: a later rename or new message does not reach the frozen record', () => {
        const live = chat('C', ['L'])
        const list = [entry('a', { lastInteraction: 1, chats: [live] })]
        const frozen = freezeStories(list, 'UNNAMED')
        live.name = 'X'
        live.message.push({ role: 'char', data: 'New', time: 5 } as never)
        expect(frozen).toEqual([{ chaId: 'a', chatLabel: 'C', snippet: 'L' }])
        expect(Object.keys(frozen[0]).sort()).toEqual(['chaId', 'chatLabel', 'snippet'])
    })

    test('S3a-U11: order and cap equal storyOrder', () => {
        const list = Array.from({ length: 9 }, (_, i) => entry(`s${i}`, { lastInteraction: (i % 4) * 10 + i + 1 }))
        expect(freezeStories(list, 'U').map((s) => s.chaId)).toEqual(storyOrder(list))
    })
})

describe('resolveFrozen', () => {
    function warmList(): Entry[] {
        return ['a', 'b', 'c'].map((id, i) => entry(id, {
            lastInteraction: (3 - i) * 1000,
            chats: [chat(`Chat-${id.toUpperCase()}`, [`Line ${id.toUpperCase()}`])],
        }))
    }

    test('S3a-U6: removals drop out; additions and reordering are not applied', () => {
        const list = warmList()
        const frozen = freezeStories(list, 'U')
        expect(resolveFrozen(frozen, list).map((s) => s.entry.chaId)).toEqual(['a', 'b', 'c'])

        list[1].trashTime = 5
        expect(resolveFrozen(frozen, list).map((s) => s.entry.chaId)).toEqual(['a', 'c'])

        list.splice(2, 1)
        expect(resolveFrozen(frozen, list).map((s) => s.entry.chaId)).toEqual(['a'])

        list.push(entry('new', { lastInteraction: 9e6 }))
        list[0].lastInteraction = 1
        expect(resolveFrozen(frozen, list).map((s) => s.entry.chaId)).toEqual(['a'])
    })

    test('S3a-U6: a hidden system entry drops out', () => {
        const list = warmList()
        const frozen = freezeStories(list, 'U')
        list[0].chaId = '§temp'
        expect(resolveFrozen(frozen, list).map((s) => s.entry.chaId)).toEqual(['b', 'c'])
    })

    test('S3a-U6 gate: the live archived state blanks the frozen text', () => {
        const list = warmList()
        const frozen = freezeStories(list, 'U')
        const warm = resolveFrozen(frozen, list)[0]
        expect(warm).toMatchObject({ archived: false, chatLabel: 'Chat-A', snippet: 'Line A' })

        list[0] = buildColdStub(list[0] as never, 'unit-a', []) as unknown as Entry
        const archived = resolveFrozen(frozen, list)[0]
        expect(archived).toMatchObject({ archived: true, chatLabel: null, snippet: '' })
    })

    test('S3a-U6 reverse: a record frozen archived stays text-free after the entry is warm', () => {
        const live = entry('a', { lastInteraction: 5, chats: [chat('Live', ['Live line'])] })
        const resolved = resolveFrozen([{ chaId: 'a', chatLabel: null, snippet: '' }], [live])
        expect(resolved).toHaveLength(1)
        expect(resolved[0]).toMatchObject({ archived: false, chatLabel: null, snippet: '' })
        expect(resolved[0].entry).toBe(live)
    })

    test('S3a-U6: the first holder of a duplicate chaId is the live entry', () => {
        const first = entry('a', { lastInteraction: 5 })
        const second = entry('a', { lastInteraction: 9 })
        const resolved = resolveFrozen([{ chaId: 'a', chatLabel: 'c', snippet: 's' }], [first, second])
        expect(resolved[0].entry).toBe(first)
    })
})
