// Seasonal scene: seollal (dangi lunar New Year: the eve of 1/1 through 1/2, lang ko).
//
// Storyboard (7.2 s of motion, 7.8 s budget): the everyday wordmark steps back 0-0.8 s; a dawn wash 0-1.0 s (lifts
// 5.4-6.6 s); a pine bough comes in from the top-right corner 0.3-1.5 s and a magpie glides in and perches 1.1-2.5 s;
// the greeting fades and scales in 2.7-3.3 s, holds and fades by 5.0 s; the bough and the magpie leave 5.0-6.0 s; the mark
// folds flat 3.8-4.1 s, the upright lucky pouch opens 4.05-4.7 s, its band and knot tie on 4.6-5.0 s and the embroidered
// triangle is stitched 4.9-5.8 s; the wordmark returns 6.0-6.8 s with a warm ivory "Tanium" and its gold edge comes up
// 6.4-7.2 s.
// Final: pouch mark with its embroidery, everyday wordmark with warm "Tanium" and a gold edge, no sky.
// Motion is Web Animations only: transform and opacity, plus stroke-dashoffset on the embroidery outline. No filters, no
// loops. The final pose is static CSS under .rt-sl-final, so finish() gives the same pose from any point.
//
// Font: EBS Juseekyung Medium from the commit-pinned jsDelivr URL, loaded by the host from `fonts`. The greeting takes the
// face only if ctx.fonts.ready() resolved true before it enters; otherwise the NanumSquare Neo fallback stack, with
// unchanged timing.
import './seollal.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 7800
const FAMILY = 'EBS Juseekyung'
const FONT_URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_one@40fb96ceb772b1b734b9569ffbb91721309bdd2b/EBSJSKMedium.woff'
const GREETING = '새해 복 많이 받으세요'
const DESCRIPTION = '새해 복 많이 받으세요!'
// Phone copy when the full greeting would shrink by more than 10% right of the mark.
const SHORT = '복 많이 받으세요'
const SVGNS = 'http://www.w3.org/2000/svg'
// Stages under this width send the bough and the magpie away before the greeting.
const NARROW = 240

// Everyday mark, shown at t=0 so the status mark hand-off is seamless.
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Lucky pouch: the frame silhouette turned upright, corners rounded and apex cinched into a neck under a gathered frill.
// The nested triangles are embroidered on the body in gold (outline = the hole, then mid and core).
const BODY = 'M-11-38C-18-22-44 2-53 20C-58 30-52 37-42 37H42C52 37 58 30 53 20C44 2 18-22 11-38Z'
const FRILL = 'M-11-38C-20-42-27-52-22-58C-18-62-12-57-8-60C-4-63 4-63 8-60C12-57 18-62 22-58C27-52 20-42 11-38Z'
const FRILL_PLEATS = 'M-8-41L-13-55M0-41V-58M8-41L13-55'
const BAND = 'M-15-43.5H15A3 3 0 0 1 15-36.5H-15A3 3 0 0 1-15-43.5Z'
// A square knot turned 45 degrees with two side loops, under the band.
const KNOT = 'M0-36L6-30L0-24L-6-30Z'
const KNOT_LOOPS = 'M-6-30C-12-33-15-27-10-25.5C-8-25-7-27-5.4-28.6M6-30C12-33 15-27 10-25.5C8-25 7-27 5.4-28.6'
// Embroidery: the everyday hole, mid and core turned upright, scaled 0.78 about (0, 12).
const EMB = 'translate(0 12) scale(0.78)'
const HOLE_UP = 'M-30.03 17.34H30.03L0-34.68Z'
const MID_UP = 'M-11.63 6.72H11.63L0-13.43Z'
const CORE_UP = 'M-7.42 4.28H7.42L0-8.57Z'

// Pine bough, viewBox 0 0 80 60, anchored at the stage's top-right corner.
function needles(cx: number, cy: number, r: number, from: number, to: number, n: number): string {
    let d = ''
    for (let i = 0; i < n; i++) {
        const a = (from + (to - from) * (i / (n - 1))) * Math.PI / 180
        const rr = r * (i % 2 ? 0.82 : 1)
        d += 'M' + cx + ' ' + cy + 'l' + (Math.cos(a) * rr).toFixed(2) + ' ' + (Math.sin(a) * rr).toFixed(2)
    }
    return d
}
const BOUGH =
    '<path class="rt-sl-wood" d="M82 5C66 9 47 17 31 27C24 31 18 34 11 36.4L11.8 38.4C19 36.2 26 33.6 33 29.6C49 20 67 12.6 82 9Z"/>' +
    '<path class="rt-sl-twig" d="M56 15.6L61 25M22 33L19 42M68 10.8L74 18"/>' +
    '<path class="rt-sl-needle-b" d="' + needles(72, 9, 9, 150, 390, 11) + needles(57, 15, 10, 160, 380, 11) + needles(62, 26, 8, -30, 210, 9) + '"/>' +
    '<path class="rt-sl-needle" d="' + needles(23, 33, 10, 120, 400, 12) + needles(11, 37, 8, 100, 330, 10) + needles(19, 43, 7, -20, 200, 9) + needles(74, 18, 7, -40, 200, 8) + '"/>'
// A point on the branch's upper edge, in bough units.
const PERCH = [37, 25.4]

// Magpie, viewBox 0 0 40 24, facing left. Feet at (15.5, 21).
const MAGPIE =
    '<path class="rt-sl-mp-ink rt-sl-mp-tail" d="M21.5 10.6L37.6 5.2C39.6 4.8 40.4 6.8 38.8 7.8L23.6 15Z"/>' +
    '<path class="rt-sl-mp-sheen" d="M30 7.8L37.6 5.2C39.6 4.8 40.4 6.8 38.8 7.8L31.6 11.2Z"/>' +
    '<ellipse class="rt-sl-mp-ink" cx="15" cy="12.6" rx="8.6" ry="5.4"/>' +
    '<ellipse class="rt-sl-mp-white" cx="17.4" cy="14.4" rx="4.8" ry="2.5"/>' +
    '<circle class="rt-sl-mp-ink" cx="7" cy="9" r="3.7"/>' +
    '<path class="rt-sl-mp-beak" d="M3.6 8.2L0.6 9.3L3.6 10.4Z"/>' +
    '<circle class="rt-sl-mp-eye" cx="6" cy="8.3" r="0.65"/>' +
    '<path class="rt-sl-mp-leg" d="M14 17.6L13.6 21M17.2 17.6L17.4 21"/>' +
    '<g class="rt-sl-mp-wing">' +
        '<path class="rt-sl-mp-ink" d="M9.6 10.2C14 4.4 20.4 4.6 25.4 7.8C20.6 11.6 15 12.6 10.6 12.4Z"/>' +
        '<path class="rt-sl-mp-sheen" d="M19.4 6.2C21.8 6.4 23.8 7 25.4 7.8C23.6 9.2 21.8 10.2 19.8 10.8Z"/>' +
        '<path class="rt-sl-mp-white" d="M11.6 10.6C14.4 8.6 17 8.4 19 9.4C16.6 11 14.2 11.4 11.6 11.4Z"/>' +
    '</g>'

interface Geometry {
    W: number
    B: number
    x: number
    bx: number
}

function sid(uid: string): string {
    return 'rt-sl-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('seollal: svg markup did not parse')
    return n
}

function markMarkup(id: string): string {
    return '<defs><linearGradient id="' + id + '-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-silk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2453c"/><stop offset="1" stop-color="#c11f2c"/></linearGradient></defs>' +
        '<g class="rt-sl-every" id="' + id + '-every">' +
            '<path class="rt-sl-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-sl-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-sl-pouch" id="' + id + '-pouch">' +
            '<path class="rt-sl-body" fill="url(#' + id + '-silk)" d="' + BODY + '"/>' +
            '<path class="rt-sl-frill" d="' + FRILL + '"/>' +
            '<path class="rt-sl-pleat" d="' + FRILL_PLEATS + '"/>' +
        '</g>' +
        '<g class="rt-sl-cord" id="' + id + '-cord">' +
            '<path class="rt-sl-band" d="' + BAND + '"/>' +
            '<path class="rt-sl-loops" d="' + KNOT_LOOPS + '"/>' +
            '<path class="rt-sl-knot" d="' + KNOT + '"/>' +
        '</g>' +
        '<g transform="' + EMB + '">' +
            '<path class="rt-sl-stitch" id="' + id + '-stitch" pathLength="1" d="' + HOLE_UP + '"/>' +
            '<g class="rt-sl-emb" id="' + id + '-emb">' +
                '<path class="rt-sl-gold" d="' + MID_UP + '"/>' +
                '<path fill="url(#' + id + '-core)" d="' + CORE_UP + '"/>' +
            '</g>' +
        '</g>'
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let fontOk = false
    let narrow = false

    ctx.setDescription(DESCRIPTION, 'ko')

    // ----- Stage -----
    const sky = el('div', 'rt-sl-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-sl-wash', sky)
    wash.id = id + '-wash'
    const bough = el('div', 'rt-sl-bough', sky)
    bough.id = id + '-bough'
    const boughSvg = svgFrom(BOUGH, 'rt-sl-bough-svg', '0 0 80 60')
    bough.appendChild(boughSvg)
    const magpie = el('div', 'rt-sl-magpie', sky)
    magpie.id = id + '-magpie'
    const magpieSvg = svgFrom(MAGPIE, 'rt-sl-magpie-svg', '0 0 40 24')
    magpie.appendChild(magpieSvg)
    const greetBox = el('div', 'rt-sl-greetbox', sky)
    greetBox.setAttribute('lang', 'ko')
    const greet = el('span', 'rt-sl-greet rt-sl-fb', greetBox)
    greet.id = id + '-greet'
    greet.textContent = GREETING
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-sl-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: warm ivory "Tanium" and a gold edge painted behind the everyday letters -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-sl-word')
    const edge = el('span', 'rt-sl-edge', word)
    edge.id = id + '-edge'
    edge.setAttribute('aria-hidden', 'true')
    edge.innerHTML = '<span>Risu</span><span>Tanium</span>'

    // ----- Geometry (stage px), measured at play and on every ctx.onRelayout call -----
    let G: Geometry = { W: 0, B: 0, x: 0, bx: 0 }
    function layoutStage(): void {
        if (state === 'destroyed') return
        const W = ctx.stageWidth()
        const SH = ctx.stageBox().height || ctx.stage.getBoundingClientRect().height || 96
        const off = ctx.stageOffset()
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const h = off.wordHeight || fs * 1.2
        // Bough: 24% of the stage, 40-84 px wide, never taller than the stage.
        const B = Math.round(Math.max(40, Math.min(84, W * 0.24, (SH - 2) / 0.75)))
        const BH = B * 0.75
        const bx = W - 4 - B
        bough.style.left = bx + 'px'
        bough.style.width = B + 'px'
        bough.style.height = BH + 'px'
        // Magpie: 46% of the bough, its feet on the perch point.
        const s = B / 80
        const k = (B * 0.46) / 40
        magpie.style.width = (40 * k) + 'px'
        magpie.style.height = (24 * k) + 'px'
        magpie.style.left = (bx + PERCH[0] * s - 15.5 * k).toFixed(1) + 'px'
        magpie.style.top = (PERCH[1] * s - 21 * k).toFixed(1) + 'px'
        // Greeting row = the brand row, always right of the mark so a running status mark never covers it.
        const left = off.wordX
        greetBox.style.left = left + 'px'
        greetBox.style.top = off.wordY + 'px'
        greetBox.style.height = h + 'px'
        greetBox.style.setProperty('--rt-sl-fs', fs + 'px')
        const rowBottom = Math.max(off.markY + (off.markSize || 0), off.wordY + h)
        wash.style.setProperty('--rt-sl-wash-h', Math.min(SH, Math.round(Math.max(rowBottom + 16, BH + 4))) + 'px')
        wash.style.setProperty('--rt-sl-mx', (off.markSize ? off.markX + off.markSize / 2 : -100).toFixed(1) + 'px')
        wash.style.setProperty('--rt-sl-my', (off.markSize ? off.markY + off.markSize / 2 : -100).toFixed(1) + 'px')
        G = { W, B, x: left, bx }
    }
    // The greeting starts at the word's left edge on every width. Its natural width is measured each fit (in the face it
    // currently uses). If a mid-play resize leaves less than 62% of it beside the props, the props are hidden
    // (rt-sl-squeezed) and it takes the rest of the row. If it would still shrink by more than 10%, the shorter phone copy
    // is used (the description keeps the full greeting).
    function fitGreeting(): void {
        if (!G.W) return
        greet.style.fontSize = ''
        greet.textContent = GREETING
        const natural = greet.scrollWidth || 0
        const squeezed = !narrow && state === 'playing' && (G.bx - 6 - G.x) < 0.62 * natural
        sky.classList.toggle('rt-sl-squeezed', squeezed)
        const max = narrow || squeezed ? G.W - G.x - 6 : G.bx - 6 - G.x
        if (natural * 0.9 > max) greet.textContent = SHORT
        if (max > 0) ctx.fitText(greet, max)
    }

    ctx.fonts.ready(FAMILY).then((ok) => {
        if (ok && state !== 'destroyed') fontOk = true
    }, () => {})

    function later(fn: () => void, ms: number): void {
        timers.push(ctx.setTimeout(fn, ms))
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
        for (const t of timers) ctx.clearTimeout(t)
        timers = []
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        sky.classList.add('rt-sl-final')
        mark?.classList.add('rt-sl-final')
        word.classList.add('rt-sl-final', 'rt-sl-warm')
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        const ease = o.ease
        const eased = ease ? frames.map((f) => (f.easing ? f : { ...f, easing: ease })) : frames
        let a: Animation
        try {
            a = node.animate(eased, { duration: o.d, delay: o.at || 0, easing: 'linear', fill: 'both' })
        } catch {
            return null
        }
        anims.push(a)
        return a
    }
    function q(sel: string): Element | null {
        return mark ? mark.querySelector(sel) : null
    }

    function timeline(): void {
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'
        narrow = ctx.stageWidth() < NARROW
        layoutStage()
        fitGreeting()

        // 0-800: the everyday wordmark steps back (and, on narrow stages, the everyday mark with it). One animation per
        // node (two fill:both animations on one node would override each other): out 0-800, back 6000-6800 (translateY
        // 0.12em to 0).
        add(every, [
            { opacity: 1, transform: 'translateY(0) scale(1)', easing: IN },
            { opacity: 0, transform: 'translateY(0) scale(0.96)', offset: 0.8 / 6.8 },
            { opacity: 0, transform: 'translateY(0.12em) scale(1)', offset: 6 / 6.8, easing: OUT },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { at: 0, d: 6800 })

        // 0-1000: a crisp dawn wash; it lifts 5400-6600.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 1 / 6.6 }, { opacity: 1, offset: 5.4 / 6.6 }, { opacity: 0 }], { at: 0, d: 6600, ease: INOUT })

        // Bough in 300-1500 from the top-right corner; out 5000-6000 (narrow: 2200-2700).
        const bOut = narrow ? 2200 : 5000
        const bOutD = narrow ? 500 : 1000
        add(bough, [
            { opacity: 0, transform: 'translateX(55%) rotate(-7deg)' },
            { opacity: 1, transform: 'translateX(0) rotate(1.5deg)', offset: 0.8 },
            { opacity: 1, transform: 'translateX(0) rotate(0deg)' },
        ], { at: 300, d: 1200, ease: OUT })
        add(boughSvg, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(40%)' }], { at: bOut, d: bOutD, ease: IN })

        // Magpie glides in from the upper right and perches, wings beating, then folds; one tail bob.
        const fly = narrow ? 900 : 1100
        const flyD = narrow ? 1100 : 1400
        add(magpieSvg, [
            { opacity: 0, transform: 'translate(170%, -150%) rotate(-10deg)' },
            { opacity: 1, transform: 'translate(115%, -105%) rotate(-12deg)', offset: 0.25 },
            { opacity: 1, transform: 'translate(55%, -55%) rotate(-6deg)', offset: 0.6 },
            { opacity: 1, transform: 'translate(10%, -10%) rotate(2deg)', offset: 0.88 },
            { opacity: 1, transform: 'translate(0, 0) rotate(0deg)' },
        ], { at: fly, d: flyD, ease: INOUT })
        const flap: Keyframe[] = []
        const beats = narrow ? 8 : 10
        for (let i = 0; i <= beats; i++) flap.push({ transform: 'scaleY(' + (i % 2 ? 0.3 : 1) + ')' })
        add(magpieSvg.querySelector('.rt-sl-mp-wing'), flap, { at: fly, d: flyD - 120, ease: 'ease-in-out' })
        add(magpieSvg.querySelector('.rt-sl-mp-tail'), [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)', offset: 0.4 }, { transform: 'rotate(0deg)' },
        ], { at: fly + flyD, d: 420, ease: INOUT })
        const mOut = narrow ? 2250 : 5000
        add(magpie, [
            { opacity: 1, transform: 'translate(0, 0)' },
            { opacity: 0, transform: 'translate(90%, -90%)' },
        ], { at: mOut, d: narrow ? 450 : 800, ease: IN })

        // 2700-5000: the greeting fades and scales in (0.96 to 1), holds, fades. Re-measured just before it enters.
        later(() => {
            if (state !== 'playing') return
            if (fontOk) {
                greet.classList.remove('rt-sl-fb')
                greet.classList.add('rt-sl-ebs')
            }
            layoutStage()
            fitGreeting()
        }, 2650)
        add(greet, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 2.3 },
            { opacity: 1, transform: 'scale(1)', offset: 1.8 / 2.3 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: 2700, d: 2300, ease: INOUT })

        if (mark) {
            // 3800-4100: the everyday triangle (in the slot since t = 0, so the slot is never empty) folds flat
            // (scaleY 1 to 0), as if turning over.
            add(q('.rt-sl-every'), [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 1, offset: 0.99 }, { transform: 'scaleY(0)', opacity: 0 }], { at: 3800, d: 300, ease: IN })
            // 4100-4700: the upright pouch opens out of the fold (scaleY 0 to 1.05 to 1).
            add(q('.rt-sl-pouch'), [
                { transform: 'scaleY(0)', opacity: 1 },
                { transform: 'scaleY(1.05)', opacity: 1, offset: 0.7 },
                { transform: 'scaleY(1)', opacity: 1 },
            ], { at: 4050, d: 650, ease: OUT })
            // 4600-5000: the gold band and knot tie on at the neck.
            add(q('.rt-sl-cord'), [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { at: 4600, d: 400, ease: OUT })
            // 4900-5800: the embroidered triangle is stitched (dashoffset 1 to 0); 5500-6000 mid and core fill.
            add(q('.rt-sl-stitch'), [{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1 }], { at: 4900, d: 900, ease: INOUT })
            add(q('.rt-sl-emb'), [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], { at: 5500, d: 500, ease: OUT })
        }

        // 6000-6800: the wordmark returns (above) with "Tanium" in warm ivory (switched while hidden, at 1200); 6400-7200
        // its gold edge comes up.
        later(() => {
            if (state === 'playing') word.classList.add('rt-sl-warm')
        }, 1200)
        add(edge, [{ opacity: 0 }, { opacity: 1 }], { at: 6400, d: 800, ease: OUT })
    }

    ctx.onRelayout(() => {
        if (state === 'playing') {
            layoutStage()
            fitGreeting()
        }
    })

    function play(): Promise<void> {
        if (state === 'destroyed') return Promise.resolve()
        if (state === 'final' || ctx.reduced) {
            applyFinal()
            return Promise.resolve()
        }
        if (playPromise && state === 'playing') return playPromise
        cancelAll()
        sky.classList.remove('rt-sl-final')
        mark?.classList.remove('rt-sl-final')
        word.classList.remove('rt-sl-final', 'rt-sl-warm')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        const mine = anims.slice()
        Promise.all(mine.map((a) => a.finished)).then(() => {
            if (state === 'playing' && anims.length && anims[0] === mine[0]) applyFinal()
        }, () => {})
        return playPromise
    }
    function finish(): void {
        if (state === 'destroyed') return
        applyFinal()
    }
    function destroy(): void {
        if (state === 'destroyed') return
        cancelAll()
        state = 'destroyed'
        sky.remove()
        mark?.remove()
        edge.remove()
        word.classList.remove('rt-sl-word', 'rt-sl-final', 'rt-sl-warm')
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'seollal',
    durationMs: DURATION,
    fonts: [{ family: FAMILY, url: FONT_URL, weight: 400, timeoutMs: 2500, sample: GREETING }],
    build,
}
export default scene
