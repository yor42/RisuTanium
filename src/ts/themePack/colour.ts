/**
 * Pure colour arithmetic shared by the contrast checks, the pack validators and the theme-pack tile. It imports
 * nothing, so it adds no runtime dependency to any user. `parseConcrete` is the one colour reader of the validators.
 */

/** A concrete sRGB colour: red, green and blue in 0..255 and alpha in 0..1. */
export type Rgba = [number, number, number, number]

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

// ---- the concrete colour reader. Every colour check of the pack validators reads a colour through parseConcrete, so a form is either read the same way everywhere or refused everywhere.
const NAMED: Record<string, string> = Object.fromEntries('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'.split(' ').map((x) => x.split(':')))
const clamp255 = (x: number): number => Math.max(0, Math.min(255, x))
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
    h = ((h % 360) + 360) % 360
    s /= 100
    l /= 100
    const k = (n: number): number => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0) * 255, f(8) * 255, f(4) * 255]
}
const chan = (s: string): number => {
    s = s.trim()
    if (/^[\d.]+%$/.test(s)) return clamp255(parseFloat(s) * 2.55)
    if (/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/.test(s)) return clamp255(parseFloat(s))
    return NaN
}
const alphaOf = (s: string | undefined): number => {
    if (s === undefined) return 1
    s = s.trim()
    if (/^[\d.]+%$/.test(s)) return Math.max(0, Math.min(1, parseFloat(s) / 100))
    if (/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/.test(s)) return Math.max(0, Math.min(1, parseFloat(s)))
    return NaN
}

/** How far an oklab mix may lie outside sRGB and still be read, measured on linear-light channels in 0..1 (the oklab-to-linear matrix output, before the transfer function). Further out is refused, never clipped. */
export const OKLAB_GAMUT_EPS = 1e-4
// color-mix() inside color-mix() is read to this many levels; the outermost mix is level 1.
const MIX_LEVELS = 3

type Triple = [number, number, number]
const toLinear = (c: number): number => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const fromLinear = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255
function linearToOklab([r, g, b]: Triple): Triple {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
function oklabToLinear([L, a, b]: Triple): Triple {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
}

type MixSpace = 'srgb' | 'srgb-linear' | 'oklab'
// Interpolation is premultiplied: w1 and w2 are the normalised weights, scale the alpha factor of a percentage sum below 100.
function mixIn(space: MixSpace, c1: Rgba, c2: Rgba, w1: number, w2: number, scale: number): Rgba | null {
    const alpha = c1[3] * w1 + c2[3] * w2
    if (alpha <= 0) return [0, 0, 0, 0]
    const enter = (c: Rgba): Triple => {
        if (space === 'srgb') return [c[0] / 255, c[1] / 255, c[2] / 255]
        const lin: Triple = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])]
        return space === 'srgb-linear' ? lin : linearToOklab(lin)
    }
    const a = enter(c1), b = enter(c2)
    const mixed = [0, 1, 2].map((i) => (a[i] * c1[3] * w1 + b[i] * c2[3] * w2) / alpha) as Triple
    let out: Triple
    if (space === 'srgb') {
        out = [mixed[0] * 255, mixed[1] * 255, mixed[2] * 255]
    }
    else {
        const lin = space === 'srgb-linear' ? mixed : oklabToLinear(mixed)
        if (space === 'oklab' && lin.some((x) => !(x >= -OKLAB_GAMUT_EPS && x <= 1 + OKLAB_GAMUT_EPS))) return null
        out = [fromLinear(clamp01(lin[0])), fromLinear(clamp01(lin[1])), fromLinear(clamp01(lin[2]))]
    }
    return out.every(Number.isFinite) ? [out[0], out[1], out[2], alpha * scale] : null
}
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

// the top-level comma-separated arguments of a function body; null when the parentheses do not balance
function splitArgs(body: string): string[] | null {
    const out: string[] = []
    let depth = 0, cur = ''
    for (const ch of body) {
        if (ch === '(') depth++
        else if (ch === ')') {
            depth--
            if (depth < 0) return null
        }
        if (ch === ',' && depth === 0) {
            out.push(cur)
            cur = ''
        }
        else cur += ch
    }
    if (depth !== 0) return null
    out.push(cur)
    return out
}
// `colour [p%]` or `p% colour`; the percentage is 0 to 100
function mixEntry(part: string): { colour: string, pct: number | undefined } | null {
    const t = part.trim()
    const lead = /^(\d*\.?\d+)%\s+([\s\S]+)$/.exec(t)
    const trail = lead ? null : /^([\s\S]+?)\s+(\d*\.?\d+)%$/.exec(t)
    const pct = lead ? parseFloat(lead[1]) : trail ? parseFloat(trail[2]) : undefined
    if (pct !== undefined && !(pct <= 100)) return null
    return { colour: (lead ? lead[2] : trail ? trail[1] : t).trim(), pct }
}
// color-mix(in <srgb | srgb-linear | oklab>, c1 [p1%]?, c2 [p2%]?): exactly two colours, no hue method
function readMix(s: string, level: number): Rgba | null {
    if (level >= MIX_LEVELS || !s.endsWith(')')) return null
    const args = splitArgs(s.slice('color-mix('.length, -1))
    if (args === null || args.length !== 3) return null
    const space = /^in\s+(srgb|srgb-linear|oklab)$/.exec(args[0].trim())
    const e1 = mixEntry(args[1]), e2 = mixEntry(args[2])
    if (!space || !e1 || !e2) return null
    const c1 = readColour(e1.colour, level + 1), c2 = readColour(e2.colour, level + 1)
    if (!c1 || !c2) return null
    let p1 = e1.pct, p2 = e2.pct
    if (p1 === undefined && p2 === undefined) {
        p1 = 50
        p2 = 50
    }
    else if (p1 === undefined) p1 = 100 - (p2 as number)
    else if (p2 === undefined) p2 = 100 - p1
    const sum = p1 + (p2 as number)
    if (!(sum > 0)) return null
    return mixIn(space[1] as MixSpace, c1, c2, p1 / sum, (p2 as number) / sum, sum < 100 ? sum / 100 : 1)
}

function readColour(s: string, mixLevel: number): Rgba | null {
    if (!s) return null
    if (s === 'transparent') return [0, 0, 0, 0]
    let m = /^#([0-9a-f]+)$/.exec(s)
    if (m) {
        let h = m[1]
        if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
        if (h.length !== 6 && h.length !== 8) return null
        const byte = (i: number): number => parseInt(h.slice(i, i + 2), 16)
        return [byte(0), byte(2), byte(4), h.length === 8 ? byte(6) / 255 : 1]
    }
    m = /^(rgba?)\(\s*([^()]*)\)$/.exec(s)
    if (m) {
        const body = m[2].trim()
        let main = body, a: string | undefined
        if (body.includes('/')) {
            const [x, y] = body.split('/')
            main = x
            a = y
        }
        const parts = main.trim().split(/[\s,]+/).filter(Boolean)
        if (!body.includes('/') && parts.length === 4) a = parts.pop()
        if (parts.length !== 3) return null
        const c = parts.map(chan)
        const al = alphaOf(a)
        if (c.some(Number.isNaN) || Number.isNaN(al)) return null
        return [c[0], c[1], c[2], al]
    }
    m = /^(hsla?)\(\s*([^()]*)\)$/.exec(s)
    if (m) {
        const body = m[2].trim()
        let main = body, a: string | undefined
        if (body.includes('/')) {
            const [x, y] = body.split('/')
            main = x
            a = y
        }
        const parts = main.trim().split(/[\s,]+/).filter(Boolean)
        if (!body.includes('/') && parts.length === 4) a = parts.pop()
        if (parts.length !== 3) return null
        const h = /^[+-]?\d*\.?\d+(deg)?$/.exec(parts[0])
        const sat = /^([\d.]+)%$/.exec(parts[1]), lig = /^([\d.]+)%$/.exec(parts[2])
        const al = alphaOf(a)
        if (!h || !sat || !lig || Number.isNaN(al)) return null
        const rgb = hsl2rgb(parseFloat(h[0]), Math.min(100, +sat[1]), Math.min(100, +lig[1]))
        return [rgb[0], rgb[1], rgb[2], al]
    }
    if (s.startsWith('color-mix(')) return readMix(s, mixLevel)
    if (NAMED[s]) return readColour('#' + NAMED[s], mixLevel)
    return null
}

/** A concrete sRGB colour, or null when the text is not one: hex, rgb(), hsl(), a named colour, `transparent`, or color-mix() of two such colours in srgb, srgb-linear or oklab. Anything else (another space, a hue method, var(), currentcolor, relative colour syntax, light-dark(), an out-of-gamut oklab mix) is null. */
export function parseConcrete(s: string): Rgba | null {
    return readColour(String(s).trim().toLowerCase().replace(/\s*!important$/, ''), 0)
}
