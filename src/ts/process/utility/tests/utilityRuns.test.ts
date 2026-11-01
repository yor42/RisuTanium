import { describe, expect, test } from 'vitest'
import { abortUtilityRun, startUtilityRun, utilityRunLive } from '../utilityRuns.svelte'

describe('Utility runs', () => {
    test('a conversation holds one run at a time and ending it frees the conversation', () => {
        const first = startUtilityRun('conv-hold')
        expect(first).not.toBeNull()
        expect(startUtilityRun('conv-hold')).toBeNull()

        first?.end()
        first?.end()

        const second = startUtilityRun('conv-hold')
        expect(second).not.toBeNull()
        second?.end()
    })

    test('every run has its own id and signal, and aborting one leaves the other running', () => {
        const a = startUtilityRun('conv-a')
        const b = startUtilityRun('conv-b')
        expect(a?.id).not.toBe(b?.id)

        expect(abortUtilityRun(a?.id ?? '')).toBe(true)

        expect(a?.signal.aborted).toBe(true)
        expect(b?.signal.aborted).toBe(false)
        a?.end()
        b?.end()
    })

    test('an aborted run no longer holds its conversation, while its late end stays harmless', () => {
        const old = startUtilityRun('conv-late')
        abortUtilityRun(old?.id ?? '')
        expect(utilityRunLive('conv-late')).toBe(false)

        const next = startUtilityRun('conv-late')
        expect(next).not.toBeNull()
        old?.end()

        expect(utilityRunLive('conv-late')).toBe(true)
        next?.end()
    })

    test('aborting an id that is not live reports false', () => {
        const run = startUtilityRun('conv-gone')
        run?.end()

        expect(abortUtilityRun(run?.id ?? '')).toBe(false)
        expect(abortUtilityRun('utility-run-never')).toBe(false)
    })
})
