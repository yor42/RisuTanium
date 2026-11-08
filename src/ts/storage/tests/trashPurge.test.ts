/**
 * The trash purge rule (`src/ts/storage/trashPurge.ts`).
 *
 * Compatibility guard: `isTrashPurgeDue` has the same expression shape as
 * upstream's startup purge in `checkNewFormat` (truthy `trashTime`, strict
 * comparison), so odd saved values behave as upstream's expression does with
 * this fork's age. The age differs on purpose: upstream purges at 3 days, this
 * fork at 30, so a character trashed between 3 and 30 days ago is the accepted
 * divergence window. Upstream's expression is copied below as the oracle.
 */
import { describe, test, expect } from 'vitest'
import { TRASH_PURGE_AGE_MS, isTrashPurgeDue } from '../trashPurge'

// Saved data is not type-checked; the cast names the one narrow shape the
// predicate accepts so odd values reach it as a saved file could deliver them.
type SavedTrashTime = number | undefined
function asSaved(value: object | string | number | boolean | null | undefined): SavedTrashTime {
    return value as SavedTrashTime
}

const DAY = 24 * 60 * 60 * 1000

// Upstream's purge expression with its own literal 3-day age.
function upstreamPurgeDue(trashTime: SavedTrashTime, now: number): boolean {
    const targetTrashTime = trashTime ? trashTime + 1000 * 60 * 60 * 24 * 3 : 0
    return !!(trashTime && targetTrashTime < now)
}

// Upstream's expression with the age as a parameter.
function sameShapePurgeDue(trashTime: SavedTrashTime, now: number, ageMs: number): boolean {
    const targetTrashTime = trashTime ? trashTime + ageMs : 0
    return !!(trashTime && targetTrashTime < now)
}

const NOW = 1_800_000_000_000

describe('isTrashPurgeDue', () => {
    test('the purge age is 30 days', () => {
        expect(TRASH_PURGE_AGE_MS).toBe(2_592_000_000)
    })

    test('literal days: 4 and 29 days are kept, 31 days is purged', () => {
        expect(isTrashPurgeDue(NOW - 4 * DAY, NOW)).toBe(false)
        expect(isTrashPurgeDue(NOW - 29 * DAY, NOW)).toBe(false)
        expect(isTrashPurgeDue(NOW - 31 * DAY, NOW)).toBe(true)
    })

    test('literal days: exactly 30 days is kept, one millisecond more is purged', () => {
        expect(isTrashPurgeDue(NOW - 30 * DAY, NOW)).toBe(false)
        expect(isTrashPurgeDue(NOW - 30 * DAY - 1, NOW)).toBe(true)
    })

    test('diagnostic: 4 days old is purged by upstream and kept by this fork', () => {
        expect(upstreamPurgeDue(NOW - 4 * DAY, NOW)).toBe(true)
        expect(isTrashPurgeDue(NOW - 4 * DAY, NOW)).toBe(false)
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
        test(`compatibility guard: ${name} matches upstream's expression at this fork's age`, () => {
            expect(isTrashPurgeDue(value, NOW)).toBe(sameShapePurgeDue(value, NOW, TRASH_PURGE_AGE_MS))
        })
    }
})
