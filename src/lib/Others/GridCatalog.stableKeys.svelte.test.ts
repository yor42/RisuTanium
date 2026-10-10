// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: a card is keyed by the character it shows, not by its position in
 * `db.characters`. Deleting another character therefore moves neither the keyboard focus nor the
 * card's key onto a different character.
 *
 * Test labels: `(R)` is a reproducer: it fails on the index-keyed lists with an assertion about the
 * defect (focus or a key now belonging to another character). `(G)` is a guard that may pass before
 * and after.
 *
 * MOCKED: the module set of `GridCatalog.window.svelte.test.ts` (same directory), with `changeChar`
 * and `removeChar` bare spies. The permanent delete is the splice `removeChar(..., 'permanent')`
 * performs on `db.characters`. Nothing here writes to storage.
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

const { changeCharSpy, removeCharSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
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
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

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

/** Characters A to E, each with its own chaId. */
const alphabet = (): CharacterFixture[] => ['A', 'B', 'C', 'D', 'E'].map((name) => makeCharacter(`id-${name}`, name))

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 2 | 3): void {
    const label =
        (layout === 0 ? language.grid : layout === 1 ? language.list : layout === 2 ? language.trash : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

/** The name button of the List row showing `name`. */
function nameButton(root: ParentNode, name: string): HTMLButtonElement {
    const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    const button = heading?.querySelector('button')
    if (!button) {
        throw new Error(`no List row named "${name}"`)
    }
    return button
}

function tileNamed(root: ParentNode, name: string): HTMLButtonElement {
    const tile = root.querySelector<HTMLButtonElement>(`.ico[aria-label="${name}"]`)
    if (!tile) {
        throw new Error(`no Grid tile named "${name}"`)
    }
    return tile
}

const keyOfCard = (card: Element): string => card.closest('[data-charlist-key]')!.getAttribute('data-charlist-key')!

/** Four tiles fit (a tile is 56 px and a gap 8 px at 16 px per rem). */
const FOUR_COLUMNS = 312

let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => FOUR_COLUMNS })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('GridCatalog cards follow the character, not its position', { timeout: 60_000 }, () => {
    test('(R) the List tab keeps focus on D when an earlier character is deleted permanently', async () => {
        DBState.db = buildDb(alphabet())
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const button = nameButton(target, 'D')
            button.focus()
            expect(document.activeElement).toBe(button)

            DBState.db.characters.splice(1, 1)
            await settle()

            expect(document.activeElement?.textContent?.trim()).toBe('D')
        })
    })

    test('(R) the Grid tab keeps focus on D when an earlier character is deleted permanently', async () => {
        DBState.db = buildDb(alphabet())
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const tile = tileNamed(target, 'D')
            tile.focus()
            expect(document.activeElement).toBe(tile)

            DBState.db.characters.splice(1, 1)
            await settle()

            expect(document.activeElement?.getAttribute('aria-label')).toBe('D')
        })
    })

    test('(R) the card that showed E still shows E after an earlier character is deleted', async () => {
        DBState.db = buildDb(alphabet())
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const before = keyOfCard(tileNamed(target, 'E'))

            DBState.db.characters.splice(1, 1)
            await settle()

            expect(keyOfCard(tileNamed(target, 'E'))).toBe(before)
        })
    })

    test('(R) the List row that showed E keeps its key after an earlier character is deleted', async () => {
        DBState.db = buildDb(alphabet())
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const before = keyOfCard(nameButton(target, 'E'))

            DBState.db.characters.splice(1, 1)
            await settle()

            expect(keyOfCard(nameButton(target, 'E'))).toBe(before)
        })
    })

    // Passes before and after: key and index change in the same flush, so a click never acts on a stale slot.
    test('(G) a click on a Grid tile after a delete opens the character the tile shows', async () => {
        DBState.db = buildDb(alphabet())
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            DBState.db.characters.splice(1, 1)
            await settle()

            tileNamed(target, 'D').click()
            const opened = changeCharSpy.mock.calls[0][0] as number
            expect(DBState.db.characters[opened].name).toBe('D')
        })
    })

    // Passes before and after: slots sharing a chaId were already told apart by their position.
    test('(G) two characters sharing a chaId get distinct keys, both render, and a query keeps the second one\'s key', async () => {
        DBState.db = buildDb([makeCharacter('dup', 'First'), makeCharacter('dup', 'Second'), makeCharacter('other', 'Third')])
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const first = keyOfCard(tileNamed(target, 'First'))
            const second = keyOfCard(tileNamed(target, 'Second'))
            expect(first).not.toBe(second)
            expect(target.querySelectorAll('.ico').length).toBe(3)

            const input = target.querySelector('input')!
            input.value = 'Second'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settle()

            expect(target.querySelectorAll('.ico').length).toBe(1)
            expect(keyOfCard(tileNamed(target, 'Second'))).toBe(second)
        })
    })
})
