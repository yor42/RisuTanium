// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: the tiles follow the rail's saved order (`characterOrder`)
 * with folders. A closed folder is one tile, an open folder is its tile followed by its
 * members, a query gives a flat list with the folder's name on each member, and the screen
 * only reads: it writes no database field and never calls `checkCharOrder`.
 *
 * Fixture (`ORDER_FIXTURE`): the live characters are A, B, C, U, W, G (two holders), X (two
 * holders), Y (one holder). D is trashed, HID is a hidden system character, 'nope', 'ghost'
 * and 'nope2' have no character, and U is not in the order. Y is listed three times and X
 * twice, so the occurrence-to-holder rules are exercised: expected tile lists are written out
 * by hand, never derived from the code under test.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the Grid read the order.
 * `(F)` is a feature test of the new behaviour. `(G)` is a guard that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.window.svelte.test.ts` (same directory), with
 * `changeChar` and `removeChar` bare spies and `checkCharOrder` a spy this file inspects.
 * Geometry is faked as there: the container's width is a mutable value every element reports.
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
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

function makeFolder(id: string, name: string, data: string[], extra: Partial<folder> = {}): folder {
    return { id, name, data, color: '', ...extra }
}

function buildDb(characters: CharacterFixture[], order?: OrderFixture): Database {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        hideAllImages: false,
    } as unknown as Database
    if (order !== undefined) {
        db.characterOrder = order
    }
    return db
}

const ORDER_FIXTURE_CHARACTERS = (): CharacterFixture[] => [
    makeCharacter('A', 'Char A'),
    makeCharacter('B', 'Char B'),
    makeCharacter('C', 'Char C'),
    makeCharacter('D', 'Char D', { trashTime: 1_700_000_000_000 }),
    makeCharacter('§playground', 'Hidden'),
    makeCharacter('U', 'Char U'),
    makeCharacter('G', 'G first'),
    makeCharacter('G', 'G second'),
    makeCharacter('X', 'X first'),
    makeCharacter('X', 'X second'),
    makeCharacter('Y', 'Char Y'),
    makeCharacter('W', 'Char W'),
]

const ORDER_FIXTURE = (): OrderFixture => [
    'C',
    makeFolder('f1', 'F1', ['B', 'D', 'nope', 'Y']),
    null,
    'ghost',
    'A',
    'G',
    'X',
    makeFolder('f2', 'F2', ['X', 'Y', 'W']),
    makeFolder('f3', 'F3', ['§playground', 'nope2']),
    'Y',
] as unknown as OrderFixture

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
    const app = mount(GridCatalog, { target, props: { endGrid: () => {} } }) as Record<string, unknown>
    try {
        await settle()
        clickTab(target, 0)
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickTab(root: HTMLElement, layout: 0 | 1): void {
    const label = (layout === 0 ? language.grid : language.list).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

/** The accessible name of each mounted tile, in document order. */
const tileNames = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll('[data-charlist-key]')).map((card) => card.querySelector('button')?.getAttribute('aria-label') ?? '')

const tileKeys = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll('[data-charlist-key]')).map((card) => card.getAttribute('data-charlist-key') ?? '')

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

async function typeQuery(root: HTMLElement, text: string): Promise<void> {
    const input = root.querySelector('input')!
    input.value = text
    input.dispatchEvent(new Event('input'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        flushSync()
        vi.advanceTimersByTime(150)
    } finally {
        vi.useRealTimers()
    }
    await settleFrame()
}

const FOUR_COLUMNS = 312
let containerWidth = FOUR_COLUMNS
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    checkCharOrderSpy.mockClear()
    containerWidth = FOUR_COLUMNS
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

const CLOSED = ['Char C', 'F1', 'Char A', 'G first', 'X first', 'F2', 'Char U', 'G second']
const F1_OPEN = ['Char C', 'F1', 'Char B', 'Char Y', 'Char A', 'G first', 'X first', 'F2', 'Char U', 'G second']
const BOTH_OPEN = ['Char C', 'F1', 'Char B', 'Char Y', 'Char A', 'G first', 'X first', 'F2', 'X second', 'Char W', 'Char U', 'G second']

describe('Grid tab: the rail order with folders', { timeout: 60_000 }, () => {
    test('(R) a character inside a folder of the order shows as a folder tile, not as a flat tile', async () => {
        DBState.db = buildDb(
            [makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B')],
            ['A', makeFolder('f1', 'F1', ['B'])],
        )
        await withMounted((target) => {
            expect(folderTile(target, 'F1')).not.toBeNull()
            expect(tileNames(target)).toEqual(['Char A', 'F1'])
        })
    })

    test('(R) the tiles follow the saved order with the occurrence rules: hidden, dangling, trashed, unlisted and duplicate ids', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            expect(tileNames(target)).toEqual(CLOSED)
            expect(new Set(tileKeys(target)).size).toBe(CLOSED.length)

            await toggle(target, 'F1')
            expect(tileNames(target)).toEqual(F1_OPEN)
            await toggle(target, 'F2')
            expect(tileNames(target)).toEqual(BOTH_OPEN)
            expect(new Set(tileKeys(target)).size).toBe(BOTH_OPEN.length)
            // Every live character exactly once, the two folders aside.
            expect(tileNames(target).filter((name) => !name.startsWith('F')).length).toBe(10)
        })
    })

    test('(F) opening a folder shows its members and closing hides them; the tile says which', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('false')
            expect(tileNames(target)).not.toContain('Char B')

            await toggle(target, 'F1')
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
            expect(tileNames(target)).toContain('Char B')

            await toggle(target, 'F1')
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('false')
            expect(tileNames(target)).not.toContain('Char B')
        })
    })

    test('(F) a member tile opens its character, as a flat tile does', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            await toggle(target, 'F1')
            target.querySelector<HTMLButtonElement>('button[aria-label="Char B"]')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
        })
    })

    test('(F) the folder tile keeps focus across a toggle, with Chromium\'s focusout on removal emulated', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            const before = folderTile(target, 'F1')!
            before.focus()
            await settle()
            expect(document.activeElement).toBe(before)

            // Chromium reports the loss of focus while the focused element is being removed; happy-dom does not.
            const originalRemove = Element.prototype.remove
            Element.prototype.remove = function (this: Element) {
                const active = document.activeElement
                if (active && this.contains(active)) {
                    active.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
                }
                originalRemove.call(this)
            }
            try {
                before.click()
                await settle()
                const opened = folderTile(target, 'F1')!
                expect(opened.getAttribute('aria-expanded')).toBe('true')
                expect(document.activeElement).toBe(opened)

                opened.click()
                await settle()
                const closed = folderTile(target, 'F1')!
                expect(closed.getAttribute('aria-expanded')).toBe('false')
                expect(document.activeElement).toBe(closed)
            } finally {
                Element.prototype.remove = originalRemove
            }
        })
    })

    test('(F) the open folders survive a remount and are pruned to the folders still in the order', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        // f3 has no visible member but is in the order, so it stays remembered; 'gone' is in no order.
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(['f3', 'gone']))
        await withMounted(async (target) => {
            await toggle(target, 'F1')
            expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual(['f3', 'f1'])
        })
        await withMounted((target) => {
            expect(tileNames(target)).toEqual(F1_OPEN)
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
        })
    })

    test('(F) a query gives a flat list with the folder name on each member, and clearing it restores the folders', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            await typeQuery(target, 'Char')
            expect(tileNames(target)).toEqual(['Char C', 'Char B', 'Char Y', 'Char A', 'Char W', 'Char U'])
            expect(target.querySelectorAll('button[aria-expanded]').length).toBe(0)
            const badges = Array.from(target.querySelectorAll('[data-charlist-key]')).map((card) => card.textContent?.trim() ?? '')
            expect(badges).toEqual(['', 'F1', 'F1', '', 'F2', ''])
            expect(new Set(tileKeys(target)).size).toBe(6)

            await typeQuery(target, '')
            expect(tileNames(target)).toEqual(CLOSED)
            expect(Array.from(target.querySelectorAll('[data-charlist-key]')).every((card) => (card.textContent?.trim() ?? '') === '')).toBe(true)
        })
    })

    test('(G) a folder with no live member has no tile, and a folder without members is ignored; the order is kept', async () => {
        const order = ['A', makeFolder('f9', 'F9', ['§playground', 'nope']), makeFolder('f8', 'F8', [])] as unknown as OrderFixture
        DBState.db = buildDb([makeCharacter('A', 'Char A'), makeCharacter('§playground', 'Hidden')], order)
        const before = JSON.stringify(DBState.db.characterOrder)
        await withMounted((target) => {
            expect(tileNames(target)).toEqual(['Char A'])
            expect(target.querySelectorAll('button[aria-expanded]').length).toBe(0)
        })
        expect(JSON.stringify(DBState.db.characterOrder)).toBe(before)
    })

    test('(F) a character inserted into the order in place moves its tile', async () => {
        DBState.db = buildDb(
            [makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B'), makeCharacter('C', 'Char C')],
            ['A', 'B'],
        )
        await withMounted(async (target) => {
            expect(tileNames(target)).toEqual(['Char A', 'Char B', 'Char C'])
            DBState.db.characterOrder.splice(0, 0, 'C')
            await settle()
            expect(tileNames(target)).toEqual(['Char C', 'Char A', 'Char B'])
        })
    })

    test('(F) 300 characters with an open folder of 100 mount a bounded window of tiles', async () => {
        const characters = Array.from({ length: 300 }, (_, i) => makeCharacter(`id-${i}`, `Character ${i}`))
        const members = characters.slice(0, 100).map((c) => c.chaId)
        const order = [makeFolder('big', 'Big', members), ...characters.slice(100).map((c) => c.chaId)] as OrderFixture
        DBState.db = buildDb(characters, order)
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(['big']))
        await withMounted((target) => {
            const mounted = target.querySelectorAll('[data-charlist-key]').length
            expect(mounted).toBeGreaterThan(0)
            expect(mounted).toBeLessThan(150)
            const first = target.querySelector('[data-charlist-key]')!
            expect(first.getAttribute('aria-setsize')).toBe('301')
            expect(folderTile(target, 'Big')!.getAttribute('aria-expanded')).toBe('true')
        })
    })

    test('(F) a folder tile carries the name when the setting asks for it, the icon otherwise', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        await withMounted(async (target) => {
            expect(folderTile(target, 'F1')!.textContent?.trim()).toBe('')
            expect(folderTile(target, 'F1')!.querySelector('svg')).not.toBeNull()
            DBState.db.showFolderName = true
            await settle()
            expect(folderTile(target, 'F1')!.textContent?.trim()).toBe('F1')
        })
    })
})

describe('Grid tab: the screen only reads', { timeout: 60_000 }, () => {
    test('(G) mount, toggle, search and remount change nothing in the database and call no checkCharOrder', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        const characters = DBState.db.characters
        const order = DBState.db.characterOrder
        const slots = [...characters]
        const snapshot = JSON.stringify(DBState.db)
        const listNames = (target: HTMLElement) => Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
        const expectedList = ['Char A', 'Char B', 'Char C', 'Char U', 'G first', 'G second', 'X first', 'X second', 'Char Y', 'Char W']

        await withMounted(async (target) => {
            await toggle(target, 'F1')
            await toggle(target, 'F2')
            await typeQuery(target, 'Char')
            await typeQuery(target, '')
            // The List tab shows `found.live`, which the Grid must not have reordered.
            clickTab(target, 1)
            await settle()
            expect(listNames(target).slice(0, expectedList.length)).toEqual(expectedList)
        })
        await withMounted(async (target) => {
            await toggle(target, 'F1')
        })

        expect(DBState.db.characters).toBe(characters)
        expect(DBState.db.characterOrder).toBe(order)
        expect(DBState.db.characters.length).toBe(slots.length)
        DBState.db.characters.forEach((slot, i) => expect(slot).toBe(slots[i]))
        expect(JSON.stringify(DBState.db)).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('(G) a missing characterOrder is tolerated: every live character is a flat tile in database order', async () => {
        DBState.db = buildDb([makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B')])
        expect(DBState.db.characterOrder).toBeUndefined()
        await withMounted(async (target) => {
            expect(tileNames(target)).toEqual(['Char A', 'Char B'])
            await typeQuery(target, 'Char B')
            expect(tileNames(target)).toEqual(['Char B'])
        })
        expect(DBState.db.characterOrder).toBeUndefined()
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('(G) a corrupt remembered value reads as nothing open', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        localStorage.setItem(OPEN_FOLDERS_KEY, '{not json')
        await withMounted((target) => {
            expect(tileNames(target)).toEqual(CLOSED)
        })
    })

    test('(G) storage that refuses a write still lets a folder open', async () => {
        DBState.db = buildDb(ORDER_FIXTURE_CHARACTERS(), ORDER_FIXTURE())
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem: () => {
                throw new Error('quota')
            },
            removeItem: () => {},
            clear: () => {},
        })
        await withMounted(async (target) => {
            await toggle(target, 'F1')
            expect(tileNames(target)).toEqual(F1_OPEN)
        })
    })
})
