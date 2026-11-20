// Install-time warnings read from the engine's own text preparation (normalise, then every private-variable variant).
// They never refuse a sheet: judgeSheet runs them only on a sheet every refusing pass accepted, so each one describes a
// pack that installs and may still look wrong on a phone.
import { decls } from './csslit'
import { CHAT_CHAINS, cr, effective, normalise, PRIVATE_PREFIX, resolve, selectorTier, type LintError, type Rgba, type TokenMap } from './engine'
import { inlinePrivate, parseConcrete } from './failclosed'
import { STUDIO_REGISTRY } from './registries/studio'

const IMPORTANT = /\s*!important\s*$/
const PERCENT = /^(\d+(?:\.\d+)?|\.\d+)%$/
const WIDTH_PROPS: ReadonlySet<string> = new Set(['width', 'max-width', 'inline-size', 'max-inline-size'])
const PHONE_PX = 360
const MIN_TEXT_PX = 240

// The part names of a selector's last compound: the same reading as partsOf in geometry.ts (geometryPass).
const partsOf = (sel: string): string[] => [...(sel.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1])

/** The canonical variants of a stylesheet, or none when the engine already refuses its private variables. */
function variantsOf(css: string): string[] {
    const pre = inlinePrivate(normalise(css), PRIVATE_PREFIX)
    return pre.error ? [] : pre.variants
}

/**
 * A phone 360 px wide: the percentage widths along each CHAT_CHAINS chain multiply, and the product must leave the
 * message text 240 px. Each part counts with the smallest percentage any of its rules gives it, whatever the selector,
 * state, @media or importance (the worst case, as the inset rule reads it); a percentage over 100 counts as 100 because
 * a part is never wider than its parent. Keyword, px and absent widths count as the full parent. One warning per chain,
 * from the variant with the smallest product.
 */
export function chainWidthWarnings(css: string): LintError[] {
    const worst = new Map<number, { w: number; parts: { part: string; pct: number }[] }>()
    for (const variant of variantsOf(css)) {
        const smallest = new Map<string, number>()
        for (const d of decls(variant)) {
            if (d.ctx.keyframes || !WIDTH_PROPS.has(d.prop)) continue
            const m = PERCENT.exec(d.value.replace(IMPORTANT, '').trim())
            if (!m) continue
            const pct = Math.min(parseFloat(m[1]), 100)
            for (const part of new Set(d.ctx.selector.split(',').flatMap(partsOf))) {
                const prev = smallest.get(part)
                if (prev === undefined || pct < prev) smallest.set(part, pct)
            }
        }
        CHAT_CHAINS.forEach((chain, index) => {
            let w = PHONE_PX
            const parts: { part: string; pct: number }[] = []
            for (const part of chain.parts) {
                const pct = smallest.get(part)
                if (pct === undefined || pct >= 100) continue
                w = w * pct / 100
                parts.push({ part, pct })
            }
            const prev = worst.get(index)
            if (!prev || w < prev.w) worst.set(index, { w, parts })
        })
    }
    const out: LintError[] = []
    const seen = new Set<string>()
    for (const { w, parts } of worst.values()) {
        if (!(w < MIN_TEXT_PX)) continue
        const list = parts.map((p) => `${p.part} ${String(p.pct)}%`).join(', ')
        const warning: LintError = {
            selector: parts.map((p) => `[data-part="${p.part}"]`).join(' '),
            prop: 'width',
            why: `percentage widths on nested chat parts multiply to ${Math.floor(w)} px of a ${PHONE_PX} px phone (${list}), under the ${MIN_TEXT_PX} px the message text needs; use fewer or larger percentages (MC-2587)`,
        }
        const key = `${warning.selector}|${warning.prop}|${warning.why}`
        if (!seen.has(key)) { seen.add(key); out.push(warning) }
    }
    return out
}

type ImageKind = 'gradient' | 'other' | 'none'
interface Slot<T> { v: T; imp: boolean }
// The effective value of every property that decides what sits behind a rule's text, after the cascade inside one rule.
// Each background list is per layer and read cyclically, as the longhands are in CSS; the shorthand fills every list with its own layers.
interface Slots {
    color: Slot<string | null>
    images: Slot<ImageKind[]> & { prop: string }
    bg: Slot<Rgba | null>
    size: Slot<string[]>
    px: Slot<boolean[]>
    py: Slot<boolean[]>
    repeat: Slot<string[]>
}

const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/
const REPEAT_WORD = /^(?:repeat|no-repeat|repeat-x|repeat-y|space|round)$/
const POSITION_WORD = /^(?:left|right|top|bottom|center)$/
const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)'
const LENGTH = new RegExp(`^${NUMBER}(?:px|rem|em|vw|vh|vmin|vmax|pt|cm|mm|in|ch|ex)?$|^calc\\(`)
const PERCENTAGE = new RegExp(`^${NUMBER}%$`)
const SIZE_WORD = /^(?:auto|cover|contain)$/
const BACKGROUND_PROPS: ReadonlySet<string> = new Set(['color', 'background', 'background-image', 'background-color', 'background-size', 'background-position', 'background-position-x', 'background-position-y', 'background-repeat'])

/** Top-level pieces of a value: split on the separator outside parentheses, trimmed, empty pieces dropped. */
function splitOn(s: string, sep: string): string[] {
    const out: string[] = []
    let cur = '', depth = 0
    for (const ch of s) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (depth === 0 && ch === sep) { out.push(cur.trim()); cur = '' }
        else cur += ch
    }
    out.push(cur.trim())
    return out.filter(Boolean)
}

/** Whitespace-separated words outside parentheses; a top-level `/` is a word of its own. */
function wordsOf(s: string): string[] {
    const out: string[] = []
    let cur = '', depth = 0
    const flush = (): void => { if (cur) out.push(cur); cur = '' }
    for (const ch of s.trim()) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (depth === 0 && /\s/.test(ch)) flush()
        else if (depth === 0 && ch === '/') { flush(); out.push('/') }
        else cur += ch
    }
    flush()
    return out
}

const imageKind = (w: string): ImageKind => (GRADIENT.test(w) ? 'gradient' : w === 'none' ? 'none' : 'other')
const isLength = (w: string): boolean => LENGTH.test(w)
const shifted = (w: string): boolean => isLength(w) && (/^calc\(/.test(w) || parseFloat(w) !== 0)
const atLayer = <T>(list: readonly T[], i: number): T => list[i % list.length]

/** Which axes a position moves off the origin: a non-zero length in the two-value form moves that axis, anywhere in the three- or four-value form it moves both. */
function positionShift(words: readonly string[]): [boolean, boolean] {
    if (words.length >= 3) {
        const any = words.some(shifted)
        return [any, any]
    }
    const swap = words[0] === 'top' || words[0] === 'bottom'
    const [x, y] = swap ? [words[1], words[0]] : [words[0], words[1]]
    return [x !== undefined && shifted(x), y !== undefined && shifted(y)]
}

/** The axes a repeat value tiles on: repeat and round tile, no-repeat and space do not, initial and unset repeat. */
function tilesOf(v: string): [boolean, boolean] {
    const w = v.trim().split(/\s+/)
    if (w[0] === 'initial' || w[0] === 'unset') return [true, true]
    if (w[0] === 'repeat-x') return [true, false]
    if (w[0] === 'repeat-y') return [false, true]
    const tile = (x: string): boolean => x === 'repeat' || x === 'round'
    return w.length === 1 ? [tile(w[0]), tile(w[0])] : [tile(w[0]), tile(w[1])]
}

/** The axes a size fills: a gradient has no intrinsic ratio, so cover, contain, auto and 100% all fill; initial and unset are auto. */
function fullOf(v: string): [boolean, boolean] {
    const t = v.trim()
    if (/^(?:cover|contain|initial|unset)$/.test(t)) return [true, true]
    const w = t.split(/\s+/)
    const full = (x = 'auto'): boolean => x === 'auto' || x === '100%'
    return [full(w[0]), full(w[1])]
}

interface ShorthandLayer { image: ImageKind; size: string; repeat: string; shift: [boolean, boolean]; colour: Rgba | null }

/** One comma layer of the `background` shorthand; only the last layer may carry the colour. */
function shorthandLayer(text: string, last: boolean): ShorthandLayer {
    const out: ShorthandLayer = { image: 'none', size: 'auto', repeat: 'repeat', shift: [false, false], colour: null }
    const size: string[] = [], repeat: string[] = [], position: string[] = []
    let afterSlash = false
    for (const w of wordsOf(text)) {
        if (w === '/') { afterSlash = true; continue }
        if (afterSlash && size.length < 2 && !/^(?:cover|contain)$/.test(size[0] ?? '') && (SIZE_WORD.test(w) || isLength(w) || PERCENTAGE.test(w))) { size.push(w); continue }
        afterSlash = false
        if (GRADIENT.test(w) || w === 'none' || /^(?:url|image-set|-webkit-image-set|cross-fade|element|paint)\(/.test(w)) out.image = imageKind(w)
        else if (REPEAT_WORD.test(w)) repeat.push(w)
        else if (POSITION_WORD.test(w) || isLength(w) || PERCENTAGE.test(w)) position.push(w)
        // Text sits in the content box, so the box and attachment keywords change nothing here.
        else if (/^(?:border-box|padding-box|content-box|scroll|fixed|local)$/.test(w)) continue
        else if (last) out.colour = parseConcrete(w)
    }
    out.size = size.join(' ') || 'auto'
    out.repeat = repeat.join(' ') || 'repeat'
    out.shift = positionShift(position)
    return out
}

function slotsOf(ds: readonly { prop: string; value: string }[], T: TokenMap): Slots {
    const s: Slots = {
        color: { v: null, imp: false },
        images: { v: [], imp: false, prop: '' },
        bg: { v: null, imp: false },
        size: { v: ['auto'], imp: false },
        px: { v: [false], imp: false },
        py: { v: [false], imp: false },
        repeat: { v: ['repeat'], imp: false },
    }
    // A declaration replaces a slot when it is !important or the slot's value is not.
    const put = <V>(slot: Slot<V>, v: V, imp: boolean): boolean => {
        if (!imp && slot.imp) return false
        slot.v = v
        slot.imp = imp
        return true
    }
    for (const d of ds) {
        const imp = /!important\s*$/.test(d.value)
        const value = resolve(d.value.replace(/\s*!important\s*$/, '').trim(), T)
        const layers = splitOn(value, ',')
        switch (d.prop) {
            case 'color': put(s.color, value, imp); break
            case 'background-color': put(s.bg, parseConcrete(value), imp); break
            case 'background-image': if (put(s.images, layers.map(imageKind), imp)) s.images.prop = d.prop; break
            case 'background-size': put(s.size, layers, imp); break
            case 'background-repeat': put(s.repeat, layers, imp); break
            case 'background-position': {
                const shifts = layers.map((l) => positionShift(wordsOf(l)))
                put(s.px, shifts.map((x) => x[0]), imp)
                put(s.py, shifts.map((x) => x[1]), imp)
                break
            }
            case 'background-position-x': put(s.px, layers.map((l) => wordsOf(l).some(shifted)), imp); break
            case 'background-position-y': put(s.py, layers.map((l) => wordsOf(l).some(shifted)), imp); break
            case 'background': {
                // The shorthand sets every slot, each with its own importance; what it leaves out takes its initial value.
                const parsed = layers.map((l, i) => shorthandLayer(l, i === layers.length - 1))
                if (put(s.images, parsed.map((l) => l.image), imp)) s.images.prop = d.prop
                put(s.bg, parsed[parsed.length - 1]?.colour ?? null, imp)
                put(s.size, parsed.map((l) => l.size), imp)
                put(s.repeat, parsed.map((l) => l.repeat), imp)
                put(s.px, parsed.map((l) => l.shift[0]), imp)
                put(s.py, parsed.map((l) => l.shift[1]), imp)
                break
            }
        }
    }
    return s
}

/** Whether gradient layer i fills the whole box: an axis is bare when the layer does not tile on it and is either smaller than the box or shifted off the origin. */
function layerCovers(s: Slots, i: number): boolean {
    const [tx, ty] = tilesOf(atLayer(s.repeat.v, i))
    const [fx, fy] = fullOf(atLayer(s.size.v, i))
    const bare = (tile: boolean, full: boolean, off: boolean): boolean => !tile && (!full || off)
    return !bare(tx, fx, atLayer(s.px.v, i)) && !bare(ty, fy, atLayer(s.py.v, i))
}

/**
 * A rule whose text colour only passes because its own gradient is the background, while the gradient can leave part
 * of the box bare. The engine's reachExtra skips its 3:1 surface check for a reach-tier text colour that has its own
 * readable background in the same rule; this reads the same surfaces (canvas, sheet, glass; a translucent canvas over
 * black) and the same colour reader, and warns when that skipped check would have failed and the gradient does not cover
 * the box. A part in a safe context is never checked by the engine, so it never warns. The block reading is narrower
 * than the engine's (last declaration per property): it follows CSS importance inside one rule, in the rule alone and
 * in the rule with every @media block of the same selector merged in.
 */
export function coverageWarnings(area: 'chat' | 'studio', css: string): LintError[] {
    const registry = area === 'studio' ? STUDIO_REGISTRY : undefined
    const out: LintError[] = []
    const seen = new Set<string>()
    for (const variant of variantsOf(css)) {
        const ds = decls(variant)
        // The same token map extraPass builds as its base: the app tokens with every :root custom property over them.
        const T: TokenMap = new Map(effective(registry).app)
        for (const d of ds) if (d.prop.startsWith('--') && d.ctx.selector.trim() === ':root') T.set(d.prop, d.value.trim())
        const flatten = (f: Rgba, b: Rgba): Rgba => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]
        const colorOf = (name: string, onto?: Rgba | null): Rgba | null => {
            const c = parseConcrete(resolve(T.get(name) || '', T))
            return c ? (c[3] < 1 ? flatten(c, onto || [0, 0, 0, 1]) : c) : null
        }
        const canvas = colorOf('--nexus-canvas')
        if (!canvas) continue
        const sheet = colorOf('--color-surface-sheet', canvas)
        const glassBase = parseConcrete(resolve(T.get('--nexus-surface') || '', T))
        const surfaces = [canvas, sheet, glassBase ? flatten(glassBase, canvas) : canvas].filter((x): x is Rgba => Boolean(x))
        const blocks = new Map<string, typeof ds>()
        for (const d of ds) {
            if (d.prop.startsWith('--') || d.ctx.keyframes || !BACKGROUND_PROPS.has(d.prop)) continue
            const key = d.ctx.selector.trim()
            if (!blocks.has(key)) blocks.set(key, [])
            blocks.get(key)!.push(d)
        }
        for (const [selector, all] of blocks) {
            const plain = all.filter((d) => d.ctx.at.length === 0)
            for (const state of plain.length === all.length ? [plain] : [plain, all]) {
                if (!state.length) continue
                const s = slotsOf(state, T)
                const c = s.color.v ? parseConcrete(s.color.v) : null
                if (!c || c[3] < 0.9) continue
                if (!s.images.v.includes('gradient')) continue
                if (s.bg.v && s.bg.v[3] >= 0.9) continue
                // An image that is not a gradient cannot be judged here, so it counts as covering.
                if (s.images.v.some((kind, i) => kind === 'other' || (kind === 'gradient' && layerCovers(s, i)))) continue
                if (Math.min(...surfaces.map((x) => cr(c, x))) >= 3) continue
                for (const entry of selector.split(',').map((e) => e.trim()).filter(Boolean)) {
                    if (selectorTier(entry, registry) !== 'reach') continue
                    const warning: LintError = {
                        selector: entry,
                        prop: s.images.prop,
                        why: `this rule's text colour passes only against its own gradient, but its background shorthand, background-size, -position or -repeat can leave part of the element bare, where the text sits on the app's own background below 3:1; make the gradient cover the element or add an opaque background colour to this rule (MC-2546)`,
                    }
                    const id = `${warning.selector}|${warning.prop}|${warning.why}`
                    if (!seen.has(id)) { seen.add(id); out.push(warning) }
                }
            }
        }
    }
    return out
}
