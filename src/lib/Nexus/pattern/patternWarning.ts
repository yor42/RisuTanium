/** The warning sheet's definition, its action rules and the pure helpers its component uses. */

export type PatternSeverity = 'notice' | 'caution' | 'confirm' | 'danger' | 'blocked'

/** What a sheet resolves to. `confirm` is the primary action. */
export type PatternAnswer = 'confirm' | 'secondary' | 'cancel'

/** Button labels, already translated. */
export interface PatternActionLabels {
    cancel?: string
    secondary?: string
    primary?: string
}

/** A sheet needs at least one action so that the user can always answer or dismiss it. */
type AtLeastOneAction =
    | { cancel: string, secondary?: string, primary?: string }
    | { cancel?: string, secondary: string, primary?: string }
    | { cancel?: string, secondary?: string, primary: string }

interface PatternWarningBase {
    /** One line: a verb and its object. */
    headline: string
    /** One fact each; the first three show, the rest fold into the disclosure. */
    consequences?: string[]
    /** Optional lines behind the disclosure. */
    detail?: string[]
    /** The label of the one checkbox that gates the primary action. */
    ack?: string
    /** A line that names a time limit. */
    undoLine?: string
}

export type PatternWarningDef =
    | (PatternWarningBase & { severity: 'confirm' | 'danger', actions: { cancel: string, secondary?: string, primary: string } })
    | (PatternWarningBase & { severity: 'notice' | 'caution' | 'blocked', actions: AtLeastOneAction })

/** Consequences shown before the disclosure. */
export const VISIBLE_CONSEQUENCES = 3

/** Used when the stylesheet does not provide `--warning-arm-delay`. */
export const DEFAULT_ARM_DELAY_MS = 250

/** The type already requires the actions; this backs it up for callers that bypass the type. */
export function assertWarningActions(def: PatternWarningDef): void {
    const actions: PatternActionLabels = def.actions
    if (def.severity === 'confirm' || def.severity === 'danger') {
        if (!actions.cancel || !actions.primary) {
            throw new Error(`A ${def.severity} warning needs cancel and primary actions`)
        }
        return
    }
    if (!actions.cancel && !actions.secondary && !actions.primary) {
        throw new Error('A warning sheet needs at least one action')
    }
}

/** The action that takes first focus: Cancel, or the only way out when there is no Cancel. */
export function firstFocusAction(actions: PatternActionLabels): PatternAnswer {
    if (actions.cancel) return 'cancel'
    if (actions.secondary) return 'secondary'
    return 'confirm'
}

export function splitConsequences(consequences: readonly string[] | undefined): { shown: string[], folded: string[] } {
    const list = consequences ?? []
    return { shown: list.slice(0, VISIBLE_CONSEQUENCES), folded: list.slice(VISIBLE_CONSEQUENCES) }
}

/** Parses a CSS time such as `250ms` or `0.25s`. Anything else is null. */
export function parseCssDuration(text: string): number | null {
    const match = /^\s*(\d*\.?\d+)\s*(ms|s)\s*$/.exec(text)
    if (!match) return null
    const value = Number(match[1]) * (match[2] === 's' ? 1000 : 1)
    return Number.isFinite(value) ? value : null
}

/** The danger arm delay in ms, read from the computed style of `element`. */
export function armDelayMs(element: Element): number {
    const text = getComputedStyle(element).getPropertyValue('--warning-arm-delay')
    return parseCssDuration(text) ?? DEFAULT_ARM_DELAY_MS
}
