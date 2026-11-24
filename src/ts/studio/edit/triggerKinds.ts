// Which effect types the trigger engine has a case for, and which kind of effect a type is. Mirrors the engine's
// effect switch: the V2 and V1 type sets are the ones the reference scan already uses, so the two cannot drift.
// Pure: membership is a `Set.has` on a string, never `in` or an object index, so a prototype key such as
// `toString` is not a known type.
import { KNOWN_V2_TYPES, V1_EFFECT_TYPES } from '../assets/referenceTargets'

export type EffectKind = 'v2' | 'lua' | 'legacy' | 'v1' | 'unknown'

const V2_TYPES: ReadonlySet<string> = new Set(KNOWN_V2_TYPES)

/** True exactly for the types the engine's effect switch has a case for: the V2 types, the V1 types and `triggerlua`. */
export function hasEngineCase(type: unknown): boolean {
    return typeof type === 'string' && (type === 'triggerlua' || V2_TYPES.has(type) || V1_EFFECT_TYPES.has(type))
}

/** `v2`, `lua` (`triggerlua`), `legacy` (`triggercode`), `v1`, or `unknown` for anything else, a non-string included. */
export function effectKindOf(type: unknown): EffectKind {
    if (typeof type !== 'string') return 'unknown'
    if (type === 'triggerlua') return 'lua'
    if (type === 'triggercode') return 'legacy'
    if (V2_TYPES.has(type)) return 'v2'
    if (V1_EFFECT_TYPES.has(type)) return 'v1'
    return 'unknown'
}

/** True exactly when `row` is an object whose `effect` is an object whose `0` entry is an object of type `triggerlua` or `triggercode`. The engine reads `effect[0]` without requiring an array, so an object-keyed effect runs on every pass too. */
export function runsOnEveryTrigger(row: unknown): boolean {
    if (typeof row !== 'object' || row === null) return false
    const effect = (row as { effect?: unknown }).effect
    if (typeof effect !== 'object' || effect === null) return false
    const first: unknown = (effect as { 0?: unknown })[0]
    if (typeof first !== 'object' || first === null) return false
    const type = (first as { type?: unknown }).type
    return type === 'triggerlua' || type === 'triggercode'
}
