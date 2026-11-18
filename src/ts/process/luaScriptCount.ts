import type { triggerscript } from '../storage/database.svelte'

/**
 * Number of distinct Lua scripts a trigger list can run: the distinct `code`
 * of every `triggerlua` effect of every trigger. It is the engine count one
 * call mode needs to keep all of its own scripts alive.
 *
 * This module has no runtime import, so a test that mocks `scriptings` or
 * `triggers` never shadows it. It skips malformed entries rather than throw:
 * a caller counts before it knows the list is well formed.
 */
export function countLuaScripts(triggers: readonly triggerscript[]): number {
    const codes = new Set<string>()
    for (const trigger of triggers) {
        const effects = trigger?.effect
        if (!Array.isArray(effects)) {
            continue
        }
        for (const effect of effects) {
            if (effect?.type === 'triggerlua') {
                codes.add(effect.code)
            }
        }
    }
    return codes.size
}
