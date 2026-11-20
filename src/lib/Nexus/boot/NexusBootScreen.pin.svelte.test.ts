// @vitest-environment jsdom

/**
 * The boot screen always paints the built-in Default scheme, whatever scheme the app has applied
 * (`updateColorScheme` runs before the screen is dismissed). The real `NexusBootScreen` is mounted
 * in each state and every painted colour of its subtree is resolved element by element by the
 * cascade model over the real stylesheets: the Tailwind output of `src/styles.css`, `chat-tokens.css`,
 * `nexus-boot.css` and `nexus-mark.css`. The model is not a browser; the same values are read from
 * Chrome in the PC device row. Mocked: the database, stores and system bars behind
 * `updateColorScheme`; the canvas context of the network background is not mounted here.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseConcrete } from '../../../ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, hex8, readRepoFile, type ModelSheet, type RuleSet } from '../../../styles/tests/cascadeModel'
import type { BootNotice, BootProgress } from './bootProgress'
import NexusBootScreen from './NexusBootScreen.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { colorSchemePresets, defaultColorScheme, updateColorScheme, type ColorScheme } from '../../../ts/gui/colorscheme'

const CUSTOM_LIGHT: ColorScheme = {
    bgcolor: '#fff8e1', darkbg: '#ffe0b2', borderc: '#4e342e', selected: '#ffcc80', draculared: '#b71c1c',
    textcolor: '#212121', textcolor2: '#5d4037', darkBorderc: '#bcaaa4', darkbutton: '#ffecb3', type: 'light',
}

// [label, colorSchemeName, saved scheme for 'custom']
const SCHEMES: [string, string, ColorScheme | undefined][] = [
    ['default', 'default', undefined],
    ['light', 'light', undefined],
    ['nexus', 'nexus', undefined],
    ['cherry', 'cherry', undefined],
    ['custom light', 'custom', CUSTOM_LIGHT],
    ['lite', 'lite', undefined],
]

interface State {
    name: string
    progress: BootProgress
    notice?: BootNotice
    lowPower?: boolean
    rm?: boolean
}

const STATES: State[] = [
    { name: 'running without count', progress: { step: 'files', state: 'running' } },
    { name: 'running with count', progress: { step: 'library', state: 'running', count: { done: 1, total: 3 } } },
    { name: 'waiting', progress: { step: 'library', state: 'waiting' } },
    { name: 'failed', progress: { step: 'save', state: 'failed' } },
    { name: 'error notice', progress: { step: 'save', state: 'running' }, notice: { kind: 'error', message: 'Disk full', detail: 'Free some space.', stackTrace: 'Error: at x', onDismiss: () => {} } },
    { name: 'wait notice', progress: { step: 'library', state: 'running' }, notice: { kind: 'wait', message: 'Working', onCancel: () => {} } },
    { name: 'low power', progress: { step: 'files', state: 'running' }, lowPower: true },
    { name: 'reduced motion class', progress: { step: 'files', state: 'running' }, rm: true },
]

let rules: RuleSet
let mounted: { target: HTMLElement, app: Record<string, unknown> } | undefined

beforeAll(async () => {
    const sources = ['src/lib/Nexus/boot/NexusBootScreen.svelte', 'src/lib/Nexus/brand/NexusStatusMark.svelte'].map(readRepoFile)
    const tailwind = await compileAppStyles(classCandidates(...sources, 'text-textcolor text-nexus-text nexus-canvas'))
    const sheets: ModelSheet[] = [
        tailwind,
        { name: 'chat-tokens', css: readRepoFile('src/styles/chat-tokens.css') },
        { name: 'nexus-boot', css: readRepoFile('src/lib/Nexus/boot/nexus-boot.css') },
        { name: 'nexus-mark', css: readRepoFile('src/lib/Nexus/brand/nexus-mark.css') },
    ]
    rules = compileRules(sheets)
}, 120000)

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
    }
    mounted = undefined
    document.documentElement.classList.remove('rm')
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

function applyScheme(name: string, saved?: ColorScheme): void {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorSchemeName = name
    h.db.colorScheme = structuredClone(saved ?? defaultColorScheme)
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

function mountState(state: State): HTMLElement {
    document.body.innerHTML = '<div id="probe" class="nexus-canvas text-nexus-text"></div>'
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state<{ progress: BootProgress, notice?: BootNotice, lowPower?: boolean }>({ progress: state.progress, notice: state.notice, lowPower: state.lowPower })
    mounted = { target, app: mount(NexusBootScreen as never, { target, props }) as unknown as Record<string, unknown> }
    flushSync()
    if (state.rm) document.documentElement.classList.add('rm')
    return target.firstElementChild as HTMLElement
}

function pathKey(root: Element, el: Element): string {
    const parts: string[] = []
    for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) {
        parts.unshift(`${n.tagName.toLowerCase()}${n.parentElement ? `[${[...n.parentElement.children].indexOf(n)}]` : ''}`)
    }
    return parts.join('/')
}

type PaintMap = Record<string, Record<string, string>>

function paintMap(root: HTMLElement, focused: Element | null): PaintMap {
    const model = new CascadeModel(rules, { focused, reducedMotion: false })
    const out: PaintMap = {}
    for (const el of [root, ...root.querySelectorAll('*')]) {
        const key = pathKey(root, el)
        out[key] = model.painted(el)
        for (const pseudo of ['::before', '::after'] as const) {
            if (el.classList.contains('nexus-boot-sweep') && pseudo === '::before') out[`${key}${pseudo}`] = model.painted(el, pseudo)
        }
    }
    return out
}

function named(root: HTMLElement) {
    const q = (selector: string): HTMLElement | null => root.querySelector(selector)
    const noticeText = [...root.querySelectorAll<HTMLElement>('[role="alert"] p, [role="status"] p')]
    return {
        root,
        title: q('span.text-2xl'),
        label: q('.text-nexus-text-secondary'),
        count: q('.tabular-nums'),
        hint: q('p.text-nexus-text-muted'),
        track: q('.nexus-boot-bar'),
        fill: q('.nexus-boot-fill'),
        ticks: q('.nexus-boot-ticks'),
        sweep: q('.nexus-boot-sweep'),
        mark: q('span[role="status"]'),
        card: q('.nexus-surface-raised'),
        button: q('button'),
        noticeText,
    }
}

describe('TB6: the boot screen paints the Default scheme under every scheme', () => {
    const PROBE_SCHEME = SCHEMES.find(([label]) => label === 'light')!

    test('(i) liveness: outside the boot root the same utilities follow the scheme', () => {
        mountState(STATES[0])
        const read = (label: string) => {
            const [, name, saved] = SCHEMES.find(([l]) => l === label)!
            applyScheme(name, saved)
            const painted = new CascadeModel(rules).painted(document.getElementById('probe')!)
            return { color: painted.color, background: painted['background-color'] }
        }
        const dflt = read('default')
        const light = read('light')
        expect(light.color).not.toBe(dflt.color)
        expect(light.background).toBe(`${colorSchemePresets.light.bgcolor}ff`)
        expect(light.color).toBe(`${colorSchemePresets.light.textcolor}ff`)
    })

    describe.each(STATES)('$name', (state) => {
        test('(ii) invariance: every painted colour equals the Default map under each scheme', () => {
            const root = mountState(state)
            const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null
            applyScheme('default')
            const reference = paintMap(root, focused)
            const els = named(root)
            // Required elements exist in this state and paint a colour.
            for (const key of ['root', 'title', 'label', 'hint', 'track', 'fill', 'ticks', 'mark'] as const) {
                expect(els[key], key).not.toBeNull()
            }
            if (state.progress.count === undefined) expect(els.sweep, 'sweep').not.toBeNull()
            if (state.notice) {
                expect(els.card, 'card').not.toBeNull()
                expect(els.noticeText.length, 'notice text').toBeGreaterThan(0)
                expect(els.button, 'button').not.toBeNull()
                expect(focused, 'the notice action holds focus').toBe(els.button)
            }
            const keys = Object.keys(reference)
            expect(keys.length).toBeGreaterThan(10)
            for (const [label, name, saved] of SCHEMES) {
                applyScheme(name, saved)
                const map = paintMap(root, focused)
                expect(map, label).toEqual(reference)
            }
        })

        test('(iii) fidelity: under Default the pin changes nothing', () => {
            const root = mountState(state)
            const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null
            applyScheme('default')
            const withPin = paintMap(root, focused)
            root.classList.remove('nexus-boot-scheme')
            const withoutPin = paintMap(root, focused)
            root.classList.add('nexus-boot-scheme')
            expect(withoutPin).toEqual(withPin)
        })
    })

    test('(iv) self-falsification: without the pin class the text follows light', () => {
        const root = mountState(STATES.find((s) => s.name === 'error notice')!)
        const focused = document.activeElement
        applyScheme('default')
        const reference = named(root)
        const colourOfEl = (m: CascadeModel, el: HTMLElement | null) => m.painted(el!).color
        const dflt = new CascadeModel(rules, { focused })
        const base = {
            title: colourOfEl(dflt, reference.title),
            label: colourOfEl(dflt, reference.label),
            hint: colourOfEl(dflt, reference.hint),
            notice: colourOfEl(dflt, reference.noticeText[0]),
        }
        applyScheme(PROBE_SCHEME[1])
        root.classList.remove('nexus-boot-scheme')
        const light = new CascadeModel(rules, { focused })
        expect(colourOfEl(light, reference.title)).not.toBe(base.title)
        expect(colourOfEl(light, reference.label)).not.toBe(base.label)
        expect(colourOfEl(light, reference.hint)).not.toBe(base.hint)
        expect(colourOfEl(light, reference.noticeText[1] ?? reference.noticeText[0])).not.toBe(base.notice)
    })

    test('(v) the pinned channels reach the bar: track, sweep tiers and failed fill derive from the pin values', () => {
        const hex = (channelsOrColour: string, alpha: number): string => {
            const c = parseConcrete(channelsOrColour.includes(' ') ? `rgb(${channelsOrColour} / ${alpha})` : channelsOrColour)!
            return hex8([c[0], c[1], c[2], channelsOrColour.includes(' ') ? alpha : c[3]])
        }
        const pinned = (root: HTMLElement) => {
            const m = new CascadeModel(rules)
            return {
                accent: m.custom(root, '--nexus-accent-rgb')!,
                danger: m.custom(root, '--nexus-danger-rgb')!,
                dangerSolid: m.custom(root, '--nexus-danger')!,
                overlay: m.custom(root, '--nexus-overlay-rgb')!,
            }
        }
        const sweepOf = (root: HTMLElement) => new CascadeModel(rules, { reducedMotion: false }).painted(root.querySelector('.nexus-boot-sweep')!, '::before')

        // Run under light so a literal that ignored the pin would still differ from the Default-derived value if it followed the scheme.
        applyScheme('light')
        let root = mountState(STATES[0])
        let p = pinned(root)
        const track = new CascadeModel(rules).painted(root.querySelector('.nexus-boot-bar')!)['background-color']
        expect(track).toBe(hex(p.overlay, 0.08))
        expect(sweepOf(root)['background-image']).toBe(`linear-gradient(90deg, #00000000, ${hex(p.accent, 0.75)}, #00000000)`)

        const cases: [string, number, State][] = [
            ['waiting', 0.4, STATES.find((s) => s.name === 'waiting')!],
            ['still', 0.5, STATES.find((s) => s.name === 'low power')!],
        ]
        for (const [, alpha, state] of cases) {
            if (mounted) { void unmount(mounted.app as never); mounted.target.remove(); mounted = undefined }
            root = mountState(state)
            p = pinned(root)
            expect(sweepOf(root)['background-color'], state.name).toBe(hex(p.accent, alpha))
        }
        if (mounted) { void unmount(mounted.app as never); mounted.target.remove(); mounted = undefined }
        root = mountState(STATES.find((s) => s.name === 'failed')!)
        p = pinned(root)
        expect(sweepOf(root)['background-color']).toBe(hex(p.danger, 0.6))
        const fill = new CascadeModel(rules).painted(root.querySelector('.nexus-boot-fill')!)
        expect(fill['background-color']).toBe(hex(p.dangerSolid, 1))
    })
})
