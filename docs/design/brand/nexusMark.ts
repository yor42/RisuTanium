import type { BrandStatus } from './brandStatus'

// Geometry and markup of the RisuTanium status mark. One source for the Svelte component, the mockups
// and the generated standalone SVGs. Motion lives in nexus-mark.css.

/**
 * The logo's centroid sits at the origin. The box holds the frame turned to any angle about the
 * centroid (circumradius 64.49, for tool_call) and the chevron's downward stream (to y 78.5).
 */
export const MARK_VIEWBOX = '-73 -66 146 146'

// The outer frame is split into three mitred sides so each can move on its own. In the rest pose they
// tile the original evenodd frame exactly.
const TOP = 'M-55.85-32.25H55.85L30.03-17.34H-30.03Z'
const RIGHT = 'M55.85-32.25L0 64.49V34.68L30.03-17.34Z'
const LEFT = 'M0 64.49L-55.85-32.25L-30.03-17.34L0 34.68Z'
const FRAME = 'M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z'
const HOLE = 'M-30.03-17.34H30.03L0 34.68Z'
const MID = 'M-11.63-6.72H11.63L0 13.43Z'
const CORE = 'M-7.42-4.28H7.42L0 8.57Z'
const GLOW = 'M-20-11.55H20L0 23.09Z'
// Determinate progress: the frame outline scaled by 1.2, starting at the top centre and running clockwise.
// 1.2 leaves about 4 units between the frame and the ring's inner edge (1.1 px at 40 px) and, with round joins,
// still fits the viewBox (bottom vertex 77.4 + 2 < 80).
const PROGRESS = 'M0-38.7H67.02L0 77.39L-67.02-38.7Z'

/**
 * Smallest rendered size, in CSS pixels, that draws the progress ring. Below it the gap between ring and frame
 * falls under a pixel and the two merge (review F-1), so smaller marks show the percentage as text instead.
 */
export const PROGRESS_MIN_SIZE = 40

// One converging layer for `memory`: a dashed triangle inside the hole and three particles on the frame.
const PARTICLES =
    `<path fill="none" stroke="#7fe9ff" stroke-width="2.4" stroke-dasharray="4 4" d="M-27-15.6H27L0 31.2Z"/>` +
    `<circle fill="#7fe9ff" r="3" cx="0" cy="-31.2"/>` +
    `<circle fill="#7fe9ff" r="3" cx="-27" cy="15.6"/>` +
    `<circle fill="#7fe9ff" r="3" cx="27" cy="15.6"/>`

function safeId(uid: string): string {
    return 'nm-' + uid.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * The inner markup of one mark. Every part is always present; the status only changes which parts are
 * visible and how they move, so a status change can morph the shape. `uid` keeps the gradient, filter and
 * clip ids unique when several marks share a document.
 */
export function markInner(uid: string): string {
    const id = safeId(uid)
    return (
        `<defs>` +
        `<linearGradient id="${id}-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient>` +
        `<linearGradient id="${id}-band" x2="0" y2="1"><stop offset="0" stop-color="#7fe9ff" stop-opacity="0"/><stop offset=".5" stop-color="#7fe9ff" stop-opacity=".95"/><stop offset="1" stop-color="#7fe9ff" stop-opacity="0"/></linearGradient>` +
        `<filter id="${id}-blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="6"/></filter>` +
        `<clipPath id="${id}-hole"><path d="${HOLE}"/></clipPath>` +
        `<clipPath id="${id}-mark"><path clip-rule="evenodd" d="${FRAME}"/><path d="${MID}"/></clipPath>` +
        `</defs>` +
        // The glow stays outside every moving group so its blur is rasterised once; only its opacity changes.
        `<path class="nm-glow" fill="#38d9ff" filter="url(#${id}-blur)" d="${GLOW}"/>` +
        // Progress stays outside the pose so status motion never moves it; hidden unless data-progress is set.
        `<g class="nm-progress"><path class="nm-progress-track" pathLength="100" d="${PROGRESS}"/>` +
        `<path class="nm-progress-a" pathLength="100" d="${PROGRESS}"/></g>` +
        `<g class="nm-pose"><g class="nm-body">` +
        `<g class="nm-fill" clip-path="url(#${id}-hole)"><rect class="nm-fill-a" x="-31" y="-18" width="62" height="54" fill="url(#${id}-core)"/></g>` +
        `<g class="nm-ring">` +
        `<g class="nm-p nm-top"><path class="nm-a" d="${TOP}"/></g>` +
        `<g class="nm-p nm-right"><path class="nm-a" d="${RIGHT}"/></g>` +
        `<g class="nm-p nm-left"><path class="nm-a" d="${LEFT}"/></g>` +
        `</g>` +
        `<g class="nm-ghost"><g class="nm-ghost-a"><path class="nm-a" d="${RIGHT}"/><path class="nm-a" d="${LEFT}"/></g></g>` +
        `<g class="nm-echo"><path class="nm-echo-a" d="${MID}"/><path class="nm-echo-a nm-late" d="${MID}"/></g>` +
        `<g class="nm-particles"><g class="nm-particles-a">${PARTICLES}</g><g class="nm-particles-a nm-late">${PARTICLES}</g></g>` +
        `<g class="nm-scan" clip-path="url(#${id}-mark)"><rect class="nm-scan-a" x="-60" y="-40" width="120" height="28" fill="url(#${id}-band)"/></g>` +
        `<g class="nm-midg"><path class="nm-mid" fill="#fff" d="${MID}"/></g>` +
        `<g class="nm-coreg"><path class="nm-core" fill="url(#${id}-core)" d="${CORE}"/><path class="nm-warn" fill="#ff6b81" d="${MID}"/></g>` +
        `</g></g>`
    )
}

export interface MarkSvgOptions {
    /** Rendered width and height in CSS pixels. */
    size?: number
    /** Inlines this stylesheet, for a standalone .svg file. Omit when the page links nexus-mark.css. */
    css?: string
    /** Determinate progress from 0 to 1; omit for an indeterminate mark. Ignored below PROGRESS_MIN_SIZE. */
    progress?: number
    /** `light` recolours the mark for light backdrops. */
    tone?: 'dark' | 'light'
}

/** Whole percent for a progress fraction, clamped to 0 to 100. Non-finite input reads as 0. */
export function progressPercent(progress: number): number {
    return Number.isFinite(progress) ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : 0
}

/** Root attributes for determinate progress, shared by the component and markSvg. */
export function progressStyle(progress: number): string {
    return `--nm-progress-offset: ${100 - progressPercent(progress)}`
}

/** A complete <svg> element for a status. Decorative: the caller supplies the text alternative. */
export function markSvg(uid: string, status: BrandStatus, options: MarkSvgOptions = {}): string {
    const size = options.size ?? 128
    const style = options.css === undefined ? '' : `<style><![CDATA[${options.css}]]></style>`
    const progress = options.progress === undefined || size < PROGRESS_MIN_SIZE ? '' : ` data-progress="" style="${progressStyle(options.progress)}"`
    const tone = options.tone === 'light' ? ' data-tone="light"' : ''
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" class="nexus-mark" data-status="${status}" viewBox="${MARK_VIEWBOX}"` +
        ` width="${size}" height="${size}" aria-hidden="true" focusable="false"${progress}${tone}>${style}${markInner(uid)}</svg>`
    )
}
