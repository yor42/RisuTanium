// Seasonal scene: krNational (Mar 1 = variant samiljeol, Aug 15 = variant gwangbokjeol; lang ko).
//
// Dignified by design: no bounce, no confetti, no jokes; flag red #cd2e3a and blue #0047a0 with a light edge; trigrams exact;
// greeting in EBS Hunminjeongeum.
// Storyboard (6.5 s of motion, 6.8 s budget): the everyday wordmark steps back 0-0.8 s and returns 5.3-6.1 s; a wash 0-0.9 s
// (lifts 4.3-5.3 s); crimson and sapphire brush ribbons are written across the row 0.3-1.87 s and fade 2.1-2.7 s (Mar 1: one
// muted ink ribbon only); the greeting stands where the Taegeuk would, with the four trigrams around it, 2.3-4.3 s; the
// everyday triangle steps back 3.0-3.4 s and the frame is written in three brush strokes 3.1-4.5 s; the Taegeuk's two halves
// flow in from opposite sides and interlock 4.3-5.2 s; a rose of Sharon opens on the "u" 5.8-6.5 s.
// Final: brushed frame holding a Taegeuk, everyday wordmark with the flower on the "u", no sky.
// Motion is Web Animations only: transform and opacity, plus stroke-dashoffset (ribbons and the brush-stroke masks). Every
// easing is a plain ease-in/out with no overshoot. No filters, no loops. The final pose is static CSS under .rt-kn-final, so
// finish() gives the same pose from any point.
//
// Font: EBS Hunminjeongeum SemiBold (the SBA cut, the exact spec hangulDay uses) from the commit-pinned jsDelivr URL, loaded by
// the host from `fonts`. The greeting takes it only if ctx.fonts.ready() resolved true before it enters; otherwise the
// NanumSquare Neo fallback stack, with unchanged timing.
//
// Trigrams are placed as on the flag around the greeting, which stands where the Taegeuk would: heaven top-left, water
// top-right, fire bottom-left, earth bottom-right, on the diagonals of a 3:2 box, each with its bars perpendicular to its
// diagonal. All four trigrams are symmetric, so no bar order can be reversed.
import './krNational.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

type Variant = 'samiljeol' | 'gwangbokjeol'

const DURATION = 6800
const FAMILY = 'EBS Hunminjeongeum'
const FONT_URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_one@40fb96ceb772b1b734b9569ffbb91721309bdd2b/EBSHunminjeongeumSBA.woff'
const FONT_SAMPLE = '3·1절 광복절'
const TEXT: Record<Variant, string> = { samiljeol: '3·1절', gwangbokjeol: '광복절' }
const SVGNS = 'http://www.w3.org/2000/svg'

const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

type Stroke = [number, number, number, number]
// Brushed frame (as hangulDay's ink strokes): the frame's centre line in writing order, each stroke a static tapered brush
// shape revealed by a round-capped mask line (stroke-dashoffset).
const STROKES: Stroke[] = [[-42.94, -24.8, 42.94, -24.8], [-42.94, -24.8, 0, 49.59], [42.94, -24.8, 0, 49.59]]
const W0 = 5.6
const W1 = 7.6
function brushPath(p: Stroke): string {
    let dx = p[2] - p[0]
    let dy = p[3] - p[1]
    const L = Math.sqrt(dx * dx + dy * dy)
    dx /= L
    dy /= L
    const nx = dy
    const ny = -dx
    const f = (v: number): string => v.toFixed(2)
    return 'M' + f(p[0] + nx * W0) + ' ' + f(p[1] + ny * W0) +
        'L' + f(p[2] + nx * W1) + ' ' + f(p[3] + ny * W1) +
        'A' + W1 + ' ' + W1 + ' 0 0 1 ' + f(p[2] - nx * W1) + ' ' + f(p[3] - ny * W1) +
        'L' + f(p[0] - nx * W0) + ' ' + f(p[1] - ny * W0) +
        'A' + W0 + ' ' + W0 + ' 0 0 1 ' + f(p[0] + nx * W0) + ' ' + f(p[1] + ny * W0) + 'Z'
}
function linePath(p: Stroke): string {
    return 'M' + p[0] + ' ' + p[1] + 'L' + p[2] + ' ' + p[3]
}

// Taegeuk in the hole: a flag-style disc. The disc is the hole's incircle (scaled 1.12, r 19.42, centre (0, 0)); red above,
// blue below, divided by the flag's S of two semicircles of half the radius (red head on the left, blue head on the right).
// Drawn on a local axis and tilted 33.69 degrees along the heaven-earth diagonal of a 3:2 flag (TILT). The hole's three
// corners outside the disc are filled in the brush ink (CORNERS), so the mark reads as the brushed triangle holding a Taegeuk.
const TR = 19.42
const Tr = TR / 2
const RED = 'M' + (-TR) + ' 0A' + TR + ' ' + TR + ' 0 0 1 ' + TR + ' 0A' + Tr + ' ' + Tr + ' 0 0 0 0 0A' + Tr + ' ' + Tr + ' 0 0 1 ' + (-TR) + ' 0Z'
const BLUE = 'M' + (-TR) + ' 0A' + TR + ' ' + TR + ' 0 0 0 ' + TR + ' 0A' + Tr + ' ' + Tr + ' 0 0 0 0 0A' + Tr + ' ' + Tr + ' 0 0 1 ' + (-TR) + ' 0Z'
const TILT = 'rotate(33.69)'
const CLIP = 'M-33.63-19.42H33.63L0 38.84Z'
const CORNERS = CLIP + 'M' + (-TR) + ' 0A' + TR + ' ' + TR + ' 0 1 0 ' + TR + ' 0A' + TR + ' ' + TR + ' 0 1 0 ' + (-TR) + ' 0Z'

// Trigrams: bars along local x, stacked along local y (toward the centre). 1 = solid, 0 = broken.
type TrigramName = 'geon' | 'gon' | 'gam' | 'ri'
const TRIGRAMS: Record<TrigramName, number[]> = { geon: [1, 1, 1], gon: [0, 0, 0], gam: [0, 1, 0], ri: [1, 0, 1] }
function trigram(bits: number[], L: number, T: number, g: number, gap: number): string {
    let s = ''
    const y0 = -(3 * T + 2 * g) / 2
    bits.forEach((b, i) => {
        const y = y0 + i * (T + g)
        if (b) s += 'M' + (-L / 2) + ' ' + y + 'h' + L + 'v' + T + 'h' + (-L) + 'Z'
        else {
            const h = (L - gap) / 2
            s += 'M' + (-L / 2) + ' ' + y + 'h' + h + 'v' + T + 'h' + (-h) + 'Z' + 'M' + (gap / 2) + ' ' + y + 'h' + h + 'v' + T + 'h' + (-h) + 'Z'
        }
    })
    return s
}

// Rose of Sharon for the "u": five pale petals with the red centre and a stamen.
function mugunghwa(): string {
    let s = ''
    for (let i = 0; i < 5; i++) {
        const a = -90 + i * 72
        s += '<path class="rt-kn-mg-petal" transform="rotate(' + a + ' 12 12)" d="M12 12C14.2 9.6 18.6 7.4 21.4 9.2C23.6 10.8 22.6 14.6 19.6 15.2C17 15.8 14 14 12 12Z"/>'
    }
    for (let j = 0; j < 5; j++) {
        s += '<path class="rt-kn-mg-heart" transform="rotate(' + (-90 + j * 72) + ' 12 12)" d="M12 12C13.4 11 15.4 10.6 16.6 11.4C15.4 12.6 13.6 12.8 12 12Z"/>'
    }
    s += '<path class="rt-kn-mg-stamen" d="M12 12L10.2 6.4"/><circle class="rt-kn-mg-pollen" cx="10" cy="6" r="1.2"/>'
    return s
}

interface Geometry {
    W: number
    Wb: number
    Hb: number
    L: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-kn-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('krNational: svg markup did not parse')
    return n
}

function markMarkup(id: string): string {
    let s = '<defs><linearGradient id="' + id + '-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<clipPath id="' + id + '-disc"><circle r="' + TR + '"/></clipPath>'
    for (let i = 0; i < 3; i++) {
        s += '<mask id="' + id + '-m' + (i + 1) + '" maskUnits="userSpaceOnUse" x="-73" y="-66" width="146" height="146">' +
            '<path class="rt-kn-reveal" id="' + id + '-reveal' + (i + 1) + '" pathLength="1" d="' + linePath(STROKES[i]) + '"/></mask>'
    }
    s += '</defs>' +
        '<g class="rt-kn-every" id="' + id + '-every">' +
            '<path class="rt-kn-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-kn-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<path class="rt-kn-corners" id="' + id + '-corners" fill-rule="evenodd" d="' + CORNERS + '"/>' +
        '<g class="rt-kn-taegeuk" id="' + id + '-taegeuk" clip-path="url(#' + id + '-disc)">' +
            '<g transform="' + TILT + '">' +
                '<path class="rt-kn-red" id="' + id + '-red" d="' + RED + '"/>' +
                '<path class="rt-kn-blue" id="' + id + '-blue" d="' + BLUE + '"/>' +
            '</g>' +
        '</g>' +
        '<g class="rt-kn-ink" id="' + id + '-ink">'
    for (let k = 0; k < 3; k++) s += '<path class="rt-kn-brush" mask="url(#' + id + '-m' + (k + 1) + ')" d="' + brushPath(STROKES[k]) + '"/>'
    s += '</g>'
    return s
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const variant: Variant = ctx.variant === 'samiljeol' || ctx.variant === 'gwangbokjeol'
        ? ctx.variant
        : (ctx.date.getMonth() === 2 ? 'samiljeol' : 'gwangbokjeol')
    const text = TEXT[variant]
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let fontOk = false

    ctx.setDescription(text, 'ko')

    // ----- Stage -----
    const sky = el('div', 'rt-kn-sky rt-kn-' + variant)
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-kn-wash', sky)
    wash.id = id + '-wash'
    const ribbonSvg = svgFrom('<path class="rt-kn-rib rt-kn-rib-red" id="' + id + '-rib1" pathLength="1"/>' +
        '<path class="rt-kn-rib-dry rt-kn-rib-red" id="' + id + '-dry1" pathLength="1"/>' +
        '<path class="rt-kn-rib rt-kn-rib-blue" id="' + id + '-rib2" pathLength="1"/>' +
        '<path class="rt-kn-rib-dry rt-kn-rib-blue" id="' + id + '-dry2" pathLength="1"/>', 'rt-kn-ribbons', '0 0 100 100')
    ribbonSvg.id = id + '-ribbons'
    sky.appendChild(ribbonSvg)
    const ribs = Array.from(ribbonSvg.querySelectorAll('path'))
    const block = el('div', 'rt-kn-block', sky)
    block.id = id + '-block'
    const triSvg = svgFrom('', 'rt-kn-tri', '0 0 100 100')
    block.appendChild(triSvg)
    const greetBox = el('div', 'rt-kn-greetbox', block)
    greetBox.setAttribute('lang', 'ko')
    const greet = el('span', 'rt-kn-greet rt-kn-fb', greetBox)
    greet.id = id + '-greet'
    greet.textContent = text
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-kn-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: the everyday wordmark plus a small rose of Sharon resting on the "u" -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-kn-word')
    const flower = el('span', 'rt-kn-flower', word)
    flower.id = id + '-flower'
    flower.setAttribute('aria-hidden', 'true')
    const flowerSvg = svgFrom(mugunghwa(), 'rt-kn-flower-svg', '0 0 24 24')
    flower.appendChild(flowerSvg)
    function placeFlower(): void {
        if (state === 'destroyed') return
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        let x = 1.81
        const a = word.querySelector('.rt-sw-a')
        const t = a ? a.firstChild : null
        if (t && t.nodeType === Node.TEXT_NODE && document.createRange) {
            try {
                const n = (t.textContent ?? '').length
                const r = document.createRange()
                r.setStart(t, n - 1)
                r.setEnd(t, n)
                const rr = r.getBoundingClientRect()
                const wr = word.getBoundingClientRect()
                if (rr.width > 0) x = (rr.left + rr.width / 2 - wr.left) / fs
            } catch {
                // no range geometry: keep the measured default
            }
        }
        flower.style.setProperty('--rt-kn-ux', x.toFixed(3) + 'em')
    }
    function onFonts(): void {
        placeFlower()
    }
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts)

    // ----- Geometry -----
    let G: Geometry = { W: 0, Wb: 0, Hb: 0, L: 0 }
    function layoutStage(): void {
        if (state === 'destroyed') return
        const W = ctx.stageWidth()
        const SH = ctx.stageBox().height || ctx.stage.getBoundingClientRect().height || 96
        const off = ctx.stageOffset()
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const h = off.wordHeight || fs * 1.2
        const cy = off.wordY + h / 2
        const rowBottom = Math.max(off.markY + (off.markSize || 0), off.wordY + h)
        // Ribbons: two brush waves across the brand row, as wide as the stage.
        const amp = Math.min(10, h * 0.36)
        const x0 = Math.max(6, (off.markSize ? off.markX + off.markSize : 0) + 4)   // clear of the (status) mark
        const x1 = W - 6
        const wave = (phase: number, dy: number): string => {
            let d = 'M' + x0 + ' ' + (cy + dy).toFixed(1)
            const n = 3
            const seg = (x1 - x0) / n
            for (let i = 0; i < n; i++) {
                const sx = x0 + i * seg
                const sgn = (i + phase) % 2 ? 1 : -1
                d += 'C' + (sx + seg * 0.35).toFixed(1) + ' ' + (cy + dy + sgn * amp).toFixed(1) + ' ' + (sx + seg * 0.65).toFixed(1) + ' ' + (cy + dy + sgn * amp).toFixed(1) + ' ' + (sx + seg).toFixed(1) + ' ' + (cy + dy).toFixed(1)
            }
            return d
        }
        ribbonSvg.setAttribute('viewBox', '0 0 ' + Math.round(W) + ' ' + Math.round(SH))
        const one = variant === 'samiljeol'
        ribs[0].setAttribute('d', wave(0, one ? 0 : -2))
        ribs[1].setAttribute('d', wave(0, one ? -3 : -5))
        ribs[2].setAttribute('d', wave(1, 2))
        ribs[3].setAttribute('d', wave(1, 5))
        // Greeting block: a 3:2 box on the brand row from the word's left edge; trigrams on its diagonals.
        const Hb = Math.round(Math.min(SH - 10, Math.max(h + 28, 44), 76))
        const Wb = Math.round(Hb * 1.5)
        const bx = off.wordX - 2
        const by = Math.max(2, Math.min(cy - Hb / 2, SH - Hb - 2))
        block.style.left = bx + 'px'
        block.style.top = by + 'px'
        block.style.width = Wb + 'px'
        block.style.height = Hb + 'px'
        triSvg.setAttribute('viewBox', '0 0 ' + Wb + ' ' + Hb)
        const L = Math.max(8, Hb * 0.24)
        const T = Math.max(1.6, Hb * 0.05)
        const g = T * 0.8
        const gap = L * 0.16
        const k = 0.84
        const cx2 = Wb / 2
        const cy2 = Hb / 2
        // [name, sx, sy]: heaven top-left, water top-right, fire bottom-left, earth bottom-right (as on the flag).
        const spots: Array<[TrigramName, number, number]> = [['geon', -1, -1], ['gam', 1, -1], ['ri', -1, 1], ['gon', 1, 1]]
        let tri = ''
        for (const sp of spots) {
            const dx = sp[1] * Wb / 2
            const dy = sp[2] * Hb / 2
            const px = cx2 + k * dx
            const py = cy2 + k * dy
            // Stack axis (local y) along the diagonal; bars perpendicular to it.
            const ang = Math.atan2(dy, dx) * 180 / Math.PI - 90
            tri += '<path class="rt-kn-trigram rt-kn-tg-' + sp[0] + '" transform="translate(' + px.toFixed(2) + ' ' + py.toFixed(2) + ') rotate(' + ang.toFixed(2) + ')" d="' + trigram(TRIGRAMS[sp[0]], L, T, g, gap) + '"/>'
        }
        // Rebuild only when the geometry changed: the trigram paths carry animations during play.
        const sig = [Wb, Hb].join(',')
        if (triSvg.getAttribute('data-sig') !== sig) {
            const rebuilt = triSvg.querySelectorAll('path').length > 0
            triSvg.innerHTML = tri
            triSvg.setAttribute('data-sig', sig)
            if (rebuilt && state === 'playing') trigramAnims()
        }
        greetBox.style.setProperty('--rt-kn-fs', fs + 'px')
        wash.style.setProperty('--rt-kn-wash-h', Math.min(SH, Math.round(Math.max(rowBottom, by + Hb) + 14)) + 'px')
        wash.style.setProperty('--rt-kn-mx', (off.markSize ? off.markX + off.markSize / 2 : -100).toFixed(1) + 'px')
        wash.style.setProperty('--rt-kn-my', (off.markSize ? off.markY + off.markSize / 2 : -100).toFixed(1) + 'px')
        G = { W, Wb, Hb, L }
    }
    function fitGreeting(): void {
        if (!G.W) return
        // The trigrams sit on the diagonals at 84% of the half-box, above and below the text row, so the greeting may run to
        // about 78% of the box width before a glyph corner meets a trigram.
        ctx.fitText(greet, Math.max(10, G.Wb * 0.78))
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
        sky.classList.add('rt-kn-final')
        mark?.classList.add('rt-kn-final')
        word.classList.add('rt-kn-final')
        state = 'final'
        placeFlower()
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
    const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
    const IN = 'cubic-bezier(0.4, 0, 1, 1)'
    const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'
    // Trigram entrances (2500, 2620, 2740, 2860), at the current scene time if rebuilt mid-play.
    function trigramAnims(): void {
        const first = anims.length ? anims[0].currentTime : null
        const now = typeof first === 'number' ? first : 0
        triSvg.querySelectorAll('.rt-kn-trigram').forEach((n, i) => {
            const a = add(n, [{ opacity: 0 }, { opacity: 1 }], { at: 2500 + i * 120, d: 500, ease: OUT })
            if (a && now) a.currentTime = now
        })
    }

    function timeline(): void {
        layoutStage()
        fitGreeting()
        placeFlower()

        // Everyday wordmark: out 0-800, back 5300-6100 (one animation per node).
        add(every, [
            { opacity: 1, transform: 'translateY(0) scale(1)', easing: IN },
            { opacity: 0, transform: 'translateY(0) scale(0.96)', offset: 0.8 / 6.1 },
            { opacity: 0, transform: 'translateY(0.1em) scale(1)', offset: 5.3 / 6.1, easing: OUT },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { at: 0, d: 6100 })

        // 0-900: the wash; it lifts 4300-5300.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.9 / 5.3 }, { opacity: 1, offset: 4.3 / 5.3 }, { opacity: 0 }], { at: 0, d: 5300, ease: INOUT })

        // 300-1870: crimson and sapphire brush ribbons are written across the row (1300 ms each, staggered); all fade
        // 2100-2700, before the greeting block holds. Mar 1: one muted ink ribbon only (rib1 with its dry-brush trace), not
        // the bright twisted pair.
        ribs.forEach((r, i) => {
            if (variant === 'samiljeol' && i >= 2) return
            const at = 300 + (i >= 2 ? 180 : 0) + (i % 2 ? 90 : 0)
            const d = 2700 - at
            add(r, [
                { strokeDashoffset: 1, opacity: 1, easing: INOUT },
                { strokeDashoffset: 0, opacity: 1, offset: 1300 / d },
                { strokeDashoffset: 0, opacity: 1, offset: (2100 - at) / d, easing: IN },
                { strokeDashoffset: 0, opacity: 0 },
            ], { at, d })
        })

        // 2300-4300: the greeting stands where the Taegeuk would, with the four trigrams around it.
        later(() => {
            if (state !== 'playing') return
            if (fontOk) {
                greet.classList.remove('rt-kn-fb')
                greet.classList.add('rt-kn-ebs')
            }
            layoutStage()
            fitGreeting()
        }, 2250)
        add(greet, [
            { opacity: 0, transform: 'scale(0.97)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 2.0 },
            { opacity: 1, transform: 'scale(1)', offset: 1.5 / 2.0 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: 2300, d: 2000, ease: INOUT })
        trigramAnims()
        add(triSvg, [{ opacity: 1 }, { opacity: 0 }], { at: 3800, d: 500, ease: IN })

        if (mark) {
            // 3000-3400: the everyday triangle steps back; 3100-4500 the frame is written in three brush strokes.
            add(q('.rt-kn-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 3000, d: 400, ease: IN })
            for (let i = 0; i < 3; i++) {
                add(q('#' + id + '-reveal' + (i + 1)), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 3100 + i * 450, d: 520, ease: INOUT })
            }
            // 4300-5200: the Taegeuk's two halves flow in from opposite sides and interlock.
            add(q('.rt-kn-red'), [{ transform: 'translateX(-46px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { at: 4300, d: 800, ease: OUT })
            add(q('.rt-kn-blue'), [{ transform: 'translateX(46px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { at: 4400, d: 800, ease: OUT })
            add(q('.rt-kn-corners'), [{ opacity: 0 }, { opacity: 1 }], { at: 4200, d: 500, ease: OUT })
        }

        // 5800-6500: the flower opens on the "u" (opacity and a gentle 0.7 to 1 scale, no overshoot).
        add(flowerSvg, [{ opacity: 0, transform: 'scale(0.7) rotate(-18deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], { at: 5800, d: 700, ease: OUT })
    }

    ctx.onRelayout(() => {
        if (state === 'playing') {
            layoutStage()
            fitGreeting()
        }
        placeFlower()
    })

    function play(): Promise<void> {
        if (state === 'destroyed') return Promise.resolve()
        if (state === 'final' || ctx.reduced) {
            applyFinal()
            return Promise.resolve()
        }
        if (playPromise && state === 'playing') return playPromise
        cancelAll()
        sky.classList.remove('rt-kn-final')
        mark?.classList.remove('rt-kn-final')
        word.classList.remove('rt-kn-final')
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
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts)
        sky.remove()
        mark?.remove()
        flower.remove()
        word.classList.remove('rt-kn-word', 'rt-kn-final')
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'krNational',
    durationMs: DURATION,
    fonts: [{ family: FAMILY, url: FONT_URL, weight: 400, timeoutMs: 2500, sample: FONT_SAMPLE }],
    build,
}
export default scene
