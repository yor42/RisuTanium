// @vitest-environment happy-dom

/**
 * A prompt that another alert covers comes back as the user left it.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for
 * `alertStore`, and writes that raw store directly, the way the rest of the app
 * does: the same prompt object, then a cover, then that same object again. It
 * does not go through the alert functions, so what it pins is the component's
 * own handling of a prompt that leaves the store and returns.
 *
 * Invariants pinned here:
 *  - the text typed into an input prompt is still in the field when the prompt
 *    returns;
 *  - the choices made in the card export dialog are still selected when it
 *    returns;
 *  - a prompt under a cover stays mounted but hidden and inert, and is
 *    neither once it returns;
 *  - a consent posted over an input prompt does not replace the held prompt,
 *    so the typed text is still there after the consent is answered.
 *
 * The first two use the raw store; the last two ask their prompt through the
 * real alert functions, so the prompt controller re-posts the prompt when the
 * cover closes.
 *
 * The module mocks copy `AlertComp.selectChar.svelte.test.ts`: none of it is
 * exercised here, but the component needs it to import and mount.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertInput, alertNormal, type alertData } from '../../ts/alert'
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

/** Replaces the alert on screen, the way the app does, and lets the component react. */
function show(value: alertData): void {
    alertStore.set(value as never)
    flushSync()
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
})

describe('AlertComp.svelte: a prompt that is covered and comes back', () => {
    test('an input prompt keeps the text typed into it when a notice covers it and it returns', () => {
        DBState.db = { characters: [] } as unknown as Database
        const prompt: alertData = { type: 'input', msg: 'Name?', datalist: [], defaultValue: 'Default' }
        show(prompt)
        const { target } = mountAlertComp()
        flushSync()
        const field = () => target.querySelector('#alert-input') as HTMLInputElement
        expect(field().value, 'the field before anything is typed').toBe('Default')
        field().value = 'typed text'
        field().dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()

        show({ type: 'normal', msg: 'A notice' })
        expect.soft(target.textContent, 'the cover on screen').toContain('A notice')
        show(prompt)

        expect(field().value, 'the field after the prompt returned').toBe('typed text')
    })

    test('the card export dialog keeps the format chosen in it when a notice covers it and it returns', () => {
        DBState.db = { characters: [], botPresets: [], botPresetsId: 0 } as unknown as Database
        const prompt: alertData = { type: 'cardexport', msg: '', submsg: 'module' }
        show(prompt)
        const { target } = mountAlertComp()
        flushSync()
        expect(target.textContent, 'the dialog before a choice').toContain(language.realmDesc)
        buttonNamed(target, 'RisuM').click()
        flushSync()
        expect(target.textContent, 'the dialog after the choice').toContain(language.risuMDesc)

        show({ type: 'normal', msg: 'A notice' })
        expect.soft(target.textContent, 'the cover on screen').toContain('A notice')
        show(prompt)

        expect.soft(target.textContent, 'the description after the dialog returned').toContain(language.risuMDesc)
        expect.soft(target.textContent, 'the realm description after the dialog returned').not.toContain(language.realmDesc)
    })
})

describe('AlertComp.svelte: a prompt asked through the alert functions and covered', () => {
    function inputField(target: HTMLElement): HTMLInputElement {
        return target.querySelector('#alert-input') as HTMLInputElement
    }

    /** The element the component wraps a held prompt in. */
    function promptWrapper(target: HTMLElement): HTMLElement {
        return inputField(target).closest('[style*="display: contents"]') as HTMLElement
    }

    function typeInto(field: HTMLInputElement, text: string): void {
        field.value = text
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
    }

    test('a covered prompt is hidden and inert, and is neither once the cover is closed and it returns', async () => {
        vi.useFakeTimers()
        DBState.db = { characters: [] } as unknown as Database
        void alertInput('Name?', [], 'Default')
        const { target } = mountAlertComp()
        flushSync()
        expect.soft(promptWrapper(target).style.visibility, 'the prompt while it is showing').not.toBe('hidden')
        expect.soft(promptWrapper(target).hasAttribute('inert'), 'the prompt while it is showing is not inert').toBe(false)

        alertNormal('A notice')
        flushSync()

        expect.soft(target.textContent, 'the cover on screen').toContain('A notice')
        expect.soft(promptWrapper(target).style.visibility, 'the covered prompt').toBe('hidden')
        expect.soft(promptWrapper(target).hasAttribute('inert'), 'the covered prompt is inert').toBe(true)

        buttonNamed(target, 'OK').click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()

        expect.soft(target.textContent, 'the cover after it was closed').not.toContain('A notice')
        expect.soft(promptWrapper(target).style.visibility, 'the prompt after it returned').not.toBe('hidden')
        expect.soft(promptWrapper(target).hasAttribute('inert'), 'the prompt after it returned is not inert').toBe(false)
    })

    test('an input prompt keeps its typed text when a consent posted over it is answered', async () => {
        vi.useFakeTimers()
        DBState.db = { characters: [] } as unknown as Database
        void alertInput('Name?', [], 'Default')
        const { target } = mountAlertComp()
        flushSync()
        typeInto(inputField(target), 'typed text')

        show({ type: 'tos', msg: 'tos' })
        show({ type: 'none', msg: 'accepted' })
        await vi.advanceTimersByTimeAsync(0)
        flushSync()

        expect(inputField(target).value, 'the field after the consent was answered').toBe('typed text')
    })
})
