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

import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, onTestFinished } from 'vitest'
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
vi.mock('src/ts/characters', () => ({
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => 0,
    supersedeChangeChar: vi.fn(),
}))
vi.mock('src/ts/characterPick', () => ({ changeCharOrAlert: vi.fn() }))

vi.mock('./HomeLibrary.svelte', () => ({ default: (_anchor: Comment) => {} }))

//#endregion

import HomeShell from './HomeShell.svelte'
import HomeShellKeyHarness from './HomeShellKeyHarness.svelte'
import { openHomeLibrary, startHomeView } from './homeView.svelte'
import { DBState, OpenRealmStore, sideBarStore } from 'src/ts/stores.svelte'
import { ColorSchemeTypeStore } from 'src/ts/gui/surfaceTone'
import NexusBootScreen from 'src/lib/Nexus/boot/NexusBootScreen.svelte'

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
    startHomeView()
    // jsdom has no `scrollTo`; the library reveal calls it on the landing scroller.
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
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
    startHomeView()
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo
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

    // Class guard (MC-3081): the mark is 32 px (28 px under 640 px) and the seasonal logo finds its bar, brand cell and
    // mark through data attributes; the status mark stays idle and static on Home.
    test('T-A1c: the brand mark is 32 px, 28 px under 640 px, and carries the seasonal hooks', () => {
        const root = mountShellAt(1280)
        const bar = topBarOf(root)!
        const brand = bar.querySelector('[data-part="home-brand"]')!
        const mark = brand.querySelector('svg')!
        expect(mark.getAttribute('width')).toBe('32')
        expect(mark.classList.contains('size-8')).toBe(true)
        expect(mark.classList.contains('max-[639.98px]:size-7')).toBe(true)
        expect(mark.getAttribute('data-status')).toBe('idle')
        expect(mark.hasAttribute('data-seasonal-mark')).toBe(true)
        expect(brand.hasAttribute('data-seasonal-brand')).toBe(true)
        expect(bar.hasAttribute('data-seasonal-anchor')).toBe(true)
    })

    test('T-A2: at 900 the layout is mid and the Characters button stays in the content, outside the top bar, given library content (MC-2931)', () => {
        DBState.db.characters = [{ chaId: 'lib-1', name: 'Lib' }] as unknown as typeof DBState.db.characters
        onTestFinished(() => {
            Reflect.deleteProperty(DBState.db, 'characters')
        })
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

    test('T-A2c: mid puts brand, chip, switcher and wide puts brand, switcher, chip, matching visual order; the phone order is in T-S6-40', () => {
        const mid = mountShellAt(900)
        const midBar = topBarOf(mid)!
        const midBrand = midBar.querySelector('[data-part="home-brand"]')!
        const midChip = chipOf(mid)!
        const midSwitcher = midBar.querySelector('fieldset')!
        expect(midBrand.compareDocumentPosition(midChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(midChip.compareDocumentPosition(midSwitcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        const wide = mountShellAt(1400)
        const wideBar = topBarOf(wide)!
        const wideBrand = wideBar.querySelector('[data-part="home-brand"]')!
        const wideSwitcher = wideBar.querySelector('fieldset')!
        const wideChip = chipOf(wide)!
        expect(wideBrand.compareDocumentPosition(wideSwitcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(wideSwitcher.compareDocumentPosition(wideChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

    // Class guard: the wordmark box is clipped by the brand cell instead of overflowing onto the switcher; the full text
    // stays in the DOM (one accessible name node) and the mark stays decorative.
    test.each([360, 900, 1280])('T-F4: at %i the wordmark is clipped, the mark keeps its size and the text is complete', (width) => {
        const root = mountShellAt(width)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).toContain('min-w-0')
        expect(classesOf(brand)).toContain('overflow-x-clip')
        // The clip margin keeps the replay focus ring (outline plus offset, 5 px) from being cut at the cell edge.
        expect(classesOf(brand)).toContain('[overflow-clip-margin:6px]')
        // On an occasion day the cell pads its end by the scene contract's 22 px right overflow, so a final pose and the
        // focus ring stay inside the clip box where the clip margin is not honoured (Android WebView).
        expect(classesOf(brand)).toContain('data-seasonal-active:pe-[22px]')
        const word = brand.querySelector('[data-seasonal-host]')!
        expect(classesOf(word)).toContain('min-w-0')
        expect(word.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
        expect(word.querySelector('.rt-sw-text')!.getAttribute('aria-hidden')).toBe('true')
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
        expect(gridColumnsOf(bar)).toEqual(['minmax(6rem,1fr)', 'minmax(0,auto)'])

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
    // wide the brand cell is the container and the wordmark is visually hidden below 4rem (32 px mark, 8 px gap, 24 px word); the
    // text stays in the DOM, so the brand keeps its text alternative.
    test.each([768, 900, 1280])('T-H1: at %i the brand cell is a container and the wordmark hides below 4rem', (width) => {
        const root = mountShellAt(width)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).toContain('@container')
        const word = brand.querySelector('[data-seasonal-host]')!
        expect(classesOf(word)).toContain('@max-[4rem]:sr-only')
        expect(classesOf(word)).not.toContain('@max-[4rem]:hidden')
        expect(word.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
        expect(word.hasAttribute('aria-hidden')).toBe(false)
    })

    // Compatibility guard (passes before and after): the phone brand has no container and no hide rule.
    test('T-H1c: at 360 the phone brand has no container and no wordmark hide rule', () => {
        const root = mountShellAt(360)
        const brand = topBarOf(root)!.querySelector('[data-part="home-brand"]')!
        expect(classesOf(brand)).not.toContain('@container')
        expect(classesOf(brand.querySelector('[data-seasonal-host]')).some((c) => c.startsWith('@max-'))).toBe(false)
    })

    // Class guard on the mid layout's first track: the minimum keeps the wordmark above the hide threshold, so a clipped
    // "Ris…" stays visible. The mid layout also serves a wide band whose bar is narrower than the switch width (MC-3670).
    test.each([768, 900, 1279])('T-H2: at %i the first track minimum leaves the wordmark above 24 px', (width) => {
        const root = mountShellAt(width)
        const first = gridColumnsOf(topBarOf(root)!)[0]
        const minimumRem = Number(/^minmax\(([\d.]+)rem,/.exec(first)![1])
        // 32 px mark + 8 px gap + 24 px word is the hide threshold (4rem); the minimum keeps a 56 px word.
        expect(minimumRem).toBeGreaterThanOrEqual(4)
        expect(minimumRem).toBeGreaterThanOrEqual((32 + 8 + 56) / 16)
    })

    // Class guards: the chip is capped inside the bar and a stored name's label truncates, so a long
    // unbroken name is clipped by the chip instead of widening it past the bar. The set-up label (no
    // name) wraps instead, so it is never cut off at large font sizes.
    test.each([900, 1280])('T-H3: at %i the chip is width-capped and the name label truncates', (width) => {
        const before = DBState.db.username
        DBState.db.username = 'Averyveryverylongunbrokenpersonaname'
        try {
            const root = mountShellAt(width)
            const chip = chipOf(root)!
            expect(classesOf(chip)).toContain('max-w-[calc(100%-2rem)]')
            const label = chip.querySelector('[data-part="home-persona-chip-label"]')!
            expect(label.textContent).toContain('Averyveryverylongunbrokenpersonaname')
            expect(classesOf(label)).toContain('truncate')
        } finally {
            DBState.db.username = before
        }
    })

    test.each([360, 900, 1280])('T-H3b: at %i the set-up label wraps instead of truncating', (width) => {
        const root = mountShellAt(width)
        const label = chipOf(root)!.querySelector('[data-part="home-persona-chip-label"]')!
        expect(label.textContent).toBe(language.homePersonaChipUnnamed)
        expect(classesOf(label)).not.toContain('truncate')
        expect(classesOf(label)).toContain('break-keep')
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

/**
 * The wide bar's two-row fallback and the chip cluster's 44 px floor. The bar's own width is read through
 * `clientWidth` (jsdom reports 0), stubbed for the top bar only; a width change arrives through a recording
 * ResizeObserver that delivers only to the observers whose target is the bar's parent, because other code
 * (the seasonal host, lattice, jump) creates observers of its own. The pixel result is a real-browser check;
 * this block proves the classes and the wiring.
 */
describe('HomeShell wide bar fallback', () => {
    interface BarObserver {
        owner: ResizeObserver
        callback: ResizeObserverCallback
        targets: Element[]
        active: boolean
    }

    let observers: BarObserver[] = []
    let headerWidth = 0
    let widthDescriptor: PropertyDescriptor | undefined

    class RecordingObserver implements ResizeObserver {
        private readonly record: BarObserver
        constructor(callback: ResizeObserverCallback) {
            this.record = { owner: this, callback, targets: [], active: true }
            observers.push(this.record)
        }
        observe(target: Element): void {
            this.record.targets.push(target)
        }
        unobserve(target: Element): void {
            this.record.targets = this.record.targets.filter((t) => t !== target)
        }
        disconnect(): void {
            this.record.active = false
        }
    }

    beforeEach(() => {
        observers = []
        headerWidth = 0
        widthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
        Object.defineProperty(Element.prototype, 'clientWidth', {
            configurable: true,
            get(this: Element): number {
                if (this.getAttribute('data-part') === 'home-topbar') return headerWidth
                return (widthDescriptor?.get?.call(this) as number | undefined) ?? 0
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        if (widthDescriptor) {
            Object.defineProperty(Element.prototype, 'clientWidth', widthDescriptor)
        } else {
            Reflect.deleteProperty(Element.prototype, 'clientWidth')
        }
    })

    const classesOf = (element: Element | null): string[] => Array.from(element?.classList ?? [])
    const gridColumnsOf = (bar: HTMLElement): string[] => {
        const tokens = classesOf(bar).filter((c) => c.startsWith('grid-cols-['))
        expect(tokens.length).toBe(1)
        return tokens[0].slice('grid-cols-['.length, -1).split('_')
    }
    const switcherWrapperOf = (root: HTMLElement): Element | null => topBarOf(root)!.querySelector('fieldset')!.parentElement
    const chipWrapperOf = (root: HTMLElement): Element | null => chipOf(root)!.parentElement
    const layoutOf = (root: HTMLElement): string | null => topBarOf(root)!.getAttribute('data-layout')
    const stubObserver = (): void => {
        vi.stubGlobal('ResizeObserver', RecordingObserver)
    }
    const parentObservers = (root: HTMLElement): BarObserver[] =>
        observers.filter((o) => o.active && o.targets.includes(topBarOf(root)!.parentElement!))

    /** Delivers a new bar width to the observers of the bar's parent, the way the browser reports a resize. */
    function deliver(root: HTMLElement, width: number): void {
        headerWidth = width
        for (const o of parentObservers(root)) o.callback([], o.owner)
        flushSync()
    }

    function expectMidClasses(root: HTMLElement): void {
        const bar = topBarOf(root)!
        const barClasses = classesOf(bar)
        expect(barClasses).toContain('pl-14')
        expect(barClasses).toContain('pr-4')
        expect(barClasses).not.toContain('pr-14')
        expect(gridColumnsOf(bar)).toEqual(['minmax(6rem,1fr)', 'minmax(0,auto)'])
        const switcherWrapper = classesOf(switcherWrapperOf(root))
        expect(switcherWrapper).toContain('col-span-2')
        expect(switcherWrapper).toContain('-ml-10')
        const chipWrapper = classesOf(chipWrapperOf(root))
        expect(chipWrapper).toContain('col-start-2')
        expect(chipWrapper).not.toContain('-mr-10')
    }

    function expectWideClasses(root: HTMLElement): void {
        const bar = topBarOf(root)!
        const barClasses = classesOf(bar)
        expect(barClasses).toContain('pr-14')
        expect(barClasses).not.toContain('pr-4')
        expect(gridColumnsOf(bar)).toEqual(['minmax(2.75rem,1fr)', 'auto', 'minmax(2.75rem,1fr)'])
        expect(classesOf(switcherWrapperOf(root))).not.toContain('-ml-10')
        expect(classesOf(chipWrapperOf(root))).toContain('-mr-10')
    }

    // Reproducer for the class contract only: the floor keeps each cluster child from shrinking under 44 px, and the
    // pixel result is a real-browser check. Red on the base because the floor class does not exist.
    test.each([768, 900, 1280])('T-S6-60: at %i the chip cluster wrapper floors its children at 44 px', (width) => {
        const root = mountShellAt(width)
        expect(classesOf(chipWrapperOf(root))).toContain('*:min-w-11')
    })

    // Compatibility guard (passes before and after): the phone chip stays without the floor.
    test('T-S6-60c: at 360 the phone chip wrapper has no floor', () => {
        const root = mountShellAt(360)
        expect(classesOf(chipWrapperOf(root))).not.toContain('*:min-w-11')
    })

    // Reproducer: a wide bar narrower than 1248 px takes the mid classes, and the wide classes return once it is
    // wide enough. The window widths are larger than the bar widths (a docked sidebar) so a test that compared the
    // window width would not switch.
    test.each([
        [1280, 811],
        [1440, 971],
        [1920, 1247],
    ])('T-S6-43: a wide band with a %i window and an %i bar takes the mid layout', (viewport, bar) => {
        stubObserver()
        headerWidth = bar
        const root = mountShellAt(viewport)
        expect(layoutOf(root)).toBe('mid')
        expectMidClasses(root)
        const tasksButton = topBarOf(root)!.querySelector('[data-part="home-tasks-button"]')!
        expect(tasksButton).not.toBeNull()
        expect(chipOf(root)!.compareDocumentPosition(topBarOf(root)!.querySelector('fieldset')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        const watching = parentObservers(root)
        expect(watching.length).toBeGreaterThanOrEqual(1)
        expect(watching.every((o) => !o.targets.includes(topBarOf(root)!))).toBe(true)

        deliver(root, 1275)
        expect(layoutOf(root)).toBe('wide')
        expectWideClasses(root)
        expect(topBarOf(root)!.querySelector('[data-part="home-tasks-button"]')).toBe(tasksButton)
        expect(topBarOf(root)!.querySelector('fieldset')!.compareDocumentPosition(chipOf(root)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        deliver(root, 811)
        expect(layoutOf(root)).toBe('mid')
        expectMidClasses(root)
        expect(topBarOf(root)!.querySelector('[data-part="home-tasks-button"]')).toBe(tasksButton)
        expect(chipOf(root)!.compareDocumentPosition(topBarOf(root)!.querySelector('fieldset')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    // Reproducer: entering the wide band reads the bar width synchronously, so the switch is in the same flush as the
    // band change and no observer delivery is needed.
    test('T-S6-43b: entering the wide band reads the bar width before any delivery', () => {
        stubObserver()
        headerWidth = 900
        const root = mountShellAt(900)
        expect(layoutOf(root)).toBe('mid')
        headerWidth = 811
        resizeTo(1280)
        expect(landingOf(root)!.getAttribute('data-layout')).toBe('wide')
        expect(layoutOf(root)).toBe('mid')
        expectMidClasses(root)
    })

    // Compatibility guard (passes before and after, except the width cases that guard the new rule): wide stays wide
    // at an unmeasured bar, at the minimum and above it, and the mount needs no ResizeObserver global.
    test('T-S6-44: an unmeasured bar, 1248 and wider stay wide, and a mount without ResizeObserver works', () => {
        expect(typeof ResizeObserver).toBe('undefined')
        const unmeasured = mountShellAt(1280)
        expect(layoutOf(unmeasured)).toBe('wide')
        expectWideClasses(unmeasured)

        stubObserver()
        for (const [viewport, bar] of [[1280, 1248], [1280, 1275], [1440, 1435]]) {
            headerWidth = bar
            const root = mountShellAt(viewport)
            expect(layoutOf(root), `${viewport}/${bar}`).toBe('wide')
            expectWideClasses(root)
        }
    })

    // Reproducer: without a ResizeObserver global, a measured narrow bar still takes the mid layout, because the
    // synchronous read happens before the observer guard.
    test('T-S6-44b: without ResizeObserver a measured narrow bar takes the mid layout', () => {
        expect(typeof ResizeObserver).toBe('undefined')
        headerWidth = 811
        const root = mountShellAt(1280)
        expect(layoutOf(root)).toBe('mid')
    })

    // Compatibility guard (passes before and after): the landing, the drawer and the lattice read the band, which a
    // narrow wide bar does not change.
    test('T-S6-45: the landing stays wide while the bar takes the mid layout', () => {
        stubObserver()
        headerWidth = 811
        const root = mountShellAt(1280)
        expect(layoutOf(root)).toBe('mid')
        expect(landingOf(root)!.getAttribute('data-layout')).toBe('wide')
        expect(menuButtonOf(root)).toBeNull()
    })

    // Compatibility guard (passes before and after): the rule applies to the wide band only. A mid band is mid at any
    // bar width, and a wide band resized to a phone width is phone.
    test('T-S6-62: a mid band is mid at a narrow bar, and a narrow wide bar resized to 360 is phone', () => {
        stubObserver()
        headerWidth = 763
        const mid = mountShellAt(768)
        expect(layoutOf(mid)).toBe('mid')
        expect(landingOf(mid)!.getAttribute('data-layout')).toBe('mid')

        headerWidth = 811
        const root = mountShellAt(1280)
        expect(layoutOf(root)).toBe('mid')
        headerWidth = 360
        resizeTo(360)
        expect(landingOf(root)!.getAttribute('data-layout')).toBe('phone')
        expect(layoutOf(root)).toBe('phone')
        expect(menuButtonOf(root)).not.toBeNull()
    })

    // Reproducer: the bar's parent is observed only while the band is wide, and the observer goes when the band leaves
    // wide. Only observers that target the parent count; other code creates observers of its own.
    test('T-S6-62b: the bar parent is observed in the wide band only and released on leaving it', () => {
        stubObserver()
        headerWidth = 360
        const phone = mountShellAt(360)
        expect(parentObservers(phone)).toHaveLength(0)
        headerWidth = 768
        const mid = mountShellAt(768)
        expect(parentObservers(mid)).toHaveLength(0)

        headerWidth = 1280
        const root = mountShellAt(1280)
        expect(parentObservers(root)).toHaveLength(1)
        expect(parentObservers(root)[0].targets).toEqual([topBarOf(root)!.parentElement])
        const created = observers.filter((o) => o.targets.includes(topBarOf(root)!.parentElement!))
        expect(created).toHaveLength(1)

        resizeTo(900)
        expect(parentObservers(root)).toHaveLength(0)
        expect(created[0].active).toBe(false)
    })
})

describe('HomeShell phone chrome', () => {
    test('T-B12: the flag is true on the phone landing and false at mid, with Realm open and after unmount; a library request leaves it true', async () => {
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
        flushSync()
        expect(landingOf(root)).not.toBeNull()
        expect(homeChrome.phoneDrawer).toBe(true)

        await unmount(mountedInstances.pop() as never)
        expect(homeChrome.phoneDrawer).toBe(false)
    })

    test('T-B12c: the top bar stays on the landing when the library is requested', async () => {
        const root = mountShellAt(360)
        expect(topBarOf(root)).not.toBeNull()

        openHomeLibrary()
        flushSync()
        expect(landingOf(root)).not.toBeNull()
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

describe('HomeShell page-level holds', () => {
    /** Mounts without a flush, so a read right after is not separated from the mount by an effect run. */
    function mountRaw(width: number): { target: HTMLElement; instance: unknown } {
        setViewportWidth(width)
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        const instance = mount(HomeShell, { target })
        mountedInstances.push(instance)
        return { target, instance }
    }

    /** Unmounts one tracked instance and drops it from the list, so `afterEach` does not unmount it twice. */
    async function unmountTracked(instance: unknown): Promise<void> {
        const index = mountedInstances.indexOf(instance)
        if (index >= 0) mountedInstances.splice(index, 1)
        await unmount(instance as never)
    }

    async function chromeOf(): Promise<NonNullable<Awaited<ReturnType<typeof loadHomeChrome>>>['homeChrome']> {
        const chrome = await loadHomeChrome()
        expect(chrome).not.toBeNull()
        return chrome!.homeChrome
    }

    test('S5-R3: the landing flag is set at mount in every band, survives the Realm view and clears on unmount', async () => {
        const homeChrome = await chromeOf()
        for (const width of [360, 900, 1400]) {
            const { instance } = mountRaw(width)
            try {
                expect(homeChrome.landing, `width ${width}`).toBe(true)
            } finally {
                await unmountTracked(instance)
            }
            expect(homeChrome.landing, `width ${width} after unmount`).toBe(false)
        }

        const { instance } = mountRaw(1400)
        try {
            flushSync()
            OpenRealmStore.set(true)
            flushSync()
            expect(homeChrome.landing).toBe(true)
            OpenRealmStore.set(false)
            flushSync()
            expect(homeChrome.landing).toBe(true)
        } finally {
            await unmountTracked(instance)
        }
        expect(homeChrome.landing).toBe(false)
    })

    test('S5-R4: a shell mounted beside another keeps the landing flag when the first one is unmounted', async () => {
        const homeChrome = await chromeOf()
        const a = mountRaw(1400)
        const b = mountRaw(1400)
        try {
            flushSync()
            expect(homeChrome.landing).toBe(true)
            await unmountTracked(a.instance)
            expect(homeChrome.landing).toBe(true)
        } finally {
            await unmountTracked(b.instance)
        }
        expect(homeChrome.landing).toBe(false)
    })

    test('S5-R6: a shell mounted beside another keeps the phone drawer flag when the first one is unmounted', async () => {
        const homeChrome = await chromeOf()
        const a = mountRaw(360)
        const b = mountRaw(360)
        try {
            flushSync()
            expect(homeChrome.phoneDrawer).toBe(true)
            await unmountTracked(a.instance)
            expect(homeChrome.phoneDrawer).toBe(true)
        } finally {
            await unmountTracked(b.instance)
        }
        expect(homeChrome.phoneDrawer).toBe(false)
    })

    /**
     * Mounts the harness (the `{#key}` block shape of App.svelte), bumps the key and returns the
     * landing nodes before and after, so the new shell is built before the old one is destroyed.
     */
    async function remountThroughKey(width: number): Promise<{ before: HTMLElement | null; after: HTMLElement | null; target: HTMLElement; instance: unknown }> {
        setViewportWidth(width)
        const props = $state({ epoch: 0 })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        const instance = mount(HomeShellKeyHarness, { target, props })
        mountedInstances.push(instance)
        flushSync()
        const before = landingOf(target)
        props.epoch = 1
        flushSync()
        if (before?.isConnected) {
            await tick()
            flushSync()
        }
        return { before, after: landingOf(target), target, instance }
    }

    test('S5-R5a: the phone drawer flag stays true across a keyed remount of the shell', async () => {
        const homeChrome = await chromeOf()
        setViewportWidth(360)
        const { before, after, target, instance } = await remountThroughKey(360)
        try {
            expect(before).not.toBeNull()
            expect(after).not.toBeNull()
            expect(after).not.toBe(before)
            expect(after!.isConnected).toBe(true)
            expect(target.querySelectorAll('[data-part="home-landing"]').length).toBe(1)
            expect(homeChrome.phoneDrawer).toBe(true)
        } finally {
            await unmountTracked(instance)
        }
        expect(homeChrome.phoneDrawer).toBe(false)
    })

    test('S5-R5b: the landing flag stays true across a keyed remount of the shell', async () => {
        const homeChrome = await chromeOf()
        const { before, after, target, instance } = await remountThroughKey(1400)
        try {
            expect(after).not.toBe(before)
            expect(target.querySelectorAll('[data-part="home-landing"]').length).toBe(1)
            expect(homeChrome.landing).toBe(true)
        } finally {
            await unmountTracked(instance)
        }
        expect(homeChrome.landing).toBe(false)
    })
})

/**
 * The phone top bar: one row of menu button, brand, Tasks and the icon persona chip, with the switcher
 * row only when there is a mode to switch. Class guards read the band conditional, not a media query;
 * jsdom does no layout, so the pixel result is a real-browser check.
 */
describe('HomeShell phone top bar', () => {
    const classesOf = (element: Element | null): string[] => Array.from(element?.classList ?? [])
    const tasksOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-tasks-button"]')
    const brandOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-brand"]')
    const labelOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-persona-chip-label"]')
    const hintOf = (root: HTMLElement): Element | undefined =>
        Array.from(chipOf(root)!.querySelectorAll('span')).find((s) => s.textContent === language.homePersonaChipHint)
    const follows = (a: Element, b: Element): boolean => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

    function setModes(visibleModes: string[], hideUnusedModes: boolean): void {
        const db = DBState.db as unknown as Record<string, unknown>
        db.visibleModes = visibleModes
        db.hideUnusedModes = hideUnusedModes
        onTestFinished(() => {
            Reflect.deleteProperty(db, 'visibleModes')
            Reflect.deleteProperty(db, 'hideUnusedModes')
        })
    }

    // Reproducer: on the base the chip sits in its own wrapper below the brand row and shows its text.
    test.each([360, 700])('T-S6-40: at %i the menu row holds menu, brand, Tasks and the icon chip in that order', (width) => {
        const root = mountShellAt(width)
        const bar = topBarOf(root)!
        const chip = chipOf(root)!
        const menu = menuButtonOf(root)!
        const row = menu.parentElement!
        expect(row.parentElement).toBe(bar)
        expect(Array.from(row.children)).toEqual([menu, brandOf(root), tasksOf(root)!.parentElement, chip])
        expect(chip.parentElement).toBe(row)

        const switcher = bar.querySelector('fieldset')!
        expect(follows(tasksOf(root)!, chip)).toBe(true)
        expect(follows(chip, switcher)).toBe(true)

        const chipClasses = classesOf(chip)
        expect(chipClasses).toContain('size-11')
        expect(chipClasses).toContain('justify-center')
        expect(classesOf(labelOf(root))).toContain('sr-only')
        expect(classesOf(hintOf(root)!)).toContain('sr-only')
        // The label and the hint stay in the text, so the accessible name is unchanged.
        expect(chip.textContent).toContain(language.homePersonaChipUnnamed)
        expect(chip.textContent).toContain(language.homePersonaChipHint)
        expect(chip.textContent).toContain(language.homePersonaChipGo)
    })

    // Compatibility guard (passes before and after): mid and wide keep the visible chip in its wrapper.
    test.each([768, 900, 1280])('T-S6-40b: at %i the chip stays visible in the chip wrapper', (width) => {
        const root = mountShellAt(width)
        const chip = chipOf(root)!
        expect(classesOf(chip)).not.toContain('size-11')
        expect(classesOf(labelOf(root))).not.toContain('sr-only')
        expect(classesOf(hintOf(root)!)).not.toContain('sr-only')
        expect(chip.parentElement!.parentElement).toBe(topBarOf(root))
        expect(chip.parentElement!.querySelector('[data-part="home-tasks-button"]')).not.toBeNull()
    })

    test('T-S6-40c: the compact chip follows the band live on a resize', () => {
        const root = mountShellAt(900)
        expect(classesOf(chipOf(root))).not.toContain('size-11')
        resizeTo(360)
        expect(classesOf(chipOf(root))).toContain('size-11')
        expect(chipOf(root)!.parentElement).toBe(menuButtonOf(root)!.parentElement)
        resizeTo(768)
        expect(classesOf(chipOf(root))).not.toContain('size-11')
    })

    test.each([360, 700])('T-S6-41: at %i the header has one child with one mode and two with several', (width) => {
        setModes(['rp'], true)
        const root = mountShellAt(width)
        const bar = topBarOf(root)!
        expect(bar.children.length).toBe(1)
        expect(bar.querySelector('fieldset')).toBeNull()

        setModes(['rp', 'utility'], true)
        const several = mountShellAt(width)
        expect(topBarOf(several)!.children.length).toBe(2)
        expect(topBarOf(several)!.querySelector('fieldset')).not.toBeNull()
    })

    // Reproducer: an empty mid switcher wrapper would still add a row gap, so mid omits it while wide keeps its centring track.
    test('T-S6-41b: with one mode shown mid omits the switcher wrapper and wide keeps its centring track', () => {
        setModes(['rp'], true)
        const mid = mountShellAt(900)
        expect(topBarOf(mid)!.children.length).toBe(2)
        expect(topBarOf(mid)!.querySelector('fieldset')).toBeNull()
        resizeTo(1280)
        expect(topBarOf(mid)!.children.length).toBe(3)
        const wideWrapper = topBarOf(mid)!.children[1]
        expect(wideWrapper.querySelector('fieldset')).toBeNull()
        expect(classesOf(wideWrapper)).toContain('justify-center')
    })

    test('T-S6-41d: with modes listed the mid switcher wrapper keeps its second row', () => {
        const root = mountShellAt(900)
        const wrapper = topBarOf(root)!.querySelector('fieldset')!.parentElement
        expect(classesOf(wrapper)).toContain('row-start-2')
    })

    // Class guard: the phone brand cell pads its end by 4 px so the wordmark's last letter is not clipped at 360 px.
    test('T-S6-41e: the phone brand cell carries 4 px of end padding; mid and wide do not', () => {
        expect(classesOf(brandOf(mountShellAt(360)))).toContain('pe-1')
        expect(classesOf(brandOf(mountShellAt(900)))).not.toContain('pe-1')
    })

    test('T-S6-41c: the switcher row follows a live change of the shown modes', () => {
        setModes(['rp'], true)
        const root = mountShellAt(360)
        expect(topBarOf(root)!.children.length).toBe(1)
        DBState.db.visibleModes = ['rp', 'hybrid']
        flushSync()
        expect(topBarOf(root)!.children.length).toBe(2)
        DBState.db.hideUnusedModes = false
        DBState.db.visibleModes = ['rp']
        flushSync()
        expect(topBarOf(root)!.children.length).toBe(2)
    })

    // The 360 case of T-H3: the compact chip has no width cap of its own (the icon is 44 px) and a stored name stays one
    // truncated label that is read out in full.
    test.each([360, 700])('T-S6-40d: at %i the compact chip keeps a long name in a truncating label', (width) => {
        const before = DBState.db.username
        DBState.db.username = 'Averyveryverylongunbrokenpersonaname'
        try {
            const root = mountShellAt(width)
            const label = labelOf(root)!
            expect(label.textContent).toContain('Averyveryverylongunbrokenpersonaname')
            expect(classesOf(label)).toContain('truncate')
            expect(classesOf(label)).toContain('sr-only')
            expect(classesOf(chipOf(root))).not.toContain('max-w-[calc(100%-2rem)]')
        } finally {
            DBState.db.username = before
        }
    })

    // Reproducer for the class contract: the wordmark leaves the layout below 350 px of viewport (a viewport variant;
    // a container query would not apply, because the phone brand cell is no container).
    test('T-S6-42: the phone wordmark hides visually under 350 px with a viewport variant', () => {
        const root = mountShellAt(360)
        const word = brandOf(root)!.querySelector('[data-seasonal-host]')!
        expect(classesOf(word)).toContain('max-[349.98px]:sr-only')
        expect(classesOf(word).some((c) => c.startsWith('@'))).toBe(false)
        expect(classesOf(brandOf(root))).not.toContain('@container')
        expect(word.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
        expect(word.hasAttribute('aria-hidden')).toBe(false)
    })

    // Compatibility guard (passes before and after): hidden modes stay out of the bar switcher, also after a live change.
    test('T-S6-46: a hidden mode has no radio in the bar switcher and follows a live change', () => {
        setModes(['rp', 'utility'], true)
        const root = mountShellAt(360)
        const modes = (): string[] => Array.from(root.querySelectorAll<HTMLInputElement>('input[name="home-mode"]')).map((i) => i.value)
        expect(modes()).toEqual(['rp', 'utility'])
        DBState.db.visibleModes = ['rp', 'hybrid']
        flushSync()
        expect(modes()).toEqual(['rp', 'hybrid'])
        DBState.db.visibleModes = ['rp', 'utility']
        flushSync()
        expect(modes()).toEqual(['rp', 'utility'])
        expect(modes()).not.toContain('hybrid')
    })
})

describe('HomeShell brand mark tone', () => {
    const markOf = (root: HTMLElement): Element | null => root.querySelector('[data-part="home-brand"] svg')

    afterEach(() => {
        ColorSchemeTypeStore.set('dark')
    })

    test.each([360, 900, 1280])('T-S6-50: at %i a light scheme tones the Home mark and a dark one sets nothing', (width) => {
        ColorSchemeTypeStore.set('light')
        const light = mountShellAt(width)
        expect(markOf(light)!.getAttribute('data-tone')).toBe('light')
        expect(light.querySelectorAll('[data-tone]').length).toBe(1)

        ColorSchemeTypeStore.set('dark')
        const dark = mountShellAt(width)
        expect(markOf(dark)!.hasAttribute('data-tone')).toBe(false)
        expect(dark.querySelector('[data-tone]')).toBeNull()
    })

    test('T-S6-50b: the tone follows a live scheme switch on the mounted mark', () => {
        const root = mountShellAt(360)
        const mark = markOf(root)!
        expect(mark.hasAttribute('data-tone')).toBe(false)
        ColorSchemeTypeStore.set('light')
        flushSync()
        expect(markOf(root)).toBe(mark)
        expect(mark.getAttribute('data-tone')).toBe('light')
        ColorSchemeTypeStore.set('dark')
        flushSync()
        expect(mark.hasAttribute('data-tone')).toBe(false)
    })

    // Compatibility guard (passes before and after): the boot screen's mark is a separate component and takes no tone
    // from the scheme store.
    test('T-S6-50c: the boot screen mark carries no tone under a light scheme', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
        onTestFinished(() => {
            vi.restoreAllMocks()
        })
        ColorSchemeTypeStore.set('light')
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        mountedInstances.push(mount(NexusBootScreen, { target, props: { progress: { step: 'files', state: 'running' } } }))
        flushSync()
        expect(target.querySelector('.nexus-mark')).not.toBeNull()
        expect(target.querySelector('[data-tone]')).toBeNull()
    })
})

describe('HomeShell greeting header', () => {
    const greetingOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-greeting"]')
    const h1Of = (root: HTMLElement): string | undefined => greetingOf(root)?.querySelector('h1')?.textContent?.trim()
    const setClock = (hour: number, minute = 0, second = 0): void => {
        vi.setSystemTime(new Date(2026, 5, 10, hour, minute, second))
    }

    beforeEach(() => {
        vi.useFakeTimers()
        setClock(10)
        ;(DBState.db as unknown as Record<string, unknown>).username = 'Synthetic Name'
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    test('S1-R1: the landing root and the header carry the eyebrow and the morning greeting at every band', () => {
        for (const [width, band] of [[360, 'phone'], [900, 'mid'], [1280, 'wide']] as const) {
            const root = mountShellAt(width)
            const landing = landingOf(root)!
            expect(landing.classList.contains('home-root')).toBe(true)
            expect(landing.getAttribute('data-layout')).toBe(band)
            const header = greetingOf(root)
            expect(header).not.toBeNull()
            expect(header!.children.length).toBe(2)
            const eyebrow = header!.querySelector('[data-part="home-eyebrow"]')
            expect(eyebrow!.tagName).toBe('P')
            expect(eyebrow!.textContent).toBe(language.settingsShellModesNameRp)
            expect(header!.children[1].tagName).toBe('H1')
            expect(h1Of(root)).toBe(language.homeGreetingMorning)
            expect(language.homeGreetingMorning).toBeTruthy()
            expect(header!.textContent).not.toContain('Synthetic Name')
        }
    })

    test('S1-R1: the period table at 360 follows the local clock', () => {
        const table: Array<[number, number, string]> = [
            [4, 59, language.homeGreetingNight],
            [0, 0, language.homeGreetingNight],
            [5, 0, language.homeGreetingMorning],
            [11, 59, language.homeGreetingMorning],
            [12, 0, language.homeGreetingAfternoon],
            [17, 59, language.homeGreetingAfternoon],
            [18, 0, language.homeGreetingEvening],
            [21, 59, language.homeGreetingEvening],
            [22, 0, language.homeGreetingNight],
        ]
        for (const [hour, minute, expected] of table) {
            setClock(hour, minute)
            const root = mountShellAt(360)
            expect(expected, `${hour}:${minute} string`).toBeTruthy()
            expect(h1Of(root), `${hour}:${minute}`).toBe(expected)
        }
    })

    test('S1-R2: the greeting is absent while the Realm view is open and returns when it closes', () => {
        const root = mountShellAt(900)
        expect(greetingOf(root)).not.toBeNull()
        OpenRealmStore.set(true)
        flushSync()
        expect(greetingOf(root)).toBeNull()
        OpenRealmStore.set(false)
        flushSync()
        expect(greetingOf(root)).not.toBeNull()
    })

    test('S1-R3: a mounted greeting switches at each boundary and on becoming visible', () => {
        for (const text of [language.homeGreetingMorning, language.homeGreetingAfternoon, language.homeGreetingEvening, language.homeGreetingNight]) {
            expect(text).toBeTruthy()
        }
        setClock(21, 59, 30)
        const root = mountShellAt(900)
        expect(h1Of(root)).toBe(language.homeGreetingEvening)
        vi.advanceTimersByTime(30000)
        flushSync()
        expect(h1Of(root)).toBe(language.homeGreetingNight)

        setClock(4, 59, 30)
        const second = mountShellAt(900)
        expect(h1Of(second)).toBe(language.homeGreetingNight)
        vi.advanceTimersByTime(30000)
        flushSync()
        expect(h1Of(second)).toBe(language.homeGreetingMorning)

        setClock(12, 10)
        const third = mountShellAt(900)
        expect(h1Of(third)).toBe(language.homeGreetingAfternoon)
        setClock(18, 5)
        const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        try {
            document.dispatchEvent(new Event('visibilitychange'))
            flushSync()
            expect(h1Of(third)).toBe(language.homeGreetingEvening)
        } finally {
            if (visibility) {
                Object.defineProperty(document, 'visibilityState', visibility)
            } else {
                delete (document as unknown as Record<string, unknown>).visibilityState
            }
        }
    })

    test('S1-R4: the landing carries no RisuTanium title outside the top bar', () => {
        const root = mountShellAt(900)
        const bar = topBarOf(root)!
        const titles = Array.from(root.querySelectorAll('h2')).filter((h) => !bar.contains(h) && h.textContent?.trim() === 'RisuTanium')
        expect(titles.length).toBe(0)
        expect(bar.querySelector('[data-part="home-brand"]')!.textContent).toContain('RisuTanium')
    })

    test('S1-R5: the version line appears once, as the last element of the Community list, after the Email row', () => {
        const root = mountShellAt(1280)
        const holders = Array.from(root.querySelectorAll('*')).filter(
            (el) => el.children.length === 0 && el.textContent?.includes('test-version'),
        )
        expect(holders.length).toBe(1)
        const version = holders[0]
        const community = root.querySelector('[data-part="home-community"]')!
        expect(version.parentElement).toBe(community)
        expect(community.lastElementChild).toBe(version)
        const emailTitle = Array.from(community.querySelectorAll('[data-part="home-community-title"]')).find(
            (el) => el.textContent?.trim() === language.homeLinkEmailTitle,
        )
        expect(emailTitle).toBeTruthy()
        expect(emailTitle!.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    test('S2b2-G4: the greeting sits in the head above the columns, outside them, at full body width', () => {
        const root = mountShellAt(1280)
        const greeting = greetingOf(root)!
        const head = root.querySelector('[data-part="home-head"]')!
        const columns = root.querySelector('[data-part="home-columns"]')!
        expect(head).not.toBeNull()
        expect(head.contains(greeting)).toBe(true)
        expect(columns.contains(head)).toBe(false)
        expect(head.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(greeting.classList.contains('max-w-4xl')).toBe(false)
        expect(greeting.classList.contains('px-6')).toBe(false)
    })
})
