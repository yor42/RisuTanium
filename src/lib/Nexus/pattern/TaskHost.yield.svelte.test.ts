// @vitest-environment jsdom

/**
 * What a covering legacy alert and a task card do to each other's keys and focus. The task card steps aside while the
 * alert is up (its dialog unmounts, so it holds no shell, key listener or focus watcher) and returns, state intact, when
 * the alert is answered.
 *
 * Drives the REAL `AlertComp.svelte` and the REAL `TaskHost.svelte` over a real `writable` standing in for `alertStore`,
 * wired as `App.svelte` wires them (`TaskYieldHarness.svelte`). The module mocks copy
 * `AlertComp.focusBox.svelte.test.ts`: none of it is exercised here, but the component graph needs it to import.
 */

import { writable } from 'svelte/store'
import { vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../../ts/platform'
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
    const { DBState } = await import('../../../ts/stores.svelte')
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

vi.mock(import('../../../ts/stores.svelte'), () => {
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
    } as unknown as typeof import('../../../ts/stores.svelte')
})

vi.mock(import('../../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../../ts/sourcemap'), () => ({
    translateStackTrace: vi.fn(async (stackTrace: string) => ({ didTranslate: false, stackTrace })),
}) as unknown as typeof import('../../../ts/sourcemap'))

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

//#endregion

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { tickFake } from '../../../ts/tests/svelteTick.test-helpers'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from '../../../ts/alertPrompts'
import { language } from 'src/lang'
import { alertConfirm, alertError } from '../../../ts/alert'
import { alertStore } from '../../../ts/stores.svelte'
import { alertTask, resetTaskHostForTests } from '../../../ts/alertTask.svelte'
import { hasOpenShell } from './patternFocus'
import TaskYieldHarness from './TaskYieldHarness.svelte'

const mounted: Array<{ app: unknown, target: HTMLElement }> = []

afterEach(async () => {
    for (const { app, target } of mounted.splice(0)) {
        await unmount(app as never).catch(() => {})
        target.remove()
    }
    document.body.replaceChildren()
    vi.useRealTimers()
    resetTaskHostForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
})

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
}

describe('TaskHost yields to a covering alert', () => {
    // The yielded card is unmounted, not hidden, so its keys and focus cannot compete with the covering alert.
    test('R9 the card steps aside for a confirm, leaves its keys and focus alone, and returns when it is answered', async () => {
        vi.useFakeTimers()
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ app: mount(TaskYieldHarness, { target, props: {} }), target })
        await settle()
        const opener = target.querySelector<HTMLButtonElement>('[data-test="opener"]')!
        opener.focus()

        const onCancel = vi.fn()
        const handle = alertTask({ title: 'Import', steps: [{ label: 'Read file' }, { label: 'Add items' }], onCancel })
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]')).not.toBeNull()
        expect(hasOpenShell()).toBe(true)

        const answer = alertConfirm('Overwrite?')
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]'), 'the card while the confirm is up').toBeNull()
        const box = document.querySelector('[data-alert-box]')
        expect(box, 'the confirm box').not.toBeNull()
        expect(box!.contains(document.activeElement), 'focus is inside the confirm').toBe(true)
        expect(hasOpenShell()).toBe(false)

        press('Escape')
        expect(onCancel).not.toHaveBeenCalled()
        expect(handle.cancelRequested).toBe(false)
        press('Tab')
        await settle()
        expect(box!.contains(document.activeElement), 'focus after Tab').toBe(true)
        expect(document.activeElement).not.toBe(opener)

        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        const yes = Array.from(box!.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'YES')!
        yes.click()
        await vi.advanceTimersByTimeAsync(0)
        await settle()
        expect(await answer).toBe(true)
        expect(document.querySelector('[data-part="pattern-task-root"]'), 'the card after the answer').not.toBeNull()
        expect(document.activeElement).toBe(document.querySelector('[data-part="pattern-task-title"]'))
    })

    // Compatibility guard (passes before and after S6b): an export run that ends while a legacy error is up keeps that error on top.
    test('TY1 a legacy error posted during a locked task stays on top when the task ends, and the result returns after it is closed', async () => {
        vi.useFakeTimers()
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ app: mount(TaskYieldHarness, { target, props: {} }), target })
        await settle()

        const handle = alertTask({ title: 'Export', steps: [{ label: 'Prepare' }, { label: 'Write' }] })
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]')).not.toBeNull()

        alertError('ERR::synthetic')
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]'), 'the card while the error is up').toBeNull()
        const box = document.querySelector('[data-alert-box]')
        expect(box, 'the error box').not.toBeNull()
        expect(box!.contains(document.activeElement), 'focus is inside the error').toBe(true)

        void handle.finish({ headline: 'Exported', summary: ['S'] })
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]'), 'the result under the error').toBeNull()

        const ok = Array.from(box!.querySelectorAll('button')).find((button) => button.textContent?.trim() === language.alertComp.ok)!
        ok.click()
        await vi.advanceTimersByTimeAsync(0)
        await settle()
        const root = document.querySelector('[data-part="pattern-task-root"]')
        expect(root, 'the card after the error is closed').not.toBeNull()
        expect(root!.textContent).toContain('Exported')
    })
})
