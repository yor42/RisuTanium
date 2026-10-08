/**
 * ELEMENT-COUNT MEASUREMENT (not a bug repro, not a fix) for the sidebar rail's windowing
 * (sidebar rework Stage 3, scenario 14).
 *
 * WHAT IT MEASURES: mounts the REAL `Sidebar.svelte` (and so the real `SidebarRail.svelte`)
 * with synthetic characters at 500, 1000 and 2000 entries, plus a 1000-entry variant with
 * open folders and one duplicated id, installs the kit's fixed rail geometry (scrollTop 0,
 * 600 px viewport) and counts, after the rail has settled:
 *   - `[data-rail-entry]` elements (the focusable rail entries),
 *   - every element under the rail's scroller,
 *   - live tooltip instances (created minus destroyed `tooltipRail` actions),
 *   - ResizeObserver targets and IntersectionObserver targets currently observed.
 *
 * READING THE RESULT: before windowing every count grows with the character count; after
 * windowing the counts at 500, 1000 and 2000 are equal. The numbers are element counts,
 * not timings, so they do not depend on the machine.
 *
 * MOCKED: storage, platform, `checkCharOrder`, `getFileSrc` (inert), the avatar thumbnail
 * lookup, `changeChar`. The two observers are counting fakes that never report; the tooltip
 * action is wrapped to count live instances and otherwise delegates to the real one.
 *
 * Run:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/sidebar-rail-count.svelte.harness.ts --reporter=verbose
 *
 * Read-only w.r.t. src/ -- it drives the real modules, it does not modify them.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../../src/ts/platform'

//#region module mocks (kept in this one file -- see Agents/Tools/README.md)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
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
    const { DBState } = await import('../../../src/ts/stores.svelte')
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

vi.mock(import('../../../src/ts/stores.svelte'), () => {
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
    } as unknown as typeof import('../../../src/ts/stores.svelte')
})

vi.mock(import('../../../src/ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: vi.fn(),
}))

vi.mock(import('../../../src/ts/media/avatarThumb'), async (importOriginal) => ({
    ...(await importOriginal()),
    getAvatarThumbSrc: vi.fn(async () => null),
}))

const tooltipLive = vi.hoisted(() => ({ created: 0, destroyed: 0 }))

vi.mock(import('../../../src/ts/gui/tooltip'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        tooltipRail: (node: HTMLElement, tip: string) => {
            tooltipLive.created++
            const action = original.tooltipRail(node, tip)
            return {
                update: action.update,
                destroy() {
                    tooltipLive.destroyed++
                    action.destroy()
                },
            }
        },
    }
})

//#endregion

//#region counting observers

class CountingObserver {
    static live = new Set<CountingObserver>()
    readonly observed = new Set<Element>()
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []

    constructor(_callback?: unknown, _options?: unknown) {
        CountingObserver.live.add(this)
    }

    observe(target: Element): void {
        this.observed.add(target)
    }

    unobserve(target: Element): void {
        this.observed.delete(target)
    }

    disconnect(): void {
        this.observed.clear()
        CountingObserver.live.delete(this)
    }

    takeRecords(): [] {
        return []
    }
}

class CountingResizeObserver extends CountingObserver {}
class CountingIntersectionObserver extends CountingObserver {}

function observedTotal(kind: typeof CountingResizeObserver | typeof CountingIntersectionObserver): number {
    let total = 0
    for (const inst of CountingObserver.live) {
        if (inst instanceof kind) {
            total += inst.observed.size
        }
    }
    return total
}

let previousRO: unknown
let previousIO: unknown

beforeAll(() => {
    previousRO = (globalThis as Record<string, unknown>).ResizeObserver
    previousIO = (globalThis as Record<string, unknown>).IntersectionObserver
    vi.stubGlobal('ResizeObserver', CountingResizeObserver)
    vi.stubGlobal('IntersectionObserver', CountingIntersectionObserver)
})

afterAll(() => {
    vi.unstubAllGlobals()
    void previousRO
    void previousIO
})

//#endregion

import { DBState } from '../../../src/ts/stores.svelte'
import Sidebar from '../../../src/lib/SideBars/Sidebar.svelte'
import { installGeometry } from '../../../src/lib/SideBars/sidebarDnd.testKit'

//#region fixture

type OrderEntry = string | { id: string; name: string; color: string; data: string[] }

const VIEWPORT_PX = 600
const FOLDER_COUNT = 10
const FOLDER_SIZE = 10

function buildDb(n: number, withFolders: boolean): Database {
    const characters = Array.from({ length: n }, (_, i) => ({
        chaId: `c${i}`,
        name: `Char ${i}`,
        image: `assets/c${i}.png`,
        type: 'character',
        chats: [],
        chatPage: 0,
    }))
    let characterOrder: OrderEntry[] = characters.map((c) => c.chaId)
    if (withFolders) {
        // The first FOLDER_COUNT * FOLDER_SIZE characters move into folders placed first in
        // the list; c0 additionally appears a second time at the top level (the duplicate id).
        const folders: OrderEntry[] = []
        for (let f = 0; f < FOLDER_COUNT; f++) {
            folders.push({
                id: `f${f}`,
                name: `Folder ${f}`,
                color: '',
                data: characters.slice(f * FOLDER_SIZE, (f + 1) * FOLDER_SIZE).map((c) => c.chaId),
            })
        }
        characterOrder = [...folders, 'c0', ...characters.slice(FOLDER_COUNT * FOLDER_SIZE).map((c) => c.chaId)]
    }
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder,
        characters,
        hideAllImages: false,
    } as unknown as Database
}

async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        flushSync()
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 25))
    }
}

interface CountRow {
    label: string
    entries: number
    scrollerElements: number
    tooltips: number
    resizeTargets: number
    intersectionTargets: number
}

const rows: CountRow[] = []

async function measure(label: string, n: number, withFolders: boolean): Promise<CountRow> {
    DBState.db = buildDb(n, withFolders)
    tooltipLive.created = 0
    tooltipLive.destroyed = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    await settle()
    const geo = installGeometry(target, VIEWPORT_PX)
    if (!geo) {
        throw new Error('no pointer rail in the mounted sidebar')
    }
    geo.scrollTo(0)
    await settle()
    if (withFolders) {
        // Open every folder that is reachable at scrollTop 0, one click at a time.
        for (let f = 0; f < FOLDER_COUNT; f++) {
            const folder = Array.from(target.querySelectorAll<HTMLElement>('[data-rail-entry][aria-expanded="false"]'))[0]
            if (!folder) {
                break
            }
            folder.click()
            await settle()
        }
    }
    const row: CountRow = {
        label,
        entries: target.querySelectorAll('[data-rail-entry]').length,
        scrollerElements: geo.el.querySelectorAll('*').length,
        tooltips: tooltipLive.created - tooltipLive.destroyed,
        resizeTargets: observedTotal(CountingResizeObserver),
        intersectionTargets: observedTotal(CountingIntersectionObserver),
    }
    rows.push(row)
    await unmount(app as never)
    target.remove()
    return row
}

//#endregion

describe('sidebar-rail-count: element counts of the mounted rail at fixed geometry', () => {
    test('500, 1000 and 2000 characters, plain list', async () => {
        for (const n of [500, 1000, 2000]) {
            await measure(`${n} plain`, n, false)
        }
    }, 300_000)

    test('1000 characters with open folders and a duplicate id, then print the table', async () => {
        await measure('1000 folders+dup', 1000, true)
        console.log('\n=== sidebar-rail-count (viewport 600 px, scrollTop 0) ===')
        console.table(rows)
        expect(rows.length).toBe(4)
    }, 300_000)
})
