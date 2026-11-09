// @vitest-environment happy-dom

/**
 * The reply indicators of the library (CHORE-685 S1b): the writing badge, the blue dot and the red dot on the Simple and
 * List rows (inside `CharacterNameRow`) and on the Grid tile, read from the real chat field and the real work registry.
 * The mount and the module mocks are those of `GridCatalog.restyle.svelte.test.ts` (same directory); `replyMarkOf` is wrapped
 * only to count how often a row reads a chat's mark.
 *
 * Labels: "reproducer" fails on the code before S1b (no indicator exists), "guard" passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

const markReads = vi.hoisted(() => ({ count: 0 }))

vi.mock(import('src/ts/process/replyMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        replyMarkOf: (...args: Parameters<typeof actual.replyMarkOf>) => {
            markReads.count += 1
            return actual.replyMarkOf(...args)
        },
    }
})

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

function makeCharacter(chaId: string, name: string, chatMarks: Array<'reply' | 'error' | undefined> = [undefined], trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: chatMarks.map((mark, index) => ({ id: `${chaId}-chat-${index}`, message: [{ role: 'user', data: 'hi', time: 1 }], note: '', name: '', localLore: [], unseenReply: mark })),
        trashTime,
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

// The Grid lays tiles out by the width of its box: four fit. happy-dom does no layout, and a missing ResizeObserver keeps
// the measured width fixed.
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
    for (const handle of handles) {
        handle.end()
    }
    handles = []
    for (const { target, app } of mounted) {
        await unmount(app as never)
        target.remove()
    }
    mounted = []
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

/** The tile of the character whose avatar is labelled `name`: its indicator parts. */
function partsOfTile(root: HTMLElement, name: string): string[] {
    const avatar = root.querySelector(`.ico[aria-label="${name}"]`)
    if (!avatar?.parentElement) {
        throw new Error(`no tile "${name}"`)
    }
    return Array.from(avatar.parentElement.querySelectorAll('[data-part^="reply-"]')).map((el) => el.getAttribute('data-part') ?? '')
}

function startWriting(chaId: string, chatId: string): WorkHandle {
    const handle = registerWork({ chaId, chatId }, undefined, 'reply')
    handles.push(handle)
    flushSync()
    return handle
}

//#endregion

describe('the Simple and List rows (T20)', () => {
    test.each([['Simple', null], ['List', language.list]] as Array<[string, string | null]>)('reproducer (T20, M21): %s: a blue dot, a red dot and a badge, on their own character only', (_view, label) => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', ['reply']),
            makeCharacter('b', 'Bob', ['error']),
            makeCharacter('c', 'Cy'),
            makeCharacter('d', 'Dee'),
        ])
        const root = mountComponent()
        if (label) {
            openView(root, label)
        }
        startWriting('d', 'd-chat-0')

        expect(partsOfRow(root, 'Ann')).toEqual(['reply-new-dot'])
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-error-dot'])
        expect(partsOfRow(root, 'Cy')).toEqual([])
        expect(partsOfRow(root, 'Dee')).toEqual(['reply-writing-badge'])
    })

    test('reproducer (T20): the indicators follow the field and the registry after the mount', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent()
        expect(partsOfRow(root, 'Ann')).toEqual([])

        DBState.db.characters[0].chats[0].unseenReply = 'reply'
        flushSync()
        expect(partsOfRow(root, 'Ann')).toEqual(['reply-new-dot'])

        const handle = startWriting('a', 'a-chat-0')
        expect(partsOfRow(root, 'Ann')).toEqual(['reply-writing-badge', 'reply-new-dot'])

        handle.end()
        flushSync()
        delete DBState.db.characters[0].chats[0].unseenReply
        flushSync()
        expect(partsOfRow(root, 'Ann')).toEqual([])
    })

    test('reproducer (T20): across a character\'s chats the red dot wins over the blue one', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', ['reply', 'error', 'reply']), makeCharacter('b', 'Bob', [undefined, 'reply'])])
        const root = mountComponent()
        expect(partsOfRow(root, 'Ann')).toEqual(['reply-error-dot'])
        expect(partsOfRow(root, 'Bob')).toEqual(['reply-new-dot'])
    })

    test('reproducer (T20): the dots carry their accessible names and the badge no aria-busy', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', ['reply']), makeCharacter('b', 'Bob', ['error'])])
        const root = mountComponent()
        startWriting('b', 'b-chat-0')
        expect(root.querySelector('[data-part="reply-new-dot"]')?.getAttribute('aria-label')).toBe(language.chatNewReplyDot)
        expect(root.querySelector('[data-part="reply-error-dot"]')?.getAttribute('aria-label')).toBe(language.chatReplyErrorDot)
        const badge = root.querySelector('[data-part="reply-writing-badge"]')
        expect(badge?.getAttribute('aria-label')).toBe(language.chatWritingBadge)
        expect(badge?.hasAttribute('aria-busy')).toBe(false)
    })

    test('guard: a name row with no indicator keeps the bare name as its text', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent()
        expect(root.querySelector('[data-part="character-name-row"]')?.textContent).toBe('Ann')
    })

    test('guard: a trashed character shows no indicator in the Trash list', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', ['error'], 1_700_000_000_000)])
        const root = mountComponent()
        openView(root, language.trash)
        expect(root.querySelectorAll('[data-part^="reply-"]').length).toBe(0)
    })
})

describe('the Grid tile (T20)', () => {
    test('reproducer (T20, M21): the tile shows the badge, the blue dot or the red dot of its own character', () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', ['reply']),
            makeCharacter('b', 'Bob', ['error']),
            makeCharacter('c', 'Cy'),
            makeCharacter('d', 'Dee'),
        ])
        const root = mountComponent()
        openView(root, language.grid)
        startWriting('d', 'd-chat-0')

        expect(partsOfTile(root, 'Ann')).toEqual(['reply-new-dot'])
        expect(partsOfTile(root, 'Bob')).toEqual(['reply-error-dot'])
        expect(partsOfTile(root, 'Cy')).toEqual([])
        expect(partsOfTile(root, 'Dee')).toEqual(['reply-writing-badge'])
    })

    test('reproducer (T20): the tile shows red if any chat is red, else blue if any is blue, and follows a clear', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', ['reply', 'error']), makeCharacter('b', 'Bob', ['reply', undefined])])
        const root = mountComponent()
        openView(root, language.grid)
        expect(partsOfTile(root, 'Ann')).toEqual(['reply-error-dot'])
        expect(partsOfTile(root, 'Bob')).toEqual(['reply-new-dot'])

        delete DBState.db.characters[0].chats[1].unseenReply
        flushSync()
        expect(partsOfTile(root, 'Ann')).toEqual(['reply-new-dot'])
    })
})

describe('the perf gate: a streamed token re-renders no row or tile (adversarial 5)', () => {
    test('guard: appending to a message 50 times reads no chat mark again, while a registration change does', () => {
        const characters = Array.from({ length: 30 }, (_value, index) => makeCharacter(`c${index}`, `Char ${index}`, ['reply', undefined]))
        DBState.db = buildDb(characters)
        const root = mountComponent()
        openView(root, language.grid)
        const settled = markReads.count
        expect(settled).toBeGreaterThan(0)

        for (let token = 0; token < 50; token++) {
            DBState.db.characters[0].chats[0].message[0].data += 'x'
            flushSync()
        }
        expect(markReads.count).toBe(settled)

        // The registry's version is the one thing a row reads besides the marks: a start re-reads, a token does not.
        startWriting('c3', 'c3-chat-0')
        expect(markReads.count).toBeGreaterThan(settled)
    })
})
