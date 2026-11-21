// Seasonal scene: valentine (Feb 14, all locales).
//
// Storyboard (6.3 s): a small blush glows around the mark 0-0.7 s (out 3.6-4.4 s); a constellation trail draws over the
// word behind a comet 0.2-2.4 s with nine stars lighting as it passes, all fading 3.3-4.0 s; the mark's frame turns
// rose-gold 1.5-2.3 s, the table facet grows 1.8-2.4 s and fourteen crown facets assemble 2.0-3.7 s; heartbeat
// 3.8-4.6 s, glint sweep 4.45-5.0 s, sparkle 4.9-5.4 s; a small heart pops onto the first "i" dot 4.7-5.25 s with a warm
// halo 4.9-5.6 s and one twinkle 5.1-5.9 s. Final: heart-prism mark, heart on the "i" dot, no trail or blush.
// Only transform and opacity are animated (Web Animations API), plus stroke-dashoffset on the trail. No filters.
// The final pose is static CSS under .rt-vl-final, so finish() is identical from any point.
import './valentine.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DURATION = 6500
// The scene clock (last keyframe) ends at 6300 ms.
const CLOCK = 6300
const VIEWBOX = '-73 -66 146 146'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

type Pt = [number, number]
type PointName = 'N' | 'a1' | 'a2' | 'a3' | 'a4' | 'Q' | 'B' | 'T2' | 'T3'

// Rose-quartz heart prism, cut to sit inside the frame's hole (inset ~2.5 units) with straight sides parallel to the
// hole's sides. MID is the table facet; the crown facets fan from it. Points are the right half; the left mirrors.
const P: Record<PointName, Pt> = {
    N: [0, -6.72], a1: [5.5, -12.6], a2: [12, -14.8], a3: [19, -14.8], a4: [22.9, -10.2], Q: [11.45, 9.7],
    B: [0, 29.6], T2: [11.63, -6.72], T3: [0, 13.43],
}
// Facets in build order (inner first), right half; colours are [right (shade), left (lit)].
const FACETS: ReadonlyArray<readonly [PointName, PointName, PointName, string, string]> = [
    ['N', 'a1', 'T2', '#ffc9d6', '#ffe3ea'],
    ['a1', 'a2', 'T2', '#ffb8ca', '#ffd3de'],
    ['T2', 'Q', 'T3', '#f4668a', '#ff8fab'],
    ['a2', 'a3', 'T2', '#ffa6bd', '#ffc2d1'],
    ['a4', 'Q', 'T2', '#fb7c9c', '#ff9db5'],
    ['a3', 'a4', 'T2', '#ff94ae', '#ffb0c3'],
    ['Q', 'B', 'T3', '#e65079', '#ff7a9c'],
]

function pt(name: PointName, mirror?: boolean): Pt {
    const p = P[name]
    return [mirror ? -p[0] : p[0], p[1]]
}
function poly(pts: Pt[]): string {
    return 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z'
}
const HEART = poly((['N', 'a1', 'a2', 'a3', 'a4', 'B'] as PointName[]).map((n) => pt(n))
    .concat((['a4', 'a3', 'a2', 'a1'] as PointName[]).map((n) => pt(n, true))))
// Four-point sparkle, unit radius 1 (scaled by its group).
const SPARK = 'M0-1C.12-.3.3-.12 1 0C.3.12.12.3 0 1C-.12.3-.3.12-1 0C-.3-.12-.12-.3 0-1Z'
// Small rounded heart for the "i" dot, viewBox 0 0 20 18.
const DOT_HEART = 'M10 17.2C4.2 13.1 .8 9.6 .8 5.6C.8 2.6 3 .8 5.5 .8C7.4 .8 9 1.9 10 3.6C11 1.9 12.6 .8 14.5 .8C17 .8 19.2 2.6 19.2 5.6C19.2 9.6 15.8 13.1 10 17.2Z'
const DOT_SHINE = 'M4.6 4.4C5.4 3.3 6.8 3 7.8 3.6'

const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const TRAIL = [0.45, 0, 0.3, 1] as const
const TRAIL_CSS = 'cubic-bezier(' + TRAIL.join(',') + ')'

interface RunOptions {
    /** Delay in ms. */
    at?: number
    /** Duration in ms. */
    d: number
    ease?: string
    /** Keeps an effect-level easing (the comet rides the line's eased head) instead of moving it onto each keyframe. */
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
    wrapped: boolean
}

interface TrailStar {
    f: number
    x: number
    y: number
    r: number
}

interface TrailGeom {
    d: string
    total: number
    stars: TrailStar[]
    comet: Pt[]
    x0: number
    x1: number
}

function sid(uid: string): string {
    return 'rt-vl-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('valentine: svg markup did not parse')
    return n
}

function facetMarkup(): string {
    let out = ''
    FACETS.forEach((f, i) => {
        for (const side of ['r', 'l']) {
            const m = side === 'l'
            const pts: Pt[] = [pt(f[0], m), pt(f[1], m), pt(f[2], m)]
            out += '<path class="rt-vl-facet" data-order="' + (i * 2 + (m ? 1 : 0)) + '" fill="' + (m ? f[4] : f[3]) + '" d="' + poly(pts) + '"/>'
        }
    })
    return out
}

// Mark markup; `id` prefixes the defs.
function markMarkup(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-rose" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="rt-vl-r0"/><stop offset="1" class="rt-vl-r1"/></linearGradient>' +
        '<linearGradient id="' + id + '-table" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2f6"/><stop offset="1" stop-color="#ffc4d2"/></linearGradient>' +
        '<linearGradient id="' + id + '-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b81"/><stop offset="1" stop-color="#ffb38a"/></linearGradient>' +
        '<clipPath id="' + id + '-heartclip"><path d="' + HEART + '"/></clipPath>' +
        '</defs>' +
        '<g class="rt-vl-heart">' +
        facetMarkup() +
        '<g class="rt-vl-table">' +
        '<path class="rt-vl-tablefacet" fill="url(#' + id + '-table)" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-gem)" d="' + CORE + '"/>' +
        '</g>' +
        '<path class="rt-vl-outline" d="' + HEART + '"/>' +
        '<g clip-path="url(#' + id + '-heartclip)"><rect class="rt-vl-glint" x="-6" y="-40" width="7" height="90"/></g>' +
        '</g>' +
        '<g class="rt-vl-every">' +
        '<path class="rt-vl-ink rt-vl-every-frame" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<g class="rt-vl-every-inner"><path class="rt-vl-ink" d="' + MID + '"/><path fill="url(#' + id + '-core)" d="' + CORE + '"/></g>' +
        '</g>' +
        '<path class="rt-vl-roseframe" fill="url(#' + id + '-rose)" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<g class="rt-vl-sparkpos" transform="translate(-15 -10.5) scale(5.2)"><path class="rt-vl-sparkle" d="' + SPARK + '"/></g>'
}

function dotMarkup(id: string): string {
    return '<defs><linearGradient id="' + id + '-dotgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="rt-vl-d0"/><stop offset="1" class="rt-vl-d1"/></linearGradient></defs>' +
        '<path fill="url(#' + id + '-dotgrad)" class="rt-vl-dotheart" d="' + DOT_HEART + '"/>' +
        '<path class="rt-vl-dotshine" d="' + DOT_SHINE + '"/>'
}

// Finds the visual "Risu" span inside the word without relying on the host's class names.
function findLeafSpan(root: HTMLElement, text: string): HTMLElement | null {
    for (const n of Array.from(root.querySelectorAll('span'))) {
        if (n.children.length === 0 && n.textContent === text) return n
    }
    return null
}

// Inverse of a CSS cubic-bezier easing: the input progress at which the eased output reaches y.
function bezierInv(x1: number, y1: number, x2: number, y2: number, y: number): number {
    const bx = (t: number): number => { const u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t }
    const by = (t: number): number => { const u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t }
    let lo = 0
    let hi = 1
    for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        if (by(mid) < y) lo = mid
        else hi = mid
    }
    return bx((lo + hi) / 2)
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null

    // ----- Stage: blush wash and the constellation trail (rebuilt from the live geometry) -----
    const sky = htmlEl('div', 'rt-vl-sky', ctx.stage)
    sky.setAttribute('aria-hidden', 'true')
    const blush = htmlEl('div', 'rt-vl-blush', sky)
    const trailHost = htmlEl('div', 'rt-vl-trailhost', sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-vl-mark', VIEWBOX)
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: a heart over the first "i" dot -----
    const word = ctx.word
    word.classList.add('rt-vl-word')
    const risu = findLeafSpan(word, 'Risu')
    const dot = htmlEl('span', 'rt-vl-dot', word)
    dot.setAttribute('aria-hidden', 'true')
    const halo = htmlEl('span', 'rt-vl-halo', dot)
    const dotPop = htmlEl('span', 'rt-vl-dotpop', dot)
    dotPop.appendChild(svgFrom(dotMarkup(id), 'rt-vl-dotsvg', '0 0 20 18'))
    const twinkle = htmlEl('span', 'rt-vl-twinkle', dot)
    twinkle.appendChild(svgFrom('<path d="' + SPARK + '"/>', 'rt-vl-twinklesvg', '-1 -1 2 2'))

    ctx.setDescription('Happy Valentine’s Day!', 'en')

    function placeDot(): void {
        // Centre of the first "i" in em from the word box's left edge (NanumSquare Neo: 0.906em).
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 0.906
        if (risu && risu.firstChild && typeof document.createRange === 'function') {
            try {
                const r = document.createRange()
                r.setStart(risu.firstChild, 1)
                r.setEnd(risu.firstChild, 2)
                const gr = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (gr.width > 0) x = (gr.left + gr.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        dot.style.setProperty('--rt-vl-ix', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeDot()
    }
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts)

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
        for (const n of [sky, mark, word]) if (n) n.classList.toggle('rt-vl-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeDot()
        setFinal(true)
        state = 'final'
        settle()
    }

    // With more than two keyframes the easing goes on each keyframe (a keyframe's own easing wins) and the effect stays
    // linear, so every keyframe offset is a real time (delay + offset x duration). `whole` keeps the effect-level easing.
    function add(node: Element | null, frames: Keyframe[], o: RunOptions): Animation | null {
        if (!node) return null
        let ease = o.ease || 'linear'
        let fr = frames
        if (frames.length > 2 && !o.whole && ease !== 'linear') {
            const ez = ease
            ease = 'linear'
            fr = frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing: ez }))
        }
        const a = node.animate(fr, { duration: o.d, delay: o.at || 0, easing: ease, fill: 'both' })
        anims.push(a)
        return a
    }

    // Stage geometry, re-measured on every layout.
    function geom(): Geom {
        const box = ctx.stageBox()
        const s = ctx.stage.getBoundingClientRect()
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
        return { W, H, cx, cy, ms, wx, wy, ww: wr.width, wh: wr.height, wrapped: box.wrapped }
    }

    // The trail: a smooth cubic arc from just right of the mark, over the word, to the right. It ends below the word's top
    // only where the stage has room right of the word; otherwise it stays in the band above the word. Returns the path, an
    // arc-length table and the stars placed at length fractions.
    function trailGeom(g: Geom): TrailGeom {
        const sx = g.cx + g.ms * 0.42
        const sy = g.cy - g.ms * 0.3
        const wordRight = g.wx + g.ww
        const roomy = g.W - wordRight > 90
        const ex = g.W - (roomy ? 18 : 8)
        const ey = roomy ? Math.min(g.H - 16, g.wy + g.wh * 0.55) : Math.max(5, g.wy - 7)
        const top = Math.max(2, Math.min(7, g.wy * 0.22))
        const c1: Pt = [sx + (ex - sx) * 0.2, top - (roomy ? 7 : 5)]
        const c2: Pt = [sx + (ex - sx) * 0.72, top - (roomy ? 9 : 5)]
        const at = (t: number): Pt => {
            const u = 1 - t
            return [u * u * u * sx + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * ex,
                u * u * u * sy + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * ey]
        }
        const N = 24
        const pts: Pt[] = []
        const lens = [0]
        let total = 0
        for (let i = 0; i <= N; i++) {
            pts.push(at(i / N))
            if (i) {
                total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
                lens.push(total)
            }
        }
        const atLen = (f: number): Pt => {
            const L = f * total
            let k = 1
            while (k < N && lens[k] < L) k++
            const t0 = lens[k - 1]
            const t1 = lens[k]
            const w = t1 > t0 ? (L - t0) / (t1 - t0) : 0
            return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * w, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * w]
        }
        // Stars at uneven fractions, nudged off the arc like a constellation.
        const fr = [0.03, 0.15, 0.27, 0.38, 0.5, 0.61, 0.72, 0.85, 0.97]
        const jit = [0, -3, 2.5, -2, 3, -2.5, 2, -3, 0]
        const size = [2.4, 3.2, 2.2, 4, 2.6, 3.4, 2.2, 3, 4.4]
        const k2 = g.wrapped ? 0.8 : 1
        const stars = fr.map((f, i): TrailStar => {
            const p = atLen(f)
            const q = atLen(Math.min(1, f + 0.01))
            const dx = q[0] - p[0]
            const dy = q[1] - p[1]
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            return { f, x: p[0] - dy / len * jit[i], y: Math.max(size[i] * k2 + 1, p[1] + dx / len * jit[i]), r: size[i] * k2 }
        })
        const d = 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'C' + c1.map((v) => v.toFixed(1)).join(' ') + ' ' +
            c2.map((v) => v.toFixed(1)).join(' ') + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1)
        const comet: Pt[] = []
        for (let c = 0; c <= 12; c++) comet.push(atLen(c / 12))
        return { d, total, stars, comet, x0: sx, x1: ex }
    }

    function buildTrail(g: Geom, tg: TrailGeom): SVGSVGElement {
        trailHost.textContent = ''
        const gid = id + '-trailgrad'
        // Stars are scaled groups, where a userSpaceOnUse gradient would be evaluated in their scaled space, so each star
        // gets a flat colour sampled along the trail instead (same end colours as the line's gradient).
        const light = ctx.theme === 'light'
        const a = light ? [214, 51, 90] : [255, 107, 129]
        const b = light ? [221, 107, 53] : [255, 179, 138]
        let m = '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + tg.x0.toFixed(1) + '" y1="0" x2="' + tg.x1.toFixed(1) + '" y2="0">' +
            '<stop offset="0" class="rt-vl-t0" stop-opacity="0"/><stop offset=".18" class="rt-vl-t0"/><stop offset="1" class="rt-vl-t1"/></linearGradient></defs>' +
            '<path class="rt-vl-line" stroke="url(#' + gid + ')" d="' + tg.d + '"/>'
        tg.stars.forEach((s, i) => {
            const t = Math.max(0, Math.min(1, (s.x - tg.x0) / Math.max(1, tg.x1 - tg.x0)))
            const fill = 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',') + ')'
            m += '<g transform="translate(' + s.x.toFixed(1) + ' ' + s.y.toFixed(1) + ') scale(' + s.r.toFixed(2) + ')"><path class="rt-vl-star" data-i="' + i + '" fill="' + fill + '" d="' + SPARK + '"/></g>'
        })
        m += '<g class="rt-vl-comet"><circle class="rt-vl-comethalo" r="5.5"/><circle class="rt-vl-cometcore" r="1.9"/></g>'
        const svg = svgFrom(m, 'rt-vl-trail', '0 0 ' + Math.round(g.W) + ' ' + Math.round(g.H))
        svg.setAttribute('width', String(Math.round(g.W)))
        svg.setAttribute('height', String(Math.round(g.H)))
        trailHost.appendChild(svg)
        return svg
    }

    function timeline(): void {
        add(sky, [{ opacity: 1 }, { opacity: 1 }], { d: CLOCK }) // scene clock, always anims[0]
        const g = geom()
        sky.classList.toggle('rt-vl-wrapped', g.wrapped)
        blush.style.setProperty('--rt-vl-mx', g.cx.toFixed(1) + 'px')
        blush.style.setProperty('--rt-vl-my', g.cy.toFixed(1) + 'px')
        const tg = trailGeom(g)
        const trail = buildTrail(g, tg)

        // 1. Blush 0-700 in, holds, 3600-4400 out.
        add(blush, [{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }], { d: 4400 })
        // 1. Constellation trail: the arc draws 200-2400 behind a comet; stars light as it passes; all fade 3300-4000.
        add(trail, [{ opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 1, offset: 0.825 }, { opacity: 0 }], { d: 4000 })
        const line = trail.querySelector<SVGPathElement>('.rt-vl-line')
        if (line) {
            const total = tg.total + 2
            line.style.strokeDasharray = total.toFixed(1) + ' ' + (total + 10).toFixed(1)
            add(line, [{ strokeDashoffset: total }, { strokeDashoffset: 0 }], { at: 200, d: 2200, ease: TRAIL_CSS })
        }
        const comet = trail.querySelector('.rt-vl-comet')
        add(comet, tg.comet.map((p) => ({ transform: 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)' })),
            { at: 200, d: 2200, ease: TRAIL_CSS, whole: true })
        add(comet, [{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { at: 200, d: 2600 })
        trail.querySelectorAll('.rt-vl-star').forEach((s, k) => {
            const at = 200 + 2200 * bezierInv(TRAIL[0], TRAIL[1], TRAIL[2], TRAIL[3], tg.stars[k].f)
            add(s, [{ transform: 'scale(0) rotate(-45deg)', opacity: 0 }, { transform: 'scale(1.5) rotate(0deg)', opacity: 1, offset: 0.4 },
                { transform: 'scale(1) rotate(0deg)', opacity: 0.9 }], { at: Math.max(0, at - 60), d: 520, ease: EASE_OUT })
        })

        if (mark) {
            // 2. 1500-2300: the frame turns rose-gold; the everyday inner triangles shrink away; the table facet grows.
            add(mark.querySelector('.rt-vl-every-frame'), [{ opacity: 1 }, { opacity: 0 }], { at: 1500, d: 800, ease: 'ease-in-out' })
            add(mark.querySelector('.rt-vl-roseframe'), [{ opacity: 0 }, { opacity: 1 }], { at: 1500, d: 800, ease: 'ease-in-out' })
            add(mark.querySelector('.rt-vl-every-inner'), [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.4)', opacity: 0 }], { at: 1500, d: 600, ease: EASE_IN })
            add(mark.querySelector('.rt-vl-table'), [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { at: 1800, d: 600, ease: POP })
            // 2. 2000-3690: fourteen crown facets assemble from the table outward, mirrored pairs together.
            mark.querySelectorAll('.rt-vl-facet').forEach((f) => {
                const order = Number(f.getAttribute('data-order'))
                const pair = order >> 1
                const left = order & 1
                const tw = left ? -14 : 14
                add(f, [{ transform: 'scale(0.25) rotate(' + tw + 'deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
                    { at: 2000 + pair * 160 + left * 40, d: 650, ease: POP })
            })
            add(mark.querySelector('.rt-vl-outline'), [{ opacity: 0 }, { opacity: 1 }], { at: 3000, d: 600 })
            // 2b. Heartbeat 3800-4600 (two beats), glint sweep 4450-5000, sparkle 4900-5400.
            add(mark.querySelector('.rt-vl-heart'), [{ transform: 'scale(1)' }, { transform: 'scale(1.09)', offset: 0.18 }, { transform: 'scale(1)', offset: 0.4 },
                { transform: 'scale(1.06)', offset: 0.58 }, { transform: 'scale(1)' }], { at: 3800, d: 800, ease: 'ease-in-out' })
            add(mark.querySelector('.rt-vl-glint'), [{ transform: 'translate(-34px, 0px) rotate(28deg)', opacity: 0 },
                { transform: 'translate(-20px, 0px) rotate(28deg)', opacity: 0.9, offset: 0.25 },
                { transform: 'translate(30px, 0px) rotate(28deg)', opacity: 0.9, offset: 0.85 },
                { transform: 'translate(36px, 0px) rotate(28deg)', opacity: 0 }], { at: 4450, d: 550, ease: 'ease-in-out' })
            add(mark.querySelector('.rt-vl-sparkle'), [{ transform: 'scale(0) rotate(-60deg)', opacity: 0 },
                { transform: 'scale(1.35) rotate(0deg)', opacity: 1, offset: 0.5 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
                { at: 4900, d: 500, ease: EASE_OUT })
        }

        // 3. The heart pops onto the "i" dot 4700-5250; its halo warms 4900-5600; one twinkle 5100-5900.
        placeDot()
        add(dotPop, [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.55 },
            { transform: 'scale(0.92)', opacity: 1, offset: 0.8 }, { transform: 'scale(1)', opacity: 1 }], { at: 4700, d: 550, ease: EASE_OUT })
        add(halo, [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1.1)', offset: 0.45 },
            { opacity: 0.75, transform: 'scale(1)' }], { at: 4900, d: 700, ease: EASE_OUT })
        add(twinkle, [{ transform: 'scale(0) rotate(0deg)', opacity: 0 }, { transform: 'scale(1) rotate(45deg)', opacity: 1, offset: 0.4 },
            { transform: 'scale(0) rotate(90deg)', opacity: 0 }], { at: 5100, d: 800, ease: 'ease-in-out' })
    }

    // Host seam: while playing, rebuild the stage timeline from the new geometry and jump every animation to the current
    // scene time (read from the clock, anims[0]). The end timer restarts with it.
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placeDot()
            return
        }
        if (!anims.length) return
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

    placeDot()
    return {
        play() {
            if (state !== 'built') return Promise.resolve()
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
            if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts)
            if (sky.parentNode) sky.parentNode.removeChild(sky)
            if (mark && mark.parentNode) mark.parentNode.removeChild(mark)
            if (dot.parentNode) dot.parentNode.removeChild(dot)
            word.classList.remove('rt-vl-word', 'rt-vl-final')
            settle()
        },
    }
}

const scene: SceneDef = { key: 'valentine', durationMs: DURATION, build }
export default scene
