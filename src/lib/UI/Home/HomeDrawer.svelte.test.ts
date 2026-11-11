// @vitest-environment jsdom

/**
 * The phone Home drawer, driven through `HomeShell.svelte` at a 360 px viewport: the menu button
 * opens a labelled modal drawer; Back, Escape, the scrim and the close button end it with focus
 * returned to the menu button; the page is inert and the toast timers pause while it is open; its
 * items close it before they act; a cover, the Realm view or a resize out of the phone band closes it.
 *
 * MOCKED: the module set of `HomeShell.svelte.test.ts`, plus the store exports the drawer and the
 * page-level chrome read (`settingsOpen`, `PlaygroundStore`, `selectedCharID`, `sideBarStore`,
 * `additionalHamburgerMenu`). `studioOpen` is the real leaf store.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { dispatchBack, installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { modalLayerCount } from 'src/lib/Nexus/pattern/modalLayers.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        sideBarStore: writable(false),
        settingsOpen: writable(false),
        PlaygroundStore: writable(0),
        selectedCharID: writable(-1),
        additionalHamburgerMenu: [{ name: 'Plug', icon: '', iconType: 'none', callback: vi.fn(), id: 'plug' }],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))

vi.mock('./HomeLibrary.svelte', () => ({ default: (_anchor: Comment) => {} }))

//#endregion

import HomeShell from './HomeShell.svelte'
import { homeView, showHomeLanding } from './homeView.svelte'
import { OpenRealmStore, PlaygroundStore, additionalHamburgerMenu, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []
const originalInnerWidth = window.innerWidth

function setViewportWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function resizeTo(width: number): void {
    setViewportWidth(width)
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

/** Mounts the shell at `width` inside a `<main>` that also holds a plain sibling and an already-inert one. */
function mountShellAt(width: number): HTMLElement {
    setViewportWidth(width)
    const main = document.createElement('main')
    const target = document.createElement('div')
    const sibling = document.createElement('div')
    sibling.setAttribute('data-test', 'sibling')
    const preInert = document.createElement('div')
    preInert.setAttribute('data-test', 'pre-inert')
    preInert.setAttribute('inert', '')
    main.append(target, sibling, preInert)
    document.body.appendChild(main)
    mountedTargets.push(main)
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

const menuButtonOf = (root: HTMLElement): HTMLButtonElement | null => root.querySelector('[data-part="home-menu-button"]')
const topBarOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-topbar"]')
const drawerOf = (): HTMLElement | null => document.querySelector('[data-part="home-drawer"]')
const scrimOf = (): HTMLElement | null => document.querySelector('[data-part="home-drawer-scrim"]')
const closeButtonOf = (): HTMLElement | null => document.querySelector('[data-part="home-drawer-close"]')
const itemsOf = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-part="home-drawer-item"]'))
const itemNamed = (label: string): HTMLElement | undefined => itemsOf().find((item) => item.textContent?.trim() === label)
const siblingOf = (root: HTMLElement): Element | null => root.parentElement!.querySelector('[data-test="sibling"]')
const preInertOf = (root: HTMLElement): Element | null => root.parentElement!.querySelector('[data-test="pre-inert"]')

/** The Characters button of the landing content: the library entry found by its label, outside the drawer. */
function contentCharactersButtonOf(root: HTMLElement): HTMLButtonElement | null {
    return Array.from(root.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === language.character && !b.closest('[data-part="home-drawer"]'),
    ) ?? null
}

function openDrawer(root: HTMLElement): HTMLButtonElement {
    const button = menuButtonOf(root)
    expect(button).not.toBeNull()
    button!.click()
    flushSync()
    expect(drawerOf()).not.toBeNull()
    return button!
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    flushSync()
    return event
}

const pluginCallback = additionalHamburgerMenu[0].callback as ReturnType<typeof vi.fn>

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
    pluginCallback.mockReset()
})

afterEach(async () => {
    OpenRealmStore.set(false)
    settingsOpen.set(false)
    studioOpen.set(false)
    PlaygroundStore.set(0)
    selectedCharID.set(-1)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    setViewportWidth(originalInnerWidth)
    resetBackHandlersForTests()
    showHomeLanding()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('HomeDrawer', () => {
    test('T-B1: the menu button opens a labelled modal drawer listing Home, Characters, Playground, the plugin items and Settings', () => {
        const root = mountShellAt(360)
        const button = menuButtonOf(root)
        expect(button).not.toBeNull()
        expect(button!.getAttribute('aria-label')).toBe(language.menu)
        expect(button!.getAttribute('aria-expanded')).toBe('false')
        expect(button!.hasAttribute('aria-controls')).toBe(false)
        expect(drawerOf()).toBeNull()

        button!.click()
        flushSync()
        const drawer = drawerOf()
        expect(drawer).not.toBeNull()
        expect(drawer!.getAttribute('role')).toBe('dialog')
        expect(drawer!.getAttribute('aria-modal')).toBe('true')
        const heading = document.getElementById(drawer!.getAttribute('aria-labelledby')!)
        expect(heading).not.toBeNull()
        expect(heading!.textContent?.trim()).toBe(language.menu)
        expect(button!.getAttribute('aria-expanded')).toBe('true')
        expect(button!.getAttribute('aria-controls')).toBe(drawer!.id)
        expect(closeButtonOf()!.getAttribute('aria-label')).toBe(language.uiCommon.close)

        expect(itemsOf().map((item) => item.textContent?.trim())).toEqual([
            language.home,
            language.character,
            language.playground.playground,
            'Plug',
            language.settings,
        ])
        expect(itemNamed(language.home)!.getAttribute('aria-current')).toBe('page')
        expect(itemNamed(language.character)!.hasAttribute('aria-current')).toBe(false)
        expect(document.activeElement).toBe(itemsOf()[0])
    })

    // Class guard only: jsdom has no layout, so this cannot measure a rendered size. The real 44 px
    // touch targets (DD-213) are a device check.
    test('T-B1c: the menu button, the drawer close button and the drawer items carry the 44 px target classes', () => {
        const root = mountShellAt(360)
        const button = menuButtonOf(root)!
        expect(button.classList.contains('h-11')).toBe(true)
        expect(button.classList.contains('w-11')).toBe(true)

        openDrawer(root)
        const close = closeButtonOf()!
        expect(close.classList.contains('h-11')).toBe(true)
        expect(close.classList.contains('w-11')).toBe(true)
        const items = itemsOf()
        expect(items.length).toBeGreaterThan(0)
        for (const item of items) expect(item.classList.contains('min-h-11')).toBe(true)
    })

    test('T-B1b: on the phone the Characters button is not in the content; at mid it is', () => {
        const phone = mountShellAt(360)
        expect(menuButtonOf(phone)).not.toBeNull()
        expect(contentCharactersButtonOf(phone)).toBeNull()

        const mid = mountShellAt(900)
        expect(menuButtonOf(mid)).toBeNull()
        expect(contentCharactersButtonOf(mid)).not.toBeNull()
    })

    test('T-B2: the Characters item opens the library and closes the drawer with no layer left', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        expect(modalLayerCount()).toBe(1)
        itemNamed(language.character)!.click()
        flushSync()
        expect(homeView.view).toBe('library')
        expect(drawerOf()).toBeNull()
        expect(modalLayerCount()).toBe(0)
    })

    test('T-B3: Back closes only the drawer and returns focus to the menu button; the next Back shows the quit toast', () => {
        const showToast = vi.fn()
        installBackGuard({ showToast })
        const root = mountShellAt(360)
        const button = openDrawer(root)

        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(showToast).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(button)

        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('T-B4: Escape, the scrim and the close button each close the drawer and return focus to the menu button', () => {
        const root = mountShellAt(360)
        const button = menuButtonOf(root)
        expect(button).not.toBeNull()

        openDrawer(root)
        const escape = press('Escape')
        expect(escape.defaultPrevented).toBe(true)
        expect(drawerOf()).toBeNull()
        expect(document.activeElement).toBe(button)

        openDrawer(root)
        expect(scrimOf()).not.toBeNull()
        scrimOf()!.click()
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(document.activeElement).toBe(button)

        openDrawer(root)
        expect(closeButtonOf()).not.toBeNull()
        closeButtonOf()!.click()
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(document.activeElement).toBe(button)
    })

    test('T-B5: while open the top bar, the content and the siblings are inert; on close all but the pre-inert one are released', () => {
        const root = mountShellAt(360)
        const bar = topBarOf(root)
        expect(bar).not.toBeNull()
        const content = bar!.nextElementSibling as HTMLElement
        expect(preInertOf(root)!.hasAttribute('inert')).toBe(true)

        openDrawer(root)
        expect(bar!.hasAttribute('inert')).toBe(true)
        expect(content.hasAttribute('inert')).toBe(true)
        expect(siblingOf(root)!.hasAttribute('inert')).toBe(true)
        expect(drawerOf()!.closest('[inert]')).toBeNull()

        press('Escape')
        expect(bar!.hasAttribute('inert')).toBe(false)
        expect(content.hasAttribute('inert')).toBe(false)
        expect(siblingOf(root)!.hasAttribute('inert')).toBe(false)
        expect(preInertOf(root)!.hasAttribute('inert')).toBe(true)
    })

    test('T-B6: Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        const controls = [closeButtonOf()!, ...itemsOf()]
        const first = controls[0]
        const last = controls[controls.length - 1]

        last.focus()
        const forward = press('Tab')
        expect(forward.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(first)

        first.focus()
        const backward = press('Tab', { shiftKey: true })
        expect(backward.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(last)
    })

    test('T-B7: one modal layer is held while open and none after close or after an unmount while open', async () => {
        const root = mountShellAt(360)
        expect(modalLayerCount()).toBe(0)
        openDrawer(root)
        expect(modalLayerCount()).toBe(1)
        press('Escape')
        expect(modalLayerCount()).toBe(0)

        openDrawer(root)
        expect(modalLayerCount()).toBe(1)
        await unmount(mountedInstances.pop() as never)
        expect(modalLayerCount()).toBe(0)
        // The Back handler went with it: the press is not consumed by a drawer that no longer exists.
        const showToast = vi.fn()
        installBackGuard({ showToast })
        dispatchBack()
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('T-B8: Settings opens after the drawer is closed and focus is on the menu button', () => {
        const root = mountShellAt(360)
        const button = openDrawer(root)
        const seen: { active: Element | null, drawerOpen: boolean, layers: number }[] = []
        const stop = settingsOpen.subscribe((value) => {
            if (value) seen.push({ active: document.activeElement, drawerOpen: drawerOf() !== null, layers: modalLayerCount() })
        })
        itemNamed(language.settings)!.click()
        flushSync()
        stop()
        expect(seen.length).toBe(1)
        expect(seen[0].active).toBe(button)
        expect(seen[0].drawerOpen).toBe(false)
        expect(seen[0].layers).toBe(0)
        expect(get(settingsOpen)).toBe(true)
    })

    test('T-B9: a cover (Studio or Settings) closes the drawer and leaves no layer', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        studioOpen.set(true)
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(modalLayerCount()).toBe(0)
        // Focus is not pulled back to the menu button under the cover.
        expect(document.activeElement).not.toBe(menuButtonOf(root))
        studioOpen.set(false)
        flushSync()

        openDrawer(root)
        settingsOpen.set(true)
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(modalLayerCount()).toBe(0)
        expect(document.activeElement).not.toBe(menuButtonOf(root))
    })

    test('T-B10: a resize out of the phone band closes the drawer and the menu button goes; it does not return on the way back', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        resizeTo(900)
        expect(drawerOf()).toBeNull()
        expect(menuButtonOf(root)).toBeNull()
        expect(modalLayerCount()).toBe(0)
        resizeTo(360)
        expect(menuButtonOf(root)).not.toBeNull()
        expect(drawerOf()).toBeNull()
    })

    test('T-B11: Playground and a plugin item act only after the drawer is closed', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        itemNamed(language.playground.playground)!.click()
        flushSync()
        expect(get(PlaygroundStore)).toBe(1)
        expect(get(selectedCharID)).toBe(-1)
        expect(drawerOf()).toBeNull()

        const layersAtCall: number[] = []
        pluginCallback.mockImplementation(() => {
            layersAtCall.push(modalLayerCount())
        })
        openDrawer(root)
        itemNamed('Plug')!.click()
        flushSync()
        expect(pluginCallback).toHaveBeenCalledTimes(1)
        expect(layersAtCall).toEqual([0])
        expect(drawerOf()).toBeNull()
    })

    test('T-B11b: the Playground item clears the selected character before opening the Playground', () => {
        selectedCharID.set(3)
        const root = mountShellAt(360)
        openDrawer(root)
        itemNamed(language.playground.playground)!.click()
        flushSync()
        expect(get(selectedCharID)).toBe(-1)
        expect(get(PlaygroundStore)).toBe(1)
    })

    test('T-B14: opening the Realm view closes the drawer and leaves no layer', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        OpenRealmStore.set(true)
        flushSync()
        expect(drawerOf()).toBeNull()
        expect(modalLayerCount()).toBe(0)
        OpenRealmStore.set(false)
        flushSync()
        expect(menuButtonOf(root)).not.toBeNull()
        expect(drawerOf()).toBeNull()
    })

    test('T-B15: the drawer carries no panel-gesture handle', () => {
        const root = mountShellAt(360)
        openDrawer(root)
        expect(drawerOf()!.closest('[data-panel-handle]')).toBeNull()
        expect(document.querySelector('[data-part="home-drawer-layer"] [data-panel-handle]')).toBeNull()
    })
})
