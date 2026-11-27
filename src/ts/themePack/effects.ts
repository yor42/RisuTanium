// Pack effects (#751; MC-2942, MC-3010, MC-3638): the area lint refuses every transition, animation, transform, filter and backdrop-filter,
// because on a subject that can hold a protected element they can cover, move or fade it. This pass admits the bounded part of that family
// on a subject that can not: it takes the admitted declarations, and the top-level `@keyframes pack-<area>-*` blocks they name, out of the
// text before the lint reads it. Everything it does not claim keeps the lint's refusal and message, so a pack outside the envelope is judged
// exactly as before.
//   extractKeyframes(text, area)        the top-level @keyframes pack-* blocks, judged and taken out like @font-face blocks
//   effectsPass(area, text, keyframes)  claims a declaration when every selector entry is eligible and the value fits a strict grammar
// A declaration is claimed only when ALL of these hold; the check is made once per declaration:
//   (a) each selector entry, judged as the lint reads it (normalise(entry)), gives no lintSelector reason;
//   (b) each entry names at least one part, every data-part value of it is a part of the judged area, and its shape is the one Rule SCOPE
//       accepts (a grammar match, no sibling combinator, a named part on the subject), because a claimed rule is never read by Rule SCOPE;
//   (c) the tier fits the property: the safe tier for all of them, plus the reach tier for a transition of paint properties only and for
//       a backdrop-filter whose subject names a part outside ESCAPE_ANCESTORS.
// Values are read case-insensitively. Only a keyframes name and an animation item's name are compared as written; structure.ts holds both to
// lower case. Every value grammar consumes every token, so var(), calc(), env(), attr(), url(), `none` and the CSS-wide keywords are
// refused because no grammar holds them.
// Install warnings: a refused declaration whose every entry is a candidate (the entry passes (a) and (b) and its tier can carry the
// property) gets one warning when its value fails a grammar or a bound. A subject that is no candidate, and a value that parses but that
// the tier refuses (a non-paint transition on a reach part), get no new warning. Warnings never change the verdict.
import { isAreaPart } from './areaParts'
import { isPackKeyframesPrelude } from './canonical'
import { decls } from './csslit'
import { CHAT_REGISTRY, ESCAPE_ANCESTORS, normalise, subjectJudge, type LintError, type RegistryInput, type SubjectFacts } from './engine'
import type { JudgedArea } from './index'
import { HOME_REGISTRY } from './registries/home'
import { POPUPS_REGISTRY } from './registries/popups'
import { SETTINGS_LINT_REGISTRY } from './registries/settings5b'
import { STUDIO_REGISTRY } from './registries/studio'
import { parseSelectorEntry } from './scope'
import { splitTop } from './structure'

/** The registry each area's lint (AREA_LINT) judges selectors with; effects.ts must read selectors exactly as the lint does. */
export function effectsRegistry(area: JudgedArea): RegistryInput {
    switch (area) {
        case 'chat': return CHAT_REGISTRY
        case 'settings': return SETTINGS_LINT_REGISTRY
        case 'studio': return STUDIO_REGISTRY
        case 'home': return HOME_REGISTRY
        case 'popups': return POPUPS_REGISTRY
    }
}

// ---- bounds
const MAX_KEYFRAMES_BLOCKS = 16
const MAX_OFFSETS = 16
const MAX_BLOCK_BYTES = 4096
const MIN_MS_PER_OFFSET = 170
const MAX_TRANSITION_ITEMS = 4
const MAX_TRANSITION_MS = 1000
const MAX_TRANSITION_DELAY_MS = 500
const MAX_ANIMATION_ITEMS = 3
const MAX_ANIMATION_MS = 20000
const MAX_ANIMATION_DELAY_MS = 2000
const MAX_ANIMATION_COUNT = 10
const MAX_TRANSFORM_FUNCTIONS = 6
const MAX_TRANSLATE_PX = 64
const MAX_TRANSLATE_PERCENT = 100
const MAX_ROTATE_DEG = 360
const MAX_ORIGIN_PX = 64
const MAX_FILTER_FUNCTIONS = 4
const MAX_BACKDROP_FUNCTIONS = 3
const MAX_BLUR_PX = 8
const MAX_BACKDROP_BLUR_PX = 24
const MAX_SHADOW_REACH_PX = 64

const EFFECT_PROPS: ReadonlySet<string> = new Set(['transition', 'animation', 'transform', 'translate', 'scale', 'rotate', 'transform-origin', 'filter', 'backdrop-filter'])
const TRANSITION_PAINT: ReadonlySet<string> = new Set(['color', 'background-color', 'border-color', 'outline-color', 'box-shadow', 'text-shadow'])
const TRANSITION_SAFE: ReadonlySet<string> = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate', 'filter', 'backdrop-filter', ...TRANSITION_PAINT])
const FRAME_PROPS: ReadonlySet<string> = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate', 'filter', 'animation-timing-function'])
const TIMING_WORDS: ReadonlySet<string> = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'])
const STEP_POSITIONS: ReadonlySet<string> = new Set(['start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both'])
const ANIMATION_DIRECTIONS: ReadonlySet<string> = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse'])
const ANIMATION_FILLS: ReadonlySet<string> = new Set(['none', 'forwards', 'backwards', 'both'])
const ANIMATION_STATES: ReadonlySet<string> = new Set(['running', 'paused'])
const ORIGIN_WORDS: ReadonlySet<string> = new Set(['left', 'right', 'top', 'bottom', 'center'])

// ---- token readers
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem)?$/i
const PERCENT = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/
const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i
const TIME = /^(\d+\.?\d*|\.\d+)(ms|s)$/i
const IDENT = /^[a-z][a-z0-9-]*$/i
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOUR_FUNCTION = /^(?:rgba?|hsla?)\([0-9a-z.%,\s/+-]*\)$/i

const toNumber = (token: string): number | null => (NUMBER.test(token) ? Number(token) : null)
/** A length in px; a rem is 16 px and a bare 0 is allowed. */
function lengthPx(token: string): number | null {
    const m = LENGTH.exec(token)
    if (!m) return null
    const n = Number(m[1])
    if (!m[2]) return n === 0 ? 0 : null
    return m[2].toLowerCase() === 'rem' ? n * 16 : n
}
const percent = (token: string): number | null => { const m = PERCENT.exec(token); return m ? Number(m[1]) : null }
function angleDeg(token: string): number | null {
    const m = ANGLE.exec(token)
    if (!m) return null
    const n = Number(m[1])
    if (!m[2]) return n === 0 ? 0 : null
    const unit = m[2].toLowerCase()
    return unit === 'deg' ? n : unit === 'turn' ? n * 360 : unit === 'rad' ? n * 180 / Math.PI : n * 0.9
}
function timeMs(token: string): number | null {
    const m = TIME.exec(token)
    if (!m) return null
    const n = Number(m[1])
    return Math.round((m[2].toLowerCase() === 's' ? n * 1000 : n) * 1e6) / 1e6
}
/** A number or a percentage as a ratio: `50%` is 0.5. */
const amount = (token: string): number | null => { const p = percent(token); return p !== null ? p / 100 : toNumber(token) }

/** The top-level whitespace-separated tokens of a value; a parenthesis group is part of its token. */
function words(value: string): string[] {
    const out: string[] = []
    let depth = 0
    let current = ''
    for (const ch of value) {
        if (ch === '(') depth++
        else if (ch === ')') depth = Math.max(0, depth - 1)
        if (depth === 0 && /\s/.test(ch)) { if (current) out.push(current); current = ''; continue }
        current += ch
    }
    if (current) out.push(current)
    return out
}
function fnOf(token: string): { name: string, args: string } | null {
    const m = /^([a-z][a-z0-9-]*)\(([\s\S]*)\)$/i.exec(token)
    return m ? { name: m[1].toLowerCase(), args: m[2] } : null
}
/** The comma-separated arguments of a function that holds no other function; null when it does. */
const simpleArgs = (args: string): string[] | null => (/[()]/.test(args) ? null : splitTop(args, ',').map((s) => s.trim()))

// ---- value grammars: each returns the reason a value is outside it, '' when it is inside
function timingWhy(token: string, steps: boolean): string {
    const lower = token.toLowerCase()
    if (TIMING_WORDS.has(lower) || (steps && (lower === 'step-start' || lower === 'step-end'))) return ''
    const f = fnOf(token)
    const args = f ? simpleArgs(f.args) : null
    if (!f || !args) return `${token} is not an admitted timing function`
    if (f.name === 'cubic-bezier') {
        const v = args.map(toNumber)
        if (v.length !== 4 || v.some((x) => x === null)) return `${token} needs four numbers`
        const [x1, y1, x2, y2] = v as number[]
        if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || y1 < -1 || y1 > 2 || y2 < -1 || y2 > 2) return `${token} must keep x within 0 to 1 and y within -1 to 2`
        return ''
    }
    if (steps && f.name === 'steps') {
        const n = toNumber(args[0] ?? '')
        if (args.length > 2 || n === null || !Number.isInteger(n) || n < 1 || n > 30) return `${token} takes 1 to 30 steps`
        if (args.length === 2 && !STEP_POSITIONS.has(args[1].toLowerCase())) return `${token} has an unknown step position`
        return ''
    }
    return `${token} is not an admitted timing function${steps ? '' : ' (no steps() in an animation)'}`
}

interface Motion { tx: number, ty: number, px: number, py: number, sx: number, sy: number, rot: number }
const newMotion = (): Motion => ({ tx: 0, ty: 0, px: 0, py: 0, sx: 1, sy: 1, rot: 0 })
function translateArg(m: Motion, axis: 'x' | 'y', token: string): boolean {
    const l = lengthPx(token)
    const p = l === null ? percent(token) : null
    if (l === null && p === null) return false
    if (axis === 'x') { m.tx += Math.abs(l ?? 0); m.px += Math.abs(p ?? 0) } else { m.ty += Math.abs(l ?? 0); m.py += Math.abs(p ?? 0) }
    return true
}
function motionWhy(m: Motion): string {
    if (m.tx > MAX_TRANSLATE_PX || m.ty > MAX_TRANSLATE_PX || m.px > MAX_TRANSLATE_PERCENT || m.py > MAX_TRANSLATE_PERCENT) return `translation may total at most ${MAX_TRANSLATE_PX}px (or ${MAX_TRANSLATE_PERCENT}%) on each axis`
    if (m.sx < 0.5 || m.sx > 1.5 || m.sy < 0.5 || m.sy > 1.5) return 'scale may total 0.5 to 1.5 on each axis'
    if (m.rot > MAX_ROTATE_DEG) return `rotation may total at most ${MAX_ROTATE_DEG}deg`
    return ''
}
function transformWhy(value: string): string {
    const tokens = words(value)
    if (!tokens.length) return 'transform needs at least one function'
    if (tokens.length > MAX_TRANSFORM_FUNCTIONS) return `transform may hold at most ${MAX_TRANSFORM_FUNCTIONS} functions`
    const m = newMotion()
    for (const token of tokens) {
        const f = fnOf(token)
        const args = f ? simpleArgs(f.args) : null
        const bad = `${token} is not an admitted transform function (translate, translateX, translateY, scale, scaleX, scaleY, rotate)`
        if (!f || !args) return bad
        const n = args.length
        const factors = args.map(toNumber)
        switch (f.name) {
            case 'translate': if (n < 1 || n > 2 || !translateArg(m, 'x', args[0]) || (n === 2 && !translateArg(m, 'y', args[1]))) return bad; break
            case 'translatex': if (n !== 1 || !translateArg(m, 'x', args[0])) return bad; break
            case 'translatey': if (n !== 1 || !translateArg(m, 'y', args[0])) return bad; break
            case 'scale': if (n < 1 || n > 2 || factors.some((x) => x === null)) return bad; m.sx *= factors[0] as number; m.sy *= (factors[n - 1]) as number; break
            case 'scalex': if (n !== 1 || factors[0] === null) return bad; m.sx *= factors[0]; break
            case 'scaley': if (n !== 1 || factors[0] === null) return bad; m.sy *= factors[0]; break
            case 'rotate': { const a = n === 1 ? angleDeg(args[0]) : null; if (a === null) return bad; m.rot += Math.abs(a); break }
            default: return bad
        }
    }
    return motionWhy(m)
}
function translateWhy(value: string): string {
    const tokens = words(value)
    const m = newMotion()
    if (tokens.length < 1 || tokens.length > 2 || !translateArg(m, 'x', tokens[0]) || (tokens.length === 2 && !translateArg(m, 'y', tokens[1]))) return 'translate takes one or two lengths or percentages'
    return motionWhy(m)
}
function scaleWhy(value: string): string {
    const tokens = words(value).map(toNumber)
    if (tokens.length < 1 || tokens.length > 2 || tokens.some((x) => x === null)) return 'scale takes one or two numbers'
    const m = newMotion()
    m.sx = tokens[0] as number
    m.sy = tokens[tokens.length - 1] as number
    return motionWhy(m)
}
function rotateWhy(value: string): string {
    const tokens = words(value)
    const a = tokens.length === 1 ? angleDeg(tokens[0]) : null
    if (a === null) return 'rotate takes one angle'
    return Math.abs(a) > MAX_ROTATE_DEG ? `rotation may total at most ${MAX_ROTATE_DEG}deg` : ''
}
function originWhy(value: string): string {
    const tokens = words(value)
    if (tokens.length < 1 || tokens.length > 2) return 'transform-origin takes one or two keywords, lengths or percentages'
    for (const token of tokens) {
        if (ORIGIN_WORDS.has(token.toLowerCase())) continue
        const l = lengthPx(token)
        const p = l === null ? percent(token) : null
        if (l !== null ? Math.abs(l) <= MAX_ORIGIN_PX : p !== null && p >= 0 && p <= 100) continue
        return `${token} is outside the transform-origin bounds (a keyword, at most ${MAX_ORIGIN_PX}px or 0% to 100%)`
    }
    return ''
}
function dropShadowWhy(args: string): string {
    let colours = 0
    const lengths: number[] = []
    for (const token of words(args)) {
        if (HEX_COLOUR.test(token) || COLOUR_FUNCTION.test(token)) { colours++; continue }
        const l = lengthPx(token)
        if (l === null) return `${token} is not an admitted drop-shadow part (a literal colour and two or three lengths)`
        lengths.push(l)
    }
    if (colours !== 1 || lengths.length < 2 || lengths.length > 3) return 'drop-shadow takes a literal colour and two or three lengths'
    if (lengths[2] !== undefined && lengths[2] < 0) return 'drop-shadow blur may not be negative'
    return Math.abs(lengths[0]) + Math.abs(lengths[1]) + (lengths[2] ?? 0) > MAX_SHADOW_REACH_PX ? `drop-shadow may reach at most ${MAX_SHADOW_REACH_PX}px` : ''
}
function filterWhy(value: string, backdrop: boolean): string {
    const tokens = words(value)
    const limit = backdrop ? MAX_BACKDROP_FUNCTIONS : MAX_FILTER_FUNCTIONS
    const name = backdrop ? 'backdrop-filter' : 'filter'
    if (!tokens.length) return `${name} needs at least one function`
    if (tokens.length > limit) return `${name} may hold at most ${limit} functions`
    let blur = 0
    let brightness = 1
    let contrast = 1
    let saturate = 1
    for (const token of tokens) {
        const f = fnOf(token)
        const bad = `${token} is not an admitted ${name} function`
        if (!f) return bad
        if (f.name === 'drop-shadow') {
            if (backdrop) return bad
            const why = dropShadowWhy(f.args)
            if (why) return why
            continue
        }
        const args = simpleArgs(f.args)
        if (!args || args.length !== 1) return bad
        const arg = args[0]
        const ratio = amount(arg)
        switch (f.name) {
            case 'blur': { const l = lengthPx(arg); if (l === null || l < 0) return bad; blur += l; break }
            case 'brightness': if (ratio === null || ratio < 0) return bad; brightness *= ratio; break
            case 'contrast': if (ratio === null || ratio < 0) return bad; contrast *= ratio; break
            case 'saturate': if (ratio === null || ratio < 0) return bad; saturate *= ratio; break
            case 'grayscale': case 'sepia': case 'opacity': if (backdrop || ratio === null || ratio < 0 || ratio > 1) return bad; break
            case 'hue-rotate': if (backdrop || angleDeg(arg) === null) return bad; break
            default: return bad
        }
    }
    if (blur > (backdrop ? MAX_BACKDROP_BLUR_PX : MAX_BLUR_PX)) return `${name} blur may total at most ${backdrop ? MAX_BACKDROP_BLUR_PX : MAX_BLUR_PX}px`
    if (brightness < 0.5 || brightness > 1.5 || contrast < 0.5 || contrast > 1.5) return 'brightness and contrast may each total 0.5 to 1.5'
    if (saturate > 2) return 'saturate may total at most 2'
    return ''
}
interface Parsed { why: string, paint?: boolean }
function transitionParsed(value: string): Parsed {
    const items = splitTop(value, ',').map((s) => s.trim())
    if (items.length > MAX_TRANSITION_ITEMS || items.some((item) => !item)) return { why: `transition takes one to ${MAX_TRANSITION_ITEMS} items` }
    let paint = true
    for (const item of items) {
        let property = ''
        let timings = 0
        const times: number[] = []
        for (const token of words(item)) {
            const ms = timeMs(token)
            if (ms !== null) { times.push(ms); continue }
            if (timingWhy(token, true) === '') { timings++; continue }
            if (IDENT.test(token) && !property) { property = token.toLowerCase(); continue }
            return { why: `${token} is not an admitted transition part (a property, times and a timing function)` }
        }
        if (!TRANSITION_SAFE.has(property)) return { why: `${property || 'a missing property'} is not a transition property a pack may animate` }
        if (times.length > 2 || timings > 1) return { why: 'a transition item takes one property, at most two times and one timing function' }
        if ((times[0] ?? 0) > MAX_TRANSITION_MS) return { why: `a transition may last at most ${MAX_TRANSITION_MS}ms` }
        if ((times[1] ?? 0) > MAX_TRANSITION_DELAY_MS) return { why: `a transition delay may be at most ${MAX_TRANSITION_DELAY_MS}ms` }
        if (!TRANSITION_PAINT.has(property)) paint = false
    }
    return { why: '', paint }
}
function animationWhy(value: string, keyframes: Readonly<Record<string, number>>): string {
    const items = splitTop(value, ',').map((s) => s.trim())
    if (items.length > MAX_ANIMATION_ITEMS || items.some((item) => !item)) return `animation takes one to ${MAX_ANIMATION_ITEMS} items`
    for (const item of items) {
        let name = ''
        let counts = 0
        let directions = 0
        let fills = 0
        let states = 0
        let timings = 0
        const times: number[] = []
        for (const token of words(item)) {
            const lower = token.toLowerCase()
            const ms = timeMs(token)
            const count = toNumber(token)
            if (ms !== null) times.push(ms)
            else if (count !== null) { counts++; if (count < 1 || count > MAX_ANIMATION_COUNT) return `an animation may repeat 1 to ${MAX_ANIMATION_COUNT} times or infinitely` }
            else if (lower === 'infinite') counts++
            else if (ANIMATION_DIRECTIONS.has(lower)) directions++
            else if (ANIMATION_FILLS.has(lower)) fills++
            else if (ANIMATION_STATES.has(lower)) states++
            else if (timingWhy(token, false) === '') timings++
            else if (IDENT.test(token) && !name) name = token
            else return `${token} is not an admitted animation part`
        }
        if (times.length < 1 || times.length > 2 || counts > 1 || directions > 1 || fills > 1 || states > 1 || timings > 1) return 'an animation item takes a duration, at most one delay and at most one each of count, direction, fill mode, play state and timing function'
        if (!name) return 'an animation item must name a @keyframes block of this stylesheet'
        if (!Object.prototype.hasOwnProperty.call(keyframes, name)) return `${name} is not a @keyframes pack block of this stylesheet`
        const offsets = keyframes[name]
        if (times[0] > MAX_ANIMATION_MS) return `an animation may last at most ${MAX_ANIMATION_MS / 1000}s`
        if (times[0] < MIN_MS_PER_OFFSET * offsets) return `an animation of ${offsets} frame offsets must last at least ${MIN_MS_PER_OFFSET * offsets}ms`
        if ((times[1] ?? 0) > MAX_ANIMATION_DELAY_MS) return `an animation delay may be at most ${MAX_ANIMATION_DELAY_MS / 1000}s`
    }
    return ''
}
function opacityWhy(value: string): string {
    const ratio = amount(value.trim())
    return ratio !== null && ratio >= 0 && ratio <= 1 ? '' : 'opacity in a frame is a number or a percentage from 0 to 1 (0% to 100%)'
}

/** Judges the value of one element declaration (`value` without its !important). */
function elementWhy(prop: string, value: string, keyframes: Readonly<Record<string, number>>): Parsed {
    switch (prop) {
        case 'transition': return transitionParsed(value)
        case 'animation': return { why: animationWhy(value, keyframes) }
        case 'transform': return { why: transformWhy(value) }
        case 'translate': return { why: translateWhy(value) }
        case 'scale': return { why: scaleWhy(value) }
        case 'rotate': return { why: rotateWhy(value) }
        case 'transform-origin': return { why: originWhy(value) }
        case 'filter': return { why: filterWhy(value, false) }
        default: return { why: filterWhy(value, true) }
    }
}
function frameWhy(prop: string, value: string): string {
    switch (prop) {
        case 'opacity': return opacityWhy(value)
        case 'transform': return transformWhy(value)
        case 'translate': return translateWhy(value)
        case 'scale': return scaleWhy(value)
        case 'rotate': return rotateWhy(value)
        case 'filter': return filterWhy(value, false)
        default: { const tokens = words(value); return tokens.length === 1 ? timingWhy(tokens[0], false) : 'animation-timing-function in a frame takes one timing function' }
    }
}

// ---- @keyframes blocks
export interface KeyframesExtraction {
    /** The text without its top-level @keyframes pack-* blocks (refused ones included); the original text when there is none. */
    remainder: string
    /** Each admitted block by name, as written, with its number of frame offsets (offset lists expanded). */
    names: Record<string, number>
    errors: LintError[]
}

const OFFSET_PERCENT = /^(\d+\.?\d*|\.\d+)%$/

/** The index of the brace that closes the one at `open`, skipping strings; -1 when it never closes. */
function closingBrace(text: string, open: number): number {
    let depth = 0
    for (let i = open; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < text.length && text[j] !== ch && text[j] !== '\n') j++
            i = j
            continue
        }
        if (ch === '{') depth++
        else if (ch === '}' && --depth === 0) return i
    }
    return -1
}

/** Judges the frames of one block body: exactly a sequence of `<offset-list>{<declarations>}`. Returns the offset count, or the reason. */
function framesOf(body: string): { offsets: number } | { why: string } {
    let pos = 0
    let offsets = 0
    for (;;) {
        while (pos < body.length && /\s/.test(body[pos])) pos++
        if (pos >= body.length) break
        const open = body.indexOf('{', pos)
        if (open < 0) return { why: `text outside a frame (${JSON.stringify(body.slice(pos, pos + 30))})` }
        const head = body.slice(pos, open)
        const list = head.split(',').map((s) => s.trim())
        for (const offset of list) {
            const lower = offset.toLowerCase()
            const pct = OFFSET_PERCENT.exec(offset)
            if (lower !== 'from' && lower !== 'to' && !(pct && Number(pct[1]) <= 100)) return { why: `${JSON.stringify(head.trim().slice(0, 30))} is not a frame offset (from, to or 0% to 100%)` }
        }
        const close = body.indexOf('}', open + 1)
        if (close < 0) return { why: 'a frame is not closed' }
        const inner = body.slice(open + 1, close)
        if (/[{[\]@]/.test(inner)) return { why: 'a frame may hold only declarations' }
        for (const piece of splitTop(inner, ';')) {
            const text = piece.trim()
            if (!text) continue
            const m = /^([a-z-]+)\s*:\s*([\s\S]+)$/i.exec(text)
            if (!m) return { why: `${JSON.stringify(text.slice(0, 30))} is not a declaration` }
            const prop = m[1].toLowerCase()
            if (!FRAME_PROPS.has(prop)) return { why: `${prop} is not an admitted frame property (opacity, transform, translate, scale, rotate, filter, animation-timing-function)` }
            if (m[2].includes('!')) return { why: 'a frame declaration may not use !important' }
            const why = frameWhy(prop, m[2].trim())
            if (why) return { why: `${prop}: ${why}` }
        }
        offsets += list.length
        pos = close + 1
    }
    return { offsets }
}

/**
 * Takes the top-level `@keyframes pack-*` blocks out of the canonical text. A block inside @media or a rule is never reached (the
 * canonical text already refuses it). An invalid block is taken out as well, with an error, so its name stays undefined.
 */
export function extractKeyframes(text: string, area: JudgedArea): KeyframesExtraction {
    const names: Record<string, number> = {}
    const errors: LintError[] = []
    const cuts: [number, number][] = []
    const namePattern = new RegExp(`^pack-${area}-[a-z0-9-]{1,40}$`)
    let depth = 0
    let start = 0
    let seen = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < text.length && text[j] !== ch && text[j] !== '\n') j++
            i = j
            continue
        }
        if (ch === ';' && depth === 0) { start = i + 1; continue }
        if (ch === '}') { depth = Math.max(0, depth - 1); if (depth === 0) start = i + 1; continue }
        if (ch !== '{') continue
        const prelude = text.slice(start, i)
        if (depth > 0 || !isPackKeyframesPrelude(prelude)) { depth++; continue }
        const close = closingBrace(text, i)
        if (close < 0) { errors.push({ selector: '@keyframes', prop: '', why: 'a @keyframes block is not closed' }); break }
        const block = text.slice(start + (prelude.length - prelude.trimStart().length), close + 1)
        const nameToken = /^@keyframes\s+(\S+)$/i.exec(prelude.trim())?.[1] ?? ''
        const fail = (why: string): void => { errors.push({ selector: `@keyframes ${nameToken}`.slice(0, 70), prop: '', why: `a @keyframes block is not admitted: ${why}` }) }
        seen++
        const frames = framesOf(text.slice(i + 1, close))
        if (seen > MAX_KEYFRAMES_BLOCKS) fail(`a stylesheet may define at most ${MAX_KEYFRAMES_BLOCKS} blocks`)
        else if (!namePattern.test(nameToken)) fail(`the name must be pack-${area}- and 1 to 40 lower-case letters, digits or hyphens`)
        else if (Object.prototype.hasOwnProperty.call(names, nameToken)) fail(`${nameToken} is defined twice`)
        else if (block.length > MAX_BLOCK_BYTES) fail(`a block may hold at most ${MAX_BLOCK_BYTES} bytes`)
        else if ('why' in frames) fail(frames.why)
        else if (frames.offsets > MAX_OFFSETS) fail(`a block may hold at most ${MAX_OFFSETS} frame offsets`)
        else names[nameToken] = frames.offsets
        cuts.push([start + (prelude.length - prelude.trimStart().length), close + 1])
        i = close
        start = close + 1
    }
    if (!cuts.length) return { remainder: text, names, errors }
    let remainder = ''
    let at = 0
    for (const [from, to] of cuts) { remainder += text.slice(at, from); at = to }
    return { remainder: remainder + text.slice(at), names, errors }
}

// ---- the declaration pass
export interface EffectsResult {
    /** The text with every claimed declaration blanked to spaces, keeping its terminator and every offset. */
    remainder: string
    warnings: LintError[]
}

interface EntryFacts { candidate: (prop: string) => boolean, usable: (prop: string, paint: boolean) => boolean }

/** The entry-level half of the eligibility rule: (a) and (b) and the part of (c) that does not read the value. */
function entryFactsOf(area: JudgedArea, judge: (entry: string) => SubjectFacts, entry: string): EntryFacts {
    const refused: EntryFacts = { candidate: () => false, usable: () => false }
    const e = normalise(entry)
    const facts = judge(e)
    if (facts.why.length || !facts.parts.length || facts.tier === undefined || facts.tier === 'root') return refused
    if (!facts.parts.every((part) => part !== '' && isAreaPart(area, part))) return refused
    const parsed = parseSelectorEntry(e)
    const last = parsed.compounds[parsed.compounds.length - 1]
    if (parsed.grammarWhy || parsed.siblings || !last || !last.attrs.some(([name, value]) => name === 'data-part' && value)) return refused
    const backdropOk = facts.subjectParts.length > 0 && !facts.subjectParts.some((part) => ESCAPE_ANCESTORS.has(part))
    const safe = facts.tier === 'safe'
    return {
        candidate: (prop) => safe || prop === 'transition' || (prop === 'backdrop-filter' && backdropOk),
        usable: (prop, paint) => safe || (prop === 'transition' && paint) || (prop === 'backdrop-filter' && backdropOk),
    }
}

/**
 * Claims the effect declarations this pass admits and blanks them. `keyframes` maps each admitted block name to its offset count
 * (extractKeyframes); a name is compared as written, never folded.
 */
export function effectsPass(area: JudgedArea, text: string, keyframes: Readonly<Record<string, number>>): EffectsResult {
    const judge = subjectJudge(effectsRegistry(area))
    const entryCache = new Map<string, EntryFacts>()
    const factsOf = (entry: string): EntryFacts => {
        let facts = entryCache.get(entry)
        if (!facts) { facts = entryFactsOf(area, judge, entry); entryCache.set(entry, facts) }
        return facts
    }
    const warnings: LintError[] = []
    const warned = new Set<string>()
    const claimed: [number, number][] = []
    for (const d of decls(text)) {
        if (d.ctx.keyframes || !EFFECT_PROPS.has(d.prop) || !d.ctx.at.every((prelude) => /^@media\b/i.test(prelude))) continue
        const entries = splitTop(d.ctx.selector, ',').map((entry) => entry.trim())
        if (!entries.length || entries.some((entry) => !entry)) continue
        const facts = entries.map(factsOf)
        if (!facts.every((f) => f.candidate(d.prop))) continue
        const parsed = elementWhy(d.prop, d.value.replace(/\s*!\s*important\s*$/i, '').trim(), keyframes)
        if (parsed.why) {
            const selector = d.ctx.selector.trim()
            const key = `${selector}|${d.prop}|${parsed.why}`
            if (!warned.has(key)) { warned.add(key); warnings.push({ selector, prop: d.prop, why: `${parsed.why} (this ${d.prop} declaration is not admitted and stays refused)` }) }
            continue
        }
        if (facts.every((f) => f.usable(d.prop, parsed.paint === true))) claimed.push([d.ds, d.de])
    }
    if (!claimed.length) return { remainder: text, warnings }
    let remainder = ''
    let at = 0
    for (const [from, to] of claimed) { remainder += text.slice(at, from) + ' '.repeat(to - from); at = to }
    return { remainder: remainder + text.slice(at), warnings }
}
