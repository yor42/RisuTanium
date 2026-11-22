// @vitest-environment happy-dom

/**
 * Where keyboard focus goes when an alert that covers the page closes.
 *
 * Drives the REAL `AlertComp.svelte` inside `AlertFocusHarness.svelte` (page controls in `AlertInertScope`, as `App.svelte`
 * mounts them) over a real `writable` standing in for `alertStore`, with the real alert functions and the real installer.
 * The assertions read `document.activeElement`.
 *
 * Invariants pinned here:
 *  - the control focused when a covering alert opened gets focus back after the alert is gone, one tick later, when the
 *    page is no longer inert;
 *  - it is recorded once per run of covering alerts and kept across a chain of them;
 *  - it is returned only while focus is on nowhere or the body, and never when the opener left the page;
 *  - a toast never records an opener.
 *
 * The module mocks copy `AlertComp.focusBox.svelte.test.ts`. Tests whose title starts with `guard:` pass with or without
 * the installer: they pin behaviour that must be preserved.
 */

import { writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'
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
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('src/ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('src/ts/sourcemap'), () => ({
    translateStackTrace: vi.fn(async (stackTrace: string) => ({ didTranslate: false, stackTrace })),
}) as unknown as typeof import('src/ts/sourcemap'))

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

//#endregion

import { language } from 'src/lang'
import { alertStore } from 'src/ts/stores.svelte'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertClear, alertConfirm, alertError, alertSelect, alertWait } from 'src/ts/alert'
import { clearAlertOpener, pendingAlertOpener } from 'src/ts/alertOpener'
import { tickFake } from 'src/ts/tests/svelteTick.test-helpers'
import AlertFocusHarness from './AlertFocusHarness.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountHarness(scoped = true): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertFocusHarness, { target, props: { scoped } }))
    flushSync()
    return target
}

/** Lets the component react to the store and run what it schedules after the DOM update. */
async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
    await tickFake()
    flushSync()
}

/** Waits out the pause that discards answers right after a prompt appears. */
async function pastGuard(): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

function control(target: HTMLElement, id: string): HTMLElement {
    const found = target.querySelector<HTMLElement>(`#${id}`)
    if (!found) throw new Error(`no control #${id}`)
    return found
}

beforeEach(() => {
    vi.useFakeTimers()
    clearAlertOpener()
})

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
    clearAlertOpener()
    vi.clearAllMocks()
})

describe('focus returns to the opener when a covering alert closes', () => {
    // FR-1
    test('a confirm answered No gives focus back to the control that opened it', async () => {
        const target = mountHarness(false)
        await settle()
        const opener = control(target, 'opener')
        opener.focus()

        void alertConfirm('Proceed?')
        await settle()
        expect(document.activeElement, 'focus while the alert is up').not.toBe(opener)
        await pastGuard()
        buttonNamed(target, language.alertComp.no).click()
        await settle()

        expect(document.activeElement).toBe(opener)
    })

    // FR-1b
    test('the same inside AlertInertScope, where the opener is inert while the alert is up', async () => {
        const target = mountHarness(true)
        await settle()
        const opener = control(target, 'opener')
        opener.focus()

        void alertConfirm('Proceed?')
        await settle()
        expect(opener.closest('[inert]'), 'the opener is inert behind the alert').not.toBeNull()
        await pastGuard()
        buttonNamed(target, language.alertComp.no).click()
        await settle()

        expect(document.activeElement).toBe(opener)
    })

    // FR-2
    test('a chain of confirms keeps the first opener, even when the continuation moved focus elsewhere', async () => {
        const target = mountHarness()
        await settle()
        const opener = control(target, 'opener')
        const other = control(target, 'other')
        opener.focus()

        void (async () => {
            if (await alertConfirm('one')) {
                other.focus()
                await alertConfirm('two')
            }
        })()
        await settle()
        await pastGuard()
        buttonNamed(target, language.alertComp.yes).click()
        await settle()
        await pastGuard()
        buttonNamed(target, language.alertComp.no).click()
        await settle()

        expect(document.activeElement).toBe(opener)
    })

    // FR-3, final answer
    test('a select covered by an error returns focus to the opener only after the select is answered', async () => {
        const target = mountHarness()
        await settle()
        const opener = control(target, 'opener')
        opener.focus()

        const answer = alertSelect(['One', 'Two'])
        await settle()
        alertError('A failure')
        await settle()
        buttonNamed(target, language.alertComp.ok).click()
        await settle()
        expect(document.activeElement, 'the opener does not take focus while the select is back on screen').not.toBe(opener)
        await pastGuard()
        buttonNamed(target, 'One').click()
        await settle()

        expect(await answer).toBe('0')
        expect(document.activeElement).toBe(opener)
    })

    // FR-3, guard half
    test('guard: a select that comes back from under an error takes focus on its own box', async () => {
        const target = mountHarness()
        await settle()
        control(target, 'opener').focus()

        void alertSelect(['One', 'Two'])
        await settle()
        alertError('A failure')
        await settle()
        buttonNamed(target, language.alertComp.ok).click()
        await settle()

        const focused = document.activeElement
        expect(focused?.hasAttribute('data-alert-box')).toBe(true)
        expect(focused?.closest('[inert]') ?? null).toBeNull()
    })

    // FR-4
    test('focus that moved elsewhere before the return keeps its place (controls outside the inert scope, which take focus at once)', async () => {
        const target = mountHarness(false)
        await settle()
        const opener = control(target, 'opener')
        const other = control(target, 'other')
        opener.focus()

        void alertConfirm('Proceed?')
        await settle()
        await pastGuard()
        buttonNamed(target, language.alertComp.no).click()
        other.focus()
        await settle()

        expect(document.activeElement).toBe(other)
    })

    // FR-5
    test('guard: an opener removed while the alert is up is not focused and nothing throws', async () => {
        const target = mountHarness()
        await settle()
        const opener = control(target, 'opener')
        opener.focus()

        void alertConfirm('Proceed?')
        await settle()
        opener.remove()
        await pastGuard()
        buttonNamed(target, language.alertComp.no).click()
        await settle()

        expect(document.activeElement).toBe(document.body)
        expect(pendingAlertOpener()).toBeNull()
    })

    // FR-6
    test('guard: a toast records no opener and returns no focus', async () => {
        const target = mountHarness()
        await settle()
        const field = control(target, 'field')
        field.focus()

        alertStore.set({ type: 'toast', msg: 'A toast' } as never)
        await settle()
        expect(pendingAlertOpener()).toBeNull()
        alertStore.set({ type: 'none', msg: '' } as never)
        await settle()

        expect(pendingAlertOpener()).toBeNull()
        expect(document.activeElement).toBe(field)
    })

    // FR-7
    test('a wait started from a button gives focus back when it is cleared', async () => {
        const target = mountHarness()
        await settle()
        const opener = control(target, 'opener')
        opener.focus()

        alertWait('Working')
        await settle()
        expect(document.activeElement).not.toBe(opener)
        alertClear()
        await settle()

        expect(document.activeElement).toBe(opener)
    })
})
