// Rule S, superset colour judging (UI-S6 I0a, MC-1569). The engine judges each rule block on its own, so two blocks that both
// reach one control can combine into an unreadable pair that neither shows alone (a dark text from one rule, a dark background
// from another). Rule S judges every text colour and every background any block can give a control part against each other,
// whatever the selector, state, @media block or order, and against the app's own defaults when no block of the stylesheet
// states the other colour. It covers the reach parts of the area's registry (the controls a person needs to navigate, stop
// work, send, apply or undo). Colours that reach a control through an ancestor part stay engine-bound (plan residue R1, R5).
import { bare, decls } from './csslit'
import { cr, effective, normalise, resolve, CHAT_REGISTRY, type LintError, type Registry, type Rgba, type TokenMap } from './engine'
import { inlinePrivate, parseConcrete } from './failclosed'
import { parseSelectorEntry } from './scope'
import { STUDIO_REGISTRY } from './registries/studio'
import type { ThemeArea } from './index'

const PACK_PAIR = 4.5
const FALLBACK_PAIR = 3

const NOT_A_COLOUR_WORD = /^(to|top|left|right|bottom|center|none|auto|solid|dashed|dotted|double|inherit|initial|unset|revert|currentcolor|repeat|no|space|round|fixed|scroll|local|border|padding|content|box|at|in|circle|ellipse|closest|farthest|side|corner|linear|radial|conic|gradient|deg|turn|rad|grad|px|em|rem|hairline|medium|thin|thick|inset|outline|groove|ridge|hidden|var|calc|min|max|clamp|url|from|stop|color|srgb|hsl|hwb|oklab|oklch|lab|lch|longer|shorter|increasing|decreasing|hue|x|y|repeating|image|set)$/
const PRIVATE_LEFTOVER = /var\(\s*--[\w-]+\s*(?:,\s*(?:[^()]|\([^()]*\))*)?\)/g
const COLOUR_TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/g

const TEXT_PROPS = /^(color|-webkit-text-fill-color)$/
const BACKGROUND_PROPS = /^(background|background-color|background-image)$/
const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer|currentcolor)$/
// The initial value of `color` is CanvasText, which the element's used colour scheme makes black or white; revert and revert-layer can fall back to it. The scheme is not known here, so the keywords are refused on a reach part.
const CANVAS_TEXT_KEYWORD = /^(initial|revert|revert-layer)$/
const CANVAS_TEXT_WHY = 'color: initial or revert resolves to the system text colour, which depends on the colour scheme; write the colour out'
const INHERITED_BACKGROUND_WHY = "a background of inherit takes the parent's value, which may be currentcolor"
const OWN_COLOUR_WORD = /(?<![\w-])currentcolor(?![\w-])/
const OWN_COLOUR_WHY = "a background of currentcolor paints the control's own text colour"

type SurfaceName = 'canvas' | 'sheet' | 'glass' | 'bubble'
interface Surface {
    name: SurfaceName
    colour: Rgba
}

interface TextMember {
    colour: Rgba
    /** True for the app's own text colour, which a block that states no text colour leaves in place. */
    fallback: boolean
    block: string
    label: string
}
interface BackgroundMember {
    colour: Rgba
    /** A pack colour, a pack colour flattened over a fallback surface, or a fallback surface a declaration without a colour leaves in place. */
    kind: 'pack' | 'flattened' | 'fallback'
    block: string
    label: string
}
interface PartPaint {
    texts: TextMember[]
    backgrounds: BackgroundMember[]
    textBlocks: Set<string>
    backgroundBlocks: Set<string>
}

const registryOf = (area: 'chat' | 'studio'): Registry => (area === 'chat' ? CHAT_REGISTRY : effective(STUDIO_REGISTRY))
const hex = (c: readonly number[]): string => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
const flatten = (top: Rgba, base: Rgba): Rgba => [top[0] * top[3] + base[0] * (1 - top[3]), top[1] * top[3] + base[1] * (1 - top[3]), top[2] * top[3] + base[2] * (1 - top[3]), 1]

/** A token's colour, flattened over `onto` when it is translucent; null when it is not a concrete colour. */
function tokenColour(tokens: TokenMap, name: string, onto: Rgba): Rgba | null {
    const colour = parseConcrete(resolve(tokens.get(name) || '', tokens))
    if (!colour) return null
    return colour[3] < 1 ? flatten(colour, onto) : colour
}

/** A value with var() resolved through `tokens`, literals and url() targets blanked, and unresolved private references dropped. */
const settled = (value: string, tokens: TokenMap): string => bare(resolve(value.replace(/\s*!important\s*$/, '').trim(), tokens)).replace(PRIVATE_LEFTOVER, ' ')

/** Every concrete colour a value names, gradient stops included, with var() resolved through `tokens`; words that are not colours and url() targets are skipped. */
function coloursIn(value: string, tokens: TokenMap): Rgba[] {
    const resolved = settled(value, tokens)
    const found: Rgba[] = []
    for (const match of resolved.matchAll(COLOUR_TOKEN)) {
        if (NOT_A_COLOUR_WORD.test(match[0]) || /gradient$/.test(match[0])) continue
        const colour = parseConcrete(match[0])
        if (colour) found.push(colour)
    }
    return found
}

function judgeVariant(area: 'chat' | 'studio', text: string): LintError[] {
    const registry = registryOf(area)
    const ds = decls(text).filter((d) => !d.ctx.keyframes)
    const tokens: TokenMap = new Map(registry.app)
    for (const d of ds) if (d.prop.startsWith('--') && d.ctx.selector.trim() === ':root') tokens.set(d.prop, d.value.replace(/\s*!important\s*$/, '').trim())
    const canvas = tokenColour(tokens, '--nexus-canvas', [0, 0, 0, 1])
    if (!canvas) return []
    const surfaces: Surface[] = [{ name: 'canvas', colour: canvas }]
    const sheet = tokenColour(tokens, '--color-surface-sheet', canvas)
    if (sheet) surfaces.push({ name: 'sheet', colour: sheet })
    const glass = tokenColour(tokens, '--nexus-surface', canvas)
    surfaces.push({ name: 'glass', colour: glass || canvas })
    const bubble = tokenColour(tokens, '--color-bubble-char', canvas)
    if (bubble) surfaces.push({ name: 'bubble', colour: bubble })
    const fallbackText = tokenColour(tokens, '--nexus-text', canvas)

    const paints = new Map<string, PartPaint>()
    const ownColourErrors: LintError[] = []
    for (const d of ds) {
        const isText = TEXT_PROPS.test(d.prop)
        if (!isText && !BACKGROUND_PROPS.test(d.prop)) continue
        const value = d.value.replace(/\s*!important\s*$/, '').trim()
        const colours = CSS_WIDE.test(value) ? [] : coloursIn(value, tokens)
        const paintsOwnColour = !isText && OWN_COLOUR_WORD.test(settled(value, tokens))
        const canvasText = d.prop === 'color' && CANVAS_TEXT_KEYWORD.test(settled(value, tokens).trim())
        const inheritsBackground = !isText && settled(value, tokens).trim() === 'inherit'
        for (const entry of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
            const parsed = parseSelectorEntry(entry)
            if (parsed.grammarWhy || !parsed.compounds.length) continue
            const reached = parsed.compounds[parsed.compounds.length - 1].attrs.filter(([name, v]) => name === 'data-part' && v !== undefined && registry.reach.has(v)).map(([, v]) => v as string)
            const block = `${entry}@${d.ctx.at.join(' ')}`
            const label = `${entry}{${d.prop}:${value}}`
            for (const part of reached) {
                let paint = paints.get(part)
                if (!paint) paints.set(part, paint = { texts: [], backgrounds: [], textBlocks: new Set(), backgroundBlocks: new Set() })
                if (isText) {
                    paint.textBlocks.add(block)
                    if (canvasText) ownColourErrors.push({ selector: `[data-part="${part}"]`, prop: d.prop, why: `${part}: ${CANVAS_TEXT_WHY} (MC-1569)` })
                    else if (!colours.length) { if (fallbackText) paint.texts.push({ colour: fallbackText, fallback: true, block, label }) }
                    else for (const colour of colours) paint.texts.push({ colour, fallback: false, block, label })
                } else if (inheritsBackground) {
                    ownColourErrors.push({ selector: `[data-part="${part}"]`, prop: d.prop, why: `${part}: ${INHERITED_BACKGROUND_WHY}; write the background out (MC-1569)` })
                } else if (paintsOwnColour) {
                    ownColourErrors.push({ selector: `[data-part="${part}"]`, prop: d.prop, why: `${part}: ${OWN_COLOUR_WHY}; give the control a background that differs from its text (MC-1569)` })
                } else if (colours.length || d.prop !== 'background-image') {
                    // background-image: none or an image states no fill, so it neither clears a colour another declaration gives nor leaves the app's surface behind the text
                    paint.backgroundBlocks.add(block)
                    if (!colours.length) for (const s of surfaces) paint.backgrounds.push({ colour: s.colour, kind: 'fallback', block, label: `${label} (the app's ${s.name} surface)` })
                    else {
                        for (const colour of colours) {
                            if (colour[3] >= 0.9) paint.backgrounds.push({ colour, kind: 'pack', block, label })
                            else for (const s of surfaces) paint.backgrounds.push({ colour: flatten(colour, s.colour), kind: 'flattened', block, label: `${label} (over the app's ${s.name} surface)` })
                        }
                    }
                }
            }
        }
    }

    const errors: LintError[] = [...ownColourErrors]
    const seen = new Set<string>()
    const check = (part: string, foreground: Rgba, textLabel: string, background: Rgba, backgroundLabel: string, needed: number): void => {
        const ratio = cr(foreground, background)
        if (ratio >= needed) return
        const key = `${part}|${textLabel}|${backgroundLabel}`
        if (seen.has(key)) return
        seen.add(key)
        errors.push({ selector: `[data-part="${part}"]`, prop: 'color', why: `${part}: text ${hex(foreground)} can be drawn on ${hex(background)} at ${ratio.toFixed(2)}:1 when ${textLabel} and ${backgroundLabel} both apply (needs ${needed}:1); give every rule that colours this control a text colour and a background that read together (MC-1569)` })
    }
    for (const [part, paint] of paints) {
        for (const t of paint.texts) {
            for (const b of paint.backgrounds) check(part, t.colour, t.fallback ? `the app's own text colour (${t.label})` : t.label, b.colour, b.label, b.kind === 'flattened' ? PACK_PAIR : t.fallback || b.kind === 'fallback' ? FALLBACK_PAIR : PACK_PAIR)
            // a block that gives the control a text colour and no background leaves the app's surfaces behind it
            if (!t.fallback && !paint.backgroundBlocks.has(t.block)) for (const s of surfaces) check(part, t.colour, t.label, s.colour, `the app's ${s.name} surface`, FALLBACK_PAIR)
        }
        // a block that gives the control a background and no text colour leaves the app's text colour on it
        if (fallbackText) for (const b of paint.backgrounds) if (b.kind !== 'fallback' && !paint.textBlocks.has(b.block)) check(part, fallbackText, "the app's own text colour", b.colour, b.label, b.kind === 'flattened' ? PACK_PAIR : FALLBACK_PAIR)
    }
    return errors
}

/**
 * Judges the reach parts of a chat or Studio stylesheet by superset (Rule S). `css` is the stylesheet with its @font-face
 * blocks taken out. Every value a private `--pack-*` variable can take is judged, as the engine judges them.
 */
export function cascadePass(area: ThemeArea, css: string): LintError[] {
    if (area !== 'chat' && area !== 'studio') return []
    const text = normalise(css)
    const errors: LintError[] = []
    const seen = new Set<string>()
    for (const variant of inlinePrivate(text, '--pack-').variants) {
        for (const e of judgeVariant(area, variant)) {
            const key = `${e.selector}|${e.prop}|${e.why}`
            if (!seen.has(key)) { seen.add(key); errors.push(e) }
        }
    }
    return errors
}
