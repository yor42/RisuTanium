// @vitest-environment jsdom
/**
 * The own-scheme island on its hosts (stage B-3): the Home drawer's Settings item, the chat shell sidebar's and the legacy
 * rail's Settings buttons, and the failed-send card. The real components are mounted, the real compiled app CSS is read through
 * the cascade model, and the scheme is painted by the real `updateColorScheme` for a stored pack scheme whose text fails the
 * contrast floor (textcolor2 #888888 on bgcolor #333333, 3.56:1).
 *
 * Regression reproducer: the Home drawer's Settings item. Without the island it paints the pack's #888888 on #333333; with it
 * the item reads the own scheme and reaches 4.5:1. The other cases are compatibility guards for the new island behaviour: each
 * host's painted subtree under the failing pack equals the same subtree with no pack. The model is not a browser.
 * MOCKED: the stores, the database accessor, alerts and the shell switch; no `.svelte` file of a host chain is mocked.
 */
import { flushSync, mount, unmount } from 'svelte'
import { compile as compileSvelte } from 'svelte/compiler'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { CascadeModel, classCandidates, appSheetsInOrder, compileRules, compositeHex, readRepoFile, type ModelSheet, type RuleSet } from './cascadeModel'

const h = vi.hoisted(() => ({
    getDb: (() => ({})) as () => object,
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((value) => { selIdState.selId = value })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        loadedStore: writable(false),
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
    getDatabase: vi.fn(() => h.getDb()),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/ts/chatShell/shellSwitch.svelte', () => {
    const flag = $state({ eligible: true })
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: vi.fn(), downloadFile: vi.fn(), getVersionString: vi.fn(() => 'test'), openURL: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null), changeChar: vi.fn(), exportAllChats: vi.fn(), importChat: vi.fn(), createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertNormal: vi.fn(), alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({ getPageStorageMode: vi.fn(() => ({ kind: 'store2' })) }) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ isBusy: vi.fn(() => false) }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({ restoreInProgress: vi.fn(() => false) }) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: vi.fn(), registerPackRequestCanceller: vi.fn() }))
vi.mock('src/lib/UI/Home/homeView.svelte', () => ({ openHomeLibrary: vi.fn(), showHomeLanding: vi.fn() }))

// Siblings that none of the host chains contain.
vi.mock('src/lib/SideBars/SidebarRail.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/QuickSettingsGUI.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { defaultColorScheme, PACK_SCHEME_NAME, updateColorScheme, type ColorScheme } from 'src/ts/gui/colorscheme'
import { DBState } from 'src/ts/stores.svelte'
import * as shellSwitchModule from 'src/ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { panelFollowView } from 'src/lib/SideBars/panelGestureBinding'
import { resetOwnColoursForTests } from 'src/ts/themePack/ownColours.svelte'
import { DynamicGUI } from 'src/ts/stores.svelte'
import HomeDrawer from 'src/lib/UI/Home/HomeDrawer.svelte'
import Sidebar from 'src/lib/SideBars/Sidebar.svelte'
import SendFailureCard from 'src/lib/ChatShell/SendFailureCard.svelte'

h.getDb = () => DBState.db

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

/** A stored pack scheme that fails the contrast floor: textcolor2 #888888 on bgcolor #333333 = 3.56:1. */
const F1: ColorScheme = { ...defaultColorScheme, bgcolor: '#333333', darkbg: '#333333', textcolor: '#f0f0f0', textcolor2: '#888888', type: 'dark' }

const HOST_SOURCES = [
    'src/lib/UI/Home/HomeDrawer.svelte',
    'src/lib/SideBars/Sidebar.svelte',
    'src/lib/ChatShell/sidebar/ShellSidebar.svelte',
    'src/lib/ChatShell/SendFailureCard.svelte',
]

let appSheets: ModelSheet[]
let mounted: Array<Record<string, unknown>> = []
let container: HTMLElement

beforeAll(async () => {
    appSheets = await appSheetsInOrder(classCandidates(...HOST_SOURCES.map(readRepoFile), 'flex bg-bg w-full h-full text-textcolor bg-darkbg'))
}, 120000)

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

/** Paints the scheme the way the app does: `pack` stores F1 as the applied pack scheme, otherwise no pack is applied. */
function paintScheme(pack: boolean): void {
    for (const key of Object.keys(DBState.db)) delete DBState.db[key]
    Object.assign(DBState.db, {
        colorSchemeName: pack ? PACK_SCHEME_NAME : 'default',
        colorScheme: structuredClone(pack ? F1 : defaultColorScheme),
        menuSideBar: false,
        hamburgerButtonBottom: false,
        characters: [],
        sideBarSize: 0,
    })
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

beforeEach(() => {
    setViewport(400)
    shellFlag.eligible = true
    DynamicGUI.set(true)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    resetOwnColoursForTests()
    container = document.createElement('main')
    document.body.append(container)
})

afterEach(() => {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    container.remove()
    resetBackHandlersForTests()
    resetOwnColoursForTests()
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
})

function mountHost(component: Parameters<typeof mount>[0], props?: Record<string, unknown>): void {
    mounted.push(mount(component, { target: container, props }) as unknown as Record<string, unknown>)
    flushSync()
}

function drawer(): HTMLElement {
    mountHost(HomeDrawer, { id: 'drawer', trigger: null, onclose: () => {} })
    return container.querySelector<HTMLElement>('[data-part="home-drawer-settings"]')!
}

function railOrShell(part: string): HTMLElement {
    mountHost(Sidebar)
    return container.querySelector<HTMLElement>(`[data-part="${part}"]`)!
}

function card(): HTMLElement {
    mountHost(SendFailureCard, { failure: { reason: 'key', fix: 'botSettings', action: 'send' }, onfix: () => {}, onretry: () => {} })
    return container.querySelector<HTMLElement>('[data-part="chat-failed-card"]')!
}

/** The card's scoped sheet, compiled with the scope class the mounted card carries. */
function cardSheet(el: HTMLElement): ModelSheet {
    const scope = [...el.classList].find((name) => name.startsWith('svelte-'))
    if (scope === undefined) throw new Error('the mounted card has no scope class')
    const file = 'src/lib/ChatShell/SendFailureCard.svelte'
    return { name: 'SendFailureCard', css: compileSvelte(readRepoFile(file), { filename: file, css: 'external', cssHash: () => scope }).css?.code ?? '' }
}

function rulesOf(...extra: ModelSheet[]): RuleSet {
    return compileRules([...appSheets, ...extra])
}

function luminance(hex: string): number {
    const channel = (offset: number) => {
        const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** The opaque colour an element sits on: its own and its ancestors' background colours composited down to the first opaque one. */
function backdrop(model: CascadeModel, el: Element): string {
    const layers: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = model.painted(node)['background-color']
        if (bg === undefined) continue
        layers.push(bg)
        if (bg.length === 9 && bg.endsWith('ff')) break
    }
    let out = '#000000'
    for (const layer of layers.reverse()) out = compositeHex(layer, out)
    return out
}

/** Every painted reading below the host plus the host's own text colour; a host's backdrop is the island's own addition. */
function subtreeReading(model: CascadeModel, host: Element): Record<string, Record<string, string> | string> {
    const out: Record<string, Record<string, string> | string> = { host: model.painted(host).color }
    host.querySelectorAll('*').forEach((el, index) => { out[`${index}:${el.tagName.toLowerCase()}`] = model.painted(el) })
    return out
}

describe('inert without a failing pack', () => {
    test('no host carries the island with no pack applied', () => {
        paintScheme(false)
        const button = drawer()
        const rail = railOrShell('sidebar-settings')
        const failed = card()
        for (const el of [button.parentElement!, rail, failed]) {
            expect(el.hasAttribute('data-own-scheme')).toBe(false)
            expect(el.getAttribute('style')?.includes('--risu-theme-') ?? false).toBe(false)
        }
    })
})

describe('the island is on the right element', () => {
    test('the Home drawer: the new wrapper around the Settings button, not the button', () => {
        paintScheme(true)
        const button = drawer()
        const wrapper = button.parentElement!
        expect(wrapper.getAttribute('data-own-scheme')).toBe('escape')
        expect(wrapper.hasAttribute('data-part')).toBe(false)
        expect(wrapper.children).toHaveLength(1)
        expect(button.hasAttribute('data-own-scheme')).toBe(false)
    })

    test('the chat shell sidebar: the Settings button', () => {
        paintScheme(true)
        expect(railOrShell('sidebar-settings').getAttribute('data-own-scheme')).toBe('escape')
    })

    test('the legacy rail: the Settings button', () => {
        shellFlag.eligible = false
        paintScheme(true)
        DBState.db.menuSideBar = true
        flushSync()
        expect(railOrShell('rail-settings').getAttribute('data-own-scheme')).toBe('escape')
    })

    test('the failed-send card: the card root, as a prompt', () => {
        paintScheme(true)
        expect(card().getAttribute('data-own-scheme')).toBe('prompt')
    })
})

describe('regression: the Home drawer Settings item under a failing pack', () => {
    test('it reads the own scheme and reaches 4.5:1; the pack value would be 3.56:1', () => {
        paintScheme(true)
        const button = drawer()
        const model = new CascadeModel(rulesOf())
        const colour = model.painted(button).color
        const ground = backdrop(model, button)
        expect(contrast(colour.slice(0, 7), ground)).toBeGreaterThanOrEqual(4.5)
        // The pack's own pairing is what the island replaces.
        expect(contrast('#888888', '#333333')).toBeLessThan(4.5)
        expect(colour).not.toBe('#888888ff')
    })
})

describe('isolation: each host paints what it paints with no pack', () => {
    function compare(build: () => HTMLElement, sheets: (el: HTMLElement) => ModelSheet[] = () => []): void {
        paintScheme(false)
        const baseHost = build()
        const baseline = subtreeReading(new CascadeModel(rulesOf(...sheets(baseHost))), baseHost)
        for (const app of mounted) unmount(app)
        mounted = []
        flushSync()
        container.innerHTML = ''
        resetOwnColoursForTests()

        paintScheme(true)
        const host = build()
        const model = new CascadeModel(rulesOf(...sheets(host)))
        const reading = subtreeReading(model, host)
        expect(reading).toEqual(baseline)
        expect(host.closest('[data-own-scheme]')).not.toBeNull()
        // An opaque bottom layer sits at or above the host.
        const ground = backdrop(model, host)
        expect(contrast(model.painted(host).color.slice(0, 7), ground)).toBeGreaterThanOrEqual(4.5)
    }

    test('the Home drawer Settings item', () => compare(drawer))
    test('the chat shell sidebar Settings button', () => compare(() => railOrShell('sidebar-settings')))
    test('the legacy rail Settings button', () => {
        shellFlag.eligible = false
        compare(() => {
            DBState.db.menuSideBar = true
            flushSync()
            return railOrShell('rail-settings')
        })
    })
    test('the failed-send card', () => compare(card, (el) => [cardSheet(el)]))
})

describe('the failed-send card keeps its tint over an opaque own sheet', () => {
    test('the bottom layer is the own sheet colour and the tint gradient is kept', () => {
        paintScheme(true)
        const el = card()
        const model = new CascadeModel(rulesOf(cardSheet(el)))
        const painted = model.painted(el)
        expect(painted['background-color']).toBe(`${defaultColorScheme.bgcolor}ff`)
        expect(painted['background-image']).toContain('linear-gradient')
    })
})
