// Seasonal scene: newYear (Jan 1-3).
//
// Storyboard (7.0 s): a dawn glow warms the stage 0-1.4 s (holds, fades 5.6-6.6 s); the idle mark flips (scaleY 1 to -1)
// into a mountain 0.6-1.6 s; the sun rises behind the peak 1.5-3.3 s, its glow and rays open 2.4-3.5 s and a sea glint
// 3.0-3.8 s; the wordmark fades and scales out 1.8-2.4 s; "Happy New Year" fades and scales in 2.4-3.0 s while the year
// glides in riding a small swirl cloud (2.55-3.45 s); both hold and leave 4.6-5.2 s; the wordmark returns with a faint
// warm edge 5.2-5.9 s.
// Final: mountain mark with the sun half-risen behind its peak, everyday wordmark with a thin warm edge.
// Only transform and opacity are animated (Web Animations API). No filters, no loops.
import './newYear.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// Snowcap, drawn on the downward mark (bottom vertex) so the flip turns it into the peak's cap. Its jagged edge stays
// inside the outer triangle (half-width 55.85 * (64.49 - y) / 96.74).
const SNOW = 'M0 64.49L-13.6 41L-8.6 45.2L-4.6 41.6L0.4 46.6L5.4 42.4L9.1 44.6L13.6 41Z'
const VIEWBOX = '-73 -66 146 146'
// Final sun centre in upright units; the peak (0,-64.49) stands in front.
const SUN = { cx: 0, cy: -27, r: 30 }
const DURATION = 7000
// Swirl cloud the year rides on. viewBox 40x16, stroked with currentColor.
const CLOUD = '<svg viewBox="0 0 40 16" aria-hidden="true" focusable="false"><path d="M2 13.5H29.5C34.5 13.5 38 10.6 38 7.2S35.2 1.5 31.6 1.5 26 4 26 6.8 27.8 10.4 30.6 10.4 33.4 8.6 33.4 6.8M7 9.2H20.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'

interface Mark {
    svg: SVGSVGElement
    flip: SVGGElement
    brand: SVGGElement
    mtn: SVGGElement
    sun: SVGGElement
    rays: SVGPathElement
    glow: SVGCircleElement
    glint: SVGGElement
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
    const n = document.createElementNS(SVG_NS, tag)
    for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]))
    if (parent) parent.appendChild(n)
    return n
}

function htmlEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function raysPath(): string {
    // Nine short rays over the upper half of the sun, from 36 to 45 units out.
    let d = ''
    for (let i = 0; i < 9; i++) {
        const a = (-170 + i * 20) * Math.PI / 180
        const w = 0.05
        const r0 = 35.5
        const r1 = i % 2 ? 42 : 46
        const p = (r: number, da: number): string => (SUN.cx + r * Math.cos(a + da)).toFixed(2) + ' ' + (SUN.cy + r * Math.sin(a + da)).toFixed(2)
        d += 'M' + p(r0, -w) + 'L' + p(r1, 0) + 'L' + p(r0, w) + 'Z'
    }
    return d
}

function buildMark(uid: string): Mark {
    const id = uid + '-ny'
    const svg = svgEl('svg', { viewBox: VIEWBOX, class: 'rt-ny-mark', 'aria-hidden': 'true', focusable: 'false' })
    const defs = svgEl('defs', {}, svg)
    const cg = svgEl('linearGradient', { id: id + '-core' }, defs)
    svgEl('stop', { offset: '0', 'stop-color': '#00a1ad' }, cg)
    svgEl('stop', { offset: '1', 'stop-color': '#587bff' }, cg)
    // Flipped: y1=1 is the peak.
    const mg = svgEl('linearGradient', { id: id + '-mtn', x1: '0', y1: '1', x2: '0', y2: '0' }, defs)
    svgEl('stop', { offset: '0', class: 'rt-ny-m0' }, mg)
    svgEl('stop', { offset: '1', class: 'rt-ny-m1' }, mg)
    const sg = svgEl('radialGradient', { id: id + '-sun', cx: SUN.cx, cy: SUN.cy - 6, r: SUN.r + 6, gradientUnits: 'userSpaceOnUse' }, defs)
    svgEl('stop', { offset: '0', 'stop-color': '#fff1b8' }, sg)
    svgEl('stop', { offset: '0.55', 'stop-color': '#ffc04d' }, sg)
    svgEl('stop', { offset: '1', 'stop-color': '#ff8a2a' }, sg)
    const gg = svgEl('radialGradient', { id: id + '-glow', cx: SUN.cx, cy: SUN.cy, r: 52, gradientUnits: 'userSpaceOnUse' }, defs)
    svgEl('stop', { offset: '0.5', class: 'rt-ny-glow0' }, gg)
    svgEl('stop', { offset: '1', class: 'rt-ny-glow1' }, gg)
    const clip = svgEl('clipPath', { id: id + '-horizon' }, defs)
    // Everything above the base line y = 32.25.
    svgEl('rect', { x: '-100', y: '-140', width: '200', height: '172.25' }, clip)

    const glow = svgEl('circle', { class: 'rt-ny-glow', cx: SUN.cx, cy: SUN.cy, r: 52, fill: 'url(#' + id + '-glow)' }, svg)
    const rays = svgEl('path', { class: 'rt-ny-rays', d: raysPath() }, svg)
    rays.style.transformOrigin = SUN.cx + 'px ' + SUN.cy + 'px'
    const horizon = svgEl('g', { 'clip-path': 'url(#' + id + '-horizon)' }, svg)
    const sun = svgEl('g', { class: 'rt-ny-sun' }, horizon)
    svgEl('circle', { cx: SUN.cx, cy: SUN.cy, r: SUN.r, fill: 'url(#' + id + '-sun)', class: 'rt-ny-sun-disc' }, sun)

    const flip = svgEl('g', { class: 'rt-ny-flip' }, svg)
    const brand = svgEl('g', { class: 'rt-ny-brand' }, flip)
    svgEl('path', { class: 'rt-ny-ink', 'fill-rule': 'evenodd', d: FRAME }, brand)
    svgEl('path', { class: 'rt-ny-ink', d: MID }, brand)
    svgEl('path', { fill: 'url(#' + id + '-core)', d: CORE }, brand)
    const mtn = svgEl('g', { class: 'rt-ny-mtn' }, flip)
    svgEl('path', { class: 'rt-ny-mtn-hole', d: HOLE }, mtn)
    svgEl('path', { class: 'rt-ny-mtn-frame', fill: 'url(#' + id + '-mtn)', 'fill-rule': 'evenodd', d: FRAME }, mtn)
    svgEl('path', { class: 'rt-ny-mtn-snow', d: SNOW }, mtn)
    svgEl('path', { class: 'rt-ny-mtn-mid', d: MID }, mtn)
    svgEl('path', { fill: 'url(#' + id + '-core)', d: CORE }, mtn)

    // A short sea glint under the mountain's base: the sun's path on calm water.
    const glint = svgEl('g', { class: 'rt-ny-glint' }, svg)
    glint.style.transformOrigin = '0px 42px'
    svgEl('path', { d: 'M-17 42H17M-10 49H10M-4.5 56H4.5' }, glint)
    return { svg, flip, brand, mtn, sun, rays, glow, glint }
}

// Finds the visual "Risu" and "Tanium" spans inside the word without relying on the host's class names.
function findSpans(word: HTMLElement): { risu: HTMLElement | null, tanium: HTMLElement | null } {
    const out: { risu: HTMLElement | null, tanium: HTMLElement | null } = { risu: null, tanium: null }
    for (const n of Array.from(word.querySelectorAll('span'))) {
        if (n.children.length) continue
        if (n.textContent === 'Risu' && !out.risu) out.risu = n
        else if (n.textContent === 'Tanium' && !out.tanium) out.tanium = n
    }
    return out
}

function build(ctx: SceneContext): SceneInstance {
    let anims: Animation[] = []
    let added: HTMLElement[] = []
    const roots: Element[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let timers: number[] = []

    let mark: Mark | null = null
    if (ctx.markSlot) {
        mark = buildMark(ctx.uid)
        ctx.markSlot.appendChild(mark.svg)
        roots.push(mark.svg)
    }

    const layer = htmlEl('div', 'rt-ny-stage', ctx.stage)
    layer.setAttribute('aria-hidden', 'true')
    added.push(layer)
    roots.push(layer)
    const dawn = htmlEl('div', 'rt-ny-dawn', layer)
    // Greeting: "Happy New Year" and the year riding in on a small swirl cloud.
    const text = htmlEl('div', 'rt-ny-text', layer)
    const ta = htmlEl('span', 'rt-ny-text-a', text)
    ta.textContent = 'Happy New Year'
    const ride = htmlEl('span', 'rt-ny-ride', text)
    const yr = htmlEl('span', 'rt-ny-year', ride)
    yr.textContent = String(ctx.year)
    const rideCloud = htmlEl('i', 'rt-ny-ride-cloud', ride)
    rideCloud.innerHTML = CLOUD

    const spans = findSpans(ctx.word)
    const prevOrigin = ctx.word.style.transformOrigin
    ctx.word.style.transformOrigin = '0 50%'
    if (spans.risu) spans.risu.classList.add('rt-ny-risu')
    if (spans.tanium) spans.tanium.classList.add('rt-ny-tanium')

    function pose(p: string): void {
        for (const r of roots) r.setAttribute('data-rt-pose', p)
    }
    function warm(on: boolean): void {
        ctx.word.classList.toggle('rt-ny-warm', on)
    }
    pose('pre')

    function run(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
        const a = el.animate(frames, { fill: 'both', easing: 'linear', ...opts })
        anims.push(a)
        return a
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

    let rideX = 16
    function layout(): void {
        const W = ctx.stageWidth()
        const box = ctx.stageBox()
        const H = box.height || 96
        const off = ctx.stageOffset()
        const wr = ctx.word.getBoundingClientRect()
        const wordX = off.wordX
        const wordY = off.wordY
        const ms = ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 32
        const cs = getComputedStyle(ctx.word)
        const wfs = parseFloat(cs.fontSize)
        const midY = wordY + wr.height / 2
        const fs0 = wfs * 0.92
        text.style.left = wordX + 'px'
        text.style.fontFamily = cs.fontFamily
        text.style.fontSize = fs0.toFixed(2) + 'px'
        text.classList.remove('rt-ny-text--2')
        ta.style.fontSize = ride.style.fontSize = ''
        // The cloud tail reaches 0.35em past the year; keep it inside the stage too.
        const max = Math.max(36, W - wordX - 6 - fs0 * 0.35)
        const natural = text.getBoundingClientRect().width
        let size = fs0
        if (natural * 0.8 <= max) {
            // One line: "Happy New Year 2027", scaled to the stage's right edge when needed.
            if (natural > max) {
                size = fs0 * max / natural
                text.style.fontSize = size.toFixed(2) + 'px'
            }
        } else {
            // Narrow stage: "Happy New Year" small over a larger year on its cloud.
            text.classList.add('rt-ny-text--2')
            const fa = Math.min(fs0 * 0.62, fs0 * max / Math.max(1, ta.getBoundingClientRect().width))
            const fy = Math.min(fs0 * 0.95, fs0 * (max - fs0 * 0.1) / Math.max(1, ride.getBoundingClientRect().width))
            ta.style.fontSize = fa.toFixed(2) + 'px'
            ride.style.fontSize = fy.toFixed(2) + 'px'
            size = fy
        }
        // Fit the block (with the cloud under the year) into the stage height; the host may clamp it to ~56 px on phones.
        let th = text.getBoundingClientRect().height + size * 0.5
        if (th > H - 4) {
            const k = (H - 4) / th
            if (text.classList.contains('rt-ny-text--2')) {
                ta.style.fontSize = (parseFloat(ta.style.fontSize) * k).toFixed(2) + 'px'
                ride.style.fontSize = (parseFloat(ride.style.fontSize) * k).toFixed(2) + 'px'
            } else text.style.fontSize = (size * k).toFixed(2) + 'px'
            size *= k
            th = text.getBoundingClientRect().height + size * 0.5
        }
        text.style.top = Math.max(1, Math.min(H - th - 1, midY - th / 2 - size * 0.1)).toFixed(1) + 'px'
        rideX = Math.round(size * 0.9)
        // The dawn glow centres on the mark, low on the bar, and fades out before the stage's edges.
        const cx = off.markX + ms / 2
        const cy = off.markY + ms * 0.62
        dawn.style.setProperty('--rt-ny-x', cx.toFixed(1) + 'px')
        dawn.style.setProperty('--rt-ny-y', cy.toFixed(1) + 'px')
    }
    // Re-fit when the stage geometry changes after build (also during play).
    ctx.onRelayout(() => { if (state === 'playing') layout() })

    function timeline(): void {
        const out = 'cubic-bezier(.2,.7,.3,1)'
        const inn = 'cubic-bezier(.5,0,.75,.3)'
        run(dawn, [
            { opacity: 0, easing: 'cubic-bezier(.3,.6,.4,1)' }, { offset: 0.212, opacity: 1 },
            { offset: 0.848, opacity: 1, easing: 'ease-in-out' }, { opacity: 0 },
        ], { duration: 6600 })
        if (mark) {
            // Flip with easing per keyframe on a linear effect: edge-on is exactly at offset 0.5 (1100 ms) and the colour
            // swap runs 0.49-0.51 while the mark is a sliver, so the white everyday triangle never shows mid-flip.
            run(mark.flip, [
                { transform: 'scale(1,1)', easing: 'cubic-bezier(.45,0,.8,.55)' },
                { offset: 0.5, transform: 'scale(1.06,0.02)', easing: 'cubic-bezier(.2,.45,.35,1)' },
                { offset: 0.82, transform: 'scale(1,-1.07)', easing: 'ease-in-out' },
                { transform: 'scale(1,-1)' },
            ], { duration: 1000, delay: 600 })
            run(mark.brand, [{ opacity: 1 }, { offset: 0.49, opacity: 1 }, { offset: 0.51, opacity: 0 }, { opacity: 0 }], { duration: 1000, delay: 600 })
            run(mark.mtn, [{ opacity: 0 }, { offset: 0.49, opacity: 0 }, { offset: 0.51, opacity: 1 }, { opacity: 1 }], { duration: 1000, delay: 600 })
            run(mark.sun, [{ transform: 'translate(0px,100px)' }, { transform: 'translate(0px,0px)' }], { duration: 1800, delay: 1500, easing: 'cubic-bezier(.25,.6,.2,1)' })
            run(mark.glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000, delay: 2400, easing: 'ease-out' })
            run(mark.glint, [{ transform: 'scale(0.2,1)', opacity: 0 }, { transform: 'scale(1,1)', opacity: 1 }], { duration: 800, delay: 3000, easing: out })
            run(mark.rays, [{ transform: 'rotate(-12deg) scale(0.7)', opacity: 0 }, { transform: 'rotate(0deg) scale(1)', opacity: 1 }], { duration: 700, delay: 2800, easing: out })
        }
        // Word out 1.8-2.4 s, back 5.2-5.9 s (opacity 1 -> 0, scale 1 -> 0.96 about its left edge).
        run(ctx.word, [
            { opacity: 1, transform: 'scale(1)', easing: inn },
            { offset: 0.146, opacity: 0, transform: 'scale(0.96)' },
            { offset: 0.829, opacity: 0, transform: 'scale(0.96)', easing: out },
            { opacity: 1, transform: 'scale(1)' },
        ], { duration: 4100, delay: 1800 })
        // The year glides in on its cloud from the right, settling with a small bob (2.55-3.45 s).
        run(ride, [
            { transform: 'translate(' + rideX + 'px,3px)', opacity: 0, easing: out },
            { offset: 0.65, transform: 'translate(-1px,-1.5px)', opacity: 1, easing: 'ease-in-out' },
            { transform: 'translate(0px,0px)', opacity: 1 },
        ], { duration: 900, delay: 2550 })
        // Greeting in 2.4-3.0 s, hold, out 4.6-5.2 s.
        run(text, [
            { opacity: 0, transform: 'scale(0.96)', easing: out },
            { offset: 0.214, opacity: 1, transform: 'scale(1)' },
            { offset: 0.786, opacity: 1, transform: 'scale(1)', easing: inn },
            { opacity: 0, transform: 'scale(0.96)' },
        ], { duration: 2800, delay: 2400 })
        later(() => warm(true), 5200)
        // Re-fit just before the greeting appears, against the current stage.
        later(() => { if (state === 'playing') layout() }, 2350)
    }

    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function finish(): void {
        if (state === 'destroyed') return
        cancelAll()
        state = 'final'
        warm(true)
        pose('final')
        settle()
    }

    return {
        play() {
            if (state !== 'built') return Promise.resolve()
            state = 'playing'
            pose('play')
            layout()
            timeline()
            return new Promise<void>((resolve) => {
                resolvePlay = resolve
                Promise.all(anims.map((a) => a.finished)).then(() => {
                    if (state === 'playing') later(finish, Math.max(0, DURATION - 6600))
                }, () => {})
            })
        },
        finish,
        destroy() {
            cancelAll()
            state = 'destroyed'
            warm(false)
            ctx.word.style.transformOrigin = prevOrigin
            if (spans.risu) spans.risu.classList.remove('rt-ny-risu')
            if (spans.tanium) spans.tanium.classList.remove('rt-ny-tanium')
            for (const n of added) if (n.parentNode) n.parentNode.removeChild(n)
            added = []
            if (mark && mark.svg.parentNode) mark.svg.parentNode.removeChild(mark.svg)
            settle()
        },
    }
}

const scene: SceneDef = { key: 'newYear', durationMs: DURATION, build }
export default scene
