// Seasonal scene: childrenDay (May 5, ko and ja).
//
// Branches on ctx.lang:
//   ja          こどもの日: three koinobori carp swim across; the triangle flips to an origami kabuto with gold horns.
//   otherwise   어린이날 (ko, and the fallback for a forced occasion in another language): paper confetti ribbons arc past; the
//               everyday triangle shrinks into the hub of a 4-vane paper pinwheel that turns 360 degrees once.
//
// Motion is Web Animations only: transform and opacity, plus stroke-dashoffset on two wind lines. No filters, no loops
// (flutters and tail wags have finite counts). The final pose is static CSS under .rt-kid-final, so finish() gives the same
// pose from any point.
import './childrenDay.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 6600 ms.
const DURATION = 6800
const SVGNS = 'http://www.w3.org/2000/svg'

// Brand mark geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// The same triangles flipped (y -> -y) for the kabuto, pointing up.
const UP_LEFT = 'M0-64.49L-55.85 32.25H0Z'
const UP_RIGHT = 'M0-64.49L55.85 32.25H0Z'
const UP_HOLE = 'M0-34.68L-30.03 17.34H30.03Z'
const UP_MID = 'M0-13.43L-11.63 6.72H11.63Z'
const UP_CORE = 'M0-8.57L-7.42 4.28H7.42Z'

// Pinwheel vane pointing up (turning clockwise), split along its crease into a light and a dark facet.
const VANE_LIGHT = 'M0 0L-6-70L17-53Z'
const VANE_DARK = 'M0 0L17-53L40-36Z'
const VANE_COLOURS = ['red', 'yellow', 'blue', 'green']
const STICK = 'M-3.2 2H3.2L3.6 76Q0 78.5-3.6 76Z'

// Kabuto (upright): brim band, two gold horns (kuwagata) with highlight lines.
const BRIM = 'M-66 21H66L57 39H-57Z'
const HORN_L = 'M-27 22L-43 22Q-56-4-65-40Q-45-17-27 22Z'
const HORN_R = 'M27 22L43 22Q56-4 65-40Q45-17 27 22Z'
const HORN_HI = 'M-38 16Q-48-6-58-30M38 16Q48-6 58-30'

// Koinobori carp, viewBox 0 0 60 22, head on the right.
const CARP_BODY = 'M57 5.5C46 2.5 28 3 13 7L13 15C28 19 46 19.5 57 16.5Z'
const CARP_TAIL = 'M13.6 7L2 1.5L7 11L2 20.5L13.6 15Z'
const CARP_SCALES = 'M46 7.5Q49 11 46 14.5M39 7Q42 11 39 15M32 7.5Q35 11 32 14.5M25 8Q27.6 11 25 14'

// Confetti ribbon, viewBox 0 0 14 8.
const RIBBON = 'M1 4C3 1 5 1 7 4S11 7 13 4'
const RIBBON_COLOURS = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', '#b197fc']

interface AddOptions {
    d: number
    at?: number
    ease?: string
    iter?: number
    dir?: PlaybackDirection
    fill?: FillMode
}

interface Mover {
    wrap: HTMLElement
    /** The tail (carp) or the flutter layer (ribbon) that wags inside the wrapper. */
    inner: Element | null
}

interface Geom {
    W: number
    H: number
    wrapped: boolean
    cx: number
    cy: number
}

function sid(uid: string): string {
    return 'rt-kid-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('childrenDay: svg markup did not parse')
    return n
}

// Deterministic PRNG so every play looks the same.
function rng(seedIn: number): () => number {
    let seed = seedIn
    return () => {
        seed |= 0
        seed = seed + 0x6D2B79F5 | 0
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

function coreGrad(id: string): string {
    return '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>'
}
function everyMarkup(id: string): string {
    return '<g class="rt-kid-every" id="' + id + '-every">' +
        '<path class="rt-kid-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-kid-ink" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>'
}
function pinwheelMarkup(id: string): string {
    let vanes = ''
    for (let k = 0; k < 4; k++) {
        vanes += '<g class="rt-kid-vane rt-kid-vane-' + VANE_COLOURS[k] + '" id="' + id + '-vane' + (k + 1) + '" transform="rotate(' + (k * 90) + ')">' +
            '<g class="rt-kid-unfold"><path class="rt-kid-vl" d="' + VANE_LIGHT + '"/><path class="rt-kid-vd" d="' + VANE_DARK + '"/></g></g>'
    }
    return '<defs>' + coreGrad(id) + '</defs>' +
        '<path class="rt-kid-stick" id="' + id + '-stick" d="' + STICK + '"/>' +
        '<g class="rt-kid-spin" id="' + id + '-spin">' + vanes + '</g>' +
        '<g class="rt-kid-hub" id="' + id + '-hub">' + everyMarkup(id) + '</g>'
}
function kabutoMarkup(id: string): string {
    return '<defs>' + coreGrad(id) + '</defs>' +
        '<g class="rt-kid-flipout" id="' + id + '-flipout">' + everyMarkup(id) + '</g>' +
        '<g class="rt-kid-kabuto" id="' + id + '-kabuto">' +
            '<g class="rt-kid-crown" id="' + id + '-crown">' +
                '<path class="rt-kid-crown-l" d="' + UP_LEFT + '"/><path class="rt-kid-crown-r" d="' + UP_RIGHT + '"/>' +
                '<path class="rt-kid-crown-hole" d="' + UP_HOLE + '"/>' +
                '<path class="rt-kid-crease" d="M0-63V-36.5"/>' +
                '<path class="rt-kid-crown-mid" d="' + UP_MID + '"/>' +
                '<path fill="url(#' + id + '-core)" d="' + UP_CORE + '"/>' +
            '</g>' +
            '<g class="rt-kid-brim" id="' + id + '-brim"><path d="' + BRIM + '"/><path class="rt-kid-brim-edge" d="M-62 23H62"/></g>' +
            '<g class="rt-kid-horn rt-kid-horn-l" id="' + id + '-horn-l"><path class="rt-kid-gold" d="' + HORN_L + '"/></g>' +
            '<g class="rt-kid-horn rt-kid-horn-r" id="' + id + '-horn-r"><path class="rt-kid-gold" d="' + HORN_R + '"/></g>' +
            '<path class="rt-kid-glint" id="' + id + '-glint" d="' + HORN_HI + '"/>' +
        '</g>'
}
function carpMarkup(): string {
    return '<g class="rt-kid-tail"><path d="' + CARP_TAIL + '"/></g>' +
        '<path class="rt-kid-carp-body" d="' + CARP_BODY + '"/>' +
        '<path class="rt-kid-carp-scales" d="' + CARP_SCALES + '"/>' +
        '<ellipse class="rt-kid-carp-mouth" cx="57" cy="11" rx="1.8" ry="5.4"/>' +
        '<circle class="rt-kid-carp-eye" cx="50.5" cy="9.4" r="2.7"/><circle class="rt-kid-carp-pupil" cx="51" cy="9.4" r="1.3"/>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const ja = ctx.lang === 'ja'
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: sky-blue breeze wash, two wind lines, carp (ja) or confetti ribbons (ko) -----
    const sky = el('div', 'rt-kid-sky ' + (ja ? 'rt-kid-ja' : 'rt-kid-ko'))
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-kid-wash', sky)
    wash.id = id + '-wash'
    const wind = svgFrom('<path class="rt-kid-wind" pathLength="100"/><path class="rt-kid-wind" pathLength="100"/>', 'rt-kid-windsvg', '0 0 100 100')
    wind.id = id + '-wind'
    wind.setAttribute('preserveAspectRatio', 'none')
    sky.appendChild(wind)
    const windPaths = Array.from(wind.querySelectorAll('.rt-kid-wind'))
    const movers: Mover[] = []
    if (ja) {
        ['black', 'red', 'blue'].forEach((c, i) => {
            const w = el('div', 'rt-kid-carp rt-kid-carp-' + c, sky)
            w.id = id + '-carp' + (i + 1)
            w.appendChild(svgFrom(carpMarkup(), 'rt-kid-carpsvg', '0 0 60 22'))
            movers.push({ wrap: w, inner: w.querySelector('.rt-kid-tail') })
        })
    } else {
        for (let r = 0; r < 12; r++) {
            const rw = el('div', 'rt-kid-ribbon', sky)
            rw.id = id + '-ribbon' + (r + 1)
            const fl = el('div', 'rt-kid-flutter', rw)
            const rs = svgFrom('<path d="' + RIBBON + '"/>', 'rt-kid-ribbonsvg', '0 0 14 8')
            rs.style.color = RIBBON_COLOURS[r % RIBBON_COLOURS.length]
            fl.appendChild(rs)
            movers.push({ wrap: rw, inner: fl })
        }
    }
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(ja ? kabutoMarkup(id) : pinwheelMarkup(id), 'rt-kid-mark ' + (ja ? 'rt-kid-ja' : 'rt-kid-ko'), '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // The wordmark itself is unchanged (everyday final pose). Optional greeting for screen readers.
    if (ctx.lang === 'ko') ctx.setDescription('어린이날을 축하해요!', 'ko')
    else if (ja) ctx.setDescription('こどもの日おめでとう！', 'ja')

    // Pauses only what it paused itself, so a relayout rebuild never resumes an animation the host holds.
    let pausedByMe: Animation[] = []
    function onVis(): void {
        if (state !== 'playing') {
            pausedByMe = []
            return
        }
        if (document.hidden) {
            for (const a of anims) {
                if (a.playState === 'running') {
                    a.pause()
                    pausedByMe.push(a)
                }
            }
        } else {
            const list = pausedByMe
            pausedByMe = []
            for (const a of list) {
                try {
                    if (a.playState === 'paused') a.play()
                } catch {
                    // already finished or cancelled
                }
            }
        }
    }
    document.addEventListener('visibilitychange', onVis)

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
        sky.classList.toggle('rt-kid-final', on)
        mark?.classList.toggle('rt-kid-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        setFinal(true)
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: o.ease || 'linear', fill: o.fill || 'both' }
        if (o.iter) opts.iterations = o.iter
        if (o.dir) opts.direction = o.dir
        let a: Animation
        try {
            a = node.animate(frames, opts)
        } catch {
            return null
        }
        anims.push(a)
        return a
    }
    function rel(node: Element): { x: number, y: number, w: number, h: number } {
        const s = ctx.stage.getBoundingClientRect()
        const r = node.getBoundingClientRect()
        return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
    }
    function geom(): Geom {
        const box = ctx.stageBox()
        const s = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : s.width
        const H = box.height ? box.height : s.height
        const origin = ctx.markSlot ? rel(ctx.markSlot) : null
        const wr = rel(ctx.word)
        return {
            W,
            H,
            wrapped: box.wrapped,
            cx: origin ? origin.x + origin.w / 2 : wr.x - 14,
            cy: origin ? origin.y + origin.h / 2 : wr.y + wr.h / 2,
        }
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const g = geom()
        const W = g.W
        const H = Math.max(40, g.H)
        // Keeps the motion within the topbar row on desktop.
        const band = g.wrapped ? H : Math.min(H, 64)
        const sz = g.wrapped ? 0.72 : 1
        sky.classList.toggle('rt-kid-wrapped', g.wrapped)
        wash.style.setProperty('--rt-kid-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-kid-my', g.cy.toFixed(1) + 'px')

        // Scene clock (property-less), always anims[0].
        add(sky, [], { d: 6600 })

        // 1. Breeze wash 0-600 in, 4200-5400 out.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.11 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }], { d: 5400 })

        // 1b. Two wind lines: one dash travels along each curl (stroke-dashoffset), 300-1700 and 1000-2500.
        wind.setAttribute('viewBox', '0 0 ' + Math.round(W) + ' ' + Math.round(band))
        const y1 = band * 0.16
        const y2 = band * 0.3
        windPaths[0].setAttribute('d', 'M' + (-10) + ' ' + y1.toFixed(1) + 'C' + (W * 0.3).toFixed(1) + ' ' + (y1 - band * 0.18).toFixed(1) + ' ' + (W * 0.5).toFixed(1) + ' ' + (y1 + band * 0.2).toFixed(1) + ' ' + (W * 0.66).toFixed(1) + ' ' + (y1 + band * 0.02).toFixed(1) + 'S' + (W * 0.86).toFixed(1) + ' ' + (y1 - band * 0.1).toFixed(1) + ' ' + (W + 10) + ' ' + (y1 - band * 0.04).toFixed(1))
        windPaths[1].setAttribute('d', 'M' + (-10) + ' ' + y2.toFixed(1) + 'C' + (W * 0.28).toFixed(1) + ' ' + (y2 + band * 0.12).toFixed(1) + ' ' + (W * 0.55).toFixed(1) + ' ' + (y2 - band * 0.2).toFixed(1) + ' ' + (W + 10) + ' ' + (y2 - band * 0.06).toFixed(1))
        add(windPaths[0], [{ strokeDashoffset: 12, opacity: 0 }, { strokeDashoffset: 0, opacity: 1, offset: 0.2 }, { strokeDashoffset: -70, opacity: 1, offset: 0.85 }, { strokeDashoffset: -100, opacity: 0 }], { at: 300, d: 1400, ease: 'linear' })
        add(windPaths[1], [{ strokeDashoffset: 12, opacity: 0 }, { strokeDashoffset: 0, opacity: 1, offset: 0.2 }, { strokeDashoffset: -70, opacity: 1, offset: 0.85 }, { strokeDashoffset: -100, opacity: 0 }], { at: 1000, d: 1500, ease: 'linear' })

        if (ja) {
            // 1c. Three koinobori swim left to right, 250-4400 ms, in a gentle wave with wagging tails.
            const sizes = [[48, 17.6], [38, 13.9], [30, 11]]
            const starts = [250, 620, 980]
            const durs = [3600, 3400, 3300]
            movers.forEach((m, i) => {
                const w = sizes[i][0] * sz
                const h = sizes[i][1] * sz
                m.wrap.style.width = w.toFixed(1) + 'px'
                m.wrap.style.height = h.toFixed(1) + 'px'
                m.wrap.style.left = '0px'
                m.wrap.style.top = '0px'
                const yBase = band * (0.17 + i * 0.16) - h / 2 + (g.wrapped ? 2 : 0)
                const amp = band * 0.07 * (i % 2 ? -1 : 1)
                const x0 = -w - 8
                const x1 = W + 8
                const frames: Keyframe[] = []
                for (let k = 0; k <= 8; k++) {
                    const t = k / 8
                    const x = x0 + (x1 - x0) * t
                    const y = yBase + amp * Math.sin(t * Math.PI * 2.4)
                    const slope = amp * Math.cos(t * Math.PI * 2.4) * Math.PI * 2.4 / (x1 - x0)
                    const rot = Math.atan(slope) * 180 / Math.PI
                    frames.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)', opacity: k === 0 ? 0 : (k === 8 ? 0 : 1), offset: t })
                }
                add(m.wrap, frames, { at: starts[i], d: durs[i], ease: 'linear' })
                const beat = 240 + i * 30
                let n = Math.floor(durs[i] / beat)
                if (n % 2) n -= 1
                add(m.inner, [{ transform: 'rotate(-14deg)' }, { transform: 'rotate(14deg)' }], { at: starts[i], d: beat, iter: n, dir: 'alternate', ease: 'ease-in-out' })
            })
        } else {
            // 1c. Twelve paper ribbons arc past, left to right, 150-4500 ms.
            const rnd = rng(505)
            movers.forEach((m, i) => {
                const w = (13 + rnd() * 4) * sz
                m.wrap.style.width = w.toFixed(1) + 'px'
                m.wrap.style.height = (w * 8 / 14).toFixed(1) + 'px'
                m.wrap.style.left = '0px'
                m.wrap.style.top = '0px'
                const x0 = -w - rnd() * 30
                const x1 = W * (0.62 + rnd() * 0.45)
                const yStart = band * (0.75 + rnd() * 0.25)
                const yTop = band * (0.02 + rnd() * 0.25)
                const yEnd = band * (0.7 + rnd() * 0.3)
                const spin = (220 + rnd() * 320) * (i % 2 ? 1 : -1)
                const r0 = rnd() * 180
                const start = 150 + i * 120 + rnd() * 90
                const dur = Math.min(4500 - start, 2200 + rnd() * 700)
                const frames: Keyframe[] = []
                for (let k = 0; k <= 8; k++) {
                    const t = k / 8
                    const x = x0 + (x1 - x0) * t
                    // Quadratic Bezier in y through the apex: start -> top -> end.
                    const y = (1 - t) * (1 - t) * yStart + 2 * (1 - t) * t * (2 * yTop - (yStart + yEnd) / 2) + t * t * yEnd
                    frames.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (r0 + spin * t).toFixed(1) + 'deg)', opacity: k === 0 ? 0 : (k >= 7 ? (k === 8 ? 0 : 0.8) : 1), offset: t })
                }
                add(m.wrap, frames, { at: start, d: dur, ease: 'linear' })
                const beat = 200 + (i % 4) * 45
                let n = Math.floor(dur / beat)
                if (n % 2) n -= 1
                add(m.inner, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(-0.6)' }], { at: start, d: beat, iter: Math.max(2, n), dir: 'alternate', ease: 'ease-in-out' })
            })
        }

        if (!mark) return
        if (ja) {
            // 2. Flip down-triangle to up-triangle 1800-2600 (scaleY through zero), brim unfolds 2600-3300, horns fold up
            //    3300-4400, gold glint 4400-5200.
            add(mark.querySelector('.rt-kid-flipout'), [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 1 }], { at: 1800, d: 400, ease: EASE_IN })
            add(mark.querySelector('.rt-kid-crown'), [{ transform: 'scaleY(0)', opacity: 1 }, { transform: 'scaleY(1.06)', opacity: 1, offset: 0.75 }, { transform: 'scaleY(1)', opacity: 1 }], { at: 2200, d: 500, ease: EASE_OUT })
            add(mark.querySelector('.rt-kid-brim'), [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1.15)', opacity: 1, offset: 0.7 }, { transform: 'scaleY(1)', opacity: 1 }], { at: 2650, d: 650, ease: EASE_OUT })
            add(mark.querySelector('.rt-kid-horn-l'), [{ transform: 'rotate(-110deg) scale(0.4)', opacity: 0 }, { transform: 'rotate(8deg) scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'rotate(0deg) scale(1)', opacity: 1 }], { at: 3300, d: 800, ease: EASE_OUT })
            add(mark.querySelector('.rt-kid-horn-r'), [{ transform: 'rotate(110deg) scale(0.4)', opacity: 0 }, { transform: 'rotate(-8deg) scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'rotate(0deg) scale(1)', opacity: 1 }], { at: 3550, d: 800, ease: EASE_OUT })
            add(mark.querySelector('.rt-kid-glint'), [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0.55 }], { at: 4450, d: 750, ease: EASE })
        } else {
            // 2. The everyday mark shrinks into the hub 1800-2500 while the vanes unfold from behind it 1850-2780 (no
            //    bare-stick beat); the stick slides in 1900-2400; the vanes turn 360 degrees once 3400-5200.
            add(mark.querySelector('.rt-kid-hub'), [{ transform: 'scale(1)' }, { transform: 'scale(0.5)', offset: 0.8 }, { transform: 'scale(0.54)' }], { at: 1800, d: 700, ease: EASE })
            add(mark.querySelector('.rt-kid-stick'), [{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'translateY(0px)', opacity: 1 }], { at: 1900, d: 500, ease: EASE_OUT })
            mark.querySelectorAll('.rt-kid-unfold').forEach((v, k) => {
                add(v, [{ transform: 'rotate(-80deg) scale(0)', opacity: 0 }, { transform: 'rotate(6deg) scale(1.05)', opacity: 1, offset: 0.7 }, { transform: 'rotate(0deg) scale(1)', opacity: 1 }], { at: 1850 + k * 110, d: 600, ease: EASE_OUT })
            })
            add(mark.querySelector('.rt-kid-spin'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { at: 3400, d: 1800, ease: 'cubic-bezier(0.45, 0, 0.25, 1)' })
        }
    }

    // Watches the first (clock) animation: it ends last, so all others are done, and a rebuild swaps it for a new one.
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
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        if (document.hidden) onVis()
        arm()
        return playPromise
    }

    // ctx.onRelayout: rebuild the timeline from the new geometry at the current scene time. Coalesced to one rebuild per frame.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state !== 'playing' || relayoutQueued) return
        relayoutQueued = true
        relayoutRaf = requestAnimationFrame(() => {
            relayoutQueued = false
            relayoutRaf = 0
            if (state !== 'playing' || !anims.length) return
            const t = anims[0].currentTime || 0
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
        document.removeEventListener('visibilitychange', onVis)
        sky.remove()
        mark?.remove()
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'childrenDay',
    durationMs: DURATION,
    build,
}
export default scene
