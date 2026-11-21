// @vitest-environment happy-dom

/**
 * The Cancel button in `AlertComp.svelte`'s select and input branches: it is rendered when the caller
 * offered a cancel that no shown option already answers, writes exactly the cancel the caller offered,
 * and is subject to the same answer guard as every other prompt button. A select or input that is not
 * opted in renders none.
 *
 * The module mocks copy `AlertComp.cancel.svelte.test.ts`. `src/ts/alert.ts` and the prompt controller
 * are real, over a real `writable` standing in for `alertStore`, with fake timers so the 400 ms answer
 * guard is a clock the test moves.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

//#endregion

import { alertStore } from '../../ts/stores.svelte'
import { alertInput, alertSelect } from '../../ts/alert'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

function buttonTexts(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '')
}

function cancelButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('button')).filter((button) => button.textContent?.trim() === language.cancel)
}

interface Outcome {
    settled: boolean
    value?: string
}

function track(promise: Promise<string>): Outcome {
    const outcome: Outcome = { settled: false }
    void promise.then((value) => {
        outcome.settled = true
        outcome.value = value
    })
    return outcome
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.useRealTimers()
})

describe('a select whose caller offered a cancel', () => {
    test('shows one Cancel button; a click inside the guard is discarded and one after it answers with the cancel', async () => {
        const out = track(alertSelect(['a', 'b'], undefined, { cancel: '-1' }))
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual(['a', 'b', language.cancel])

        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect.soft(out.settled, 'a click inside the answer guard').toBe(false)
        expect.soft(get(alertStore).type, 'the store after the early click').toBe('select')

        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect(out).toEqual({ settled: true, value: '-1' })
    })

    test('a cancel equal to a shown option index renders no extra button, and Back writes that option', async () => {
        const out = track(alertSelect(['Replace', 'Skip', 'Add'], undefined, { cancel: '1' }))
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual(['Replace', 'Skip', 'Add'])
        expect(cancelButtons(target).length).toBe(0)

        expect(dispatchBack()).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(out).toEqual({ settled: true, value: '1' })
    })

    test('a heading is not an option: the cancel index counts the options only', async () => {
        const out = track(alertSelect(['Replace', 'Skip'], 'Heading', { cancel: '2' }))
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual(['Replace', 'Skip', language.cancel])

        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect(out).toEqual({ settled: true, value: '2' })
    })
})

describe('an input whose caller offered a cancel', () => {
    test('shows a Cancel button after OK; a click after the guard answers with the cancel', async () => {
        const out = track(alertInput('Name?', [], '', { cancel: '' }))
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual([language.alertComp.ok, language.cancel])

        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect.soft(out.settled, 'a click inside the answer guard').toBe(false)

        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect(out).toEqual({ settled: true, value: '' })
    })

    test('writes the offered cancel and not the text in the field', async () => {
        const out = track(alertInput('Name?', [], 'typed', { cancel: '\u0000cancel' }))
        const target = mountAlertComp()
        flushSync()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        cancelButtons(target)[0].click()
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect(out).toEqual({ settled: true, value: '\u0000cancel' })
    })
})

describe('a select or input that is not opted in', () => {
    test('a select renders no Cancel button', () => {
        void alertSelect(['a', 'b'])
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual(['a', 'b'])
    })

    test('an input renders no Cancel button', () => {
        void alertInput('Name?')
        const target = mountAlertComp()
        flushSync()
        expect(buttonTexts(target)).toEqual([language.alertComp.ok])
    })
})
