// @vitest-environment jsdom
// The save ack with the preset subject, over fake dependencies: a covering commit settles by the preset's commit verdict,
// as a module ack does, never by the character rules. New-rule guards (the subject kind is new).
import { describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({
    getCommittedSaveMarkCount: () => 0,
    afterNextSaveCommit: () => {},
    requestSaveNow: () => {},
    getPeerSaveCount: () => 0,
    getSaveMarkCount: () => 0,
    isCharacterUnsavable: () => false,
    isItemUnsavable: () => false,
    isSavingStopped: () => false,
    moduleCommitVerdict: () => 'saved',
    onSavingStopped: () => () => {},
    saving: { state: false },
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, frozenSaveKeysStore: writable([]) }
})

import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createSaveAck, productionPresetAckSubject, type ModuleCommitVerdict, type SaveAck, type SaveAckDeps } from '../saveAck.svelte'

interface Rig {
    clock: FakeClock
    ack: SaveAck
    verdict: ReturnType<typeof vi.fn<(id: string) => ModuleCommitVerdict>>
    state: { marks: number, committed: number }
    commit(covered?: number): void
}

function rig(initial: ModuleCommitVerdict = 'saved'): Rig {
    const clock = createFakeClock()
    const state = { marks: 0, committed: 0 }
    const callbacks = new Set<() => void>()
    const verdict = vi.fn<(id: string) => ModuleCommitVerdict>(() => initial)
    const deps: SaveAckDeps = {
        getMarkCount: () => state.marks,
        getCommittedMarkCount: () => state.committed,
        afterNextCommit: (callback) => { callbacks.add(callback) },
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    const ack = createSaveAck(deps, { kind: 'preset', verdict })
    return {
        clock,
        ack,
        verdict,
        state,
        commit(covered = state.marks) {
            state.committed = covered
            for (const callback of [...callbacks]) {
                callbacks.delete(callback)
                callback()
            }
        },
    }
}

// An edit: the mark counts first, then the ack is told the count read before.
function edit(r: Rig, id = 'p1'): void {
    const before = r.state.marks
    r.state.marks += 1
    r.ack.noteEdit(id, before)
}

describe('the preset subject of the save ack', () => {
    test('A1 a covering commit with the verdict saved settles saved, asking the verdict for the edited preset', () => {
        const r = rig('saved')
        edit(r, 'p7')
        expect(r.ack.state).toBe('pending')
        r.commit()
        expect(r.ack.state).toBe('saved')
        expect(r.verdict).toHaveBeenCalledWith('p7')
        r.ack.dispose()
    })

    test('A2 a blocked verdict is unconfirmed and Retry is offered', () => {
        const r = rig('blocked')
        edit(r)
        r.commit()
        expect(r.ack.state).toBe('unconfirmed')
        expect(r.ack.canRetry()).toBe(true)
        r.ack.dispose()
    })

    test('A3 an unsavable verdict is a failed with no Retry, and a later stored commit makes it saved', () => {
        const r = rig('unsavable')
        edit(r)
        r.commit()
        expect(r.ack.state).toBe('failed')
        expect(r.ack.canRetry()).toBe(false)
        r.verdict.mockReturnValue('saved')
        r.commit()
        expect(r.ack.state).toBe('saved')
        r.ack.dispose()
    })

    test('A4 a mark that was not counted is failed at once', () => {
        const r = rig('saved')
        r.ack.noteEdit('p1', r.state.marks)
        expect(r.ack.state).toBe('failed')
        r.ack.dispose()
    })

    test('A5 a commit that does not cover the edit asks no verdict and stays pending', () => {
        const r = rig('saved')
        edit(r)
        r.commit(0)
        expect(r.verdict).not.toHaveBeenCalled()
        expect(r.ack.state).toBe('pending')
        r.ack.dispose()
    })

    test('A6 the production subject is a preset subject', () => {
        expect(productionPresetAckSubject().kind).toBe('preset')
    })
})
