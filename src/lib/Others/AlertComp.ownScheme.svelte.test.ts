// @vitest-environment jsdom

/**
 * The own-scheme host of the save-guard prompts (#438 S3c-C). `AlertComp.svelte`'s `alertView` snippet puts `use:ownScheme`
 * on the `data-part="pattern-dialog"` panel only, and only for an alert flagged `ownScheme: 'saveGuard'`.
 *
 * The real `AlertComp.svelte` is mounted over a real `writable` standing in for `alertStore`, so what is pinned is the
 * component's own wiring: the attribute on the panel of the right slot (`held` for a prompt, `live` for a notice such as an
 * error), none on an unflagged alert, none on the layer or the scrim, none while the own colours are off.
 *
 * A prompt is held by the component the moment it enters the store, so it renders in the `held` slot; `error` is not a prompt
 * type and renders in the `live` slot. Held and live panels are told apart by the slot id in their `aria-labelledby`.
 *
 * Regression reproducers (they fail on the base, where the panel carries no island): the flagged cases (which also check that the
 * layer and the scrim carry no island), the held/live independence cases, the T2-G1 case and the TB-4 colour and TB-5 readings.
 * Compatibility guards (they pass before and after): the unflagged, own-colours-off, TB-4 font-row and inert cases.
 * The differential reads the real compiled app CSS, the real component CSS and the real committed pack sheet through the cascade
 * model, with the scheme painted by the real `updateColorScheme` for a pack scheme whose text fails the contrast floor
 * (textcolor2 #888888 on bgcolor #333333, 3.56:1). The model is not a browser.
 * MOCKED: the stores, the database accessor and the platform labels; no `.svelte` file of the prompt chain is mocked.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { compile as compileSvelte } from 'svelte/compiler'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { PeerConflictRowView, alertData } from '../../ts/alert'
import { CascadeModel, classCandidates, appSheetsInOrder, compileRules, compositeHex, readRepoFile, withPackElement, type ModelSheet } from '../../styles/tests/cascadeModel'

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
        setDatabase: vi.fn(),
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
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        loadedStore: writable(false),
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

vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: vi.fn(), registerPackRequestCanceller: vi.fn() }))

//#endregion

import { defaultColorScheme, PACK_SCHEME_NAME, updateColorScheme, type ColorScheme } from 'src/ts/gui/colorscheme'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { ownColours, resetOwnColoursForTests } from 'src/ts/themePack/ownColours.svelte'
import { buildAppliedText, commitPackSheet, resetPackSheetForTests } from 'src/ts/themePack/apply'
import { chatCommitInput } from 'src/ts/themePack/fixtures/packCommit'
import { judgeAreaSheet } from 'src/ts/themePack/index'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from 'src/ts/themePack/surfaceGate.svelte'
import AlertComp from './AlertComp.svelte'

const PANEL = '[data-part="pattern-dialog"]'
const OWN_VARS = { '--risu-theme-bgcolor': '#202020', '--risu-theme-textcolor': '#f0f0f0' }

type Slot = 'held' | 'live'

const rows: PeerConflictRowView[] = [
    { id: 'a', label: 'Setting: zoomsize', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: null },
]

/** One flagged alert per `messageDialog` branch the host must cover, with the slot it renders in. */
interface Case { name: string, slot: Slot, make: (flagged: boolean) => alertData }

function guard<T extends alertData>(data: T, flagged: boolean): alertData {
    return flagged ? { ...data, ownScheme: 'saveGuard' } : data
}

const CASES: Case[] = [
    { name: 'select', slot: 'held', make: (f) => guard({ type: 'select', msg: 'one||two' }, f) },
    { name: 'ask', slot: 'held', make: (f) => guard({ type: 'ask', msg: 'Keep it?' }, f) },
    { name: 'peerConflicts', slot: 'held', make: (f) => guard({ type: 'peerConflicts', msg: 'Title', peerConflicts: rows }, f) },
    { name: 'parkedReply', slot: 'held', make: (f) => guard({ type: 'parkedReply', msg: 'Title', parkedReply: { name: 'Ari', text: 'a reply' } }, f) },
    { name: 'error', slot: 'live', make: (f) => guard({ type: 'error', msg: 'Save failed', stackTrace: 'Error: x\n    at y' }, f) },
]

const PROMPTS = CASES.filter((c) => c.slot === 'held')

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function setOwnColours(on: boolean): void {
    ownColours.on = on
    ownColours.vars = on ? { ...OWN_VARS } : {}
}

function show(value: alertData): void {
    alertStore.set(value as never)
    flushSync()
}

function mountAlertComp(into?: HTMLElement): HTMLElement {
    const target = into ?? document.createElement('div')
    if (!into) document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    flushSync()
    return target
}

function panels(target: HTMLElement): HTMLElement[] {
    return [...target.querySelectorAll<HTMLElement>(PANEL)]
}

/** The panel of a slot: the slot id is part of the `aria-labelledby` every panel carries. */
function panelOf(target: HTMLElement, slot: Slot): HTMLElement {
    const found = panels(target).filter((panel) => (panel.getAttribute('aria-labelledby') ?? '').includes(`-${slot}-`))
    expect(found, `the ${slot} panel`).toHaveLength(1)
    return found[0]
}

function hostsIn(target: HTMLElement): HTMLElement[] {
    return [...target.querySelectorAll<HTMLElement>('[data-own-scheme]')]
}

beforeEach(() => {
    DBState.db = { characters: [] } as unknown as Database
    resetOwnColoursForTests()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((target) => target.remove())
    document.body.replaceChildren()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    resetOwnColoursForTests()
    vi.clearAllMocks()
})

describe('the save-guard panel is the own-scheme host', () => {
    test.each(CASES)('$name flagged: the panel of its slot carries data-own-scheme="prompt", and it is the only host', ({ make, slot }) => {
        setOwnColours(true)
        show(make(true))
        const target = mountAlertComp()
        expect(panels(target)).toHaveLength(1)
        const panel = panelOf(target, slot)
        expect(panel.getAttribute('data-own-scheme')).toBe('prompt')
        expect(panel.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#202020')
        // Never the fixed full-viewport layer or its scrim, and nothing else inside the dialog.
        expect(hostsIn(target)).toEqual([panel])
        expect(target.querySelector('[data-part="pattern-layer"]')!.hasAttribute('data-own-scheme')).toBe(false)
        expect(target.querySelector('[data-part="pattern-scrim"]')!.hasAttribute('data-own-scheme')).toBe(false)
    })

    test.each(CASES)('$name unflagged: no attribute and no own properties', ({ make, slot }) => {
        setOwnColours(true)
        show(make(false))
        const target = mountAlertComp()
        const panel = panelOf(target, slot)
        expect(hostsIn(target)).toEqual([])
        expect(panel.style.getPropertyValue('--risu-theme-bgcolor')).toBe('')
    })

    test.each(CASES)('$name flagged with the own colours off: no attribute and no own properties', ({ make, slot }) => {
        setOwnColours(false)
        show(make(true))
        const target = mountAlertComp()
        const panel = panelOf(target, slot)
        expect(hostsIn(target)).toEqual([])
        expect(panel.style.getPropertyValue('--risu-theme-bgcolor')).toBe('')
    })

    test('the own colours switching on and off moves the attribute with them', () => {
        setOwnColours(false)
        show(CASES[1].make(true))
        const target = mountAlertComp()
        const panel = panelOf(target, 'held')
        expect(panel.hasAttribute('data-own-scheme')).toBe(false)
        setOwnColours(true)
        flushSync()
        expect(panel.getAttribute('data-own-scheme')).toBe('prompt')
        setOwnColours(false)
        flushSync()
        expect(panel.hasAttribute('data-own-scheme')).toBe(false)
    })

    test.each(PROMPTS)('held $name guard under a live unflagged error: each panel reads its own alert', ({ make }) => {
        setOwnColours(true)
        const prompt = make(true)
        show(prompt)
        const target = mountAlertComp()
        show({ type: 'error', msg: 'Something else failed' })
        expect(panels(target)).toHaveLength(2)
        expect(panelOf(target, 'held').getAttribute('data-own-scheme')).toBe('prompt')
        expect(panelOf(target, 'live').hasAttribute('data-own-scheme')).toBe(false)
    })

    test.each(PROMPTS)('held unflagged $name under a live flagged error: the live panel alone is the host', ({ make }) => {
        setOwnColours(true)
        show(make(false))
        const target = mountAlertComp()
        show(CASES[4].make(true))
        expect(panels(target)).toHaveLength(2)
        expect(panelOf(target, 'held').hasAttribute('data-own-scheme')).toBe(false)
        expect(panelOf(target, 'live').getAttribute('data-own-scheme')).toBe('prompt')
    })

    test('a flagged held prompt under a flagged live error: both panels are hosts', () => {
        setOwnColours(true)
        show(CASES[0].make(true))
        const target = mountAlertComp()
        show(CASES[4].make(true))
        expect(hostsIn(target)).toEqual([panelOf(target, 'held'), panelOf(target, 'live')])
    })
})

//#region differential against a hostile pack (TB-4 panel case, TB-5, T2-G1)

/** A stored pack scheme that fails the contrast floor: textcolor2 #888888 on bgcolor #333333 = 3.56:1. */
const F1: ColorScheme = { ...defaultColorScheme, bgcolor: '#333333', darkbg: '#333333', textcolor: '#f0f0f0', textcolor2: '#888888', type: 'dark' }

const SOURCES = [
    'src/lib/Others/AlertComp.svelte',
    'src/lib/Others/PeerConflicts.svelte',
    'src/lib/Others/ParkedReplyPrompt.svelte',
]
const PATTERN_SHEETS = ['pattern-dialog', 'pattern-alert', 'pattern-alert-tools']

let appSheets: ModelSheet[]

beforeAll(async () => {
    appSheets = await appSheetsInOrder(classCandidates(...SOURCES.map(readRepoFile), 'flex bg-bg w-full h-full text-textcolor bg-darkbg'))
    for (const name of PATTERN_SHEETS) appSheets.push({ name, css: readRepoFile(`src/lib/Nexus/pattern/${name}.css`) })
    // The chat tokens carry the root-state twins that the pattern sheets read.
    for (const file of ['studio-tokens', 'home-tokens']) appSheets.push({ name: file, css: readRepoFile(`src/styles/${file}.css`) })
}, 120000)

function paintScheme(pack: boolean): void {
    DBState.db = {
        characters: [],
        colorSchemeName: pack ? PACK_SCHEME_NAME : 'default',
        colorScheme: structuredClone(pack ? F1 : defaultColorScheme),
    } as unknown as Database
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

/** The chat-shell ancestor a pack may style, wrapped around every mounted dialog. */
function shellHost(): HTMLElement {
    const main = document.createElement('main')
    const shell = document.createElement('div')
    shell.setAttribute('data-part', 'chat-shell')
    main.append(shell)
    document.body.append(main)
    return shell
}

function hostileSheet(): string {
    return `[data-part="chat-shell"] {
  color: #ffe9a8 !important; background-color: #1a1a2e !important; background-image: linear-gradient(#1a1a2e, #16213e) !important;
  border-color: #ffd166; box-shadow: inset 0 0 0 2px #16213e; text-shadow: 1px 1px #1a1a2e;
  caret-color: #ffd166; accent-color: #ffd166;
  font-family: papyrus, fantasy; font-weight: 100; font-style: italic; text-decoration: underline 3px #ffd166;
}
:root { --nexus-text: #ffe9a8; --nexus-canvas: #1a1a2e; --ui-radius: 0px; --ui-border-width: 2px; }`
}

function commitHostile(): void {
    const judged = judgeAreaSheet('chat', hostileSheet(), undefined, 'chat')
    expect(judged.result.ok).toBe(true)
    expect(commitPackSheet(chatCommitInput(buildAppliedText(judged, () => '')))).toEqual({ ok: true })
}

const packElement = (): HTMLStyleElement | null => document.querySelector<HTMLStyleElement>('style[data-theme-pack]')

/** The component's scoped sheet, compiled with the scope class the mounted dialog carries. */
function componentSheet(target: HTMLElement): ModelSheet {
    const scoped = target.querySelector<HTMLElement>(PANEL)!.querySelector<HTMLElement>('.stack-trace') ?? target.querySelector<HTMLElement>('[data-part="pattern-warn-root"]')!
    const scope = [...scoped.classList].find((name) => name.startsWith('svelte-'))
    if (scope === undefined) throw new Error('the mounted dialog has no scope class')
    const file = 'src/lib/Others/AlertComp.svelte'
    return { name: 'AlertComp', css: compileSvelte(readRepoFile(file), { filename: file, css: 'external', cssHash: () => scope }).css?.code ?? '' }
}

function modelOf(target: HTMLElement, withPack: boolean): CascadeModel {
    const base = withPack ? withPackElement(appSheets, packElement()) : appSheets
    return new CascadeModel(compileRules([...base, componentSheet(target)]), { important: true })
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

/** The opaque colour an element sits on: its own and its ancestors' backgrounds composited down to the first opaque one. */
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

function subtree(panel: Element): Element[] {
    return [panel, ...panel.querySelectorAll('*')]
}

/** Every painted reading below the panel plus the panel's own text colour; the panel's backdrop is the island's own addition. */
function subtreeReading(model: CascadeModel, panel: Element): Record<string, Record<string, string> | string> {
    const out: Record<string, Record<string, string> | string> = { host: model.painted(panel).color }
    panel.querySelectorAll('*').forEach((el, index) => { out[`${index}:${el.tagName.toLowerCase()}`] = model.painted(el) })
    return out
}

/** An error with a stack trace and its details open, so the `.stack-trace` block is in the subtree. */
function errorWithDetails(): alertData {
    return CASES[4].make(true)
}

function openDetails(target: HTMLElement): void {
    const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.classList.contains('pattern-button'))!
    button.click()
    flushSync()
}

interface Built { target: HTMLElement, panel: HTMLElement }

/** One dialog mounted inside the shell ancestor, in the state of the pack run or the no-pack run. */
async function build(make: () => alertData, details: boolean): Promise<Built> {
    show(make())
    const target = mountAlertComp(shellHost())
    await tick()
    flushSync()
    if (details) openDetails(target)
    return { target, panel: target.querySelector<HTMLElement>(PANEL)! }
}

function teardown(): void {
    for (const instance of mountedInstances.splice(0)) void unmount(instance as never)
    mountedTargets.splice(0).forEach((target) => target.closest('main')?.remove())
    flushSync()
    for (const child of [...document.body.children]) if (child.id !== 'customcss') child.remove()
    alertStore.set({ type: 'none', msg: '' } as never)
    resetAlertPromptsForTests()
    resetOwnColoursForTests()
}

const SUBJECTS: Array<{ name: string, make: () => alertData, details: boolean }> = [
    { name: 'a save-guard select', make: () => CASES[0].make(true), details: false },
    { name: 'a save-guard ask', make: () => CASES[1].make(true), details: false },
    { name: 'a save-guard peerConflicts', make: () => CASES[2].make(true), details: false },
    { name: 'a save-guard parkedReply', make: () => CASES[3].make(true), details: false },
    { name: 'a save-guard error with its stack trace open', make: errorWithDetails, details: true },
]

describe('the hostile pack run, panel as host', () => {
    beforeEach(() => {
        resetRoot()
        document.head.innerHTML = ''
        document.body.innerHTML = ''
        // The pack elements are inserted before the app's custom CSS element.
        const custom = document.createElement('style')
        custom.id = 'customcss'
        document.body.appendChild(custom)
        installThemePackGate(() => false)
        declareSurface('chat')
    })

    afterEach(() => {
        teardown()
        resetPackSheetForTests()
        resetThemePackGateForTests()
        resetRoot()
        document.head.innerHTML = ''
    })

    test('T2-G1: a save-guard alert with the own colours on renders the panel body under [data-own-scheme="prompt"]', async () => {
        commitHostile()
        paintScheme(true)
        expect(ownColours.on).toBe(true)
        const { target, panel } = await build(() => CASES[1].make(true), false)
        const body = target.querySelector('[data-part="pattern-warn-root"]')!
        expect(body.closest('[data-own-scheme="prompt"]')).toBe(panel)
        expect(panel.parentElement!.getAttribute('data-part')).toBe('pattern-layer')
    })

    test.each(SUBJECTS)('TB-4 panel case, $name: every painted property of the subtree equals the no-pack run', async ({ make, details }) => {
        paintScheme(false)
        const base = await build(make, details)
        const baseline = subtreeReading(modelOf(base.target, false), base.panel)
        const baselineCount = subtree(base.panel).length
        teardown()
        resetRoot()

        commitHostile()
        paintScheme(true)
        const run = await build(make, details)
        const model = modelOf(run.target, true)
        expect(run.panel.getAttribute('data-own-scheme')).toBe('prompt')
        expect(subtree(run.panel).length).toBe(baselineCount)
        expect(subtreeReading(model, run.panel)).toEqual(baseline)
    })

    test.each(SUBJECTS)('TB-4 font rows, $name: every element resolves the app font; only .stack-trace keeps monospace', async ({ make, details }) => {
        commitHostile()
        paintScheme(true)
        const { target, panel } = await build(make, details)
        const model = modelOf(target, true)
        const appFont = model.custom(document.documentElement, '--risu-font-family')
        expect(appFont).toBeDefined()
        // The pack's ancestor declares papyrus: the panel must not read it.
        expect(model.prop(panel.closest('[data-part="chat-shell"]')!, 'font-family')).toContain('papyrus')
        let monospaced = 0
        for (const el of subtree(panel)) {
            const font = model.prop(el, 'font-family')
            if (el.classList.contains('stack-trace')) {
                expect(font).toBe('monospace')
                monospaced += 1
            } else {
                expect(font === undefined || font === appFont, `${el.tagName.toLowerCase()}.${el.getAttribute('class')} font-family`).toBe(true)
            }
            const shorthand = model.prop(el, 'font')
            expect(shorthand === undefined || /^\s*inherit\s*$/.test(shorthand)).toBe(true)
        }
        expect(monospaced).toBe(details ? 1 : 0)
    })

    test.each(SUBJECTS)('TB-5 backdrop, $name: the panel resolves an opaque own bottom layer and its text reaches 4.5:1', async ({ make, details }) => {
        commitHostile()
        paintScheme(true)
        const { target, panel } = await build(make, details)
        const model = modelOf(target, true)
        const painted = model.painted(panel)
        // The own bgcolor of the default scheme the island re-declares, not the pack-base sheet surface (#0e0f2a) the panel shows without the island.
        expect(painted['background-color']).toBe(`${defaultColorScheme.bgcolor}ff`)
        const ground = backdrop(model, panel)
        expect(ground).toBe(defaultColorScheme.bgcolor)
        expect(contrast(painted.color.slice(0, 7), ground)).toBeGreaterThanOrEqual(4.5)
        // The pack's own pairing is what the island replaces.
        expect(contrast('#888888', '#333333')).toBeLessThan(4.5)
        // Layer and scrim stay the pack's: they are never the island.
        expect(panel.parentElement!.hasAttribute('data-own-scheme')).toBe(false)
    })

    test('inert: with no failing pack the same dialog carries no island', async () => {
        commitHostile()
        paintScheme(false)
        expect(ownColours.on).toBe(false)
        const { target, panel } = await build(() => CASES[1].make(true), false)
        expect(hostsIn(target)).toEqual([])
        expect(panel.getAttribute('style')?.includes('--risu-theme-') ?? false).toBe(false)
    })
})

//#endregion
