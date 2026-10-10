// @vitest-environment happy-dom

/**
 * Regression tests: each listed character's avatar should be resolved (a
 * call to `getFileSrc` through `getCharImage`) ONCE, not re-resolved on every
 * re-render of an unrelated part of the list.
 *
 * This file mounts the REAL `GridCatalog.svelte` (and therefore the REAL
 * `MobileCharacters.svelte` and `BarIcon.svelte`) with Svelte's `mount()`
 * into happy-dom, drives it exactly like a user would (click the real
 * layout buttons, type into the real search input, mutate `DBState.db`
 * directly the way the rest of the app does), and counts calls to a spy
 * standing in for `getFileSrc`, scaled down to a suite-friendly N and reusing
 * one mount per layout (a fresh N=1000 mount per scenario risks a heap OOM;
 * N here is 60 non-trashed + 5 trashed, one mount per layout, reused across
 * every scenario for that layout).
 *
 * MOCKED, AND WHY (kept in this ONE file: harnesses that mock the app's rune
 * modules keep them in ONE file):
 *   - `localforage` -- IndexedDB backend; inert stub, never exercised here.
 *   - `src/ts/globalApi.svelte` -- `getFileSrc` is replaced with a COUNTING
 *     SPY (records every `loc` argument, resolves on the same microtask
 *     tick). Every other export is an inert no-op stub; none is called by
 *     these scenarios.
 *   - `src/ts/storage/database.svelte` -- `getDatabase()` returns the same
 *     `DBState.db` the tests set directly (Sidebar.svelte's own `$effect`
 *     calls it unconditionally via `getCharacterIndexObject()`; see the
 *     inline comment at that mock for detail). `presetTemplate` is a small
 *     stub, as in the harness.
 *   - `src/ts/platform` -- forces the plain-HTTP branch (`isTauri: false`).
 *   - `@tauri-apps/plugin-fs` -- stubbed; not exercised when `isTauri` is
 *     false.
 *   - `src/ts/stores.svelte` -- replaced with a thin, genuinely reactive
 *     (`$state`-backed) stand-in exposing every store this import graph
 *     reads, identical in shape to the harness's own mock.
 *   - `src/ts/characters` -- a PARTIAL mock: every export is the REAL one
 *     (via `importOriginal`), except `changeChar`, which is replaced with a
 *     plain `vi.fn()` spy so click-target tests can assert which index was
 *     passed, without the real `changeChar` mutating the fixture characters
 *     via `characterFormatUpdate` (default-field backfill) as a side effect
 *     of a click assertion that only cares about the index. `getCharImage`
 *     is left untouched and real.
 *   - `src/ts/media/avatarThumb` -- a PARTIAL mock (T12 only): every export
 *     is the REAL one (via `importOriginal`), except `getAvatarThumbSrc`,
 *     which is replaced with `avatarThumbSpy`, resolving `null` by default
 *     (see the inline comment at that mock for why).
 *
 * NOT mocked: `src/ts/characters`'s `getCharImage` (real), `src/ts/media/
 * avatarThumb`'s `isThumbEligible` (real), `src/lang`, `src/ts/util.ts`,
 * `GridCatalog.svelte`, `MobileCharacters.svelte`, `BarIcon.svelte`,
 * `TextInput.svelte`, `Button.svelte`, the lucide icon components, and
 * everything else `characters.ts` drags in transitively (a one-time ~13-17s
 * Vite transform cost; only the first test below pays it).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

//#region module mocks (kept in this one file -- see header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

// The counting spy IS the measurement instrument, same pattern as the
// harness. vi.mock factories are hoisted above ordinary top-level
// const/let, so the spy must live in vi.hoisted() to be visible to the
// factory below at the time it runs.
// `thumbOverride` backs the T12 avatarThumb spy below: keyed by `loc`, empty
// (every loc resolves `null`, i.e. "no thumbnail, fall back to getFileSrc")
// unless a T12 test sets an entry for the one loc it wants to render as a
// thumbnail.
const { getFileSrcSpy, changeCharSpy, avatarThumbSpy, thumbOverride } = vi.hoisted(() => {
    const thumbOverride: Record<string, string> = {}
    return {
        getFileSrcSpy: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        changeCharSpy: vi.fn(),
        thumbOverride,
        avatarThumbSpy: vi.fn(async (loc: string) => thumbOverride[loc] ?? null),
    }
})

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
            // AlertComp.svelte's own direct needs (its selectChar branch
            // never calls these, but the named imports must resolve).
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
            // getFileSrcCached calls this predicate.
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

// `getDatabase()` returns the same `DBState.db` the tests set directly --
// unlike GridCatalog/MobileCharacters, which never call it, Sidebar.svelte's
// own `$effect` calls `getCharacterIndexObject()` (`src/ts/util.ts`), which
// calls `getDatabase()` unconditionally.
// A version that throws (as some other harnesses in this repo use, since
// their components never reach this call) makes every Sidebar mount throw
// inside that effect. The dynamic import inside the factory resolves to the
// ALREADY-mocked `stores.svelte` below (vi.mock intercepts by resolved
// module id, regardless of who imports it or when).
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
        // AlertComp.svelte imports this too; not called on the selectChar
        // branch, but the named import must resolve.
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    // AlertComp.svelte's script body calls these eagerly at mount
    // (`osLabel`/`risuEnvironment` initializers).
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

// Thin, genuinely-reactive ($state-backed) stand-in for the app's whole
// store module -- same pattern and same reason as the harness's mock.
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
        // Sidebar.svelte's own direct needs, plus its statically-imported
        // (but not necessarily instantiated) children CharConfig.svelte,
        // SideChatList.svelte and QuickSettingsGUI.svelte -- ES imports are
        // eager, so their module bodies run at import time even when the
        // component they render behind a runtime `{#if}` is never mounted.
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
        // AlertComp.svelte's own direct need.
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

// Partial mock: everything real except `changeChar`, replaced with a bare
// spy (see header for why the real `changeChar` cannot run against the
// `database.svelte` mock above). `getCharImage` and everything else stays
// the genuine implementation.
vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: changeCharSpy,
    }
})

// The real `avatarThumb` module adds genuine async hops on top of `getCharImage`
// -- a store lookup, a queue and (once per session) a canvas readback probe --
// none of which this file's `settle()` convergence loop is designed to absorb.
// `getAvatarThumbSrc` is replaced with a spy that resolves `null` by default,
// i.e. "no thumbnail, fall back to `getFileSrc`" -- the plain/css fallback
// path -- so every `getFileSrcSpy` count assertion in this file keeps
// measuring only that fallback path. `isThumbEligible` is left real: it is a
// pure, synchronous predicate (`loc.startsWith('assets/')`), adds no async hop
// of its own, and keeping it real exercises the real eligibility check against
// this file's own fixture locs rather than assuming it.
vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: avatarThumbSpy,
    }
})

//#endregion

//#region IntersectionObserver fake (see comment below)

/**
 * Avatar resolution is gated on `nearViewport`'s use of `IntersectionObserver`,
 * and happy-dom's own `IntersectionObserver` never invokes its callback at
 * all (`observe()` is a no-op there), so without a fake every avatar here
 * would stay permanently unresolved and every assertion below would read 0
 * lookups no matter what actually changed. This fake reports every observed
 * target immediately, permanently visible, so this file measures per-change
 * re-lookup behaviour, not visibility gating (that is
 * `charlistAvatarLazy.svelte.test.ts`'s job).
 *
 * SYNCHRONOUS, ON PURPOSE: `nearViewport.svelte.ts` (`use:nearViewport`'s
 * setup) reads nothing about *when* its `IntersectionObserver` callback
 * fires -- it only registers a per-target callback and calls `observe()`;
 * there is no code path anywhere in it, or in this file's `settle()` helper,
 * that depends on the callback arriving asynchronously. A version of this
 * fake that defers its callback via `queueMicrotask`, matching the real
 * spec's always-async delivery, races `settle()`'s own "stop once two
 * consecutive checks agree" convergence loop: `settle()` can observe two
 * stable-looking ticks and return before the deferred microtask has even
 * run, letting that call land after the next test's own
 * `getFileSrcSpy.mockClear()`, misattributing it. Firing synchronously inside
 * `observe()` removes that hop entirely: `onChange(true)` runs in the same
 * tick as the mount/update that called `observe()`, which is precisely the
 * behaviour these tests measure. Installed before any component ever mounts
 * (module-level, not inside a hook), per `nearViewport.svelte.ts`'s own
 * test-seam doc comment.
 */
class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

// happy-dom has no layout, and the Grid tab builds no tile until its container reports a width:
// every element reports 312 px, room for four tiles.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

//#endregion

import { DBState, alertStore } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'
import { resetCharListAvatarCacheForTest } from './CharListAvatar.svelte'
import Sidebar from '../SideBars/Sidebar.svelte'
import AlertComp from './AlertComp.svelte'

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

const NON_TRASHED = 60
const TRASHED = 5
// Every 10th non-trashed character (i % 10 === 0) carries a `~` marker --
// exactly 6 of 60, a precise and reproducible "~10% of the currently-shown
// list" narrowing target. Every name contains "Character", so a single 'C'
// keystroke matches every non-trashed character.
const MARKED_INDICES = [0, 10, 20, 30, 40, 50]

function buildDb(nonTrashed: number, trashed: number): Database {
    const characters: CharacterFixture[] = []
    for (let i = 0; i < nonTrashed; i++) {
        const marked = i % 10 === 0
        characters.push({
            chaId: `char-${i}`,
            name: `Character ${i}${marked ? '~' : ''}`,
            type: 'character',
            image: `assets/${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            // Unique per character, so MobileCharacters's primary sort key
            // (interaction, descending) never ties -- renaming a character
            // never changes its sort position, regardless of the new name.
            lastInteraction: i,
            chats: [{ id: `char-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    for (let j = 0; j < trashed; j++) {
        characters.push({
            chaId: `trashed-${j}`,
            name: `Character Trash ${j}`,
            type: 'character',
            image: `assets/trashed-${j}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: 0,
            chats: [{ id: `trashed-${j}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: 1_700_000_000_000 + j,
        } as unknown as CharacterFixture)
    }
    return {
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

const SIDEBAR_N = 25

/**
 * A separate, smaller, all-non-trashed fixture for Sidebar.svelte: the
 * sidebar's own `$effect` walks `DBState.db.characterOrder` directly (a
 * flat list of plain `chaId`
 * strings here -- no folders), independent of `formatChars`/`sortChar`'s
 * trash filtering, so mixing in trashed characters would only complicate
 * the expected call count for no reason relevant to AV-1.
 */
function buildSidebarDb(n: number): Database {
    const characters: CharacterFixture[] = []
    for (let i = 0; i < n; i++) {
        characters.push({
            chaId: `sb-char-${i}`,
            name: `Sidebar Character ${i}`,
            type: 'character',
            image: `assets/sb-${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: i,
            chats: [{ id: `sb-char-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    return {
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

/**
 * A single-folder Sidebar fixture (`Sidebar.svelte`'s folder row for the
 * folder's own avatar, and its member rows for their avatars once opened):
 * `characterOrder`
 * holds one `folder` entry (rather than the flat chaId strings
 * `buildSidebarDb` uses) whose `data` lists every member's chaId, and whose
 * `imgFile` is the folder's own thumbnail-eligible loc.
 */
function buildSidebarDbWithFolder(memberCount: number): Database {
    const members: CharacterFixture[] = []
    for (let i = 0; i < memberCount; i++) {
        members.push({
            chaId: `sb-folder-member-${i}`,
            name: `Folder Member ${i}`,
            type: 'character',
            image: `assets/sb-folder-member-${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: i,
            chats: [{ id: `sb-folder-member-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    const folderEntry = {
        id: 'sb-folder-1',
        name: 'Sidebar Folder',
        color: 'default',
        data: members.map((c) => c.chaId),
        imgFile: 'assets/sb-folder.png',
    } as unknown as folder
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [folderEntry],
        characters: members,
        hideAllImages: false,
    } as unknown as Database
}

/** The folder's own avatar span, distinguished from a normal/member avatar
 *  span by the absence of `data-char-id` (`SidebarAvatar` is only ever given
 *  a `chaId` prop for normal characters and folder members, `Sidebar.svelte`
 *  `:622`/`:793` -- never for a folder itself). */
function folderAvatarSpan(root: HTMLElement): HTMLElement {
    const spans = Array.from(root.querySelectorAll('span.avatar')) as HTMLElement[]
    const found = spans.find((s) => !s.hasAttribute('data-char-id'))
    if (!found) {
        throw new Error('folder avatar span not found')
    }
    return found
}

function countAvatarEls(root: HTMLElement): number {
    return root.querySelectorAll('[style*="background: url("]').length
}

function avatarButtons(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.ico'))
}

function resolvedAvatarButtons(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.ico[style]'))
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 2 | 3): void {
    const label =
        (layout === 0 ? language.grid : layout === 1 ? language.list : layout === 2 ? language.trash : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
}

/**
 * The grid, list, simple and trash tabs mount only the rows near their scroll viewport. A container
 * with no layout (happy-dom) is windowed by `window.innerHeight`, so a tall window mounts the
 * whole fixture: the lookups guards below are about re-resolution of an avatar, which has to be
 * observed on every row; the window itself is covered by `GridCatalog.window.svelte.test.ts`.
 */
function useTallViewport(): () => void {
    const previous = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 100_000 })
    return () => {
        if (previous) {
            Object.defineProperty(window, 'innerHeight', previous)
        } else {
            delete (window as unknown as Record<string, unknown>).innerHeight
        }
    }
}

function setSearchValue(root: HTMLElement, value: string): void {
    const input = root.querySelector('input[type="text"]') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // The typed query lands after the search debounce; fake the clock only for
    // that window so the rest of the file keeps real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        flushSync()
        vi.advanceTimersByTime(150)
    } finally {
        vi.useRealTimers()
    }
}

/**
 * Repeatedly flushes the REAL Svelte runtime this component tree is
 * compiled against, then awaits a pair of microtask ticks, until neither
 * the getFileSrc call count nor the number of resolved-avatar DOM nodes
 * changes between two consecutive iterations. Bounded at 50 iterations as a
 * safety cap (same as the harness); never observed to need more than a
 * handful in practice since the mocked getFileSrc resolves in one
 * microtask.
 */
async function settle(root: HTMLElement): Promise<void> {
    let lastCalls = -1
    let lastAvatars = -1
    for (let i = 0; i < 50; i++) {
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        const calls = getFileSrcSpy.mock.calls.length
        const avatars = countAvatarEls(root)
        if (calls === lastCalls && avatars === lastAvatars) {
            break
        }
        lastCalls = calls
        lastAvatars = avatars
    }
    flushSync()
}

// A mount starts from an empty avatar style cache, so a block's counts are its own and never
// satisfied by what an earlier block resolved for the same location.
function mountGridCatalog(): { target: HTMLElement; app: Record<string, unknown> } {
    resetCharListAvatarCacheForTest()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

function mountSidebar(): { target: HTMLElement; app: Record<string, unknown> } {
    resetCharListAvatarCacheForTest()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

function mountAlertComp(): { target: HTMLElement; app: Record<string, unknown> } {
    resetCharListAvatarCacheForTest()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(AlertComp, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

//#endregion

describe.sequential('grid layout: avatar lookups (AV-1 regression, GridCatalog.svelte)', () => {
    let target: HTMLElement
    let app: Record<string, unknown>
    let restoreViewport: () => void

    beforeAll(async () => {
        restoreViewport = useTallViewport()
        DBState.db = buildDb(NON_TRASHED, TRASHED)
        getFileSrcSpy.mockClear()
        // Generous effective timeout: this first mount in the file pays the
        // one-time ~13-17s Vite transform cost for characters.ts's whole
        // transitive import graph (see header / harness header for why that
        // is a one-time cost, not a per-test cost).
        const mounted = mountGridCatalog()
        target = mounted.target
        app = mounted.app
        await settle(target) // settle the default (simple) layout, uncounted
        getFileSrcSpy.mockClear()
        clickLayoutButton(target, 0)
        await settle(target)
        getFileSrcSpy.mockClear() // grid's own first render, uncounted by the tests below
    }, 120_000)

    afterAll(async () => {
        await teardown(target, app)
        restoreViewport()
    })

    test('a search keystroke that still matches every character resolves no avatar again', async () => {
        setSearchValue(target, 'C')
        await settle(target)
        // Guards against every listed character's avatar re-resolving when
        // the visible set is unchanged.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
    })

    test('a search keystroke that narrows to ~10% resolves no avatar again', async () => {
        setSearchValue(target, '') // back to the full list, uncounted
        await settle(target)
        getFileSrcSpy.mockClear()
        setSearchValue(target, '~')
        await settle(target)
        // Guards against the now-visible subset re-resolving on a narrowing search: a card that
        // lands in a different row is a new tile, which paints from the style cache.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
        expect(countAvatarEls(target)).toBe(MARKED_INDICES.length)
        setSearchValue(target, '') // restore the full list for later tests
        await settle(target)
    })

    test("clicking a row after narrowing search calls changeChar with that row's own db.characters index (guard: holds regardless of avatar caching)", async () => {
        setSearchValue(target, '~')
        await settle(target)
        const buttons = resolvedAvatarButtons(target)
        expect(buttons.length).toBe(MARKED_INDICES.length)
        changeCharSpy.mockClear()
        const k = 2 // third visible row -> original db.characters index 20
        buttons[k].click()
        flushSync()
        expect(changeCharSpy).toHaveBeenCalledWith(MARKED_INDICES[k])
        setSearchValue(target, '') // restore the full list for later tests
        await settle(target)
    })

    test("changing one character's avatar resolves exactly that character, with its new path", async () => {
        getFileSrcSpy.mockClear()
        const idx = 31
        const newPath = 'assets/mutated-grid.png'
        DBState.db.characters[idx].image = newPath
        await settle(target)
        // Only the one character whose avatar changed re-resolves.
        expect(getFileSrcSpy.mock.calls.length).toBe(1)
        expect(getFileSrcSpy.mock.calls[0][0]).toBe(newPath)
    })

    test('toggling hideAllImages hides every avatar behind the placeholder, then re-resolves every avatar on the way back (guard: getCharImage reads hideAllImages as a genuine dependency, independent of the avatar-caching equality check)', async () => {
        getFileSrcSpy.mockClear()
        DBState.db.hideAllImages = true
        await settle(target)
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
        expect(countAvatarEls(target)).toBe(0)
        for (const btn of avatarButtons(target)) {
            // getCharImage returns '' for css type while hideAllImages is
            // true, so no button carries a background-url style.
            expect(btn.getAttribute('style') ?? '').not.toContain('background: url(')
        }

        getFileSrcSpy.mockClear()
        DBState.db.hideAllImages = false
        await settle(target)
        // The pictures resolved before the toggle come back from the style cache, so the
        // way back asks for nothing; they must all be showing again.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
        expect(countAvatarEls(target)).toBe(NON_TRASHED)
    })

    test('deleting an earlier character leaves every remaining tile showing its own avatar, not a stale one (guard: Svelte always passes the item at each position the correct, freshly-read image even in an unkeyed each; re-keying is for click/DOM-identity reasons, not this)', async () => {
        const deleteAt = 3 // before most other non-trashed characters
        DBState.db.characters.splice(deleteAt, 1)
        await settle(target)
        const expectedImages = DBState.db.characters.filter((c) => !c.trashTime).map((c) => c.image)
        const buttons = resolvedAvatarButtons(target)
        expect(buttons.length).toBe(expectedImages.length)
        buttons.forEach((btn, i) => {
            expect(btn.getAttribute('style')).toContain(`loc=${expectedImages[i]}`)
        })
    })
})

describe.sequential('list layout: avatar lookups (AV-1 regression, GridCatalog.svelte)', () => {
    let target: HTMLElement
    let app: Record<string, unknown>
    let restoreViewport: () => void

    beforeAll(async () => {
        restoreViewport = useTallViewport()
        DBState.db = buildDb(NON_TRASHED, TRASHED)
        getFileSrcSpy.mockClear()
        const mounted = mountGridCatalog()
        target = mounted.target
        app = mounted.app
        await settle(target)
        getFileSrcSpy.mockClear()
        clickLayoutButton(target, 1)
        await settle(target)
        getFileSrcSpy.mockClear() // list's own first render, uncounted by the tests below
    })

    afterAll(async () => {
        await teardown(target, app)
        restoreViewport()
    })

    test('a search keystroke that still matches every character resolves no avatar again', async () => {
        setSearchValue(target, 'C')
        await settle(target)
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
    })

    test('a search keystroke that narrows to ~10% resolves no avatar again', async () => {
        setSearchValue(target, '')
        await settle(target)
        getFileSrcSpy.mockClear()
        setSearchValue(target, '~')
        await settle(target)
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
        setSearchValue(target, '')
        await settle(target)
    })

    test("clicking a row after narrowing search calls changeChar with that row's own db.characters index (guard: holds regardless of avatar caching)", async () => {
        setSearchValue(target, '~')
        await settle(target)
        const buttons = resolvedAvatarButtons(target)
        expect(buttons.length).toBe(MARKED_INDICES.length)
        changeCharSpy.mockClear()
        const k = 4 // fifth visible row -> original db.characters index 40
        buttons[k].click()
        flushSync()
        expect(changeCharSpy).toHaveBeenCalledWith(MARKED_INDICES[k])
        setSearchValue(target, '')
        await settle(target)
    })

    test("changing one character's avatar resolves exactly that character, with its new path", async () => {
        getFileSrcSpy.mockClear()
        const idx = 32
        const newPath = 'assets/mutated-list.png'
        DBState.db.characters[idx].image = newPath
        await settle(target)
        expect(getFileSrcSpy.mock.calls.length).toBe(1)
        expect(getFileSrcSpy.mock.calls[0][0]).toBe(newPath)
    })

    test('deleting an earlier character leaves every remaining tile showing its own avatar, not a stale one (guard: holds regardless of avatar caching)', async () => {
        const deleteAt = 4
        DBState.db.characters.splice(deleteAt, 1)
        await settle(target)
        const expectedImages = DBState.db.characters.filter((c) => !c.trashTime).map((c) => c.image)
        const buttons = resolvedAvatarButtons(target)
        expect(buttons.length).toBe(expectedImages.length)
        buttons.forEach((btn, i) => {
            expect(btn.getAttribute('style')).toContain(`loc=${expectedImages[i]}`)
        })
    })
})

describe.sequential('simple layout: avatar lookups (AV-1 regression, MobileCharacters.svelte)', () => {
    let target: HTMLElement
    let app: Record<string, unknown>
    let restoreViewport: () => void

    beforeAll(async () => {
        restoreViewport = useTallViewport()
        DBState.db = buildDb(NON_TRASHED, TRASHED)
        getFileSrcSpy.mockClear()
        const mounted = mountGridCatalog() // GridCatalog defaults to selected=3 (simple)
        target = mounted.target
        app = mounted.app
        await settle(target)
    })

    afterAll(async () => {
        await teardown(target, app)
        restoreViewport()
    })

    test('renaming one character resolves no avatar again (the rename does not move its row: sort is primarily by lastInteraction, which is unique per character in this fixture and untouched by a rename)', async () => {
        getFileSrcSpy.mockClear()
        const idx = 33
        DBState.db.characters[idx].name = 'Renamed Character Unique Name'
        await settle(target)
        // Guards against every listed character's avatar re-resolving when
        // an unrelated character is renamed.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
    })

    test("changing one character's avatar resolves exactly that character, with its new path", async () => {
        getFileSrcSpy.mockClear()
        const idx = 34
        const newPath = 'assets/mutated-simple.png'
        DBState.db.characters[idx].image = newPath
        await settle(target)
        expect(getFileSrcSpy.mock.calls.length).toBe(1)
        expect(getFileSrcSpy.mock.calls[0][0]).toBe(newPath)
    })
})

describe.sequential('Sidebar: avatar lookups (AV-1 regression, Sidebar.svelte)', () => {
    let target: HTMLElement
    let app: Record<string, unknown>

    beforeAll(async () => {
        DBState.db = buildSidebarDb(SIDEBAR_N)
        getFileSrcSpy.mockClear()
        const mounted = mountSidebar()
        target = mounted.target
        app = mounted.app
        await settle(target)
        getFileSrcSpy.mockClear() // initial mount, uncounted by the tests below
    })

    afterAll(async () => {
        await teardown(target, app)
    })

    test('renaming one character resolves no avatar again', async () => {
        getFileSrcSpy.mockClear()
        DBState.db.characters[10].name = 'Renamed Sidebar Character'
        await settle(target)
        // Guards against every listed character's avatar re-resolving when
        // an unrelated character is renamed.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)
    })

    test("changing one character's avatar resolves exactly that character, with its new path", async () => {
        getFileSrcSpy.mockClear()
        const newPath = 'assets/mutated-sidebar.png'
        DBState.db.characters[12].image = newPath
        await settle(target)
        // Only the one character whose avatar changed re-resolves.
        expect(getFileSrcSpy.mock.calls.length).toBe(1)
        expect(getFileSrcSpy.mock.calls[0][0]).toBe(newPath)
    })
})

describe('AlertComp selectChar dialog: avatar lookups (observation only: AlertComp is changed only if it churns)', () => {
    test('renaming one character while the selectChar dialog is open', async () => {
        DBState.db = buildSidebarDb(SIDEBAR_N)
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        getFileSrcSpy.mockClear()
        const { target, app } = mountAlertComp()
        await settle(target)
        getFileSrcSpy.mockClear() // initial mount, uncounted

        DBState.db.characters[10].name = 'Renamed Sidebar Character'
        await settle(target)

        // AlertComp's selectChar branch iterates `DBState.db.characters`
        // directly -- the live database proxies, whose identity is stable
        // across a rename, unlike formatChars/sortChar/Sidebar's own
        // freshly-built per-item objects -- so renaming does not churn its
        // avatars.
        expect(getFileSrcSpy.mock.calls.length).toBe(0)

        await teardown(target, app)
        alertStore.set({ type: 'none', msg: '' } as never)
    })
})

// Every `getCharImage(loc, 'thumb'|'thumbcss')` call site in the app: grid,
// list and trash layouts, the simple layout, a Sidebar normal row, a
// Sidebar folder's own avatar, a Sidebar folder member once its folder is
// open, and AlertComp's own selectChar dialog. Every one of these eight is
// covered below, each against this file's simpler "everything reports
// visible immediately" `IntersectionObserver` fake -- proving the WIRING at
// every site, not the visibility-gating behaviour itself (that is
// `charlistAvatarLazy.svelte.test.ts`'s job, and its own T12 only covers a
// subset of these sites for that reason -- see its own comment).
describe('T12: getAvatarThumbSrc is wired into every list site', () => {
    afterEach(() => {
        for (const key of Object.keys(thumbOverride)) {
            delete thumbOverride[key]
        }
        avatarThumbSpy.mockClear()
    })

    test("grid layout: the spy receives every visible character's loc", async () => {
        DBState.db = buildDb(5, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        // The default tab (simple/`MobileCharacters.svelte`) already resolved
        // every one of these same locs before the switch below; clear so the
        // assertion below can only be satisfied by the GRID tab's own calls. The style cache is
        // emptied too, or the tab would paint from it and look nothing up.
        avatarThumbSpy.mockClear()
        resetCharListAvatarCacheForTest()
        clickLayoutButton(target, 0)
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        await teardown(target, app)
    })

    test('grid layout: a non-null thumbnail result renders as the background-url, bypassing the getFileSrc fallback', async () => {
        DBState.db = buildDb(5, 0)
        const targetLoc = DBState.db.characters[2].image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-grid-2'
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        const buttons = resolvedAvatarButtons(target)
        const thumbButton = buttons.find((b) => (b.getAttribute('style') ?? '').includes(`url("${thumbOverride[targetLoc]}")`))
        expect(thumbButton).toBeTruthy()
        // The thumbnailed character's own loc never reaches getFileSrc, since
        // getAvatarThumbSrc's non-null result short-circuits the fallback
        // (`characters.ts`'s `getCharImage`, `?? await getFileSrc(loc)`).
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === targetLoc)).toBe(false)

        await teardown(target, app)
    })

    test("Sidebar: the spy receives every visible character's loc, and a non-null result renders as the <img> src", async () => {
        DBState.db = buildSidebarDb(5)
        const targetLoc = DBState.db.characters[1].image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-sidebar-1'
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        const imgs = Array.from(target.querySelectorAll('img.sidebar-avatar')) as HTMLImageElement[]
        expect(imgs.some((img) => img.getAttribute('src') === thumbOverride[targetLoc])).toBe(true)
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === targetLoc)).toBe(false)

        await teardown(target, app)
    })

    test('Sidebar folder: the folder\'s own visible avatar resolves its imgFile through the thumbnail path', async () => {
        DBState.db = buildSidebarDbWithFolder(3)
        const folderLoc = 'assets/sb-folder.png'
        thumbOverride[folderLoc] = 'data:image/webp;base64,thumb-for-sidebar-folder'
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)

        expect(avatarThumbSpy.mock.calls.map((c) => c[0])).toContain(folderLoc)

        const folderStyle = folderAvatarSpan(target).querySelector('.sidebar-avatar')?.getAttribute('style') ?? ''
        expect(folderStyle).toContain(`url("${thumbOverride[folderLoc]}")`)
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === folderLoc)).toBe(false)

        await teardown(target, app)
    })

    test("Sidebar folder members: opening the folder resolves each member's loc through the thumbnail path", async () => {
        DBState.db = buildSidebarDbWithFolder(3)
        const targetLoc = (DBState.db.characters[1] as CharacterFixture).image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-sidebar-folder-member-1'
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)

        // Members are not in the DOM at all until the folder is opened.
        expect(avatarThumbSpy.mock.calls.map((c) => c[0])).not.toContain(targetLoc)

        folderAvatarSpan(target).dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        const imgs = Array.from(target.querySelectorAll('img.sidebar-avatar')) as HTMLImageElement[]
        expect(imgs.some((img) => img.getAttribute('src') === thumbOverride[targetLoc])).toBe(true)
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === targetLoc)).toBe(false)

        await teardown(target, app)
    })

    test("simple layout (MobileCharacters.svelte): the spy receives every visible character's loc", async () => {
        DBState.db = buildDb(5, 0) // GridCatalog defaults to selected=3 (simple)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        await teardown(target, app)
    })

    test("list layout: the spy receives every visible character's loc", async () => {
        DBState.db = buildDb(5, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        // The default tab (simple/`MobileCharacters.svelte`) already resolved
        // every one of these same locs before the switch below; clear so the
        // assertion below can only be satisfied by the LIST tab's own calls (style cache emptied as above).
        avatarThumbSpy.mockClear()
        resetCharListAvatarCacheForTest()
        clickLayoutButton(target, 1)
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        await teardown(target, app)
    })

    test("trash layout: the spy receives every visible trashed character's loc", async () => {
        DBState.db = buildDb(0, 5)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 2)
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        await teardown(target, app)
    })

    test("AlertComp selectChar dialog: the spy receives every visible character's loc, and a non-null result renders as the background-url", async () => {
        DBState.db = buildDb(5, 0)
        const targetLoc = DBState.db.characters[1].image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-alertcomp-1'
        getFileSrcSpy.mockClear()
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        const { target, app } = mountAlertComp()
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        const buttons = resolvedAvatarButtons(target)
        const thumbButton = buttons.find((b) => (b.getAttribute('style') ?? '').includes(`url("${thumbOverride[targetLoc]}")`))
        expect(thumbButton).toBeTruthy()
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === targetLoc)).toBe(false)

        await teardown(target, app)
        alertStore.set({ type: 'none', msg: '' } as never)
    })
})
