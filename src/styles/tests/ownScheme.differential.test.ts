// @vitest-environment jsdom
/**
 * The own-scheme islands against a hostile applied pack (stage B-5): isolation, fidelity and inertness, for all five hosts
 * (the Home drawer's Settings wrapper, the chat shell sidebar's and the legacy rail's Settings buttons, the This-chat sheet's
 * All settings button and the failed-send card). The real components are mounted, the real compiled app CSS and the real
 * committed pack sheet are read through the cascade model, and the scheme is painted by the real `updateColorScheme` for a
 * stored pack scheme whose text fails the contrast floor (textcolor2 #888888 on bgcolor #333333, 3.56:1). The pack sheet
 * comes from the real producer: `judgeAreaSheet`, `buildAppliedText` and `commitPackSheet` with the real gate.
 *
 * Compatibility guard for the islands' own rules: every case passes with the islands as built and fails when one rule is
 * broken (a mirrored token block dropped, the pack-base block mirrored, the shape reset dropped, the universal font rule
 * removed). The Home drawer reproducer lives in ownScheme.hosts.svelte.test.ts. The model is not a browser.
 * MOCKED: the stores, the database accessor, alerts and the shell switch; no `.svelte` file of a host chain is mocked.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { compile as compileSvelte } from 'svelte/compiler'
import postcss from 'postcss'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { CascadeModel, classCandidates, appSheetsInOrder, compileRules, readRepoFile, withPackElement, type ModelEnv, type ModelSheet } from './cascadeModel'

const h = vi.hoisted(() => ({
    getDb: (() => ({})) as () => object,
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = { db: {} as Record<string, unknown> }
    const selectedCharID = writable(-1)
    const selIdState = { selId: -1 }
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
        hypaV3ModalOpen: writable(false),
        QuickSettings: { open: false },
        additionalHamburgerMenu: [],
        additionalChatMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.getDb()),
    setDatabase: vi.fn(),
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    appVer: '1',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/ts/chatShell/shellSwitch.svelte', () => {
    const flag = { eligible: true }
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    changeChatTo: vi.fn(), downloadFile: vi.fn(), getVersionString: vi.fn(() => 'test'), openURL: vi.fn(),
    aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null), changeChar: vi.fn(), exportAllChats: vi.fn(), importChat: vi.fn(), createNewChat: vi.fn(),
    removeChatConfirmed: vi.fn(), exportChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertNormal: vi.fn(), alertError: vi.fn(), showHypaV2Alert: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({ getPageStorageMode: vi.fn(() => ({ kind: 'store2' })) }) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
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
import { DBState, DynamicGUI } from 'src/ts/stores.svelte'
import * as shellSwitchModule from 'src/ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { panelFollowView } from 'src/lib/SideBars/panelGestureBinding'
import { ownColours, resetOwnColoursForTests } from 'src/ts/themePack/ownColours.svelte'
import { buildAppliedText, commitPackSheet, resetPackSheetForTests } from 'src/ts/themePack/apply'
import { chatCommitInput } from 'src/ts/themePack/fixtures/packCommit'
import { judgeAreaSheet } from 'src/ts/themePack/index'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from 'src/ts/themePack/surfaceGate.svelte'
import HomeDrawer from 'src/lib/UI/Home/HomeDrawer.svelte'
import Sidebar from 'src/lib/SideBars/Sidebar.svelte'
import SendFailureCard from 'src/lib/ChatShell/SendFailureCard.svelte'
import ThisChatSheet from 'src/lib/ChatShell/ThisChatSheet.svelte'

h.getDb = () => DBState.db

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

/** A stored pack scheme that fails the contrast floor: textcolor2 #888888 on bgcolor #333333 = 3.56:1. */
const F1: ColorScheme = { ...defaultColorScheme, bgcolor: '#333333', darkbg: '#333333', textcolor: '#f0f0f0', textcolor2: '#888888', type: 'dark' }

const HOST_SOURCES = [
    'src/lib/UI/Home/HomeDrawer.svelte',
    'src/lib/SideBars/Sidebar.svelte',
    'src/lib/ChatShell/sidebar/ShellSidebar.svelte',
    'src/lib/ChatShell/SendFailureCard.svelte',
    'src/lib/ChatShell/ThisChatSheet.svelte',
]

// Parts an applied pack may style that sit above a host in the real app; the test wraps every host in this chain.
const WRAPPER_PARTS = ['chat-shell', 'chat-sidebar-footer']

// The shape tokens a pack could try to carry into a host (the radius and hairline scale, MC-3128).
const SHAPE_TOKENS: Record<string, string> = { '--ui-radius-xs': '0px', '--ui-radius-sm': '1px', '--ui-radius-md': '2px', '--ui-radius-lg': '3px', '--ui-radius-xl': '4px', '--ui-radius': '0px', '--ui-border-width': '2px' }
const HOSTILE_COLOUR_TOKENS: Record<string, string> = { '--nexus-text': '#ffe9a8', '--nexus-canvas': '#1a1a2e' }

let appSheets: ModelSheet[]
let mounted: Array<Record<string, unknown>> = []
let container: HTMLElement
let ancestorPartsCache: string[] | null = null

beforeAll(async () => {
    appSheets = await appSheetsInOrder(classCandidates(...HOST_SOURCES.map(readRepoFile), 'flex bg-bg w-full h-full text-textcolor bg-darkbg'))
    // Token files with root-state twins (rm, low power, lang=ko) that the chat shell's own imports do not load.
    for (const file of ['studio-tokens', 'home-tokens']) appSheets.push({ name: file, css: readRepoFile(`src/styles/${file}.css`) })
}, 120000)

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

/** Paints the scheme the way the app does: `pack` stores F1 as the applied pack scheme, otherwise the default scheme. */
function paintScheme(pack: boolean): void {
    for (const key of Object.keys(DBState.db)) delete DBState.db[key]
    Object.assign(DBState.db, {
        colorSchemeName: pack ? PACK_SCHEME_NAME : 'default',
        colorScheme: structuredClone(pack ? F1 : defaultColorScheme),
        menuSideBar: false,
        hamburgerButtonBottom: false,
        characters: [],
        sideBarSize: 0,
        username: 'User', personas: [], selectedPersona: 0, jailbreak: '', jailbreakToggle: false, promptTemplate: undefined,
        supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: false, hypaMemory: false, showMenuHypaMemoryModal: false,
        customPromptTemplateToggle: '', globalChatVariables: {},
    })
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

function resetRoot(): void {
    const root = document.documentElement
    root.removeAttribute('style')
    root.removeAttribute('class')
    root.removeAttribute('data-input')
    root.removeAttribute('lang')
    root.removeAttribute('data-theme-pack-base')
}

function clearMounted(): void {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    container.innerHTML = ''
    resetOwnColoursForTests()
}

beforeEach(() => {
    setViewport(400)
    shellFlag.eligible = true
    DynamicGUI.set(true)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    resetOwnColoursForTests()
    resetRoot()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
    let tail: HTMLElement = document.createElement('main')
    document.body.append(tail)
    for (const part of WRAPPER_PARTS) {
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-part', part)
        tail.append(wrapper)
        tail = wrapper
    }
    container = tail
    installThemePackGate(() => false)
    declareSurface('chat')
})

afterEach(() => {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    resetBackHandlersForTests()
    resetOwnColoursForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    resetRoot()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

async function mountHost(component: Parameters<typeof mount>[0], props?: Record<string, unknown>): Promise<void> {
    mounted.push(mount(component, { target: container, props }) as unknown as Record<string, unknown>)
    flushSync()
    await tick()
}

interface Host {
    name: string
    build: () => Promise<HTMLElement>
    /** Component CSS that the scoped styles of this host add. */
    sheets?: (el: HTMLElement) => ModelSheet[]
}

function cardSheet(el: HTMLElement): ModelSheet {
    const scope = [...el.classList].find((name) => name.startsWith('svelte-'))
    if (scope === undefined) throw new Error('the mounted card has no scope class')
    const file = 'src/lib/ChatShell/SendFailureCard.svelte'
    return { name: 'SendFailureCard', css: compileSvelte(readRepoFile(file), { filename: file, css: 'external', cssHash: () => scope }).css?.code ?? '' }
}

const view = { open: true }

// The All settings button sets no colour of its own and reads the text colour its sheet hands down; the model has no scoped CSS of the sheet.
const APP_TEXT: ModelSheet = { name: 'sheet-text', css: '[data-part="chat-sidebar-footer"] { color: var(--risu-theme-textcolor) }' }

const HOSTS: Host[] = [
    {
        name: 'the Home drawer Settings wrapper',
        build: async () => {
            await mountHost(HomeDrawer, { id: 'drawer', trigger: null, onclose: () => {} })
            return container.querySelector<HTMLElement>('[data-part="home-drawer-settings"]')!.parentElement!
        },
    },
    {
        name: 'the chat shell sidebar Settings button',
        build: async () => {
            await mountHost(Sidebar)
            return container.querySelector<HTMLElement>('[data-part="sidebar-settings"]')!
        },
    },
    {
        name: 'the legacy rail Settings button',
        build: async () => {
            shellFlag.eligible = false
            DBState.db.menuSideBar = true
            flushSync()
            await mountHost(Sidebar)
            return container.querySelector<HTMLElement>('[data-part="rail-settings"]')!
        },
    },
    {
        name: 'the This-chat sheet All settings button',
        build: async () => {
            const chat = { message: [], note: '', name: 'Harbour night', localLore: [], id: 'chat-1' }
            const owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat], supaMemory: false }
            view.open = true
            const opener = document.createElement('button')
            document.body.append(opener)
            await mountHost(ThisChatSheet, {
                get open() { return view.open },
                opener,
                background: [],
                target: { owner, chat },
                confirmDelete: async () => true,
                onpersona: () => {},
                onmodules: () => {},
                onremoved: () => {},
                onclose: () => {},
            })
            return document.querySelector<HTMLElement>('[data-part="this-chat-all-settings"]')!
        },
        sheets: () => [APP_TEXT],
    },
    {
        name: 'the failed-send card',
        build: async () => {
            await mountHost(SendFailureCard, { failure: { reason: 'key', fix: 'botSettings', action: 'send' }, onfix: () => {}, onretry: () => {} })
            return container.querySelector<HTMLElement>('[data-part="chat-failed-card"]')!
        },
        sheets: (el) => [cardSheet(el)],
    },
]

// ---- the hostile pack

/** Every `data-part` value above the host, from the document root down to the host's parent. */
function partsAbove(host: Element): string[] {
    const found: string[] = []
    for (let node = host.parentElement; node; node = node.parentElement) {
        const part = node.getAttribute('data-part')
        if (part !== null) found.push(part)
    }
    return found
}

/** The ancestor parts of every host, read from the mounted DOM once. */
async function ancestorParts(): Promise<string[]> {
    if (ancestorPartsCache !== null) return ancestorPartsCache
    paintScheme(false)
    const found = new Set<string>()
    for (const host of HOSTS) {
        const el = await host.build()
        for (const part of partsAbove(el)) found.add(part)
        clearMounted()
        shellFlag.eligible = true
    }
    // A chat stylesheet may name only parts of the chat screen: the Home drawer's own parts are not packable.
    ancestorPartsCache = [...found].filter((part) => !part.startsWith('home-')).sort()
    return ancestorPartsCache
}

/**
 * One rule per ancestor part reaching every colour-bearing and font property a pack may declare on a part that is not a
 * host, plus, on the root where a pack may set tokens, the colour and shape tokens that a host would inherit.
 */
function hostileSheet(parts: readonly string[]): string {
    const tokens = Object.entries({ ...HOSTILE_COLOUR_TOKENS, ...SHAPE_TOKENS }).map(([name, value]) => `${name}: ${value};`).join(' ')
    return parts.map((part) => `[data-part="${part}"] {
  color: #ffe9a8 !important; background-color: #1a1a2e !important; background-image: linear-gradient(#1a1a2e, #16213e) !important;
  border-color: #ffd166; box-shadow: inset 0 0 0 2px #16213e; text-shadow: 1px 1px #1a1a2e;
  caret-color: #ffd166; accent-color: #ffd166;
  font-family: papyrus, fantasy; font-weight: 100; font-style: italic; text-decoration: underline 3px #ffd166;
}`).join('\n') + `\n:root { ${tokens} }`
}

async function commitHostile(): Promise<void> {
    const judged = judgeAreaSheet('chat', hostileSheet(await ancestorParts()), undefined, 'chat')
    expect(judged.result.ok).toBe(true)
    expect(commitPackSheet(chatCommitInput(buildAppliedText(judged, () => '')))).toEqual({ ok: true })
}

const packElement = (): HTMLStyleElement | null => document.querySelector<HTMLStyleElement>('style[data-theme-pack]')

// ---- reading helpers

function rulesOf(sheets: readonly ModelSheet[]): ReturnType<typeof compileRules> {
    return compileRules([...sheets])
}

/** Every painted reading below the host plus the host's own text colour; the host's backdrop is the island's own addition. */
function subtreeReading(model: CascadeModel, host: Element): Record<string, Record<string, string> | string> {
    const out: Record<string, Record<string, string> | string> = { host: model.painted(host).color }
    host.querySelectorAll('*').forEach((el, index) => { out[`${index}:${el.tagName.toLowerCase()}`] = model.painted(el) })
    return out
}

function subtree(host: Element): Element[] {
    return [host, ...host.querySelectorAll('*')]
}

function stripIslandSelectors(sheets: readonly ModelSheet[]): ModelSheet[] {
    return sheets.map((sheet) => {
        const root = postcss.parse(sheet.css)
        root.walkRules((rule) => {
            const kept = rule.selectors.filter((selector) => !selector.includes('data-own-scheme'))
            if (kept.length === 0) rule.remove()
            else rule.selectors = kept
        })
        return { name: sheet.name, css: root.toString() }
    })
}

/** The custom property names the token files, the compiled theme and the root's inline style declare. */
function rootTokenNames(): string[] {
    const names = new Set<string>()
    for (const sheet of appSheets) {
        postcss.parse(sheet.css).walkDecls((decl) => { if (decl.prop.startsWith('--')) names.add(decl.prop) })
    }
    const style = document.documentElement.style
    for (let i = 0; i < style.length; i++) if (style[i].startsWith('--')) names.add(style[i])
    return [...names].sort()
}

/** The winning font-family of an element (var() substituted), or undefined when no rule declares it. */
function fontFamilyOf(model: CascadeModel, el: Element): string | undefined {
    return model.prop(el, 'font-family')
}

/**
 * The value an ancestor outside `host` hands to host elements that declare `property` nowhere on the way up to the host:
 * the closest declaration above the host, one entry per such element.
 */
function inheritedFromAbove(model: CascadeModel, host: Element, property: string): string[] {
    const declaredAt = (node: Element): string | undefined => {
        const value = model.prop(node, property)
        return value === undefined || ['inherit', 'unset', 'initial'].includes(value.trim()) ? undefined : value
    }
    const out: string[] = []
    for (const el of subtree(host)) {
        let own = false
        for (let node: Element | null = el; node; node = node === host ? null : node.parentElement) {
            if (declaredAt(node) !== undefined) { own = true; break }
        }
        if (own) continue
        for (let above = host.parentElement; above; above = above.parentElement) {
            const value = declaredAt(above)
            if (value !== undefined) { out.push(value); break }
        }
    }
    return out
}

/** The model of the pack run: the app sheets plus the committed pack element. */
function packModel(host: HTMLElement, extra: ModelSheet[], env: ModelEnv = {}): CascadeModel {
    return new CascadeModel(rulesOf([...withPackElement(appSheets, packElement()), ...extra]), { ...env, important: true })
}

function baseModel(extra: ModelSheet[], env: ModelEnv = {}): CascadeModel {
    return new CascadeModel(rulesOf([...appSheets, ...extra]), { ...env, important: true })
}

/**
 * Builds one host with no pack (and the default scheme) and reads `read` from it, then rebuilds it under the committed
 * hostile pack with F1 painted and reads the same thing.
 */
async function bothRuns<T>(host: Host, read: (model: CascadeModel, el: HTMLElement, root: HTMLElement) => T, env: (el: HTMLElement) => ModelEnv = () => ({})): Promise<{ base: T, pack: T, el: HTMLElement, model: CascadeModel }> {
    paintScheme(false)
    const baseEl = await host.build()
    const base = read(baseModel(host.sheets?.(baseEl) ?? [], env(baseEl)), baseEl, document.documentElement)
    clearMounted()
    shellFlag.eligible = true
    resetRoot()
    await commitHostile()
    paintScheme(true)
    const el = await host.build()
    const model = packModel(el, host.sheets?.(el) ?? [], env(el))
    return { base, pack: read(model, el, document.documentElement), el, model }
}

describe('the hostile pack reaches the ancestors, and only them', () => {
    test('every wrapper part carries the pack values, the pack is on the document and the own scheme is on', async () => {
        const parts = await ancestorParts()
        expect(parts).toEqual(expect.arrayContaining(WRAPPER_PARTS))
        await commitHostile()
        paintScheme(true)
        expect(ownColours.on).toBe(true)
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(true)
        const el = await HOSTS[0].build()
        const model = packModel(el, [])
        for (const part of WRAPPER_PARTS) {
            const wrapper = document.querySelector<HTMLElement>(`[data-part="${part}"]`)!
            expect(model.painted(wrapper).color).toBe('#ffe9a8ff')
            expect(fontFamilyOf(model, wrapper)).toContain('papyrus')
            expect(model.custom(wrapper, '--ui-radius')).toBe('0px')
            expect(model.custom(document.documentElement, '--nexus-text')).toBe('#ffe9a8')
        }
    })
})

describe.each(HOSTS)('isolation: $name', (host) => {
    test('every painted property of the subtree equals the no-pack run, for the plain and the hovered host', async () => {
        for (const hovered of [false, true]) {
            const { base, pack, el } = await bothRuns(host, (model, node) => subtreeReading(model, node), (node) => hovered ? { hovered: node, hoverMedia: true } : {})
            expect(el.closest('[data-own-scheme]')).not.toBeNull()
            expect(pack).toEqual(base)
            clearMounted()
            resetPackSheetForTests()
            resetRoot()
        }
    })

    test('every element of the subtree resolves the app font, whatever the ancestors declare', async () => {
        const { pack, base } = await bothRuns(host, (model, node, root) => ({
            root: model.custom(root, '--risu-font-family'),
            fonts: subtree(node).map((el) => fontFamilyOf(model, el)),
            shorthand: subtree(node).map((el) => model.prop(el, 'font')),
        }))
        expect(pack.root).toBeDefined()
        expect(pack.fonts.length).toBeGreaterThan(0)
        for (const font of pack.fonts) expect(font).toBe(pack.root)
        // The font rule is the app's own, so the no-pack run gives the very same fonts.
        expect(pack.fonts).toEqual(base.fonts)
        // A `font` shorthand that is not an inherit would reset the family behind the universal rule's back.
        for (const value of pack.shorthand) expect(value === undefined || /^\s*inherit\s*$/.test(value)).toBe(true)
    })

    test('known limits: the ancestors\' italic, weight 100 and 3px text-decoration stay the exact expected text', async () => {
        const { pack } = await bothRuns(host, (model, node) => ({
            style: inheritedFromAbove(model, node, 'font-style'),
            weight: inheritedFromAbove(model, node, 'font-weight'),
            decoration: inheritedFromAbove(model, node, 'text-decoration'),
        }))
        for (const value of pack.style) expect(value).toBe('italic')
        for (const value of pack.weight) expect(value).toBe('100')
        for (const value of pack.decoration) expect(value).toBe('underline 3px #ffd166')
        // At least the host itself reads the ancestors' values: the island does not reset them (L1, L2).
        expect(pack.style.length).toBeGreaterThan(0)
        expect(pack.weight.length).toBeGreaterThan(0)
        expect(pack.decoration.length).toBeGreaterThan(0)
    })
})

interface Env {
    name: string
    apply: () => void
    model: ModelEnv
    /** A name that this environment changes at the root, so the comparison is not vacuous. */
    moves: string
}

const ENVIRONMENTS: Env[] = [
    { name: 'html.rm', apply: () => document.documentElement.classList.add('rm'), model: {}, moves: '--studio-dur-base' },
    { name: 'html.nexus-low-power', apply: () => document.documentElement.classList.add('nexus-low-power'), model: {}, moves: '--studio-dur-base' },
    { name: 'data-input=hover', apply: () => document.documentElement.setAttribute('data-input', 'hover'), model: {}, moves: '--pattern-warn-action-height' },
    { name: 'lang=ko', apply: () => document.documentElement.setAttribute('lang', 'ko'), model: {}, moves: '--home-leading-body' },
    { name: 'prefers-reduced-motion', apply: () => {}, model: { reducedMotion: true }, moves: '--studio-dur-base' },
]

describe('fidelity: every root token inside a host equals its no-pack value under the root states', () => {
    test.each(ENVIRONMENTS)('$name', async (environment) => {
        const names = new Set<string>()
        let compared = Infinity
        for (const host of HOSTS) {
            paintScheme(false)
            environment.apply()
            const baseEl = await host.build()
            for (const name of rootTokenNames()) names.add(name)
            const baseModelNow = baseModel(host.sheets?.(baseEl) ?? [], environment.model)
            const tokenNames = [...names]
            const base = tokenNames.map((name) => baseModelNow.custom(document.documentElement, name))
            clearMounted()
            shellFlag.eligible = true
            resetRoot()
            await commitHostile()
            environment.apply()
            paintScheme(true)
            const el = await host.build()
            const model = packModel(el, host.sheets?.(el) ?? [], environment.model)
            const pack = tokenNames.map((name) => model.custom(el, name))
            // The model reads the Tailwind @theme blocks (:root, :host) as nothing at the root; those names are TB-6's.
            const different = tokenNames.filter((_, i) => base[i] !== undefined && base[i] !== pack[i])
            compared = Math.min(compared, base.filter((value) => value !== undefined).length)
            expect(different, `${host.name}: ${different.map((n) => `${n} base=${base[tokenNames.indexOf(n)]} pack=${pack[tokenNames.indexOf(n)]}`).join('; ')}`).toEqual([])
            clearMounted()
            resetPackSheetForTests()
            resetRoot()
        }
        expect(names.size).toBeGreaterThan(150)
        expect(compared).toBeGreaterThan(150)
        {
            // The state really changes the root: the comparison above is not between two defaults.
            paintScheme(false)
            const plain = baseModel([]).custom(document.documentElement, environment.moves)
            environment.apply()
            const moved = baseModel([], environment.model).custom(document.documentElement, environment.moves)
            expect(moved).not.toBe(plain)
        }
    })
})

describe('inertness: without the own colours the island rules change nothing', () => {
    test.each(HOSTS)('$name: no island, and the CSS with every [data-own-scheme] selector stripped paints the same', async (host) => {
        await commitHostile()
        paintScheme(false)
        const el = await host.build()
        expect(ownColours.on).toBe(false)
        expect(document.querySelector('[data-own-scheme]')).toBeNull()
        expect(el.getAttribute('style')?.includes('--risu-theme-') ?? false).toBe(false)
        const extra = host.sheets?.(el) ?? []
        const sheets = [...withPackElement(appSheets, packElement()), ...extra]
        const names = rootTokenNames()
        const whole = new CascadeModel(rulesOf(sheets), { important: true })
        const stripped = new CascadeModel(rulesOf(stripIslandSelectors(sheets)), { important: true })
        expect(subtreeReading(whole, el)).toEqual(subtreeReading(stripped, el))
        expect(names.map((name) => whole.custom(el, name))).toEqual(names.map((name) => stripped.custom(el, name)))
    })

    test('the stripped sheet is not the same sheet: with the own colours on the readings differ', async () => {
        await commitHostile()
        paintScheme(true)
        const el = await HOSTS[0].build()
        const sheets = withPackElement(appSheets, packElement())
        const whole = new CascadeModel(rulesOf(sheets), { important: true })
        const stripped = new CascadeModel(rulesOf(stripIslandSelectors(sheets)), { important: true })
        expect(subtreeReading(whole, el)).not.toEqual(subtreeReading(stripped, el))
    })
})
