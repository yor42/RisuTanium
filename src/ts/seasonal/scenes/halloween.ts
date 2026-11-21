// Seasonal scene: halloween (Oct 31, all locales).
//
// Storyboard (7.2 s): a night tint washes the stage 0-0.7 s (full until 2.6 s, eases to 0.6 by 3.4 s, out 6.0-7.2 s);
// four bats leave from behind the mark 0.45-3.55 s; the everyday mark shrinks away 2.3-2.9 s and a jack-o'-lantern pops
// in 2.45-3.35 s, its carving lighting 3.4-4.3 s; a small bat flies in and settles on the "T" 4.1-5.6 s; "Tanium" takes
// one candle flicker 5.2-6.4 s. Final: jack-o'-lantern mark, bat perched on the "T", no night tint.
// Only transform and opacity are animated (Web Animations API; the flicker animates a ::after where the browser can
// target it). No filters. The final pose is static CSS under .rt-hw-final, so finish() is identical from any point.
import './halloween.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DURATION = 7400
// The last keyframe ends at 7200 ms.
const TIMELINE = 7200

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const OUTER = 'M-55.85-32.25H55.85L0 64.49Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
const VIEWBOX = '-73 -66 146 146'

// Jack-o'-lantern carving inside the frame silhouette: two upward eyes and a downward (mark-like) mouth with two teeth.
const EYES = 'M-26 0L-17-16L-8 0ZM8 0L17-16L26 0Z'
const MOUTH = 'M-19 9H-9L-6 15L-3 9H3L6 15L9 9H19L0 35Z'
// Pumpkin ribs (clipped to the body) and stem.
const RIBS = 'M-20-32C-30 -2-16 30 0 64M20-32C30-2 16 30 0 64'
const STEM = 'M-4.5-31C-5-36-4-41-1-44C1-45 4-44 4.5-42C2-39 3-35 4.5-31Z'
const LEAF = 'M4-40C9-46 16-45 18-41C13-41 9-39 6-37Z'

// Bat silhouettes (viewBox 0 0 40 24): wings are separate groups so they can flap with scaleY about the shoulder.
const BAT_BODY = 'M20 5C22.8 5 24.3 7.4 24.3 10.6C24.3 15.2 22.3 19 20 19C17.7 19 15.7 15.2 15.7 10.6C15.7 7.4 17.2 5 20 5Z' +
    'M16.6 6.8L16 1.6L19 5.2ZM23.4 6.8L24 1.6L21 5.2Z'
const BAT_WING_L = 'M17 8C12 3 6 1.5 .5 3.5C2.5 6 3 9 2.5 12.5C5 11 7.5 11.5 9 14C10.5 12 13 11.6 15 13C15.6 11.6 16.2 11 17 11Z'
const BAT_WING_R = 'M23 8C28 3 34 1.5 39.5 3.5C37.5 6 37 9 37.5 12.5C35 11 32.5 11.5 31 14C29.5 12 27 11.6 25 13C24.4 11.6 23.8 11 23 11Z'
const BAT_EYES = 'M17.6 9.6a1 1 0 1 0 2 0a1 1 0 1 0-2 0ZM20.4 9.6a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z'

const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

interface RunOptions {
    /** Delay in ms. */
    at?: number
    /** Duration in ms. */
    d: number
    ease?: string
    fill?: FillMode
    iter?: number
    dir?: PlaybackDirection
    /** Moves `ease` onto each keyframe (a keyframe's own easing wins) and keeps the effect linear, so offsets are real times. */
    segment?: boolean
    pseudo?: string
}

interface Geom {
    W: number
    H: number
    cx: number
    cy: number
    wr: { x: number, y: number, w: number, h: number }
    wrapped: boolean
    moon: { x: number, y: number } | null
}

const MOON_R = 22

function sid(uid: string): string {
    return 'rt-hw-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('halloween: svg markup did not parse')
    return n
}

function batMarkup(eyes: boolean): string {
    return '<g class="rt-hw-wing rt-hw-wing-l"><path d="' + BAT_WING_L + '"/></g>' +
        '<g class="rt-hw-wing rt-hw-wing-r"><path d="' + BAT_WING_R + '"/></g>' +
        '<path class="rt-hw-batbody" d="' + BAT_BODY + '"/>' +
        (eyes ? '<path class="rt-hw-bateyes" d="' + BAT_EYES + '"/>' : '')
}

function markMarkup(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".55" stop-color="#f7801e"/><stop offset="1" stop-color="#d9560b"/></linearGradient>' +
        '<radialGradient id="' + id + '-flame" cx="0.5" cy="0.62" r="0.7"><stop offset="0" stop-color="#fffbe2"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffb12e"/></radialGradient>' +
        '<clipPath id="' + id + '-body"><path d="' + OUTER + '"/></clipPath>' +
        '</defs>' +
        '<g class="rt-hw-every">' +
        '<path class="rt-hw-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-hw-ink" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-hw-pumpkin">' +
        '<path class="rt-hw-stem" d="' + STEM + '"/>' +
        '<path class="rt-hw-leaf" d="' + LEAF + '"/>' +
        '<path class="rt-hw-skin" fill="url(#' + id + '-skin)" stroke-linejoin="round" d="' + OUTER + '"/>' +
        '<path class="rt-hw-ribs" clip-path="url(#' + id + '-body)" d="' + RIBS + '"/>' +
        '<path class="rt-hw-carve" d="' + EYES + MOUTH + '"/>' +
        '<g class="rt-hw-glow"><path fill="url(#' + id + '-flame)" d="' + EYES + MOUTH + '"/></g>' +
        '</g>'
}

// Finds the visual "Tanium" span inside the word without relying on the host's class names.
function findLeafSpan(root: HTMLElement, text: string): HTMLElement | null {
    for (const n of Array.from(root.querySelectorAll('span'))) {
        if (n.children.length === 0 && n.textContent === text) return n
    }
    return null
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null

    // ----- Stage: night tint and fleeing bats -----
    const sky = htmlEl('div', 'rt-hw-sky', ctx.stage)
    sky.setAttribute('aria-hidden', 'true')
    const tint = htmlEl('div', 'rt-hw-tint', sky)
    const moon = htmlEl('div', 'rt-hw-moon', tint) // static; fades with the tint
    const bats: HTMLElement[] = []
    for (let b = 0; b < 4; b++) {
        const wrap = htmlEl('div', 'rt-hw-bat rt-hw-bat-' + (b + 1), sky)
        wrap.appendChild(svgFrom(batMarkup(false), 'rt-hw-batsvg', '0 0 40 24'))
        bats.push(wrap)
    }

    // ----- Mark slot: everyday mark that becomes a jack-o'-lantern -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-hw-mark', VIEWBOX)
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: perched bat on "T", candle flicker on "Tanium" -----
    const word = ctx.word
    word.classList.add('rt-hw-word')
    const tan = findLeafSpan(word, 'Tanium')
    if (tan) {
        tan.classList.add('rt-hw-tan')
        tan.setAttribute('data-rt-hw-text', 'Tanium')
    }
    const perch = htmlEl('span', 'rt-hw-perch', word)
    perch.setAttribute('aria-hidden', 'true')
    const perchInner = htmlEl('span', 'rt-hw-perch-fly', perch)
    perchInner.appendChild(svgFrom(batMarkup(true), 'rt-hw-batsvg', '0 0 40 24'))

    function placePerch(): void {
        // Centre of the "T" in em of the word's font size, measured from the word box's left edge.
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 2.55 // NanumSquare Neo estimate when measurement is impossible
        if (tan && tan.firstChild && typeof document.createRange === 'function') {
            try {
                const r = document.createRange()
                r.setStart(tan.firstChild, 0)
                r.setEnd(tan.firstChild, 1)
                const tr = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (tr.width > 0) x = (tr.left + tr.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        perch.style.setProperty('--rt-hw-tx', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placePerch()
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

    function add(node: Element, frames: Keyframe[], opts: RunOptions): Animation {
        const o: KeyframeAnimationOptions = { duration: opts.d, delay: opts.at || 0, easing: opts.ease || 'linear', fill: opts.fill || 'both' }
        if (opts.iter) o.iterations = opts.iter
        if (opts.dir) o.direction = opts.dir
        if (opts.pseudo) o.pseudoElement = opts.pseudo
        let fr = frames
        if (opts.segment && frames.length > 2 && o.easing !== 'linear') {
            const ez = o.easing
            o.easing = 'linear'
            fr = frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing: ez }))
        }
        const a = node.animate(fr, o)
        anims.push(a)
        return a
    }

    function rel(node: Element): { x: number, y: number, w: number, h: number } {
        const s = ctx.stage.getBoundingClientRect()
        const r = node.getBoundingClientRect()
        return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
    }

    // Stage geometry, re-measured on every layout: the clamped height and whether the top bar wrapped come from the host.
    function geom(): Geom {
        const box = ctx.stageBox()
        const s = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : s.width
        const H = box.height ? box.height : s.height
        const wr = rel(word)
        const origin = ctx.markSlot ? rel(ctx.markSlot) : null
        const cx = origin ? origin.x + origin.w / 2 : wr.x - 14
        const cy = origin ? origin.y + origin.h / 2 : wr.y + wr.h / 2
        const wordRight = wr.x + wr.w
        // Moon: 9 px disc in a 22 px halo. It is drawn only where the whole halo clears the word by 4 px and the
        // stage edge by 2 px, so it can never sit over the word.
        const mx = Math.min(W - MOON_R - 6, Math.max(wordRight + 4 + MOON_R + 10, W * 0.8))
        let moonAt: { x: number, y: number } | null = null
        if (mx - MOON_R >= wordRight + 4 && mx + MOON_R <= W - 2) moonAt = { x: mx, y: Math.max(MOON_R - 4, Math.min(cy - 4, H - MOON_R)) }
        return { W, H, cx, cy, wr, wrapped: box.wrapped, moon: moonAt }
    }
    function applyGeom(g: Geom): void {
        sky.classList.toggle('rt-hw-narrow', !g.moon)
        sky.classList.toggle('rt-hw-wrapped', g.wrapped)
        tint.style.setProperty('--rt-hw-mx', g.cx.toFixed(1) + 'px')
        tint.style.setProperty('--rt-hw-my', g.cy.toFixed(1) + 'px')
        if (g.moon) {
            moon.style.left = (g.moon.x - MOON_R) + 'px'
            moon.style.top = (g.moon.y - MOON_R) + 'px'
            moon.style.width = moon.style.height = 2 * MOON_R + 'px'
        }
    }

    function timeline(): void {
        add(sky, [], { d: TIMELINE }) // scene clock (property-less), always anims[0]
        const g = geom()
        applyGeom(g)
        // 1. Night tint: 0-700 in, full until 2600, eases to 0.6 by 3400 so the jack-o'-lantern reads, 6000-7200 out.
        add(tint, [{ opacity: 0 }, { opacity: 1, offset: 0.097 }, { opacity: 1, offset: 0.361 }, { opacity: 0.6, offset: 0.472 },
            { opacity: 0.6, offset: 0.833 }, { opacity: 0 }], { d: TIMELINE })

        // 1b. Bats leave from behind the mark (stage coordinates, measured now).
        const cx = g.cx
        const cy = g.cy
        const W = g.W
        // [dx, dy] waypoints relative to the mark centre; the last one is off-stage.
        const paths: number[][][] = [
            [[18, -14], [Math.min(W * 0.32, 120), -6], [Math.min(W * 0.5, 190), -60]],
            [[30, 4], [W * 0.45, -10], [W + 40 - cx, 2]],
            [[-6, -16], [-14, -30], [-cx - 40, -64]],
            [[26, 16], [W * 0.38, 30], [W + 40 - cx, -18]],
        ]
        const starts = [450, 650, 820, 1050]
        const durs = [2000, 2300, 1700, 2500]
        bats.forEach((bat, i) => {
            bat.style.left = (cx - 15) + 'px'
            bat.style.top = (cy - 9) + 'px'
            const p = paths[i]
            const tilt = p[2][0] < 0 ? -1 : 1
            add(bat, [
                { transform: 'translate(0px, 0px) scale(0.25) rotate(0deg)', opacity: 0 },
                { transform: 'translate(' + p[0][0] + 'px,' + p[0][1] + 'px) scale(0.6) rotate(' + (-8 * tilt) + 'deg)', opacity: 1, offset: 0.2 },
                { transform: 'translate(' + p[1][0] + 'px,' + p[1][1] + 'px) scale(0.9) rotate(' + (6 * tilt) + 'deg)', opacity: 1, offset: 0.6 },
                { transform: 'translate(' + p[2][0] + 'px,' + p[2][1] + 'px) scale(1) rotate(' + (-10 * tilt) + 'deg)', opacity: 1, offset: 0.98 },
                { transform: 'translate(' + p[2][0] + 'px,' + p[2][1] + 'px) scale(1) rotate(' + (-10 * tilt) + 'deg)', opacity: 0 },
            ], { at: starts[i], d: durs[i], ease: EASE_IN })
            const flap = 150 + i * 12
            let n = Math.floor(durs[i] / flap)
            if (n % 2) n -= 1 // even count: wings end open
            bat.querySelectorAll('.rt-hw-wing').forEach((w) => {
                add(w, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.3)' }], { at: starts[i], d: flap, iter: n, dir: 'alternate', ease: 'ease-in-out' })
            })
        })

        if (mark) {
            const every = mark.querySelector('.rt-hw-every')
            const pumpkin = mark.querySelector('.rt-hw-pumpkin')
            const glow = mark.querySelector('.rt-hw-glow')
            // 2. Everyday mark shrinks away 2300-2900; the pumpkin pops in 2450-3350; carving lights 3400-4300.
            if (every) add(every, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.55)', opacity: 0 }], { at: 2300, d: 600, ease: EASE_IN })
            if (pumpkin) {
                add(pumpkin, [
                    { transform: 'scale(0.4)', opacity: 0 },
                    { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
                    { transform: 'scale(0.97)', opacity: 1, offset: 0.82 },
                    { transform: 'scale(1)', opacity: 1 },
                ], { at: 2450, d: 900, ease: EASE_OUT, segment: true })
            }
            if (glow) {
                add(glow, [
                    { opacity: 0 }, { opacity: 0.95, offset: 0.18 }, { opacity: 0.3, offset: 0.34 },
                    { opacity: 1, offset: 0.55 }, { opacity: 0.62, offset: 0.74 }, { opacity: 1 },
                ], { at: 3400, d: 900 })
            }
        }

        // 3. A small bat flies in and settles on the "T" 4100-5600 (in em, relative to its final perch).
        placePerch()
        add(perchInner, [
            { transform: 'translate(2.4em, -0.9em) scale(0.55) rotate(-12deg)', opacity: 0 },
            { transform: 'translate(1.7em, -0.55em) scale(0.75) rotate(8deg)', opacity: 1, offset: 0.22 },
            { transform: 'translate(0.9em, -0.85em) scale(0.9) rotate(-8deg)', opacity: 1, offset: 0.48 },
            { transform: 'translate(0.25em, -0.4em) scale(1) rotate(6deg)', opacity: 1, offset: 0.74 },
            { transform: 'translate(0em, 0.04em) scale(1) rotate(0deg)', opacity: 1, offset: 0.9 },
            { transform: 'translate(0em, 0em) scale(1) rotate(0deg)', opacity: 1 },
        ], { at: 4100, d: 1500, ease: EASE, segment: true })
        perchInner.querySelectorAll('.rt-hw-wing').forEach((w) => {
            // Flap during the flight, then fold to the perched pose (scaleX 0.55, the .rt-hw-final value).
            add(w, [{ transform: 'scale(1, 1)' }, { transform: 'scale(1, 0.3)' }], { at: 4100, d: 140, iter: 8, dir: 'alternate', ease: 'ease-in-out' })
            add(w, [{ transform: 'scale(1, 1)' }, { transform: 'scale(0.55, 1)' }], { at: 5250, d: 350, ease: EASE_OUT, fill: 'forwards' })
        })

        // 4. "Tanium" takes a candle flicker once 5200-6400, then settles back to its ink. Only where WAAPI can target
        // ::after; elsewhere animating would blink the word itself, so it is skipped.
        const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
        if (tan && pseudoOk) {
            add(tan, [
                { opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.35, offset: 0.24 }, { opacity: 0.95, offset: 0.36 },
                { opacity: 0.55, offset: 0.5 }, { opacity: 1, offset: 0.64 }, { opacity: 1, offset: 0.78 }, { opacity: 0 },
            ], { at: 5200, d: 1200, pseudo: '::after' })
        }
    }

    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placePerch()
        sky.classList.add('rt-hw-final')
        if (mark) mark.classList.add('rt-hw-final')
        word.classList.add('rt-hw-final')
        state = 'final'
        settle()
    }

    // Host seam: while playing, rebuild the timeline from the new geometry and jump every animation to the current
    // scene time, so positions, the moon and the compact sky follow the real stage. The end timer restarts with it.
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placePerch()
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
        later(() => { if (state === 'playing') applyFinal() }, Math.max(0, TIMELINE - t))
    }
    ctx.onRelayout(relayout)

    placePerch()
    return {
        play() {
            if (state !== 'built') return Promise.resolve()
            state = 'playing'
            timeline()
            return new Promise<void>((resolve) => {
                resolvePlay = resolve
                later(() => { if (state === 'playing') applyFinal() }, TIMELINE)
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
            if (perch.parentNode) perch.parentNode.removeChild(perch)
            word.classList.remove('rt-hw-word', 'rt-hw-final')
            if (tan) {
                tan.classList.remove('rt-hw-tan')
                tan.removeAttribute('data-rt-hw-text')
            }
            settle()
        },
    }
}

const scene: SceneDef = { key: 'halloween', durationMs: DURATION, build }
export default scene
