// @vitest-environment happy-dom

/**
 * Avatars resolve only near the viewport, using a shared, injectable
 * `IntersectionObserver`, instead of every listed avatar resolving
 * unconditionally at mount.
 *
 * This file copies `charlistAvatarLookups.svelte.test.ts`'s mock setup and
 * fixture-building helpers rather than extending that file in place, because
 * this file needs one more piece of global test infrastructure that file has
 * no reason to carry: a controllable fake `globalThis.IntersectionObserver`
 * (installed for the whole file) and an injected `<style>` stylesheet (see
 * below). Keeping that out of `charlistAvatarLookups.svelte.test.ts` keeps
 * that file's mocks exactly as narrow as its own header documents.
 *
 * MOCKED, same reasons as `charlistAvatarLookups.svelte.test.ts`'s header
 * (`localforage`, `src/ts/globalApi.svelte`'s `getFileSrc` as a counting spy,
 * `src/ts/storage/database.svelte`'s `getDatabase`, `src/ts/platform` forced to
 * the plain-HTTP branch, `@tauri-apps/plugin-fs`, a reactive `stores.svelte`
 * stand-in, a partial `src/ts/characters` mock with only `changeChar`
 * replaced, and a partial `src/ts/media/avatarThumb` mock with only
 * `getAvatarThumbSrc` replaced by a spy resolving `null` by default).
 * `getCharImage` and `isThumbEligible` are both real. See that file for the
 * full rationale; it is not repeated line-by-line here.
 *
 * THE FAKE INTERSECTION OBSERVER (test seam): the lazy-loading code reads
 * `globalThis.IntersectionObserver` at use time, so tests can `vi.stubGlobal`
 * a controllable fake and fire hand-built entries -- no source-text guards,
 * and this file never imports `src/ts/gui/nearViewport.svelte.ts` directly.
 * `FakeIntersectionObserver` below records every constructed instance (with
 * its `root`/`rootMargin` options), every target it is asked to `observe`,
 * and whether `disconnect` was called. Tests drive it only through
 * `fire(...)`, which mirrors a real observer: it only reports the subset of a
 * given batch of entries that instance itself is observing.
 *
 * COMPUTED-STYLE SEAM: the root-selection rule is "the nearest ancestor whose
 * COMPUTED overflow-y is auto or scroll". The app expresses that only via the
 * Tailwind utility classes `overflow-y-auto` (and, elsewhere in the app,
 * `overflow-y-scroll`), and no Tailwind CSS is loaded in happy-dom, so without
 * help `getComputedStyle` would report `visible` for every element and every
 * root would fall back to `null`, and the root-selection test would pass
 * trivially and prove nothing. This file injects a plain `<style>` element
 * mapping those two classes to the real CSS property before any component
 * mounts. The very first test below is a live guard, run against a throwaway
 * element, that happy-dom's `getComputedStyle` actually honours it, so a
 * happy-dom upgrade that stops honouring stylesheet rules fails there for an
 * obvious, diagnosable reason instead of silently passing for the wrong one.
 *
 * N is kept deliberately small everywhere (max 8 characters per fixture): a
 * much larger fixture risks a heap OOM in this mount/settle harness.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

//#region module mocks (copied from charlistAvatarLookups.svelte.test.ts -- see header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

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
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
            // getFileSrcCached calls this predicate.
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
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

import { DBState, alertStore } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'
import Sidebar from '../SideBars/Sidebar.svelte'
import { installGeometry, settleFrame, type Geometry } from '../SideBars/sidebarDnd.testKit'
import AlertComp from './AlertComp.svelte'

//#region fake IntersectionObserver (test seam)

type FakeEntry = { target: Element; isIntersecting: boolean }

class FakeIntersectionObserver implements Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect' | 'takeRecords'> {
    static instances: FakeIntersectionObserver[] = []

    readonly root: Element | Document | null
    readonly rootMargin: string
    readonly thresholds: ReadonlyArray<number>
    readonly callback: IntersectionObserverCallback
    readonly observed = new Set<Element>()
    disconnected = false

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback
        this.root = (options?.root as Element | Document | null) ?? null
        this.rootMargin = options?.rootMargin ?? '0px'
        const t = options?.threshold
        this.thresholds = t === undefined ? [0] : Array.isArray(t) ? t : [t]
        FakeIntersectionObserver.instances.push(this)
    }

    observe(target: Element): void {
        this.observed.add(target)
    }

    unobserve(target: Element): void {
        this.observed.delete(target)
    }

    disconnect(): void {
        this.disconnected = true
        this.observed.clear()
    }

    takeRecords(): IntersectionObserverEntry[] {
        return []
    }

    /**
     * Fires only the subset of `entries` this particular instance is actually
     * observing -- mirroring a real IntersectionObserver, whose callback only
     * ever reports its own targets, never another observer's.
     */
    fire(entries: FakeEntry[]): void {
        const observing = entries.filter((e) => this.observed.has(e.target))
        if (observing.length === 0) {
            return
        }
        const records = observing.map(
            (e) =>
                ({
                    target: e.target,
                    isIntersecting: e.isIntersecting,
                    intersectionRatio: e.isIntersecting ? 1 : 0,
                    boundingClientRect: {} as DOMRectReadOnly,
                    intersectionRect: {} as DOMRectReadOnly,
                    rootBounds: null,
                    time: 0,
                }) as IntersectionObserverEntry,
        )
        this.callback(records, this as unknown as IntersectionObserver)
    }
}

/**
 * A constructor that always throws, simulating a broken/unsupported
 * `IntersectionObserver` implementation. The fake's only job is to make the
 * constructor throw; the assertions in v11 below establish what fail-open
 * behaviour actually results.
 */
class ThrowingIntersectionObserver {
    constructor() {
        throw new Error('v11 fake: IntersectionObserver constructor always throws')
    }
}

const NEAR_MARGIN = '100% 0px'
const FAR_MARGIN = '300% 0px'

/**
 * A constructor that HALF-succeeds -- it returns a working instance for the
 * near band (`rootMargin: '100% 0px'`) and only throws for the far band
 * (`rootMargin: '300% 0px'`). `v11`'s own fake above ALWAYS throws, so it only
 * ever exercises `nearViewport.svelte.ts`'s FIRST construction throwing; it
 * never exercises a real bug where the first construction succeeds -- one
 * live observer already created and registered -- and only the SECOND one
 * throws.
 *
 * Which band is made to throw is deliberate, not arbitrary: reading
 * `nearViewport.svelte.ts`'s `nearViewport` function confirms it constructs
 * the near entry FIRST and the far entry SECOND, so making the FAR band the
 * one that throws here puts the throw on the SECOND construction in the real
 * call order -- exactly the half-succeeded state this test needs. Had that
 * source instead constructed far before near, this fake's throwing band would
 * need to flip to near, to keep the throw on the second one actually
 * attempted.
 */
class HalfThrowingIntersectionObserver implements Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect' | 'takeRecords'> {
    static nearInstances: HalfThrowingIntersectionObserver[] = []

    readonly rootMargin: string
    readonly observed = new Set<Element>()
    disconnected = false

    constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.rootMargin = options?.rootMargin ?? '0px'
        if (this.rootMargin === FAR_MARGIN) {
            throw new Error('v11c fake: IntersectionObserver constructor throws for the far band only')
        }
        HalfThrowingIntersectionObserver.nearInstances.push(this)
    }

    observe(target: Element): void {
        this.observed.add(target)
    }

    unobserve(target: Element): void {
        this.observed.delete(target)
    }

    disconnect(): void {
        this.disconnected = true
        this.observed.clear()
    }

    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

function instancesByMargin(margin: string): FakeIntersectionObserver[] {
    return FakeIntersectionObserver.instances.filter((i) => i.rootMargin === margin)
}

/**
 * Every target any of `instances` is observing, deduplicated and sorted into
 * DOM (document) order -- so "the first k" and "item j" can be identified
 * purely from what the fake itself recorded, never from assumptions about
 * which element the not-yet-written implementation chooses as its target.
 */
function orderedTargets(instances: FakeIntersectionObserver[]): Element[] {
    const set = new Set<Element>()
    for (const inst of instances) {
        for (const el of inst.observed) {
            set.add(el)
        }
    }
    return Array.from(set).sort((a, b) => {
        const pos = a.compareDocumentPosition(b)
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
        return 0
    })
}

function fireOn(instances: FakeIntersectionObserver[], entries: FakeEntry[]): void {
    for (const inst of instances) {
        inst.fire(entries)
    }
}

//#endregion

//#region computed-overflow stylesheet (see header's "COMPUTED-STYLE SEAM")

function injectOverflowStylesheet(): void {
    if (document.getElementById('av2-test-overflow-styles')) {
        return
    }
    const style = document.createElement('style')
    style.id = 'av2-test-overflow-styles'
    style.textContent = '.overflow-y-auto{overflow-y:auto} .overflow-y-scroll{overflow-y:scroll}'
    document.head.appendChild(style)
}
injectOverflowStylesheet()

//#endregion

//#region fixture helpers (same shapes as charlistAvatarLookups.svelte.test.ts, smaller N)

type CharacterFixture = Database['characters'][number]

const V_N = 8
const V_TRASHED = 3
const V_K = 3

function buildDb(nonTrashed: number, trashed: number): Database {
    const characters: CharacterFixture[] = []
    for (let i = 0; i < nonTrashed; i++) {
        characters.push({
            chaId: `char-${i}`,
            name: `Character ${i}`,
            type: 'character',
            image: `assets/${i}.png`,
            creatorNotes: '',
            chatPage: 0,
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
 * v12's Sidebar fixture: `topN` top-level normal characters plus one folder
 * (`folder-1`) holding `folderN` members. Mirrors `buildSidebarDb` in every
 * other respect.
 */
function buildSidebarFolderDb(topN: number, folderN: number): Database {
    const topChars: CharacterFixture[] = []
    for (let i = 0; i < topN; i++) {
        topChars.push({
            chaId: `sb-top-${i}`,
            name: `Sidebar Top ${i}`,
            type: 'character',
            image: `assets/sb-top-${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: i,
            chats: [{ id: `sb-top-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    const memberChars: CharacterFixture[] = []
    for (let j = 0; j < folderN; j++) {
        memberChars.push({
            chaId: `sb-mem-${j}`,
            name: `Sidebar Member ${j}`,
            type: 'character',
            image: `assets/sb-mem-${j}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: j,
            chats: [{ id: `sb-mem-${j}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    const characters = [...topChars, ...memberChars]
    const folderOrder = {
        id: 'folder-1',
        name: 'Folder 1',
        color: '',
        data: memberChars.map((c) => c.chaId),
    }
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [...topChars.map((c) => c.chaId), folderOrder],
        characters,
        hideAllImages: false,
    } as unknown as Database
}

function countAvatarEls(root: HTMLElement): number {
    return root.querySelectorAll('[style*="background: url("]').length
}

function avatarButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll('button.ico'))
}

function resolvedAvatarButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll('button.ico[style]'))
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

/** Same bounded settle loop as charlistAvatarLookups.svelte.test.ts (see that file's header for why). */
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

function mountGridCatalog(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

function mountSidebar(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

function mountAlertComp(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(AlertComp, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

/** Characters in the Sidebar windowing fixtures: enough that the last row is far outside a 300 px window. */
const SB_N = 40

/** Mounts the Sidebar with a 300 px fake rail viewport, so the rail mounts only the window around it. */
async function mountWindowedSidebar(): Promise<{ target: HTMLElement; app: Record<string, unknown>; geo: Geometry }> {
    const { target, app } = mountSidebar()
    await settle(target)
    const geo = installGeometry(target, 300)!
    await settleFrame()
    await settle(target)
    return { target, app, geo }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

//#endregion

beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterAll(() => {
    vi.unstubAllGlobals()
})

beforeEach(() => {
    FakeIntersectionObserver.instances.length = 0
})

describe('test-infrastructure sanity check (not one of v1-v10)', () => {
    test('happy-dom getComputedStyle honours the injected overflow-y stylesheet rule', () => {
        const div = document.createElement('div')
        div.className = 'overflow-y-auto'
        document.body.appendChild(div)
        try {
            expect(getComputedStyle(div).overflowY).toBe('auto')
        } finally {
            div.remove()
        }
    })
})

describe('v1: only the fake-reported-intersecting items resolve, per layout', () => {
    test('grid layout (GridCatalog.svelte, selected=0)', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)
        getFileSrcSpy.mockClear() // initial mount + layout switch, uncounted

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        // Only the fired-and-intersecting items resolve: firing the first k
        // triggers exactly V_K new calls, none for the rest.
        expect(getFileSrcSpy.mock.calls.length).toBe(V_K)

        await teardown(target, app)
    })

    test('list layout (GridCatalog.svelte, selected=1)', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 1)
        await settle(target)
        getFileSrcSpy.mockClear()

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        // Same invariant as the grid case above.
        expect(getFileSrcSpy.mock.calls.length).toBe(V_K)

        await teardown(target, app)
    })

    test('trash layout (GridCatalog.svelte, selected=2)', async () => {
        const k = Math.min(V_K, V_TRASHED)
        DBState.db = buildDb(V_N, V_TRASHED)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 2)
        await settle(target)
        getFileSrcSpy.mockClear()

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, k).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        // Same invariant as the grid case above, for the trashed avatars
        // shown in this tab.
        expect(getFileSrcSpy.mock.calls.length).toBe(k)

        await teardown(target, app)
    })

    test('simple layout (MobileCharacters.svelte, GridCatalog default selected=3)', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog() // defaults to selected=3 (simple)
        await settle(target)
        getFileSrcSpy.mockClear()

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        // Same invariant as the grid case above.
        expect(getFileSrcSpy.mock.calls.length).toBe(V_K)

        await teardown(target, app)
    })

    test('Sidebar (Sidebar.svelte): only the rows in the scroll window are mounted, and each one requests its own avatar', async () => {
        DBState.db = buildSidebarDb(SB_N)
        getFileSrcSpy.mockClear()
        const { target, app } = await mountWindowedSidebar()

        // The rail mounts the window around the viewport instead of gating a mounted
        // list on an observer: a mounted row resolves its own avatar, a row outside it does not.
        const mountedRows = target.querySelectorAll('[data-char-id]').length
        const requested = new Set(getFileSrcSpy.mock.calls.map((c) => c[0]))
        expect(mountedRows).toBeGreaterThan(0)
        expect(mountedRows).toBeLessThan(SB_N)
        // Rows mounted before the container reported its height (the unmeasured window) may
        // also have asked, so the lookups cover at least the mounted rows and never the whole list.
        expect(requested.size).toBeGreaterThanOrEqual(mountedRows)
        expect(requested.size).toBeLessThan(SB_N)
        expect(requested.has('assets/sb-0.png')).toBe(true)
        expect(requested.has(`assets/sb-${SB_N - 1}.png`)).toBe(false)

        await teardown(target, app)
    })

    test('AlertComp selectChar dialog', async () => {
        DBState.db = buildSidebarDb(V_N)
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        getFileSrcSpy.mockClear()
        const { target, app } = mountAlertComp()
        await settle(target)
        getFileSrcSpy.mockClear()

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        // Same invariant as the grid case above, for AlertComp's selectChar dialog.
        expect(getFileSrcSpy.mock.calls.length).toBe(V_K)

        await teardown(target, app)
        alertStore.set({ type: 'none', msg: '' } as never)
    })
})

describe('v2: firing a single intersecting entry for item j resolves only j', () => {
    test('grid layout -- item j renders its own loc= path', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        // Nothing has fired yet, so nothing is resolved.
        expect(resolvedAvatarButtons(target).length).toBe(0)

        const j = 2
        const itemTarget = orderedTargets(instancesByMargin(NEAR_MARGIN))[j]
        if (itemTarget) {
            fireOn(instancesByMargin(NEAR_MARGIN), [{ target: itemTarget, isIntersecting: true }])
            await settle(target)
        }

        const resolved = resolvedAvatarButtons(target)
        expect(resolved.length).toBe(1)
        expect(resolved[0].getAttribute('style')).toContain(`loc=${DBState.db.characters[j].image}`)

        await teardown(target, app)
    })

    test('Sidebar -- a row that scrolls into the window renders its loc= path as the <img> src', async () => {
        DBState.db = buildSidebarDb(SB_N)
        getFileSrcSpy.mockClear()
        const { target, app, geo } = await mountWindowedSidebar()

        const j = 30
        const far = DBState.db.characters[j].chaId
        // Outside the window the row is not mounted: no avatar element and no lookup.
        expect(target.querySelector(`[data-char-id="${far}"]`)).toBeNull()

        await geo.scrollAndSettle(16 + j * 72)

        const img = target.querySelector(`[data-char-id="${far}"] img.sidebar-avatar`) as HTMLImageElement | null
        expect(img).not.toBeNull()
        expect(img!.getAttribute('src')).toBe(`data:mock-image;loc=${DBState.db.characters[j].image}`)

        await teardown(target, app)
    })
})

describe('v3: release -- leaving the far band shows the placeholder again; re-entry resolves again', () => {
    test('grid layout, near band (100% 0px) resolves, far band (300% 0px) releases', async () => {
        DBState.db = buildDb(5, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        const j = 1
        const itemTarget = orderedTargets(FakeIntersectionObserver.instances)[j]

        if (itemTarget) {
            fireOn(instancesByMargin(NEAR_MARGIN), [{ target: itemTarget, isIntersecting: true }])
            await settle(target)
        }
        // This alone does not distinguish gated resolution from unconditional
        // resolution at mount -- the far-band release below is the real check.
        expect(avatarButtons(target)[j].getAttribute('style') ?? '').toContain('background: url(')

        if (itemTarget) {
            fireOn(instancesByMargin(FAR_MARGIN), [{ target: itemTarget, isIntersecting: false }])
            await settle(target)
        }
        // Firing a non-intersecting entry on the far-band ('300% 0px') observer
        // releases a resolved avatar back to its placeholder.
        expect(avatarButtons(target)[j].getAttribute('style') ?? '').not.toContain('background: url(')

        const callsBeforeReentry = getFileSrcSpy.mock.calls.length
        if (itemTarget) {
            fireOn(instancesByMargin(NEAR_MARGIN), [{ target: itemTarget, isIntersecting: true }])
            await settle(target)
        }
        expect(avatarButtons(target)[j].getAttribute('style') ?? '').toContain('background: url(')
        // Re-entry re-runs the base64 encode on plain HTTP: no string cache
        // survives a release, so getFileSrc is called again.
        expect(getFileSrcSpy.mock.calls.length).toBeGreaterThan(callsBeforeReentry)

        await teardown(target, app)
    })
})

describe('v4: no IntersectionObserver global means every avatar still resolves (fail open)', () => {
    test('grid layout resolves all N with the global absent', async () => {
        vi.stubGlobal('IntersectionObserver', undefined)
        try {
            DBState.db = buildDb(V_N, 0)
            getFileSrcSpy.mockClear()
            const { target, app } = mountGridCatalog()
            await settle(target) // default (simple) layout's own resolution, uncounted
            getFileSrcSpy.mockClear()
            clickLayoutButton(target, 0)
            await settle(target)

            expect(resolvedAvatarButtons(target).length).toBe(V_N)
            expect(getFileSrcSpy.mock.calls.length).toBe(V_N)

            await teardown(target, app)
        } finally {
            vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
        }
    })
})

describe('v5 (new): nested MobileCharacters-inside-GridCatalog root selection', () => {
    test('the chosen root for MobileCharacters items is its own overflow-y-auto container, not GridCatalog\'s outer one', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog() // defaults to selected=3 (simple, nested)
        await settle(target)

        const scrollBoxes = Array.from(target.querySelectorAll('.overflow-y-auto')) as HTMLElement[]
        // GridCatalog's own outer scroll box is the first in document
        // order; MobileCharacters' own nested scroll box is the second.
        expect(scrollBoxes.length).toBeGreaterThanOrEqual(2)
        const gridOuter = scrollBoxes[0]
        const mobileCharsRoot = scrollBoxes[1]
        expect(gridOuter).not.toBe(mobileCharsRoot)
        expect(gridOuter.contains(mobileCharsRoot)).toBe(true)

        const nearInNested = instancesByMargin(NEAR_MARGIN).filter((inst) =>
            Array.from(inst.observed).some((el) => mobileCharsRoot.contains(el)),
        )
        // Precondition: at least one near-band instance was actually created
        // for MobileCharacters' items.
        expect(nearInNested.length).toBeGreaterThan(0)
        for (const inst of nearInNested) {
            // The specific expected root: MobileCharacters' own container, not
            // "some ancestor" and not GridCatalog's outer one.
            expect(inst.root).toBe(mobileCharsRoot)
        }

        await teardown(target, app)
    })
})

describe('v6: hideAllImages toggled while items are off-screen', () => {
    test('becoming visible while hideAllImages is true shows the placeholder; toggling back resolves with the fresh value', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        // Nothing has fired yet, so nothing is resolved.
        expect(resolvedAvatarButtons(target).length).toBe(0)

        DBState.db.hideAllImages = true
        await settle(target)

        const j = 0
        const itemTarget = orderedTargets(instancesByMargin(NEAR_MARGIN))[j]
        if (itemTarget) {
            fireOn(instancesByMargin(NEAR_MARGIN), [{ target: itemTarget, isIntersecting: true }])
            await settle(target)
        }
        // getCharImage returns '' for css type while hideAllImages is true,
        // regardless of visibility, so a newly-visible item still shows no
        // background-url style.
        expect(avatarButtons(target)[j].getAttribute('style') ?? '').not.toContain('background: url(')

        DBState.db.hideAllImages = false
        await settle(target)
        expect(avatarButtons(target)[j].getAttribute('style') ?? '').toContain('background: url(')
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === DBState.db.characters[j].image)).toBe(true)

        await teardown(target, app)
    })
})

describe('v7: Sidebar data-char-id and DOM order', () => {
    test('every item carries data-char-id, in characterOrder\'s order, independent of resolution', async () => {
        DBState.db = buildSidebarDb(V_N)
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)

        const idEls = Array.from(target.querySelectorAll('[data-char-id]'))
        expect(idEls.length).toBe(V_N)
        idEls.forEach((el, i) => {
            expect(el.getAttribute('data-char-id')).toBe(DBState.db.characters[i].chaId)
        })

        await teardown(target, app)
    })
})

describe('v9: observer registry lifecycle across repeated mount/unmount and dialog open/close', () => {
    test('every observer created across three grid mounts and three selectChar opens gets disconnect, holding no targets afterward', async () => {
        for (let i = 0; i < 3; i++) {
            DBState.db = buildDb(4, 0)
            const { target, app } = mountGridCatalog()
            await settle(target)
            await teardown(target, app)
        }

        DBState.db = buildSidebarDb(4)
        const { target: alertTarget, app: alertApp } = mountAlertComp()
        await settle(alertTarget)
        for (let i = 0; i < 3; i++) {
            alertStore.set({ type: 'selectChar', msg: '' } as never)
            await settle(alertTarget)
            alertStore.set({ type: 'none', msg: '' } as never)
            await settle(alertTarget)
        }
        await teardown(alertTarget, alertApp)

        // Precondition: at least one observer was actually created. Tested
        // through the fake's own records, since the real registry (a WeakMap)
        // is private and cannot be imported or inspected directly.
        expect(FakeIntersectionObserver.instances.length).toBeGreaterThan(0)

        for (const inst of FakeIntersectionObserver.instances) {
            expect(inst.disconnected).toBe(true)
            expect(inst.observed.size).toBe(0)
        }
    })
})

describe('v10: Sidebar rows outside the window do no avatar work', () => {
    test('a mounted row keeps the avatar size and classes, and the lookup of a row outside the window never starts', async () => {
        DBState.db = buildSidebarDb(SB_N)
        getFileSrcSpy.mockClear()
        const { target, app } = await mountWindowedSidebar()

        // Guard: a mounted avatar, resolved or still pending, has the 56 px size and classes.
        const avatar = target.querySelector('[data-char-id] .sidebar-avatar') as HTMLElement | null
        expect(avatar).toBeTruthy()
        expect(avatar!.style.width).toBe('56px')
        expect(avatar!.style.height).toBe('56px')
        expect(avatar!.classList.contains('sidebar-avatar')).toBe(true)
        expect(avatar!.classList.contains('rounded-md')).toBe(true)

        // A row outside the window is not mounted, so its lookup (not just its DOM) never starts.
        const farImage = DBState.db.characters[SB_N - 1].image
        expect(target.querySelector(`[data-char-id="${DBState.db.characters[SB_N - 1].chaId}"]`)).toBeNull()
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === farImage)).toBe(false)

        await teardown(target, app)
    })
})

describe('v11: a throwing IntersectionObserver constructor must fail open', () => {
    // `nearViewport(node, options)` calls `getOrCreateEntry` (which does
    // `new IO(...)`) synchronously, inline in the action's setup -- i.e.
    // inline in the effect Svelte runs to mount that `{#each}` item. There is
    // no error boundary anywhere in `GridCatalog`/`MobileCharacters`/
    // `Sidebar`/`AlertComp`, so `nearViewport.svelte.ts` itself must catch a
    // throwing constructor for every avatar to keep resolving.

    // Both tests below obtain a valid, already-mounted `app` handle before the
    // throwing fake ever runs (an empty character list, or Sidebar's
    // `menuSideBar` gate, means the initial mount drives zero `nearViewport`
    // calls). Only a later reactive update introduces the items whose
    // `use:nearViewport` first calls the throwing constructor, exercising a
    // throw during a later reactive mount rather than the initial one. This
    // also keeps `app` valid for cleanup in `finally` regardless of whether the
    // reactive update throws: an uncaught error from a `use:` action escapes
    // Svelte's own root boundary uncleaned, and a half-mounted, still-reactive
    // component left behind would keep reacting to later tests' `DBState.db`
    // reassignments and corrupt unrelated tests' target counts.

    test('grid layout still resolves every avatar when the constructor throws on a later, reactive mount', async () => {
        DBState.db = buildDb(0, 0) // no characters yet: initial mount drives zero nearViewport calls
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        vi.stubGlobal('IntersectionObserver', ThrowingIntersectionObserver)
        try {
            // A LATER reactive update populates the Simple tab's `{#each}`; each
            // item's `use:nearViewport` now calls the throwing constructor for
            // the first time.
            DBState.db = buildDb(V_N, 0)
            await settle(target)
            clickLayoutButton(target, 0)
            await settle(target)

            // Fail open: every avatar still resolves even though the observer
            // is unusable.
            expect(resolvedAvatarButtons(target).length).toBe(V_N)
            expect(avatarButtons(target).length).toBe(V_N)
        } finally {
            vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
            await unmount(app as never).catch(() => {})
            target.remove()
        }
    })

    test('Sidebar still renders every item with data-char-id when the constructor throws on a later, reactive mount', async () => {
        // Sidebar's own top-level `{#if DBState.db.menuSideBar}` gate lets us
        // mount with the item list absent (no `nearViewport` call fires at
        // all, since that branch has no items), then flip `menuSideBar` to
        // false afterward -- a genuine reactive mount of the item-bearing
        // branch on an already-mounted component.
        DBState.db = buildSidebarDb(V_N)
        DBState.db.menuSideBar = true
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)
        vi.stubGlobal('IntersectionObserver', ThrowingIntersectionObserver)
        try {
            DBState.db.menuSideBar = false
            await settle(target)

            // Fail open: same invariant as the grid case above.
            const idEls = Array.from(target.querySelectorAll('[data-char-id]'))
            expect(idEls.length).toBe(V_N)
        } finally {
            vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
            await unmount(app as never).catch(() => {})
            target.remove()
        }
    })
})

describe('v11c: a HALF-throwing constructor (near succeeds, far throws) must still fail open', () => {
    // See `HalfThrowingIntersectionObserver`'s own doc comment above for why
    // this fake exists and why the far band is the one made to throw (it is
    // the second construction in `nearViewport.svelte.ts`'s real call order,
    // confirmed by reading that file).
    //
    // The try/catch wrapping both `getOrCreateEntry` calls in
    // `nearViewport.svelte.ts` fails open and cleans up regardless of which
    // of the two constructions throws.
    //
    // Same later-reactive-mount and unmount-in-finally shape as v11 above
    // (see that describe block's own comment for the full rationale): an
    // empty character list drives zero `nearViewport` calls at initial mount,
    // so `app` is a valid, already-mounted handle before the half-throwing
    // fake is ever installed, and cleanup always runs in `finally` -- a
    // half-mounted, still-reactive component here can never leak into later
    // tests.
    function currentAlertType(): string {
        let type = ''
        const unsubscribe = alertStore.subscribe((value) => {
            type = (value as { type: string }).type
        })
        unsubscribe()
        return type
    }

    test('every avatar resolves, the created near instance is torn down empty, console.warn fires without an alert, and unmount does not throw', async () => {
        DBState.db = buildDb(0, 0) // no characters yet: initial mount drives zero nearViewport calls
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const alertBefore = currentAlertType()
        HalfThrowingIntersectionObserver.nearInstances.length = 0
        vi.stubGlobal('IntersectionObserver', HalfThrowingIntersectionObserver)

        let unmountError: unknown
        try {
            // A LATER reactive update populates the grid's `{#each}`; each
            // item's `use:nearViewport` now calls the half-succeeding
            // constructor for the first time.
            DBState.db = buildDb(V_N, 0)
            await settle(target)
            clickLayoutButton(target, 0)
            await settle(target)

            // Fail open: every avatar still resolves, exactly like v11's
            // always-throwing case, even though the near construction itself
            // succeeded before the far one threw.
            expect(resolvedAvatarButtons(target).length).toBe(V_N)
            expect(avatarButtons(target).length).toBe(V_N)

            // Precondition: at least one near instance was actually created
            // (otherwise the teardown assertions below would vacuously pass).
            expect(HalfThrowingIntersectionObserver.nearInstances.length).toBeGreaterThan(0)
            // Every near instance that WAS created gets torn down by the
            // catch block's `removeTarget(root, NEAR_MARGIN, node)`
            // (`nearViewport.svelte.ts` ~:280): the far construction throws
            // before that near entry's own `targets.set`/`observe` calls
            // ever run, so its target map is already empty when
            // `removeTarget` runs, and it disconnects immediately, holding
            // no targets.
            for (const inst of HalfThrowingIntersectionObserver.nearInstances) {
                expect(inst.disconnected).toBe(true)
                expect(inst.observed.size).toBe(0)
            }

            // The catch block's own fail-open warning fired, and nothing
            // routed this into the app's own alert UI.
            expect(warnSpy).toHaveBeenCalled()
            expect(currentAlertType()).toBe(alertBefore)
        } finally {
            vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
            try {
                await unmount(app as never)
            } catch (error) {
                unmountError = error
            } finally {
                target.remove()
                warnSpy.mockRestore()
            }
        }

        expect(unmountError).toBeUndefined()
    })
})

describe('v12: entries must leave the visible set when items unmount', () => {
    test('switching tabs away and back requires a fresh near entry per remounted item', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)
        getFileSrcSpy.mockClear()

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)
        // Sanity precondition: firing the first k resolves exactly k (same as v1).
        expect(resolvedAvatarButtons(target).length).toBe(V_K)

        // Switch away, then back -- no new entries fired for either hop.
        clickLayoutButton(target, 1)
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        // `nearViewport`'s `destroy()` calls `onChange(false)`, which removes
        // the destroyed node's index from `GridCatalog.svelte`'s shared
        // `visibleIndices`. The freshly remounted grid items for those same
        // indices therefore read `isVisible = visibleIndices.has(char.index)`
        // as `false` again, with no fresh near entry fired for their new nodes.
        expect(resolvedAvatarButtons(target).length).toBe(0)

        // Firing a fresh near entry for the same indices' new nodes resolves them
        // again, same as v1/v2.
        const targetsAfter = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targetsAfter.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)
        expect(resolvedAvatarButtons(target).length).toBe(V_K)

        await teardown(target, app)
    })

    test('narrowing then restoring the search requires a fresh near entry for the restored items', async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)
        getFileSrcSpy.mockClear()

        // Fire near for everything -- all V_N resolve.
        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)
        expect(resolvedAvatarButtons(target).length).toBe(V_N)

        // Narrow the search so only "Character 0" (index 0) survives; the rest
        // unmount.
        const searchInput = target.querySelector('input') as HTMLInputElement
        searchInput.value = 'Character 0'
        searchInput.dispatchEvent(new Event('input'))
        await settle(target)
        expect(avatarButtons(target).length).toBe(1)

        // Restore the search -- indices 1..V_N-1 remount as fresh DOM nodes.
        searchInput.value = ''
        searchInput.dispatchEvent(new Event('input'))
        await settle(target)

        // Index 0's node was never unmounted, so it stays correctly resolved.
        // Indices 1..V_N-1 are fresh nodes whose entries were removed from
        // `visibleIndices` on unmount, so they need their own fresh near entry,
        // which nothing here has fired yet.
        expect(resolvedAvatarButtons(target).length).toBe(1)

        // Firing a fresh near entry for the restored items resolves them.
        const targetsAfterRestore = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targetsAfterRestore.map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)
        expect(resolvedAvatarButtons(target).length).toBe(V_N)

        await teardown(target, app)
    })

    describe('v12b: ordering hazard on grid -> list', () => {
        test('a list item resolves once its own near entry fires after switching from grid, even without ever firing in grid mode', async () => {
            // Guards against an ordering hazard: if the OLD grid item's
            // destroy-time `onChange(false)` ran after the NEW list item's
            // `onChange(true)` add, it would incorrectly strip the just-added
            // index back out of `visibleIndices` and leave the freshly-fired
            // list item stuck on the placeholder. Never firing anything in grid
            // mode first isolates this from the stale-entry case in the tests
            // above: there is nothing stale to fall back on here, so if this
            // ever regresses to "does not resolve", it is this ordering hazard.
            DBState.db = buildDb(V_N, 0)
            getFileSrcSpy.mockClear()
            const { target, app } = mountGridCatalog()
            await settle(target)
            clickLayoutButton(target, 0)
            await settle(target)
            // Deliberately fire nothing in grid mode.
            clickLayoutButton(target, 1)
            await settle(target)
            getFileSrcSpy.mockClear()

            const listTargets = orderedTargets(instancesByMargin(NEAR_MARGIN))
            fireOn(
                instancesByMargin(NEAR_MARGIN),
                listTargets.slice(0, V_K).map((t) => ({ target: t, isIntersecting: true })),
            )
            await settle(target)

            expect(resolvedAvatarButtons(target).length).toBe(V_K)

            await teardown(target, app)
        })

        test('no IntersectionObserver global -- grid to list tab switch still resolves every list avatar (fail-open)', async () => {
            vi.stubGlobal('IntersectionObserver', undefined)
            try {
                DBState.db = buildDb(V_N, 0)
                getFileSrcSpy.mockClear()
                const { target, app } = mountGridCatalog()
                await settle(target)
                clickLayoutButton(target, 0)
                await settle(target)
                clickLayoutButton(target, 1)
                await settle(target)

                // Fail open calls `onChange(true)` unconditionally at every
                // mount, tab switch or not (v4 covers the single-layout case;
                // this is the grid -> list hop specifically).
                expect(resolvedAvatarButtons(target).length).toBe(V_N)
                expect(getFileSrcSpy.mock.calls.length).toBeGreaterThanOrEqual(V_N)

                await teardown(target, app)
            } finally {
                vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
            }
        })
    })

    test('Sidebar folder members mount and resolve when the folder opens, unmount when it closes, and resolve again on reopen; top-level items stay resolved', async () => {
        DBState.db = buildSidebarFolderDb(2, 3)
        getFileSrcSpy.mockClear()
        const { target, app } = await mountWindowedSidebar()

        // The two top-level characters resolve at mount; the closed folder's members
        // are not mounted and request nothing.
        const topImgs = Array.from(target.querySelectorAll('img.sidebar-avatar')) as HTMLImageElement[]
        expect(topImgs.length).toBe(2)
        expect(getFileSrcSpy.mock.calls.some((c) => String(c[0]).startsWith('assets/sb-mem-'))).toBe(false)

        // Open the folder. The folder's own toggle avatar is the one
        // `span.avatar` with no `data-char-id` (normal items and folder members
        // both get one; only the folder header itself does not, per
        // `Sidebar.svelte`'s `SidebarAvatar` calls).
        const folderAvatar = Array.from(target.querySelectorAll('span.avatar')).find(
            (el) => !el.hasAttribute('data-char-id'),
        ) as HTMLElement | undefined
        if (!folderAvatar) {
            throw new Error('folder toggle avatar not found')
        }
        folderAvatar.click()
        await settle(target)

        // The mounted members resolve their own avatars without any observer report.
        const imgCount = (): number => target.querySelectorAll('img.sidebar-avatar').length
        expect(imgCount()).toBe(5)

        // Close: the members unmount. Reopen: fresh member nodes mount and resolve again.
        folderAvatar.click()
        await settle(target)
        expect(imgCount()).toBe(2)
        folderAvatar.click()
        await settle(target)
        expect(imgCount()).toBe(5)

        // The top-level rows were never unmounted.
        const topNow = Array.from(target.querySelectorAll('img.sidebar-avatar')).filter((img) => topImgs.includes(img as HTMLImageElement))
        expect(topNow.length).toBe(2)

        await teardown(target, app)
    })
})

// Covers only the grid layout (`GridCatalog.svelte`) and Sidebar's
// normal-row avatar (`Sidebar.svelte`) -- proving that the wiring also
// survives THIS file's real, margin-banded `IntersectionObserver` fake
// (`fireOn`/`instancesByMargin`/`orderedTargets`), not just the simpler
// "everything visible immediately" fake `charlistAvatarLookups.svelte.test.ts`
// uses. The other six call sites (`GridCatalog.svelte`'s list and trash
// rows, `Sidebar.svelte`'s folder and folder-member rows, AlertComp's own
// selectChar dialog, `MobileCharacters.svelte`) are NOT covered here: each
// would need its own fixture (a trashed-character DB, a
// folder DB, an AlertComp mount, a mobile-layout mount) PLUS this file's own
// margin-band bookkeeping threaded through it, which is disproportionate to
// what it would add -- the wiring itself (does this call site route through
// `getAvatarThumbSrc`/`isThumbEligible` at all) is already proven for every
// one of those six sites by
// `charlistAvatarLookups.svelte.test.ts`'s own T12, against the same real
// `getCharImage`/`characters.ts` source. Re-proving that here would only
// additionally confirm that the margin-band observer doesn't somehow block
// the call, which grid+Sidebar-normal below already establish for both a
// CSS-background site and an `<img src>` site -- the two rendering shapes
// every other site's avatar also uses.
describe('T12: getAvatarThumbSrc is wired into the grid layout and Sidebar', () => {
    afterEach(() => {
        for (const key of Object.keys(thumbOverride)) {
            delete thumbOverride[key]
        }
        avatarThumbSpy.mockClear()
    })

    test("grid layout: firing near entries makes the spy receive each newly-visible character's loc", async () => {
        DBState.db = buildDb(V_N, 0)
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        const calledLocs = avatarThumbSpy.mock.calls.map((c) => c[0])
        for (const c of DBState.db.characters) {
            expect(calledLocs).toContain(c.image)
        }

        await teardown(target, app)
    })

    test('grid layout: a non-null thumbnail result renders as the background-url, bypassing the getFileSrc fallback', async () => {
        DBState.db = buildDb(V_N, 0)
        const targetLoc = DBState.db.characters[1].image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-lazy-grid-1'
        getFileSrcSpy.mockClear()
        const { target, app } = mountGridCatalog()
        await settle(target)
        clickLayoutButton(target, 0)
        await settle(target)

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.map((t) => ({ target: t, isIntersecting: true })),
        )
        await settle(target)

        const buttons = resolvedAvatarButtons(target)
        const thumbButton = buttons.find((b) => (b.getAttribute('style') ?? '').includes(`url("${thumbOverride[targetLoc]}")`))
        expect(thumbButton).toBeTruthy()
        expect(getFileSrcSpy.mock.calls.some((c) => c[0] === targetLoc)).toBe(false)

        await teardown(target, app)
    })

    test("Sidebar: firing near entries makes the spy receive each visible character's loc, and a non-null result renders as the <img> src", async () => {
        DBState.db = buildSidebarDb(V_N)
        const targetLoc = DBState.db.characters[0].image as string
        thumbOverride[targetLoc] = 'data:image/webp;base64,thumb-for-lazy-sidebar-0'
        getFileSrcSpy.mockClear()
        const { target, app } = mountSidebar()
        await settle(target)

        const targets = orderedTargets(instancesByMargin(NEAR_MARGIN))
        fireOn(
            instancesByMargin(NEAR_MARGIN),
            targets.map((t) => ({ target: t, isIntersecting: true })),
        )
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
})
