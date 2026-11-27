// @vitest-environment node
// F10a: the fallback tail builder has no catch of its own, so a failing declaration walk reaches the caller (apply.ts then applies no sheet).
// This file mocks ./csslit for that reason and holds no other test.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./csslit', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./csslit')>()
    return { ...actual, decls: () => { throw new Error('decls failed') } }
})

import { fallbackTail } from './effectsFallback'

describe('F10a fallbackTail propagates a failure (GUARD: no pre-change seam exists)', () => {
    it('throws when the declaration walk throws, and never answers an empty tail', () => {
        expect(() => fallbackTail('[data-part="chat-message-avatar"]{transition:opacity 1s}')).toThrow('decls failed')
    })
})
