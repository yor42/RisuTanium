/**
 * The Shortcuts page rules apart from the component: which rows are listed, conflicts, duplicates, plans and the
 * undo guard. New seam: behaviour tests, no pre-fix code.
 */
import { describe, expect, test } from 'vitest'
import { defaultHotkeys, type Hotkey } from '../defaulthotkeys'
import {
    applyPlan, duplicateGroups, findConflict, hotkeyUndoAction, isChanged, keyboardSignal, listedRows, pageReadOnly,
    planResetAll, planSwap, planUnbind, rowChord,
} from './hotkeyPage'

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

    test('Ctrl+1 and Esc are fixed', () => {
        const listed = listedRows(freshRows(), { scrollToActiveChar: true })
        expect(findConflict(listed, 'home', { key: '1', ctrl: true, alt: false, shift: false })?.kind).toBe('fixed')
        expect(findConflict(listed, 'home', { key: 'Escape', ctrl: false, alt: false, shift: false })?.kind).toBe('fixed')
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
