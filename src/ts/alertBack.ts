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
 * - `cancelIfOffered`: a prompt whose caller may offer a cancel per instance; Back writes that
 *   instance's `cancelAnswer`, and without one it holds.
 * - `hold`: nothing a user could cancel, or not an alert the page may dismiss; Back does nothing.
 */
type BackAction =
    | { kind: 'close' }
    | { kind: 'answer', message: string }
    | { kind: 'cancelWait' }
    | { kind: 'cancelIfOffered' }
    | { kind: 'hold' }

const CLOSE: BackAction = { kind: 'close' }
const HOLD: BackAction = { kind: 'hold' }
const CANCEL_IF_OFFERED: BackAction = { kind: 'cancelIfOffered' }

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
    parkedReply: { kind: 'answer', message: 'later' },
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
    select: CANCEL_IF_OFFERED,
    peerConflicts: HOLD,
    input: CANCEL_IF_OFFERED,
    tos: HOLD,
    staleAccountNotice: HOLD,
    progress: HOLD,
    toast: HOLD,
    none: HOLD,
}

/**
 * The answer the Cancel button, Back and Escape all write for the alert shown: the caller's
 * `cancelAnswer`, and only for a type the table classifies as a per-instance cancel.
 */
export function offeredCancel(shown: alertData): string | undefined {
    if (ALERT_BACK_ACTIONS[shown.type].kind !== 'cancelIfOffered') {
        return undefined
    }
    return shown.cancelAnswer
}

/**
 * Whether an offered cancel is the answer of one of a select's own option buttons, so the dialog
 * adds no Cancel button and Back and Escape press that option. The `__DISPLAY__` heading is not an option.
 */
export function cancelHasOwnButton(a: alertData): boolean {
    if (a.type !== 'select' || a.cancelAnswer === undefined) {
        return false
    }
    const parts = a.msg.startsWith('__DISPLAY__') ? a.msg.substring(11).split('||').slice(1) : a.msg.split('||')
    return /^(0|[1-9]\d*)$/.test(a.cancelAnswer) && Number(a.cancelAnswer) < parts.length
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
        case 'cancelIfOffered': {
            const answer = offeredCancel(shown)
            if (answer !== undefined) {
                answerShownPrompt(answer)
            }
            return
        }
        case 'hold':
            return
    }
}
