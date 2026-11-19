// Rule E-2 (CHORE-738 stage 2, MC-2073, MC-2309): in a chat or Studio stylesheet every box-shadow layer without `inset` and every
// text-shadow layer may reach at most 2 px past its element. The rule is keyed on the declaration: every subject of these areas names
// a part, so no part list is read, and no colour is read either, so a transparent, translucent or unreadable colour does not exempt a
// layer. An unmeasurable layer is refused (the whitelist reader of paintOver.ts fails closed on any token of no listed shape), and so
// is `box-shadow: inherit`, which copies a shadow the check cannot see; the other keywords and every inset layer are not refused. rem
// is read at 16 px, the engine's convention. Every `--pack-*` variant is judged, with the app's tokens and the pack's own `:root`
// token overrides resolved first, exactly as cascade.ts builds its token map.
// Ordering contract with index.ts: this pass runs last, and only on a sheet every earlier pass accepted, so a refused sheet never gains
// or loses a reason. By the time it runs, app tokens can be set only on an exact `:root` with no `!`, so the token map is complete; if
// an earlier pass ever relaxes either rule, E-2 must read the same token configurations.
import { bare, decls } from './csslit'
import { effective, normalise, resolve, CHAT_REGISTRY, type LintError, type TokenMap } from './engine'
import { inlinePrivate } from './failclosed'
import { shadowLayers, shadowReach, MAX_OUTER_REACH_PX } from './paintOver'
import { STUDIO_REGISTRY } from './registries/studio'
import type { ThemeArea } from './index'

const RULE = 'in chat and Studio an outer box-shadow or a text-shadow may reach at most 2 px past its element, whatever its colour, so that it cannot lie under or over a control (MC-2073, MC-2309)'
const LABEL_MAX = 200
const clip = (text: string): string => text.slice(0, 60)
const short = (text: string): string => text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX)}…` : text

const overWhy = (prop: string, layer: string, reach: number): string => `${prop} layer "${clip(layer)}" reaches ${reach} px past its element; ${RULE}`
const unmeasuredWhy = (prop: string, layer: string): string => `${prop} layer "${clip(layer)}" cannot be measured, so its reach cannot be judged; write px or rem lengths with a space between values; ${RULE}`
const inheritWhy = `box-shadow: inherit copies the parent's shadow, which the check cannot measure; ${RULE}`

function judgeVariant(area: 'chat' | 'studio', text: string): LintError[] {
    const registry = area === 'chat' ? CHAT_REGISTRY : effective(STUDIO_REGISTRY)
    const ds = decls(text)
    const tokens: TokenMap = new Map(registry.app)
    for (const d of ds) if (d.prop.startsWith('--') && d.ctx.selector.trim() === ':root') tokens.set(d.prop, d.value.replace(/\s*!important\s*$/, '').trim())
    const errors: LintError[] = []
    for (const d of ds) {
        const box = d.prop === 'box-shadow'
        if (!box && d.prop !== 'text-shadow') continue
        const literal = bare(resolve(d.value.replace(/\s*!important\s*$/, '').trim(), tokens)).toLowerCase()
        const selector = short(d.ctx.selector.trim())
        if (box && literal.replace(/\s+/g, ' ').trim() === 'inherit') {
            errors.push({ selector, prop: d.prop, why: inheritWhy })
            continue
        }
        for (const l of shadowLayers(literal, box ? 'box' : 'text')) {
            if (box && l.inset && !l.text.includes('var(')) continue
            const reach = shadowReach(l.text, box ? 'box' : 'text')
            if (reach === null) {
                errors.push({ selector, prop: d.prop, why: unmeasuredWhy(d.prop, l.text) })
                break
            }
            if (reach > MAX_OUTER_REACH_PX) {
                errors.push({ selector, prop: d.prop, why: overWhy(d.prop, l.text, reach) })
                break
            }
        }
    }
    return errors
}

/** The E-2 refusals of one area's stylesheet: one error per declaration and variant, none for any area but chat and Studio. */
export function outerShadowPass(area: ThemeArea, css: string): LintError[] {
    if (area !== 'chat' && area !== 'studio') return []
    const text = normalise(css)
    const errors: LintError[] = []
    const seen = new Set<string>()
    for (const variant of inlinePrivate(text, '--pack-').variants) {
        for (const e of judgeVariant(area, variant)) {
            const key = `${e.selector}|${e.prop}|${e.why}`
            if (!seen.has(key)) { seen.add(key); errors.push(e) }
        }
    }
    return errors
}
