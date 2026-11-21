/**
 * The approval question is plain text built from the call, answered once or denied, and never shown to a run
 * that was already stopped.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ asked: [] as string[], yes: true }))

vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async (text: string) => { h.asked.push(text); return h.yes }) }))

import { askToolApproval } from '../toolApproval'

const request = { tool: 'fs_write_file', url: 'internal:fs', kind: 'mutating' as const, summary: 'fs_write_file({"path":"a.txt"})' }

beforeEach(() => {
    h.asked.length = 0
    h.yes = true
})

describe('askToolApproval', () => {
    test('shows the server and the call as text and returns once on yes', async () => {
        expect(await askToolApproval(request)).toBe('once')
        expect(h.asked).toHaveLength(1)
        expect(h.asked[0]).toContain('internal:fs')
        expect(h.asked[0]).toContain('fs_write_file({"path":"a.txt"})')
    })

    test('returns deny on no', async () => {
        h.yes = false
        expect(await askToolApproval(request)).toBe('deny')
    })

    test('a summary holding replacement patterns is shown literally', async () => {
        await askToolApproval({ ...request, summary: 'x($&$1)' })
        expect(h.asked[0]).toContain('x($&$1)')
    })

    test('a stopped run is denied without a question', async () => {
        const controller = new AbortController()
        controller.abort()
        expect(await askToolApproval(request, { signal: controller.signal })).toBe('deny')
        expect(h.asked).toEqual([])
    })
})
