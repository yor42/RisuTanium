// Seasonal scene: bunkaNoHi (文化の日, Culture Day; Nov 3, lang ja).
//
// The Japanese counterpart of hangulDay's typographic hand-off: "RisuTanium" leaves, "11月3日 文化の日" is set in a mincho, the
// triangle is redrawn as a seigaiha (青海波) wave field with a vermilion seal (判子) at its core, and the wordmark returns as
// "リスタニウム" (ctx.setName('リスタニウム', 'ja')).
// Storyboard (5.8 s of motion, 6.5 s budget): the everyday wordmark and mark step back 0-1.2 s; the date fades and scales in
// 1.0-3.6 s and fades out by 4.6 s; the outline draws 1.2-1.8 s, the wave rows roll in from the apex upwards 1.5-2.95 s, the
// hole's outline draws 2.6-3.05 s and the seal is pressed 3.15-3.7 s; リス fades and scales in at 4.6 s, タニウム 200 ms later.
// Final: the seigaiha mark with its seal, リスタニウム, no date line.
// Fonts: none loaded. Japanese text uses the system mincho stack. The word box keeps its everyday width: if the kana run is
// wider in the face the system picked, it is set smaller instead, so the header never reflows.
// The seal is generic and abstract: a vermilion square with a border and a carved triangle (the mark's own core). It holds no
// characters, so it can never read as a name.
// Motion is Web Animations only: opacity/transform, plus stroke-dashoffset on the two outline strokes. No filters, no loops.
// The final pose is static CSS under .rt-bk-final, so finish() gives the same pose from any point.
import './bunkaNoHi.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 6500
const SVGNS = 'http://www.w3.org/2000/svg'

// Everyday mark, shown at t=0 so the hand-off from the status mark is seamless.
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const OUTER = 'M-55.85-32.25H55.85L0 64.49Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

// Seigaiha (青海波): overlapping wave scales of radius 30, rows 15 units apart, alternate rows offset by half a scale, clipped
// to the outer triangle. Each scale is a filled disc with three rings (edge, middle, inner); later rows paint over the lower
// half of earlier ones, which is what makes the fan-scale pattern.
const SG_R = 30
const SG_RINGS = [28.5, 19, 9.5]
const SG_ROWS = [-22, -7, 8, 23, 38, 53]
function circlePath(cx: number, cy: number, r: number): string {
    const f = (v: number): number => Math.round(v * 100) / 100
    return 'M' + f(cx - r) + ' ' + f(cy) + 'a' + r + ' ' + r + ' 0 1 0 ' + f(2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + f(-2 * r) + ' 0Z'
}
// Half-width of the outer triangle at height y (0 outside it).
function halfWidth(y: number): number {
    return y < -32.25 || y > 64.49 ? 0 : 55.85 * (64.49 - y) / 96.74
}
interface SeigaihaRow {
    fill: string
    rings: string
}
function seigaihaRows(): SeigaihaRow[] {
    const rows: SeigaihaRow[] = []
    for (let i = 0; i < SG_ROWS.length; i++) {
        const y = SG_ROWS[i]
        const off = i % 2 ? SG_R : 0
        let fill = ''
        let rings = ''
        for (let x = -120 + off; x <= 120; x += 2 * SG_R) {
            // Keep a scale only when its disc reaches into the triangle between its own top and its centre row.
            const reach = Math.max(halfWidth(Math.max(-32.25, y - SG_R)), halfWidth(Math.min(64.49, y)))
            if (Math.abs(x) - SG_R >= reach) continue
            fill += circlePath(x, y, SG_R)
            for (const ring of SG_RINGS) rings += circlePath(x, y, ring)
        }
        rows.push({ fill, rings })
    }
    return rows
}
// The seal: a 24-unit vermilion square (rx 3.5) centred on (0, -4) inside the hole, a thin border, and the mark's triangle
// carved in it. Placed so its lower corners stay inside the narrowing hole (half-width 15.4 at y 8).
const SEAL = { x: -12, y: -16, s: 24, r: 3.5 }
const SEAL_BORDER = { x: -9.6, y: -13.6, s: 19.2, r: 2 }
const SEAL_CARVE = 'M-6.6-8.6H6.6L0 4Z'

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-bk-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
}

function el(tag: 'div' | 'span', cls: string, parent?: Element): HTMLElement {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function markMarkup(id: string): string {
    const rows = seigaihaRows()
    let s = '<defs><linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>' +
        '<clipPath id="' + id + '-clip"><path d="' + OUTER + '"/></clipPath></defs>' +
        '<g class="rt-bk-every" id="' + id + '-every">' +
            '<path class="rt-bk-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-bk-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-bk-new" id="' + id + '-new">' +
            '<g class="rt-bk-waves" id="' + id + '-waves" clip-path="url(#' + id + '-clip)">'
    for (let i = 0; i < rows.length; i++) {
        s += '<g class="rt-bk-row" id="' + id + '-row' + (i + 1) + '">' +
            '<path class="rt-bk-scale" d="' + rows[i].fill + '"/>' +
            '<path class="rt-bk-rings" d="' + rows[i].rings + '"/>' +
            '</g>'
    }
    s += '</g>' +
        '<path class="rt-bk-edge" id="' + id + '-edge" pathLength="1" d="' + OUTER + '"/>' +
        '<path class="rt-bk-hole" id="' + id + '-hole" pathLength="1" d="' + HOLE + '"/>' +
        '<g class="rt-bk-seal" id="' + id + '-seal">' +
            '<rect class="rt-bk-seal-body" x="' + SEAL.x + '" y="' + SEAL.y + '" width="' + SEAL.s + '" height="' + SEAL.s + '" rx="' + SEAL.r + '"/>' +
            '<rect class="rt-bk-seal-line" x="' + SEAL_BORDER.x + '" y="' + SEAL_BORDER.y + '" width="' + SEAL_BORDER.s + '" height="' + SEAL_BORDER.s + '" rx="' + SEAL_BORDER.r + '"/>' +
            '<path class="rt-bk-seal-carve" d="' + SEAL_CARVE + '"/>' +
        '</g>' +
        '</g>'
    return s
}

function markSvg(id: string): SVGSVGElement {
    const holder = document.createElement('span')
    holder.innerHTML = '<svg xmlns="' + SVGNS + '" viewBox="-73 -66 146 146" class="rt-bk-mark" aria-hidden="true" focusable="false">' + markMarkup(id) + '</svg>'
    const n = holder.firstElementChild
    if (!(n instanceof SVGSVGElement)) throw new Error('bunkaNoHi: svg markup did not parse')
    return n
}

function build(ctx: SceneContext): SceneInstance {
    const id = sid(ctx.uid)
    let anims: Animation[] = []
    let timers: number[] = []
    let state: 'built' | 'playing' | 'final' | 'destroyed' = 'built'
    let resolvePlay: (() => void) | null = null
    let playPromise: Promise<void> | null = null

    ctx.setName('リスタニウム', 'ja')
    ctx.setDescription('11月3日 文化の日', 'ja')

    // ----- Stage: the date line, in the mincho stack -----
    const dateBox = el('div', 'rt-bk-datebox')
    dateBox.id = id + '-datebox'
    dateBox.setAttribute('aria-hidden', 'true')
    dateBox.setAttribute('lang', 'ja')
    const date = el('span', 'rt-bk-date rt-bk-mincho', dateBox)
    date.id = id + '-date'
    el('span', 'rt-bk-date-num', date).textContent = '11月3日 '
    el('span', 'rt-bk-date-day', date).textContent = '文化の日'
    ctx.stage.appendChild(dateBox)

    // ----- Mark slot: everyday mark to seigaiha triangle with the vermilion seal -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = markSvg(id)
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: リスタニウム over the everyday text (which stays, hidden, for the host) -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-bk-word')
    const ja = el('span', 'rt-bk-ja rt-bk-mincho', word)
    ja.id = id + '-ja'
    ja.setAttribute('aria-hidden', 'true')
    ja.setAttribute('lang', 'ja')
    const jaA = el('span', 'rt-bk-a', ja)
    jaA.textContent = 'リス'
    const jaB = el('span', 'rt-bk-b', ja)
    jaB.textContent = 'タニウム'

    // Keep the brand slot stable: the word box keeps its everyday width; the kana run is set smaller if it would be wider than
    // the box (a wide fallback face), never larger than 1em.
    function sizeWord(): void {
        if (state === 'destroyed') return
        ja.style.fontSize = ''
        const box = word.getBoundingClientRect().width
        const w = ja.scrollWidth || ja.getBoundingClientRect().width
        if (box > 0 && w > box) ja.style.fontSize = (Math.floor(box / w * 1000) / 1000) + 'em'
        word.style.setProperty('--rt-bk-w', Math.max(1, Math.round(Math.min(w, box))) + 'px')
    }
    function placeDate(): void {
        const off = ctx.stageOffset()
        const h = off.wordHeight || word.getBoundingClientRect().height
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        dateBox.style.left = off.wordX + 'px'
        dateBox.style.top = off.wordY + 'px'
        dateBox.style.height = h + 'px'
        dateBox.style.setProperty('--rt-bk-fs', fs + 'px')
        const max = ctx.stageWidth() - off.wordX - 4
        if (max > 0) ctx.fitText(date, max)
    }

    function onFonts(): void {
        if (state === 'destroyed') return
        sizeWord()
        if (state === 'playing') placeDate()
    }
    document.fonts?.addEventListener('loadingdone', onFonts)

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
        dateBox.classList.add('rt-bk-final')
        mark?.classList.add('rt-bk-final')
        word.classList.add('rt-bk-final')
        state = 'final'
        sizeWord()
        settle()
    }
    function add(node: Element | null, frames: Keyframe[], o: AddOptions): Animation | null {
        if (!node || !node.animate) return null
        // Easing per keyframe segment, so holds stay holds.
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
        // Tailwind-equivalent curves: ease-in, ease-out, ease-in-out.
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

        // 1. 0-1200: everyday wordmark and mark fade and scale down (1 to 0.96), as on hangulDay.
        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 1200, ease: IN })
        if (mark) add(mark.querySelector('.rt-bk-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 1200, ease: IN })

        // 2. 1000-3600: the date fades and scales in and holds; 3600-4600 it fades out.
        add(date, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 3.6 },
            { opacity: 1, transform: 'scale(1)', offset: 2.6 / 3.6 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: 1000, d: 3600, ease: INOUT })

        if (mark) {
            // 2b. The outline draws (1200-1800), the wave rows roll in from the apex upwards (1500-2950), the hole's outline
            // draws (2600-3050) and the seal is pressed (3150-3700).
            add(mark.querySelector('.rt-bk-edge'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 1200, d: 600, ease: INOUT })
            const rows = mark.querySelectorAll('.rt-bk-row')
            for (let i = rows.length - 1, k = 0; i >= 0; i--, k++) {
                add(rows[i], [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], { at: 1500 + k * 190, d: 500, ease: OUT })
            }
            add(mark.querySelector('.rt-bk-hole'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: 2600, d: 450, ease: INOUT })
            add(mark.querySelector('.rt-bk-seal'), [
                { opacity: 0, transform: 'scale(1.45) rotate(-10deg)' },
                { opacity: 1, transform: 'scale(0.93) rotate(0deg)', offset: 0.5 },
                { opacity: 1, transform: 'scale(1.03) rotate(0deg)', offset: 0.75 },
                { opacity: 1, transform: 'scale(1) rotate(0deg)' },
            ], { at: 3150, d: 550, ease: OUT })
        }

        // 3-4. 4600: リス fades and scales in, タニウム follows 200 ms later; settled at 5800.
        add(jaA, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4600, d: 1000, ease: OUT })
        add(jaB, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4800, d: 1000, ease: OUT })
        later(() => {
            if (state === 'playing') placeDate()
        }, 1000)
        later(() => {
            if (state === 'playing') sizeWord()
        }, 4600)
    }

    // Host seam: called with the stage box whenever the stage geometry changes after build.
    ctx.onRelayout(() => {
        if (state === 'destroyed') return
        if (state === 'playing') placeDate()
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
        dateBox.classList.remove('rt-bk-final')
        mark?.classList.remove('rt-bk-final')
        word.classList.remove('rt-bk-final')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        placeDate()
        sizeWord()
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
        document.fonts?.removeEventListener('loadingdone', onFonts)
        dateBox.remove()
        mark?.remove()
        ja.remove()
        word.classList.remove('rt-bk-word', 'rt-bk-final')
        word.style.removeProperty('--rt-bk-w')
        ctx.setName('RisuTanium')
        ctx.setDescription('')
        settle()
    }

    sizeWord()
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'bunkaNoHi',
    durationMs: DURATION,
    build,
}
export default scene
