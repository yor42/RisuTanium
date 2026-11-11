// @vitest-environment jsdom

/**
 * `HomeShell.svelte` layout: the Home-local width band and the top bar (brand, mode switcher,
 * persona chip) on the landing. The band flips at 768 and 1280 and follows a live resize; the
 * Characters button stays in the content; the top bar is absent while the Realm view is open.
 *
 * It also covers the phone drawer's page-level effects: the `homeChrome.phoneDrawer` flag that hides
 * the sidebar arrow, and the close of a legacy sidebar overlay on arrival at the phone landing.
 *
 * MOCKED: the module set of `HomeShell.svelte.test.ts`, plus the store exports the phone drawer
 * reads only once it is mounted or the phone landing is entered (`sideBarStore`, `settingsOpen`,
 * `PlaygroundStore`, `selectedCharID`, `additionalHamburgerMenu`). The width comes from
 * `window.innerWidth`, set per test.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'

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
        additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))

vi.mock('./HomeLibrary.svelte', () => ({ default: (_anchor: Comment) => {} }))

//#endregion

import HomeShell from './HomeShell.svelte'
import { openHomeLibrary, showHomeLanding } from './homeView.svelte'
import { OpenRealmStore, sideBarStore } from 'src/ts/stores.svelte'

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

function mountShellAt(width: number): HTMLElement {
    setViewportWidth(width)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

const landingOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-landing"]')
const topBarOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-topbar"]')
const chipOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-persona-chip"]')
const menuButtonOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-menu-button"]')

/**
 * The page-level flag module, loaded ahead of the mount so a read right after the mount is not
 * separated from it by an await. The specifier is not a literal so a missing module fails the
 * assertions that need it instead of the whole file.
 */
const HOME_CHROME_SPECIFIER = './homeChrome.svelte'
async function loadHomeChrome(): Promise<typeof import('./homeChrome.svelte') | null> {
    return import(/* @vite-ignore */ HOME_CHROME_SPECIFIER).catch(() => null)
}

/** The Characters button: the landing's library entry, found by its visible label. */
function charactersButtonOf(root: HTMLElement): HTMLButtonElement | null {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.character) ?? null
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
})

afterEach(async () => {
    OpenRealmStore.set(false)
    sideBarStore.set(false)
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

describe('HomeShell layout', () => {
    test('T-A1: at 360 the landing carries a top bar holding the brand, the switcher and the chip', () => {
        const root = mountShellAt(360)
        const landing = landingOf(root)
        expect(landing).not.toBeNull()
        expect(landing!.getAttribute('data-layout')).toBe('phone')

        const bar = topBarOf(root)
        expect(bar).not.toBeNull()
        expect(bar!.querySelector('[data-part="home-brand"]')).not.toBeNull()
        expect(bar!.querySelector('[data-part="home-brand"]')!.textContent).toContain('RisuTanium')
        expect(bar!.querySelector('fieldset')).not.toBeNull()
        const chip = chipOf(root)
        expect(chip).not.toBeNull()
        expect(bar!.contains(chip)).toBe(true)
        expect(root.querySelectorAll('[data-part="home-persona-chip"]').length).toBe(1)
        expect(root.querySelectorAll('fieldset').length).toBe(1)
    })

    test('T-A1b: the decorative brand mark is hidden from assistive technology', () => {
        const root = mountShellAt(360)
        const mark = topBarOf(root)!.querySelector('[data-part="home-brand"] svg')
        expect(mark).not.toBeNull()
        expect(mark!.getAttribute('aria-hidden')).toBe('true')
    })

    test('T-A2: at 900 the layout is mid and the Characters button stays in the content, outside the top bar', () => {
        const root = mountShellAt(900)
        const landing = landingOf(root)
        expect(landing).not.toBeNull()
        expect(landing!.getAttribute('data-layout')).toBe('mid')

        const bar = topBarOf(root)
        expect(bar).not.toBeNull()
        expect(bar!.querySelector('[data-part="home-brand"]')).not.toBeNull()
        expect(bar!.querySelector('fieldset')).not.toBeNull()
        expect(bar!.contains(chipOf(root))).toBe(true)

        const characters = charactersButtonOf(root)
        expect(characters).not.toBeNull()
        expect(bar!.contains(characters)).toBe(false)
        expect(landing!.contains(characters)).toBe(true)
    })

    test('T-A2b: at 1280 the layout is wide with the same three parts in the top bar', () => {
        const root = mountShellAt(1280)
        const landing = landingOf(root)
        expect(landing).not.toBeNull()
        expect(landing!.getAttribute('data-layout')).toBe('wide')
        const bar = topBarOf(root)
        expect(bar).not.toBeNull()
        expect(bar!.querySelector('[data-part="home-brand"]')).not.toBeNull()
        expect(bar!.querySelector('fieldset')).not.toBeNull()
        expect(bar!.contains(chipOf(root))).toBe(true)
    })

    test('T-A2c: the top bar keeps one DOM order in every band: brand, switcher, chip', () => {
        for (const width of [360, 900, 1400]) {
            const root = mountShellAt(width)
            const bar = topBarOf(root)
            expect(bar).not.toBeNull()
            const brand = bar!.querySelector('[data-part="home-brand"]')!
            const switcher = bar!.querySelector('fieldset')!
            const chip = chipOf(root)!
            expect(brand.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
            expect(switcher.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        }
    })

    test.each([
        [767, 'phone'],
        [768, 'mid'],
        [1279, 'mid'],
        [1280, 'wide'],
    ])('T-A3: the band at %i is %s', (width, band) => {
        const root = mountShellAt(width)
        const landing = landingOf(root)
        expect(landing).not.toBeNull()
        expect(landing!.getAttribute('data-layout')).toBe(band)
    })

    test('T-A4: a resize re-bands the mounted landing live', () => {
        const root = mountShellAt(1280)
        const landing = landingOf(root)
        expect(landing).not.toBeNull()
        expect(landing!.getAttribute('data-layout')).toBe('wide')

        resizeTo(360)
        expect(landingOf(root)!.getAttribute('data-layout')).toBe('phone')
        resizeTo(900)
        expect(landingOf(root)!.getAttribute('data-layout')).toBe('mid')
    })

    // Compatibility guard: passes on base too, because the top bar does not exist there at all.
    test('T-A5: no top bar while the Realm view is open', () => {
        const root = mountShellAt(900)
        OpenRealmStore.set(true)
        flushSync()
        expect(topBarOf(root)).toBeNull()
        expect(chipOf(root)).toBeNull()
    })

    test('T-A5b: the top bar returns when the Realm view closes', () => {
        const root = mountShellAt(900)
        expect(topBarOf(root)).not.toBeNull()
        OpenRealmStore.set(true)
        flushSync()
        OpenRealmStore.set(false)
        flushSync()
        expect(topBarOf(root)).not.toBeNull()
    })
})

describe('HomeShell phone chrome', () => {
    test('T-B12: the flag is true on the phone landing and false at mid, in the library, with Realm open and after unmount', async () => {
        const chrome = await loadHomeChrome()
        const root = mountShellAt(360)
        expect(menuButtonOf(root)).not.toBeNull()
        expect(chrome).not.toBeNull()
        const { homeChrome } = chrome!
        expect(homeChrome.phoneDrawer).toBe(true)

        OpenRealmStore.set(true)
        flushSync()
        expect(homeChrome.phoneDrawer).toBe(false)
        OpenRealmStore.set(false)
        flushSync()
        expect(homeChrome.phoneDrawer).toBe(true)

        resizeTo(900)
        expect(homeChrome.phoneDrawer).toBe(false)
        resizeTo(360)
        expect(homeChrome.phoneDrawer).toBe(true)

        openHomeLibrary()
        await vi.waitFor(() => expect(landingOf(root)).toBeNull())
        flushSync()
        expect(homeChrome.phoneDrawer).toBe(false)
        showHomeLanding()
        flushSync()
        expect(homeChrome.phoneDrawer).toBe(true)

        await unmount(mountedInstances.pop() as never)
        expect(homeChrome.phoneDrawer).toBe(false)
    })

    test('T-B12c: the top bar shows on the landing only: absent once the library branch shows, present again on return', async () => {
        const root = mountShellAt(360)
        expect(topBarOf(root)).not.toBeNull()

        openHomeLibrary()
        await vi.waitFor(() => expect(landingOf(root)).toBeNull())
        flushSync()
        expect(topBarOf(root)).toBeNull()

        showHomeLanding()
        flushSync()
        expect(topBarOf(root)).not.toBeNull()
    })

    test('T-B12b: the flag is already set when the mount returns, before any effect flush', async () => {
        const chrome = await loadHomeChrome()
        setViewportWidth(360)
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        mountedInstances.push(mount(HomeShell, { target }))
        // No flushSync: the arrow must not render for even one frame on the phone landing.
        expect(menuButtonOf(target)).not.toBeNull()
        expect(chrome).not.toBeNull()
        expect(chrome!.homeChrome.phoneDrawer).toBe(true)
    })

    test('T-O3: arrival at the phone landing closes a legacy sidebar overlay, and mid and wide leave it open', () => {
        sideBarStore.set(true)
        const phone = mountShellAt(360)
        expect(menuButtonOf(phone)).not.toBeNull()
        expect(get(sideBarStore)).toBe(false)

        for (const width of [900, 1400]) {
            sideBarStore.set(true)
            const root = mountShellAt(width)
            expect(topBarOf(root)).not.toBeNull()
            expect(get(sideBarStore)).toBe(true)
        }
    })

    test('T-O3b: a resize into the phone band closes a legacy sidebar overlay', () => {
        const root = mountShellAt(900)
        expect(topBarOf(root)).not.toBeNull()
        sideBarStore.set(true)
        resizeTo(360)
        expect(menuButtonOf(root)).not.toBeNull()
        expect(get(sideBarStore)).toBe(false)
    })
})
