/**
 * The engine choice is derived from the legacy engine fields plus the
 * fork-only `ltmEngine` flag, never stored. `memoryEngineOf` must read them the
 * way the chat runtime dispatches (truthiness, in the runtime's precedence
 * order, ChroMemory first only for the strict boolean `true`); `setMemoryEngine`
 * must write the select's table every time.
 */

import { describe, expect, test } from 'vitest'
import {
    alwaysToggleOnApplies,
    chroMemoryOn,
    chroMemoryModeOf,
    chroMemoryShadowRuns,
    legacyEngineFields,
    memoryEngineOf,
    memoryTakesChatsOf,
    setMemoryEngine,
    showsMemoryToggle,
    type MemoryEngine,
} from './memoryEngine'

type Flag = boolean | number | undefined
type EngineDb = Parameters<typeof memoryEngineOf>[0]

function dbOf(hanuraiEnable: Flag, hypav2: Flag, hypaV3: Flag, supaModelType: string | undefined, ltmEngine?: unknown): EngineDb {
    const db = { hanuraiEnable, hypav2, hypaV3, supaModelType } as Record<string, unknown>
    if (ltmEngine !== undefined) db.ltmEngine = ltmEngine
    return db as unknown as EngineDb
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

const flags: Flag[] = [true, false, undefined, 1]
const supaTypes: (string | undefined)[] = ['none', 'distilbart', 'subModel', 'instruct35', undefined]
const cases: [Flag, Flag, Flag, string | undefined][] = []
for (const a of flags) for (const b of flags) for (const c of flags) for (const d of supaTypes) {
    cases.push([a, b, c, d])
}
const legacyOffValues: unknown[] = [undefined, false]
const notStrictTrue: unknown[] = [1, 'true', {}]

describe('memoryEngineOf', () => {
    test('guard: matches the runtime dispatch for every flag combination while ChroMemory is off', () => {
        expect(cases).toHaveLength(320)
        for (const off of legacyOffValues) {
            for (const [a, b, c, d] of cases) {
                expect(memoryEngineOf(dbOf(a, b, c, d, off)), JSON.stringify([a, b, c, d, off])).toBe(runtimeEngine(a, b, c, d))
            }
        }
    })

    test('reproducer: ChroMemory wins over every legacy flag combination', () => {
        for (const [a, b, c, d] of cases) {
            expect(memoryEngineOf(dbOf(a, b, c, d, true)), JSON.stringify([a, b, c, d])).toBe('chroMemory')
        }
    })

    test('new rule: only the boolean true selects ChroMemory', () => {
        for (const bad of notStrictTrue) {
            for (const [a, b, c, d] of cases) {
                expect(memoryEngineOf(dbOf(a, b, c, d, bad)), JSON.stringify([a, b, c, d, bad])).toBe(runtimeEngine(a, b, c, d))
            }
            expect(chroMemoryOn({ ltmEngine: bad } as never)).toBe(false)
        }
        expect(chroMemoryOn({ ltmEngine: true })).toBe(true)
    })

    test('new rule: a truthy non-boolean flag selects its engine', () => {
        expect(memoryEngineOf(dbOf(false, 1, false, 'none'))).toBe('hypaV2')
    })

    test('new rule: an undefined summary model reads as SupaMemory', () => {
        expect(memoryEngineOf(dbOf(false, false, false, undefined))).toBe('supaMemory')
    })
})

describe('memory dispatch predicates', () => {
    // Oracle: the expression the dispatcher used before ChroMemory existed.
    const legacyTakes = (db: EngineDb, on: boolean) => on && (db.supaModelType !== 'none' || !!db.hanuraiEnable || !!db.hypav2 || !!db.hypaV3)

    test('new rule: memoryTakesChatsOf equals the legacy expression while off and is false for ChroMemory', () => {
        for (const on of [true, false]) {
            for (const [a, b, c, d] of cases) {
                for (const off of legacyOffValues) {
                    const db = dbOf(a, b, c, d, off)
                    expect(memoryTakesChatsOf(db, on), JSON.stringify([a, b, c, d, off, on])).toBe(Boolean(legacyTakes(db, on)))
                }
                expect(memoryTakesChatsOf(dbOf(a, b, c, d, true), on)).toBe(false)
            }
        }
    })

    test('new rule: chroMemoryShadowRuns needs ChroMemory and the memory switch', () => {
        for (const [a, b, c, d] of cases) {
            expect(chroMemoryShadowRuns(dbOf(a, b, c, d, true), true)).toBe(true)
            expect(chroMemoryShadowRuns(dbOf(a, b, c, d, true), false)).toBe(false)
            expect(chroMemoryShadowRuns(dbOf(a, b, c, d), true)).toBe(false)
        }
    })

    test('new rule: showsMemoryToggle is the legacy OR, or true for ChroMemory', () => {
        for (const [a, b, c, d] of cases) {
            const db = dbOf(a, b, c, d)
            expect(showsMemoryToggle(db)).toBe(Boolean(legacyTakes(db, true)))
            expect(showsMemoryToggle(dbOf(a, b, c, d, true))).toBe(true)
        }
        expect(showsMemoryToggle(dbOf(false, false, false, 'none'))).toBe(false)
    })

    test('new rule: legacyEngineFields is the database itself when off and a frozen all-off view when on', () => {
        const off = dbOf(true, true, true, 'distilbart') as unknown as Parameters<typeof legacyEngineFields>[0]
        expect(legacyEngineFields(off)).toBe(off)
        const on = { ...off, ltmEngine: true } as typeof off
        const view = legacyEngineFields(on)
        expect(view).toEqual({ hanuraiEnable: false, hypav2: false, hypaV3: false, supaModelType: 'none', hypaMemory: false })
        expect(Object.isFrozen(view)).toBe(true)
    })
})

describe('alwaysToggleOnApplies', () => {
    type Arg = Parameters<typeof alwaysToggleOnApplies>[0]
    // Oracle: the condition the alwaysToggleOn hook used before ChroMemory existed.
    const legacy = (db: Arg) => Boolean(db.hypaV3 && db.hypaV3Presets?.[db.hypaV3PresetId]?.settings?.alwaysToggleOn)
    const presets = {
        on: [{ settings: { alwaysToggleOn: true } }],
        offPreset: [{ settings: { alwaysToggleOn: false } }],
        missing: [],
        undef: undefined,
    }

    test('new rule: equals the legacy condition while off and is false for every ChroMemory row', () => {
        for (const v3 of [true, false]) {
            for (const [name, list] of Object.entries(presets)) {
                for (const id of [0, 5]) {
                    for (const ltm of [undefined, false, true]) {
                        const db = { hypaV3: v3, hypaV3Presets: list, hypaV3PresetId: id, ltmEngine: ltm } as unknown as Arg
                        const label = JSON.stringify([v3, name, id, ltm])
                        expect(alwaysToggleOnApplies(db), label).toBe(ltm === true ? false : legacy(db))
                    }
                }
            }
        }
    })
})

describe('setMemoryEngine', () => {
    type Row = { supaModelType: string, memoryAlgorithmType: string, hypav2: boolean, hanuraiEnable: boolean, hypaV3: boolean, ltmEngine?: boolean }
    const table: Record<MemoryEngine, Row> = {
        none: { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false },
        supaMemory: { supaModelType: 'distilbart', memoryAlgorithmType: 'supaMemory', hypav2: false, hanuraiEnable: false, hypaV3: false },
        hypaV2: { supaModelType: 'distilbart', memoryAlgorithmType: 'hypaMemoryV2', hypav2: true, hanuraiEnable: false, hypaV3: false },
        hanuraiMemory: { supaModelType: 'none', memoryAlgorithmType: 'hanuraiMemory', hypav2: false, hanuraiEnable: true, hypaV3: false },
        hypaV3: { supaModelType: 'none', memoryAlgorithmType: 'hypaMemoryV3', hypav2: false, hanuraiEnable: false, hypaV3: true },
        chroMemory: { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false, ltmEngine: true },
    }
    const engines = Object.keys(table) as MemoryEngine[]
    const legacyEngines = engines.filter((e) => e !== 'chroMemory')
    const starts: Row[] = [
        { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false },
        { supaModelType: 'subModel', memoryAlgorithmType: 'hypaMemoryV2', hypav2: true, hanuraiEnable: true, hypaV3: true },
        { supaModelType: 'instruct35', memoryAlgorithmType: 'x', hypav2: false, hanuraiEnable: true, hypaV3: false },
        { supaModelType: 'distilbart', memoryAlgorithmType: 'hypaMemoryV3', hypav2: false, hanuraiEnable: false, hypaV3: true },
    ]

    test.each(engines)('new rule: choosing %s writes its table from any start', (engine) => {
        for (const start of starts) {
            const db: Row = { ...start }
            setMemoryEngine(db, engine)
            expect(db).toEqual(table[engine])
            expect(memoryEngineOf(db)).toBe(engine)
        }
    })

    test.each(legacyEngines)('reproducer: choosing %s from a ChroMemory start clears ltmEngine', (engine) => {
        for (const start of starts) {
            const db: Row = { ...start, ltmEngine: true }
            setMemoryEngine(db, engine)
            expect(db).toEqual({ ...table[engine], ltmEngine: false })
            expect(memoryEngineOf(db)).toBe(engine)
        }
    })

    test.each(legacyEngines)('guard: choosing %s on a profile that never chose ChroMemory adds no ltmEngine key', (engine) => {
        for (const start of starts) {
            const db: Row = { ...start }
            setMemoryEngine(db, engine)
            expect(Object.hasOwn(db, 'ltmEngine')).toBe(false)
        }
    })
})
describe('chroMemoryModeOf', () => {
    test('ME1: off without the engine or with memory off; inject by default; shadow only for an explicit true', () => {
        const on = dbOf(false, false, false, 'none', true)
        expect(chroMemoryModeOf(on, true, undefined)).toBe('inject')
        expect(chroMemoryModeOf(on, true, { budgetTokens: 900 })).toBe('inject')
        expect(chroMemoryModeOf(on, true, { shadow: false })).toBe('inject')
        expect(chroMemoryModeOf(on, true, { shadow: 'yes' })).toBe('inject')
        expect(chroMemoryModeOf(on, true, 'garbage')).toBe('inject')
        expect(chroMemoryModeOf(on, true, { shadow: true })).toBe('shadow')
        expect(chroMemoryModeOf(on, false, { shadow: true })).toBe('off')
        expect(chroMemoryModeOf(dbOf(false, false, false, 'none'), true, { shadow: true })).toBe('off')
        expect(chroMemoryModeOf(dbOf(true, false, false, 'none'), true, undefined)).toBe('off')
    })
})
