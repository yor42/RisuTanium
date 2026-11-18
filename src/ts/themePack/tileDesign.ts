/**
 * The look of a theme pack's picker tile, as data. Pure: the same inputs always give the same spec, so the picker shows a
 * stable, distinct tile per pack with no stored image.
 */
import { bestExtreme, cr, mixSrgb, parseHexColour, toHex } from './colour'
import type { Rgba } from './failclosed'

export const TILE_FAMILIES = ['bands', 'rings', 'dots', 'chevrons', 'bubble', 'steps'] as const
export type TileFamily = typeof TILE_FAMILIES[number]

export interface TileSpec {
    family: TileFamily
    /** Small variation numbers taken from the seed hash: a and b are 0-3, c is 0-1. */
    params: { a: number, b: number, c: number }
    /** Lower-case `#rrggbb`, or null when the tile is neutral and styled by theme tokens instead. */
    ground: string | null
    /** Pattern and plate outline; contrast with the ground is at least 3:1. */
    ink: string | null
    /** Glyph on the plate; contrast with the ground is at least 4.5:1. */
    glyphInk: string | null
    /** The one character cluster drawn on the plate; empty when the name has none. */
    grapheme: string
    neutral: boolean
}

export interface TileInput {
    /** The manifest pack id when there is one, otherwise the name. The record id is never the seed. */
    seedKey: string
    name: string
    main?: string
    secondary?: string
}

const INK_MIN = 3
const GLYPH_MIN = 4.5
const MIX_STEPS = [0.2, 0.4, 0.6, 0.8, 1]
const PARTNER_MIX = 0.7
const WORTH_SHOWING = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u

/** FNV-1a, 32 bit, over the UTF-8 bytes. */
export function seedHash(seedKey: string): number {
    let h = 0x811c9dc5
    for (const byte of new TextEncoder().encode(seedKey)) {
        h ^= byte
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h >>> 0
}

function segments(text: string): string[] {
    if (typeof Intl.Segmenter === 'function') {
        return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment)
    }
    // Without a Segmenter a cluster is one code point, so a flag shows a single indicator.
    return [...text]
}

/**
 * The first letter, digit, emoji or flag of the name as one grapheme cluster, upper-cased when that stays one cluster;
 * the first cluster when none qualifies; empty for an empty name.
 */
export function tileGrapheme(name: string): string {
    const parts = segments(name.trim())
    const first = parts.find((part) => WORTH_SHOWING.test(part)) ?? parts[0]
    if (first === undefined) {
        return ''
    }
    const upper = first.toUpperCase()
    return upper !== first && segments(upper).length === 1 ? upper : first
}

/** The colour itself when it reaches 3:1 on the ground, otherwise the first step of the way to the best extreme that does. */
function readable(colour: Rgba, ground: Rgba): Rgba {
    if (cr(colour, ground) >= INK_MIN) {
        return colour
    }
    const extreme = bestExtreme(ground)
    for (const t of MIX_STEPS) {
        const mixed = mixSrgb(colour, extreme, t)
        if (cr(mixed, ground) >= INK_MIN) {
            return mixed
        }
    }
    return extreme
}

export function tileSpec(input: TileInput): TileSpec {
    const h = seedHash(input.seedKey)
    const family = TILE_FAMILIES[h % TILE_FAMILIES.length]
    const params = { a: (h >>> 3) & 3, b: (h >>> 5) & 3, c: (h >>> 7) & 1 }
    const grapheme = tileGrapheme(input.name)
    const main = input.main === undefined ? null : parseHexColour(input.main)
    const secondary = input.secondary === undefined ? null : parseHexColour(input.secondary)
    if (main === null && secondary === null) {
        return { family, params, ground: null, ink: null, glyphInk: null, grapheme, neutral: true }
    }
    const partner = (known: Rgba): Rgba => mixSrgb(known, bestExtreme(known), PARTNER_MIX)
    const ground: Rgba = secondary ?? partner(main as Rgba)
    const wanted: Rgba = main ?? partner(secondary as Rgba)
    const ink = readable(wanted, ground)
    const glyphInk = cr(wanted, ground) >= GLYPH_MIN ? wanted : bestExtreme(ground)
    return { family, params, ground: toHex(ground), ink: toHex(ink), glyphInk: toHex(glyphInk), grapheme, neutral: false }
}
