// @vitest-environment happy-dom

/**
 * The 8 s `Still working.` hint of a legacy wait (`wait`, `wait2`): it follows the wait's own text, so a same-text
 * re-emission keeps the running timer, a new text restarts it, and the hint goes when the wait goes.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for `alertStore` under fake timers.
 * The module mocks copy `AlertComp.shell.svelte.test.ts`; the component needs them to mount.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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

vi.mock(import('../../ts/sourcemap'), () => ({
    translateStackTrace: vi.fn(async (stackTrace: string) => ({ didTranslate: false, stackTrace })),
}) as unknown as typeof import('../../ts/sourcemap'))

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

//#endregion

import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { language } from 'src/lang'
import { alertStore } from '../../ts/stores.svelte'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertWait, type alertData } from '../../ts/alert'
import AlertComp from './AlertComp.svelte'

const HINT_MS = 8000
const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

async function show(value: alertData): Promise<void> {
    alertStore.set(value as never)
    await settle()
}

async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
    await settle()
}

const hintShown = (target: HTMLElement): boolean => (target.textContent ?? '').includes(language.alertWaitSlowHint)

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
})

describe('AlertComp.svelte: the still-working hint of a wait', () => {
    test.each(['wait', 'wait2'] as const)('a %s alert shows the hint once its text has been the same for 8 s, and not before', async (type) => {
        vi.useFakeTimers()
        const target = mountAlertComp()
        await show({ type, msg: 'Loading...' })

        await advance(HINT_MS - 1)
        expect(hintShown(target), 'just before 8 s').toBe(false)
        await advance(1)
        expect(hintShown(target), 'at 8 s').toBe(true)
    })

    test('a same-text re-emission keeps the timer', async () => {
        vi.useFakeTimers()
        const target = mountAlertComp()
        await show({ type: 'wait', msg: 'Loading...' })
        await advance(5000)

        await show({ type: 'wait', msg: 'Loading...' })
        await advance(HINT_MS - 5000)

        expect(hintShown(target), '8 s after the first emission').toBe(true)
    })

    test('a text change restarts the timer', async () => {
        vi.useFakeTimers()
        const target = mountAlertComp()
        await show({ type: 'wait', msg: 'Loading 1' })
        await advance(5000)

        await show({ type: 'wait', msg: 'Loading 2' })
        await advance(HINT_MS - 5000)
        expect(hintShown(target), '8 s after the first text, 3 s after the second').toBe(false)

        await advance(5000)
        expect(hintShown(target), '8 s after the second text').toBe(true)
    })

    test('the hint goes when the wait goes, and a wait cleared before 8 s never shows it', async () => {
        vi.useFakeTimers()
        const target = mountAlertComp()
        await show({ type: 'wait', msg: 'Loading...' })
        await advance(HINT_MS)
        expect(hintShown(target), 'after 8 s').toBe(true)
        await show({ type: 'none', msg: '' })
        expect(hintShown(target), 'after the wait ended').toBe(false)

        await show({ type: 'wait', msg: 'Again' })
        await advance(3000)
        await show({ type: 'none', msg: '' })
        await advance(HINT_MS)
        expect(hintShown(target), 'a later 8 s with no wait on screen').toBe(false)

        const wait = alertWait('Third')
        expect(wait.type).toBe('wait')
        await settle()
        expect(hintShown(target), 'a new wait starts without the hint').toBe(false)
    })
})
