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

/**
 * Class guards for the top bar's centring and the wordmark. jsdom does no layout, so these pin the
 * class strings that produce the geometry (the equal insets and side tracks, the margins that
 * reclaim the inset difference, the truncating wordmark); the measured offsets are a real-layout
 * check, not something this file can show.
 */
describe('HomeShell top bar centring and wordmark', () => {
    const classesOf = (element: Element | null): string[] => Array.from(element?.classList ?? [])
    const gridColumnsOf = (bar: HTMLElement): string[] => {
        const tokens = classesOf(bar).filter((c) => c.startsWith('grid-cols-['))
        expect(tokens.length).toBe(1)
        return tokens[0].slice('grid-cols-['.length, -1).split('_')
    }
    const switcherWrapperOf = (root: HTMLElement): Element | null => topBarOf(root)!.querySelector('fieldset')!.parentElement
    const chipWrapperOf = (root: HTMLElement): Element | null => chipOf(root)!.parentElement

    // Class guard: the wide bar carries equal insets so the content box shares the bar's centre.
    test('T-F1: the wide bar has equal start and end insets and the end inset follows the band on a resize', () => {
        const root = mountShellAt(1280)
        for (const width of [1280, 1920]) {
            resizeTo(width)
            const wide = classesOf(topBarOf(root))
            expect(wide).toContain('pl-14')
            expect(wide).toContain('pr-14')
            expect(wide).not.toContain('pr-4')
        }
        resizeTo(767)
        const phone = classesOf(topBarOf(root))
        expect(phone).toContain('pr-4')
        expect(phone).not.toContain('pr-14')
        resizeTo(1280)
        const wideAgain = classesOf(topBarOf(root))
        expect(wideAgain).toContain('pr-14')
        expect(wideAgain).not.toContain('pr-4')
    })

    // Class guard: equal side tracks with equal fixed minimums put the auto track at the centre.
    test('T-F2: the wide grid has two identical flexible side tracks around an auto track and no max-content track', () => {
        const root = mountShellAt(1280)
        const tracks = gridColumnsOf(topBarOf(root)!)
        expect(tracks.length).toBe(3)
        expect(tracks[0]).toBe('minmax(2.75rem,1fr)')
        expect(tracks[2]).toBe(tracks[0])
        expect(tracks[1]).toBe('auto')
        expect(tracks.join('_')).not.toContain('max-content')
    })

    // Class guard: the negative end margin equals the inset difference, so the chip keeps its
    // 16 px right edge while the switcher column stays symmetric.
    test('T-F3: the wide chip wrapper reclaims the inset difference and the switcher wrapper is centred', () => {
        const root = mountShellAt(1280)
        const chipWrapper = classesOf(chipWrapperOf(root))
        expect(chipWrapper).toContain('min-w-0')
        expect(chipWrapper).toContain('-mr-10')
        expect(chipWrapper).toContain('justify-end')
        const switcherWrapper = classesOf(switcherWrapperOf(root))
        expect(switcherWrapper).toContain('justify-center')
        expect(switcherWrapper).not.toContain('-ml-10')
    })

    // Class guard: the wordmark truncates instead of overflowing onto the switcher; the full text
    // stays in the DOM and the mark stays decorative.
    test.each([360, 900, 1280])('T-F4: at %i the wordmark truncates, the mark keeps its size and the text is complete', (width) => {
        const root = mountShellAt(width)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).toContain('min-w-0')
        const word = brand.querySelector('span')!
        expect(classesOf(word)).toContain('min-w-0')
        expect(classesOf(word)).toContain('truncate')
        expect(word.textContent).toBe('RisuTanium')
        const mark = brand.querySelector('svg')!
        expect(classesOf(mark)).toContain('shrink-0')
        expect(mark.getAttribute('aria-hidden')).toBe('true')
    })

    // Class guard: in mid only the switcher row is stretched into the start inset; the bar insets
    // stay unequal and the chip wrapper is untouched.
    test.each([768, 900, 1279])('T-F5: at %i the mid switcher row reclaims the start inset and the chip wrapper is unchanged', (width) => {
        const root = mountShellAt(width)
        const bar = topBarOf(root)!
        const barClasses = classesOf(bar)
        expect(barClasses).toContain('pl-14')
        expect(barClasses).toContain('pr-4')
        expect(barClasses).not.toContain('pr-14')
        expect(gridColumnsOf(bar)).toEqual(['minmax(5.75rem,1fr)', 'minmax(0,auto)'])

        const switcherWrapper = classesOf(switcherWrapperOf(root))
        expect(switcherWrapper).toContain('col-span-2')
        expect(switcherWrapper).toContain('-ml-10')
        expect(switcherWrapper).toContain('justify-center')
        const chipWrapper = classesOf(chipWrapperOf(root))
        expect(chipWrapper).toContain('col-start-2')
        expect(chipWrapper).toContain('justify-end')
        expect(chipWrapper).not.toContain('-mr-10')
    })

    // Class guard, not a layout proof: the hint is clamped to the chip so an unbreakable run (ja, cn)
    // is ellipsised instead of spilling out; it may still wrap at break points.
    test.each([360, 900, 1280])('T-G2: at %i the persona hint is clamped to the chip and still wraps', (width) => {
        const root = mountShellAt(width)
        const hint = Array.from(chipOf(root)!.querySelectorAll('span')).find((s) => s.textContent === language.homePersonaChipHint)!
        expect(hint).toBeTruthy()
        const classes = classesOf(hint)
        expect(classes).toContain('max-w-full')
        expect(classes).toContain('overflow-hidden')
        expect(classes).toContain('text-ellipsis')
        expect(classes).toContain('break-keep')
        expect(classes).not.toContain('whitespace-nowrap')
        expect(classes).not.toContain('truncate')
    })

    // Class guard, not a layout proof: each wrapped switcher line is centred in mid and wide
    // (MC-1440); the wrapper centres the fieldset box itself.
    test.each([900, 1280])('T-G3: at %i the switcher wrapper centres every wrapped line', (width) => {
        const root = mountShellAt(width)
        expect(classesOf(switcherWrapperOf(root))).toContain('*:justify-center')
    })

    // Compatibility guard (passes before and after): the phone wrapper is not centred, and the
    // fieldset never carries justify-center itself.
    test.each([360, 900, 1280])('T-G3c: at %i the fieldset has no justify-center and the phone wrapper has none either', (width) => {
        const root = mountShellAt(width)
        expect(classesOf(topBarOf(root)!.querySelector('fieldset'))).not.toContain('justify-center')
        if (width === 360) expect(classesOf(switcherWrapperOf(root))).not.toContain('*:justify-center')
    })

    // Class guards (MC-1443), not layout proofs: jsdom cannot evaluate container queries. In mid and
    // wide the brand cell is the container and the wordmark is visually hidden below 3.75rem; the
    // text stays in the DOM, so the brand keeps its text alternative.
    test.each([768, 900, 1280])('T-H1: at %i the brand cell is a container and the wordmark hides below 3.75rem', (width) => {
        const root = mountShellAt(width)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).toContain('@container')
        const word = brand.querySelector('span')!
        expect(classesOf(word)).toContain('@max-[3.75rem]:sr-only')
        expect(classesOf(word)).not.toContain('@max-[3.75rem]:hidden')
        expect(classesOf(word)).toContain('truncate')
        expect(word.textContent).toBe('RisuTanium')
        expect(word.hasAttribute('aria-hidden')).toBe(false)
    })

    // Compatibility guard (passes before and after): the phone brand has no container and no hide rule.
    test('T-H1c: at 360 the phone brand has no container and no wordmark hide rule', () => {
        const root = mountShellAt(360)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).not.toContain('@container')
        expect(classesOf(brand.querySelector('span')).some((c) => c.startsWith('@max-'))).toBe(false)
    })

    // Class guard, red on the base (the base first track has a zero minimum): the mid first-track minimum keeps the wordmark
    // above the hide threshold (en at 1280 open stays "Ris…", MC-1436).
    test.each([768, 900, 1279])('T-H2: at %i the first track minimum leaves the wordmark above 24 px', (width) => {
        const root = mountShellAt(width)
        const first = gridColumnsOf(topBarOf(root)!)[0]
        const minimumRem = Number(/^minmax\(([\d.]+)rem,/.exec(first)![1])
        expect(minimumRem).toBeGreaterThanOrEqual(3.75)
    })

    // Class guards: the chip is capped inside the bar and its name label truncates, so a long
    // unbroken name is clipped by the chip instead of widening it past the bar.
    test.each([360, 900, 1280])('T-H3: at %i the chip is width-capped and the name label truncates', (width) => {
        const root = mountShellAt(width)
        const chip = chipOf(root)!
        expect(classesOf(chip)).toContain('max-w-[calc(100%-2rem)]')
        const label = chip.querySelector('span > span')!
        expect(label.textContent).not.toBe('')
        expect(classesOf(label)).toContain('truncate')
    })

    // Compatibility guard (passes before and after): the phone bar and its wrappers are unchanged.
    test('T-F6: at 360 the phone bar keeps its insets and column and no wrapper takes a negative margin', () => {
        const root = mountShellAt(360)
        const barClasses = classesOf(topBarOf(root))
        expect(barClasses).toContain('pl-4')
        expect(barClasses).toContain('pr-4')
        expect(barClasses).toContain('flex-col')
        expect(barClasses).not.toContain('pr-14')
        expect(classesOf(chipWrapperOf(root))).not.toContain('-mr-10')
        expect(classesOf(switcherWrapperOf(root))).not.toContain('-ml-10')
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
