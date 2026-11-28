/**
 * Request resolution of the per-task parameter modes (#929, S1a), driven through the real `applyParameters`.
 * Only `getDatabase` is mocked, so the values a request would send are read from the real resolution code.
 *
 * Every source carries one distinct number (main 70, memory 11, emotion 12, translate 13, otherAx 14, the model override
 * 21), so the data names which source a request used.
 *
 * Classes: tests titled `reproducer:` fail on the pre-change base (it ignores the mode key inside the container);
 * tests titled `guard:` pass before and after (compatibility guards).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ModelModeExtended } from '../shared'

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db }))

import { applyParameters } from '../shared'

const MODEL_ID = 'test-model'
const PARAMS = ['temperature', 'top_k', 'frequency_penalty', 'thinking_tokens'] as const
const MODES: ModelModeExtended[] = ['model', 'submodel', 'memory', 'emotion', 'translate', 'otherAx']
const TASKS = ['memory', 'emotion', 'translate', 'otherAx'] as const
const BLOCK_VALUE = { memory: 11, emotion: 12, translate: 13, otherAx: 14 }
const MAIN = 70
const OVERRIDE = 21

function mainFields() {
    return { temperature: MAIN, top_k: MAIN, frequencyPenalty: MAIN, thinkingTokens: MAIN }
}

function block(n: number) {
    return { temperature: n, top_k: n, frequency_penalty: n, thinking_tokens: n }
}

function dataFor(n: number | 'empty') {
    return n === 'empty' ? {} : { temperature: n / 100, top_k: n, frequency_penalty: n / 100, thinking_tokens: n }
}

interface Setup {
    flag: boolean
    blocks: 'empty' | 'full'
    byModel: boolean
    override: boolean
    taskModes?: unknown
}

function install(s: Setup) {
    const container: Record<string, unknown> = {
        memory: s.blocks === 'full' ? block(BLOCK_VALUE.memory) : {},
        emotion: s.blocks === 'full' ? block(BLOCK_VALUE.emotion) : {},
        translate: s.blocks === 'full' ? block(BLOCK_VALUE.translate) : {},
        otherAx: s.blocks === 'full' ? block(BLOCK_VALUE.otherAx) : {},
        overrides: s.override ? { [MODEL_ID]: block(OVERRIDE) } : {},
    }
    if (s.taskModes !== undefined) {
        container.taskModes = s.taskModes
    }
    h.db = {
        ...mainFields(),
        seperateParametersEnabled: s.flag,
        seperateParametersByModel: s.byModel,
        seperateParameters: container,
    }
}

function send(mode: ModelModeExtended): Record<string, unknown> {
    return applyParameters({}, [...PARAMS], {}, mode, { modelId: MODEL_ID })
}

beforeEach(() => {
    h.db = {}
})

/** What the base sent for a record whose every task reads as the flag says (written from the census table, not from the code). */
function expectedUnmigrated(s: Setup, mode: ModelModeExtended): Record<string, unknown> | 'throws' {
    if (!s.flag) {
        return dataFor(MAIN)
    }
    const blockOf = (n: number) => dataFor(s.blocks === 'full' ? n : 'empty')
    if (mode === 'model') {
        if (!s.byModel) {
            return dataFor(MAIN)
        }
        return s.override ? dataFor(OVERRIDE) : 'throws'
    }
    if (s.byModel && !s.override) {
        return 'throws'
    }
    if (mode === 'submodel') {
        return blockOf(BLOCK_VALUE.otherAx)
    }
    return s.byModel ? dataFor(OVERRIDE) : blockOf(BLOCK_VALUE[mode])
}

describe('T-C1 the 16 migration cells send what the base sent', () => {
    for (const flag of [false, true]) {
        for (const blocks of ['empty', 'full'] as const) {
            for (const byModel of [false, true]) {
                for (const override of [true, false]) {
                    const s: Setup = { flag, blocks, byModel, override }
                    for (const keyed of [false, true]) {
                        for (const mode of MODES) {
                            test(`guard: flag ${flag} blocks ${blocks} byModel ${byModel} override ${override} ${keyed ? 'key all-agreeing' : 'no key'} ${mode}`, () => {
                                const all = flag ? 'own' : 'same'
                                install({ ...s, taskModes: keyed ? { memory: all, emotion: all, translate: all, otherAx: all } : undefined })
                                const expected = expectedUnmigrated(s, mode)
                                if (expected === 'throws') {
                                    expect(() => send(mode)).toThrow()
                                } else {
                                    expect(send(mode)).toEqual(expected)
                                }
                            })
                        }
                    }
                }
            }
        }
    }
})

describe('T-R1 a mix: a same task sends the main values', () => {
    const mix = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

    test('reproducer: memory sends its block, emotion, translate and other send the main values', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: mix })
        expect(send('memory')).toEqual(dataFor(BLOCK_VALUE.memory))
        expect(send('emotion')).toEqual(dataFor(MAIN))
        expect(send('translate')).toEqual(dataFor(MAIN))
        expect(send('otherAx')).toEqual(dataFor(MAIN))
    })

    test('reproducer: every task own but translate keeps translate on the main values', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'own', emotion: 'own', translate: 'same', otherAx: 'own' } })
        expect(send('emotion')).toEqual(dataFor(BLOCK_VALUE.emotion))
        expect(send('translate')).toEqual(dataFor(MAIN))
    })

    test('guard: by-model keeps its override for a same task', () => {
        install({ flag: true, blocks: 'full', byModel: true, override: true, taskModes: mix })
        expect(send('emotion')).toEqual(dataFor(OVERRIDE))
        expect(send('memory')).toEqual(dataFor(OVERRIDE))
    })

    test('guard: by-model with no override entry still throws for a same task', () => {
        install({ flag: true, blocks: 'full', byModel: true, override: false, taskModes: mix })
        expect(() => send('emotion')).toThrow()
        expect(() => send('submodel')).toThrow()
    })

    test('guard: the main model is never read from a block while by-model is off', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: mix })
        expect(send('model')).toEqual(dataFor(MAIN))
    })
})

describe('T-R2 the sub-model follows other', () => {
    test('reproducer: other same sends the main values for the sub-model although memory is own', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' } })
        expect(send('submodel')).toEqual(dataFor(MAIN))
    })

    test('reproducer: other own sends the other block for the sub-model, memory same stays on main', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'own' } })
        expect(send('submodel')).toEqual(dataFor(BLOCK_VALUE.otherAx))
        expect(send('memory')).toEqual(dataFor(MAIN))
    })
})

describe('T-R3 a flag the modes disagree with wins', () => {
    test('guard: flag off over a stored mix sends the main values everywhere', () => {
        install({ flag: false, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' } })
        for (const mode of MODES) {
            expect(send(mode)).toEqual(dataFor(MAIN))
        }
    })

    test('guard: flag on over a stored all-same sends every block', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' } })
        for (const task of TASKS) {
            expect(send(task)).toEqual(dataFor(BLOCK_VALUE[task]))
        }
    })

    test('reproducer: an unreadable mode falls back to the flag (own) while a readable one is kept', () => {
        install({ flag: true, blocks: 'full', byModel: false, override: true, taskModes: { memory: 'auto', emotion: 'same', translate: 'own', otherAx: 'own' } })
        expect(send('memory')).toEqual(dataFor(BLOCK_VALUE.memory))
        expect(send('emotion')).toEqual(dataFor(MAIN))
        expect(send('translate')).toEqual(dataFor(BLOCK_VALUE.translate))
    })
})
