import { describe, expect, test } from 'vitest'
import { TRASH_PURGE_AGE_MS } from '../../ts/storage/trashPurge'
import { trashDaysLeft } from './trashDays'

/**
 * T26: whole days left before the purge, rounded up so a row never reads "0 days left" while it still
 * exists, and clamped so an overdue row never reads a negative count.
 */
const NOW = 1_700_000_000_000
const DAY = 86_400_000
const HOUR = 3_600_000

describe('trashDaysLeft', () => {
    test('a character trashed just now has the whole retention left', () => {
        expect(trashDaysLeft(NOW, NOW)).toBe(30)
    })

    test('ten days and an hour ago rounds the partial day up to 20', () => {
        expect(trashDaysLeft(NOW - (10 * DAY + HOUR), NOW)).toBe(20)
    })

    test('exactly ten days ago leaves exactly 20', () => {
        expect(trashDaysLeft(NOW - 10 * DAY, NOW)).toBe(20)
    })

    test('exactly at the retention age leaves 0', () => {
        expect(trashDaysLeft(NOW - TRASH_PURGE_AGE_MS, NOW)).toBe(0)
    })

    test('a minute before the retention age still leaves 1', () => {
        expect(trashDaysLeft(NOW - TRASH_PURGE_AGE_MS + 60_000, NOW)).toBe(1)
    })

    test('past the retention age clamps to 0, never negative', () => {
        expect(trashDaysLeft(NOW - 31 * DAY, NOW)).toBe(0)
        expect(trashDaysLeft(NOW - 400 * DAY, NOW)).toBe(0)
    })

    test('the retention is the purge age the store uses, 30 days', () => {
        expect(TRASH_PURGE_AGE_MS).toBe(30 * DAY)
    })
})
