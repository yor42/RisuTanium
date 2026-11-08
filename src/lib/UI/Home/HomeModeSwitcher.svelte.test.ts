// @vitest-environment jsdom

/**
 * `HomeModeSwitcher.svelte`: a labelled group of native radios. Roleplay is current and enabled;
 * held modes are disabled and tagged "coming later"; the component never writes the mode fields and
 * follows `DBState.db`.
 *
 * MOCKED: `src/ts/stores.svelte` is reduced to a `$state` `DBState`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

type ModeFields = { visibleModes: string[]; hideUnusedModes: boolean }

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { visibleModes: ['rp', 'hybrid', 'utility'], hideUnusedModes: false } as ModeFields,
    })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import HomeModeSwitcher from './HomeModeSwitcher.svelte'

const mountedInstances: unknown[] = []

function mountSwitcher(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedInstances.push(mount(HomeModeSwitcher, { target }))
    flushSync()
    return target
}

function radio(root: HTMLElement, mode: string): HTMLInputElement {
    const found = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${mode}"]`)
    if (!found) {
        throw new Error(`radio ${mode} not found`)
    }
    return found
}

const db = (): ModeFields => DBState.db as unknown as ModeFields

beforeEach(() => {
    db().visibleModes = ['rp', 'hybrid', 'utility']
    db().hideUnusedModes = false
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    document.body.replaceChildren()
})

describe('HomeModeSwitcher', () => {
    test('is a group labelled with the switcher label', () => {
        const root = mountSwitcher()
        const group = root.querySelector('fieldset')
        expect(group).not.toBeNull()
        expect(group!.querySelector('legend')!.textContent).toBe(language.homeModeSwitcherLabel)
        expect(root.querySelectorAll('input[type="radio"]').length).toBe(3)
    })

    test('Roleplay is checked and enabled; the held modes are disabled with the coming-later tag', () => {
        const root = mountSwitcher()
        const rp = radio(root, 'rp')
        expect(rp.checked).toBe(true)
        expect(rp.disabled).toBe(false)
        expect(rp.getAttribute('aria-disabled')).toBeNull()

        for (const held of ['hybrid', 'utility']) {
            const input = radio(root, held)
            expect(input.disabled).toBe(true)
            expect(input.checked).toBe(false)
            expect(input.getAttribute('aria-disabled')).toBe('true')
            expect(input.closest('label')!.textContent).toContain(language.homeModeComingLater)
        }
        expect(rp.closest('label')!.textContent).not.toContain(language.homeModeComingLater)
    })

    test('uses the existing mode names', () => {
        const root = mountSwitcher()
        expect(radio(root, 'rp').closest('label')!.textContent).toContain(language.settingsShellModesNameRp)
        expect(radio(root, 'hybrid').closest('label')!.textContent).toContain(language.settingsShellModesNameHybrid)
        expect(radio(root, 'utility').closest('label')!.textContent).toContain(language.settingsShellModesNameUtility)
    })

    test('activating a held entry keeps Roleplay current and leaves the mode fields unchanged', () => {
        db().visibleModes = ['rp', 'utility']
        db().hideUnusedModes = true
        const before = JSON.stringify(DBState.db)
        const root = mountSwitcher()

        radio(root, 'utility').click()
        radio(root, 'utility').closest('label')!.click()
        flushSync()

        expect(radio(root, 'rp').checked).toBe(true)
        expect(radio(root, 'utility').checked).toBe(false)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('activating the enabled Roleplay entry leaves the mode fields unchanged', () => {
        db().visibleModes = ['rp', 'utility']
        db().hideUnusedModes = true
        const before = JSON.stringify(DBState.db)
        const root = mountSwitcher()
        const rp = radio(root, 'rp')

        rp.click()
        rp.closest('label')!.click()
        rp.dispatchEvent(new Event('input', { bubbles: true }))
        rp.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()

        expect(rp.checked).toBe(true)
        expect(db().visibleModes).toEqual(['rp', 'utility'])
        expect(db().hideUnusedModes).toBe(true)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('renders nothing when shownModes has one entry', () => {
        db().visibleModes = ['rp']
        db().hideUnusedModes = true
        const root = mountSwitcher()
        expect(root.querySelector('fieldset')).toBeNull()
    })

    test('keeps Roleplay while it is the only built mode, even when hidden', () => {
        db().visibleModes = ['hybrid', 'utility']
        db().hideUnusedModes = true
        const root = mountSwitcher()
        expect(radio(root, 'rp').checked).toBe(true)
        expect(radio(root, 'rp').disabled).toBe(false)
    })

    test('follows a DBState.db swap', () => {
        const root = mountSwitcher()
        expect(root.querySelectorAll('input[type="radio"]').length).toBe(3)

        DBState.db = { visibleModes: ['rp', 'utility'], hideUnusedModes: true } as unknown as typeof DBState.db
        flushSync()
        expect(root.querySelectorAll('input[type="radio"]').length).toBe(2)
        expect(root.querySelector('input[value="hybrid"]')).toBeNull()

        DBState.db = { visibleModes: ['rp'], hideUnusedModes: true } as unknown as typeof DBState.db
        flushSync()
        expect(root.querySelector('fieldset')).toBeNull()
    })
})
