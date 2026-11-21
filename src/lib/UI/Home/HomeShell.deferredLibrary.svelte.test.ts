// @vitest-environment jsdom

/**
 * The deferred mount of the library embedded in the real `HomeShell` landing: until a trigger fires the
 * section holds a same-height placeholder and `HomeLibrary` is not mounted. The triggers are idle time
 * (armed only after a double animation frame), a scroll that brings the placeholder within half a
 * screen, and an explicit library request; once mounted it stays mounted for the shell's life.
 *
 * REAL: `HomeShell`, `MainMenu`, `homeView`. MOCKED: the module set of `HomeShell.library.svelte.test.ts`
 * (`./HomeLibrary.svelte` is a stand-in that records its `embedded` prop). The animation-frame and
 * idle-callback schedulers and the scroller geometry are fakes the test drives by hand.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/ts/characters', () => ({
    createNewCharacter: vi.fn(),
    changeChar: vi.fn(),
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => 0,
    supersedeChangeChar: vi.fn(),
}))

vi.mock('src/ts/characterPick', () => ({
    changeCharOrAlert: vi.fn(async () => 'selected'),
}))

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
            characters: [],
            username: 'User',
            personas: [],
            selectedPersona: 0,
        } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        sideBarStore: writable(false),
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))

vi.mock('./HomeLibrary.svelte', () => ({
    default: (anchor: Comment) => {
        const root = document.createElement('div')
        root.setAttribute('data-testid', 'library-stub')
                anchor.parentNode!.insertBefore(root, anchor)
    },
}))

//#endregion

import HomeShell from './HomeShell.svelte'
import { openHomeLibrary, showHomeLanding, startHomeView } from './homeView.svelte'
import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'

type Slot = Record<string, unknown>

function warm(name: string): Slot {
    return {
        type: 'character', chaId: name, name, image: '', chatPage: 0, lastInteraction: 0,
        chats: [{ id: `c-${name}`, name: `Chat-${name}`, message: [], note: '', localLore: [] }],
    }
}

function setCharacters(characters: Slot[]): void {
    DBState.db = {
        hideRealm: false,
        realmDirectOpen: false,
        hideAllImages: false,
        characters,
        username: 'Juno',
        personas: [{ name: 'Juno' }],
        selectedPersona: 0,
    } as unknown as typeof DBState.db
}

//#region fake schedulers

let frames = new Map<number, () => void>()
let nextFrame = 1
let idleCallback: (() => void) | null = null
let requestIdle = vi.fn()
let cancelIdle = vi.fn()
let cancelFrame = vi.fn()
const scrollSpy = vi.fn()

function installSchedulers(): void {
    frames = new Map()
    nextFrame = 1
    idleCallback = null
    requestIdle = vi.fn((callback: () => void, _options?: { timeout: number }) => {
        idleCallback = callback
        return 7
    })
    cancelIdle = vi.fn()
    cancelFrame = vi.fn((id: number) => {
        frames.delete(id)
    })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
        const id = nextFrame++
        frames.set(id, callback)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    vi.stubGlobal('requestIdleCallback', requestIdle)
    vi.stubGlobal('cancelIdleCallback', cancelIdle)
}

/** Runs every frame callback queued right now; callbacks queued while running wait for the next frame. */
function runFrame(): void {
    const due = Array.from(frames.entries())
    frames.clear()
    for (const [, callback] of due) callback()
    flushSync()
}

function fireIdle(): void {
    idleCallback?.()
    flushSync()
}

//#endregion

const instances: unknown[] = []
const targets: HTMLElement[] = []

function mountShell(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

const stubs = (root: ParentNode) => root.querySelectorAll('[data-testid="library-stub"]')
const placeholderOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-library-placeholder"]')
const scrollerOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-landing"] > div.min-h-0 > div')!

/** Fixes the scroller's geometry: it spans 0..800 px, and the placeholder starts at `placeholderTop`. */
function setGeometry(root: ParentNode, placeholderTop: number): void {
    const scroller = scrollerOf(root)
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 })
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect
    placeholderOf(root)!.getBoundingClientRect = () => ({ top: placeholderTop, bottom: placeholderTop + 800 }) as DOMRect
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
    installSchedulers()
    scrollSpy.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy })
    setCharacters([warm('a'), warm('b'), warm('c')])
})

afterEach(async () => {
    OpenRealmStore.set(false)
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    showHomeLanding()
    startHomeView()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.unstubAllGlobals()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('the deferred library mount', () => {
    test('S4a-D1 (i): before idle the placeholder stands in; the idle callback mounts the library', () => {
        const root = mountShell()
        runFrame()
        runFrame()
        expect(placeholderOf(root)).not.toBeNull()
        expect(placeholderOf(root)!.getAttribute('aria-hidden')).toBe('true')
        expect(stubs(root)).toHaveLength(0)
        expect(requestIdle).toHaveBeenCalledTimes(1)
        expect(requestIdle.mock.calls[0][1]).toEqual({ timeout: 2000 })

        fireIdle()
        expect(stubs(root)).toHaveLength(1)
        expect(placeholderOf(root)).toBeNull()
    })

    test('S4a-D1 (ii): a placeholder already in view at first paint does not mount before idle', () => {
        const root = mountShell()
        setGeometry(root, 100)
        runFrame()
        runFrame()
        expect(stubs(root)).toHaveLength(0)
        fireIdle()
        expect(stubs(root)).toHaveLength(1)
    })

    test('S4a-D1 (iii): the idle callback is registered only after two animation frames', () => {
        mountShell()
        expect(requestIdle).not.toHaveBeenCalled()
        runFrame()
        expect(requestIdle).not.toHaveBeenCalled()
        runFrame()
        expect(requestIdle).toHaveBeenCalledTimes(1)
    })

    test('S4a-D1 (iv): a scroll with the placeholder within half a screen mounts it; a far one does not', () => {
        const root = mountShell()
        setGeometry(root, 5000)
        runFrame()
        runFrame()
        scrollerOf(root).dispatchEvent(new Event('scroll'))
        flushSync()
        expect(stubs(root)).toHaveLength(0)

        setGeometry(root, 1100)
        scrollerOf(root).dispatchEvent(new Event('scroll'))
        flushSync()
        expect(stubs(root)).toHaveLength(1)
    })

    test('S4a-D1 (v): an explicit library request mounts the library, then scrolls to the section and focuses its heading', async () => {
        const root = mountShell()
        runFrame()
        runFrame()
        expect(stubs(root)).toHaveLength(0)
        let stubsAtScroll = -1
        scrollSpy.mockImplementationOnce(() => {
            stubsAtScroll = stubs(root).length
        })

        openHomeLibrary()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(stubs(root)).toHaveLength(1)
        // The reveal waits for the mount: the section was already full height when it was scrolled.
        expect(stubsAtScroll).toBe(1)
        const section = root.querySelector<HTMLElement>('[data-part="home-library"]')!
        expect(scrollSpy.mock.contexts[0]).toBe(section)
        expect(document.activeElement).toBe(section.querySelector('h2'))

        expect(placeholderOf(root)).toBeNull()
        expect(root.querySelectorAll('[data-testid="library-stub"]')).toHaveLength(1)
        expect(idleCallback).not.toBeNull()
    })

    test('S4a-D1 (vi): once mounted, closing the Realm view brings the library back at once', () => {
        const root = mountShell()
        runFrame()
        runFrame()
        fireIdle()
        expect(stubs(root)).toHaveLength(1)

        OpenRealmStore.set(true)
        flushSync()
        expect(stubs(root)).toHaveLength(0)
        OpenRealmStore.set(false)
        flushSync()
        expect(placeholderOf(root)).toBeNull()
        expect(stubs(root)).toHaveLength(1)
    })

    test('S4a-D1 (vii): every trigger is torn down after the mount', () => {
        const root = mountShell()
        const scroller = scrollerOf(root)
        const remove = vi.spyOn(scroller, 'removeEventListener')
        runFrame()
        runFrame()
        fireIdle()
        expect(cancelIdle).toHaveBeenCalledWith(7)
        expect(remove.mock.calls.some(([type]) => type === 'scroll')).toBe(true)
    })

    test('S4a-D1 (vii): destroying the shell before idle cancels the idle callback and the pending frame', async () => {
        mountShell()
        runFrame()
        expect(frames.size).toBeGreaterThan(0)
        await unmount(instances.pop() as never)
        expect(cancelFrame).toHaveBeenCalled()
        expect(frames.size).toBe(0)

        const second = mountShell()
        const secondScroller = scrollerOf(second)
        const secondRemove = vi.spyOn(secondScroller, 'removeEventListener')
        runFrame()
        runFrame()
        expect(idleCallback).not.toBeNull()
        await unmount(instances.pop() as never)
        expect(cancelIdle).toHaveBeenCalledWith(7)
        expect(secondRemove.mock.calls.some(([type]) => type === 'scroll')).toBe(true)
    })
})
