// Seasonal scene: christmas (Dec 19-25).
//
// Storyboard (7.0 s): snowfall 0-6.0 s (24 flakes); a pale moon 0.2-6.2 s and one sleigh crossing 2.3-4.9 s (moon only
// when the stage has room right of the word); the idle mark flips (scaleY 1 to -1) into a tree 0.9-1.9 s; trunk and
// ornaments pop 2.0-3.1 s; the star drops onto the apex 3.1-3.8 s with one sparkle; the Santa hat drops onto the final
// "m" 4.2-5.2 s. Final: tree mark with star, hat on the word.
// Only transform and opacity are animated (Web Animations API). No filters, no loops.
//
// The hat is the hidden 5-tap game button: ctx.attachGame moves it into the over-layer and makes it a button. The game
// panel's target is the same hat art, passed as markup with a __UID__ placeholder the host replaces.
import './christmas.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const SVG_NS = 'http://www.w3.org/2000/svg'
// Mark geometry (centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
const VIEWBOX = '-73 -66 146 146'

const DURATION = 7000
const FLAKES = 24
// Ornaments in final (upright) mark units: [cx, cy, r, colour class]. All on the green frame band.
const ORNAMENTS: ReadonlyArray<readonly [number, number, number, string]> = [
    [-36, 24, 6.5, 'r'], [0, 25.5, 6.5, 'g'], [36, 24, 6.5, 'c'],
    [-19, -11, 5.5, 'g'], [23, -3, 5.5, 'r'],
]
// The star sits on the upright apex (0, -64.49).
const STAR_C = [0, -67] as const
// Sleigh and two reindeer, heading left. viewBox 64x18, filled with currentColor.
const SLEIGH = '<svg viewBox="0 0 64 18" aria-hidden="true" focusable="false"><g fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="10" cy="9" rx="5.6" ry="2.5" stroke="none"/><path d="M5.6 8.4L3.3 4.8" stroke-width="1.9" fill="none"/><circle cx="2.9" cy="4.2" r="1.6" stroke="none"/>' +
    '<path d="M3.5 3L4.6 0.8M4.1 1.9L5.8 1.5M2.4 3L1.6 0.9" stroke-width="0.8" fill="none"/><path d="M7 10.6L4.9 13.8M13.4 10.4L15.8 13.4M8.6 10.9L8 14M12 10.9L13 14" stroke-width="1.1" fill="none"/>' +
    '<ellipse cx="25" cy="8.4" rx="5.6" ry="2.5" stroke="none"/><path d="M20.6 7.8L18.3 4.2" stroke-width="1.9" fill="none"/><circle cx="17.9" cy="3.6" r="1.6" stroke="none"/>' +
    '<path d="M18.5 2.4L19.6 0.3M19.1 1.3L20.8 0.9M17.4 2.4L16.6 0.4" stroke-width="0.8" fill="none"/><path d="M22 10L19.9 13.2M28.4 9.8L30.8 12.8M23.6 10.3L23 13.4M27 10.3L28 13.4" stroke-width="1.1" fill="none"/>' +
    '<path d="M15.5 8.6Q21 9.6 30.5 8.2Q35 9.4 39 9.6" stroke-width="0.6" fill="none"/>' +
    '<circle cx="46.5" cy="4.6" r="2.7" stroke="none"/><circle cx="53.4" cy="5" r="3.1" stroke="none"/>' +
    '<path d="M38.5 6.6H55.5C58.6 6.6 59.6 9.6 58.6 12.4H42.2C39.8 12.4 38.6 10.4 38.5 6.6Z" stroke="none"/>' +
    '<path d="M37.2 15H58C60.4 15 61.8 13.8 62 12.2M43 12.6V15M55 12.6V15" stroke-width="1.2" fill="none"/></g></svg>'

interface RunOptions extends KeyframeAnimationOptions {
    /** Moves `easing` onto each keyframe (a keyframe's own easing wins) and keeps the effect linear, so offsets are real times. */
    segment?: boolean
}

interface Mark {
    svg: SVGSVGElement
    flip: SVGGElement
    brand: SVGGElement
    tree: SVGGElement
    trunk: SVGGElement
    orns: SVGGElement[]
    star: SVGGElement
    spark: SVGGElement
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

function starPath(cx: number, cy: number, R: number, r: number): string {
    let d = ''
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5
        const rad = i % 2 ? r : R
        d += (i ? 'L' : 'M') + (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2)
    }
    return d + 'Z'
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

// The Santa hat (viewBox 64x48, anchor brim bottom centre 30,44). Also used, with the host's __UID__ placeholder as the
// id prefix, as the game panel's target.
function hatSvg(id: string): string {
    return '<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false">' +
        '<defs><linearGradient id="' + id + '-hb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0434a"/><stop offset="1" stop-color="#b8142a"/></linearGradient></defs>' +
        '<g class="rt-xm-hat-body"><path d="M10 37C10.5 22 20 9 34 8C44 7.4 51 11.5 55.5 19L51.6 21.6C48.4 17.6 43.6 17.4 41.6 21C45 27 48 32 50 37Z" fill="url(#' + id + '-hb)" stroke="#6e0b18" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M17 33C17.6 23 23 14.5 31 12.4" fill="none" stroke="#ff8a8f" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/></g>' +
        '<g class="rt-xm-hat-brim"><rect x="7" y="33" width="46" height="11" rx="5.5" fill="#f6f7fb" stroke="#7d8597" stroke-width="1.1"/>' +
        '<path d="M12 39.5H48" fill="none" stroke="#d6dae4" stroke-width="1.4" stroke-linecap="round"/></g>' +
        '<g class="rt-xm-hat-pom"><circle cx="55" cy="21.5" r="5.6" fill="#f6f7fb" stroke="#7d8597" stroke-width="1.1"/><circle cx="53.3" cy="19.8" r="1.6" fill="#fff"/></g>' +
        '</svg>'
}

function buildMark(uid: string): Mark {
    const id = uid + '-xm'
    const svg = svgEl('svg', { viewBox: VIEWBOX, class: 'rt-xm-mark', 'aria-hidden': 'true', focusable: 'false' })
    const defs = svgEl('defs', {}, svg)
    const cg = svgEl('linearGradient', { id: id + '-core' }, defs)
    svgEl('stop', { offset: '0', 'stop-color': '#00a1ad' }, cg)
    svgEl('stop', { offset: '1', 'stop-color': '#587bff' }, cg)
    // Drawn pointing down; after the flip y1=1 (the drawn bottom) is the tree's top.
    const gg = svgEl('linearGradient', { id: id + '-green', x1: '0', y1: '1', x2: '0', y2: '0' }, defs)
    svgEl('stop', { offset: '0', class: 'rt-xm-g0' }, gg)
    svgEl('stop', { offset: '1', class: 'rt-xm-g1' }, gg)

    const trunk = svgEl('g', { class: 'rt-xm-trunk' }, svg)
    svgEl('rect', { x: '-7', y: '30.5', width: '14', height: '11.5', rx: '1.5' }, trunk)

    const flip = svgEl('g', { class: 'rt-xm-flip' }, svg)
    const brand = svgEl('g', { class: 'rt-xm-brand' }, flip)
    svgEl('path', { class: 'rt-xm-ink', 'fill-rule': 'evenodd', d: FRAME }, brand)
    svgEl('path', { class: 'rt-xm-ink', d: MID }, brand)
    svgEl('path', { fill: 'url(#' + id + '-core)', d: CORE }, brand)
    const tree = svgEl('g', { class: 'rt-xm-tree' }, flip)
    svgEl('path', { class: 'rt-xm-tree-hole', d: HOLE }, tree)
    svgEl('path', { class: 'rt-xm-tree-frame', fill: 'url(#' + id + '-green)', 'fill-rule': 'evenodd', d: FRAME }, tree)
    svgEl('path', { class: 'rt-xm-tree-mid', d: MID }, tree)
    svgEl('path', { fill: 'url(#' + id + '-core)', d: CORE }, tree)

    const orns: SVGGElement[] = []
    const og = svgEl('g', { class: 'rt-xm-orns' }, svg)
    for (const o of ORNAMENTS) {
        const g = svgEl('g', { class: 'rt-xm-orn rt-xm-orn-' + o[3] }, og)
        g.style.transformOrigin = o[0] + 'px ' + o[1] + 'px'
        svgEl('circle', { cx: o[0], cy: o[1], r: o[2] }, g)
        svgEl('circle', { class: 'rt-xm-orn-hi', cx: o[0] - o[2] * 0.35, cy: o[1] - o[2] * 0.35, r: o[2] * 0.32 }, g)
        orns.push(g)
    }

    const spark = svgEl('g', { class: 'rt-xm-spark' }, svg)
    spark.style.transformOrigin = STAR_C[0] + 'px ' + STAR_C[1] + 'px'
    svgEl('path', { d: 'M0-92V-86M-27-67H-21M21-67H27M-18-85L-14-81M18-85L14-81' }, spark)
    const star = svgEl('g', { class: 'rt-xm-star' }, svg)
    star.style.transformOrigin = STAR_C[0] + 'px ' + STAR_C[1] + 'px'
    svgEl('path', { d: starPath(STAR_C[0], STAR_C[1], 17, 7.6) }, star)

    return { svg, flip, brand, tree, trunk, orns, star, spark }
}

function build(ctx: SceneContext): SceneInstance {
    let anims: Animation[] = []
    let added: HTMLElement[] = []
    const roots: Element[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let stageAnims: Animation[] = []
    let timers: number[] = []

    let mark: Mark | null = null
    if (ctx.markSlot) {
        mark = buildMark(ctx.uid)
        ctx.markSlot.appendChild(mark.svg)
        roots.push(mark.svg)
    }

    const snow = htmlEl('div', 'rt-xm-snow', ctx.stage)
    snow.setAttribute('aria-hidden', 'true')
    added.push(snow)
    roots.push(snow)
    const flakes: HTMLElement[] = []
    // Mostly soft round dots, with every sixth flake a small six-armed snowflake.
    for (let i = 0; i < FLAKES; i++) flakes.push(htmlEl('i', 'rt-xm-flake' + (i % 6 === 5 ? ' rt-xm-flake--star' : ''), snow))
    // A pale moon and a tiny sleigh crossing once.
    const moon = htmlEl('i', 'rt-xm-moon', snow)
    htmlEl('i', 'rt-xm-crater rt-xm-crater-a', moon)
    htmlEl('i', 'rt-xm-crater rt-xm-crater-b', moon)
    const sleigh = htmlEl('i', 'rt-xm-sleigh', snow)
    sleigh.innerHTML = SLEIGH

    const hat = htmlEl('span', 'rt-xm-hat')
    const drop = htmlEl('span', 'rt-xm-hat-drop', hat)
    drop.innerHTML = hatSvg(ctx.uid + '-xmh')
    ctx.attachGame(hat, { targetSvg: hatSvg('__UID__') })
    added.push(hat)
    roots.push(hat)

    function pose(p: string): void {
        for (const r of roots) r.setAttribute('data-rt-pose', p)
    }
    pose('pre')

    function run(el: Element, frames: Keyframe[], opts: RunOptions): Animation {
        const { segment, ...rest } = opts
        const o: KeyframeAnimationOptions = { fill: 'both', easing: 'linear', ...rest }
        let fr = frames
        if (segment && frames.length > 2 && o.easing !== 'linear') {
            const ez = o.easing
            o.easing = 'linear'
            fr = frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing: ez }))
        }
        const a = el.animate(fr, o)
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
    function runStage(el: Element, frames: Keyframe[], opts: RunOptions): void {
        stageAnims.push(run(el, frames, opts))
    }

    // Stage layers (moon, sleigh, snow) depend on the stage box, so they can be rebuilt mid-play (restage()).
    function stageTimeline(): void {
        const W = ctx.stageWidth()
        const box = ctx.stageBox()
        const H = box.height ? box.height : (ctx.stage.getBoundingClientRect().height || 96)
        const R = rng(1225)
        // Moon and sleigh: right of the word when there is room, otherwise the sleigh alone crosses the top strip.
        const off = ctx.stageOffset()
        const wr = ctx.word.getBoundingClientRect()
        const wordX = off.wordX
        const wordY = off.wordY
        const wordR = wordX + wr.width + 14 // clear the hat's pompom
        const free = W - wordR
        // Flakes settle within the first header row (word bottom + 20 px), never over the phone's wrapped mode switcher.
        const floor = Math.min(H - 4, wordY + wr.height + 20)
        const sw = 44
        const sh = sw * 18 / 64
        sleigh.style.width = sw + 'px'
        sleigh.style.height = sh.toFixed(1) + 'px'
        let sx0 = W + 4
        let sx1: number
        let sy: number
        if (free >= 46) {
            const mr = Math.min(17, free / 2 - 5)
            const mcx = wordR + free / 2
            const mcy = Math.min(34, wordY + wr.height / 2)
            moon.style.display = ''
            moon.style.width = moon.style.height = (mr * 2).toFixed(1) + 'px'
            moon.style.left = (mcx - mr).toFixed(1) + 'px'
            moon.style.top = (mcy - mr).toFixed(1) + 'px'
            runStage(moon, [
                { opacity: 0, transform: 'scale(0.9)', easing: 'cubic-bezier(.2,.7,.3,1)' },
                { offset: 0.16, opacity: 1, transform: 'scale(1)' },
                { offset: 0.84, opacity: 1, transform: 'scale(1)', easing: 'ease-in' },
                { opacity: 0, transform: 'scale(1)' },
            ], { duration: 6000, delay: 200 })
            // The dark silhouette crosses the moon only (it would vanish on a dark canvas elsewhere).
            sleigh.classList.remove('rt-xm-sleigh--lit')
            sy = mcy - sh / 2 - 2
            sx0 = mcx + mr - sw * 0.15
            sx1 = mcx - mr - sw * 0.85
        } else {
            moon.style.display = 'none'
            sleigh.classList.add('rt-xm-sleigh--lit') // no moon behind it: draw it pale so it reads on the dark canvas
            sy = Math.max(1, wordY - sh - 2)
            sx1 = wordX - sw - 10
        }
        runStage(sleigh, [
            { transform: 'translate(' + sx0.toFixed(1) + 'px,' + (sy + 3).toFixed(1) + 'px)', opacity: 0 },
            { offset: 0.12, opacity: 1 },
            { offset: 0.5, transform: 'translate(' + ((sx0 + sx1) / 2).toFixed(1) + 'px,' + (sy - 2).toFixed(1) + 'px)' },
            { offset: 0.82, opacity: 1 },
            { transform: 'translate(' + sx1.toFixed(1) + 'px,' + (sy - 4).toFixed(1) + 'px)', opacity: 0 },
        ], { duration: 2600, delay: 2300, easing: 'cubic-bezier(.35,.1,.65,.9)' })
        // 1. Snow: 24 flakes, every one settled (faded) by 6.0 s.
        flakes.forEach((f) => {
            const size = f.classList.contains('rt-xm-flake--star') ? 7 : 2 + Math.round(R() * 2.2)
            f.style.width = f.style.height = size + 'px'
            const x0 = 4 + R() * (W - 8)
            const yEnd = 0.5 * floor + R() * 0.5 * floor
            const a = 4 + R() * 8
            const dur = 3400 + R() * 1200
            const delay = Math.min(6000 - dur, R() * 1500)
            const x = (dx: number): string => Math.max(1, Math.min(W - size - 1, x0 + dx)).toFixed(1)
            runStage(f, [
                { transform: 'translate(' + x(0) + 'px,-6px)', opacity: 0 },
                { offset: 0.14, opacity: 0.95 },
                { offset: 0.35, transform: 'translate(' + x(a) + 'px,' + (yEnd * 0.35).toFixed(1) + 'px)' },
                { offset: 0.7, transform: 'translate(' + x(-a * 0.6) + 'px,' + (yEnd * 0.72).toFixed(1) + 'px)', opacity: 0.9 },
                { transform: 'translate(' + x(a * 0.3) + 'px,' + yEnd.toFixed(1) + 'px)', opacity: 0 },
            ], { duration: dur, delay, easing: 'cubic-bezier(.3,.1,.6,1)' })
        })
    }
    // Rebuilds the stage layers against the current stage box, at the same point of the timeline.
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
        stageTimeline()
        for (const a of stageAnims) {
            a.currentTime = elapsed
            if (paused) a.pause()
        }
    }
    ctx.onRelayout(restage)

    function timeline(): void {
        stageTimeline()
        if (mark) {
            // 2. Flip: scaleY 1 -> -1 about the centroid with a small overshoot. Easing per keyframe on a linear effect puts
            // edge-on at exactly offset 0.5 (1400 ms); the colour swap runs 0.49-0.51 while the mark is a sliver, so the
            // white everyday triangle never shows mid-flip.
            run(mark.flip, [
                { transform: 'scale(1,1)', easing: 'cubic-bezier(.45,0,.8,.55)' },
                { offset: 0.5, transform: 'scale(1.06,0.02)', easing: 'cubic-bezier(.2,.45,.35,1)' },
                { offset: 0.82, transform: 'scale(1,-1.07)', easing: 'ease-in-out' },
                { transform: 'scale(1,-1)' },
            ], { duration: 1000, delay: 900 })
            run(mark.brand, [{ opacity: 1 }, { offset: 0.49, opacity: 1 }, { offset: 0.51, opacity: 0 }, { opacity: 0 }], { duration: 1000, delay: 900 })
            run(mark.tree, [{ opacity: 0 }, { offset: 0.49, opacity: 0 }, { offset: 0.51, opacity: 1 }, { opacity: 1 }], { duration: 1000, delay: 900 })
            // 3. Trunk grows down from the base, then ornaments pop one by one.
            run(mark.trunk, [{ transform: 'scale(1,0)', opacity: 0 }, { offset: 0.3, opacity: 1 }, { transform: 'scale(1,1)', opacity: 1 }],
                { duration: 360, delay: 1950, easing: 'cubic-bezier(.2,.8,.2,1)', segment: true })
            mark.orns.forEach((g, i) => {
                run(g, [
                    { transform: 'scale(0)', opacity: 0 },
                    { offset: 0.6, transform: 'scale(1.3)', opacity: 1 },
                    { transform: 'scale(1)', opacity: 1 },
                ], { duration: 380, delay: 2150 + i * 140, easing: 'cubic-bezier(.2,.8,.3,1)', segment: true })
            })
            // 4. The star drops onto the apex, turning one point, with a single sparkle.
            run(mark.star, [
                { transform: 'translate(0px,-58px) rotate(-72deg)', opacity: 0 },
                { offset: 0.25, opacity: 1 },
                { offset: 0.72, transform: 'translate(0px,3px) rotate(4deg)', opacity: 1 },
                { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1 },
            ], { duration: 700, delay: 3100, easing: 'cubic-bezier(.5,0,.4,1)', segment: true })
            run(mark.spark, [
                { transform: 'scale(0.4)', opacity: 0 },
                { offset: 0.35, opacity: 1 },
                { transform: 'scale(1.25)', opacity: 0 },
            ], { duration: 520, delay: 3620, easing: 'cubic-bezier(.2,.7,.3,1)', segment: true })
        }
        // 5. The hat drops onto the final "m" and settles with one wobble about the brim.
        run(drop, [
            { transform: 'translateY(-2.2em) rotate(-14deg)', opacity: 0 },
            { offset: 0.2, opacity: 1 },
            { offset: 0.55, transform: 'translateY(0.08em) rotate(7deg)', opacity: 1 },
            { offset: 0.78, transform: 'translateY(-0.12em) rotate(-3deg)' },
            { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        ], { duration: 1000, delay: 4200, easing: 'cubic-bezier(.4,0,.3,1)', segment: true })
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
            const usedW = ctx.stageWidth()
            return new Promise<void>((resolve) => {
                resolvePlay = resolve
                later(() => { if (state === 'playing') finish() }, DURATION)
                // Re-check the stage once the header has settled, for layouts that change without a relayout signal.
                later(() => {
                    const W = ctx.stageWidth()
                    if (W && Math.abs(W - usedW) > 1) restage()
                }, 300)
            })
        },
        finish,
        destroy() {
            cancelAll()
            state = 'destroyed'
            if (mark && mark.svg.parentNode) mark.svg.parentNode.removeChild(mark.svg)
            for (const n of added) if (n.parentNode) n.parentNode.removeChild(n)
            added = []
            settle()
        },
    }
}

const scene: SceneDef = { key: 'christmas', durationMs: DURATION, build }
export default scene
