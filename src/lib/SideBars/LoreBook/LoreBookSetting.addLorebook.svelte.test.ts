// @vitest-environment happy-dom

/**
 * The add and add-folder buttons of the lorebook settings panel act on the
 * lorebook the selected tab names: tab 0 is the character's lorebook and tab 1 is
 * the chat's.
 *
 * Mounts the REAL `LoreBookSetting.svelte` over a real `$state` database. The two
 * add functions are spies; everything else in `lorebook.svelte` is real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'
import { language } from 'src/lang'

//#region module mocks

const adds = vi.hoisted(() => ({ addLorebook: vi.fn(), addLorebookFolder: vi.fn() }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        changeChatTo: vi.fn(), downloadFile: vi.fn(), openURL: vi.fn(), loadAsset: vi.fn(), saveAsset: vi.fn(),
        readImage: vi.fn(), globalFetch: vi.fn(), fetchNative: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '', usingSw: false, getFetchLogs: vi.fn(() => []), getFetchData: vi.fn(() => ({})),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('src/ts/stores.svelte')
    return { ...actual, getDatabase: vi.fn((_o?: { snapshot?: boolean }) => DBState.db) }
})

vi.mock(import('src/ts/process/lorebook.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, addLorebook: adds.addLorebook, addLorebookFolder: adds.addLorebookFolder }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(),
    remove: vi.fn(), readDir: vi.fn(async () => []), BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({
    default: () => {},
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]), CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }), MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 }, SettingsMenuIndex: writable(0), ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false), botMakerMode: writable(false), DynamicGUI: writable(false),
        sideBarClosing: writable(false), sideBarStore: writable({ tab: 0 }), PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]), additionalHamburgerMenu: writable([]), CharConfigSubMenu: writable(0),
        MobileGUI: writable(false), hypaV3ModalOpen: writable(false), ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false), alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import LoreBookSetting from './LoreBookSetting.svelte'

function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['c0'], hideAllImages: false,
        loreBook: [{ data: [] }], loreBookPage: 0,
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', image: '', creatorNotes: '', chatPage: 0, lastInteraction: 0,
            globalLore: [],
            chats: [{ id: 'c0-chat-0', message: [], note: '', name: '', localLore: [] }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

let target: HTMLElement
let app: Record<string, unknown>

function tabButton(label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!found) throw new Error(`tab button not found: ${label}`)
    return found
}

/** The toolbar buttons are icon-only; they are, in order, add, export, add folder, import. */
function toolbarButton(index: number): HTMLButtonElement {
    const row = Array.from(target.querySelectorAll('div.mt-2.flex')).find((d) => d.querySelector('svg'))
    if (!row) throw new Error('toolbar not found')
    return row.querySelectorAll('button')[index] as HTMLButtonElement
}

describe('lorebook settings panel add buttons', () => {
    beforeEach(() => {
        adds.addLorebook.mockClear()
        adds.addLorebookFolder.mockClear()
        installDb()
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(LoreBookSetting, { target, props: {} }) as unknown as Record<string, unknown>
        flushSync()
    })

    afterEach(async () => {
        await unmount(app as never)
        target.remove()
    })

    test('guard: add and add folder act on the character lorebook on the character tab', () => {
        toolbarButton(0).click()
        toolbarButton(2).click()
        expect(adds.addLorebook).toHaveBeenCalledExactlyOnceWith(0)
        expect(adds.addLorebookFolder).toHaveBeenCalledExactlyOnceWith(0)
    })

    test('guard: add and add folder act on the chat lorebook on the chat tab', () => {
        tabButton(language.Chat).click()
        flushSync()
        toolbarButton(0).click()
        toolbarButton(2).click()
        expect(adds.addLorebook).toHaveBeenCalledExactlyOnceWith(1)
        expect(adds.addLorebookFolder).toHaveBeenCalledExactlyOnceWith(1)
    })
})
