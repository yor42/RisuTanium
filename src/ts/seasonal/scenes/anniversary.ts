// Seasonal scene: anniversary (Sep 21, from 2027).
//
// Storyboard (6.8 s): the nested triangles slide up out of the frame and stack into a three-tier cake 0.3-1.7 s (the
// frame's hole fills as they leave); frosting sets 1.6-2.1 s; min(N, 5) candles rise 2.1-2.8 s and light 2.8-3.4 s with
// one flicker; one confetti burst (32 pieces) 3.6-5.6 s; the greeting link fades and scales in 4.6-5.3 s. Final:
// cake-stack mark with lit candles, the everyday wordmark and the greeting link.
// Only transform and opacity are animated (Web Animations API). No filters, no loops.
//
// The greeting button is host-owned (placement, fitting, onLink via the host's anniversary URL); the scene only
// animates it and the host removes it with the scene.
import './anniversary.css'
import { anniversaryOrdinal, anniversaryText } from '../calendar'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
const VIEWBOX = '-73 -66 146 146'
const DURATION = 6800
const CONFETTI = 32

// Tiers: the nested triangles scaled about the centroid and lifted, so each top edge sits above the one below.
//   mid  (top edge 23.26 wide at y -6.72)  -> 100 wide at y -54: scale 4.299, lift -25.11
//   core (top edge 14.84 wide at y -4.28)  -> 64 wide at y -71: scale 4.313, lift -52.54
// The whole cake then sits 8 units lower (SHIFT) so the flames stay inside the mark slot's 6 px margin.
const MID_T = { k: 100 / 23.26, dy: -54 + 6.72 * 100 / 23.26, top: -54, hw: 50 }
const CORE_T = { k: 64 / 14.84, dy: -71 + 4.28 * 64 / 14.84, top: -71, hw: 32 }
const SHIFT = 8

interface CandleSpec {
    w: number
    h: number
    gap: number
}

// Candle size by count: one tall candle reads at 32 px; more candles get slimmer.
function candleSpec(n: number): CandleSpec {
    return n === 1 ? { w: 7, h: 15, gap: 0 } : n <= 3 ? { w: 6, h: 14, gap: 13 } : { w: 5.5, h: 13, gap: 11 }
}

interface Mark {
    svg: SVGSVGElement
    all: SVGGElement
    top: SVGGElement
    topIdle: SVGPathElement
    topCake: SVGPathElement
    mid: SVGGElement
    midIdle: SVGPathElement
    midCake: SVGPathElement
    hole: SVGPathElement
    frost: SVGPathElement[]
    candles: SVGGElement[]
    flames: SVGGElement[]
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

// Deterministic PRNG so every play looks the same.
function rng(seed: number): () => number {
    return () => {
        seed |= 0
        seed = seed + 0x6D2B79F5 | 0
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

function f(n: number): string {
    return (Math.round(n * 100) / 100).toString()
}

// A frosting band on a tier's top edge with scalloped drips. The tier narrows 0.577 units per unit down.
function frostPath(hw: number, y: number): string {
    const n = Math.max(3, Math.round(hw / 9))
    const x0 = -hw + 0.6
    const x1 = hw - 0.6
    const step = (x1 - x0) / n
    let d = 'M' + f(-hw - 0.4) + ' ' + f(y - 0.8) + 'H' + f(hw + 0.4) + 'L' + f(x1 - 1.6) + ' ' + f(y + 3)
    for (let i = n - 1; i >= 0; i--) {
        const a = x0 + (i + 1) * step
        const b = x0 + i * step
        const depth = i % 2 ? 4.2 : 6
        d += 'C' + f(a - step * 0.1) + ' ' + f(y + depth) + ' ' + f(b + step * 0.1) + ' ' + f(y + depth) + ' ' + f(b) + ' ' + f(y + 2.6)
    }
    return d + 'Z'
}

function buildMark(uid: string, candles: number): Mark {
    const id = uid + '-an'
    const svg = svgEl('svg', { viewBox: VIEWBOX, class: 'rt-an-mark', 'aria-hidden': 'true', focusable: 'false' })
    const defs = svgEl('defs', {}, svg)
    const cg = svgEl('linearGradient', { id: id + '-core' }, defs)
    svgEl('stop', { offset: '0', 'stop-color': '#00a1ad' }, cg)
    svgEl('stop', { offset: '1', 'stop-color': '#587bff' }, cg)
    const wg = svgEl('linearGradient', { id: id + '-warm' }, defs)
    svgEl('stop', { offset: '0', class: 'rt-an-w0' }, wg)
    svgEl('stop', { offset: '1', class: 'rt-an-w1' }, wg)
    const sg = svgEl('linearGradient', { id: id + '-sponge', x1: '0', y1: '0', x2: '0', y2: '1' }, defs)
    svgEl('stop', { offset: '0', class: 'rt-an-s0' }, sg)
    svgEl('stop', { offset: '1', class: 'rt-an-s1' }, sg)

    // Back to front: top tier (core), middle tier (mid), bottom tier (frame + filled hole).
    const all = svgEl('g', { class: 'rt-an-all' }, svg)
    const top = svgEl('g', { class: 'rt-an-top' }, all)
    const topIdle = svgEl('path', { class: 'rt-an-top-idle', fill: 'url(#' + id + '-core)', d: CORE }, top)
    const topCake = svgEl('path', { class: 'rt-an-top-cake', fill: 'url(#' + id + '-warm)', d: CORE }, top)
    const mid = svgEl('g', { class: 'rt-an-mid' }, all)
    const midIdle = svgEl('path', { class: 'rt-an-ink rt-an-mid-idle', d: MID }, mid)
    const midCake = svgEl('path', { class: 'rt-an-mid-cake', fill: 'url(#' + id + '-sponge)', d: MID }, mid)
    const hole = svgEl('path', { class: 'rt-an-hole', fill: 'url(#' + id + '-core)', d: HOLE }, all)
    svgEl('path', { class: 'rt-an-ink', 'fill-rule': 'evenodd', d: FRAME }, all)

    const frost = svgEl('g', { class: 'rt-an-frost' }, all)
    const frostMid = svgEl('path', { class: 'rt-an-frost-a', d: frostPath(MID_T.hw, MID_T.top) }, frost)
    frostMid.style.transformOrigin = '0 ' + MID_T.top + 'px'
    const frostTop = svgEl('path', { class: 'rt-an-frost-a', d: frostPath(CORE_T.hw, CORE_T.top) }, frost)
    frostTop.style.transformOrigin = '0 ' + CORE_T.top + 'px'

    const candleGroups: SVGGElement[] = []
    const flames: SVGGElement[] = []
    const CANDLE = candleSpec(candles)
    const cg2 = svgEl('g', { class: 'rt-an-candles' }, all)
    for (let i = 0; i < candles; i++) {
        const x = (i - (candles - 1) / 2) * CANDLE.gap
        const y0 = CORE_T.top - 0.5
        const c = svgEl('g', { class: 'rt-an-candle rt-an-candle-' + (i % 3) }, cg2)
        c.style.transformOrigin = f(x) + 'px ' + f(y0) + 'px'
        svgEl('rect', { x: f(x - CANDLE.w / 2), y: f(y0 - CANDLE.h), width: CANDLE.w, height: CANDLE.h, rx: '1.2' }, c)
        svgEl('path', { class: 'rt-an-candle-stripe', d: 'M' + f(x - CANDLE.w / 2) + ' ' + f(y0 - 4) + 'l' + CANDLE.w + ' -3.2v2.4l-' + CANDLE.w + ' 3.2Z' }, c)
        const fl = svgEl('g', { class: 'rt-an-flame' }, all)
        const fy = y0 - CANDLE.h - 1
        fl.style.transformOrigin = f(x) + 'px ' + f(fy) + 'px'
        svgEl('path', { class: 'rt-an-flame-o', d: 'M' + f(x) + ' ' + f(fy) + 'c-3.4 0-4-3.9 0-10.5c4 6.6 3.4 10.5 0 10.5Z' }, fl)
        svgEl('path', { class: 'rt-an-flame-i', d: 'M' + f(x) + ' ' + f(fy - 0.8) + 'c-1.5 0-1.8-1.8 0-4.6c1.8 2.8 1.5 4.6 0 4.6Z' }, fl)
        candleGroups.push(c)
        flames.push(fl)
    }
    return { svg, all, top, topIdle, topCake, mid, midIdle, midCake, hole, frost: [frostMid, frostTop], candles: candleGroups, flames }
}

function build(ctx: SceneContext): SceneInstance {
    const n = Math.max(1, ctx.year - 2026)
    const candles = Math.min(n, 5)
    let anims: Animation[] = []
    let added: HTMLElement[] = []
    const roots: Element[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let stageAnims: Animation[] = []
    let timers: number[] = []

    let mark: Mark | null = null
    if (ctx.markSlot) {
        mark = buildMark(ctx.uid, candles)
        ctx.markSlot.appendChild(mark.svg)
        roots.push(mark.svg)
    }

    const layer = htmlEl('div', 'rt-an-stage', ctx.stage)
    layer.setAttribute('aria-hidden', 'true')
    added.push(layer)
    roots.push(layer)
    const bits: HTMLElement[] = []
    const R = rng(921)
    for (let i = 0; i < CONFETTI; i++) {
        bits.push(htmlEl('i', 'rt-an-bit rt-an-bit-' + (i % 5) + (R() < 0.3 ? ' rt-an-dot' : ''), layer))
    }

    // Before the first anniversary the text is empty and no greeting is shown.
    const text = anniversaryText(ctx.year)
    const greet: HTMLElement | null = text ? ctx.showGreeting({ text, shortText: anniversaryOrdinal(ctx.year) }) : null

    function pose(p: string): void {
        for (const r of roots) r.setAttribute('data-rt-pose', p)
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
        stageAnims = []
        for (const t of timers) ctx.clearTimeout(t)
        timers = []
    }

    function confetti(): void {
        const W = ctx.stageWidth()
        const box = ctx.stageBox()
        const H = box.height ? box.height : (ctx.stage.getBoundingClientRect().height || 96)
        const off = ctx.stageOffset()
        const ms = ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 32
        // Burst from the top tier's candles: (0, -78) in mark units (after the 8-unit shift).
        const ox = off.markX + ms / 2
        const oy = Math.max(3, off.markY + ms * ((-78 + 66) / 146))
        const Rb = rng(2027)
        const clampX = (x: number): number => Math.max(2, Math.min(W - 6, x))
        // Pieces fall no lower than the first header row (word bottom + 20 px): never over the phone's mode switcher.
        const wr = ctx.word.getBoundingClientRect()
        const floor = Math.min(H - 6, off.wordY + wr.height + 20)
        const clampY = (y: number): number => Math.max(2, Math.min(floor, y))
        const wordL = off.wordX
        const wordT = off.wordY
        const wordR = wordL + wr.width
        bits.forEach((bit) => {
            // Mostly up and to the right: the mark sits at the stage's left edge. The stage has only ~12 px above the
            // mark, so the burst fans out sideways and rains down over the bar.
            const ang = (-150 + Rb() * 140) * Math.PI / 180
            const d = 30 + Rb() * 60
            let px = clampX(ox + Math.cos(ang) * d * 1.6)
            let py = clampY(oy - 2 - Rb() * Math.max(2, oy - 4) + Math.max(0, Math.cos(ang)) * Rb() * 18)
            const ex = clampX(px + (Rb() - 0.3) * 36)
            let ey = clampY(py + Math.max(8, floor - py) * (0.5 + 0.5 * Rb()))
            // Keep the confetti off the word box: over the word it flutters in the strip above it and fades there.
            const overWord = (x: number): boolean => x > wordL - 4 && x < wordR + 4
            if (overWord(px) || overWord(ex)) {
                py = Math.min(py, wordT - 3)
                ey = Math.max(py + 1, Math.min(ey, wordT - 2))
            }
            const r1 = Math.round((Rb() - 0.5) * 360)
            const r2 = r1 + Math.round((Rb() - 0.5) * 540)
            const dur = 1500 + Rb() * 500
            const delay = 3600 + Rb() * 120
            const t = (x: number, y: number, r: number, sc: number): string => 'translate(' + f(x) + 'px,' + f(y) + 'px) rotate(' + r + 'deg) scale(' + sc + ')'
            stageAnims.push(run(bit, [
                { transform: t(ox, oy, 0, 0.3), opacity: 0, easing: 'cubic-bezier(.15,.75,.35,1)' },
                { offset: 0.06, opacity: 1 },
                { offset: 0.36, transform: t(px, py, r1, 1), easing: 'cubic-bezier(.45,0,.75,.6)' },
                { offset: 0.8, opacity: 1 },
                { transform: t(ex, ey, r2, 0.9), opacity: 0 },
            ], { duration: dur, delay }))
        })
    }

    // Rebuilds the confetti against the current stage box at the same timeline point.
    function restage(): void {
        if (state !== 'playing' || !stageAnims.length) return
        const elapsed = Number(stageAnims[0].currentTime) || 0
        const paused = stageAnims[0].playState === 'paused'
        for (const a of stageAnims) {
            a.cancel()
            const i = anims.indexOf(a)
            if (i >= 0) anims.splice(i, 1)
        }
        stageAnims = []
        confetti()
        for (const a of stageAnims) {
            a.currentTime = elapsed
            if (paused) a.pause()
        }
    }
    ctx.onRelayout(restage)

    function timeline(): void {
        const settleEase = 'cubic-bezier(.5,0,.2,1)'
        if (mark) {
            // 1. The tiers slide up out of the frame and grow; their colours turn from idle to cake on the way.
            run(mark.mid, [
                { transform: 'translate(0px,0px) scale(1)' },
                { offset: 0.8, transform: 'translate(0px,' + f(MID_T.dy - 2.5) + 'px) scale(' + f(MID_T.k) + ')' },
                { transform: 'translate(0px,' + f(MID_T.dy) + 'px) scale(' + f(MID_T.k) + ')' },
            ], { duration: 1100, delay: 300, easing: settleEase })
            run(mark.top, [
                { transform: 'translate(0px,0px) scale(1)' },
                { offset: 0.8, transform: 'translate(0px,' + f(CORE_T.dy - 3) + 'px) scale(' + f(CORE_T.k) + ')' },
                { transform: 'translate(0px,' + f(CORE_T.dy) + 'px) scale(' + f(CORE_T.k) + ')' },
            ], { duration: 1250, delay: 450, easing: settleEase })
            run(mark.midCake, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 500, easing: 'ease-in-out' })
            run(mark.midIdle, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 500, easing: 'ease-in-out' })
            run(mark.topCake, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 700, easing: 'ease-in-out' })
            run(mark.topIdle, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 700, easing: 'ease-in-out' })
            run(mark.hole, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 500, easing: 'ease-out' })
            run(mark.all, [{ transform: 'translate(0px,0px)' }, { transform: 'translate(0px,' + SHIFT + 'px)' }], { duration: 1250, delay: 450, easing: settleEase })
            // 2. Frosting sets from each tier's top edge.
            mark.frost.forEach((p, i) => {
                run(p, [{ transform: 'scale(1,0)', opacity: 0 }, { offset: 0.4, opacity: 1 }, { transform: 'scale(1,1)', opacity: 1 }],
                    { duration: 450, delay: 1600 + i * 120, easing: 'cubic-bezier(.2,.8,.3,1)' })
            })
            // 3. Candles rise, then light one by one with a single flicker each.
            mark.candles.forEach((c, i) => {
                run(c, [{ transform: 'scale(1,0)', opacity: 0 }, { offset: 0.3, opacity: 1 }, { transform: 'scale(1,1)', opacity: 1 }],
                    { duration: 340, delay: 2100 + i * 100, easing: 'cubic-bezier(.2,.8,.3,1.2)' })
            })
            mark.flames.forEach((fl, i) => {
                run(fl, [
                    { transform: 'scale(0.2)', opacity: 0 },
                    { offset: 0.35, transform: 'scale(1.3,1.15)', opacity: 1 },
                    { offset: 0.6, transform: 'scale(0.85,1.05)' },
                    { offset: 0.8, transform: 'scale(1.08,0.97)' },
                    { transform: 'scale(1)', opacity: 1 },
                ], { duration: 520, delay: 2800 + i * 90, easing: 'ease-out' })
            })
        }
        // 4. One confetti burst.
        confetti()
        // 5. The greeting link fades and scales in (opacity 0 -> 1, scale 0.96 -> 1, 4 px rise).
        if (greet) {
            run(greet, [
                { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
                { opacity: 1, transform: 'translateY(0px) scale(1)' },
            ], { duration: 700, delay: 4600, easing: 'cubic-bezier(.2,.7,.3,1)' })
        }
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
        pose('final')
        settle()
    }

    return {
        play() {
            if (state !== 'built') return Promise.resolve()
            state = 'playing'
            pose('play')
            timeline()
            return new Promise<void>((resolve) => {
                resolvePlay = resolve
                // A pausable timer, since restage() may replace the confetti animations mid-play.
                later(() => { if (state === 'playing') finish() }, 6500)
                // Re-aim the burst just before it fires, for layouts that change without a relayout signal.
                later(restage, 3500)
            })
        },
        finish,
        destroy() {
            cancelAll()
            state = 'destroyed'
            if (mark && mark.svg.parentNode) mark.svg.parentNode.removeChild(mark.svg)
            for (const node of added) if (node.parentNode) node.parentNode.removeChild(node)
            added = []
            settle()
        },
    }
}

const scene: SceneDef = { key: 'anniversary', durationMs: DURATION, build }
export default scene
