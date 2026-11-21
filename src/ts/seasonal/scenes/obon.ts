// Seasonal scene: obon (お盆; Aug 13-16, lang ja).
//
// A quiet summer night: distant hanabi (花火) rings bloom and fade in the upper stage while ripples cross the water line under
// the brand; the triangle warms into a floating tōrō (灯籠流し) paper lantern resting on two reflection dashes, and "Tanium"
// keeps a warm lantern-lit edge. Obon is a time of remembrance, so nothing bounces or bursts near the word: the fireworks are
// small and far, and the lantern settles slowly.
// Storyboard (6.8 s of motion, 7.2 s budget): the night wash comes in 0-0.7 s (out 4.4-5.4 s); four hanabi rings bloom at
// 0.5/1.25/2.05/2.9 s; five ripples cross the water line 0.7-5.7 s; the everyday mark fades 2.2-3.0 s; the lantern comes down
// 2.4-5.8 s, its paper warms to gold 3.4-4.6 s, the flame catches 3.3-3.9 s, the halo opens 3.6-4.8 s and the reflection
// dashes spread 4.3-5.15 s; "Tanium" takes the warm edge 5.2-6.8 s.
// Final: the lantern mark with halo and dashes, "Tanium" with its lantern-lit edge, no sky.
// No fonts. Motion is Web Animations only: transform and opacity (plus one ::after opacity). No filters, no loops. The final
// pose is static CSS under .rt-ob-final, so finish() gives the same pose from any point.
import './obon.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 7200
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const OUTER = 'M-55.85-32.25H55.85L0 64.49Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// Lantern parts: the wooden top rail across the top edge, two paper-panel ribs, the reflection dashes under the apex, and the
// halo behind it (r 78: 1.1 px past a 32 px slot; the lower dash reaches 2.8 px past it).
const RAIL = { x: -62, y: -40, w: 124, h: 8.5, r: 2.5 }
const RIBS = 'M-18.6-32.25L-10 -17.34M18.6-32.25L10 -17.34'
const DASH1 = 'M-36 77H36'
const DASH2 = 'M-21 89.5H21'

// Hanabi ring (viewBox -50 -50 100 100): an outer ring of 14 dots and an inner ring of 8, each a single dashed circle with
// round caps, plus a centre spark. Stroke widths are set per burst so dots stay about 2 px wide.
const RING_OUT = 40
const RING_IN = 21

interface BurstSpot {
    x: number
    y: number
    r: number
}

interface Geom {
    W: number
    H: number
    wx: number
    wy: number
    ww: number
    wh: number
    mx: number
    my: number
    ms: number
    cx: number
    cy: number
    bursts: BurstSpot[]
    mode: 'wide' | 'band'
    waterY: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-ob-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('obon: svg markup did not parse')
    return n
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

function burstMarkup(sw: string): string {
    return '<circle class="rt-ob-ring-out" r="' + RING_OUT + '" pathLength="98" stroke-dasharray="0 7" stroke-width="' + sw + '"/>' +
        '<circle class="rt-ob-ring-in" r="' + RING_IN + '" pathLength="96" stroke-dasharray="0 12" stroke-width="' + (Number(sw) * 0.85).toFixed(2) + '"/>' +
        '<circle class="rt-ob-spark" r="' + (Number(sw) * 0.6).toFixed(2) + '"/>'
}

function markMarkup(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-peach" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd2b3"/><stop offset="1" stop-color="#ffb38a"/></linearGradient>' +
        '<linearGradient id="' + id + '-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeaa8"/><stop offset=".55" stop-color="#ffd166"/><stop offset="1" stop-color="#ffb84d"/></linearGradient>' +
        '<radialGradient id="' + id + '-halo" cx="0" cy="6" r="78" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffd166" stop-opacity=".55"/><stop offset=".55" stop-color="#ffb38a" stop-opacity=".22"/><stop offset="1" stop-color="#ffb38a" stop-opacity="0"/></radialGradient>' +
        '</defs>' +
        '<g class="rt-ob-every" id="' + id + '-every">' +
            '<path class="rt-ob-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-ob-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-ob-halo" id="' + id + '-halo"><circle cx="0" cy="6" r="78" fill="url(#' + id + '-halo)"/></g>' +
        '<g class="rt-ob-water" id="' + id + '-water">' +
            '<path class="rt-ob-dash rt-ob-dash-1" id="' + id + '-dash1" d="' + DASH1 + '"/>' +
            '<path class="rt-ob-dash rt-ob-dash-2" id="' + id + '-dash2" d="' + DASH2 + '"/>' +
        '</g>' +
        '<g class="rt-ob-lantern" id="' + id + '-lantern">' +
            '<path class="rt-ob-paper-a" fill="url(#' + id + '-peach)" d="' + OUTER + '"/>' +
            '<path class="rt-ob-paper-b" id="' + id + '-warm" fill="url(#' + id + '-gold)" d="' + OUTER + '"/>' +
            '<path class="rt-ob-edge" d="' + OUTER + '"/>' +
            '<path class="rt-ob-ribs" d="' + RIBS + '"/>' +
            '<path class="rt-ob-lit" d="' + HOLE + '"/>' +
            '<g class="rt-ob-flame" id="' + id + '-flame">' +
                '<path class="rt-ob-flame-body" d="' + MID + '"/>' +
                '<path class="rt-ob-flame-core" d="' + CORE + '"/>' +
            '</g>' +
            '<rect class="rt-ob-rail" x="' + RAIL.x + '" y="' + RAIL.y + '" width="' + RAIL.w + '" height="' + RAIL.h + '" rx="' + RAIL.r + '"/>' +
        '</g>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    ctx.setDescription('お盆', 'ja')

    // ----- Stage: night wash, hanabi rings, ripples on the water line -----
    const sky = el('div', 'rt-ob-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-ob-wash', sky)
    wash.id = id + '-wash'
    const bursts: HTMLElement[] = []
    for (let b = 0; b < 4; b++) {
        const bw = el('div', 'rt-ob-burst rt-ob-burst-' + (b + 1), sky)
        bw.id = id + '-burst' + (b + 1)
        bursts.push(bw)
    }
    const ripples: HTMLElement[] = []
    for (let r = 0; r < 5; r++) {
        const rp = el('div', 'rt-ob-ripple', sky)
        rp.id = id + '-ripple' + (r + 1)
        ripples.push(rp)
    }
    ctx.stage.appendChild(sky)

    // ----- Mark slot: everyday mark to floating paper lantern -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-ob-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: a warm lantern-lit copy of "Tanium" on ::after (only its opacity animates) -----
    const word = ctx.word
    word.classList.add('rt-ob-word')
    const tan = findLeafSpan(word, 'Tanium')
    if (tan) {
        tan.classList.add('rt-ob-tan')
        tan.setAttribute('data-rt-ob-text', 'Tanium')
    }

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
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        sky.classList.add('rt-ob-final')
        mark?.classList.add('rt-ob-final')
        word.classList.add('rt-ob-final')
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions, pseudo?: string): Animation | null {
        if (!node || !node.animate) return null
        // The easing applies per keyframe segment (not to the whole iteration), so holds stay holds.
        const ease = o.ease
        const eased = ease ? frames.map((f) => (f.easing ? f : { ...f, easing: ease })) : frames
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: 'linear', fill: 'both' }
        if (pseudo) opts.pseudoElement = pseudo
        let a: Animation
        try {
            a = node.animate(eased, opts)
        } catch {
            return null
        }
        anims.push(a)
        return a
    }

    // Stage geometry from the host seams (stageBox: clamped height and wrap; stageOffset: mark and word boxes).
    function geom(): Geom {
        const box = ctx.stageBox()
        const sr = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : sr.width
        const H = box.height ? box.height : sr.height
        const off = ctx.stageOffset()
        const wx = off.wordX
        const wy = off.wordY
        const ww = off.wordWidth
        const wh = off.wordHeight
        const ms = off.markSize ? off.markSize : (ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 0)
        const mx = off.markX
        const my = off.markY
        // Bursts: four rings. Where the stage has room right of the word (desktop), three bloom there and one small ring above
        // the word; otherwise (phones: 156-186 px stages) all four are small and stay in the band above the word box, clear of
        // the mark. No ring ever overlaps the word box or the mark slot.
        const fx0 = wx + ww + 14
        const fx1 = W - 10
        const band = Math.max(0, Math.min(wy, my) - 1)
        const bandR = Math.max(5, Math.min(9, band / 2 - 0.5))
        const lo = mx + ms + 6 + bandR
        const hi = W - bandR - 3
        let spots: BurstSpot[]
        let mode: 'wide' | 'band'
        if (fx1 - fx0 >= 90) {
            const span = fx1 - fx0
            const rb = Math.min(22, span / 4.5)
            spots = [
                { x: fx0 + 0.3 * span, y: Math.min(28, H * 0.42), r: rb },
                { x: fx0 + 0.74 * span, y: Math.min(19, H * 0.3), r: rb * 0.75 },
                { x: Math.min(hi, wx + ww * 0.62), y: band / 2, r: bandR },
                { x: fx0 + 0.52 * span, y: Math.min(42, H * 0.6), r: rb * 0.6 },
            ]
            mode = 'wide'
        } else {
            spots = [0.14, 0.64, 0.92, 0.4].map((k) => ({ x: lo + k * Math.max(0, hi - lo), y: band / 2, r: bandR }))
            mode = 'band'
        }
        // Water line just under the mark (inside the top bar on desktop; above the clamped bottom on phones).
        const waterY = Math.min(H - 7, my + ms + 3)
        return { W, H, wx, wy, ww, wh, mx, my, ms, cx: mx + ms / 2, cy: my + ms / 2, bursts: spots, mode, waterY }
    }
    function applyGeom(g: Geom): void {
        sky.setAttribute('data-rt-ob-mode', g.mode)
        wash.style.setProperty('--rt-ob-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-ob-my', g.cy.toFixed(1) + 'px')
        // The hole hugs the mark (radius = half the slot + 1 px, feathered over 8 px), so it never shows as a dark round patch
        // beside the mark. The wash fades out by the top of the mark slot, so the brand row is never tinted.
        wash.style.setProperty('--rt-ob-fade', Math.max(14, g.cy - g.ms / 2).toFixed(1) + 'px')
        const hr = (g.ms || 28) / 2
        wash.style.setProperty('--rt-ob-h0', (hr + 1).toFixed(1) + 'px')
        wash.style.setProperty('--rt-ob-h1', (hr + 9).toFixed(1) + 'px')
        bursts.forEach((n, i) => {
            const p = g.bursts[i]
            const s = 2 * p.r
            // Dots about 2.2 px (1.8 px on the small rings) whatever the ring size: 1 unit = r / 50 px.
            const sw = Math.min(14, (p.r >= 12 ? 2.2 : 1.8) / (p.r / 50))
            n.style.cssText = 'left:' + (p.x - p.r).toFixed(1) + 'px;top:' + (p.y - p.r).toFixed(1) + 'px;width:' + s.toFixed(1) + 'px;height:' + s.toFixed(1) + 'px'
            n.innerHTML = ''
            n.appendChild(svgFrom(burstMarkup(sw.toFixed(2)), 'rt-ob-burst-svg', '-50 -50 100 100'))
        })
        const unit = g.ms ? g.ms / 32 : 1
        const xs = [-4, 12, 28, 46, 64]
        const ws = [18, 14, 20, 16, 22]
        ripples.forEach((n, i) => {
            const w = ws[i] * unit
            n.style.cssText = 'left:' + (g.cx + xs[i] * unit - w / 2).toFixed(1) + 'px;top:' + (g.waterY + (i % 2 ? 2.5 : 0)).toFixed(1) + 'px;width:' + w.toFixed(1) + 'px'
        })
    }

    function timeline(): void {
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const BLOOM = 'cubic-bezier(0.16, 1, 0.3, 1)'

        add(sky, [], { d: 6800 })    // scene clock (property-less), always anims[0]
        applyGeom(geom())

        // 1. Night wash: 0-700 in, holds, 4400-5400 out. Static mask with a soft hole over the mark slot.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 700 / 5400 }, { opacity: 1, offset: 4400 / 5400 }, { opacity: 0 }], { d: 5400 })

        // 1b. Hanabi: four distant rings bloom (scale 0.2 to 1, fast then slow) and fade while drifting down 3 px.
        const starts = [500, 1250, 2050, 2900]
        bursts.forEach((n, i) => {
            add(n, [
                { opacity: 0, transform: 'translateY(0) scale(0.2)', easing: BLOOM },
                { opacity: 1, transform: 'translateY(0) scale(0.92)', offset: 0.32, easing: 'linear' },
                { opacity: 0.9, transform: 'translateY(1px) scale(1)', offset: 0.5, easing: IN },
                { opacity: 0, transform: 'translateY(3px) scale(1.04)' },
            ], { at: starts[i], d: 1700 })
            add(n.querySelector('.rt-ob-ring-in'), [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { at: starts[i] + 120, d: 700, ease: OUT })
        })

        // 1c. Ripples cross the water line one after another (each once): drift right, widen, fade in and out.
        ripples.forEach((n, i) => {
            add(n, [
                { opacity: 0, transform: 'translateX(-5px) scaleX(0.5)' },
                { opacity: 0.8, transform: 'translateX(0) scaleX(0.85)', offset: 0.3 },
                { opacity: 0, transform: 'translateX(6px) scaleX(1)' },
            ], { at: 700 + i * 520, d: 2000, ease: INOUT })
        })

        if (mark) {
            // 2. 2200-3000 the everyday mark fades; 2400-3600 the lantern comes down onto the water (peach paper); 3400-4600
            // the paper warms to gold; the flame catches 3300-3900; the halo opens 3600-4800; the reflection dashes spread
            // 4300-5000; one slow bob 4700-5600.
            add(mark.querySelector('.rt-ob-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }], { at: 2200, d: 800, ease: IN })
            add(mark.querySelector('.rt-ob-lantern'), [
                { opacity: 0, transform: 'translateY(-12px)' },
                { opacity: 1, transform: 'translateY(0)', offset: 1200 / 3400 },
                { opacity: 1, transform: 'translateY(0)', offset: 2300 / 3400 },
                { opacity: 1, transform: 'translateY(2.5px)', offset: 2750 / 3400 },
                { opacity: 1, transform: 'translateY(0)' },
            ], { at: 2400, d: 3400, ease: INOUT })
            add(mark.querySelector('.rt-ob-paper-b'), [{ opacity: 0 }, { opacity: 1 }], { at: 3400, d: 1200, ease: INOUT })
            // The wooden rail joins once the paper has body (3300-3800): faded in with the lantern it read as a dark smudge over
            // the dark canvas during the crossfade.
            add(mark.querySelector('.rt-ob-rail'), [{ opacity: 0 }, { opacity: 1 }], { at: 3300, d: 500, ease: INOUT })
            add(mark.querySelector('.rt-ob-flame'), [
                { opacity: 0, transform: 'scale(0.4)' },
                { opacity: 1, transform: 'scale(1.15)', offset: 0.55 },
                { opacity: 1, transform: 'scale(1)' },
            ], { at: 3300, d: 600, ease: OUT })
            add(mark.querySelector('.rt-ob-halo'), [{ opacity: 0 }, { opacity: 1, offset: 0.6 }, { opacity: 0.85 }], { at: 3600, d: 1200, ease: INOUT })
            add(mark.querySelector('.rt-ob-dash-1'), [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 0.85, transform: 'scaleX(1)' }], { at: 4300, d: 700, ease: OUT })
            add(mark.querySelector('.rt-ob-dash-2'), [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 0.5, transform: 'scaleX(1)' }], { at: 4450, d: 700, ease: OUT })
        }

        // 3. "Tanium" takes the lantern's warm edge 5200-6800 and keeps it (final pose). Only where WAAPI can target ::after;
        // elsewhere the final class shows it at the end without animation.
        const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
        if (tan && pseudoOk) add(tan, [{ opacity: 0 }, { opacity: 1 }], { at: 5200, d: 1600, ease: INOUT }, '::after')
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
        sky.classList.remove('rt-ob-final')
        mark?.classList.remove('rt-ob-final')
        word.classList.remove('rt-ob-final')
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
        sky.remove()
        mark?.remove()
        word.classList.remove('rt-ob-word', 'rt-ob-final')
        if (tan) {
            tan.classList.remove('rt-ob-tan')
            tan.removeAttribute('data-rt-ob-text')
        }
        ctx.setDescription('')
        settle()
    }

    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'obon',
    durationMs: DURATION,
    build,
}
export default scene
