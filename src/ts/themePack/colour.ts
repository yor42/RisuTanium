/**
 * Pure colour arithmetic shared by the contrast checks and the theme-pack tile. It imports only a type, so it adds no
 * runtime dependency to either user.
 */
import type { Rgba } from './failclosed'

/** WCAG relative luminance of an sRGB colour with 0-255 channels; alpha is ignored. */
export const lum = (c: readonly number[]): number => {
    const f = c.slice(0, 3).map((x) => {
        x /= 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}

/** The foreground composited over an opaque background. */
export const over = (f: Rgba, b: Rgba): Rgba => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]

/** WCAG contrast ratio, at least 1 whichever argument is lighter. */
export const cr = (a: readonly number[], b: readonly number[]): number => {
    const x = lum(a), y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** `#rgb` or `#rrggbb` in any case, opaque; anything else is null. */
export function parseHexColour(text: string): Rgba | null {
    const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text.trim())
    if (m === null) {
        return null
    }
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
}

/** Lower-case `#rrggbb`; each channel is rounded and clamped to 0-255, alpha is dropped. */
export function toHex(c: readonly number[]): string {
    return '#' + [0, 1, 2].map((i) => Math.min(255, Math.max(0, Math.round(c[i]))).toString(16).padStart(2, '0')).join('')
}

/** Linear mix in sRGB channel space: `t` 0 gives `a`, 1 gives `b`. */
export function mixSrgb(a: Rgba, b: Rgba, t: number): Rgba {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

const BLACK: Rgba = [0, 0, 0, 1]
const WHITE: Rgba = [255, 255, 255, 1]

/** Black or white, whichever contrasts more with the colour. */
export function bestExtreme(c: Rgba): Rgba {
    return cr(c, BLACK) >= cr(c, WHITE) ? BLACK : WHITE
}
