// @vitest-environment jsdom

/**
 * The network lattice on the real `HomeShell`: it appears two animation frames after the shell is created, is
 * still outside the wide band, pauses while the page is covered, gives way to a user background image, and
 * stays a previous sibling of the landing so every Home block paints over it.
 *
 * REAL: `HomeShell`, `MainMenu`, `NexusNetworkBackground`, `chatSurface`. MOCKED: the renderer (a spy that
 * records each field's options and destroys), the module set of `HomeShell.deferredLibrary.svelte.test.ts`.
 * The animation-frame scheduler is a fake the test drives by hand.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import type { NetworkField, NetworkFieldOptions } from 'src/lib/Nexus/network/nexusNetwork'

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

const created: Array<{ canvas: HTMLCanvasElement, options: NetworkFieldOptions, field: NetworkField & { destroy: ReturnType<typeof vi.fn> } }> = []

vi.mock('src/lib/Nexus/network/nexusNetwork', () => ({
    createNetworkField: vi.fn((canvas: HTMLCanvasElement, options: NetworkFieldOptions) => {
        const field = { destroy: vi.fn(), time: () => (options.startTime ?? 0) + 5 }
        created.push({ canvas, options, field })
        return field
    }),
}))

//#endregion

import HomeShell from './HomeShell.svelte'
import HomeShellKeyHarness from './HomeShellKeyHarness.svelte'
import { startHomeView } from './homeView.svelte'
import { chatSurface } from '../../ChatScreens/chatSurface.svelte'
import { DBState, OpenRealmStore, alertStore } from 'src/ts/stores.svelte'

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

let frames = new Map<number, () => void>()
let nextFrame = 1

function installSchedulers(): void {
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
        const id = nextFrame++
        frames.set(id, callback)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames.delete(id)
    })
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 7))
    vi.stubGlobal('cancelIdleCallback', vi.fn())
}

/** Runs every frame callback queued right now; callbacks queued while running wait for the next frame. */
function runFrame(): void {
    const due = Array.from(frames.entries())
    frames.clear()
    for (const [, callback] of due) callback()
    flushSync()
}

const originalInnerWidth = window.innerWidth

function setViewportWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function resizeTo(width: number): void {
    setViewportWidth(width)
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

const instances: unknown[] = []
const targets: HTMLElement[] = []

function mountShellAt(width: number): HTMLElement {
    setViewportWidth(width)
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

/** Mounts and runs the two arming frames. */
function armedShellAt(width: number): HTMLElement {
    const root = mountShellAt(width)
    runFrame()
    runFrame()
    return root
}

const partOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-network"]')
const landingOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-landing"]')
const live = () => created.filter((entry) => entry.field.destroy.mock.calls.length === 0)
const lastOptions = (): NetworkFieldOptions => created[created.length - 1].options
const frozen = (options: NetworkFieldOptions): boolean => options.still === true

beforeEach(() => {
    created.length = 0
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    startHomeView()
    installSchedulers()
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
    setCharacters([warm('a'), warm('b'), warm('c')])
})

afterEach(async () => {
    OpenRealmStore.set(false)
    alertStore.set({ type: 'none', msg: '' })
    chatSurface.hidden = false
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    setViewportWidth(originalInnerWidth)
    resetBackHandlersForTests()
    startHomeView()
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('arming and bands', () => {
    test('L1: nothing of the lattice exists in the first render; it appears two frames later and animates when wide', () => {
        const root = mountShellAt(1400)
        expect(partOf(root)).toBeNull()
        expect(created).toHaveLength(0)
        runFrame()
        expect(partOf(root)).toBeNull()
        runFrame()
        expect(partOf(root)).not.toBeNull()
        expect(live()).toHaveLength(1)
        expect(frozen(lastOptions())).toBe(false)
    })

    test('L2: the phone and mid bands show a coarse still frame; the wide band animates', () => {
        for (const width of [360, 1000, 1279]) {
            created.length = 0
            const root = armedShellAt(width)
            expect(partOf(root), `${width}`).not.toBeNull()
            expect(live(), `${width}`).toHaveLength(1)
            expect(frozen(lastOptions()), `${width}`).toBe(true)
            expect(lastOptions().lowPower, `${width}`).toBe(true)
        }
        for (const width of [1280, 1400]) {
            created.length = 0
            const root = armedShellAt(width)
            expect(partOf(root), `${width}`).not.toBeNull()
            expect(frozen(lastOptions()), `${width}`).toBe(false)
            expect(lastOptions().lowPower, `${width}`).toBe(false)
        }
    })

    test('L3: crossing the wide edge replaces the field with the phase carried; staying in a still band does not', () => {
        const root = armedShellAt(1400)
        const first = created[0]
        resizeTo(700)
        expect(first.field.destroy).toHaveBeenCalledTimes(1)
        expect(created).toHaveLength(2)
        expect(frozen(created[1].options)).toBe(true)
        expect(created[1].options.startTime).toBe(first.field.time())
        resizeTo(1100)
        expect(created).toHaveLength(2)
        resizeTo(1400)
        expect(created).toHaveLength(3)
        expect(frozen(created[2].options)).toBe(false)
        expect(live()).toHaveLength(1)
        expect(root.querySelectorAll('[data-part="home-network"] canvas')).toHaveLength(1)
    })
})

describe('pausing', () => {
    test('L4: a hidden chat surface pauses the lattice and showing it again resumes', () => {
        armedShellAt(1400)
        chatSurface.hidden = true
        flushSync()
        expect(live()).toHaveLength(0)
        chatSurface.hidden = false
        flushSync()
        expect(live()).toHaveLength(1)
        expect(created).toHaveLength(2)
    })

    test('L5: a page-covering alert pauses the lattice; a toast does not', () => {
        armedShellAt(1400)
        alertStore.set({ type: 'ask', msg: '' })
        flushSync()
        expect(live()).toHaveLength(0)
        alertStore.set({ type: 'none', msg: '' })
        flushSync()
        expect(live()).toHaveLength(1)
        alertStore.set({ type: 'toast', msg: '' })
        flushSync()
        expect(live()).toHaveLength(1)
    })

    test('L6: destroying the shell before arming cancels the frames; after arming every field is destroyed', async () => {
        mountShellAt(1400)
        runFrame()
        await unmount(instances.pop() as never)
        expect(frames.size).toBe(0)
        expect(created).toHaveLength(0)

        armedShellAt(1400)
        expect(created.length).toBeGreaterThan(0)
        await unmount(instances.pop() as never)
        expect(live()).toHaveLength(0)
    })

    test('L7: a keyed remount leaves exactly one field and one part', async () => {
        setViewportWidth(1400)
        const props = $state({ epoch: 0 })
        const target = document.createElement('div')
        document.body.appendChild(target)
        targets.push(target)
        const instance = mount(HomeShellKeyHarness, { target, props })
        instances.push(instance)
        flushSync()
        runFrame()
        runFrame()
        expect(live()).toHaveLength(1)
        props.epoch = 1
        flushSync()
        runFrame()
        runFrame()
        expect(live()).toHaveLength(1)
        expect(target.querySelectorAll('[data-part="home-network"]')).toHaveLength(1)
        await unmount(instances.pop() as never)
        expect(live()).toHaveLength(0)
    })
})

describe('markup and wiring', () => {
    test('L8: the part is the previous sibling of the landing, hidden from assistive tech, and carries the alpha on its child', () => {
        const root = armedShellAt(1400)
        const part = partOf(root)!
        expect(part.nextElementSibling).toBe(landingOf(root))
        expect(part.getAttribute('aria-hidden')).toBe('true')
        const classes = Array.from(part.classList)
        for (const name of ['pointer-events-none', 'absolute', 'inset-0', 'forced-colors:hidden', 'text-[color:var(--nexus-edge-strong)]']) {
            expect(classes).toContain(name)
        }
        expect(part.children).toHaveLength(1)
        expect(part.children[0].classList.contains('opacity-[var(--home-network-alpha)]')).toBe(true)
        expect(landingOf(root)!.querySelector('canvas')).toBeNull()
    })

    test('L9: the field draws in the canvas computed colour', () => {
        const original = window.getComputedStyle.bind(window)
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) =>
            element instanceof HTMLCanvasElement ? ({ color: 'rgb(9, 8, 7)' } as unknown as CSSStyleDeclaration) : original(element, pseudo))
        armedShellAt(1400)
        expect(lastOptions().colour).toBe('rgb(9, 8, 7)')
    })

    test('L10: a user background image keeps the lattice away, at mount and at runtime', () => {
        DBState.db.customBackground = 'x'
        const root = armedShellAt(1400)
        expect(partOf(root)).toBeNull()
        expect(created).toHaveLength(0)

        DBState.db.customBackground = ''
        flushSync()
        expect(partOf(root)).not.toBeNull()
        expect(live()).toHaveLength(1)

        DBState.db.customBackground = 'y'
        flushSync()
        expect(partOf(root)).toBeNull()
        expect(live()).toHaveLength(0)
    })

    test('L11: only presses on the bare page may raise a wave', () => {
        const root = armedShellAt(1400)
        const canWave = lastOptions().canWave!
        const landing = landingOf(root)!
        const verdict = (element: Element): boolean => {
            let result = true
            const listener = (event: Event): void => {
                result = canWave(event as PointerEvent)
            }
            window.addEventListener('pointerdown', listener, { once: true })
            element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
            window.removeEventListener('pointerdown', listener)
            return result
        }
        const parts = Array.from(landing.querySelectorAll('[data-part]'))
            .filter((element) => !['home-landing', 'home-body'].includes(element.getAttribute('data-part')!))
        expect(parts.length).toBeGreaterThan(0)
        for (const element of parts) expect(verdict(element), element.getAttribute('data-part')!).toBe(false)
        const buttons = Array.from(landing.querySelectorAll('button, a'))
        expect(buttons.length).toBeGreaterThan(0)
        for (const element of buttons) expect(verdict(element)).toBe(false)
        const nested = buttons.map((button) => button.firstElementChild).find((child): child is Element => child !== null)
        expect(nested).toBeDefined()
        expect(verdict(nested!)).toBe(false)

        const body = landing.querySelector('[data-part="home-body"]')!
        expect(verdict(body)).toBe(true)
        expect(verdict(body.parentElement!)).toBe(true)
        expect(verdict(document.body)).toBe(false)
    })
})
