import { cr, over, parseConcrete, toHex, type Rgba } from "../themePack/colour";
import type { ColorScheme } from "./colorscheme";

/**
 * Colour roles derived from the nine scheme colours so every new-screen text, field, accent and
 * status colour meets its contrast floor on the scheme's own surfaces. Keys are the suffixes of the
 * `--risu-theme-role-*` custom properties written by `updateColorScheme`.
 */
export interface SchemeRoles {
    'text-secondary': string
    'text-muted': string
    'accent': string
    'accent-rgb': string
    /** The classic keyboard focus ring; it stays at least 3:1 on the scheme's page, panel and button colours. */
    'focus-ring': string
    'field-border': string
    'danger': string
    'danger-rgb': string
    'warning-rgb': string
    'overlay-rgb': string
    'switch-off-alpha': string
    'surface-toast': string
    'color-scheme': 'light' | 'dark'
}

export type SchemeRoleName = keyof SchemeRoles

// The accent fallback is one rule for solid and channel: the built-in Default accent, so the two can never disagree.
const FALLBACK_ACCENT = '#6f7fc8'
const FALLBACK_ACCENT_RGB = '111 127 200'
const FALLBACK_DANGER_RGB = '255 107 129'
const FALLBACK_WARNING = '#ffd166'
const FALLBACK_WARNING_RGB = '255 209 102'
const FALLBACK_OVERLAY_RGB = '255 255 255'
const FALLBACK_SWITCH_OFF = '0.36'

const channels = (hex: string): string => {
    const c = parseConcrete(hex)
    return c === null ? '0 0 0' : `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`
}

/** `color-mix(in oklab, from, to p%)` as a hex colour; null when the colour is out of sRGB or unreadable. */
function mixAt(from: string, to: string, p: number): string | null {
    if (p <= 0) return from
    if (p >= 100) return to
    const c = parseConcrete(`color-mix(in oklab, ${from} ${100 - p}%, ${to} ${p}%)`)
    return c === null ? null : toHex(c)
}

/**
 * The first p in 0..100 (step 1) at which the mix meets `meets`. Mixes that fall outside sRGB are
 * skipped. When no p passes the result is `to` and `short` is true.
 */
function firstMix(from: string, to: string, meets: (c: string) => boolean): { c: string, short: boolean } {
    for (let p = 0; p <= 100; p++) {
        const c = mixAt(from, to, p)
        if (c !== null && meets(c)) {
            return { c, short: false }
        }
    }
    return { c: to, short: true }
}

const lift = (from: string, to: string, floor: number, against: readonly string[]) =>
    firstMix(from, to, (c) => against.every((b) => cr(parseConcrete(c)!, parseConcrete(b)!) >= floor))

function hexOf(text: string): string | null {
    const c = parseConcrete(text)
    return c === null ? null : toHex(c)
}

export interface DerivedSchemeRoles {
    roles: SchemeRoles
    /** Role names whose floor no mix reached; the role then holds the extreme. Test-only. */
    short: SchemeRoleName[]
}

export function deriveSchemeRolesChecked(scheme: ColorScheme): DerivedSchemeRoles {
    const bg = hexOf(scheme.bgcolor)
    const dbg = hexOf(scheme.darkbg)
    const bc = hexOf(scheme.borderc)
    const sel = hexOf(scheme.selected)
    const red = hexOf(scheme.draculared)
    const tx = hexOf(scheme.textcolor)
    const tx2 = hexOf(scheme.textcolor2)
    const btn = hexOf(scheme.darkbutton)

    const roles: SchemeRoles = {
        'text-secondary': tx ?? scheme.textcolor,
        'text-muted': tx2 ?? scheme.textcolor2,
        'accent': FALLBACK_ACCENT,
        'accent-rgb': FALLBACK_ACCENT_RGB,
        'focus-ring': FALLBACK_ACCENT,
        'field-border': bc ?? scheme.borderc,
        'danger': red ?? scheme.draculared,
        'danger-rgb': FALLBACK_DANGER_RGB,
        'warning-rgb': FALLBACK_WARNING_RGB,
        'overlay-rgb': FALLBACK_OVERLAY_RGB,
        'switch-off-alpha': FALLBACK_SWITCH_OFF,
        'surface-toast': sel ?? scheme.selected,
        'color-scheme': scheme.type === 'light' ? 'light' : 'dark',
    }
    const short: SchemeRoleName[] = []
    const note = (name: SchemeRoleName, r: { short: boolean }) => {
        if (r.short) short.push(name)
    }

    if (tx !== null && tx2 !== null && bg !== null && dbg !== null && btn !== null) {
        const muted = lift(tx2, tx, 4.5, [bg, dbg, btn])
        note('text-muted', muted)
        roles['text-muted'] = muted.c
        roles['text-secondary'] = mixAt(muted.c, tx, 35) ?? tx
    }
    if (tx !== null && bc !== null && bg !== null && dbg !== null && btn !== null) {
        const accent = firstMix(bc, tx, (c) => {
            const v = parseConcrete(c)!
            return cr(v, parseConcrete(bg)!) >= 4.5 && cr(v, parseConcrete(dbg)!) >= 4.5 && cr(v, parseConcrete(btn)!) >= 3
        })
        note('accent', accent)
        note('focus-ring', accent)
        roles['accent'] = accent.c
        roles['focus-ring'] = accent.c
        roles['accent-rgb'] = channels(accent.c)
    }
    if (tx !== null && bc !== null && bg !== null && dbg !== null) {
        const field = lift(bc, tx, 3, [bg, dbg])
        note('field-border', field)
        roles['field-border'] = field.c
    }
    if (tx !== null && red !== null && bg !== null && dbg !== null) {
        const danger = lift(red, tx, 4.5, [bg, dbg])
        note('danger', danger)
        roles['danger'] = danger.c
        roles['danger-rgb'] = channels(danger.c)
    }
    if (tx !== null && bg !== null && dbg !== null) {
        const warning = lift(FALLBACK_WARNING, tx, 4.5, [bg, dbg])
        note('warning-rgb', warning)
        roles['warning-rgb'] = channels(warning.c)
        roles['overlay-rgb'] = channels(tx)

        const txv = parseConcrete(tx)!
        const bgv = parseConcrete(bg)!
        const dbgv = parseConcrete(dbg)!
        // The off track of a switch is the text colour at this alpha over the canvas.
        let alpha = 0.8
        for (let a = 36; a <= 80; a++) {
            const track = over([txv[0], txv[1], txv[2], a / 100] as Rgba, bgv)
            if (cr(track, bgv) >= 3 && cr(track, dbgv) >= 3) {
                alpha = a / 100
                break
            }
        }
        roles['switch-off-alpha'] = String(alpha)
    }
    if (tx !== null && sel !== null && btn !== null) {
        roles['surface-toast'] = cr(parseConcrete(tx)!, parseConcrete(sel)!) >= 4.5 ? sel : btn
    }
    return { roles, short }
}

export function deriveSchemeRoles(scheme: ColorScheme): SchemeRoles {
    return deriveSchemeRolesChecked(scheme).roles
}
