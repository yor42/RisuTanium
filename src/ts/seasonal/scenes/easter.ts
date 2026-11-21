// Seasonal scene: easter (Western Easter Sunday; en, de, es).
//
// Storyboard (6.8 s budget, the last keyframe ends at 6.4 s): a pastel meadow wash fades in 0-0.7 s (out 4.0-5.0 s) while two
// painted ribbons draw across the stage (0.3-1.8 s and 0.7-2.2 s, fading 3.6-4.4 s and 3.8-4.6 s); the idle mark flips from
// down to up (1.8-2.8 s) and rounds into a pastel egg (2.9-3.7 s); three chevron stripes that echo the nested triangles paint in
// (gold, lavender, mint, 3.4-4.6 s), the brand core pops in (4.5-5.0 s) and the egg wobbles once (4.7-5.6 s); bunny ears rise
// on the "u" (5.0-5.8 s) and the right ear flops (5.8-6.4 s).
// Final: chevron-egg mark (a triangle silhouette with rounded sides) and the bunny ears on the "u".
// Greeting (description only, per language): en "Happy Easter!", de "Frohe Ostern!", es "¡Felices Pascuas!".
// No fonts. Motion is Web Animations only: transform, opacity and stroke-dashoffset. No filters, no loops. The final pose is
// static CSS under .rt-ea-final, so finish() gives the same pose from any point.
import './easter.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 6400 ms.
const DURATION = 6800
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Egg, drawn upright (after the flip the mark points up): the frame silhouette with its sides rounded out.
const EGG = 'M0-64C16-64 58 2 56 22C54.5 38 30 44 0 44C-30 44-54.5 38-56 22C-58 2-16-64 0-64Z'
// Chevron stripes whose arms run parallel to the triangle's sides (60 degrees), nested like the mark. Each arm stops at the
// egg's foot line (y = 44) so the stripes stay inside the egg's box (they are also clipped to it).
function chevron(a: number): string {
    const y = Math.min(a + 97, 44)
    const x = ((y - a) * 0.5774).toFixed(1)
    return 'M-' + x + ' ' + y + 'L0 ' + a + 'L' + x + ' ' + y
}
const CHEVRONS = [
    { cls: 'rt-ea-chev-gold', d: chevron(-42) },
    { cls: 'rt-ea-chev-lav', d: chevron(-20) },
    { cls: 'rt-ea-chev-mint', d: chevron(2) },
]
// The brand core, flipped and enlarged 1.5x, sits under the lowest chevron like the innermost triangle.
const CORE_UP = 'M-11.13 29.42H11.13L0 10.15Z'
const SHINE = 'M-24-30C-19-38-14-42-11-41C-10-37-16-28-21-24C-24-23-26-26-24-30Z'

// Bunny ears (viewBox -16 -36 32 36, base line y = 0; bases over the u's stems, 10.5 units = 0.23em apart from its centre): each
// ear is drawn with its base at its own origin.
const EAR_OUT = 'M-5 0C-7.5-13-6.5-29 0-34C6.5-29 7.5-13 5 0Z'
const EAR_IN = 'M-2.3-3C-3.6-13-3.2-24 0-28.5C3.2-24 3.6-13 2.3-3Z'

const GREETING: Record<string, string> = { en: 'Happy Easter!', de: 'Frohe Ostern!', es: '¡Felices Pascuas!' }

interface Geom {
    W: number
    H: number
    wy: number
    wh: number
    cx: number
    cy: number
    rowBottom: number
    wrapped: boolean
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
    fill?: FillMode
}

function sid(uid: string): string {
    return 'rt-ea-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('easter: svg markup did not parse')
    return n
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

function markMarkup(id: string): string {
    const chev = CHEVRONS.map((c) => '<path class="rt-ea-chev ' + c.cls + '" pathLength="1" d="' + c.d + '"/>').join('')
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff9ef"/><stop offset=".55" stop-color="#ffeef3"/><stop offset="1" stop-color="#fbd9e6"/></linearGradient>' +
        '<clipPath id="' + id + '-clip"><path d="' + EGG + '"/></clipPath>' +
        '</defs>' +
        // Start pose: the everyday mark, inside the flip group (scaleY 1 to -1 turns it point-up).
        '<g class="rt-ea-flip" id="' + id + '-flip"><g class="rt-ea-brand" id="' + id + '-brand">' +
            '<path class="rt-ea-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-ea-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g></g>' +
        // Final: the egg. Nesting: opacity root > pivot at the egg's foot (0, 44) for the wobble > pop about the centroid.
        '<g class="rt-ea-egg" id="' + id + '-egg"><g transform="translate(0 44)"><g class="rt-ea-wobble" id="' + id + '-wobble">' +
            '<g transform="translate(0 -44)"><g class="rt-ea-pop" id="' + id + '-pop">' +
                '<path class="rt-ea-shell" fill="url(#' + id + '-shell)" d="' + EGG + '"/>' +
                '<g clip-path="url(#' + id + '-clip)">' + chev + '</g>' +
                '<g class="rt-ea-core" id="' + id + '-core-up"><path fill="url(#' + id + '-core)" d="' + CORE_UP + '"/></g>' +
                '<path class="rt-ea-shine" d="' + SHINE + '"/>' +
                '<path class="rt-ea-rim" d="' + EGG + '"/>' +
            '</g></g>' +
        '</g></g></g>'
}

function earsMarkup(): string {
    const ear = (x: number, side: string): string =>
        '<g transform="translate(' + x + ' 0)"><g class="rt-ea-ear rt-ea-ear-' + side + '">' +
        '<path class="rt-ea-ear-out" d="' + EAR_OUT + '"/><path class="rt-ea-ear-in" d="' + EAR_IN + '"/></g></g>'
    return ear(-10.5, 'l') + ear(10.5, 'r')
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: meadow wash and two painted ribbons -----
    const sky = el('div', 'rt-ea-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-ea-wash', sky)
    wash.id = id + '-wash'
    const ribbons = document.createElementNS(SVGNS, 'svg')
    ribbons.setAttribute('class', 'rt-ea-ribbons')
    ribbons.setAttribute('aria-hidden', 'true')
    ribbons.setAttribute('focusable', 'false')
    sky.appendChild(ribbons)
    const ribA = document.createElementNS(SVGNS, 'path')
    ribA.setAttribute('class', 'rt-ea-rib rt-ea-rib-a')
    ribA.setAttribute('pathLength', '1')
    ribA.id = id + '-rib-a'
    const ribB = document.createElementNS(SVGNS, 'path')
    ribB.setAttribute('class', 'rt-ea-rib rt-ea-rib-b')
    ribB.setAttribute('pathLength', '1')
    ribB.id = id + '-rib-b'
    ribbons.appendChild(ribA)
    ribbons.appendChild(ribB)
    ctx.stage.appendChild(sky)

    // ----- Mark slot: the everyday mark that flips into the chevron egg -----
    let mark: SVGSVGElement | null = null
    let flip: Element | null = null
    let brand: Element | null = null
    let egg: Element | null = null
    let wobble: Element | null = null
    let pop: Element | null = null
    let coreUp: Element | null = null
    let chevs: Element[] = []
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-ea-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
        flip = mark.querySelector('.rt-ea-flip')
        brand = mark.querySelector('.rt-ea-brand')
        egg = mark.querySelector('.rt-ea-egg')
        wobble = mark.querySelector('.rt-ea-wobble')
        pop = mark.querySelector('.rt-ea-pop')
        coreUp = mark.querySelector('.rt-ea-core')
        chevs = Array.from(mark.querySelectorAll('.rt-ea-chev'))
    }

    // ----- Word: bunny ears on the "u" -----
    const word = ctx.word
    word.classList.add('rt-ea-word')
    const risu = findLeafSpan(word, 'Risu')
    const ears = el('span', 'rt-ea-ears', word)
    ears.id = id + '-ears'
    ears.setAttribute('aria-hidden', 'true')
    ears.appendChild(svgFrom(earsMarkup(), 'rt-ea-earsvg', '-16 -36 32 36'))
    const earL = ears.querySelector('.rt-ea-ear-l')
    const earR = ears.querySelector('.rt-ea-ear-r')

    const lang = GREETING[ctx.lang] ? ctx.lang : 'en'
    ctx.setDescription(GREETING[lang], lang)

    function placeEars(): void {
        // Centre of the "u" in em of the word's font size, measured from the word box's left edge (estimate when it cannot be
        // measured).
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 1.93
        if (risu && risu.firstChild) {
            try {
                const r = document.createRange()
                r.setStart(risu.firstChild, 3)
                r.setEnd(risu.firstChild, 4)
                const ur = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (ur.width > 0) x = (ur.left + ur.width / 2 - wr.left) / fs
            } catch {
                // keep the estimate
            }
        }
        ears.style.setProperty('--rt-ea-ux', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeEars()
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
        sky.classList.toggle('rt-ea-final', on)
        mark?.classList.toggle('rt-ea-final', on)
        word.classList.toggle('rt-ea-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeEars()
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

    // Stage geometry from the host seams (stageBox for the clamped height, stageOffset for the word and mark).
    function geom(): Geom {
        const box = ctx.stageBox()
        const sr = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : sr.width
        const H = box.height ? box.height : sr.height
        const off = ctx.stageOffset()
        const rowBottom = box.rowBottom ? box.rowBottom : H
        const ms = off.markSize ? off.markSize : (ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 0)
        const cx = ctx.markSlot ? off.markX + ms / 2 : off.wordX - 20
        const cy = ctx.markSlot ? off.markY + ms / 2 : off.wordY + off.wordHeight / 2
        return { W, H, wy: off.wordY, wh: off.wordHeight, cx, cy, rowBottom, wrapped: box.wrapped }
    }

    // A smooth ribbon wave (cubic humps, peak = amp) instead of a zigzag, which read as a spell-check squiggle under the
    // word. Half-period `half` px; the phase alternates so the two ribbons do not mirror.
    function wave(x0: number, x1: number, y: number, amp: number, half: number, phase: number): string {
        const n = Math.max(2, Math.round((x1 - x0) / half))
        const h = (x1 - x0) / n
        let d = 'M' + x0.toFixed(1) + ' ' + y.toFixed(1)
        for (let i = 0; i < n; i++) {
            const x = x0 + i * h
            const sgn = (i + phase) % 2 ? 1 : -1
            const c = (y + sgn * amp * 4 / 3).toFixed(1)
            d += 'C' + (x + h / 3).toFixed(1) + ' ' + c + ' ' + (x + 2 * h / 3).toFixed(1) + ' ' + c + ' ' + (x + h).toFixed(1) + ' ' + y.toFixed(1)
        }
        return d
    }

    function applyGeom(g: Geom): void {
        sky.classList.toggle('rt-ea-wrapped', g.wrapped)
        wash.style.setProperty('--rt-ea-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-ea-my', g.cy.toFixed(1) + 'px')
        ribbons.setAttribute('viewBox', '0 0 ' + Math.max(1, Math.round(g.W)) + ' ' + Math.max(1, Math.round(g.H)))
        ribbons.setAttribute('width', String(Math.round(g.W)))
        ribbons.setAttribute('height', String(Math.round(g.H)))
        // One ribbon above the word, one below it, both inside the topbar row (never over page content below it).
        const limit = Math.min(g.H, g.rowBottom + 8)
        const ya = Math.max(5, g.wy - 7)
        const yb = Math.min(limit - 5, g.wy + g.wh + 8)
        const half = g.wrapped ? 18 : 24
        ribA.setAttribute('d', wave(6, g.W - 6, ya, 3, half, 0))
        ribB.setAttribute('d', wave(6, g.W - 6, yb, 3, half, 1))
        // The meadow wash (and its painted flower dots) ends with the topbar row instead of reaching over main.
        wash.style.bottom = 'auto'
        wash.style.height = Math.round(limit) + 'px'
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const PAINT = 'cubic-bezier(0.45, 0, 0.25, 1)'

        add(sky, [], { d: 6400 })    // scene clock (property-less), always anims[0]
        applyGeom(geom())

        // 1. Meadow wash: in 0-700, holds, out 4000-5000.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { d: 5000 })
        // 1b. Painted ribbons draw left to right, hold, then fade.
        add(ribA, [
            { strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.36 },
            { strokeDashoffset: 0, opacity: 1, offset: 0.82 }, { strokeDashoffset: 0, opacity: 0 },
        ], { at: 300, d: 4100, ease: 'linear' })
        add(ribB, [
            { strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.38 },
            { strokeDashoffset: 0, opacity: 1, offset: 0.8 }, { strokeDashoffset: 0, opacity: 0 },
        ], { at: 700, d: 3900, ease: 'linear' })

        if (mark) {
            // 2. Flip down to up (1800-2800), as the New Year mark does: through a thin sliver, small overshoot.
            add(flip, [
                { transform: 'scale(1, 1)' },
                { transform: 'scale(1.06, 0.02)', offset: 0.5 },
                { transform: 'scale(1, -1.07)', offset: 0.82 },
                { transform: 'scale(1, -1)' },
            ], { at: 1800, d: 1000, ease: 'cubic-bezier(.45,0,.25,1)' })
            add(brand, [{ opacity: 1 }, { opacity: 0 }], { at: 2900, d: 400, ease: 'ease-in' })
            // 2b. The up-pointing mark rounds into the egg (2900-3700): crossfade plus a soft pop about the centroid.
            add(egg, [{ opacity: 0 }, { opacity: 1 }], { at: 2900, d: 400, ease: 'ease-out' })
            add(pop, [
                { transform: 'scale(0.88)' }, { transform: 'scale(1.06)', offset: 0.55 },
                { transform: 'scale(0.98)', offset: 0.8 }, { transform: 'scale(1)' },
            ], { at: 2900, d: 800, ease: EASE_OUT })
            // 2c. Chevron stripes paint in, one after another (gold, lavender, mint).
            chevs.forEach((c, i) => {
                add(c, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 3400 + i * 300, d: 600, ease: PAINT })
            })
            // 2d. The brand core pops in under the stripes, then the egg wobbles once on its foot.
            add(coreUp, [
                { transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 },
            ], { at: 4500, d: 500, ease: EASE_OUT })
            add(wobble, [
                { transform: 'rotate(0deg)' }, { transform: 'rotate(-6deg)', offset: 0.25 }, { transform: 'rotate(5deg)', offset: 0.55 },
                { transform: 'rotate(-2.5deg)', offset: 0.8 }, { transform: 'rotate(0deg)' },
            ], { at: 4700, d: 900, ease: 'ease-in-out' })
        }

        // 3. Bunny ears rise on the "u" (5000-5800), then the right ear flops (5800-6400).
        placeEars()
        add(earL, [
            { transform: 'rotate(-6deg) scale(1, 0)', opacity: 0 },
            { transform: 'rotate(-6deg) scale(1, 1.1)', opacity: 1, offset: 0.65 },
            { transform: 'rotate(-6deg) scale(1, 1)', opacity: 1 },
        ], { at: 5000, d: 600, ease: EASE_OUT })
        add(earR, [
            { transform: 'rotate(6deg) scale(1, 0)', opacity: 0 },
            { transform: 'rotate(6deg) scale(1, 1.1)', opacity: 1, offset: 0.65 },
            { transform: 'rotate(6deg) scale(1, 1)', opacity: 1 },
        ], { at: 5150, d: 600, ease: EASE_OUT })
        add(earR, [
            { transform: 'rotate(6deg) scale(1, 1)' }, { transform: 'rotate(22deg) scale(1, 1)', offset: 0.45 },
            { transform: 'rotate(11deg) scale(1, 1)', offset: 0.75 }, { transform: 'rotate(14deg) scale(1, 1)' },
        ], { at: 5800, d: 600, ease: EASE, fill: 'forwards' })
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
    // time (read from the clock, anims[0]), keeping a paused state. Coalesced to one rebuild per frame.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placeEars()
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
        ears.remove()
        word.classList.remove('rt-ea-word', 'rt-ea-final')
        ctx.setDescription('')
        settle()
    }

    placeEars()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'easter',
    durationMs: DURATION,
    build,
}
export default scene
