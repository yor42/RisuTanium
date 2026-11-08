// @vitest-environment jsdom

/**
 * The mode visibility group of the Settings shell, with the real component and the real homeModes rules: lock states
 * and reasons, refused activations that leave the box and the stored set unchanged, allowed toggles, the hide switch
 * round trip, the show-all request, the repair banner, the status line and the notes. All guards for new behaviour.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState stand-in). Space activation is not testable here: jsdom has no keyboard
 * activation, so the click paths (input and label) stand for it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { HomeMode } from '../../ts/storage/homeModes'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../ts/stores.svelte')
})

import { language } from '../../lang'
import { DBState } from '../../ts/stores.svelte'
import ModeVisibilityGroup from './ModeVisibilityGroup.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
let asked: Array<{ trigger: HTMLElement, hidden: HomeMode[] }> = []

function setDb(visibleModes: HomeMode[], hideUnusedModes: boolean): void {
    DBState.db = { visibleModes, hideUnusedModes } as unknown as Database
}

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ModeVisibilityGroup, { target, props: { onaskshowall: (trigger: HTMLElement, hidden: HomeMode[]) => { asked.push({ trigger, hidden }) } } }))
    flushSync()
    return target
}

const box = (target: HTMLElement, mode: HomeMode) => target.querySelector<HTMLInputElement>(`[data-part="mode-checkbox"][data-mode="${mode}"]`)!
const rowOf = (target: HTMLElement, mode: HomeMode) => target.querySelector<HTMLLabelElement>(`[data-part="mode-row"][data-mode="${mode}"]`)!
const part = (target: HTMLElement, name: string) => target.querySelector<HTMLElement>(`[data-part="${name}"]`)
const checkedModes = (target: HTMLElement) => (['rp', 'hybrid', 'utility'] as HomeMode[]).filter((mode) => box(target, mode).checked)

beforeEach(() => {
    asked = []
    setDb(['rp', 'hybrid', 'utility'], false)
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('checked and lock states', () => {
    test('with hiding off every box is checked and locked with the hiding-off reason', () => {
        setDb(['hybrid'], false)
        const target = show()
        expect(checkedModes(target)).toEqual(['rp', 'hybrid', 'utility'])
        for (const mode of ['rp', 'hybrid', 'utility'] as HomeMode[]) {
            expect(box(target, mode).getAttribute('aria-disabled')).toBe('true')
            expect(box(target, mode).hasAttribute('disabled')).toBe(false)
            const reason = box(target, mode).getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent)
            expect(reason).toContain(language.settingsShellModesLockOff)
        }
    })

    test('with hiding on the remembered set is checked and only the last visible mode is locked', () => {
        setDb(['hybrid'], true)
        const target = show()
        expect(checkedModes(target)).toEqual(['hybrid'])
        expect(box(target, 'hybrid').getAttribute('aria-disabled')).toBe('true')
        expect(box(target, 'rp').hasAttribute('aria-disabled')).toBe(false)
        expect(box(target, 'utility').hasAttribute('aria-disabled')).toBe(false)
        const reasons = box(target, 'hybrid').getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent)
        expect(reasons).toContain(language.settingsShellModesLockLast)
    })

    test('every box has its name and description', () => {
        const target = show()
        expect(rowOf(target, 'rp').textContent).toContain(language.settingsShellModesNameRp)
        expect(rowOf(target, 'hybrid').textContent).toContain(language.settingsShellModesDescHybrid)
        expect(rowOf(target, 'utility').textContent).toContain(language.settingsShellModesNameUtility)
    })
})

describe('refused activations leave the box and the data unchanged', () => {
    test('a click on a box locked by hiding being off flips nothing and writes nothing', () => {
        setDb(['hybrid'], false)
        const stored = DBState.db.visibleModes
        const target = show()
        box(target, 'rp').click()
        flushSync()
        expect(box(target, 'rp').checked).toBe(true)
        expect(box(target, 'rp').getAttribute('aria-disabled')).toBe('true')
        expect(DBState.db.visibleModes).toBe(stored)
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(false)
    })

    test('a click on the label of a locked box is refused the same way', () => {
        setDb(['hybrid'], false)
        const stored = DBState.db.visibleModes
        const target = show()
        rowOf(target, 'utility').click()
        flushSync()
        expect(box(target, 'utility').checked).toBe(true)
        expect(DBState.db.visibleModes).toBe(stored)
    })

    test('unchecking the last visible mode is refused, by input and by label', () => {
        setDb(['hybrid'], true)
        const stored = DBState.db.visibleModes
        const target = show()
        box(target, 'hybrid').click()
        flushSync()
        expect(box(target, 'hybrid').checked).toBe(true)
        rowOf(target, 'hybrid').click()
        flushSync()
        expect(box(target, 'hybrid').checked).toBe(true)
        expect(box(target, 'hybrid').getAttribute('aria-disabled')).toBe('true')
        expect(DBState.db.visibleModes).toBe(stored)
        expect(DBState.db.hideUnusedModes).toBe(true)
    })
})

describe('allowed toggles', () => {
    test('checking and unchecking writes the canonical set and the box follows', () => {
        setDb(['hybrid'], true)
        const target = show()
        box(target, 'rp').click()
        flushSync()
        expect(DBState.db.visibleModes).toEqual(['rp', 'hybrid'])
        expect(box(target, 'rp').checked).toBe(true)
        expect(checkedModes(target)).toEqual(['rp', 'hybrid'])
        box(target, 'hybrid').click()
        flushSync()
        expect(DBState.db.visibleModes).toEqual(['rp'])
        expect(box(target, 'hybrid').checked).toBe(false)
        expect(box(target, 'rp').getAttribute('aria-disabled')).toBe('true')
    })
})

describe('the hide switch', () => {
    test('off then on keeps the remembered set: all boxes show checked and locked while off, the set returns when on', () => {
        setDb(['hybrid'], true)
        const stored = DBState.db.visibleModes
        const target = show()
        const hide = part(target, 'mode-hide-switch')!
        expect(hide.getAttribute('role')).toBe('switch')
        expect(hide.getAttribute('aria-checked')).toBe('true')

        hide.click()
        flushSync()
        expect(hide.getAttribute('aria-checked')).toBe('false')
        expect(DBState.db.hideUnusedModes).toBe(false)
        expect(DBState.db.visibleModes).toBe(stored)
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(checkedModes(target)).toEqual(['rp', 'hybrid', 'utility'])
        for (const mode of ['rp', 'hybrid', 'utility'] as HomeMode[]) expect(box(target, mode).getAttribute('aria-disabled')).toBe('true')

        hide.click()
        flushSync()
        expect(hide.getAttribute('aria-checked')).toBe('true')
        expect(DBState.db.hideUnusedModes).toBe(true)
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(checkedModes(target)).toEqual(['hybrid'])
    })
})

describe('show all modes', () => {
    test('while nothing is hidden it is aria-disabled with the already reason and asks for nothing', () => {
        const target = show()
        const button = part(target, 'mode-show-all')!
        expect(button.getAttribute('aria-disabled')).toBe('true')
        expect(button.getAttribute('aria-describedby')).toBeTruthy()
        expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(language.settingsShellModesAlready)
        button.click()
        flushSync()
        expect(asked).toEqual([])
        expect(DBState.db.visibleModes).toEqual(['rp', 'hybrid', 'utility'])
    })

    test('with hiding off it stays disabled even when a smaller set is remembered', () => {
        setDb(['hybrid'], false)
        const target = show()
        const button = part(target, 'mode-show-all')!
        expect(button.getAttribute('aria-disabled')).toBe('true')
        button.click()
        expect(asked).toEqual([])
    })

    test('with modes hidden it asks the host with the button and the hidden modes, and writes nothing itself', () => {
        setDb(['hybrid'], true)
        const stored = DBState.db.visibleModes
        const target = show()
        const button = part(target, 'mode-show-all')!
        expect(button.hasAttribute('aria-disabled')).toBe(false)
        button.click()
        flushSync()
        expect(asked).toHaveLength(1)
        expect(asked[0].trigger).toBe(button)
        expect(asked[0].hidden).toEqual(['rp', 'utility'])
        expect(DBState.db.visibleModes).toBe(stored)
        expect(DBState.db.hideUnusedModes).toBe(true)
    })
})

describe('banner, status and notes', () => {
    test('the repair banner shows only while hiding is on and fewer than three modes are shown', () => {
        setDb(['hybrid'], true)
        let target = show()
        expect(part(target, 'mode-repair-banner')?.textContent).toContain(language.settingsShellModesBanner(language.settingsShellModesNameHybrid))
        for (const component of mounted.splice(0)) unmount(component)
        document.body.replaceChildren()

        setDb(['hybrid'], false)
        target = show()
        expect(part(target, 'mode-repair-banner')).toBeNull()
        for (const component of mounted.splice(0)) unmount(component)
        document.body.replaceChildren()

        setDb(['rp', 'hybrid', 'utility'], true)
        target = show()
        expect(part(target, 'mode-repair-banner')).toBeNull()
    })

    test('the status line names the shown modes, and says all when all are shown', () => {
        setDb(['rp', 'utility'], true)
        const target = show()
        const status = part(target, 'mode-status')!
        expect(status.getAttribute('role')).toBe('status')
        expect(status.textContent).toBe(language.settingsShellModesStatusSome(2, `${language.settingsShellModesNameRp}, ${language.settingsShellModesNameUtility}`))
        box(target, 'utility').click()
        flushSync()
        expect(status.textContent).toBe(language.settingsShellModesStatusSome(1, language.settingsShellModesNameRp))
        part(target, 'mode-hide-switch')!.click()
        flushSync()
        expect(status.textContent).toBe(language.settingsShellModesStatusAll)
    })

    test('both note lines are always present, including the Home-arrives note', () => {
        const target = show()
        expect(part(target, 'mode-visibility-note')?.textContent).toBe(language.settingsShellModesNote)
        expect(part(target, 'mode-visibility-home-note')?.textContent).toBe(language.settingsShellModesHomeNote)
        expect(part(target, 'mode-visibility-title')?.textContent).toBe(language.settingsShellModesTitle)
    })
})
