// @vitest-environment happy-dom

/**
 * Where keyboard focus goes when an alert that covers the page is shown.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for
 * `alertStore`, and the real alert functions for the prompt that a notice
 * covers. The assertions read `document.activeElement`.
 *
 * Invariants pinned here:
 *  - when an alert that covers the page is shown, focus is inside it, on an
 *    element that is not a control: a button, a field, a link or an element
 *    that acts as a button would be pressed by the same Enter or Space that
 *    opened the alert;
 *  - the control that held focus before the alert opened does not keep it;
 *  - a prompt that comes back from under a notice takes focus again;
 *  - a different alert that replaces one whose control holds focus takes focus
 *    from that control, while a re-emission of the same wait alert with new
 *    text leaves focus on the control the user moved to.
 *
 * The module mocks copy `AlertComp.promptState.svelte.test.ts`: none of it is
 * exercised here, but the component needs it to import and mount.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved. Every other test fails while the behaviour
 * it names is missing.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
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

import { alertStore, DBState } from '../../ts/stores.svelte'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertConfirm, alertGenerationInfoStore, alertNormal, type alertData } from '../../ts/alert'
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

/** Lets the component react to the store and run the focus it moves after the DOM update. */
async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
    await Promise.resolve()
}

/** Replaces the alert on screen, the way the app does, and lets the component react. */
async function show(value: alertData): Promise<void> {
    alertStore.set(value as never)
    await settle()
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

/** An element that a press of Enter or Space would activate, or that takes typed text. */
function isControl(el: Element | null): boolean {
    if (!el) {
        return false
    }
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'A'].includes(el.tagName)) {
        return true
    }
    const role = el.getAttribute('role')
    return role === 'button' || role === 'link' || role === 'menuitem' || el.hasAttribute('contenteditable')
}

function describeElement(el: Element | null): string {
    if (!el) {
        return 'nothing'
    }
    const role = el.getAttribute('role')
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}>`
}

function arrangeDatabase(): void {
    DBState.db = {
        characters: [{
            name: 'Alice',
            chats: [{ message: [], hypaV2Data: { chunks: [], mainChunks: [] } }],
            chatPage: 0,
        }],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
    } as unknown as Database
    alertGenerationInfoStore.set({
        genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
        idx: 0,
    } as never)
}

/** One alert of every type that covers the page, shaped the way its caller posts it. */
const COVERING_ALERTS: Array<[alertData['type'], alertData]> = [
    ['ask', { type: 'ask', msg: 'Proceed?' }],
    ['pluginconfirm', { type: 'pluginconfirm', msg: 'A plugin\nIt can read data\n\nImport it?' }],
    ['select', { type: 'select', msg: 'One||Two' }],
    ['input', { type: 'input', msg: 'Name?', datalist: [], defaultValue: '' }],
    ['selectChar', { type: 'selectChar', msg: '' }],
    ['addchar', { type: 'addchar', msg: '' }],
    ['chatOptions', { type: 'chatOptions', msg: '' }],
    ['cardexport', { type: 'cardexport', msg: '', submsg: 'module' }],
    ['selectModule', { type: 'selectModule', msg: '' }],
    ['tos', { type: 'tos', msg: 'tos' }],
    ['staleAccountNotice', { type: 'staleAccountNotice', msg: 'stale' }],
    ['progress', { type: 'progress', msg: 'Saving', submsg: '10' }],
    ['normal', { type: 'normal', msg: 'A notice' }],
    ['error', { type: 'error', msg: 'A failure' }],
    ['markdown', { type: 'markdown', msg: 'Some **text**' }],
    ['requestdata', { type: 'requestdata', msg: '' }],
    ['hypaV2', { type: 'hypaV2', msg: '' }],
    ['branches', { type: 'branches', msg: '' }],
    ['requestlogs', { type: 'requestlogs', msg: '' }],
    ['pukmakkurit', { type: 'pukmakkurit', msg: '' }],
    ['wait2', { type: 'wait2', msg: 'Stopped' }],
    ['wait', { type: 'wait', msg: 'Loading...' }],
]

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

describe('AlertComp.svelte: focus when an alert that covers the page opens', () => {
    test.each(COVERING_ALERTS)('a %s alert takes focus on an element of its own that is not a control', async (_type, alert) => {
        arrangeDatabase()
        const target = mountAlertComp()
        await settle()

        await show(alert)

        const focused = document.activeElement
        expect.soft(target.childElementCount, 'the alert is rendered').toBeGreaterThan(0)
        expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
        expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
    })

    test('the composer that held focus before the alert opened does not keep it', async () => {
        arrangeDatabase()
        const composer = document.createElement('textarea')
        document.body.append(composer)
        composer.focus()
        expect(document.activeElement, 'focus before the alert').toBe(composer)
        mountAlertComp()
        await settle()

        await show({ type: 'ask', msg: 'Proceed?' })

        expect(document.activeElement).not.toBe(composer)
    })

    test('a prompt that comes back from under a notice takes focus on an element of its own that is not a control', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        void alertConfirm('Proceed?')
        const target = mountAlertComp()
        await settle()
        alertNormal('A notice')
        await settle()

        buttonNamed(target, 'OK').click()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        const prompt = target.querySelector('[style*="display: contents"]')
        const focused = document.activeElement
        expect.soft(target.textContent, 'the notice after it was closed').not.toContain('A notice')
        expect.soft(prompt?.contains(focused) ?? false, `focus is inside the prompt that came back (it is on ${describeElement(focused)})`).toBe(true)
        expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
    })
})

describe('AlertComp.svelte: focus when a prompt is covered and uncovered', () => {
    test('a notice shown over a waiting prompt takes focus on its own box, not on the covered prompt\'s box', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        void alertConfirm('Proceed?')
        const target = mountAlertComp()
        await settle()

        alertNormal('A notice')
        await settle()

        const focused = document.activeElement
        expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
        expect.soft(focused?.closest('[inert]') ?? null, 'the inert ancestor of the focused element').toBeNull()
        expect.soft(focused?.closest('[style*="display: contents"]') ?? null, 'the covered prompt\'s wrapper around the focused element').toBeNull()
        expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
    })

    test('a prompt that comes back after a toast covered it takes focus on its box again', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        void alertConfirm('Proceed?')
        const target = mountAlertComp()
        await settle()
        alertStore.set({ type: 'toast', msg: 'A toast' } as never)
        await settle()
        // A browser drops focus from a subtree that becomes inert; happy-dom keeps it, so the test does the same.
        ;(document.activeElement as HTMLElement | null)?.blur()
        expect(document.activeElement, 'focus while the toast covers the prompt').toBe(document.body)

        alertStore.set({ type: 'none', msg: '' } as never)
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        const prompt = target.querySelector('[style*="display: contents"]')
        const focused = document.activeElement
        expect.soft(target.textContent, 'the toast after it ended').not.toContain('A toast')
        expect.soft(prompt?.contains(focused) ?? false, `focus is inside the prompt that came back (it is on ${describeElement(focused)})`).toBe(true)
        expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
    })
})

describe('AlertComp.svelte: what is inert inside a covering alert', () => {
    /** The covering alerts whose markup holds at least one button. */
    const WITH_BUTTONS: Array<alertData['type']> = [
        'ask', 'pluginconfirm', 'select', 'input', 'selectChar', 'addchar', 'chatOptions', 'cardexport',
        'selectModule', 'staleAccountNotice', 'normal', 'error', 'markdown', 'requestdata', 'hypaV2',
        'branches', 'requestlogs',
    ]

    test.each(COVERING_ALERTS.filter(([type]) => WITH_BUTTONS.includes(type)))('guard: no button of a %s alert sits inside an inert subtree', async (_type, alert) => {
        arrangeDatabase()
        const target = mountAlertComp()
        await settle()

        await show(alert)

        const buttons = Array.from(target.querySelectorAll('button'))
        expect.soft(buttons.length, 'the buttons the alert renders').toBeGreaterThan(0)
        expect(buttons.filter((button) => button.closest('[inert]') !== null).map((button) => button.textContent?.trim()), 'the buttons inside an inert subtree').toEqual([])
    })

    test('guard: a prompt covered by a notice is inert and the notice is not', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        void alertConfirm('Proceed?')
        const target = mountAlertComp()
        await settle()

        alertNormal('A notice')
        await settle()

        expect.soft(buttonNamed(target, 'YES').closest('[inert]'), 'the covered prompt\'s button').not.toBeNull()
        expect.soft(buttonNamed(target, 'OK').closest('[inert]'), 'the notice\'s button').toBeNull()
    })
})

describe('AlertComp.svelte: focus when one alert replaces another', () => {
    test('a new error replacing an error whose "Show details" button holds focus takes focus on an element that is not a control', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'error', msg: 'First failure', stackTrace: 'Error: first\n    at a' })
        const details = buttonNamed(target, language.showErrorDetails)
        details.focus()
        expect(document.activeElement, 'focus before the replacement').toBe(details)

        await show({ type: 'error', msg: 'Second failure', stackTrace: 'Error: second\n    at b' })

        const focused = document.activeElement
        expect.soft(target.textContent, 'the alert on screen').toContain('Second failure')
        expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
        expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
    })

    test('guard: a wait alert re-emitted with new text leaves focus on its Cancel button', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        const onCancel = vi.fn()
        await show({ type: 'wait', msg: 'Loading 1', onCancel })
        const cancel = buttonNamed(target, language.cancel)
        cancel.focus()
        expect(document.activeElement, 'focus before the update').toBe(cancel)

        await show({ type: 'wait', msg: 'Loading 2', onCancel })

        expect.soft(target.textContent, 'the alert on screen').toContain('Loading 2')
        expect.soft(document.activeElement, 'focus after the update').toBe(cancel)
    })
})
