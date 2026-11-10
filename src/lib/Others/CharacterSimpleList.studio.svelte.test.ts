// @vitest-environment happy-dom

/**
 * `CharacterSimpleList.svelte`, Open in Studio from the Home library (stage G2, T15). With the optional
 * `studio` prop a row whose character Studio can open gets an icon button next to the row button, never
 * inside it. Without the prop, or for a character that is not available, the row's DOM is exactly the
 * row's DOM before the stage.
 *
 * Test labels: `(F)` is new behaviour (it fails on the code before the stage by assertion), `(G)` is a
 * compatibility guard that may pass before and after.
 *
 * MOCKED: the module set of `CharacterSimpleList.unnamed.svelte.test.ts`, with `changeChar` a bare spy.
 * `studio` is a plain object of spies; the real Home wiring is covered by `HomeLibrary.studio.svelte.test.ts`.
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

import { language } from 'src/lang'
import { DBState } from '../../ts/stores.svelte'
import CharacterSimpleList from './CharacterSimpleList.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, lastInteraction: number): CharacterFixture {
    return {
        chaId, name, type: 'character', image: '', creatorNotes: '', chatPage: 0, lastInteraction,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

/** Slot 0 Ann is the oldest, slot 2 Cy the newest, so the list shows Cy, Bob, Ann. */
function installDb(): void {
    const characters = [makeCharacter('a', 'Ann', 1000), makeCharacter('b', 'Bob', 2000), makeCharacter('c', 'Cy', 3000)]
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => c.chaId), characters, hideAllImages: false,
    } as unknown as Database
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

interface StudioProp {
    available: (index: number) => boolean
    open: (index: number, opener: HTMLElement) => void
}

const availableSpy = vi.fn<(index: number) => boolean>()
const openSpy = vi.fn<(index: number, opener: HTMLElement) => void>()
const onpickSpy = vi.fn<(index: number) => void>()

async function withList(props: { studio?: StudioProp, onpick?: (index: number) => void }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
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

const studioButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[data-part="library-studio"]'))
const studioButtonOf = (root: ParentNode, chaId: string): HTMLButtonElement | undefined =>
    studioButtons(root).find((button) => button.getAttribute('data-cha-id') === chaId)
const rowButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.getAttribute('data-part') !== 'library-studio' && button.textContent?.includes('|'))

const STUDIO: StudioProp = { available: (index) => availableSpy(index), open: (index, opener) => openSpy(index, opener) }

beforeEach(() => {
    changeCharSpy.mockReset()
    availableSpy.mockReset()
    availableSpy.mockReturnValue(true)
    openSpy.mockReset()
    onpickSpy.mockReset()
    installDb()
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

//#endregion

describe('CharacterSimpleList: Open in Studio', { timeout: 60_000 }, () => {
    test('(F) T15 every available row has a named icon button of its own, beside the row button and never inside it', async () => {
        await withList({ studio: STUDIO, onpick: onpickSpy }, (target) => {
            const buttons = studioButtons(target)
            expect(buttons.map((button) => button.getAttribute('data-cha-id'))).toEqual(['c', 'b', 'a'])
            const cy = studioButtonOf(target, 'c')!
            expect(cy.getAttribute('aria-label')).toBe(language.studioOpenInNamed('Cy'))
            expect(cy.getAttribute('title')).toBe(language.studioOpenInNamed('Cy'))
            for (const button of buttons) {
                // A button cannot nest in a button: no ancestor of the icon button is a button.
                expect(button.parentElement!.closest('button')).toBeNull()
                // And the row button is its sibling, in the same wrapper.
                expect(button.parentElement!.querySelectorAll(':scope > button').length).toBe(2)
            }
        })
    })

    test('(F) T15 a click on the icon button opens that slot with the button as opener, and the row is not picked', async () => {
        await withList({ studio: STUDIO, onpick: onpickSpy }, async (target) => {
            const bob = studioButtonOf(target, 'b')
            expect(bob).toBeDefined()
            bob!.click()
            await settle()
            expect(openSpy).toHaveBeenCalledTimes(1)
            expect(openSpy.mock.calls[0][0]).toBe(1)
            expect(openSpy.mock.calls[0][1]).toBe(bob!)
            expect(onpickSpy).not.toHaveBeenCalled()
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T17 a row whose character is not available has no icon button; the others keep theirs', async () => {
        availableSpy.mockImplementation((index) => index !== 1)
        await withList({ studio: STUDIO, onpick: onpickSpy }, (target) => {
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id'))).toEqual(['c', 'a'])
        })
    })

    test('(G) T15 the row button still picks its slot', async () => {
        await withList({ studio: STUDIO, onpick: onpickSpy }, async (target) => {
            const bob = rowButtons(target).find((button) => button.textContent?.includes('Bob'))!
            bob.click()
            await settle()
            expect(onpickSpy.mock.calls).toEqual([[1]])
            expect(openSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) T15 T17 without the prop there is no icon button, and the DOM equals the DOM of an unavailable list', async () => {
        let withoutProp = ''
        await withList({ onpick: onpickSpy }, (target) => {
            expect(studioButtons(target)).toEqual([])
            withoutProp = target.innerHTML
        })
        expect(withoutProp).toContain('Bob')
        availableSpy.mockReturnValue(false)
        await withList({ studio: STUDIO, onpick: onpickSpy }, (target) => {
            expect(studioButtons(target)).toEqual([])
            // With the prop present but nothing available, the markup is the markup without the prop.
            expect(target.innerHTML).toBe(withoutProp)
        })
    })
})
