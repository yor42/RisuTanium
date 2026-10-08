// @vitest-environment happy-dom

/**
 * Focus events that Chromium fires synchronously while a keyed `{#each}` reconcile moves a
 * focused entry, driven through the REAL `Sidebar.svelte` (and so the real `SidebarRail.svelte`).
 *
 * happy-dom does not fire focusout when a focused node is moved, so the DOM insertion method
 * Svelte's each-block `move` uses (`before`) is wrapped: moving a node that contains the active
 * element first dispatches a bubbling focusout with no related target, as Chromium does. That
 * event runs inside the block effect, where writing `$state` throws `state_unsafe_mutation`.
 *
 * MOCKED: `checkCharOrder` (a spy), `changeChar`, the chat list, `alertSelect` / `alertInput`
 * and the storage and platform modules.
 */
import { mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { checkCharOrderSpy, changeCharSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: checkCharOrderSpy,
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(async () => 'asset-1'),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

vi.mock(import('../../ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '3'),
    alertInput: vi.fn(async () => ''),
}))

import { DBState, selectedCharID, alertStore } from '../../ts/stores.svelte'
import { DEFAULT_HEIGHTS } from './railConstants'
import Sidebar from './Sidebar.svelte'
import { charKey } from './railTestKit'
import { defaultSettle, installGeometry, scrollerOf, settleFrame, type Geometry } from './sidebarDnd.testKit'

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `c${i}`)
const ROW_PITCH = DEFAULT_HEIGHTS.char + DEFAULT_HEIGHTS.gap
const rowTop = (index: number): number => DEFAULT_HEIGHTS.gap + index * ROW_PITCH

function setDb(order: string[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: order.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let root: HTMLElement
let geo: Geometry

async function settle(): Promise<void> {
    await defaultSettle()
    await tick()
    await defaultSettle()
}

async function mountRail(order: string[], height: number): Promise<void> {
    setDb(order)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    root = target
    geo = installGeometry(target, height)!
    await settleFrame()
}

//#region Chromium focus on move

type Insert = (this: ChildNode, ...nodes: (Node | string)[]) => void
const patched: Array<{ proto: object; own: PropertyDescriptor | undefined; method: 'before' | 'remove' }> = []
let focusoutOnMove = 0
let focusoutOnRemove = 0

/**
 * Wraps `before` so a node that contains the active element reports a focusout, with no related
 * target, before it is placed: the event Chromium fires from inside the each-block `move`.
 */
function emulateFocusoutOnMove(): void {
    for (const ctor of [Element, Comment, Text]) {
        const proto = ctor.prototype as unknown as { before: Insert }
        const original = proto.before
        patched.push({ proto, own: Object.getOwnPropertyDescriptor(proto, 'before'), method: 'before' })
        proto.before = function (this: ChildNode, ...nodes: (Node | string)[]) {
            for (const node of nodes) {
                const active = document.activeElement
                if (typeof node !== 'string' && active && active !== document.body && node.contains(active)) {
                    focusoutOnMove++
                    active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
                }
            }
            original.apply(this, nodes)
        }
    }
}

/**
 * Wraps `remove` so a node that contains the active element reports a focusout, with no related
 * target, before it is detached: the event Chromium fires while a focused rail is unmounted.
 */
function emulateFocusoutOnRemove(): void {
    for (const ctor of [Element, Comment, Text]) {
        const proto = ctor.prototype as unknown as { remove: () => void }
        const original = proto.remove
        patched.push({ proto, own: Object.getOwnPropertyDescriptor(proto, 'remove'), method: 'remove' })
        proto.remove = function (this: ChildNode) {
            const active = document.activeElement
            if (active && active !== document.body && this.contains(active)) {
                focusoutOnRemove++
                active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
            }
            original.call(this)
        }
    }
}

function restoreInsertion(): void {
    for (const { proto, own, method } of patched.splice(0).reverse()) {
        if (own) {
            Object.defineProperty(proto, method, own)
        }
        else {
            delete (proto as Record<string, unknown>)[method]
        }
    }
}

//#endregion

const errors: unknown[] = []
const onError = (ev: ErrorEvent): void => {
    errors.push(ev.error ?? ev.message)
    ev.preventDefault()
}
const onRejection = (reason: unknown): void => {
    errors.push(reason)
}

beforeEach(() => {
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    selectedCharID.set(-1)
    alertStore.set({ type: 'none', msg: '' })
    errors.length = 0
    focusoutOnMove = 0
    focusoutOnRemove = 0
    window.addEventListener('error', onError)
    process.on('unhandledRejection', onRejection)
    process.on('uncaughtException', onRejection)
})

afterEach(async () => {
    window.removeEventListener('error', onError)
    process.off('unhandledRejection', onRejection)
    process.off('uncaughtException', onRejection)
    restoreInsertion()
    if (mounted) {
        try {
            await unmount(mounted.app as never)
        } catch {
            // a sidebar that failed half way through mounting is torn down best effort
        }
        mounted.target.remove()
        mounted = null
    }
    document.body.innerHTML = ''
})

const entryOf = (key: string): HTMLElement | null =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]')).find((el) => el.getAttribute('data-rail-entry') === key) ?? null
const focusedKey = (): string | null => (document.activeElement as HTMLElement | null)?.getAttribute?.('data-rail-entry') ?? null
const plusButton = (): HTMLElement | null => root.querySelector<HTMLElement>('[data-rail-kind="plus"] button')

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(ev)
    return ev
}

describe('a focus event fired inside a keyed move', () => {
    test('moving the focused entry with the keyboard raises no error, and the rail keys keep working', async () => {
        await mountRail(['A', 'B', 'C'], 2000)
        entryOf(charKey('A'))!.focus()
        await settle()
        emulateFocusoutOnMove()

        press(document.activeElement!, 'ArrowDown', { altKey: true })
        await settle()

        expect(focusoutOnMove).toBeGreaterThan(0)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(errors).toEqual([])
        expect(get(alertStore).type).not.toBe('error')

        const focused = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
        const keyBefore = focusedKey() ?? charKey('A')
        const order = focused.map((el) => el.getAttribute('data-rail-entry'))
        const at = order.indexOf(keyBefore)
        const ev = press(entryOf(keyBefore)!, 'ArrowUp')
        await settle()
        expect(ev.defaultPrevented).toBe(true)
        expect(focusedKey()).toBe(order[Math.max(0, at - 1)])
        expect(errors).toEqual([])
    })
})

describe('a focus event fired while the rail unmounts', () => {
    test('unmounting a rail that holds focus raises no error from the deferred focus bookkeeping', async () => {
        await mountRail(['A', 'B', 'C'], 2000)
        entryOf(charKey('A'))!.focus()
        await settle()
        emulateFocusoutOnRemove()

        const app = mounted!.app
        mounted = null
        await unmount(app as never)
        await settle()

        expect(focusoutOnRemove).toBeGreaterThan(0)
        expect(errors).toEqual([])
        expect(get(alertStore).type).not.toBe('error')
        root.remove()
    })
})

describe('the plus button pin', () => {
    test('a focused plus button stays mounted away from the band, and is released once focus leaves it', async () => {
        await mountRail(ids(200), 600)
        await geo.scrollAndSettle(100000)
        const plus = plusButton()
        expect(plus).not.toBeNull()
        plus!.focus()
        await settle()
        expect(document.activeElement).toBe(plus)

        await geo.scrollAndSettle(rowTop(0))
        expect(plusButton()).toBe(plus)
        expect(scrollerOf(root).contains(plus)).toBe(true)

        plus!.blur()
        await settle()
        expect(plusButton()).toBeNull()
    })
})
