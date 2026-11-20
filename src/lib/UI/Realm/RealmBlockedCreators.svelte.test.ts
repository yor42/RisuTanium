// @vitest-environment jsdom

/**
 * The blocked-creators list is a modal dialog: it has a role and a name, focus starts on its named
 * close button and stays inside, Escape and the hardware Back close it, and focus returns to the
 * control that opened it. MOCKED: `src/ts/stores.svelte` (a plain database with two blocked
 * creators). Synthetic data only.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { blockedRealmCreators: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        settingsOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import RealmBlockedCreators from './RealmBlockedCreators.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const showToast = vi.fn()

function mountDialog(props: { onClose?: () => void, onUnblock?: () => void } = {}) {
    // The app shell hosts the page inside <main>; the dialog holds the siblings up to it inert.
    const main = document.createElement('main')
    document.body.appendChild(main)
    const opener = document.createElement('button')
    opener.textContent = 'open'
    main.appendChild(opener)
    opener.focus()
    const target = document.createElement('div')
    main.appendChild(target)
    mounted.push(mount(RealmBlockedCreators, { target, props }))
    flushSync()
    return { target, opener }
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

beforeEach(() => {
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    showToast.mockReset()
    DBState.db.blockedRealmCreators = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('RealmBlockedCreators.svelte: dialog semantics and focus', () => {
    test('the panel is a modal dialog named by its heading', () => {
        const { target } = mountDialog()
        const dialog = target.querySelector('[role="dialog"]')!
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        const heading = document.getElementById(dialog.getAttribute('aria-labelledby')!)
        expect(heading?.textContent?.trim()).toBe(language.blockedRealmCreators)
    })

    test('focus starts on the named close button, which closes the dialog', () => {
        const onClose = vi.fn()
        const { target } = mountDialog({ onClose })
        const close = target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(close).toBeTruthy()
        expect(document.activeElement).toBe(close)
        close.click()
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('Escape closes the dialog', () => {
        const onClose = vi.fn()
        mountDialog({ onClose })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('hardware Back closes the dialog before anything else answers', () => {
        const onClose = vi.fn()
        mountDialog({ onClose })
        expect(pressBack()).toBe(true)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('a click inside the panel does not close; a click on the scrim does', () => {
        const onClose = vi.fn()
        const { target } = mountDialog({ onClose })
        ;(target.querySelector('[role="dialog"]') as HTMLElement).click()
        expect(onClose).not.toHaveBeenCalled()
        ;(target.firstElementChild as HTMLElement).click()
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last', () => {
        const { target } = mountDialog()
        const buttons = Array.from(target.querySelectorAll<HTMLElement>('button'))
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        last.focus()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        expect(document.activeElement).toBe(first)
        first.focus()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
        expect(document.activeElement).toBe(last)
    })

    test('the page behind is inert while open, and focus returns to the opener on close', () => {
        const { opener } = mountDialog()
        expect(opener.hasAttribute('inert')).toBe(true)
        unmount(mounted.pop()!)
        expect(opener.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(opener)
    })
})

describe('RealmBlockedCreators.svelte: names and colours', () => {
    test('every control is named, the glyphs are hidden, and only the scrim uses a default-palette class', () => {
        const { target } = mountDialog()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
    })
})

describe('RealmBlockedCreators.svelte: unblocking', () => {
    test('Unblock is a text button without an icon; it removes the creator and notifies the host', async () => {
        const onUnblock = vi.fn()
        const { target } = mountDialog({ onUnblock })
        const unblock = Array.from(target.querySelectorAll('button')).filter((b) => b.textContent?.trim() === language.unblockRealmCreator)
        expect(unblock.length).toBe(2)
        expect(unblock[0].querySelector('svg')).toBeNull()

        unblock[0].click()
        await Promise.resolve()
        flushSync()
        expect((DBState.db.blockedRealmCreators as Array<{ id: string }>).map((c) => c.id)).toEqual(['b'])
        expect(onUnblock).toHaveBeenCalledTimes(1)
    })
})
