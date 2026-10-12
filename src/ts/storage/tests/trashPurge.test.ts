/**
 * The trash purge rule (`src/ts/storage/trashPurge.ts`).
 *
 * Compatibility guard: `isTrashPurgeDue` must answer exactly like upstream's
 * startup purge expression in `checkNewFormat`, for every saved `trashTime`
 * value, odd ones included, so a `.bin` moved between the two purges the same
 * characters. That expression is copied below as the oracle, which is what
 * pins the behaviour.
 */
import { describe, test, expect } from 'vitest'
import { TRASH_PURGE_AGE_MS, isTrashPurgeDue } from '../trashPurge'

// Saved data is not type-checked; the cast names the one narrow shape the
// predicate accepts so odd values reach it as a saved file could deliver them.
type SavedTrashTime = number | undefined
function asSaved(value: object | string | number | boolean | null | undefined): SavedTrashTime {
    return value as SavedTrashTime
}

// The purge's original inline expression.
function originalPurgeDue(trashTime: SavedTrashTime, now: number): boolean {
    const targetTrashTime = trashTime ? trashTime + 1000 * 60 * 60 * 24 * 3 : 0
    return !!(trashTime && targetTrashTime < now)
}

const NOW = 1_800_000_000_000

describe('isTrashPurgeDue', () => {
    test('compatibility guard: the purge age is three days', () => {
        expect(TRASH_PURGE_AGE_MS).toBe(259_200_000)
    })

    test('compatibility guard: the boundary is strict', () => {
        const t = 1_700_000_000_000
        expect(isTrashPurgeDue(t, t + TRASH_PURGE_AGE_MS)).toBe(false)
        expect(isTrashPurgeDue(t, t + TRASH_PURGE_AGE_MS + 1)).toBe(true)
        expect(isTrashPurgeDue(t, t + TRASH_PURGE_AGE_MS - 1)).toBe(false)
    })

    test('compatibility guard: no trashTime is never due', () => {
        expect(isTrashPurgeDue(undefined, NOW)).toBe(false)
        expect(isTrashPurgeDue(0, NOW)).toBe(false)
    })

    const odd: Array<[string, SavedTrashTime]> = [
        ['undefined', undefined],
        ['null', asSaved(null)],
        ['0', 0],
        ['1', 1],
        ['negative', -5],
        ['NaN', NaN],
        ['numeric string', asSaved('1700000000000')],
        ['empty string', asSaved('')],
        ['true', asSaved(true)],
        ['false', asSaved(false)],
        ['future time', NOW + 10 * TRASH_PURGE_AGE_MS],
        ['object', asSaved({})],
        ['array', asSaved([])],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['now', NOW],
        ['exact boundary', NOW - TRASH_PURGE_AGE_MS],
        ['boundary + 1 ms', NOW - TRASH_PURGE_AGE_MS + 1],
        ['boundary - 1 ms', NOW - TRASH_PURGE_AGE_MS - 1],
    ]
    for (const [name, value] of odd) {
        test(`compatibility guard: ${name} matches the original expression`, () => {
            expect(isTrashPurgeDue(value, NOW)).toBe(originalPurgeDue(value, NOW))
        })
    }
})
