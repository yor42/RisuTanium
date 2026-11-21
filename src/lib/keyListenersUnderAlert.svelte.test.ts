// @vitest-environment happy-dom

/**
 * The window and document key listeners that the app's own components register,
 * while an alert that covers the page is shown.
 *
 * Mounts the REAL `TriggerV2List.svelte`, `PromptSettings.svelte`,
 * `BookmarkList.svelte`, `IrisModal.svelte` and `SourceDisclosure.svelte`, with
 * the REAL document keydown listener that `initHotkey()` registers, the real
 * alert functions and a real `writable` standing in for `alertStore`. Keys are
 * dispatched at the page body, as the browser does when nothing is focused, and
 * the assertions read what the component did: the effects left in the trigger
 * list, the open state the prompt template reports to its items, the store a
 * component closes itself through, and the dialogue line the iris modal shows.
 * `happy-dom` does not enforce `inert`, so these tests cover the listeners and
 * say nothing about what the browser does with the page behind an alert.
 *
 * Invariants pinned here:
 *  - a key that arrives while a confirm is up, or while a notice covers the
 *    page, is not acted on by these listeners: Delete removes no effect, Ctrl+Alt+O
 *    opens no prompt item, Escape closes the notice and nothing else, and Enter
 *    that closes a notice does not also advance the iris modal's dialogue;
 *  - the same keys act as usual when no alert is shown.
 *
 * Child components that need the app's whole dependency graph are replaced by
 * stand-ins: the chat message in `BookmarkList` and the prompt item, model list
 * and auxiliary model selectors in `PromptSettings`.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved. Every other test fails while the behaviour
 * it names is missing.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { triggerscript } from 'src/ts/process/triggers'
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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [] } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    const iris = $state({ open: true })
    const scrollTo = $state({ value: -1 })
    return {
        DBState: state,
        selIdState: selId,
        irisStore: iris,
        ScrollToMessageStore: scrollTo,
        alertStore: writable({ type: 'none', msg: '' }),
        loadoutModalStore: { open: false },
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        openPersonaList: writable(false),
        openPresetList: writable(false),
        OpenRealmStore: writable(false),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        selectedCharID: writable(0),
        settingsOpen: writable(false),
        bookmarkListOpen: writable(false),
        createSimpleCharacter: vi.fn(() => ({})),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        changeToPreset: vi.fn(),
        getCurrentCharacter: vi.fn(() => ({ name: 'Bob' })),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(),
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState'],
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(),
    getUserName: vi.fn(() => 'User'),
    getUserIcon: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/iris'), () => ({
    getIrisSystemPrompt: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/iris'))

vi.mock(import('src/ts/process/mcp/risuaccess'), () => ({
    RisuAccessClient: class {
        async getToolList() { return [] }
    },
}) as unknown as typeof import('src/ts/process/mcp/risuaccess'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ format: 0 })),
    LLMFormat: { OpenAICompatible: 0, Anthropic: 1, VertexAIGemini: 2, GoogleCloud: 3 },
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/process/templates/templateCheck'), () => ({
    templateCheck: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/templates/templateCheck'))

// The props each stand-in prompt item was mounted with: `isOpened` is a live getter on the
// parent's state, so reading it later shows what the parent currently reports.
const promptItemProps: Array<{ isOpened: boolean }> = []

vi.mock('src/lib/UI/PromptDataItem.svelte', () => ({
    default: (_anchor: unknown, props: { isOpened: boolean }) => { promptItemProps.push(props) },
}))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/ChatScreens/Chat.svelte', () => ({ default: () => {} }))

//#endregion

import { alertStore, bookmarkListOpen, DBState, irisStore } from 'src/ts/stores.svelte'
import { initHotkey } from 'src/ts/hotkey'
import { resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertConfirm, alertNormal, type alertData } from 'src/ts/alert'
import TriggerV2List from 'src/lib/SideBars/Scripts/TriggerV2List.svelte'
import PromptSettings from 'src/lib/Setting/Pages/PromptSettings.svelte'
import BookmarkList from 'src/lib/Others/BookmarkList.svelte'
import IrisModal from 'src/lib/Others/IrisModal.svelte'
import SourceDisclosure from 'src/lib/UI/SourceDisclosure.svelte'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }
/** One millisecond past the pause during which a notice ignores Enter. */
const PAUSE_MS = 401

function shown(): alertData {
    return get(alertStore) as alertData
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    document.body.dispatchEvent(ev)
    return ev
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountComponent(component: unknown, props: Record<string, unknown>): { target: HTMLElement, instance: unknown } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(component as never, { target, props })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

/** The ways an alert that blocks the keys can be on screen, each raised the way a caller raises it. */
const BLOCKING: Array<[string, () => void]> = [
    ['a confirm', () => { void alertConfirm('Proceed?') }],
    ['a notice', () => { alertNormal('A notice') }],
]

beforeAll(() => {
    initHotkey()
    // Svelte's transitions build their keyframes through the Web Animations API, which happy-dom lacks.
    if (typeof Element.prototype.animate !== 'function') {
        Element.prototype.animate = function () {
            return { onfinish: null, cancel() {}, finish() {}, currentTime: 0, finished: Promise.resolve() } as unknown as Animation
        }
    }
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
    alertStore.set(NONE as never)
    bookmarkListOpen.set(false)
    irisStore.open = true
    promptItemProps.length = 0
})

afterAll(() => {
    alertStore.set(NONE as never)
})

//#endregion

describe('TriggerV2List.svelte: the editor\'s key listener', () => {
    function mountEditorWithSelectedEffect(): triggerscript[] {
        const value: triggerscript[] = [
            { comment: 'header', type: 'manual', conditions: [], effect: [] },
            {
                comment: 'a trigger',
                type: 'manual',
                conditions: [],
                effect: [
                    { type: 'v2Comment', value: 'first', indent: 0 } as never,
                    { type: 'v2Comment', value: 'second', indent: 0 } as never,
                ],
            },
        ]
        DBState.db = { characters: [] } as unknown as Database
        const { target } = mountComponent(TriggerV2List, { value })
        target.querySelector<HTMLButtonElement>('button')!.click()
        flushSync()
        // The editor renders through a portal into the body: its effect rows are the buttons that hold a comment.
        const effectRow = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
            .find((button) => button.textContent?.includes('first'))
        expect(effectRow, 'the first effect row of the open editor').toBeTruthy()
        effectRow!.click()
        flushSync()
        return value
    }

    function editorIsOpen(): boolean {
        return Array.from(document.body.querySelectorAll('button')).some((button) => button.textContent?.includes('first'))
    }

    test('guard: with nothing shown, Delete removes the selected effect', () => {
        const value = mountEditorWithSelectedEffect()

        press('Delete')

        expect(value[1].effect.length).toBe(1)
    })

    test.each(BLOCKING)('Delete removes no effect while %s is shown', (_label, raise) => {
        const value = mountEditorWithSelectedEffect()
        raise()

        press('Delete')

        expect(value[1].effect.length, 'the effects left in the trigger').toBe(2)
    })

    test('Escape closes a notice over the editor and leaves the editor open', () => {
        mountEditorWithSelectedEffect()
        alertNormal('A notice')

        press('Escape')
        flushSync()

        expect.soft(shown().type, 'the alert after Escape').toBe('none')
        expect.soft(editorIsOpen(), 'the editor is still open').toBe(true)
    })

    test('guard: with nothing shown, Escape closes the editor', () => {
        mountEditorWithSelectedEffect()

        press('Escape')
        flushSync()

        expect(editorIsOpen()).toBe(false)
    })
})

describe('PromptSettings.svelte: the open-all key', () => {
    function mountPromptSettings(): void {
        DBState.db = {
            characters: [],
            promptTemplate: [{ type: 'plain', text: '', role: 'system', type2: 'normal' }],
        } as unknown as Database
        mountComponent(PromptSettings, {})
        expect(promptItemProps.length, 'the prompt items that were mounted').toBe(1)
    }

    test('guard: with nothing shown, Ctrl+Alt+O opens every prompt item', () => {
        mountPromptSettings()
        expect(promptItemProps[0].isOpened, 'the item before the key').toBe(false)

        press('o', { ctrlKey: true, altKey: true })
        flushSync()

        expect(promptItemProps[0].isOpened).toBe(true)
    })

    test.each(BLOCKING)('Ctrl+Alt+O opens no prompt item while %s is shown', (_label, raise) => {
        mountPromptSettings()
        raise()

        press('o', { ctrlKey: true, altKey: true })
        flushSync()

        expect(promptItemProps[0].isOpened, 'the item after the key').toBe(false)
    })
})

describe('BookmarkList.svelte: the Escape listener', () => {
    function mountBookmarks(): void {
        DBState.db = {
            characters: [{ name: 'Alice', chatPage: 0, chats: [{ message: [], bookmarks: [], bookmarkNames: {} }] }],
        } as unknown as Database
        bookmarkListOpen.set(true)
        mountComponent(BookmarkList, {})
    }

    test('guard: with nothing shown, Escape closes the bookmark list', () => {
        mountBookmarks()

        press('Escape')

        expect(get(bookmarkListOpen)).toBe(false)
    })

    test('Escape closes a notice over the bookmark list and leaves the list open', () => {
        mountBookmarks()
        alertNormal('A notice')

        press('Escape')

        expect.soft(shown().type, 'the alert after Escape').toBe('none')
        expect.soft(get(bookmarkListOpen), 'the bookmark list is still open').toBe(true)
    })
})

describe('IrisModal.svelte: the dialogue keys', () => {
    /** The iris dialogue line's accessible name: it reads "Dialogue loading" while the line is still being typed out. */
    function lineLabel(target: HTMLElement): string {
        return target.querySelector('[aria-live="polite"]')?.getAttribute('aria-label') ?? ''
    }

    async function mountIris(): Promise<HTMLElement> {
        vi.useFakeTimers()
        DBState.db = { characters: [], language: 'en', subModel: '', seperateModels: {} } as unknown as Database
        const { target } = mountComponent(IrisModal, {})
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        // The modal focuses its own text field; the keys under test are the ones that arrive with focus elsewhere.
        ;(document.activeElement as HTMLElement | null)?.blur()
        expect(lineLabel(target), 'the first line before any key').toContain('loading')
        return target
    }

    test('guard: with nothing shown, Enter finishes typing out the line', async () => {
        const target = await mountIris()

        press('Enter')
        flushSync()

        expect(lineLabel(target)).not.toContain('loading')
    })

    test('Enter that closes a notice over the modal does not advance the dialogue', async () => {
        const target = await mountIris()
        alertNormal('A notice')
        await vi.advanceTimersByTimeAsync(PAUSE_MS)

        press('Enter')
        flushSync()

        expect.soft(shown().type, 'the alert after Enter').toBe('none')
        expect.soft(lineLabel(target), 'the line after Enter').toContain('loading')
    })

    test('Escape closes a notice over the modal and leaves the modal open', async () => {
        await mountIris()
        alertNormal('A notice')

        press('Escape')

        expect.soft(shown().type, 'the alert after Escape').toBe('none')
        expect.soft(irisStore.open, 'the modal is still open').toBe(true)
    })
})

describe('SourceDisclosure.svelte: the Escape listener', () => {
    function mountOpenDisclosure(): HTMLButtonElement {
        const { target } = mountComponent(SourceDisclosure, {
            title: 'Source & Issues',
            description: 'Browse the source code.',
        })
        const trigger = target.querySelector('button') as HTMLButtonElement
        trigger.click()
        flushSync()
        expect(trigger.getAttribute('aria-expanded'), 'the disclosure after it was opened').toBe('true')
        return trigger
    }

    test('guard: with nothing shown, Escape closes the disclosure', () => {
        const trigger = mountOpenDisclosure()

        press('Escape')
        flushSync()

        expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })

    test('Escape closes a notice over an open disclosure and leaves the disclosure open', () => {
        const trigger = mountOpenDisclosure()
        alertNormal('A notice')

        press('Escape')
        flushSync()

        expect.soft(shown().type, 'the alert after Escape').toBe('none')
        expect.soft(trigger.getAttribute('aria-expanded'), 'the disclosure is still open').toBe('true')
    })
})
