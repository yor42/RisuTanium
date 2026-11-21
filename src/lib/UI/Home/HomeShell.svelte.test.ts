// @vitest-environment jsdom

/**
 * `HomeShell.svelte`: Home's landing (the real `MainMenu` with the Characters button in its header). There is
 * no separate library view: every entry reveals the library embedded in the landing, which stays rendered.
 * Every creation starts at the top, disengaged; the creation that ends a Home-opened Studio visit reveals once.
 * The button needs library content, so the default fixture holds three live characters.
 *
 * MOCKED: the module set of `MainMenu.hubStates.svelte.test.ts` (`src/lib/UI`). `HomeLibrary` is a
 * marker stand-in (its own behaviour is tested in `HomeLibrary.svelte.test.ts`), and `alertError` is
 * the only export of a stand-in alert module. jsdom has no `scrollTo`, so a spy stands in.
 */

import { flushSync, mount, onDestroy, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'

//#region module mocks

const alertErrorSpy = vi.hoisted(() => vi.fn())

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
        db: {
            hideRealm: false,
            realmDirectOpen: false,
            hideAllImages: false,
            characters: [{ type: 'character', chaId: 'a', name: 'a', image: '', chats: [], chatPage: 0 }],
        } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: alertErrorSpy }))
vi.mock('src/ts/characters', () => ({
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => 0,
    supersedeChangeChar: vi.fn(),
}))
vi.mock('src/ts/characterPick', () => ({ changeCharOrAlert: vi.fn() }))

const libraryStub = vi.hoisted(() => (anchor: Comment) => {
    const marker = document.createElement('div')
    marker.setAttribute('data-testid', 'library-stub')
    anchor.parentNode!.insertBefore(marker, anchor)
    // The stand-in sits at the block's own anchor, so the block would not remove it; remove it with the component.
    onDestroy(() => marker.remove())
})
vi.mock('./HomeLibrary.svelte', () => ({ default: libraryStub }))

//#endregion

import HomeShell from './HomeShell.svelte'
import { homeView, openHomeLibrary, requestHomeLibrary, showHomeLanding, startHomeView } from './homeView.svelte'
import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'

type Slot = Record<string, unknown>

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []
const scrollSpy = vi.fn()
const originalInnerWidth = window.innerWidth

function liveSlot(name: string): Slot {
    return { type: 'character', chaId: name, name, image: '', chats: [], chatPage: 0 }
}

function setCharacters(characters: Slot[]): void {
    DBState.db = {
        hideRealm: false,
        realmDirectOpen: false,
        hideAllImages: false,
        characters,
    } as unknown as typeof DBState.db
}

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function mountShell(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

const landingOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-landing"]')
const sectionOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-library"]')
const stubsOf = (root: HTMLElement) => root.querySelectorAll('[data-testid="library-stub"]')
// The landing scroller is the MainMenu root: the parent of the page body. The reveal scrolls it, never the document.
const scrollerOf = (root: HTMLElement): HTMLElement => landingOf(root)!.querySelector('[data-part="home-body"]')!.parentElement!
// The scroll offset is the target's top edge, so a marked top tells which element the reveal aimed at.
function markTop(element: HTMLElement, top: number): void {
    element.getBoundingClientRect = () => ({ top } as DOMRect)
}

function libraryButton(root: HTMLElement): HTMLButtonElement {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.character)
    if (!button) {
        throw new Error('Library button not found')
    }
    return button
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    alertErrorSpy.mockClear()
    scrollSpy.mockClear()
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollSpy })
    setWidth(1280)
    setCharacters([liveSlot('a'), liveSlot('b'), liveSlot('c')])
    startHomeView()
})

afterEach(async () => {
    OpenRealmStore.set(false)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    document.documentElement.classList.remove('rm')
    resetBackHandlersForTests()
    startHomeView()
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo
    setWidth(originalInnerWidth)
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('HomeShell', () => {
    test('S4b-R1 the Characters button reveals the library inside the landing: scroll to the section, focus its heading, engage', async () => {
        const root = mountShell()
        expect(landingOf(root)).not.toBeNull()
        expect(homeView.libraryEngaged).toBe(false)
        markTop(sectionOf(root)!, 321)

        libraryButton(root).click()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(landingOf(root)).not.toBeNull()
        const section = sectionOf(root)!
        expect(scrollSpy.mock.contexts[0]).toBe(scrollerOf(root))
        expect(scrollSpy).toHaveBeenCalledWith({ top: 321, behavior: 'smooth' })
        expect(document.activeElement).toBe(section.querySelector('h2'))
        expect(section.querySelector('h2')!.textContent).toBe(language.homeLibraryHeading)
        expect(homeView.libraryEngaged).toBe(true)
        expect(stubsOf(root)).toHaveLength(1)
    })

    test('S4b-F2 the reveal re-aims on a resize of the scroller, and destroying the shell disconnects the re-aim', async () => {
        const observers: Array<{ observed: Element[]; disconnect: ReturnType<typeof vi.fn>; callback: () => void }> = []
        vi.stubGlobal('ResizeObserver', class {
            observed: Element[] = []
            disconnect = vi.fn()
            constructor(readonly callback: () => void) {
                observers.push(this)
            }
            observe(node: Element): void {
                this.observed.push(node)
            }
        })
        try {
            const root = mountShell()
            const section = sectionOf(root)!
            markTop(section, 321)
            libraryButton(root).click()
            flushSync()
            await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
            const reaim = observers.find((observer) => observer.observed.includes(scrollerOf(root)))!
            expect(reaim.observed).toContain(section)

            markTop(section, 400)
            reaim.callback()
            expect(scrollSpy).toHaveBeenCalledTimes(2)
            expect(scrollSpy).toHaveBeenLastCalledWith({ top: 400, behavior: 'smooth' })

            expect(reaim.disconnect).not.toHaveBeenCalled()
            await unmount(mountedInstances.pop() as never)
            expect(reaim.disconnect).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
        }
    })
    test('S4b-R1 with reduced motion on the root the scroll is instant', async () => {
        document.documentElement.classList.add('rm')
        const root = mountShell()
        markTop(sectionOf(root)!, 321)
        libraryButton(root).click()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(scrollSpy).toHaveBeenCalledWith({ top: 321, behavior: 'instant' })
    })

    test('S4b-R1 every character trashed: the library wins over the visible hero, scrolled and focused', async () => {
        setCharacters([{ ...liveSlot('a'), trashTime: 3 }, { ...liveSlot('b'), trashTime: 3 }])
        const root = mountShell()
        expect(root.querySelectorAll('[data-part="home-empty-hero"]')).toHaveLength(1)
        markTop(sectionOf(root)!, 321)
        markTop(root.querySelector<HTMLElement>('section[data-part="home-empty-hero"]')!, 654)

        libraryButton(root).click()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        const section = sectionOf(root)!
        expect(scrollSpy.mock.contexts[0]).toBe(scrollerOf(root))
        expect(scrollSpy).toHaveBeenCalledWith({ top: 321, behavior: 'smooth' })
        expect(document.activeElement).toBe(section.querySelector('[data-jump-target="library"]'))
        expect(document.activeElement).not.toBe(root.querySelector('[data-jump-target="home-hero"]'))
    })

    test('S4b-R1 the library is mounted before the scroll, so the section is already its full height when scrolled', async () => {
        const root = mountShell()
        expect(stubsOf(root)).toHaveLength(0)
        let stubsAtScroll = -1
        scrollSpy.mockImplementationOnce(() => {
            stubsAtScroll = stubsOf(root).length
        })
        openHomeLibrary()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(stubsAtScroll).toBe(1)
    })

    test('the mode switcher sits in the landing header and is hidden while the Realm view is open', () => {
        const root = mountShell()
        const group = root.querySelector('fieldset')
        expect(group).not.toBeNull()
        expect(group!.querySelector('legend')!.textContent).toBe(language.homeModeSwitcherLabel)
        expect(group!.querySelectorAll('input[type="radio"]').length).toBe(3)

        OpenRealmStore.set(true)
        flushSync()
        expect(root.querySelector('fieldset')).toBeNull()

        OpenRealmStore.set(false)
        flushSync()
        expect(root.querySelector('fieldset')).not.toBeNull()
    })

    test('showHomeLanding changes nothing on screen: the landing is the only branch', () => {
        const root = mountShell()
        libraryButton(root).click()
        flushSync()
        showHomeLanding()
        flushSync()
        expect(landingOf(root)).not.toBeNull()
        expect(sectionOf(root)).not.toBeNull()
    })

    test('every creation starts at the top and disengaged, even when the library was used', async () => {
        const first = mountShell()
        libraryButton(first).click()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(homeView.libraryEngaged).toBe(true)

        await unmount(mountedInstances.pop() as never)
        mountedTargets.pop()!.remove()
        scrollSpy.mockClear()

        const second = mountShell()
        expect(homeView.libraryEngaged).toBe(false)
        expect(landingOf(second)).not.toBeNull()
        await tick()
        expect(scrollSpy).not.toHaveBeenCalled()
    })

    test('F T13b: a requested library is revealed by the creation in the same tick and consumed by it', async () => {
        requestHomeLibrary()
        const first = mountShell()
        expect(homeView.libraryEngaged).toBe(true)
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(scrollSpy.mock.contexts[0]).toBe(scrollerOf(first))

        await unmount(mountedInstances.pop() as never)
        mountedTargets.pop()!.remove()
        scrollSpy.mockClear()
        const second = mountShell()
        expect(homeView.libraryEngaged).toBe(false)
        expect(landingOf(second)).not.toBeNull()
        await tick()
        expect(scrollSpy).not.toHaveBeenCalled()
    })

    test('G T13b: a request not used by a creation expires after the tick, so a later creation starts at the top', async () => {
        requestHomeLibrary()
        await tick()
        await tick()
        scrollSpy.mockClear()

        const root = mountShell()
        expect(homeView.libraryEngaged).toBe(false)
        expect(landingOf(root)).not.toBeNull()
        await tick()
        expect(scrollSpy).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(document.body)
    })
})
