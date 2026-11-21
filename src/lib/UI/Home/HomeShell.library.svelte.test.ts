// @vitest-environment jsdom

/**
 * The library embedded in the real `HomeShell` landing: where the section sits, which content makes it
 * (and the mid/wide Characters button) appear, that a touch inside it engages the Home library (the
 * signal that cancels a pending last-character restore) while mounting alone does not, and the
 * structure that bounds its height.
 *
 * REAL: `HomeShell`, `MainMenu`, `HomeStoryShelf`, `HomeEmptyHero`, `homeView`. MOCKED: the module set
 * of `HomeShell.stories.svelte.test.ts`, with `./HomeLibrary.svelte` a stand-in that renders a Studio
 * control and a control whose pointerdown stops propagation.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
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
        const plain = document.createElement('button')
        plain.setAttribute('data-part', 'library-studio')
        plain.setAttribute('data-cha-id', 'a')
        const stopping = document.createElement('button')
        stopping.setAttribute('data-stop-propagation', '')
        stopping.addEventListener('pointerdown', (event) => event.stopPropagation())
        stopping.addEventListener('keydown', (event) => event.stopPropagation())
        root.append(plain, stopping)
        anchor.parentNode!.insertBefore(root, anchor)
    },
}))

//#endregion

import HomeShell from './HomeShell.svelte'
import { homeView, showHomeLanding, startHomeView } from './homeView.svelte'
import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'

type Slot = Record<string, unknown>

function warm(name: string, extra: Slot = {}): Slot {
    return {
        type: 'character', chaId: name, name, image: '', chatPage: 0, lastInteraction: 0,
        chats: [{ id: `c-${name}`, name: `Chat-${name}`, message: [], note: '', localLore: [] }],
        ...extra,
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

const originalInnerWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

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

/**
 * The deferral is driven for real, not bypassed: the animation-frame and idle schedulers are manual fakes,
 * and this mounts the shell, runs the two frames that arm the triggers, then fires the idle callback.
 */
function mountLibraryShell(): HTMLElement {
    const frames = new Map<number, () => void>()
    let nextFrame = 1
    let idle: (() => void) | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
        frames.set(nextFrame, callback)
        return nextFrame++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames.delete(id)
    })
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
        idle = callback
        return 1
    })
    vi.stubGlobal('cancelIdleCallback', () => {})
    const root = mountShell()
    for (let frame = 0; frame < 2; frame++) {
        const due = Array.from(frames.values())
        frames.clear()
        due.forEach((callback) => callback())
    }
    idle?.()
    flushSync()
    return root
}

const section = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-library"]')
const landing = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-landing"]')!

/** The mid/wide Characters button: the landing's button named `language.character`. */
function charactersButton(root: ParentNode): HTMLButtonElement | undefined {
    return Array.from(landing(root).querySelectorAll('button')).find((b) => b.textContent?.trim() === language.character)
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
    setWidth(1280)
    setCharacters([])
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
    vi.unstubAllGlobals()
    setWidth(originalInnerWidth)
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('the embedded library section', () => {
    test('S4a-R1: three never-opened characters give the section with its heading and the library, before the side block', () => {
        setCharacters([warm('a'), warm('b'), warm('c')])
        const root = mountLibraryShell()
        const stage = root.querySelector('[data-part="home-stage"]')!
        const lib = section(root)
        expect(lib).not.toBeNull()
        expect(stage.contains(lib)).toBe(true)
        const heading = lib!.querySelector('h2')!
        expect(heading.textContent).toBe(language.homeLibraryHeading)
        expect(lib!.getAttribute('aria-labelledby')).toBe(heading.id)
        expect(lib!.querySelector('[data-testid="library-stub"]')).not.toBeNull()
        const side = root.querySelector('aside[data-part="home-side"]')!
        expect(lib!.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    test('S4a-R2: every character trashed keeps the section and shows exactly one hero on the landing', () => {
        setCharacters([warm('a', { trashTime: 3 }), warm('b', { trashTime: 3 })])
        const root = mountShell()
        expect(section(root)).not.toBeNull()
        expect(landing(root).querySelectorAll('[data-part="home-empty-hero"]').length).toBe(1)
        expect(section(root)!.querySelector('[data-part="home-empty-hero"]')).toBeNull()
    })

    test.each([
        ['no characters', () => []],
        ['only the hidden Playground', () => [warm('§playground', { utilityBot: true })]],
    ] as [string, () => Slot[]][])('S4a-R3: %s give no section, no stage and the hero', (_name, build) => {
        setCharacters(build())
        const root = mountShell()
        expect(section(root)).toBeNull()
        expect(root.querySelector('[data-part="home-stage"]')).toBeNull()
        expect(landing(root).querySelector('[data-part="home-empty-hero"]')).not.toBeNull()
    })

    test('S4a-R3: an undefined character list gives no section', () => {
        setCharacters([])
        ;(DBState.db as unknown as Slot).characters = undefined
        const root = mountShell()
        expect(section(root)).toBeNull()
    })

    test('S4a-U4: the section is bounded to one scroller height and the scroller is a size container', () => {
        setCharacters([warm('a')])
        const placeholderRoot = mountShell()
        expect(section(placeholderRoot)!.className.split(/\s+/)).toEqual(expect.arrayContaining(['max-h-[100cqh]', 'flex-col', 'min-h-0']))
        placeholderRoot.remove()
        const root = mountLibraryShell()
        const classes = section(root)!.className.split(/\s+/)
        expect(classes).toContain('max-h-[100cqh]')
        expect(classes).toContain('flex-col')
        expect(classes).toContain('min-h-0')
        const scroller = root.querySelector('[data-part="home-body"]')!.parentElement!
        expect(scroller.className.split(/\s+/)).toContain('[container-type:size]')
        const slot = stub(root).parentElement!
        expect(slot.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']))
    })
})

const stub = (root: ParentNode) => section(root)!.querySelector<HTMLElement>('[data-testid="library-stub"]')!

describe('the Characters button', () => {
    test.each([768, 1280])('S4a-R7 at %i: no library content hides the button', (width) => {
        setWidth(width)
        setCharacters([])
        expect(charactersButton(mountShell())).toBeUndefined()
    })

    test.each([768, 1280])('S4a-R7 at %i: only a hidden-system slot hides the button', (width) => {
        setWidth(width)
        setCharacters([warm('§playground', { utilityBot: true })])
        expect(charactersButton(mountShell())).toBeUndefined()
    })

    test.each([768, 1280])('S4a-R7 at %i: every character trashed keeps the button', (width) => {
        setWidth(width)
        setCharacters([warm('a', { trashTime: 3 }), warm('b', { trashTime: 3 })])
        expect(charactersButton(mountShell())).toBeDefined()
    })

    test.each([768, 1280])('S4a-R7 at %i: live characters keep the button', (width) => {
        setWidth(width)
        setCharacters([warm('a'), warm('b'), warm('c')])
        expect(charactersButton(mountShell())).toBeDefined()
    })
})

describe('touching the library engages it', () => {
    beforeEach(() => {
        setCharacters([warm('a'), warm('b')])
    })

    test('S4a-U6: mounting and settling alone does not engage, and a new creation starts disengaged', async () => {
        const first = mountLibraryShell()
        await new Promise((resolve) => setTimeout(resolve, 0))
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
        expect(homeView.libraryEngaged).toBe(false)

        stub(first).querySelector<HTMLElement>('[data-part="library-studio"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(homeView.libraryEngaged).toBe(true)

        await unmount(instances.pop() as never)
        targets.pop()!.remove()
        mountShell()
        expect(homeView.libraryEngaged).toBe(false)
    })

    test('S4a-R4: a pointerdown inside the section engages', () => {
        const root = mountLibraryShell()
        expect(homeView.libraryEngaged).toBe(false)
        stub(root).querySelector('[data-part="library-studio"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: a key press inside the section engages', () => {
        const root = mountLibraryShell()
        stub(root).querySelector('[data-part="library-studio"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: focus entering the section engages', () => {
        const root = mountLibraryShell()
        const control = stub(root).querySelector<HTMLElement>('[data-part="library-studio"]')!
        control.focus()
        if (!homeView.libraryEngaged) {
            control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        }
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: focus alone (a real focus call) engages without any other event', () => {
        const root = mountLibraryShell()
        stub(root).querySelector<HTMLElement>('[data-part="library-studio"]')!.focus()
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: a control that stops pointerdown propagation still engages (capture phase)', () => {
        const root = mountLibraryShell()
        stub(root).querySelector('[data-stop-propagation]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: a control that stops keydown propagation still engages (capture phase)', () => {
        const root = mountLibraryShell()
        stub(root).querySelector('[data-stop-propagation]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
        expect(homeView.libraryEngaged).toBe(true)
    })

    test('S4a-R4: a pointerdown on the side block or the header leaves it disengaged', () => {
        const root = mountShell()
        root.querySelector('aside[data-part="home-side"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        root.querySelector('[data-part="home-head"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(homeView.libraryEngaged).toBe(false)
    })
})
