// Seasonal scene: tsukimi (月見, 中秋の名月; chinese lunar 8/15, lang ja).
//
// A silver-gold moon rises past three susuki (ススキ) plumes while "中秋の名月" is shown; the triangle flips to an upright one and
// becomes a moon-viewing offering: six white tsukimi dango stacked 3-2-1 on a wooden sanpō (三方) stand, with the moon behind
// its upper right. The wordmark returns in silver-gold with a small susuki plume beside it.
// Deliberately unlike the other autumn moons: chuseok fills the slot with a yellow moon carrying the triangle as a shadow,
// midAutumn stamps the triangle on a scalloped mooncake. Here the moon stays small and behind, and the stage moon is silver.
// Storyboard (7.1 s of motion, 7.4 s budget): the everyday wordmark steps back 0-0.7 s; the night wash comes in 0-0.6 s (out
// 4.8-5.8 s); the moon rises 0.75-3.25 s and fades 4.6-5.6 s; the susuki grow 0.8-2.1 s, sway and fade 4.4-5.2 s; the greeting
// shows 1.0-3.8 s; the mark flips and the dango are set down 3.0-5.4 s; the word returns silver-gold 5.8-7.0 s and the small
// plume grows 6.2-7.1 s.
// Final: the dango offering mark, the silver-gold wordmark with its plume, no sky.
// Text: the system Japanese sans stack (no web font). Motion is Web Animations only: transform and opacity. No filters, no
// loops. The final pose is static CSS under .rt-tk-final, so finish() gives the same pose from any point.
import './tsukimi.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 7400
const SVGNS = 'http://www.w3.org/2000/svg'
const GREETING = '中秋の名月'

// Triangle geometry (viewBox -73 -66 146 146, centroid at the origin, pointing down).
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
// The frame is flipped about the centroid and opened at its base: a Λ whose legs stand on the sanpō tray; the tray closes the
// triangle. Six dango (r 8.5) are heaped 3-2-1 on the tray with rows overlapping like soft mochi and a clear gap to the frame's
// inner edges.
const FRAME_OPEN = 'M-55.85 32.25L0-64.49L55.85 32.25H38.68L0-34.68L-38.68 32.25Z'
// Listed back to front (top dango first, so lower rows paint over the ones behind them); the third value is the order in which
// each is set down (bottom row left to right, then the middle row, then the top).
const DANGO_R = 8.5
const DANGO: Array<[number, number, number]> = [[0, -10.5, 5], [-8.5, 3.5, 3], [8.5, 3.5, 4], [-17, 17.5, 0], [0, 17.5, 1], [17, 17.5, 2]]
// Sanpō stand in front of the base: tray, a tapered base with the kurikata (繰形) cut-out.
const TRAY = { x: -64, y: 26, w: 128, h: 7, r: 2 }
const BASE = 'M-46 33H46L40 50H-40Z'
const CUT = { cx: 0, cy: 42, rx: 9, ry: 4.4 }
// The moon behind the offering's upper right: centre (30,-30), r 33 (inside the 146 box).
const MOON = { cx: 30, cy: -30, r: 33 }

// Susuki stalk (viewBox 0 0 20 60): a leaf blade from the base, the stem, and a plume of five strands that leans right. The
// small plume beside the word (viewBox 0 0 14 30) is the same drawing, shorter.
const STALK = '<path class="rt-tk-leaf" d="M10 60Q4 46 1 33"/>' +
    '<path class="rt-tk-stem" d="M10 60Q11 36 9 16"/>' +
    '<path class="rt-tk-plume" d="M9 18Q11 8 15 2M9 17Q13 10 18 7M9 20Q14 15 19 14M9 15Q9 7 11 0M9 21Q12 19 16 21"/>'
const PLUME = '<path class="rt-tk-leaf" d="M7 30Q2.5 23 1 16"/>' +
    '<path class="rt-tk-stem" d="M7 30Q7.6 19 6.4 9.5"/>' +
    '<path class="rt-tk-plume" d="M6.4 11Q7.6 5 10.6 1.5M6.4 10.5Q9 6.3 12.6 4.6M6.4 12.4Q9.6 9.4 13.2 9.2M6.4 9.4Q6.4 4.6 7.6 0.5M6.4 13Q8.4 12 11 13.2"/>'

interface Geom {
    W: number
    H: number
    ms: number
    cx: number
    cy: number
    mode: 'wide' | 'narrow'
    R: number
    mx: number
    my: number
    base: number
    stalkH: number[]
    stalkX: number[]
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-tk-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('tsukimi: svg markup did not parse')
    return n
}

function markMarkup(id: string): string {
    let s = '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<radialGradient id="' + id + '-moon" cx="' + (MOON.cx - 9) + '" cy="' + (MOON.cy - 9) + '" r="' + (MOON.r + 9) + '" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" stop-color="#fffaf0"/><stop offset=".55" stop-color="#f6e2a0"/><stop offset="1" stop-color="#e6bd56"/></radialGradient>' +
        // Warm off-white mochi with a soft lower shade (one gradient shared by all six, in each circle's own box).
        '<radialGradient id="' + id + '-mochi" cx=".4" cy=".32" r=".78"><stop offset="0" stop-color="#fffdf6"/><stop offset=".55" stop-color="#f8eedb"/><stop offset="1" stop-color="#e2cda2"/></radialGradient>' +
        '</defs>' +
        '<g class="rt-tk-every" id="' + id + '-every">' +
            '<path class="rt-tk-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-tk-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-tk-moondisc" id="' + id + '-moondisc">' +
            '<circle cx="' + MOON.cx + '" cy="' + MOON.cy + '" r="' + MOON.r + '" fill="url(#' + id + '-moon)"/>' +
            '<circle class="rt-tk-moonrim" cx="' + MOON.cx + '" cy="' + MOON.cy + '" r="' + (MOON.r - 1.2) + '"/>' +
        '</g>' +
        '<g class="rt-tk-up" id="' + id + '-up">' +
            '<path class="rt-tk-frame" d="' + FRAME_OPEN + '"/>' +
        '</g>' +
        '<g class="rt-tk-stand" id="' + id + '-stand">' +
            '<path class="rt-tk-base" d="' + BASE + '"/>' +
            '<ellipse class="rt-tk-cut" cx="' + CUT.cx + '" cy="' + CUT.cy + '" rx="' + CUT.rx + '" ry="' + CUT.ry + '"/>' +
            '<rect class="rt-tk-tray" x="' + TRAY.x + '" y="' + TRAY.y + '" width="' + TRAY.w + '" height="' + TRAY.h + '" rx="' + TRAY.r + '"/>' +
        '</g>' +
        '<g class="rt-tk-dango" id="' + id + '-dango">'
    for (let i = 0; i < DANGO.length; i++) {
        s += '<circle class="rt-tk-d rt-tk-d' + (i + 1) + '" id="' + id + '-d' + (i + 1) + '"' +
            ' fill="url(#' + id + '-mochi)" data-order="' + DANGO[i][2] + '"' +
            ' cx="' + DANGO[i][0] + '" cy="' + DANGO[i][1] + '" r="' + DANGO_R + '"/>'
    }
    return s + '</g>'
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    ctx.setDescription(GREETING, 'ja')

    // ----- Stage: night wash, rising moon, susuki, the greeting -----
    const sky = el('div', 'rt-tk-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const wash = el('div', 'rt-tk-wash', sky)
    wash.id = id + '-wash'
    const moon = el('div', 'rt-tk-moon', sky)
    moon.id = id + '-moon'
    const stalks: HTMLElement[] = []
    for (let k = 0; k < 3; k++) {
        const st = el('div', 'rt-tk-stalk rt-tk-stalk-' + (k + 1), sky)
        st.id = id + '-stalk' + (k + 1)
        const sway = el('div', 'rt-tk-sway', st)
        sway.appendChild(svgFrom(STALK, 'rt-tk-stalk-svg', '0 0 20 60'))
        stalks.push(st)
    }
    const textBox = el('div', 'rt-tk-textbox', sky)
    textBox.id = id + '-textbox'
    textBox.setAttribute('lang', 'ja')
    const text = el('span', 'rt-tk-text', textBox)
    text.id = id + '-text'
    text.textContent = GREETING
    ctx.stage.appendChild(sky)

    // ----- Mark slot: everyday mark to the moon-viewing offering with dango on a sanpō -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-tk-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: a silver-gold copy over the everyday text, and the small plume -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-tk-word')
    const gold = el('span', 'rt-tk-gold', word)
    gold.id = id + '-gold'
    gold.setAttribute('aria-hidden', 'true')
    const goldA = el('span', 'rt-tk-a', gold)
    goldA.textContent = 'Risu'
    const goldB = el('span', 'rt-tk-b', gold)
    goldB.textContent = 'Tanium'
    const plume = el('span', 'rt-tk-plumebox', word)
    plume.id = id + '-plume'
    plume.setAttribute('aria-hidden', 'true')
    const plumeIn = el('span', 'rt-tk-plume-in', plume)
    plumeIn.appendChild(svgFrom(PLUME, 'rt-tk-plume-svg', '0 0 14 30'))

    // The plume goes right of the word (+14 px) where the fit column has room for it. Otherwise (phones at 360/375) it is
    // omitted: squeezed between mark and word it touched the "R" and the focus ring.
    function placePlume(): void {
        const box = ctx.stageBox()
        const off = ctx.stageOffset()
        const W = box.width ? box.width : ctx.stage.getBoundingClientRect().width
        plume.classList.toggle('rt-tk-plume-off', W - (off.wordX + off.wordWidth) < 14)
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
        placePlume()
        sky.classList.add('rt-tk-final')
        mark?.classList.add('rt-tk-final')
        word.classList.add('rt-tk-final')
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

    function geom(): Geom {
        const box = ctx.stageBox()
        const sr = ctx.stage.getBoundingClientRect()
        const W = box.width ? box.width : sr.width
        const H = box.height ? box.height : sr.height
        const off = ctx.stageOffset()
        const wx = off.wordX
        const wy = off.wordY
        const wh = off.wordHeight
        const ms = off.markSize
        const mx = off.markX
        const my = off.markY
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        // The greeting sits on the word box; measure it at the word size first.
        textBox.style.left = wx + 'px'
        textBox.style.top = wy + 'px'
        textBox.style.height = wh + 'px'
        textBox.style.setProperty('--rt-tk-fs', fs + 'px')
        text.style.fontSize = ''
        const natural = text.scrollWidth || text.getBoundingClientRect().width
        const avail = W - wx - 4
        const base = { W, H, ms, cx: mx + ms / 2, cy: my + ms / 2 }
        let g: Geom
        if (avail - natural >= 2 * 18 + 24) {
            // Wide: a 36 px moon right of the greeting, rising into the upper stage; susuki in front of it.
            const R = 18
            g = { ...base, mode: 'wide', R, mx: Math.min(W - R - 14, wx + natural + 64), my: Math.min(30, H * 0.38), base: Math.min(H, 62), stalkH: [44, 36, 50], stalkX: [] }
        } else {
            // Narrow (phones): the greeting is fitted to leave room for a small moon at the stage's right end.
            ctx.fitText(text, Math.max(40, avail - 28))
            const tw = text.scrollWidth || text.getBoundingClientRect().width
            const R = Math.max(7, Math.min(10, (W - (wx + tw) - 12) / 2))
            g = { ...base, mode: 'narrow', R, mx: W - R - 7, my: Math.max(R + 2, Math.min(wy - 1, H * 0.32)), base: H, stalkH: [0.74 * H, 0.62 * H, 0.82 * H], stalkX: [] }
        }
        g.stalkX = [g.mx - g.R * 1.1, g.mx - g.R * 0.25, g.mx + g.R * 0.75]
        return g
    }
    function applyGeom(g: Geom): void {
        sky.setAttribute('data-rt-tk-mode', g.mode)
        wash.style.setProperty('--rt-tk-mx', g.cx.toFixed(1) + 'px')
        wash.style.setProperty('--rt-tk-my', g.cy.toFixed(1) + 'px')
        // The hole hugs the mark (radius = half the slot + 1 px, feathered over 8 px), so it never shows as a dark round patch
        // beside the mark. The wash fades out by the top of the mark slot, so the brand row is never tinted.
        wash.style.setProperty('--rt-tk-fade', Math.max(14, g.cy - g.ms / 2).toFixed(1) + 'px')
        const hr = (g.ms || 28) / 2
        wash.style.setProperty('--rt-tk-h0', (hr + 1).toFixed(1) + 'px')
        wash.style.setProperty('--rt-tk-h1', (hr + 9).toFixed(1) + 'px')
        moon.style.cssText = 'left:' + (g.mx - g.R).toFixed(1) + 'px;top:' + (g.my - g.R).toFixed(1) + 'px;width:' + (2 * g.R) + 'px;height:' + (2 * g.R) + 'px'
        stalks.forEach((n, i) => {
            const h = g.stalkH[i]
            const w = h / 3
            n.style.cssText = 'left:' + (g.stalkX[i] - w / 2).toFixed(1) + 'px;top:' + (g.base - h).toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px'
        })
    }

    function timeline(): void {
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

        add(sky, [], { d: 7100 })    // scene clock (property-less), always anims[0]
        const g = geom()
        applyGeom(g)

        // 1. 0-700: the everyday wordmark fades and scales down; the night wash comes in (0-600, out 4800-5800).
        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 700, ease: IN })
        add(wash, [{ opacity: 0 }, { opacity: 1, offset: 600 / 5800 }, { opacity: 1, offset: 4800 / 5800 }, { opacity: 0 }], { d: 5800 })

        // 1b. The moon rises from below the stage 750-3250 (after the everyday word has gone, so it never crosses a visible
        // word on phones) and fades out 4600-5600, before the mark's moon is set.
        const rise = g.base - g.my + g.R + 4
        add(moon, [
            { opacity: 0, transform: 'translateY(' + rise.toFixed(1) + 'px)' },
            { opacity: 1, transform: 'translateY(' + (rise * 0.55).toFixed(1) + 'px)', offset: 700 / 4850, easing: OUT },
            { opacity: 1, transform: 'translateY(0)', offset: 2500 / 4850 },
            { opacity: 1, transform: 'translateY(0)', offset: 3850 / 4850 },
            { opacity: 0, transform: 'translateY(0)' },
        ], { at: 750, d: 4850, ease: INOUT })

        // 1c. Susuki grow up from the ground (800-2060, after the everyday word has gone), sway twice (1500-4300) and fade
        // (4400-5200).
        stalks.forEach((n, i) => {
            const at = 800 + i * 180
            add(n, [
                { opacity: 0, transform: 'scaleY(0.25)' },
                { opacity: 1, transform: 'scaleY(1)', offset: 900 / (5200 - at), easing: 'linear' },
                { opacity: 1, transform: 'scaleY(1)', offset: (4400 - at) / (5200 - at), easing: IN },
                { opacity: 0, transform: 'scaleY(1)' },
            ], { at, d: 5200 - at, ease: OUT })
            const dir = i === 1 ? -1 : 1
            add(n.firstElementChild, [
                { transform: 'rotate(0deg)' }, { transform: 'rotate(' + (-5 * dir) + 'deg)', offset: 0.22 },
                { transform: 'rotate(' + (4 * dir) + 'deg)', offset: 0.5 }, { transform: 'rotate(' + (-2.5 * dir) + 'deg)', offset: 0.76 },
                { transform: 'rotate(0deg)' },
            ], { at: 1500 + i * 120, d: 2800, ease: INOUT })
        })

        // 1d. The greeting fades and scales in at the word's place 1000-1600, holds, fades out 3200-3800.
        add(text, [
            { opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)', offset: 600 / 2800 },
            { opacity: 1, transform: 'scale(1)', offset: 2200 / 2800 }, { opacity: 0, transform: 'scale(1)' },
        ], { at: 1000, d: 2800, ease: INOUT })

        if (mark) {
            // 2. Flip down to up (3000-3750: the everyday mark folds flat, the offering frame opens), the stand slides up
            // 3500-3900, the moon disc appears behind 3700-4400, the dango are stacked one by one 4100-5380.
            add(mark.querySelector('.rt-tk-every'), [
                { opacity: 1, transform: 'scaleY(1)' }, { opacity: 1, transform: 'scaleY(0)', offset: 0.98 }, { opacity: 0, transform: 'scaleY(0)' },
            ], { at: 3000, d: 360, ease: IN })
            add(mark.querySelector('.rt-tk-up'), [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(0.02)', offset: 0.02 }, { opacity: 1, transform: 'scaleY(1)' }], { at: 3360, d: 390, ease: OUT })
            add(mark.querySelector('.rt-tk-stand'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 3500, d: 400, ease: OUT })
            add(mark.querySelector('.rt-tk-moondisc'), [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1)' }], { at: 3700, d: 700, ease: OUT })
            mark.querySelectorAll('.rt-tk-d').forEach((n) => {
                add(n, [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 4100 + Number(n.getAttribute('data-order')) * 180, d: 380, ease: OUT })
            })
        }

        // 3. The word returns silver-gold: Risu 5800-6800, Tanium 6000-7000; the plume grows 6200-7100.
        add(goldA, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 5800, d: 1000, ease: OUT })
        add(goldB, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 6000, d: 1000, ease: OUT })
        placePlume()
        add(plumeIn, [
            { opacity: 0, transform: 'scaleY(0.2) rotate(0deg)' },
            { opacity: 1, transform: 'scaleY(1) rotate(-6deg)', offset: 0.6 },
            { opacity: 1, transform: 'scaleY(1) rotate(0deg)' },
        ], { at: 6200, d: 900, ease: OUT })
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
        sky.classList.remove('rt-tk-final')
        mark?.classList.remove('rt-tk-final')
        word.classList.remove('rt-tk-final')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        arm()
        return playPromise
    }

    // ctx.onRelayout: while playing, rebuild from the new geometry at the current scene time (clock = anims[0]); otherwise only
    // re-place the plume. Coalesced to one rebuild per frame.
    let relayoutQueued = false
    let relayoutRaf = 0
    function relayout(): void {
        if (state === 'destroyed') return
        if (state !== 'playing') {
            placePlume()
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
        sky.remove()
        mark?.remove()
        gold.remove()
        plume.remove()
        word.classList.remove('rt-tk-word', 'rt-tk-final')
        ctx.setDescription('')
        settle()
    }

    placePlume()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'tsukimi',
    durationMs: DURATION,
    build,
}
export default scene
