// @vitest-environment happy-dom

/**
 * Keyboard use of the character rail, driven through the REAL `Sidebar.svelte` (and so the
 * real `SidebarRail.svelte`) with synthetic key, focus, pointer and context-menu events and
 * fake geometry (`installGeometry`, see `sidebarDnd.testKit.ts`).
 *
 * MOCKED: `checkCharOrder` (a spy), `alertSelect` / `alertInput` (spies that answer
 * "cancel"), `changeChar`, `saveAsset`, and the storage and platform modules.
 *
 * Tests whose title starts with `guard:` state behaviour that must be preserved and pass
 * before and after the keyboard work. The others are acceptance tests of the keyboard rail.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import isEqual from 'lodash/isEqual'
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

const { checkCharOrderSpy, changeCharSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
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
            saveAsset: vi.fn(async () => 'asset-1'),
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

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

vi.mock(import('../../ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '5'),
    alertInput: vi.fn(async () => ''),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { alertSelect } from 'src/ts/alert'
import { setLiveKeysBlockedReader } from '../../ts/keyEventBlocked'
import Sidebar from './Sidebar.svelte'
import { charKey, folderKey, memberKey } from './railTestKit'
import { moveToGap, type Gap, type ItemRef } from './sidebarOrder'
import { clientY, defaultSettle, folderAvatars, installGeometry, pointer, scrollerOf, resetRailMemory } from './sidebarDnd.testKit'

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'X', 'Y']

function setDb(order: OrderFixture): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: LETTERS.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let root: HTMLElement

async function settle(): Promise<void> {
    await defaultSettle()
    await tick()
    await defaultSettle()
}

async function mountSidebar(order: OrderFixture, openFolders = 0): Promise<HTMLElement> {
    setDb(order)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    installGeometry(target, 2000)
    root = target
    for (let i = 0; i < openFolders; i++) {
        folderAvatars(root)[i].click()
    }
    await settle()
    return target
}

beforeEach(() => {
    resetRailMemory()
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    vi.mocked(alertSelect).mockClear()
    selectedCharID.set(-1)
})

afterEach(async () => {
    setLiveKeysBlockedReader(() => false)
    vi.useRealTimers()
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

//#region helpers

const isGeneratedId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)

function show(order: readonly (string | FolderFixture)[]): string[] {
    return order.map((e) => (typeof e === 'string' ? e : `${isGeneratedId(e.id) ? 'NEW' : e.id}[${e.data.join(',')}]`))
}
const orderNow = (): string[] => show($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture)

const entries = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
const entryOf = (key: string): HTMLElement | null => entries().find((el) => el.getAttribute('data-rail-entry') === key) ?? null
const focusedKey = (): string | null => (document.activeElement as HTMLElement | null)?.getAttribute?.('data-rail-entry') ?? null
const liveRegion = (): HTMLElement | null => root.querySelector<HTMLElement>('[aria-live="polite"]')

function focusEntry(key: string): HTMLElement {
    const el = entryOf(key)
    expect(el).not.toBeNull()
    el!.focus()
    return el!
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(ev)
    return ev
}

async function pressAndSettle(el: Element, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
    const ev = press(el, key, init)
    await settle()
    return ev
}

/**
 * What Chromium may do when a focused entry is removed: a bubbling focusout without a related
 * target, with the entry already gone from the document when the microtask queue runs.
 */
function removeFocusedEntry(el: HTMLElement): void {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    el.remove()
}

const altDown = { altKey: true }

const refOf = {
    char: (id: string): ItemRef => ({ kind: 'char', id, occurrence: 0 }),
}

//#endregion

describe('one Tab stop (K1, K14)', () => {
    test('exactly one entry focus target has tabindex 0 and no avatar is focusable', async () => {
        await mountSidebar(['A', folderOf('F', ['X', 'Y']), 'B'], 1)
        const all = entries()
        expect(all.length).toBe(5)
        expect(all.filter((el) => el.getAttribute('tabindex') === '0').length).toBe(1)
        expect(all.filter((el) => el.getAttribute('tabindex') === '-1').length).toBe(4)
        expect(root.querySelectorAll('span.avatar[tabindex]').length).toBe(0)
        expect(root.querySelectorAll('span.avatar[role]').length).toBe(0)
    })

    test('the Tab stop follows the last focused entry', async () => {
        await mountSidebar(['A', 'B', 'C'])
        focusEntry(charKey('C'))
        await settle()
        expect(entryOf(charKey('C'))?.getAttribute('tabindex')).toBe('0')
        expect(entries().filter((el) => el.getAttribute('tabindex') === '0').length).toBe(1)
    })

    test('before any focus the selected top-level character is the Tab stop', async () => {
        selectedCharID.set(LETTERS.indexOf('B'))
        await mountSidebar(['A', 'B', 'C'])
        expect(entries().filter((el) => el.getAttribute('tabindex') === '0').map((el) => el.getAttribute('data-rail-entry'))).toEqual([charKey('B')])
    })

    test('before any focus the selected folder member is the Tab stop once its folder is open, and the first entry while it is closed', async () => {
        selectedCharID.set(LETTERS.indexOf('Y'))
        await mountSidebar([folderOf('F', ['X', 'Y']), 'B'])
        expect(entries().filter((el) => el.getAttribute('tabindex') === '0').map((el) => el.getAttribute('data-rail-entry'))).toEqual([folderKey('F')])
        folderAvatars(root)[0].click()
        await settle()
        expect(entries().filter((el) => el.getAttribute('tabindex') === '0').map((el) => el.getAttribute('data-rail-entry'))).toEqual([memberKey('F', 'Y')])
    })

    test('the list, its items, the names and the folder state are exposed', async () => {
        await mountSidebar(['A', folderOf('F', ['X', 'Y'])], 1)
        const scroller = scrollerOf(root)
        expect(scroller.getAttribute('role')).toBe('list')
        const plus = root.querySelector('[data-rail-kind="plus"]')
        expect(plus?.getAttribute('role')).toBe('listitem')
        expect(entryOf(charKey('A'))?.getAttribute('aria-label')).toBe('A')
        expect(entryOf(folderKey('F'))?.getAttribute('aria-label')).toBe('Name F')
        expect(entryOf(folderKey('F'))?.getAttribute('aria-expanded')).toBe('true')
        expect(entryOf(charKey('A'))?.hasAttribute('aria-expanded')).toBe(false)
        expect(entryOf(charKey('A'))?.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown')
        const live = liveRegion()
        expect(live).not.toBeNull()
        expect(scroller.contains(live)).toBe(false)
    })
})

describe('moving focus (K3)', () => {
    test('arrows, Home and End walk the entries in visual order across an open folder', async () => {
        await mountSidebar(['A', folderOf('F', ['X', 'Y']), 'B'], 1)
        focusEntry(charKey('A'))
        const order = [charKey('A'), folderKey('F'), memberKey('F', 'X'), memberKey('F', 'Y'), charKey('B')]
        for (let i = 1; i < order.length; i++) {
            const ev = await pressAndSettle(document.activeElement!, 'ArrowDown')
            expect(ev.defaultPrevented).toBe(true)
            expect(focusedKey()).toBe(order[i])
        }
        await pressAndSettle(document.activeElement!, 'ArrowDown')
        expect(focusedKey()).toBe(order[4])
        await pressAndSettle(document.activeElement!, 'ArrowUp')
        expect(focusedKey()).toBe(order[3])
        await pressAndSettle(document.activeElement!, 'Home')
        expect(focusedKey()).toBe(order[0])
        await pressAndSettle(document.activeElement!, 'ArrowUp')
        expect(focusedKey()).toBe(order[0])
        await pressAndSettle(document.activeElement!, 'End')
        expect(focusedKey()).toBe(order[4])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('keys the rail does not handle are left alone', async () => {
        await mountSidebar(['A', 'B'])
        const el = focusEntry(charKey('A'))
        expect(press(el, 'ArrowLeft').defaultPrevented).toBe(false)
        expect(press(el, 'Tab').defaultPrevented).toBe(false)
        expect(press(el, 'a').defaultPrevented).toBe(false)
        expect(press(el, 'ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false)
    })
})

describe('activation (K4)', () => {
    test('Enter toggles a folder and still selects a character', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'B'])
        const folderEl = focusEntry(folderKey('F'))
        expect(entries().length).toBe(2)
        const first = await pressAndSettle(folderEl, 'Enter')
        expect(first.defaultPrevented).toBe(true)
        expect(entries().length).toBe(4)
        await pressAndSettle(entryOf(folderKey('F'))!, 'Enter')
        expect(entries().length).toBe(2)
        const charEl = focusEntry(charKey('B'))
        await pressAndSettle(charEl, 'Enter')
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(changeCharSpy.mock.calls[0][0]).toBe(LETTERS.indexOf('B'))
    })

    test('guard: a mouse click on a character selects it and a click on a folder toggles it', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'B'])
        root.querySelector<HTMLElement>('[data-char-id="B"]')!.click()
        await settle()
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        folderAvatars(root)[0].click()
        await settle()
        expect(root.querySelectorAll('[data-rail-kind="member"]').length).toBe(2)
    })
})

describe('moving an entry (K5 to K9)', () => {
    test('Alt+ArrowDown writes once through moveToGap, keeps focus on the moved row across a folder boundary, and repeats', async () => {
        const start: OrderFixture = ['A', folderOf('F', ['X', 'Y']), 'B']
        await mountSidebar(start, 1)
        const before = $state.snapshot(DBState.db.characterOrder)
        const gap: Gap = { in: 'folder', folder: { kind: 'folder', id: 'F', occurrence: 0 }, after: null }
        const expected = moveToGap(before as never, refOf.char('A'), gap)
        const el = focusEntry(charKey('A'))
        const ev = await pressAndSettle(el, 'ArrowDown', altDown)
        expect(ev.defaultPrevented).toBe(true)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(isEqual($state.snapshot(DBState.db.characterOrder), expected)).toBe(true)
        expect(focusedKey()).toBe(memberKey('F', 'A'))
        await pressAndSettle(document.activeElement!, 'ArrowDown', altDown)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(2)
        expect(orderNow()).toEqual(['F[X,A,Y]', 'B'])
        expect(focusedKey()).toBe(memberKey('F', 'A'))
    })

    test('a held key repeats nothing and a fresh press after it moves again', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const el = focusEntry(charKey('A'))
        await pressAndSettle(el, 'ArrowDown', altDown)
        expect(orderNow()).toEqual(['B', 'A', 'C'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        const repeat = await pressAndSettle(document.activeElement!, 'ArrowDown', { ...altDown, repeat: true })
        expect(repeat.defaultPrevented).toBe(true)
        expect(orderNow()).toEqual(['B', 'A', 'C'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        await pressAndSettle(document.activeElement!, 'ArrowDown', altDown)
        expect(orderNow()).toEqual(['B', 'C', 'A'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(2)
    })

    test('identical duplicates: the first press moves focus only, the next moves the entry', async () => {
        await mountSidebar(['A', 'A', 'B'])
        const first = focusEntry(charKey('A', 0))
        await pressAndSettle(first, 'ArrowDown', altDown)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(orderNow()).toEqual(['A', 'A', 'B'])
        expect(focusedKey()).toBe(charKey('A', 1))
        await pressAndSettle(document.activeElement!, 'ArrowDown', altDown)
        expect(orderNow()).toEqual(['A', 'B', 'A'])
        expect(focusedKey()).toBe(charKey('A', 1))
    })

    test('an end writes nothing and the sole member of a folder is refused', async () => {
        await mountSidebar([folderOf('F', ['X']), 'A'], 1)
        const sole = focusEntry(memberKey('F', 'X'))
        const ev = await pressAndSettle(sole, 'ArrowDown', altDown)
        expect(ev.defaultPrevented).toBe(true)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(orderNow()).toEqual(['F[X]', 'A'])
        const folderEl = focusEntry(folderKey('F'))
        await pressAndSettle(folderEl, 'ArrowUp', altDown)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('a folder with one shown member and a hidden id is moved', async () => {
        await mountSidebar([folderOf('F', ['X', 'GONE']), 'A'], 1)
        await pressAndSettle(focusEntry(memberKey('F', 'X')), 'ArrowDown', altDown)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(orderNow()).toEqual(['F[GONE]', 'X', 'A'])
    })
})

describe('consumption of keys (K8)', () => {
    test('a document listener does not see a handled Alt+Arrow, sees unhandled keys, and sees Alt+Arrow on the plus button', async () => {
        await mountSidebar(['A', 'B'])
        const seen: KeyboardEvent[] = []
        const listener = (e: KeyboardEvent) => {
            seen.push(e)
        }
        document.addEventListener('keydown', listener)
        try {
            const el = focusEntry(charKey('A'))
            await pressAndSettle(el, 'ArrowDown', altDown)
            expect(seen.length).toBe(0)
            expect(orderNow()).toEqual(['B', 'A'])
            press(document.activeElement!, 'ArrowLeft')
            expect(seen.map((e) => e.key)).toEqual(['ArrowLeft'])
            const plusButton = root.querySelector<HTMLElement>('[data-rail-kind="plus"] button')!
            expect(plusButton).not.toBeNull()
            press(plusButton, 'ArrowDown', altDown)
            expect(seen.map((e) => e.key)).toEqual(['ArrowLeft', 'ArrowDown'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        } finally {
            document.removeEventListener('keydown', listener)
        }
    })

    test('Ctrl+Alt, Shift+Alt and Meta+Alt with Arrow reach the document and write nothing', async () => {
        await mountSidebar(['A', 'B'])
        const seen: KeyboardEvent[] = []
        const listener = (e: KeyboardEvent) => {
            seen.push(e)
        }
        document.addEventListener('keydown', listener)
        try {
            const el = focusEntry(charKey('A'))
            for (const mod of ['ctrlKey', 'shiftKey', 'metaKey'] as const) {
                for (const key of ['ArrowDown', 'ArrowUp']) {
                    const ev = press(el, key, { altKey: true, [mod]: true })
                    expect(ev.defaultPrevented).toBe(false)
                }
            }
            await settle()
            expect(seen.length).toBe(6)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(orderNow()).toEqual(['A', 'B'])
        } finally {
            document.removeEventListener('keydown', listener)
        }
    })
})

describe('announcements (K14)', () => {
    test('a move says the new place, at the top level and in a folder', async () => {
        await mountSidebar(['A', 'B', folderOf('F', ['X', 'Y'])], 1)
        expect(liveRegion()).not.toBeNull()
        await pressAndSettle(focusEntry(charKey('A')), 'ArrowDown', altDown)
        expect(liveRegion()!.textContent).toBe('Position 2 of 3')
        await pressAndSettle(focusEntry(memberKey('F', 'Y')), 'ArrowUp', altDown)
        expect(liveRegion()!.textContent).toBe('Position 1 of 2 in Name F')
    })

    test('an end and a refusal are announced, and an identical message is cleared before it is set again', async () => {
        await mountSidebar([folderOf('F', ['X']), 'A'], 1)
        expect(liveRegion()).not.toBeNull()
        await pressAndSettle(focusEntry(charKey('A')), 'ArrowDown', altDown)
        expect(liveRegion()!.textContent).toBe('Already last')
        press(document.activeElement!, 'ArrowDown', altDown)
        flushSync()
        expect(liveRegion()!.textContent).toBe('')
        await settle()
        expect(liveRegion()!.textContent).toBe('Already last')
        await pressAndSettle(focusEntry(folderKey('F')), 'ArrowUp', altDown)
        expect(liveRegion()!.textContent).toBe('Already first')
        await pressAndSettle(focusEntry(memberKey('F', 'X')), 'ArrowDown', altDown)
        expect(liveRegion()!.textContent).toBe("Can't move out: this is the only character in Name F, and moving it would remove the folder.")
    })
})
describe('focus survives a rail change (K2)', () => {
    test('closing the folder that holds the focused member focuses the folder row', async () => {
        await mountSidebar(['A', folderOf('F', ['X', 'Y']), 'B'], 1)
        const member = focusEntry(memberKey('F', 'X'))
        await settle()
        removeFocusedEntry(member)
        folderAvatars(root)[0].click()
        await settle()
        expect(entryOf(memberKey('F', 'X'))).toBeNull()
        expect(focusedKey()).toBe(folderKey('F'))
    })

    test('deleting the focused character focuses a surviving entry, not the page body', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const focused = focusEntry(charKey('B'))
        await settle()
        removeFocusedEntry(focused)
        DBState.db.characterOrder = ['A', 'C']
        await settle()
        expect(entryOf(charKey('B'))).toBeNull()
        expect(document.activeElement).not.toBe(document.body)
        expect(focusedKey()).toBe(charKey('C'))
    })

    test('a focusout without a related target that leaves focus on the page body is not pulled back by a rail change', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const focused = focusEntry(charKey('B'))
        await settle()
        focused.blur()
        focused.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
        await settle()
        expect(document.activeElement).toBe(document.body)
        DBState.db.characterOrder = ['A', 'C']
        await settle()
        expect(document.activeElement).toBe(document.body)
    })

    test('focus that left the rail is not pulled back by a rail change', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        focusEntry(charKey('B'))
        await settle()
        outside.focus()
        await settle()
        DBState.db.characterOrder = ['A', 'C']
        await settle()
        expect(document.activeElement).toBe(outside)
    })
})

describe('pointer session (K13)', () => {
    test('keys do nothing while a press is held, and work after it ends', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const el = focusEntry(charKey('A'))
        const row = el.closest<HTMLElement>('[data-rail-kind]')!
        row.dispatchEvent(pointer('pointerdown', clientY(root, row)))
        await settle()
        const arrow = await pressAndSettle(el, 'ArrowDown')
        const move = await pressAndSettle(el, 'ArrowDown', altDown)
        expect(arrow.defaultPrevented).toBe(true)
        expect(move.defaultPrevented).toBe(true)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(orderNow()).toEqual(['A', 'B', 'C'])
        expect(focusedKey()).toBe(charKey('A'))
        window.dispatchEvent(pointer('pointerup', clientY(root, row)))
        await settle()
        await pressAndSettle(el, 'ArrowDown', altDown)
        expect(orderNow()).toEqual(['B', 'A', 'C'])
    })
})

describe('blocked keys (K12)', () => {
    test('while keys are blocked nothing happens, and it works again once they are not', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'A', 'B'])
        setLiveKeysBlockedReader(() => true)
        const folderEl = focusEntry(folderKey('F'))
        const altMove = await pressAndSettle(folderEl, 'ArrowDown', altDown)
        const arrow = await pressAndSettle(folderEl, 'ArrowDown')
        const enterFolder = await pressAndSettle(folderEl, 'Enter')
        const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        folderEl.dispatchEvent(context)
        await settle()
        expect(altMove.defaultPrevented).toBe(true)
        expect(arrow.defaultPrevented).toBe(true)
        expect(enterFolder.defaultPrevented).toBe(true)
        expect(context.defaultPrevented).toBe(true)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(orderNow()).toEqual(['F[X,Y]', 'A', 'B'])
        expect(focusedKey()).toBe(folderKey('F'))
        expect(entries().length).toBe(3)
        expect(alertSelect).not.toHaveBeenCalled()
        const charEl = entryOf(charKey('A'))!
        await pressAndSettle(charEl, 'Enter')
        expect(changeCharSpy).not.toHaveBeenCalled()

        setLiveKeysBlockedReader(() => false)
        await pressAndSettle(charEl, 'Enter')
        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        folderEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
        await pressAndSettle(folderEl, 'ArrowDown', altDown)
        expect(orderNow()).toEqual(['A', 'F[X,Y]', 'B'])
    })
})

describe('folder menu (K10)', () => {
    test('a context menu on the focus target of a folder opens the menu once', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'A'])
        const folderEl = focusEntry(folderKey('F'))
        folderEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('guard: a right-click on the folder avatar opens the menu once', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'A'])
        folderAvatars(root)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await settle()
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('a context menu on a character opens nothing', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'A'])
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        focusEntry(charKey('A')).dispatchEvent(ev)
        await settle()
        expect(alertSelect).not.toHaveBeenCalled()
    })
})

describe('name on focus (K11)', () => {
    test('a shown tooltip adds no aria-describedby to its entry', async () => {
        await mountSidebar(['A', 'B'])
        const el = entryOf(charKey('A')) as (HTMLElement & { _tippy?: { show(): void; hide(): void; state: { isVisible: boolean } } }) | null
        expect(el?._tippy).toBeDefined()
        el!._tippy!.show()
        expect(el!._tippy!.state.isVisible).toBe(true)
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(el!.hasAttribute('aria-describedby')).toBe(false)
        el!._tippy!.hide()
    })

    test('each entry has one tooltip, on its focus target and not on its avatar', async () => {
        await mountSidebar(['A', folderOf('F', ['X', 'Y']), 'B'], 1)
        const withTippy = Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => (el as HTMLElement & { _tippy?: unknown })._tippy)
        expect(entries().length).toBe(5)
        expect(withTippy.length).toBe(5)
        for (const el of withTippy) {
            expect(el.hasAttribute('data-rail-entry')).toBe(true)
        }
    })
})
