// Seasonal scene: midAutumn (chinese lunar 8/15; lang cn, zh, zh-Hant).
//
// Deliberately distinct from chuseok (moon into the mark, eave, five-direction colours): here clouds part over a moon in the
// stage, a paper lantern rises, and the mark becomes a golden mooncake stamped with the triangle.
// Storyboard (7.6 s of motion, 7.8 s budget): the night tint comes in 0-0.6 s and lifts 5.4-6.6 s; xiangyun clouds close in,
// part and fade over 2.6 s around a moon that brightens and fades; a paper lantern drifts up 1.6-5.6 s; the greeting shows
// 2.5-5.1 s; the triangle lifts and presses into the mooncake 5.0-6.3 s; the wordmark returns amber 6.1-6.9 s and the
// xiangyun motif pops beside it 6.8-7.6 s.
// Two layouts: 'beside' (room for the word, greeting and moon in one row; the word is dimmed under the greeting) and 'over'
// (phones, wrapped top bars, narrow stages; the greeting takes the word's place and the word is hidden before any night
// layer appears and returns only after the moon has gone).
// Final: golden mooncake mark, amber wordmark with the xiangyun motif, no sky.
// No web font: system CJK stacks. Motion is Web Animations only: transform and opacity. No filters, no loops. The final pose
// is static CSS under .rt-ma-final (plus .rt-ma-amber on the word), so finish() gives the same pose from any point.
import './midAutumn.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 7800
const SVGNS = 'http://www.w3.org/2000/svg'

const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Xiangyun (auspicious cloud) bank, viewBox 0 0 120 60: lobes plus curl strokes.
const CLOUD_FILL = 'M8 48C2 48 0 40 6 37C4 29 14 25 20 30C22 20 36 18 40 27C44 15 62 14 66 26C72 18 86 20 86 31C96 28 104 36 98 42C110 42 114 50 106 52H10C8 52 7 50 8 48Z'
const CLOUD_CURL = 'M26 40C26 35 32 34 33 38C34 41 30 42 29 40M52 36C52 29 61 28 62 34C63 38 57 39 56 36M80 40C80 35 86 34 87 38C88 41 84 42 83 40'
// Paper lantern, viewBox 0 0 30 46.
const LANTERN = '<path class="rt-ma-lan-cord" d="M15 0V5"/>' +
    '<rect class="rt-ma-lan-cap" x="9" y="4.5" width="12" height="4" rx="1.5"/>' +
    '<ellipse class="rt-ma-lan-body" cx="15" cy="20" rx="13" ry="12"/>' +
    '<ellipse class="rt-ma-lan-glow" cx="15" cy="20.5" rx="8" ry="8"/>' +
    '<path class="rt-ma-lan-rib" d="M15 8.2V31.8M8.5 9.6C4.8 14 4.8 26 8.5 30.4M21.5 9.6C25.2 14 25.2 26 21.5 30.4"/>' +
    '<rect class="rt-ma-lan-cap" x="9" y="31" width="12" height="4" rx="1.5"/>' +
    '<path class="rt-ma-lan-tassel" d="M15 35V45M12.5 37.5V44M17.5 37.5V44"/>'
// Word motif: a three-curl xiangyun on a tail line, sitting on the baseline. viewBox 0 0 26 16; stroke only so it stays crisp at
// 20-24 px.
const MOTIF = '<path class="rt-ma-motif-curl" d="M13 11.6C9.6 11.6 8.6 7.2 11 5.3C13.2 3.6 16.3 5 15.9 7.7C15.6 9.5 13.4 9.7 12.8 8.5' +
    'M8.4 11.8C5.8 12.4 3.4 10.8 3.8 8.4C4.2 6.4 6.6 5.8 7.6 7.2M17.6 11.8C20.2 12.4 22.6 10.8 22.2 8.4C21.8 6.4 19.4 5.8 18.4 7.2' +
    'M2.6 13.6H19.6C22.2 13.6 24.2 14.2 25 15.4"/>'

interface Layout {
    H: number
    R: number
    dxL: number
    dxR: number
    mode: 'beside' | 'over'
    compact: boolean
    swapAt: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
    fill?: FillMode
}

function sid(uid: string): string {
    return 'rt-ma-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('midAutumn: svg markup did not parse')
    return n
}

// Scalloped mooncake rim: 14 lobes around (0, 7). Returns circles for one layer.
function rim(r0: number, rl: number, cls: string): string {
    let s = '<circle class="' + cls + '" cx="0" cy="7" r="' + r0 + '"/>'
    for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2
        s += '<circle class="' + cls + '" cx="' + (Math.sin(a) * 60).toFixed(2) + '" cy="' + (7 - Math.cos(a) * 60).toFixed(2) + '" r="' + rl + '"/>'
    }
    return s
}

function markMarkup(id: string): string {
    const tri = (cls: string): string =>
        '<g class="' + cls + '"><path fill-rule="evenodd" d="' + FRAME + '"/><path d="' + MID + '"/><path d="' + CORE + '"/></g>'
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<radialGradient id="' + id + '-crust" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#f6c86a"/><stop offset=".7" stop-color="#d9962f"/><stop offset="1" stop-color="#b8741c"/></radialGradient>' +
        '</defs>' +
        '<g class="rt-ma-every" id="' + id + '-every">' +
            '<path class="rt-ma-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-ma-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-ma-cake" id="' + id + '-cake">' +
            '<g class="rt-ma-rim-edge">' + rim(66, 13, 'rt-ma-c') + '</g>' +
            '<g class="rt-ma-rim" fill="url(#' + id + '-crust)">' + rim(63, 10.5, 'rt-ma-c') + '</g>' +
            '<circle class="rt-ma-face-ring" cx="0" cy="7" r="50"/>' +
            '<circle class="rt-ma-face" cx="0" cy="7" r="47" fill="url(#' + id + '-crust)"/>' +
            // Embossed triangle: shadow below-right, highlight above-left, relief face on top.
            '<g transform="translate(0 7) scale(0.6)">' +
                '<g transform="translate(3 3)">' + tri('rt-ma-emb-shadow') + '</g>' +
                '<g transform="translate(-2 -2)">' + tri('rt-ma-emb-light') + '</g>' +
                tri('rt-ma-emb-face') +
            '</g>' +
        '</g>'
}

function findLeafSpan(root: Element, text: string): HTMLElement | null {
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
        if (s.children.length === 0 && s.textContent === text) return s
    }
    return null
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    const hant = ctx.lang === 'zh-Hant'
    let anims: Animation[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    // ----- Stage -----
    const sky = el('div', 'rt-ma-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const tint = el('div', 'rt-ma-tint', sky)
    tint.id = id + '-tint'
    const moon = el('div', 'rt-ma-moon', sky)
    moon.id = id + '-moon'
    const cloudL = el('div', 'rt-ma-cloud rt-ma-cloud-l', sky)
    cloudL.id = id + '-cloud-l'
    const cloudR = el('div', 'rt-ma-cloud rt-ma-cloud-r', sky)
    cloudR.id = id + '-cloud-r'
    cloudL.appendChild(svgFrom('<path class="rt-ma-cloud-fill" d="' + CLOUD_FILL + '"/><path class="rt-ma-cloud-curl" d="' + CLOUD_CURL + '"/>', 'rt-ma-svg', '0 0 120 60'))
    cloudR.appendChild(svgFrom('<g transform="translate(120 0) scale(-1 1)"><path class="rt-ma-cloud-fill" d="' + CLOUD_FILL + '"/><path class="rt-ma-cloud-curl" d="' + CLOUD_CURL + '"/></g>', 'rt-ma-svg', '0 0 120 60'))
    const lantern = el('div', 'rt-ma-lantern', sky)
    lantern.id = id + '-lantern'
    lantern.appendChild(svgFrom(LANTERN, 'rt-ma-svg', '0 0 30 46'))
    const greet = el('div', 'rt-ma-greet', sky)
    greet.id = id + '-greet'
    greet.setAttribute('lang', hant ? 'zh-Hant' : 'zh-Hans')
    greet.classList.add(hant ? 'rt-ma-hant' : 'rt-ma-hans')
    greet.textContent = hant ? '中秋快樂' : '中秋快乐'
    ctx.stage.appendChild(sky)

    // ----- Mark -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(markMarkup(id), 'rt-ma-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word -----
    const word = ctx.word
    word.classList.add('rt-ma-word')
    const risu = findLeafSpan(word, 'Risu')
    const tan = findLeafSpan(word, 'Tanium')
    if (risu) risu.classList.add('rt-ma-risu')
    if (tan) tan.classList.add('rt-ma-tan')
    // The visible (aria-hidden) text group fades while the greeting shows; the accessible-name node is untouched.
    const visual = risu && risu.parentElement !== word ? risu.parentElement : null
    const motif = el('span', 'rt-ma-motif', word)
    motif.id = id + '-motif'
    motif.setAttribute('aria-hidden', 'true')
    const motifInner = el('span', 'rt-ma-motif-in', motif)
    motifInner.appendChild(svgFrom(MOTIF, 'rt-ma-svg', '0 0 26 16'))

    function cancelAll(): void {
        const list = anims
        anims = []
        for (const a of list) {
            try {
                a.onfinish = null
                a.cancel()
            } catch {
                // already gone
            }
        }
    }
    function setFinalClasses(on: boolean): void {
        sky.classList.toggle('rt-ma-final', on)
        mark?.classList.toggle('rt-ma-final', on)
        word.classList.toggle('rt-ma-final', on)
        word.classList.toggle('rt-ma-amber', on)
    }
    function settle(): void {
        if (!resolvePlay) return
        const r = resolvePlay
        resolvePlay = null
        r()
    }
    function applyFinal(): void {
        cancelAll()
        setFinalClasses(true)
        state = 'final'
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        let a: Animation
        try {
            a = node.animate(frames, { duration: o.d, delay: o.at || 0, easing: o.ease || 'linear', fill: o.fill || 'both' })
        } catch {
            return null
        }
        anims.push(a)
        return a
    }

    // Layout from the current stage geometry. stageBox() gives the clamped height and whether the top bar wrapped.
    function layout(): Layout {
        const box = ctx.stageBox()
        const off = ctx.stageOffset()
        const W = box.width ? box.width : ctx.stageWidth()
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const wx = off.wordX
        const wy = off.wordY
        const wh = off.wordHeight
        const wordRight = wx + off.wordWidth
        const wrapped = box.wrapped
        const compact = wrapped || W < 280
        const skyH = box.height ? box.height : (compact ? Math.round(wy + wh + 12) : ctx.stage.getBoundingClientRect().height)
        sky.classList.toggle('rt-ma-compact', compact)
        if (ctx.markSlot) {
            // Soft hole in the tint over the mark slot: the status mark stays undimmed.
            tint.style.setProperty('--rt-ma-mx', (off.markX + off.markSize / 2).toFixed(1) + 'px')
            tint.style.setProperty('--rt-ma-my', (off.markY + off.markSize / 2).toFixed(1) + 'px')
        }
        const narrow = W < 280
        const R = narrow ? 14 : (wrapped ? 18 : 22)    // wrapped (640-680 px) keeps one row but only ~58 px height
        const mx = W - R - (narrow ? 8 : 24)
        const my = Math.max(R + 4, Math.min(wy + wh / 2, skyH - R - 2))
        // Natural greeting width at the word's size (fitText clears the inline font-size, hence the variable).
        greet.style.cssText = '--rt-ma-fs:' + fs + 'px;height:' + wh + 'px;line-height:' + wh + 'px;top:' + wy + 'px;left:0'
        const gwNat = greet.scrollWidth || greet.getBoundingClientRect().width
        const mode: 'beside' | 'over' = !narrow && (mx - R - 10) - (wordRight + 12) >= gwNat ? 'beside' : 'over'
        const gx = mode === 'beside' ? wordRight + 12 : wx
        greet.style.left = gx + 'px'
        const maxW = Math.max(40, (mx - R - 6) - gx)
        ctx.fitText(greet, maxW)
        const gw = Math.min(greet.getBoundingClientRect().width, maxW)
        moon.style.cssText = 'left:' + (mx - R) + 'px;top:' + (my - R) + 'px;width:' + 2 * R + 'px;height:' + 2 * R + 'px'
        const cw = R * 4.2
        const ch = cw / 2
        cloudL.style.cssText = 'left:' + (mx - cw * 0.75) + 'px;top:' + (my - ch * 0.7) + 'px;width:' + cw + 'px;height:' + ch + 'px'
        cloudR.style.cssText = 'left:' + (mx - cw * 0.25) + 'px;top:' + (my - ch * 0.35) + 'px;width:' + cw + 'px;height:' + ch + 'px'
        // Parting distance (the last keyframe goes 1.3x further); in 'beside' the left bank stops short of the word.
        let dxL = cw * 0.55
        const dxR = cw * 0.55
        if (mode === 'beside') dxL = Math.max(0, Math.min(dxL * 1.3, (mx - cw * 0.75) - (wordRight + 4)) / 1.3)
        const lw = compact ? 20 : 26
        let lx = Math.min(gx + gw + 10, mx - R - lw - 2)
        if (lx < gx + gw + 4) lx = mx - lw / 2           // no room beside the text: rise in front of the moon
        lantern.style.cssText = 'left:' + lx + 'px;top:' + skyH + 'px;width:' + lw + 'px;height:' + (lw * 46 / 30) + 'px'
        return { H: skyH, R, dxL, dxR, mode, compact, swapAt: 0 }
    }

    let L: Layout | null = null
    function timeline(): void {
        const lay = layout()
        L = lay
        add(sky, [], { d: 7600 })    // scene clock (property-less), always anims[0]
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const POP = 'cubic-bezier(0.34, 1.4, 0.64, 1)'

        const beside = lay.mode === 'beside'
        // Timing table. 'over' clears the word (0-450) before clouds or moon appear and brings it back at 6100, after the
        // moon has faded (by 5950), so no night layer is ever drawn over a visible word.
        const T = beside
            ? { cloudAt: 0, moonAt: 200, moonD: 6000, moonIn: 0.24, moonHold: 0.8, swapAt: 5650 }
            : { cloudAt: 450, moonAt: 650, moonD: 5300, moonIn: 0.27, moonHold: 0.81, swapAt: 3000 }
        lay.swapAt = T.swapAt
        sky.setAttribute('data-rt-ma-mode', lay.mode)

        // 1. Night: tint 0-600 in, out 5400-6600; clouds close in, part and fade over 2.6 s; the moon brightens and later
        //    fades (see T).
        add(tint, [{ opacity: 0 }, { opacity: 1, offset: 0.091 }, { opacity: 1, offset: 0.818 }, { opacity: 0 }], { d: 6600 })
        add(moon, [
            { opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)', offset: T.moonIn },
            { opacity: 1, transform: 'scale(1)', offset: T.moonHold }, { opacity: 0, transform: 'scale(1.04)' },
        ], { at: T.moonAt, d: T.moonD, ease: EASE })
        const CE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        const banks: Array<[HTMLElement, number]> = [[cloudL, -lay.dxL], [cloudR, lay.dxR]]
        for (const c of banks) {
            add(c[0], [
                { opacity: 0, transform: 'translateX(0)' },
                { opacity: 1, transform: 'translateX(0)', offset: 0.2 },
                { opacity: 1, transform: 'translateX(0)', offset: 0.35, easing: CE },
                { opacity: 0.9, transform: 'translateX(' + c[1].toFixed(1) + 'px)', offset: 0.85 },
                { opacity: 0, transform: 'translateX(' + (c[1] * 1.3).toFixed(1) + 'px)' },
            ], { at: T.cloudAt, d: 2600 })
        }

        // The word: 'beside' dims it to 0.35 under the greeting (2300-2800) and hides it only for the colour swap
        // (5200-5600); 'over' hides it 0-450. Both bring it back amber 6100-6900.
        if (visual) {
            if (beside) {
                add(visual, [{ opacity: 1 }, { opacity: 0.35, offset: 0.152 }, { opacity: 0.35, offset: 0.879 }, { opacity: 0 }], { at: 2300, d: 3300 })
            } else {
                add(visual, [{ opacity: 1 }, { opacity: 0 }], { at: 0, d: 450, ease: EASE_IN })
            }
            add(visual, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 6100, d: 800, ease: EASE_OUT, fill: 'forwards' })
        }
        // Swap the word colour while it is invisible: an empty (property-less) animation whose end adds the amber class, so
        // the swap pauses with the timeline instead of using a timer.
        const swap = add(motif, [], { at: 0, d: T.swapAt })
        if (swap) {
            swap.onfinish = () => {
                if (state === 'playing') word.classList.add('rt-ma-amber')
            }
        }

        // 2. Lantern drifts up 1600-5600 with a gentle sway; greeting 2500-5100. Per-keyframe easing; linear overall so the
        //    lantern lingers beside the greeting (stage y ~56 to ~1 to gone).
        const H = lay.H
        const SW = 'cubic-bezier(0.45, 0, 0.55, 1)'
        add(lantern, [
            { transform: 'translateY(0) rotate(-4deg)', opacity: 0, easing: SW },
            { transform: 'translateY(-40px) rotate(4deg)', opacity: 1, offset: 0.2, easing: SW },
            { transform: 'translateY(-' + (H * 0.72).toFixed(1) + 'px) rotate(-3deg)', opacity: 1, offset: 0.5, easing: SW },
            { transform: 'translateY(-' + (H * 0.98).toFixed(1) + 'px) rotate(3deg)', opacity: 1, offset: 0.78, easing: SW },
            { transform: 'translateY(-' + (H + 44).toFixed(1) + 'px) rotate(-2deg)', opacity: 0 },
        ], { at: 1600, d: 4000 })
        add(greet, [
            { opacity: 0, transform: (greet.style.transform || '') + ' translateY(3px)' },
            { opacity: 1, transform: (greet.style.transform || '') + ' translateY(0)', offset: 0.23 },
            { opacity: 1, transform: (greet.style.transform || '') + ' translateY(0)', offset: 0.77 },
            { opacity: 0, transform: (greet.style.transform || '') + ' translateY(-2px)' },
        ], { at: 2500, d: 2600, ease: EASE })

        // 3. Mooncake stamp: the triangle lifts 5000-5450, presses down 5450-5700 and vanishes into the cake, which squashes
        //    in 5600-6300.
        if (mark) {
            add(mark.querySelector('.rt-ma-every'), [
                { transform: 'translateY(0) scale(1)', opacity: 1, easing: EASE_OUT },
                { transform: 'translateY(-18px) scale(1.14)', opacity: 1, offset: 0.55, easing: EASE_IN },
                { transform: 'translateY(2px) scale(0.72)', opacity: 1, offset: 0.86 },
                { transform: 'translateY(2px) scale(0.72)', opacity: 0 },
            ], { at: 5000, d: 700 })
            add(mark.querySelector('.rt-ma-cake'), [
                { transform: 'scale(0.8)', opacity: 0 },
                { transform: 'scale(1.07, 0.94)', opacity: 1, offset: 0.35 },
                { transform: 'scale(0.97, 1.03)', opacity: 1, offset: 0.65 },
                { transform: 'scale(1)', opacity: 1 },
            ], { at: 5600, d: 700, ease: EASE_OUT })
        }

        // Word motif (cloud with curl) pops in 6800-7600.
        add(motifInner, [{ opacity: 0, transform: 'translateY(0.15em) scale(0.4) rotate(-20deg)' }, { opacity: 1, transform: 'none' }], { at: 6800, d: 800, ease: POP })
    }

    // Watches the first (clock) animation: it ends last, so all others are done, and a rebuild swaps it for a new one.
    function arm(): void {
        const mine = anims.slice()
        Promise.all(mine.map((a) => a.finished)).then(() => {
            if (state === 'playing' && anims[0] === mine[0]) applyFinal()
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
        setFinalClasses(false)
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        timeline()
        arm()
        return playPromise
    }

    // ctx.onRelayout: rebuild the timeline from the new geometry and jump to the current scene time, so the mode, moon,
    // clouds, greeting and lantern follow the real stage. Coalesced to one rebuild per frame.
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
            word.classList.remove('rt-ma-amber')
            timeline()
            if (L && t >= L.swapAt) word.classList.add('rt-ma-amber')
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
        motif.remove()
        word.classList.remove('rt-ma-word', 'rt-ma-final', 'rt-ma-amber')
        risu?.classList.remove('rt-ma-risu')
        tan?.classList.remove('rt-ma-tan')
        settle()
    }

    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'midAutumn',
    durationMs: DURATION,
    build,
}
export default scene
