import { describe, expect, test } from 'vitest'
import { newToolLoop, reportToolStep, summarizeToolArgs, TOOL_STEP_SUMMARY_MAX, type ToolStep, type ToolStepOutcome } from '../toolLoop'

/** The step hook of the tool loop state: one event per call outcome, a short plain summary, and a hook that cannot break the loop. */

describe('reportToolStep', () => {
    test('each outcome reaches the hook with the tool name and the argument summary', () => {
        const steps: ToolStep[] = []
        const state = newToolLoop(null)
        state.onStep = (step) => { steps.push(step) }
        const outcomes: ToolStepOutcome[] = ['ran', 'denied', 'refused', 'error', 'stopped']

        for (const outcome of outcomes) {
            reportToolStep(state, 'write_file', { path: 'a.md' }, outcome)
        }

        expect(steps).toEqual(outcomes.map(outcome => ({ name: 'write_file', summary: 'a.md', outcome })))
    })

    test('a hook that throws is caught and the next step is still delivered', () => {
        const seen: string[] = []
        const state = newToolLoop(null)
        let first = true
        state.onStep = (step) => {
            if (first) {
                first = false
                throw new Error('boom')
            }
            seen.push(step.outcome)
        }

        expect(() => reportToolStep(state, 'x', {}, 'ran')).not.toThrow()
        reportToolStep(state, 'x', {}, 'denied')

        expect(seen).toEqual(['denied'])
    })

    test('(R) bidi controls in the tool name are shown escaped', () => {
        const steps: ToolStep[] = []
        const state = newToolLoop(null)
        state.onStep = (step) => { steps.push(step) }

        reportToolStep(state, 'x' + String.fromCharCode(0x202E) + 'evil', {}, 'refused')

        expect(steps[0].name).toBe('x\\u202eevil')
    })

    test('a state without a hook, and no state at all, ignore the step', () => {
        expect(() => reportToolStep(newToolLoop(null), 'x', {}, 'ran')).not.toThrow()
        expect(() => reportToolStep(undefined, 'x', {}, 'ran')).not.toThrow()
    })
})

describe('summarizeToolArgs', () => {
    test('a path argument is the summary, a move names both ends', () => {
        expect(summarizeToolArgs({ path: 'notes/a.md', text: 'long body' })).toBe('notes/a.md')
        expect(summarizeToolArgs({ from: 'a.md', to: 'b.md' })).toBe('a.md -> b.md')
    })

    test('(R) bidi controls in a path or a move end are shown escaped', () => {
        const rlo = String.fromCharCode(0x202E)
        expect(summarizeToolArgs({ path: `a${rlo}/x/SKILL.md` })).toBe('a\\u202e/x/SKILL.md')
        expect(summarizeToolArgs({ from: `a${rlo}b`, to: 'c' })).toBe('a\\u202eb -> c')
    })

    test('other arguments become compact JSON, cut on code points', () => {
        expect(summarizeToolArgs({ q: 1 })).toBe('{"q":1}')
        const long = summarizeToolArgs({ path: '\u{1F600}'.repeat(TOOL_STEP_SUMMARY_MAX + 5) })
        expect(Array.from(long)).toHaveLength(TOOL_STEP_SUMMARY_MAX + 3)
        expect(long.endsWith('...')).toBe(true)
    })

    test('unserializable and absent arguments give text, never a throw', () => {
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(summarizeToolArgs(cyclic)).toBe('')
        expect(summarizeToolArgs(undefined)).toBe('')
        expect(summarizeToolArgs(null)).toBe('null')
    })
})
