/**
 * The Shortcuts page rules apart from the component: which rows are listed, conflicts, duplicates, plans and the
 * undo guard. New seam: behaviour tests, no pre-fix code.
 */
import { describe, expect, test } from 'vitest'
import { defaultHotkeys, type Hotkey } from '../defaulthotkeys'
import {
    applyPlan, duplicateGroups, findConflict, hotkeyUndoAction, isChanged, keyboardSignal, listedRows, pageReadOnly,
    planResetAll, planSwap, planUnbind, rowChord, slotUndoAction,
} from './hotkeyPage'
import { applySlotPlan, planSlotAssign } from '../storage/presetMeta'

function freshRows(): Hotkey[] {
    return JSON.parse(JSON.stringify(defaultHotkeys)) as Hotkey[]
}

function byAction(rows: Hotkey[], action: string): Hotkey {
    const found = rows.find((row) => row.action === action)
    if (!found) throw new Error(`no row ${action}`)
    return found
}

const texts = { undone: 'undone', refused: 'refused', failed: 'failed' }

describe('listedRows', () => {
    test('hidden and unknown actions are left out', () => {
        const rows = [...freshRows(), { key: 'k', ctrl: true, action: 'someUpstreamOnly' }]
        const actions = listedRows(rows, { scrollToActiveChar: true }).map((row) => row.action)
        for (const hidden of ['toggleVoice', 'webcam', 'modelSelect', 'someUpstreamOnly']) {
            expect(actions).not.toContain(hidden)
        }
        expect(actions).toContain('home')
    })

    test('the nine slot rows form their own group between navigation and tools', () => {
        const actions = listedRows(freshRows(), { scrollToActiveChar: true }).map((row) => row.action)
        const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `presetSlot${n}`)
        const first = actions.indexOf('presetSlot1')
        expect(actions.slice(first, first + 9)).toEqual(slots)
        expect(first).toBeGreaterThan(actions.indexOf('focusInput'))
        expect(first + 9).toBe(actions.indexOf('toggleCSS'))
    })

    test('scrollToActiveChar follows its setting', () => {
        const rows = freshRows()
        expect(listedRows(rows, { scrollToActiveChar: true }).map((row) => row.action)).toContain('scrollToActiveChar')
        expect(listedRows(rows, { scrollToActiveChar: false }).map((row) => row.action)).not.toContain('scrollToActiveChar')
    })
})

describe('findConflict', () => {
    test('a chord held by another listed action conflicts and carries this action\'s old chord', () => {
        const rows = freshRows()
        const listed = listedRows(rows, { scrollToActiveChar: true })
        const conflict = findConflict(listed, 'presets', { key: 'h', ctrl: true, alt: false, shift: false })
        expect(conflict).toEqual({
            kind: 'action', action: 'home', otherOld: { key: 'p', ctrl: true, alt: false, shift: false },
        })
    })

    test('Esc is fixed, and Ctrl+1 is the ordinary row of preset slot 1 that can be swapped', () => {
        const listed = listedRows(freshRows(), { scrollToActiveChar: true })
        expect(findConflict(listed, 'home', { key: 'Escape', ctrl: false, alt: false, shift: false })?.kind).toBe('fixed')
        expect(findConflict(listed, 'home', { key: '1', ctrl: true, alt: false, shift: false })).toEqual({
            kind: 'action', action: 'presetSlot1', otherOld: { key: 'h', ctrl: true, alt: false, shift: false },
        })
    })

    test('a slot row can take a free chord and swap with another slot row', () => {
        const listed = listedRows(freshRows(), { scrollToActiveChar: true })
        expect(findConflict(listed, 'presetSlot1', { key: '1', ctrl: false, alt: true, shift: false })).toBeNull()
        expect(findConflict(listed, 'presetSlot1', { key: '2', ctrl: true, alt: false, shift: false })).toMatchObject({ kind: 'action', action: 'presetSlot2' })
    })

    test('a hidden row\'s chord and the own row are ignored', () => {
        const listed = listedRows(freshRows(), { scrollToActiveChar: true })
        expect(findConflict(listed, 'home', { key: 'v', ctrl: true, alt: false, shift: false })).toBeNull()
        expect(findConflict(listed, 'home', { key: 'h', ctrl: true, alt: false, shift: false })).toBeNull()
    })
})

describe('duplicateGroups and isChanged', () => {
    test('two rows on one chord are one duplicate and name each other', () => {
        const rows = freshRows()
        Object.assign(byAction(rows, 'presets'), { key: 'h' })
        const info = duplicateGroups(listedRows(rows, { scrollToActiveChar: true }))
        expect(info.count).toBe(1)
        expect(info.partners.get('home')).toEqual(['presets'])
        expect(info.partners.get('presets')).toEqual(['home'])
    })

    test('unbound rows are never duplicates and count as changed', () => {
        const rows = freshRows()
        byAction(rows, 'home').key = ''
        byAction(rows, 'presets').key = ''
        expect(duplicateGroups(listedRows(rows, { scrollToActiveChar: true })).count).toBe(0)
        expect(isChanged(byAction(rows, 'home'))).toBe(true)
        expect(isChanged(byAction(freshRows(), 'home'))).toBe(false)
    })
})

describe('plans', () => {
    test('a swap hands the other action this action\'s old chord, or unbound when it had none', () => {
        const rows = freshRows()
        const chord = { key: 'h', ctrl: true, alt: false, shift: false }
        const plan = planSwap(byAction(rows, 'presets'), byAction(rows, 'home'), chord)
        expect(plan[1].after).toEqual({ key: 'p', ctrl: true, alt: false, shift: false })
        byAction(rows, 'presets').key = ''
        const none = planSwap(byAction(rows, 'presets'), byAction(rows, 'home'), chord)
        expect(none[1].after.key).toBe('')
    })

    test('reset all counts only the listed rows that differ', () => {
        const rows = freshRows()
        byAction(rows, 'home').key = 'j'
        byAction(rows, 'presets').ctrl = false
        byAction(rows, 'toggleVoice').key = 'z'
        const plan = planResetAll(listedRows(rows, { scrollToActiveChar: true }))
        expect(plan.map((step) => step.action).sort()).toEqual(['home', 'presets'])
    })
})

describe('undo', () => {
    test('run restores the before state', () => {
        const rows = freshRows()
        const plan = planUnbind(byAction(rows, 'home'))
        applyPlan(rows, plan)
        expect(byAction(rows, 'home').key).toBe('')
        const outcome = hotkeyUndoAction(() => rows, plan, texts).run()
        expect(outcome).toEqual({ ok: true, text: 'undone' })
        expect(rowChord(byAction(rows, 'home'))).toEqual({ key: 'h', ctrl: true, alt: false, shift: false })
    })

    test('run refuses when a later edit changed the row, and when the row is gone', () => {
        const rows = freshRows()
        const plan = planUnbind(byAction(rows, 'home'))
        applyPlan(rows, plan)
        byAction(rows, 'home').key = 'j'
        const edited = hotkeyUndoAction(() => rows, plan, texts).run()
        expect(edited).toMatchObject({ ok: false, text: 'refused' })
        expect(byAction(rows, 'home').key).toBe('j')
        const gone = hotkeyUndoAction(() => rows.filter((row) => row.action !== 'home'), plan, texts).run()
        expect(gone).toMatchObject({ ok: false })
    })

    test('slot undo restores the slots a swap changed, refuses after a later edit, and refuses when a preset is gone', () => {
        const presets = [{ name: 'A', id: 'a', slot: 1 }, { name: 'B', id: 'b', slot: 2 }]
        const plan = planSlotAssign(presets, 2, 0)
        applySlotPlan(presets, plan)
        expect(presets.map((p) => p.slot)).toEqual([2, 1])
        expect(slotUndoAction(() => presets, plan, texts).run()).toEqual({ ok: true, text: 'undone' })
        expect(presets.map((p) => p.slot)).toEqual([1, 2])

        applySlotPlan(presets, plan)
        presets[0].slot = 5
        expect(slotUndoAction(() => presets, plan, texts).run()).toMatchObject({ ok: false, text: 'refused' })
        expect(presets.map((p) => p.slot)).toEqual([5, 1])
        expect(slotUndoAction(() => presets.slice(1), plan, texts).run()).toMatchObject({ ok: false })
    })

    test('reset all covers a slot row that was rebound', () => {
        const rows = freshRows()
        byAction(rows, 'presetSlot3').alt = true
        const plan = planResetAll(listedRows(rows, { scrollToActiveChar: true }))
        expect(plan.map((step) => step.action)).toEqual(['presetSlot3'])
    })

    test('every undo has its own id', () => {
        const rows = freshRows()
        const plan = planUnbind(byAction(rows, 'home'))
        expect(hotkeyUndoAction(() => rows, plan, texts).id).not.toBe(hotkeyUndoAction(() => rows, plan, texts).id)
    })
})

describe('read-only rule', () => {
    test('read-only only on a narrow screen with no fine pointer and no keyboard seen', () => {
        for (const width of [412, 1024]) {
            for (const finePointer of [false, true]) {
                for (const keyboardSeen of [false, true]) {
                    const expected = width < 768 && !finePointer && !keyboardSeen
                    expect(pageReadOnly({ width, finePointer, keyboardSeen })).toBe(expected)
                }
            }
        }
    })

    test('Ctrl, Alt and the command key signal a keyboard, Shift does not', () => {
        expect(keyboardSignal({ ctrlKey: true, altKey: false, metaKey: false })).toBe(true)
        expect(keyboardSignal({ ctrlKey: false, altKey: true, metaKey: false })).toBe(true)
        expect(keyboardSignal({ ctrlKey: false, altKey: false, metaKey: true })).toBe(true)
        expect(keyboardSignal({ ctrlKey: false, altKey: false, metaKey: false })).toBe(false)
    })
})
