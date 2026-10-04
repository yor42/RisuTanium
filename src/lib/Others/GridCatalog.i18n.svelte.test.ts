// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` shows the fallback text for a character without creator notes and for
 * a character without a name in the UI language, read at render. The language is set before
 * mount and restored to English afterwards. The fallback is applied when the row renders, so
 * the character's own data stays empty rather than carrying translated text.
 *
 * Mounts the REAL component in its list layout. MOCKED: the module set of
 * `GridCatalog.hiddenCharacters.svelte.test.ts` (same directory), with `changeChar` a bare
 * spy. Nothing here writes to storage.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while the fallback is a hard-coded English literal.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
            isPlainHttpFileSrc: vi.fn(() => false),
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
import { changeLanguage, language } from '../../lang'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'
import GridCatalog from './GridCatalog.svelte'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, creatorNotes?: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        ...(creatorNotes === undefined ? {} : { creatorNotes }),
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

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function listRows(): Promise<{ text: string, titles: string[], placeholders: string[] }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
    try {
        await settle()
        const listLabel = language.list.trim()
        Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === listLabel)!.click()
        await settle()
        return {
            text: target.textContent ?? '',
            titles: Array.from(target.querySelectorAll('button[title]')).map((b) => b.getAttribute('title') ?? ''),
            placeholders: Array.from(target.querySelectorAll('input')).map((i) => i.placeholder),
        }
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

afterEach(() => {
    changeLanguage('en')
})

describe('GridCatalog fallback texts', { timeout: 60_000 }, () => {
    test('regression reproducer: Korean shows the no-description fallback for a character without creator notes', async () => {
        changeLanguage('ko')
        expect(languageKorean.othersUi.noDescription).not.toBe(languageEnglish.othersUi.noDescription)
        DBState.db = buildDb([makeCharacter('a', 'Alice')])

        const { text } = await listRows()
        expect(text).toContain(languageKorean.othersUi.noDescription)
        expect(text).not.toContain('No description')
    })

    test('regression reproducer: Korean shows the unnamed fallback, the back title and the search placeholder in Korean', async () => {
        changeLanguage('ko')
        DBState.db = buildDb([makeCharacter('a', '')])

        const { text, titles, placeholders } = await listRows()
        expect(text).toContain(languageKorean.settingsPage.unnamed)
        expect(text).not.toContain('Unnamed')
        expect(titles).toContain(languageKorean.settingsPage.back)
        expect(titles).not.toContain('Back')
        expect(placeholders).toContain(languageKorean.search)
        expect(placeholders).not.toContain('Search')
    })

    test('guard: the creator notes of a character are shown as written in Korean', async () => {
        changeLanguage('ko')
        DBState.db = buildDb([makeCharacter('a', 'Alice', 'A very kind knight')])

        const { text } = await listRows()
        expect(text).toContain('A very kind knight')
        expect(text).not.toContain(languageKorean.othersUi.noDescription)
    })

    test('guard: English shows "No description" and "Unnamed" for a bare character', async () => {
        DBState.db = buildDb([makeCharacter('a', '')])

        const { text } = await listRows()
        expect(text).toContain('No description')
        expect(text).toContain('Unnamed')
    })
})