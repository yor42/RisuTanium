// @vitest-environment happy-dom

/**
 * "Ungroup" and "Delete folder" in the folder menu of the character rail, driven through the
 * REAL `Sidebar.svelte` (and so the real `SidebarRail.svelte`). The menu is opened with a
 * `contextmenu` event on the folder row, as a right click or the keyboard does.
 *
 * REAL here: `trashFolderMembers` (src/ts/characters.ts). MOCKED: `checkCharOrder` (a spy, so
 * the order after a choice is exactly what the rail wrote), `changeChar`, the chat list,
 * `alertSelect` (answers from a queue and records what it was offered), `alertConfirm` and
 * `alertInput`, and the storage and platform modules.
 *
 * Test labels: `(R)` fails against the rail before this change; `(G)` is proven by a named
 * mutant of the rail that it fails against.
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
    alertInput: vi.fn(async () => ''),
}))


import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { alertConfirm } from 'src/ts/alert'
import Sidebar from './Sidebar.svelte'
import { OPEN_FOLDERS_KEY } from './railMemory'
import { defaultSettle, folderAvatars, installGeometry, resetRailMemory } from './sidebarDnd.testKit'

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

function setDb(order: OrderFixture, trashed: string[] = []): void {
    const ids = order.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.data))
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: ids.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0, trashTime: trashed.includes(chaId) ? T0 : undefined })),
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

async function mountRail(order: OrderFixture, trashed: string[] = []): Promise<void> {
    setDb(order, trashed)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    installGeometry(target, 600)
    root = target
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

/** Opens the folder menu and answers the dialogs with `answers` in turn; waits for the choices to be applied. */
async function chooseFromMenu(...answers: Array<string | (() => string)>): Promise<void> {
    selectAnswers.push(...answers)
    folderAvatars(root)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
}

const orderNow = (): string[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).map((e) => (typeof e === 'string' ? e : `${e.id}[${e.data.join(',')}]`))
const trashedNames = (): string[] => DBState.db.characters.filter((c) => c.trashTime && c.trashTime !== T0).map((c) => c.name)

//#endregion

describe('the folder menu', () => {
    test('(R) offers Ungroup and Delete folder before Cancel', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1']), 'b'])
        await chooseFromMenu('5')

        expect(selectOffers).toEqual([[language.renameFolder, language.changeFolderColor, language.changeFolderImage, language.ungroupFolder, language.deleteFolder, language.cancel]])
        expect(orderNow()).toEqual(['a', 'F[m0,m1]', 'b'])
    })

    test('(R) Ungroup puts the members where the folder was, in folder order, and forgets the folder as open', async () => {
        await mountRail(['a', folderOf('F', ['m1', 'm0']), 'b'])
        folderAvatars(root)[0].click()
        await settle()
        expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual(['F'])

        await chooseFromMenu('3')

        expect(orderNow()).toEqual(['a', 'm1', 'm0', 'b'])
        expect(checkCharOrderSpy).toHaveBeenCalled()
        expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual([])
    })

    test('(G) with two folders sharing an id, Ungroup acts on the one the menu was opened on', async () => {
        await mountRail([folderOf('F', ['m0']), 'a', folderOf('F', ['m1', 'm2'])])
        const second = folderAvatars(root)[1]
        selectAnswers.push('3')
        second.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await settle()

        expect(orderNow()).toEqual(['F[m0]', 'a', 'm1', 'm2'])
    })
})

describe('Delete folder', () => {
    test('(R) offers keeping the characters or moving them to the trash with their count', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1', 'm2']), 'b'])
        await chooseFromMenu('4', '2')

        expect(selectOffers[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(3), language.cancel])
        expect(orderNow()).toEqual(['a', 'F[m0,m1,m2]', 'b'])
        expect(trashedNames()).toEqual([])
    })

    test('(G) keeping the characters gives the order Ungroup gives, with every id kept', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1', 'm2']), 'b'])
        await chooseFromMenu('4', '0')

        expect(orderNow()).toEqual(['a', 'm0', 'm1', 'm2', 'b'])
        expect(trashedNames()).toEqual([])
    })

    test('(R) moving to the trash trashes exactly the members, once confirmed, and leaves the others', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1', 'm2']), 'b'])
        await chooseFromMenu('4', '1')

        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.deleteFolderTrashConfirm('Name F', 3))
        expect(trashedNames().sort()).toEqual(['m0', 'm1', 'm2'])
        expect(DBState.db.characters.find((c) => c.name === 'a')!.trashTime).toBeUndefined()
        expect(DBState.db.characters.find((c) => c.name === 'b')!.trashTime).toBeUndefined()
        expect(checkCharOrderSpy).toHaveBeenCalled()
    })

    test('(G) members already in the trash are not counted and a folder of only trashed members offers just Keep', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1', 'm2'])], ['m2'])
        await chooseFromMenu('4', '2')
        expect(selectOffers[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(2), language.cancel])

        selectOffers.length = 0
        await mountRailAgain(['a', folderOf('F', ['m0'])], ['m0'])
        await chooseFromMenu('4', '1')
        expect(selectOffers[1]).toEqual([language.deleteFolderKeep, language.cancel])
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('(U) declining the confirmation, or choosing Cancel, changes nothing', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1']), 'b'])
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        await chooseFromMenu('4', '1')
        expect(trashedNames()).toEqual([])

        await chooseFromMenu('4', '2')
        expect(trashedNames()).toEqual([])
        expect(orderNow()).toEqual(['a', 'F[m0,m1]', 'b'])
    })

    test('(G) a folder that is gone when the choice is made changes nothing', async () => {
        await mountRail(['a', folderOf('F', ['m0', 'm1']), 'b'])
        await chooseFromMenu('4', () => {
            DBState.db.characterOrder = ['a', 'b']
            return '1'
        })

        expect(trashedNames()).toEqual([])
        expect(alertConfirm).not.toHaveBeenCalled()
    })
})

async function mountRailAgain(order: OrderFixture, trashed: string[]): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    await mountRail(order, trashed)
}
