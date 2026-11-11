// @vitest-environment happy-dom

/**
 * How a Simple or List row finds its character for the reply indicators (CHORE-705): one map from id to the first live
 * holder, shared by every row, instead of a scan of the whole list per row. The mount and the module mocks are those of
 * `GridCatalog.replyMarks.svelte.test.ts` (same directory).
 *
 * Labels: "reproducer" fails on the per-row scan, "guard" passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
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
            changeChatTo: vi.fn(),
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            fetchNative: vi.fn(),
            toGetter: vi.fn((obj: unknown) => obj),
            aiWatermarkingLawApplies: vi.fn(() => false),
            aiLawApplies: vi.fn(() => false),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        ...actual,
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
    }
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
        OpenRealmStore: writable(false),
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

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'
import { registerWork, type WorkHandle } from '../../ts/process/chatOrigin'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, chatMarks: Array<'reply' | 'error' | undefined> = [undefined], trashTime?: number, lastInteraction = 0): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction,
        chats: chatMarks.map((mark, index) => ({ id: `${chaId}-chat-${index}`, message: [{ role: 'user', data: 'hi', time: 1 }], note: '', name: '', localLore: [], unseenReply: mark })),
        trashTime,
    } as unknown as CharacterFixture
}

/** Counts every read of `chaId` and `trashTime` through prototype getters. Svelte leaves an object whose prototype is
 *  not Object.prototype unproxied, so each read reaches the getter. */
const slotReads = { count: 0 }

class CountingCharacter {
    name: string
    type = 'character'
    image = ''
    creatorNotes = ''
    chatPage = 0
    lastInteraction: number
    chats: unknown[]
    private id: string
    constructor(chaId: string, name: string, lastInteraction: number) {
        this.id = chaId
        this.name = name
        this.lastInteraction = lastInteraction
        this.chats = [{ id: `${chaId}-chat-0`, message: [{ role: 'user', data: 'hi', time: 1 }], note: '', name: '', localLore: [] }]
    }
    get chaId(): string {
        slotReads.count += 1
        return this.id
    }
    get trashTime(): number | undefined {
        slotReads.count += 1
        return undefined
    }
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
        characterOrder: characters.filter((c) => !c.trashTime).map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

type Mounted = { target: HTMLElement; app: Record<string, unknown> }
let mounted: Mounted[] = []
let handles: WorkHandle[] = []

function mountComponent(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

async function unmountAll(): Promise<void> {
    for (const handle of handles) {
        handle.end()
    }
    handles = []
    for (const { target, app } of mounted) {
        await unmount(app as never)
        target.remove()
    }
    mounted = []
}

const FOUR_COLUMNS = 312
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => FOUR_COLUMNS })
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: undefined })
})

afterEach(async () => {
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    }
    if (resizeObserverDescriptor) {
        Object.defineProperty(globalThis, 'ResizeObserver', resizeObserverDescriptor)
    } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver')
    }
    await unmountAll()
})

function openView(root: HTMLElement, label: string): void {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label.trim())
    if (!found) {
        throw new Error(`no button "${label}"`)
    }
    found.click()
    flushSync()
}

/** The indicator parts inside the name row whose text is `name`. */
function partsOfRow(root: HTMLElement, name: string): string[] {
    const row = Array.from(root.querySelectorAll('[data-part="character-name-row"]')).find((el) => el.firstChild?.textContent === name)
    if (!row) {
        throw new Error(`no row "${name}"`)
    }
    return Array.from(row.querySelectorAll('[data-part^="reply-"]')).map((el) => el.getAttribute('data-part') ?? '')
}

/** Mounts the Simple tab over `count` counting characters (the array's tail is the most recent, so it shows first), starts
 *  a reply registration for the last one and returns the rows mounted and the slot reads that registration caused. */
function registrationCost(count: number): { rows: number, reads: number } {
    const characters = Array.from({ length: count }, (_value, index) => new CountingCharacter(`c${index}`, `Char ${index}`, index + 1))
    DBState.db = buildDb(characters as unknown as CharacterFixture[])
    const root = mountComponent()
    const rows = root.querySelectorAll('[data-part="character-name-row"]').length
    slotReads.count = 0
    handles.push(registerWork({ chaId: `c${count - 1}`, chatId: `c${count - 1}-chat-0` }, undefined, 'reply'))
    flushSync()
    return { rows, reads: slotReads.count }
}

//#endregion

describe('the row lookup of the reply indicators (CHORE-705)', () => {
    test('reproducer (T1, M3, M4): the slot reads a registration causes do not grow with the length of the list', async () => {
        const small = registrationCost(50)
        await unmountAll()
        const large = registrationCost(500)

        // The comparison below is about the lookup only if both mounts draw the same number of rows.
        expect(small.rows).toBeGreaterThan(0)
        expect(large.rows).toBe(small.rows)
        expect(small.reads).toBeGreaterThan(0)
        expect(large.reads).toBe(small.reads)
    })

    test('guard (T2): two live slots of one id: every row of that id shows the first holder\'s state', () => {
        DBState.db = buildDb([
            makeCharacter('x', 'Ann', ['error'], undefined, 2),
            makeCharacter('x', 'Bob', ['reply'], undefined, 1),
        ])
        const root = mountComponent()
        expect(partsOfRow(root, 'Ann')).toEqual(['reply-error-dot'])
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-error-dot'])
    })

    test('guard (T3): trashing the first holder moves the shared id to the remaining holder at once', () => {
        DBState.db = buildDb([
            makeCharacter('x', 'Ann', ['error'], undefined, 2),
            makeCharacter('x', 'Bob', ['reply'], undefined, 1),
        ])
        const root = mountComponent()
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-error-dot'])

        DBState.db.characters[0].trashTime = 1_700_000_000_000
        flushSync()
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-new-dot'])
    })

    test('guard (T3): a character restored from the trash becomes the holder of its id again', () => {
        DBState.db = buildDb([
            makeCharacter('x', 'Ann', ['error'], 1_700_000_000_000, 2),
            makeCharacter('x', 'Bob', ['reply'], undefined, 1),
        ])
        const root = mountComponent()
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-new-dot'])

        delete DBState.db.characters[0].trashTime
        flushSync()
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-error-dot'])
    })

    test('guard (T4): a trashed character with no live holder shows no indicator in the Trash list', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', ['error'], 1_700_000_000_000)])
        const root = mountComponent()
        openView(root, language.trash)
        expect(root.querySelectorAll('[data-part^="reply-"]').length).toBe(0)
    })
})
