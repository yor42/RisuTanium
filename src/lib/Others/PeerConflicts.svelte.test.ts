// @vitest-environment jsdom
import { get, writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../ts/stores.svelte'))

import { language } from 'src/lang'
import type { PeerConflictRowView } from '../../ts/alert'
import { closeDialogForBack } from '../../ts/alertBack'
import { escapeActionFor } from '../../ts/alertEscape'
import { ANSWER_GUARD_MS, askPrompt, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertStore } from '../../ts/stores.svelte'
import PeerConflicts from './PeerConflicts.svelte'

/**
 * The per-record conflict dialog. Text bindings only: a name never becomes markup, and no sanitizer is involved, so the
 * escaping row asserts the DOM itself. The prompt rows run the real prompt controller over the shared store.
 */

const text = () => language.store2Boot

const rows: PeerConflictRowView[] = [
    { id: 'a', label: 'Setting: zoomsize', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'restore note' },
    { id: 'b', label: 'Ann: chat One', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'copy note' },
    { id: 'c', label: 'Ann was deleted there', choices: ['mine', 'theirs'], preselect: 'mine', note: null },
]

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function render(props: { rows: readonly PeerConflictRowView[], title?: string, onanswer?: (message: string) => void }): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PeerConflicts as never, { target, props: { title: 'Title', onanswer: vi.fn(), ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const row = (target: HTMLElement, id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-conflict-row="${id}"]`)!
const radios = (target: HTMLElement, id: string): HTMLInputElement[] => [...row(target, id).querySelectorAll<HTMLInputElement>('input[type="radio"]')]
const checkedOf = (target: HTMLElement, id: string): string | undefined => radios(target, id).find(input => input.checked)?.value
const buttonNamed = (target: HTMLElement, label: string): HTMLButtonElement => [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

describe('the dialog\'s rows (J1)', () => {
    test('J1 one row per record: the label, three radios (two for a delete row), and the keep-both note where there is one', () => {
        const target = render({ rows })
        expect(target.querySelectorAll('[data-conflict-row]')).toHaveLength(3)
        expect([...target.querySelectorAll('legend')].map(legend => legend.textContent)).toEqual(rows.map(item => item.label))
        expect(radios(target, 'a').map(input => input.value)).toEqual(['mine', 'theirs', 'both'])
        expect(radios(target, 'c').map(input => input.value)).toEqual(['mine', 'theirs'])
        expect(row(target, 'a').querySelector('[data-conflict-note]')?.textContent).toBe('restore note')
        expect(row(target, 'b').querySelector('[data-conflict-note]')?.textContent).toBe('copy note')
        expect(row(target, 'c').querySelector('[data-conflict-note]')).toBeNull()
        expect(target.textContent).toContain('Title')
        expect(buttonNamed(target, text().peerConflictApply)).toBeDefined()
        // The labels of the choices are the strings of the language.
        expect(row(target, 'a').textContent).toContain(text().peerKeepMine)
        expect(row(target, 'a').textContent).toContain(text().peerKeepBoth)
        expect(row(target, 'c').textContent).not.toContain(text().peerKeepBoth)
    })

    test('J5 names render as text: markup in a label stays a literal string and creates no element', () => {
        const target = render({ rows: [{ id: 'x', label: 'Ann: chat <b>bold</b><img src=x onerror=alert(1)>', choices: ['mine', 'theirs'], preselect: 'mine', note: null }], title: '<i>t</i>' })
        expect(row(target, 'x').querySelector('legend')?.textContent).toBe('Ann: chat <b>bold</b><img src=x onerror=alert(1)>')
        expect(target.querySelector('b')).toBeNull()
        expect(target.querySelector('img')).toBeNull()
        expect(target.querySelector('i')).toBeNull()
    })
})

describe('the choices (J2, J3)', () => {
    test('J3 every row is preselected (keep both; the kept version for a delete row) and Apply answers every row', () => {
        const onanswer = vi.fn()
        const target = render({ rows, onanswer })
        expect([checkedOf(target, 'a'), checkedOf(target, 'b'), checkedOf(target, 'c')]).toEqual(['both', 'both', 'mine'])
        buttonNamed(target, text().peerConflictApply).click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ a: 'both', b: 'both', c: 'mine' }))
    })

    test('J2 "same for all" sets every row (a delete row keeps its own default for keep both), and a later change alters only that row', () => {
        const onanswer = vi.fn()
        const target = render({ rows, onanswer })
        buttonNamed(target, text().peerKeepTheirs).click()
        flushSync()
        expect([checkedOf(target, 'a'), checkedOf(target, 'b'), checkedOf(target, 'c')]).toEqual(['theirs', 'theirs', 'theirs'])
        radios(target, 'b').find(input => input.value === 'mine')!.click()
        flushSync()
        expect([checkedOf(target, 'a'), checkedOf(target, 'b'), checkedOf(target, 'c')]).toEqual(['theirs', 'mine', 'theirs'])
        buttonNamed(target, text().peerKeepBoth).click()
        flushSync()
        expect([checkedOf(target, 'a'), checkedOf(target, 'b'), checkedOf(target, 'c')]).toEqual(['both', 'both', 'mine'])
        buttonNamed(target, text().peerConflictApply).click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ a: 'both', b: 'both', c: 'mine' }))
    })
})

describe('the prompt is not dismissable (J4)', () => {
    test('J4 Escape is classified ignore and Back does nothing, even after the answer guard: the dialog stays until Apply answers it', async () => {
        const data = { type: 'peerConflicts' as const, msg: 'Title', peerConflicts: rows }
        const answered = askPrompt(data)
        expect(get(alertStore)).toBe(data)
        expect(escapeActionFor('peerConflicts')).toBe('ignore')
        await new Promise<void>(resolve => setTimeout(resolve, ANSWER_GUARD_MS + 40))
        closeDialogForBack()
        expect(get(alertStore)).toBe(data)
        alertStore.set({ type: 'none', msg: JSON.stringify({ a: 'mine' }) })
        expect(await answered).toBe(JSON.stringify({ a: 'mine' }))
    })
})
