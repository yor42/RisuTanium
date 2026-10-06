// @vitest-environment happy-dom

/**
 * The character picker (`AlertComp.svelte`'s `selectChar` block) has an
 * on-screen way out: a Cancel button that ends the alert with an empty answer,
 * which `addGroupChar` in `group.ts` treats as an abort. Escape leaves a prompt
 * alone, so without the button the picker's only exits would be choosing a
 * character or reloading the page.
 *
 * The module mocks copy `AlertComp.cancel.svelte.test.ts`: none of it is
 * exercised by the picker's Cancel button, but the component needs it to import
 * and mount. The button is found by its visible text, `language.cancel`, which
 * is what the branch renders.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import { language } from 'src/lang'
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

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): { target: HTMLElement } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(AlertComp, { target, props: {} })
    mountedInstances.push(instance)
    return { target }
}

/** The buttons in the mounted component whose text is the Cancel string. */
function cancelButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('button')).filter((button) => button.textContent?.trim() === language.cancel)
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

describe('AlertComp.svelte selectChar block: the Cancel button', () => {
    test('the picker shows one Cancel button, and pressing it ends the alert with an empty answer', () => {
        DBState.db = { characters: [] } as unknown as Database
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        const { target } = mountAlertComp()
        flushSync()

        const buttons = cancelButtons(target)
        expect(buttons.length, 'Cancel buttons on the picker').toBe(1)
        expect(get(alertStore).type, 'the alert before the press').toBe('selectChar')

        buttons[0].click()
        flushSync()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
    })

    test('the Cancel button goes away with the picker', () => {
        DBState.db = { characters: [] } as unknown as Database
        alertStore.set({ type: 'selectChar', msg: '' } as never)
        const { target } = mountAlertComp()
        flushSync()
        expect(cancelButtons(target).length).toBe(1)

        alertStore.set({ type: 'none', msg: '' } as never)
        flushSync()

        expect(cancelButtons(target).length).toBe(0)
    })
})
