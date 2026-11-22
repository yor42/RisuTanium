/**
 * The approval question is plain text built from the call, answered once or denied, and never shown to a run
 * that was already stopped.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ asked: [] as string[], yes: true, structured: [] as unknown[], decision: 'always' as 'once' | 'always' | 'deny' }))

vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async (text: string) => { h.asked.push(text); return h.yes }),
    alertToolApproval: vi.fn(async (view: unknown) => { h.structured.push(view); return h.decision }),
}))

import { askToolApproval } from '../toolApproval'

const request = { tool: 'fs_write_file', url: 'internal:fs', kind: 'mutating' as const, summary: 'fs_write_file({"path":"a.txt"})' }

beforeEach(() => {
    h.asked.length = 0
    h.structured.length = 0
    h.yes = true
    h.decision = 'always'
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

    test('a request with a view goes to the structured dialog with the server and the call, and its decision is returned as it is', async () => {
        const view = { action: [{ text: 'delete (' }, { text: 'a.txt', path: true }, { text: ')' }], instructionTarget: false, replacement: null, offerAlways: true }
        expect(await askToolApproval({ ...request, view })).toBe('always')
        expect(h.structured).toEqual([{ server: 'internal:fs', summary: request.summary, ...view }])
        expect(h.asked).toEqual([])
    })

    test('a request with a view is not shown to a run that was already stopped', async () => {
        const controller = new AbortController()
        controller.abort()
        const view = { action: [], instructionTarget: false, replacement: null, offerAlways: true }
        expect(await askToolApproval({ ...request, view }, { signal: controller.signal })).toBe('deny')
        expect(h.structured).toEqual([])
    })

    test('a stopped run is denied without a question', async () => {
        const controller = new AbortController()
        controller.abort()
        expect(await askToolApproval(request, { signal: controller.signal })).toBe('deny')
        expect(h.asked).toEqual([])
    })
})
