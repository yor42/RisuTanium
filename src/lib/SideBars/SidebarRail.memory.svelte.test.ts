// @vitest-environment happy-dom

/**
 * What the character rail remembers on this device, driven through the REAL `Sidebar.svelte`
 * (and so the real `SidebarRail.svelte`) with the kit's fake geometry (`sidebarDnd.testKit.ts`):
 * the folders that are open and one scroll position, kept in `localStorage` and never in the
 * database. A remount stands for a round trip through Settings or the grid, which unmounts the
 * whole sidebar.
 *
 * The kit's container clamps writes to the scrollable range and reports 0 once detached, as a
 * browser does, so a restore beyond the range clamps and a read at teardown would save 0.
 *
 * MOCKED: `checkCharOrder` (a spy), `changeChar`, the chat list, `alertSelect` / `alertInput`
 * and the storage and platform modules.
 *
 * Test labels: `(R)` fails against the rail before this change; `(G)` is proven by a named
 * mutant of the rail that it fails against.
 */
import { mount, tick, unmount } from 'svelte'
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

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

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
import Sidebar from './Sidebar.svelte'
import { DEFAULT_HEIGHTS } from './railConstants'
import { charKey } from './railTestKit'
import { OPEN_FOLDERS_KEY, RAIL_SCROLL_KEY } from './railMemory'
import {
    boxOf,
    charRow,
    defaultSettle,
    folderAvatars,
    installGeometry,
    realWait,
    resetRailMemory,
    scrollerOf,
    settleFrame,
    type Geometry,
} from './sidebarDnd.testKit'

//#region fixture and helpers

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })
const ids = (count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => `c${from + i}`)

/** One default character row plus the gap after it. */
const ROW_PITCH = DEFAULT_HEIGHTS.char + DEFAULT_HEIGHTS.gap
/** The first gap lies above the first row. */
const rowTop = (index: number): number => DEFAULT_HEIGHTS.gap + index * ROW_PITCH
const VIEWPORT = 600

function characterIds(order: OrderFixture): string[] {
    return order.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.data))
}

function setDb(order: OrderFixture): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: characterIds(order).map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
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

/** Mounts the sidebar; `height: null` leaves the container unlaid-out, as a hidden one is. */
async function mountRail(order: OrderFixture | null, height: number | null = VIEWPORT): Promise<HTMLElement> {
    if (order) {
        setDb(order)
    }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    root = target
    if (height !== null) {
        geo = installGeometry(target, height)!
        await settleFrame()
        await settle()
    }
    return target
}

async function unmountRail(): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
}

beforeEach(() => {
    resetRailMemory()
    FakeResizeObserver.instances.length = 0
    checkCharOrderSpy.mockClear()
    selectedCharID.set(-1)
})

afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    removeLayoutStub()
    try {
        await unmountRail()
    } catch {
        // a sidebar that failed half way through mounting is torn down best effort
    }
    document.body.innerHTML = ''
})

const memberRows = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-kind="member"]'))
const savedFolders = (): unknown => JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? 'null')
const savedScroll = (): unknown => JSON.parse(localStorage.getItem(RAIL_SCROLL_KEY) ?? 'null')
const seedScroll = (key: string, offset: number, px: number): void => localStorage.setItem(RAIL_SCROLL_KEY, JSON.stringify({ key, offset, px }))
const railTotal = (): number => Number(scrollerOf(root).getAttribute('data-rail-total'))

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

const observer = (): FakeResizeObserver => FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]

/**
 * A prototype stub that gives every rail scroll container a positive height and a clamping
 * scroll position from the first moment it exists, as a visible browser container has at
 * mount. A timing stand-in, not native evidence.
 */
const stubbedProps = ['clientHeight', 'scrollHeight', 'scrollTop'] as const
const layoutStubOwners: Array<{ owner: object; name: string; original: PropertyDescriptor | undefined }> = []

function installLayoutStub(): void {
    const tops = new WeakMap<Element, number>()
    for (const name of stubbedProps) {
        let owner: object | null = HTMLElement.prototype
        while (owner && !Object.getOwnPropertyDescriptor(owner, name)) {
            owner = Object.getPrototypeOf(owner)
        }
        if (!owner) {
            throw new Error(`no ${name} on the element prototype`)
        }
        const original = Object.getOwnPropertyDescriptor(owner, name)
        layoutStubOwners.push({ owner, name, original })
        const isRail = (el: Element): boolean => el.matches('[data-rail-scroll]')
        const max = (el: Element): number => Math.max(0, Math.max(Number(el.getAttribute('data-rail-total') ?? 0), VIEWPORT) - VIEWPORT)
        Object.defineProperty(owner, name, {
            configurable: true,
            get(this: Element) {
                if (!isRail(this)) {
                    return original?.get?.call(this)
                }
                if (name === 'clientHeight') {
                    return VIEWPORT
                }
                if (name === 'scrollHeight') {
                    return Math.max(Number(this.getAttribute('data-rail-total') ?? 0), VIEWPORT)
                }
                return tops.get(this) ?? 0
            },
            set(this: Element, value: number) {
                if (name === 'scrollTop' && isRail(this)) {
                    tops.set(this, Math.max(0, Math.min(value, max(this))))
                    return
                }
                original?.set?.call(this, value)
            },
        })
    }
}

function removeLayoutStub(): void {
    for (const { owner, name, original } of layoutStubOwners.splice(0)) {
        if (original) {
            Object.defineProperty(owner, name, original)
        } else {
            delete (owner as Record<string, unknown>)[name]
        }
    }
}

//#endregion

describe('remembered open folders', () => {
    test('(R) a remembered folder is open on the first render, and an id that names no folder opens nothing', async () => {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(['F', 'gone']))
        await mountRail([folderOf('F', ['m0', 'm1']), folderOf('G', ['m2']), ...ids(3)])

        expect(memberRows().map((el) => el.getAttribute('data-char-id') ?? el.querySelector('[data-char-id]')?.getAttribute('data-char-id'))).toEqual(['m0', 'm1'])
        expect(savedFolders()).toEqual(['F'])
    })

    test('(R) opening and closing a folder writes the open set', async () => {
        await mountRail([folderOf('F', ['m0', 'm1']), ...ids(3)])
        expect(memberRows()).toHaveLength(0)

        folderAvatars(root)[0].click()
        await settle()
        expect(memberRows()).toHaveLength(2)
        expect(savedFolders()).toEqual(['F'])

        folderAvatars(root)[0].click()
        await settle()
        expect(savedFolders()).toEqual([])
    })

    test('(R) open folders and the scroll position survive an unmount and remount, the way a Settings round trip does', async () => {
        const order = [folderOf('F', ['m0', 'm1']), ...ids(200)]
        await mountRail(order)
        folderAvatars(root)[0].click()
        await settle()
        const openTotal = railTotal()
        await geo.scrollAndSettle(3000)
        expect(geo.scrollTop).toBe(3000)

        await unmountRail()
        await mountRail(order)

        // Scrolled to 3000 the folder's rows are out of the window: its open state shows in the total.
        expect(railTotal()).toBe(openTotal)
        expect(geo.scrollTop).toBe(3000)
    })

    test('(G) stale ids never open another folder and a corrupt value is ignored', async () => {
        localStorage.setItem(OPEN_FOLDERS_KEY, '{not json')
        await mountRail([folderOf('F', ['m0']), ...ids(2)])
        expect(memberRows()).toHaveLength(0)
    })
})

describe('remembered scroll position', () => {
    describe('with a ResizeObserver that reports on demand', () => {
        beforeEach(() => {
            vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        })

        test('(G) the position is restored by row and offset, so it lands on the same row when the real row heights differ from the defaults', async () => {
            const order = ids(200)
            await mountRail(order)
            const measured: Array<[Element, number]> = Array.from({ length: 12 }, (_, i) => [charRow(root, `c${i}`), 70])
            observer().report(measured)
            await settle()
            const target = boxOf(charRow(root, 'c5')).y + 20
            await geo.scrollAndSettle(target)
            await unmountRail()

            // The remounted rail has measured nothing yet: its offsets are the defaults.
            FakeResizeObserver.instances.length = 0
            await mountRail(order)
            await settle()

            expect(geo.scrollTop - boxOf(charRow(root, 'c5')).y).toBe(20)
            expect(geo.scrollTop).not.toBe(target)
        })

        test('(G) a rail mounted hidden restores when it is shown, and nothing is written while it is hidden', async () => {
            seedScroll(charKey('c100'), 5, 0)
            await mountRail(ids(200), null)
            geo = installGeometry(root, VIEWPORT)!
            geo.hide()
            await settleFrame()
            await settle()
            expect(geo.scrollTop).toBe(0)
            expect(savedScroll()).toEqual({ key: charKey('c100'), offset: 5, px: 0 })

            geo.show()
            observer().report([[scrollerOf(root), VIEWPORT]])
            await settleFrame()
            await settle()
            expect(geo.scrollTop).toBe(rowTop(100) + 5)
        })

        test('(G) hiding and showing the rail saves nothing from the hidden container', async () => {
            await mountRail(ids(200))
            await geo.scrollAndSettle(rowTop(50))
            await realWait(300)
            const before = savedScroll()
            expect(before).not.toBeNull()

            geo.hide()
            observer().report([[scrollerOf(root), 0]])
            scrollerOf(root).dispatchEvent(new Event('scroll'))
            await settleFrame()
            await realWait(300)
            expect(savedScroll()).toEqual(before)

            geo.show()
            observer().report([[scrollerOf(root), VIEWPORT]])
            await settleFrame()
            await realWait(300)
            expect(savedScroll()).toEqual(before)
        })
    })

    test('(G) a position beyond the scrollable range clamps once, with no retry', async () => {
        seedScroll('no-such-key', 0, 1_000_000)
        await mountRail(ids(200), null)
        geo = installGeometry(root, VIEWPORT)!
        const el = scrollerOf(root)
        const original = Object.getOwnPropertyDescriptor(el, 'scrollTop')!
        let writes = 0
        Object.defineProperty(el, 'scrollTop', {
            configurable: true,
            get: original.get,
            set(value: number) {
                writes++
                original.set!.call(el, value)
            },
        })
        await settleFrame()
        await settle()
        await realWait(300)

        expect(geo.scrollTop).toBe(railTotal() - VIEWPORT)
        expect(writes).toBe(1)
    })

    test('(G) a container that is visible at mount restores to the saved row once the rows exist', async () => {
        installLayoutStub()
        seedScroll(charKey('c100'), 5, 3)
        await mountRail(ids(200), null)
        await settle()

        expect(scrollerOf(root).scrollTop).toBe(rowTop(100) + 5)
    })

    test('(R) with nothing saved, or a corrupt value, the first scroll is saved', async () => {
        for (const raw of [null, '{not json', '{"key":1}']) {
            resetRailMemory()
            if (raw !== null) {
                localStorage.setItem(RAIL_SCROLL_KEY, raw)
            }
            await mountRail(ids(200))
            await geo.scrollAndSettle(rowTop(40))
            await realWait(300)
            expect(savedScroll()).toMatchObject({ key: charKey('c40'), px: rowTop(40) })
            await unmountRail()
        }
    })

    test('(G) the container is never read at teardown: an unmount keeps the last position that was visible', async () => {
        await mountRail(ids(200))
        await geo.scrollAndSettle(rowTop(30))
        await unmountRail()

        expect(savedScroll()).toMatchObject({ key: charKey('c30'), px: rowTop(30) })
    })

    test('(G) a rail hidden for its whole mount writes nothing, and the remembered position survives it', async () => {
        seedScroll(charKey('c100'), 5, 0)
        await mountRail(ids(200), null)
        await unmountRail()

        expect(savedScroll()).toEqual({ key: charKey('c100'), offset: 5, px: 0 })
    })
})

describe('storage and the database', () => {
    test('(G) storage that is blocked leaves the rail working and remembers nothing', async () => {
        const blocked = (): never => {
            throw new Error('blocked')
        }
        vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked })
        await mountRail([folderOf('F', ['m0', 'm1']), ...ids(200)])

        folderAvatars(root)[0].click()
        await settle()
        expect(memberRows()).toHaveLength(2)
        await geo.scrollAndSettle(3000)
        await unmountRail()
        vi.unstubAllGlobals()

        expect(localStorage.getItem(OPEN_FOLDERS_KEY)).toBeNull()
        expect(localStorage.getItem(RAIL_SCROLL_KEY)).toBeNull()
    })

    test('(G) opening, closing and scrolling never change the database or ask for a save', async () => {
        await mountRail([folderOf('F', ['m0', 'm1']), ...ids(200)])
        const before = $state.snapshot(DBState.db)

        folderAvatars(root)[0].click()
        await settle()
        await geo.scrollAndSettle(3000)
        await realWait(300)

        expect($state.snapshot(DBState.db)).toEqual(before)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})
