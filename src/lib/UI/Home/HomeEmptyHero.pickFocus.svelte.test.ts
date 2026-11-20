// @vitest-environment jsdom

/**
 * Focus around the hero's Import button: the button stays focusable while an import runs, so the file picker
 * records it as the opener and the card that follows the pick can give focus back to it. A `disabled` button
 * loses focus on the next render and cannot take it back until the import ends.
 *
 * MOCKED: `importCharacter` plays `selectFileByDom` (it records the focused element as the opener, as the picker
 * does, then reports files back) and `stores.svelte` is reduced to an empty library. The native chooser is not
 * involved.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { markPickReturned, rememberPickOpener, resetPickOpenerForTest, takePickOpener } from 'src/ts/pickOpener'

const importCharacterSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: importCharacterSpy,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/ts/characters', () => ({
    createNewCharacter: vi.fn(),
    changeChar: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        SettingsMenuIndex: { set: vi.fn() },
        settingsOpen: { set: vi.fn() },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import HomeEmptyHero from './HomeEmptyHero.svelte'

let component: ReturnType<typeof mount> | null = null
let finishCard: (() => void) | null = null

beforeEach(() => {
    resetPickOpenerForTest()
    // The import stays pending until the card closes, as in a Preflight sheet that waits for Cancel.
    importCharacterSpy.mockImplementation(async () => {
        const active = document.activeElement
        rememberPickOpener(active instanceof HTMLElement && active !== document.body ? active : null)
        markPickReturned()
        await new Promise<void>(resolve => { finishCard = resolve })
        return []
    })
})

afterEach(() => {
    if (component) {
        unmount(component)
        component = null
    }
    finishCard?.()
    finishCard = null
    resetPickOpenerForTest()
    importCharacterSpy.mockReset()
    document.body.replaceChildren()
})

function importButton(): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === language.homeEmptyImport)
    if (!found) throw new Error('Import button not rendered')
    return found
}

describe('the hero Import button around a pick', () => {
    test('stays the focused element while the import runs, so a card that closes can return focus to it', async () => {
        component = mount(HomeEmptyHero, { target: document.body })
        flushSync()
        const button = importButton()
        button.focus()
        expect(document.activeElement).toBe(button)

        button.click()
        await tick()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalled())
        await tick()

        expect(button.disabled).toBe(false)
        expect(document.activeElement).toBe(button)

        // The chooser takes focus away; the card closes while the import is still pending, so the button must accept focus then.
        button.blur()
        expect(document.activeElement).toBe(document.body)
        const opener = takePickOpener()
        expect(opener).toBe(button)
        opener?.focus()
        expect(document.activeElement).toBe(button)
    })

    test('a second activation while the import runs does not start another import', async () => {
        component = mount(HomeEmptyHero, { target: document.body })
        flushSync()
        const button = importButton()
        button.click()
        await tick()
        button.click()
        await tick()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalled())
        expect(importCharacterSpy).toHaveBeenCalledTimes(1)
        expect(button.getAttribute('aria-disabled')).toBe('true')
    })
})
