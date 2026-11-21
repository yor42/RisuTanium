import { describe, expect, test, vi } from 'vitest'

// Each label key renders as its own name, so the assertions compare keys rather than English text.
vi.mock('../../../lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))

import { memoryToggleLabel } from './memoryLabels'

type Arg = Parameters<typeof memoryToggleLabel>[0]
const bools = [true, false]

// Oracle: the label chain the toggle sites carried before ChroMemory existed.
function legacyLabel(db: Arg): string {
    return db.hanuraiEnable ? 'hanuraiMemory' : (db.hypav2 || db.hypaV3 || db.hypaMemory) ? 'ToggleHypaMemory' : 'ToggleSuperMemory'
}

describe('memoryToggleLabel', () => {
    test('new rule: equals the legacy label chain while ChroMemory is off', () => {
        for (const hanuraiEnable of bools) for (const hypav2 of bools) for (const hypaV3 of bools) for (const hypaMemory of bools) {
            for (const ltmEngine of [undefined, false]) {
                const db = { hanuraiEnable, hypav2, hypaV3, hypaMemory, supaModelType: 'none', ltmEngine } as Arg
                expect(memoryToggleLabel(db), JSON.stringify(db)).toBe(legacyLabel(db))
            }
        }
    })

    test('new rule: ChroMemory shows its own label whatever the legacy flags say', () => {
        for (const hanuraiEnable of bools) for (const hypav2 of bools) for (const hypaV3 of bools) for (const hypaMemory of bools) {
            const db = { hanuraiEnable, hypav2, hypaV3, hypaMemory, supaModelType: 'none', ltmEngine: true } as Arg
            expect(memoryToggleLabel(db), JSON.stringify(db)).toBe('chroMemory')
        }
    })
})
