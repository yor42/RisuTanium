import { describe, expect, test } from 'vitest'
import { createStreamCadence, nextStreamCadence, STREAM_CONTAINMENT } from './streamCadence'

describe('stream cadence', () => {
    test('backs off after slow renders and recovers after five fast renders', () => {
        const cadence = createStreamCadence()
        expect(cadence.interval).toBe(100)
        expect(cadence.record(9)).toBe(250)
        expect(cadence.record(9)).toBe(500)
        for (let i = 0; i < 4; i++) expect(cadence.record(8)).toBe(500)
        expect(cadence.record(8)).toBe(100)
        cadence.reset()
        expect(cadence.interval).toBe(100)
    })

    test('low power has a 250 ms floor', () => {
        const cadence = createStreamCadence(true)
        expect(cadence.interval).toBe(250)
        expect(cadence.record(9)).toBe(500)
        for (let i = 0; i < 5; i++) cadence.record(1)
        expect(cadence.interval).toBe(250)
        expect(nextStreamCadence({ interval: 100, fastRenders: 0 }, 1, true).interval).toBe(250)
    })

    test('containment data excludes the newest three and retains measured height', () => {
        expect(STREAM_CONTAINMENT).toEqual({
            newestUncontained: 3,
            contentVisibility: 'auto',
            containIntrinsicSize: 'last-measured-height',
        })
    })
})
