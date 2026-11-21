// @vitest-environment node
// S41A-R1: A_tok(area) builds the pack-settable test once per area, not once per candidate name. The counter wraps
// settableTest and passes through, so every verdict is the real one. This file stands alone because the mock is file-wide.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('./failclosed', async (importOriginal) => {
    const real = await importOriginal<typeof import('./failclosed')>()
    return { ...real, settableTest: (reg: Parameters<typeof real.settableTest>[0]) => { calls.n += 1; return real.settableTest(reg) } }
})

// A fresh module graph per case: the per-area cache must be empty, or the count would be 0 for the wrong reason.
beforeEach(() => { vi.resetModules() })

describe('S41A-R1: A_tok builds the pack-settable test once per area', () => {
    it.each(['studio', 'chat'] as const)('%s', async (area) => {
        const names = await import('./appThemeNames')
        calls.n = 0
        names.allowedTokenNames(area)
        expect(calls.n).toBe(1)
    })

    it('a second call of the same area reuses the cached set and builds nothing', async () => {
        const names = await import('./appThemeNames')
        names.allowedTokenNames('studio')
        calls.n = 0
        names.allowedTokenNames('studio')
        expect(calls.n).toBe(0)
    })
})
