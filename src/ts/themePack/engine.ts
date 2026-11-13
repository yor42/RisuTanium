// Pack-install validator (DD-149, DD-155, DD-159; THEMING.md "Protected surfaces are enforced at install") and chat's registry.
//   lintPack(css, name?, registry?) -> { ok, errors: [{ selector, prop, why }], name }
//
// The rule is by REACH (DD-155), not by lists of dangerous properties:
//  0. The text is normalised first: comments removed, CSS escapes decoded (\64isplay is display), upper case folded. Nothing is judged before that.
//  1. Selectors: only :root / html and [data-*="value"] attribute selectors with :hover, :focus-within, :focus-visible. No tag, class, id, *, :not / :is / :has,
//     pseudo-element, nesting, or attribute operator other than equals. At-rules: only @media. No @keyframes, @import, @font-face, @property, @supports, @layer, @container.
//  2. A selector may not name a protected surface anywhere (data-part-critical, chat-failed-card, chat-save-guard, chat-critical-body, chat-critical-action, and a critical sheet's own chat-critical-title, -header, -handle).
//  3. Token rules: custom properties (and color-scheme) only on :root and on html[data-input=..] / html[data-layout=..] and their combinations (DD-159, they cannot reach a part).
//     The resulting tokens are checked: critical text keeps 4.5:1 on its surface, critical sizes stay usable (tokenCheck).
//  4. Every other rule is judged by what its subject can reach. A subject is a SAFE LEAF only if the app guarantees it never contains, is, or sits inside a protected element
//     (the leaf parts listed below, or anything inside a user or system message: a protected element is only ever in a character message or a sheet). Every other subject
//     (an ancestor, a descendant, any subject that names no part, [data-fail], [data-kind], html[...]) may be, hold or sit inside a protected element, and its declarations
//     are checked against an ALLOWLIST: colours (never transparent or equal to the surface), borders, radii, shadows, font family / style / weight, bounded font size,
//     bounded spacing, safe widths. Everything else (display, visibility, opacity, transform, clip, filter, position, flex and grid layout, overflow, order, heights, ...) is rejected.
//  5. For every subject: position fixed / sticky, z-index, animation, transition, filter, backdrop-filter, mix-blend-mode, transform, content, contain, direction, all,
//     and oversized shadows, outlines and borders (more than 64 px) are rejected, because they can cover or disable a protected surface from anywhere.
import { decls } from './csslit'
import { failClosedPass, settableTest, parseConcrete, inlinePrivate } from './failclosed'
import type { ContrastPair, LintError, NameMatch, Rgba, SameChannel, SurfaceCheck, TokenMap } from './failclosed'
import { geometryPass, sheetHeights } from './geometry'
import type { GeometryChain, GeometrySheet, SheetHeightRow, SheetTerm } from './geometry'
import { tokenFile } from './tokens'

export { sheetHeights, COMPOUND, effective, resolve, cr }
export type { ContrastPair, LintError, NameMatch, Rgba, SameChannel, SurfaceCheck, TokenMap }

/** A registry as an area passes it to lintPack: every field optional; effective() adds chat's names and the shared defaults. */
export interface RegistryInput {
    /** DD-243 key controls (reach tier, colours judged as their own pair). */
    controls?: Iterable<string>
    critical?: Iterable<string>
    safe?: Iterable<string>
    /** DD-243 reach tier: removed from the safe list wherever they appear. */
    reach?: Iterable<string>
    surfaces?: readonly SurfaceCheck[]
    /** No position, offsets or percentage widths on any safe part. */
    strictSafe?: boolean
    positionable?: Iterable<string>
    minimums?: Readonly<Record<string, string | number>>
    maximums?: Readonly<Record<string, string | number>>
    /** The area's token defaults, layered over chat's. */
    tokens?: Iterable<readonly [string, string]>
    fixedWidth?: Iterable<string>
    settable?: readonly NameMatch[]
    colours?: readonly NameMatch[]
    transparentOk?: readonly NameMatch[]
    opaque?: Iterable<string>
    pairs?: readonly ContrastPair[]
    same?: readonly SameChannel[]
    chains?: readonly GeometryChain[]
    sheets?: readonly GeometrySheet[]
    /** DD-258 private helper prefix; '' turns private variables off. */
    privatePrefix?: string
}

/** The effective registry every pass reads (chat's names plus the area's). transparentOk and same are absent only on CHAT_REGISTRY itself. */
export interface Registry {
    controls: Set<string>
    critical: Set<string>
    safe: Set<string>
    reach: Set<string>
    surfaces: readonly SurfaceCheck[]
    strictSafe: boolean
    positionable: Set<string>
    minimums: Record<string, string | number>
    maximums: Record<string, string | number>
    app: TokenMap
    fixedWidth: Set<string>
    settable: readonly NameMatch[]
    colours: readonly NameMatch[]
    transparentOk?: readonly NameMatch[]
    opaque: readonly string[]
    pairs: readonly ContrastPair[]
    same?: readonly SameChannel[]
    chains: readonly GeometryChain[]
    sheets: readonly GeometrySheet[]
    privatePrefix: string
}

/** The verdict on one stylesheet. */
export interface LintResult {
    ok: boolean
    errors: LintError[]
    name: string
}

/** The content estimate of a sheet-height model: title and body length in characters, number of stacked buttons, extra fixed px. */
export interface SheetRef {
    title: number
    body: number
    nBtn: number
    extra?: number
}

export const sheetReport = (css: string, registry?: RegistryInput): SheetHeightRow[] => sheetHeights(normalise(css), effective(registry))
export const CRITICAL_PARTS: string[] = ['chat-failed-card', 'chat-save-guard', 'chat-critical-body', 'chat-critical-action', 'chat-critical-title', 'chat-critical-header', 'chat-critical-handle']
// DD-243: the reach tier takes the controls a person needs to navigate, stop work, send, apply, undo and see a failed save. A pack may recolour, reborder and respace these parts (DD-155 allowlist);
// it may not hide, move or re-lay them out, and no pack rule may change an outline. Each registry lists its own part names in `reach`; effective() removes them from the safe list wherever they were.
//   chat: navigation (the sidebar, the chat list and its rows, the header with its menu), the generation strip that holds Stop, the composer with its field and Send, and the toast and status row that carry Undo.
export const REACH_CHAT: string[] = ['chat-header', 'chat-header-menu', 'chat-gen-strip', 'chat-sidebar', 'chat-sidebar-header', 'chat-sidebar-toggle', 'chat-sidebar-strip', 'chat-list', 'chat-list-row', 'chat-list-row-main', 'chat-list-row-menu',
    'chat-composer', 'chat-composer-input', 'chat-composer-plus', 'chat-send', 'chat-toast', 'chat-status-row']
// parts the app guarantees are never protected, never hold a protected element and never sit inside one
export const SAFE_LEAVES: Set<string> = new Set(['chat-message-avatar', 'chat-message-name', 'chat-message-badges', 'chat-message-actions', 'chat-message-actions-hover', 'chat-message-actions-float', 'chat-message-spacer', 'chat-message-alts', 'chat-message-name-row',
    'chat-header', 'chat-header-avatar', 'chat-header-title', 'chat-header-menu', 'chat-preset-chip', 'chat-gen-strip', 'chat-sidebar', 'chat-sidebar-header', 'chat-sidebar-toggle', 'chat-sidebar-search', 'chat-sidebar-strip', 'chat-sidebar-footer',
    'chat-list', 'chat-list-row', 'chat-list-row-main', 'chat-list-row-name', 'chat-list-row-time', 'chat-list-row-last', 'chat-list-row-count', 'chat-list-row-mark', 'chat-list-row-menu', 'chat-list-folder', 'chat-list-character',
    'chat-composer', 'chat-composer-input', 'chat-composer-plus', 'chat-composer-persona', 'chat-send', 'chat-toast', 'chat-status-row', 'chat-sheet-scrim'].filter((p) => !REACH_CHAT.includes(p)))
// The part lists are a parameter (DS-075): a screen passes its own { critical: [...], safe: [...] } and gets chat's names plus its own; nothing module-level is mutated.
// surfaces: [token, surface, label, ratio]: the colour tokens a pack states must keep this contrast on the surfaces a screen's protected text sits on (surface: canvas, sheet, glass, raised, toast)
export const CHAT_SURFACES: SurfaceCheck[] = [['--nexus-text', 'canvas', 'the canvas', 4.5], ['--nexus-text-secondary', 'canvas', 'the canvas', 4.5], ['--nexus-ring', 'canvas', 'the canvas', 3], ['--nexus-ring', 'sheet', 'the sheet', 3]]
// DD-161: only these safe leaves may be positioned (position absolute|relative, offsets and negative margins within 64 px): Banana Cocoa's side layout places the avatar and the message actions and pulls the alternatives row left. Every other safe part gets the strict ban.
export const POSITIONABLE: string[] = ['chat-message-avatar', 'chat-message-actions', 'chat-message-actions-hover', 'chat-message-actions-float', 'chat-message-alts']
// DD-242 / DD-243 registry fields (all optional; every registry gets the shared defaults below):
//   settable   [name | RegExp]   the area's role tokens a pack may set (on top of SHARED_SETTABLE in failclosed and every token the area bounds with minimums / maximums / the value space)
//   colours    [name | RegExp]   colour tokens that are not recognisable by name or by a colour default (their values must still resolve to sRGB)
//   opaque     [name]            tokens that colour a protected surface: they must resolve to alpha 1 (the shared sheet and toast are always included)
//   pairs      [[fg, bg, ratio, label]]  token-on-token contrast, judged over the worst case (on top of the shared pairs below)
//   reach      [part]            parts of the DD-243 reach tier: removed from the safe list wherever they appear
//   privatePrefix string         DD-258: the one prefix under which a pack may keep private helper variables (default PRIVATE_PREFIX = "--pack-"; "" turns it off). They are inlined and the values they produce are judged.
export const PRIVATE_PREFIX = '--pack-'
export const SHARED_OPAQUE: string[] = ['--color-surface-sheet', '--color-surface-toast']
// protected text on the protected surfaces (DD-242): 4.5:1 for text, 3:1 for the ring. The sheet carries every critical dialog, the toast carries the Undo action.
export const SHARED_PAIRS: ContrastPair[] = [['--nexus-text', '--color-surface-sheet', 4.5, 'the sheet'], ['--nexus-text-secondary', '--color-surface-sheet', 4.5, 'the sheet'], ['--nexus-text-muted', '--color-surface-sheet', 4.5, 'the sheet'],
    ['--nexus-danger', '--color-surface-sheet', 4.5, 'the sheet'], ['--nexus-ring', '--color-surface-sheet', 3, 'the sheet'], ['--nexus-text', '--color-surface-toast', 4.5, 'the toast'], ['--nexus-text-muted', '--color-surface-toast', 4.5, 'the toast'], ['--nexus-ring', '--color-surface-toast', 3, 'the toast']]
// shared floors and ceilings for the DD-235 tokens and the motion basics (a pack may tune them inside these limits; they also make the names pack-settable)
//   --opacity-dim / --opacity-soft: chat's two dimming steps, which Banana Cocoa tunes (0.78, 0.82). Listed deliberately with a floor of 0.5 (just under Deep Nexus' 0.55) and a ceiling of 1; the other --opacity-* steps stay internal.
export const SHARED_MINIMUMS: Record<string, string | number> = { '--nexus-focus-ring-width': '1px', '--nexus-focus-ring-offset': '-4px', '--nexus-touch': '32px', '--opacity-dim': 0.5, '--opacity-soft': 0.5 }
// DD-260: ceilings for the size role tokens that had none (px; the defaults are far below). A header or a gap beyond these pushes the content off a phone; the sheet-height rule (DD-256) judges the sum.
export const SIZE_CEILINGS: Record<string, string> = (() => {
    const px = (names: string, v: string): Record<string, string> => Object.fromEntries(names.split(/\s+/).filter(Boolean).map((n) => ['--' + n, v]))
    return { ...px('header-height', '96px'), ...px('transcript-padding-top', '160px'), ...px('transcript-padding-top-strip', '220px'), ...px('transcript-padding-x transcript-padding-bottom', '64px'), ...px('message-gap message-meta-gap message-inset-start composer-gap', '64px'),
        ...px('message-name-row-height', '72px'), ...px('composer-padding-x composer-padding-y composer-field-padding-x composer-field-padding-y row-padding-start row-padding-end status-row-padding-start', '48px'), ...px('composer-field-height', '160px'),
        ...px('sheet-width-dock sheet-width-panel sheet-width-popup sheet-width-tall sheet-width-wide sidebar-width sidebar-width-phone sidebar-width-max', '720px'),
        ...px('size-avatar size-avatar-sm size-avatar-md size-avatar-lg size-avatar-xl', '96px'), ...px('size-touch size-touch-sm size-touch-lg', '72px'),
        ...px('font-size-2xs font-size-xs font-size-sm font-size-md font-size-base font-size-lg', '24px'), ...px('font-size-xl', '28px'), ...px('font-size-2xl', '40px'),
        ...px('bubble-pad-y bubble-pad-start bubble-pad-end', '48px'), ...px('radius-bubble radius-bubble-tail', '32px'), ...px('stroke-medium stroke-bold stroke-heavy stroke-xheavy', '8px') }
})()
export const SHARED_MAXIMUMS: Record<string, string | number> = { ...SIZE_CEILINGS, '--opacity-dim': 1, '--opacity-soft': 1, '--nexus-focus-ring-width': '8px', '--nexus-focus-ring-offset': '8px', '--nexus-touch': '72px', '--nexus-blur': '40px', '--nexus-duration-press': '600ms', '--nexus-duration-enter': '600ms', '--nexus-duration-exit': '600ms',
    '--nexus-duration-lowpower-cap': '600ms', '--nexus-scrim-duration': '600ms', '--nexus-dialog-enter-distance': '48px', '--nexus-sheet-enter-distance': '48px' }
// chat's own role tokens (DD-148 role block, DD-153 decoration hooks, the bubble hooks of DD-018/Banana Cocoa, the named sizes) and its non-ladder scales. The numbered ladder (--space-N, --size-N, --offset-N, --size-rel-N, --radius-N, --leading-N) is NOT listed.
export const CHAT_SETTABLE: NameMatch[] = [/^--(control-gap|control-padding-x|header-height|transcript-padding-(top|top-strip|x|bottom)|message-(gap|meta-gap|name-row-height|inset-start)|composer-(gap|padding-x|padding-y|field-padding-x|field-padding-y|field-height)|sheet-padding-(x|bottom)|item-gap|item-padding-x|row-padding-(start|end)|status-row-padding-start)$/,
    /^--(icon-stroke|icon-scale|icon-size-(2xs|xs|sm|md|lg|xl|2xl)|selection-bg|selection-text|scrollbar-color|scrollbar-width|caret-color)$/,
    /^--(bubble-pad-(y|start|end)|bubble-max-width|radius-bubble|radius-bubble-tail|cl-spacer-display|thread-max-width|radius-pill)$/,
    /^--(sheet-width-(dock|panel|popup|tall|wide)|sidebar-width|sidebar-width-phone|sidebar-width-max|size-avatar(-lg|-md|-sm|-xl)?|size-touch(-lg|-sm)?|focus-ring-w|focus-ring-w-forced|focus-ring-offset|focus-ring-offset-inset|focus-ring-offset-wide)$/,
    /^--(font-size-(2xs|xs|sm|md|base|lg|xl|2xl)|font-weight-(regular|medium|semibold|bold)|stroke-(medium|bold|heavy|xheavy)|chat-speaker-[0-7])$/, /^--(danger)$/]
// DD-260 / DD-256 geometry models of chat (estimates of the DOM, see geometry): the chains of ancestors of the failed card and of the critical sheet, and the height of the critical sheet (handle, title, body, two stacked buttons)
// Calibrated against rendered pages at 360x640 touch, Korean: the ancestry below is the real DOM ancestry of the failed card and of the critical sheet; the sheet is a bottom
// sheet with max-height 60% whose .sheet-body scrolls, so what a pack can break is the room left for the scroller. The terms are the content estimate: grab bar and title, body padding, text, one stacked action per button.
export const CHAT_CHAINS: GeometryChain[] = [{ name: 'the transcript chain (chat-shell > chat-transcript > chat-message > chat-message-stage > chat-message-body > chat-message-text > the failed card)', parts: ['chat-shell', 'chat-transcript', 'chat-message', 'chat-message-stage', 'chat-message-body', 'chat-message-text'], defaults: { 'chat-transcript': 24, 'chat-message-body': 14 } }, { name: 'the sheet chain (chat-sheet > chat-sheet-body)', parts: ['chat-sheet', 'chat-sheet-body'], defaults: { 'chat-sheet-body': 20 } }]
// The live chat shell mounts the failed card in chat-composer-host, an ancestor no CHAT_CHAINS entry names; CHAT_CHAINS is the mockup model the reference parity is pinned to and stays as it is. This list holds exactly the failed-card ancestry (chat-shell > chat-composer-host), without defaults because the page pads neither part, and is judged only by chatLiveChainErrors.
export const CHAT_LIVE_CHAINS: GeometryChain[] = [{ name: 'the failed-card chain (chat-shell > chat-composer-host > the failed card)', parts: ['chat-shell', 'chat-composer-host'] }]
export const CHAT_SHEET_TERMS = (p: SheetRef): SheetTerm[] => [{ px: 24 }, { text: { chars: p.title, size: '--font-size-lg', lead: 1.5, hfixed: 32 } }, { px: 4 }, { t: '--sheet-padding-bottom' }, { px: 12 }, { text: { chars: p.body, size: '--font-size-md', lead: 1.5, hpad: ['--sheet-padding-x'], hfixed: 20 } }, { px: p.extra || 0 }, { px: 10 }, { t: '--size-touch-lg', n: p.nBtn }, { px: 8 * p.nBtn }]
export const CHAT_SHEET_REF: SheetRef = { title: 16, body: 40, nBtn: 3 }
export const CHAT_SHEETS: GeometrySheet[] = [{ name: 'chat critical sheet', terms: CHAT_SHEET_TERMS(CHAT_SHEET_REF), fixed: [{ px: 24 }, { text: { chars: CHAT_SHEET_REF.title, size: '--font-size-lg', lead: 1.5, hfixed: 32 } }], cap: 384 }]
export const CHAT_FIXED_WIDTH: string[] = ['chat-sheet', 'chat-sheet-body']

// ---- tokens: defaults of the app plus the pack's :root, resolved on demand
const readTokens = (css: string, into: TokenMap): TokenMap => {
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim())
    return into
}
const APP: TokenMap = readTokens(tokenFile('chat/theme-tokens.css'), readTokens(tokenFile('theme/nexus-tokens.css'), new Map()))

export const CHAT_REGISTRY: Registry = { fixedWidth: new Set(CHAT_FIXED_WIDTH), critical: new Set(CRITICAL_PARTS), safe: SAFE_LEAVES, surfaces: CHAT_SURFACES, strictSafe: false, positionable: new Set(POSITIONABLE), minimums: { ...SHARED_MINIMUMS }, maximums: { ...SHARED_MAXIMUMS }, settable: CHAT_SETTABLE, colours: [], opaque: SHARED_OPAQUE, pairs: [...SHARED_PAIRS, ['--color-on-accent', '--nexus-accent', 4.5, 'the accent fill']], reach: new Set(REACH_CHAT), chains: CHAT_CHAINS, sheets: CHAT_SHEETS, privatePrefix: PRIVATE_PREFIX, app: APP, controls: new Set(REACH_CHAT) }

// chat's registry is used as is; any other registry gets chat's names and the shared defaults under its own
const effective = (reg?: RegistryInput | null): Registry => {
    if (!reg || reg === CHAT_REGISTRY) return CHAT_REGISTRY
    const controls = new Set([...REACH_CHAT, ...(reg.controls || [])])
    const reach = new Set([...controls, ...(reg.reach || [])])
    return { controls, critical: new Set([...CRITICAL_PARTS, ...(reg.critical || [])]), safe: new Set([...SAFE_LEAVES, ...(reg.safe || [])].filter((p) => !reach.has(p))), reach, surfaces: reg.surfaces || CHAT_SURFACES, strictSafe: !!reg.strictSafe, positionable: new Set([...POSITIONABLE, ...(reg.positionable || [])]),
        minimums: { ...SHARED_MINIMUMS, ...(reg.minimums || {}) }, maximums: { ...SHARED_MAXIMUMS, ...(reg.maximums || {}) }, app: reg.tokens ? new Map([...APP, ...reg.tokens]) : APP,
        fixedWidth: new Set([...CHAT_FIXED_WIDTH, ...(reg.fixedWidth || [])]), settable: [...CHAT_SETTABLE, ...(reg.settable || [])], colours: reg.colours || [], transparentOk: reg.transparentOk || [], opaque: [...new Set([...SHARED_OPAQUE, ...(reg.opaque || [])])], pairs: [...SHARED_PAIRS, ...(reg.pairs || [])], same: reg.same || [], chains: [...CHAT_CHAINS, ...(reg.chains || [])], sheets: [...CHAT_SHEETS, ...(reg.sheets || [])], privatePrefix: reg.privatePrefix === undefined ? PRIVATE_PREFIX : reg.privatePrefix }
}
const ROOT_ATTRS = ['data-input', 'data-layout']
export const normalise = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?/g, (m: string, h: string) => {
    try {
        return String.fromCodePoint(parseInt(h, 16))
    } catch {
        return ''
    }
}).replace(/\\([^\n])/g, '$1').toLowerCase()

function resolve(v: string, T: TokenMap, depth = 0): string {
    if (depth > 12) return v
    return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m: string, n: string, fb: string | undefined) => (T.has(n) ? resolve(T.get(n)!, T, depth + 1) : fb !== undefined ? resolve(fb, T, depth + 1) : m))
}
const PX_FACTOR: Record<string, number> = { px: 1, rem: 16, em: 16, vw: 10, vh: 8, vmin: 8, vmax: 10, pt: 1.33, cm: 37.8, mm: 3.78, in: 96, ch: 8, ex: 8, '%': 0 }
const px = (n0: string, u: string): number => {
    const n = parseFloat(n0)
    const f = PX_FACTOR[u]
    return f === undefined ? 0 : n * f
}
const maxLen = (v: string, T: TokenMap): number => {
    const r = resolve(v, T)
    let m = 0
    for (const x of r.matchAll(/(-?\d*\.?\d+)(px|rem|em|vw|vh|vmin|vmax|pt|cm|mm|in|ch|ex)\b/g)) m = Math.max(m, Math.abs(px(x[1], x[2])))
    return m
}
const maxPct = (v: string, T: TokenMap): number => {
    let m = 0
    for (const x of resolve(v, T).matchAll(/(-?\d*\.?\d+)%/g)) m = Math.max(m, Math.abs(parseFloat(x[1])))
    return m
}
// hex and rgb() only: anything else (hsl(), a named colour) is not a colour to this check
function parseColor(s: string): Rgba | null {
    s = s.trim().toLowerCase()
    if (s === 'transparent') return [0, 0, 0, 0]
    let m = /^#([0-9a-f]{3,8})$/.exec(s)
    if (m) {
        let h = m[1]
        if (h.length <= 4) h = [...h].map((c) => c + c).join('')
        const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
        return [n[0], n[1], n[2], h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (m) {
        const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
        return [+m[1], +m[2], +m[3], a]
    }
    return null
}
const lum = (c: readonly number[]): number => {
    const f = c.slice(0, 3).map((x) => {
        x /= 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
const over = (f: Rgba, b: Rgba): Rgba => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]
const cr = (a: readonly number[], b: readonly number[]): number => {
    const x = lum(a), y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const col = (T: TokenMap, name: string, onto?: Rgba | null): Rgba | null => {
    const c = parseColor(resolve(T.get(name) || '', T))
    if (!c) return null
    return c[3] < 1 ? over(c, onto || [0, 0, 0, 1]) : c
}

type Block = [string, Map<string, string>]

// ---- what a pack's tokens do to protected text and controls (DD-155 N8; thresholds are a stand-in, DD-151 keeps the app floor off)
export function tokenCheck(css: string, T0: TokenMap = APP): LintError[] {
    const errs: LintError[] = []
    const base = new Map(T0)
    const blocks: Block[] = []
    for (const d of decls(css)) {
        if (!d.prop.startsWith('--')) continue
        const sel = d.ctx.selector.trim()
        let b = blocks.find((x) => x[0] === sel)
        if (!b) blocks.push(b = [sel, new Map()])
        b[1].set(d.prop, d.value.trim())
    }
    const configs: Block[] = [['base', (blocks.find((b) => b[0] === ':root') || [':root', new Map<string, string>()])[1]], ...blocks.filter((b) => b[0] !== ':root').map((b): Block => [b[0], b[1]])]
    const rootMap = new Map(base)
    for (const [k, v] of configs[0][1]) rootMap.set(k, v)
    for (const [label, over1] of configs) {
        const T = new Map(rootMap)
        if (label !== 'base') for (const [k, v] of over1) T.set(k, v)
        const sheet = col(T, '--color-surface-sheet'), canvas = col(T, '--nexus-canvas')
        if (!sheet || !canvas) continue
        const bubbleRaw = col(T, '--color-bubble-char', canvas)
        const bubble = bubbleRaw || canvas
        const pairs: [string, Rgba, string][] = [['--nexus-text', sheet, 'the sheet'], ['--nexus-text-secondary', sheet, 'the sheet'], ['--nexus-accent', sheet, 'the sheet'], ['--nexus-text', bubble, 'the message bubble'], ['--nexus-text-secondary', bubble, 'the message bubble'], ['--danger', bubble, 'the message bubble'], ['--nexus-accent', bubble, 'the message bubble']]
        for (const [n, bg, on] of pairs) {
            const c = col(T, n, bg)
            if (c && cr(c, bg) < 4.5) errs.push({ selector: label, prop: n, why: `critical text would be ${cr(c, bg).toFixed(2)}:1 on ${on} (needs 4.5:1)` })
        }
        const num = (n: string): number => maxLen(T.get(n) || '0', T)
        const min = (n: string, v: number, why: string): void => { if (T.has(n) && num(n) < v) errs.push({ selector: label, prop: n, why }) }
        const max = (n: string, v: number, why: string): void => { if (T.has(n) && num(n) > v) errs.push({ selector: label, prop: n, why }) }
        min('--size-touch-lg', 32, 'critical choices would be shorter than 32 px')
        min('--size-touch', 24, 'controls would be smaller than 24 px')
        for (const f of ['--font-size-sm', '--font-size-md', '--font-size-base']) min(f, 11, 'critical text would be smaller than 11 px')
        max('--sheet-padding-x', 48, 'sheet padding beyond 48 px pushes the choices off a narrow sheet')
        max('--sheet-padding-bottom', 48, 'sheet padding beyond 48 px')
        max('--control-padding-x', 48, 'button padding beyond 48 px')
        max('--item-padding-x', 48, 'item padding beyond 48 px')
        max('--item-gap', 48, 'item gap beyond 48 px')
        min('--focus-ring-w', 1, 'no focus ring')
    }
    return errs
}

// ---- selectors
function compounds(sel: string): string[] {
    const out: string[] = []
    let cur = '', depth = 0
    for (const ch of sel.trim()) {
        if (ch === '[') depth++
        if (ch === ']') depth--
        if (depth === 0 && /[\s>+~]/.test(ch)) {
            if (cur) out.push(cur)
            cur = ''
        }
        else cur += ch
    }
    if (cur) out.push(cur)
    return out
}
const COMPOUND = /^(:root|html)?((?:\[data-[\w-]+(?:="[^"\]]*")?\])*)((?::hover|:focus-within|:focus-visible)*)$/
// [name, value]; the value is undefined for a valueless attribute selector such as [data-part]
type Attr = [string, string]
interface Subject {
    root: string
    attrs: Attr[]
    pseudo: string
}
type Tier = 'root' | 'safe' | 'reach'
interface Analysis {
    why: string[]
    ok: boolean
    tier?: Tier
    rootOnly?: boolean
    sp?: string[]
    control?: boolean
    pseudo?: string
}
function analyse(sel: string, reg: Registry = CHAT_REGISTRY): Analysis {
    const why: string[] = []
    const parts = compounds(sel)
    if (!parts.length) return { why: ['empty selector'], ok: false }
    const attrs: Attr[] = []
    let syntax = true
    let subject: Subject | null = null
    parts.forEach((c, i) => {
        const m = COMPOUND.exec(c)
        if (!m || (!m[1] && !m[2])) {
            syntax = false
            why.push(`not allowed in a pack selector: ${c}`)
            return
        }
        const list = [...m[2].matchAll(/\[(data-[\w-]+)(?:="([^"\]]*)")?\]/g)].map((a): Attr => [a[1], a[2]])
        attrs.push(...list)
        if (i === parts.length - 1) subject = { root: m[1] || '', attrs: list, pseudo: m[3] }
    })
    // forEach assignments are invisible to control-flow narrowing
    const subj = subject as Subject | null
    for (const [k, v] of attrs) {
        if (k === 'data-part-critical') why.push('names data-part-critical')
        if (k === 'data-part' && reg.critical.has(v)) why.push(`names the protected part ${v}`)
    }
    const rootOnly = !!(syntax && parts.length === 1 && subj && subj.root && subj.attrs.every(([k]) => ROOT_ATTRS.includes(k)) && !subj.pseudo)
    const safeCtx = attrs.some(([k, v]) => k === 'data-role' && (v === 'user' || v === 'system'))
    const sp = subj ? subj.attrs.filter(([k]) => k === 'data-part').map(([, v]) => v) : []
    const tier: Tier = rootOnly ? 'root' : (safeCtx || (sp.length > 0 && sp.every((p) => reg.safe.has(p)))) ? 'safe' : 'reach'
    // a CONTROL (DD-243): a reach-tier part that is a key control (navigation, Tasks, Stop, composer, Send, Apply, Undo/Redo, the failed-save chip). It is restyled, never hidden or moved (the reach allowlist), but it holds no
    // critical text, so its colours are judged as a pair of its own (text on its fill, 4.5:1), not against the danger text of a dialog.
    const control = tier === 'reach' && sp.length > 0 && sp.every((p) => reg.controls.has(p))
    return { why, ok: syntax && why.length === 0, tier, rootOnly, sp, control, pseudo: subj ? subj.pseudo : '' }
}
// DD-243: a rule in a focus state (:focus-visible, :focus-within) may add to the indication but not take it away: no outline at all (see lintOnce), and no border or shadow that is none or fully transparent
const colourWords = (v: string): Rgba[] => [...v.matchAll(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/g)].map((m) => parseConcrete(m[0])).filter((c): c is Rgba => Boolean(c))
function focusLoss(prop: string, value: string, T: TokenMap): string {
    const v = resolve(value.replace(/\s*!important\s*$/, '').trim(), T)
    if (/^(box-shadow|border(-(top|right|bottom|left))?)$/.test(prop) && /^(none|0)$/.test(v)) return `${prop}: ${v} would remove the indication of focus`
    if (/^border(-(top|right|bottom|left))?-style$/.test(prop) && v === 'none') return `${prop}: none would remove the indication of focus`
    if (/^(box-shadow|border(-(top|right|bottom|left))?(-color)?)$/.test(prop) && colourWords(v).some((c) => c[3] === 0)) return `${prop}: a fully transparent colour would remove the indication of focus`
    return ''
}
// DD-242: is this custom property pack-settable under the registry? (used by the regression fuzz)
export function isPackSettable(name: string, registry?: RegistryInput): boolean {
    const r = effective(registry)
    return settableTest({ ...r, isBounded: VALUES.isBounded })(name)
}
export function lintSelector(sel: string, reg?: RegistryInput): string[] {
    const a = analyse(sel, effective(reg))
    return a.why
}

// ---- declarations
const GLOBAL_PROPS = /^(z-index|animation(-[\w-]+)?|transition(-[\w-]+)?|will-change|filter|backdrop-filter|mix-blend-mode|transform(-[\w-]+)?|translate|scale|rotate|perspective|zoom|content|contain(-[\w-]+)?|container(-[\w-]+)?|direction|unicode-bidi|writing-mode|isolation|all|offset(-[\w-]+)?|clip-path|mask(-[\w-]+)?|-webkit-mask(-[\w-]+)?)$/
function colourUnsafe(value: string, T: TokenMap): string {
    const v = value.replace(/\s*!important\s*$/, '').trim()
    if (/^(inherit|initial|unset|currentcolor)$/.test(v)) return ''
    const r = resolve(v, T)
    const c = parseColor(r)
    if (!c) return /^[a-z]+$/.test(r) && r !== 'transparent' ? '' : `a colour that cannot be checked (${r.slice(0, 30)})`
    if (c[3] < 0.9) return 'a transparent or translucent text colour'
    const sheet = col(T, '--color-surface-sheet'), canvas = col(T, '--nexus-canvas'), bubble = col(T, '--color-bubble-char', canvas || [0, 0, 0, 1]) || canvas
    for (const [bg, n] of [[sheet, 'the sheet'], [bubble, 'the bubble']] as [Rgba | null, string][]) if (bg && cr(c, bg) < 3) return `a text colour that is ${cr(c, bg).toFixed(2)}:1 on ${n}`
    return ''
}
function reachAllowed(prop: string, value: string, T: TokenMap, ctl: boolean | undefined, block: Map<string, string> | undefined): string {
    const v = value.replace(/\s*!important\s*$/, '').trim()
    if (prop === 'color') {
        // a control that paints its own fill (a yellow Send with dark text) is judged as that pair: opaque fill, 4.5:1
        if (ctl && block) {
            const bgv = block.get('background-color') || block.get('background')
            const f = bgv ? parseColor(resolve(bgv.replace(/\s*!important\s*$/, '').trim(), T)) : null
            const c = parseColor(resolve(v, T))
            if (f && c && f[3] >= 0.9 && c[3] >= 0.9 && cr(c, f) >= 4.5) return ''
        }
        return colourUnsafe(v, T)
    }
    if (/^(background|background-color|border(-(top|right|bottom|left))?(-color|-style)?|border-image|outline|outline-color|outline-style|box-shadow|text-shadow)$/.test(prop)) return /url\(/.test(v) ? 'an image' : ''
    if (/^border(-(top|right|bottom|left))?(-width)?$/.test(prop)) return maxLen(v, T) > 16 ? 'a border wider than 16 px' : ''
    if (/^border-(top|bottom)-(left|right)-radius$|^border-radius$/.test(prop)) return ''
    if (/^(background-image)$/.test(prop)) return /url\(/.test(v) ? 'an image' : ''
    if (prop === 'cursor') return /(^|[\s,])none(\s|,|$)/.test(resolve(v, T)) ? 'cursor: none hides the pointer over a control' : ''
    if (/^(font-family|font-style|font-weight|text-align|text-decoration(-[\w-]+)?|text-transform|caret-color|accent-color|scrollbar-color|color-scheme)$/.test(prop)) return ''
    if (prop === 'font-size') {
        const r = resolve(v, T).trim()
        if (/^0(px|rem|em|%)?$/.test(r) || /xx-small|x-small/.test(r)) return 'a font size that hides the text'
        const m = maxLen(v, T)
        return m && (m < 11 || m > 40) ? `a font size of ${m}px (11 to 40 px)` : ''
    }
    if (prop === 'line-height') {
        const r = resolve(v, T)
        const n = parseFloat(r)
        return /^[\d.]+$/.test(r.trim()) && (n < 1 || n > 3) ? 'a line height outside 1 to 3' : /px|rem|em/.test(r) && maxLen(v, T) < 11 ? 'a line height under 11 px' : ''
    }
    if (prop === 'letter-spacing') return maxLen(v, T) > 2 ? 'letter spacing beyond 2 px' : ''
    if (/^(width|max-width)$/.test(prop)) return /^(auto|none|fit-content|max-content|min-content|inherit|initial|unset|100%)$/.test(v) || (/^\d+(\.\d+)?%$/.test(v) && parseFloat(v) >= 50) ? '' : `a ${prop} that can collapse the surface`
    if (/^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/.test(prop)) {
        const r = resolve(v, T)
        if (/(^|[\s(*\/])-\s*[\d.]|\*\s*-\s*[\d.]/.test(r)) return `negative ${prop} on a surface that can hold a protected element`
        if (maxLen(v, T) > 64 || maxPct(v, T) > 20) return `${prop} larger than 64 px (or 20%): the token range for spacing`
        return ''
    }
    return 'is not on the declaration allowlist for a surface that can contain or be a protected element'
}
function globalBan(prop: string, value: string, T: TokenMap): string {
    if (GLOBAL_PROPS.test(prop)) return `${prop} can cover, fade or disable a protected surface from anywhere`
    const v = value.trim()
    if (prop === 'position' && /fixed|sticky/.test(v)) return `position: ${v} can cover a protected surface`
    if (/^(box-shadow|text-shadow|outline|outline-offset|outline-width|border|border-width|border-(top|right|bottom|left)(-width)?)$/.test(prop) && maxLen(v, T) > 64) return `${prop} larger than 64 px can cover a protected surface`
    return ''
}

// ---- the value space (DS-075): bounds on role tokens, contrast on the surfaces text sits on, a short declaration list for the safe tier,
// named colours and gradients resolved. It adds to the rules above and replaces none of them; its own helpers (resolve, lum, cr, parseColour...) stay inside this factory.
interface ValueSpace {
    extraPass: (css: string, reg: Registry) => LintError[]
    isBounded: (n: string) => boolean
}
type Bound = [RegExp, number, number, string]
type Limit = [string, string | number, 'min' | 'max']
const VALUES: ValueSpace = (() => {
    function resolve(v: string, T: TokenMap, depth = 0): string {
        if (depth > 14) return v
        return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m: string, n: string, fb: string | undefined) => (T.has(n) ? resolve(T.get(n)!, T, depth + 1) : fb !== undefined ? resolve(fb, T, depth + 1) : m))
    }
    const splitTop = (s: string): string[] => {
        const out: string[] = []
        let cur = '', d = 0
        for (const ch of s.trim()) {
            if (ch === '(') d++
            if (ch === ')') d--
            if (d === 0 && /\s/.test(ch)) {
                if (cur) out.push(cur)
                cur = ''
            }
            else cur += ch
        }
        if (cur) out.push(cur)
        return out
    }
    const UNIT: Record<string, number> = { px: 1, rem: 16, em: 16, vw: 12.8, vh: 8, ms: 1, s: 1000, '': 1 }
    // one value: a length in px, a duration in ms or a plain number; null when it cannot be bounded. calc() is evaluated only once reduced to digits, dots, spaces, + - * / and parentheses.
    function num1(s: string): number | null {
        s = s.trim()
        const m = /^(-?\d*\.?\d+)(px|rem|em|vw|vh|ms|s)?$/.exec(s)
        if (m) return parseFloat(m[1]) * UNIT[m[2] || '']
        if (/^calc\(/.test(s)) {
            const e = s.slice(5, -1).replace(/(-?\d*\.?\d+)(px|rem|em|vw|vh|ms|s)\b/g, (x: string, n: string, u: string) => String(parseFloat(n) * UNIT[u]))
            if (/^[\d.\s+\-*\/()]+$/.test(e)) {
                try {
                    return (Function(`return (${e})`) as () => number)()
                } catch {
                    return null
                }
            }
        }
        return null
    }
    const nums = (v: string, T: TokenMap): (number | null)[] => splitTop(resolve(v, T)).map(num1)

    // ---- colours
    const NAMED: Record<string, string> = Object.fromEntries('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'.split(' ').map((x) => x.split(':')))
    function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
        h = ((h % 360) + 360) % 360
        s /= 100
        l /= 100
        const k = (n: number): number => (n + h / 30) % 12
        const a = s * Math.min(l, 1 - l)
        const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
        return [f(0) * 255, f(8) * 255, f(4) * 255]
    }
    // -> [r, g, b, a] or null
    function parseColour(s: string): Rgba | null {
        s = s.trim().toLowerCase()
        if (s === 'transparent') return [0, 0, 0, 0]
        let m = /^#([0-9a-f]{3,8})$/.exec(s)
        if (m) {
            let h = m[1]
            if (h.length <= 4) h = [...h].map((c) => c + c).join('')
            if (h.length !== 6 && h.length !== 8) return null
            const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
            return [n[0], n[1], n[2], h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
        }
        m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s)
        if (m) {
            const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
            return [+m[1], +m[2], +m[3], a]
        }
        m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s)
        if (m) {
            const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
            const [r, g, b] = hsl2rgb(+m[1], +m[2], +m[3])
            return [r, g, b, a]
        }
        if (NAMED[s]) return parseColour('#' + NAMED[s])
        return null
    }
    const lum = (c: readonly number[]): number => {
        const f = c.slice(0, 3).map((x) => {
            x /= 255
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
    }
    const flat = (f: Rgba, b: Rgba): Rgba => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]
    const cr = (a: readonly number[], b: readonly number[]): number => {
        const x = lum(a), y = lum(b)
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    const colOf = (T: TokenMap, name: string, onto?: Rgba | null): Rgba | null => {
        const c = parseColour(resolve(T.get(name) || '', T))
        if (!c) return null
        return c[3] < 1 ? flat(c, onto || [0, 0, 0, 1]) : c
    }
    const COLOUR_RE = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/g
    // every colour a value mentions (gradient stops included); words that are not colours (to, linear-gradient, 50%) are skipped; any other bare word that is not a colour is an undefined entry
    function coloursIn(v: string, T: TokenMap): (Rgba | undefined)[] {
        const r = resolve(v, T).replace(/!important/, '')
        const out: (Rgba | undefined)[] = []
        for (const m of r.matchAll(COLOUR_RE)) {
            const w = m[0]
            if (/^(to|top|left|right|bottom|center|none|auto|solid|dashed|dotted|double|inherit|initial|unset|currentcolor|repeat|no|space|round|fixed|scroll|border|padding|content|box|at|in|circle|ellipse|closest|farthest|side|corner|linear|radial|conic|gradient|deg|turn|rad|px|em|rem|hairline|medium|thin|thick|inset|outline|groove|ridge|hidden|var|calc|min|max|clamp|url)$/.test(w) || /gradient$/.test(w)) continue
            const c = parseColour(w)
            if (c) out.push(c)
            else if (/^[a-z]+$/.test(w)) out.push(undefined)
        }
        return out
    }

    // ---- 2. role-token bounds (px / ms / plain number); chat's 48 px limits are reused for padding and gaps
    const BOUNDS: Bound[] = [
        [/^--settings-dialog-padding$|^--settings-dialog-actions-(gap|margin-top)$|^--settings-(button|header|row|section|page)-padding(-[a-z]+)*$|^--settings-section-(gap|gap-first|title-gap)$|^--settings-header-gap$|^--settings-rows-gap$|^--field-padding-[xy]$|^--control-(gap|padding-x)$|^--settings-index-item-(padding|gap)$/, 0, 48, 'padding or gap beyond 48 px (chat\'s limit for sheet, control and item padding)'],
        [/^--settings-page-padding-bottom$|^--settings-index-padding(-phone)?$/, 0, 120, 'clearance beyond 120 px'],
        [/^--dialog-width$/, 280, 640, 'a dialog narrower than 280 px or wider than 640 px'],
        [/^--page-max-width$/, 480, 960, 'a page narrower than 480 px or wider than 960 px'],
        [/^--index-width(-mid)?$/, 160, 360, 'an index narrower than 160 px or wider than 360 px'],
        [/^--search-width$|^--palette-width$|^--picker-width$|^--picker-detail-width$|^--sheet-width-panel$/, 200, 960, 'a panel width outside 200 to 960 px'],
        [/^--settings-header-height(-phone)?$/, 32, 96, 'a header shorter than 32 px or taller than 96 px'],
        [/^--settings-row-min-height$/, 32, 120, 'a row minimum outside 32 to 120 px (chat: choices at least 32 px)'],
        [/^--field-min-height$/, 24, 64, 'a field minimum outside 24 to 64 px (chat: controls at least 24 px)'],
        [/^--settings-index-item-height(-touch|-phone)?$/, 24, 72, 'an index item outside 24 to 72 px'],
        [/^--dur-(fast|base|slow)-nominal$|^--dur-lowpower-cap$/, 0, 600, 'a duration beyond 600 ms (a fade this slow hides a critical surface)'],
        [/^--dur-spin$/, 200, 3000, 'a spinner period outside 0.2 to 3 s'],
        [/^--settings-radius-dialog$|^--radius-(control|menu|popup|card|sheet|field|search)$|^--settings-row-ring-radius$/, 0, 32, 'a corner radius beyond 32 px'],
        [/^--hairline$|^--settings-row-last-border-width$/, 0, 4, 'a hairline or border beyond 4 px'],
        [/^--icon-size-(xs|sm|md|lg|xl|2xl)$|^--settings-icon-size-(inline|mark|feature)$/, 10, 48, 'an icon outside 10 to 48 px'],
        [/^--icon-scale$/, 0.75, 1.5, 'an icon scale outside 0.75 to 1.5'],
        [/^--icon-stroke$/, 1, 3, 'an icon stroke outside 1 to 3 px'],
        [/^--focus-ring-offset$/, -6, 6, 'a focus-ring offset outside -6 to 6 px'],
        [/^--alpha-text-dim(-strong)?$/, 0.6, 1, 'dim text weaker than 0.6'],
        [/^--alpha-switch-off$/, 0.1, 1, 'a switch off track weaker than 0.1'],
        [/^--alpha-accent-tint$/, 0.02, 0.3, 'a selection tint outside 0.02 to 0.3'],
        [/^--alpha-mark(-soft)?$/, 0, 0.4, 'a search highlight stronger than 0.4 (the text on it keeps 4.5:1)'],
        [/^--chip-(cap|name)-ratio$/, 0.1, 0.6, 'a chip share outside 0.1 to 0.6 of the header'],
        [/^--popup-(edge|gap)$/, 0, 48, 'a popup margin beyond 48 px'],
    ]
    function tokenBounds(T: TokenMap, label: string, reg: Registry): LintError[] {
        const errs: LintError[] = []
        const bad = (prop: string, why: string): void => { errs.push({ selector: label, prop, why }) }
        for (const [k, v] of T) {
            if (!k.startsWith('--')) continue
            for (const [re, lo, hi, why] of BOUNDS) {
                if (!re.test(k)) continue
                if (T.get(k) === reg.app.get(k)) break   // an unchanged default is the app's business
                const ns = nums(v, T)
                if (!ns.length || ns.some((n) => n === null || Number.isNaN(n))) {
                    bad(k, `a value that cannot be bounded (${v.slice(0, 40)}): use plain lengths`)
                    break
                }
                if ((ns as number[]).some((n) => n < lo - 1e-9 || n > hi + 1e-9)) bad(k, `${why}: ${v.slice(0, 40)}`)
                break
            }
        }
        const tracks = (n: string): void => {
            if (!T.has(n) || T.get(n) === reg.app.get(n)) return
            for (const tr of splitTop(resolve(T.get(n)!, T))) {
                if (/^minmax\(/.test(tr)) {
                    const hi = tr.slice(7, -1).split(',')[1]
                    const x = hi ? num1(hi.trim()) : null
                    if (x !== null && (x < 120 || x > 560)) bad(n, `a column outside 120 to 560 px (${tr})`)
                }
                else if (/fr$/.test(tr)) continue
                else {
                    const x = num1(tr)
                    if (x === null) bad(n, `a column that cannot be bounded (${tr})`)
                    else if (x < 120 || x > 560) bad(n, `a column outside 120 to 560 px (${tr})`)
                }
            }
        }
        tracks('--body-columns')
        tracks('--body-columns-mid')
        const ic = T.get('--index-column'), pc = T.get('--page-column')
        if ((ic !== undefined && ic !== reg.app.get('--index-column')) || (pc !== undefined && pc !== reg.app.get('--page-column'))) {
            const a = +resolve(ic ?? '1', T), b = +resolve(pc ?? '2', T)
            if (!([1, 2].includes(a) && [1, 2].includes(b) && a !== b)) bad('--index-column', 'the index and the page must take columns 1 and 2, one each')
        }
        const tw = T.get('--settings-section-title-width')
        if (tw !== undefined && tw !== reg.app.get('--settings-section-title-width') && !/^(auto|fit-content|max-content|100%)$/.test(resolve(tw, T).trim()) && !((num1(resolve(tw, T)) ?? 0) >= 120)) bad('--settings-section-title-width', 'a section title narrower than 120 px')
        // contrast on the surfaces the area's text sits on (chat checks the sheet and the bubble)
        const canvas = colOf(T, '--nexus-canvas'), sheet = colOf(T, '--color-surface-sheet', canvas)
        if (!canvas) return errs
        const glass = (n: string): Rgba | null => {
            const c = parseColour(resolve(T.get(n) || '', T))
            return c ? flat(c, canvas) : null
        }
        const surf = glass('--nexus-surface'), raised = glass('--nexus-surface-raised'), toast = colOf(T, '--color-surface-toast', canvas)
        const SURF: Record<string, Rgba | null> = { canvas, sheet, glass: surf, raised, toast }
        for (const [n, key, on, need] of reg.surfaces) {
            const bg = SURF[key]
            if (!bg) continue
            const c = colOf(T, n, bg)
            if (!c) {
                if (T.has(n) && /^(--nexus-ring)$/.test(n)) bad(n, 'a focus ring colour that cannot be checked')
                continue
            }
            if (cr(c, bg) < need) bad(n, `${n.replace('--nexus-', '')} would be ${cr(c, bg).toFixed(2)}:1 on ${on} (needs ${need}:1)`)
        }
        const st = parseColour(resolve(T.get('--selection-text') || 'currentcolor', T))
        if (st && st[3] < 0.9) bad('--selection-text', 'selected text would be transparent')
        return errs
    }

    // ---- 3 and 4. declarations
    const SAFE_DECL_BAN = /^(position|top|right|bottom|left|inset(-[\w]+)*|float|clear)$/
    const tierOf = (sel: string, reg: Registry): Tier => {
        const parts: string[] = []
        let cur = '', d = 0
        for (const ch of sel.trim()) {
            if (ch === '[') d++
            if (ch === ']') d--
            if (d === 0 && /[\s>+~]/.test(ch)) {
                if (cur) parts.push(cur)
                cur = ''
            }
            else cur += ch
        }
        if (cur) parts.push(cur)
        const last = parts[parts.length - 1] || ''
        const sp = [...last.matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1])
        if (parts.length === 1 && /^(:root|html)/.test(last) && !sp.length) return 'root'
        return sp.length > 0 && sp.every((p) => reg.safe.has(p)) ? 'safe' : 'reach'
    }
    function safeDecl(prop: string, value: string, T: TokenMap, reg: Registry, sp: string[] = []): string {
        const canPos = !reg.strictSafe && sp.length > 0 && sp.every((p) => reg.positionable.has(p))
        const v = value.replace(/\s*!important\s*$/, '').trim()
        // chat's own safe leaves (the avatar and the actions of Banana Cocoa's side layout) may be positioned, with offsets bounded to 64 px; a screen that passes strictSafe (Settings) gets no position at all
        if (canPos && (prop === 'position' ? /^(absolute|relative|static)$/.test(v) : /^(top|right|bottom|left|inset(-[\w]+)*)$/.test(prop) && (v === 'auto' || nums(v, T).every((n) => n !== null && Math.abs(n) <= 64)))) return ''
        if (!reg.strictSafe && /^(width|max-width)$/.test(prop) && /^\d+(\.\d+)?%$/.test(v) && parseFloat(v) <= 100) return ''   // a bubble's max-width: a share of its row, never more than the row
        if (SAFE_DECL_BAN.test(prop) && !(prop === 'position' && /^(static|relative)$/.test(v))) return `${prop}: ${v.slice(0, 24)} can place a safe part over a protected one (the safe tier has no position, no inset, no float)`
        if (/^(width|min-width|max-width|height|min-height|max-height|flex-basis|block-size|inline-size)$/.test(prop)) {
            if (/^(auto|none|fit-content|max-content|min-content|inherit|initial|unset|100%|100vw|0)$/.test(v)) return /^(height|min-height|max-height|block-size)$/.test(prop) && /^(100%|100vw)$/.test(v) && prop !== 'max-height' ? `${prop}: ${v} is a large size` : ''
            const ns = nums(v, T)
            if (ns.some((n) => n === null) || ns.some((n) => n !== null && (n > 480 || n < 0))) return `${prop}: ${v.slice(0, 30)} is a size beyond 480 px (or one that cannot be bounded) on a safe part`
            if (/%/.test(v)) return `${prop}: ${v.slice(0, 30)} is a relative size on a safe part`
            return ''
        }
        // DD-260: padding on a safe part is bounded like the reach tier (64 px or 20%): 4000 px of padding turns an ordinary toast into a wall
        if (/^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(prop)) {
            if (maxLen(v, T) > 64 || maxPct(v, T) > 20) return `${prop} larger than 64 px (or 20%) on a safe part`
            return ''
        }
        if (/^margin(-|$)/.test(prop) || /^(translate|scale|rotate)$/.test(prop)) {
            const r = resolve(v, T)
            if (/(^|[\s(*\/])-\s*[\d.]|\*\s*-\s*[\d.]/.test(r) && (!canPos || nums(v, T).some((n) => n === null || n < -64))) return `negative ${prop} can pull a safe part over a protected one`
            const ns = nums(v, T).filter((n): n is number => n !== null)
            if (ns.some((n) => n > 48)) return `${prop} beyond 48 px`
        }
        return ''
    }
    function reachExtra(prop: string, value: string, T: TokenMap, block: Map<string, string>, ctl: boolean | undefined): string {
        const v = value.replace(/\s*!important\s*$/, '').trim()
        const cs = prop === 'color' ? coloursIn(v, T) : /^(background|background-color|background-image)$/.test(prop) ? coloursIn(v, T) : null
        if (!cs) return ''
        if (cs.some((c) => c === undefined)) return `a colour word that is not a colour (${v.slice(0, 24)}) cannot be checked`
        const own = block.get(prop === 'color' ? 'background' : 'color') || (prop === 'color' ? block.get('background-color') : undefined)
        const canvas = colOf(T, '--nexus-canvas')
        if (!canvas) return ''
        const sheet = colOf(T, '--color-surface-sheet', canvas)
        const g = (): Rgba => {
            const c = parseColour(resolve(T.get('--nexus-surface') || '', T))
            return c ? flat(c, canvas) : canvas
        }
        const surfaces = [canvas, sheet, g()].filter((s): s is Rgba => Boolean(s))
        const text = colOf(T, '--nexus-text', canvas)
        for (let c of cs as Rgba[]) {
            if (prop === 'color') {
                if (c[3] < 0.9) return 'a transparent or translucent text colour'
                if (own) {
                    // the rule sets its own readable pair
                    const o = coloursIn(own, T).filter(Boolean)[0]
                    if (o && o[3] >= 0.9 && cr(c, o) >= 4.5) continue
                }
                const worst = Math.min(...surfaces.map((s) => cr(c, s)))
                if (worst < 3) return `a text colour that is ${worst.toFixed(2)}:1 on a Settings surface (the dialog, the canvas or a row)`
            }
            else {
                if (!text) continue
                c = c[3] < 0.9 ? flat(c, canvas) : c
                const dg = ctl ? null : colOf(T, '--nexus-danger', c)
                if (dg && cr(dg, c) < 3) return `a background that makes the danger text ${cr(dg, c).toFixed(2)}:1 (needs 3:1)`
                if (own) {
                    const o = coloursIn(own, T).filter(Boolean)[0]
                    if (o && o[3] >= 0.9 && cr(o, c) >= 4.5) continue
                }
                if (cr(text, c) < 3) return `a background that makes the critical text ${cr(text, c).toFixed(2)}:1 (needs 3:1; or set a readable colour in the same rule)`
            }
        }
        return ''
    }
    const partsOf = (sel: string): string[] => [...(sel.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1])
    function extraPass(css: string, reg: Registry): LintError[] {
        const errs: LintError[] = []
        const fail = (selector: string, prop: string, why: string): void => { errs.push({ selector, prop, why }) }
        const text = normalise(css)
        const ds = decls(text)
        const blocks: Block[] = []
        for (const d of ds) {
            if (!d.prop.startsWith('--')) continue
            const sel = d.ctx.selector.trim()
            let b = blocks.find((x) => x[0] === sel)
            if (!b) blocks.push(b = [sel, new Map()])
            b[1].set(d.prop, d.value.trim())
        }
        const root = (blocks.find((b) => b[0] === ':root') || [':root', new Map<string, string>()])[1]
        const base = new Map(reg.app)
        for (const [k, v] of root) base.set(k, v)
        for (const e of tokenBounds(base, 'base', reg)) fail(e.selector, e.prop, e.why)
        for (const [label, m] of blocks.filter((b) => b[0] !== ':root')) {
            const T = new Map(base)
            for (const [k, v] of m) T.set(k, v)
            for (const e of tokenBounds(T, label, reg)) if (!errs.some((x) => x.prop === e.prop && x.why === e.why)) fail(e.selector, e.prop, e.why)
        }
        const props = new Map<string, Map<string, string>>()
        for (const d of ds) {
            if (d.prop.startsWith('--') || d.ctx.keyframes) continue
            const k = d.ctx.selector.trim()
            if (!props.has(k)) props.set(k, new Map())
            props.get(k)!.set(d.prop, d.value.trim())
        }
        for (const d of ds) {
            if (d.prop.startsWith('--') || d.ctx.keyframes) continue
            for (const sel of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
                const an = analyse(sel, reg)
                const tier = an.tier || tierOf(sel, reg)
                if (tier === 'root') continue   // chat's own tier (a user or system message is a safe context too)
                const w = tier === 'safe' ? safeDecl(d.prop, d.value, base, reg, partsOf(sel)) : reachExtra(d.prop, d.value, base, props.get(d.ctx.selector.trim()) || new Map(), an.control)
                if (w) fail(sel, d.prop, w)
            }
        }
        // registry.minimums / registry.maximums (DD-182, DD-195): a token that carries a critical cue keeps its floor / ceiling in the WORST CASE over everything the pack can do. Every declaration of the token
        // anywhere (:root, a root attribute, an @media block, any selector) counts, and so does every declaration of every token in its var() chain, so an override of a leaf under html[data-layout=phone]
        // or inside @media is judged too. Only absolute units are accepted on these tokens (px, rem at 16 px, ms, s, plain numbers): vw, vh, %, em, ch and the rest fail closed, as does anything unresolvable.
        const lims: Limit[] = [...Object.entries(reg.minimums || {}).map(([n, f]): Limit => [n, f, 'min']), ...Object.entries(reg.maximums || {}).map(([n, f]): Limit => [n, f, 'max'])]
        if (lims.length) {
            const declsOf = (n: string): string[] => [...ds.filter((d) => d.prop === n).map((d) => d.value.replace(/\s*!important\s*$/, '').trim()), ...(reg.app.has(n) ? [reg.app.get(n)!] : [])]
            const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/
            // every value v can take, as strings without var(); null when some variable cannot be resolved
            // Memoised on (value, depth), and the key must keep depth (the depth limit changes the result): nothing else feeds it, and without it a chain of tokens each declared several times expands exponentially (a pack of about 1 KB could take minutes).
            const expanded = new Map<string, string[] | null>()
            const expand = (v: string, depth: number): string[] | null => {
                const key = `${depth}\u0000${v}`
                if (expanded.has(key)) return expanded.get(key)!
                const result = expandOnce(v, depth)
                expanded.set(key, result)
                return result
            }
            const expandOnce = (v: string, depth: number): string[] | null => {
                if (depth > 12) return null
                const m = VAR.exec(v)
                if (!m) return [v]
                let opts: (string | null)[] = declsOf(m[1]).flatMap((x): (string | null)[] => expand(x, depth + 1) ?? [null])
                if (!opts.length) {
                    if (m[2] === undefined) return null
                    opts = expand(m[2].trim(), depth + 1) ?? [null]
                }
                if (opts.some((o) => o === null)) return null
                if (opts.length > 64) opts = opts.slice(0, 64)
                const out: string[] = []
                for (const o of opts as string[]) {
                    const r = expand(v.slice(0, m.index) + o + v.slice(m.index + m[0].length), depth + 1)
                    if (r === null) return null
                    out.push(...r)
                    if (out.length > 256) return null
                }
                return out
            }
            for (const [n, limit, kind] of lims) {
                const own = ds.filter((d) => d.prop === n)
                if (!own.length && !reg.app.has(n)) continue
                const bound = typeof limit === 'number' ? limit : num1(String(limit))
                const word = kind === 'min' ? 'below the critical minimum' : 'above the critical maximum'
                const sel = own.length ? own[0].ctx.selector.trim() : 'base'
                let worst: number | null = null, why = ''
                for (const raw of declsOf(n)) {
                    const vs = expand(raw, 0)
                    if (vs === null) {
                        why = `cannot be resolved (${raw.slice(0, 30)})`
                        break
                    }
                    for (const v of vs) {
                        if (/\d(?:\.\d+)?(?!px|rem|ms|s\b)[a-z%]+/i.test(v.replace(/\d(?:\.\d+)?(px|rem|ms|s)\b/gi, '0'))) {
                            why = `a relative unit (${v.slice(0, 30)}) cannot be judged`
                            break
                        }
                        const x = num1(v)
                        if (x === null || Number.isNaN(x)) {
                            why = `cannot be resolved to a number (${v.slice(0, 30)})`
                            break
                        }
                        if (worst === null || (kind === 'min' ? x < worst : x > worst)) worst = x
                    }
                    if (why) break
                }
                // an unparseable bound compares as 0, as null does in arithmetic
                const b = bound ?? 0
                if (why) fail(sel, n, `${word} cannot be ruled out: ${n} ${why}; the ${kind === 'min' ? 'floor' : 'ceiling'} is ${limit}`)
                else if (worst !== null && (kind === 'min' ? worst < b - 1e-9 : worst > b + 1e-9)) fail(sel, n, `${word}: ${n} can be ${worst} (in px, ms or plain units) under some selector, @media block or variable override; the ${kind === 'min' ? 'floor' : 'ceiling'} is ${limit}`)
            }
        }
        return errs
    }
    // a token the value space bounds is a deliberately listed role token (DD-242): it is pack-settable inside those bounds
    const isBounded = (n: string): boolean => BOUNDS.some(([re]) => re.test(n)) || /^--(body-columns|body-columns-mid|index-column|page-column|settings-section-title-width)$/.test(n)
    return { extraPass, isBounded }
})()

// A stylesheet whose structure is broken still applies in a browser (an unclosed block is closed at the end of the file), so it must fail closed: unbalanced braces or parentheses, an unterminated
// string or an unterminated comment. Read on the raw text, before comments are removed.
export function structureErrors(css: string): string[] {
    const errs: string[] = []
    let depth = 0, paren = 0, i = 0
    const n = css.length
    while (i < n) {
        const c = css[i]
        if (c === '\\') { i += 2; continue }
        if (c === '/' && css[i + 1] === '*') {
            const e = css.indexOf('*/', i + 2)
            if (e < 0) {
                errs.push('an unterminated comment')
                break
            }
            i = e + 2
            continue
        }
        if (c === '"' || c === "'") {
            let j = i + 1, closed = false
            while (j < n) {
                if (css[j] === '\\') { j += 2; continue }
                if (css[j] === c) { closed = true; break }
                if (css[j] === '\n') break
                j++
            }
            if (!closed) {
                errs.push('an unterminated string')
                break
            }
            i = j + 1
            continue
        }
        if (c === '{') depth++
        else if (c === '}') {
            depth--
            if (depth < 0) {
                errs.push('a closing brace without an opening one')
                break
            }
        }
        else if (c === '(') paren++
        else if (c === ')') {
            paren--
            if (paren < 0) {
                errs.push('a closing parenthesis without an opening one')
                break
            }
        }
        i++
    }
    if (!errs.length && depth !== 0) errs.push(`${depth} unclosed block${depth > 1 ? 's' : ''}`)
    if (!errs.length && paren !== 0) errs.push('an unclosed parenthesis')
    return errs
}

// DD-258: private variables (--pack-*) are inlined first (see failclosed inlinePrivate); the stylesheet is judged once per combination of the values they can take and the errors are merged.
export function lintPack(css: string, name = '', registry?: RegistryInput): LintResult {
    const reg = effective(registry)
    if (!reg.privatePrefix) return lintOnce(css, name, reg, false)
    const pre = inlinePrivate(normalise(css), reg.privatePrefix)
    if (pre.variants.length === 1 && pre.variants[0] === normalise(css) && !pre.error) return lintOnce(css, name, reg, false)
    const errors: LintError[] = []
    const seen = new Set<string>()
    const add = (e: LintError): void => {
        const k = e.selector + '|' + e.prop + '|' + e.why
        if (!seen.has(k)) {
            seen.add(k)
            errors.push(e)
        }
    }
    for (const w of structureErrors(css)) add({ selector: '(stylesheet)', prop: '', why: `unbalanced or unterminated: ${w}` })
    if (pre.error) add({ selector: ':root', prop: reg.privatePrefix, why: `private variables cannot be judged: ${pre.error}` })
    for (const v of pre.variants) for (const e of lintOnce(v, name, reg, true).errors) add(e)
    return { ok: errors.length === 0, errors, name }
}
// The live-shell geometry of chat: CHAT_LIVE_CHAINS judged over the same text preparation as lintPack (normalise, then every private-variable variant) with the app's token map, errors de-duplicated. The caller runs it only on a sheet every other pass accepted, so it adds refusals for the live shell and cannot change another pass's output.
export function chatLiveChainErrors(css: string): LintError[] {
    const pre = inlinePrivate(normalise(css), PRIVATE_PREFIX)
    const errors: LintError[] = []
    const seen = new Set<string>()
    for (const variant of pre.variants) for (const e of geometryPass(variant, { app: APP, chains: CHAT_LIVE_CHAINS })) {
        const key = e.selector + '|' + e.prop + '|' + e.why
        if (!seen.has(key)) { seen.add(key); errors.push({ selector: e.selector, prop: e.prop, why: e.why }) }
    }
    return errors
}
// The two size messages below begin with a space and the fixed-width one with ":  " (no property name): the wording is part of the verdict and matches the reference byte for byte.
const NO_PART_SIZE_WHY = ' on a selector that names no part can resize a protected element directly (DD-265): name a part instead'
const FIXED_WIDTH_WHY = ':  on the root of a protected sheet (DD-265): its width is the page\'s; leave it auto or 100%'
function lintOnce(css: string, name: string, reg: Registry, skipStructure: boolean): LintResult {
    const errors: LintError[] = []
    const fail = (selector: string, prop: string, why: string): void => { errors.push({ selector, prop, why }) }
    if (!skipStructure) for (const w of structureErrors(css)) fail('(stylesheet)', '', `unbalanced or unterminated: ${w}`)
    const text = normalise(css)
    for (const m of text.matchAll(/@([a-z-]+)/g)) if (m[1] !== 'media') fail('@' + m[1], '', `@${m[1]} is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)`)
    const packRoot = new Map<string, string>()
    for (const d of decls(text)) if (d.prop.startsWith('--') && d.ctx.selector.trim() === ':root') packRoot.set(d.prop, d.value.trim())
    const T = new Map(reg.app)
    for (const [k, v] of packRoot) T.set(k, v)
    const blockOf = new Map<string, Map<string, string>>()
    for (const d of decls(text)) {
        if (d.prop.startsWith('--') || d.ctx.keyframes) continue
        const k = d.ctx.selector.trim()
        if (!blockOf.has(k)) blockOf.set(k, new Map())
        blockOf.get(k)!.set(d.prop, d.value.trim())
    }
    for (const d of decls(text)) {
        if (d.ctx.keyframes) continue
        const sels = d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)
        if (!sels.length) {
            fail('(no selector)', d.prop, 'a declaration outside a rule')
            continue
        }
        for (const sel of sels) {
            const a = analyse(sel, reg)
            for (const w of a.why) fail(sel, d.prop, w)
            if (!a.ok) continue
            if (a.tier === 'root') {
                if (!d.prop.startsWith('--') && d.prop !== 'color-scheme') fail(sel, d.prop, 'only custom properties (and color-scheme) may be set on the root or on a root attribute')
                continue
            }
            if (d.prop.startsWith('--')) {
                fail(sel, d.prop, 'a token may only be set on :root or html[data-input] / html[data-layout]')
                continue
            }
            // DD-243: no pack rule may change an outline (the focus ring is drawn with outlines and the --nexus-ring colour, which is contrast-checked)
            if (/^outline(-|$)/.test(d.prop)) {
                fail(sel, d.prop, 'a pack may not change outlines or focus rings (DD-243): the ring is set by its tokens, which have a floor')
                continue
            }
            if (/focus/.test(a.pseudo || '')) {
                const f = focusLoss(d.prop, d.value, T)
                if (f) {
                    fail(sel, d.prop, f + ' (DD-243)')
                    continue
                }
            }
            // DD-242: a selector that names no part (a data-kind, data-state or data-fail attribute) can match a protected surface itself, so it may not paint a background
            if (a.tier === 'reach' && !(a.sp || []).length && /^(background|background-color|background-image)$/.test(d.prop)) {
                fail(sel, d.prop, 'a background on a selector that names no part can match a protected surface directly (DD-242): name a part instead')
                continue
            }
            // DD-265: a selector that names no part (a data-kind / data-state attribute) can match a protected element itself, so it may not change a size either: no padding, border width, font size or width at all
            if (a.tier === 'reach' && !(a.sp || []).length && /^(padding(-[\w]+)*|border(-(top|right|bottom|left))?(-width)?|border-(block|inline)(-(start|end))?(-width)?|font-size|width|min-width|max-width)$/.test(d.prop)) {
                fail(sel, d.prop, NO_PART_SIZE_WHY)
                continue
            }
            // DD-265: the width of a protected sheet's root is the page's (360 px phone); a pack may only leave it auto, none or 100%
            if ((a.sp || []).some((p) => reg.fixedWidth.has(p)) && /^(width|min-width|max-width|inline-size|min-inline-size|max-inline-size)$/.test(d.prop) && !/^(auto|none|100%|initial|unset|inherit)(\s*!important)?$/.test(d.value.trim())) {
                fail(sel, d.prop, FIXED_WIDTH_WHY)
                continue
            }
            const g = globalBan(d.prop, d.value, T)
            if (g) {
                fail(sel, d.prop, g)
                continue
            }
            if (a.tier === 'reach') {
                const w = reachAllowed(d.prop, d.value, T, a.control, blockOf.get(d.ctx.selector.trim()))
                if (w) fail(sel, d.prop, `${d.prop}: ${w} (this subject can contain, be or sit inside a protected element)`)
            }
        }
    }
    for (const e of tokenCheck(text, reg.app)) fail(e.selector, e.prop, e.why)
    for (const e of VALUES.extraPass(css, reg)) errors.push(e)
    for (const e of geometryPass(text, reg)) errors.push(e)   // DD-256, DD-260: ancestor padding summed along a chain, the worst-case height of each protected sheet
    for (const e of failClosedPass(text, { ...reg, isBounded: VALUES.isBounded })) errors.push(e)   // DD-242: role tokens only, colours that resolve, opaque protected surfaces, worst-case contrast
    return { ok: errors.length === 0, errors, name }
}
