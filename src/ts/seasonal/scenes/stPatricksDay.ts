// Seasonal scene: stPatricksDay (Mar 17; en, de, es).
//
// Storyboard (6.8 s budget, the scene clock ends at 6.6 s): a rainbow of three touching bands sweeps over the word 0.3-1.9 s
// (fades 3.3-4.2 s) while eight clovers drift left to right 0.25-4.2 s; the everyday mark gives way to an emerald frame and a
// mint inner triangle 1.8-2.4 s, the vertices round out into three leaves 2.2-3.5 s, a gold coin spins into the core 2.95-3.65 s,
// a gold stem draws 3.5-4.15 s, the coin glints 4.25-4.75 s and the shamrock sways once 4.3-5.0 s; "Risu" crossfades to
// emerald-cyan 4.9-5.6 s and a small shamrock drops above its "u" 5.0-5.65 s.
// Final: emerald shamrock mark with gold stem and coin, emerald-cyan "Risu" with the shamrock on the "u", no sky.
// No fonts. Motion is Web Animations only: transform and opacity (plus stroke-dashoffset on the bands and the stem, and one
// ::after opacity). No filters, no loops. The final pose is static CSS under .rt-sp-final, so finish() gives the same pose
// from any point.
import './stPatricksDay.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe of the scene clock ends at 6600 ms.
const DURATION = 6800
const CLOCK = 6600
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Heart-shaped clover leaf, point at the origin, lobes up (-y), 9.2 wide and 8.4 long.
const LEAF = 'M0 0C-1-1.5-4.6-3.2-4.6-5.6C-4.6-7.4-3.3-8.4-2.1-8.4C-1-8.4-.3-7.7 0-6.9C.3-7.7 1-8.4 2.1-8.4' +
    'C3.3-8.4 4.6-7.4 4.6-5.6C4.6-3.2 1-1.5 0 0Z'
const RIB = 'M0-.8V-6.4'
// Mark leaves: one at each vertex of the frame, point toward the centroid (r = 21), lobes on the vertex (r = 62).
const MARK_LEAVES = [
    { rot: -60, ux: -0.866, uy: -0.5 },
    { rot: 60, ux: 0.866, uy: -0.5 },
    { rot: 180, ux: 0, uy: 1 },
]
const LEAF_R0 = 21
const LEAF_SCALE = 4.9
// Gold stem from the centre out through the free sector between the lower and top-right leaves, ending in a curl.
const STEM = 'M7 4C19 10 32 17 42 26C47 31 49 37 45 41'

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

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

// Small upright shamrock (viewBox 0 0 20 20) for the drifting clovers and the one tucked on the "u".
function cloverMarkup(cls: string): string {
    let c = ''
    for (const r of [0, 120, 240]) {
        c += '<g transform="translate(10 9.6) rotate(' + r + ') scale(1.02)"><path class="' + cls + '-leaf" d="' + LEAF + '"/><path class="' + cls + '-rib" d="' + RIB + '"/></g>'
    }
    return '<path class="' + cls + '-stem" d="M10 10.4C10.4 13.4 11.6 16.2 13.2 18.6"/>' + c
}

function sid(uid: string): string {
    return 'rt-sp-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('stPatricksDay: svg markup did not parse')
    return n
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

function markMarkup(id: string): string {
    let leaves = ''
    MARK_LEAVES.forEach((l, i) => {
        leaves += '<g transform="translate(' + (l.ux * LEAF_R0).toFixed(2) + ' ' + (l.uy * LEAF_R0).toFixed(2) + ') rotate(' + l.rot + ') scale(' + LEAF_SCALE + ')">' +
            '<g class="rt-sp-leaf" id="' + id + '-leaf' + (i + 1) + '"><path fill="url(#' + id + '-leafgrad)" class="rt-sp-leafbody" d="' + LEAF + '"/>' +
            '<path class="rt-sp-rib" d="' + RIB + '"/></g></g>'
    })
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-leafgrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" class="rt-sp-l0"/><stop offset="1" class="rt-sp-l1"/></linearGradient>' +
        '<linearGradient id="' + id + '-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#d97706"/></linearGradient>' +
        '</defs>' +
        '<g class="rt-sp-sway" id="' + id + '-sway">' +
            '<g class="rt-sp-every" id="' + id + '-every">' +
                '<path class="rt-sp-ink rt-sp-every-frame" fill-rule="evenodd" d="' + FRAME + '"/>' +
                '<g class="rt-sp-every-inner"><path class="rt-sp-ink" d="' + MID + '"/><path fill="url(#' + id + '-core)" d="' + CORE + '"/></g>' +
            '</g>' +
            '<path class="rt-sp-frame" id="' + id + '-frame" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-sp-mid" id="' + id + '-mid" d="' + MID + '"/>' +
            '<path class="rt-sp-stem" id="' + id + '-stem" stroke="url(#' + id + '-gold)" d="' + STEM + '"/>' +
            leaves +
            '<g class="rt-sp-coin" id="' + id + '-coin">' +
                '<circle r="7.6" fill="url(#' + id + '-gold)" class="rt-sp-coinface"/>' +
                '<path class="rt-sp-coinmark" d="' + CORE + '" transform="translate(0 -1.4) scale(.62)"/>' +
            '</g>' +
            '<g transform="translate(-4.6 -5.2) scale(5)"><path class="rt-sp-glint" id="' + id + '-glint" d="M0-1C.12-.3.3-.12 1 0C.3.12.12.3 0 1C-.12.3-.3.12-1 0C-.3-.12-.12-.3 0-1Z"/></g>' +
        '</g>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: rainbow bands and drifting clovers (rebuilt from the live geometry) -----
    const sky = el('div', 'rt-sp-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const bowHost = el('div', 'rt-sp-bowhost', sky)
    const clovers: HTMLElement[] = []
    for (let c = 0; c < 8; c++) {
        const cw = el('div', 'rt-sp-drift', sky)
        cw.id = id + '-clover' + (c + 1)
        cw.appendChild(svgFrom(cloverMarkup('rt-sp-c'), 'rt-sp-driftsvg', '0 0 20 20'))
        clovers.push(cw)
    }
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-sp-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: "Risu" turns emerald-cyan; a small shamrock tucked above the "u" of Risu -----
    const word = ctx.word
    word.classList.add('rt-sp-word')
    const risu = findLeafSpan(word, 'Risu')
    if (risu) {
        risu.classList.add('rt-sp-risu')
        risu.setAttribute('data-rt-sp-text', 'Risu')
    }
    const tuck = el('span', 'rt-sp-tuck', word)
    tuck.id = id + '-tuck'
    tuck.setAttribute('aria-hidden', 'true')
    const tuckIn = el('span', 'rt-sp-tuckin', tuck)
    tuckIn.appendChild(svgFrom(cloverMarkup('rt-sp-t'), 'rt-sp-tucksvg', '0 0 20 20'))

    ctx.setDescription('Happy St. Patrick’s Day!', 'en')

    function placeTuck(): void {
        // Centre of the "u" of Risu in em from the word box's left edge (estimate when it cannot be measured).
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 2.0
        if (risu && risu.firstChild) {
            try {
                const r = document.createRange()
                r.setStart(risu.firstChild, 3)
                r.setEnd(risu.firstChild, 4)
                const gr = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (gr.width > 0) x = (gr.left + gr.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        tuck.style.setProperty('--rt-sp-ux', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeTuck()
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
        sky.classList.toggle('rt-sp-final', on)
        mark?.classList.toggle('rt-sp-final', on)
        word.classList.toggle('rt-sp-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeTuck()
        setFinal(true)
        state = 'final'
        settle()
    }
    // With more than two keyframes the easing goes on each keyframe (segment) and the effect stays linear, so every keyframe
    // offset is a real time (delay + offset x duration). A keyframe's own easing wins.
    function add(node: Element | null, frames: Keyframe[], o: AddOptions, pseudo?: string): Animation | null {
        if (!node || !node.animate) return null
        const ease = o.ease || 'linear'
        const perSegment = frames.length > 2 && ease !== 'linear'
        const list = perSegment
            ? frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing: ease }))
            : frames
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: perSegment ? 'linear' : ease, fill: 'both' }
        if (pseudo) opts.pseudoElement = pseudo
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
        const ms = off.markSize ? off.markSize : (ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 28)
        const cx = ctx.markSlot ? off.markX + ms / 2 : off.wordX - 20
        const cy = ctx.markSlot ? off.markY + ms / 2 : off.wordY + off.wordHeight / 2
        return { W, H, cx, cy, ms, wx: off.wordX, wy: off.wordY, ww: off.wordWidth, wh: off.wordHeight, wrapped: box.wrapped }
    }

    // Rainbow: three parallel bands on one cubic arc from above the mark, over the word, to the right. Where the stage has
    // room right of the word it lands near the stage bottom (allowed during play); otherwise it stays in the band above the
    // word and leaves through the right edge.
    function buildBow(g: Geom): SVGSVGElement {
        bowHost.textContent = ''
        const sx = g.cx + g.ms * 0.1
        const sy = g.cy - g.ms * 0.5
        const roomy = g.W - (g.wx + g.ww) > 90
        const ex = roomy ? g.W - 30 : g.W + 6
        const ey = roomy ? g.H - 10 : Math.max(8, g.wy - 6)
        const top = g.wrapped ? 9 : Math.max(9, Math.min(12, g.wy * 0.45))
        // Control points keep the outer band's apex at least ~3 px below the stage top (no clipped crest).
        const c1 = [sx + (ex - sx) * 0.12, top - (g.wrapped ? 6 : 10)]
        const c2 = [sx + (ex - sx) * (roomy ? 0.78 : 0.62), top - (roomy ? 14 : g.wrapped ? 4 : 8)]
        const d = 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' +
            c2[0].toFixed(1) + ' ' + c2[1].toFixed(1) + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1)
        const gap = g.wrapped ? 1.8 : 2.4   // equal to the band stroke, so the bands touch
        let m = ''
        ;['rt-sp-band-gold', 'rt-sp-band-mint', 'rt-sp-band-emerald'].forEach((cls, i) => {
            m += '<path class="rt-sp-band ' + cls + '" transform="translate(0 ' + ((i - 1) * gap).toFixed(1) + ')" d="' + d + '"/>'
        })
        const svg = svgFrom(m, 'rt-sp-bow', '0 0 ' + Math.round(g.W) + ' ' + Math.round(g.H))
        svg.setAttribute('width', String(Math.round(g.W)))
        svg.setAttribute('height', String(Math.round(g.H)))
        if (g.wrapped) svg.classList.add('rt-sp-bow-thin')
        bowHost.appendChild(svg)
        return svg
    }

    function pathLength(p: SVGPathElement, fallback: number): number {
        return typeof p.getTotalLength === 'function' ? p.getTotalLength() : fallback
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

        add(sky, [{ opacity: 1 }, { opacity: 1 }], { d: CLOCK })    // scene clock, always anims[0]
        const g = geom()
        sky.classList.toggle('rt-sp-wrapped', g.wrapped)

        // 1. Rainbow 300-1900 sweeps in (bands drawn with a small stagger), holds, 3300-4200 fades.
        const bow = buildBow(g)
        add(bow, [{ opacity: 1 }, { opacity: 1, offset: 0.786 }, { opacity: 0 }], { d: 4200 })
        bow.querySelectorAll<SVGPathElement>('.rt-sp-band').forEach((p, i) => {
            const len = pathLength(p, 600) + 4
            p.style.strokeDasharray = len.toFixed(1) + ' ' + (len + 10).toFixed(1)
            add(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { at: 300 + i * 110, d: 1500, ease: 'cubic-bezier(0.5, 0, 0.25, 1)' })
        })

        // 1b. Eight clovers drift left to right, tumbling, 250-4200 (staggered), each through four waypoints.
        const lo = 4
        const hi = g.H - 14
        const rows = [0.1, 0.62, 0.3, 0.85, 0.45, 0.15, 0.7, 0.38]
        const starts = [250, 520, 800, 1050, 1350, 1600, 1900, 2150]
        const durs = [2300, 2000, 2400, 1900, 2200, 2000, 2050, 2000]
        const sizes = [11, 9, 12, 8, 10, 9, 11, 8]
        clovers.forEach((cl, i) => {
            const y0 = lo + (hi - lo) * rows[i]
            const amp = (g.wrapped ? 5 : 9) * (i % 2 ? -1 : 1)
            const x0 = -14 + (i % 3) * 6
            const x1 = g.W + 8
            const sc = sizes[i] / 12 * (g.wrapped ? 0.85 : 1)
            cl.style.left = '0px'
            cl.style.top = '0px'
            const spin = (i % 2 ? -1 : 1) * (200 + i * 25)
            const tf = (f: number, dy: number, r: number): string => {
                const x = x0 + (x1 - x0) * f
                const y = Math.max(lo, Math.min(hi, y0 + dy))
                return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + r.toFixed(0) + 'deg) scale(' + sc.toFixed(2) + ')'
            }
            add(cl, [
                { transform: tf(0, 0, 0), opacity: 0 },
                { transform: tf(0.12, -amp * 0.6, spin * 0.12), opacity: 0.95, offset: 0.12 },
                { transform: tf(0.4, amp, spin * 0.4), opacity: 0.95, offset: 0.4 },
                { transform: tf(0.7, -amp * 0.4, spin * 0.7), opacity: 0.9, offset: 0.7 },
                { transform: tf(1, amp * 0.5, spin), opacity: 0 },
            ], { at: starts[i], d: durs[i], ease: 'linear' })
        })

        if (mark) {
            const q = (s: string): Element | null => mark.querySelector(s)
            // 2. 1800-2400: the everyday mark gives way to the emerald frame and the mint inner triangle.
            add(q('.rt-sp-every-frame'), [{ opacity: 1 }, { opacity: 0 }], { at: 1800, d: 600, ease: 'ease-in-out' })
            add(q('.rt-sp-frame'), [{ opacity: 0 }, { opacity: 1 }], { at: 1800, d: 600, ease: 'ease-in-out' })
            add(q('.rt-sp-every-inner'), [{ opacity: 1 }, { opacity: 0 }], { at: 1900, d: 500, ease: 'ease-in-out' })
            add(q('.rt-sp-mid'), [{ opacity: 0 }, { opacity: 1 }], { at: 1900, d: 500, ease: 'ease-in-out' })
            // 2. 2200-3460: the vertices round out into three leaves, growing from each vertex inward.
            mark.querySelectorAll('.rt-sp-leaf').forEach((leaf, i) => {
                add(leaf, [
                    { transform: 'scale(0.15)', opacity: 0, easing: EASE_OUT },
                    { transform: 'scale(1.12)', opacity: 1, offset: 0.62, easing: 'ease-in-out' },
                    { transform: 'scale(1)', opacity: 1 },
                ], { at: 2200 + i * 180, d: 900 })
            })
            // 2. 2950-3650: the gold coin spins into the core; 3500-4150 the gold stem draws; 4250-4750 the coin glints.
            add(q('.rt-sp-coin'), [
                { transform: 'scale(0, 1)', opacity: 0 },
                { transform: 'scale(1, 1)', opacity: 1, offset: 0.3 },
                { transform: 'scale(-1, 1)', opacity: 1, offset: 0.62 },
                { transform: 'scale(1, 1)', opacity: 1 },
            ], { at: 2950, d: 700, ease: EASE })
            const stem = mark.querySelector<SVGPathElement>('.rt-sp-stem')
            if (stem) {
                const sl = pathLength(stem, 70) + 2
                stem.style.strokeDasharray = sl.toFixed(1) + ' ' + (sl + 10).toFixed(1)
                add(stem, [
                    { strokeDashoffset: sl, opacity: 0 },
                    { strokeDashoffset: sl * 0.96, opacity: 1, offset: 0.04 },
                    { strokeDashoffset: 0, opacity: 1 },
                ], { at: 3500, d: 650, ease: EASE })
            }
            add(q('.rt-sp-glint'), [
                { transform: 'scale(0) rotate(-45deg)', opacity: 0 },
                { transform: 'scale(1.4) rotate(0deg)', opacity: 1, offset: 0.45 },
                { transform: 'scale(0.75) rotate(0deg)', opacity: 1 },
            ], { at: 4250, d: 500, ease: EASE_OUT })
            // 2b. A small breeze sway of the whole shamrock 4300-5000.
            add(q('.rt-sp-sway'), [
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(-5deg)', offset: 0.3 },
                { transform: 'rotate(3deg)', offset: 0.65 },
                { transform: 'rotate(0deg)' },
            ], { at: 4300, d: 700, ease: 'ease-in-out' })
        }

        // 3. "Risu" crossfades to emerald-cyan 4900-5600 (opacity of a gradient copy on ::after, where supported).
        const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
        if (risu && pseudoOk) add(risu, [{ opacity: 0 }, { opacity: 1 }], { at: 4900, d: 700, ease: 'ease-in-out' }, '::after')
        // 3. The small shamrock drops into place above the "u" 5000-5650 (one overshoot, the keyframe, no curve on top).
        placeTuck()
        add(tuckIn, [
            { transform: 'translate(0.1em, -0.55em) rotate(-70deg) scale(0.3)', opacity: 0, easing: EASE_OUT },
            { transform: 'translate(0em, 0.06em) rotate(8deg) scale(1.1)', opacity: 1, offset: 0.6, easing: 'ease-in-out' },
            { transform: 'translate(0em, 0em) rotate(0deg) scale(1)', opacity: 1 },
        ], { at: 5000, d: 650 })
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
            placeTuck()
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
        tuck.remove()
        if (risu) {
            risu.classList.remove('rt-sp-risu')
            risu.removeAttribute('data-rt-sp-text')
        }
        word.classList.remove('rt-sp-word', 'rt-sp-final')
        ctx.setDescription('')
        settle()
    }

    placeTuck()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'stPatricksDay',
    durationMs: DURATION,
    build,
}
export default scene
