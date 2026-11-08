import { describe, expect, test } from 'vitest'
import type { HomeMode, ModeState } from 'src/ts/storage/homeModes'
import { BUILT_HOME_MODES, switcherEntries } from './homeSwitcher'

/**
 * `switcherEntries`: the switcher's entries come from `shownModes` only. Fixtures are stored-value
 * literals, as `homeModes.test.ts` builds them.
 */

const modes = (entries: ReturnType<typeof switcherEntries>): HomeMode[] => entries.map((entry) => entry.mode)

describe('switcherEntries', () => {
    test('hiding off lists all three modes whatever the remembered set holds', () => {
        const entries = switcherEntries({ visibleModes: ['rp'], hideUnusedModes: false })
        expect(modes(entries)).toEqual(['rp', 'hybrid', 'utility'])
    })

    test('hiding on lists the remembered set', () => {
        const entries = switcherEntries({ visibleModes: ['rp', 'utility'], hideUnusedModes: true })
        expect(modes(entries)).toEqual(['rp', 'utility'])
    })

    test('stored values that are malformed fall back to all three modes', () => {
        for (const visibleModes of [undefined, null, 'rp', [], ['nope'], 5]) {
            const state = { visibleModes, hideUnusedModes: true } as unknown as ModeState
            expect(modes(switcherEntries(state))).toEqual(['rp', 'hybrid', 'utility'])
        }
        const hidingOff = { visibleModes: ['rp'], hideUnusedModes: undefined } as unknown as ModeState
        expect(modes(switcherEntries(hidingOff))).toEqual(['rp', 'hybrid', 'utility'])
    })

    test('Roleplay is current and built; Hybrid and Utility are held', () => {
        const entries = switcherEntries({ visibleModes: ['rp', 'hybrid', 'utility'], hideUnusedModes: false })
        expect(entries).toEqual([
            { mode: 'rp', held: false, current: true },
            { mode: 'hybrid', held: true, current: false },
            { mode: 'utility', held: true, current: false },
        ])
        expect(BUILT_HOME_MODES).toEqual(['rp'])
    })

    test('one shown mode gives no switcher', () => {
        for (const only of ['rp', 'hybrid', 'utility'] as const) {
            expect(switcherEntries({ visibleModes: [only], hideUnusedModes: true })).toEqual([])
        }
    })

    test('while Roleplay is the only built mode it stays listed even when shownModes omits it', () => {
        const entries = switcherEntries({ visibleModes: ['hybrid', 'utility'], hideUnusedModes: true })
        expect(entries).toEqual([
            { mode: 'rp', held: false, current: true },
            { mode: 'hybrid', held: true, current: false },
            { mode: 'utility', held: true, current: false },
        ])
    })

    test('once another mode is built, Roleplay follows shownModes', () => {
        const state: ModeState = { visibleModes: ['hybrid', 'utility'], hideUnusedModes: true }
        const entries = switcherEntries(state, ['rp', 'hybrid'])
        expect(entries).toEqual([
            { mode: 'hybrid', held: false, current: true },
            { mode: 'utility', held: true, current: false },
        ])
    })

    test('the state passed in is not modified', () => {
        const state: ModeState = { visibleModes: ['hybrid', 'utility'], hideUnusedModes: true }
        const before = JSON.stringify(state)
        switcherEntries(state)
        expect(JSON.stringify(state)).toBe(before)
    })
})
