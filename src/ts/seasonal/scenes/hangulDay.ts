// Seasonal scene: hangulDay (Oct 9, lang ko).
//
// Storyboard (5.8 s of motion, 6.5 s budget): the everyday wordmark and mark fade and scale down 0-1.2 s; the date line
// "10월 9일 한글날" fades and scales in 1.0-1.6 s, holds and fades 3.6-4.6 s; the three ink strokes of the mark draw in
// Hangul writing order 1.2-2.95 s and the dot is set 3.15-3.67 s; the Korean wordmark's first half fades in at 4.6 s and its
// second half 0.2 s later, settled by 5.8 s.
// Final: mark of three brush strokes and a dot, Korean wordmark, no date line.
// Motion is Web Animations only: opacity and transform, plus stroke-dashoffset on the three ink strokes. No filters, no
// loops. The final pose is static CSS under .rt-hg-final, so finish() gives the same pose from any point.
//
// Font: EBS Hunminjeongeum SemiBold (the SBA cut) from the commit-pinned jsDelivr URL, loaded by the host from `fonts`. It
// is applied to an element only once ctx.fonts.ready() has resolved true, so the font-display:block period never hides
// text and the timeline never waits; otherwise the NanumSquare Neo fallback stack is used.
import './hangulDay.css'
import type { SceneContext, SceneDef, SceneInstance } from '../sceneTypes'

const DURATION = 6500
const FAMILY = 'EBS Hunminjeongeum'
const FONT_URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_one@40fb96ceb772b1b734b9569ffbb91721309bdd2b/EBSHunminjeongeumSBA.woff'
const FONT_SAMPLE = '리스타늄 10월 9일 한글날'
const SVGNS = 'http://www.w3.org/2000/svg'

// Everyday mark, shown at t=0 so the status mark hand-off is seamless.
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'

type Stroke = [number, number, number, number]
// Ink strokes: the frame's centre line (midway between the outer triangle and the hole), drawn with a 15-unit round-capped
// stroke so the band matches the frame's 14.9-unit thickness. Stroke order follows Hangul writing order: the horizontal
// first (left to right), then the left fall, then the right fall, both downward.
const STROKES: Stroke[] = [
    [-42.94, -24.8, 42.94, -24.8],
    [-42.94, -24.8, 0, 49.59],
    [42.94, -24.8, 0, 49.59],
]
// Brush character: each stroke is a static filled shape that starts narrow (half-width 5.6) and ends heavier (8.4) with
// round ends, like a brush entering lightly and pressing at the end. It is revealed by a mask whose round-capped centre line
// draws on with stroke-dashoffset, so no filter and no path morph is needed.
const W0 = 5.6
const W1 = 8.4
function brushPath(p: Stroke): string {
    let dx = p[2] - p[0]
    let dy = p[3] - p[1]
    const L = Math.sqrt(dx * dx + dy * dy)
    dx /= L
    dy /= L
    // n = d turned 90 degrees counter-clockwise (screen coordinates)
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
// The dot at the centroid, in the everyday core gradient.
const DOT_R = 12

interface AddOptions {
    d: number
    at?: number
    ease?: string
}

function sid(uid: string): string {
    return 'rt-hg-' + String(uid || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
}

function el(tag: 'div' | 'span', cls: string, parent?: Element): HTMLElement {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
}

function markMarkup(id: string): string {
    let s = '<defs><linearGradient id="' + id + '-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient></defs>' +
        '<g class="rt-hg-every" id="' + id + '-every">' +
            '<path class="rt-hg-every-ink" fill-rule="evenodd" d="' + FRAME + '"/>' +
            '<path class="rt-hg-every-ink" d="' + MID + '"/>' +
            '<path fill="url(#' + id + '-core)" d="' + CORE + '"/>' +
        '</g>' +
        '<g class="rt-hg-ink" id="' + id + '-ink">'
    for (let i = 0; i < STROKES.length; i++) {
        const mid = id + '-m' + (i + 1)
        s += '<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="-73" y="-66" width="146" height="146">' +
            '<path class="rt-hg-stroke rt-hg-stroke-' + (i + 1) + '" id="' + id + '-stroke' + (i + 1) + '" pathLength="1" d="' + linePath(STROKES[i]) + '"/></mask>' +
            '<path class="rt-hg-brush" mask="url(#' + mid + ')" d="' + brushPath(STROKES[i]) + '"/>'
    }
    s += '</g><circle class="rt-hg-dot" id="' + id + '-dot" r="' + DOT_R + '" fill="url(#' + id + '-core)"/>'
    return s
}

function markSvg(id: string): SVGSVGElement {
    const holder = document.createElement('span')
    holder.innerHTML = '<svg xmlns="' + SVGNS + '" viewBox="-73 -66 146 146" class="rt-hg-mark" aria-hidden="true" focusable="false">' + markMarkup(id) + '</svg>'
    const n = holder.firstElementChild
    if (!(n instanceof SVGSVGElement)) throw new Error('hangulDay: svg markup did not parse')
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

    ctx.setName('리스타늄', 'ko')
    // The host gives the description its own lang="ko" span in an aria-describedby node.
    ctx.setDescription('10월 9일 한글날', 'ko')

    // ----- Stage: the date line -----
    const dateBox = el('div', 'rt-hg-datebox')
    dateBox.id = id + '-datebox'
    dateBox.setAttribute('aria-hidden', 'true')
    dateBox.setAttribute('lang', 'ko')
    const date = el('span', 'rt-hg-date rt-hg-fb', dateBox)
    date.id = id + '-date'
    el('span', 'rt-hg-date-num', date).textContent = '10월 9일 '
    el('span', 'rt-hg-date-day', date).textContent = '한글날'
    ctx.stage.appendChild(dateBox)

    // ----- Mark slot: everyday mark to three ink strokes and the dot -----
    let mark: SVGSVGElement | null = null
    if (ctx.markSlot) {
        mark = markSvg(id)
        mark.id = id + '-mark'
        ctx.markSlot.appendChild(mark)
    }

    // ----- Word: the Korean wordmark over the everyday text -----
    const word = ctx.word
    const every = word.querySelector<HTMLElement>('.rt-sw-text')
    word.classList.add('rt-hg-word')
    const ko = el('span', 'rt-hg-ko rt-hg-fb', word)
    ko.id = id + '-ko'
    ko.setAttribute('aria-hidden', 'true')
    const koA = el('span', 'rt-hg-a', ko)
    koA.textContent = '리스'
    const koB = el('span', 'rt-hg-b', ko)
    koB.textContent = '타늄'
    const prevWidth = word.style.width

    function useFont(node: HTMLElement): void {
        if (!fontOk) return
        node.classList.remove('rt-hg-fb')
        node.classList.add('rt-hg-ebs')
    }
    function sizeWord(): void {
        if (state === 'destroyed') return
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        const w = ko.offsetWidth
        if (w > 0) {
            word.style.width = (w / fs).toFixed(3) + 'em'
            word.style.setProperty('--rt-hg-w', w + 'px')
        }
    }
    function placeDate(): void {
        const off = ctx.stageOffset()
        const x = off.wordX
        const y = off.wordY
        const h = off.wordHeight || word.getBoundingClientRect().height
        const fs = parseFloat(getComputedStyle(word).fontSize) || 24
        dateBox.style.left = x + 'px'
        dateBox.style.top = y + 'px'
        dateBox.style.height = h + 'px'
        dateBox.style.setProperty('--rt-hg-fs', fs + 'px')
        const max = ctx.stageWidth() - x - 4
        if (max > 0) ctx.fitText(date, max)
    }

    ctx.fonts.ready(FAMILY).then((ok) => {
        if (!ok || state === 'destroyed') return
        fontOk = true
        // Upgrade only what is not on screen yet, plus the final pose (one swap at most, within timeoutMs of the build).
        if (state === 'built' || state === 'final') {
            useFont(ko)
            useFont(date)
            sizeWord()
        }
    }, () => {
        // the fallback stays
    })

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
        useFont(ko)
        dateBox.classList.add('rt-hg-final')
        mark?.classList.add('rt-hg-final')
        word.classList.add('rt-hg-final')
        state = 'final'
        sizeWord()
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

    function timeline(): void {
        // Tailwind-equivalent curves: ease-in, ease-out, ease-in-out.
        const IN = 'cubic-bezier(0.4, 0, 1, 1)'
        const OUT = 'cubic-bezier(0, 0, 0.2, 1)'
        const INOUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

        // 1. 0-1200: everyday wordmark and mark fade and scale down (1 to 0.96).
        add(every, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 1200, ease: IN })
        if (mark) add(mark.querySelector('.rt-hg-every'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], { at: 0, d: 1200, ease: IN })

        // 2. 1000-3600: the date fades and scales in (0.96 to 1) and holds; 3600-4600 it fades out.
        add(date, [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.6 / 3.6 },
            { opacity: 1, transform: 'scale(1)', offset: 2.6 / 3.6 },
            { opacity: 0, transform: 'scale(1)' },
        ], { at: 1000, d: 3600, ease: INOUT })
        later(() => {
            if (state === 'playing') {
                useFont(date)
                placeDate()
            }
        }, 1000)

        // 2b. Ink: the three strokes draw in writing order 1200-2950, then the dot is set 3000-3400.
        if (mark) {
            const strokes = mark.querySelectorAll('.rt-hg-stroke')
            const starts = [1200, 1800, 2400]
            const lens = [550, 550, 550]
            for (let i = 0; i < strokes.length; i++) {
                add(strokes[i], [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { at: starts[i], d: lens[i], ease: INOUT })
            }
            // The dot lands a beat after the last stroke, with a small settle (rhymes with the dot in the face).
            add(mark.querySelector('.rt-hg-dot'), [
                { opacity: 0, transform: 'scale(0.3)' },
                { opacity: 1, transform: 'scale(1.16)', offset: 0.45 },
                { opacity: 1, transform: 'scale(0.94)', offset: 0.72 },
                { opacity: 1, transform: 'scale(1)' },
            ], { at: 3150, d: 520, ease: OUT })
        }

        // 3-4. 4600: the first half fades and scales in (0.96 to 1), the second follows 200 ms later; settled by 5800. The
        // word box takes the Korean wordmark's width at 1200, once the everyday text has faded (no visible jump); the face
        // is fixed again at 4600 in case the font arrived in between (the host caps it at timeoutMs).
        later(() => {
            if (state === 'playing') {
                useFont(ko)
                sizeWord()
            }
        }, 1200)
        later(() => {
            if (state === 'playing') {
                useFont(ko)
                sizeWord()
            }
        }, 4600)
        add(koA, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4600, d: 1000, ease: OUT })
        add(koB, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { at: 4800, d: 1000, ease: OUT })
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
        dateBox.classList.remove('rt-hg-final')
        mark?.classList.remove('rt-hg-final')
        word.classList.remove('rt-hg-final')
        state = 'playing'
        playPromise = new Promise<void>((res) => {
            resolvePlay = res
        })
        placeDate()
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
        dateBox.remove()
        mark?.remove()
        ko.remove()
        word.classList.remove('rt-hg-word', 'rt-hg-final')
        word.style.width = prevWidth
        word.style.removeProperty('--rt-hg-w')
        ctx.setName('RisuTanium')
        ctx.setDescription('')
        settle()
    }
    return { play, finish, destroy }
}

const scene: SceneDef = {
    key: 'hangulDay',
    durationMs: DURATION,
    fonts: [{ family: FAMILY, url: FONT_URL, weight: 400, timeoutMs: 2500, sample: FONT_SAMPLE }],
    build,
}
export default scene
