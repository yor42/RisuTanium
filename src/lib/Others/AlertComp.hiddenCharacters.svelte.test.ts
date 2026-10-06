// @vitest-environment happy-dom

/**
 * The character picker (`AlertComp.svelte`'s `selectChar` block, opened by
 * `addGroupChar` in `group.ts`) offers only characters that can be picked as a
 * group member: groups, trashed characters, and the two system characters kept
 * in `db.characters` (the Playground's `'§playground'` utility bot and a stray
 * `'§temp'` copy left by an upstream multiuser save) are never offered. Each
 * offered avatar resolves the prompt with its own character's `chaId`, however
 * many hidden entries precede it. An ordinary character that merely shares the
 * name 'assistant' is offered like any other.
 *
 * The module mocks copy `AlertComp.selectChar.svelte.test.ts` (same
 * directory). Nothing here writes to storage.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { changeCharSpy, avatarThumbSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    avatarThumbSpy: vi.fn(async () => null),
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
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
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
        getAvatarThumbSrc: avatarThumbSpy,
    }
})

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import AlertComp from './AlertComp.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

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

function makeGroup(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'group',
        image: '',
        chatPage: 0,
        characters: [],
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPicker(characters: CharacterFixture[]): HTMLElement {
    DBState.db = { characters } as unknown as Database
    alertStore.set({ type: 'selectChar', msg: '' } as never)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    flushSync()
    return target
}

function avatarButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico'))
}

/**
 * The `chaId` each offered avatar resolves the prompt with, in display order:
 * every avatar is pressed in turn, and the picker is reopened between presses.
 */
function offeredChaIds(target: HTMLElement): string[] {
    const count = avatarButtons(target).length
    const picked: string[] = []
    for (let i = 0; i < count; i++) {
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        flushSync()
        avatarButtons(target)[i].click()
        flushSync()
        picked.push((get(alertStore) as { msg: string }).msg)
    }
    return picked
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
})

//#endregion

describe('AlertComp.svelte selectChar block: which characters are offered', () => {
    test('offers only the ordinary characters and resolves each with its own chaId, with hidden entries ahead of them', () => {
        const target = mountPicker([
            makeCharacter('§playground', 'assistant', { utilityBot: true }),
            makeCharacter('§temp', 'Temp Copy'),
            makeCharacter('trashed-id', 'Trashed X', { trashTime: Date.now() - 1000 }),
            makeGroup('group-id', 'Group G'),
            makeCharacter('alice-id', 'Alice'),
            makeCharacter('bob-id', 'Bob'),
        ])

        expect(offeredChaIds(target)).toEqual(['alice-id', 'bob-id'])
    })

    test('does not offer a trashed system character either', () => {
        const target = mountPicker([
            makeCharacter('§playground', 'assistant', { utilityBot: true, trashTime: Date.now() - 1000 }),
            makeCharacter('§temp', 'Temp Copy', { trashTime: Date.now() - 1000 }),
            makeCharacter('alice-id', 'Alice'),
        ])

        expect(offeredChaIds(target)).toEqual(['alice-id'])
    })

    test('does not offer the Playground or the stray copy when they are the only entries', () => {
        const target = mountPicker([
            makeCharacter('§playground', 'assistant', { utilityBot: true }),
            makeCharacter('§temp', 'Temp Copy'),
        ])

        expect(avatarButtons(target)).toHaveLength(0)
    })

    test('does not offer a trashed ordinary character', () => {
        const target = mountPicker([
            makeCharacter('trashed-id', 'Trashed X', { trashTime: Date.now() - 1000 }),
            makeCharacter('alice-id', 'Alice'),
        ])

        expect(offeredChaIds(target)).toEqual(['alice-id'])
    })

    // Guard: passes with and without the filter; an ordinary character named
    // 'assistant' is offered, and a group is never offered.
    test('guard: offers an ordinary character named "assistant" and leaves out a group', () => {
        const target = mountPicker([
            makeGroup('group-id', 'Group G'),
            makeCharacter('named-assistant-id', 'assistant'),
            makeCharacter('alice-id', 'Alice'),
        ])

        expect(offeredChaIds(target)).toEqual(['named-assistant-id', 'alice-id'])
    })
})
