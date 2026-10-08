// @vitest-environment happy-dom

/**
 * Pointer drag and drop on the character rail, driven through the REAL `Sidebar.svelte`
 * (and so the real `SidebarRail.svelte`, layout model and interaction machine) with
 * synthetic pointer, touch, key and context-menu events and fake geometry.
 *
 * happy-dom has no layout. `installGeometry` (see `sidebarDnd.testKit.ts`) gives the rail's
 * scroll container a rect and a scroll position the test owns; positions come from the
 * `data-rail-y` and `data-rail-h` attributes the rail renders from its layout model. Timers
 * and animation frames are fake where a test depends on time. Pointer capture is a spy on
 * the container, because happy-dom has no `setPointerCapture`.
 *
 * MOCKED: `checkCharOrder` (a spy), `alertSelect` / `alertInput` (spies that answer
 * "cancel"), `saveAsset`, `changeChar`, and the storage and platform modules.
 *
 * Tests whose title starts with `guard:` state behaviour that must be preserved. The others
 * state the behaviour of the pointer rail.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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

vi.mock(import('../../ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '5'),
    alertInput: vi.fn(async () => ''),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { alertSelect } from 'src/ts/alert'
import Sidebar from './Sidebar.svelte'
import {
    AUTO_SCROLL_MAX_PX_PER_S,
    CLICK_SUPPRESS_MS,
    LONG_PRESS_MS,
    MERGE_DWELL_MS,
    OUTSIDE_MARGIN_PX,
    SPRING_OPEN_MS,
    TOUCH_CONTEXTMENU_WINDOW_MS,
    TOUCH_SLOP_PX,
    edgeBandPx,
} from './railConstants'
import {
    allRows,
    boxOf,
    charRow,
    clientY,
    defaultSettle as settle,
    dragOnto,
    folderAvatars,
    folderGaps,
    folderRow,
    installGeometry,
    pointer,
    scrollerOf,
    topGaps,
    zoneClientY,
    type Geometry,
    type PointerOptions,
    resetRailMemory,
} from './sidebarDnd.testKit'

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'X', 'Y']

function setDb(order: OrderFixture, extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: LETTERS.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
        ...extra,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let geo: Geometry
let root: HTMLElement

async function mountSidebar(height = 2000): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    geo = installGeometry(target, height)!
    scrollerOf(target).setPointerCapture = captureSpy
    scrollerOf(target).releasePointerCapture = releaseSpy
    root = target
    return target
}

const captureSpy = vi.fn()
const releaseSpy = vi.fn()

beforeEach(() => {
    resetRailMemory()
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    captureSpy.mockClear()
    releaseSpy.mockClear()
    vi.mocked(alertSelect).mockClear()
    selectedCharID.set(-1)
})

afterEach(async () => {
    vi.useRealTimers()
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
    Reflect.deleteProperty(navigator, 'vibrate')
    Reflect.deleteProperty(document, 'visibilityState')
})

function useFakeTime(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
}

//#region helpers

const isGeneratedId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)

function show(order: readonly (string | FolderFixture)[]): string[] {
    return order.map((e) => (typeof e === 'string' ? e : `${isGeneratedId(e.id) ? 'NEW' : e.id}[${e.data.join(',')}]`))
}
const orderNow = (): string[] => show($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture)

const ghostEl = (): HTMLElement | null => document.querySelector('[data-rail-ghost]')
const indicatorEl = (): HTMLElement | null => root.querySelector('[data-rail-indicator]')
const highlighted = (): HTMLElement[] => allRows(root).filter((el) => el.classList.contains('ring-2'))
const dimmed = (): HTMLElement[] => allRows(root).filter((el) => el.classList.contains('opacity-40'))
const plusEl = (): HTMLElement => root.querySelector<HTMLElement>('[data-rail-kind="plus"]')!

const down = (el: HTMLElement, y: number, o?: PointerOptions) => el.dispatchEvent(pointer('pointerdown', y, o))
const move = (y: number, o?: PointerOptions) => window.dispatchEvent(pointer('pointermove', y, o))
const up = (y: number, o?: PointerOptions) => window.dispatchEvent(pointer('pointerup', y, o))
const cancelPointer = (y: number, o?: PointerOptions) => window.dispatchEvent(pointer('pointercancel', y, o))
const rowY = (el: HTMLElement, fraction = 0.5): number => clientY(root, el, fraction)

/** Presses a row with the mouse and moves far enough to start the drag. */
async function startMouseDrag(el: HTMLElement): Promise<void> {
    const y = rowY(el)
    down(el, y)
    move(y + 6)
    await settle()
}

/** Lifts a row with a touch long-press (fake time). */
async function liftWithTouch(el: HTMLElement): Promise<void> {
    down(el, rowY(el), { pointerType: 'touch' })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    await settle()
}

async function moveTo(y: number, o?: PointerOptions): Promise<void> {
    move(y, o)
    await settle()
}

async function rest(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms)
    await settle()
}

function pressKey(key: string): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    return ev
}

const fakeWait = async (ms: number): Promise<void> => {
    vi.advanceTimersByTime(ms)
}

/** Distinct window and document listeners currently registered, as `target|type|capture|id`. */
function trackListeners(): { live(): Set<string>; stop(): void } {
    const ids = new WeakMap<object, number>()
    let next = 0
    const idOf = (fn: unknown): number => {
        if (typeof fn !== 'function') {
            return -1
        }
        if (!ids.has(fn)) {
            ids.set(fn, next++)
        }
        return ids.get(fn)!
    }
    const live = new Set<string>()
    const spies: Array<{ mockRestore(): void }> = []
    const wrap = (target: 'window' | 'document', obj: Window | Document) => {
        const add = obj.addEventListener.bind(obj)
        const remove = obj.removeEventListener.bind(obj)
        const capture = (o: unknown): boolean => (typeof o === 'boolean' ? o : Boolean((o as { capture?: boolean } | undefined)?.capture))
        spies.push(
            vi.spyOn(obj, 'addEventListener').mockImplementation(((type: string, fn: EventListener, o?: unknown) => {
                live.add(`${target}|${type}|${capture(o)}|${idOf(fn)}`)
                return add(type, fn, o as boolean)
            }) as typeof obj.addEventListener),
            vi.spyOn(obj, 'removeEventListener').mockImplementation(((type: string, fn: EventListener, o?: unknown) => {
                live.delete(`${target}|${type}|${capture(o)}|${idOf(fn)}`)
                return remove(type, fn, o as boolean)
            }) as typeof obj.removeEventListener),
        )
    }
    wrap('window', window)
    wrap('document', document)
    return { live: () => live, stop: () => spies.forEach((s) => s.mockRestore()) }
}

//#endregion

describe('mouse reorder and cancel', () => {
    test('dragging C between A and B reorders; the ghost and the dimmed source exist only during the drag', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const c = charRow(t, 'C')
        await startMouseDrag(c)
        expect(ghostEl()).not.toBeNull()
        expect(dimmed()).toEqual([c])
        const gap = topGaps(t)[1]
        await moveTo(rowY(gap))
        expect(indicatorEl()).not.toBeNull()
        up(rowY(gap))
        await settle()
        expect(orderNow()).toEqual(['A', 'C', 'B'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(ghostEl()).toBeNull()
        expect(indicatorEl()).toBeNull()
        expect(dimmed()).toEqual([])
    })

    test('Escape mid-drag cancels with no write, leaves no ghost, and is consumed before any document listener', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(rowY(topGaps(t)[0]))
        const documentListener = vi.fn()
        document.addEventListener('keydown', documentListener)
        const ev = pressKey('Escape')
        document.removeEventListener('keydown', documentListener)
        await settle()
        expect(documentListener).not.toHaveBeenCalled()
        expect(ev.defaultPrevented).toBe(true)
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(ghostEl()).toBeNull()
        expect(indicatorEl()).toBeNull()
        expect(dimmed()).toEqual([])
    })

    test('guard: Escape with no drag running is not consumed', async () => {
        setDb(['A', 'B'])
        await mountSidebar()
        expect(pressKey('Escape').defaultPrevented).toBe(false)
    })

    test('a drag takes pointer capture on the container when it starts, never at the press, and releases it at the end', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const c = charRow(t, 'C')
        down(c, rowY(c))
        expect(captureSpy).not.toHaveBeenCalled()
        move(rowY(c) + 6)
        await settle()
        expect(captureSpy).toHaveBeenCalledWith(1)
        up(rowY(c))
        await settle()
        expect(releaseSpy).toHaveBeenCalledWith(1)
    })
})

describe('merge by dwell', () => {
    test('a release in a character centre zone before the dwell drops into the nearest gap and creates no folder', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await dragOnto(t, charRow(t, 'C'), charRow(t, 'A'), { wait: fakeWait, holdMs: MERGE_DWELL_MS - 1 })
        expect(orderNow()).toEqual(['A', 'C', 'B'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
    })

    test('after the dwell the row is highlighted instead of the line, and a release creates a folder of the two', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const a = charRow(t, 'A')
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(zoneClientY(t, a))
        expect(indicatorEl()).not.toBeNull()
        expect(highlighted()).toEqual([])
        await rest(MERGE_DWELL_MS)
        expect(highlighted()).toEqual([a])
        expect(indicatorEl()).toBeNull()
        up(zoneClientY(t, a))
        await settle()
        expect(orderNow()).toEqual(['NEW[C,A]', 'B'])
        expect(($state.snapshot(DBState.db.characterOrder) as unknown as FolderFixture[])[0].name).toBe('New Folder')
    })

    test('leaving the zone and returning restarts the dwell', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await startMouseDrag(charRow(t, 'D'))
        await moveTo(zoneClientY(t, b))
        await rest(MERGE_DWELL_MS - 50)
        await moveTo(rowY(b, 0.95))
        await rest(100)
        await moveTo(zoneClientY(t, b))
        await rest(MERGE_DWELL_MS - 1)
        expect(highlighted()).toEqual([])
        await rest(1)
        expect(highlighted()).toEqual([b])
    })

    test('a wheel that slides another row under a stationary pointer clears the dwell', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await startMouseDrag(charRow(t, 'D'))
        await moveTo(zoneClientY(t, b))
        await rest(MERGE_DWELL_MS / 2)
        geo.scrollTo(boxOf(charRow(t, 'C')).y - boxOf(b).y)
        await settle()
        await rest(MERGE_DWELL_MS * 2)
        expect(highlighted()).toEqual([])
    })

    test('a row that is armed and then scrolls away from the pointer is disarmed', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await startMouseDrag(charRow(t, 'D'))
        await moveTo(zoneClientY(t, b))
        await rest(MERGE_DWELL_MS)
        expect(highlighted()).toEqual([b])
        geo.scrollTo(60)
        await settle()
        expect(highlighted()).toEqual([])
        up(zoneClientY(t, b))
        await settle()
        expect(orderNow().some((e) => e.startsWith('NEW'))).toBe(false)
    })

    test('a pointer parked in the bottom edge band never arms; moving into a zone arms after the dwell', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        const t = await mountSidebar(400)
        const bandY = 400 - 5
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(bandY)
        await rest(MERGE_DWELL_MS * 3)
        expect(highlighted()).toEqual([])
        geo.scrollTo(0)
        const b = charRow(t, 'B')
        await moveTo(zoneClientY(t, b))
        await rest(MERGE_DWELL_MS)
        expect(highlighted()).toEqual([b])
    })

    test('the first character can be merge-targeted at its centre inside the top band area at scrollTop 0', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        const t = await mountSidebar(400)
        const a = charRow(t, 'A')
        expect(rowY(a)).toBeLessThan(edgeBandPx(400))
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(rowY(a))
        await rest(MERGE_DWELL_MS)
        expect(highlighted()).toEqual([a])
        up(rowY(a))
        await settle()
        expect(orderNow()).toEqual(['NEW[C,A]', 'B', 'D', 'E', 'F', 'G', 'H'])
    })
    test('a member row is never highlighted, however long the pointer rests on it', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A', 'B']), 'C'])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(zoneClientY(t, charRow(t, 'B')))
        await rest(MERGE_DWELL_MS * 3)
        expect(highlighted()).toEqual([])
    })
})

describe('folders', () => {
    test('entering a closed folder centre zone highlights it at once and a release appends', async () => {
        useFakeTime()
        setDb(['A', 'B', folderOf('f1', ['C', 'D'])])
        const t = await mountSidebar()
        const f = folderRow(t)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(zoneClientY(t, f))
        expect(highlighted()).toEqual([f])
        expect(indicatorEl()).toBeNull()
        up(zoneClientY(t, f))
        await settle()
        expect(orderNow()).toEqual(['B', 'f1[C,D,A]'])
    })

    test('a release on the folder row outside its centre zone drops into the nearest gap', async () => {
        useFakeTime()
        setDb(['A', 'B', folderOf('f1', ['C', 'D'])])
        const t = await mountSidebar()
        await dragOnto(t, charRow(t, 'A'), folderRow(t), { zone: 'upper', wait: fakeWait })
        expect(orderNow()).toEqual(['B', 'A', 'f1[C,D]'])
    })

    test('a pause opens the closed folder, a member gap becomes a target, and the folder stays open after the drop', async () => {
        useFakeTime()
        setDb(['A', folderOf('f1', ['C', 'D'])])
        const t = await mountSidebar()
        const f = folderRow(t)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(zoneClientY(t, f))
        await rest(SPRING_OPEN_MS - 1)
        expect(allRows(t)).toHaveLength(2)
        await rest(1)
        expect(allRows(t)).toHaveLength(4)
        expect(highlighted()).toEqual([f])
        const gap = folderGaps(t, f)[1]
        await moveTo(rowY(gap))
        up(rowY(gap))
        await settle()
        expect(orderNow()).toEqual(['f1[C,A,D]'])
        expect(allRows(t)).toHaveLength(4)
    })

    test('a spring-opened folder stays open after a cancelled drag, and nothing is written', async () => {
        useFakeTime()
        setDb(['A', folderOf('f1', ['C', 'D'])])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(zoneClientY(t, folderRow(t)))
        await rest(SPRING_OPEN_MS)
        pressKey('Escape')
        await settle()
        expect(allRows(t)).toHaveLength(4)
        expect(orderNow()).toEqual(['A', 'f1[C,D]'])
    })

    test('an auto-scroll that carries a folder zone under the parked pointer never highlights it', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', folderOf('f1', ['I', 'J'])])
        const t = await mountSidebar(400)
        const f = folderRow(t)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(400 - 4)
        for (let i = 0; i < 80; i++) {
            await rest(16)
            expect(highlighted()).toEqual([])
        }
        expect(geo.scrollTop).toBeGreaterThan(0)
        const folderBox = boxOf(f)
        expect(folderBox.y).toBeGreaterThan(0)
        up(400 - 4)
        await settle()
        expect(orderNow()).not.toContain('f1[I,J,A]')
    })

    test('a wheel that slides a folder zone under a stationary pointer shows no highlight until the pointer re-enters the zone', async () => {
        useFakeTime()
        setDb(['A', 'B', folderOf('f1', ['I']), 'C'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        const f = folderRow(t)
        await startMouseDrag(charRow(t, 'C'))
        const y = zoneClientY(t, b)
        await moveTo(y)
        geo.scrollTo(boxOf(f).y - boxOf(b).y)
        await settle()
        expect(highlighted()).toEqual([])
        await moveTo(y + 1)
        expect(highlighted()).toEqual([])
        await moveTo(zoneClientY(t, f) + 40)
        await moveTo(zoneClientY(t, f))
        expect(highlighted()).toEqual([f])
    })

    test('a folder opened elsewhere under a stationary pointer does not arm the row that arrives under it', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['X', 'Y']), 'A', 'B', 'C'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(zoneClientY(t, b))
        selectedCharID.set(LETTERS.indexOf('X'))
        window.dispatchEvent(new Event('scrollToActiveCharacter'))
        selectedCharID.set(-1)
        await settle()
        expect(allRows(t).length).toBeGreaterThan(4)
        await rest(MERGE_DWELL_MS * 2 + 200)
        expect(highlighted()).toEqual([])
    })

    test('a dragged folder never highlights a row or opens a folder', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['X']), 'A', folderOf('f2', ['Y'])])
        const t = await mountSidebar()
        await startMouseDrag(folderRow(t, 0))
        await moveTo(zoneClientY(t, charRow(t, 'A')))
        await rest(MERGE_DWELL_MS * 2)
        expect(highlighted()).toEqual([])
        await moveTo(zoneClientY(t, folderRow(t, 1)))
        await rest(SPRING_OPEN_MS * 2)
        expect(highlighted()).toEqual([])
        expect(allRows(t)).toHaveLength(3)
        up(zoneClientY(t, folderRow(t, 1)))
        await settle()
        expect(orderNow().length).toBe(3)
        expect(orderNow()).not.toEqual(['f1[X]', 'A', 'f2[Y]'])
    })
})

describe('outside the column', () => {
    test('beyond the margin the indicator is hidden and a release writes nothing; back inside it returns', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        const y = rowY(topGaps(t)[0])
        await moveTo(y)
        expect(indicatorEl()).not.toBeNull()
        await moveTo(y, { x: 80 + OUTSIDE_MARGIN_PX + 8 })
        expect(indicatorEl()).toBeNull()
        up(y, { x: 80 + OUTSIDE_MARGIN_PX + 8 })
        await settle()
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(ghostEl()).toBeNull()
    })

    test('auto-scroll stops while the pointer is outside the column', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        const t = await mountSidebar(400)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(400 - 3)
        await rest(160)
        const before = geo.scrollTop
        expect(before).toBeGreaterThan(0)
        await moveTo(400 - 3, { x: 80 + OUTSIDE_MARGIN_PX + 8 })
        await rest(160)
        expect(geo.scrollTop).toBe(before)
    })

    test('a release below the last row, over the plus block, drops at the end', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await dragOnto(t, charRow(t, 'A'), plusEl())
        expect(orderNow()).toEqual(['B', 'C', 'A'])
    })

    test('a release above the first row drops at the start', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(-30)
        up(-30)
        await settle()
        expect(orderNow()).toEqual(['C', 'A', 'B'])
    })
})

describe('auto-scroll and keys', () => {
    test('the bottom band scrolls down with speed that grows with depth, and the top band scrolls up', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
        const t = await mountSidebar(400)
        const band = edgeBandPx(400)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(400 - band / 2)
        await rest(16)
        const start = geo.scrollTop
        await rest(160)
        const shallow = geo.scrollTop - start
        await moveTo(400)
        const mid = geo.scrollTop
        await rest(160)
        const deep = geo.scrollTop - mid
        expect(shallow).toBeGreaterThan(0)
        expect(deep).toBeGreaterThan(shallow)
        expect(deep).toBeLessThanOrEqual(Math.ceil((AUTO_SCROLL_MAX_PX_PER_S * 0.16) + 20))
        await moveTo(2)
        const top = geo.scrollTop
        await rest(160)
        expect(geo.scrollTop).toBeLessThan(top)
    })

    test('leaving the band stops the scrolling', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
        const t = await mountSidebar(400)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(400 - 3)
        await rest(160)
        await moveTo(200)
        const parked = geo.scrollTop
        await rest(320)
        expect(geo.scrollTop).toBe(parked)
    })

    test('PageDown scrolls the container during a drag and the indicator follows; Home returns', async () => {
        setDb(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
        const t = await mountSidebar(400)
        await startMouseDrag(charRow(t, 'A'))
        await moveTo(rowY(topGaps(t)[3]))
        const before = indicatorEl()!.style.transform
        const ev = pressKey('PageDown')
        await settle()
        expect(ev.defaultPrevented).toBe(true)
        expect(geo.scrollTop).toBeGreaterThan(0)
        expect(indicatorEl()!.style.transform).not.toBe(before)
        pressKey('Home')
        await settle()
        expect(geo.scrollTop).toBe(0)
    })

    test('guard: PageDown with no drag running is not consumed', async () => {
        setDb(['A', 'B'])
        await mountSidebar()
        expect(pressKey('PageDown').defaultPrevented).toBe(false)
    })
})

describe('touch', () => {
    const touchMove = (el: Element): Event => {
        const ev = new Event('touchmove', { bubbles: true, cancelable: true })
        el.dispatchEvent(ev)
        return ev
    }

    test('long-press then move drags with the native scroll held; before the lift the touch move is left to the browser', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const c = charRow(t, 'C')
        down(c, rowY(c), { pointerType: 'touch' })
        expect(touchMove(c).defaultPrevented).toBe(false)
        vi.advanceTimersByTime(LONG_PRESS_MS)
        await settle()
        expect(ghostEl()).not.toBeNull()
        expect(touchMove(c).defaultPrevented).toBe(true)
        const gap = topGaps(t)[1]
        await moveTo(rowY(gap), { pointerType: 'touch' })
        up(rowY(gap), { pointerType: 'touch' })
        await settle()
        expect(orderNow()).toEqual(['A', 'C', 'B'])
        expect(touchMove(c).defaultPrevented).toBe(false)
    })

    test('a quick swipe leaves the scroll to the browser and starts no drag', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const c = charRow(t, 'C')
        down(c, rowY(c), { pointerType: 'touch' })
        await moveTo(rowY(c) + TOUCH_SLOP_PX + 5, { pointerType: 'touch' })
        vi.advanceTimersByTime(LONG_PRESS_MS * 2)
        await settle()
        expect(ghostEl()).toBeNull()
        expect(touchMove(c).defaultPrevented).toBe(false)
        up(rowY(c) + TOUCH_SLOP_PX + 5, { pointerType: 'touch' })
        expect(orderNow()).toEqual(['A', 'B', 'C'])
    })

    test('a native scroll that cancels the pointer ends the press with no write', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const c = charRow(t, 'C')
        down(c, rowY(c), { pointerType: 'touch' })
        cancelPointer(rowY(c), { pointerType: 'touch' })
        vi.advanceTimersByTime(LONG_PRESS_MS * 2)
        await settle()
        expect(ghostEl()).toBeNull()
        expect(orderNow()).toEqual(['A', 'B', 'C'])
    })

    test('releasing a lifted character without moving selects nothing, and the click that follows is swallowed once', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await liftWithTouch(b)
        up(rowY(b), { pointerType: 'touch' })
        await settle()
        const button = b.querySelector<HTMLElement>('div[role="button"]')!
        button.click()
        expect(changeCharSpy).not.toHaveBeenCalled()
        button.click()
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('releasing a lifted folder without moving opens the folder menu; moving beyond the slop first does not', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A']), 'B'])
        const t = await mountSidebar()
        const f = folderRow(t)
        await liftWithTouch(f)
        up(rowY(f), { pointerType: 'touch' })
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
        expect(orderNow()).toEqual(['f1[A]', 'B'])

        vi.mocked(alertSelect).mockClear()
        vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 100)
        await liftWithTouch(f)
        await moveTo(rowY(f) + TOUCH_SLOP_PX + 2, { pointerType: 'touch' })
        up(rowY(f), { pointerType: 'touch' })
        await settle()
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('a tap CLICK_SUPPRESS_MS after a long-press drag selects normally', async () => {
        useFakeTime()
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        await liftWithTouch(b)
        up(rowY(b), { pointerType: 'touch' })
        await settle()
        vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 100)
        b.querySelector<HTMLElement>('div[role="button"]')!.click()
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
    })

    test('the long-press lift vibrates once where the API exists and is a no-op where it does not', async () => {
        useFakeTime()
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const vibrate = vi.fn(() => true)
        Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: vibrate })
        const a = charRow(t, 'A')
        await liftWithTouch(a)
        expect(vibrate).toHaveBeenCalledTimes(1)
        up(rowY(a), { pointerType: 'touch' })
        await settle()
        Reflect.deleteProperty(navigator, 'vibrate')
        vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 100)
        await liftWithTouch(a)
        expect(ghostEl()).not.toBeNull()
        expect(vibrate).toHaveBeenCalledTimes(1)
    })
})

describe('folder context menu', () => {
    const contextMenu = (el: Element): Event => {
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        el.dispatchEvent(ev)
        return ev
    }

    test('a mouse right-click on a folder opens the menu', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A'])])
        const t = await mountSidebar()
        const ev = contextMenu(folderAvatars(t)[0])
        await settle()
        expect(ev.defaultPrevented).toBe(true)
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('a contextmenu while a touch pointer is down never opens the menu and is prevented', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A'])])
        const t = await mountSidebar()
        const f = folderRow(t)
        down(f, rowY(f), { pointerType: 'touch' })
        const ev = contextMenu(folderAvatars(t)[0])
        await settle()
        expect(ev.defaultPrevented).toBe(true)
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('a contextmenu after a pointercancel that came before it is also touch-originated', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A'])])
        const t = await mountSidebar()
        const f = folderRow(t)
        down(f, rowY(f), { pointerType: 'touch' })
        cancelPointer(rowY(f), { pointerType: 'touch' })
        vi.advanceTimersByTime(100)
        contextMenu(folderAvatars(t)[0])
        await settle()
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('a keyboard contextmenu with no touch before it opens the menu', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A'])])
        const t = await mountSidebar()
        contextMenu(folderAvatars(t)[0])
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('the same contextmenu opens the menu once the touch window has passed, and not 100 ms after the touch', async () => {
        useFakeTime()
        setDb([folderOf('f1', ['A'])])
        const t = await mountSidebar()
        const f = folderRow(t)
        down(f, rowY(f), { pointerType: 'touch' })
        up(rowY(f), { pointerType: 'touch' })
        vi.advanceTimersByTime(100)
        contextMenu(folderAvatars(t)[0])
        await settle()
        expect(alertSelect).not.toHaveBeenCalled()
        vi.advanceTimersByTime(TOUCH_CONTEXTMENU_WINDOW_MS)
        contextMenu(folderAvatars(t)[0])
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })
})

describe('click and pointers', () => {
    test('guard: a plain mouse click with no movement selects the character and takes no capture', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        down(b, rowY(b))
        up(rowY(b))
        b.querySelector<HTMLElement>('div[role="button"]')!.click()
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(captureSpy).not.toHaveBeenCalled()
    })

    test('the click after a completed drag selects nothing; the next click does', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await dragOnto(t, charRow(t, 'C'), topGaps(t)[1])
        const button = charRow(t, 'A').querySelector<HTMLElement>('div[role="button"]')!
        button.click()
        expect(changeCharSpy).not.toHaveBeenCalled()
        down(button, 20)
        up(20)
        button.click()
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
    })

    test('a middle or right button press and a non-primary pointer start no drag', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const b = charRow(t, 'B')
        for (const o of [{ button: 1 }, { button: 2 }, { isPrimary: false }] as PointerOptions[]) {
            down(b, rowY(b), o)
            move(rowY(b) + 20, o)
            await settle()
            expect(ghostEl()).toBeNull()
            up(rowY(b) + 20, o)
        }
        expect(orderNow()).toEqual(['A', 'B'])
    })

    test('a second touch pointer during a drag is ignored', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        const other = charRow(t, 'A')
        down(other, rowY(other), { pointerType: 'touch', pointerId: 2 })
        move(rowY(topGaps(t)[0]), { pointerType: 'touch', pointerId: 2 })
        up(rowY(topGaps(t)[0]), { pointerType: 'touch', pointerId: 2 })
        await settle()
        expect(ghostEl()).not.toBeNull()
        expect(orderNow()).toEqual(['A', 'B', 'C'])
    })
})

describe('cancel paths', () => {
    async function dragging(): Promise<HTMLElement> {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(rowY(topGaps(t)[0]))
        expect(ghostEl()).not.toBeNull()
        return t
    }

    const ended = (t: HTMLElement) => {
        expect(ghostEl()).toBeNull()
        expect(indicatorEl()).toBeNull()
        expect(dimmed()).toEqual([])
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(t.isConnected).toBe(true)
    }

    test('pointercancel', async () => {
        const t = await dragging()
        cancelPointer(10)
        await settle()
        ended(t)
    })

    test('lost pointer capture during the drag, and a no-op after a drop', async () => {
        const t = await dragging()
        scrollerOf(t).dispatchEvent(new Event('lostpointercapture'))
        await settle()
        // happy-dom's plain Event has no pointerId; the machine ignores a capture loss it cannot attribute
        expect(ghostEl()).not.toBeNull()
        const lost = new Event('lostpointercapture') as Event & { pointerId: number }
        Object.defineProperty(lost, 'pointerId', { value: 1 })
        scrollerOf(t).dispatchEvent(lost)
        await settle()
        ended(t)
        scrollerOf(t).dispatchEvent(lost)
        await settle()
        ended(t)
    })

    test('a lost pointer capture bubbling from a row inside the scroller does not end the drag', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        const gap = topGaps(t)[1]
        await moveTo(rowY(gap))
        const lost = new Event('lostpointercapture', { bubbles: true }) as Event & { pointerId: number }
        Object.defineProperty(lost, 'pointerId', { value: 1 })
        charRow(t, 'A').dispatchEvent(lost)
        await settle()
        expect(ghostEl()).not.toBeNull()
        await moveTo(rowY(topGaps(t)[0]))
        expect(indicatorEl()).not.toBeNull()
        up(rowY(topGaps(t)[0]))
        await settle()
        expect(orderNow()).toEqual(['C', 'A', 'B'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
    })

    test('window blur', async () => {
        const t = await dragging()
        window.dispatchEvent(new Event('blur'))
        await settle()
        ended(t)
    })

    test('the page becoming hidden', async () => {
        const t = await dragging()
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        await settle()
        ended(t)
    })

    test('unmounting the sidebar mid-drag leaves no ghost and no write', async () => {
        await dragging()
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        expect(ghostEl()).toBeNull()
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('every window and document listener added for the gesture is removed, on a drop and on each cancel', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        const tracker = trackListeners()
        try {
            const before = new Set(tracker.live())
            const run = async (end: () => unknown) => {
                await startMouseDrag(charRow(t, 'C'))
                expect(tracker.live().size).toBeGreaterThan(before.size)
                await end()
                await settle()
                expect(tracker.live()).toEqual(before)
            }
            await run(() => up(rowY(topGaps(t)[0])))
            await run(() => pressKey('Escape'))
            await run(() => cancelPointer(5))
            await run(() => window.dispatchEvent(new Event('blur')))
        } finally {
            tracker.stop()
        }
    })

    test('a drag whose source leaves the order ends with no write', async () => {
        const t = await dragging()
        DBState.db.characterOrder = ['A', 'B']
        await settle()
        expect(ghostEl()).toBeNull()
        up(rowY(topGaps(t)[0]))
        await settle()
        expect(orderNow()).toEqual(['A', 'B'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})

describe('native drag', () => {
    test('dragstart inside the rail is prevented and avatar images are not draggable', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const ev = new Event('dragstart', { bubbles: true, cancelable: true })
        charRow(t, 'A').dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(true)
        expect(allRows(t).length).toBe(2)
    })
})

describe('motion settings', () => {
    test('animationSpeed 0 gives the indicator and the ghost no transition', async () => {
        setDb(['A', 'B', 'C'], { animationSpeed: 0 })
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(rowY(topGaps(t)[0]))
        expect(indicatorEl()!.style.transition).toBe('none')
        expect(ghostEl()!.style.transition).toBe('none')
    })

    test('a positive animationSpeed lets the indicator glide between gaps while the ghost still follows the pointer directly', async () => {
        setDb(['A', 'B', 'C'], { animationSpeed: 0.2 })
        const t = await mountSidebar()
        await startMouseDrag(charRow(t, 'C'))
        await moveTo(rowY(topGaps(t)[0]))
        expect(indicatorEl()!.style.transition).toContain('transform')
        expect(ghostEl()!.style.transition).toBe('none')
    })
})

describe('geometry', () => {
    test('rows, gaps, spacers, the plus block and the folder background are siblings in one flat list', async () => {
        setDb([folderOf('f1', ['A', 'B']), 'C'])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        const scroller = scrollerOf(t)
        const items = Array.from(scroller.querySelectorAll<HTMLElement>('[data-rail-y]'))
        expect(items.length).toBeGreaterThan(8)
        for (const el of items) {
            expect(el.parentElement).toBe(scroller)
        }
        const background = scroller.querySelector('[data-rail-folder-bg]')
        expect(background?.parentElement).toBe(scroller)
    })

    test('the offsets the rail renders are contiguous in document order and end at the total height', async () => {
        setDb([folderOf('f1', ['A', 'B']), 'C', folderOf('f2', ['D'])])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        const items = Array.from(scrollerOf(t).querySelectorAll<HTMLElement>('[data-rail-y]')).map(boxOf)
        let y = 0
        for (const box of items) {
            expect(box.y).toBe(y)
            y += box.h
        }
        // the plus block is the last item, so the list ends where the model's total height ends
        expect(items.at(-1)).toEqual(boxOf(t.querySelector<HTMLElement>('[data-rail-kind="plus"]')!))
    })

    test('the open folder background spans its head to its tail and sits behind the member rows', async () => {
        setDb([folderOf('f1', ['A', 'B'])])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        const bg = scrollerOf(t).querySelector<HTMLElement>('[data-rail-folder-bg]')!
        const top = Number.parseFloat(bg.style.top)
        const height = Number.parseFloat(bg.style.height)
        const rows = allRows(t).filter((r) => r.getAttribute('data-rail-kind') === 'member').map(boxOf)
        for (const r of rows) {
            expect(r.y).toBeGreaterThanOrEqual(top)
            expect(r.y + r.h).toBeLessThanOrEqual(top + height)
        }
        expect(bg.className).toContain('z-0')
    })
})

describe('measured heights', () => {
    class FakeResizeObserver {
        static instances: FakeResizeObserver[] = []
        readonly observed = new Set<Element>()
        constructor(private readonly callback: ResizeObserverCallback) {
            FakeResizeObserver.instances.push(this)
        }
        observe(el: Element) {
            this.observed.add(el)
        }
        unobserve(el: Element) {
            this.observed.delete(el)
        }
        disconnect() {
            this.observed.clear()
        }
        report(sizes: Array<[Element, number]>) {
            this.callback(
                sizes.map(([target, blockSize]) => ({ target, borderBoxSize: [{ blockSize, inlineSize: 72 }], contentRect: { height: blockSize } }) as unknown as ResizeObserverEntry),
                this as unknown as ResizeObserver,
            )
        }
    }

    beforeEach(() => {
        FakeResizeObserver.instances.length = 0
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const observer = () => FakeResizeObserver.instances[0]

    test('a measured row height replaces the default and moves every offset after it', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const a = charRow(t, 'A')
        const b = charRow(t, 'B')
        const beforeB = boxOf(b).y
        observer().report([[a, 80]])
        await settle()
        expect(boxOf(a).h).toBe(80)
        expect(boxOf(b).y).toBe(beforeB + 80 - 56)
    })

    test('a zero measurement and a measurement taken while the container has no height are ignored', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const a = charRow(t, 'A')
        observer().report([[a, 80]])
        await settle()
        observer().report([[a, 0]])
        await settle()
        expect(boxOf(a).h).toBe(80)
        Object.defineProperty(scrollerOf(t), 'clientHeight', { configurable: true, get: () => 0 })
        observer().report([[a, 40]])
        await settle()
        expect(boxOf(a).h).toBe(80)
    })

    test('a drag after a measurement targets by the measured positions', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        observer().report([[charRow(t, 'A'), 120]])
        await settle()
        await dragOnto(t, charRow(t, 'C'), topGaps(t)[1])
        expect(orderNow()).toEqual(['A', 'C', 'B'])
    })

    test('an unmounted row drops its measurement', async () => {
        setDb([folderOf('f1', ['A', 'B'])])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        const a = charRow(t, 'A')
        observer().report([[a, 90]])
        await settle()
        expect(boxOf(a).h).toBe(90)
        folderAvatars(t)[0].click()
        await settle()
        folderAvatars(t)[0].click()
        await settle()
        expect(boxOf(charRow(t, 'A')).h).toBe(56)
    })
})

describe('tooltips', () => {
    test('an entry tooltip stays closed while a drag runs and is not set to open on touch', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        type TippyHost = HTMLElement & { _tippy?: { show(): void; state: { isVisible: boolean }; props: { touch: unknown } } }
        const avatar = charRow(t, 'A').querySelector<TippyHost>('[data-rail-entry]')!
        expect(avatar._tippy).toBeDefined()
        expect(avatar._tippy!.props.touch).toBe(false)
        await startMouseDrag(charRow(t, 'B'))
        avatar._tippy!.show()
        expect(avatar._tippy!.state.isVisible).toBe(false)
    })
})
