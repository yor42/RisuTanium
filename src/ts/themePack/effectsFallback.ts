// The app-written fallback tail of an applied pack sheet: the OS reduce-motion and reduce-transparency answers for the effects a pack sets.
// It reads only the selector entries and the property names of the judged text and never copies a pack value, so what it emits is a function of
// which families each entry sets. Every entry is copied verbatim, so the tail selects exactly what the pack rule selects, and it sits after the pack's
// rules with `!important` at equal specificity. It has no try/catch on purpose: a throw must reach the caller, which then applies no sheet.
import { decls } from './csslit'
import { selectorList } from './shapeMode'

/** The effect families an entry sets: T transition, A animation, F filter, B backdrop-filter. */
interface Families { t: boolean, a: boolean, f: boolean, b: boolean }

const MOTION_TRANSITION = 'transition-duration:.01ms!important;transition-delay:0s!important'
const MOTION_ANIMATION = 'animation-duration:.01ms!important;animation-iteration-count:1!important;animation-delay:0s!important'

/**
 * The tail to append to a judged text, or '' when no selector entry sets a transition, an animation, a filter or a backdrop-filter.
 * Motion group (prefers-reduced-motion): the entries with a transition or animation get their durations and delays reset.
 * Transparency group (prefers-reduced-transparency): the entries with a filter, a backdrop-filter or an animation get their filters
 * removed, because an animation can run a filter through its keyframes. Only the families an entry sets are emitted for it.
 */
export function fallbackTail(text: string): string {
    const entries = new Map<string, Families>()
    for (const d of decls(text)) {
        if (d.ctx.keyframes) continue
        const family = d.prop === 'transition' ? 't' : d.prop === 'animation' ? 'a' : d.prop === 'filter' ? 'f' : d.prop === 'backdrop-filter' ? 'b' : null
        if (family === null) continue
        for (const raw of selectorList(d.ctx.selector)) {
            const entry = raw.trim()
            if (!entry) continue
            let families = entries.get(entry)
            if (!families) { families = { t: false, a: false, f: false, b: false }; entries.set(entry, families) }
            families[family] = true
        }
    }
    let motion = ''
    let transparency = ''
    for (const [entry, families] of entries) {
        const motionDeclarations = [families.t ? MOTION_TRANSITION : '', families.a ? MOTION_ANIMATION : ''].filter(Boolean)
        if (motionDeclarations.length) motion += `${entry}{${motionDeclarations.join(';')}}`
        const transparencyDeclarations = [families.f || families.a ? 'filter:none!important' : '', families.b ? 'backdrop-filter:none!important' : ''].filter(Boolean)
        if (transparencyDeclarations.length) transparency += `${entry}{${transparencyDeclarations.join(';')}}`
    }
    return (motion ? `@media (prefers-reduced-motion: reduce){${motion}}` : '') + (transparency ? `@media (prefers-reduced-transparency: reduce){${transparency}}` : '')
}
