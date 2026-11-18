// The tile colours a pack declares in its own chat.css: the accent is the main colour and the canvas the secondary one.
// Only a token the sheet itself declares counts; the app's default tokens serve to resolve `var()` chains and are never a
// colour source, so a sheet that declares neither gets a neutral tile. This module imports the two token stylesheets and
// the colour and CSS-literal helpers only, so the install flow does not pull in the validator.
import chatThemeTokens from '../../../docs/design/chat/theme-tokens.css?raw'
import nexusTokens from '../../../docs/design/theme/nexus-tokens.css?raw'
import { over, parseConcrete, toHex, type Rgba } from './colour'
import { decls } from './csslit'

export interface TileColours {
    main?: string
    secondary?: string
}

type TokenMap = Map<string, string>

const MAIN_TOKEN = '--nexus-accent'
const SECONDARY_TOKEN = '--nexus-canvas'
const ROOT_SELECTOR = /^(:root|html)$/i
const RESOLVE_DEPTH = 12

function readTokens(css: string, into: TokenMap): TokenMap {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
        into.set(m[1], m[2].trim())
    }
    return into
}

// The same chain the validator follows: a missing token takes its fallback, an unknown one is left in place.
function resolve(value: string, tokens: TokenMap, depth = 0): string {
    if (depth > RESOLVE_DEPTH) {
        return value
    }
    return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (whole: string, name: string, fallback: string | undefined) => {
        const known = tokens.get(name)
        if (known !== undefined) {
            return resolve(known, tokens, depth + 1)
        }
        return fallback !== undefined ? resolve(fallback, tokens, depth + 1) : whole
    })
}

let defaults: TokenMap | null = null
function defaultTokens(): TokenMap {
    defaults ??= readTokens(chatThemeTokens, readTokens(nexusTokens, new Map()))
    return defaults
}

/**
 * The main and secondary colours of a pack, as lower-case `#rrggbb`, read from its judged canonical chat sheet. Only
 * unconditional `:root` or `html` declarations count (the last one wins); a rule inside any at-rule or with another
 * selector is ignored. The secondary colour must be opaque; a translucent main colour is laid over it, and without a
 * secondary colour it is left out. An unreadable value leaves its field out. Never throws.
 */
export function deriveTileColours(canonicalChat: string): TileColours {
    try {
        const declared: TokenMap = new Map()
        for (const d of decls(canonicalChat)) {
            if (d.prop.startsWith('--') && d.ctx.at.length === 0 && ROOT_SELECTOR.test(d.ctx.selector.trim())) {
                declared.set(d.prop, d.value.trim())
            }
        }
        const tokens = new Map(defaultTokens())
        for (const [name, value] of declared) {
            tokens.set(name, value)
        }
        const read = (name: string): Rgba | null => {
            const raw = declared.get(name)
            return raw === undefined ? null : parseConcrete(resolve(raw, tokens))
        }
        const out: TileColours = {}
        const canvas = read(SECONDARY_TOKEN)
        const secondary = canvas !== null && canvas[3] >= 1 ? canvas : null
        const accent = read(MAIN_TOKEN)
        if (accent !== null) {
            if (accent[3] >= 1) {
                out.main = toHex(accent)
            } else if (secondary !== null) {
                out.main = toHex(over(accent, secondary))
            }
        }
        if (secondary !== null) {
            out.secondary = toHex(secondary)
        }
        return out
    } catch {
        return {}
    }
}
