// T2-RC-1: the retry loop of a `riskyConfirm` refusal, pure, with a fake question. The retry carries the confirmed paths
// and the first refusal's pin; a declined or cancelled question and a `still()` that no longer holds are silent and run no
// further attempt; a blocked question returns the refusal; at most one re-ask follows, and a refusal after it is
// returned as it is.
import { describe, expect, test } from 'vitest'
import type { ReplayDesc, RiskyPin, StudioResult } from '../history/ownerHistory.svelte'
import type { SetPath } from '../history/historyModel'
import { characterOwnerKey } from '../history/ownerPhase'
import type { RiskyAnswer } from './riskyConfirm.svelte'
import { pinnedDesc, withRiskyConfirm } from './riskyReplay'

const OWNER = characterOwnerKey('A')

const refusal = (paths: SetPath[], pin?: RiskyPin): StudioResult => ({ ok: false, reason: 'riskyConfirm', paths, ...(pin === undefined ? {} : { pin }) })

interface Rig {
    asked: SetPath[][]
    attempts: { confirmed: readonly SetPath[] | undefined; pin: RiskyPin | undefined }[]
}

function rig(answers: RiskyAnswer[], results: StudioResult[]): { rig: Rig; run(still?: () => boolean): Promise<StudioResult | null> } {
    const state: Rig = { asked: [], attempts: [] }
    const queue = [...results]
    const answered = [...answers]
    return {
        rig: state,
        run: (still = () => true) =>
            withRiskyConfirm(
                OWNER,
                (confirmed, pin) => {
                    state.attempts.push({ confirmed, pin })
                    return queue.shift() ?? { ok: true }
                },
                still,
                (_owner, paths) => {
                    state.asked.push([...paths])
                    return { answer: Promise.resolve(answered.shift() ?? 'no') }
                },
            ),
    }
}

describe('T2-RC-1: withRiskyConfirm', () => {
    test('a result that is not a risky refusal is returned with no question', async () => {
        const run = rig([], [{ ok: true }])
        expect(await run.run()).toEqual({ ok: true })
        expect(run.rig.asked).toEqual([])
    })

    test('a declined question returns null and runs no second attempt', async () => {
        const run = rig(['no'], [refusal(['utilityBot'], { expectTop: 'p:1' })])
        expect(await run.run()).toBeNull()
        expect(run.rig.attempts).toHaveLength(1)
    })

    test('yes with a still() that no longer holds returns null and runs no second attempt', async () => {
        const run = rig(['yes'], [refusal(['utilityBot'], { expectTop: 'p:1' })])
        expect(await run.run(() => false)).toBeNull()
        expect(run.rig.attempts).toHaveLength(1)
    })

    test('yes retries with the confirmed paths and the first refusal pin', async () => {
        const run = rig(['yes'], [refusal(['utilityBot'], { expectTop: 'p:1' }), { ok: true }])
        expect(await run.run()).toEqual({ ok: true })
        expect(run.rig.attempts).toEqual([
            { confirmed: undefined, pin: undefined },
            { confirmed: ['utilityBot'], pin: { expectTop: 'p:1' } },
        ])
        expect(run.rig.asked).toEqual([['utilityBot']])
    })

    test('a retry refused with a new path asks exactly once more, with every path so far confirmed and the first pin', async () => {
        const run = rig(['yes', 'yes'], [refusal(['utilityBot'], { expectIds: ['p:1', 'p:2'] }), refusal(['lowLevelAccess']), { ok: true }])
        expect(await run.run()).toEqual({ ok: true })
        expect(run.rig.asked).toEqual([['utilityBot'], ['lowLevelAccess']])
        expect(run.rig.attempts[2]).toEqual({ confirmed: ['utilityBot', 'lowLevelAccess'], pin: { expectIds: ['p:1', 'p:2'] } })
    })

    test('a third refusal is returned unchanged, without a third question', async () => {
        const third = refusal(['escapeOutput'])
        const run = rig(['yes', 'yes', 'yes'], [refusal(['utilityBot']), refusal(['lowLevelAccess']), third])
        expect(await run.run()).toEqual(third)
        expect(run.rig.asked).toHaveLength(2)
        expect(run.rig.attempts).toHaveLength(3)
    })

    test('blocked returns the refusal unchanged and runs no second attempt', async () => {
        const first = refusal(['utilityBot'], { expectTop: 'p:1' })
        const run = rig(['blocked'], [first])
        expect(await run.run()).toEqual(first)
        expect(run.rig.attempts).toHaveLength(1)
    })
})

describe('pinnedDesc', () => {
    test('an undo or a redo keeps expectTop, a revert keeps expectIds, and the confirmed paths ride along', () => {
        const undo: ReplayDesc = { kind: 'undo' }
        expect(pinnedDesc(undo, ['utilityBot'], { expectTop: 'p:1' })).toEqual({ kind: 'undo', expectTop: 'p:1', confirmed: ['utilityBot'] })
        const revert: ReplayDesc = { kind: 'revert', stepId: 'p:1' }
        expect(pinnedDesc(revert, ['utilityBot'], { expectIds: ['p:1', 'p:2'] })).toEqual({ kind: 'revert', stepId: 'p:1', expectIds: ['p:1', 'p:2'], confirmed: ['utilityBot'] })
        expect(pinnedDesc(undo)).toEqual({ kind: 'undo' })
    })
})
