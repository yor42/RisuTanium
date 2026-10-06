// @vitest-environment happy-dom

/**
 * `MobileCharacters.svelte` never lists or selects the two system characters
 * kept in `db.characters`: the Playground's `'§playground'` utility bot and a
 * stray `'§temp'` copy left by an upstream multiuser save. Both are skipped
 * with the trash hidden and shown, whatever the search text, trashed or not.
 * An ordinary character that merely shares the name 'assistant' is listed like
 * any other, and a row still selects its own `db.characters` index.
 *
 * MOCKED: the module set of `GridCatalog.hiddenCharacters.svelte.test.ts`
 * (`src/lib/Others`), with `changeChar` a bare spy. Nothing here writes to
 * storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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

class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

import { DBState } from '../../ts/stores.svelte'
import MobileCharacters from './MobileCharacters.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const ALICE = 0
const PLAYGROUND = 1
const TEMP = 2
const NAMED_ASSISTANT = 3

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

/** [Alice, the Playground, a stray temp copy, an ordinary character named 'assistant']. */
function standardCharacters(): CharacterFixture[] {
    return [
        makeCharacter('alice-id', 'Alice'),
        makeCharacter('§playground', 'assistant', { utilityBot: true }),
        makeCharacter('§temp', 'Temp Copy'),
        makeCharacter('named-assistant-id', 'assistant'),
    ]
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

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(props: { hideTrash?: boolean; search?: string }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
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

/** One entry per list row, in display order: the row's name and the index it hands to `changeChar` when clicked. */
function rows(root: HTMLElement): { name: string; index: number }[] {
    const result: { name: string; index: number }[] = []
    const names = Array.from(root.querySelectorAll('div.flex-1 > span:first-child'))
    for (const nameSpan of names) {
        const row = nameSpan.closest('button') as HTMLButtonElement
        changeCharSpy.mockClear()
        row.click()
        result.push({
            name: nameSpan.textContent?.trim() ?? '',
            index: changeCharSpy.mock.calls[0]?.[0] as number,
        })
    }
    return result
}

function trashAll(indices: number[]): void {
    for (const index of indices) {
        DBState.db.characters[index].trashTime = Date.now() - 1000
    }
}

beforeEach(() => {
    changeCharSpy.mockClear()
})

//#endregion

describe('MobileCharacters skips the Playground and stray temp characters', { timeout: 60_000 }, () => {
    test.each([
        ['hidden', true],
        ['shown', false],
    ] as const)('with the trash %s, Alice and the ordinary "assistant" are listed and neither system character is', async (_label, hideTrash) => {
        DBState.db = buildDb(standardCharacters())

        await withMounted({ hideTrash }, (target) => {
            expect(rows(target)).toEqual([
                { name: 'Alice', index: ALICE },
                { name: 'assistant', index: NAMED_ASSISTANT },
            ])
        })
    })

    test('with the trash shown, trashed system characters are not listed and the trashed ordinary character is', async () => {
        DBState.db = buildDb(standardCharacters())
        trashAll([PLAYGROUND, TEMP, NAMED_ASSISTANT])

        await withMounted({ hideTrash: false }, (target) => {
            expect(rows(target)).toEqual([
                { name: 'Alice', index: ALICE },
                { name: 'assistant', index: NAMED_ASSISTANT },
            ])
        })
    })

    // Guard: passes with and without the filter; hiding the trash already
    // drops every trashed character.
    test('guard: with the trash hidden, trashed characters of every kind are not listed', async () => {
        DBState.db = buildDb(standardCharacters())
        trashAll([PLAYGROUND, TEMP, NAMED_ASSISTANT])

        await withMounted({ hideTrash: true }, (target) => {
            expect(rows(target)).toEqual([{ name: 'Alice', index: ALICE }])
        })
    })

    test('searching "assistant" lists only the ordinary character, and clicking it selects its own index', async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted({ hideTrash: true, search: 'assistant' }, (target) => {
            expect(rows(target)).toEqual([{ name: 'assistant', index: NAMED_ASSISTANT }])
        })
    })

    test("searching the stray copy's own name lists nothing", async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted({ hideTrash: false, search: 'temp copy' }, (target) => {
            expect(rows(target)).toEqual([])
        })
    })

    // Guard: passes with and without the filter; an ordinary character named
    // 'assistant' is never mistaken for the Playground.
    test('guard: an ordinary character named "assistant" is listed and selects its own index', async () => {
        DBState.db = buildDb([makeCharacter('alice-id', 'Alice'), makeCharacter('named-assistant-id', 'assistant')])

        await withMounted({ hideTrash: true }, (target) => {
            expect(rows(target)).toEqual([
                { name: 'Alice', index: 0 },
                { name: 'assistant', index: 1 },
            ])
        })
    })
})
