/**
 * `chatListModel.ts`: the pure model behind the new shell's chat list.
 *
 * Invariants exercised here:
 * - Folders come first (their chats under them unless the folder is folded), unfiled chats after.
 * - Recent order is newest first and stable; an empty chat counts as newest; My order is the array order.
 * - A chat whose folder id matches no folder is listed as unfiled, never dropped.
 * - The mounted window never exceeds 40 rows, however many chats exist.
 * - A preview is plain text capped at 200 characters; markup tags are dropped.
 * - Alt+arrow neighbours follow the listed order and skip folder headers.
 */
import { describe, expect, test } from 'vitest'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import { coldStorageHeader } from '../process/coldstorageData'
import {
    ROW_HEIGHT,
    MAX_MOUNTED_ROWS,
    adjacentChat,
    chatListItems,
    chatRecency,
    isArchivedChat,
    previewLine,
    rowTime,
    windowRange,
} from './chatListModel'

type Entry = Database['characters'][number]

function chat(name: string, extra: Partial<Chat> & { times?: number[] } = {}): Chat {
    const { times, ...rest } = extra
    const message = (times ?? []).map((time, i) => ({ role: i % 2 === 0 ? 'char' : 'user', data: `${name} ${i}`, time }))
    return { name, message, note: '', localLore: [], ...rest } as unknown as Chat
}

function owner(chats: Chat[], chatFolders: ChatFolder[] = []): Entry {
    return { type: 'character', chaId: 'a', name: 'A', chats, chatFolders, chatPage: 0 } as unknown as Entry
}

function names(items: ReturnType<typeof chatListItems>): string[] {
    return items.map((item) => (item.kind === 'folder' ? `[${item.folder.name}]` : (item.chat as Chat).name))
}

describe('chatRecency', () => {
    test('TC1: the last message time decides; an empty chat is newest; no time falls back to lastDate, then 0', () => {
        expect(chatRecency(chat('t', { times: [10, 30] }))).toBe(30)
        expect(chatRecency(chat('empty'))).toBe(Infinity)
        expect(chatRecency(chat('d', { times: [undefined as unknown as number], lastDate: 77 }))).toBe(77)
        expect(chatRecency(chat('none', { times: [undefined as unknown as number] }))).toBe(0)
    })
})

describe('chatListItems', () => {
    test('TC1: Recent lists folders first, their chats under them, then unfiled chats, newest first', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        const o = owner([
            chat('old', { times: [1] }),
            chat('infolder-old', { times: [5], folderId: 'f1' }),
            chat('new', { times: [90] }),
            chat('infolder-new', { times: [50], folderId: 'f1' }),
        ], [folder])
        expect(names(chatListItems(o, 'recent'))).toEqual(['[Work]', 'infolder-new', 'infolder-old', 'new', 'old'])
    })

    test('TC1: an empty chat leads the unfiled chats in Recent; equal times keep the array order', () => {
        const o = owner([chat('x', { times: [5] }), chat('y', { times: [5] }), chat('fresh')])
        expect(names(chatListItems(o, 'recent'))).toEqual(['fresh', 'x', 'y'])
    })

    test('TC1: My order is the array order inside each group', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        const o = owner([
            chat('b', { times: [1] }),
            chat('f-late', { times: [99], folderId: 'f1' }),
            chat('a', { times: [50] }),
            chat('f-early', { times: [2], folderId: 'f1' }),
        ], [folder])
        expect(names(chatListItems(o, 'manual'))).toEqual(['[Work]', 'f-late', 'f-early', 'b', 'a'])
    })

    test('a folded folder keeps its header and count but lists none of its chats', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: true }
        const o = owner([chat('inside', { folderId: 'f1' }), chat('outside')], [folder])
        const items = chatListItems(o, 'recent')
        expect(names(items)).toEqual(['[Work]', 'outside'])
        const header = items[0]
        expect(header.kind === 'folder' && header.count).toBe(1)
        expect(header.kind === 'folder' && header.folded).toBe(true)
    })

    test('a chat whose folder id matches no folder is listed as unfiled', () => {
        const o = owner([chat('orphan', { folderId: 'gone' })], [{ id: 'f1', name: 'Work', folded: false }])
        expect(names(chatListItems(o, 'recent'))).toEqual(['[Work]', 'orphan'])
    })

    test('level, position and set size describe the tree', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        const o = owner([chat('in1', { folderId: 'f1' }), chat('in2', { folderId: 'f1' }), chat('top')], [folder])
        const items = chatListItems(o, 'manual')
        expect(items.map((i) => [i.level, i.posinset, i.setsize])).toEqual([[1, 1, 2], [2, 1, 2], [2, 2, 2], [1, 2, 2]])
    })

    test('an owner without chats or folders gives an empty list', () => {
        expect(chatListItems({ type: 'character', chaId: 'a' } as unknown as Entry, 'recent')).toEqual([])
    })
})

describe('previewLine and rowTime', () => {
    test('TC2: the preview is the last message as plain text, tags dropped, capped at 200 characters', () => {
        const c = chat('p', { times: [1] })
        c.message[0].data = '<span class="x">Hello</span>  <b>there</b>\nfriend'
        expect(previewLine(c)).toBe('Hello there friend')
        c.message[0].data = 'x'.repeat(500)
        expect(previewLine(c).length).toBe(200)
        expect(previewLine(chat('empty'))).toBe('')
    })

    test('TC2: an unclosed tag at the end is dropped too', () => {
        const c = chat('p', { times: [1] })
        c.message[0].data = 'visible <img src="a'
        expect(previewLine(c)).toBe('visible')
    })

    test('TC2: rowTime shows a time for today, a date for another day, nothing for an empty chat', () => {
        const now = new Date(2026, 5, 15, 18, 0, 0).getTime()
        const today = new Date(2026, 5, 15, 9, 5, 0).getTime()
        const older = new Date(2026, 4, 2, 9, 5, 0).getTime()
        const lastYear = new Date(2025, 4, 2, 9, 5, 0).getTime()
        expect(rowTime(chat('t', { times: [today] }), now, 'en-US')).toMatch(/9:05/)
        expect(rowTime(chat('o', { times: [older] }), now, 'en-US')).toMatch(/May/)
        expect(rowTime(chat('o', { times: [older] }), now, 'en-US')).not.toMatch(/2026/)
        expect(rowTime(chat('y', { times: [lastYear] }), now, 'en-US')).toMatch(/2025/)
        expect(rowTime(chat('empty'), now, 'en-US')).toBe('')
    })
})

describe('isArchivedChat', () => {
    test('a chat whose first message is the cold header is archived', () => {
        const archived = chat('c', { times: [1] })
        archived.message[0].data = `${coldStorageHeader}abc`
        expect(isArchivedChat(archived)).toBe(true)
        expect(isArchivedChat(chat('plain', { times: [1] }))).toBe(false)
        expect(isArchivedChat(chat('empty'))).toBe(false)
    })
})

describe('windowRange', () => {
    test('TC3: 1,000 rows never mount more than the cap, wherever the scroll is', () => {
        for (const top of [0, 1, 500, 12_345, 55_000, 1_000_000]) {
            const range = windowRange(1000, top, 700)
            expect(range.end - range.start).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
            expect(range.start).toBeGreaterThanOrEqual(0)
            expect(range.end).toBeLessThanOrEqual(1000)
        }
        expect(MAX_MOUNTED_ROWS).toBe(40)
    })

    test('TC3: the window covers the visible rows and clamps at both ends', () => {
        const mid = windowRange(1000, ROW_HEIGHT * 100, ROW_HEIGHT * 10)
        expect(mid.start).toBeLessThanOrEqual(100)
        expect(mid.end).toBeGreaterThanOrEqual(110)
        const tail = windowRange(1000, ROW_HEIGHT * 5000, ROW_HEIGHT * 10)
        expect(tail.end).toBe(1000)
        expect(tail.start).toBeLessThan(1000)
        expect(windowRange(0, 0, 500)).toEqual({ start: 0, end: 0 })
        expect(windowRange(3, 0, 500)).toEqual({ start: 0, end: 3 })
    })
})

describe('adjacentChat', () => {
    const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
    const o = owner([chat('one', { folderId: 'f1' }), chat('two'), chat('three')], [folder])
    const items = chatListItems(o, 'manual')
    const [one, two, three] = [o.chats[0], o.chats[1], o.chats[2]]

    test('TC6: it steps through the listed chats and skips folder headers', () => {
        expect(adjacentChat(items, one, 1)).toBe(two)
        expect(adjacentChat(items, two, 1)).toBe(three)
        expect(adjacentChat(items, three, -1)).toBe(two)
        expect(adjacentChat(items, two, -1)).toBe(one)
    })

    test('TC6: it does not wrap at either end', () => {
        expect(adjacentChat(items, three, 1)).toBeUndefined()
        expect(adjacentChat(items, one, -1)).toBeUndefined()
    })

    test('TC6: a current chat that is not listed (folded away) goes to the nearest end in the key direction', () => {
        const folded = owner([chat('hidden', { folderId: 'f1' }), chat('shown')], [{ ...folder, folded: true }])
        const listed = chatListItems(folded, 'manual')
        expect(adjacentChat(listed, folded.chats[0], 1)).toBe(folded.chats[1])
        expect(adjacentChat(listed, folded.chats[0], -1)).toBe(folded.chats[1])
        expect(adjacentChat(listed, undefined, 1)).toBe(folded.chats[1])
    })
})
