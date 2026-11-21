// The default colour scheme of a theme pack (MC-3001, MC-3004): the nine colours the app's own screens would paint if the
// pack's chat look were the user's scheme. It is derived from the judged canonical chat sheet and the fixed base that sheet
// was judged on, with the same token chain the judge follows. Nothing persisted depends on the result: it is recomputed
// whenever the pack is read. This module imports the token stylesheets and the colour and CSS-literal helpers only.
import chatThemeTokens from '../../../docs/design/chat/theme-tokens.css?raw'
import nexusTokens from '../../../docs/design/theme/nexus-tokens.css?raw'
import type { ColorScheme } from '../gui/colorscheme'
import type { SchemeTone } from '../gui/surfaceTone'
import { over, lum, parseConcrete, toHex, type Rgba } from './colour'
import { decls } from './csslit'
import { LIGHT_BASE_JUDGE_PREFIX } from './lightBase'

type TokenMap = Map<string, string>

const ROOT_SELECTOR = /^(:root|html)$/i
const RESOLVE_DEPTH = 12
const BLACK: Rgba = [0, 0, 0, 1]
// The luminance at which black and white text contrast equally; a canvas above it is a light scheme.
const LIGHT_LUMINANCE = 0.179

const CORE_TOKENS = ['--nexus-canvas', '--nexus-surface', '--nexus-text'] as const

function readTokens(css: string, into: TokenMap): TokenMap {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
        into.set(m[1], m[2].trim())
    }
    return into
}

/** The custom properties of one unconditional rule of a stylesheet, matched by its exact selector text. */
function readRule(css: string, selector: string, into: TokenMap): TokenMap {
    for (const d of decls(css)) {
        if (d.prop.startsWith('--') && d.ctx.at.length === 0 && d.ctx.selector.trim() === selector) {
            into.set(d.prop, d.value.trim())
        }
    }
    return into
}

// The same chain the validator follows: a missing token takes its fallback, an unknown one is left in place.
function resolve(value: string, tokens: TokenMap, depth = 0): string {
    if (depth > RESOLVE_DEPTH) {
        return value
    }
    return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (whole: string, name: string, fallback: string | undefined) => {
        const known = tokens.get(name)
        if (known !== undefined) {
            return resolve(known, tokens, depth + 1)
        }
        return fallback !== undefined ? resolve(fallback, tokens, depth + 1) : whole
    })
}

interface BaseLayers {
    dark: TokenMap
    light: TokenMap
}

let layers: BaseLayers | null = null

/**
 * The fixed bases a pack sits on. `dark` is the docs/design token files, which are the reference the judge reads and carry
 * the values the app's `:root:where([data-theme-pack-base])` blocks restore (packColours.test.ts compares the two); it also
 * resolves any `var()` no other layer names. `light` is the declaration list a light-only pack is judged on (the text
 * lightBase.ts keeps in step with chat-light-base.css), laid over `dark`.
 */
export function baseTokenLayers(): Readonly<BaseLayers> {
    layers ??= {
        dark: readTokens(chatThemeTokens, readTokens(nexusTokens, new Map())),
        light: readRule(LIGHT_BASE_JUDGE_PREFIX, ':root', new Map()),
    }
    return layers
}

function composite(value: Rgba, backdrop: Rgba): string {
    return toHex(value[3] >= 1 ? value : over(value, backdrop))
}

/**
 * The scheme a pack's judged chat sheet stands for, or null when the pack has no default scheme.
 * - Core gate (MC-3001): `--nexus-canvas`, `--nexus-surface` and `--nexus-text` must each be declared in an unconditional
 *   `:root` or `html` rule (no at-rule, last declaration wins) and resolve to a concrete colour. Otherwise null.
 * - Every field resolves through one token map: the dark base, then the light base for a light pack, then the pack's own
 *   root declarations. A non-core token the pack does not set, or sets to a value that is
 *   not a concrete colour, takes the base value that colour mode paints in chat for it (MC-3004).
 * - The canvas is laid over black and every other colour over the canvas, each written as lower-case `#rrggbb`. `type`
 *   follows the luminance of the canvas, not the base.
 * Never throws.
 */
export function packDefaultScheme(canonicalChat: string, base: SchemeTone): ColorScheme | null {
    try {
        const declared: TokenMap = new Map()
        for (const d of decls(canonicalChat)) {
            if (d.prop.startsWith('--') && d.ctx.at.length === 0 && ROOT_SELECTOR.test(d.ctx.selector.trim())) {
                declared.set(d.prop, d.value.trim())
            }
        }
        const { dark, light } = baseTokenLayers()
        const baseMap: TokenMap = new Map(dark)
        if (base === 'light') {
            for (const [name, value] of light) {
                baseMap.set(name, value)
            }
        }
        const tokens: TokenMap = new Map(baseMap)
        for (const [name, value] of declared) {
            tokens.set(name, value)
        }
        const read = (map: TokenMap, name: string): Rgba | null => {
            const raw = map.get(name)
            return raw === undefined ? null : parseConcrete(resolve(raw, map))
        }
        for (const name of CORE_TOKENS) {
            if (!declared.has(name) || read(tokens, name) === null) {
                return null
            }
        }
        const canvas = read(tokens, '--nexus-canvas')
        if (canvas === null) {
            return null
        }
        const bg = over(canvas, BLACK)
        const field = (name: string): string => {
            const colour = read(tokens, name) ?? read(baseMap, name)
            if (colour === null) {
                throw new Error(`no colour for ${name}`)
            }
            return composite(colour, bg)
        }
        return {
            bgcolor: toHex(bg),
            darkbg: field('--nexus-surface'),
            darkbutton: field('--nexus-surface-raised'),
            darkBorderc: field('--nexus-edge'),
            borderc: field('--nexus-accent'),
            textcolor: field('--nexus-text'),
            textcolor2: field('--nexus-text-muted'),
            selected: field('--color-surface-toast'),
            draculared: field('--nexus-danger'),
            type: lum(bg) > LIGHT_LUMINANCE ? 'light' : 'dark',
        }
    } catch {
        return null
    }
}

const SCHEME_COLOUR_FIELDS = ['bgcolor', 'darkbg', 'darkbutton', 'darkBorderc', 'borderc', 'textcolor', 'textcolor2', 'selected', 'draculared'] as const

/** Whether two schemes carry the same nine colours (case-insensitively) and the same `type`; false for anything that is not a scheme. */
export function sameScheme(a: unknown, b: unknown): boolean {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false
    }
    const left: Record<string, unknown> = { ...a }
    const right: Record<string, unknown> = { ...b }
    for (const key of SCHEME_COLOUR_FIELDS) {
        const x = left[key]
        const y = right[key]
        if (typeof x !== 'string' || typeof y !== 'string' || x.toLowerCase() !== y.toLowerCase()) {
            return false
        }
    }
    return typeof left.type === 'string' && left.type === right.type
}
