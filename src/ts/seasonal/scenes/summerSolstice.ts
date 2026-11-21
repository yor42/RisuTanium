// Seasonal scene: summerSolstice (Jun 20-21, every language).
//
// Storyboard (7.0 s budget, the last keyframe ends at 6.8 s): a short-night wash deepens the stage 0-0.8 s (out 5.6-6.8 s); 18
// fireflies (12 on a wrapped or narrow stage) in gold and cyan drift lazily and blink through the stage 0.15-5.2 s, three of them
// gathering into the mark (arriving 4.3-5.0 s); the mark becomes a firefly lantern (emerald frame with a gold rim, glowing hole,
// gold core) and settles with a soft bob 4.5-5.6 s, its three trapped sparks twinkle once 5.2-6.2 s; one firefly flies in and
// rests on the "m" 5.0-6.3 s, its tail glowing once 6.3-6.8 s.
// Final: firefly-lantern mark and a firefly on the "m", no sky.
// No fonts. Motion is Web Animations only: transform and opacity. No filters, no loops. Glows are static radial gradients. The
// final pose is static CSS under .rt-ss-final, so finish() gives the same pose from any point.
import './summerSolstice.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 6800 ms.
const DURATION = 7000
const CLOCK = 6800
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// Three trapped sparks in the lantern's hole (outside the mid triangle).
const SPARKS = [[-17, -11, 2.6], [17, -10, 2.3], [0, 24, 2.4]]

// Firefly at rest (viewBox -12 -9 24 14): facing left; head, orange cap, folded wings, glowing tail at the right.
const FF_BODY = 'M-7.5 0a7.5 2.7 0 1 0 15 0a7.5 2.7 0 1 0-15 0Z'
const FF_HEAD = 'M-9.7-.2a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0Z'
const FF_CAP = 'M-7.4-1a2.1 1.9 0 1 0 4.2 0a2.1 1.9 0 1 0-4.2 0Z'
const FF_WINGS = 'M-4.6-2.2C-2-5.6 5-5.8 7.4-3C4.6-1.6-1.6-1.3-4.6-2.2Z'
const FF_WING2 = 'M-3.4-2.6C-.6-7.2 5.6-7.4 7.2-5.2C4.6-3.4-.6-2.4-3.4-2.6Z'
const FF_LEGS = 'M-3 2.2L-4 4.8M0 2.6V4.8M3 2.2L4 4.8M-9-1.7Q-10.8-4.6-12.2-5.2M-8.3-2Q-9.2-5.4-10.4-6.6'
const FF_TAIL = 'M3.2.3a2.7 2.3 0 1 0 5.4 0a2.7 2.3 0 1 0-5.4 0Z'

// Firefly box (px); its glow is painted inside it.
const FLY = 14

type Pt = [number, number]

interface Geom {
    W: number
    H: number
    cx: number
    cy: number
    wx: number
    wy: number
    ww: number
    wh: number
    wrapped: boolean
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-ss-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
}

function el(tag: 'div' | 'span' | 'i', cls: string, parent?: Element): HTMLElement {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function svgFrom(markup: string, cls: string, viewBox: string): SVGSVGElement {
    const holder = document.createElement('span')
    holder.innerHTML = '<svg xmlns="' + SVGNS + '" viewBox="' + viewBox + '" class="' + cls + '" aria-hidden="true" focusable="false">' + markup + '</svg>'
    const n = holder.firstElementChild
    if (!(n instanceof SVGSVGElement)) throw new Error('summerSolstice: svg markup did not parse')
    return n
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

// Deterministic PRNG so every play (and every captured frame) uses the same flight paths.
function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function markMarkup(id: string): string {
    const sparks = SPARKS.map((p, i) =>
        '<g transform="translate(' + p[0] + ' ' + p[1] + ')"><g class="rt-ss-spark" id="' + id + '-spark' + (i + 1) + '">' +
        '<circle r="' + (p[2] * 2.4) + '" fill="url(#' + id + '-sparkglow)"/><circle class="rt-ss-sparkdot" r="' + p[2] + '"/></g></g>').join('')
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-cage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rt-ss-cage0"/><stop offset="1" class="rt-ss-cage1"/></linearGradient>' +
        '<radialGradient id="' + id + '-glow" cx="0" cy="2" r="36" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" stop-color="#fff6cf"/><stop offset=".35" stop-color="#ffd166"/><stop offset=".8" stop-color="#f2a33a"/><stop offset="1" stop-color="#c77a1c"/></radialGradient>' +
        '<radialGradient id="' + id + '-halo" cx="0" cy="4" r="70" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" class="rt-ss-halo0"/><stop offset=".55" class="rt-ss-halo1"/><stop offset="1" class="rt-ss-halo2"/></radialGradient>' +
        '<radialGradient id="' + id + '-sparkglow"><stop offset="0" stop-color="#fffbe6" stop-opacity=".95"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient>' +
        '</defs>' +
        '<g class="rt-ss-settle" id="' + id + '-settle">' +
            '<circle class="rt-ss-halo" id="' + id + '-halo" r="70" cy="4" fill="url(#' + id + '-halo)"/>' +
            '<g class="rt-ss-every" id="' + id + '-every">' +
                '<path class="rt-ss-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
                '<path class="rt-ss-ink" d="' + MID + '"/>' +
                '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
            '</g>' +
            '<g class="rt-ss-lantern" id="' + id + '-lantern">' +
                '<path class="rt-ss-holeglow" id="' + id + '-holeglow" fill="url(#' + id + '-glow)" d="' + HOLE + '"/>' +
                sparks +
                '<path class="rt-ss-cage" fill="url(#' + id + '-cage)" fill-rule="evenodd" d="' + FRAME + '"/>' +
                '<path class="rt-ss-rim" d="' + HOLE + '"/>' +
                '<path class="rt-ss-mid" d="' + MID + '"/>' +
                '<g class="rt-ss-corepop" id="' + id + '-corepop"><path class="rt-ss-core" d="' + CORE + '"/></g>' +
            '</g>' +
        '</g>'
}

function restMarkup(id: string): string {
    return '<defs><radialGradient id="' + id + '-tail"><stop offset="0" stop-color="#fffbe0"/><stop offset=".4" stop-color="#ffd166" stop-opacity=".9"/>' +
        '<stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient></defs>' +
        '<circle class="rt-ss-tailglow" id="' + id + '-tailglow" cx="6" cy=".3" r="7" fill="url(#' + id + '-tail)"/>' +
        '<path class="rt-ss-fflegs" d="' + FF_LEGS + '"/>' +
        '<path class="rt-ss-ffwings rt-ss-ffwing2" d="' + FF_WING2 + '"/>' +
        '<path class="rt-ss-ffbody" d="' + FF_BODY + '"/>' +
        '<path class="rt-ss-ffhead" d="' + FF_HEAD + '"/>' +
        '<path class="rt-ss-ffcap" d="' + FF_CAP + '"/>' +
        '<path class="rt-ss-fftail" d="' + FF_TAIL + '"/>' +
        '<path class="rt-ss-ffwings" d="' + FF_WINGS + '"/>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: short-night wash and fireflies -----
    const sky = el('div', 'rt-ss-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-ss-wash', sky)
    wash.id = id + '-wash'
    const flies: HTMLElement[] = []
    for (let f = 0; f < 18; f++) {
        const fly = el('i', 'rt-ss-fly ' + (f % 3 === 1 ? 'rt-ss-fly-cyan' : 'rt-ss-fly-gold'), sky)
        fly.id = id + '-fly' + (f + 1)
        flies.push(fly)
    }
    ctx.stage.appendChild(sky)

    // ----- Mark slot: everyday mark that settles into a firefly lantern -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-ss-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: one firefly resting on the "m" -----
    const word = ctx.word
    word.classList.add('rt-ss-word')
    const tan = findLeafSpan(word, 'Tanium')
    const rest = el('span', 'rt-ss-rest', word)
    rest.id = id + '-rest'
    rest.setAttribute('aria-hidden', 'true')
    const restFly = el('span', 'rt-ss-rest-fly', rest)
    restFly.appendChild(svgFrom(restMarkup(id), 'rt-ss-restsvg', '-12 -9 24 14'))
    const tailGlow = restFly.querySelector('.rt-ss-tailglow')

    function placeRest(): void {
        // Centre of the "m" in em, measured from the word box's left edge (estimate when it cannot be measured).
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 5.72
        const text = tan ? tan.firstChild : null
        if (tan && text) {
            try {
                const n = (text as Text).length
                const r = document.createRange()
                r.setStart(text, n - 1)
                r.setEnd(text, n)
                const mr = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (mr.width > 0) x = (mr.left + mr.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        rest.style.setProperty('--rt-ss-mx', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeRest()
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
        sky.classList.toggle('rt-ss-final', on)
        mark?.classList.toggle('rt-ss-final', on)
        word.classList.toggle('rt-ss-final', on)
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
    // With more than two keyframes the easing applies per segment (on each keyframe) and the effect stays linear, so the
    // keyframe offsets are real times (an effect-level easing would warp every hold).
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        const ease = o.ease || 'linear'
        const perSegment = frames.length > 2 && ease !== 'linear'
        const list = perSegment ? frames.map((f) => (f.easing ? f : { ...f, easing: ease })) : frames
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: perSegment ? 'linear' : ease, fill: 'both' }
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
        const ms = off.markSize ? off.markSize : (ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 0)
        const cx = ctx.markSlot ? off.markX + ms / 2 : off.wordX - 20
        const cy = ctx.markSlot ? off.markY + ms / 2 : H / 2
        const ww = off.wordWidth
        const wh = off.wordHeight
        return { W, H, cx, cy, wx: off.wordX + ww / 2, wy: off.wordY + wh / 2, ww, wh, wrapped: box.wrapped }
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

        add(sky, [], { d: CLOCK })    // scene clock (property-less), always anims[0]
        const g = geom()
        sky.classList.toggle('rt-ss-wrapped', g.wrapped)
        wash.style.setProperty('--rt-ss-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-ss-my', g.cy.toFixed(1) + 'px')
        // A soft elliptical hole over the word box keeps the wordmark readable under the wash.
        wash.style.setProperty('--rt-ss-wx', g.wx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-ss-wy', g.wy.toFixed(1) + 'px')
        wash.style.setProperty('--rt-ss-rx', (g.ww / 2 + 40).toFixed(1) + 'px')
        wash.style.setProperty('--rt-ss-ry', (g.wh / 2 + 22).toFixed(1) + 'px')

        // 1. Short-night wash: in 0-800, holds, out 5600-6800.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.118 }, { opacity: 1, offset: 0.824 }, { opacity: 0 }], { d: 6800 })

        // 1b. Fireflies. Positions are clamped so each 14 px box stays inside the stage (never outside it).
        const rnd = rng(0x5017)
        const count = (g.wrapped || g.W < 260) ? 12 : 18
        const gatherers = count === 18 ? [2, 8, 14] : [2, 6, 10]
        const minX = FLY / 2 + 2
        const maxX = Math.max(minX, g.W - FLY / 2 - 2)
        const minY = FLY / 2 + 1
        const maxY = Math.max(minY, g.H - FLY / 2 - 1)
        const cl = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
        const tf = (p: Pt, s: number): string => 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) scale(' + s.toFixed(2) + ')'
        flies.forEach((fly, i) => {
            fly.style.display = i < count ? '' : 'none'
            if (i >= count) return
            const gather = gatherers.indexOf(i) !== -1
            // Spread the start points over the stage; gatherers start to the right of the mark.
            let x0 = cl(minX + (i + rnd()) / count * (maxX - minX), minX, maxX)
            const y0 = cl(minY + rnd() * (maxY - minY), minY, maxY)
            if (gather) x0 = cl(g.cx + 40 + rnd() * Math.max(10, g.W * 0.4 - 40), minX, maxX)
            const size = 0.7 + rnd() * 0.4
            fly.style.left = (x0 - FLY / 2) + 'px'
            fly.style.top = (y0 - FLY / 2) + 'px'
            const pts: Pt[] = [[0, 0]]
            let x = x0
            let y = y0
            for (let k = 0; k < 3; k++) {
                const nx = cl(x + (rnd() * 2 - 1) * 34, minX, maxX)
                const ny = cl(y + (rnd() * 2 - 1) * 14, minY, maxY)
                pts.push([nx - x0, ny - y0])
                x = nx
                y = ny
            }
            let at: number
            let dur: number
            if (gather) {
                // End inside the mark (its centre is always inside the stage) and shrink into it.
                const gi = gatherers.indexOf(i)
                at = 1300 + gi * 250
                dur = 4300 + gi * 350 - at
                pts[3] = [g.cx - x0, g.cy - y0]
            } else {
                at = 150 + i * 75 + Math.round(rnd() * 500)
                dur = Math.min(2600 + Math.round(rnd() * 1000), 5200 - at)
            }
            const frames: Keyframe[] = gather ? [
                { transform: tf(pts[0], size), opacity: 0 },
                { transform: tf(pts[1], size), opacity: 0.95, offset: 0.25 },
                { transform: tf(pts[2], size), opacity: 0.5, offset: 0.55 },
                { transform: tf(pts[3], size * 1.1), opacity: 1, offset: 0.9 },
                { transform: tf(pts[3], 0.3), opacity: 0 },
            ] : [
                { transform: tf(pts[0], size), opacity: 0 },
                { transform: tf([pts[1][0] * 0.4, pts[1][1] * 0.4], size), opacity: 0.95, offset: 0.12 },
                { transform: tf(pts[1], size), opacity: 0.35, offset: 0.32 },
                { transform: tf([(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2], size), opacity: 1, offset: 0.48 },
                { transform: tf(pts[2], size), opacity: 0.5, offset: 0.66 },
                { transform: tf([(pts[2][0] + pts[3][0]) / 2, (pts[2][1] + pts[3][1]) / 2], size), opacity: 0.9, offset: 0.82 },
                { transform: tf(pts[3], size), opacity: 0 },
            ]
            add(fly, frames, { at, d: dur, ease: 'ease-in-out' })
        })

        if (mark) {
            const q = (s: string): Element | null => mark.querySelector(s)
            // 2. The lantern lights as the gatherers arrive (4500-5400), the everyday mark gives way, a soft settle bob.
            add(q('.rt-ss-lantern'), [{ opacity: 0 }, { opacity: 1 }], { at: 4500, d: 600, ease: 'ease-out' })
            add(q('.rt-ss-every'), [{ opacity: 1 }, { opacity: 0 }], { at: 4650, d: 450, ease: 'ease-in' })
            add(q('.rt-ss-holeglow'), [{ opacity: 0.4 }, { opacity: 1, offset: 0.35 }, { opacity: 0.72, offset: 0.65 }, { opacity: 1 }], { at: 4500, d: 900 })
            add(q('.rt-ss-halo'), [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0.8 }], { at: 4500, d: 1100, ease: 'ease-out' })
            add(q('.rt-ss-corepop'), [{ transform: 'scale(0.6)' }, { transform: 'scale(1.25)', offset: 0.55 }, { transform: 'scale(1)' }], { at: 4800, d: 600, ease: EASE_OUT })
            add(q('.rt-ss-settle'), [
                { transform: 'translate(0px, 0px) scale(1)' },
                { transform: 'translate(0px, -4px) scale(1.05)', offset: 0.4 },
                { transform: 'translate(0px, 1.5px) scale(0.985)', offset: 0.75 },
                { transform: 'translate(0px, 0px) scale(1)' },
            ], { at: 4700, d: 900, ease: 'ease-in-out' })
            mark.querySelectorAll('.rt-ss-spark').forEach((sp, i) => {
                add(sp, [
                    { opacity: 0, transform: 'scale(0.4)' },
                    { opacity: 1, transform: 'scale(1.3)', offset: 0.4 },
                    { opacity: 0.55, transform: 'scale(0.9)', offset: 0.7 },
                    { opacity: 1, transform: 'scale(1)' },
                ], { at: 5200 + i * 160, d: 680, ease: 'ease-in-out' })
            })
        }

        // 3. One firefly flies in and rests on the "m" (5000-6300), then its tail glows once (6300-6800).
        placeRest()
        add(restFly, [
            { transform: 'translate(-1.6em, -1.1em) rotate(-18deg) scale(0.7)', opacity: 0 },
            { transform: 'translate(-1.0em, -0.7em) rotate(10deg) scale(0.85)', opacity: 1, offset: 0.25 },
            { transform: 'translate(-0.2em, -0.95em) rotate(-8deg) scale(0.95)', opacity: 1, offset: 0.5 },
            { transform: 'translate(0.12em, -0.35em) rotate(6deg) scale(1)', opacity: 1, offset: 0.78 },
            { transform: 'translate(0em, 0.03em) rotate(0deg) scale(1)', opacity: 1, offset: 0.92 },
            { transform: 'translate(0em, 0em) rotate(0deg) scale(1)', opacity: 1 },
        ], { at: 5000, d: 1300, ease: EASE })
        add(tailGlow, [{ opacity: 0.6 }, { opacity: 1, offset: 0.4 }, { opacity: 0.7, offset: 0.75 }, { opacity: 0.85 }], { at: 6300, d: 500, ease: 'ease-in-out' })
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
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        arm()
        return playPromise
    }

    // ctx.onRelayout: while playing, rebuild the timeline from the new geometry and jump every animation to the current scene
    // time (the clock, anims[0]), keeping a paused state. Coalesced to one rebuild per frame.
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
        rest.remove()
        word.classList.remove('rt-ss-word', 'rt-ss-final')
        settle()
    }

    placeRest()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'summerSolstice',
    durationMs: DURATION,
    build,
}
export default scene
