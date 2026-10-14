import { describe, expect, it } from 'vitest'
import { checkFences, decideBatch, type CommitKeyRead, type FenceInput } from '../../store2/sweep'
import { commitKeyOf } from './sweepFixtures'

function okInput(over: Partial<FenceInput> = {}): FenceInput {
    return {
        commitKey: { status: 'ok', value: commitKeyOf() },
        fence: 'absent',
        legacyFiles: [],
        tauriFlushPending: false,
        bulkMarkersSet: true,
        ...over,
    }
}

function reasonsOf(over: Partial<FenceInput>): string[] {
    const result = checkFences(okInput(over))
    return result.status === 'refused' ? result.reasons : []
}

describe('sweep fences', () => {
    it('passes when every precondition holds', () => {
        expect(checkFences(okInput())).toEqual({ status: 'clear' })
    })

    it('refuses with staging set', () => {
        const staging = { owner: 'tab', prefix: 'store2/g-0000000000000000-', startedAt: 0, label: 'restore' as const }
        expect(reasonsOf({ commitKey: { status: 'ok', value: commitKeyOf({ staging }) } })).toEqual(['staging'])
    })

    it('refuses a null current manifest', () => {
        expect(reasonsOf({ commitKey: { status: 'ok', value: commitKeyOf({ current: null }) } })).toEqual(['no-current'])
    })

    it('refuses an absent, damaged, too-new or unreadable commit key', () => {
        const reads: [CommitKeyRead, string][] = [
            [{ status: 'absent' }, 'commit-absent'],
            [{ status: 'damaged', reason: 'x' }, 'commit-damaged'],
            [{ status: 'too-new', reason: 'x' }, 'commit-too-new'],
            [{ status: 'unreadable', reason: 'x' }, 'commit-unreadable'],
        ]
        for (const [commitKey, reason] of reads) {
            expect(reasonsOf({ commitKey })).toEqual([reason])
        }
    })

    it('refuses a commit key that parsed with a format or required feature this build does not know', () => {
        expect(reasonsOf({ commitKey: { status: 'ok', value: { ...commitKeyOf(), req: ['future'] } } })).toEqual(['commit-too-new'])
        expect(reasonsOf({ commitKey: { status: 'ok', value: { ...commitKeyOf(), fmt: 2 as 1 } } })).toEqual(['commit-too-new'])
    })

    it('refuses any fence that is not absent, parsable or not', () => {
        expect(reasonsOf({ fence: 'present' })).toEqual(['fence-present'])
        expect(reasonsOf({ fence: 'unreadable' })).toEqual(['fence-unreadable'])
    })

    it('refuses while a legacy file is unreadable, and releases only when none is', () => {
        expect(reasonsOf({ legacyFiles: [{ key: 'a.bin', status: 'ok' }, { key: 'b.bin', status: 'unreadable' }] })).toEqual(['legacy-file-unreadable'])
        expect(reasonsOf({ legacyFiles: [{ key: 'a.bin', status: 'ok' }, { key: 'b.bin', status: 'gone' }] })).toEqual([])
    })

    it('refuses while a Tauri commit-key flush is pending and while a bulk has not set its marker', () => {
        expect(reasonsOf({ tauriFlushPending: true })).toEqual(['tauri-flush-pending'])
        expect(reasonsOf({ bulkMarkersSet: false })).toEqual(['bulk-marker-missing'])
    })

    it('reports every failing precondition', () => {
        expect(reasonsOf({ fence: 'present', tauriFlushPending: true, commitKey: { status: 'absent' } }))
            .toEqual(['commit-absent', 'fence-present', 'tauri-flush-pending'])
    })
})

describe('per-batch re-check', () => {
    const same = { commitAtStart: 5, commitNow: 5, fenceAtStart: 2, fenceNow: 2 }

    it('proceeds when both keys are unchanged, an absent-at-revision fence included', () => {
        expect(decideBatch(same)).toBe('proceed')
        expect(decideBatch({ commitAtStart: 'a', commitNow: 'a', fenceAtStart: null, fenceNow: null })).toBe('proceed')
    })

    it('rebuilds the keep-set when the commit key moved', () => {
        expect(decideBatch({ ...same, commitNow: 6 })).toBe('rebuild')
    })

    it('refuses when a fence appeared between the pass start and the batch', () => {
        expect(decideBatch({ ...same, fenceAtStart: null, fenceNow: 'bytes' })).toBe('refuse')
        expect(decideBatch({ ...same, fenceNow: 3 })).toBe('refuse')
    })

    it('refuses first when both keys moved', () => {
        expect(decideBatch({ commitAtStart: 1, commitNow: 2, fenceAtStart: 1, fenceNow: 2 })).toBe('refuse')
    })
})
