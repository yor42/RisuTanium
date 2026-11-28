/**
 * #929 S1b units of the pure translation: the copy rule (`mainValuesAsBlock`), rule P (`representable`) and the per-record
 * translation (`translateTaskParameters`). All are unit tests of new code: they would fail to import on the pre-change base,
 * so they carry no regression claim; the behaviour on the real exports is in the export and preset-file tests.
 */
import { describe, expect, test } from 'vitest'
import { BLOCK_PARAMETERS, mainValuesAsBlock, representable, translateTaskParameters, TASK_MODES_KEY, type MainValueFields, type TaskModeRecord } from '../taskParameterModes'

const MAIN: MainValueFields = { temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequencyPenalty: 30, PresensePenalty: 31, reasoningEffort: 2, thinkingTokens: 2048, verbosity: 2 }

describe('mainValuesAsBlock (copy rule)', () => {
    test('exactly the eleven block-path keys, renamed from their main fields, and no display-only member', () => {
        const block = mainValuesAsBlock({ ...MAIN, thinkingType: 'adaptive' } as MainValueFields, 'working')

        expect(Object.keys(block).sort()).toEqual([...BLOCK_PARAMETERS].sort())
        expect(block).toEqual({ temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequency_penalty: 30, presence_penalty: 31, reasoning_effort: 2, thinking_tokens: 2048, verbosity: 2 })
        expect(block).not.toHaveProperty('thinking_type')
        expect(block).not.toHaveProperty('outputImageModal')
    })

    test('null is copied verbatim and an absent value stays absent', () => {
        const block = mainValuesAsBlock({ temperature: 80, thinkingTokens: null as unknown as number }, 'working')

        expect(block).toEqual({ temperature: 80, thinking_tokens: null })
        expect(Object.hasOwn(block, 'top_k')).toBe(false)
        expect(Object.hasOwn(block, 'verbosity')).toBe(false)
    })

    test('a working database reads `reasoningEffort`, a slot reads `reasonEffort`', () => {
        expect(mainValuesAsBlock({ reasoningEffort: 3, reasonEffort: 1 }, 'working').reasoning_effort).toBe(3)
        expect(mainValuesAsBlock({ reasoningEffort: 3, reasonEffort: 1 }, 'slot').reasoning_effort).toBe(1)
    })

    test('a slot applies the constant fallbacks setPreset applies and leaves the working-value fallbacks absent', () => {
        const block = mainValuesAsBlock({ temperature: 70 }, 'slot')

        expect(block).toEqual({ temperature: 70, top_p: 1, reasoning_effort: 0, thinking_tokens: null, verbosity: 1 })
    })

    test('every call returns a new object', () => {
        expect(mainValuesAsBlock(MAIN, 'working')).not.toBe(mainValuesAsBlock(MAIN, 'working'))
    })
})

describe('representable (rule P, the table of the main-versus-block comparison)', () => {
    test('finite numbers and -1000 are representable for every parameter', () => {
        for (const parameter of BLOCK_PARAMETERS) {
            for (const value of [0, 5, -1000, 1.5]) {
                expect(representable(parameter, value)).toBe(true)
            }
        }
    })

    test('null is representable only where both paths scale it, and for the two mapped parameters', () => {
        const nullOk = BLOCK_PARAMETERS.filter((parameter) => representable(parameter, null))

        expect(nullOk).toEqual(['temperature', 'frequency_penalty', 'presence_penalty', 'reasoning_effort', 'verbosity'])
    })

    test('NaN and an absent value are unrepresentable except for the two mapped parameters', () => {
        const nanOk = BLOCK_PARAMETERS.filter((parameter) => representable(parameter, Number.NaN))
        const absentOk = BLOCK_PARAMETERS.filter((parameter) => representable(parameter, undefined))

        expect(nanOk).toEqual(['reasoning_effort', 'verbosity'])
        expect(absentOk).toEqual(['reasoning_effort', 'verbosity'])
    })
})

describe('translateTaskParameters', () => {
    function record(over: Partial<TaskModeRecord & MainValueFields> & Record<string, unknown> = {}) {
        return {
            ...MAIN,
            seperateParametersEnabled: true,
            seperateParameters: { memory: { temperature: 11 }, emotion: { temperature: 12 }, translate: {}, otherAx: {}, overrides: { m: { temperature: 5 } }, [TASK_MODES_KEY]: { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' } },
            ...over,
        } as TaskModeRecord & MainValueFields
    }

    test('flag on: the same tasks become copies, the own task, overrides and flag are untouched, the key is gone', () => {
        const out = translateTaskParameters(record(), 'working')

        expect(out.record.seperateParametersEnabled).toBe(true)
        expect(out.record.seperateParameters).toEqual({
            memory: { temperature: 11 },
            emotion: mainValuesAsBlock(MAIN, 'working'),
            translate: mainValuesAsBlock(MAIN, 'working'),
            otherAx: mainValuesAsBlock(MAIN, 'working'),
            overrides: { m: { temperature: 5 } },
        })
    })

    test('the input is never changed and the copies are new objects', () => {
        const input = record()
        const before = JSON.stringify(input)

        const out = translateTaskParameters(input, 'working')

        expect(JSON.stringify(input)).toBe(before)
        expect(out.record).not.toBe(input)
        expect(out.record.seperateParameters).not.toBe(input.seperateParameters)
        expect(out.record.seperateParameters.emotion).not.toBe(out.record.seperateParameters.translate)
    })

    test('flag off: only the key is removed, nothing is copied or listed', () => {
        const input = record({ seperateParametersEnabled: false })

        const out = translateTaskParameters(input, 'working')

        expect(out.leftOut).toEqual([])
        expect(out.record.seperateParameters).toEqual({ memory: { temperature: 11 }, emotion: { temperature: 12 }, translate: {}, otherAx: {}, overrides: { m: { temperature: 5 } } })
    })

    test('R16: flag on with a raw all-same key reads all own, so nothing is synthesized', () => {
        const input = record()
        ;(input.seperateParameters as Record<string, unknown>)[TASK_MODES_KEY] = { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' }

        const out = translateTaskParameters(input, 'working')

        expect(out.leftOut).toEqual([])
        expect(out.record.seperateParameters).toEqual({ memory: { temperature: 11 }, emotion: { temperature: 12 }, translate: {}, otherAx: {}, overrides: { m: { temperature: 5 } } })
    })

    test('a keyless flag-on record is returned as the same object', () => {
        const input = record()
        delete (input.seperateParameters as Record<string, unknown>)[TASK_MODES_KEY]

        expect(translateTaskParameters(input, 'working').record).toBe(input)
    })

    test('leftOut names unrepresentable main values per same task, and a differing non-empty stored block, in task order', () => {
        const out = translateTaskParameters(record({ thinkingTokens: null as unknown as number }), 'working')

        expect(out.leftOut).toEqual([
            { task: 'emotion', parameter: 'thinking_tokens' },
            { task: 'emotion', parameter: 'replacedBlock' },
            { task: 'translate', parameter: 'thinking_tokens' },
            { task: 'otherAx', parameter: 'thinking_tokens' },
        ])
    })

    test('a stored block equal to the copy and an empty stored block give no replaced-block entry', () => {
        const input = record()
        const container = input.seperateParameters as Record<string, unknown>
        container.emotion = mainValuesAsBlock(MAIN, 'working')

        expect(translateTaskParameters(input, 'working').leftOut).toEqual([])
    })

    test('a stored block with an extra member differs from the copy', () => {
        const input = record()
        const container = input.seperateParameters as Record<string, unknown>
        container.emotion = { ...mainValuesAsBlock(MAIN, 'working'), thinking_type: 'budget' }

        expect(translateTaskParameters(input, 'working').leftOut).toEqual([{ task: 'emotion', parameter: 'replacedBlock' }])
    })

    test('a record that is not an object is returned as it is', () => {
        expect(translateTaskParameters(null as unknown as TaskModeRecord, 'slot').record).toBeNull()
    })
})
