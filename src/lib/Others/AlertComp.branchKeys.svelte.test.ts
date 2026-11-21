// @vitest-environment happy-dom

/**
 * The branches dialog of `AlertComp.svelte` as a keyboard and screen-reader surface: every node is a native button named
 * by its message's first line, focus shows the preview and blur hides it, and the tree is ONE Tab stop with a roving
 * `tabindex` and an arrow-key map (Up parent, Down first child, Left and Right along the row, Home and End along the
 * branch, no wrap).
 *
 * Drives the REAL `AlertComp.svelte`, the REAL `getChatBranches` over a seeded database (the producer is not mocked),
 * and the REAL document keydown listener of `initHotkey()`. Keys are dispatched as `KeyboardEvent`s on the focused node,
 * because happy-dom synthesises no click from Enter.
 *
 * Tests whose title starts with `guard:` pass with or without the keyboard model (they pin what must not change). Every
 * other test fails while the behaviour it names is missing.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (copied from AlertComp.toolProtocol.svelte.test.ts; only the branches producer stays real)

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
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isMobile: false,
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
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: '' },
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

vi.mock(import('src/ts/tokenizer'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        tokenize: vi.fn(async () => 7),
    }
})

vi.mock(import('../../ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('../../ts/process/index.svelte'))

//#endregion

import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { language } from 'src/lang'
import { alertStore, DBState, selectedCharID } from '../../ts/stores.svelte'
import { initHotkey } from '../../ts/hotkey'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { tabbables } from '../Nexus/pattern/patternFocus'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import AlertComp from './AlertComp.svelte'

/** The element that is one branch node. */
const NODE_SELECTOR = '[data-part="pattern-alert-tree-node"]'
const PREVIEW_SELECTOR = '[data-part="pattern-alert-tree-preview"]'

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

type Message = { role: 'user' | 'char', data: string }
type ChatSeed = { fmIndex?: number, message: Message[] }

function chatOf(texts: string[], fmIndex?: number): ChatSeed {
    return {
        ...(fmIndex === undefined ? {} : { fmIndex }),
        message: texts.map((data, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data })),
    }
}

function seedCharacter(firstMessage: string, alternateGreetings: string[], chats: ChatSeed[], hotkeys: unknown[] = []): void {
    DBState.db = {
        characters: [
            { name: 'Alice', chaId: 'cha-a', type: 'character', image: '', firstMessage, alternateGreetings, chats, chatPage: 0, additionalAssets: [] },
        ],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
        hotkeys,
    } as unknown as Database
}

/** BF: names and overlap. Five nodes in tree order. */
function seedBF(): void {
    seedCharacter('Hello from Alice\nSecond line', [], [
        chatOf(['\n\n   Hi there\nmore', '   \t ']),
        chatOf(['\n\n   Hi there\nmore', 'A'.repeat(30) + ' ' + 'B'.repeat(20), '**Bold** <img src=x onerror=alert(1)>']),
    ])
}

/** BF2: the key map. Seven nodes in tree order: R1, a1, a2, b1, b2, R2, c1. */
function seedBF2(hotkeys: unknown[] = []): void {
    seedCharacter('Greeting', ['Other greeting'], [
        chatOf(['a1', 'a2']),
        chatOf(['b1', 'b2']),
        chatOf(['c1'], 0),
    ], hotkeys)
}

async function openBranches(seed: () => void): Promise<HTMLElement> {
    vi.useFakeTimers()
    seed()
    const target = mountAlertComp()
    await settle()
    alertStore.set({ type: 'branches', msg: '' } as never)
    await settle()
    return target
}

const nodesOf = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>(NODE_SELECTOR))

function closeButton(target: HTMLElement): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.uiCommon.close}"]`)
    if (!found) throw new Error('no close button is mounted')
    return found
}

const previewText = (target: HTMLElement): string | null => target.querySelector(PREVIEW_SELECTOR)?.textContent?.trim() ?? null

function press(key: string, init: KeyboardEventInit = {}, on: Element | null = document.activeElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    ;(on ?? document.body).dispatchEvent(event)
    flushSync()
    return event
}

function focusNode(node: HTMLElement): void {
    node.focus()
    flushSync()
}

const stopsOf = (nodes: HTMLElement[]): number[] => nodes.flatMap((node, i) => (node.tabIndex === 0 ? [i] : []))

beforeAll(() => {
    initHotkey()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    selectedCharID.set(0)
})

afterAll(() => {
    alertStore.set({ type: 'none', msg: '' } as never)
})

describe('T3-8: the tree is one Tab stop', () => {
    test('exactly one native node button is tabbable besides the close, and it is the first node', async () => {
        const target = await openBranches(seedBF)

        const close = closeButton(target)
        const stops = tabbables(target).filter((el) => el !== close)
        expect(stops).toHaveLength(1)
        const nodes = nodesOf(target)
        expect(stops[0].tagName).toBe('BUTTON')
        expect(stops[0].matches(NODE_SELECTOR)).toBe(true)
        expect(stops[0]).toBe(nodes[0])
        expect(controlName(stops[0])).toBe('Hello from Alice')
        for (const node of nodes.slice(1)) expect(node.tabIndex).toBe(-1)
    })
})

describe('T3-9: every node is named by its message', () => {
    test('the names are the first non-blank line, trimmed, collapsed and truncated; no control is unnamed', async () => {
        const target = await openBranches(seedBF)

        const nodes = nodesOf(target)
        expect(nodes.map(controlName)).toEqual([
            'Hello from Alice',
            'Hi there',
            language.chatShellTogglesEmpty,
            'A'.repeat(30) + ' ' + 'B'.repeat(8) + '…',
            '**Bold** <img src=x onerror=alert(1)>',
        ])
        expect(language.chatShellTogglesEmpty).toBe('(empty)')
        expect(unnamedControls(target)).toEqual([])
        expect(target.querySelector('img')).toBeNull()
    })
})

describe('T3-10: focus shows the preview, blur hides it', () => {
    test('focus shows the full message and makes the node the only roving stop; blur removes the preview', async () => {
        const target = await openBranches(seedBF)
        const nodes = nodesOf(target)

        focusNode(nodes[1])
        expect(previewText(target)).toBe('\n\n   Hi there\nmore'.trim())
        expect(stopsOf(nodes)).toEqual([1])

        nodes[1].blur()
        flushSync()
        expect(previewText(target)).toBeNull()
    })

    test('a message with markup is shown as text and creates no element', async () => {
        const target = await openBranches(seedBF)
        const nodes = nodesOf(target)

        focusNode(nodes[4])

        expect(previewText(target)).toBe('**Bold** <img src=x onerror=alert(1)>')
        expect(target.querySelector('img')).toBeNull()
    })

    test('blur clears only its own preview, and focus replaces another node\'s preview', async () => {
        const target = await openBranches(seedBF)
        const nodes = nodesOf(target)

        focusNode(nodes[1])
        nodes[1].dispatchEvent(new MouseEvent('mouseleave'))
        flushSync()
        nodes[3].dispatchEvent(new MouseEvent('mouseenter'))
        flushSync()
        expect(previewText(target)).toBe('A'.repeat(30) + ' ' + 'B'.repeat(20))

        nodes[1].blur()
        flushSync()
        expect(previewText(target), 'a blur of a node that does not own the preview leaves it').toBe('A'.repeat(30) + ' ' + 'B'.repeat(20))

        focusNode(nodes[1])
        expect(previewText(target), 'focus replaces the preview of another node').toBe('Hi there\nmore')
    })

    test('a click on one node while another holds the focus preview shows the clicked node', async () => {
        const target = await openBranches(seedBF)
        const nodes = nodesOf(target)

        focusNode(nodes[2])
        nodes[3].click()
        flushSync()

        expect(previewText(target)).toBe('A'.repeat(30) + ' ' + 'B'.repeat(20))
    })
})

describe('T3-12: the first-message node shows its text', () => {
    test('mouseenter on the root node shows the first message', async () => {
        const target = await openBranches(seedBF)

        nodesOf(target)[0].dispatchEvent(new MouseEvent('mouseenter'))
        flushSync()

        expect(target.textContent).toContain('Hello from Alice')
    })
})

describe('T3-13: Escape from a focused node closes the dialog', () => {
    test('guard: the preview and the dialog go away and the store is closed', async () => {
        const target = await openBranches(seedBF2)
        const nodes = nodesOf(target)
        focusNode(nodes[3])

        press('Escape')
        await settle()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
        expect(nodesOf(target)).toHaveLength(0)
        expect(previewText(target)).toBeNull()
    })
})

describe('T3-15: the arrow keys move along the tree', () => {
    // Indexes in BF2 tree order: 0 R1, 1 a1, 2 a2, 3 b1, 4 b2, 5 R2, 6 c1.
    const NAMES = ['Greeting', 'a1', 'a2', 'b1', 'b2', 'Other greeting', 'c1']
    const CASES: Array<[string, number, string, number]> = [
        ['R1 ArrowDown goes to a1, the first child', 0, 'ArrowDown', 1],
        ['a1 ArrowDown goes to a2', 1, 'ArrowDown', 2],
        ['R1 ArrowRight goes to R2', 0, 'ArrowRight', 5],
        ['a2 ArrowRight goes to b2, a cousin in another branch', 2, 'ArrowRight', 4],
        ['b1 ArrowRight goes to c1, across first messages', 3, 'ArrowRight', 6],
        ['b2 ArrowLeft goes to a2', 4, 'ArrowLeft', 2],
        ['R2 ArrowLeft goes to R1', 5, 'ArrowLeft', 0],
        ['b2 ArrowUp goes to b1', 4, 'ArrowUp', 3],
        ['b1 ArrowUp goes to R1, the parent and not the previous node in tree order', 3, 'ArrowUp', 0],
        ['c1 ArrowUp goes to R2', 6, 'ArrowUp', 5],
        ['b2 Home goes to R1', 4, 'Home', 0],
        ['c1 Home goes to R2, the root of its own branch', 6, 'Home', 5],
        ['R1 End goes to a2, the end of the straight line below', 0, 'End', 2],
    ]

    test.each(CASES)('%s', async (_title, from, key, to) => {
        const target = await openBranches(seedBF2)
        const nodes = nodesOf(target)
        expect(nodes).toHaveLength(NAMES.length)
        focusNode(nodes[from])

        const event = press(key)

        expect(document.activeElement).toBe(nodes[to])
        expect(stopsOf(nodes)).toEqual([to])
        expect(previewText(target)).toBe(NAMES[to])
        expect(event.defaultPrevented).toBe(true)
    })

    test('a user hotkey bound to a plain arrow is consumed while blocked, and the tree still moves', async () => {
        const target = await openBranches(() => seedBF2([{ key: 'ArrowRight', action: 'home' }]))
        const nodes = nodesOf(target)
        focusNode(nodes[2])

        press('ArrowRight')

        expect(document.activeElement).toBe(nodes[4])
        expect(get(selectedCharID)).toBe(0)
    })

    test('Escape on the focused node still closes the dialog', async () => {
        const target = await openBranches(seedBF2)
        focusNode(nodesOf(target)[4])

        press('Escape')
        await settle()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
    })
})

describe('T3-17: the edges do not wrap', () => {
    const EDGES: Array<[string, number, string]> = [
        ['a2 ArrowDown (a leaf)', 2, 'ArrowDown'],
        ['R1 ArrowUp (a root)', 0, 'ArrowUp'],
        ['R1 ArrowLeft (first on its row)', 0, 'ArrowLeft'],
        ['c1 ArrowRight (last on its row)', 6, 'ArrowRight'],
        ['R1 Home', 0, 'Home'],
        ['a2 End', 2, 'End'],
    ]

    test.each(EDGES)('%s keeps the focus, the stop and prevents the default', async (_title, from, key) => {
        const target = await openBranches(seedBF2)
        const nodes = nodesOf(target)
        focusNode(nodes[from])

        const event = press(key)

        expect(document.activeElement).toBe(nodes[from])
        expect(stopsOf(nodes)).toEqual([from])
        expect(event.defaultPrevented).toBe(true)
    })
})

describe('T3-18: a re-render keeps a valid roving stop', () => {
    test('a node added before the focused one keeps the same element, name and stop', async () => {
        const target = await openBranches(seedBF2)
        const before = nodesOf(target)
        focusNode(before[3])
        const element = before[3]

        ;(DBState.db.characters[0].chats[0].message as Message[]).push({ role: 'user', data: 'a3' })
        await settle()

        const after = nodesOf(target)
        expect(after).toHaveLength(8)
        expect(document.activeElement).toBe(element)
        expect(controlName(element)).toBe('b1')
        expect(stopsOf(after)).toEqual([after.indexOf(element)])
    })

    test('removing the focused node leaves exactly one roving stop', async () => {
        const target = await openBranches(seedBF2)
        const chat = DBState.db.characters[0].chats[0].message as Message[]
        chat.push({ role: 'user', data: 'a3' })
        await settle()
        focusNode(nodesOf(target)[3])

        chat.pop()
        await settle()

        expect(stopsOf(nodesOf(target))).toHaveLength(1)
    })

    test('closing and reopening starts at the first node again', async () => {
        const target = await openBranches(seedBF2)
        focusNode(nodesOf(target)[4])

        press('Escape')
        await settle()
        alertStore.set({ type: 'branches', msg: '' } as never)
        await settle()

        expect(stopsOf(nodesOf(target))).toEqual([0])
    })
})

describe('T3-19: the tree does not interfere with other keys', () => {
    test('guard: ArrowDown on a node still reaches the window bubble listeners', async () => {
        const target = await openBranches(seedBF2)
        const nodes = nodesOf(target)
        focusNode(nodes[0])
        const seen = vi.fn()
        window.addEventListener('keydown', seen)
        try {
            press('ArrowDown')
        } finally {
            window.removeEventListener('keydown', seen)
        }

        expect(seen).toHaveBeenCalledTimes(1)
    })

    test.each([['altKey'], ['ctrlKey'], ['shiftKey'], ['metaKey']])('guard: %s with ArrowDown does not move focus and is not prevented', async (modifier) => {
        const target = await openBranches(seedBF2)
        const nodes = nodesOf(target)
        focusNode(nodes[0])

        const event = press('ArrowDown', { [modifier]: true })

        expect(document.activeElement).toBe(nodes[0])
        expect(event.defaultPrevented).toBe(false)
    })

    test('guard: ArrowDown aimed at the close button is not handled', async () => {
        const target = await openBranches(seedBF2)
        const close = closeButton(target)
        close.focus()
        flushSync()

        const event = press('ArrowDown')

        expect(document.activeElement).toBe(close)
        expect(event.defaultPrevented).toBe(false)
    })

    test('guard: Enter and Tab on a node are not prevented and the dialog stays', async () => {
        const target = await openBranches(seedBF2)
        focusNode(nodesOf(target)[1])

        const enter = press('Enter')
        const tab = press('Tab')
        await settle()

        expect(enter.defaultPrevented).toBe(false)
        expect(tab.defaultPrevented).toBe(false)
        expect(get(alertStore).type).toBe('branches')
    })
})
