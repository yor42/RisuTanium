// Seasonal scene: dano / Duanwu (lunar 5/5: dangi for ko, chinese for cn, zh, zh-Hant).
//
// Per language (ctx.lang):
//   ko                  "즐거운 단오 보내세요": the mark unfolds as a painted folding fan (부채) whose leaf carries the nested triangles
//   cn / zh, zh-Hant    "端午安康" (zh-Hans / zh-Hant): the mark wraps in bamboo leaves and is tied with a cord as a geometric zongzi
// Shared stage: a jade wash, rippling water lines and sweet flag (창포 / 菖蒲) leaves. The wordmark ends in a celadon-to-cyan
// gradient. No web font (system Korean and CJK stacks).
//
// Motion is Web Animations only: transform and opacity, plus stroke-dashoffset on the cord. No filters, no loops. The final
// pose is static CSS under .rt-dn-final, so finish() gives the same pose from any point.
import './dano.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

// The last keyframe ends at 6400 ms.
const DURATION = 7000
const SVGNS = 'http://www.w3.org/2000/svg'

interface Copy {
    text: string
    short: string
    desc: string
    lang: string
    cls: string
}
const COPY: { ko: Copy, hans: Copy, hant: Copy } = {
    ko: { text: '즐거운 단오 보내세요', short: '즐거운 단오!', desc: '즐거운 단오 보내세요!', lang: 'ko', cls: 'rt-dn-ko' },
    hans: { text: '端午安康', short: '', desc: '端午安康！', lang: 'zh-Hans', cls: 'rt-dn-hans' },
    hant: { text: '端午安康', short: '', desc: '端午安康！', lang: 'zh-Hant', cls: 'rt-dn-hant' },
}

const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const OUTER = 'M-55.85-32.25H55.85L0 64.49Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
const PIVOT: [number, number] = [0, 64.49]

// Fan: K wedge slices of one painted leaf, each clipped to its wedge and rotated about the pivot (the lower apex). Folded:
// every slice turned onto the centre slice. Open: rotate 0.
const K = 7
const XS: number[] = []
for (let i = 0; i <= K; i++) XS.push(-55.85 + (111.7 * i) / K)
function sliceAngle(i: number): number {
    const xc = (XS[i] + XS[i + 1]) / 2
    return Math.atan2(xc, PIVOT[1] + 32.25) * 180 / Math.PI
}
function fanPainting(id: string, i: number): string {
    // The leaf: frame band in celadon-to-cyan, hole in hanji, mid in deep jade, core in the brand gradient.
    return '<path class="rt-dn-leaf" d="' + OUTER + '"/>' +
        '<path fill="url(#' + id + '-celadon)" fill-rule="evenodd" d="' + FRAME + '"/>' +
        '<path class="rt-dn-mid" d="' + MID + '"/>' +
        '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '<path class="rt-dn-rib" d="M0 64.49L' + XS[i].toFixed(2) + ' -32.25' + (i === K - 1 ? 'M0 64.49L' + XS[K].toFixed(2) + ' -32.25' : '') + '"/>'
}

// Zongzi: the outer triangle in dark bamboo leaf with two lighter wrapping bands, the hole in a lighter leaf, the middle
// triangle pale and the core as the rice corner; a red cord ties it.
const WRAP_A = 'M-60-40L-20-40L40 70L0 70Z'
const WRAP_B = 'M60-40L28-40L-30 70L4 70Z'
const VEINS = 'M-44-30L10 62M-32-30L20 52M44-30L-8 62M34-30L-16 52'
// Two cord wraps around the body (the outer triangle's half-width at y is 55.85*(64.49 - y)/96.74), tied off at the right
// end of the upper wrap with a small loop and tail.
const CORD = 'M-42.5-8H42.5'
const CORD_V = 'M-29.2 14H29.2'
const BOW = 'M42.5-8C50-16 58-12 53-6C50-3 46-5 42.5-8ZM42.5-8C48-2 50 6 47 12'

// Sweet flag leaf, viewBox 0 0 12 60: a long blade with a midrib, base at the bottom centre.
const BLADE = '<path class="rt-dn-blade" d="M6 60C4.2 44 3.6 24 5.4 2C6 1 6.4 1 6.8 2C8.4 24 8 44 6.8 60Z"/><path class="rt-dn-blade-rib" d="M6.1 58C5.6 42 5.4 24 6.1 6"/>'
// x share, lean (deg), height share
const LEAVES: Array<[number, number, number]> = [[0.18, -9, 0.78], [0.42, -3, 1], [0.62, 5, 0.9], [0.84, 11, 0.7]]

interface Geometry {
    W: number
    x: number
    zx: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-dn-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('dano: svg markup did not parse')
    return n
}

function markMarkup(id: string, ko: boolean): string {
    let s = '<defs><linearGradient id="' + id + '-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<linearGradient id="' + id + '-celadon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#38d9ff"/></linearGradient>'
    if (ko) {
        for (let i = 0; i < K; i++) {
            s += '<clipPath id="' + id + '-w' + i + '"><path d="M0 64.49L' + (XS[i] - 0.7).toFixed(2) + ' -32.25H' + (XS[i + 1] + 0.7).toFixed(2) + 'Z"/></clipPath>'
        }
    } else {
        s += '<clipPath id="' + id + '-outer"><path d="' + OUTER + '"/></clipPath>'
    }
    s += '</defs>' +
        '<g class="rt-dn-every" id="' + id + '-every">' +
            '<path class="rt-dn-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-dn-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>'
    if (ko) {
        s += '<g class="rt-dn-fan" id="' + id + '-fan">' +
            '<path class="rt-dn-edge" d="' + OUTER + '"/>'
        for (let j = 0; j < K; j++) {
            s += '<g class="rt-dn-slice" id="' + id + '-slice' + (j + 1) + '"><g clip-path="url(#' + id + '-w' + j + ')">' + fanPainting(id, j) + '</g></g>'
        }
        s += '<path class="rt-dn-guard" d="M0 64.49L-55.85-32.25M0 64.49L55.85-32.25"/>' +
            '<circle class="rt-dn-pivot" cx="0" cy="62" r="5.4"/></g>'
    } else {
        s += '<g class="rt-dn-zongzi" id="' + id + '-zongzi">' +
            '<g class="rt-dn-z1" id="' + id + '-z1"><path class="rt-dn-zleaf" d="' + OUTER + '"/></g>' +
            '<g clip-path="url(#' + id + '-outer)"><g class="rt-dn-z2" id="' + id + '-z2">' +
                '<path class="rt-dn-zwrap" d="' + WRAP_A + '"/><path class="rt-dn-zwrap rt-dn-zwrap-b" d="' + WRAP_B + '"/>' +
                '<path class="rt-dn-zvein" d="' + VEINS + '"/></g></g>' +
            '<g class="rt-dn-z3" id="' + id + '-z3"><path class="rt-dn-zhole" d="' + HOLE + '"/><path class="rt-dn-zmid" d="' + MID + '"/><path class="rt-dn-zcore" d="' + CORE + '"/></g>' +
            '<path class="rt-dn-zedge" d="' + OUTER + '"/>' +
            '<path class="rt-dn-cord" id="' + id + '-cord" pathLength="1" d="' + CORD + '"/>' +
            '<path class="rt-dn-cord rt-dn-cord-v" id="' + id + '-cordv" pathLength="1" d="' + CORD_V + '"/>' +
            '<path class="rt-dn-bow" id="' + id + '-bow" d="' + BOW + '"/></g>'
    }
    return s
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const ko = ctx.lang === 'ko'
    const copy = ko ? COPY.ko : ctx.lang === 'zh-Hant' ? COPY.hant : COPY.hans
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let crowded = false

    ctx.setDescription(copy.desc, copy.lang)

    // ----- Stage -----
    const sky = el('div', 'rt-dn-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-dn-wash', sky)
    wash.id = id + '-wash'
    const water = el('div', 'rt-dn-water', sky)
    water.id = id + '-water'
    const waterSvg = svgFrom('<path class="rt-dn-wave rt-dn-wave-1"/><path class="rt-dn-wave rt-dn-wave-2"/><path class="rt-dn-wave rt-dn-wave-3"/>', 'rt-dn-water-svg', '0 0 100 20')
    water.appendChild(waterSvg)
    const waves = Array.from(waterSvg.querySelectorAll('path'))
    const reeds = el('div', 'rt-dn-reeds', sky)
    reeds.id = id + '-reeds'
    const blades = LEAVES.map((_lf, i) => {
        const b = el('div', 'rt-dn-leafbox', reeds)
        b.id = id + '-blade' + (i + 1)
        b.appendChild(svgFrom(BLADE, 'rt-dn-blade-svg', '0 0 12 60'))
        return b
    })
    const greetBox = el('div', 'rt-dn-greetbox', sky)
    greetBox.setAttribute('lang', copy.lang)
    const greet = el('span', 'rt-dn-greet ' + copy.cls, greetBox)
    greet.id = id + '-greet'
    greet.textContent = copy.text
    ctx.stage.appendChild(sky)

    // ----- Mark slot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id, ko), 'rt-dn-mark ' + (ko ? 'rt-dn-mark-fan' : 'rt-dn-mark-zongzi'), '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: celadon-to-cyan copy over the hidden everyday text -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-dn-word')
    const jade = el('span', 'rt-dn-jade', word)
    jade.id = id + '-jade'
    jade.setAttribute('aria-hidden', 'true')
    jade.innerHTML = '<span>Risu</span><span>Tanium</span>'

    // ----- Geometry -----
    let G: Geometry = { W: 0, x: 0, zx: 0 }
    function layoutStage(): Geometry {
        if (state === 'destroyed') return G
        const W = ctx.stageWidth()
        const SH = ctx.stageBox().height || ctx.stage.getBoundingClientRect().height || 96
        const off = ctx.stageOffset()
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const h = off.wordHeight || fs * 1.2
        const rowBottom = Math.max(off.markY + (off.markSize || 0), off.wordY + h)
        const washH = Math.min(SH, Math.round(rowBottom + 16))
        // Water: three ripple lines along the wash's lower edge, 1.5x the stage wide so the drift never shows an end.
        const wy = Math.max(rowBottom - 2, washH - 14)
        water.style.top = wy + 'px'
        water.style.height = '16px'
        const WW = Math.round(W * 1.5)
        const seg = 22
        waterSvg.setAttribute('viewBox', '0 0 ' + WW + ' 16')
        waterSvg.style.width = WW + 'px'
        waves.forEach((p, i) => {
            const y = 3 + i * 5
            const a = 1.6 - i * 0.3
            let d = 'M0 ' + y
            for (let x = 0; x < WW; x += seg) d += 'q' + (seg / 4) + ' ' + (-a) + ' ' + (seg / 2) + ' 0t' + (seg / 2) + ' 0'
            p.setAttribute('d', d)
        })
        // Reeds: the right-hand zone, 20% of the stage (34-80 px), rising from the wash's lower edge.
        const P = Math.round(Math.max(34, Math.min(80, W * 0.2)))
        const zx = W - 4 - P
        const RH = Math.min(washH - 2, 64)
        reeds.style.left = zx + 'px'
        reeds.style.width = P + 'px'
        reeds.style.top = (washH - RH) + 'px'
        reeds.style.height = RH + 'px'
        blades.forEach((b, i) => {
            const bh = RH * LEAVES[i][2]
            b.style.left = (P * LEAVES[i][0] - bh * 0.1) + 'px'
            b.style.height = bh + 'px'
            b.style.width = (bh * 0.2) + 'px'
            b.style.setProperty('--rt-dn-lean', LEAVES[i][1] + 'deg')
        })
        // Always right of the mark: a running status mark never covers the greeting.
        const left = off.wordX
        greetBox.style.left = left + 'px'
        greetBox.style.top = off.wordY + 'px'
        greetBox.style.height = h + 'px'
        greetBox.style.setProperty('--rt-dn-fs', fs + 'px')
        wash.style.setProperty('--rt-dn-wash-h', washH + 'px')
        wash.style.setProperty('--rt-dn-mx', (off.markSize ? off.markX + off.markSize / 2 : -100).toFixed(1) + 'px')
        wash.style.setProperty('--rt-dn-my', (off.markSize ? off.markY + off.markSize / 2 : -100).toFixed(1) + 'px')
        G = { W, x: left, zx }
        return G
    }
    // The greeting starts at the word's left edge on every width. Its natural width is measured each fit (in the face it
    // currently uses). If a mid-play resize leaves less than 62% of it beside the props, the props are hidden
    // (rt-dn-squeezed) and it takes the rest of the row. If it would still shrink by more than 10%, the shorter phone copy
    // is used (the description keeps the full greeting).
    let squeezed = false
    function fitGreeting(): void {
        if (!G.W) return
        greet.style.fontSize = ''
        greet.textContent = copy.text
        const natural = greet.scrollWidth || 0
        squeezed = !crowded && state === 'playing' && (G.zx - 6 - G.x) < 0.62 * natural
        sky.classList.toggle('rt-dn-squeezed', squeezed)
        const max = crowded || squeezed ? G.W - G.x - 6 : G.zx - 6 - G.x
        if (copy.short && natural * 0.9 > max) greet.textContent = copy.short
        if (max > 0) ctx.fitText(greet, max)
    }
    function decideCrowded(): void {
        crowded = false
        layoutStage()
        greet.style.fontSize = ''
        crowded = (greet.scrollWidth || 0) * 0.8 > (G.zx - 6 - G.x)
        layoutStage()
    }

    function onVis(): void {
        if (state !== 'playing') return
        for (const a of anims) {
            try {
                if (document.hidden) a.pause()
                else a.play()
            } catch {
                // already finished or cancelled
            }
        }
    }
    document.addEventListener('visibilitychange', onVis)

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
        sky.classList.add('rt-dn-final')
        mark?.classList.add('rt-dn-final')
        word.classList.add('rt-dn-final')
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
        decideCrowded()
        fitGreeting()

        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 800, ease: IN })

        // 0-900: a jade wash; it lifts 5200-6200.
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 0.9 / 6.2 }, { opacity: 1, offset: 5.2 / 6.2 }, { opacity: 0 }], { at: 0, d: 6200, ease: INOUT })

        // 200-1100 the water lines rise; they drift left (one linear pass) until the wash lifts.
        add(water, [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)', offset: 0.9 / 6.0 },
            { opacity: 1, transform: 'translateY(0)', offset: 5.0 / 6.0 },
            { opacity: 0, transform: 'translateY(0)' },
        ], { at: 200, d: 6000, ease: INOUT })
        // Three ripple periods.
        add(waterSvg, [{ transform: 'translateX(0)' }, { transform: 'translateX(-66px)' }], { at: 200, d: 6000, ease: 'linear' })

        // 500-1700 the sweet flag blades grow from the water (staggered) and lean into place; they sink 4800-5500
        // (crowded: 2100-2600, before the greeting).
        blades.forEach((b, i) => {
            const lean = LEAVES[i][1]
            add(b, [
                { transform: 'rotate(' + lean + 'deg) scaleY(0)', opacity: 0 },
                { transform: 'rotate(' + lean + 'deg) scaleY(0.4)', opacity: 1, offset: 0.25 },
                { transform: 'rotate(' + (lean + (i % 2 ? -3 : 3)) + 'deg) scaleY(1)', opacity: 1, offset: 0.75 },
                { transform: 'rotate(' + lean + 'deg) scaleY(1)', opacity: 1 },
            ], { at: 500 + i * 160, d: 1500, ease: INOUT })
        })
        add(reeds, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(30%)' }], { at: crowded ? 2100 : 4800, d: crowded ? 500 : 700, ease: IN })

        // 2100-4600 (crowded 2600-4800): the greeting.
        const gAt = crowded ? 2600 : 2100
        later(() => {
            if (state !== 'playing') return
            layoutStage()
            fitGreeting()
        }, gAt - 50)
        add(greet, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 2.5 },
            { opacity: 1, transform: 'scale(1)', offset: 2.0 / 2.5 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: gAt, d: crowded ? 2200 : 2500, ease: INOUT })

        if (mark) {
            add(q('.rt-dn-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }], { at: 3700, d: 350, ease: IN })
            if (ko) {
                // 3900-4150 the folded fan appears; 4150-5150 its ribs open from the pivot, outer slices last.
                add(q('.rt-dn-fan'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 3900, d: 300, ease: OUT })
                for (let i = 0; i < K; i++) {
                    const ang = -sliceAngle(i)
                    const dist = Math.abs(i - (K - 1) / 2)
                    add(q('#' + id + '-slice' + (i + 1)), [
                        { transform: 'rotate(' + ang.toFixed(2) + 'deg)' },
                        { transform: 'rotate(0deg)' },
                    ], { at: 4150 + dist * 60, d: 900, ease: INOUT })
                }
                add(q('.rt-dn-guard'), [{ opacity: 0 }, { opacity: 1 }], { at: 4900, d: 400, ease: OUT })
                add(q('.rt-dn-edge'), [{ opacity: 0 }, { opacity: 1 }], { at: 5000, d: 400, ease: OUT })
            } else {
                // 3900-4800 three leaf layers wrap on; 4800-5500 the cord is tied (dashoffset); 5300-5700 the bow.
                add(q('.rt-dn-z1'), [{ opacity: 0, transform: 'rotate(-28deg) scale(0.75)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }], { at: 3900, d: 600, ease: OUT })
                add(q('.rt-dn-z2'), [{ opacity: 0, transform: 'rotate(24deg) scale(1.25)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }], { at: 4150, d: 600, ease: OUT })
                add(q('.rt-dn-z3'), [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4400, d: 500, ease: OUT })
                add(q('.rt-dn-zedge'), [{ opacity: 0 }, { opacity: 1 }], { at: 4500, d: 400, ease: OUT })
                add(q('#' + id + '-cordv'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 4800, d: 400, ease: INOUT })
                add(q('#' + id + '-cord'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 5050, d: 400, ease: INOUT })
                add(q('.rt-dn-bow'), [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(1)' }], { at: 5300, d: 400, ease: OUT })
            }
        }

        // 5600-6400: the wordmark returns in celadon-to-cyan.
        add(jade, [{ opacity: 0, transform: 'translateY(0.12em)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 5600, d: 800, ease: OUT })
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
        sky.classList.remove('rt-dn-final')
        mark?.classList.remove('rt-dn-final')
        word.classList.remove('rt-dn-final')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        if (document.hidden) for (const a of anims) a.pause()
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
        document.removeEventListener('visibilitychange', onVis)
        sky.remove()
        mark?.remove()
        jade.remove()
        word.classList.remove('rt-dn-word', 'rt-dn-final')
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'dano',
    durationMs: DURATION,
    build,
}
export default scene
