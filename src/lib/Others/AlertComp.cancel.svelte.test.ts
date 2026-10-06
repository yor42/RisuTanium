// @vitest-environment happy-dom

/**
 * The Cancel button in `AlertComp.svelte`'s wait branch: it is rendered on a
 * wait notice that carries a cancel action and on no other wait notice, and
 * pressing it runs that action. The last test mounts the component over the
 * REAL prompt-preview runner (`src/ts/process/previewRunner.ts`) with a stand-in
 * `sendChat`, so the button pressed is the one on the preview's own notice.
 *
 * The module mocks copy `AlertComp.tos.svelte.test.ts` (`localforage`,
 * `src/ts/globalApi.svelte`, `src/ts/storage/database.svelte`,
 * `src/ts/platform`, `@tauri-apps/plugin-fs`, a reactive `stores.svelte`
 * stand-in and partial `characters` / `avatarThumb` mocks): none of it is
 * exercised by the wait branch, but the component needs it to import and
 * mount. `src/ts/alert.ts` is real, over a real `writable` standing in for
 * `alertStore`. `sendChat` is a stand-in; it says nothing about what the real
 * send does.
 *
 * The button is found by its visible text, `language.cancel`, which is what
 * the branch renders.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { SendChatArg } from 'src/ts/process/index.svelte'
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

const { changeCharSpy, avatarThumbSpy, sendChatMock } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    avatarThumbSpy: vi.fn(async () => null),
    sendChatMock: vi.fn(),
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

// The preview runner's send: the real one is far too heavy to load here.
vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: sendChatMock,
}) as unknown as typeof import('src/ts/process/index.svelte'))

//#endregion

import { alertStore } from '../../ts/stores.svelte'
import { alertClear, alertErrorWait, alertNormal, alertWait } from '../../ts/alert'
import { renderPromptResult, runPreview } from 'src/ts/process/previewRunner'
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
    sendChatMock.mockReset()
})

describe('AlertComp.svelte wait notice: the Cancel button', () => {
    test('a wait notice with a cancel action shows one Cancel button, and pressing it runs the action once', () => {
        const onCancel = vi.fn()
        alertWait('Loading...', onCancel)
        const { target } = mountAlertComp()
        flushSync()

        const buttons = cancelButtons(target)
        expect(buttons.length).toBe(1)
        expect(onCancel).not.toHaveBeenCalled()

        buttons[0].click()
        flushSync()

        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('a wait notice without a cancel action shows no Cancel button', () => {
        alertWait('Loading...')
        const { target } = mountAlertComp()
        flushSync()

        expect(cancelButtons(target).length).toBe(0)
    })

    test('the error wait notice shows no Cancel button', () => {
        void alertErrorWait('Something failed')
        const { target } = mountAlertComp()
        flushSync()

        expect(get(alertStore).type).toBe('wait2')
        expect(cancelButtons(target).length).toBe(0)
    })

    test('the Cancel button goes away with the notice', () => {
        alertWait('Loading...', vi.fn())
        const { target } = mountAlertComp()
        flushSync()
        expect(cancelButtons(target).length).toBe(1)

        alertNormal('Something else')
        flushSync()

        expect(cancelButtons(target).length).toBe(0)
    })
})

describe('the preview runner\'s notice in AlertComp.svelte', () => {
    test('pressing Cancel on the preview\'s notice closes it at once and aborts the send, and nothing is shown when the send ends', async () => {
        let finish!: () => void
        const gate = new Promise<void>((resolve) => { finish = resolve })
        let started!: (arg: SendChatArg) => void
        const startedArg = new Promise<SendChatArg>((resolve) => { started = resolve })
        sendChatMock.mockImplementationOnce(async (_index?: number, arg: SendChatArg = {}) => {
            started(arg)
            await gate
            if (arg.previewResult) {
                arg.previewResult.body = JSON.stringify({ url: 'https://api.example.com/v1', headers: {}, body: { model: 'test-model' } })
            }
            return true
        })
        const seen: string[] = []
        const stop = alertStore.subscribe((value) => { seen.push((value as { type: string }).type) })
        const { target } = mountAlertComp()

        const run = runPreview({ previewPrompt: true }, renderPromptResult)
        const arg = await startedArg
        flushSync()
        const buttons = cancelButtons(target)
        expect(buttons.length, 'Cancel buttons on the preview\'s notice').toBe(1)
        expect(arg.signal?.aborted, 'aborted before the press').toBe(false)

        buttons[0].click()
        flushSync()

        expect.soft(get(alertStore).type, 'the alert right after the press').toBe('none')
        expect.soft(arg.signal?.aborted, 'the send\'s signal').toBe(true)
        expect.soft(cancelButtons(target).length, 'Cancel buttons after the press').toBe(0)
        finish()
        await run
        stop()
        expect.soft(get(alertStore).type, 'the alert when the run ended').toBe('none')
        expect.soft(seen.includes('markdown'), 'a preview was shown').toBe(false)
        alertClear()
    })
})
