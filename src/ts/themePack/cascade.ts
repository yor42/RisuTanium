// Rule S, superset colour judging (UI-S6 I0a, MC-1569). The engine judges each rule block on its own, so two blocks that both
// reach one control can combine into an unreadable pair that neither shows alone (a dark text from one rule, a dark background
// from another). Rule S judges every text colour and every background any block can give a control part against each other,
// whatever the selector, state, @media block or order, and against the app's own defaults when no block of the stylesheet
// states the other colour. It covers the reach parts of the area's registry (the controls a person needs to navigate, stop
// work, send, apply or undo). Colours that reach a control through an ancestor part stay engine-bound (plan residue R1, R5).
//
// A plain colour or fill on a reach part is refused (MC-2313, widened to every reach part by MC-2370; value-blind, MC-2349). The app's own styles for these controls can outrank a plain pack rule, so color, background, background-color and background-image on a part of the area registry's reach tier must be written with one trailing !important. The rule reads the written stylesheet, before private variables are inlined, in every at-rule, state, selector-list position and ancestor form. A refused declaration adds no Rule S or Rule P member: on a reach part only an !important colour or fill can paint (MC-2314).
//
// Rule P (CHORE-738, MC-2072, MC-2090) judges what a control paints over its own text, on the same reach parts, per
// `--pack-*` variant, in chat and Studio only:
// - An inset box-shadow layer (or a layer that still holds a var(), which may hold the word) is judged against every text colour
//   of the part: 4.5:1 against pack text, 3:1 against the app's text colour, 4.5:1 when translucent and flattened.
// - A text-shadow layer blurred over 2 px (an unreadable blur counts as over) needs 3:1 against every text colour of the part.
//   A translucent halo is judged over the part's fills and over every colour an inset of the part can lie under the text.
//   A halo is judged at its own colour (as written, or as a stack's composite over each backdrop), not along its
//   blur's fade: a fade that crosses the text's lightness is accepted residue (2026-11-17 halo-fade answer, MC-2117).
// - The qualifying layers of one declaration are judged as every colour they can paint together: each order-preserving subset, the
//   first layer on top, ending at its first layer of alpha 0.9 or more. The stacks of all of a part's declarations in one variant
//   are counted against 4096 before any is built; a declaration over what is left adds none and refuses the part (MC-2090,
//   MC-2177). Values of different blocks never stack, and the overlay members stay in their own per-part lists, so Rule S's lists
//   and block sets are untouched.
// - A part gets at most one pairing error per text colour and source; a declaration's immediate errors are pushed once per part.
//   Labels in these messages are clipped to 200 characters.
// - The app's own text colour pairs with an overlay only when no !important text colour is set on the part in any block of the variant; a plain one cannot paint on a reach part (MC-2314, restating MC-2090 PQ-2).
// - A decoration thickness over 3 px or 0.2em, from-font and an unreadable thickness are refused; so are currentcolor and unreadable
//   colours on a qualifying layer.
// - Translucent pairs are counted from member and fill counts before anything is flattened; over 4096 the part's translucent
//   pairings are refused and the inset backdrop is never built.
import { bare, decls } from './csslit'
import { cr, effective, normalise, resolve, CHAT_REGISTRY, type LintError, type Registry, type Rgba, type TokenMap } from './engine'
import { inlinePrivate, parseConcrete } from './failclosed'
import { layerStacks, MAX_BLUR_PX, MAX_THICKNESS_EM, MAX_THICKNESS_PX, OPAQUE_FROM, shadowLayers, stackCount, thicknessProblems, type LayerStack, type ShadowLayer } from './paintOver'
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

type PaintChannel = 'text' | 'fill'
const paintChannelOf = (prop: string): PaintChannel | null => prop === 'color' ? 'text' : BACKGROUND_PROPS.test(prop) ? 'fill' : null
const isWrittenImportant = (value: string): boolean => /!important\s*$/.test(value) && value.split('!').length === 2
const holdsOtherBang = (value: string): boolean => value.includes('!') && !isWrittenImportant(value)
/** The parts of the registry's reach tier that a selector-list entry has as its subject. */
const reachedParts = (registry: Registry, entry: string): string[] => {
    const parsed = parseSelectorEntry(entry)
    if (parsed.grammarWhy || !parsed.compounds.length) return []
    return parsed.compounds[parsed.compounds.length - 1].attrs.filter(([name, v]) => name === 'data-part' && v !== undefined && registry.reach.has(v)).map(([, v]) => v as string)
}
const plainPaintWhy = (part: string, prop: string, value: string, channel: PaintChannel): string => {
    const noun = channel === 'text' ? 'text colour' : 'background'
    if (holdsOtherBang(value)) return `${part}: "${prop}: ${clip(value)}" is not a valid !important declaration, and a ${noun} on this control must be written with !important, because the app's own styles can outrank a plain one; write one !important at the end of the value, or remove it (MC-2313, MC-2370)`
    return `${part}: a ${noun} on this control must be written with !important, because the app's own styles can outrank a plain one; "${prop}: ${clip(value)}" is plain, so write it with !important, or remove it (MC-2313, MC-2370)`
}
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

/** Every concrete colour a value names, gradient stops included, with var() resolved through `tokens`; words that are not colours and url() targets are skipped. It reads word by word, so the words of a color-mix() are never one colour: only a scan that judges the resolved mix whole may accept it. */
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

const OVER_PROPS = /^(box-shadow|text-shadow|text-decoration|text-decoration-thickness)$/
const HALO_PAIR = 3
const MAX_TRANSLUCENT_PAIRS = 4096
const APP_TEXT_LABEL = '--nexus-text'

/**
 * One colour a control can paint over its own text: a stack of inset box-shadow layers or of blurred text-shadow layers of one
 * declaration, at the stack's composite alpha. At OPAQUE_FROM and above it is judged as written; below it, flattened over every
 * backdrop it can lie on.
 */
interface OverMember {
    colour: Rgba
    alpha: number
    source: 'inset' | 'halo'
    prop: 'box-shadow' | 'text-shadow'
    block: string
    label: string
    /** True when the colour is the composite of two or more layers; a refusal then cites the compositing rule. */
    stacked: boolean
}
interface Backdrop {
    colour: Rgba
    label: string
}

const readable = (colour: ShadowLayer['colour']): colour is Rgba => Array.isArray(colour)
const clip = (text: string): string => text.slice(0, 60)
const LABEL_MAX = 200
const short = (text: string): string => text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX)}…` : text
// The engine's relative luminance and contrast ratio, with the luminance split out so that a text's is computed once; the
// operations and their order are the engine's, so a ratio equals `cr` bit for bit.
const lum = (c: readonly number[]): number => {
    const f = c.slice(0, 3).map((x) => {
        x /= 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
const crOfLum = (x: number, y: number): number => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
const rgbaKey = (colour: readonly number[]): string => colour.join(',')

const overError = (part: string, prop: string, why: string): LintError => ({ selector: `[data-part="${part}"]`, prop, why })
const currentColourWhy = (part: string, halo: boolean): string => halo
    ? `${part}: a text-shadow blurred more than 2 px in the text colour (currentcolor, or no colour written) paints the control's own text colour around its text; write a colour that reads against the text (MC-2072)`
    : `${part}: an inset box-shadow in the text colour (currentcolor, or no colour written) paints the control's own text colour under its text; write a colour that reads against the text (MC-2072)`
const unreadableLayerWhy = (part: string, prop: string, layer: string): string => `${part}: ${prop} layer "${clip(layer)}" cannot be read, so it cannot be judged against the text; write a hex, rgb(), hsl() or named colour, or color-mix() in srgb, srgb-linear or oklab, and px or rem lengths (MC-2072, MC-2090)`
const tooManyWhy = (part: string): string => `${part}: too many colours to judge: more than ${MAX_TRANSLUCENT_PAIRS} pairs of translucent shadow colours and fills; use fewer distinct translucent shadow and fill colours on this control (MC-2072, MC-2090)`
const tooManyStacksWhy = (part: string): string => `${part}: too many colours to judge: the inset box-shadow and text-shadow layers on this control can paint more than ${MAX_TRANSLUCENT_PAIRS} different colours together; use fewer layers or fewer translucent layers (MC-2072, MC-2090, MC-2177)`
const thicknessWhy = (part: string, prop: string, value: string, token: string, why: 'over' | 'from-font' | 'unreadable'): string => {
    if (why === 'over') return `${part}: a text decoration ${token} thick is over the limit of ${MAX_THICKNESS_PX} px (${MAX_THICKNESS_EM}em); a decoration line on a control may be at most ${MAX_THICKNESS_PX} px thick (MC-2072)`
    if (why === 'from-font') return `${part}: a text decoration ${token} thick takes the thickness from the font file, which the check cannot measure; write a thickness of at most ${MAX_THICKNESS_PX} px (MC-2072)`
    return `${part}: ${prop} ${clip(value)} cannot be measured, so the decoration thickness cannot be judged (MC-2072)`
}

/**
 * Judges the overlay members of one part against every text colour the part can have. Counts the translucent pairs from member and
 * fill counts before anything is flattened; over the cap the part's translucent pairings are skipped and the inset backdrop is
 * never built. Opaque members are always judged.
 */
function judgeOver(part: string, members: readonly OverMember[], paint: PartPaint | undefined, surfaces: readonly Surface[], fallbackText: Rgba | null, errors: LintError[]): void {
    const distinct = new Map<string, OverMember>()
    for (const m of members) {
        const key = `${m.source}|${m.prop}|${m.block}|${rgbaKey(m.colour)}|${m.alpha}`
        if (!distinct.has(key)) distinct.set(key, m)
    }
    const list = [...distinct.values()]
    const translucent = (m: OverMember): boolean => m.alpha < OPAQUE_FROM
    const insets = list.filter((m) => m.source === 'inset')
    const halos = list.filter((m) => m.source === 'halo')

    const addDistinct = (into: Backdrop[], seen: Set<string>, item: Backdrop): void => {
        const key = rgbaKey(item.colour)
        if (seen.has(key)) return
        seen.add(key)
        into.push(item)
    }
    const surfaceBackdrops: Backdrop[] = surfaces.map((s) => ({ colour: s.colour, label: `the app's ${s.name} surface` }))
    const fills: Backdrop[] = []
    const seenFills = new Set<string>()
    if (paint) for (const b of paint.backgrounds) addDistinct(fills, seenFills, { colour: b.colour, label: short(b.label) })
    // the fills the part can have in the member's block, plus the app's surfaces when that block gives no fill; two lists per part,
    // one for blocks that give a fill and one shared by every block that does not
    let withSurfaces: Backdrop[] | undefined
    const backdropsOf = (m: OverMember): Backdrop[] => {
        if (paint && paint.backgroundBlocks.has(m.block)) return fills.length ? fills : surfaceBackdrops
        if (!withSurfaces) {
            const out = [...fills]
            const seen = new Set(seenFills)
            for (const s of surfaceBackdrops) addDistinct(out, seen, s)
            withSurfaces = out.length ? out : surfaceBackdrops
        }
        return withSurfaces
    }

    const translucentInsets = insets.filter(translucent)
    const opaqueInsets = insets.length - translucentInsets.length
    let insetPairs = 0
    for (const i of translucentInsets) insetPairs += backdropsOf(i).length
    let bound = insetPairs
    for (const h of halos) if (translucent(h)) bound += backdropsOf(h).length + opaqueInsets + insetPairs
    const capped = bound > MAX_TRANSLUCENT_PAIRS
    if (capped) errors.push(overError(part, list[0].prop, tooManyWhy(part)))

    const texts: { colour: Rgba, fallback: boolean, label: string, lum: number }[] = []
    const seenTexts = new Set<string>()
    const addText = (t: { colour: Rgba, fallback: boolean, label: string }): void => {
        const key = `${t.fallback}|${rgbaKey(t.colour)}`
        if (seenTexts.has(key)) return
        seenTexts.add(key)
        texts.push({ ...t, lum: lum(t.colour) })
    }
    if (paint) for (const t of paint.texts) addText(t)
    // only an !important colour on a reach part is a member, so the app's own text colour pairs unless one is set (MC-2314)
    const textSet = paint ? paint.texts.some((t) => !t.fallback) : false
    if (!textSet && fallbackText) addText({ colour: fallbackText, fallback: true, label: APP_TEXT_LABEL })

    // a text refused for a source is not judged again for it: a part gets at most one pairing error per (source, text colour)
    const refused = { inset: texts.map(() => false), halo: texts.map(() => false) }
    const refusedCount = { inset: 0, halo: 0 }
    const pair = (source: 'inset' | 'halo', prop: OverMember['prop'], overlay: Backdrop, opaque: boolean, stacked: boolean): void => {
        if (refusedCount[source] === texts.length) return
        const rules = (base: string): string => (stacked ? `${base}, MC-2177` : base)
        const overlayLum = lum(overlay.colour)
        for (let at = 0; at < texts.length; at++) {
            if (refused[source][at]) continue
            const t = texts[at]
            const needed = source === 'halo' ? HALO_PAIR : opaque && t.fallback ? FALLBACK_PAIR : PACK_PAIR
            const ratio = crOfLum(t.lum, overlayLum)
            if (ratio >= needed) continue
            refused[source][at] = true
            refusedCount[source]++
            const textLabel = short(t.fallback ? `the app's own text colour (${t.label})` : t.label)
            const why = source === 'inset'
                ? `${part}: an inset box-shadow ${hex(overlay.colour)} can be drawn under text ${hex(t.colour)} at ${ratio.toFixed(2)}:1 when ${textLabel} and ${overlay.label} both apply (needs ${needed}:1); give the inset shadow a colour that reads with every text colour of this control, or make it an outer shadow (${rules('MC-2072')})`
                : `${part}: a text-shadow ${hex(overlay.colour)} blurred more than 2 px can be drawn around text ${hex(t.colour)} at ${ratio.toFixed(2)}:1 when ${textLabel} and ${overlay.label} both apply (needs ${needed}:1); a halo must read against the text it surrounds (${rules('MC-2072, MC-2090')})`
            errors.push(overError(part, prop, why))
        }
    }
    const withAlpha = (m: OverMember): Rgba => [m.colour[0], m.colour[1], m.colour[2], m.alpha]

    // INSET(part): every colour an inset can have under the text; built only under the cap
    const insetColours: Backdrop[] = []
    const seenInset = new Set<string>()
    for (const i of insets) {
        if (!translucent(i)) {
            const overlay = { colour: i.colour, label: i.label }
            pair('inset', i.prop, overlay, true, i.stacked)
            if (!capped) addDistinct(insetColours, seenInset, overlay)
        } else if (!capped) {
            for (const u of backdropsOf(i)) {
                const overlay = { colour: flatten(withAlpha(i), u.colour), label: `${i.label} (over ${u.label})` }
                pair('inset', i.prop, overlay, false, i.stacked)
                addDistinct(insetColours, seenInset, overlay)
            }
        }
    }
    for (const h of halos) {
        if (!translucent(h)) pair('halo', h.prop, { colour: h.colour, label: h.label }, true, h.stacked)
        else if (!capped) {
            for (const u of backdropsOf(h)) pair('halo', h.prop, { colour: flatten(withAlpha(h), u.colour), label: `${h.label} (over ${u.label})` }, false, h.stacked)
            for (const i of insetColours) pair('halo', h.prop, { colour: flatten(withAlpha(h), i.colour), label: `${h.label} over ${i.label}` }, false, h.stacked)
        }
    }
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
    const overErrors: LintError[] = []
    const overs = new Map<string, OverMember[]>()
    // the stacks admitted per part across every declaration of this variant; at most MAX_TRANSLUCENT_PAIRS
    const stackBudget = new Map<string, number>()
    for (const d of ds) {
        if (OVER_PROPS.test(d.prop)) {
            const written = d.value.replace(/\s*!important\s*$/, '').trim()
            const literal = bare(resolve(written, tokens)).toLowerCase()
            const prop = d.prop
            const box = prop === 'box-shadow'
            const shadow = box || prop === 'text-shadow'
            const problems = shadow ? [] : thicknessProblems(literal, prop === 'text-decoration')
            const layers = shadow ? shadowLayers(literal, box ? 'box' : 'text') : []
            const qualifies = (l: ShadowLayer): boolean => (box ? l.inset : l.blur === null || l.blur > MAX_BLUR_PX)
            const qualifying = layers.filter(qualifies)
            // the readable layers that paint something, with their 1-based list positions among all the declaration's layers
            const painting: { colour: Rgba, index: number }[] = []
            layers.forEach((l, at) => { if (qualifies(l) && readable(l.colour) && l.colour[3] > 0) painting.push({ colour: l.colour, index: at + 1 }) })
            // the stacks are counted before any is built and built only once a part admits them
            const count = stackCount(painting, MAX_TRANSLUCENT_PAIRS)
            let stacks: LayerStack[] | null = null
            const judgedParts = new Set<string>()
            const cappedParts = new Set<string>()
            for (const entry of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
                const reached = reachedParts(registry, entry)
                const block = `${entry}@${d.ctx.at.join(' ')}`
                const label = short(`${entry}{${prop}:${written}}`)
                for (const part of reached) {
                    // a declaration's immediate errors are pushed once per part, however many entries of its selector list reach it
                    if (!judgedParts.has(part)) {
                        judgedParts.add(part)
                        for (const p of problems) overErrors.push(overError(part, prop, thicknessWhy(part, prop, literal, p.token, p.why)))
                        let currentSeen = false
                        for (const l of qualifying) {
                            if (l.colour === 'current') {
                                if (!currentSeen) overErrors.push(overError(part, prop, currentColourWhy(part, !box)))
                                currentSeen = true
                            } else if (!readable(l.colour)) overErrors.push(overError(part, prop, unreadableLayerWhy(part, prop, l.text)))
                        }
                    }
                    if (count === 0) continue
                    const left = stackBudget.get(part) ?? MAX_TRANSLUCENT_PAIRS
                    if (count > left) {
                        if (!cappedParts.has(part)) {
                            cappedParts.add(part)
                            overErrors.push(overError(part, prop, tooManyStacksWhy(part)))
                        }
                        continue
                    }
                    stackBudget.set(part, left - count)
                    stacks ??= layerStacks(painting, MAX_TRANSLUCENT_PAIRS) ?? []
                    let members = overs.get(part)
                    if (!members) overs.set(part, members = [])
                    for (const s of stacks) {
                        const stacked = s.indices.length > 1
                        const note = stacked ? ` (layers ${s.indices.join(', ')} painted together)` : painting.length > 1 ? ` (layer ${s.indices[0]})` : ''
                        members.push({ colour: s.colour, alpha: s.alpha, source: box ? 'inset' : 'halo', prop: box ? 'box-shadow' : 'text-shadow', block, label: `${label}${note}`, stacked })
                    }
                }
            }
            continue
        }
        const isText = TEXT_PROPS.test(d.prop)
        if (!isText && !BACKGROUND_PROPS.test(d.prop)) continue
        if (paintChannelOf(d.prop) !== null && !isWrittenImportant(d.value)) continue
        const value = d.value.replace(/\s*!important\s*$/, '').trim()
        const colours = CSS_WIDE.test(value) ? [] : coloursIn(value, tokens)
        const paintsOwnColour = !isText && OWN_COLOUR_WORD.test(settled(value, tokens))
        const canvasText = d.prop === 'color' && CANVAS_TEXT_KEYWORD.test(settled(value, tokens).trim())
        const inheritsBackground = !isText && settled(value, tokens).trim() === 'inherit'
        for (const entry of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
            const reached = reachedParts(registry, entry)
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
    for (const e of overErrors) errors.push(e)
    for (const [part, members] of overs) judgeOver(part, members, paints.get(part), surfaces, fallbackText, errors)
    return errors
}

/** Every plain colour or fill declaration whose selector-list entry has a reach part as its subject; one error per declaration and part, whatever the value, at-rule or state. */
function plainPaintErrors(area: 'chat' | 'studio', text: string): LintError[] {
    const registry = registryOf(area)
    const errors: LintError[] = []
    for (const d of decls(text)) {
        const channel = paintChannelOf(d.prop)
        if (d.ctx.keyframes || channel === null || isWrittenImportant(d.value)) continue
        const done = new Set<string>()
        for (const entry of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
            for (const part of reachedParts(registry, entry)) {
                if (done.has(part)) continue
                done.add(part)
                errors.push({ selector: `[data-part="${part}"]`, prop: d.prop, why: plainPaintWhy(part, d.prop, d.value, channel) })
            }
        }
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
    const errors: LintError[] = plainPaintErrors(area, text)
    const seen = new Set<string>(errors.map((e) => `${e.selector}|${e.prop}|${e.why}`))
    for (const variant of inlinePrivate(text, '--pack-').variants) {
        for (const e of judgeVariant(area, variant)) {
            const key = `${e.selector}|${e.prop}|${e.why}`
            if (!seen.has(key)) { seen.add(key); errors.push(e) }
        }
    }
    return errors
}
