/**
 * MEASUREMENT (not a regression test) for the character-list search change:
 * how much work one burst of typing in the GridCatalog search box causes.
 *
 * WHAT IT MEASURES, per layout (simple, grid) and per N (500, 1000), for three
 * bursts of three keystrokes that end by matching 100%, 10% and 0% of the list:
 *
 *   - hiddenCalls: calls to `isHiddenSystemCharacter` during the burst. Every
 *     pass over `db.characters` (the header count, the layout's own filter,
 *     MobileCharacters' sort pass, the search index) calls it once per slot, so
 *     the count is a proxy for the number of full scans, not a timing.
 *   - domAdded / domRemoved: elements inserted into and removed from the mounted
 *     tree during the burst (a subtree counts every element in it), i.e. DOM
 *     churn. The same burst on an unchanged final list still churns when each
 *     keystroke rebuilds the rows.
 *   - observes / unobserves: IntersectionObserver registrations the rows made.
 *   - domAfter: total elements once the burst has settled.
 *
 * HOW THE BURST IS DRIVEN: after each keystroke the real Svelte runtime is
 * flushed, and after the third keystroke the fake clock advances past the
 * debounce window (a no-op on a base without a debounce) before the final
 * settle. Only setTimeout/clearTimeout are faked, so `Date` stays real.
 *
 * LIMITS: happy-dom has no layout, so these are counts, never timings. The
 * IntersectionObserver is a fake that reports every observed element visible
 * at once, so it cannot show the near/far gating. The module set matches
 * `GridCatalog.hiddenCharacters.svelte.test.ts`; nothing here touches storage.
 * The numbers describe search work and DOM/observer churn only; they say
 * nothing about avatar loading.
 *
 * RUN:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/charlist-search-count.svelte.harness.ts --reporter=verbose
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../../src/ts/platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { hiddenCalls, observerCounts } = vi.hoisted(() => ({
    hiddenCalls: { n: 0 },
    observerCounts: { observe: 0, unobserve: 0 },
}))

vi.mock(import('src/ts/hiddenCharacters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        isHiddenSystemCharacter: (char: { chaId?: string } | null | undefined) => {
            hiddenCalls.n++
            return actual.isHiddenSystemCharacter(char)
        },
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
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
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

vi.mock(import('../../../src/ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        observerCounts.observe++
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {
        observerCounts.unobserve++
    }
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

import { DBState } from '../../../src/ts/stores.svelte'
import { language } from '../../../src/lang'
import GridCatalog from '../../../src/lib/Others/GridCatalog.svelte'

//#region fixture and helpers

type CharacterFixture = Database['characters'][number]

/**
 * Every name contains "Character"; every 10th also contains "Zed". So the
 * bursts C-Ch-Cha, Z-Ze-Zed and Q-Qq-Qqq end on 100%, 10% and 0% of the list.
 */
function buildDb(n: number): Database {
    const characters: CharacterFixture[] = []
    for (let i = 0; i < n; i++) {
        characters.push({
            chaId: `char-${i}`,
            name: `Character ${i}${i % 10 === 0 ? ' Zed' : ''}`,
            type: 'character',
            image: `assets/${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: i,
            chats: [{ id: `char-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
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

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
    }
    flushSync()
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 3): void {
    const label = (layout === 0 ? language.grid : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

function setSearchValue(root: HTMLElement, value: string): void {
    const input = root.querySelector('input[type="text"]') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function countEls(node: Node): number {
    if (node.nodeType !== 1) {
        return 0
    }
    return 1 + (node as Element).querySelectorAll('*').length
}

interface Row {
    n: number
    layout: string
    burst: string
    hiddenCalls: number
    domAdded: number
    domRemoved: number
    observes: number
    unobserves: number
    domAfter: number
}

const rows: Row[] = []

const BURSTS: { label: string; keys: string[] }[] = [
    { label: '100%', keys: ['C', 'Ch', 'Cha'] },
    { label: '10%', keys: ['Z', 'Ze', 'Zed'] },
    { label: '0%', keys: ['Q', 'Qq', 'Qqq'] },
]

async function measure(n: number, layout: 0 | 3): Promise<void> {
    DBState.db = buildDb(n)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
    await settle()
    if (layout !== 3) {
        clickLayoutButton(target, layout)
        await settle()
    }

    let added = 0
    let removed = 0
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                added += countEls(node)
            })
            record.removedNodes.forEach((node) => {
                removed += countEls(node)
            })
        }
    })
    observer.observe(target, { childList: true, subtree: true })

    for (const burst of BURSTS) {
        setSearchValue(target, '')
        vi.advanceTimersByTime(1000)
        await settle()
        observer.takeRecords()
        added = 0
        removed = 0
        hiddenCalls.n = 0
        observerCounts.observe = 0
        observerCounts.unobserve = 0

        for (const key of burst.keys) {
            setSearchValue(target, key)
            await settle()
        }
        vi.advanceTimersByTime(1000)
        await settle()
        await Promise.resolve()

        rows.push({
            n,
            layout: layout === 0 ? 'grid' : 'simple',
            burst: burst.label,
            hiddenCalls: hiddenCalls.n,
            domAdded: added,
            domRemoved: removed,
            observes: observerCounts.observe,
            unobserves: observerCounts.unobserve,
            domAfter: target.querySelectorAll('*').length,
        })
    }

    observer.disconnect()
    await unmount(app as never)
    target.remove()
}

//#endregion

describe('charlist-search-count: typing bursts against GridCatalog', { timeout: 300_000 }, () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterAll(() => {
        vi.useRealTimers()
    })

    test('N=500 and N=1000, simple and grid, then print the table', async () => {
        for (const n of [500, 1000]) {
            await measure(n, 3)
            await measure(n, 0)
        }
        console.log('\n=== charlist-search-count (happy-dom, all-visible IntersectionObserver fake; counts only) ===')
        console.table(rows)
        expect(rows.length).toBe(12)
    })
})
