// Seasonal scene: thanksgiving (the fourth Thursday of November; en).
//
// Storyboard (7.4 s budget, the last keyframe ends at 7.2 s): a warm amber-russet breeze wash 0-0.8 s (out 4.6-5.6 s) carries ten
// maple and oak leaves and three wheat stalks across the stage 0.1-4.7 s; "Happy Thanksgiving" fades in beside or below the word,
// or briefly in its place on narrow stages 0.9-4.2 s; the mark warms to cream and amber 2.0-2.6 s, a tied wheat sheaf slides out
// diagonally behind it 2.2-3.1 s, its stalks splay and the ears burst open 2.45-3.5 s, a maple leaf settles on the top-left
// vertex 3.1-3.9 s and the sheaf sways once 4.4-5.4 s; a small maple leaf falls onto the "T" 5.2-6.7 s and "Tanium" takes a
// copper-gold edge 5.6-6.4 s.
// Final: harvest-sheaf mark, copper-gold edge on "Tanium", maple leaf on the "T", no sky.
// No fonts. Motion is Web Animations only: transform and opacity (plus one ::after opacity). No filters, no loops. The final
// pose is static CSS under .rt-tg-final, so finish() gives the same pose from any point.
import './thanksgiving.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 7200 ms.
const DURATION = 7400
const CLOCK = 7200
const SVGNS = 'http://www.w3.org/2000/svg'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Harvest sheaf: five tied wheat stalks lying diagonally behind the mark, ears to the upper right and cut ends to the lower
// left, plus a maple leaf on the top-left vertex. Deliberately asymmetric: nothing rises from the top edge as a symmetric
// crown. The sheaf's local axis is "up" (-y); the group is turned 50 degrees clockwise about its tie crossing (0, -6), so the
// ears point up-right. Stalk angles splay about that crossing.
const SHEAF_AT = 'translate(0 -6) rotate(50)'
// Splay (deg), head distance and cut-end distance from the crossing (units).
const STALKS = [
    { s: -14, h: 84, b: 60 }, { s: -7, h: 90, b: 64 }, { s: 0, h: 96, b: 66 }, { s: 7, h: 90, b: 64 }, { s: 14, h: 84, b: 60 },
]
const EAR_LEN = 32          // ear length (units) from its base to the top grain
const TIE_Y = 40            // tie band position along the cut-end side (local +y)
const LEAF_AT = 'translate(-50 -40)'

// Leaves (viewBox -10 -10 20 20) and a wheat stalk (viewBox -7 -29 14 50).
const MAPLE = 'M0-9.5L2-5.2L5-6.6L4.2-2.2L8.8-3.2L6.7 0L8.2 1.6L3.2 2.6L3.7 5.2L.6 3.8V9.5H-.6V3.8L-3.7 5.2L-3.2 2.6L-8.2 1.6L-6.7 0L-8.8-3.2L-4.2-2.2L-5-6.6L-2-5.2Z'
const OAK = 'M0-9C2.5-9 2-6.5 3.5-6C5.5-5.5 4.5-3 4-2C6-2 6.2.5 4.3 1.2C5.5 2.5 4.5 4.5 2.5 4.3C2.5 6 1.5 7 .6 7V9.5H-.6V7C-1.5 7-2.5 6-2.5 4.3C-4.5 4.5-5.5 2.5-4.3 1.2C-6.2.5-6-2-4-2C-4.5-3-5.5-5.5-3.5-6C-2-6.5-2.5-9 0-9Z'
const WHEAT_STEM = 'M0 21C.4 10 .2 0 0-8'
const WHEAT_AWNS = 'M-2.4-9.6L-5.6-15M2.4-9.6L5.6-15M-2.4-13.2L-5-18.6M2.4-13.2L5-18.6M-2.4-16.8L-4-21.6M2.4-16.8L4-21.6M0-24V-28'
function wheatGrains(): string {
    let d = ''
    for (let i = 0; i < 4; i++) {
        const y = -6 - i * 3.6
        d += 'M-.4 ' + (y + 1) + 'C-3.6 ' + (y + .4) + '-4.2 ' + (y - 2.6) + '-2.4 ' + (y - 3.6) + 'C-1 ' + (y - 2.6) + '-.4 ' + (y - 1) + '-.4 ' + (y + 1) + 'Z'
        d += 'M.4 ' + (y + 1) + 'C3.6 ' + (y + .4) + ' 4.2 ' + (y - 2.6) + ' 2.4 ' + (y - 3.6) + 'C1 ' + (y - 2.6) + ' .4 ' + (y - 1) + ' .4 ' + (y + 1) + 'Z'
    }
    d += 'M0-19.4C-1.6-20.8-1.2-23.2 0-24C1.2-23.2 1.6-20.8 0-19.4Z'
    return d
}

const LEAF_COLORS = ['#d62b33', '#f59e0b', '#ea580c', '#ffd166', '#b45309']

type GreetMode = 'side' | 'below' | 'over'

interface Geom {
    W: number
    H: number
    wx: number
    wy: number
    ww: number
    wh: number
    cx: number
    cy: number
    wrapped: boolean
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
    fill?: FillMode
}

function sid(uid: string): string {
    return 'rt-tg-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('thanksgiving: svg markup did not parse')
    return n
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

function markMarkup(id: string): string {
    const defs = '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rt-tg-cu0"/><stop offset="1" class="rt-tg-cu1"/></linearGradient>'
    let sheaf = ''
    STALKS.forEach((st, i) => {
        // Straw from the cut end to the ear base; the ear (grains scaled 1.7 from the stage sprite) bursts about its base.
        const base = -(st.h - EAR_LEN)
        sheaf += '<g class="rt-tg-stalk" id="' + id + '-stalk' + (i + 1) + '" style="--rt-tg-a:' + st.s + 'deg">' +
            '<path class="rt-tg-straw" d="M0 ' + st.b + 'V' + (base + 2) + '"/>' +
            '<g transform="translate(0 ' + base + ')"><g class="rt-tg-ear" id="' + id + '-ear' + (i + 1) + '">' +
                '<g transform="translate(0 9) scale(1.7)"><path class="rt-tg-grain" d="' + wheatGrains() + '"/></g></g></g></g>'
    })
    sheaf += '<path class="rt-tg-tie" d="M-13 ' + TIE_Y + 'H13"/>'
    return '<defs>' + defs + '</defs>' +
        '<g transform="' + SHEAF_AT + '"><g class="rt-tg-sheaf" id="' + id + '-sheaf">' + sheaf + '</g></g>' +
        '<g class="rt-tg-every" id="' + id + '-every">' +
            '<path class="rt-tg-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-tg-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-tg-harvest" id="' + id + '-harvest">' +
            '<path class="rt-tg-body" d="' + HOLE + '"/>' +
            '<path class="rt-tg-frame" fill="url(#' + id + '-copper)" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-tg-mid" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g transform="' + LEAF_AT + '"><g class="rt-tg-markleaf" id="' + id + '-markleaf">' +
            '<g transform="rotate(-30) scale(1.9)"><path class="rt-tg-markleaf-shape" d="' + MAPLE + '"/></g></g></g>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let mode: GreetMode = 'side'

    // ----- Stage: breeze wash, leaves, wheat, greeting -----
    const sky = el('div', 'rt-tg-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-tg-wash', sky)
    wash.id = id + '-wash'
    const leaves: HTMLElement[] = []
    for (let i = 0; i < 10; i++) {
        const lf = el('i', 'rt-tg-leaf', sky)
        lf.id = id + '-leaf' + (i + 1)
        lf.appendChild(svgFrom('<path fill="' + LEAF_COLORS[i % 5] + '" d="' + (i % 2 ? OAK : MAPLE) + '"/>', 'rt-tg-leafsvg', '-10 -10 20 20'))
        leaves.push(lf)
    }
    const wheats: HTMLElement[] = []
    for (let w = 0; w < 3; w++) {
        const wh = el('i', 'rt-tg-wheat', sky)
        wh.id = id + '-wheat' + (w + 1)
        wh.appendChild(svgFrom('<path class="rt-tg-wstem" d="' + WHEAT_STEM + '"/><path class="rt-tg-wawn" d="' + WHEAT_AWNS + '"/><path class="rt-tg-wgrain" d="' + wheatGrains() + '"/>',
            'rt-tg-wheatsvg', '-7 -29 14 50'))
        wheats.push(wh)
    }
    const greet = el('div', 'rt-tg-greet', sky)
    greet.id = id + '-greet'
    const gA = el('span', 'rt-tg-greet-a', greet)
    gA.textContent = 'Happy'
    greet.appendChild(document.createTextNode(' '))
    const gB = el('span', 'rt-tg-greet-b', greet)
    gB.textContent = 'Thanksgiving'
    ctx.stage.appendChild(sky)

    // ----- Mark slot: warmed mark with a wheat sheaf behind it and a maple leaf on its corner -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-tg-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: copper-gold edge on "Tanium", maple leaf on the "T" -----
    const word = ctx.word
    word.classList.add('rt-tg-word')
    const tan = findLeafSpan(word, 'Tanium')
    if (tan) {
        tan.classList.add('rt-tg-tan')
        tan.setAttribute('data-rt-tg-text', 'Tanium')
    }
    const perch = el('span', 'rt-tg-perch', word)
    perch.id = id + '-perch'
    perch.setAttribute('aria-hidden', 'true')
    const perchFall = el('span', 'rt-tg-perch-fall', perch)
    perchFall.appendChild(svgFrom('<path class="rt-tg-perchleaf" d="' + MAPLE + '"/>', 'rt-tg-leafsvg', '-10 -10 20 20'))

    ctx.setDescription('Happy Thanksgiving!', 'en')

    function placePerch(): void {
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 2.55    // estimate when the "T" cannot be measured
        if (tan && tan.firstChild) {
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
        perch.style.setProperty('--rt-tg-tx', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        if (state !== 'destroyed') placePerch()
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
        sky.classList.toggle('rt-tg-final', on)
        mark?.classList.toggle('rt-tg-final', on)
        word.classList.toggle('rt-tg-final', on)
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
        setFinal(true)
        state = 'final'
        settle()
    }
    // With more than two keyframes the easing applies per segment (on each keyframe) and the effect stays linear, so the
    // keyframe offsets are real times (an effect-level easing would warp every hold).
    function add(node: Element | null, frames: Keyframe[], o: AddOptions, pseudo?: string): Animation | null {
        if (!node || !node.animate) return null
        const ease = o.ease || 'linear'
        const perSegment = frames.length > 2 && ease !== 'linear'
        const list = perSegment ? frames.map((f) => (f.easing ? f : { ...f, easing: ease })) : frames
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: perSegment ? 'linear' : ease, fill: o.fill || 'both' }
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
        const ms = off.markSize ? off.markSize : (ctx.markSlot ? ctx.markSlot.getBoundingClientRect().width : 0)
        const cx = ctx.markSlot ? off.markX + ms / 2 : off.wordX - 20
        const cy = ctx.markSlot ? off.markY + ms / 2 : off.wordY + off.wordHeight / 2
        return { W, H, wx: off.wordX, wy: off.wordY, ww: off.wordWidth, wh: off.wordHeight, cx, cy, wrapped: box.wrapped }
    }

    // Greeting placement, chosen from the live geometry: beside the word when it fits at >= 0.5em, below it when the stage has
    // room for >= 11 px text, otherwise in the word's place (the word fades out for 3 s).
    function placeGreeting(g: Geom): void {
        const cs = getComputedStyle(word)
        const wfs = parseFloat(cs.fontSize) || 24
        greet.style.fontFamily = cs.fontFamily
        greet.classList.remove('rt-tg-greet--2')
        gA.style.fontSize = ''
        gB.style.fontSize = ''
        const natural = (px: number): number => {
            greet.style.fontSize = px + 'px'
            return greet.getBoundingClientRect().width
        }
        const base = wfs * 0.62
        const sideX = g.wx + g.ww + 12
        const sideAvail = g.W - sideX - 8
        const n = natural(base)
        if (sideAvail >= n * (0.5 / 0.62)) {
            const fsS = Math.min(base, base * sideAvail / n)
            mode = 'side'
            greet.style.fontSize = fsS.toFixed(2) + 'px'
            const h = greet.getBoundingClientRect().height
            greet.style.left = sideX.toFixed(1) + 'px'
            greet.style.top = (g.wy + g.wh / 2 - h / 2).toFixed(1) + 'px'
            return
        }
        const belowY = g.wy + g.wh + 1
        const belowH = g.H - belowY - 2
        const fsB = Math.min(wfs * 0.55, belowH / 1.2, base * (g.W - g.wx - 6) / n)
        if (fsB >= 11) {
            mode = 'below'
            greet.style.fontSize = fsB.toFixed(2) + 'px'
            greet.style.left = g.wx.toFixed(1) + 'px'
            greet.style.top = belowY.toFixed(1) + 'px'
            return
        }
        // In place of the word: "Happy" small over a larger "Thanksgiving", fitted to the word's width and the stage.
        mode = 'over'
        greet.classList.add('rt-tg-greet--2')
        const maxW = Math.max(40, Math.min(g.W - g.wx - 6, g.ww + 14))
        greet.style.fontSize = wfs + 'px'
        gB.style.fontSize = wfs + 'px'
        const bw = gB.getBoundingClientRect().width || 1
        let fb = Math.min(wfs * 0.85, wfs * maxW / bw)
        let fa = fb * 0.62
        let th = fa * 1.1 + fb * 1.1
        if (th > g.H - 4) {
            const k = (g.H - 4) / th
            fa *= k
            fb *= k
            th *= k
        }
        gA.style.fontSize = fa.toFixed(2) + 'px'
        gB.style.fontSize = fb.toFixed(2) + 'px'
        greet.style.left = g.wx.toFixed(1) + 'px'
        greet.style.top = Math.max(1, Math.min(g.H - th - 1, g.wy + g.wh / 2 - th / 2)).toFixed(1) + 'px'
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

        add(sky, [], { d: CLOCK })    // scene clock (property-less), always anims[0]
        const g = geom()
        sky.classList.toggle('rt-tg-wrapped', g.wrapped)
        wash.style.setProperty('--rt-tg-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-tg-my', g.cy.toFixed(1) + 'px')
        // A soft elliptical hole over the word box so the wash never dims the wordmark.
        wash.style.setProperty('--rt-tg-wx', (g.wx + g.ww / 2).toFixed(1) + 'px')
        wash.style.setProperty('--rt-tg-wy', (g.wy + g.wh / 2).toFixed(1) + 'px')
        wash.style.setProperty('--rt-tg-rx', (g.ww / 2 + 40).toFixed(1) + 'px')
        wash.style.setProperty('--rt-tg-ry', (g.wh / 2 + 22).toFixed(1) + 'px')
        placeGreeting(g)
        sky.setAttribute('data-greet', mode)

        // 1. Breeze wash: in 0-800, holds, out 4600-5600.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.143 }, { opacity: 1, offset: 0.821 }, { opacity: 0 }], { d: 5600 })

        // 1b. Leaves ride the breeze left to right: wave in y, tumble (rotate) and flutter (scaleX).
        const LS = 14
        const starts = [100, 350, 600, 800, 1050, 1300, 1500, 1750, 1950, 2200]
        leaves.forEach((lf, i) => {
            const y = Math.max(LS / 2 + 1, Math.min(g.H - LS / 2 - 1, g.H * (0.12 + ((i * 0.37) % 0.78))))
            const amp = Math.min(10, g.H * 0.14) * (i % 2 ? 1 : -1)
            const size = 0.75 + ((i * 7) % 5) * 0.08
            lf.style.left = (-LS - 2) + 'px'
            lf.style.top = (y - LS / 2) + 'px'
            const X = g.W + LS * 2 + 4
            const spin = (i % 2 ? 1 : -1) * (300 + (i % 3) * 80)
            const f = (p: number, dy: number, r: number, sx: number): string =>
                'translate(' + (X * p).toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' + r.toFixed(0) + 'deg) scale(' + (size * sx).toFixed(2) + ',' + size.toFixed(2) + ')'
            add(lf, [
                { transform: f(0, 0, 0, 1), opacity: 1 },
                { transform: f(0.25, amp, spin * 0.25, -0.4), offset: 0.25 },
                { transform: f(0.5, -amp * 0.6, spin * 0.5, 1), offset: 0.5 },
                { transform: f(0.75, amp * 0.8, spin * 0.75, -0.5), offset: 0.75 },
                { transform: f(1, 0, spin, 1), opacity: 1 },
            ], { at: starts[i], d: 2300 + (i % 4) * 200, ease: 'linear' })
        })
        // 1c. Wheat stalks drift slower and lower, swaying.
        const wheatRuns = [[250, 0.72], [900, 0.5], [1600, 0.82]]
        wheatRuns.forEach((p, i) => {
            const wh = wheats[i]
            const hh = Math.min(30, g.H * 0.5)
            const y = Math.max(hh / 2 + 1, Math.min(g.H - hh / 2 - 1, g.H * p[1]))
            wh.style.left = '-14px'
            wh.style.top = (y - 15) + 'px'
            const X = g.W + 28
            const s = hh / 30
            add(wh, [
                { transform: 'translate(0px,0px) rotate(-28deg) scale(' + s.toFixed(2) + ')' },
                { transform: 'translate(' + (X * 0.35).toFixed(1) + 'px,-4px) rotate(14deg) scale(' + s.toFixed(2) + ')', offset: 0.35 },
                { transform: 'translate(' + (X * 0.7).toFixed(1) + 'px,3px) rotate(-16deg) scale(' + s.toFixed(2) + ')', offset: 0.7 },
                { transform: 'translate(' + X.toFixed(1) + 'px,0px) rotate(24deg) scale(' + s.toFixed(2) + ')' },
            ], { at: p[0], d: 3000, ease: 'linear' })
        })

        // 1d. Greeting: in 900-1500, holds, out 3400-4000 (over mode: the word gives way 800-1200 and returns 3700-4200).
        add(greet, [
            { opacity: 0, transform: 'translateY(3px) scale(0.96)' },
            { opacity: 1, transform: 'translateY(0px) scale(1)', offset: 0.194 },
            { opacity: 1, transform: 'translateY(0px) scale(1)', offset: 0.806 },
            { opacity: 0, transform: 'translateY(-2px) scale(0.98)' },
        ], { at: 900, d: 3100, ease: EASE })
        if (mode === 'over') {
            add(word, [
                { opacity: 1 }, { opacity: 0, offset: 0.118 }, { opacity: 0, offset: 0.853 }, { opacity: 1 },
            ], { at: 800, d: 3400, ease: EASE })
        }

        if (mark) {
            const m = mark
            const q = (s: string): Element | null => m.querySelector(s)
            // 2. The mark warms (2000-2600); the sheaf slides out along its axis from behind the frame (2200-3100).
            add(q('.rt-tg-harvest'), [{ opacity: 0 }, { opacity: 1 }], { at: 2000, d: 600, ease: 'ease-out' })
            add(q('.rt-tg-every'), [{ opacity: 1 }, { opacity: 0 }], { at: 2150, d: 450, ease: EASE_IN })
            add(q('.rt-tg-sheaf'), [
                { transform: 'translate(0px, 34px) rotate(0deg) scale(0.6)', opacity: 0 },
                { transform: 'translate(0px, -3px) rotate(0deg) scale(1.03)', opacity: 1, offset: 0.7 },
                { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
            ], { at: 2200, d: 900, ease: EASE_OUT })
            // 2b. Stalks splay from the bundle, outer ones last (2450-3390); ears burst open in turn (2750-3710).
            STALKS.forEach((st, i) => {
                const order = Math.abs(i - 2)
                if (st.s) {
                    add(q('#' + id + '-stalk' + (i + 1)), [
                        { transform: 'rotate(0deg)' },
                        { transform: 'rotate(' + (st.s * 1.15).toFixed(1) + 'deg)', offset: 0.7 },
                        { transform: 'rotate(' + st.s + 'deg)' },
                    ], { at: 2450 + order * 120, d: 700, ease: EASE_OUT })
                }
                add(q('#' + id + '-ear' + (i + 1)), [
                    { transform: 'scale(0.3)', opacity: 0 },
                    { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
                    { transform: 'scale(1)', opacity: 1 },
                ], { at: 2750 + i * 90, d: 600, ease: EASE_OUT })
            })
            // 2c. A maple leaf tumbles onto the top-left vertex (3100-3900).
            add(q('.rt-tg-markleaf'), [
                { transform: 'translate(-26px, -30px) rotate(-140deg) scale(0.4)', opacity: 0 },
                { transform: 'translate(3px, 2px) rotate(12deg) scale(1.05)', opacity: 1, offset: 0.7 },
                { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
            ], { at: 3100, d: 800, ease: EASE_OUT })
            // 2d. The sheaf sways once about its tie crossing (4400-5400); forwards fill only, so it never masks the slide-in.
            add(q('.rt-tg-sheaf'), [
                { transform: 'translate(0px, 0px) rotate(0deg) scale(1)' },
                { transform: 'translate(0px, 0px) rotate(-4deg) scale(1)', offset: 0.3 },
                { transform: 'translate(0px, 0px) rotate(3deg) scale(1)', offset: 0.65 },
                { transform: 'translate(0px, 0px) rotate(0deg) scale(1)' },
            ], { at: 4400, d: 1000, ease: 'ease-in-out', fill: 'forwards' })
        }

        // 3. A small maple leaf falls onto the "T" (5200-6700), swaying.
        placePerch()
        add(perchFall, [
            { transform: 'translate(1.1em, -1.5em) rotate(-70deg) scale(0.8)', opacity: 0 },
            { transform: 'translate(0.45em, -1.15em) rotate(15deg) scale(0.9)', opacity: 1, offset: 0.22 },
            { transform: 'translate(0.75em, -0.7em) rotate(-40deg) scale(0.95)', opacity: 1, offset: 0.48 },
            { transform: 'translate(0.12em, -0.25em) rotate(12deg) scale(1)', opacity: 1, offset: 0.74 },
            { transform: 'translate(0em, 0.03em) rotate(-4deg) scale(1)', opacity: 1, offset: 0.9 },
            { transform: 'translate(0em, 0em) rotate(0deg) scale(1)', opacity: 1 },
        ], { at: 5200, d: 1500, ease: EASE })

        // 4. "Tanium" copper-gold edge (an ::after copy behind the glyphs; only its opacity animates) 5600-6400.
        const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
        if (tan && pseudoOk) add(tan, [{ opacity: 0 }, { opacity: 0.9 }], { at: 5600, d: 800, ease: EASE_OUT }, '::after')
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
            placePerch()
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
        perch.remove()
        word.classList.remove('rt-tg-word', 'rt-tg-final')
        if (tan) {
            tan.classList.remove('rt-tg-tan')
            tan.removeAttribute('data-rt-tg-text')
        }
        ctx.setDescription('')
        settle()
    }

    placePerch()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'thanksgiving',
    durationMs: DURATION,
    build,
}
export default scene
