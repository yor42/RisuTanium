// Seasonal scene: aprilFool (Apr 1, all locales).
//
// A pool of four variants, one per mount: tiramisu, invert (the original option B: flip + pixel shades + reversed word),
// element, acorn. The first mount picks one at random; a build that follows a played build advances the cycle by one
// ((index + 1) % 4), which is what a replay does: the host rebuilds the scene for every replay. A build that only shows
// the final pose (already played today, reduced motion) keeps the current variant.
//
// The joke is visual only: the accessible name stays "RisuTanium" (no setName), every scramble/overlay is aria-hidden,
// and nothing outside the brand slot remains in the final pose.
//
// Storyboard (6.0 s clock): motion ends by 4.6 s; the final pose holds until the clock ends. Only transform and opacity
// are animated (Web Animations API), plus stroke-dashoffset on the electric arc. No filters, no loops. The final pose is
// static CSS under .rt-af-final (+ .rt-af-v-<variant>), so finish() is identical from any point.
//
// Unverified: the clipped-gradient letter paint (.rt-af-ch-sheen and .rt-af-ch-ac, plus the element variant's final
// pose on .rt-sw-a/.rt-sw-b) uses background-clip: text, which failed in Firefox for the tiramisu overlay in an earlier
// prototype; "Risu" letters (.rt-af-ch-a) already use a sampled solid colour instead.
import './aprilFool.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
// Motion ends by 4.6 s; the final pose holds until the scene clock ends at 6000 ms.
const DURATION = 6200
const CLOCK = 6000
const NAME = 'RisuTanium'
const VIEWBOX = '-73 -66 146 146'

type Variant = 'tiramisu' | 'invert' | 'element' | 'acorn'
const VARIANTS: readonly Variant[] = ['tiramisu', 'invert', 'element', 'acorn']

// ----- Variant pool (module state: survives replays, which rebuild the scene) -----
let cursor = -1
let lastPlayed = false
let random: () => number = Math.random

/** Resets the variant cycle and sets the random source used for the next first pick (a seam for tests). */
export function resetVariantPool(source: () => number = Math.random): void {
    cursor = -1
    lastPlayed = false
    random = source
}

function pickVariant(): Variant {
    if (cursor < 0) {
        const i = Math.floor(random() * VARIANTS.length)
        cursor = Math.max(0, Math.min(VARIANTS.length - 1, Number.isFinite(i) ? i : 0))
    } else if (lastPlayed) {
        cursor = (cursor + 1) % VARIANTS.length
    }
    lastPlayed = false
    return VARIANTS[cursor]
}

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
const SNAP = 'cubic-bezier(0.5, 0, 0.3, 1.4)'
const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

const DESC: Record<Variant, string> = {
    tiramisu: 'April Fools! The logo turned into a tiramisu.',
    invert: 'April Fools! The logo is upside down today.',
    element: 'April Fools! RisuTanium is element 119 today.',
    acorn: 'April Fools! A squirrel took over the logo.',
}

function sid(uid: string): string {
    return 'rt-af-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
}

function htmlEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function svgFrom(markup: string, cls: string, viewBox: string): SVGSVGElement {
    const holder = document.createElement('span')
    holder.innerHTML = '<svg xmlns="' + SVG_NS + '" viewBox="' + viewBox + '" class="' + cls + '" aria-hidden="true" focusable="false">' + markup + '</svg>'
    const n = holder.firstElementChild
    if (!(n instanceof SVGSVGElement)) throw new Error('aprilFool: svg markup did not parse')
    return n
}

function f1(n: number): string {
    return (Math.round(n * 10) / 10).toString()
}
function f3(n: number): string {
    return (Math.round(n * 1000) / 1000).toString()
}

// ============================================================================================================
// Mark markup, one function per variant. All draw into the same viewBox (-73 -66 146 146) over the status mark.
// ============================================================================================================

// ----- invert: pixel shades on a 4-unit grid, 16 x 4 cells, drawn for the upright (flipped) mark -----
const CELL = 4
const SX = -32
const SY = -18
const SHADE_ROWS: number[][][] = [[[0, 15]], [[0, 6], [9, 15]], [[1, 6], [9, 14]], [[2, 5], [10, 13]]]
const SHINE: number[][] = [[1, 2], [2, 3], [1, 10], [2, 11]]
function rects(rows: number[][][], inflate: number): string {
    let d = ''
    rows.forEach((runs, r) => {
        for (const run of runs) {
            const x = SX + run[0] * CELL - inflate
            const y = SY + r * CELL - inflate
            const w = (run[1] - run[0] + 1) * CELL + 2 * inflate
            const h = CELL + 2 * inflate
            d += 'M' + x + ' ' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z'
        }
    })
    return d
}
const SHADES = rects(SHADE_ROWS, 0)
const SHADES_EDGE = rects(SHADE_ROWS, 2.2)
const SHADES_SHINE = SHINE.map((c) => 'M' + (SX + c[1] * CELL) + ' ' + (SY + c[0] * CELL) + 'h4v4h-4Z').join('')
const PIX_TWINKLE = 'M-1.2-6h2.4v4.8h4.8v2.4h-4.8v4.8h-2.4v-4.8h-4.8v-2.4h4.8Z'

function invertMark(id: string): string {
    return '<defs><linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient></defs>' +
        '<g class="rt-af-hop">' +
        '<g class="rt-af-spin">' +
        '<path class="rt-af-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-af-ink" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-af-shades">' +
        '<path class="rt-af-shadeedge" d="' + SHADES_EDGE + '"/>' +
        '<path class="rt-af-shade" d="' + SHADES + '"/>' +
        '<path class="rt-af-shine" d="' + SHADES_SHINE + '"/>' +
        '</g>' +
        '<g transform="translate(-19 -12)"><path class="rt-af-twinkle" d="' + PIX_TWINKLE + '"/></g>' +
        '</g>'
}

// ----- tiramisu: nested triangles separate into a 3-layer wedge (cocoa top, cream, espresso ladyfinger) -----
// The wedge is the frame silhouette flipped to a point-up triangle (apex y -64.49, base y 32.25), cut into bands.
const T_A = -64.49
const T_B = 32.25
const T_HW = 55.85
const T_H = 96.74
function twHw(y: number): number {
    return T_HW * (y - T_A) / T_H
}
function twBand(y0: number, y1: number): string {
    return 'M' + f3(-twHw(y0)) + ' ' + y0 + 'H' + f3(twHw(y0)) + 'L' + f3(twHw(y1)) + ' ' + y1 + 'H' + f3(-twHw(y1)) + 'Z'
}
const TW_TOP = twBand(T_A, -38)
const TW_CREAM = twBand(-33, -3)
const TW_LADY = twBand(2, T_B)
function tiramisuMark(id: string): string {
    return '<defs><linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient></defs>' +
        '<g class="rt-af-tn">' +
        '<g class="rt-af-tn1"><path class="rt-af-ink" fill-rule="evenodd" d="' + FRAME + '"/></g>' +
        '<g class="rt-af-tn2"><path class="rt-af-ink" d="' + MID + '"/></g>' +
        '<g class="rt-af-tn3"><path fill="url(#' + id + '-core)" d="' + CORE + '"/></g>' +
        '</g>' +
        '<g class="rt-af-tw">' +
        '<g class="rt-af-tb rt-af-tb3"><path class="rt-af-t-lady" d="' + TW_LADY + '"/>' +
        '<path class="rt-af-t-soak" d="M-30 14H30M-23 22.5H23"/></g>' +
        '<g class="rt-af-tb rt-af-tb2"><path class="rt-af-t-cream" d="' + TW_CREAM + '"/>' +
        '<path class="rt-af-t-bub" d="M-14-14h5M6-20h4M10-9h5M-4-8h3"/></g>' +
        '<g class="rt-af-tb rt-af-tb1"><path class="rt-af-t-top" d="' + TW_TOP + '"/>' +
        '<path class="rt-af-t-fleck" d="M-4-52h3M3-47h3M-8-44h3M1-58h2"/></g>' +
        '<g transform="translate(4 -66)"><g class="rt-af-leaf"><path class="rt-af-t-mint" d="M0 0C5-10 15-9 18-1C10 6 3 6 0 0Z"/><path class="rt-af-t-vein" d="M1 0L14-3"/></g></g>' +
        '</g>'
}

// ----- element: nested triangles flip into a brushed-chrome periodic-table tile "119 / Rt" -----
function elementMark(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-chrome" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#f1f5f9"/><stop offset=".28" stop-color="#9aa8b8"/><stop offset=".5" stop-color="#e8eef5"/><stop offset=".74" stop-color="#7d8ba0"/><stop offset="1" stop-color="#d5dde8"/></linearGradient>' +
        '</defs>' +
        '<g class="rt-af-en">' +
        '<path class="rt-af-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-af-ink" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-af-tile">' +
        '<rect class="rt-af-tile-edge" x="-63" y="-51" width="126" height="126" rx="13"/>' +
        '<rect x="-62" y="-50" width="124" height="124" rx="12" fill="url(#' + id + '-chrome)"/>' +
        '<path class="rt-af-brush" d="M-54-38H54M-58-26H58M-58-12H58M-58 2H58M-58 16H58M-58 30H58M-58 44H58M-58 58H58M-54 68H54"/>' +
        '<path class="rt-af-bev-t" d="M-55.85-32.25H55.85L30.03-17.34H-30.03Z"/>' +
        '<path class="rt-af-bev-l" d="M-55.85-32.25L-30.03-17.34L0 34.68L0 64.49Z"/>' +
        '<path class="rt-af-bev-r" d="M55.85-32.25L0 64.49L0 34.68L30.03-17.34Z"/>' +
        '<path class="rt-af-hole" d="M-30.03-17.34H30.03L0 34.68Z"/>' +
        '<text class="rt-af-sym" x="0" y="4" text-anchor="middle" font-size="30">Rt</text>' +
        '<text class="rt-af-num" x="-56" y="-37.5" font-size="13.5">119</text>' +
        '</g>'
}

// ----- acorn: the frame silhouette rounded into an acorn, cross-hatched oak cap over a hazel body -----
const AC_CAP = 'M-58-24C-58-54-32-64 0-64S58-54 58-24Q0-10-58-24Z'
const AC_BODY = 'M-51-20Q-54 22-15 54Q0 67 15 54Q54 22 51-20Q0-8-51-20Z'
function hatch(): string {
    let d = ''
    for (let i = -9; i <= 9; i++) {
        d += 'M' + (i * 11 - 40) + ' -70L' + (i * 11 + 40) + ' 10'
        d += 'M' + (i * 11 + 40) + ' -70L' + (i * 11 - 40) + ' 10'
    }
    return d
}
const AC_HATCH = hatch()
function acornMark(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-hazel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8954a"/><stop offset="1" stop-color="#8f5a22"/></linearGradient>' +
        '<clipPath id="' + id + '-capclip"><path d="' + AC_CAP + '"/></clipPath>' +
        '</defs>' +
        '<g class="rt-af-an">' +
        '<path class="rt-af-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-af-ink" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-af-ac">' +
        '<path class="rt-af-ac-stem" d="M-4-62Q-5-76 3-79Q6-72 4-62Z"/>' +
        '<path class="rt-af-ac-body" fill="url(#' + id + '-hazel)" d="' + AC_BODY + '"/>' +
        '<path class="rt-af-ac-shine" d="M-37-4Q-35 22-13 44"/>' +
        '<path class="rt-af-ac-mid" d="M-24 4H24L0 40Z"/>' +
        '<g transform="translate(0 16) scale(.8)"><path fill="url(#' + id + '-core)" d="' + CORE + '"/></g>' +
        '<path class="rt-af-ac-cap" d="' + AC_CAP + '"/>' +
        '<g clip-path="url(#' + id + '-capclip)"><path class="rt-af-ac-hatch" d="' + AC_HATCH + '"/></g>' +
        '<path class="rt-af-ac-rim" d="' + AC_CAP + '"/>' +
        '</g>'
}

const TAIL_LO = 'M22 84C6 70 7 42 23 28'
const TAIL_HI = 'M13 50C14 40 18 33 23 28C34 18 49 19 48 31C47 39 38 38 38 32'
function tailLayer(cls: string, extra: number): string {
    return '<path class="rt-af-tail-' + cls + '" style="stroke-width:' + (15 + extra) + 'px" d="' + TAIL_LO + '"/>' +
        '<path class="rt-af-tail-' + cls + '" style="stroke-width:' + (23 + extra) + 'px" d="' + TAIL_HI + '"/>'
}
const MARKS: Record<Variant, (id: string) => string> = { invert: invertMark, tiramisu: tiramisuMark, element: elementMark, acorn: acornMark }

// Finds a visual leaf span ("Risu", "Tanium") inside the word without relying on the host's class names.
function findLeafSpan(root: HTMLElement, text: string): HTMLElement | null {
    for (const n of Array.from(root.querySelectorAll('span'))) {
        if (n.children.length === 0 && n.textContent === text) return n
    }
    return null
}

interface RunOptions {
    /** Delay in ms. */
    at?: number
    /** Duration in ms. */
    d: number
    ease?: string
    fill?: FillMode
    /** Keeps an effect-level easing instead of moving it onto each keyframe. */
    whole?: boolean
}

interface Geom {
    W: number
    H: number
    cx: number
    cy: number
    ms: number
    wx: number
    wy: number
    ww: number
    wh: number
    fs: number
    wrapped: boolean
}

interface VariantImpl {
    onFinal?(): void
    timeline(g: Geom, xs: number[]): void
}

// ============================================================================================================
// build(ctx)
// ============================================================================================================
function build(ctx: SceneContext): SceneInstance {
    const variant = pickVariant()
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    const vcls = 'rt-af-v-' + variant

    // ----- Stage -----
    const sky = htmlEl('div', 'rt-af-sky ' + vcls, ctx.stage)
    sky.setAttribute('aria-hidden', 'true')
    sky.setAttribute('data-af-variant', variant)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(MARKS[variant](id), 'rt-af-mark ' + vcls, VIEWBOX)
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: aria-hidden overlay, filled by the variant -----
    const word = ctx.word
    word.classList.add('rt-af-word', vcls)
    word.setAttribute('data-af-variant', variant)
    const risu = findLeafSpan(word, 'Risu')
    const tanium = findLeafSpan(word, 'Tanium')
    const visual: Element | null = word.querySelector('.rt-sw-text') || (risu ? risu.parentElement : null)
    const scr = htmlEl('span', 'rt-af-scr', word)
    scr.setAttribute('aria-hidden', 'true')

    ctx.setDescription(DESC[variant], 'en')

    // Glyph positions (em from the word box's left edge), measured from the real spans with Ranges.
    // Fallback: NanumSquare Neo values measured in the prototype.
    const FALLBACK_X = [0, 0.751, 1.066, 1.673, 2.346, 2.974, 3.607, 4.28, 4.596, 5.269, 6.247]
    function fontPx(): number {
        return parseFloat(getComputedStyle(word).fontSize) || 24
    }
    function measure(): number[] {
        const fs = fontPx()
        let xs = FALLBACK_X.slice()
        try {
            const wr = word.getBoundingClientRect()
            const spans: Array<[HTMLElement | null, number]> = [[risu, 4], [tanium, 6]]
            if (risu && tanium && risu.firstChild && tanium.firstChild && typeof document.createRange === 'function') {
                const got: Array<[number, number]> = []
                for (const sp of spans) {
                    const node = sp[0]?.firstChild
                    if (!node) throw new Error('missing text node')
                    for (let i = 0; i < sp[1]; i++) {
                        const r = document.createRange()
                        r.setStart(node, i)
                        r.setEnd(node, i + 1)
                        const gr = r.getBoundingClientRect()
                        got.push([(gr.left - wr.left) / fs, (gr.right - wr.left) / fs])
                    }
                }
                if (got[9][1] > got[0][0]) {
                    xs = got.map((g) => g[0])
                    xs.push(got[9][1])
                }
            }
        } catch {
            // keep the fallback
        }
        return xs
    }
    // One overlay letter. kind: 'a' (Risu gradient slice), 'b' (ink), 'sheen', 'ac' (acorn tone).
    function makeCh(text: string, kind: 'a' | 'b' | 'sheen' | 'ac'): HTMLElement {
        const ch = htmlEl('span', 'rt-af-ch rt-af-ch-' + kind, scr)
        ch.textContent = text
        return ch
    }
    // Moving "Risu" letters are painted with a solid colour sampled from the everyday gradient at their position, not
    // with background-clip:text. A transformed letter inside a fading layer can drop its clipped gradient on some GPU
    // paths (only T, a, m, i showed in the dark theme), and solid text cannot.
    function rgbOf(v: string): [number, number, number] | null {
        const s = String(v || '').trim()
        let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
        if (m) {
            const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
        }
        m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s)
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
    }
    function gradientAt(t: number): string {
        const cs = getComputedStyle(word)
        const c0 = rgbOf(cs.getPropertyValue('--nexus-core-from')) || [0, 161, 173]
        const c1 = rgbOf(cs.getPropertyValue('--nexus-core-to')) || [88, 123, 255]
        const k = Math.max(0, Math.min(1, t))
        return 'rgb(' + [0, 1, 2].map((i) => Math.round(c0[i] + (c1[i] - c0[i]) * k)).join(',') + ')'
    }
    function placeCh(ch: HTMLElement, x: number): void {
        ch.style.left = f3(x) + 'em'
        if (ch.classList.contains('rt-af-ch-a') || ch.classList.contains('rt-af-ch-sheen') || ch.classList.contains('rt-af-ch-ac')) {
            ch.style.backgroundPosition = f3(-x) + 'em 0'
        }
        if (ch.classList.contains('rt-af-ch-a')) {
            // The everyday gradient is diagonal over the 6.21em x 1.2em word box; the letter centre picks its colour.
            ch.style.color = gradientAt((x + 0.3) / 6.21)
            ch.style.backgroundImage = 'none'
        }
    }
    function cw(node: Element): number {
        return node.getBoundingClientRect().width / fontPx()
    }

    function later(fn: () => void, ms: number): number {
        const t = ctx.setTimeout(fn, ms)
        timers.push(t)
        return t
    }
    function cancelAll(): void {
        for (const a of anims) a.cancel()
        anims = []
        for (const t of timers) ctx.clearTimeout(t)
        timers = []
    }
    function setFinal(on: boolean): void {
        for (const n of [sky, mark, word]) if (n) n.classList.toggle('rt-af-final', on)
    }
    let impl: VariantImpl | null = null
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        setFinal(true)
        if (impl && impl.onFinal) impl.onFinal()
        state = 'final'
        settle()
    }
    // With more than two keyframes the easing goes on each keyframe (a keyframe's own easing wins) and the effect stays
    // linear, so every keyframe offset is a real time (delay + offset x duration).
    function add(node: Element | null, frames: Keyframe[], o: RunOptions): Animation | null {
        if (!node) return null
        let ease = o.ease || 'linear'
        let fr = frames
        if (frames.length > 2 && !o.whole && ease !== 'linear') {
            const ez = ease
            ease = 'linear'
            fr = frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing: ez }))
        }
        const a = node.animate(fr, { duration: o.d, delay: o.at || 0, easing: ease, fill: o.fill || 'both' })
        anims.push(a)
        return a
    }
    // The real text fades out at t0 and returns at t1; the overlay shows in between.
    function swapWord(t0: number, t1: number): void {
        add(visual, [{ opacity: 1 }, { opacity: 1, offset: t0 / t1 }, { opacity: 0, offset: t0 / t1 + 0.0002 },
            { opacity: 0, offset: 0.9998 }, { opacity: 1 }], { d: t1 })
        add(scr, [{ opacity: 0 }, { opacity: 0, offset: t0 / t1 }, { opacity: 1, offset: t0 / t1 + 0.0002 },
            { opacity: 1, offset: 0.9998 }, { opacity: 0 }], { d: t1 })
    }

    function geom(): Geom {
        const s = ctx.stage.getBoundingClientRect()
        const box = ctx.stageBox()
        const W = box.width ? box.width : s.width
        const H = box.height ? box.height : s.height
        const wr = word.getBoundingClientRect()
        const wx = wr.left - s.left
        const wy = wr.top - s.top
        let cx = wx - 20
        let cy = wy + wr.height / 2
        let ms = 28
        if (ctx.markSlot) {
            const m = ctx.markSlot.getBoundingClientRect()
            cx = m.left - s.left + m.width / 2
            cy = m.top - s.top + m.height / 2
            ms = m.width
        }
        return { W, H, cx, cy, ms, wx, wy, ww: wr.width, wh: wr.height, fs: fontPx(), wrapped: box.wrapped }
    }

    // ============================================================================================================
    // Variant: invert (original option B)
    // ============================================================================================================
    function invertImpl(): VariantImpl {
        const ticks: HTMLElement[] = []
        for (let t = 0; t < 2; t++) {
            const tk = htmlEl('div', 'rt-af-ticks rt-af-ticks-' + (t ? 'r' : 'l'), sky)
            tk.appendChild(svgFrom('<path d="M2 12L9 7M4 4L10 1"/>', 'rt-af-ticksvg', '0 0 12 14'))
            ticks.push(tk)
        }
        const chars: HTMLElement[] = []
        for (let c = 0; c < NAME.length; c++) chars.push(makeCh(NAME.charAt(c), c < 4 ? 'a' : 'b'))
        return {
            timeline(g, xs) {
                const baseY = g.cy - g.ms / 2 + g.ms * (98.25 / 146)
                const half = g.ms * 0.42
                const sz = Math.max(9, g.ms * 0.38)
                ticks.forEach((tk, i) => {
                    const right = i === 1
                    tk.style.width = sz + 'px'
                    tk.style.height = (sz * 14 / 12) + 'px'
                    tk.style.left = (right ? g.cx + half : g.cx - half - sz) + 'px'
                    tk.style.top = (baseY - sz * 1.05) + 'px'
                })
                if (mark) {
                    // 250-1950: crouch, jump (the flip happens in the air, 520-1050), land with a squash, spring back.
                    add(mark.querySelector('.rt-af-hop'), [
                        { transform: 'translate(0px, 0px) scale(1, 1)' },
                        { transform: 'translate(0px, 6px) scale(1.14, 0.8)', offset: 0.16 },
                        { transform: 'translate(0px, -34px) scale(0.9, 1.12)', offset: 0.3 },
                        { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0.47 },
                        { transform: 'translate(0px, 5px) scale(1.18, 0.78)', offset: 0.55 },
                        { transform: 'translate(0px, -6px) scale(0.94, 1.08)', offset: 0.68 },
                        { transform: 'translate(0px, 1px) scale(1.03, 0.97)', offset: 0.8 },
                        { transform: 'translate(0px, 0px) scale(1, 1)' },
                    ], { at: 250, d: 1700, ease: 'ease-in-out' })
                    add(mark.querySelector('.rt-af-spin'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { at: 520, d: 530, ease: 'cubic-bezier(0.45, 0, 0.35, 1)' })
                    // 2150-2850: the pixel shades drop from above and settle across the triangle with one bounce.
                    add(mark.querySelector('.rt-af-shades'), [
                        { transform: 'translate(0px, -120px) rotate(-14deg)', opacity: 0, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
                        { transform: 'translate(0px, -90px) rotate(-10deg)', opacity: 1, offset: 0.12, easing: 'cubic-bezier(0.5, 0, 1, 1)' },
                        { transform: 'translate(0px, 3px) rotate(2deg)', opacity: 1, offset: 0.62, easing: 'cubic-bezier(0, 0, 0.3, 1)' },
                        { transform: 'translate(0px, -5px) rotate(-1deg)', opacity: 1, offset: 0.8, easing: 'cubic-bezier(0.5, 0, 0.5, 1)' },
                        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
                    ], { at: 2150, d: 700 })
                    // 2950-3450: one pixel twinkle on the left lens.
                    add(mark.querySelector('.rt-af-twinkle'), [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.4 },
                        { transform: 'scale(0)', opacity: 0 }], { at: 2950, d: 500, ease: 'steps(2, end)' })
                }
                ticks.forEach((tk) => {
                    add(tk, [{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.35 },
                        { transform: 'scale(1.15)', opacity: 0 }], { at: 1120, d: 420, ease: EASE_OUT })
                })
                // The word: letters swap to the overlay at 1100, shuffle into "muinaTusiR" 1100-1800, hold about 2 s,
                // snap back 3750-4000, and the real text returns at 4000.
                chars.forEach((ch, i) => { placeCh(ch, xs[i]) })
                const adv: number[] = []
                for (let i = 0; i < 10; i++) adv.push(xs[i + 1] - xs[i])
                const revX: number[] = []
                let acc = xs[0]
                for (let j = 0; j < 10; j++) {
                    revX[9 - j] = acc
                    acc += adv[9 - j]
                }
                swapWord(1100, 4000)
                chars.forEach((ch, k) => {
                    const dxn = revX[k] - xs[k]
                    const dx = dxn.toFixed(3)
                    const lift = (k % 2 ? 0.32 : -0.42) * (Math.abs(dxn) > 2 ? 1 : 0.7)
                    const at = 1100 + (k % 5) * 50 + (k > 4 ? 25 : 0)
                    add(ch, [
                        { transform: 'translate(0em, 0em) rotate(0deg)' },
                        { transform: 'translate(' + (dxn * 0.5).toFixed(3) + 'em, ' + lift.toFixed(2) + 'em) rotate(' + (k % 2 ? 10 : -10) + 'deg)', offset: 0.5 },
                        { transform: 'translate(' + dx + 'em, 0em) rotate(0deg)' },
                    ], { at, d: 500, ease: EASE, fill: 'forwards' })
                    add(ch, [{ transform: 'translate(' + dx + 'em, 0em)' }, { transform: 'translate(0em, 0em)' }], { at: 3750, d: 250, ease: SNAP, fill: 'forwards' })
                })
            },
        }
    }

    // ============================================================================================================
    // Variant: tiramisu
    // ============================================================================================================
    function tiramisuImpl(): VariantImpl {
        const chars: HTMLElement[] = []
        for (let c = 0; c < NAME.length; c++) chars.push(makeCh(NAME.charAt(c), c < 4 ? 'a' : 'b'))
        // The R becomes a lowercase r in the middle of "Tiramisu": a second glyph inside the same element.
        const rCapSpan = htmlEl('span', 'rt-af-rcap')
        rCapSpan.textContent = 'R'
        const rLow = htmlEl('span', 'rt-af-rlow')
        rLow.textContent = 'r'
        chars[0].textContent = ''
        chars[0].appendChild(rCapSpan)
        chars[0].appendChild(rLow)
        const dust: HTMLElement[] = []
        for (let d = 0; d < 14; d++) dust.push(htmlEl('i', 'rt-af-dust rt-af-dust-' + (d % 3), sky))
        const ORDER = [4, 1, 0, 5, 9, 7, 2, 3] // source letter for each slot of "Tiramisu": T i r a m i s u
        const LEFT = [6, 8] // n and u float away and puff into cocoa dust
        return {
            timeline(g, xs) {
                const fs = g.fs
                chars.forEach((ch, i) => { placeCh(ch, xs[i]) })
                const widths = ORDER.map((k) => (k === 0 ? cw(rLow) : cw(chars[k])))
                const total = widths.reduce((a, b) => a + b, 0)
                const start = xs[0] + ((xs[10] - xs[0]) - total) / 2
                const slotX: number[] = []
                let acc = start
                for (const w of widths) {
                    slotX.push(acc)
                    acc += w
                }
                swapWord(300, 4000)
                ORDER.forEach((k, s) => {
                    const dx = slotX[s] - xs[k]
                    const up = s % 2 === 0
                    const lift = (up ? -0.42 : 0.38) * (Math.abs(dx) > 1.2 ? 1.1 : 0.8)
                    const rot = up ? -12 : 12
                    const out = 350 + s * 45
                    const back = 2950 + s * 30
                    add(chars[k], [
                        { transform: 'translate(0em, 0em) rotate(0deg)' },
                        { transform: 'translate(' + f3(dx * 0.5) + 'em, ' + lift.toFixed(2) + 'em) rotate(' + rot + 'deg)', offset: 0.5 },
                        { transform: 'translate(' + f3(dx) + 'em, 0em) rotate(0deg)' },
                    ], { at: out, d: 850, ease: EASE, fill: 'forwards' })
                    add(chars[k], [
                        { transform: 'translate(' + f3(dx) + 'em, 0em) rotate(0deg)' },
                        { transform: 'translate(' + f3(dx * 0.5) + 'em, ' + (-lift * 0.8).toFixed(2) + 'em) rotate(' + (-rot) + 'deg)', offset: 0.5 },
                        { transform: 'translate(0em, 0em) rotate(0deg)' },
                    ], { at: back, d: 700, ease: EASE, fill: 'forwards' })
                    if (k === 0) {
                        // R -> r at the middle of the flight and back at the middle of the return.
                        add(rCapSpan, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5002 }, { opacity: 0 }], { at: out, d: 850, fill: 'forwards' })
                        add(rLow, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5002 }, { opacity: 1 }], { at: out, d: 850, fill: 'forwards' })
                        add(rCapSpan, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5002 }, { opacity: 1 }], { at: back, d: 700, fill: 'forwards' })
                        add(rLow, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5002 }, { opacity: 0 }], { at: back, d: 700, fill: 'forwards' })
                    }
                })
                // n and u float up, then puff into cocoa dust; they pop back in near the end.
                LEFT.forEach((k, j) => {
                    const at = 400 + j * 90
                    add(chars[k], [
                        { transform: 'translate(0em, 0em) scale(1)', opacity: 1 },
                        { transform: 'translate(0em, -0.36em) scale(1.2)', opacity: 1, offset: 0.55 },
                        { transform: 'translate(0em, -0.62em) scale(1.45)', opacity: 0 },
                    ], { at, d: 650, ease: EASE_OUT, fill: 'forwards' })
                    add(chars[k], [
                        { transform: 'translate(0em, -0.2em) scale(0.4)', opacity: 0 },
                        { transform: 'translate(0em, 0em) scale(1.18)', opacity: 1, offset: 0.6 },
                        { transform: 'translate(0em, 0em) scale(1)', opacity: 1 },
                    ], { at: 3500 + j * 150, d: 500, ease: EASE_OUT, fill: 'forwards' })
                    // 7 dust motes per letter, bursting from the lifted position.
                    const cxw = g.wx + (xs[k] + cw(chars[k]) / 2) * fs
                    const cyw = Math.max(5, g.wy + g.wh * 0.5 - 0.55 * fs)
                    for (let m = 0; m < 7; m++) {
                        const p = dust[j * 7 + m]
                        const ang = (m / 7) * Math.PI * 2 + j * 0.7
                        const rr = (0.55 + (m % 3) * 0.28) * fs
                        const tx = Math.cos(ang) * rr
                        const ty = Math.sin(ang) * rr * 0.8 - 0.25 * fs
                        p.style.left = f1(cxw - 2) + 'px'
                        p.style.top = f1(cyw - 2) + 'px'
                        add(p, [
                            { transform: 'translate(0px, 0px) scale(0.3)', opacity: 0 },
                            { transform: 'translate(' + f1(tx * 0.6) + 'px, ' + f1(ty * 0.6) + 'px) scale(1.2)', opacity: 0.95, offset: 0.35 },
                            { transform: 'translate(' + f1(tx) + 'px, ' + f1(ty + 0.5 * fs) + 'px) scale(0.7)', opacity: 0 },
                        ], { at: at + 520 + m * 25, d: 900, ease: EASE_OUT })
                    }
                })
                if (mark) {
                    // 2000-3000: the three nested triangles separate (frame down, mid up, core to the top), flipping to point up.
                    add(mark.querySelector('.rt-af-tn'), [{ transform: 'rotate(0deg)', opacity: 1 }, { transform: 'rotate(100deg)', opacity: 1, offset: 0.55 },
                        { transform: 'rotate(180deg)', opacity: 0 }], { at: 2000, d: 1000, ease: 'cubic-bezier(0.45, 0, 0.35, 1)' })
                    const dys = [-18, 15, 50]
                    const nestSel = ['.rt-af-tn1', '.rt-af-tn2', '.rt-af-tn3']
                    nestSel.forEach((sel, i) => {
                        add(mark.querySelector(sel), [{ transform: 'translate(0px, 0px)' }, { transform: 'translate(0px, ' + dys[i] + 'px)' }],
                            { at: 2000, d: 1000, ease: 'cubic-bezier(0.45, 0, 0.35, 1)' })
                    })
                    // 2500-3200: the wedge's three layers settle into place.
                    const from = [-12, 0, 12]
                    const layerSel = ['.rt-af-tb1', '.rt-af-tb2', '.rt-af-tb3']
                    layerSel.forEach((sel, i) => {
                        add(mark.querySelector(sel), [{ transform: 'translate(0px, ' + from[i] + 'px) scale(0.9)', opacity: 0 },
                            { transform: 'translate(0px, 0px) scale(1)', opacity: 1 }], { at: 2500 + i * 80, d: 650, ease: EASE_OUT })
                    })
                    // 3200-3900: the mint leaf pops on the tip.
                    add(mark.querySelector('.rt-af-leaf'), [{ transform: 'scale(0) rotate(-40deg)', opacity: 0, easing: EASE_OUT },
                        { transform: 'scale(1.3) rotate(8deg)', opacity: 1, offset: 0.6, easing: EASE },
                        { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { at: 3200, d: 700 })
                }
            },
        }
    }

    // ============================================================================================================
    // Variant: element
    // ============================================================================================================
    const TYPED = 'Atomic Mass: 299.4 · 99.9% Pure Roleplay Alloy'
    function elementImpl(): VariantImpl {
        const grid = htmlEl('div', 'rt-af-grid', sky)
        const halo = htmlEl('div', 'rt-af-flash', sky)
        const arc = svgFrom('<path class="rt-af-arc-g" d=""/><path class="rt-af-arc-c" d=""/><path class="rt-af-arc-b" d=""/>', 'rt-af-arc', '0 0 100 100')
        sky.appendChild(arc)
        const sparks: HTMLElement[] = []
        for (let sp = 0; sp < 6; sp++) sparks.push(htmlEl('i', 'rt-af-spark', sky))
        const typed = htmlEl('div', 'rt-af-typed', sky)
        const tchars: HTMLElement[] = []
        for (let i = 0; i < TYPED.length; i++) {
            const s = htmlEl('span', 'rt-af-tc', typed)
            s.textContent = TYPED.charAt(i)
            tchars.push(s)
        }
        const caret = htmlEl('i', 'rt-af-caret', typed)
        const chars: HTMLElement[] = []
        for (let c = 0; c < NAME.length; c++) chars.push(makeCh(NAME.charAt(c), 'sheen'))
        return {
            // The sheen gradient's x offset for "Tanium" (static pose), set in em from the measured glyph.
            onFinal() {
                const xs = measure()
                word.style.setProperty('--rt-af-tx', f3(xs[4]) + 'em')
            },
            timeline(g, xs) {
                const fs = g.fs
                chars.forEach((ch, i) => { placeCh(ch, xs[i]) })
                word.style.setProperty('--rt-af-tx', f3(xs[4]) + 'em')
                // Blueprint grid fills the stage, feathered by a static mask in the CSS.
                grid.style.width = g.W + 'px'
                grid.style.height = g.H + 'px'
                add(grid, [{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { at: 0, d: 4400, ease: 'linear' })
                // Typed text: right of the word's left edge (never over the mark), under the word; wraps to two lines on phones.
                const availW = Math.max(60, g.W - g.wx - 6)
                typed.style.left = f1(g.wx) + 'px'
                typed.style.width = f1(availW) + 'px'
                typed.style.fontSize = '10px'
                typed.style.lineHeight = '12px'
                // Real monospace advance (em) of the font in use, then the size that fits one line, or two lines split at the dot.
                const ratio = (tchars[0].getBoundingClientRect().width / 10) || 0.6
                let fsT = Math.min(10, availW / (TYPED.length * ratio))
                if (fsT < 8.5) {
                    fsT = Math.max(6, Math.min(10, availW / (25.4 * ratio)))
                    typed.style.width = f1(Math.min(availW, 25.4 * ratio * fsT)) + 'px'
                }
                if (g.wrapped) fsT = Math.min(fsT, 6.8) // the clamped phone stage is about 56 px tall with a soft bottom edge
                typed.style.fontSize = f1(fsT) + 'px'
                typed.style.lineHeight = f1(fsT * (g.wrapped ? 1.08 : 1.2)) + 'px'
                typed.style.top = f1(g.wy + g.wh * (g.wrapped ? 0.78 : 0.83)) + 'px' // RisuTanium has no descenders: the last 0.2em of the word box is empty
                // Measure each character cell for the caret.
                const tr = typed.getBoundingClientRect()
                const pos = tchars.map((n): [number, number] => {
                    const r = n.getBoundingClientRect()
                    return [r.left - tr.left, r.top - tr.top]
                })
                const step = 38
                const t0 = 500
                tchars.forEach((n, k) => {
                    add(n, [{ opacity: 0 }, { opacity: 1 }], { at: t0 + k * step, d: 1 })
                })
                const kf: Keyframe[] = pos.map((p, k) => ({ transform: 'translate(' + f1(p[0]) + 'px, ' + f1(p[1]) + 'px)', offset: k / pos.length, easing: 'step-end' }))
                const last = pos[pos.length - 1]
                kf.push({ transform: 'translate(' + f1(last[0] + fsT * 0.6) + 'px, ' + f1(last[1]) + 'px)', offset: 1 })
                caret.style.width = f1(fsT * 0.55) + 'px'
                caret.style.height = f1(fsT * 1.05) + 'px'
                add(caret, kf, { at: t0, d: step * tchars.length, ease: 'linear' })
                add(caret, [{ opacity: 0 }, { opacity: 1, offset: 0.001 }, { opacity: 1, offset: 0.999 }, { opacity: 0 }], { at: t0, d: step * tchars.length + 700, ease: 'linear' })
                // The text holds, then fades out; nothing remains in the final pose.
                add(typed, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { at: 3300, d: 700, ease: 'linear' })

                // Electric arc, 2350-2900: a jagged bolt from the top edge, between the mark and the word, into the mark.
                const sx = Math.min(g.wx - 4, g.cx + g.ms * 0.55 + 10)
                const sy = 2
                const ex = g.cx
                const ey = g.cy - g.ms * 0.05
                const amp = g.ms * 0.3
                const seeds = [0, 0.8, -0.9, 0.7, -1, 0.9, -0.6, 0.5, 0]
                const pts = seeds.map((sd, n): [number, number] => {
                    const t = n / (seeds.length - 1)
                    const bx = sx + (ex - sx) * t
                    const by = sy + (ey - sy) * t
                    const dxn = ex - sx
                    const dyn = ey - sy
                    const L = Math.sqrt(dxn * dxn + dyn * dyn) || 1
                    return [bx + (-dyn / L) * amp * sd, by + (dxn / L) * amp * sd]
                })
                const dMain = 'M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L')
                const bp = pts[3]
                const dBranch = 'M' + f1(bp[0]) + ' ' + f1(bp[1]) + 'L' + f1(bp[0] - g.ms * 0.35) + ' ' + f1(bp[1] + g.ms * 0.1) + 'L' + f1(bp[0] - g.ms * 0.5) + ' ' + f1(bp[1] + g.ms * 0.4)
                arc.setAttribute('viewBox', '0 0 ' + f1(g.W) + ' ' + f1(g.H))
                arc.style.width = f1(g.W) + 'px'
                arc.style.height = f1(g.H) + 'px'
                const paths = arc.querySelectorAll<SVGPathElement>('path')
                paths[0].setAttribute('d', dMain)
                paths[1].setAttribute('d', dMain)
                paths[2].setAttribute('d', dBranch)
                let lenMain = 0
                for (let q = 1; q < pts.length; q++) lenMain += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1])
                const lenBr = g.ms * 1.0
                for (const p of [paths[0], paths[1]]) p.style.strokeDasharray = f1(lenMain + 4) + ' ' + f1(lenMain + 40)
                paths[2].style.strokeDasharray = f1(lenBr + 4) + ' ' + f1(lenBr + 40)
                add(paths[0], [{ strokeDashoffset: lenMain + 4 }, { strokeDashoffset: 0 }], { at: 2350, d: 120, ease: 'linear' })
                add(paths[1], [{ strokeDashoffset: lenMain + 4 }, { strokeDashoffset: 0 }], { at: 2350, d: 120, ease: 'linear' })
                add(paths[2], [{ strokeDashoffset: lenBr + 4 }, { strokeDashoffset: 0 }], { at: 2400, d: 120, ease: 'linear' })
                add(arc, [{ opacity: 0 }, { opacity: 1, offset: 0.02 }, { opacity: 1, offset: 0.2 }, { opacity: 0.1, offset: 0.24 }, { opacity: 1, offset: 0.34 },
                    { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.54 }, { opacity: 0.9, offset: 0.62 }, { opacity: 0.9, offset: 0.72 }, { opacity: 0, offset: 0.76 },
                    { opacity: 0 }], { at: 2350, d: 650, ease: 'linear' })
                // Impact flash and sparks.
                const hs = g.ms * 2.6
                halo.style.width = halo.style.height = f1(hs) + 'px'
                halo.style.left = f1(g.cx - hs / 2) + 'px'
                halo.style.top = f1(g.cy - hs / 2) + 'px'
                add(halo, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.18 }, { opacity: 0.25, transform: 'scale(0.9)', offset: 0.36 },
                    { opacity: 0.8, transform: 'scale(1.1)', offset: 0.5 }, { opacity: 0, transform: 'scale(1.4)' }], { at: 2400, d: 700, ease: EASE_OUT })
                sparks.forEach((n, k) => {
                    const a = k * 60 + 20
                    n.style.left = f1(g.cx - 1) + 'px'
                    n.style.top = f1(g.cy - 5) + 'px'
                    add(n, [{ transform: 'rotate(' + a + 'deg) translateY(' + f1(-g.ms * 0.3) + 'px) scaleY(0.4)', opacity: 0 },
                        { transform: 'rotate(' + a + 'deg) translateY(' + f1(-g.ms * 0.55) + 'px) scaleY(1)', opacity: 1, offset: 0.3 },
                        { transform: 'rotate(' + a + 'deg) translateY(' + f1(-g.ms * 0.95) + 'px) scaleY(0.6)', opacity: 0 }], { at: 2650, d: 520, ease: EASE_OUT })
                })
                if (mark) {
                    // 2350-2750 the nested mark strobes; 2700-3350 it flips (card-style) into the chrome tile.
                    add(mark.querySelector('.rt-af-en'), [{ opacity: 1, transform: 'scale(1, 1)', easing: 'steps(1, end)' }, { opacity: 0.2, offset: 0.1, transform: 'scale(1, 1)', easing: 'steps(1, end)' },
                        { opacity: 1, offset: 0.22, transform: 'scale(1, 1)', easing: 'steps(1, end)' }, { opacity: 0.3, offset: 0.34, transform: 'scale(1, 1)', easing: 'steps(1, end)' },
                        { opacity: 1, offset: 0.5, transform: 'scale(1, 1)', easing: EASE_IN }, { opacity: 1, offset: 0.85, transform: 'scale(1, 1)', easing: EASE_IN },
                        { opacity: 1, offset: 0.9, transform: 'scale(0, 1)' }, { opacity: 0, transform: 'scale(0, 1)' }], { at: 2350, d: 1200, ease: 'linear' })
                    add(mark.querySelector('.rt-af-tile'), [{ transform: 'scale(0, 1)', opacity: 0, easing: 'linear' }, { transform: 'scale(0, 1)', opacity: 0, offset: 0.001, easing: EASE_OUT },
                        { transform: 'scale(1.1, 1)', opacity: 1, offset: 0.6, easing: EASE }, { transform: 'scale(1, 1)', opacity: 1 }], { at: 2900, d: 700 })
                }
                // 3300-3900: the word takes its silver-cyan sheen (the overlay carries the same gradient as the final CSS).
                add(scr, [{ opacity: 0 }, { opacity: 1 }], { at: 3300, d: 600, ease: 'linear' })
                // The overlay stays above the real text from here on: it is hidden in the final pose, where the real text
                // is painted with the identical gradient.
            },
        }
    }

    // ============================================================================================================
    // Variant: acorn
    // ============================================================================================================
    function acornImpl(): VariantImpl {
        const tail = htmlEl('span', 'rt-af-tail', word)
        tail.setAttribute('aria-hidden', 'true')
        tail.appendChild(svgFrom(
            tailLayer('o', 4.5) + tailLayer('b', 0) + tailLayer('s', 0) +
            '<path class="rt-af-tail-h" d="M23 82C10 69 11 45 25 31"/>', 'rt-af-tailsvg', '0 0 60 90'))
        const fly = htmlEl('span', 'rt-af-fly', sky)
        fly.appendChild(svgFrom('<path class="rt-af-ac-stem" d="M-2-31Q-3-38 1-40Q3-36 2-31Z"/><path class="rt-af-ac-body" d="M-24-9Q-26 11-8 27Q0 33 8 27Q26 11 24-9Q0-3-24-9Z"/>' +
            '<path class="rt-af-ac-cap" d="M-29-12C-29-27-16-32 0-32S29-27 29-12Q0-5-29-12Z"/><path class="rt-af-ac-hatch" d="M-22-27L-6-12M-8-30L8-12M8-30L20-14M20-26L8-12M6-30L-8-12M-8-28L-20-14"/>', 'rt-af-flysvg', '-34 -42 68 80'))
        const bits: HTMLElement[] = []
        for (let b = 0; b < 6; b++) bits.push(htmlEl('i', 'rt-af-bit', sky))
        const risuCh: HTMLElement[] = []
        const acCh: HTMLElement[] = []
        const tanCh: HTMLElement[] = []
        for (let r = 0; r < 4; r++) risuCh.push(makeCh('Risu'.charAt(r), 'a'))
        for (let a = 0; a < 5; a++) acCh.push(makeCh('Acorn'.charAt(a), 'ac'))
        for (let t = 0; t < 6; t++) tanCh.push(makeCh('Tanium'.charAt(t), 'b'))
        return {
            timeline(g, xs) {
                const fs = g.fs
                risuCh.forEach((ch, i) => { placeCh(ch, xs[i]) })
                tanCh.forEach((ch, i) => { placeCh(ch, xs[4 + i]) })
                // "Acorn" in place of "Risu": natural widths, tightened so "Tanium" shifts by about 0.5em at most.
                const w = acCh.map(cw)
                const sumw = w.reduce((p, q) => p + q, 0)
                const ls = Math.max(-0.07, Math.min(0, (xs[4] + 0.45 - sumw) / 4))
                let ax = xs[0]
                const acX: number[] = []
                for (const ww of w) {
                    acX.push(ax)
                    ax += ww + ls
                }
                const shift = Math.max(0, ax - ls - xs[4])
                acCh.forEach((ch, i) => { placeCh(ch, acX[i]) })

                // Tail: grows in behind the R, wiggles, winds up and flicks the acorn, then curls away.
                add(tail, [
                    { transform: 'scale(0.15) rotate(-30deg)', opacity: 0, easing: EASE_OUT },
                    { transform: 'scale(1.1) rotate(5deg)', opacity: 1, offset: 0.55, easing: EASE },
                    { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { at: 300, d: 700 })
                add(tail, [
                    { transform: 'scale(1) rotate(0deg)', easing: EASE },
                    { transform: 'scale(1) rotate(-5deg)', offset: 0.5, easing: EASE },
                    { transform: 'scale(1) rotate(0deg)' }], { at: 1000, d: 400, fill: 'forwards' })
                add(tail, [
                    { transform: 'scale(1) rotate(0deg)', easing: EASE },
                    { transform: 'scale(1) rotate(15deg)', offset: 0.45, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' }, // wind up
                    { transform: 'scale(1) rotate(-32deg)', offset: 0.7, easing: EASE_OUT }, // flick
                    { transform: 'scale(1) rotate(-6deg)', offset: 0.88, easing: EASE },
                    { transform: 'scale(1) rotate(0deg)' }], { at: 1450, d: 900, fill: 'forwards' })
                add(tail, [
                    { transform: 'scale(1) rotate(0deg)', opacity: 1, easing: EASE_IN },
                    { transform: 'scale(0.2) rotate(-35deg)', opacity: 0 }], { at: 2500, d: 600, fill: 'forwards' })

                // The acorn: pops in the curl, then flies across the stage into the mark slot.
                const sx = g.wx + fs * 0.3
                const sy = g.wy + fs * 0.02
                const ex = g.cx
                const ey = g.cy
                const peak = Math.max(6, Math.min(sy, ey) - Math.max(14, g.ms * 0.5))
                const N = 12
                const frames: Keyframe[] = []
                for (let n = 0; n <= N; n++) {
                    const u = n / N
                    const x = sx + (ex - sx) * u
                    const y = sy + (ey - sy) * u + ((peak - Math.min(sy, ey)) * 4 * u * (1 - u))
                    const sc = u < 0.82 ? 1 : 1 - (u - 0.82) / 0.18 * 0.55
                    frames.push({ transform: 'translate(' + f1(x) + 'px, ' + f1(y) + 'px) rotate(' + Math.round(u * -600) + 'deg) scale(' + f3(sc) + ')',
                        opacity: u > 0.96 ? 0 : 1, offset: u })
                }
                fly.style.left = '0px'
                fly.style.top = '0px'
                const flyW = Math.max(14, Math.min(20, g.ms * 0.7))
                fly.style.width = flyW + 'px'
                fly.style.height = (flyW * 80 / 68) + 'px'
                fly.style.marginLeft = f1(-flyW / 2) + 'px'
                fly.style.marginTop = f1(-flyW * 80 / 68 * 0.52) + 'px'
                add(fly, [{ transform: 'translate(' + f1(sx) + 'px, ' + f1(sy) + 'px) scale(0)', opacity: 0, easing: POP },
                    { transform: 'translate(' + f1(sx) + 'px, ' + f1(sy) + 'px) scale(1)', opacity: 1 }], { at: 1350, d: 250, fill: 'both', ease: 'linear' })
                add(fly, frames, { at: 1750, d: 900, ease: 'linear', fill: 'forwards' })
                // Landing bits.
                bits.forEach((bn, k) => {
                    const an = (k / bits.length) * Math.PI * 2 + 0.4
                    bn.style.left = f1(ex - 2) + 'px'
                    bn.style.top = f1(ey - 2) + 'px'
                    add(bn, [{ transform: 'translate(0px, 0px) scale(0.3)', opacity: 0 },
                        { transform: 'translate(' + f1(Math.cos(an) * g.ms * 0.55) + 'px, ' + f1(Math.sin(an) * g.ms * 0.55) + 'px) scale(1)', opacity: 1, offset: 0.35 },
                        { transform: 'translate(' + f1(Math.cos(an) * g.ms * 0.85) + 'px, ' + f1(Math.sin(an) * g.ms * 0.85 + 4) + 'px) scale(0.5)', opacity: 0 }], { at: 2650, d: 520, ease: EASE_OUT })
                })

                // Word: Risu -> Acorn (+ Tanium shifts right), hold, then back.
                swapWord(1700, 4000)
                risuCh.forEach((ch, i) => {
                    add(ch, [{ transform: 'scale(1) rotate(0deg)', opacity: 1, easing: EASE_IN }, { transform: 'scale(0.2) rotate(' + (i % 2 ? 40 : -40) + 'deg)', opacity: 0 }],
                        { at: 1780 + i * 55, d: 280, fill: 'forwards' })
                    add(ch, [{ transform: 'scale(0.2) rotate(' + (i % 2 ? -40 : 40) + 'deg)', opacity: 0, easing: POP }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
                        { at: 3600 + i * 50, d: 330, fill: 'forwards' })
                })
                acCh.forEach((ch, i) => {
                    add(ch, [{ transform: 'scale(0.2) rotate(' + (i % 2 ? 30 : -30) + 'deg)', opacity: 0, easing: POP }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
                        { at: 1950 + i * 65, d: 380, fill: 'both' })
                    add(ch, [{ transform: 'scale(1) rotate(0deg)', opacity: 1, easing: EASE_IN }, { transform: 'scale(0.2) rotate(' + (i % 2 ? -35 : 35) + 'deg)', opacity: 0 }],
                        { at: 3500 + i * 50, d: 280, fill: 'forwards' })
                })
                tanCh.forEach((ch) => {
                    add(ch, [{ transform: 'translate(0em, 0em)' }, { transform: 'translate(' + f3(shift) + 'em, 0em)' }], { at: 1950, d: 400, ease: EASE, fill: 'forwards' })
                    add(ch, [{ transform: 'translate(' + f3(shift) + 'em, 0em)' }, { transform: 'translate(0em, 0em)' }], { at: 3600, d: 380, ease: SNAP, fill: 'forwards' })
                })

                if (mark) {
                    // 2650-3000: the triangle squashes on impact and gives way; the acorn pops in and settles (2700-3350).
                    add(mark.querySelector('.rt-af-an'), [{ transform: 'scale(1, 1)', opacity: 1, easing: EASE_OUT },
                        { transform: 'scale(1.25, 0.7)', opacity: 1, offset: 0.35, easing: EASE_IN }, { transform: 'scale(0.5, 0.5)', opacity: 0 }], { at: 2650, d: 400 })
                    add(mark.querySelector('.rt-af-ac'), [{ transform: 'scale(0.3) rotate(-25deg)', opacity: 0, easing: EASE_OUT },
                        { transform: 'scale(1.15) rotate(4deg)', opacity: 1, offset: 0.5, easing: EASE }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { at: 2750, d: 650 })
                }
            },
        }
    }

    const IMPLS: Record<Variant, () => VariantImpl> = { invert: invertImpl, tiramisu: tiramisuImpl, element: elementImpl, acorn: acornImpl }
    impl = IMPLS[variant]()

    function timeline(): void {
        add(sky, [{ opacity: 1 }, { opacity: 1 }], { d: CLOCK }) // scene clock, always anims[0]
        const g = geom()
        sky.classList.toggle('rt-af-wrapped', g.wrapped)
        if (impl) impl.timeline(g, measure())
    }

    // Host seam: while playing, rebuild the timeline (placement, measurement) and jump every animation to the current
    // scene time (the clock, anims[0]). The end timer restarts with it.
    function relayout(): void {
        if (state !== 'playing' || !anims.length) return
        const t = Number(anims[0].currentTime) || 0
        const paused = anims[0].playState === 'paused'
        cancelAll()
        timeline()
        for (const a of anims) {
            a.currentTime = t
            if (paused) a.pause()
        }
        later(() => { if (state === 'playing') applyFinal() }, Math.max(0, CLOCK - t))
    }
    ctx.onRelayout(relayout)

    return {
        play() {
            if (state !== 'built') return Promise.resolve()
            lastPlayed = true
            state = 'playing'
            timeline()
            return new Promise<void>((resolve) => {
                resolvePlay = resolve
                later(() => { if (state === 'playing') applyFinal() }, CLOCK)
            })
        },
        finish() {
            if (state === 'destroyed') return
            applyFinal()
        },
        destroy() {
            cancelAll()
            state = 'destroyed'
            const tailEl = word.querySelector('.rt-af-tail')
            if (tailEl && tailEl.parentNode) tailEl.parentNode.removeChild(tailEl)
            if (sky.parentNode) sky.parentNode.removeChild(sky)
            if (mark && mark.parentNode) mark.parentNode.removeChild(mark)
            if (scr.parentNode) scr.parentNode.removeChild(scr)
            word.classList.remove('rt-af-word', 'rt-af-final')
            for (const v of VARIANTS) word.classList.remove('rt-af-v-' + v)
            word.removeAttribute('data-af-variant')
            word.style.removeProperty('--rt-af-tx')
            settle()
        },
    }
}

const scene: SceneDef = { key: 'aprilFool', durationMs: DURATION, build }
export default scene
