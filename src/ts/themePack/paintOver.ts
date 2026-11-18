// Rule P value readers (CHORE-738, MC-2072, MC-2090). A control can paint over its own text with an inset box-shadow, a blurred
// text-shadow halo or a thick decoration line. These readers turn those values into layers and thickness verdicts for the
// judge in cascade.ts. A value arrives with !important stripped, var() resolved and url() and strings blanked; every function
// here is linear in the length of its input and treats anything it cannot read as unreadable, never as harmless.
import type { Rgba } from './engine'
import { parseConcrete } from './failclosed'
import { splitTop } from './structure'

export interface ShadowLayer {
    /** The layer as written (lower case, whitespace collapsed). */
    text: string
    /** True for the word `inset` anywhere in the layer, and for a layer that still holds a var() (it may hold the word). */
    inset: boolean
    /** The layer's colour; 'current' when it writes none or writes currentcolor; null when it cannot be read. */
    colour: Rgba | 'current' | null
    /** A text-shadow blur in px; null when it cannot be read (judged as over the limit). Always 0 for a box-shadow. */
    blur: number | null
}

/** A length in px, or in em when it is relative to the font size. */
export interface Measure {
    value: number
    em: boolean
}

export interface ThicknessProblem {
    token: string
    why: 'over' | 'from-font' | 'unreadable'
}

export const MAX_BLUR_PX = 2
export const MAX_THICKNESS_PX = 3
export const MAX_THICKNESS_EM = 0.2

const WHOLE_KEYWORD = /^(none|inherit|initial|unset|revert|revert-layer)$/
const COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/
const LENGTH = /^[+-]?(\d+\.?\d*|\.\d+)(px|rem|em|%)?$/
const MAX_CALC_DEPTH = 8

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()
const tokensOf = (text: string): string[] => splitTop(collapse(text), ' ').filter(Boolean)
const isLengthLike = (token: string): boolean => /^[+\-.\d]/.test(token) || (token.includes('(') && !COLOUR_FUNCTION.test(token))

function plainLength(token: string): Measure | null {
    const m = LENGTH.exec(token)
    if (!m) return null
    const n = Math.abs(parseFloat(token))
    switch (m[2]) {
        case undefined: return n === 0 ? { value: 0, em: false } : null
        case 'px': return { value: n, em: false }
        case 'rem': return { value: n * 16, em: false }
        case 'em': return { value: n, em: true }
        default: return { value: n / 100, em: true }
    }
}

/** A plain length, or `calc(A * -1)` / `calc(-1 * A)` over a readable A (the only calc the value rules allow); null otherwise. */
export function readLength(token: string, depth = 0): Measure | null {
    const plain = plainLength(token)
    if (plain) return plain
    if (depth > MAX_CALC_DEPTH || !token.startsWith('calc(') || !token.endsWith(')')) return null
    const parts = splitTop(token.slice(5, -1), '*')
    if (parts.length !== 2) return null
    const left = parts[0].trim()
    const right = parts[1].trim()
    if (right === '-1') return readLength(left, depth + 1)
    if (left === '-1') return readLength(right, depth + 1)
    return null
}

function readLayer(layer: string, kind: 'box' | 'text'): ShadowLayer {
    let inset = false
    const lengths: string[] = []
    const colours: string[] = []
    for (const token of tokensOf(layer)) {
        if (token === 'inset') inset = true
        else if (isLengthLike(token)) lengths.push(token)
        else colours.push(token)
    }
    const leftover = layer.includes('var(')
    let colour: ShadowLayer['colour'] = null
    if (colours.length === 0 || (colours.length === 1 && colours[0] === 'currentcolor')) colour = 'current'
    else if (colours.length === 1) colour = parseConcrete(colours[0])
    if (kind === 'box') return { text: layer, inset: inset || leftover, colour, blur: 0 }
    let blur: number | null = null
    if (!leftover && lengths.length >= 2 && lengths.length <= 3) {
        if (lengths.length === 2) blur = 0
        else {
            const measure = readLength(lengths[2])
            if (measure && !measure.em) blur = measure.value
        }
    }
    return { text: layer, inset, colour, blur }
}

/** The layers of a box-shadow or text-shadow value; `none` and the CSS-wide keywords give none. */
export function shadowLayers(value: string, kind: 'box' | 'text'): ShadowLayer[] {
    const text = collapse(value.toLowerCase())
    if (!text || WHOLE_KEYWORD.test(text)) return []
    return splitTop(text, ',').map((layer) => layer.trim()).filter(Boolean).map((layer) => readLayer(layer, kind))
}

/** At this alpha and above a layer covers everything beneath it and is judged as written; below it, it is translucent. */
export const OPAQUE_FROM = 0.9

/** One colour the layers of a declaration can paint together: its alpha, and the 1-based list positions of the layers that make it. */
export interface LayerStack {
    colour: Rgba
    alpha: number
    indices: number[]
}

const covering = (layer: { colour: Rgba }): boolean => layer.colour[3] >= OPAQUE_FROM

/**
 * The number of stacks `layerStacks` emits for these layers, computed from the alphas alone and saturated at `limit + 1`, so it is
 * never more than `limit + 1` and no stack is built to learn it.
 */
export function stackCount(layers: readonly { colour: Rgba }[], limit: number): number {
    let count = 0
    let translucentAbove = 0
    for (const layer of layers) {
        if (covering(layer)) count = Math.min(count + 2 ** translucentAbove, limit + 1)
        else translucentAbove++
        if (count > limit) return limit + 1
    }
    return Math.min(count + 2 ** translucentAbove - 1, limit + 1)
}

/**
 * Every colour the readable layers of one declaration can paint together. Layers differ in spread, offset and blur and geometry is
 * not modelled, so a point under the text may be covered by any order-preserving subset of them; the first layer is on top. A subset
 * ends at its first covering layer, which hides everything beneath it. Each stack is composited top-down with source-over, so
 * layers of one colour reduce to their combined alpha. The stack count is computed from the alphas before any stack is built and
 * null is returned when it is over `limit`; the count and the emitted stacks agree exactly.
 */
export function layerStacks(layers: readonly { colour: Rgba, index: number }[], limit: number): LayerStack[] | null {
    if (stackCount(layers, limit) > limit) return null

    const stacks: LayerStack[] = []
    const picked: number[] = []
    const emit = (p: readonly number[], a: number): void => {
        stacks.push({ colour: [p[0] / a, p[1] / a, p[2] / a, 1], alpha: a, indices: [...picked] })
    }
    // p is the premultiplied colour and a the alpha of the layers picked so far, composited top-down
    const walk = (at: number, p: readonly number[], a: number): void => {
        if (at === layers.length) {
            if (picked.length) emit(p, a)
            return
        }
        walk(at + 1, p, a)
        const layer = layers[at]
        const alpha = covering(layer) ? 1 : layer.colour[3]
        const next = [0, 1, 2].map((k) => p[k] + layer.colour[k] * alpha * (1 - a))
        picked.push(layer.index)
        if (covering(layer)) emit(next, 1)
        else walk(at + 1, next, a + alpha * (1 - a))
        picked.pop()
    }
    walk(0, [0, 0, 0], 0)
    return stacks
}

function judgeThickness(token: string): ThicknessProblem | null {
    if (token === 'auto' || token === 'thick' || token === 'thin' || token === 'medium') return null
    if (token === 'from-font') return { token, why: 'from-font' }
    const measure = readLength(token)
    if (!measure) return { token, why: 'unreadable' }
    return measure.value > (measure.em ? MAX_THICKNESS_EM : MAX_THICKNESS_PX) ? { token, why: 'over' } : null
}

/**
 * The thicknesses a text-decoration-thickness value (`shorthand` false) or a text-decoration shorthand names that are over
 * the limit or cannot be measured. The shorthand's line, style and colour words are not thicknesses.
 */
export function thicknessProblems(value: string, shorthand: boolean): ThicknessProblem[] {
    const text = collapse(value.toLowerCase())
    if (!text || WHOLE_KEYWORD.test(text)) return []
    const candidates = shorthand ? tokensOf(text).filter((token) => isLengthLike(token) || token === 'from-font') : [text]
    const problems: ThicknessProblem[] = []
    for (const token of candidates) {
        const problem = judgeThickness(token)
        if (problem) problems.push(problem)
    }
    return problems
}
