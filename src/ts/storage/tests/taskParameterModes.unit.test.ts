/**
 * T-U1: the pure read rule and writers of the per-task parameter modes (#929, S1a). Unit tests of new code: they have no
 * pre-change base (the module is new); each is a mutant-checked assertion of the stated rule.
 */
import { describe, expect, test } from 'vitest'
import { effectiveTaskModes, setAllTaskModes, setTaskMode, TASK_KEYS, TASK_MODES_KEY, withoutTaskModes, type TaskModeRecord } from '../taskParameterModes'

const SAME = { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' }
const OWN = { memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' }

function record(flag: boolean | undefined, taskModes?: unknown): TaskModeRecord {
    const container: Record<string, unknown> = { memory: { temperature: 1 }, emotion: {}, translate: {}, otherAx: {}, overrides: {} }
    if (taskModes !== undefined) {
        container[TASK_MODES_KEY] = taskModes
    }
    return { seperateParametersEnabled: flag, seperateParameters: container as TaskModeRecord['seperateParameters'] }
}

describe('effectiveTaskModes: the read rule', () => {
    test('R1 no key reads the flag: on is all own, off is all same, absent is all same', () => {
        expect(effectiveTaskModes(record(true))).toEqual(OWN)
        expect(effectiveTaskModes(record(false))).toEqual(SAME)
        expect(effectiveTaskModes(record(undefined))).toEqual(SAME)
    })

    test('R2 a partial key inherits the flag for the missing tasks', () => {
        expect(effectiveTaskModes(record(true, { memory: 'own' }))).toEqual(OWN)
        expect(effectiveTaskModes(record(true, { memory: 'same', emotion: 'own' }))).toEqual({ memory: 'same', emotion: 'own', translate: 'own', otherAx: 'own' })
    })

    test('R3 an unreadable member reads as the flag and the others stay', () => {
        expect(effectiveTaskModes(record(true, { memory: 'auto', emotion: 'same', translate: 'own', otherAx: 7 }))).toEqual({ memory: 'own', emotion: 'same', translate: 'own', otherAx: 'own' })
    })

    test('R4 a non-object key or container reads as absent', () => {
        expect(effectiveTaskModes(record(true, 'x'))).toEqual(OWN)
        expect(effectiveTaskModes(record(true, ['own']))).toEqual(OWN)
        expect(effectiveTaskModes(record(false, null))).toEqual(SAME)
        expect(effectiveTaskModes({ seperateParametersEnabled: true, seperateParameters: null })).toEqual(OWN)
        expect(effectiveTaskModes({ seperateParametersEnabled: false })).toEqual(SAME)
    })

    test('R5 a flag turned off over a mix reads all same', () => {
        expect(effectiveTaskModes(record(false, { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }))).toEqual(SAME)
    })

    test('R6 a flag turned on over all same reads all own', () => {
        expect(effectiveTaskModes(record(true, SAME))).toEqual(OWN)
    })

    test('a mix agreeing with the flag is kept', () => {
        const mix = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }
        expect(effectiveTaskModes(record(true, mix))).toEqual(mix)
    })

    test('reading writes nothing', () => {
        const r = record(true, { memory: 'auto' })
        const before = JSON.stringify(r)
        effectiveTaskModes(r)
        expect(JSON.stringify(r)).toBe(before)
    })
})

describe('writers', () => {
    test('setTaskMode writes all four readable values and the flag together', () => {
        const r = record(true)
        setTaskMode(r, 'memory', 'same')
        expect(r.seperateParameters?.taskModes).toEqual({ memory: 'same', emotion: 'own', translate: 'own', otherAx: 'own' })
        expect(r.seperateParametersEnabled).toBe(true)
    })

    test('setTaskMode turns the flag on for the first own task and off with the last one', () => {
        const r = record(false)
        setTaskMode(r, 'translate', 'own')
        expect(r.seperateParametersEnabled).toBe(true)
        expect(effectiveTaskModes(r)).toEqual({ memory: 'same', emotion: 'same', translate: 'own', otherAx: 'same' })
        setTaskMode(r, 'translate', 'same')
        expect(r.seperateParametersEnabled).toBe(false)
        expect(r.seperateParameters?.taskModes).toEqual(SAME)
    })

    test('A2 setTaskMode replaces another task\'s unreadable value with the effective one', () => {
        const r = record(true, { memory: 'own', emotion: 'auto', translate: 'same', otherAx: 'own' })
        setTaskMode(r, 'memory', 'own')
        expect(r.seperateParameters?.taskModes).toEqual({ memory: 'own', emotion: 'own', translate: 'same', otherAx: 'own' })
    })

    test('setTaskMode on a flag that disagrees with a stored mix starts from the effective view', () => {
        const r = record(false, { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' })
        setTaskMode(r, 'emotion', 'own')
        expect(r.seperateParameters?.taskModes).toEqual({ memory: 'same', emotion: 'own', translate: 'same', otherAx: 'same' })
        expect(r.seperateParametersEnabled).toBe(true)
    })

    test('the writers give the modes a new object and leave the blocks as they were', () => {
        const r = record(true)
        const memory = r.seperateParameters?.memory
        const before = { ...r.seperateParameters }
        setTaskMode(r, 'emotion', 'same')
        expect(r.seperateParameters?.memory).toBe(memory)
        expect(r.seperateParameters?.overrides).toBe(before.overrides)
    })

    test('a record without a container gets the five empty members first', () => {
        const r: TaskModeRecord = {}
        setTaskMode(r, 'memory', 'own')
        expect(r.seperateParameters).toEqual({ memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {}, taskModes: { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' } })
        expect(r.seperateParametersEnabled).toBe(true)
    })

    test('R4 a null container is replaced by the five empty members', () => {
        const r: TaskModeRecord = { seperateParametersEnabled: true, seperateParameters: null }
        setAllTaskModes(r, 'same')
        expect(r.seperateParameters).toEqual({ memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {}, taskModes: SAME })
        expect(r.seperateParametersEnabled).toBe(false)
    })

    test('setAllTaskModes writes all four modes and the flag', () => {
        const r = record(false)
        setAllTaskModes(r, 'own')
        expect(r.seperateParameters?.taskModes).toEqual(OWN)
        expect(r.seperateParametersEnabled).toBe(true)
        setAllTaskModes(r, 'same')
        expect(r.seperateParameters?.taskModes).toEqual(SAME)
        expect(r.seperateParametersEnabled).toBe(false)
    })

    test('every writer leaves the flag equal to "some task is own"', () => {
        for (const task of TASK_KEYS) {
            for (const start of [true, false]) {
                for (const mode of ['same', 'own'] as const) {
                    const r = record(start)
                    setTaskMode(r, task, mode)
                    expect(r.seperateParametersEnabled).toBe(Object.values(effectiveTaskModes(r)).includes('own'))
                    expect(r.seperateParametersEnabled).toBe(Object.values(r.seperateParameters?.taskModes ?? {}).includes('own'))
                }
            }
        }
    })
})

describe('withoutTaskModes', () => {
    test('a record whose container holds the key becomes a new record with a new container without it; the input is untouched', () => {
        const input = { name: 'p', seperateParametersEnabled: true, seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {}, taskModes: { ...OWN } } }
        const before = JSON.stringify(input)
        const out = withoutTaskModes(input)
        expect(out).not.toBe(input)
        expect(out.seperateParameters).not.toBe(input.seperateParameters)
        expect(out.seperateParameters).not.toHaveProperty('taskModes')
        expect(out.seperateParameters.memory).toBe(input.seperateParameters.memory)
        expect(out.name).toBe('p')
        expect(JSON.stringify(input)).toBe(before)
    })

    test('a record without the key keeps the same object', () => {
        const noKey = { seperateParameters: { memory: {}, overrides: {} } }
        expect(withoutTaskModes(noKey)).toBe(noKey)
        const noContainer = { name: 'x' }
        expect(withoutTaskModes(noContainer)).toBe(noContainer)
        const nullContainer = { seperateParameters: null }
        expect(withoutTaskModes(nullContainer)).toBe(nullContainer)
    })

    test('a non-object record is returned as it is', () => {
        expect(withoutTaskModes(null as unknown as object)).toBeNull()
    })
})
