// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` List tab: each description is rendered as markdown once
 * its row is mounted (a row outside the list's window does not exist, so it is
 * never parsed), clamped, and a "Show more"
 * toggle appears only when the clamp actually cuts the text off. Expanded, the
 * toggle reads "Show less". The toggle belongs to its row, never opens the
 * character, and follows resizes and text changes.
 *
 * LAYOUT SEAM: happy-dom has no layout, so the geometry getters of
 * `HTMLElement` are replaced by a stand-in: an element whose text contains
 * LONG is 100 tall and only 60 tall while it carries the clamp class, every
 * other element fits. The clamp measurement itself is the real one.
 *
 * MOCKED: the module set of `GridCatalog.pick.svelte.test.ts` (same
 * directory), plus a stand-in `ParseMarkdown`. Nothing here writes to storage.
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

const { changeCharSpy, parseSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    parseSpy: vi.fn(async (text: string) => `<p>${text}</p>`),
}))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ParseMarkdown: parseSpy,
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

/**
 * A ResizeObserver that reports on demand. `fireAll` reports only the description blocks the clamp
 * checks watch, not the rows the list's window measures: a clamp re-check is what these tests drive.
 */
class ControlledResizeObserver {
    static instances: ControlledResizeObserver[] = []
    readonly targets = new Set<Element>()

    constructor(readonly callback: ResizeObserverCallback) {
        ControlledResizeObserver.instances.push(this)
    }

    observe(target: Element): void {
        this.targets.add(target)
    }
    unobserve(target: Element): void {
        this.targets.delete(target)
    }
    disconnect(): void {
        this.targets.clear()
    }
    static fireAll(): void {
        for (const instance of ControlledResizeObserver.instances) {
            const watched = Array.from(instance.targets).filter((target) => target.hasAttribute('data-description'))
            if (watched.length > 0) {
                instance.callback(watched.map((target) => ({ target, contentRect: { height: 0 } }) as unknown as ResizeObserverEntry), instance as unknown as ResizeObserver)
            }
        }
    }
}

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { clearDescriptionCache } from '../../ts/gui/descriptionMarkdown'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const CLAMP_CLASS = 'max-h-18'
let fitsEverywhere = false

function installLayoutStandIn(): () => void {
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
            return !fitsEverywhere && this.textContent?.includes('LONG') ? 100 : 20
        },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
            return !fitsEverywhere && this.textContent?.includes('LONG') && this.classList.contains(CLAMP_CLASS) ? 60 : this.textContent?.includes('LONG') && !fitsEverywhere ? 100 : 20
        },
    })
    return () => {
        if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight)
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
        if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    }
}

function makeCharacter(chaId: string, name: string, creatorNotes: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes,
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
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
    for (let i = 0; i < 8; i++) {
        flushSync()
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    flushSync()
}

async function withList(endGrid: () => void, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
    try {
        await settle()
        const list = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.list)!
        list.click()
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function listRow(root: HTMLElement, name: string): HTMLElement {
    const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    const row = heading?.closest<HTMLElement>('.border-darkborderc')
    if (!row) {
        throw new Error(`list row not found for "${name}"`)
    }
    return row
}

/** The windowed list's container. */
function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

/** Gives the container a height and a scroll position (happy-dom has no layout) and lets the window read them. */
function installGeometry(el: HTMLElement, height: number): { scrollAndSettle(top: number): Promise<void> } {
    let top = 0
    const total = (): number => Number(el.getAttribute('data-charlist-total') ?? 0)
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            top = Math.max(0, Math.min(value, Math.max(0, total() - height)))
        },
    })
    el.dispatchEvent(new Event('scroll'))
    return {
        async scrollAndSettle(value) {
            top = value
            el.dispatchEvent(new Event('scroll'))
            await settleFrame()
        },
    }
}

async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    flushSync()
    await Promise.resolve()
    flushSync()
}

function toggleOf(row: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(row.querySelectorAll('button')).find((b) => /^Show (more|less)$/.test(b.textContent?.trim() ?? ''))
}

function clampElement(row: HTMLElement): HTMLElement {
    const el = row.querySelector<HTMLElement>('[data-description]')
    if (!el) {
        throw new Error('description element not found')
    }
    return el
}

const characters = (): CharacterFixture[] => [
    makeCharacter('a', 'Ann', 'LONG text that runs past three lines'),
    makeCharacter('b', 'Bob', 'short text'),
    makeCharacter('c', 'Cat', 'LONG another long text'),
]

let restoreLayout: () => void = () => {}

beforeEach(() => {
    changeCharSpy.mockClear()
    parseSpy.mockReset()
    parseSpy.mockImplementation(async (text: string) => `<p>${text}</p>`)
    clearDescriptionCache()
    fitsEverywhere = false
    ControlledResizeObserver.instances.length = 0
    restoreLayout = installLayoutStandIn()
})

afterEach(() => {
    restoreLayout()
    vi.stubGlobal('ResizeObserver', undefined)
})

//#endregion

describe('GridCatalog List tab: Show more', { timeout: 60_000 }, () => {
    test('the toggle labels come from the language table', () => {
        expect(language.othersUi.showMore).toBe('Show more')
        expect(language.othersUi.showLess).toBe('Show less')
    })

    test('appears only on rows whose text is actually cut off', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), (target) => {
            expect(toggleOf(listRow(target, 'Ann'))?.textContent?.trim()).toBe('Show more')
            expect(toggleOf(listRow(target, 'Bob'))).toBeUndefined()
            expect(toggleOf(listRow(target, 'Cat'))?.textContent?.trim()).toBe('Show more')
        })
    })

    test('expands the one row to the full text and reads Show less, then collapses back', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            const row = listRow(target, 'Ann')
            expect(clampElement(row).classList.contains(CLAMP_CLASS)).toBe(true)

            toggleOf(row)!.click()
            await settle()
            expect(clampElement(row).classList.contains(CLAMP_CLASS)).toBe(false)
            expect(toggleOf(row)?.textContent?.trim()).toBe('Show less')
            expect(toggleOf(row)?.getAttribute('aria-expanded')).toBe('true')
            // The other long row is untouched.
            expect(clampElement(listRow(target, 'Cat')).classList.contains(CLAMP_CLASS)).toBe(true)
            expect(toggleOf(listRow(target, 'Cat'))?.textContent?.trim()).toBe('Show more')

            toggleOf(row)!.click()
            await settle()
            expect(clampElement(row).classList.contains(CLAMP_CLASS)).toBe(true)
            expect(toggleOf(row)?.textContent?.trim()).toBe('Show more')
        })
    })

    test('the toggle never opens the character or closes the screen', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withList(endGrid, async (target) => {
            const row = listRow(target, 'Ann')
            toggleOf(row)!.click()
            await settle()
            toggleOf(row)!.click()
            await settle()
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })

    test('disappears when a resize makes the text fit, and returns when it overflows again', async () => {
        vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            expect(toggleOf(listRow(target, 'Ann'))).toBeDefined()
            fitsEverywhere = true
            ControlledResizeObserver.fireAll()
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))).toBeUndefined()
            fitsEverywhere = false
            ControlledResizeObserver.fireAll()
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))).toBeDefined()
        })
    })

    test('collapsing re-measures: a text that now fits loses the toggle, one that still overflows keeps it', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            toggleOf(listRow(target, 'Ann'))!.click()
            toggleOf(listRow(target, 'Cat'))!.click()
            await settle()
            fitsEverywhere = true
            toggleOf(listRow(target, 'Ann'))!.click()
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))).toBeUndefined()

            fitsEverywhere = false
            toggleOf(listRow(target, 'Cat'))!.click()
            await settle()
            expect(toggleOf(listRow(target, 'Cat'))?.textContent?.trim()).toBe('Show more')
        })
    })

    test('the expanded state belongs to the character, not to its position in the list', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            toggleOf(listRow(target, 'Cat'))!.click()
            await settle()
            DBState.db.characters.splice(1, 1)
            await settle()
            const cat = listRow(target, 'Cat')
            expect(toggleOf(cat)?.textContent?.trim()).toBe('Show less')
            expect(clampElement(cat).classList.contains(CLAMP_CLASS)).toBe(false)
            expect(clampElement(listRow(target, 'Ann')).classList.contains(CLAMP_CLASS)).toBe(true)
        })
    })
    test('follows a change of the description text', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            expect(toggleOf(listRow(target, 'Ann'))).toBeDefined()
            DBState.db.characters[0].creatorNotes = 'now short'
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))).toBeUndefined()
            DBState.db.characters[0].creatorNotes = 'LONG again'
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))).toBeDefined()
        })
    })
})

describe('GridCatalog List tab: markdown descriptions', { timeout: 60_000 }, () => {
    test('a row near the viewport shows its description rendered as markdown', async () => {
        DBState.db = buildDb(characters())

        await withList(vi.fn(), async (target) => {
            await vi.waitFor(() => expect(clampElement(listRow(target, 'Bob')).querySelector('p')?.textContent).toBe('short text'), { timeout: 20_000 })
            expect(parseSpy).toHaveBeenCalledWith('short text')
        })
    })

    // Feature test: a row outside the window is not mounted, so nothing parses or measures it.
    test('a row outside the window is not mounted and its description is not parsed', async () => {
        const far = makeCharacter('far', 'Zed', 'far words')
        const fillers = Array.from({ length: 60 }, (_, i) => makeCharacter(`f${i}`, `Filler ${i}`, `filler words ${i}`))
        DBState.db = buildDb([...characters(), ...fillers, far])

        await withList(vi.fn(), async (target) => {
            installGeometry(scrollerOf(target), 300)
            await settleFrame()
            const names = Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim())
            expect(names).toContain('Bob')
            expect(names).not.toContain('Zed')
            expect(names.length).toBeLessThan(DBState.db.characters.length)
            expect(parseSpy).toHaveBeenCalledWith('short text')
            expect(parseSpy).not.toHaveBeenCalledWith('far words')
        })
    })

    // Feature test: the expanded state belongs to the character, so it outlives the row's element.
    test('an expanded row is still expanded after it scrolls out of the window and back', async () => {
        const fillers = Array.from({ length: 60 }, (_, i) => makeCharacter(`f${i}`, `Filler ${i}`, `filler words ${i}`))
        DBState.db = buildDb([...characters(), ...fillers])

        await withList(vi.fn(), async (target) => {
            const geometry = installGeometry(scrollerOf(target), 300)
            await settleFrame()
            toggleOf(listRow(target, 'Ann'))!.click()
            await settle()
            expect(toggleOf(listRow(target, 'Ann'))?.textContent?.trim()).toBe('Show less')

            await geometry.scrollAndSettle(6000)
            expect(Array.from(target.querySelectorAll('h4')).some((h) => h.textContent?.trim() === 'Ann')).toBe(false)

            await geometry.scrollAndSettle(0)
            const ann = listRow(target, 'Ann')
            expect(toggleOf(ann)?.textContent?.trim()).toBe('Show less')
            expect(clampElement(ann).classList.contains(CLAMP_CLASS)).toBe(false)
            expect(toggleOf(listRow(target, 'Cat'))?.textContent?.trim()).toBe('Show more')
        })
    })

    // Guard: scrolling parses the descriptions it mounts and nothing else.
    test('scrolling the list parses only the descriptions of rows that were mounted', async () => {
        const fillers = Array.from({ length: 120 }, (_, i) => makeCharacter(`f${i}`, `Filler ${i}`, `filler words ${i}`))
        DBState.db = buildDb([...characters(), ...fillers])

        await withList(vi.fn(), async (target) => {
            const geometry = installGeometry(scrollerOf(target), 300)
            await settleFrame()
            await geometry.scrollAndSettle(15_000)
            await geometry.scrollAndSettle(0)
            await vi.waitFor(() => expect(parseSpy).toHaveBeenCalledWith('filler words 114'), { timeout: 20_000 })
            const parsed = new Set(parseSpy.mock.calls.map((call) => call[0]))
            expect(parsed.has('short text')).toBe(true)
            // Rows between the two places the list rested at were never mounted.
            expect(parsed.has('filler words 40')).toBe(false)
            expect(parsed.has('filler words 60')).toBe(false)
            expect(parsed.size).toBeLessThan(60)
        })
    })

    test('a click on a link whose href was stripped opens the character like other text', async () => {
        parseSpy.mockImplementation(async (text: string) => text.startsWith('LONG text') ? '<p>see <a>the dead link</a></p>' : `<p>${text}</p>`)
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withList(endGrid, async (target) => {
            await vi.waitFor(() => expect(listRow(target, 'Ann').querySelector('a')).not.toBeNull(), { timeout: 20_000 })
            listRow(target, 'Ann').querySelector<HTMLAnchorElement>('a')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[0]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('a click on a link inside the description does not open the character or close the screen', async () => {
        parseSpy.mockImplementation(async (text: string) => text.startsWith('LONG text') ? '<p>see <a href="https://example.com">the link</a></p>' : `<p>${text}</p>`)
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withList(endGrid, async (target) => {
            await vi.waitFor(() => expect(listRow(target, 'Ann').querySelector('a')).not.toBeNull(), { timeout: 20_000 })
            const link = listRow(target, 'Ann').querySelector<HTMLAnchorElement>('a')!
            const event = new MouseEvent('click', { bubbles: true, cancelable: true })
            link.dispatchEvent(event)
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
            // The link keeps its default action, so the app opens it as it does elsewhere.
            expect(event.defaultPrevented).toBe(false)
        })
    })
})
