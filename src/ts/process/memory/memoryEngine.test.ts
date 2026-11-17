/**
 * The engine choice is derived from five existing database fields, never
 * stored. `memoryEngineOf` must read them the way the chat runtime dispatches
 * (truthiness, in the runtime's precedence order); `setMemoryEngine` must write
 * the select's five-value table every time.
 */

import { describe, expect, test } from 'vitest'
import { memoryEngineOf, setMemoryEngine, type MemoryEngine } from './memoryEngine'

type Flag = boolean | number | undefined
type EngineDb = Parameters<typeof memoryEngineOf>[0]

function dbOf(hanuraiEnable: Flag, hypav2: Flag, hypaV3: Flag, supaModelType: string | undefined): EngineDb {
    return { hanuraiEnable, hypav2, hypaV3, supaModelType } as unknown as EngineDb
}

// Oracle: the dispatch branches of the chat runtime, in order, by truthiness.
function runtimeEngine(hanurai: Flag, v2: Flag, v3: Flag, supa: string | undefined): MemoryEngine {
    const branches: [Flag | boolean, MemoryEngine][] = [
        [hanurai, 'hanuraiMemory'],
        [v2, 'hypaV2'],
        [v3, 'hypaV3'],
        [supa !== 'none', 'supaMemory'],
    ]
    for (const [taken, engine] of branches) {
        if (taken) return engine
    }
    return 'none'
}

describe('memoryEngineOf', () => {
    const flags: Flag[] = [true, false, undefined, 1]
    const supaTypes: (string | undefined)[] = ['none', 'distilbart', 'subModel', 'instruct35', undefined]
    const cases: [Flag, Flag, Flag, string | undefined][] = []
    for (const a of flags) for (const b of flags) for (const c of flags) for (const d of supaTypes) {
        cases.push([a, b, c, d])
    }

    test('new rule: matches the runtime dispatch for every flag combination', () => {
        expect(cases).toHaveLength(320)
        for (const [a, b, c, d] of cases) {
            expect(memoryEngineOf(dbOf(a, b, c, d)), JSON.stringify([a, b, c, d])).toBe(runtimeEngine(a, b, c, d))
        }
    })

    test('new rule: a truthy non-boolean flag selects its engine', () => {
        expect(memoryEngineOf(dbOf(false, 1, false, 'none'))).toBe('hypaV2')
    })

    test('new rule: an undefined summary model reads as SupaMemory', () => {
        expect(memoryEngineOf(dbOf(false, false, false, undefined))).toBe('supaMemory')
    })
})

describe('setMemoryEngine', () => {
    const table: Record<MemoryEngine, { supaModelType: string, memoryAlgorithmType: string, hypav2: boolean, hanuraiEnable: boolean, hypaV3: boolean }> = {
        none: { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false },
        supaMemory: { supaModelType: 'distilbart', memoryAlgorithmType: 'supaMemory', hypav2: false, hanuraiEnable: false, hypaV3: false },
        hypaV2: { supaModelType: 'distilbart', memoryAlgorithmType: 'hypaMemoryV2', hypav2: true, hanuraiEnable: false, hypaV3: false },
        hanuraiMemory: { supaModelType: 'none', memoryAlgorithmType: 'hanuraiMemory', hypav2: false, hanuraiEnable: true, hypaV3: false },
        hypaV3: { supaModelType: 'none', memoryAlgorithmType: 'hypaMemoryV3', hypav2: false, hanuraiEnable: false, hypaV3: true },
    }
    const engines = Object.keys(table) as MemoryEngine[]
    const starts = [
        { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false },
        { supaModelType: 'subModel', memoryAlgorithmType: 'hypaMemoryV2', hypav2: true, hanuraiEnable: true, hypaV3: true },
        { supaModelType: 'instruct35', memoryAlgorithmType: 'x', hypav2: false, hanuraiEnable: true, hypaV3: false },
        { supaModelType: 'distilbart', memoryAlgorithmType: 'hypaMemoryV3', hypav2: false, hanuraiEnable: false, hypaV3: true },
    ]

    test.each(engines)('new rule: choosing %s writes the five-value table from any start', (engine) => {
        for (const start of starts) {
            const db = { ...start }
            setMemoryEngine(db, engine)
            expect(db).toEqual(table[engine])
            expect(memoryEngineOf(db)).toBe(engine)
        }
    })
})
