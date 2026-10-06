// @vitest-environment happy-dom

/**
 * What an Enter keydown answers when the alert's own buttons are on screen.
 *
 * Drives the REAL `AlertComp.svelte`, the REAL document keydown listener that
 * `initHotkey()` registers, the real alert functions and a real `writable`
 * standing in for `alertStore`. The assertions read the answer the caller of the
 * confirm received and every value ever written to the store. `happy-dom`
 * synthesises no click from Enter on a focused button, so a keydown the page
 * left alone is followed by the click the browser would make on that button.
 *
 * Invariants pinned here:
 *  - with a button of the dialog focused, Enter takes that button's answer:
 *    the focused NO answers no and the store is never written a yes;
 *  - the focused OK of a notice closes it without a yes being written;
 *  - Enter with nothing in the dialog focused answers a confirm yes once its
 *    pause is over.
 *
 * The module mocks copy `AlertComp.promptState.svelte.test.ts`, extended with
 * what `hotkey.ts` imports.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved. Every other test fails while the behaviour
 * it names is missing.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
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
        changeToPreset: vi.fn(),
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
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
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
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        loadoutModalStore: { open: false },
        openPersonaList: writable(false),
        openPresetList: writable(false),
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
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('../../ts/process/index.svelte'))

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import { initHotkey } from '../../ts/hotkey'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertConfirm, alertNormal, type alertData } from '../../ts/alert'
import AlertComp from './AlertComp.svelte'

/** One millisecond past the pause during which a prompt or a notice ignores Enter. */
const PAUSE_MS = 401

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
const stopRecording: Array<() => void> = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
    await Promise.resolve()
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

/** Records every value the store takes from now on. */
function recordStoreWrites(): alertData[] {
    const written: alertData[] = []
    const stop = alertStore.subscribe((value) => { written.push(value as alertData) })
    stopRecording.push(stop)
    written.length = 0
    return written
}

/**
 * Presses Enter where the browser would send it, which is the focused element or the
 * body, and then does what the browser does for a button when the keydown was left alone.
 */
function pressEnterAsTheBrowserWould(): KeyboardEvent {
    const focused = document.activeElement ?? document.body
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    focused.dispatchEvent(ev)
    if (!ev.defaultPrevented && focused.tagName === 'BUTTON') {
        ;(focused as HTMLButtonElement).click()
    }
    return ev
}

function yesWrites(written: alertData[]): alertData[] {
    return written.filter((value) => value.type === 'none' && value.msg === 'yes')
}

beforeAll(() => {
    initHotkey()
})

afterEach(async () => {
    while (stopRecording.length > 0) {
        stopRecording.pop()!()
    }
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

afterAll(() => {
    alertStore.set({ type: 'none', msg: '' } as never)
})

describe('AlertComp.svelte with the hotkey listener: Enter while a button of the dialog is focused', () => {
    async function openConfirmPastPause(): Promise<{ target: HTMLElement, answers: boolean[], written: alertData[] }> {
        vi.useFakeTimers()
        DBState.db = { characters: [] } as unknown as Database
        const answers: boolean[] = []
        void alertConfirm('Proceed?').then((answer) => { answers.push(answer) })
        const target = mountAlertComp()
        await settle()
        await vi.advanceTimersByTimeAsync(PAUSE_MS)
        await settle()
        const written = recordStoreWrites()
        return { target, answers, written }
    }

    test('Enter on the focused NO answers no and the store is never written a yes', async () => {
        const { target, answers, written } = await openConfirmPastPause()
        buttonNamed(target, 'NO').focus()

        pressEnterAsTheBrowserWould()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        expect.soft(answers, 'the answers the confirm was given').toEqual([false])
        expect.soft(yesWrites(written), 'the yes values written to the store').toEqual([])
    })

    test('guard: Enter on the focused YES answers yes', async () => {
        const { target, answers } = await openConfirmPastPause()
        buttonNamed(target, 'YES').focus()

        pressEnterAsTheBrowserWould()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        expect(answers).toEqual([true])
    })

    test('guard: Enter with nothing of the dialog that acts as a button focused answers yes', async () => {
        const { target, answers } = await openConfirmPastPause()
        const focused = document.activeElement
        expect.soft(focused !== null && focused.tagName === 'BUTTON' && target.contains(focused), 'a button of the dialog holds focus').toBe(false)

        pressEnterAsTheBrowserWould()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        expect(answers).toEqual([true])
    })

    test('Enter on the focused OK of a notice closes it and no yes is written to the store', async () => {
        vi.useFakeTimers()
        DBState.db = { characters: [] } as unknown as Database
        const target = mountAlertComp()
        await settle()
        alertNormal('A notice')
        await settle()
        await vi.advanceTimersByTimeAsync(PAUSE_MS)
        await settle()
        const written = recordStoreWrites()
        buttonNamed(target, 'OK').focus()

        pressEnterAsTheBrowserWould()
        await settle()

        expect.soft(target.textContent, 'the notice after Enter').not.toContain('A notice')
        expect.soft(yesWrites(written), 'the yes values written to the store').toEqual([])
    })
})
