// @vitest-environment happy-dom

/**
 * A character moved in the sidebar keeps its avatar state with its row: dragging a
 * character from far down the list to the top shows its avatar without any scroll, because
 * the row moves as a unit and the observer reports it entering the viewport.
 *
 * Mounts the REAL `Sidebar.svelte`. The `IntersectionObserver` is a fake that decides
 * intersection by DOM position: after each flush the test calls `report(k)`, and every
 * observed element among the first `k` in document order is reported as intersecting, once
 * per change, exactly as a browser reports a node that moves into view. The far band never
 * releases, so only the near band decides what resolves.
 *
 * MOCKED: storage, platform, `checkCharOrder`, `getFileSrc` (a counting spy), the avatar
 * thumbnail lookup (always "no thumbnail"), `changeChar`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

const { getFileSrcSpy } = vi.hoisted(() => ({
    getFileSrcSpy: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
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
            getFileSrc: getFileSrcSpy,
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
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

//#region position-based fake IntersectionObserver

const NEAR = '100% 0px'

class PositionalIntersectionObserver implements Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect' | 'takeRecords'> {
    static instances: PositionalIntersectionObserver[] = []

    readonly rootMargin: string
    readonly observed = new Set<Element>()
    private readonly reported = new Map<Element, boolean>()

    constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.rootMargin = options?.rootMargin ?? '0px'
        PositionalIntersectionObserver.instances.push(this)
    }

    observe(target: Element): void {
        this.observed.add(target)
    }

    unobserve(target: Element): void {
        this.observed.delete(target)
        this.reported.delete(target)
    }

    disconnect(): void {
        this.observed.clear()
        this.reported.clear()
    }

    takeRecords(): IntersectionObserverEntry[] {
        return []
    }

    /** Reports every observed element whose intersection state changed since the last report. */
    report(windowSize: number): void {
        const ordered = Array.from(this.observed).sort((a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        )
        const changed: IntersectionObserverEntry[] = []
        ordered.forEach((el, position) => {
            const isIntersecting = this.rootMargin === NEAR ? position < windowSize : true
            if (this.reported.get(el) !== isIntersecting) {
                this.reported.set(el, isIntersecting)
                changed.push({ target: el, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry)
            }
        })
        if (changed.length > 0) {
            this.callback(changed, this as unknown as IntersectionObserver)
        }
    }
}

function report(windowSize: number): void {
    for (const inst of PositionalIntersectionObserver.instances) {
        inst.report(windowSize)
    }
}

//#endregion

const N = 8
const WINDOW = 3

function setDb(): void {
    const characters = Array.from({ length: N }, (_, i) => ({
        chaId: `c${i}`,
        name: `Char ${i}`,
        image: `assets/c${i}.png`,
        type: 'character',
        chats: [],
        chatPage: 0,
    }))
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
    }
}

/** One browser frame: flush, let the observer report positions, flush the reaction. */
async function frame(): Promise<void> {
    await settle()
    report(WINDOW)
    await settle()
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', PositionalIntersectionObserver)
})

afterAll(() => {
    vi.unstubAllGlobals()
})

beforeEach(() => {
    PositionalIntersectionObserver.instances.length = 0
    getFileSrcSpy.mockClear()
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
})

interface FakeDataTransfer {
    types: string[]
    setData(type: string): void
    setDragImage(): void
    dropEffect: string
}

function fire(el: Element, type: string, dataTransfer: FakeDataTransfer): void {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    el.dispatchEvent(ev)
}

const rowOf = (t: HTMLElement, id: string): HTMLElement => t.querySelector(`[data-char-id="${id}"]`)!.closest<HTMLElement>('div[draggable="true"]')!
const topGaps = (t: HTMLElement): HTMLElement[] =>
    Array.from(t.querySelectorAll<HTMLElement>('div.h-4.min-h-4.w-14')).filter((g) => !g.classList.contains('relative'))
const avatarSrc = (t: HTMLElement, id: string): string | null =>
    t.querySelector(`[data-char-id="${id}"] img.sidebar-avatar`)?.getAttribute('src') ?? null

async function mountSidebar(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await frame()
    return target
}

async function dragTo(src: HTMLElement, dst: HTMLElement): Promise<void> {
    const dt: FakeDataTransfer = {
        types: [],
        setData(type: string) {
            if (!this.types.includes(type)) {
                this.types.push(type)
            }
        },
        setDragImage() {},
        dropEffect: 'none',
    }
    fire(src, 'dragstart', dt)
    await settle()
    fire(dst, 'drop', dt)
    await frame()
}

describe('avatar state moves with the row', () => {
    test('guard: only the rows the observer reported as near resolve their avatar', async () => {
        setDb()
        const t = await mountSidebar()
        expect(avatarSrc(t, 'c0')).toBe('data:mock-image;loc=assets/c0.png')
        expect(avatarSrc(t, 'c2')).toBe('data:mock-image;loc=assets/c2.png')
        expect(avatarSrc(t, 'c3')).toBeNull()
        expect(avatarSrc(t, 'c7')).toBeNull()
    })

    test('regression reproducer: a character moved from far down to the top shows its avatar without a scroll', async () => {
        setDb()
        const t = await mountSidebar()
        expect(avatarSrc(t, 'c7')).toBeNull()

        await dragTo(rowOf(t, 'c7'), topGaps(t)[0])

        const rows = Array.from(t.querySelectorAll('[data-char-id]')).map((e) => e.getAttribute('data-char-id'))
        expect(rows.slice(0, 3)).toEqual(['c7', 'c0', 'c1'])
        expect(avatarSrc(t, 'c7')).toBe('data:mock-image;loc=assets/c7.png')
        expect(avatarSrc(t, 'c0')).toBe('data:mock-image;loc=assets/c0.png')
    })

    test('guard: a character that stays out of view stays unresolved after another row moves', async () => {
        setDb()
        const t = await mountSidebar()
        await dragTo(rowOf(t, 'c7'), topGaps(t)[0])
        expect(avatarSrc(t, 'c6')).toBeNull()
        expect(avatarSrc(t, 'c5')).toBeNull()
    })

    test('guard: a folder row near the viewport loads its background image', async () => {
        setDb()
        const db = DBState.db as unknown as { characterOrder: Array<string | { id: string; name: string; color: string; data: string[]; imgFile?: string }> }
        db.characterOrder = [{ id: 'f1', name: 'Folder', color: '', data: ['c0'], imgFile: 'assets/folder.png' }, 'c1', 'c2']
        const t = await mountSidebar()
        const folderAvatar = Array.from(t.querySelectorAll<HTMLElement>('span.avatar')).find((a) => !a.hasAttribute('data-char-id'))!
        const bg = folderAvatar.querySelector<HTMLElement>('.sidebar-avatar')!
        expect(bg.style.backgroundImage).toContain('data:mock-image;loc=assets/folder.png')
    })})
