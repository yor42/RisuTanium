// @vitest-environment happy-dom

/**
 * The mobile character screen as `MobileBody.svelte` mounts it (`MobileGUIStack` = 1) with 200
 * characters and 150 trashed ones: the list and the trash view mount only the rows near their
 * scroll viewport, the Trash (n) and Back rows stay outside the scroller, and Back from the trash
 * returns to the character that was at the top, not to the pixel offset.
 *
 * Fixture size: 200 live and 150 trashed characters in a happy-dom document that is 768 px high.
 * Counts for 1000 and 2000 characters live in the `charlist-window-count` harness.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the windowed lists with an
 * assertion about the defect (every row mounted). `(F)` is a feature test: it asserts the list
 * container or the restore, which do not exist before. `(G)` is a guard that may pass before and
 * after.
 *
 * MOCKED: the module set of `MobileBody.trash.svelte.test.ts` (same directory). The container's
 * height and scroll position are faked on `HTMLElement.prototype`, and row heights arrive through
 * a ResizeObserver that reports on demand, as in `src/lib/Others/CharacterWindow.svelte.test.ts`.
 * Nothing here writes to storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

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

const { changeCharSpy, restoreSpy, removeCharSpy, removeTrashedSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    restoreSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    removeTrashedSpy: vi.fn(),
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
    const { DBState } = await import('../../ts/stores.svelte')
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

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable(1),
        MobileSideBar: writable(0),
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
        restoreCharacterFromTrash: restoreSpy,
        removeChar: removeCharSpy,
        removeTrashedCharacters: removeTrashedSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock('../Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../UI/Realm/RealmMain.svelte', () => ({ default: () => {} }))
vi.mock('../ChatScreens/ChatScreen.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/DevTool.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState, MobileSearch } from '../../ts/stores.svelte'
import { language } from '../../lang'
import MobileBody from './MobileBody.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const LIVE = 200
const TRASHED = 150
const MOST_MOUNTED = 60
const GONE = 1_700_000_000_000

function makeCharacters(): CharacterFixture[] {
    const live = Array.from({ length: LIVE }, (_, i) => ({
        chaId: `live-${i}`,
        name: `Character ${i}`,
        type: 'character',
        image: '',
        creatorNotes: `Description ${i}`,
        chatPage: 0,
        // The list is most recent first: Character 199 is the first row.
        lastInteraction: i + 1,
        chats: [{ id: `live-${i}-chat`, message: [], note: '', name: '', localLore: [] }],
    }))
    const gone = Array.from({ length: TRASHED }, (_, j) => ({
        chaId: `gone-${j}`,
        name: `Trashed ${j}`,
        type: 'character',
        image: '',
        creatorNotes: `Gone ${j}`,
        chatPage: 0,
        lastInteraction: 0,
        trashTime: GONE + j,
        chats: [{ id: `gone-${j}-chat`, message: [], note: '', name: '', localLore: [] }],
    }))
    return [...live, ...gone] as unknown as CharacterFixture[]
}

function buildDb(characters: CharacterFixture[]): Database {
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
    }
    flushSync()
}

async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await settle()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileBody, { target, props: {} }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

const VIEWPORT = 600

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
            sizes.map(([target, blockSize]) => ({ target, borderBoxSize: [{ blockSize, inlineSize: 300 }], contentRect: { height: blockSize } }) as unknown as ResizeObserverEntry),
            this as unknown as ResizeObserver,
        )
    }
}

/** The observer of the window that is mounted now. */
const observer = (): FakeResizeObserver => FakeResizeObserver.instances.at(-1)!

let restoreGeometry: () => void = () => {}

/** A container height of `VIEWPORT` and a scroll position clamped to the list's total, for every element. */
function installGeometry(): () => void {
    const tops = new WeakMap<Element, number>()
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
            return tops.get(this) ?? 0
        },
        set(this: HTMLElement, value: number) {
            const total = Number(this.getAttribute('data-charlist-total') ?? Number.POSITIVE_INFINITY)
            tops.set(this, Math.max(0, Math.min(value, Math.max(0, total - VIEWPORT))))
        },
    })
    return () => {
        for (const [name, descriptor] of [['clientHeight', clientHeight], ['scrollTop', scrollTop]] as const) {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor)
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
            }
        }
    }
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

async function scrollAndSettle(root: ParentNode, top: number): Promise<void> {
    const el = scrollerOf(root)
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
    await settleFrame()
}

const rowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')
const trashRowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
const buttonWith = (root: ParentNode, text: string): HTMLButtonElement | undefined => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
const trashEntryLabel = `${language.trash} (${TRASHED})`

/**
 * The name of the row under the top edge of the list, from the rows' modelled heights: a row
 * measured at `MEASURED` px, any other at `FALLBACK` px, spacers as rendered.
 */
const FALLBACK = 73
const MEASURED = 120
function topRowName(target: HTMLElement, measured: ReadonlySet<string>): string {
    const scroller = scrollerOf(target)
    const top = scroller.scrollTop
    let y = 0
    for (const child of Array.from(scroller.children) as HTMLElement[]) {
        if (child.hasAttribute('data-charlist-spacer')) {
            y += Number.parseFloat(child.style.height)
            continue
        }
        const name = child.querySelector('div.flex-1 > span:first-child')!.textContent!.trim()
        const height = measured.has(name) ? MEASURED : FALLBACK
        if (y <= top && top < y + height) {
            return name
        }
        y += height
    }
    throw new Error(`no mounted row holds the list top (${top})`)
}

beforeEach(() => {
    changeCharSpy.mockClear()
    restoreSpy.mockClear()
    removeCharSpy.mockClear()
    removeTrashedSpy.mockClear()
    FakeResizeObserver.instances.length = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    restoreGeometry = installGeometry()
    DBState.db = buildDb(makeCharacters())
})

afterEach(() => {
    vi.unstubAllGlobals()
    restoreGeometry()
    MobileSearch.set('')
})

//#endregion

describe('MobileBody: the character list and the trash view mount a bounded window', { timeout: 60_000 }, () => {
    test('(R) the list mounts a bounded number of rows of 200 characters', async () => {
        await withMounted((target) => {
            const rows = rowNames(target).length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
            expect(rowNames(target)[0]).toBe(`Character ${LIVE - 1}`)
        })
    })

    test('(R) the trash view mounts a bounded number of rows of 150 trashed characters', async () => {
        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel)!.click()
            await settle()
            const rows = trashRowNames(target).length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(F) the Trash (n) row and the Back row stay outside the scroller, and the Trash row is still there when the list is scrolled', async () => {
        await withMounted(async (target) => {
            await scrollAndSettle(target, 5000)
            const trashRow = buttonWith(target, trashEntryLabel)!
            expect(trashRow).toBeDefined()
            expect(scrollerOf(target).contains(trashRow)).toBe(false)

            trashRow.click()
            await settle()
            const back = buttonWith(target, language.settingsPage.back)!
            expect(back).toBeDefined()
            expect(scrollerOf(target).contains(back)).toBe(false)
        })
    })

    test('(F) the trash view opens at the top and its actions work on a scrolled row', async () => {
        await withMounted(async (target) => {
            await scrollAndSettle(target, 5000)
            buttonWith(target, trashEntryLabel)!.click()
            await settle()
            expect(scrollerOf(target).scrollTop).toBe(0)
            expect(trashRowNames(target)).toContain('Trashed 0')

            await scrollAndSettle(target, 8000)
            const heading = Array.from(target.querySelectorAll('h4'))[3]
            const index = DBState.db.characters.findIndex((c) => c.name === heading.textContent?.trim())
            const actions = heading.parentElement!.querySelectorAll<HTMLButtonElement>('.justify-end button')
            actions[0].click()
            expect(restoreSpy).toHaveBeenCalledWith(DBState.db.characters[index])
            actions[1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[index], heading.textContent?.trim(), 'permanent')
        })
    })

    // Guard: the add button is hidden while the trash view covers the screen and returns with the list.
    test('(G) the add button is hidden in the trash view and back after it', async () => {
        await withMounted(async (target) => {
            const fab = (): Element | null => target.querySelector('.absolute.bottom-2.right-2')
            expect(fab()).not.toBeNull()
            buttonWith(target, trashEntryLabel)!.click()
            await settle()
            expect(fab()).toBeNull()
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            expect(fab()).not.toBeNull()
        })
    })
})

describe('MobileBody: Back from the trash returns to the character that was at the top', { timeout: 60_000 }, () => {
    // Feature test: the list is unmounted while the trash view is open, so the position is kept as
    // the row at the top and the offset into it, against the row heights measured before.
    test('(F) with rows measured taller than the fallback, Back shows the same first character, not the same pixel offset', async () => {
        await withMounted(async (target) => {
            await scrollAndSettle(target, 3000)
            await settleFrame()

            // Every mounted row turns out taller than the height the list assumed for it.
            const measured = new Set<string>()
            const sizes: Array<[Element, number]> = []
            for (const row of Array.from(scrollerOf(target).querySelectorAll('[role="listitem"]'))) {
                measured.add(row.querySelector('div.flex-1 > span:first-child')!.textContent!.trim())
                sizes.push([row, MEASURED])
            }
            observer().report(sizes)
            flushSync()
            await settleFrame()

            const before = topRowName(target, measured)
            const scrollBefore = scrollerOf(target).scrollTop
            const totalBefore = scrollerOf(target).getAttribute('data-charlist-total')
            expect(scrollBefore).toBeGreaterThan(0)

            buttonWith(target, trashEntryLabel)!.click()
            await settle()
            expect(scrollerOf(target).querySelector('[role="listitem"]')).not.toBeNull()
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            await settleFrame()

            expect(topRowName(target, measured)).toBe(before)
            expect(rowNames(target)).toContain(before)
            // The measured heights outlived the unmounted list: the new list has the same total height.
            expect(scrollerOf(target).getAttribute('data-charlist-total')).toBe(totalBefore)
        })
    })

    test('(F) a search that changed while the trash was open drops the saved position: Back shows the top of the new list', async () => {
        await withMounted(async (target) => {
            await scrollAndSettle(target, 3000)
            expect(scrollerOf(target).scrollTop).toBeGreaterThan(0)
            buttonWith(target, trashEntryLabel)!.click()
            await settle()

            // Every character matches, so the row that was at the top is still in the list.
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                MobileSearch.set('Character')
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settle()
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            await settleFrame()

            expect(scrollerOf(target).scrollTop).toBe(0)
            expect(rowNames(target)[0]).toBe(`Character ${LIVE - 1}`)
        })
    })
    test('(F) Back from a list that was never scrolled shows the top of the list', async () => {
        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel)!.click()
            await settle()
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            await settleFrame()
            expect(scrollerOf(target).scrollTop).toBe(0)
            expect(rowNames(target)[0]).toBe(`Character ${LIVE - 1}`)
        })
    })
})
