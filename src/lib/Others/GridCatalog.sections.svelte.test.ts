// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: an open folder is a section of rows. The flow before it ends
 * its row, the folder tile and its members fill rows that carry `data-charlist-folder` and the
 * folder's tint (rounded on the first and last row), and the flow resumes in a new row. The
 * tiles are ordinary cards: the window, the column-change anchor, the focus pin and the
 * `aria-setsize` count work on them as on any tile, and opening a folder moves no row above it.
 * Because a section re-parents the folder tile into a row of its own, the tile that was
 * activated is re-created by a toggle; the handler returns focus to it.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit where an open folder was an
 * ordinary run of the flow, or where the folder tile had no fallback for a picture that does
 * not load. `(F)` is a feature test of the section layout. `(G)` is a guard that may pass before
 * and after.
 *
 * MOCKED: the module set of `GridCatalog.folders.svelte.test.ts` (same directory). Geometry is
 * faked as in `GridCatalog.window.svelte.test.ts`: the container's width is a mutable value
 * every element reports, its height is 600 px and no row is ever measured, so every row is
 * the 64 px fallback.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
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

const { changeCharSpy, removeCharSpy, checkCharOrderSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    checkCharOrderSpy: vi.fn(),
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
        removeChar: removeCharSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { OPEN_FOLDERS_KEY } from '../SideBars/railMemory'
import { getFileSrc } from '../../ts/globalApi.svelte'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function makeFolder(id: string, name: string, data: string[], extra: Partial<folder> = {}): folder {
    return { id, name, data, color: '', ...extra }
}

function buildDb(characters: CharacterFixture[], order: OrderFixture): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        characterOrder: order,
        hideAllImages: false,
    } as unknown as Database
}

/** Characters 'Char A'.. with chaIds 'A'.. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
const lettered = (): CharacterFixture[] => LETTERS.map((letter) => makeCharacter(letter, `Char ${letter}`))
const numbered = (count: number): CharacterFixture[] => Array.from({ length: count }, (_, i) => makeCharacter(`id-${i}`, `Char ${i}`))
const ids = (characters: CharacterFixture[], from: number, to: number): string[] => characters.slice(from, to).map((c) => c.chaId)

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

function openFoldersRemembered(...folderIds: string[]): void {
    localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(folderIds))
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid: () => {} } }) as Record<string, unknown>
    try {
        await settle()
        const label = language.grid.trim()
        const btn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
        if (!btn) {
            throw new Error('Grid tab button not found')
        }
        btn.click()
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

interface Geometry {
    readonly writes: number[]
    scrollAndSettle(top: number): Promise<void>
}

/** Gives the container a 600 px height and a scroll position clamped to the list's total. */
function installGeometry(el: HTMLElement): Geometry {
    const height = 600
    let top = 0
    const writes: number[] = []
    const total = (): number => Number(el.getAttribute('data-charlist-total') ?? 0)
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            writes.push(value)
            top = Math.max(0, Math.min(value, Math.max(0, total() - height)))
        },
    })
    el.dispatchEvent(new Event('scroll'))
    return {
        writes,
        async scrollAndSettle(value) {
            top = value
            el.dispatchEvent(new Event('scroll'))
            await settleFrame()
        },
    }
}

/** Reports a size change of the container to the window's observer, as the browser does. */
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
    static reportContainer(el: Element): void {
        const owner = FakeResizeObserver.instances.find((instance) => instance.observed.has(el))
        if (!owner) {
            throw new Error('no observer watches the container')
        }
        owner.callback(
            [{ target: el, borderBoxSize: [{ blockSize: 0, inlineSize: 0 }], contentRect: { height: 0 } } as unknown as ResizeObserverEntry],
            owner as unknown as ResizeObserver,
        )
    }
}

interface RowView {
    folder: string | null
    classes: DOMTokenList
    names: string[]
}

/** The mounted rows in order: the folder they belong to, their classes and the name of each tile. */
const rowViews = (root: ParentNode): RowView[] =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-charlist-row]')).map((row) => ({
        folder: row.getAttribute('data-charlist-folder'),
        classes: row.classList,
        names: Array.from(row.querySelectorAll('[data-charlist-key]')).map((card) => card.querySelector('button')?.getAttribute('aria-label') ?? ''),
    }))

const rowNames = (root: ParentNode): string[][] => rowViews(root).map((row) => row.names)
const rowFolders = (root: ParentNode): Array<string | null> => rowViews(root).map((row) => row.folder)

const tileNamed = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
const cardOf = (root: ParentNode, name: string): Element | null => tileNamed(root, name)?.closest('[data-charlist-key]') ?? null

const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)

async function toggle(root: ParentNode, name: string): Promise<void> {
    const tile = folderTile(root, name)
    if (!tile) {
        throw new Error(`no folder tile named "${name}"`)
    }
    tile.click()
    await settle()
}

/** Four tiles fit (a tile is 56 px and a gap 8 px at 16 px per rem). */
const FOUR_COLUMNS = 312
const THREE_COLUMNS = 200
const TILE_ROW = 64
const MOST_TILES = 150

let containerWidth = FOUR_COLUMNS
let clientWidthDescriptor: PropertyDescriptor | undefined
const defaultFileSrc = async (loc: string): Promise<string> => `data:mock-image;loc=${loc}`

beforeEach(() => {
    localStorage.clear()
    containerWidth = FOUR_COLUMNS
    FakeResizeObserver.instances.length = 0
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(getFileSrc).mockImplementation(defaultFileSrc)
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

/** Chromium reports the loss of focus while the focused element is being removed; happy-dom does not. */
function emulateFocusoutOnRemove(): () => void {
    const originalRemove = Element.prototype.remove
    Element.prototype.remove = function (this: Element) {
        const active = document.activeElement
        if (active && this.contains(active)) {
            active.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
        }
        originalRemove.call(this)
    }
    return () => {
        Element.prototype.remove = originalRemove
    }
}

//#endregion

describe('Grid tab: an open folder is a section of rows', { timeout: 60_000 }, () => {
    test('(R) opening a folder ends the flow row before it and puts the folder tile and its members in tinted rows of their own', async () => {
        DBState.db = buildDb(lettered(), ['A', 'B', makeFolder('f1', 'F1', ['C', 'D', 'E', 'F', 'G']), 'H', 'I', 'J'] as OrderFixture)
        await withMounted(async (target) => {
            expect(rowNames(target)).toEqual([['Char A', 'Char B', 'F1', 'Char H'], ['Char I', 'Char J']])
            expect(rowFolders(target)).toEqual([null, null])

            await toggle(target, 'F1')

            expect(rowNames(target)).toEqual([['Char A', 'Char B'], ['F1', 'Char C', 'Char D', 'Char E'], ['Char F', 'Char G'], ['Char H', 'Char I', 'Char J']])
            expect(rowFolders(target)).toEqual([null, 'f1', 'f1', null])
            const rows = rowViews(target)
            expect(rows[1].classes.contains('bg-selected/20')).toBe(true)
            expect(rows[1].classes.contains('rounded-t-lg')).toBe(true)
            expect(rows[1].classes.contains('rounded-b-lg')).toBe(false)
            expect(rows[2].classes.contains('bg-selected/20')).toBe(true)
            expect(rows[2].classes.contains('rounded-b-lg')).toBe(true)
            expect(rows[2].classes.contains('rounded-t-lg')).toBe(false)
            for (const flow of [rows[0], rows[3]]) {
                expect(flow.classes.contains('bg-selected/20')).toBe(false)
                expect(flow.classes.contains('rounded-t-lg')).toBe(false)
            }
            // The flow keeps its own layout classes; a section row adds to them.
            expect(rows[1].classes.contains('justify-center')).toBe(true)
        })
    })

    test('(R) a section row takes the folder colour, and closing the folder restores the flow rows', async () => {
        const order = ['A', makeFolder('f1', 'F1', ['B', 'C'], { color: 'red' }), 'D'] as OrderFixture
        DBState.db = buildDb(lettered(), order)
        openFoldersRemembered('f1')
        await withMounted(async (target) => {
            const rows = rowViews(target)
            expect(rows.map((row) => row.names)).toEqual([['Char A'], ['F1', 'Char B', 'Char C'], ['Char D', 'Char E', 'Char F', 'Char G'], ['Char H', 'Char I', 'Char J']])
            expect(rows[1].classes.contains('bg-red-700/20')).toBe(true)

            await toggle(target, 'F1')
            expect(rowNames(target)).toEqual([['Char A', 'F1', 'Char D', 'Char E'], ['Char F', 'Char G', 'Char H', 'Char I'], ['Char J']])
            expect(rowFolders(target)).toEqual([null, null, null])
            expect(rowViews(target).every((row) => !row.classes.contains('bg-red-700/20'))).toBe(true)
        })
    })

    test('(F) a one-row section is rounded at both ends and its partial row stays centred like a flow row', async () => {
        DBState.db = buildDb(lettered(), ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'] as OrderFixture)
        openFoldersRemembered('f1')
        await withMounted((target) => {
            const section = rowViews(target)[1]
            expect(section.names).toEqual(['F1', 'Char B', 'Char C'])
            expect(section.classes.contains('rounded-t-lg')).toBe(true)
            expect(section.classes.contains('rounded-b-lg')).toBe(true)
            for (const row of Array.from(target.querySelectorAll('[data-charlist-row]'))) {
                expect(row.classList.contains('justify-center')).toBe(true)
                expect(row.classList.contains('supports-[justify-content:safe_center]:[justify-content:safe_center]')).toBe(true)
            }
        })
    })

    test('(F) two open folders next to each other make two sections with no flow row between them', async () => {
        DBState.db = buildDb(lettered(), ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E', 'F', 'G', 'H']), 'I', 'J'] as OrderFixture)
        openFoldersRemembered('f1', 'f2')
        await withMounted((target) => {
            expect(rowNames(target)).toEqual([['Char A'], ['F1', 'Char B', 'Char C'], ['F2', 'Char D', 'Char E', 'Char F'], ['Char G', 'Char H'], ['Char I', 'Char J']])
            expect(rowFolders(target)).toEqual([null, 'f1', 'f2', 'f2', null])
            const keys = Array.from(target.querySelectorAll('[data-charlist-key]')).map((card) => card.getAttribute('data-charlist-key'))
            expect(new Set(keys).size).toBe(keys.length)
        })
    })

    test('(F) an open folder first and an open folder last each leave no empty row', async () => {
        DBState.db = buildDb(lettered(), [makeFolder('f1', 'F1', ['A', 'B', 'C', 'D', 'E']), 'F'] as OrderFixture)
        openFoldersRemembered('f1')
        await withMounted((target) => {
            expect(rowNames(target)).toEqual([['F1', 'Char A', 'Char B', 'Char C'], ['Char D', 'Char E'], ['Char F', 'Char G', 'Char H', 'Char I'], ['Char J']])
            expect(rowFolders(target)).toEqual(['f1', 'f1', null, null])
        })

        DBState.db = buildDb(lettered(), ['A', 'B', makeFolder('f1', 'F1', ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])] as OrderFixture)
        await withMounted((target) => {
            expect(rowNames(target)).toEqual([['Char A', 'Char B'], ['F1', 'Char C', 'Char D', 'Char E'], ['Char F', 'Char G', 'Char H', 'Char I'], ['Char J']])
            expect(rowFolders(target)).toEqual([null, 'f1', 'f1', 'f1'])
            expect(rowViews(target)[3].classes.contains('rounded-b-lg')).toBe(true)
        })
    })
})

describe('Grid tab: focus across a toggle that re-parents the folder tile', { timeout: 60_000 }, () => {
    test('(R) the folder tile has focus after it is opened and after it is closed, with Chromium\'s focusout on removal emulated', async () => {
        DBState.db = buildDb(lettered(), ['A', 'B', makeFolder('f1', 'F1', ['C', 'D']), 'E', 'F'] as OrderFixture)
        await withMounted(async (target) => {
            const closed = folderTile(target, 'F1')!
            expect(rowNames(target)[0]).toEqual(['Char A', 'Char B', 'F1', 'Char E'])
            closed.focus()
            await settle()
            expect(document.activeElement).toBe(closed)

            const restore = emulateFocusoutOnRemove()
            try {
                closed.click()
                await settle()
                const opened = folderTile(target, 'F1')!
                // The tile moved into the section's row: its element is a new one.
                expect(opened).not.toBe(closed)
                expect(closed.isConnected).toBe(false)
                expect(opened.closest('[data-charlist-row]')?.getAttribute('data-charlist-folder')).toBe('f1')
                expect(opened.getAttribute('aria-expanded')).toBe('true')
                expect(document.activeElement).toBe(opened)

                opened.click()
                await settle()
                const closedAgain = folderTile(target, 'F1')!
                expect(closedAgain).not.toBe(opened)
                expect(opened.isConnected).toBe(false)
                expect(closedAgain.closest('[data-charlist-row]')?.getAttribute('data-charlist-folder')).toBeNull()
                expect(document.activeElement).toBe(closedAgain)
            } finally {
                restore()
            }
        })
    })

    test('(R) the focus restored after a toggle does not scroll the tile into view', async () => {
        DBState.db = buildDb(lettered(), ['A', 'B', makeFolder('f1', 'F1', ['C', 'D']), 'E', 'F'] as OrderFixture)
        await withMounted(async (target) => {
            const closed = folderTile(target, 'F1')!
            closed.focus()
            await settle()

            const originalFocus = HTMLElement.prototype.focus
            const calls: Array<{ element: HTMLElement, options: FocusOptions | undefined }> = []
            HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
                calls.push({ element: this, options })
                originalFocus.call(this, options)
            }
            const restore = emulateFocusoutOnRemove()
            try {
                closed.click()
                await settle()
                const opened = folderTile(target, 'F1')!
                expect(document.activeElement).toBe(opened)
                const refocus = calls.filter((call) => call.element === opened)
                expect(refocus.length).toBeGreaterThan(0)
                for (const call of refocus) {
                    expect(call.options?.preventScroll).toBe(true)
                }
            } finally {
                restore()
                HTMLElement.prototype.focus = originalFocus
            }
        })
    })

    test('(G) a toggle while focus is elsewhere does not move focus', async () => {
        DBState.db = buildDb(lettered(), ['A', 'B', makeFolder('f1', 'F1', ['C', 'D']), 'E', 'F'] as OrderFixture)
        await withMounted(async (target) => {
            const other = document.createElement('button')
            document.body.appendChild(other)
            try {
                other.focus()
                folderTile(target, 'F1')!.click()
                await settle()
                expect(document.activeElement).toBe(other)
            } finally {
                other.remove()
            }
        })
    })
})

describe('Grid tab: a folder tile whose picture does not load', { timeout: 60_000 }, () => {
    const withPicture = (extra: Partial<folder> = {}): void => {
        DBState.db = buildDb(lettered(), ['A', makeFolder('f1', 'F1', ['B', 'C'], { color: 'blue', imgFile: 'assets/folder.png', ...extra })] as OrderFixture)
    }

    test('(R) a picture whose file source gives nothing leaves the folder icon on the tile', async () => {
        withPicture()
        vi.mocked(getFileSrc).mockImplementation(async () => '')
        await withMounted(async (target) => {
            await settleFrame()
            const tile = folderTile(target, 'F1')!
            expect(tile.querySelector('svg')).not.toBeNull()
            expect(tile.querySelector('[style*="background"]')).toBeNull()
        })
    })

    test('(R) a picture whose file source fails leaves the folder icon, or the name when the setting asks for it', async () => {
        withPicture()
        vi.mocked(getFileSrc).mockImplementation(async () => {
            throw new Error('missing')
        })
        await withMounted(async (target) => {
            await settleFrame()
            expect(folderTile(target, 'F1')!.querySelector('svg')).not.toBeNull()
            expect(folderTile(target, 'F1')!.textContent?.trim()).toBe('')

            DBState.db.showFolderName = true
            await settle()
            expect(folderTile(target, 'F1')!.textContent?.trim()).toBe('F1')
            expect(folderTile(target, 'F1')!.querySelector('svg')).toBeNull()
        })
    })

    test('(R) hiding all images leaves the folder icon', async () => {
        withPicture()
        DBState.db.hideAllImages = true
        await withMounted(async (target) => {
            await settleFrame()
            expect(folderTile(target, 'F1')!.querySelector('svg')).not.toBeNull()
        })
    })

    test('(R) a picture that loads still shows the folder icon over it, or the name when the setting asks for it', async () => {
        withPicture()
        await withMounted(async (target) => {
            await settleFrame()
            const tile = folderTile(target, 'F1')!
            expect(tile.querySelector('[style*="data:mock-image;loc=assets/folder.png"]')).not.toBeNull()
            expect(tile.querySelector('svg')).not.toBeNull()
            expect(tile.textContent?.trim()).toBe('')

            DBState.db.showFolderName = true
            await settle()
            expect(tile.querySelector('[style*="data:mock-image;loc=assets/folder.png"]')).not.toBeNull()
            expect(tile.querySelector('svg')).toBeNull()
            expect(tile.textContent?.trim()).toBe('F1')
            expect(tile.getAttribute('aria-label')).toBe('F1')
        })
    })

    test('(R) a toggle of another folder keeps a folder picture that has loaded, and looks it up once', async () => {
        DBState.db = buildDb(lettered(), [makeFolder('f1', 'F1', ['A'], { imgFile: 'assets/one.png' }), makeFolder('f2', 'F2', ['B'], { imgFile: 'assets/two.png' }), 'C'] as OrderFixture)
        const seen = new Map<string, number>()
        // The first lookup of a picture resolves; a repeat lookup never settles, so a tile that asks again shows its pending span.
        vi.mocked(getFileSrc).mockImplementation((loc: string) => {
            seen.set(loc, (seen.get(loc) ?? 0) + 1)
            return seen.get(loc) === 1 ? Promise.resolve(`data:mock-image;loc=${loc}`) : new Promise<string>(() => {})
        })
        await withMounted(async (target) => {
            await settleFrame()
            const pictureOf = (name: string) => folderTile(target, name)!.querySelector('[style*="data:mock-image"]')
            expect(pictureOf('F1')).not.toBeNull()
            expect(pictureOf('F2')).not.toBeNull()

            await toggle(target, 'F2')

            expect(pictureOf('F1')).not.toBeNull()
            expect(seen.get('assets/one.png')).toBe(1)
        })
    })

    test('(G) hiding all images while a picture is shown leaves the folder icon, and showing them again restores it', async () => {
        withPicture()
        await withMounted(async (target) => {
            await settleFrame()
            expect(folderTile(target, 'F1')!.querySelector('[style*="data:mock-image"]')).not.toBeNull()

            DBState.db.hideAllImages = true
            await settleFrame()
            expect(folderTile(target, 'F1')!.querySelector('svg')).not.toBeNull()
            expect(folderTile(target, 'F1')!.querySelector('[style*="background"]')).toBeNull()

            DBState.db.hideAllImages = false
            await settleFrame()
            expect(folderTile(target, 'F1')!.querySelector('[style*="data:mock-image"]')).not.toBeNull()
        })
    })

    test('(G) a folder without a picture keeps the icon', async () => {
        withPicture({ imgFile: '' })
        await withMounted((target) => {
            expect(folderTile(target, 'F1')!.querySelector('svg')).not.toBeNull()
        })
    })
})

describe('Grid tab: the window over sections', { timeout: 60_000 }, () => {
    /** `before` characters of the flow, a folder of 100 members, the rest of the 300 characters of the flow. */
    const bigFolder = (before = 60): CharacterFixture[] => {
        const characters = numbered(300)
        DBState.db = buildDb(characters, [...ids(characters, 0, before), makeFolder('big', 'Big', ids(characters, before, before + 100)), ...ids(characters, before + 100, 300)] as OrderFixture)
        return characters
    }

    test('(F) a column change with an open section keeps the first visible tile at the top', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        bigFolder(61)
        openFoldersRemembered('big')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const geometry = installGeometry(scroller)
            await settleFrame()
            // 16 flow rows (the last holds one tile), then the section: the tile and 100 members in 26 rows, then 35 flow rows.
            expect(Number(scroller.getAttribute('data-charlist-total'))).toBe((16 + 26 + 35) * TILE_ROW)
            // Section row 10 holds its cards 40 to 43; card 40 is the 40th member, 'Char 100'. The top is 10 px into it.
            await geometry.scrollAndSettle((16 + 10) * TILE_ROW + 10)
            expect(rowNames(target).some((names) => names[0] === 'Char 100')).toBe(true)
            geometry.writes.length = 0

            containerWidth = THREE_COLUMNS
            FakeResizeObserver.reportContainer(scroller)
            await settleFrame()

            // At three per row the flow is 21 rows, and card 40 of the section lies in its row 13 (cards 39 to 41).
            expect(Number(scroller.getAttribute('data-charlist-total'))).toBe((21 + 34 + 47) * TILE_ROW)
            expect(geometry.writes.at(-1)).toBe((21 + 13) * TILE_ROW + 10)
            const row = rowViews(target).find((view) => view.names.includes('Char 100'))
            expect(row?.names).toEqual(['Char 99', 'Char 100', 'Char 101'])
            expect(row?.folder).toBe('big')
            expect(rowViews(target).every((view) => view.names.length <= 3)).toBe(true)
        })
    })

    test('(F) opening and closing a folder keep the scroll position and the tile at the top', async () => {
        const characters = numbered(100)
        DBState.db = buildDb(characters, [...ids(characters, 0, 6), makeFolder('f1', 'F1', ids(characters, 6, 56)), ...ids(characters, 56, 100)] as OrderFixture)
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const geometry = installGeometry(scroller)
            await settleFrame()
            // Row 1 holds 'Char 4', 'Char 5', the folder tile and 'Char 56'; the top is 10 px into it.
            await geometry.scrollAndSettle(TILE_ROW + 10)
            expect(rowNames(target)[1]).toEqual(['Char 4', 'Char 5', 'F1', 'Char 56'])
            geometry.writes.length = 0
            const totalClosed = Number(scroller.getAttribute('data-charlist-total'))

            await toggle(target, 'F1')
            await settleFrame()
            // The row at the top is the flow row before the section, now short.
            expect(rowNames(target).slice(0, 3)).toEqual([['Char 0', 'Char 1', 'Char 2', 'Char 3'], ['Char 4', 'Char 5'], ['F1', 'Char 6', 'Char 7', 'Char 8']])
            expect(scroller.scrollTop).toBe(TILE_ROW + 10)
            expect(geometry.writes).toEqual([])
            expect(Number(scroller.getAttribute('data-charlist-total'))).toBeGreaterThan(totalClosed)

            await toggle(target, 'F1')
            await settleFrame()
            expect(rowNames(target)[1]).toEqual(['Char 4', 'Char 5', 'F1', 'Char 56'])
            expect(scroller.scrollTop).toBe(TILE_ROW + 10)
            expect(geometry.writes).toEqual([])
            expect(Number(scroller.getAttribute('data-charlist-total'))).toBe(totalClosed)
        })
    })

    test('(G) 300 characters with an open folder of 100 mount a bounded window, count the tiles emitted and pin a focused tile', async () => {
        bigFolder()
        openFoldersRemembered('big')
        await withMounted(async (target) => {
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            // Member 'Char 150' is the 91st member: 60 flow tiles, the folder tile and 90 members come before it.
            // It sits in section row 22 (card 91), row 15 + 22 = 37 of the list.
            await geometry.scrollAndSettle(37 * TILE_ROW)
            const mounted = target.querySelectorAll('[data-charlist-key]').length
            expect(mounted).toBeGreaterThan(0)
            expect(mounted).toBeLessThan(MOST_TILES)
            expect(tileNamed(target, 'Char 0')).toBeNull()
            const card = cardOf(target, 'Char 150')!
            expect(card).not.toBeNull()
            // 301 tiles in all (the folder tile and 300 characters); the member comes after 60 + 1 + 90 tiles.
            expect(card.getAttribute('aria-setsize')).toBe('301')
            expect(card.getAttribute('aria-posinset')).toBe('152')

            tileNamed(target, 'Char 150')!.focus()
            await settle()
            await geometry.scrollAndSettle(0)
            expect(tileNamed(target, 'Char 150')).not.toBeNull()
            expect(document.activeElement).toBe(tileNamed(target, 'Char 150'))
        })
    })
})
