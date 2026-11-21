// Seasonal scene: independenceDay (Jul 4; en only). Original artwork only: no flag reproduction, no logos.
//
// Stage (0-5.0 s): a deep summer-twilight wash and three staggered vector fireworks (sapphire, crimson-coral, white), each a
// launch trail plus two rings of rays drawn with stroke-dashoffset and a ring of star sparks. Mark (1.8-7.2 s): the mark flips
// to a point-up rocket nosecone and unfolds into a faceted five-point star inside the triangle silhouette, with a tri-colour
// shimmer. A tiny sparkler star sits on the "i" dot of "Risu" (pops 2.3-2.95 s, fizzes at 4.0 and 6.0 s).
// Final: the glass badge with the unfolded star and the sparkler, no sky.
// No fonts. Motion is Web Animations only: transform, opacity and stroke-dashoffset. No filters, no loops. The final pose is
// static CSS under .rt-id-final, so finish() gives the same pose from any point, including before play().
import './independenceDay.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The scene clock (the last keyframe) ends at 7200 ms.
const DURATION = 7400
const CLOCK = 7200
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

type Pt = [number, number]
type Tone = 'sap' | 'crim' | 'wht'

// The faceted star: R 33, r 13.2, apex up, centre (0, 2) (the silhouette's visual centre after the flip).
const SR = 33
const SRI = 13.2
const SCY = 2
function pt(rad: number, deg: number): Pt {
    const a = deg * Math.PI / 180
    return [rad * Math.cos(a), SCY + rad * Math.sin(a)]
}
function f(n: number): string {
    return (Math.round(n * 100) / 100).toString()
}
function xy(p: Pt): string {
    return f(p[0]) + ' ' + f(p[1])
}
// Point k (0 = top, clockwise): tip + two inner vertices. Left facet O, I(k-), T; right facet O, T, I(k+).
const TONES: Tone[] = ['sap', 'crim', 'wht', 'sap', 'crim']
function starPoint(k: number, id: string): string {
    const tip = pt(SR, -90 + 72 * k)
    const il = pt(SRI, -90 + 72 * k - 36)
    const ir = pt(SRI, -90 + 72 * k + 36)
    const o: Pt = [0, SCY]
    return '<g class="rt-id-pt rt-id-pt-' + k + '" id="' + id + '-pt' + k + '">' +
        '<path class="rt-id-f rt-id-' + TONES[k] + '-l" d="M' + xy(o) + 'L' + xy(il) + 'L' + xy(tip) + 'Z"/>' +
        '<path class="rt-id-f rt-id-' + TONES[k] + '-r" d="M' + xy(o) + 'L' + xy(tip) + 'L' + xy(ir) + 'Z"/>' +
        '<path class="rt-id-hi" id="' + id + '-hi' + k + '" d="M' + xy(o) + 'L' + xy(il) + 'L' + xy(tip) + 'L' + xy(ir) + 'Z"/>' +
        '</g>'
}
const PLUS = 'M0-1.6L.45-.45L1.6 0L.45.45L0 1.6L-.45.45L-1.6 0L-.45-.45Z'   // four-point twinkle, radius 1.6
const SPARK_STAR = 'M0-1L.26-.26L1 0L.26.26L0 1L-.26.26L-1 0L-.26-.26Z'

function markMarkup(id: string): string {
    const d = '<defs><linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient></defs>'
    let pts = ''
    for (let k = 0; k < 5; k++) pts += starPoint(k, id)
    let tw = ''
    const tips: Array<[number, number, Tone]> = [[-28, -32, 'sap'], [30, -24, 'wht'], [0, 43, 'crim']]
    tips.forEach((t, i) => {
        tw += '<g transform="translate(' + t[0] + ' ' + t[1] + ')"><path class="rt-id-tw rt-id-tw-' + t[2] + '" id="' + id + '-tw' + i + '" d="' + PLUS + '" transform="scale(5)"/></g>'
    })
    return d +
        '<g class="rt-id-lift" id="' + id + '-lift">' +
            '<path class="rt-id-flame" id="' + id + '-flame" d="M-14 36Q0 76 14 36Q0 46 -14 36Z"/>' +
            '<g class="rt-id-glass" id="' + id + '-glass"><path class="rt-id-glassfill" d="M-55.85 32.25H55.85L0-64.49Z"/>' +
                '<path class="rt-id-glassedge" fill-rule="evenodd" d="M-55.85 32.25H55.85L0-64.49ZM-39 22.5L0-45L39 22.5Z"/></g>' +
            '<g class="rt-id-flip" id="' + id + '-flip">' +
                '<path class="rt-id-ink rt-id-ring" fill-rule="evenodd" d="' + FRAME + '"/>' +
                '<path class="rt-id-ink rt-id-mid" d="' + MID + '"/>' +
                '<path class="rt-id-core" fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
            '</g>' +
            '<g class="rt-id-star" id="' + id + '-star">' + pts + '</g>' +
            '<g class="rt-id-twinkles">' + tw + '</g>' +
        '</g>'
}

interface Geom {
    W: number
    H: number
    cx: number
    cy: number
    ms: number
    wx: number
    ww: number
    wrapped: boolean
    wy: number
    wh: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
    fill?: FillMode
}

interface Burst {
    t0: number
    c: [Tone, Tone, Tone]
    fx: number
    fy: number
    rs: number
}

interface BurstNode {
    g: SVGGElement
    R: number
    bx: number
    by: number
    ty0: number
    b: Burst
}

function sid(uid: string): string {
    return 'rt-id-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
}

function el(tag: 'div' | 'span', cls: string, parent?: Element): HTMLElement {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function svgFrom(markup: string, cls: string, viewBox: string): SVGSVGElement {
    const holder = document.createElement('span')
    holder.innerHTML = '<svg xmlns="' + SVGNS + '" viewBox="' + viewBox + '" class="' + cls + '" aria-hidden="true" focusable="false">' + markup + '</svg>'
    const n = holder.firstElementChild
    if (!(n instanceof SVGSVGElement)) throw new Error('independenceDay: svg markup did not parse')
    return n
}

function f1(n: number): string {
    return (Math.round(n * 10) / 10).toString()
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

// Colours: [ring A, ring B, sparks] per burst (sapphire #38d9ff, crimson-coral #ff6b81, white #ebecff).
const BURSTS: Burst[] = [
    { t0: 300, c: ['sap', 'wht', 'sap'], fx: 0.72, fy: 0.46, rs: 1.0 },
    { t0: 1000, c: ['crim', 'wht', 'crim'], fx: 0.3, fy: 0.4, rs: 0.9 },
    { t0: 1900, c: ['wht', 'crim', 'sap'], fx: 0.55, fy: 0.34, rs: 1.2 },
]
function rays(n: number, r0: number, r1: number, rot: number): string {
    let d = ''
    for (let i = 0; i < n; i++) {
        const a = (rot + i * 360 / n) * Math.PI / 180
        d += 'M' + f1(Math.cos(a) * r0) + ' ' + f1(Math.sin(a) * r0) + 'L' + f1(Math.cos(a) * r1) + ' ' + f1(Math.sin(a) * r1)
    }
    return d
}
function starsAt(n: number, r: number, rot: number, s: number): string {
    let d = ''
    for (let i = 0; i < n; i++) {
        const a = (rot + i * 360 / n) * Math.PI / 180
        const cx = Math.cos(a) * r
        const cy = Math.sin(a) * r
        d += 'M' + f1(cx) + ' ' + f1(cy - s) + 'L' + f1(cx + s * 0.28) + ' ' + f1(cy - s * 0.28) + 'L' + f1(cx + s) + ' ' + f1(cy) + 'L' + f1(cx + s * 0.28) + ' ' + f1(cy + s * 0.28) +
            'L' + f1(cx) + ' ' + f1(cy + s) + 'L' + f1(cx - s * 0.28) + ' ' + f1(cy + s * 0.28) + 'L' + f1(cx - s) + ' ' + f1(cy) + 'L' + f1(cx - s * 0.28) + ' ' + f1(cy - s * 0.28) + 'Z'
    }
    return d
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: wash + fireworks svg -----
    const sky = el('div', 'rt-id-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-id-wash', sky)
    wash.id = id + '-wash'
    const fw = svgFrom('', 'rt-id-fw', '0 0 100 100')
    sky.appendChild(fw)
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-id-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: a sparkler star on the first "i" dot -----
    const word = ctx.word
    word.classList.add('rt-id-word')
    const risu = findLeafSpan(word, 'Risu')
    const spark = el('span', 'rt-id-spark', word)
    spark.id = id + '-spark'
    spark.setAttribute('aria-hidden', 'true')
    const sparkGlow = el('span', 'rt-id-sparkglow', spark)
    const sparkStar = el('span', 'rt-id-sparkstar', spark)
    sparkStar.appendChild(svgFrom('<path class="rt-id-sp-a" d="' + SPARK_STAR + '" transform="scale(1)"/><path class="rt-id-sp-b" d="' + SPARK_STAR + '" transform="rotate(45) scale(.62)"/>', 'rt-id-sparksvg', '-1.1 -1.1 2.2 2.2'))

    ctx.setDescription('Happy 4th of July!', 'en')

    function placeSpark(): void {
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 0.906
        if (risu && risu.firstChild) {
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
        spark.style.setProperty('--rt-id-ix', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeSpark()
    }
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts)

    function cancelAll(): void {
        const list = anims
        anims = []
        for (const a of list) {
            try {
                a.cancel()
            } catch {
                // already gone
            }
        }
    }
    function setFinal(on: boolean): void {
        sky.classList.toggle('rt-id-final', on)
        mark?.classList.toggle('rt-id-final', on)
        word.classList.toggle('rt-id-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeSpark()
        setFinal(true)
        state = 'final'
        settle()
    }
    // More than two keyframes: easing goes on each keyframe (a keyframe's own easing wins), the effect stays linear, so every
    // offset is a real time.
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        const ease = o.ease || 'linear'
        const perSegment = frames.length > 2 && ease !== 'linear'
        const list = perSegment
            ? frames.map((fr, i) => (i === frames.length - 1 || fr.easing ? fr : { ...fr, easing: ease }))
            : frames
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: perSegment ? 'linear' : ease, fill: o.fill || 'both' }
        let a: Animation
        try {
            a = node.animate(list, opts)
        } catch {
            return null
        }
        anims.push(a)
        return a
    }

    function geom(): Geom {
        const box = ctx.stageBox()
        const sr = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : sr.width
        const H = box.height ? box.height : sr.height
        const off = ctx.stageOffset()
        const ms = ctx.markSlot ? (off.markSize ? off.markSize : ctx.markSlot.getBoundingClientRect().width) : 28
        const cx = ctx.markSlot ? off.markX + ms / 2 : off.wordX - 20
        const cy = ctx.markSlot ? off.markY + ms / 2 : off.wordY + off.wordHeight / 2
        return { W, H, cx, cy, ms, wx: off.wordX, wy: off.wordY, ww: off.wordWidth, wh: off.wordHeight, wrapped: box.wrapped }
    }

    // ----- Fireworks -----
    let burstNodes: BurstNode[] = []
    function fireworks(g: Geom): void {
        fw.textContent = ''
        burstNodes = []
        fw.setAttribute('viewBox', '0 0 ' + f1(g.W) + ' ' + f1(g.H))
        fw.style.width = f1(g.W) + 'px'
        fw.style.height = f1(g.H) + 'px'
        const rx0 = g.wx + g.ww + 12
        const rx1 = g.W - 6
        const roomy = rx1 - rx0 >= 90
        const small = g.H < 70
        BURSTS.forEach((b, i) => {
            let R = Math.min(34, g.H * 0.4) * b.rs * (roomy ? 1 : 0.85)
            if (!roomy) R = Math.min(R, 21)
            let bx = roomy ? rx0 + (rx1 - rx0) * b.fx : g.wx + 10 + (g.W - g.wx - 20) * [0.78, 0.28, 0.54][i]
            const by = Math.max(R + 2, g.H * (small ? b.fy * 0.8 : b.fy))
            bx = Math.max(R + 3, Math.min(g.W - R - 3, bx))
            const tx = bx + [10, -8, 4][i]
            const ty0 = g.H + 2
            const grp = document.createElementNS(SVGNS, 'g')
            grp.setAttribute('id', id + '-fw' + (i + 1))
            grp.innerHTML =
                '<path class="rt-id-trail rt-id-c-' + b.c[0] + '" d="M' + f1(tx) + ' ' + f1(ty0) + 'Q' + f1((tx + bx) / 2 + (i % 2 ? -5 : 5)) + ' ' + f1((ty0 + by) / 2) + ' ' + f1(bx) + ' ' + f1(by) + '"/>' +
                '<g transform="translate(' + f1(bx) + ' ' + f1(by) + ')"><g class="rt-id-burst">' +
                    '<path class="rt-id-ra rt-id-c-' + b.c[0] + '" d="' + rays(10, R * 0.12, R * 0.58, i * 9) + '"/>' +
                    '<path class="rt-id-rb rt-id-c-' + b.c[1] + '" d="' + rays(14, R * 0.62, R, i * 9 + 13) + '"/>' +
                    '<g class="rt-id-sp"><path class="rt-id-fill rt-id-f-' + b.c[2] + '" d="' + starsAt(10, R * 1.05, i * 9 + 4, Math.max(1.6, R * 0.1)) + '"/></g>' +
                    '<circle class="rt-id-flash rt-id-f-' + b.c[0] + '" r="' + f1(Math.max(2.5, R * 0.1)) + '"/>' +
                '</g></g>'
            fw.appendChild(grp)
            burstNodes.push({ g: grp, R, bx, by, ty0, b })
        })
    }

    function timeline(): void {
        add(sky, [{ opacity: 1 }, { opacity: 1 }], { d: CLOCK })    // scene clock, always anims[0]
        const g = geom()
        sky.classList.toggle('rt-id-wrapped', g.wrapped)
        sky.style.setProperty('--rt-id-mx', f1(g.cx) + 'px')
        sky.style.setProperty('--rt-id-my', f1(g.cy) + 'px')
        sky.style.setProperty('--rt-id-h0', f1(g.ms * 0.62) + 'px')
        sky.style.setProperty('--rt-id-h1', f1(g.ms * 1.5) + 'px')
        fireworks(g)

        // 1. The twilight wash: in 0-700, holds, out 4000-5000 (stage 0-5.0 s).
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { d: 5000, ease: 'linear' })

        // 2. Three fireworks: launch trail, bloom of two ray rings, star sparks, a flash, a slow droop and fade.
        burstNodes.forEach((n) => {
            const t0 = n.b.t0
            const R = n.R
            const q = (s: string): Element | null => n.g.querySelector(s)
            const trail = q('.rt-id-trail')
            const ra = q('.rt-id-ra')
            const rb = q('.rt-id-rb')
            const sp = q('.rt-id-sp')
            const flash = q('.rt-id-flash')
            const burst = q('.rt-id-burst')
            const tl = Math.abs(n.ty0 - n.by) * 1.15 + 6
            if (trail instanceof SVGElement) trail.style.strokeDasharray = f1(tl) + ' ' + f1(tl + 30)
            // Launch: the trail draws up (450 ms), its tail then follows (the dash slides off) while it fades.
            add(trail, [
                { strokeDashoffset: tl, opacity: 1, easing: EASE_OUT },
                { strokeDashoffset: 0, opacity: 1, offset: 0.6, easing: EASE_IN },
                { strokeDashoffset: -tl, opacity: 0 },
            ], { at: t0, d: 750, ease: 'linear' })
            const bloom = t0 + 600
            const la = R * 0.46
            const lb = R * 0.38
            if (ra instanceof SVGElement) ra.style.strokeDasharray = f1(la) + ' ' + f1(la + 20)
            if (rb instanceof SVGElement) rb.style.strokeDasharray = f1(lb) + ' ' + f1(lb + 20)
            // Rays shoot outward (dash grows), then their tails detach and fade.
            add(ra, [
                { strokeDashoffset: la, opacity: 0, easing: EASE_OUT },
                { strokeDashoffset: 0, opacity: 1, offset: 0.3, easing: EASE },
                { strokeDashoffset: -la * 0.9, opacity: 0 },
            ], { at: bloom, d: 1100, ease: 'linear' })
            add(rb, [
                { strokeDashoffset: lb, opacity: 0, easing: EASE_OUT },
                { strokeDashoffset: 0, opacity: 1, offset: 0.34, easing: EASE },
                { strokeDashoffset: -lb * 0.9, opacity: 0 },
            ], { at: bloom + 130, d: 1200, ease: 'linear' })
            add(sp, [
                { transform: 'scale(0.5)', opacity: 0, easing: EASE_OUT },
                { transform: 'scale(1)', opacity: 1, offset: 0.3, easing: 'linear' },
                { transform: 'scale(1.06)', opacity: 1, offset: 0.55, easing: 'linear' },
                { transform: 'scale(1.08)', opacity: 0.2, offset: 0.7, easing: 'linear' },
                { transform: 'scale(1.1)', opacity: 0.9, offset: 0.8, easing: 'linear' },
                { transform: 'scale(1.12)', opacity: 0 },
            ], { at: bloom + 160, d: 1250, ease: 'linear' })
            add(flash, [
                { transform: 'scale(0)', opacity: 0, easing: EASE_OUT },
                { transform: 'scale(2.4)', opacity: 1, offset: 0.2, easing: EASE_IN },
                { transform: 'scale(0.4)', opacity: 0 },
            ], { at: bloom - 40, d: 420, ease: 'linear' })
            add(burst, [{ transform: 'translate(0px, 0px)' }, { transform: 'translate(0px, ' + f1(R * 0.18) + 'px)' }], { at: bloom, d: 1500, ease: 'linear' })
        })

        // 3. Mark. 1800-2000 rumble, 2000-2700 flip + hop (rocket nosecone) with a small flame, 2750-3300 the ring turns into a
        // glass badge while the nested pieces fold away, 3000-4300 the star unfolds point by point, 4600-7000 the tri-colour
        // shimmer.
        if (mark) {
            const m = mark
            const q = (s: string): Element | null => m.querySelector(s)
            add(q('.rt-id-lift'), [
                { transform: 'translate(0px, 0px)', easing: 'linear' },
                { transform: 'translate(-1.6px, 0px)', offset: 0.08, easing: 'linear' },
                { transform: 'translate(1.6px, 0px)', offset: 0.16, easing: 'linear' },
                { transform: 'translate(-1.6px, 0px)', offset: 0.24, easing: 'linear' },
                { transform: 'translate(0px, 0px)', offset: 0.3, easing: EASE_OUT },
                { transform: 'translate(0px, -34px)', offset: 0.64, easing: EASE_IN },
                { transform: 'translate(0px, 3px)', offset: 0.84, easing: EASE },
                { transform: 'translate(0px, 0px)' },
            ], { at: 1800, d: 1100, ease: 'linear' })
            add(q('.rt-id-flip'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { at: 2000, d: 560, ease: 'cubic-bezier(0.45, 0, 0.35, 1)' })
            add(q('.rt-id-flame'), [
                { transform: 'scale(0.2, 0)', opacity: 0, easing: EASE_OUT },
                { transform: 'scale(1, 1.1)', opacity: 1, offset: 0.3, easing: EASE },
                { transform: 'scale(0.8, 0.7)', opacity: 0.8, offset: 0.7, easing: EASE_IN },
                { transform: 'scale(0.3, 0)', opacity: 0 },
            ], { at: 2200, d: 800 })
            add(q('.rt-id-mid'), [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.3)', opacity: 0 }], { at: 2750, d: 450, ease: EASE_IN })
            add(q('.rt-id-core'), [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.3)', opacity: 0 }], { at: 2750, d: 450, ease: EASE_IN })
            add(q('.rt-id-ring'), [{ opacity: 1 }, { opacity: 0 }], { at: 2850, d: 450, ease: 'linear' })
            add(q('.rt-id-glass'), [{ opacity: 0 }, { opacity: 1 }], { at: 2850, d: 450, ease: 'linear' })
            for (let k = 0; k < 5; k++) {
                add(q('.rt-id-pt-' + k), [
                    { transform: 'scale(0.05) rotate(' + (k % 2 ? 70 : -70) + 'deg)', opacity: 0, easing: EASE_OUT },
                    { transform: 'scale(1.14) rotate(' + (k % 2 ? -6 : 6) + 'deg)', opacity: 1, offset: 0.62, easing: EASE },
                    { transform: 'scale(1) rotate(0deg)', opacity: 1 },
                ], { at: 3000 + k * 130, d: 760 })
                // Shimmer: each point lights up in turn.
                add(q('#' + id + '-hi' + k), [
                    { opacity: 0, easing: EASE },
                    { opacity: 0.85, offset: 0.42, easing: EASE },
                    { opacity: 0 },
                ], { at: 4600 + k * 280, d: 900 })
            }
            for (let w = 0; w < 3; w++) {
                add(q('#' + id + '-tw' + w), [
                    { transform: 'scale(0) rotate(0deg)', opacity: 0, easing: EASE_OUT },
                    { transform: 'scale(1) rotate(45deg)', opacity: 1, offset: 0.4, easing: EASE_IN },
                    { transform: 'scale(0) rotate(90deg)', opacity: 0 },
                ], { at: 5300 + w * 520, d: 700 })
            }
        }

        // 4. Sparkler on the "i" dot: pops 2300-2900, fizzes (two twinkles), settles to a small steady star.
        add(sparkStar, [
            { transform: 'scale(0) rotate(-60deg)', opacity: 0, easing: EASE_OUT },
            { transform: 'scale(1.5) rotate(10deg)', opacity: 1, offset: 0.55, easing: EASE },
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
        ], { at: 2300, d: 650 })
        const fizzle: Keyframe[] = [
            { transform: 'scale(1) rotate(0deg)', easing: EASE },
            { transform: 'scale(1.45) rotate(25deg)', offset: 0.5, easing: EASE },
            { transform: 'scale(1) rotate(0deg)' },
        ]
        add(sparkStar, fizzle, { at: 4000, d: 600, fill: 'forwards' })
        add(sparkStar, fizzle, { at: 6000, d: 600, fill: 'forwards' })
        add(sparkGlow, [
            { opacity: 0, transform: 'scale(0.4)', easing: EASE_OUT },
            { opacity: 0.9, transform: 'scale(1.3)', offset: 0.5, easing: EASE },
            { opacity: 0.55, transform: 'scale(1)' },
        ], { at: 2300, d: 700 })
    }

    // Watches every animation: the clock ends last, so all others are done, and a rebuild swaps it for a new one.
    function arm(): void {
        const mine = anims.slice()
        Promise.all(mine.map((a) => a.finished)).then(() => {
            if (state === 'playing' && anims.length && anims[0] === mine[0]) applyFinal()
        }, () => {
            // cancelled by finish, destroy or a relayout rebuild
        })
    }

    function play(): Promise<void> {
        if (state === 'destroyed') return Promise.resolve()
        if (state === 'final' || ctx.reduced) {
            applyFinal()
            return Promise.resolve()
        }
        if (playPromise && state === 'playing') return playPromise
        cancelAll()
        setFinal(false)
        placeSpark()
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        arm()
        return playPromise
    }

    // ctx.onRelayout: while playing, rebuild the timeline from the new geometry and jump to the current scene time (read from
    // the clock, anims[0]), keeping a paused state. Coalesced to one rebuild per frame.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state !== 'playing' || relayoutQueued) return
        relayoutQueued = true
        relayoutRaf = requestAnimationFrame(() => {
            relayoutQueued = false
            relayoutRaf = 0
            if (state !== 'playing' || !anims.length) return
            const t = Number(anims[0].currentTime) || 0
            const paused = anims[0].playState === 'paused'
            cancelAll()
            timeline()
            for (const a of anims) {
                try {
                    a.currentTime = t
                    if (paused) a.pause()
                } catch {
                    // already finished or cancelled
                }
            }
            arm()
        })
    }
    ctx.onRelayout(relayout)

    function finish(): void {
        if (state !== 'destroyed') applyFinal()
    }
    function destroy(): void {
        if (state === 'destroyed') return
        cancelAll()
        state = 'destroyed'
        if (relayoutRaf) {
            cancelAnimationFrame(relayoutRaf)
            relayoutRaf = 0
        }
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts)
        sky.remove()
        mark?.remove()
        spark.remove()
        word.classList.remove('rt-id-word', 'rt-id-final')
        ctx.setDescription('')
        settle()
    }

    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'independenceDay',
    durationMs: DURATION,
    build,
}
export default scene
