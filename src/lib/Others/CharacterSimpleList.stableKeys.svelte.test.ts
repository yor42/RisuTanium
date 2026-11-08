// @vitest-environment happy-dom

/**
 * `CharacterSimpleList.svelte`: a row is keyed by the character it shows, not by its position in
 * `db.characters`. `CharacterWindow` follows focus by that key (`data-charlist-key`), so a removal
 * from an earlier slot must leave every other row's key on its own character.
 *
 * Test labels: `(G)` is a compatibility guard: it passes on the keyed list and fails on an
 * index-keyed one (mutant: `key: String(i)` in `sorted`).
 *
 * MOCKED: the module set of `CharacterSimpleList.trash.svelte.test.ts` (same directory), with `changeChar`
 * a bare spy. The permanent delete is the splice `removeChar(..., 'permanent')` performs on
 * `db.characters`. Nothing here writes to storage.
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
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
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

import { DBState } from '../../ts/stores.svelte'
import CharacterSimpleList from './CharacterSimpleList.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const GONE = 1_700_000_000_000
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

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(props: Record<string, never>, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterSimpleList, { target, props }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

/** The `data-charlist-key` of the row showing `name`, or null when no rendered row shows it. */
function keyOfRowShowing(root: ParentNode, name: string): string | null {
    const label = Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).find((s) => s.textContent?.trim() === name)
    return label?.closest('[data-charlist-key]')?.getAttribute('data-charlist-key') ?? null
}

beforeEach(() => {
    changeCharSpy.mockClear()
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

//#endregion

describe('CharacterSimpleList keeps a row on its character', { timeout: 60_000 }, () => {
    test('(G) a row keeps its key on its character when an earlier slot is deleted', async () => {
        DBState.db = buildDb(fixture())
        await withMounted({}, async (target) => {
            const shown = `Character ${LIVE - 1}`
            const before = keyOfRowShowing(target, shown)
            expect(before).not.toBeNull()

            // The trashed character at slot 0 goes: every live character moves one slot down.
            DBState.db.characters.splice(0, 1)
            await settle()

            expect(keyOfRowShowing(target, shown)).toBe(before)
        })
    })
})
