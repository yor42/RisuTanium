// @vitest-environment jsdom

/**
 * T29b: the import Undo on a result card across a yield.
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
import { resetAlertPromptsForTests } from '../../../ts/alertPrompts'
import { alertStore } from '../../../ts/stores.svelte'
import { alertTask, resetTaskHostForTests } from '../../../ts/alertTask.svelte'
import TaskYieldHarness from './TaskYieldHarness.svelte'

const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []

afterEach(async () => {
    for (const { app, target } of mounted.splice(0)) {
        await unmount(app).catch(() => {})
        target.remove()
    }
    document.body.replaceChildren()
    vi.useRealTimers()
    resetTaskHostForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    vi.clearAllMocks()
})

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

function tapStamped(button: HTMLElement, stamp: number): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: stamp })
    button.dispatchEvent(tap)
}

const undoButton = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-part="pattern-task-result-action"]')

describe('a result card with a guarded Undo across a yield', () => {
    test('T29b guard: Undo renders again after a covering alert, is armed afresh, and a click after arming answers undo', async () => {
        vi.useFakeTimers()
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ app: mount(TaskYieldHarness, { target, props: {} }), target })
        await settle()

        const handle = alertTask({ title: 'Import', steps: [{ label: 'Read file' }, { label: 'Add items' }] })
        const closed = handle.finish({ headline: 'Imported 1 item', actions: [{ id: 'undo', label: 'Undo import', guarded: true }] })
        await settle()
        expect(undoButton(), 'Undo on the first render').not.toBeNull()

        alertStore.set({ type: 'normal', msg: 'covering' })
        await settle()
        expect(document.querySelector('[data-part="pattern-task-root"]'), 'the card steps aside').toBeNull()

        alertStore.set({ type: 'none', msg: '' })
        await settle()
        expect(undoButton(), 'Undo returns with the card').not.toBeNull()
        //A tap stamped at the return belongs to the alert that was just closed.
        tapStamped(undoButton()!, performance.now())
        await settle()
        let answered: unknown = 'pending'
        void closed.then((answer) => { answered = answer })
        await settle()
        expect(answered, 'the click before re-arming is ignored').toBe('pending')

        await vi.advanceTimersByTimeAsync(400)
        tapStamped(undoButton()!, performance.now())
        await vi.advanceTimersByTimeAsync(0)
        await settle()
        expect(answered).toEqual({ kind: 'action', id: 'undo' })
    })
})