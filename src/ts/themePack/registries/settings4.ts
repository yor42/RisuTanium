// The Settings part registry as slice 4 extends it: this module adds the slice 4 names to ./settings' lists and passes them to the same validator (lintPack(css, name, registry)).
import { SETTINGS_CRITICAL, SETTINGS_SAFE, SETTINGS_SURFACES, SETTINGS_TOKENS, lintPack as lintSettings } from './settings'
import type { LintResult, NameMatch, RegistryInput, SurfaceCheck, TokenMap } from '../engine'

/** A slice registry as it extends the Settings registry: part lists, value floors and its role tokens. */
export interface SliceRegistry extends RegistryInput {
    critical: string[]
    safe: string[]
    surfaces: SurfaceCheck[]
    tokens: TokenMap
    strictSafe: boolean
    minimums: Record<string, string | number>
    settable: NameMatch[]
}

// the 26 new part names (SLICE4_SPEC Appendix: Parts)
export const NEW_PARTS: string[] = ['settings-param-page', 'settings-param-header', 'settings-param-group', 'settings-param-row', 'settings-param-label', 'settings-param-hint', 'settings-param-help', 'settings-param-slider', 'settings-param-field', 'settings-param-send',
    'settings-param-warning', 'settings-param-fix', 'settings-param-reason', 'settings-param-badge', 'settings-param-advanced', 'settings-param-preview', 'settings-service-group', 'settings-bias-table', 'settings-addparam-table', 'settings-flag-list', 'settings-task-mode', 'settings-param-send-switch', 'settings-param-estimate', 'settings-param-leftout', 'settings-param-models-mark', 'settings-param-flags-note']
// critical: the over-limit warning (and its mark and the custom-flags line) and its fix button, a protected child with a name of its own
// DS-097: the send switch (and the switch inside it), the reason line, the global badge and the value field are protected too: a pack cannot name them (so cannot hide them); the estimate label of the preview panel is protected for the same reason (DS-095: it must not read as the exact request)
export const NEW_CRITICAL: string[] = ['settings-param-warning', 'settings-param-fix', 'settings-param-send', 'settings-param-send-switch', 'settings-param-reason', 'settings-param-badge', 'settings-param-field', 'settings-param-estimate', 'settings-param-models-mark', 'settings-param-flags-note', 'settings-param-label', 'settings-param-leftout']
// R4-15 (which parts a pack may hide): the row label (the only name a row has) and the left-out list (it carries the DS-095 'with why' and the DS-080 reasons) are protected. The flag list is reach tier: it holds the switches that change what the app tells the service the model can do, so it may be restyled but not hidden.
// The slider, the hint and the help stay safe: the number field (protected) always carries the value and the send switch (protected) the state.
// safe leaves: never critical, never hold a critical element, never sit inside one (asserted in the browser by parts.mjs). The hint and the help may be moved by a pack, the warning may not.
export const NEW_SAFE: string[] = ['settings-param-header', 'settings-param-hint', 'settings-param-help', 'settings-param-slider']
export const CRITICAL4: string[] = [...SETTINGS_CRITICAL, ...NEW_CRITICAL]
export const SAFE4: string[] = [...SETTINGS_SAFE, ...NEW_SAFE]
// DD-182 / DD-187: a pack may not set these tokens below a floor (registry.minimums). --param-dim-opacity: the controls of a dimmed row stay visible; --param-warn-bar: the bar of the over-limit warning still reads as an edge.
export const MINIMUMS4: Record<string, string | number> = { '--param-dim-opacity': 0.4, '--param-warn-bar': '2px' }
export const REG4: SliceRegistry = { critical: CRITICAL4, safe: SAFE4, surfaces: SETTINGS_SURFACES, tokens: SETTINGS_TOKENS, strictSafe: true, minimums: MINIMUMS4, settable: [/^--param-[a-z0-9-]+$/] }   // DD-242: the slice 4 role tokens (--param-*) are pack-settable
export const lint4 = (css: string, name = ''): LintResult => lintSettings(css, name, REG4)
