import { describe, expect, test } from 'vitest'
import { treeKeyAction, type TreeKeyInput, type TreeKeyResult, type TreeRowInfo } from './treeKeys'

function row(id: string, level: number, parentId: string | null, options: Partial<TreeRowInfo> = {}): TreeRowInfo {
    return { id, level, parentId, expandable: false, expanded: false, label: id, ...options }
}

// What is on screen: an open owner with an open lorebook kind and a closed regex kind, then a closed owner.
const rows: TreeRowInfo[] = [
    row('alice', 1, null, { expandable: true, expanded: true, label: 'Alice' }),
    row('alice/lore', 2, 'alice', { expandable: true, expanded: true, label: 'Lorebook' }),
    row('lore-1', 3, 'alice/lore', { label: 'Castle' }),
    row('lore-2', 3, 'alice/lore', { label: 'Cellar' }),
    row('alice/regex', 2, 'alice', { expandable: true, expanded: false, label: 'Regex' }),
    row('bob', 1, null, { expandable: true, expanded: false, label: 'Bob' }),
]

function press(focus: string | null, key: string, init: Partial<TreeKeyInput> = {}, typeAhead = ''): TreeKeyResult {
    return treeKeyAction(rows, focus, { key, ...init }, typeAhead)
}

describe('4a tree key map', () => {
    test('arrows move one visible row and stop at the ends', () => {
        expect(press('alice', 'ArrowDown')).toMatchObject({ action: 'focus', id: 'alice/lore' })
        expect(press('lore-2', 'ArrowDown')).toMatchObject({ action: 'focus', id: 'alice/regex' })
        expect(press('lore-1', 'ArrowUp')).toMatchObject({ action: 'focus', id: 'alice/lore' })
        expect(press('alice', 'ArrowUp')).toMatchObject({ action: 'focus', id: 'alice' })
        expect(press('bob', 'ArrowDown')).toMatchObject({ action: 'focus', id: 'bob' })
    })

    test('Home and End go to the first and last visible row, counting rows of open groups', () => {
        expect(press('lore-2', 'Home')).toMatchObject({ action: 'focus', id: 'alice' })
        expect(press('alice', 'End')).toMatchObject({ action: 'focus', id: 'bob' })
        const openEnd: TreeRowInfo[] = [...rows.slice(0, 5), row('bob', 1, null, { expandable: true, expanded: true }), row('bob/lore', 2, 'bob')]
        expect(treeKeyAction(openEnd, 'alice', { key: 'End' })).toMatchObject({ action: 'focus', id: 'bob/lore' })
    })

    test('Right opens a closed row, then enters an open one; a leaf does nothing', () => {
        expect(press('bob', 'ArrowRight')).toMatchObject({ action: 'expand', id: 'bob' })
        expect(press('alice/regex', 'ArrowRight')).toMatchObject({ action: 'expand', id: 'alice/regex' })
        expect(press('alice', 'ArrowRight')).toMatchObject({ action: 'focus', id: 'alice/lore' })
        expect(press('lore-1', 'ArrowRight').action).toBe('none')
    })

    test('Left closes an open row, else goes to the parent; a top closed row does nothing', () => {
        expect(press('alice/lore', 'ArrowLeft')).toMatchObject({ action: 'collapse', id: 'alice/lore' })
        expect(press('lore-1', 'ArrowLeft')).toMatchObject({ action: 'focus', id: 'alice/lore' })
        expect(press('alice/regex', 'ArrowLeft')).toMatchObject({ action: 'focus', id: 'alice' })
        expect(press('bob', 'ArrowLeft').action).toBe('none')
    })

    test('Enter opens the row and Shift+F10 or the menu key opens its menu', () => {
        expect(press('lore-1', 'Enter')).toMatchObject({ action: 'activate', id: 'lore-1' })
        expect(press('lore-1', 'F10', { shiftKey: true })).toMatchObject({ action: 'menu', id: 'lore-1' })
        expect(press('lore-1', 'ContextMenu')).toMatchObject({ action: 'menu', id: 'lore-1' })
        expect(press('lore-1', 'F10').action).toBe('none')
    })

    test('a letter jumps to the next row that starts with it, wrapping around', () => {
        expect(press('alice', 'l')).toMatchObject({ action: 'focus', id: 'alice/lore', typeAhead: 'l' })
        expect(press('bob', 'a')).toMatchObject({ action: 'focus', id: 'alice' })
        expect(press('alice', 'z')).toMatchObject({ action: 'none', typeAhead: 'z' })
    })

    test('a repeated letter cycles; a longer word narrows from the focused row', () => {
        expect(press('lore-1', 'c', {}, 'c')).toMatchObject({ action: 'focus', id: 'lore-2', typeAhead: 'cc' })
        expect(press('lore-1', 'e', {}, 'c')).toMatchObject({ action: 'focus', id: 'lore-2', typeAhead: 'ce' })
        expect(press('lore-1', 'a', {}, 'c')).toMatchObject({ action: 'focus', id: 'lore-1', typeAhead: 'ca' })
    })

    test('a space continues a typed word and otherwise activates', () => {
        expect(press('lore-1', ' ')).toMatchObject({ action: 'activate', id: 'lore-1' })
        const spaced = [row('a', 1, null, { label: 'New chat' }), row('b', 1, null, { label: 'Notes' })]
        expect(treeKeyAction(spaced, 'b', { key: ' ' }, 'new')).toMatchObject({ action: 'focus', id: 'a', typeAhead: 'new ' })
    })

    test('keys with Ctrl, Meta or Alt, composition keys and keys the tree does not own are left alone', () => {
        expect(press('alice', 'ArrowDown', { ctrlKey: true }).action).toBe('none')
        expect(press('alice', 'Home', { metaKey: true }).action).toBe('none')
        expect(press('alice', 'l', { altKey: true }).action).toBe('none')
        expect(press('alice', 'ArrowDown', { isComposing: true }).action).toBe('none')
        expect(press('alice', 'Enter', { keyCode: 229 }).action).toBe('none')
        expect(press('alice', 'Tab').action).toBe('none')
        expect(press('alice', 'Escape').action).toBe('none')
    })

    test('no rows gives nothing, and no focused row starts at the top', () => {
        expect(treeKeyAction([], null, { key: 'ArrowDown' }).action).toBe('none')
        expect(press(null, 'ArrowDown')).toMatchObject({ action: 'focus', id: 'alice' })
        expect(press(null, 'Enter').action).toBe('none')
    })
})
