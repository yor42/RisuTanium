// Seasonal scene: springFestival (chinese lunar 1/1-1/3; lang cn, zh, zh-Hant, vi).
//
// Per language:
//   cn / zh   "新春快乐" (zh-Hans), two sky lanterns, palace-lantern lattice mark, red knot on the final "m"
//   zh-Hant   "新春快樂" (zh-Hant), the same art
//   vi        "Chúc Mừng Năm Mới" (vi), a hoa mai (yellow apricot blossom) branch with six falling petals, a
//             blossom-in-the-frame mark, a small blossom on the final "m"
// Storyboard (7.4 s of motion, 7.6 s budget): the everyday wordmark steps back 0-0.8 s; a cinnabar-and-gold dusk falls 0-1.0 s
// (lifts 4.6-5.8 s); the props (lanterns or branch and petals) cross the right-hand zone; the greeting fades and scales in
// 1.4-4.3 s (crowded: 2.0-4.6 s) and fades out; the mark turns into the lit palace lantern or the opened blossom 3.6-6.3 s;
// the wordmark returns crimson-to-amber 5.8-6.6 s and the motif settles on the "m" 6.3-7.4 s.
// Final: the lantern or blossom mark, the amber wordmark with its motif, no sky.
// No web font: system CJK stacks and a system Latin stack with full Vietnamese coverage. Motion is Web Animations only:
// transform and opacity. No filters, no loops. The final pose is static CSS under .rt-sf-final, so finish() gives the same
// pose from any point.
import './springFestival.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 7600
const SVGNS = 'http://www.w3.org/2000/svg'

interface Copy {
    text: string
    short: string
    desc: string
    lang: string
}
const COPY: { hans: Copy, hant: Copy, vi: Copy } = {
    hans: { text: '新春快乐', short: '', desc: '新春快乐！', lang: 'zh-Hans' },
    hant: { text: '新春快樂', short: '', desc: '新春快樂！', lang: 'zh-Hant' },
    vi: { text: 'Chúc Mừng Năm Mới', short: 'Mừng Năm Mới', desc: 'Chúc Mừng Năm Mới!', lang: 'vi' },
}

const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Palace-lantern lattice mark: lacquer-red frame with a gold edge and a gold cap on the top edge, a lit lattice (a triangular
// grid parallel to the hole's sides) in the hole, the middle triangle red on gold and the core gold; a tassel hangs from the
// lower apex.
const CAP = 'M-50-41.5H50A4 4 0 0 1 54-37.5V-34.5A2.4 2.4 0 0 1 51.6-32.1H-51.6A2.4 2.4 0 0 1-54-34.5V-37.5A4 4 0 0 1-50-41.5Z'
const RING = 'M-5-41.5A5 5 0 0 1 5-41.5'
const LATTICE = 'M-40 0H40M-40 17.34H40' +
    'M-40.03-69.36L35.05 60.69M-20.03-69.36L55.05 60.69' +
    'M20.03-69.36L-55.05 60.69M40.03-69.36L-35.05 60.69'
const TASSEL_KNOT = 'M0 66L4.6 70.6L0 75.2L-4.6 70.6Z'
const TASSEL = 'M-3 75V86M-1 75V87M1 75V87M3 75V86'

// Hoa mai mark: the same frame, a deep-red hole and a five-petal yellow apricot blossom whose centre is the core triangle.
function petals(cx: number, cy: number, dist: number, r: number, cls: string): string {
    let s = ''
    for (let i = 0; i < 5; i++) {
        const a = (-90 + i * 72) * Math.PI / 180
        s += '<circle class="' + cls + '" cx="' + (cx + Math.cos(a) * dist).toFixed(2) + '" cy="' + (cy + Math.sin(a) * dist).toFixed(2) + '" r="' + r + '"/>'
    }
    return s
}

// Sky lantern, viewBox 0 0 20 26.
function skyLantern(id: string): string {
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a6"/><stop offset="1" stop-color="#ff8f3a"/></linearGradient></defs>' +
        '<path class="rt-sf-sl-body" fill="url(#' + id + ')" d="M2.6 2.2H17.4L15.2 20.2H4.8Z"/>' +
        '<path class="rt-sf-sl-rib" d="M7.6 2.6L8.2 20M12.4 2.6L11.8 20"/>' +
        '<path class="rt-sf-sl-rim" d="M2.6 2.2H17.4M4.8 20.2H15.2"/>' +
        '<ellipse class="rt-sf-sl-flame" cx="10" cy="22.4" rx="1.8" ry="2.4"/>'
}

// Hoa mai branch, viewBox 0 0 80 60, anchored at the top-right corner.
function blossom(x: number, y: number, s: number): string {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' + petals(0, 0, 4.2, 3.6, 'rt-sf-mai-petal') +
        '<circle class="rt-sf-mai-eye" r="1.8"/></g>'
}
const MAI_BRANCH =
    '<path class="rt-sf-mai-wood" d="M82 3C70 6 58 10 46 16C36 21 26 26 15 31L15.8 33C27 28 37 23.6 47.6 18.4C59 12.8 70 8.6 82 6.4Z"/>' +
    '<path class="rt-sf-mai-twig" d="M46 17L42 29M64 9.6L70 19M30 24.4L24 18"/>' +
    blossom(66, 10, 1.15) + blossom(44, 28, 1) + blossom(25, 17, 0.9) + blossom(16, 33, 1.05) + blossom(70, 19, 0.75) +
    '<circle class="rt-sf-mai-bud" cx="54" cy="12.6" r="2"/><circle class="rt-sf-mai-bud" cx="35" cy="22.6" r="1.7"/>'
const PETAL = '<ellipse class="rt-sf-mai-petal" cx="5" cy="5" rx="3.6" ry="2.6"/>'

// Word motifs: a small red knot (zh) or a mai blossom (vi) on the final "m", in em.
const KNOT_SVG = '<path class="rt-sf-k-cord" d="M10 0V5"/>' +
    '<path class="rt-sf-k-loop" d="M10 6C4 4 2 10 6 12M10 6C16 4 18 10 14 12M6 12C2 14 4 20 10 18M14 12C18 14 16 20 10 18"/>' +
    '<path class="rt-sf-k-body" d="M10 7L15 12L10 17L5 12Z"/>' +
    '<path class="rt-sf-k-tassel" d="M8.6 18.5V29M10 18.5V30M11.4 18.5V29"/>'
const MAI_SVG = petals(10, 10, 4.6, 3.9, 'rt-sf-mai-petal') + '<circle class="rt-sf-mai-eye" cx="10" cy="10" r="2"/>'

// Falling petals: [x as a share of the prop zone, start delay in ms, size factor].
const PETALS: Array<[number, number, number]> = [[0.18, 0, 1], [0.42, 380, 0.85], [0.66, 820, 1.1], [0.3, 1250, 0.9], [0.78, 1650, 1], [0.54, 2050, 0.8]]

interface Geometry {
    W: number
    P: number
    x: number
    zx: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-sf-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('springFestival: svg markup did not parse')
    return n
}

function markMarkup(id: string, vi: boolean): string {
    let s = '<defs><linearGradient id="' + id + '-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<radialGradient id="' + id + '-glow" cx="0" cy="2" r="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff3b8"/><stop offset=".6" stop-color="#ffc25a"/><stop offset="1" stop-color="#ff8a3a"/></radialGradient>' +
        '<clipPath id="' + id + '-hole"><path d="' + HOLE + '"/></clipPath></defs>' +
        '<g class="rt-sf-every" id="' + id + '-every">' +
            '<path class="rt-sf-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-sf-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-sf-new" id="' + id + '-new">'
    if (!vi) {
        s += '<path class="rt-sf-holefill" d="' + HOLE + '"/>' +
            '<path class="rt-sf-glow" id="' + id + '-glow" fill="url(#' + id + '-glow)" d="' + HOLE + '"/>' +
            '<g clip-path="url(#' + id + '-hole)"><path class="rt-sf-lattice" id="' + id + '-lattice" d="' + LATTICE + '"/></g>' +
            '<path class="rt-sf-frame" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-sf-ring" d="' + RING + '"/>' +
            '<path class="rt-sf-cap" d="' + CAP + '"/>' +
            '<g class="rt-sf-fu" id="' + id + '-fu"><path class="rt-sf-mid" d="' + MID + '"/><path class="rt-sf-core" d="' + CORE + '"/></g>'
    } else {
        s += '<path class="rt-sf-holefill rt-sf-holefill-vi" d="' + HOLE + '"/>' +
            '<path class="rt-sf-frame" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<g class="rt-sf-bloom" id="' + id + '-bloom">'
        for (let i = 0; i < 5; i++) {
            const a = (-90 + i * 72) * Math.PI / 180
            s += '<g class="rt-sf-p" style="transform-origin:' + (73 + Math.cos(a) * 3).toFixed(2) + 'px ' + (66 + 1 + Math.sin(a) * 3).toFixed(2) + 'px"><circle class="rt-sf-mai-petal rt-sf-mark-petal" cx="' + (Math.cos(a) * 9.6).toFixed(2) + '" cy="' + (1 + Math.sin(a) * 9.6).toFixed(2) + '" r="8.4"/></g>'
        }
        s += '<path class="rt-sf-core rt-sf-core-vi" transform="translate(0 1.4) scale(1.05)" d="' + CORE + '"/></g>'
    }
    s += '</g>'
    if (!vi) s += '<g class="rt-sf-tassel" id="' + id + '-tassel"><path class="rt-sf-t-strand" d="' + TASSEL + '"/><path class="rt-sf-t-knot" d="' + TASSEL_KNOT + '"/></g>'
    return s
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const lang = ctx.lang
    const vi = lang === 'vi'
    const copy = vi ? COPY.vi : lang === 'zh-Hant' ? COPY.hant : COPY.hans
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let crowded = false

    ctx.setDescription(copy.desc, copy.lang)

    // ----- Stage -----
    const sky = el('div', 'rt-sf-sky' + (vi ? ' rt-sf-vi' : ''))
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-sf-wash', sky)
    wash.id = id + '-wash'
    // [wrapper, inner] pairs that rise or fall.
    const props: Array<[HTMLElement, SVGSVGElement]> = []
    let branch: HTMLElement | null = null
    if (!vi) {
        for (let i = 0; i < 2; i++) {
            const rise = el('div', 'rt-sf-rise', sky)
            rise.id = id + '-lantern' + (i + 1)
            const inner = svgFrom(skyLantern(id + '-slg' + i), 'rt-sf-sl', '0 0 20 26')
            rise.appendChild(inner)
            props.push([rise, inner])
        }
    } else {
        branch = el('div', 'rt-sf-branch', sky)
        branch.id = id + '-branch'
        branch.appendChild(svgFrom(MAI_BRANCH, 'rt-sf-branch-svg', '0 0 80 60'))
        for (let p = 0; p < 6; p++) {
            const fall = el('div', 'rt-sf-fall', sky)
            fall.id = id + '-petal' + (p + 1)
            const pet = svgFrom(PETAL, 'rt-sf-petal', '0 0 10 10')
            fall.appendChild(pet)
            props.push([fall, pet])
        }
    }
    const greetBox = el('div', 'rt-sf-greetbox', sky)
    greetBox.setAttribute('lang', copy.lang)
    const greet = el('span', 'rt-sf-greet ' + (vi ? 'rt-sf-latin' : copy.lang === 'zh-Hant' ? 'rt-sf-hant' : 'rt-sf-hans'), greetBox)
    greet.id = id + '-greet'
    greet.textContent = copy.text
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id, vi), 'rt-sf-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: crimson-to-amber copy over the hidden everyday text, and a motif on the "m" -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-sf-word')
    const warm = el('span', 'rt-sf-warm', word)
    warm.id = id + '-warm'
    warm.setAttribute('aria-hidden', 'true')
    warm.innerHTML = '<span>Risu</span><span>Tanium</span>'
    const motif = el('span', 'rt-sf-motif' + (vi ? ' rt-sf-motif-vi' : ''), word)
    motif.id = id + '-motif'
    motif.setAttribute('aria-hidden', 'true')
    const motifSvg = svgFrom(vi ? MAI_SVG : KNOT_SVG, 'rt-sf-motif-svg', vi ? '0 0 20 20' : '0 0 20 31')
    motif.appendChild(motifSvg)

    // ----- Geometry -----
    let G: Geometry = { W: 0, P: 0, x: 0, zx: 0 }
    function layoutStage(): void {
        if (state === 'destroyed') return
        const W = ctx.stageWidth()
        const SH = ctx.stageBox().height || ctx.stage.getBoundingClientRect().height || 96
        const off = ctx.stageOffset()
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const h = off.wordHeight || fs * 1.2
        // The right-hand prop zone: 22% of the stage, 38-90 px.
        const P = Math.round(Math.max(38, Math.min(90, W * 0.22)))
        const zx = W - 4 - P
        if (!vi) {
            props.forEach((pr, i) => {
                const lw = Math.round(Math.max(11, Math.min(22, SH * (i ? 0.18 : 0.23))))
                pr[0].style.left = (zx + P * (i ? 0.62 : 0.12)).toFixed(1) + 'px'
                pr[0].style.width = lw + 'px'
                pr[1].style.height = (lw * 1.3) + 'px'
            })
        } else if (branch) {
            const BH = Math.min(SH - 2, P * 0.75)
            const B = BH / 0.75
            branch.style.left = (W - 4 - B) + 'px'
            branch.style.width = B + 'px'
            branch.style.height = BH + 'px'
            props.forEach((pr, i) => {
                const ps = Math.round(7 * PETALS[i][2] + (SH > 60 ? 2 : 0))
                pr[0].style.left = (zx + P * PETALS[i][0] - 10).toFixed(1) + 'px'
                pr[0].style.width = ps + 'px'
                pr[1].style.height = ps + 'px'
            })
        }
        // Always right of the mark: a running status mark never covers the greeting.
        const left = off.wordX
        greetBox.style.left = left + 'px'
        greetBox.style.top = off.wordY + 'px'
        greetBox.style.height = h + 'px'
        greetBox.style.setProperty('--rt-sf-fs', fs + 'px')
        const rowBottom = Math.max(off.markY + (off.markSize || 0), off.wordY + h)
        wash.style.setProperty('--rt-sf-wash-h', Math.min(SH, Math.round(rowBottom + 18)) + 'px')
        wash.style.setProperty('--rt-sf-mx', (off.markSize ? off.markX + off.markSize / 2 : -100).toFixed(1) + 'px')
        wash.style.setProperty('--rt-sf-my', (off.markSize ? off.markY + off.markSize / 2 : -100).toFixed(1) + 'px')
        G = { W, P, x: left, zx }
    }
    // The greeting starts at the word's left edge on every width. Its natural width is measured each fit (in the face it
    // currently uses). If a mid-play resize leaves less than 62% of it beside the props, the props are hidden
    // (rt-sf-squeezed) and it takes the rest of the row. If it would still shrink by more than 10%, the shorter phone copy
    // is used (the description keeps the full greeting).
    function fitGreeting(): void {
        if (!G.W) return
        greet.style.fontSize = ''
        greet.textContent = copy.text
        const natural = greet.scrollWidth || 0
        const squeezed = !crowded && state === 'playing' && (G.zx - 6 - G.x) < 0.62 * natural
        sky.classList.toggle('rt-sf-squeezed', squeezed)
        const max = crowded || squeezed ? G.W - G.x - 6 : G.zx - 6 - G.x
        if (copy.short && natural * 0.9 > max) greet.textContent = copy.short
        if (max > 0) ctx.fitText(greet, max)
    }
    // Crowded = the greeting would shrink by more than 20% beside the props: then the props leave first and the greeting
    // takes the whole brand row.
    function decideCrowded(): void {
        crowded = false
        layoutStage()
        greet.style.fontSize = ''
        const natural = greet.scrollWidth || 0
        crowded = natural * 0.8 > (G.zx - 6 - G.x)
        layoutStage()
    }

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
        sky.classList.add('rt-sf-final')
        mark?.classList.add('rt-sf-final')
        word.classList.add('rt-sf-final')
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        // The easing applies per keyframe segment (not to the whole iteration), so holds stay holds.
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
        decideCrowded()
        fitGreeting()

        // 0-800: the everyday wordmark steps back.
        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 800, ease: IN })

        // 0-1000: a cinnabar-and-gold dusk; it lifts 4600-5800.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 1 / 5.8 }, { opacity: 1, offset: 4.6 / 5.8 }, { opacity: 0 }], { at: 0, d: 5800, ease: INOUT })

        if (!vi) {
            // Two sky lanterns rise through the right-hand zone with a slow sway (crowded: faster, gone by 1900).
            const LT = crowded ? [[200, 1700], [450, 1450]] : [[300, 4200], [900, 3800]]
            props.forEach((pr, i) => {
                add(pr[0], [
                    { transform: 'translateY(100%)', opacity: 0 },
                    { transform: 'translateY(70%)', opacity: 1, offset: 0.15 },
                    { transform: 'translateY(5%)', opacity: 1, offset: 0.8 },
                    { transform: 'translateY(-30%)', opacity: 0 },
                ], { at: LT[i][0], d: LT[i][1], ease: 'cubic-bezier(0.3, 0, 0.6, 1)' })
                add(pr[1], [
                    { transform: 'translateX(0) rotate(0deg)' },
                    { transform: 'translateX(' + (i ? -3 : 3) + 'px) rotate(' + (i ? -4 : 4) + 'deg)', offset: 0.35 },
                    { transform: 'translateX(' + (i ? 2 : -2) + 'px) rotate(' + (i ? 3 : -3) + 'deg)', offset: 0.7 },
                    { transform: 'translateX(0) rotate(0deg)' },
                ], { at: LT[i][0], d: LT[i][1], ease: INOUT })
            })
        } else if (branch) {
            // The hoa mai branch reaches in from the top-right; six petals fall through the zone.
            const bOut = crowded ? 1500 : 4400
            add(branch, [
                { opacity: 0, transform: 'translateX(50%) rotate(-6deg)' },
                { opacity: 1, transform: 'translateX(0) rotate(1deg)', offset: 0.8 },
                { opacity: 1, transform: 'translateX(0) rotate(0deg)' },
            ], { at: 300, d: 1000, ease: OUT })
            add(branch.firstElementChild, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(40%)' }], { at: bOut, d: crowded ? 450 : 800, ease: IN })
            const span = crowded ? 0.35 : 1
            props.forEach((pr, i) => {
                const at = 700 + PETALS[i][1] * span
                const d = crowded ? 1100 : 2400
                add(pr[0], [
                    { transform: 'translateY(-20%)', opacity: 0 },
                    { transform: 'translateY(0%)', opacity: 1, offset: 0.12 },
                    { transform: 'translateY(80%)', opacity: 1, offset: 0.8 },
                    { transform: 'translateY(100%)', opacity: 0 },
                ], { at, d, ease: 'linear' })
                add(pr[1], [
                    { transform: 'translateX(0) rotate(0deg)' },
                    { transform: 'translateX(-6px) rotate(120deg)', offset: 0.5 },
                    { transform: 'translateX(-2px) rotate(220deg)' },
                ], { at, d, ease: INOUT })
            })
        }

        // 1400-4300 (crowded: 2000-4600): the greeting fades and scales in, holds, fades. Geometry is re-measured just before
        // it enters.
        const gAt = crowded ? 2000 : 1400
        later(() => {
            if (state === 'playing') {
                layoutStage()
                fitGreeting()
            }
        }, gAt - 50)
        add(greet, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 2.9 },
            { opacity: 1, transform: 'scale(1)', offset: 2.4 / 2.9 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: gAt, d: crowded ? 2600 : 2900, ease: INOUT })

        if (mark) {
            add(q('.rt-sf-every'), [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 1, offset: 0.99 }, { transform: 'scaleY(0)', opacity: 0 }], { at: 3600, d: 300, ease: IN })
            add(q('.rt-sf-new'), [
                { transform: 'scaleY(0)', opacity: 1 },
                { transform: 'scaleY(1.04)', opacity: 1, offset: 0.7 },
                { transform: 'scaleY(1)', opacity: 1 },
            ], { at: 3850, d: 650, ease: OUT })
            if (!vi) {
                // The lantern lights: glow and lattice 4400-5200, then the tassel drops and swings to rest.
                add(q('.rt-sf-glow'), [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0.75, offset: 0.6 }, { opacity: 1 }], { at: 4400, d: 800, ease: 'linear' })
                add(q('.rt-sf-lattice'), [{ opacity: 0, transform: 'scale(1.18)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4500, d: 600, ease: OUT })
                add(q('.rt-sf-fu'), [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4800, d: 500, ease: OUT })
                add(q('.rt-sf-tassel'), [
                    { opacity: 0, transform: 'scaleY(0) rotate(0deg)' },
                    { opacity: 1, transform: 'scaleY(1) rotate(0deg)', offset: 0.3 },
                    { opacity: 1, transform: 'scaleY(1) rotate(12deg)', offset: 0.45 },
                    { opacity: 1, transform: 'scaleY(1) rotate(-8deg)', offset: 0.62 },
                    { opacity: 1, transform: 'scaleY(1) rotate(4deg)', offset: 0.78 },
                    { opacity: 1, transform: 'scaleY(1) rotate(-1.5deg)', offset: 0.9 },
                    { opacity: 1, transform: 'scaleY(1) rotate(0deg)' },
                ], { at: 4900, d: 1400, ease: INOUT })
            } else {
                // The blossom opens petal by petal around the core triangle.
                add(q('.rt-sf-bloom'), [{ transform: 'rotate(-40deg)' }, { transform: 'rotate(0deg)' }], { at: 4400, d: 1200, ease: OUT })
                mark.querySelectorAll('.rt-sf-p').forEach((n, i) => {
                    add(n, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4400 + i * 120, d: 500, ease: OUT })
                })
                add(q('.rt-sf-core-vi'), [{ opacity: 0 }, { opacity: 1 }], { at: 5000, d: 400, ease: OUT })
            }
        }

        // 5800-6600: the wordmark returns in crimson-to-amber; 6300-7400 the motif settles on the "m".
        add(warm, [{ opacity: 0, transform: 'translateY(0.12em)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 5800, d: 800, ease: OUT })
        if (!vi) {
            add(motifSvg, [
                { opacity: 0, transform: 'translateY(-0.3em) rotate(0deg)' },
                { opacity: 1, transform: 'translateY(0) rotate(0deg)', offset: 0.4 },
                { opacity: 1, transform: 'translateY(0) rotate(9deg)', offset: 0.6 },
                { opacity: 1, transform: 'translateY(0) rotate(-5deg)', offset: 0.78 },
                { opacity: 1, transform: 'translateY(0) rotate(2deg)', offset: 0.9 },
                { opacity: 1, transform: 'translateY(0) rotate(0deg)' },
            ], { at: 6300, d: 1100, ease: INOUT })
        } else {
            add(motifSvg, [{ opacity: 0, transform: 'scale(0.3) rotate(-60deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], { at: 6300, d: 700, ease: OUT })
        }
    }

    // Host seam: called with the stage box whenever the stage geometry changes after build.
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
        sky.classList.remove('rt-sf-final')
        mark?.classList.remove('rt-sf-final')
        word.classList.remove('rt-sf-final')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        const mine = anims.slice()
        Promise.all(mine.map((a) => a.finished)).then(() => {
            if (state === 'playing' && anims.length && anims[0] === mine[0]) applyFinal()
        }, () => {
            // cancelled by finish or destroy
        })
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
        warm.remove()
        motif.remove()
        word.classList.remove('rt-sf-word', 'rt-sf-final')
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'springFestival',
    durationMs: DURATION,
    build,
}
export default scene
