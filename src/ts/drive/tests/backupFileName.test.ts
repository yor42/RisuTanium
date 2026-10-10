import { describe, test, expect, vi } from 'vitest'
import { localBackupFileName } from '../backupFileName'

describe('localBackupFileName', () => {
    test('names a full backup local-YYYYMMDD.bin', () => {
        expect(localBackupFileName(new Date(2026, 9, 10, 12, 0, 0))).toBe('local-20261010.bin')
    })

    test('names a partial backup local-partial-YYYYMMDD.bin', () => {
        expect(localBackupFileName(new Date(2026, 9, 10, 12, 0, 0), true)).toBe('local-partial-20261010.bin')
    })

    test('zero-pads a single-digit month and day', () => {
        expect(localBackupFileName(new Date(2026, 0, 5, 12, 0, 0))).toBe('local-20260105.bin')
        expect(localBackupFileName(new Date(2026, 2, 9, 12, 0, 0), true)).toBe('local-partial-20260309.bin')
    })

    test('zero-pads a year below 1000 to four digits', () => {
        const date = new Date(2000, 0, 1, 12, 0, 0)
        date.setFullYear(999)
        expect(localBackupFileName(date)).toBe('local-09990101.bin')
    })

    describe('local date versus UTC', () => {
        // An instant whose UTC calendar day differs from the device's local one, built by overriding the
        // local getters, so the result does not depend on the time zone the test runs in.
        function dateWithLocalDay(utcIso: string, local: { year: number, month: number, day: number }): Date {
            const date = new Date(utcIso)
            vi.spyOn(date, 'getFullYear').mockReturnValue(local.year)
            vi.spyOn(date, 'getMonth').mockReturnValue(local.month)
            vi.spyOn(date, 'getDate').mockReturnValue(local.day)
            return date
        }

        test('uses the local calendar day when UTC is already the next day', () => {
            const date = dateWithLocalDay('2026-10-11T07:30:00Z', { year: 2026, month: 9, day: 10 })
            expect(date.getUTCDate()).toBe(11)
            expect(localBackupFileName(date)).toBe('local-20261010.bin')
        })

        test('uses the local calendar day when UTC is still the previous day', () => {
            const date = dateWithLocalDay('2026-12-31T15:30:00Z', { year: 2027, month: 0, day: 1 })
            expect(date.getUTCFullYear()).toBe(2026)
            expect(localBackupFileName(date, true)).toBe('local-partial-20270101.bin')
        })

        test('a late-evening local time keeps its own day', () => {
            expect(localBackupFileName(new Date(2026, 9, 10, 23, 59, 59))).toBe('local-20261010.bin')
            expect(localBackupFileName(new Date(2026, 9, 11, 0, 0, 1))).toBe('local-20261011.bin')
        })
    })
})
