// @vitest-environment jsdom

/**
 * The lorebook settings tab shows the "SillyTavern-style Word Boundaries" check beside "Full Word
 * Matching" while the character has its own lore settings, and toggling it writes
 * `loreSettings.fullWordAsciiBoundary`. The "Word-start Matching" check sits beside them and writes
 * `loreSettings.cjkWordStart`. With the global settings in use no such check is shown.
 * Titles beginning "regression reproducer:" fail when the check is missing; "guard:" pass before and after.
 *
 * Mounts the REAL `LoreBookSetting` with the real `CheckInput` and English strings. MOCKED:
 * `stores.svelte`, `lorebook.svelte`, `alert` and the lore list.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/lorebook.svelte', () => ({
    addLorebook: vi.fn(), addLorebookFolder: vi.fn(), exportLoreBook: vi.fn(), importLoreBook: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('./LoreBookList.svelte', () => ({ default: () => {} }))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import LoreBookSetting from './LoreBookSetting.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function render(loreSettings?: Database['characters'][number]['loreSettings'], type: 'character' | 'group' = 'character') {
    DBState.db = {
        characters: [{ type, chatPage: 0, chats: [{ localLore: [] }], globalLore: [], loreSettings }],
        loreBookToken: 100,
        loreBookDepth: 3,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(LoreBookSetting, { target }))
    flushSync()
    const tabs = target.querySelectorAll<HTMLButtonElement>('button')
    tabs[2].click()
    flushSync()
    return target
}

const checkNamed = (target: HTMLElement, name: string) => target.querySelector<HTMLInputElement>(`input[type="checkbox"][alt="${name}"]`)

// `loreExt` exists on character cards only, so the shared character union does not declare it.
const extensionsOf = (char: Database['characters'][number]) => char as { loreExt?: Record<string, unknown> }

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.innerHTML = ''
})

describe('LoreBookSetting word-start matching check', () => {
    // A fresh object per test: the component writes through to the settings it is given.
    const own = () => ({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: false })

    test('regression reproducer: toggling the check sets the character option', () => {
        const target = render(own())
        const check = checkNamed(target, language.cjkWordStart)
        expect(check).not.toBeNull()
        check!.click()
        flushSync()
        expect(DBState.db.characters[0].loreSettings?.cjkWordStart).toBe(true)
        check!.click()
        flushSync()
        expect(DBState.db.characters[0].loreSettings?.cjkWordStart).toBe(false)
    })

    test('regression reproducer: toggling the check keeps the stored card extensions in step and leaves the other flag alone', () => {
        const target = render(own())
        extensionsOf(DBState.db.characters[0]).loreExt = { other: 1, risu_fullWordAsciiBoundary: true }
        const check = checkNamed(target, language.cjkWordStart)
        expect(check).not.toBeNull()
        check!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ other: 1, risu_fullWordAsciiBoundary: true, risu_cjkWordStart: true })
        check!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ other: 1, risu_fullWordAsciiBoundary: true })
    })

    test('regression reproducer: turning the check on creates the card extensions when absent', () => {
        const target = render(own())
        const check = checkNamed(target, language.cjkWordStart)
        expect(check).not.toBeNull()
        check!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ risu_cjkWordStart: true })
    })

    test('regression reproducer: a character with the option on shows the check ticked', () => {
        const target = render({ ...own(), cjkWordStart: true })
        expect(checkNamed(target, language.cjkWordStart)?.checked).toBe(true)
    })

    test('regression reproducer: the check is shown while Full Word Matching is off', () => {
        const target = render(own())
        expect(checkNamed(target, language.fullWordMatching)?.checked).toBe(false)
        expect(checkNamed(target, language.cjkWordStart)).not.toBeNull()
    })

    test('regression reproducer: a group character toggles the option without creating card extensions', () => {
        const target = render(own(), 'group')
        const check = checkNamed(target, language.cjkWordStart)
        expect(check).not.toBeNull()
        check!.click()
        flushSync()
        expect(DBState.db.characters[0].loreSettings?.cjkWordStart).toBe(true)
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toBeUndefined()
    })

    test('guard: the global-settings branch shows no word-start check', () => {
        expect(checkNamed(render(undefined), language.cjkWordStart)).toBeNull()
    })
})

describe('LoreBookSetting SillyTavern-style word boundaries check', () => {
    test('regression reproducer: toggling the check sets the character option', () => {
        const target = render({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: true })
        const check = checkNamed(target, language.fullWordAsciiBoundary)
        expect(check).not.toBeNull()
        check!.click()
        flushSync()
        expect(DBState.db.characters[0].loreSettings?.fullWordAsciiBoundary).toBe(true)
        check!.click()
        flushSync()
        expect(DBState.db.characters[0].loreSettings?.fullWordAsciiBoundary).toBe(false)
    })

    test('regression reproducer: toggling the check keeps the stored card extensions in step', () => {
        const target = render({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: true })
        extensionsOf(DBState.db.characters[0]).loreExt = { other: 1 }
        const check = checkNamed(target, language.fullWordAsciiBoundary)
        check!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ other: 1, risu_fullWordAsciiBoundary: true })
        check!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ other: 1 })
    })

    test('regression reproducer: turning the check on creates the card extensions when absent', () => {
        const target = render({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false })
        checkNamed(target, language.fullWordAsciiBoundary)!.click()
        flushSync()
        expect(extensionsOf(DBState.db.characters[0]).loreExt).toEqual({ risu_fullWordAsciiBoundary: true })
    })

    test('regression reproducer: a character with the option on shows the check ticked', () => {
        const target = render({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: true, fullWordAsciiBoundary: true })
        expect(checkNamed(target, language.fullWordAsciiBoundary)?.checked).toBe(true)
    })

    test('guard: the Full Word Matching check is still present and the global-settings branch shows neither', () => {
        const own = render({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false })
        expect(checkNamed(own, language.fullWordMatching)).not.toBeNull()
        const global = render(undefined)
        expect(checkNamed(global, language.fullWordMatching)).toBeNull()
        expect(checkNamed(global, language.fullWordAsciiBoundary)).toBeNull()
    })
})
