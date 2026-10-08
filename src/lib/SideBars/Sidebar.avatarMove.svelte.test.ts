// @vitest-environment happy-dom

/**
 * A character moved in the sidebar keeps its avatar with its row: a character moved from far
 * down the list to the top shows its avatar without any scroll, because the rail mounts the
 * rows of the scroll window and a mounted row resolves its own avatar. A row outside the
 * window is not mounted at all and does no avatar work.
 *
 * Mounts the REAL `Sidebar.svelte` with a short fake viewport (`installGeometry`), so with
 * 40 characters the row of `c30` starts outside the window. The order is changed directly in
 * the database, the same write the keyboard move and a drop end in.
 *
 * MOCKED: storage, platform, `checkCharOrder`, `getFileSrc` (a counting spy), the avatar
 * thumbnail lookup (always "no thumbnail"), `changeChar`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { defaultSettle, installGeometry, scrollerOf, settleFrame, resetRailMemory } from './sidebarDnd.testKit'

const N = 40
/** Short enough that the row of `FAR` starts outside the window: viewport 300 plus 300 overscan reaches about row 12. */
const VIEWPORT = 300
const FAR = 'c30'

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

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

beforeEach(() => {
    resetRailMemory()
    getFileSrcSpy.mockClear()
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
})

const avatarSrc = (t: HTMLElement, id: string): string | null =>
    t.querySelector(`[data-char-id="${id}"] img.sidebar-avatar`)?.getAttribute('src') ?? null
const isMounted = (t: HTMLElement, id: string): boolean => t.querySelector(`[data-char-id="${id}"]`) !== null
const mountedIds = (t: HTMLElement): string[] => Array.from(t.querySelectorAll('[data-char-id]')).map((e) => e.getAttribute('data-char-id')!)

async function mountSidebar(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    installGeometry(target, VIEWPORT)
    await settleFrame()
    await defaultSettle()
    return target
}

/** Moves a character to the top of the list the way every order write ends: by assigning the order. */
async function moveToTop(id: string): Promise<void> {
    const order = DBState.db.characterOrder as string[]
    DBState.db.characterOrder = [id, ...order.filter((o) => o !== id)]
    await settleFrame()
    await settle()
}

describe('avatar state moves with the row', () => {
    test('guard: a row inside the window resolves its avatar and a row outside it is not mounted', async () => {
        setDb()
        const t = await mountSidebar()
        expect(avatarSrc(t, 'c0')).toBe('data:mock-image;loc=assets/c0.png')
        expect(avatarSrc(t, 'c2')).toBe('data:mock-image;loc=assets/c2.png')
        expect(isMounted(t, FAR)).toBe(false)
        expect(isMounted(t, 'c39')).toBe(false)
        expect(scrollerOf(t).querySelectorAll('[data-rail-entry]').length).toBeLessThan(N)
    })

    test('guard: a character moved from far down to the top shows its avatar without a scroll', async () => {
        setDb()
        const t = await mountSidebar()
        expect(isMounted(t, FAR)).toBe(false)

        await moveToTop(FAR)

        expect(mountedIds(t).slice(0, 3)).toEqual([FAR, 'c0', 'c1'])
        expect(avatarSrc(t, FAR)).toBe('data:mock-image;loc=assets/c30.png')
        expect(avatarSrc(t, 'c0')).toBe('data:mock-image;loc=assets/c0.png')
    })

    test('guard: a character that stays outside the window stays unmounted after another row moves', async () => {
        setDb()
        const t = await mountSidebar()
        getFileSrcSpy.mockClear()
        await moveToTop(FAR)
        expect(isMounted(t, 'c29')).toBe(false)
        expect(isMounted(t, 'c28')).toBe(false)
        const resolved = getFileSrcSpy.mock.calls.map((call) => call[0])
        expect(resolved).not.toContain('assets/c29.png')
        expect(resolved).not.toContain('assets/c28.png')
    })

    test('guard: a folder row inside the window loads its background image', async () => {
        setDb()
        const db = DBState.db as unknown as { characterOrder: Array<string | { id: string; name: string; color: string; data: string[]; imgFile?: string }> }
        db.characterOrder = [{ id: 'f1', name: 'Folder', color: '', data: ['c0'], imgFile: 'assets/folder.png' }, 'c1', 'c2']
        const t = await mountSidebar()
        const folderAvatar = Array.from(t.querySelectorAll<HTMLElement>('span.avatar')).find((a) => !a.hasAttribute('data-char-id'))!
        const bg = folderAvatar.querySelector<HTMLElement>('.sidebar-avatar')!
        expect(bg.style.backgroundImage).toContain('data:mock-image;loc=assets/folder.png')
    })
})