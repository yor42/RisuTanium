// @vitest-environment happy-dom

/**
 * `AlertComp.svelte`'s two consent dialogs, the `'tos'` agreement and the
 * `'staleAccountNotice'` notice, take no click or tap for 400 ms after the
 * dialog appears: a press meant for whatever was on screen before (a double
 * click on the control that opened the agreement, a second tap on the button
 * of the dialog that just closed) must not accept, decline or acknowledge a
 * dialog the user has not yet seen. A discarded click writes nothing to the
 * store and leaves the dialog up. A click after the pause writes the same value
 * as ever, and every new appearance of a dialog starts its own pause.
 *
 * Fake timers drive the 400 ms, so each outcome is read at a time the test
 * chooses. The buttons are found by position, not by wording, so a later
 * change to the strings in `src/lang` does not affect this file. The mocks
 * follow `AlertComp.tos.svelte.test.ts`; none of that machinery is exercised by
 * the two blocks themselves, but `AlertComp.svelte` needs it to import and
 * mount.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_DECLINE } from 'src/ts/upstreamAgreement'
import { STALE_ACCOUNT_NOTICE_ACK } from 'src/ts/alert'
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

const { changeCharSpy, avatarThumbSpy, openUrlSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    avatarThumbSpy: vi.fn(async () => null),
    openUrlSpy: vi.fn(),
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
            openURL: openUrlSpy,
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

import { alertStore } from '../../ts/stores.svelte'
import AlertComp from './AlertComp.svelte'

/** Just past the 400 ms during which a click on a consent dialog is discarded. */
const GUARD_MS = 401

const TOS = { type: 'tos', msg: 'tos' } as never
const STALE = { type: 'staleAccountNotice', msg: 'notice' } as never

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

/** Puts a dialog on screen and returns its buttons in document order. */
function show(target: HTMLElement, alert: never): HTMLButtonElement[] {
    alertStore.set(alert)
    flushSync()
    return Array.from(target.querySelectorAll('button'))
}

function click(button: HTMLButtonElement): void {
    button.click()
    flushSync()
}

/** Clicks the button at index of the dialog as it is on screen now. */
function clickShown(target: HTMLElement, index: number): void {
    const button = target.querySelectorAll('button')[index]
    expect.soft(button, 'the button on screen at that moment').toBeDefined()
    button?.click()
    flushSync()
}

function advance(ms: number): void {
    vi.advanceTimersByTime(ms)
    flushSync()
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('the agreement dialog discards a click within 400 ms of appearing', () => {
    test.each([
        ['Accept', 0, UPSTREAM_AGREEMENT_ACCEPT],
        ['Decline', 1, UPSTREAM_AGREEMENT_DECLINE],
    ])('%s clicked at the moment the dialog appears and 100 ms later writes nothing and leaves the dialog up, and after 400 ms writes its own value', (_label, index, value) => {
        const target = mountAlertComp()
        const buttons = show(target, TOS)
        expect(buttons.length, 'buttons').toBe(2)
        const shown = get(alertStore)

        click(buttons[index])
        expect.soft(get(alertStore), 'the store after a click at the moment the dialog appeared').toBe(shown)
        advance(100)
        click(buttons[index])
        expect.soft(get(alertStore), 'the store after a click 100 ms after the dialog appeared').toBe(shown)
        expect.soft(target.querySelectorAll('button').length, 'buttons still on screen').toBe(2)

        advance(GUARD_MS)
        clickShown(target, index)
        expect(get(alertStore)).toEqual({ type: 'none', msg: value })
    })

    test('a dialog that appears again after one was answered starts its own pause', () => {
        const target = mountAlertComp()
        let buttons = show(target, TOS)
        advance(GUARD_MS)
        click(buttons[0])
        expect.soft(get(alertStore), 'the first dialog after a click outside its pause').toEqual({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })

        buttons = show(target, TOS)
        const shown = get(alertStore)
        click(buttons[0])
        expect.soft(get(alertStore), 'the store after a click at the moment the second dialog appeared').toBe(shown)
        advance(GUARD_MS)
        clickShown(target, 1)
        expect(get(alertStore)).toEqual({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
    })
})

describe('the stale-account notice discards a click within 400 ms of appearing', () => {
    test('OK clicked at the moment the notice appears and 100 ms later writes nothing and leaves the notice up, and after 400 ms writes the acknowledgement', () => {
        const target = mountAlertComp()
        const buttons = show(target, STALE)
        expect(buttons.length, 'buttons').toBe(1)
        const shown = get(alertStore)

        click(buttons[0])
        expect.soft(get(alertStore), 'the store after a click at the moment the notice appeared').toBe(shown)
        advance(100)
        click(buttons[0])
        expect.soft(get(alertStore), 'the store after a click 100 ms after the notice appeared').toBe(shown)
        expect.soft(target.querySelectorAll('button').length, 'buttons still on screen').toBe(1)

        advance(GUARD_MS)
        clickShown(target, 0)
        expect(get(alertStore)).toEqual({ type: 'none', msg: STALE_ACCOUNT_NOTICE_ACK })
    })

    test('a notice that replaces the agreement dialog starts its own pause', () => {
        const target = mountAlertComp()
        show(target, TOS)
        advance(GUARD_MS)

        const buttons = show(target, STALE)
        const shown = get(alertStore)
        click(buttons[0])
        expect.soft(get(alertStore), 'the store after a click at the moment the notice replaced the dialog').toBe(shown)
        advance(GUARD_MS)
        clickShown(target, 0)
        expect(get(alertStore)).toEqual({ type: 'none', msg: STALE_ACCOUNT_NOTICE_ACK })
    })
})