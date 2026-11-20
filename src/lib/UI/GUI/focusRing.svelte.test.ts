// @vitest-environment jsdom

/**
 * The classic keyboard focus ring is one colour from the colour scheme. The fixtures are the real
 * producers: the classic primitives (text, text area and check inputs included) and the Home persona chip mounted from source, the CBS card
 * button through the real sanitizer, the Tailwind output of `src/styles.css` compiled for those
 * sources, `cardEffects.css`, the real `updateColorScheme`, and the real theme pack apply path,
 * all resolved per element by the cascade model.
 *
 * TB5 (every preset, every control paints a focus indicator at 3:1 or more on the scheme's page and
 * panel colours) is a regression reproducer: the box-shadow ring the primitives painted before the
 * focus-ring role fails it on assertions. TB5d and TB5f are new-rule guards.
 *
 * MOCKED: alert, database, globalApi, util and stores (the persona chip reads only the username),
 * the system bars, the app store and the Settings opener. Forced colours and `:focus` versus
 * `:focus-visible` quietness are not observable in jsdom; they are device rows.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import postcss, { type Rule } from 'postcss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete, type Rgba } from 'src/ts/themePack/colour'
import {
    CascadeModel, classCandidates, compileAppStyles, compileRules, hex8, normaliseColours, readRepoFile, withPackElement,
    type ModelSheet, type RuleSet,
} from 'src/styles/tests/cascadeModel'

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
    getFileSrc: vi.fn(async () => ''),
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    aiLawApplies: vi.fn(() => false),
    aiWatermarkingLawApplies: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/guisize'), () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/gui/highlight'), () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: [] as string[],
}) as unknown as typeof import('src/ts/gui/highlight'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
    CurrentTriggerIdStore: writable(null),
    HideIconStore: writable(false),
    createSimpleCharacter: vi.fn(() => null),
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/lib/UI/Home/homeEmptyActions'), () => ({
    openPersonaSettings: vi.fn(),
}) as unknown as typeof import('src/lib/UI/Home/homeEmptyActions'))

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'
import { trimMarkdown } from 'src/ts/parser/parser.svelte'
import { BUILTIN_PACKS } from 'src/ts/themePack/builtins'
import { buildAppliedText, commitPackSheet, resetPackSheetForTests } from 'src/ts/themePack/apply'
import { judgeAreaSheet } from 'src/ts/themePack/index'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from 'src/ts/themePack/surfaceGate.svelte'
import Button from './Button.svelte'
import NumberInput from './NumberInput.svelte'
import SelectInput from './SelectInput.svelte'
import KeyListInput from './KeyListInput.svelte'
import TextInput from './TextInput.svelte'
import TextAreaInput from './TextAreaInput.svelte'
import CheckInput from './CheckInput.svelte'
import HomePersonaChip from 'src/lib/UI/Home/HomePersonaChip.svelte'

const COMPONENT_SOURCES = [
    'src/lib/UI/GUI/Button.svelte',
    'src/lib/UI/GUI/NumberInput.svelte',
    'src/lib/UI/GUI/SelectInput.svelte',
    'src/lib/UI/GUI/KeyListInput.svelte',
    'src/lib/UI/GUI/TextInput.svelte',
    'src/lib/UI/GUI/TextAreaInput.svelte',
    'src/lib/UI/GUI/CheckInput.svelte',
    'src/lib/UI/Home/HomePersonaChip.svelte',
]
const EFFECTS_CSS = 'src/ts/chatShell/cardEffects.css'

let tailwind: ModelSheet
let effects: ModelSheet
let rules: RuleSet
/** `focus` is the element that takes focus; `paint` is the element whose focus indicator is read (they differ for the focus-within wrapper and the peer box). */
type Control = { focus: HTMLElement, paint: HTMLElement }
const controls = new Map<string, Control>()
const instances: unknown[] = []
let cardButton: HTMLElement

function mountInto(label: string, component: Parameters<typeof mount>[0], props: Record<string, unknown>, find: (root: HTMLElement) => HTMLElement, paintOf: (focus: HTMLElement) => HTMLElement = (focus) => focus): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(component, { target, props }))
    flushSync()
    const focus = find(target)
    controls.set(label, { focus, paint: paintOf(focus) })
}

const nextSibling = (focus: HTMLElement): HTMLElement => {
    const sibling = focus.nextElementSibling
    if (!(sibling instanceof HTMLElement)) throw new Error('no next sibling')
    return sibling
}

/** The focus-within wrapper is the editor's parent; TextAreaInput mounts it as its root element. */
const wrapperOf = (focus: HTMLElement): HTMLElement => {
    const root = focus.parentElement
    if (root === null) throw new Error('no wrapper')
    return root
}

const first = (selector: string) => (root: HTMLElement): HTMLElement => {
    const el = root.querySelector<HTMLElement>(selector)
    if (el === null) throw new Error(`no ${selector}`)
    return el
}

beforeAll(async () => {
    tailwind = await compileAppStyles(classCandidates(...COMPONENT_SOURCES.map(readRepoFile)))
    effects = { name: 'cardEffects', css: readRepoFile(EFFECTS_CSS) }
    rules = compileRules([tailwind, effects])

    h.db.username = ''
    mountInto('Button primary', Button, { styled: 'primary' }, first('button'))
    mountInto('Button outlined', Button, { styled: 'outlined' }, first('button'))
    mountInto('Button danger', Button, { styled: 'danger' }, first('button'))
    mountInto('NumberInput', NumberInput, { value: 0 }, first('input'))
    mountInto('SelectInput', SelectInput, { value: '' }, first('select'))
    mountInto('KeyListInput', KeyListInput, { value: '' }, first('input'))
    mountInto('TextInput', TextInput, { value: '' }, first('input'))
    mountInto('TextAreaInput', TextAreaInput, { value: '' }, first('textarea'), wrapperOf)
    mountInto('TextAreaInput highlight', TextAreaInput, { value: '', highlight: true }, first('div[role="textbox"]'), wrapperOf)
    mountInto('CheckInput', CheckInput, { check: false, name: 'Check' }, first('input[type="checkbox"]'), nextSibling)
    mountInto('HomePersonaChip', HomePersonaChip, {}, first('button'))

    const chat = document.createElement('div')
    chat.className = 'chattext'
    chat.innerHTML = trimMarkdown('<button class="button-default">Go</button>')
    document.body.appendChild(chat)
    cardButton = first('button')(chat)
    controls.set('CBS card button', { focus: cardButton, paint: cardButton })
}, 120000)

afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-card-effects-off')
})

afterAll(async () => {
    for (const instance of instances.splice(0)) await unmount(instance as never).catch(() => {})
})

function applyScheme(name: string): void {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

function splitTop(text: string, sep: ',' | ' '): string[] {
    const parts: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of text) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
            if (cur.trim() !== '') parts.push(cur.trim())
            cur = ''
        } else cur += ch
    }
    if (cur.trim() !== '') parts.push(cur.trim())
    return parts
}

const COLOUR_TOKEN = /^(#|(oklch|oklab|rgba?|hsla?|color-mix)\()/

/** Tailwind's default palette is written in oklch, which the colour parser does not read; out-of-gamut values are clipped. */
function oklchToRgba(token: string): Rgba | null {
    const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(token)
    if (m === null) return null
    const L = Number(m[1]) / (m[2] === '%' ? 100 : 1)
    const C = Number(m[3])
    const hue = (Number(m[4]) * Math.PI) / 180
    const a = C * Math.cos(hue)
    const b = C * Math.sin(hue)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
    ]
    const gamma = (v: number): number => {
        const c = Math.min(1, Math.max(0, v))
        return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
    }
    return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2]), 1]
}

/** A colour token as `#rrggbbaa`; null when the token is not a concrete colour. */
function asHex8(token: string): string | null {
    const c = parseConcrete(token) ?? oklchToRgba(token)
    return c === null ? null : hex8(c)
}

const visible = (colour: string | null): colour is string => colour !== null && colour.length === 9 && colour.slice(7) !== '00'

/** The colours a focused element paints as its indicator: a visible outline, and every outer box-shadow layer with a spread. */
function indicators(painted: Record<string, string>): string[] {
    const out: string[] = []
    const outline = painted['outline-color']
    const outlineHex = outline === undefined ? null : asHex8(outline)
    if (visible(outlineHex)) out.push(outlineHex)
    for (const layer of splitTop(painted['box-shadow'] ?? '', ',')) {
        const tokens = splitTop(layer, ' ')
        if (tokens.includes('inset')) continue
        const colour = tokens.find((t) => COLOUR_TOKEN.test(t))
        const lengths = tokens.filter((t) => t !== colour)
        const spread = lengths[3]
        const colourHex = colour === undefined ? null : asHex8(colour)
        if (visible(colourHex) && spread !== undefined && !/^0(px)?$/.test(spread)) out.push(colourHex)
    }
    return out
}

const rgbOf = (hex: string) => parseConcrete(hex.slice(0, 7))!

function focusedIndicators(control: Control, set: RuleSet): { colours: string[] } {
    const m = new CascadeModel(set, { focused: control.focus })
    return { colours: indicators(m.painted(control.paint)) }
}

function contrastFailures(name: string, label: string, control: Control, set: RuleSet): string[] {
    const scheme = colorSchemePresets[name]
    const { colours } = focusedIndicators(control, set)
    const failures: string[] = []
    if (colours.length === 0) {
        failures.push(`${name} ${label}: no focus indicator`)
        return failures
    }
    const ok = colours.some((c) => cr(rgbOf(c), parseConcrete(scheme.bgcolor)!) >= 3 && cr(rgbOf(c), parseConcrete(scheme.darkbg)!) >= 3)
    if (!ok) {
        const ratios = colours.map((c) => `${c} ${cr(rgbOf(c), parseConcrete(scheme.bgcolor)!).toFixed(2)}/${cr(rgbOf(c), parseConcrete(scheme.darkbg)!).toFixed(2)}`)
        failures.push(`${name} ${label}: indicator below 3:1 (bg/dbg ${ratios.join(', ')})`)
    }
    return failures
}

describe('TB5: every classic control paints a focus indicator of at least 3:1 on the scheme page and panel colours', () => {
    test('the compiled sheet is live: the primitives and the chip carry classes that exist', () => {
        expect(controls.size).toBe(12)
        expect(tailwind.css).toContain('.risu-focus-ring')
    })

    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const failures: string[] = []
        for (const [label, el] of controls) failures.push(...contrastFailures(name, label, el, rules))
        expect(failures).toEqual([])
    })

    test.each(colorSchemeList)('%s: the card button keeps a 3:1 outline while card effects are off', (name) => {
        applyScheme(name)
        document.documentElement.setAttribute('data-card-effects-off', '')
        expect(contrastFailures(name, 'CBS card button, effects off', { focus: cardButton, paint: cardButton }, rules)).toEqual([])
    })

    test.each(colorSchemeList)('%s: every control paints the focus-ring role', (name) => {
        applyScheme(name)
        const role = normaliseColours(document.documentElement.style.getPropertyValue('--risu-theme-role-focus-ring'), '#000000ff')
        expect(role).not.toBe('')
        for (const [label, el] of controls) {
            expect(focusedIndicators(el, rules).colours, `${name} ${label}`).toContain(role)
        }
    })
})

describe('TB5d: the focus ring rules stay inside the CHORE-738 width and offset limits', () => {
    const px = (v: string | undefined): number => {
        const m = /^(-?[\d.]+)(?:px)?$/.exec((v ?? '').trim())
        if (m === null) throw new Error(`not a px length: ${v}`)
        return Number(m[1])
    }

    function ringRules(css: string, match: (selector: string) => boolean): Rule[] {
        const out: Rule[] = []
        postcss.parse(css).walkRules((rule) => {
            if (rule.selectors.some(match)) out.push(rule)
        })
        return out
    }

    function checkOutline(rule: Rule): void {
        let outline: string | undefined
        let offset: string | undefined
        rule.walkDecls((d) => {
            if (d.prop === 'outline') outline = d.value
            if (d.prop === 'outline-offset') offset = d.value
        })
        const width = /(-?[\d.]+px)/.exec(outline ?? '')?.[1]
        expect(px(width), rule.selector).toBeGreaterThanOrEqual(1)
        expect(px(width), rule.selector).toBeLessThanOrEqual(4)
        expect(px(offset), rule.selector).toBeGreaterThanOrEqual(-4)
        expect(px(offset), rule.selector).toBeLessThanOrEqual(6)
    }

    test('the app rule group paints a 1 to 4px outline at an offset from -4 to 6px, and the group is not empty', () => {
        const found = ringRules(tailwind.css, (s) => s.includes('risu-focus-ring') || s.includes('x-risu-button-default:focus-visible'))
        const selectors = found.flatMap((r) => r.selectors.filter((s) => s.includes('risu-focus-ring') || s.includes('x-risu-button-default:focus-visible')))
        expect(selectors.length).toBeGreaterThanOrEqual(4)
        for (const rule of found) checkOutline(rule)
    })

    test('the card-effects-off stand-in stays inside the limits', () => {
        const found = ringRules(effects.css, (s) => s.includes('x-risu-button-default:focus'))
        expect(found.length).toBeGreaterThanOrEqual(1)
        for (const rule of found) checkOutline(rule)
    })
})

describe('TB5f: a theme pack does not move the classic ring', () => {
    let covered = false

    beforeEach(() => {
        h.db.colorSchemeName = 'default'
        const custom = document.createElement('style')
        custom.id = 'customcss'
        document.body.appendChild(custom)
        covered = false
        installThemePackGate(() => covered)
        declareSurface('chat')
    })

    afterEach(() => {
        resetPackSheetForTests()
        resetThemePackGateForTests()
        document.getElementById('customcss')?.remove()
        document.head.innerHTML = ''
    })

    test('under light with Origin Navy on, the focused Button keeps the light role and the new-screen ring sits on the pack base', () => {
        const navy = BUILTIN_PACKS.find((p) => p.id === 'builtin:origin-navy')!
        const judged = judgeAreaSheet('chat', navy.chatCss, undefined, 'chat')
        expect(judged.result.ok).toBe(true)
        expect(commitPackSheet({ text: buildAppliedText(judged, () => ''), blobs: [] })).toEqual({ ok: true })
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(true)

        applyScheme('light')
        const set = compileRules(withPackElement([tailwind, effects], document.querySelector<HTMLStyleElement>('style[data-theme-pack]')))
        const button = controls.get('Button primary')!.focus
        const m = new CascadeModel(set, { focused: button })
        const role = document.documentElement.style.getPropertyValue('--risu-theme-role-focus-ring')
        expect(normaliseColours(role, '#000000ff')).toBe('#0f172aff')
        expect(m.painted(button)['outline-color']).toBe('#0f172aff')
        // The new-screen ring follows the pack (its accent), never the scheme role the classic ring reads.
        expect(normaliseColours(m.custom(document.documentElement, '--nexus-ring')!, '#000000ff')).toBe('#8be9fdff')
    })
})
