/**
 * The pure model of reordering the chat list: where a chat or folder lands among its siblings.
 *
 * Invariants:
 * - A chat's siblings are the chats of its own group (its known folder, else unfiled; a dangling folder id is unfiled); a
 *   folder's siblings are the folders. Nothing here ever moves an item into another group.
 * - A move that changes nothing (onto the item itself, onto its successor, to the end when already last) is null.
 * - The gaps beside the dragged row are no-ops, and a pointer outside the group lands at the group's edge.
 *
 * MOCKED: the modules chatOrder imports for its live writes; the list model and the geometry are real.
 */
import { describe, expect, test, vi } from 'vitest'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => ({ DBState: { db: { characters: [] } }, selIdState: { selId: -1 } }) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { AUTOSCROLL_MAX_PX, autoscrollDelta, indicatorGap, reorderedChats, reorderedFolders, reorderedSiblings, siblingDropTarget, siblingEdges, stepTarget } from './chatOrder'
import { ROW_HEIGHT, chatListItems } from './chatListModel'

type Entry = Database['characters'][number]

function chat(id: string, folderId?: string): Chat {
    return { id, name: id, message: [{ role: 'user', data: id, time: 1 }], note: '', localLore: [], fmIndex: -1, ...(folderId ? { folderId } : {}) } as unknown as Chat
}

function folder(id: string, folded = false): ChatFolder {
    return { id, name: id, folded }
}

function owner(chats: Chat[], chatFolders: ChatFolder[]): Entry {
    return { type: 'character', chaId: 'A', name: 'A', chats, chatPage: 0, chatFolders } as unknown as Entry
}

describe('reorderedSiblings', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd']

    test('moves an item directly before another, or to the end for null', () => {
        expect(reorderedSiblings([a, b, c, d], d, b)).toEqual([a, d, b, c])
        expect(reorderedSiblings([a, b, c, d], a, d)).toEqual([b, c, a, d])
        expect(reorderedSiblings([a, b, c, d], a, null)).toEqual([b, c, d, a])
    })

    test('is null when nothing would change', () => {
        expect(reorderedSiblings([a, b, c], b, b)).toBeNull()
        expect(reorderedSiblings([a, b, c], b, c)).toBeNull()
        expect(reorderedSiblings([a, b, c], c, null)).toBeNull()
        expect(reorderedSiblings([a], a, null)).toBeNull()
    })

    test('is null for an item or a before that is not in the list', () => {
        expect(reorderedSiblings([a, b], 'x', a)).toBeNull()
        expect(reorderedSiblings([a, b], a, 'x')).toBeNull()
    })

    test('does not change the list it was given', () => {
        const list = [a, b, c]
        reorderedSiblings(list, c, a)
        expect(list).toEqual([a, b, c])
    })
})

describe('reorderedChats', () => {
    function fixture() {
        const folders = [folder('f1'), folder('f2')]
        const chats = [chat('u1'), chat('m1', 'f1'), chat('d1', 'gone'), chat('n1', 'f2'), chat('m2', 'f1'), chat('u2')]
        return { folders, chats, byId: (id: string) => chats.find((c) => c.id === id)! }
    }

    test('refills only the slots of the moved chat\'s group, in the new order', () => {
        const { folders, chats, byId } = fixture()
        const next = reorderedChats(chats, folders, byId('m2'), byId('m1'))
        expect(next!.map((c) => c.id)).toEqual(['u1', 'm2', 'd1', 'n1', 'm1', 'u2'])
        expect(next).not.toBe(chats)
        expect(chats.map((c) => c.id)).toEqual(['u1', 'm1', 'd1', 'n1', 'm2', 'u2'])
    })

    test('a dangling folder id is unfiled and moves among the unfiled chats', () => {
        const { folders, chats, byId } = fixture()
        const next = reorderedChats(chats, folders, byId('u2'), byId('u1'))
        expect(next!.map((c) => c.id)).toEqual(['u2', 'm1', 'u1', 'n1', 'm2', 'd1'])
    })

    test('keeps every object, the length, the keys and the folder ids', () => {
        const { folders, chats, byId } = fixture()
        const keys = new Map(chats.map((c) => [c, Object.keys(c).join()]))
        const filed = new Map(chats.map((c) => [c, c.folderId]))
        const next = reorderedChats(chats, folders, byId('u2'), null)
        expect(next).toBeNull()
        const moved = reorderedChats(chats, folders, byId('u1'), null)!
        expect(moved).toHaveLength(chats.length)
        expect(new Set(moved)).toEqual(new Set(chats))
        for (const entry of moved) {
            expect(Object.keys(entry).join()).toBe(keys.get(entry))
            expect(entry.folderId).toBe(filed.get(entry))
        }
    })

    test('is null for a no-op move', () => {
        const { folders, chats, byId } = fixture()
        expect(reorderedChats(chats, folders, byId('m1'), byId('m1'))).toBeNull()
        expect(reorderedChats(chats, folders, byId('m1'), byId('m2'))).toBeNull()
        expect(reorderedChats(chats, folders, byId('m2'), null)).toBeNull()
    })
})

describe('reorderedFolders', () => {
    test('moves a folder among the folders', () => {
        const [x, y, z] = [folder('x'), folder('y'), folder('z')]
        expect(reorderedFolders([x, y, z], z, x)).toEqual([z, x, y])
        expect(reorderedFolders([x, y, z], x, y)).toBeNull()
    })
})

describe('the list geometry', () => {
    // Rows: 0 header F, 1 a, 2 m, 3 b (members of F), 4 x, 5 y (unfiled).
    function n2() {
        const [a, m, b] = [chat('a', 'F'), chat('m', 'F'), chat('b', 'F')]
        const [x, y] = [chat('x'), chat('y')]
        const F = folder('F')
        const items = chatListItems(owner([a, m, b, x, y], [F]), 'manual')
        return { items, a, m, b, x, y, F }
    }

    const gapPx = (gap: number) => gap * ROW_HEIGHT

    test('the gaps beside the dragged row drop onto the row itself and its successor, which change nothing', () => {
        const { items, m, b, x, y, F } = n2()
        expect(siblingDropTarget(items, m, gapPx(2))).toEqual({ before: m })
        expect(siblingDropTarget(items, m, gapPx(3))).toEqual({ before: b })
        expect(siblingDropTarget(items, b, gapPx(3))).toEqual({ before: b })
        expect(siblingDropTarget(items, b, gapPx(4))).toEqual({ before: null })
        expect(siblingDropTarget(items, x, gapPx(4))).toEqual({ before: x })
        expect(siblingDropTarget(items, x, gapPx(5))).toEqual({ before: y })
        expect(siblingDropTarget(items, y, gapPx(5))).toEqual({ before: y })
        expect(siblingDropTarget(items, y, gapPx(6))).toEqual({ before: null })
        expect(siblingDropTarget(items, F, gapPx(0))).toEqual({ before: F })
        expect(siblingDropTarget(items, F, gapPx(1))).toEqual({ before: null })
    })

    test('a pointer outside the group lands at the group\'s edge', () => {
        const { items, a, b, x, y } = n2()
        expect(siblingDropTarget(items, x, gapPx(1))).toEqual({ before: x })
        expect(siblingDropTarget(items, y, gapPx(0))).toEqual({ before: x })
        expect(siblingDropTarget(items, a, gapPx(5))).toEqual({ before: null })
        expect(siblingDropTarget(items, a, gapPx(99))).toEqual({ before: null })
        expect(siblingDropTarget(items, b, -300)).toEqual({ before: a })
    })

    test('a drop before the item\'s predecessor is a move', () => {
        const { items, m, a } = n2()
        expect(siblingDropTarget(items, m, gapPx(1))).toEqual({ before: a })
    })

    test('a dragged item that is no longer listed has no target', () => {
        const { items } = n2()
        expect(siblingDropTarget(items, chat('gone'), gapPx(2))).toBeNull()
        expect(siblingDropTarget(items, folder('gone'), gapPx(2))).toBeNull()
    })

    test('folders are siblings of folders only', () => {
        const [c1, c2] = [chat('c1', 'F1'), chat('c2', 'F2')]
        const [F1, F2] = [folder('F1'), folder('F2')]
        const items = chatListItems(owner([c1, c2], [F1, F2]), 'manual')
        // 0 F1, 1 c1, 2 F2, 3 c2
        expect(siblingDropTarget(items, F2, gapPx(1))).toEqual({ before: F2 })
        expect(siblingDropTarget(items, F2, gapPx(0))).toEqual({ before: F1 })
        expect(siblingDropTarget(items, F1, gapPx(4))).toEqual({ before: null })
    })

    test('the siblings of a member stop at its folder\'s edge, however the next folder\'s members are interleaved in the array', () => {
        const [a1, b1, a2, b2, b3] = [chat('a1', 'F1'), chat('b1', 'F2'), chat('a2', 'F1'), chat('b2', 'F2'), chat('b3', 'F2')]
        const [F1, F2] = [folder('F1'), folder('F2')]
        const list = [a1, b1, a2, b2, b3]
        const items = chatListItems(owner(list, [F1, F2]), 'manual')
        // 0 F1, 1 a1, 2 a2, 3 F2, 4 b1, 5 b2, 6 b3
        expect(siblingDropTarget(items, b2, gapPx(1))).toEqual({ before: b1 })
        expect(siblingDropTarget(items, b2, gapPx(2))).toEqual({ before: b1 })
        expect(siblingDropTarget(items, a1, gapPx(5))).toEqual({ before: null })
        expect(siblingDropTarget(items, a1, gapPx(3))).toEqual({ before: null })
        expect(stepTarget(items, a2, 'down')).toBeNull()
        expect(stepTarget(items, b1, 'up')).toBeNull()
        expect(indicatorGap(items, a1, { before: null })).toBe(3)
        expect(indicatorGap(items, b3, { before: b1 })).toBe(4)
        const edges = siblingEdges(items)
        expect(edges.get(a2)).toEqual({ first: false, last: true })
        expect(edges.get(b1)).toEqual({ first: true, last: false })
        // The slots of the other folder's members stay where they are.
        expect(reorderedChats(list, [F1, F2], b3, b1)).toEqual([a1, b3, a2, b1, b2])
        expect(reorderedChats(list, [F1, F2], a1, null)).toEqual([a2, b1, a1, b2, b3])
    })

    test('a dangling-id chat is a sibling of the unfiled chats', () => {
        const [dangling, x] = [chat('d', 'gone'), chat('x')]
        const items = chatListItems(owner([dangling, x], [folder('F')]), 'manual')
        // 0 F, 1 d, 2 x
        expect(siblingDropTarget(items, x, gapPx(0))).toEqual({ before: dangling })
    })

    test('indicatorGap is the index of the before row, or the end of the group', () => {
        const { items, m, b, x, y, F } = n2()
        expect(indicatorGap(items, b, { before: m })).toBe(2)
        expect(indicatorGap(items, b, { before: null })).toBe(4)
        expect(indicatorGap(items, x, { before: null })).toBe(6)
        expect(indicatorGap(items, y, { before: x })).toBe(4)
        expect(indicatorGap(items, F, { before: null })).toBe(4)
    })

    test('indicatorGap for the last folder counts its members only while it is open', () => {
        const F = folder('F', true)
        const items = chatListItems(owner([chat('a', 'F'), chat('x')], [F]), 'manual')
        expect(indicatorGap(items, F, { before: null })).toBe(1)
    })

    test('stepTarget moves one place and is null at the edges', () => {
        const { items, a, m, b, x, y, F } = n2()
        expect(stepTarget(items, m, 'up')).toEqual({ before: a })
        expect(stepTarget(items, a, 'down')).toEqual({ before: b })
        expect(stepTarget(items, m, 'down')).toEqual({ before: null })
        expect(stepTarget(items, a, 'up')).toBeNull()
        expect(stepTarget(items, b, 'down')).toBeNull()
        expect(stepTarget(items, x, 'up')).toBeNull()
        expect(stepTarget(items, y, 'down')).toBeNull()
        expect(stepTarget(items, F, 'up')).toBeNull()
        expect(stepTarget(items, F, 'down')).toBeNull()
        expect(stepTarget(items, chat('gone'), 'up')).toBeNull()
    })

    test('siblingEdges marks the first and the last of each group', () => {
        const { items, a, m, b, x, y, F } = n2()
        const edges = siblingEdges(items)
        expect(edges.get(F)).toEqual({ first: true, last: true })
        expect(edges.get(a)).toEqual({ first: true, last: false })
        expect(edges.get(m)).toEqual({ first: false, last: false })
        expect(edges.get(b)).toEqual({ first: false, last: true })
        expect(edges.get(x)).toEqual({ first: true, last: false })
        expect(edges.get(y)).toEqual({ first: false, last: true })
    })

    test('autoscrollDelta is zero in the middle, signed toward the near edge and capped', () => {
        expect(autoscrollDelta(300, 0, 640)).toBe(0)
        expect(autoscrollDelta(ROW_HEIGHT, 0, 640)).toBe(0)
        expect(autoscrollDelta(10, 0, 640)).toBeLessThan(0)
        expect(autoscrollDelta(630, 0, 640)).toBeGreaterThan(0)
        expect(autoscrollDelta(-500, 0, 640)).toBe(-AUTOSCROLL_MAX_PX)
        expect(autoscrollDelta(5000, 0, 640)).toBe(AUTOSCROLL_MAX_PX)
        expect(Math.abs(autoscrollDelta(5, 0, 640))).toBeGreaterThan(Math.abs(autoscrollDelta(50, 0, 640)))
    })
})
