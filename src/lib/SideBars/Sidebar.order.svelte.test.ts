// @vitest-environment happy-dom

/**
 * Order operations and folder edits of the character sidebar, driven through the REAL
 * `Sidebar.svelte` with synthetic drag events and context-menu events.
 *
 * Every operation addresses characters and folders by id, never by the index of a rendered
 * row, so a stale id, a duplicate entry or a data-less folder in `characterOrder` cannot
 * change where an item lands or which folder an edit reaches. The order lives in a `$state`
 * object here, exactly as in the app, so every operation runs against a live proxy.
 *
 * MOCKED: `checkCharOrder` (a spy; the real one runs in `sidebarOrder.checkCharOrder.svelte.test.ts`),
 * `alertSelect` / `alertInput` (answer from queues), `selectSingleFile` (held open until the
 * test releases it), `saveAsset`, `changeChar`, and the storage and platform modules.
 *
 * Tests whose title starts with `guard:` pass with or without the id-based order model.
 * Tests starting `regression reproducer:` fail while operations address rows by index.
 * Tests starting `rule:` state behaviour the order model defines. They define behaviour and are not defect reproducers.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
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

const { checkCharOrderSpy, saveAssetSpy, changeCharSpy, pickerSpy, pickers } = vi.hoisted(() => {
    const pickers: Array<(file: { name: string; data: Uint8Array } | null) => void> = []
    return {
        checkCharOrderSpy: vi.fn(),
        saveAssetSpy: vi.fn(async () => 'asset-1'),
        changeCharSpy: vi.fn(),
        pickers,
        pickerSpy: vi.fn(
            () =>
                new Promise<{ name: string; data: Uint8Array } | null>((resolve) => {
                    pickers.push(resolve)
                }),
        ),
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
            checkCharOrder: checkCharOrderSpy,
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: saveAssetSpy,
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
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal()),
    selectSingleFile: pickerSpy as unknown as typeof import('src/ts/util').selectSingleFile,
}))

const selectAnswers: string[] = []
const inputAnswers: string[] = []

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => selectAnswers.shift() ?? '3'),
    alertInput: vi.fn(async () => inputAnswers.shift() ?? ''),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
    imgFile?: string
    img?: string
}
type OrderFixture = Array<string | FolderFixture | null>

const folderOf = (id: string, data: string[], extra: Partial<FolderFixture> = {}): FolderFixture => ({
    id,
    name: `Name ${id}`,
    color: '',
    data,
    ...extra,
})

function character(chaId: string): Record<string, unknown> {
    return { chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 }
}

function setDb(order: OrderFixture, charIds: string[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: charIds.map(character),
        hideAllImages: false,
    } as unknown as Database
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
}

async function settleLong(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await settle()
        await new Promise((r) => setTimeout(r, 5))
    }
}

/** Mounts the sidebar; a throw while mounting is returned, not rethrown, so tests assert on it. */
async function mountSidebar(): Promise<{ target: HTMLElement; error: unknown }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    let error: unknown
    try {
        const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
        mounted = { target, app }
        await settle()
    } catch (e) {
        error = e
    }
    return { target, error }
}

beforeEach(() => {
    selectAnswers.length = 0
    inputAnswers.length = 0
    pickers.length = 0
    checkCharOrderSpy.mockClear()
    saveAssetSpy.mockClear()
    changeCharSpy.mockClear()
    pickerSpy.mockClear()
    selectedCharID.set(-1)
})

afterEach(async () => {
    if (mounted) {
        try {
            await unmount(mounted.app as never)
        } catch {
            // a sidebar that failed half way through mounting is torn down best effort
        }
        mounted.target.remove()
        mounted = null
    }
    document.body.innerHTML = ''
})

//#region drag helpers

interface FakeDataTransfer {
    types: string[]
    setData(type: string, value: string): void
    setDragImage(): void
    dropEffect: string
}

function makeDataTransfer(types: string[] = []): FakeDataTransfer {
    return {
        types: [...types],
        setData(type: string) {
            if (!this.types.includes(type)) {
                this.types.push(type)
            }
        },
        setDragImage() {},
        dropEffect: 'none',
    }
}

function fire(el: Element, type: string, dataTransfer: FakeDataTransfer): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    el.dispatchEvent(ev)
    return ev
}

const draggables = (t: HTMLElement): HTMLElement[] => Array.from(t.querySelectorAll<HTMLElement>('div[draggable="true"]'))
const FOLDER_BODY = 'div.mt-1.rounded-lg'
const topRows = (t: HTMLElement): HTMLElement[] => draggables(t).filter((el) => !el.closest(FOLDER_BODY))
const topGaps = (t: HTMLElement): HTMLElement[] =>
    Array.from(t.querySelectorAll<HTMLElement>('div.h-4.min-h-4.w-14')).filter((g) => !g.classList.contains('relative'))
const folderAvatars = (t: HTMLElement): HTMLElement[] =>
    Array.from(t.querySelectorAll<HTMLElement>('span.avatar')).filter((a) => !a.hasAttribute('data-char-id'))

/** The `n`-th rendered row for character `id` (a top-level or folder member row). */
function charRow(t: HTMLElement, id: string, n = 0): HTMLElement {
    const hits = Array.from(t.querySelectorAll(`[data-char-id="${id}"]`))
    const row = hits[n]?.closest<HTMLElement>('div[draggable="true"]')
    if (!row) {
        throw new Error(`no row ${n} for ${id}`)
    }
    return row
}

/** The `n`-th folder row in the top-level list. */
function folderRow(t: HTMLElement, n = 0): HTMLElement {
    const row = folderAvatars(t)[n]?.closest<HTMLElement>('div[draggable="true"]')
    if (!row) {
        throw new Error(`no folder row ${n}`)
    }
    return row
}

/** The three kinds of gap inside an open folder, in order: start, then one after each member. */
function folderGaps(folderRowEl: HTMLElement): HTMLElement[] {
    const body = folderRowEl.nextElementSibling
    if (!body || !body.matches(FOLDER_BODY)) {
        throw new Error('folder is not open')
    }
    return Array.from(body.querySelectorAll<HTMLElement>('div.h-4'))
}

async function openFolder(t: HTMLElement, n = 0): Promise<void> {
    folderAvatars(t)[n].click()
    await settle()
}

/** Starts a drag on `src`, then drops on `dst`; returns the drop event. */
async function dragTo(src: HTMLElement, dst: HTMLElement): Promise<Event> {
    const dt = makeDataTransfer()
    fire(src, 'dragstart', dt)
    await settle()
    const ev = fire(dst, 'drop', dt)
    await settle()
    return ev
}

//#endregion

//#region order inspection

const isGeneratedId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)

function show(order: readonly (string | FolderFixture | null)[]): string[] {
    return order.map((e) => {
        if (e === null) {
            return 'null'
        }
        if (typeof e === 'string') {
            return e
        }
        return `${isGeneratedId(e.id) ? 'NEW' : e.id}[${e.data.join(',')}]`
    })
}

const orderNow = (): string[] => show($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture)
const foldersNow = (): FolderFixture[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).filter(
        (e): e is FolderFixture => e !== null && typeof e !== 'string',
    )

//#endregion

describe('guard: operations keep their results', () => {
    test('reorder through a top gap, and to the start of the list', async () => {
        setDb(['A', 'B', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'C'), topGaps(target)[1])
        expect(orderNow()).toEqual(['A', 'C', 'B'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)

        await dragTo(charRow(target, 'B'), topGaps(target)[0])
        expect(orderNow()).toEqual(['B', 'A', 'C'])
    })

    test('a character dropped on a character makes a new folder at the target place', async () => {
        setDb(['A', 'B', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'C'), charRow(target, 'A'))
        expect(orderNow()).toEqual(['NEW[C,A]', 'B'])
        const created = foldersNow()[0]
        expect(created.name).toBe('New Folder')
        expect(created.color).toBe('')
        expect(isGeneratedId(created.id)).toBe(true)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
    })

    test('a character dropped on a folder is appended to it', async () => {
        setDb(['A', folderOf('f1', ['B', 'C'])], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'A'), folderRow(target))
        expect(orderNow()).toEqual(['f1[B,C,A]'])
    })

    test('a character dropped in a folder gap lands at that position', async () => {
        setDb(['A', 'D', folderOf('f1', ['B', 'C'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'A'), folderGaps(folderRow(target))[1])
        expect(orderNow()).toEqual(['D', 'f1[B,A,C]'])
        await dragTo(charRow(target, 'D'), folderGaps(folderRow(target))[0])
        expect(orderNow()).toEqual(['f1[D,B,A,C]'])
    })

    test('reorder inside a folder', async () => {
        setDb([folderOf('f1', ['B', 'C', 'D'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'D'), folderGaps(folderRow(target))[0])
        expect(orderNow()).toEqual(['f1[D,B,C]'])
        await dragTo(charRow(target, 'D'), folderGaps(folderRow(target))[3])
        expect(orderNow()).toEqual(['f1[B,C,D]'])
    })

    test('a folder member dropped on a top-level gap leaves its folder', async () => {
        setDb(['A', folderOf('f1', ['B', 'C']), 'D'], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'C'), topGaps(target)[3])
        expect(orderNow()).toEqual(['A', 'f1[B]', 'D', 'C'])
    })

    test('a folder member dropped on a top-level character makes a new folder from the two', async () => {
        setDb(['A', folderOf('f1', ['B', 'C']), 'D'], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'B'), charRow(target, 'D'))
        expect(orderNow()).toEqual(['A', 'f1[C]', 'NEW[B,D]'])
    })

    test('a folder member dropped on another folder is appended; on its own folder it moves to the end', async () => {
        setDb([folderOf('f1', ['A', 'B']), folderOf('f2', ['C', 'D'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target, 0)
        await dragTo(charRow(target, 'A'), folderRow(target, 1))
        expect(orderNow()).toEqual(['f1[B]', 'f2[C,D,A]'])

        setDb([folderOf('f1', ['A', 'B'])], LETTERS)
        await settle()
        await dragTo(charRow(target, 'A'), folderRow(target, 0))
        expect(orderNow()).toEqual(['f1[B,A]'])
    })

    test('a whole folder dropped on a top-level gap is moved', async () => {
        setDb(['A', folderOf('f1', ['B', 'C']), 'D'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(folderRow(target), topGaps(target)[3])
        expect(orderNow()).toEqual(['A', 'D', 'f1[B,C]'])
        await dragTo(folderRow(target), topGaps(target)[0])
        expect(orderNow()).toEqual(['f1[B,C]', 'A', 'D'])
    })

    test('a drop into the item own gap leaves the order unchanged', async () => {
        setDb(['A', 'B', 'C', folderOf('f1', ['D', 'E'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'B'), topGaps(target)[1])
        await dragTo(charRow(target, 'B'), topGaps(target)[2])
        await dragTo(folderRow(target), topGaps(target)[3])
        await dragTo(folderRow(target), topGaps(target)[4])
        await dragTo(charRow(target, 'D'), folderGaps(folderRow(target))[0])
        await dragTo(charRow(target, 'D'), folderGaps(folderRow(target))[1])
        expect(orderNow()).toEqual(['A', 'B', 'C', 'f1[D,E]'])
    })

    test('drops that are ignored stay ignored', async () => {
        setDb(['A', folderOf('f1', ['B', 'C']), folderOf('f2', ['D', 'E']), 'F'], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target, 0)
        await openFolder(target, 1)
        const before = orderNow()
        // a folder onto a character, onto a folder, and into a folder gap
        await dragTo(folderRow(target, 0), charRow(target, 'A'))
        await dragTo(folderRow(target, 0), folderRow(target, 1))
        await dragTo(folderRow(target, 0), folderGaps(folderRow(target, 1))[1])
        // any drop on a folder member row
        await dragTo(charRow(target, 'A'), charRow(target, 'C'))
        await dragTo(charRow(target, 'F'), charRow(target, 'E'))
        await dragTo(charRow(target, 'B'), charRow(target, 'E'))
        expect(orderNow()).toEqual(before)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})

describe('rule: stated behaviour of the order model', () => {
    test('a drop into the item own gap does not run checkCharOrder', async () => {
        setDb(['A', 'B', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'B'), topGaps(target)[1])
        await dragTo(charRow(target, 'B'), topGaps(target)[2])
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('moving out the last member of a folder removes the folder in the sidebar own write', async () => {
        setDb(['A', folderOf('f1', ['B'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'B'), topGaps(target)[0])
        expect(orderNow()).toEqual(['B', 'A'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
    })
})

describe('guard: order values that must mount and render', () => {
    test('duplicate strings, duplicate folder ids and a folder id equal to a character id render one row per occurrence', async () => {
        setDb(
            ['A', 'B', 'A', folderOf('B', ['C', 'C']), folderOf('B', ['D']), folderOf('A', ['E'])],
            LETTERS,
        )
        const { target, error } = await mountSidebar()
        expect(error).toBeUndefined()
        expect(topRows(target)).toHaveLength(6)
        // folders 0 and 1 share an id and open together; folder 2 opens on its own
        await openFolder(target, 0)
        await openFolder(target, 2)
        expect(draggables(target)).toHaveLength(6 + 4)
        expect(target.querySelectorAll('[data-char-id="C"]')).toHaveLength(2)
    })

    test('an unknown id in the order draws no row', async () => {
        setDb(['stale', 'A', 'B'], LETTERS)
        const { target } = await mountSidebar()
        expect(topRows(target)).toHaveLength(2)
    })
})

describe('guard: sidebar features', () => {
    test('rows carry data-char-id in order, the rail keeps its classes, and a click and Enter select the character', async () => {
        setDb(['A', folderOf('f1', ['B', 'C']), 'D'], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        expect(target.querySelector('.rs-sidebar')).toBeTruthy()
        const ids = Array.from(target.querySelectorAll('[data-char-id]')).map((e) => e.getAttribute('data-char-id'))
        expect(ids).toEqual(['A', 'B', 'C', 'D'])

        const button = charRow(target, 'C').querySelector<HTMLElement>('div[role="button"]')!
        button.click()
        expect(changeCharSpy).toHaveBeenCalledWith(2, expect.anything())
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(changeCharSpy).toHaveBeenCalledTimes(2)
    })

    test('clicking a folder opens and closes it', async () => {
        setDb([folderOf('f1', ['B', 'C'])], LETTERS)
        const { target } = await mountSidebar()
        expect(draggables(target)).toHaveLength(1)
        await openFolder(target)
        expect(draggables(target)).toHaveLength(3)
        await openFolder(target)
        expect(draggables(target)).toHaveLength(1)
    })

    test('scrollToActiveCharacter opens the folder that holds the selected character and scrolls to it', async () => {
        setDb(['A', folderOf('f1', ['B', 'C'])], LETTERS)
        const scroll = vi.fn()
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = scroll
        try {
            const { target } = await mountSidebar()
            expect(draggables(target)).toHaveLength(2)
            // The handler reads the store synchronously; the selection is cleared again before any
            // flush so the chat panel for the selected character is never rendered.
            selectedCharID.set(2)
            window.dispatchEvent(new Event('scrollToActiveCharacter'))
            selectedCharID.set(-1)
            await settle()
            expect(draggables(target)).toHaveLength(4)
            await new Promise((r) => setTimeout(r, 150))
            expect(scroll).toHaveBeenCalledTimes(1)
        } finally {
            Element.prototype.scrollIntoView = original
        }
    })

    test('a non-sidebar drag over the rail is not intercepted', async () => {
        setDb(['A', 'B', folderOf('f1', ['C', 'D'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        const reached: string[] = []
        const targets = [topGaps(target)[0], charRow(target, 'A'), folderRow(target), folderGaps(folderRow(target))[1], charRow(target, 'C')]
        const spy = (e: Event) => reached.push(e.type)
        document.body.addEventListener('dragover', spy)
        document.body.addEventListener('drop', spy)
        try {
            for (const el of targets) {
                for (const type of ['dragover', 'dragenter', 'drop']) {
                    const ev = fire(el, type, makeDataTransfer(['Files']))
                    expect(ev.defaultPrevented).toBe(false)
                }
            }
        } finally {
            document.body.removeEventListener('dragover', spy)
            document.body.removeEventListener('drop', spy)
        }
        // dragover and drop bubble all the way to the body; dragenter is not counted
        expect(reached).toHaveLength(targets.length * 2)
        expect(orderNow()).toEqual(['A', 'B', 'f1[C,D]'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})

describe('reorder and drop addressing', () => {
    test('regression reproducer: an unknown id before the rows does not shift where a drop lands', async () => {
        setDb(['stale', 'A', 'B', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'C'), topGaps(target)[1])
        expect(orderNow().filter((e) => e !== 'stale')).toEqual(['A', 'C', 'B'])
    })

    test('regression reproducer: an unknown id inside a folder does not shift which member moves', async () => {
        setDb([folderOf('f1', ['stale', 'A', 'B'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'B'), folderRow(target))
        expect(orderNow()).toEqual(['f1[stale,A,B]'])
    })

    test('regression reproducer: an unknown id inside a folder does not shift a member gap drop', async () => {
        setDb([folderOf('f1', ['stale', 'A', 'B', 'C'])], LETTERS)
        const { target } = await mountSidebar()
        await openFolder(target)
        await dragTo(charRow(target, 'C'), folderGaps(folderRow(target))[1])
        expect(orderNow()).toEqual(['f1[stale,A,C,B]'])
    })

    test('regression reproducer: dragging the later of two duplicate entries moves that entry', async () => {
        setDb(['A', 'B', 'A', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'A', 1), topGaps(target)[4])
        expect(orderNow()).toEqual(['A', 'B', 'C', 'A'])
    })

    test('guard: dragging the earlier of two duplicate entries moves that entry', async () => {
        setDb(['A', 'B', 'A', 'C'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'A', 0), topGaps(target)[4])
        expect(orderNow()).toEqual(['B', 'A', 'C', 'A'])
    })

    test('guard: return to origin restores the original order', async () => {
        setDb(['A', 'B', 'C', 'D'], LETTERS)
        const { target } = await mountSidebar()
        await dragTo(charRow(target, 'A'), topGaps(target)[3])
        expect(orderNow()).toEqual(['B', 'C', 'A', 'D'])
        await dragTo(charRow(target, 'A'), topGaps(target)[0])
        expect(orderNow()).toEqual(['A', 'B', 'C', 'D'])
    })

    test('guard: reorder and create-folder operate on the live state proxy', async () => {
        setDb(['A', 'B', 'C'], LETTERS)
        const { target } = await mountSidebar()
        expect($state.snapshot(DBState.db.characterOrder)).toEqual(['A', 'B', 'C'])
        await dragTo(charRow(target, 'A'), topGaps(target)[3])
        expect(orderNow()).toEqual(['B', 'C', 'A'])
        await dragTo(charRow(target, 'B'), charRow(target, 'A'))
        expect(orderNow()).toEqual(['C', 'NEW[B,A]'])
        // the rendered rows follow the written order
        expect(Array.from(target.querySelectorAll('[data-char-id]')).map((e) => e.getAttribute('data-char-id'))).toEqual(['C'])
    })

    test('regression reproducer: an entry that is null or a folder without data does not stop the other rows from rendering', async () => {
        setDb([null, 'A', { id: 'f1', name: 'No data', color: '' } as unknown as FolderFixture, 'B'], LETTERS)
        const { target, error } = await mountSidebar()
        expect(error).toBeUndefined()
        expect(topRows(target)).toHaveLength(2)
        expect(Array.from(target.querySelectorAll('[data-char-id]')).map((e) => e.getAttribute('data-char-id'))).toEqual(['A', 'B'])
    })
})

describe('folder edits address the folder by id', () => {
    async function openMenu(target: HTMLElement, avatarIndex: number): Promise<void> {
        folderAvatars(target)[avatarIndex].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await settleLong()
    }

    test('guard: rename, colour and image reset change the folder that was clicked', async () => {
        setDb([folderOf('f1', ['A'], { imgFile: 'assets/old.png', img: '' })], LETTERS)
        const { target } = await mountSidebar()

        selectAnswers.push('0')
        inputAnswers.push('Renamed')
        await openMenu(target, 0)
        expect(foldersNow()[0].name).toBe('Renamed')

        selectAnswers.push('1', '2')
        await openMenu(target, 0)
        expect(foldersNow()[0].color).toBe('blue')

        selectAnswers.push('2', '0')
        await openMenu(target, 0)
        expect(foldersNow()[0].imgFile).toBeNull()
        expect(foldersNow()[0].img).toBe('')
    })

    test('guard: choosing an image stores the saved asset on the folder and clears the busy marker', async () => {
        setDb([folderOf('f1', ['A'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('2', '1')
        await openMenu(target, 0)
        expect(pickers).toHaveLength(1)
        pickers[0]({ name: 'x.png', data: new Uint8Array([1]) })
        await settleLong()
        expect(saveAssetSpy).toHaveBeenCalledTimes(1)
        expect(foldersNow()[0].imgFile).toBe('asset-1')
    })

    test('regression reproducer: renaming with an unknown id before two folders renames the clicked folder', async () => {
        setDb(['stale', folderOf('f1', ['A']), folderOf('f2', ['B'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('0')
        inputAnswers.push('Renamed')
        await openMenu(target, 1)
        expect(foldersNow().map((f) => f.name)).toEqual(['Name f1', 'Renamed'])
    })

    test('regression reproducer: changing the colour with an unknown id before two folders changes the clicked folder', async () => {
        setDb(['stale', folderOf('f1', ['A']), folderOf('f2', ['B'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('1', '0')
        await openMenu(target, 1)
        expect(foldersNow().map((f) => f.color)).toEqual(['', 'red'])
    })

    test('regression reproducer: an image chosen after the folder was removed writes nothing', async () => {
        setDb([folderOf('f1', ['A'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('2', '1')
        await openMenu(target, 0)
        expect(pickers).toHaveLength(1)
        DBState.db.characterOrder = ['A']
        await settle()
        pickers[0]({ name: 'x.png', data: new Uint8Array([1]) })
        await settleLong()
        expect($state.snapshot(DBState.db.characterOrder)).toEqual(['A'])
    })

    test('regression reproducer: an image chosen after the folder moved lands on that folder, not on the entry now at its old place', async () => {
        setDb([folderOf('f1', ['A']), folderOf('f2', ['B'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('2', '1')
        await openMenu(target, 0)
        expect(pickers).toHaveLength(1)
        const [first, second] = $state.snapshot(DBState.db.characterOrder) as unknown as FolderFixture[]
        DBState.db.characterOrder = [second, first]
        await settle()
        pickers[0]({ name: 'x.png', data: new Uint8Array([1]) })
        await settleLong()
        expect(foldersNow().map((f) => [f.id, f.imgFile])).toEqual([['f2', undefined], ['f1', 'asset-1']])
    })

    test('regression reproducer: two folders with the same id: a rename writes nothing', async () => {
        setDb([folderOf('same', ['A']), folderOf('same', ['B'])], LETTERS)
        const { target } = await mountSidebar()
        selectAnswers.push('0')
        inputAnswers.push('Renamed')
        await openMenu(target, 1)
        expect(foldersNow().map((f) => f.name)).toEqual(['Name same', 'Name same'])
    })
})
