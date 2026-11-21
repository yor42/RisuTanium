// Seasonal scene: chuseok (dangi lunar 8/14-16, lang ko).
//
// Storyboard (8.32 s of motion, 8.8 s budget): the everyday wordmark and mark step back 0-0.8 s; night falls 0-0.9 s (lifts
// 6.6-7.6 s); the eave slides down from the top edge 0.3-1.4 s and withdraws 5.0-6.2 s; the persimmon branch swings in from
// the right 0.6-2.8 s and leaves 5.0-6.2 s (narrow stage: settles by 2.3 s, leaves 2.3-2.9 s); the greeting fades and scales
// in 2.8-3.4 s, holds and fades by 5.1 s; the full moon rises into the mark slot 4.9-6.7 s (drawn by a twin in the stage)
// and its halo comes up 5.8-6.9 s; the triangle's shadow is cast inside the moon 6.1-7.2 s; the wordmark returns letter group
// by letter group in the five-direction colours 7.2-8.32 s.
// Final: moon mark with the triangle's shadow, wordmark in five colour groups with a dancheong-style outline, no sky.
// Motion is Web Animations only: transform and opacity. No filters, no loops. The final pose is static CSS under
// .rt-cs-final, so finish() gives the same pose from any point.
//
// Font: EBS Juseekyung Medium (the only cut on the CDN) from the commit-pinned jsDelivr URL, loaded by the host from
// `fonts`. The greeting uses it only if ctx.fonts.ready() resolved true before the greeting enters (the host caps the wait
// at timeoutMs = 2500 < 2750 ms); otherwise the NanumSquare Neo fallback stack.
import './chuseok.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 8800
const FAMILY = 'EBS Juseekyung'
const FONT_URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_one@40fb96ceb772b1b734b9569ffbb91721309bdd2b/EBSJSKMedium.woff'
const GREETING = '행복한 한가위 되세요!'
const SVGNS = 'http://www.w3.org/2000/svg'
// Stages under this width send the branch away before the greeting.
const NARROW = 240

// Everyday mark, shown at t=0 so the status mark hand-off is seamless.
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Five-direction colour groups, as the R/i/s/u/Tan/ium split: blue, red, yellow, white, black, then blue again for "ium".
const GROUPS: Array<[string, string]> = [['R', 'cheong'], ['i', 'jeok'], ['s', 'hwang'], ['u', 'baek'], ['Tan', 'heuk'], ['ium', 'cheong']]

// Moon mark. Centre (0,7) = the centre of the -73 -66 146 146 box; r 72 stays inside it. The halo (r 96) reaches 5 px past a
// 32 px slot, inside the contract's 6 px allowance.
function moonMarkup(id: string): string {
    return '<defs>' +
        '<linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<radialGradient id="' + id + '-halo" cx="0" cy="7" r="96" gradientUnits="userSpaceOnUse">' +
            '<stop offset=".7" stop-color="#ffe7a0" stop-opacity=".42"/><stop offset="1" stop-color="#ffe7a0" stop-opacity="0"/></radialGradient>' +
        '<clipPath id="' + id + '-disc"><circle cx="0" cy="7" r="72"/></clipPath>' +
        '</defs>' +
        '<g class="rt-cs-every" id="' + id + '-every">' +
            '<path class="rt-cs-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-cs-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<circle class="rt-cs-halo" id="' + id + '-halo" cx="0" cy="7" r="96" fill="url(#' + id + '-halo)"/>' +
        '<g class="rt-cs-moon" id="' + id + '-moon">' +
            '<circle class="rt-cs-disc" cx="0" cy="7" r="72"/>' +
            // Two lighter flat patches near the limb (the moon's own texture, kept away from the centre).
            '<g clip-path="url(#' + id + '-disc)" class="rt-cs-patch">' +
                '<path d="M-58-26C-50-44-30-52-16-50C-26-40-40-30-46-14C-52-12-60-16-58-26Z"/>' +
                '<path d="M40 52C52 44 60 30 62 18C68 30 64 52 50 64C44 64 38 58 40 52Z"/>' +
            '</g>' +
            '<circle class="rt-cs-rim" cx="0" cy="7" r="70.5"/>' +
            // The cast shadow: the everyday mark's silhouette (frame + middle triangle), 0.8x, on the moon's centre.
            '<g class="rt-cs-shadow" id="' + id + '-shadow">' +
                '<g transform="translate(0 6) scale(0.8)">' +
                    '<path fill-rule="evenodd" d="' + FRAME + '"/>' +
                    '<path d="' + MID + '"/>' +
                '</g>' +
            '</g>' +
        '</g>'
}

// Persimmon branch, viewBox 0 0 72 72, attached at the top-right corner.
function fruit(cx: number, cy: number, r: number): string {
    return '<g transform="translate(' + cx + ' ' + cy + ')">' +
        '<circle class="rt-cs-fruit-shade" r="' + r + '"/>' +
        '<circle class="rt-cs-fruit" cx="-1" cy="-1" r="' + (r - 1.1) + '"/>' +
        '<ellipse class="rt-cs-fruit-hi" cx="' + (-r * 0.38) + '" cy="' + (-r * 0.36) + '" rx="' + (r * 0.26) + '" ry="' + (r * 0.15) + '" transform="rotate(-35 ' + (-r * 0.38) + ' ' + (-r * 0.36) + ')"/>' +
        '<path class="rt-cs-calyx" transform="translate(0 ' + (-r + 1.6) + ') scale(1.15)" d="M0-3.2L1.3-.7L4 0L1.3.7L0 2.6L-1.3.7L-4 0L-1.3-.7Z"/>' +
        '</g>'
}
function leaf(x: number, y: number, rot: number, s: number, cls: string): string {
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + rot + ') scale(' + s + ')">' +
        '<path class="' + cls + '" d="M0 0C4-5.2 12-5.4 17 0C12 5.4 4 5.2 0 0Z"/>' +
        '<path class="rt-cs-rib" d="M1 0H15"/></g>'
}
const BRANCH =
    leaf(58, 5, 158, 1, 'rt-cs-leaf') +
    leaf(40, 12, 205, 0.95, 'rt-cs-leaf-b') +
    '<path class="rt-cs-wood" d="M74 1C62 4 46 9 33 16C24 21 15 25 6 29L5.2 27C14 23 23 18.4 31.4 13.4C45 5.6 60 .2 74-3Z"/>' +
    '<path class="rt-cs-twig" d="M31 15.6L27.6 27M51 7.4L52.4 16.8M12 26L11.4 32"/>' +
    leaf(22, 21, 120, 0.9, 'rt-cs-leaf') +
    fruit(52.4, 24.4, 7.6) +
    fruit(27, 35.4, 8.8) +
    fruit(11.4, 38.6, 6.6) +
    leaf(45, 14, 62, 0.85, 'rt-cs-leaf-b')

// Eave: a hanok eave seen from the front, ends swept up, sagging in the middle, round tile ends along the edge and a thin
// warm moon rim on the tiles. Built for width W so its tile ends stay round.
function eaveMarkup(W: number): { markup: string, height: number } {
    // The roof stops short of the stage edges so both corners show: the edge sags gently through the middle and sweeps up
    // into a pointed tip at each end, f = |2t - 1|^4.
    const H = 30
    const yEnd = 0.5
    const yMid = 14
    const m = Math.round(Math.max(10, Math.min(22, W * 0.05)))   // sky left at each side
    const x0 = m
    const x1 = W - m
    const x = (t: number): number => x0 + t * (x1 - x0)
    const y = (t: number): number => yMid - (yMid - yEnd) * Math.pow(Math.abs(2 * t - 1), 4)
    const STEPS = 56
    let edge = ''
    for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS
        edge += (k ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(t).toFixed(2)
    }
    // Roof mass: the tips sit on the top edge and the mass rises straight above the tile line.
    let s = '<path class="rt-cs-roof" d="' + edge + 'L' + (x1 - 3).toFixed(1) + ' 0H' + (x0 + 3).toFixed(1) + 'Z"/>'
    // Tile furrows: faint vertical lines on the roof mass.
    const n = Math.max(7, Math.round((x1 - x0) / 16))
    let lines = ''
    for (let i = 1; i < n; i++) {
        const tx = i / n
        if (y(tx) < 5) continue
        lines += 'M' + x(tx).toFixed(1) + ' 0V' + (y(tx) - 1.2).toFixed(1)
    }
    s += '<path class="rt-cs-furrow" d="' + lines + '"/>'
    // Round tile ends hang under the edge (not on the swept-up tips); a thin warm moon rim runs along the tiles.
    let discs = ''
    for (let j = 0; j < n; j++) {
        const q = (j + 0.5) / n
        if (y(q) < 6) continue
        discs += '<circle cx="' + x(q).toFixed(1) + '" cy="' + (y(q) + 3.4).toFixed(1) + '" r="4.6"/>'
    }
    s += '<g class="rt-cs-makse">' + discs + '</g>'
    s += '<path class="rt-cs-eave-rim" d="' + edge + '"/>'
    return { markup: s, height: H }
}

// Night wash stars: fixed positions in % of the stage, so no layout reads. [x, y, radius]
const STARS: Array<[number, number, number]> = [[18, 28, 1], [34, 70, 0.8], [47, 22, 1.1], [63, 58, 0.8], [71, 30, 1], [86, 72, 0.9], [9, 64, 0.8], [56, 84, 0.7]]

interface Geometry {
    W: number
    B: number
    x: number
}

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-cs-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
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
    if (!(n instanceof SVGSVGElement)) throw new Error('chuseok: svg markup did not parse')
    return n
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null
    let fontOk = false

    // The host writes the description into an aria-describedby node with its own lang and adds a period only when the text
    // has no closing punctuation, so the greeting keeps its "!".
    ctx.setDescription(GREETING, 'ko')

    // ----- Stage -----
    const sky = el('div', 'rt-cs-sky')
    sky.id = id + '-sky'
    sky.setAttribute('aria-hidden', 'true')
    const night = el('div', 'rt-cs-night', sky)
    night.id = id + '-night'
    const eave = el('div', 'rt-cs-eave', sky)
    eave.id = id + '-eave'
    const branch = el('div', 'rt-cs-branch', sky)
    branch.id = id + '-branch'
    branch.appendChild(svgFrom(BRANCH, 'rt-cs-branch-svg', '0 0 72 72'))
    const greetBox = el('div', 'rt-cs-greetbox', sky)
    greetBox.setAttribute('lang', 'ko')
    const greet = el('span', 'rt-cs-greet rt-cs-fb', greetBox)
    greet.id = id + '-greet'
    greet.textContent = GREETING
    // The stage sits above the mark slot, so the rising moon is drawn in the stage at the mark's box (an exact twin of the
    // slot's moon); the slot's moon is revealed underneath once the rise ends and the stage clears at the end.
    const moonBox = el('div', 'rt-cs-stagemoon', sky)
    const smoon = svgFrom(moonMarkup(id + '-s'), 'rt-cs-mark rt-cs-twin', '-73 -66 146 146')
    moonBox.appendChild(smoon)
    ctx.stage.appendChild(sky)
    // Triangle policy: when the status mark takes over (non-idle), the host hides the slot; the twin must follow, or a
    // celebratory moon would sit over a running status mark. While a status runs, its (raised) mark sits where the greeting
    // starts, so the greeting moves right of the mark and re-fits; it moves back when the status returns to idle.
    let slotObs: MutationObserver | null = null
    let busy = false
    function syncTwin(): void {
        const off = !!(ctx.markSlot && ctx.markSlot.classList.contains('rt-sw-markslot-off'))
        moonBox.classList.toggle('rt-cs-twin-off', off)
        if (off !== busy) {
            busy = off
            if (state === 'playing') {
                layoutStage()
                fitGreeting()
            }
        }
    }
    if (ctx.markSlot && typeof MutationObserver !== 'undefined') {
        slotObs = new MutationObserver(syncTwin)
        slotObs.observe(ctx.markSlot, { attributes: true, attributeFilter: ['class'] })
    }

    // ----- Mark slot: everyday mark to moon with the triangle's shadow -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = svgFrom(moonMarkup(id), 'rt-cs-mark', '-73 -66 146 146')
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: five-direction colour groups over the everyday text -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-cs-word')
    const obang = el('span', 'rt-cs-obang', word)
    obang.id = id + '-obang'
    obang.setAttribute('aria-hidden', 'true')
    const groups = GROUPS.map((g, i) => {
        const s = el('span', 'rt-cs-g rt-cs-' + g[1], obang)
        s.id = id + '-g' + (i + 1)
        s.textContent = g[0]
        return s
    })
    const prevWidth = word.style.width

    function sizeWord(): void {
        if (state === 'destroyed') return
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const w = obang.offsetWidth
        if (w > 0) word.style.width = (w / fs).toFixed(3) + 'em'
    }

    // Stage geometry (stage px). Measured at play and again on every ctx.onRelayout call (the topbar may settle or the
    // window may resize after build, including mid-play), and before the greeting enters.
    let G: Geometry = { W: 0, B: 0, x: 0 }
    // The dusk's mark hole opens only once the moon rises into the slot.
    let holeOn = false
    // Decided at play: stages under 240 px send the branch away before the greeting.
    let narrow = false
    function layoutStage(): void {
        if (state === 'destroyed') return
        const W = ctx.stageWidth()
        const off = ctx.stageOffset()
        const SH = ctx.stageBox().height || ctx.stage.getBoundingClientRect().height || 96
        let stars = ''
        for (const s of STARS) stars += '<circle cx="' + (s[0] * W / 100).toFixed(1) + '" cy="' + (s[1] * SH / 100).toFixed(1) + '" r="' + s[2] + '"/>'
        night.innerHTML = ''
        night.appendChild(svgFrom(stars, 'rt-cs-stars', '0 0 ' + Math.round(W) + ' ' + Math.round(SH)))
        const e = eaveMarkup(Math.max(40, Math.round(W)))
        eave.innerHTML = ''
        eave.appendChild(svgFrom(e.markup, 'rt-cs-eave-svg', '0 0 ' + Math.round(W) + ' ' + e.height))
        eave.style.height = e.height + 'px'
        // Branch: 22% of the stage, 36-78 px, so a 165 px stage still leaves the greeting about 110 px.
        const B = Math.round(Math.max(36, Math.min(78, W * 0.22)))
        branch.style.width = B + 'px'
        branch.style.height = B + 'px'
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const h = off.wordHeight || fs * 1.2
        const top = Math.max(off.wordY, 26)
        const gx = busy ? off.wordX : off.markX
        greetBox.style.left = gx + 'px'
        greetBox.style.top = top + 'px'
        greetBox.style.height = h + 'px'
        greetBox.style.setProperty('--rt-cs-fs', fs + 'px')
        // The dusk covers the brand row only (on phones the mode switcher's row starts below it), plus a soft tail.
        const rowBottom = Math.max(off.markY + (off.markSize || 0), top + h)
        night.style.setProperty('--rt-cs-night-h', Math.min(SH, Math.round(rowBottom + 16)) + 'px')
        // Soft hole over the mark slot. Parked off-stage while the slot is visually empty (the everyday mark has faded and
        // the moon has not risen), where it would show as a dark disc; a running status mark needs no hole, because the
        // host raises it above the stage.
        const hole = holeOn && off.markSize
        night.style.setProperty('--rt-cs-mx', (hole ? off.markX + off.markSize / 2 : -100).toFixed(1) + 'px')
        night.style.setProperty('--rt-cs-my', (hole ? off.markY + off.markSize / 2 : -100).toFixed(1) + 'px')
        if (ctx.markSlot && off.markSize) {
            moonBox.style.left = off.markX + 'px'
            moonBox.style.top = off.markY + 'px'
            moonBox.style.width = off.markSize + 'px'
            moonBox.style.height = off.markSize + 'px'
        } else moonBox.style.display = 'none'
        G = { W, B, x: gx }
    }
    // The greeting never reaches the branch: it is fitted to the space left of the branch's box (right: 6 px) minus 6 px.
    function fitGreeting(): void {
        if (!G.W) return
        const max = narrow ? G.W - G.x - 6 : G.W - G.x - G.B - 6 - 6
        if (max > 0) ctx.fitText(greet, max)
    }

    syncTwin()

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
        sky.classList.add('rt-cs-final')
        mark?.classList.add('rt-cs-final')
        word.classList.add('rt-cs-final')
        state = 'final'
        holeOn = true
        sizeWord()
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

    function timeline(): void {
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'
        holeOn = false
        busy = !!(ctx.markSlot && ctx.markSlot.classList.contains('rt-sw-markslot-off'))
        layoutStage()
        // The moon starts rising into the slot at 4900: open the dusk's mark hole then.
        later(() => {
            if (state !== 'playing') return
            holeOn = true
            layoutStage()
            fitGreeting()
        }, 4900)

        // 0-800: everyday wordmark and mark step back (fade, scale 1 to 0.96).
        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 800, ease: IN })
        if (mark) add(mark.querySelector('.rt-cs-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 800, ease: IN })

        // 0-900: night falls; it lifts 6600-7600 as the moon settles and the wordmark returns.
        add(night, [{ opacity: 0 }, { opacity: 1, offset: 0.9 / 7.6 }, { opacity: 1, offset: 6.6 / 7.6 }, { opacity: 0 }], { at: 0, d: 7600, ease: INOUT })

        // 300-1400: the eave slides down from the top edge; 5000-6200 it withdraws upward.
        add(eave, [
            { transform: 'translateY(-110%)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1, offset: 1.1 / 5.9 },
            { transform: 'translateY(0)', opacity: 1, offset: 4.7 / 5.9 },
            { transform: 'translateY(-110%)', opacity: 0 },
        ], { at: 300, d: 5900, ease: INOUT })

        // 600-2800: the persimmon branch swings in from the right about its stem and settles (before the greeting enters,
        // so the swing never crosses it); 5000-6200 it leaves. On a narrow stage (under 240 px, phones) it swings in,
        // settles by 2300 and leaves 2300-2900, so the greeting gets the whole width.
        narrow = G.W > 0 && G.W < NARROW
        if (!narrow) {
            add(branch, [
                { transform: 'translateX(70%) rotate(-24deg)', opacity: 0 },
                { transform: 'translateX(0) rotate(7deg)', opacity: 1, offset: 0.9 / 5.6 },
                { transform: 'translateX(0) rotate(-3.5deg)', opacity: 1, offset: 1.5 / 5.6 },
                { transform: 'translateX(0) rotate(1.2deg)', opacity: 1, offset: 1.9 / 5.6 },
                { transform: 'translateX(0) rotate(0deg)', opacity: 1, offset: 2.2 / 5.6 },
                { transform: 'translateX(0) rotate(0deg)', opacity: 1, offset: 4.4 / 5.6 },
                { transform: 'translateX(80%) rotate(-12deg)', opacity: 0 },
            ], { at: 600, d: 5600, ease: INOUT })
        } else {
            add(branch, [
                { transform: 'translateX(70%) rotate(-24deg)', opacity: 0 },
                { transform: 'translateX(0) rotate(7deg)', opacity: 1, offset: 0.9 / 2.3 },
                { transform: 'translateX(0) rotate(-3deg)', opacity: 1, offset: 1.3 / 2.3 },
                { transform: 'translateX(0) rotate(0deg)', opacity: 1, offset: 1.6 / 2.3 },
                { transform: 'translateX(0) rotate(0deg)', opacity: 1, offset: 1.7 / 2.3 },
                { transform: 'translateX(80%) rotate(-12deg)', opacity: 0 },
            ], { at: 600, d: 2300, ease: INOUT })
        }

        // 2800-5100: the greeting fades and scales in (0.96 to 1) under the eave, holds, and fades out. Geometry is
        // re-measured just before it enters, whatever the host reported earlier.
        later(() => {
            if (state !== 'playing') return
            if (fontOk) {
                greet.classList.remove('rt-cs-fb')
                greet.classList.add('rt-cs-ebs')
            }
            layoutStage()
            fitGreeting()
        }, 2750)
        add(greet, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 2.3 },
            { opacity: 1, transform: 'scale(1)', offset: 1.8 / 2.3 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: 2800, d: 2300, ease: INOUT })

        if (mark) {
            // The slot's own moon is complete but stays hidden under the twin until 7300 (the twin has settled by 7200).
            for (const n of [mark.querySelector('.rt-cs-moon'), mark.querySelector('.rt-cs-halo'), mark.querySelector('.rt-cs-shadow')]) {
                add(n, [{ opacity: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1 }], { at: 0, d: 7300 })
            }
            // 4900-6250: the full moon rises into the mark slot (drawn by the stage twin) as the greeting fades.
            add(smoon.querySelector('.rt-cs-moon'), [
                { opacity: 0, transform: 'translateY(64px) scale(0.72)' },
                { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.75 },
                { opacity: 1, transform: 'translateY(0) scale(1)' },
            ], { at: 4900, d: 1800, ease: OUT })
            add(smoon.querySelector('.rt-cs-halo'), [{ opacity: 0 }, { opacity: 1 }], { at: 5800, d: 1100, ease: OUT })
            // 6100-7200: the triangle's shadow is cast inside the moon.
            add(smoon.querySelector('.rt-cs-shadow'), [
                { opacity: 0, transform: 'scale(1.1)' },
                { opacity: 1, transform: 'scale(1)' },
            ], { at: 6100, d: 1100, ease: OUT })
        }

        // 7200-8320: the wordmark returns letter group by letter group in the five-direction colours.
        later(() => {
            if (state === 'playing') sizeWord()
        }, 800)
        groups.forEach((s, i) => {
            add(s, [
                { opacity: 0, transform: 'translateY(0.18em) scale(0.92)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' },
            ], { at: 7200 + i * 140, d: 420, ease: OUT })
        })
    }

    // Host seam: called with the stage box whenever the stage geometry changes after build.
    ctx.onRelayout(() => {
        if (state === 'destroyed') return
        if (state === 'playing') {
            layoutStage()
            fitGreeting()
        }
        sizeWord()
    })

    function play(): Promise<void> {
        if (state === 'destroyed') return Promise.resolve()
        if (state === 'final' || ctx.reduced) {
            applyFinal()
            return Promise.resolve()
        }
        if (playPromise && state === 'playing') return playPromise
        cancelAll()
        sky.classList.remove('rt-cs-final')
        mark?.classList.remove('rt-cs-final')
        word.classList.remove('rt-cs-final')
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
        if (slotObs) {
            slotObs.disconnect()
            slotObs = null
        }
        sky.remove()
        mark?.remove()
        obang.remove()
        word.classList.remove('rt-cs-word', 'rt-cs-final')
        word.style.width = prevWidth
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'chuseok',
    durationMs: DURATION,
    fonts: [{ family: FAMILY, url: FONT_URL, weight: 400, timeoutMs: 2500, sample: GREETING }],
    build,
}
export default scene
