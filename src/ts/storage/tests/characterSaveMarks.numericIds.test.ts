/**
 * NUMID-MARK: a usable numeric chaId is a valid explicit mark, queued as the
 * raw number (the legacy no-reload filter compares marks with the raw chaId).
 * Unusable ids still name nothing.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { installCharacterSaveMarks, markCharacterForSave, resetCharacterSaveMarksForTest } from '../characterSaveMarks'
import { ensureInstalled, resetNetSignalsForTest, type NetSignalHandle } from '../netSignalMeter'
import type { toSaveType } from '../risuSave'

function makeTracker(character: string[] = []): toSaveType {
    return {
        character,
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

afterEach(() => {
    resetCharacterSaveMarksForTest()
    localStorage.clear()
    resetNetSignalsForTest()
})

describe('markCharacterForSave and numeric ids', () => {
    test('U1: a usable numeric id is appended raw, once, and schedules', () => {
        const tracker = makeTracker(['front'])
        const schedule = vi.fn()
        installCharacterSaveMarks({ tracker, schedule })

        markCharacterForSave(7)
        markCharacterForSave(7)
        markCharacterForSave(-2.5)

        expect(tracker.character).toEqual(['front', 7, -2.5])
        expect(schedule).toHaveBeenCalledTimes(3)
    })

    test('U2: a numeric mark before install is queued raw and drained on install', () => {
        markCharacterForSave(7)

        const tracker = makeTracker([])
        const schedule = vi.fn()
        installCharacterSaveMarks({ tracker, schedule })

        expect(tracker.character).toEqual([7])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    test('U3: falsy, unusable and non-id values stay a no-op', () => {
        const tracker = makeTracker(['existing'])
        const schedule = vi.fn()
        installCharacterSaveMarks({ tracker, schedule })

        for (const value of [undefined, null, '', 0, -0, Number.NaN, Infinity, -Infinity, true, {}, [], 7n]) {
            markCharacterForSave(value)
        }

        expect(tracker.character).toEqual(['existing'])
        expect(schedule).not.toHaveBeenCalled()
    })

    test('U4: a numeric mark counts one api signal under its text id', () => {
        localStorage.setItem('risu-measure-savepass', 'on')
        resetNetSignalsForTest()
        ensureInstalled(() => null)
        const handle = (globalThis as { __risuNetSignals?: NetSignalHandle }).__risuNetSignals
        installCharacterSaveMarks({ tracker: makeTracker([]), schedule: vi.fn() })

        markCharacterForSave(5)

        expect(handle?.signals('5')?.api.n).toBe(1)
    })
})
