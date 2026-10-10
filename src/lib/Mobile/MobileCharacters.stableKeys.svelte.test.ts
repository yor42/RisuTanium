// @vitest-environment happy-dom

/**
 * `MobileCharacters.svelte`: a row is keyed by the character it shows, not by its position in
 * `db.characters`. The position the list returns to after the trash view was open therefore
 * names the same character when the trash view removed a character from an earlier slot.
 *
 * Test labels: `(R)` is a reproducer: it fails on the index-keyed list with an assertion about the
 * defect (the list comes back at another character).
 *
 * MOCKED: the module set of `MobileCharacters.trash.svelte.test.ts` (same directory), with `changeChar`
 * a bare spy; geometry is faked as in `MobileCharacters.window.svelte.test.ts`. The permanent delete
 * is the splice `removeChar(..., 'permanent')` performs on `db.characters`. Nothing here writes to
 * storage.
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

const { changeCharSpy } = vi.hoisted(() => ({
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

import { DBState, MobileSearch } from '../../ts/stores.svelte'
import { language } from '../../lang'
import MobileCharacters from './MobileCharacters.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const GONE = 1_700_000_000_000
const VIEWPORT = 600
const ROW = 73
const LIVE = 40

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

/**
 * One trashed character at slot 0, then LIVE live ones. Character `i` has the interaction `i + 1`,
 * so the list shows `Character LIVE-1` first and `Character 0` last.
 */
function fixture(): CharacterFixture[] {
    return [
        makeCharacter('gone', 'Gone', { trashTime: GONE }),
        ...Array.from({ length: LIVE }, (_, i) => makeCharacter(`id-${i}`, `Character ${i}`, { lastInteraction: i + 1 })),
    ]
}

/** The name the list shows at row `ordinal`, counted from the top. */
const nameAtRow = (ordinal: number): string => `Character ${LIVE - 1 - ordinal}`

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

let restoreGeometry: () => void = () => {}

/** A container height of `VIEWPORT` and a scroll position clamped to the list's total, for every element. */
function installGeometry(): () => void {
    const tops = new WeakMap<Element, number>()
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
            return tops.get(this) ?? 0
        },
        set(this: HTMLElement, value: number) {
            const total = Number(this.getAttribute('data-charlist-total') ?? Number.POSITIVE_INFINITY)
            tops.set(this, Math.max(0, Math.min(value, Math.max(0, total - VIEWPORT))))
        },
    })
    return () => {
        for (const [name, descriptor] of [['clientHeight', clientHeight], ['scrollTop', scrollTop]] as const) {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor)
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
            }
        }
    }
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

async function scrollAndSettle(root: ParentNode, top: number): Promise<void> {
    const el = scrollerOf(root)
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
    await settleFrame()
}

async function withMounted(props: { trashEntry?: boolean }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileCharacters, { target, props }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
}

const rowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')

beforeEach(() => {
    changeCharSpy.mockClear()
    MobileSearch.set('')
    vi.stubGlobal('ResizeObserver', undefined)
    restoreGeometry = installGeometry()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    restoreGeometry()
})

//#endregion

describe('MobileCharacters returns to the same character after the trash view', { timeout: 60_000 }, () => {
    test('(R) a permanent delete of an earlier slot in the trash view leaves the list at the same top row', async () => {
        DBState.db = buildDb(fixture())
        await withMounted({ trashEntry: true }, async (target) => {
            await scrollAndSettle(target, 20 * ROW)
            expect(scrollerOf(target).scrollTop).toBe(20 * ROW)

            buttonWith(target, `${language.trash} (1)`)!.click()
            await settle()
            // The trashed character at slot 0 goes: every live character moves one slot down.
            DBState.db.characters.splice(0, 1)
            await settle()
            buttonWith(target, language.settingsPage.back)!.click()
            await settleFrame()
            await settleFrame()

            const top = scrollerOf(target).scrollTop
            expect(top % ROW).toBe(0)
            expect(nameAtRow(top / ROW)).toBe(nameAtRow(20))
            expect(rowNames(target)).toContain(nameAtRow(20))
        })
    })
})
