// @vitest-environment happy-dom

/**
 * Sidebar drag and drop behaviours, asserted through the REAL `Sidebar.svelte`.
 *
 * Every test body here drives the sidebar through `dragOnto` and DOM lookups, and asserts
 * the drop's result or the DOM. Tests whose title starts with `regression reproducer:` pin
 * a defect fix; `guard:` tests pin behaviour that must be preserved.
 *
 * MOCKED: `checkCharOrder` (a spy), `saveAsset`, `changeChar`, the avatar thumbnail lookup
 * (always "no thumbnail"), and the storage and platform modules.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, afterAll, beforeAll, beforeEach } from 'vitest'
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

const { checkCharOrderSpy } = vi.hoisted(() => ({ checkCharOrderSpy: vi.fn() }))

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
    changeChar: vi.fn(),
}))

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => ({
    ...(await importOriginal()),
    getAvatarThumbSrc: vi.fn(async () => null),
}))

import { DBState } from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'
import { MERGE_DWELL_MS } from './railConstants'
import { charRow, defaultSettle as settle, dragOnto, fireNative, folderAvatars, folderRow, installGeometry, topGaps, type DragOptions, resetRailMemory } from './sidebarDnd.testKit'

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const LETTERS = ['A', 'B', 'C', 'D']

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
        characters: LETTERS.map((chaId) => ({ chaId, name: chaId, image: `assets/${chaId}.png`, type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

async function mountSidebar(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
    }
    installGeometry(target)
    return target
}

// Without an observer every avatar resolves at once, so the rendered images can be inspected.
beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
})

afterAll(() => {
    vi.unstubAllGlobals()
})

beforeEach(() => {
    resetRailMemory()
    checkCharOrderSpy.mockClear()
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    document.body.innerHTML = ''
})

const dragTo = (src: HTMLElement, dst: HTMLElement, opts: DragOptions = {}) => dragOnto(mounted!.target, src, dst, { settle, ...opts })

const orderNow = (): string[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).map((e) => (typeof e === 'string' ? e : `F[${e.data.join(',')}]`))

describe('releasing on a character without resting', () => {
    test('regression reproducer: a release at a character centre without a pause makes no folder', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await dragTo(charRow(t, 'C'), charRow(t, 'A'))
        expect(orderNow().some((e) => e.startsWith('F['))).toBe(false)
        expect(orderNow()).toEqual(['A', 'C', 'B'])
    })

    test('guard: a release after resting on the character makes a folder of the two', async () => {
        setDb(['A', 'B', 'C'])
        const t = await mountSidebar()
        await dragTo(charRow(t, 'C'), charRow(t, 'A'), { holdMs: MERGE_DWELL_MS + 50 })
        expect(orderNow()).toEqual(['F[C,A]', 'B'])
    })
})

describe('a folder member released on its own folder', () => {
    test('regression reproducer: a member released on its own open folder row is not moved to the end', async () => {
        setDb([{ id: 'f1', name: 'F', color: '', data: ['A', 'B'] }, 'C'])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        await dragTo(charRow(t, 'A'), folderRow(t))
        expect(orderNow()).toEqual(['F[A,B]', 'C'])
    })

    test('guard: a member released on a gap of another place still moves there', async () => {
        setDb([{ id: 'f1', name: 'F', color: '', data: ['A', 'B'] }, 'C'])
        const t = await mountSidebar()
        folderAvatars(t)[0].click()
        await settle()
        await dragTo(charRow(t, 'A'), topGaps(t)[2])
        expect(orderNow()).toEqual(['F[B]', 'C', 'A'])
    })
})

describe('native drag of the rail', () => {
    test('regression reproducer: dragstart on a rail row is prevented', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const ev = fireNative(charRow(t, 'A'), 'dragstart', { types: [], setData() {}, setDragImage() {}, dropEffect: 'none' } as unknown as { types: string[] })
        expect(ev.defaultPrevented).toBe(true)
    })

    test('regression reproducer: avatar images are not draggable', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        const images = Array.from(t.querySelectorAll('img.sidebar-avatar'))
        expect(images.length).toBeGreaterThan(0)
        for (const img of images) {
            expect(img.getAttribute('draggable')).toBe('false')
        }
    })

    test('guard: an OS file dragover on a row is not prevented by the rail', async () => {
        setDb(['A', 'B'])
        const t = await mountSidebar()
        for (const type of ['dragover', 'dragenter', 'drop']) {
            expect(fireNative(charRow(t, 'A'), type, { types: ['Files'] }).defaultPrevented).toBe(false)
        }
    })
})
