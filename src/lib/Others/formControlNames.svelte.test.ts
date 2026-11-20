// @vitest-environment jsdom
/**
 * Every choice radio of the per-record conflict dialog is named through aria-label equal to the visible choice text,
 * and none uses aria-labelledby. REAL: PeerConflicts. MOCKED: `stores.svelte` (the alert store only), as the sibling
 * test does.
 */
import { writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../ts/stores.svelte'))

import type { PeerConflictRowView } from '../../ts/alert'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import PeerConflicts from './PeerConflicts.svelte'

const rows: PeerConflictRowView[] = [
    { id: 'a', label: 'Setting: zoomsize', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'restore note' },
    { id: 'c', label: 'Ann was deleted there', choices: ['mine', 'theirs'], preselect: 'mine', note: null },
]

const mounted: Array<ReturnType<typeof mount>> = []

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('PeerConflicts form control names', () => {
    test('each radio carries aria-label equal to its visible choice text, in every row', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push(mount(PeerConflicts as never, { target, props: { rows, title: 'Title', onanswer: vi.fn() } }))
        flushSync()
        const radios = [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        expect(radios).toHaveLength(5)
        for (const radio of radios) {
            const visible = radio.closest('label')!.textContent!.trim()
            expect(visible).not.toBe('')
            expect(radio.getAttribute('aria-label')).toBe(visible)
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(radio)).toBe(visible)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
