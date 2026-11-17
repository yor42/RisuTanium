/**
 * The cancel a caller offers on a select or input prompt. This module imports nothing, so a
 * `vi.mock` of `./alert` can never hide these values from the callers that use them.
 */

/** Options of `alertSelect` and `alertInput`: the answer the prompt's Cancel button, Back and Escape write. */
export interface PromptCancel {
    cancel?: string
}

/**
 * The select answer that names no option. Every caller already reads it as "no option": `parseInt`
 * gives -1, an `actions[-1]` lookup misses and an `=== '0'` style test is false.
 */
export const ALERT_SELECT_CANCEL = '-1'

/** An input answer a text field cannot produce, for a caller that guards on it before using the text. */
export const ALERT_INPUT_CANCEL = '\u0000cancel'
