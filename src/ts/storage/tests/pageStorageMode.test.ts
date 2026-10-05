// @vitest-environment node
/**
 * The page's storage mode and the two flags boot hands to later steps
 * (`src/ts/storage/pageStorageMode.ts`).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    getPageStorageMode,
    holdAssetSweep,
    isAssetSweepHeld,
    noteMainFileLeftOverLimit,
    pendingConvertedFrom,
    resetPageStorageModeForTests,
    setPageStorageMode,
    takeMainFileLeftOverLimit,
} from 'src/ts/storage/pageStorageMode'

beforeEach(() => {
    resetPageStorageModeForTests()
})

describe('the storage mode', () => {
    test('is unset until boot decides', () => {
        expect(getPageStorageMode()).toEqual({ kind: 'unset' })
    })

    test('a legacy page offers the fingerprint of the file boot read to every whole-state replace it makes', () => {
        setPageStorageMode({ kind: 'legacy', convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb' })

        expect(pendingConvertedFrom()).toBe('b1:100:2:aaaaaaaa:bbbbbbbb')
    })

    test.each([
        ['a legacy page that read no file', { kind: 'legacy', convertedFrom: null } as const],
        ['a block page', { kind: 'block' } as const],
        ['a read-only page', { kind: 'read-only' } as const],
        ['a page boot has not decided for', { kind: 'unset' } as const],
    ])('%s has no fingerprint to pass', (_label, mode) => {
        setPageStorageMode(mode)

        expect(pendingConvertedFrom()).toBeUndefined()
    })

    test('a won conversion moves a legacy page to a block page, after which no fingerprint is offered', () => {
        setPageStorageMode({ kind: 'legacy', convertedFrom: 'c1:5:00000000' })
        setPageStorageMode({ kind: 'block' })

        expect(getPageStorageMode()).toEqual({ kind: 'block' })
        expect(pendingConvertedFrom()).toBeUndefined()
    })
})

describe('the startup asset sweep hold', () => {
    test('is off until something holds it, and stays held for the rest of the page', () => {
        expect(isAssetSweepHeld()).toBe(false)

        holdAssetSweep()

        expect(isAssetSweepHeld()).toBe(true)
        expect(isAssetSweepHeld()).toBe(true)
    })
})

describe('the main file the rename finish could not move', () => {
    test('is noted once and taken once', () => {
        expect(takeMainFileLeftOverLimit()).toBe(false)

        noteMainFileLeftOverLimit()

        expect(takeMainFileLeftOverLimit()).toBe(true)
        expect(takeMainFileLeftOverLimit()).toBe(false)
    })
})
