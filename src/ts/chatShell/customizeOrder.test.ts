import { describe, expect, it } from 'vitest'
import { ACTION_IDS, DEFAULT_ORDER, partition, type ActionId } from './actionSlots'
import { CUSTOMIZABLE, customizableIds, dropGap, moveVisible, reorderVisible, withMissing, writeVisible } from './customizeOrder'

const ids = (...list: ActionId[]): ActionId[] => list
const DEF: ActionId[] = [...DEFAULT_ORDER]
const HIDDEN = ids('deleteAfter', 'customizeButtons')
const HEAD = ids('edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark')

// Fixture R: defaults after two pre-fix "Move down" presses on hideAI.
const R = ids('edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'deleteAfter', 'customizeButtons', 'hideAI')
const E = ids('edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'hideAI', 'deleteAfter', 'customizeButtons', 'bookmark')
const G3 = ids('delete', 'copy', 'edit', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons')
// Fixture M: a stored order that predates newReply.
const M = DEF.filter(id => id !== 'newReply')
const MV = ids('edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'branch', 'bookmark', 'newReply', 'deleteAfter', 'customizeButtons', 'hideAI')

function holders(order: readonly ActionId[]): Map<number, ActionId> {
    const map = new Map<number, ActionId>()
    order.forEach((id, index) => { if (!CUSTOMIZABLE.includes(id)) map.set(index, id) })
    return map
}

describe('CHORE-729 customize order model', () => {
    it('CUSTOMIZABLE is ACTION_IDS without the two hidden built-ins', () => {
        expect(CUSTOMIZABLE).toEqual(ids('copy', 'selectText', 'edit', 'translate', 'readAloud', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'delete'))
        expect(ACTION_IDS.length).toBe(14)
    })

    it('P1 customizableIds drops hidden built-ins and plugin ids', () => {
        expect(customizableIds(ids('plugin:x', 'edit', 'deleteAfter', 'delete', 'customizeButtons')).slice(0, 2)).toEqual(ids('edit', 'delete'))
        expect(customizableIds(ids('plugin:x', 'edit', 'deleteAfter', 'delete', 'customizeButtons'))).not.toContain('plugin:x')
        expect(customizableIds(R)).toEqual([...HEAD, 'hideAI'])
    })

    it('P2 moveVisible passes the next visible row across hidden ids', () => {
        expect(moveVisible(R, 'hideAI', -1)).toEqual(E)
        expect(moveVisible(R, 'bookmark', 1)).toEqual(E)
    })

    it('P3 moveVisible returns null at the edges and for an absent id', () => {
        expect(moveVisible(DEF, 'edit', -1)).toBeNull()
        expect(moveVisible(DEF, 'hideAI', 1)).toBeNull()
        expect(moveVisible(DEF, 'plugin:x', 1)).toBeNull()
    })

    it('P4 dropGap counts midpoints strictly above y', () => {
        const mids = [82, 126, 170]
        expect(dropGap(mids, 0)).toBe(0)
        expect(dropGap(mids, 82)).toBe(0)
        expect(dropGap(mids, 83)).toBe(1)
        expect(dropGap(mids, 170)).toBe(2)
        expect(dropGap(mids, 9999)).toBe(3)
        expect(dropGap([], 5)).toBe(0)
    })

    it('P5 own gaps are null and a downward drop inserts before the gap', () => {
        expect(reorderVisible(DEF, 'edit', 0)).toBeNull()
        expect(reorderVisible(DEF, 'edit', 1)).toBeNull()
        expect(reorderVisible(DEF, 'copy', 2)).toBeNull()
        expect(reorderVisible(DEF, 'copy', 3)).toBeNull()
        expect(reorderVisible(DEF, 'edit', 3)).toEqual(G3)
        expect(reorderVisible(R, 'hideAI', 10)).toEqual(E)
        expect(reorderVisible(DEF, 'hideAI', 0)).toEqual(ids('hideAI', 'edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', ...HIDDEN))
    })

    it('P6 every reorder is a permutation that keeps hidden ids at their indices', () => {
        const order = ids('plugin:x', 'edit', 'deleteAfter', 'delete', 'copy', 'customizeButtons', 'translate', 'plugin:y', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI')
        const base = withMissing(order)
        const visible = customizableIds(order)
        let writes = 0
        for (const id of visible) {
            for (let gap = 0; gap <= visible.length; gap++) {
                const next = reorderVisible(order, id, gap)
                if (next === null) continue
                writes++
                expect([...next].sort()).toEqual([...base].sort())
                expect(holders(next)).toEqual(holders(base))
            }
            for (const delta of [-1, 1] as const) {
                const next = moveVisible(order, id, delta)
                if (next === null) continue
                expect([...next].sort()).toEqual([...base].sort())
                expect(holders(next)).toEqual(holders(base))
            }
        }
        expect(writes).toBeGreaterThan(100)
        expect(writeVisible(order, visible)).toEqual(base)
    })

    it('P7 built-ins missing from the stored order are listed and movable', () => {
        const labels = ids('edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'branch', 'bookmark', 'hideAI', 'newReply')
        expect(customizableIds(M)).toEqual(labels)
        expect(moveVisible(M, 'newReply', -1)).toEqual(MV)
        const o3 = DEF.filter(id => id !== 'copy' && id !== 'selectText' && id !== 'edit')
        const expected = ids('delete', 'translate', 'readAloud', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'copy', 'selectText', 'edit')
        expect(customizableIds(o3)).toEqual(expected)
        expect(partition({ order: o3, pinned: [...CUSTOMIZABLE] }, CUSTOMIZABLE, 99).pinned).toEqual(expected)
    })

    it('P8 ids that are not listed are never reordered', () => {
        for (const id of ids('plugin:x', 'deleteAfter', 'customizeButtons')) {
            expect(reorderVisible(DEF, id, 5)).toBeNull()
            expect(moveVisible(DEF, id, -1)).toBeNull()
            expect(moveVisible(DEF, id, 1)).toBeNull()
        }
    })

    it('DEFAULT_ORDER is the readSlots default shape', () => {
        expect(DEFAULT_ORDER.slice(0, 2)).toEqual(ids('edit', 'delete'))
        expect(DEFAULT_ORDER.length).toBe(14)
    })
})
