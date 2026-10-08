// @vitest-environment happy-dom

/**
 * Hidden system characters (`§playground`, `§temp`) on the character rail, driven through the
 * REAL `Sidebar.svelte` (and so the real `SidebarRail.svelte`) with synthetic key, pointer and
 * context-menu events and fake geometry (`installGeometry`, see `sidebarDnd.testKit.ts`).
 *
 * REAL here: `trashFolderMembers` (src/ts/characters.ts). MOCKED: `checkCharOrder` (a spy, so
 * the order after a choice is exactly what the rail and the trash wrote), `changeChar`,
 * `alertSelect` (answers from a queue and records what it was offered), `alertConfirm`,
 * `alertInput`, and the storage and platform modules.
 *
 * Test labels: `(R)` is a regression reproducer that fails on the rail before the hidden
 * characters were taken off it; `(G)` is a compatibility guard that passes before and after.
 */
import { mount, tick, unmount } from 'svelte'
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

const { checkCharOrderSpy, changeCharSpy, selectAnswers, selectOffers } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
    selectAnswers: [] as Array<string | (() => string)>,
    selectOffers: [] as string[][],
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
    alertSelect: vi.fn(async (offered: string[]) => {
        selectOffers.push([...offered])
        const answer = selectAnswers.shift() ?? '5'
        return typeof answer === 'function' ? answer() : answer
    }),
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => 'Renamed'),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { alertConfirm } from 'src/ts/alert'
import Sidebar from './Sidebar.svelte'
import { charKey, folderKey, memberKey } from './railTestKit'
import { charRow, defaultSettle, dragOnto, folderAvatars, installGeometry, resetRailMemory, topGaps } from './sidebarDnd.testKit'

//#region fixture and helpers

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })

const T0 = 1_700_000_000_000

/** Every id in the order gets a character, except the ids listed in `unknown`. */
function setDb(order: OrderFixture, unknown: string[] = []): void {
    const ids = order.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.data)).filter((id) => !unknown.includes(id))
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: ids.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
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

async function mountRail(order: OrderFixture, openFolders = 0, unknown: string[] = []): Promise<void> {
    setDb(order, unknown)
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
}

beforeEach(() => {
    resetRailMemory()
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    selectAnswers.length = 0
    selectOffers.length = 0
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    selectedCharID.set(-1)
})

afterEach(async () => {
    try {
        if (mounted) {
            await unmount(mounted.app as never)
            mounted.target.remove()
            mounted = null
        }
    } catch {
        // a sidebar that failed half way through mounting is torn down best effort
    }
    document.body.innerHTML = ''
})

const orderNow = (): string[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).map((e) => (typeof e === 'string' ? e : `${e.id}[${e.data.join(',')}]`))
const folderNames = (): string[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).flatMap((e) => (typeof e === 'string' ? [] : [e.name]))
const trashedNames = (): string[] => DBState.db.characters.filter((c) => c.trashTime && c.trashTime !== T0).map((c) => c.name)
const entries = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
const entryKeys = (): string[] => entries().map((el) => el.getAttribute('data-rail-entry')!)
const entryOf = (key: string): HTMLElement | null => entries().find((el) => el.getAttribute('data-rail-entry') === key) ?? null
const liveText = (): string => root.querySelector<HTMLElement>('[aria-live="polite"]')!.textContent ?? ''

function focusEntry(key: string): HTMLElement {
    const el = entryOf(key)
    expect(el).not.toBeNull()
    el!.focus()
    return el!
}

async function altArrow(key: string, arrow: 'ArrowUp' | 'ArrowDown'): Promise<void> {
    focusEntry(key).dispatchEvent(new KeyboardEvent('keydown', { key: arrow, altKey: true, bubbles: true, cancelable: true }))
    await settle()
}

/** Opens the context menu of the folder row with `key` and answers the dialogs in turn. */
async function chooseFromMenu(key: string, ...answers: Array<string | (() => string)>): Promise<void> {
    selectAnswers.push(...answers)
    entryOf(key)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
}

//#endregion

describe('what the rail shows', () => {
    test('(R) a hidden character is not a row at the top level or in an open folder', async () => {
        await mountRail(['a', '§playground', folderOf('F', ['x', '§temp', 'y']), 'b'], 1)

        expect(entryKeys()).toEqual([charKey('a'), folderKey('F'), memberKey('F', 'x'), memberKey('F', 'y'), charKey('b')])
    })

    test('(R) a folder whose members are all hidden is not a row, and neither is a folder of only unknown ids', async () => {
        await mountRail(['a', folderOf('H', ['§playground', '§temp']), folderOf('U', ['gone']), 'b'], 0, ['gone'])

        expect(entryKeys()).toEqual([charKey('a'), charKey('b')])
        expect(folderAvatars(root)).toHaveLength(0)
        expect(orderNow()).toEqual(['a', 'H[§playground,§temp]', 'U[gone]', 'b'])
    })

    test('(R) a hidden character is not a row, and selecting it and asking the rail to scroll (a guard) changes nothing', async () => {
        await mountRail(['a', '§playground', 'b'])
        selectedCharID.set(DBState.db.characters.findIndex((c) => c.chaId === '§playground'))
        window.dispatchEvent(new Event('scrollToActiveCharacter'))
        await settle()

        expect(entryKeys()).toEqual([charKey('a'), charKey('b')])
        expect(orderNow()).toEqual(['a', '§playground', 'b'])
    })
})

describe('keyboard moves around hidden characters', () => {
    test('(R) a character moves past its visible neighbour and the hidden id between them keeps its place', async () => {
        await mountRail(['a', '§playground', 'b'])
        await altArrow(charKey('a'), 'ArrowDown')

        expect(orderNow()).toEqual(['§playground', 'b', 'a'])
        expect(liveText()).toBe('Position 2 of 2')
    })

    test('(R) a hidden-only folder before the row does not count in the announced position or total', async () => {
        await mountRail(['a', folderOf('H', ['§temp']), 'b', 'c'])
        await altArrow(charKey('b'), 'ArrowDown')

        expect(orderNow()).toEqual(['a', 'H[§temp]', 'c', 'b'])
        expect(liveText()).toBe('Position 3 of 3')
    })

    test('(G) a closed folder still counts in the announced position', async () => {
        await mountRail([folderOf('F', ['x', 'y']), 'b', 'c'])
        await altArrow(charKey('b'), 'ArrowDown')

        expect(liveText()).toBe('Position 3 of 3')
    })

    test('(R) the only visible member of a folder is refused, with the message for a sole member', async () => {
        await mountRail([folderOf('F', ['x', '§temp']), 'a'], 1)
        await altArrow(memberKey('F', 'x'), 'ArrowDown')

        expect(orderNow()).toEqual(['F[x,§temp]', 'a'])
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(liveText()).toBe(language.sidebarUi.moveWouldRemoveFolder('Name F'))
    })

    test('(R) a member of a folder with another visible member moves past it and then out, and the hidden id stays in the folder', async () => {
        await mountRail([folderOf('F', ['x', '§temp', 'y']), 'a'], 1)
        await altArrow(memberKey('F', 'x'), 'ArrowDown')
        expect(orderNow()).toEqual(['F[§temp,y,x]', 'a'])

        await altArrow(memberKey('F', 'x'), 'ArrowDown')
        expect(orderNow()).toEqual(['F[§temp,y]', 'x', 'a'])
    })
})

describe('drag and drop around hidden characters', () => {
    test('(R) a drag lands after the visible neighbour and leaves the hidden id where it was', async () => {
        await mountRail(['a', '§playground', 'b'])
        await dragOnto(root, charRow(root, 'a'), topGaps(root)[2])

        expect(orderNow()).toEqual(['§playground', 'b', 'a'])
    })

    test('(R) dragging the last visible member out leaves the folder in the saved order but off the rail', async () => {
        await mountRail([folderOf('F', ['x', '§temp']), 'a'], 1)
        await dragOnto(root, charRow(root, 'x'), topGaps(root)[topGaps(root).length - 1])

        expect(orderNow()).toEqual(['F[§temp]', 'a', 'x'])
        expect(entryKeys()).toEqual([charKey('a'), charKey('x')])
    })
})

describe('the folder menu with hidden members', () => {
    test('(R) Delete folder counts and trashes only visible members and puts hidden ones where the folder was', async () => {
        await mountRail(['a', folderOf('F', ['m0', '§temp', 'm1']), 'b'])
        await chooseFromMenu(folderKey('F'), '4', '1')

        expect(selectOffers[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(2), language.cancel])
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.deleteFolderTrashConfirm('Name F', 2))
        expect(trashedNames().sort()).toEqual(['m0', 'm1'])
        expect(DBState.db.characters.find((c) => c.chaId === '§temp')!.trashTime).toBeUndefined()
        expect(orderNow()).toEqual(['a', '§temp', 'b'])
    })

    test('(G) cancelling the trash changes nothing', async () => {
        await mountRail(['a', folderOf('F', ['m0', '§temp']), 'b'])
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        await chooseFromMenu(folderKey('F'), '4', '1')

        expect(trashedNames()).toEqual([])
        expect(orderNow()).toEqual(['a', 'F[m0,§temp]', 'b'])
    })

    test('(G) Ungroup and Keep put every id, hidden ones included, where the folder was', async () => {
        await mountRail(['a', folderOf('F', ['m0', '§temp']), 'b'])
        await chooseFromMenu(folderKey('F'), '3')
        expect(orderNow()).toEqual(['a', 'm0', '§temp', 'b'])

        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        await mountRail(['a', folderOf('F', ['m0', '§temp']), 'b'])
        await chooseFromMenu(folderKey('F'), '4', '0')
        expect(orderNow()).toEqual(['a', 'm0', '§temp', 'b'])
    })
})

describe('a hidden-only folder with the id of a shown folder (writes land on the shown one)', () => {
    const order = (): OrderFixture => [folderOf('F', ['§temp']), 'a', folderOf('F', ['m0', 'm1'])]
    const shown = folderKey('F', 1)

    test('(R) only the second occurrence is on the rail', async () => {
        await mountRail(order())

        expect(entryKeys()).toEqual([charKey('a'), shown])
    })

    test('(G) Ungroup acts on the shown folder', async () => {
        await mountRail(order())
        await chooseFromMenu(shown, '3')

        expect(orderNow()).toEqual(['F[§temp]', 'a', 'm0', 'm1'])
    })

    test('(G) Delete folder, Keep, acts on the shown folder', async () => {
        await mountRail(order())
        await chooseFromMenu(shown, '4', '0')

        expect(orderNow()).toEqual(['F[§temp]', 'a', 'm0', 'm1'])
    })

    test('(R) Delete folder, trash, acts on the shown folder and not on its same-id twin', async () => {
        await mountRail(order())
        await chooseFromMenu(shown, '4', '1')

        expect(trashedNames().sort()).toEqual(['m0', 'm1'])
        expect(orderNow()).toEqual(['F[§temp]', 'a'])
    })

    test('(R) a keyboard move of the shown folder moves it and not its twin', async () => {
        await mountRail(order())
        await altArrow(shown, 'ArrowUp')

        expect(orderNow()).toEqual(['F[m0,m1]', 'F[§temp]', 'a'])
    })

    test('(G) renaming is refused for either folder, as for any duplicate id', async () => {
        await mountRail(order())
        const before = folderNames()
        await chooseFromMenu(shown, '0')

        expect(folderNames()).toEqual(before)
    })
})
