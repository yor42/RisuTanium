// The question that stands between a risky flag and its turn-on. It lives in memory only: a reload, leaving Studio, a
// visit change, a change of the selected character and the destruction of the asker each end it with 'no', and the
// flag stays off. At most one question is pending, and it asks one flag after another.
//
// Known limitation: `hasOpenShell` is app-wide. A pattern shell left registered elsewhere while Studio is open would
// make every turn-on answer 'blocked' (a refusal line, never silent harm). The Studio entry points close their sheets
// first, so today no such shell survives into Studio.

import { hasOpenShell } from '../../../lib/Nexus/pattern/patternFocus'
import type { SetPath } from '../history/historyModel'
import type { OwnerKey } from '../history/ownerPhase'
import { studioScreen } from '../studioScreen.svelte'

// 'yes': every asked flag was confirmed. 'no': the user declined or the question was cancelled. 'blocked': no question
// could be shown (a shell layer is open), so nothing was asked.
export type RiskyAnswer = 'yes' | 'no' | 'blocked'

export interface RiskyAsk {
    answer: Promise<RiskyAnswer>
    // Ends the question this ask opened (a no-op once it ended), for the asker's own destruction.
    cancel(): void
}

export interface RiskyQuestionView {
    readonly owner: OwnerKey
    // The flag asked about now, and every flag of the action with this one's place among them.
    readonly path: SetPath
    readonly paths: readonly SetPath[]
    readonly index: number
}

interface Pending extends RiskyQuestionView {
    readonly visitId: string
    readonly chaId: string
    readonly returnTo: HTMLElement | null
    readonly finish: (answer: 'yes' | 'no') => void
    readonly advance: () => void
}

let pending = $state.raw<Pending | null>(null)

export function riskyQuestion(): RiskyQuestionView | null {
    return pending
}

export function askRiskyTurnOn(owner: OwnerKey, paths: readonly SetPath[]): RiskyAsk {
    if (pending !== null) {
        return { answer: Promise.resolve('no'), cancel() {} }
    }
    if (paths.length === 0) {
        return { answer: Promise.resolve('yes'), cancel() {} }
    }
    if (hasOpenShell()) {
        return { answer: Promise.resolve('blocked'), cancel() {} }
    }
    const active = typeof document === 'undefined' ? null : document.activeElement
    const returnTo = active instanceof HTMLElement ? active : null
    const visitId = studioScreen.visitId
    const chaId = studioScreen.chaId
    let settle!: (answer: RiskyAnswer) => void
    const answer = new Promise<RiskyAnswer>((resolve) => {
        settle = resolve
    })
    let ended = false
    let index = 0
    let mine: Pending | null = null
    const open = (): Pending => {
        const question: Pending = {
            owner,
            path: paths[index],
            paths,
            index,
            visitId,
            chaId,
            returnTo,
            finish(result) {
                if (ended || pending !== question) {
                    return
                }
                ended = true
                pending = null
                if (result === 'no' && returnTo?.isConnected) {
                    returnTo.focus()
                }
                settle(result)
            },
            advance() {
                if (ended || pending !== question) {
                    return
                }
                index += 1
                if (index >= paths.length) {
                    question.finish('yes')
                    return
                }
                pending = open()
            },
        }
        mine = question
        return question
    }
    pending = open()
    return {
        answer,
        // Only this ask's own question: a later ask's question is not ended by an earlier asker's destruction.
        cancel() {
            mine?.finish('no')
        },
    }
}

// The user's answer to the question shown now: 'yes' confirms the flag asked about and moves to the next one, if any.
export function answerRiskyQuestion(yes: boolean): void {
    if (pending === null) {
        return
    }
    if (yes) {
        pending.advance()
    } else {
        pending.finish('no')
    }
}

export function cancelRiskyQuestion(): void {
    pending?.finish('no')
}

// Ends the question when the visit or the selected character it was asked in is no longer the current one.
export function cancelRiskyQuestionIfMoved(): void {
    if (pending !== null && (pending.visitId !== studioScreen.visitId || pending.chaId !== studioScreen.chaId)) {
        pending.finish('no')
    }
}
