// @vitest-environment happy-dom

/**
 * The mobile character screen as `MobileBody.svelte` mounts it
 * (`MobileGUIStack` = 1): trashed characters are hidden from the list, a
 * "Trash (n)" row appears while the trash holds something, opens the trash in
 * place with a back row, and restore, delete permanently and Empty trash work
 * there. Opening the trash is local state: the `MobileGUIStack` value the
 * swipe gestures move through never changes.
 *
 * MOCKED: the module set of `MobileCharacters.trash.svelte.test.ts` (same
 * directory), with the heavy sibling screens (Settings, RealmMain, ChatScreen,
 * CharConfig, SideChatList, DevTool) replaced by empty components. Nothing
 * here writes to storage.
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

const { changeCharSpy, restoreSpy, removeCharSpy, removeTrashedSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    restoreSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    removeTrashedSpy: vi.fn(),
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
        MobileGUIStack: writable(1),
        MobileSideBar: writable(0),
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
        restoreCharacterFromTrash: restoreSpy,
        removeChar: removeCharSpy,
        removeTrashedCharacters: removeTrashedSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock('../Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../UI/Realm/RealmMain.svelte', () => ({ default: () => {} }))
vi.mock('../ChatScreens/ChatScreen.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('../SideBars/DevTool.svelte', () => ({ default: () => {} }))

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

import { get } from 'svelte/store'
import { DBState, MobileGUIStack } from '../../ts/stores.svelte'
import { language } from '../../lang'
import MobileBody from './MobileBody.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const GONE = 1_700_000_000_000

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

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileBody, { target, props: {} }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function rowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')
}

function trashRowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
}

const trashEntryLabel = (n: number) => `${language.trash} (${n})`

beforeEach(() => {
    changeCharSpy.mockClear()
    restoreSpy.mockClear()
    removeCharSpy.mockClear()
    removeTrashedSpy.mockClear()
})

//#endregion

describe('MobileBody: the mobile trash', { timeout: 60_000 }, () => {
    function withTrash(): CharacterFixture[] {
        return [
            makeCharacter('a', 'Ann'),
            makeCharacter('b', 'Bob'),
            makeCharacter('c', 'Cat', { trashTime: GONE }),
            makeCharacter('d', 'Cara', { trashTime: GONE }),
        ]
    }

    test('the list hides trashed characters and offers the Trash row with the whole count', async () => {
        DBState.db = buildDb(withTrash())

        await withMounted((target) => {
            expect(rowNames(target)).toEqual(['Ann', 'Bob'])
            expect(buttonWith(target, trashEntryLabel(2))).toBeDefined()
        })
    })

    test('there is no Trash row when nothing is trashed', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted((target) => {
            expect(rowNames(target)).toEqual(['Ann'])
            expect(buttonWith(target, language.trash)).toBeUndefined()
        })
    })

    test('opening the trash lists the trashed characters in place and leaves MobileGUIStack alone; back returns', async () => {
        DBState.db = buildDb(withTrash())

        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel(2))!.click()
            await settle()
            expect(trashRowNames(target).sort()).toEqual(['Cara', 'Cat'])
            expect(rowNames(target)).toEqual([])
            expect(get(MobileGUIStack)).toBe(1)
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            expect(rowNames(target)).toEqual(['Ann', 'Bob'])
            expect(get(MobileGUIStack)).toBe(1)
        })
    })

    test('restore, delete permanently and Empty trash reach the same functions as on desktop', async () => {
        DBState.db = buildDb(withTrash())

        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel(2))!.click()
            await settle()
            const actions = Array.from(target.querySelectorAll('h4'))
                .find((h) => h.textContent?.trim() === 'Cat')!
                .parentElement!.querySelectorAll<HTMLButtonElement>('.justify-end button')
            actions[0].click()
            expect(restoreSpy).toHaveBeenCalledWith(DBState.db.characters[2])
            actions[1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[2], 'Cat', 'permanent')
            buttonWith(target, language.emptyTrash)!.click()
            const [refs, options] = removeTrashedSpy.mock.calls[0]
            expect((refs as CharacterFixture[]).map((c) => c.name).sort()).toEqual(['Cara', 'Cat'])
            expect(options).toEqual({ matching: false })
        })
    })

    test('a trashed row does not open on a click: the avatar and the name do nothing', async () => {
        DBState.db = buildDb(withTrash())

        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel(2))!.click()
            await settle()
            const avatars = Array.from(target.querySelectorAll<HTMLElement>('.ico'))
            expect(avatars.length).toBe(2)
            for (const avatar of avatars) {
                avatar.click()
            }
            for (const heading of Array.from(target.querySelectorAll('h4'))) {
                heading.click()
            }
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('after the last trashed character is restored the open view shows the empty trash with the back row', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('c', 'Cat', { trashTime: GONE })])

        await withMounted(async (target) => {
            buttonWith(target, trashEntryLabel(1))!.click()
            await settle()
            DBState.db.characters[1].trashTime = undefined
            await settle()
            expect(trashRowNames(target)).toEqual([])
            expect(buttonWith(target, language.settingsPage.back)).toBeDefined()
            expect(target.textContent).toContain(language.trashDesc)
        })
    })
})
