/**
 * The estimate behind the Android import time warning. The expected seconds are literals worked out from the measured
 * runs (about 4.2 MiB/s of asset copy, 1 ms per entry, 6 s fixed, a 480 s tail for a large database entry), so a changed
 * coefficient cannot pass by changing the function and the expectation together. The table is a compatibility check of
 * the fit, not a defect reproducer; the step at 16 MiB is a recorded shape, not a fitted one.
 */
import { describe, expect, test } from 'vitest'
import { estimateImportSeconds, importAssetBytes, importFreeGigabytesText, importFreeSpaceBytes, importGigabytesText, importSpaceVerdict, IMPORT_TIME_WARNING_BYTES, roundImportMinutes } from '../importEstimate'

const MIB = 1024 * 1024

describe('estimateImportSeconds', () => {
    test('the 42,001-entry, 2887 MiB run comes to about 1215 s from now', () => {
        expect(estimateImportSeconds(42_001, 2887 * MIB, 49 * MIB)).toBeCloseTo(1215.4, 0)
    })

    test('the 102,001-entry, 6841 MiB run comes to about 2217 s from now', () => {
        expect(estimateImportSeconds(102_001, 6841 * MIB, 49 * MIB)).toBeCloseTo(2216.8, 0)
    })

    test('a small file with a large database is the tail alone plus its fixed part', () => {
        expect(estimateImportSeconds(0, 0, 86 * MIB)).toBe(486)
    })

    test('the tail is a step at 16 MiB of database entry: 60 s up to it, 480 s above it', () => {
        expect(estimateImportSeconds(0, 0, 16 * MIB)).toBe(66)
        expect(estimateImportSeconds(0, 0, 16 * MIB + 1)).toBe(486)
        expect(estimateImportSeconds(0, 0, 0)).toBe(66)
    })

    test('the estimate never falls as the database entry grows', () => {
        let previous = 0
        for (let bytes = 0; bytes <= 120 * MIB; bytes += MIB) {
            const seconds = estimateImportSeconds(10_000, 2 * 1024 * MIB, bytes)
            expect(seconds).toBeGreaterThanOrEqual(previous)
            previous = seconds
        }
    })
})

describe('roundImportMinutes', () => {
    test.each([
        [60, 5],
        [300, 5],
        [301, 10],
        [1215, 25],
        [2217, 40],
        [7140, 120],
        [7200, 120],
        [7201, 150],
        [8670, 150],
    ])('%s s is shown as %s minutes', (seconds, minutes) => {
        expect(roundImportMinutes(seconds)).toBe(minutes)
    })
})

describe('free space', () => {
    test('a file with 2887 MiB of assets needs about 3687.7 MiB', () => {
        expect(importFreeSpaceBytes(2887 * MIB) / MIB).toBeCloseTo(3687.7, 1)
    })

    test('gigabytes are decimal, one decimal, rounded up', () => {
        // 3687.7 MiB is 3.87e9 bytes: a binary-gigabyte figure would read 3.6.
        expect(importGigabytesText(importFreeSpaceBytes(2887 * MIB))).toBe(3.9)
        expect(importGigabytesText(1_000_000_001)).toBe(1.1)
        expect(importGigabytesText(1_000_000_000)).toBe(1)
        expect(importGigabytesText(0)).toBe(0)
    })
})

describe('importSpaceVerdict', () => {
    // With no assets the need is exactly 512 MiB, so the boundary involves no floating-point rounding.
    const NEED = importFreeSpaceBytes(0)

    test('free equal to the need is enough; one byte less is short', () => {
        expect(NEED).toBe(512 * MIB)
        expect(importSpaceVerdict(NEED, NEED)).toBe('enough')
        expect(importSpaceVerdict(NEED - 1, NEED)).toBe('short')
        expect(importSpaceVerdict(NEED + 1, NEED)).toBe('enough')
    })

    test('no free figure is unknown, whatever the need', () => {
        expect(importSpaceVerdict(null, NEED)).toBe('unknown')
        expect(importSpaceVerdict(null, 0)).toBe('unknown')
    })

    test('zero free bytes is short, not unknown', () => {
        expect(importSpaceVerdict(0, NEED)).toBe('short')
    })
})

describe('importFreeGigabytesText', () => {
    test('is decimal, one decimal, rounded down so the shown free space never overstates', () => {
        expect(importFreeGigabytesText(1_999_999_999)).toBe(1.9)
        expect(importFreeGigabytesText(2_000_000_000)).toBe(2)
        expect(importFreeGigabytesText(599_999_999)).toBe(0.5)
        expect(importFreeGigabytesText(99_999_999)).toBe(0)
        expect(importFreeGigabytesText(0)).toBe(0)
    })

    test('whenever the verdict is short the shown free figure is below the shown need', () => {
        const needs = [0, 1, 400 * MIB, 2887 * MIB, 6841 * MIB]
        for (const assets of needs) {
            const need = importFreeSpaceBytes(assets)
            const shownNeed = importGigabytesText(need)
            for (const delta of [1, 1000, 50_000_000, 99_999_999, 100_000_000, 100_000_001, 1_000_000_000]) {
                const free = Math.max(0, Math.floor(need) - delta)
                if (importSpaceVerdict(free, need) === 'short') {
                    expect(importFreeGigabytesText(free)).toBeLessThan(shownNeed)
                }
            }
        }
    })
})

describe('the asset bytes of a file', () => {
    test('are the file less its database entry, never negative', () => {
        expect(importAssetBytes(5000, 1200)).toBe(3800)
        expect(importAssetBytes(1000, 1200)).toBe(0)
    })

    test('the warning threshold is 1 GiB', () => {
        expect(IMPORT_TIME_WARNING_BYTES).toBe(1024 * 1024 * 1024)
    })
})
