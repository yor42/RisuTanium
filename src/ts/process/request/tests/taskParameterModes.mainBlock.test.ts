import { describe, expect, test, vi } from 'vitest'
import type { LLMParameter } from '../shared'

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db }))

import { applyParameters } from '../shared'
import { representable, type BlockParameter } from 'src/ts/storage/taskParameterModes'

const KEYS: { parameter: LLMParameter, main: string, finite: number }[] = [
    { parameter: 'temperature', main: 'temperature', finite: 80 },
    { parameter: 'top_k', main: 'top_k', finite: 40 },
    { parameter: 'repetition_penalty', main: 'repetition_penalty', finite: 1.1 },
    { parameter: 'min_p', main: 'min_p', finite: 0.1 },
    { parameter: 'top_a', main: 'top_a', finite: 0.2 },
    { parameter: 'top_p', main: 'top_p', finite: 0.9 },
    { parameter: 'frequency_penalty', main: 'frequencyPenalty', finite: 30 },
    { parameter: 'presence_penalty', main: 'PresensePenalty', finite: 30 },
    { parameter: 'reasoning_effort', main: 'reasoningEffort', finite: 2 },
    { parameter: 'thinking_tokens', main: 'thinkingTokens', finite: 2048 },
    { parameter: 'verbosity', main: 'verbosity', finite: 2 },
]
const VALUES: { label: string, value: number | null | undefined }[] = [
    { label: 'finite', value: undefined },
    { label: '0', value: 0 },
    { label: '-1000', value: -1000 },
    { label: 'null', value: null },
    { label: 'NaN', value: NaN },
    { label: 'undefined', value: undefined },
]

function sendMain(main: string, value: number | null | undefined): Record<string, unknown> {
    h.db = { seperateParametersEnabled: false, seperateParametersByModel: false, [main]: value }
    return applyParameters({}, [KEYS.find((key) => key.main === main)!.parameter], {}, 'memory', { modelId: 'm' })
}

function sendBlock(parameter: string, value: number | null | undefined): Record<string, unknown> {
    const block: Record<string, number | null> = {}
    if (value !== undefined) {
        block[parameter] = value
    }
    h.db = {
        seperateParametersEnabled: true,
        seperateParametersByModel: false,
        seperateParameters: { memory: block, emotion: {}, translate: {}, otherAx: {}, overrides: {}, taskModes: { memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' } },
    }
    return applyParameters({}, [parameter as LLMParameter], {}, 'memory', { modelId: 'm' })
}

/** An own key with an undefined value differs from an absent key. */
function sameData(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    return ka.length === kb.length && ka.every((key, i) => key === kb[i] && Object.is(a[key], b[key]))
}

/**
 * T-D1: for each of the eleven block-path keys and each value, the data the main path returns equals the data the block path
 * returns exactly when `representable` says so. The comparison is strict and data-only: an own `undefined` key differs from an
 * absent one. First a diagnostic of the pre-S1b code, now a guard: `representable` is this table, so a change to either
 * resolution path that moves a cell fails here.
 */
describe('T-D1 main path versus block path of applyParameters', () => {
    for (const key of KEYS) {
        for (const entry of VALUES) {
            test(`guard: ${key.parameter} ${entry.label}`, () => {
                const value = entry.label === 'finite' ? key.finite : entry.value
                const same = sameData(sendMain(key.main, value), sendBlock(key.parameter, value))
                expect(representable(key.parameter as BlockParameter, value)).toBe(same)
            })
        }
    }

    test('guard: the table has the two unrepresentable families the plan predicted', () => {
        expect(representable('thinking_tokens', null)).toBe(false)
        expect(representable('temperature', null)).toBe(true)
        expect(representable('reasoning_effort', undefined)).toBe(true)
        expect(representable('top_k', Number.NaN)).toBe(false)
    })
})
