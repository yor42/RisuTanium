// The retry loop of an action the history service refused with `riskyConfirm`: ask for the refused flags, then run the
// same attempt again with them confirmed and pinned to the target the refused attempt found. Pure: the question is
// passed in, so a test drives it with a fake.

import type { ReplayDesc, RiskyPin, StudioResult } from '../history/ownerHistory.svelte'
import type { SetPath } from '../history/historyModel'
import type { OwnerKey } from '../history/ownerPhase'
import type { RiskyAsk } from './riskyConfirm.svelte'

// Runs one attempt: `confirmed` and `pin` are absent on the first call.
export type RiskyAttempt = (confirmed?: readonly SetPath[], pin?: RiskyPin) => StudioResult | Promise<StudioResult>

export type RiskyAskFn = (owner: OwnerKey, paths: readonly SetPath[]) => Pick<RiskyAsk, 'answer'>

// At most two questions and three attempts: a retry is refused again only when a live value changed elsewhere during the
// question (the pin keeps the target), and a refusal after the one re-ask is returned as it is.
const MAX_QUESTIONS = 2

type RiskyRefusal = Extract<StudioResult, { ok: false }>

function isRiskyRefusal(result: StudioResult): result is RiskyRefusal {
    return result.ok === false && result.reason === 'riskyConfirm'
}

// `first` is a refused attempt's result. Null is the silent result: the question was declined or cancelled, or the
// caller's `still()` no longer holds after the answer, so there is nothing to say and nothing was written.
export async function resolveRiskyRefusal(
    owner: OwnerKey,
    first: StudioResult,
    attempt: RiskyAttempt,
    still: () => boolean,
    ask: RiskyAskFn,
): Promise<StudioResult | null> {
    let result = first
    let confirmed: SetPath[] = []
    const pin = first.ok === false ? first.pin : undefined
    for (let asked = 0; asked < MAX_QUESTIONS && isRiskyRefusal(result); asked++) {
        const needed = (result.paths ?? []).filter((path) => !confirmed.includes(path))
        const answer = await ask(owner, needed).answer
        if (answer === 'no' || !still()) {
            return null
        }
        if (answer === 'blocked') {
            return result
        }
        confirmed = [...confirmed, ...needed]
        result = await attempt(confirmed, pin)
    }
    return result
}

// `desc` with the retry's confirmation and pin added: an undo or a redo keeps `expectTop`, a revert keeps `expectIds`.
export function pinnedDesc(desc: ReplayDesc, confirmed?: readonly SetPath[], pin?: RiskyPin): ReplayDesc {
    const withConfirmed = confirmed === undefined ? desc : { ...desc, confirmed }
    if (pin === undefined) {
        return withConfirmed
    }
    if (withConfirmed.kind === 'revert') {
        return 'expectIds' in pin ? { ...withConfirmed, expectIds: pin.expectIds } : withConfirmed
    }
    return 'expectTop' in pin ? { ...withConfirmed, expectTop: pin.expectTop } : withConfirmed
}

export async function withRiskyConfirm(owner: OwnerKey, attempt: RiskyAttempt, still: () => boolean, ask: RiskyAskFn): Promise<StudioResult | null> {
    const first = await attempt()
    return isRiskyRefusal(first) ? resolveRiskyRefusal(owner, first, attempt, still, ask) : first
}
