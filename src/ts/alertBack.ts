import { get } from 'svelte/store'
import type { alertData } from './alert'
import { answerShownPrompt } from './alertPrompts'
import { PATTERN_PROMPT_CANCEL } from './patternPromptAnswer'
import { alertStore } from './stores.svelte'

/**
 * What Back does to the alert on screen, per type.
 * - `close`: a notice with no answer to give; it ends as its OK or X ends it.
 * - `answer`: a prompt with a cancel button; Back writes the answer that button writes. It is never
 *   a confirming answer.
 * - `cancelWait`: a wait notice offering Cancel; Back runs the cancel action, as Escape does.
 * - `hold`: nothing a user could cancel, or not an alert the page may dismiss; Back does nothing.
 */
type BackAction =
    | { kind: 'close' }
    | { kind: 'answer', message: string }
    | { kind: 'cancelWait' }
    | { kind: 'hold' }

const CLOSE: BackAction = { kind: 'close' }
const HOLD: BackAction = { kind: 'hold' }

/**
 * Total over `alertData['type']`, so a new alert type fails the type check until it is classified.
 * `cardexport` answers a cancel with an empty `type2`: its X button writes the dialog's own
 * `type2` selection, which is component state, and callers read only `type`.
 */
export const ALERT_BACK_ACTIONS: Record<alertData['type'], BackAction> = {
    ask: { kind: 'answer', message: 'no' },
    pluginconfirm: { kind: 'answer', message: 'no' },
    selectChar: { kind: 'answer', message: '' },
    selectModule: { kind: 'answer', message: '' },
    cardexport: { kind: 'answer', message: JSON.stringify({ type: 'cancel', type2: '' }) },
    addchar: { kind: 'answer', message: 'cancel' },
    chatOptions: { kind: 'answer', message: 'cancel' },
    patternSelect: { kind: 'answer', message: PATTERN_PROMPT_CANCEL },
    patternInput: { kind: 'answer', message: PATTERN_PROMPT_CANCEL },
    normal: CLOSE,
    error: CLOSE,
    markdown: CLOSE,
    requestdata: CLOSE,
    hypaV2: CLOSE,
    branches: CLOSE,
    requestlogs: CLOSE,
    pukmakkurit: CLOSE,
    wait2: CLOSE,
    wait: { kind: 'cancelWait' },
    select: HOLD,
    input: HOLD,
    tos: HOLD,
    staleAccountNotice: HOLD,
    progress: HOLD,
    toast: HOLD,
    none: HOLD,
}

/**
 * Acts on the alert that is on screen for one Back press. A prompt queued or hidden under a cover
 * is left alone. Notices are closed by writing the raw store, as their own buttons do: unlike
 * `alertClear` this never depends on whether a prompt is showing, and a notice is never a prompt.
 * A wait's cancel action runs but the wait may still be up on return, because closing it is the
 * callback's job.
 */
export function closeDialogForBack(): void {
    const shown = get(alertStore)
    const action = ALERT_BACK_ACTIONS[shown.type]
    switch (action.kind) {
        case 'close':
            alertStore.set({ type: 'none', msg: '' })
            return
        case 'answer':
            answerShownPrompt(action.message)
            return
        case 'cancelWait':
            if (shown.type === 'wait' && shown.onCancel) {
                shown.onCancel()
            }
            return
        case 'hold':
            return
    }
}
