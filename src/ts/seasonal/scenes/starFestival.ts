// Seasonal scene: starFestival (ja solar Jul 7 七夕; ko dangi lunar 7/7 칠석; cn/zh/zh-Hant chinese lunar 7/7 七夕).
//
// Story: Altair (cyan) rises from the mark and Vega (warm) from the far side; they travel the two halves of a stardust bridge
// and meet at its apex, above the join of "Risu" and "Tanium". The triangle becomes the Summer Triangle as a constellation
// prism: Deneb top-left, Vega top-right, Altair at the bottom vertex, joined by dashed lines, with a faint Milky Way crossing
// between Vega and Altair. Final: "Risu" in Altair cyan, "Tanium" in Vega amber-white, a tiny twin-star arc between "u" and "T".
// Per language: ko and zh build the bridge with small magpie chevrons (오작교 / 鵲橋); ja keeps pure stardust (天の川) and hangs a
// tiny tanzaku wish strip from the arc in the final pose. Other languages: stardust only.
//
// Motion is Web Animations only: transform, opacity and stroke-dashoffset. No filters, no loops. The final pose is static CSS
// under .rt-tnb-final, so finish() gives the same pose from any point. No web font.
import './starFestival.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 7200 ms.
const DURATION = 7400
const SVGNS = 'http://www.w3.org/2000/svg'

// Brand mark geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const OUTER = 'M-55.85-32.25H55.85L0 64.49Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// The Summer Triangle on the outer vertices: Deneb top-left, Vega top-right, Altair bottom.
const STARS = [
    { name: 'deneb', x: -55.85, y: -32.25, at: 2900 },
    { name: 'vega', x: 55.85, y: -32.25, at: 3150 },
    { name: 'altair', x: 0, y: 64.49, at: 3400 },
]
const SPARKLE = 'M0-10C1-2.2 2.2-1 10 0C2.2 1 1 2.2 0 10C-1 2.2-2.2 1-10 0C-2.2-1-1-2.2 0-10Z'
// Milky Way through Deneb, crossing the Vega-Altair edge (clipped to the triangle).
const MILKY = 'M-70-44C-30-22 10 4 62 38'
const MAGPIE = 'M0 5.2L4.2 1.4L8.4 5.2M3.2 2.4L4.2 4.2L5.2 2.4'

type Pt = [number, number]

interface AddOptions {
    d: number
    at?: number
    ease?: string
    fill?: FillMode
}

interface WordEm {
    /** Centre of "u" (last letter of Risu), em from the word box's left edge. */
    u: number
    /** Centre of "T" (first of Tanium). */
    T: number
    fs: number
}

interface Geom {
    W: number
    H: number
    wrapped: boolean
    wr: { x: number, y: number, w: number, h: number }
    cx: number
    cy: number
    mw: number
}

interface Half {
    p0: Pt
    c: Pt
    p1: Pt
}

function sid(uid: string): string {
    return 'rt-tnb-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('starFestival: svg markup did not parse')
    return n
}

// Markup the scene itself just wrote, so a miss is a programming error.
function need<T extends Element>(root: ParentNode, sel: string): T {
    const n = root.querySelector<T>(sel)
    if (!n) throw new Error('starFestival: missing ' + sel)
    return n
}

function sparkleSvg(cls: string): SVGSVGElement {
    return svgFrom('<path class="rt-tnb-spk" d="' + SPARKLE + '"/><circle class="rt-tnb-spk-core" r="2.2"/>', cls, '-11 -11 22 22')
}

function textNodeOf(root: Element, cls: string): Text | null {
    const s = root.querySelector('.' + cls)
    const t = s ? s.firstChild : null
    return t instanceof Text ? t : null
}

function markMarkup(id: string): string {
    const stars = STARS.map((s) =>
        '<g transform="translate(' + s.x + ' ' + s.y + ')"><g class="rt-tnb-vstar rt-tnb-' + s.name + '" id="' + id + '-' + s.name + '">' +
        '<circle class="rt-tnb-vhalo" r="15" fill="url(#' + id + '-halo-' + s.name + ')"/>' +
        '<path class="rt-tnb-vspk" transform="scale(1.5)" d="' + SPARKLE + '"/><circle class="rt-tnb-vcore" r="3.2"/></g></g>').join('')
    function halo(name: string, c: string): string {
        return '<radialGradient id="' + id + '-halo-' + name + '"><stop offset="0" stop-color="' + c + '" stop-opacity="0.75"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>'
    }
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-prism" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="rt-tnb-p0"/><stop offset="1" class="rt-tnb-p1"/></linearGradient>' +
        halo('deneb', '#e7f0ff') + halo('vega', '#ffb38a') + halo('altair', '#38d9ff') +
        '<clipPath id="' + id + '-tri"><path d="' + OUTER + '"/></clipPath>' +
        '<mask id="' + id + '-reveal" maskUnits="userSpaceOnUse" x="-80" y="-80" width="160" height="170">' +
            '<path class="rt-tnb-reveal" pathLength="300" d="' + OUTER + '"/></mask>' +
        '</defs>' +
        '<g class="rt-tnb-every" id="' + id + '-every">' +
            '<path class="rt-tnb-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-tnb-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-tnb-prism" id="' + id + '-prism">' +
            '<path class="rt-tnb-prismfill" fill="url(#' + id + '-prism)" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-tnb-holeedge" d="' + HOLE + '"/>' +
            '<path class="rt-tnb-mid" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-tnb-milky" id="' + id + '-milky" clip-path="url(#' + id + '-tri)">' +
            '<path class="rt-tnb-milkyband" d="' + MILKY + '"/><path class="rt-tnb-milkydust" d="' + MILKY + '"/></g>' +
        '<g mask="url(#' + id + '-reveal)"><path class="rt-tnb-dash" id="' + id + '-dash" d="' + OUTER + '"/></g>' +
        stars
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const lang = String(ctx.lang || '')
    const ja = lang === 'ja'
    const magpies = lang === 'ko' || lang === 'cn' || lang === 'zh' || lang === 'zh-Hant'
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage: indigo night, the stardust bridge, Altair and Vega -----
    const sky = el('div', 'rt-tnb-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const night = el('div', 'rt-tnb-night', sky)
    night.id = id + '-night'
    const bridge = svgFrom('<defs><linearGradient id="' + id + '-river" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">' +
            '<stop offset="0" class="rt-tnb-r0"/><stop offset="1" class="rt-tnb-r1"/></linearGradient></defs>' +
            '<path class="rt-tnb-band rt-tnb-band-l" pathLength="100"/><path class="rt-tnb-band rt-tnb-band-r" pathLength="100"/>' +
            '<path class="rt-tnb-dust rt-tnb-dust-l" pathLength="100"/><path class="rt-tnb-dust rt-tnb-dust-r" pathLength="100"/>',
        'rt-tnb-bridge', '0 0 100 100')
    bridge.id = id + '-bridge'
    sky.appendChild(bridge)
    const bandL = need<SVGPathElement>(bridge, '.rt-tnb-band-l')
    const bandR = need<SVGPathElement>(bridge, '.rt-tnb-band-r')
    const dustL = need<SVGPathElement>(bridge, '.rt-tnb-dust-l')
    const dustR = need<SVGPathElement>(bridge, '.rt-tnb-dust-r')
    const river = need<SVGLinearGradientElement>(bridge, 'linearGradient')
    bandL.style.stroke = 'url(#' + id + '-river)'
    bandR.style.stroke = 'url(#' + id + '-river)'
    const birds: HTMLElement[] = []
    if (magpies) {
        for (let b = 0; b < 8; b++) {
            const bw = el('div', 'rt-tnb-magpie', sky)
            bw.id = id + '-magpie' + (b + 1)
            bw.appendChild(svgFrom('<path d="' + MAGPIE + '"/>', 'rt-tnb-magpiesvg', '0 0 8.4 6.4'))
            birds.push(bw)
        }
    }
    const altair = el('div', 'rt-tnb-star rt-tnb-star-altair', sky)
    altair.id = id + '-altair'
    altair.appendChild(sparkleSvg('rt-tnb-starsvg'))
    const vega = el('div', 'rt-tnb-star rt-tnb-star-vega', sky)
    vega.id = id + '-vega'
    vega.appendChild(sparkleSvg('rt-tnb-starsvg'))
    const flash = el('div', 'rt-tnb-flash', sky)
    flash.id = id + '-flash'
    ctx.stage.appendChild(sky)

    // ----- Mark slot: the Summer Triangle as a constellation prism -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-tnb-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: Altair/Vega colours, twin-star arc, tanzaku (ja) -----
    const word = ctx.word
    word.classList.add('rt-tnb-word')
    const risu = word.querySelector<HTMLElement>('.rt-sw-a')
    const tan = word.querySelector<HTMLElement>('.rt-sw-b')
    if (risu) {
        risu.classList.add('rt-tnb-risu')
        risu.setAttribute('data-rt-tnb-text', risu.textContent || '')
    }
    if (tan) {
        tan.classList.add('rt-tnb-tan')
        tan.setAttribute('data-rt-tnb-text', tan.textContent || '')
    }
    const arc = el('span', 'rt-tnb-arc', word)
    arc.id = id + '-arc'
    arc.setAttribute('aria-hidden', 'true')
    const arcSvg = svgFrom('<path class="rt-tnb-arcline" pathLength="100"/>' +
        '<g class="rt-tnb-arcstar rt-tnb-arcstar-a"><path d="' + SPARKLE + '"/></g>' +
        '<g class="rt-tnb-arcstar rt-tnb-arcstar-v"><path d="' + SPARKLE + '"/></g>', 'rt-tnb-arcsvg', '0 0 100 62')
    arc.appendChild(arcSvg)
    const arcLine = need<SVGPathElement>(arcSvg, '.rt-tnb-arcline')
    const arcA = need<SVGGElement>(arcSvg, '.rt-tnb-arcstar-a')
    const arcV = need<SVGGElement>(arcSvg, '.rt-tnb-arcstar-v')
    let tanzaku: HTMLElement | null = null
    let tanzakuSwing: HTMLElement | null = null
    if (ja) {
        tanzaku = el('span', 'rt-tnb-tanzaku', word)
        tanzaku.id = id + '-tanzaku'
        tanzaku.setAttribute('aria-hidden', 'true')
        tanzakuSwing = el('span', 'rt-tnb-tanzaku-swing', tanzaku)
        tanzakuSwing.appendChild(svgFrom('<path class="rt-tnb-string" d="M5 0V5"/><rect class="rt-tnb-paper" x="1" y="5" width="8" height="21" rx="0.6"/>' +
            '<path class="rt-tnb-wish" d="M5 9.5V13.5M5 16V21.5"/>', 'rt-tnb-tanzakusvg', '0 0 10 27'))
    }

    if (lang === 'ko') ctx.setDescription('견우와 직녀가 만나는 칠석이에요.', 'ko')
    else if (ja) ctx.setDescription('七夕です。願いが届きますように。', 'ja')
    else if (lang === 'cn' || lang === 'zh') ctx.setDescription('七夕快乐！', 'zh-Hans')
    else if (lang === 'zh-Hant') ctx.setDescription('七夕快樂！', 'zh-Hant')

    // Word geometry in em: centres of "u" and "T"; the constants are the estimates used until the glyphs can be measured.
    let W_EM: WordEm = { u: 2.04, T: 2.62, fs: 24 }
    function measureWord(): WordEm {
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const wr = word.getBoundingClientRect()
        function centre(cls: string, i: number, fallback: number): number {
            const tn = textNodeOf(word, cls)
            if (!tn || tn.length <= i || !document.createRange) return fallback
            try {
                const r = document.createRange()
                r.setStart(tn, i)
                r.setEnd(tn, i + 1)
                const cr = r.getBoundingClientRect()
                return cr.width > 0 ? (cr.left + cr.width / 2 - wr.left) / fs : fallback
            } catch {
                return fallback
            }
        }
        W_EM = { u: centre('rt-sw-a', 3, 2.04), T: centre('rt-sw-b', 0, 2.62), fs }
        return W_EM
    }
    // Arc: a span from the "u" centre to the "T" centre, top -0.5em, 0.62em tall; viewBox units are 1/100 em.
    const ARC = { top: -0.5, h: 0.62, endY: 56, ctrlY: -12 }
    function arcY(t: number): number {
        return (1 - t) * (1 - t) * ARC.endY + 2 * (1 - t) * t * ARC.ctrlY + t * t * ARC.endY
    }
    function placeWord(): void {
        const m = measureWord()
        const w = Math.max(0.2, m.T - m.u)
        const wu = Math.round(w * 100)
        arc.style.left = m.u.toFixed(3) + 'em'
        arc.style.width = w.toFixed(3) + 'em'
        arcSvg.setAttribute('viewBox', '0 0 ' + wu + ' 62')
        arcLine.setAttribute('d', 'M0 ' + ARC.endY + 'Q' + (wu / 2) + ' ' + ARC.ctrlY + ' ' + wu + ' ' + ARC.endY)
        arcA.setAttribute('transform', 'translate(0 ' + ARC.endY + ') scale(0.9)')
        arcV.setAttribute('transform', 'translate(' + wu + ' ' + ARC.endY + ') scale(0.9)')
        if (tanzaku) {
            const t = 0.66
            const x = m.u + w * t
            const y = ARC.top + arcY(t) / 100
            tanzaku.style.left = (x - 0.075).toFixed(3) + 'em'
            tanzaku.style.top = y.toFixed(3) + 'em'
        }
    }
    function onFonts(): void {
        if (state !== 'destroyed') placeWord()
    }
    document.fonts?.addEventListener('loadingdone', onFonts)

    // The host pauses subtree animations while hidden; this only resumes what it paused itself.
    let pausedByMe: Animation[] = []
    function onVis(): void {
        if (state !== 'playing') {
            pausedByMe = []
            return
        }
        if (document.hidden) {
            for (const a of anims) {
                if (a.playState === 'running') {
                    a.pause()
                    pausedByMe.push(a)
                }
            }
        } else {
            const list = pausedByMe
            pausedByMe = []
            for (const a of list) {
                try {
                    if (a.playState === 'paused') a.play()
                } catch {
                    // already finished or cancelled
                }
            }
        }
    }
    document.addEventListener('visibilitychange', onVis)

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
        sky.classList.toggle('rt-tnb-final', on)
        mark?.classList.toggle('rt-tnb-final', on)
        word.classList.toggle('rt-tnb-final', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        placeWord()
        setFinal(true)
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions, pseudo?: string): Animation | null {
        if (!node || !node.animate) return null
        const opts: KeyframeAnimationOptions = { duration: o.d, delay: o.at || 0, easing: o.ease || 'linear', fill: o.fill || 'both' }
        if (pseudo) opts.pseudoElement = pseudo
        let a: Animation
        try {
            a = node.animate(frames, opts)
        } catch {
            return null
        }
        anims.push(a)
        return a
    }
    function rel(node: Element): { x: number, y: number, w: number, h: number } {
        const s = ctx.stage.getBoundingClientRect()
        const r = node.getBoundingClientRect()
        return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
    }
    function geom(): Geom {
        const box = ctx.stageBox()
        const s = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : s.width
        const H = box.height ? box.height : s.height
        const origin = ctx.markSlot ? rel(ctx.markSlot) : null
        const wr = rel(word)
        return {
            W,
            H,
            wrapped: box.wrapped,
            wr,
            cx: origin ? origin.x + origin.w / 2 : wr.x - 14,
            cy: origin ? origin.y + origin.h / 2 : wr.y + wr.h / 2,
            mw: origin ? origin.w : 0,
        }
    }

    function timeline(): void {
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const POP = 'cubic-bezier(0.34, 1.4, 0.64, 1)'
        const g = geom()
        const m = measureWord()
        placeWord()
        const W = g.W
        const H = Math.max(40, g.H)
        const band = g.wrapped ? H : Math.min(H, 64)
        const fs = m.fs
        sky.classList.toggle('rt-tnb-wrapped', g.wrapped)
        night.style.setProperty('--rt-tnb-mx', g.cx.toFixed(1) + 'px')
        night.style.setProperty('--rt-tnb-my', g.cy.toFixed(1) + 'px')

        // Scene clock (property-less), always anims[0].
        add(sky, [], { d: 7200 })

        // 1. Night: 0-700 in, full until 4600, out by 6200.
        add(night, [{ opacity: 0 }, { opacity: 1, offset: 0.113 }, { opacity: 1, offset: 0.742 }, { opacity: 0 }], { d: 6200 })

        // 1b. Bridge geometry: two quadratic halves meeting at the apex above the u/T join, horizontal at the apex.
        const ax = g.wr.x + ((m.u + m.T) / 2) * fs
        const ay = Math.max(5, band * 0.12)
        // Starts just right of the mark, never over it.
        const x0 = Math.max(4, g.cx + g.mw / 2 + 4)
        const x1 = W - 8
        const yE = Math.min(band - 6, g.wr.y + g.wr.h - 2)
        function half(xs: number): Half {
            return { p0: [xs, yE], c: [ax - (ax - xs) * 0.5, ay], p1: [ax, ay] }
        }
        const L = half(x0)
        const R = half(x1)
        function q(hb: Half, t: number): Pt {
            const u = 1 - t
            return [u * u * hb.p0[0] + 2 * u * t * hb.c[0] + t * t * hb.p1[0], u * u * hb.p0[1] + 2 * u * t * hb.c[1] + t * t * hb.p1[1]]
        }
        function d(hb: Half): string {
            return 'M' + hb.p0[0].toFixed(1) + ' ' + hb.p0[1].toFixed(1) + 'Q' + hb.c[0].toFixed(1) + ' ' + hb.c[1].toFixed(1) + ' ' + hb.p1[0].toFixed(1) + ' ' + hb.p1[1].toFixed(1)
        }
        bridge.setAttribute('viewBox', '0 0 ' + Math.round(W) + ' ' + Math.round(H))
        river.setAttribute('x1', x0.toFixed(1))
        river.setAttribute('x2', x1.toFixed(1))
        for (const p of [bandL, dustL]) p.setAttribute('d', d(L))
        for (const p of [bandR, dustR]) p.setAttribute('d', d(R))
        // Each half draws from its outer end to the apex, 700-3300 (left) and 900-3300 (right).
        add(bandL, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { at: 700, d: 2600, ease: EASE })
        add(bandR, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { at: 900, d: 2400, ease: EASE })
        // Stardust appears behind the drawing fronts, then drifts slowly toward the apex (shimmer), 1500-5200.
        add(dustL, [{ opacity: 0, strokeDashoffset: 0 }, { opacity: 1, strokeDashoffset: -6, offset: 0.4 }, { opacity: 1, strokeDashoffset: -15 }], { at: 1500, d: 3700, ease: 'linear' })
        add(dustR, [{ opacity: 0, strokeDashoffset: 0 }, { opacity: 1, strokeDashoffset: -6, offset: 0.4 }, { opacity: 1, strokeDashoffset: -15 }], { at: 1600, d: 3600, ease: 'linear' })
        // The whole bridge fades 4800-6000.
        add(bridge, [{ opacity: 1 }, { opacity: 0 }], { at: 4800, d: 1200, ease: EASE })

        // 1c. Magpies (ko, zh) land along the bridge from both ends, 1400-3200; they leave with it.
        birds.forEach((bw, i) => {
            const hb = i % 2 ? R : L
            const k = Math.floor(i / 2)
            const t = 0.18 + k * 0.2
            const p = q(hb, t)
            const size = g.wrapped ? 7 : 9
            bw.style.width = size + 'px'
            bw.style.height = (size * 6.4 / 8.4).toFixed(1) + 'px'
            bw.style.left = (p[0] - size / 2).toFixed(1) + 'px'
            bw.style.top = (p[1] - size * 0.55).toFixed(1) + 'px'
            const at = 1400 + k * 380 + (i % 2) * 120
            add(bw, [{ transform: 'translateY(-8px) scale(0.3)', opacity: 0 }, { transform: 'translateY(1px) scale(1.1)', opacity: 1, offset: 0.7 }, { transform: 'translateY(0px) scale(1)', opacity: 1 }], { at, d: 500, ease: EASE_OUT })
            add(bw.firstElementChild, [{ opacity: 1 }, { opacity: 0 }], { at: 4700, d: 900, ease: EASE })
        })

        // 1d. Altair and Vega ride the drawing fronts, meet at the apex (3300), flash once, then descend to the ends of the
        //     word's twin-star arc and hand over to it (3700-4800).
        const S = g.wrapped ? 12 : 15
        for (const st of [altair, vega]) {
            st.style.width = S + 'px'
            st.style.height = S + 'px'
            st.style.left = (-S / 2) + 'px'
            st.style.top = (-S / 2) + 'px'
        }
        function tr(p: Pt, s: number): string {
            return 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) scale(' + s + ')'
        }
        function ride(hb: Half, startAt: number, dur: number): { frames: Keyframe[], at: number, d: number } {
            const frames: Keyframe[] = []
            for (let k = 0; k <= 8; k++) {
                // Follows the ease of the band draw roughly.
                const t = k / 8
                const e = 1 - Math.pow(1 - t, 1.6)
                frames.push({ transform: tr(q(hb, e), k === 0 ? 0.4 : 1), opacity: k === 0 ? 0 : 1, offset: t })
            }
            return { frames, at: startAt, d: dur }
        }
        const rA = ride(L, 700, 2600)
        const rV = ride(R, 900, 2400)
        add(altair, rA.frames, { at: rA.at, d: rA.d, ease: 'linear' })
        add(vega, rV.frames, { at: rV.at, d: rV.d, ease: 'linear' })
        const apexA: Pt = [ax - S * 0.42, ay]
        const apexV: Pt = [ax + S * 0.42, ay]
        const tA: Pt = [g.wr.x + m.u * fs, g.wr.y + (ARC.top + ARC.endY / 100) * fs]
        const tV: Pt = [g.wr.x + m.T * fs, g.wr.y + (ARC.top + ARC.endY / 100) * fs]
        add(altair, [
            { transform: tr(q(L, 1), 1), opacity: 1 }, { transform: tr(apexA, 1.35), opacity: 1, offset: 0.3 }, { transform: tr(apexA, 1), opacity: 1, offset: 0.45 },
            { transform: tr(tA, 0.55), opacity: 1, offset: 0.92 }, { transform: tr(tA, 0.45), opacity: 0 },
        ], { at: 3300, d: 1500, ease: EASE, fill: 'forwards' })
        add(vega, [
            { transform: tr(q(R, 1), 1), opacity: 1 }, { transform: tr(apexV, 1.35), opacity: 1, offset: 0.3 }, { transform: tr(apexV, 1), opacity: 1, offset: 0.45 },
            { transform: tr(tV, 0.55), opacity: 1, offset: 0.92 }, { transform: tr(tV, 0.45), opacity: 0 },
        ], { at: 3300, d: 1500, ease: EASE, fill: 'forwards' })
        const F = g.wrapped ? 30 : 40
        flash.style.width = F + 'px'
        flash.style.height = F + 'px'
        flash.style.left = (ax - F / 2).toFixed(1) + 'px'
        flash.style.top = (ay - F / 2).toFixed(1) + 'px'
        add(flash, [{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 0.9, offset: 0.35 }, { transform: 'scale(1.5)', opacity: 0 }], { at: 3300, d: 900, ease: EASE_OUT })

        // 2. Mark: ink out / prism in 2500-3300; vertex stars pop 2900/3150/3400; dashed lines draw 3300-4500 from Deneb via
        //    Vega and Altair; the Milky Way fades in 4300-5100.
        if (mark) {
            add(mark.querySelector('.rt-tnb-every'), [{ opacity: 1 }, { opacity: 0 }], { at: 2600, d: 700, ease: EASE })
            add(mark.querySelector('.rt-tnb-prism'), [{ opacity: 0 }, { opacity: 1 }], { at: 2500, d: 700, ease: EASE })
            for (const s of STARS) {
                add(mark.querySelector('.rt-tnb-' + s.name), [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.35)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { at: s.at, d: 600, ease: POP })
            }
            add(mark.querySelector('.rt-tnb-reveal'), [{ strokeDashoffset: 300 }, { strokeDashoffset: 0 }], { at: 3300, d: 1200, ease: 'linear' })
            add(mark.querySelector('.rt-tnb-milky'), [{ opacity: 0 }, { opacity: 1 }], { at: 4300, d: 800, ease: EASE })
        }

        // 3. Word: Altair/Vega colour copies fade in 4600-5600 (where WAAPI can target ::after); the twin-star arc draws
        //    4900-5700 and its stars pop 5400-5900; the tanzaku swings in 5600-6900 (ja).
        const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
        if (pseudoOk) {
            if (risu) add(risu, [{ opacity: 0 }, { opacity: 1 }], { at: 4600, d: 1000, ease: EASE }, '::after')
            if (tan) add(tan, [{ opacity: 0 }, { opacity: 1 }], { at: 4750, d: 1000, ease: EASE }, '::after')
        }
        add(arcLine, [{ strokeDashoffset: 100, opacity: 1 }, { strokeDashoffset: 0, opacity: 1 }], { at: 4900, d: 800, ease: EASE })
        add(arcA, [{ opacity: 0 }, { opacity: 1 }], { at: 4700, d: 300, ease: EASE })
        add(arcV, [{ opacity: 0 }, { opacity: 1 }], { at: 4800, d: 300, ease: EASE })
        if (tanzakuSwing) {
            add(tanzakuSwing, [
                { transform: 'rotate(-38deg) scale(0.6)', opacity: 0 }, { transform: 'rotate(12deg) scale(1)', opacity: 1, offset: 0.35 },
                { transform: 'rotate(-7deg)', opacity: 1, offset: 0.6 }, { transform: 'rotate(3deg)', opacity: 1, offset: 0.82 }, { transform: 'rotate(0deg)', opacity: 1 },
            ], { at: 5600, d: 1300, ease: EASE })
        }
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
        setFinal(false)
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        if (document.hidden) onVis()
        arm()
        return playPromise
    }

    // ctx.onRelayout: rebuild the timeline from the new geometry at the current scene time. Coalesced to one rebuild per
    // frame. Outside play, only the word furniture is re-placed.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placeWord()
            return
        }
        if (relayoutQueued) return
        relayoutQueued = true
        relayoutRaf = requestAnimationFrame(() => {
            relayoutQueued = false
            relayoutRaf = 0
            if (state !== 'playing' || !anims.length) return
            const t = anims[0].currentTime || 0
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
        document.removeEventListener('visibilitychange', onVis)
        document.fonts?.removeEventListener('loadingdone', onFonts)
        sky.remove()
        mark?.remove()
        arc.remove()
        tanzaku?.remove()
        word.classList.remove('rt-tnb-word', 'rt-tnb-final')
        if (risu) {
            risu.classList.remove('rt-tnb-risu')
            risu.removeAttribute('data-rt-tnb-text')
        }
        if (tan) {
            tan.classList.remove('rt-tnb-tan')
            tan.removeAttribute('data-rt-tnb-text')
        }
        ctx.setDescription('')
        settle()
    }

    placeWord()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'starFestival',
    durationMs: DURATION,
    build,
}
export default scene
