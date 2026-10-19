/**
 * The estimate behind the Android import time warning. The expected seconds are literals worked out from the measured
 * runs (about 4.2 MiB/s of asset copy, 1 ms per entry, 6 s fixed, a 480 s tail for a large database entry), so a changed
 * coefficient cannot pass by changing the function and the expectation together. The table is a compatibility check of
 * the fit, not a defect reproducer; the step at 16 MiB is a recorded shape, not a fitted one.
 */
import { describe, expect, test } from 'vitest'
import { estimateImportSeconds, importAssetBytes, importFreeSpaceBytes, importGigabytesText, IMPORT_TIME_WARNING_BYTES, roundImportMinutes } from '../importEstimate'

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

describe('the asset bytes of a file', () => {
    test('are the file less its database entry, never negative', () => {
        expect(importAssetBytes(5000, 1200)).toBe(3800)
        expect(importAssetBytes(1000, 1200)).toBe(0)
    })

    test('the warning threshold is 1 GiB', () => {
        expect(IMPORT_TIME_WARNING_BYTES).toBe(1024 * 1024 * 1024)
    })
})
