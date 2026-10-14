import { describe, expect, it } from 'vitest'
import { decideAutoSweep, SWEEP_AUTO_LIMIT } from '../../store2/sweep'

describe('automatic sweep limit', () => {
    it('defaults to 50,000 files', () => {
        expect(SWEEP_AUTO_LIMIT).toBe(50_000)
    })

    it('allows the automatic sweep at or below the limit', () => {
        expect(decideAutoSweep(0)).toEqual({ auto: true, reason: 'within-limit' })
        expect(decideAutoSweep(SWEEP_AUTO_LIMIT)).toEqual({ auto: true, reason: 'within-limit' })
    })

    it('leaves the sweep to the button above the limit', () => {
        expect(decideAutoSweep(SWEEP_AUTO_LIMIT + 1)).toEqual({ auto: false, reason: 'over-limit' })
        expect(decideAutoSweep(383_000)).toEqual({ auto: false, reason: 'over-limit' })
    })

    it('treats an unknown count (old server, unrecognised answer) as over the limit', () => {
        expect(decideAutoSweep('unknown')).toEqual({ auto: false, reason: 'unknown-count' })
        expect(decideAutoSweep(Number.NaN)).toEqual({ auto: false, reason: 'unknown-count' })
        expect(decideAutoSweep(-1)).toEqual({ auto: false, reason: 'unknown-count' })
    })

    it('takes the limit as a parameter', () => {
        expect(decideAutoSweep(11, 10).auto).toBe(false)
        expect(decideAutoSweep(10, 10).auto).toBe(true)
    })
})
