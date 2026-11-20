import type { Rgba } from '../../ts/themePack/colour'

/** Tailwind's default palette is written in oklch, which the colour parser does not read; out-of-gamut values are clipped. */
export function oklchToRgba(token: string): Rgba | null {
    const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(token)
    if (m === null) return null
    const L = Number(m[1]) / (m[2] === '%' ? 100 : 1)
    const C = Number(m[3])
    const hue = (Number(m[4]) * Math.PI) / 180
    const a = C * Math.cos(hue)
    const b = C * Math.sin(hue)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
    ]
    const gamma = (v: number): number => {
        const c = Math.min(1, Math.max(0, v))
        return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
    }
    return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2]), 1]
}
