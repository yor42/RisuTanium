// @vitest-environment jsdom
/**
 * TA-5(e), the mounted-screen walk (part 1: the chat shell sidebar and the legacy rail). The authority for ESCAPE_ANCESTORS: it
 * mounts the real components the app renders for each screen, finds each escape element in every layout its chain branches on,
 * and asserts that every `data-part` above it is in ESCAPE_ANCESTORS or critical, and that no message role can reach it.
 *
 * Fixtures: F1 (Sidebar.svelte and ShellSidebar.svelte, phone and wide) and F7 (Sidebar.svelte as the legacy rail: the direct button
 * and both hamburger positions). No `.svelte` file of either chain is mocked; the mocks set state (stores, the shell switch) and stand
 * in for siblings the chains do not contain. escapeWalk.<screen>.svelte.test.ts files carry the other fixtures of ESCAPE_FIXTURE_SITES.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS } from './engine'
import { escapeWalkViolations } from './fixtures/criticalClosure'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { menuSideBar: false, hamburgerButtonBottom: false, characters: [] } as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((value) => { selIdState.selId = value })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        CharEmotion: writable({}),
        OpenRealmStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        MobileGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable(true),
        PlaygroundStore: writable(0),
        bookmarkListOpen: writable(false),
        QuickSettings: { open: false },
        additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ sideBarSize: 0 })),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/ts/chatShell/shellSwitch.svelte', () => {
    const flag = $state({ eligible: true })
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null), changeChar: vi.fn(), exportAllChats: vi.fn(), importChat: vi.fn(), createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertNormal: vi.fn(), alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))

// Siblings that neither chain contains.
vi.mock('src/lib/SideBars/SidebarRail.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/QuickSettingsGUI.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI } from 'src/ts/stores.svelte'
import * as shellSwitchModule from 'src/ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { panelFollowView } from 'src/lib/SideBars/panelGestureBinding'
import Sidebar from 'src/lib/SideBars/Sidebar.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag
const allowed = new Set<string>([...ESCAPE_ANCESTORS, ...CRITICAL_PARTS])

let mounted: Array<Record<string, unknown>> = []
let container: HTMLElement

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function mountSidebar(): void {
    mounted.push(mount(Sidebar, { target: container }))
    flushSync()
}

/** Holds the elements named `name` to the walk's rules: every part above is listed or critical, no message role reaches them. */
function escapeElements(name: string, expected: { count: number, marked: boolean }): void {
    expect(escapeWalkViolations(container, name, expected, allowed)).toEqual([])
}

beforeEach(() => {
    setViewport(400)
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    DBState.db.hamburgerButtonBottom = false
    DynamicGUI.set(true)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    container = document.createElement('div')
    document.body.append(container)
})

afterEach(() => {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    container.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('F1 the chat shell sidebar', () => {
    test('phone (overlay): the settings button is a marked escape element', () => {
        setViewport(400)
        DynamicGUI.set(true)
        mountSidebar()
        escapeElements('sidebar-settings', { count: 1, marked: true })
    })

    test('wide (docked): the settings button is a marked escape element', () => {
        setViewport(1000)
        DynamicGUI.set(false)
        mountSidebar()
        escapeElements('sidebar-settings', { count: 1, marked: true })
    })
})

describe('F7 the legacy rail', () => {
    const openHamburger = (): void => {
        container.querySelector<HTMLButtonElement>(`button[aria-label="${language.menu}"]`)?.click()
        flushSync()
    }

    for (const [label, width] of [['phone', 400], ['wide', 1000]] as const) {
        test(`${label}: the direct rail button is a marked escape element`, () => {
            setViewport(width)
            shellFlag.eligible = false
            DBState.db.menuSideBar = true
            mountSidebar()
            escapeElements('rail-settings', { count: 1, marked: true })
        })

        test(`${label}: the hamburger entry at the top is wrapped, not marked`, () => {
            setViewport(width)
            shellFlag.eligible = false
            DBState.db.hamburgerButtonBottom = false
            mountSidebar()
            openHamburger()
            escapeElements('rail-settings', { count: 1, marked: false })
        })

        test(`${label}: the hamburger entry at the bottom is wrapped, not marked`, () => {
            setViewport(width)
            shellFlag.eligible = false
            DBState.db.hamburgerButtonBottom = true
            mountSidebar()
            openHamburger()
            escapeElements('rail-settings', { count: 1, marked: false })
        })
    }
})

describe('the walk helper sees what it is meant to forbid', () => {
    const verdict = (html: string, expected: { count: number, marked: boolean } = { count: 1, marked: true }): string[] => {
        container.innerHTML = html
        return escapeWalkViolations(container, 'escape', expected, new Set(['listed']))
    }

    test('a listed ancestor and a marked element pass', () => {
        expect(verdict('<section data-part="listed"><button data-part="escape" data-part-critical></button></section>')).toEqual([])
    })

    test('an unlisted part above, a missing marker and a wrong count are reported', () => {
        expect(verdict('<section data-part="other"><button data-part="escape"></button></section>')).toEqual([
            'escape: no data-part-critical',
            'escape: parts above that are neither in ESCAPE_ANCESTORS nor critical: other',
        ])
        expect(verdict('<p></p>')).toEqual(['escape: 0 elements, expected 1'])
    })

    test('a message-role ancestor and a message-role previous sibling of the element or of an ancestor are reported', () => {
        expect(verdict('<article data-role="user"><button data-part="escape" data-part-critical></button></article>')).toEqual(['escape: a message-role ancestor'])
        expect(verdict('<button data-part="escape" data-part-critical></button>'.replace('<button', '<article data-role="system"></article><button'))).toEqual(['escape: a message-role previous sibling'])
        expect(verdict('<article data-role="user"></article><section data-part="listed"><button data-part="escape" data-part-critical></button></section>')).toEqual(['escape: a message-role previous sibling'])
    })
})