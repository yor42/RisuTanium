// Seasonal scene: sakura (Mar 25 - Apr 7, ko and ja).
//
// Motion is Web Animations only: transform and opacity. No filters, no loops (petal flutters have finite counts). The final
// pose is static CSS under .rt-skr-final, so finish() gives the same pose from any point.
import './sakura.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 6800 ms.
const DURATION = 7000
const SVGNS = 'http://www.w3.org/2000/svg'
const PETALS = 14

// Brand mark geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
type Pt = [number, number]
const OUTER_V: Pt[] = [[-55.85, -32.25], [55.85, -32.25], [0, 64.49]]

// Sakura petal, viewBox 0 0 20 24: notched tip at the top, base at the bottom.
const PETAL = 'M10 23.5C5.2 20.6 1.6 15.4 1.6 9.6C1.6 4.6 4.2 1.2 7.2 1.2L10 4.6L12.8 1.2C15.8 1.2 18.4 4.6 18.4 9.6C18.4 15.4 14.8 20.6 10 23.5Z'
const PETAL_BLUSH = 'M10 23.5C7.6 22 6 19.6 6.4 17.2C7.6 18.3 8.8 18.8 10 18.8C11.2 18.8 12.4 18.3 13.6 17.2C14 19.6 12.4 22 10 23.5Z'

// The outer triangle with each vertex rounded into a petal tip and notched: a corner arc of radius R whose apex is cut by a V
// of depth `depth`, leaving two rounded lobes (the lobe arcs end `phi` degrees either side of the apex). The 60-degree corner
// arc spans 120 degrees, so its tangent points are at +-60 degrees.
function notchedOuter(R: number, depth: number, phi: number): string {
    let out = ''
    const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
    const unit = (v: Pt): Pt => {
        const l = Math.sqrt(v[0] * v[0] + v[1] * v[1])
        return [v[0] / l, v[1] / l]
    }
    const at = (p: Pt, v: Pt, s: number): Pt => [p[0] + v[0] * s, p[1] + v[1] * s]
    const rot = (v: Pt, deg: number): Pt => {
        const a = deg * Math.PI / 180
        const c = Math.cos(a)
        const s = Math.sin(a)
        return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
    }
    const f = (p: Pt): string => p[0].toFixed(2) + ' ' + p[1].toFixed(2)
    for (let i = 0; i < 3; i++) {
        const V = OUTER_V[i]
        // Inward bisector (the centroid is the origin).
        const u = unit(sub([0, 0], V))
        // Arc centre.
        const O = at(V, u, R / Math.sin(Math.PI / 6))
        // From the arc centre towards the vertex.
        const outward: Pt = [-u[0], -u[1]]
        const A1 = at(O, rot(outward, -60), R)
        const N1 = at(O, rot(outward, -phi), R)
        const N2 = at(O, rot(outward, phi), R)
        const A2 = at(O, rot(outward, 60), R)
        const T = at(O, outward, R - depth)
        out += (i ? 'L' : 'M') + f(A1) + 'A' + R + ' ' + R + ' 0 0 1 ' + f(N1) + 'L' + f(T) + 'L' + f(N2) +
            'A' + R + ' ' + R + ' 0 0 1 ' + f(A2)
    }
    return out + 'Z'
}
// One shallow notch per tip, no shoulder steps.
const NOTCHED = notchedOuter(10, 5.5, 13) + HOLE
// Three stamens: short filaments from the mid triangle's vertices with anthers at the ends.
const STAMEN_LINES = 'M-11.6-6.7L-19.5-11.3M11.6-6.7L19.5-11.3M0 13.4L0 22.4'
const STAMEN_DOTS: Pt[] = [[-21.2, -12.3], [21.2, -12.3], [0, 24.4]]

interface AddOptions {
    d: number
    at?: number
    ease?: string
    iter?: number
    dir?: PlaybackDirection
}

interface Geom {
    W: number
    H: number
    wrapped: boolean
    cx: number
    cy: number
}

function sid(uid: string): string {
    return 'rt-skr-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('sakura: svg markup did not parse')
    return n
}

function petalMarkup(): string {
    return '<path class="rt-skr-pbody" d="' + PETAL + '"/><path class="rt-skr-pblush" d="' + PETAL_BLUSH + '"/>'
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

function markMarkup(id: string): string {
    const dots = STAMEN_DOTS.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.6"/>').join('')
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-rose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3c6"/><stop offset="1" stop-color="#ffd6e0"/></linearGradient>' +
        '<linearGradient id="' + id + '-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f5a524"/></linearGradient>' +
        '</defs>' +
        '<g class="rt-skr-sway" id="' + id + '-sway">' +
            '<g class="rt-skr-every" id="' + id + '-every">' +
                '<path class="rt-skr-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
                '<path class="rt-skr-ink" d="' + MID + '"/>' +
                '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
            '</g>' +
            '<g class="rt-skr-blush" id="' + id + '-blush">' +
                '<path class="rt-skr-petalframe" fill="url(#' + id + '-rose)" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '</g>' +
            '<g class="rt-skr-bloom" id="' + id + '-bloom">' +
                '<path class="rt-skr-petalframe" fill="url(#' + id + '-rose)" fill-rule="evenodd" d="' + NOTCHED + '"/>' +
                '<path class="rt-skr-crease" d="M0-31V-18.6M-26.9 15.5L-16.1 9.3M26.9 15.5L16.1 9.3"/>' +
                '<path class="rt-skr-mid" d="' + MID + '"/>' +
            '</g>' +
            '<g class="rt-skr-heart" id="' + id + '-heart">' +
                '<path class="rt-skr-stamen" d="' + STAMEN_LINES + '"/>' +
                '<g class="rt-skr-anther">' + dots + '</g>' +
                '<path fill="url(#' + id + '-gold)" class="rt-skr-core" d="' + CORE + '"/>' +
            '</g>' +
        '</g>'
}

function textNodeOf(root: Element, cls: string): Text | null {
    const s = root.querySelector('.' + cls)
    const t = s ? s.firstChild : null
    return t instanceof Text ? t : null
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: twilight-pink wash and drifting petals -----
    const sky = el('div', 'rt-skr-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-skr-wash', sky)
    wash.id = id + '-wash'
    const petals: Array<{ wrap: HTMLElement, flutter: HTMLElement }> = []
    for (let p = 0; p < PETALS; p++) {
        const wrap = el('div', 'rt-skr-petal', sky)
        wrap.id = id + '-petal' + (p + 1)
        const flutter = el('div', 'rt-skr-flutter', wrap)
        flutter.appendChild(svgFrom(petalMarkup(), 'rt-skr-psvg', '0 0 20 24'))
        petals.push({ wrap, flutter })
    }
    ctx.stage.appendChild(sky)

    // ----- Mark slot: everyday triangle that blushes into the sakura-notched triangle -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-skr-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: one petal comes to rest on the dot of the "i" -----
    const word = ctx.word
    word.classList.add('rt-skr-word')
    const rest = el('span', 'rt-skr-rest', word)
    rest.id = id + '-rest'
    rest.setAttribute('aria-hidden', 'true')
    const restFly = el('span', 'rt-skr-rest-fly', rest)
    restFly.appendChild(svgFrom(petalMarkup(), 'rt-skr-psvg', '0 0 20 24'))

    // Optional greeting for screen readers (decorative scene; the accessible name stays "RisuTanium").
    if (ctx.lang === 'ko') ctx.setDescription('벚꽃이 피는 계절이에요.', 'ko')
    else if (ctx.lang === 'ja') ctx.setDescription('桜の季節です。', 'ja')

    // Centre of the "i" in em from the word box's left edge; 0.66em is the NanumSquare Neo estimate when it cannot be measured.
    function placeRest(): void {
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 0.66
        const tn = textNodeOf(word, 'rt-sw-a')
        if (tn && tn.length >= 2 && document.createRange) {
            try {
                const r = document.createRange()
                r.setStart(tn, 1)
                r.setEnd(tn, 2)
                const ir = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (ir.width > 0) x = (ir.left + ir.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        rest.style.setProperty('--rt-skr-ix', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeRest()
    }
    document.fonts?.addEventListener('loadingdone', onFonts)

    // The host pauses subtree animations while hidden; this only resumes what it paused itself.
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
        sky.classList.toggle('rt-skr-final', on)
        mark?.classList.toggle('rt-skr-final', on)
        word.classList.toggle('rt-skr-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeRest()
        setFinal(true)
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: o.ease || 'linear', fill: 'both' }
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
        const wr = rel(word)
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
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const g = geom()
        sky.classList.toggle('rt-skr-wrapped', g.wrapped)
        wash.style.setProperty('--rt-skr-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-skr-my', g.cy.toFixed(1) + 'px')

        // Scene clock (property-less), always anims[0].
        add(sky, [], { d: 6800 })

        // 1. Twilight-pink wash: 0-700 in, holds, 4200-5600 out.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.125 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { d: 5600 })

        // 1b. Fourteen petals on a curved breeze, left to right. Drift width and height follow the live stage.
        const rnd = rng(0x5ac0)
        const W = g.W
        const H = Math.max(40, g.H)
        const sz = g.wrapped ? 0.72 : 1
        // Keeps the drift within the topbar on desktop.
        const band = Math.min(H, g.wrapped ? H : 72)
        petals.forEach((pt, i) => {
            const size = (9 + rnd() * 4) * sz
            pt.wrap.style.width = size.toFixed(1) + 'px'
            pt.wrap.style.height = (size * 1.2).toFixed(1) + 'px'
            const y0 = band * (0.04 + rnd() * 0.5)
            const drop = band * (0.18 + rnd() * 0.3)
            const amp = band * (0.08 + rnd() * 0.12) * (i % 2 ? 1 : -1)
            const x0 = -size - 4 - rnd() * 24
            const x3 = W + 6 + rnd() * 10
            const y3 = Math.min(band - size, y0 + drop)
            const spin = (140 + rnd() * 200) * (i % 3 === 0 ? -1 : 1)
            const r0 = rnd() * 360
            // 60-1700 ms.
            const start = 60 + i * 118 + rnd() * 80
            const dur = Math.min(4500 - start, 2300 + rnd() * 700)
            // A few melt away before the edge.
            const fadeEarly = i % 4 === 3
            pt.wrap.style.left = '0px'
            pt.wrap.style.top = '0px'
            const pos = (t: number): string => {
                const x = x0 + (x3 - x0) * t
                const y = y0 + (y3 - y0) * t + amp * Math.sin(t * Math.PI * 2)
                return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (r0 + spin * t).toFixed(1) + 'deg)'
            }
            const frames: Keyframe[] = []
            for (let k = 0; k <= 6; k++) {
                const t = k / 6
                const op = k === 0 ? 0 : (k === 6 ? 0 : (fadeEarly && k === 5 ? 0.4 : 0.95))
                frames.push({ transform: pos(fadeEarly ? t * 0.82 : t), opacity: op, offset: t })
            }
            add(pt.wrap, frames, { at: start, d: dur, ease: 'linear' })
            const beat = 260 + (i % 5) * 40
            let n = Math.floor(dur / beat)
            if (n % 2) n -= 1
            add(pt.flutter, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.3)' }], { at: start, d: beat, iter: Math.max(2, n), dir: 'alternate', ease: 'ease-in-out' })
        })

        // 2. Mark: blush 2000-3000, notch the tips 3000-4100 with a small sway, golden stamen core 3900-5200.
        if (mark) {
            const sway = mark.querySelector('.rt-skr-sway')
            const every = mark.querySelector('.rt-skr-every')
            const blush = mark.querySelector('.rt-skr-blush')
            const bloom = mark.querySelector('.rt-skr-bloom')
            const heart = mark.querySelector('.rt-skr-heart')
            add(every, [{ opacity: 1 }, { opacity: 0 }], { at: 2450, d: 500, ease: EASE })
            add(blush, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { at: 2000, d: 2000, ease: 'linear' })
            add(sway, [
                { transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(1.06) rotate(0deg)', offset: 0.22 },
                { transform: 'scale(1) rotate(0deg)', offset: 0.42 }, { transform: 'scale(1) rotate(-5deg)', offset: 0.62 },
                { transform: 'scale(1) rotate(3deg)', offset: 0.82 }, { transform: 'scale(1) rotate(0deg)' },
            ], { at: 2000, d: 2200, ease: EASE })
            add(bloom, [{ opacity: 0 }, { opacity: 1 }], { at: 3000, d: 1000, ease: EASE })
            add(heart, [
                { transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.55 },
                { transform: 'scale(0.96)', opacity: 1, offset: 0.8 }, { transform: 'scale(1)', opacity: 1 },
            ], { at: 3900, d: 1300, ease: EASE_OUT })
        }

        // 3. A petal glides down and rests on the "i" dot 4400-6400 (em, relative to its rest position).
        placeRest()
        add(restFly, [
            { transform: 'translate(-1.5em, -1.1em) rotate(-120deg)', opacity: 0 },
            { transform: 'translate(-1.0em, -0.9em) rotate(-70deg)', opacity: 1, offset: 0.15 },
            { transform: 'translate(-0.35em, -0.95em) rotate(-10deg)', opacity: 1, offset: 0.4 },
            { transform: 'translate(0.25em, -0.55em) rotate(-48deg)', opacity: 1, offset: 0.62 },
            { transform: 'translate(-0.08em, -0.18em) rotate(-14deg)', opacity: 1, offset: 0.82 },
            { transform: 'translate(0.02em, 0.03em) rotate(-30deg)', opacity: 1, offset: 0.93 },
            { transform: 'translate(0em, 0em) rotate(-26deg)', opacity: 1 },
        ], { at: 4400, d: 2000, ease: EASE })

        // The clock stays the longest effect: 6800 ms.
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

    // ctx.onRelayout: rebuild the timeline from the new geometry at the current scene time (drift width and height follow the
    // stage). Coalesced to one rebuild per frame. Outside play, only the petal is re-placed.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placeRest()
            return
        }
        if (relayoutQueued) return
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
        if (state === 'destroyed') return
        applyFinal()
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
        document.fonts?.removeEventListener('loadingdone', onFonts)
        sky.remove()
        mark?.remove()
        rest.remove()
        word.classList.remove('rt-skr-word', 'rt-skr-final')
        ctx.setDescription('')
        settle()
    }

    placeRest()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'sakura',
    durationMs: DURATION,
    build,
}
export default scene
