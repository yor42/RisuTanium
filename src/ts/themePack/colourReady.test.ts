// @vitest-environment node
// M2: the colour-ready switch (MC-3121) is pinned. An area joins it only in a PR that also changes this row, so the set can
// never grow by accident; until then every other applied area applies its judged shape variant alone, with no base.
import { describe, expect, it } from 'vitest'
import { APPLIED_AREAS } from './intake'
import { COLOUR_READY_AREAS } from './colourReady'

describe('M2 COLOUR_READY_AREAS', () => {
    it('is exactly {chat}', () => {
        expect([...COLOUR_READY_AREAS]).toEqual(['chat'])
    })

    it('names only applied areas', () => {
        for (const area of COLOUR_READY_AREAS) {
            expect(APPLIED_AREAS).toContain(area)
        }
    })
})
