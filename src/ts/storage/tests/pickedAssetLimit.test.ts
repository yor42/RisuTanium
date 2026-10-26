// @vitest-environment happy-dom

/**
 * The size rule for a picked asset: the notice text, the split of a pick into the files within the limit and the
 * refused ones, the one-notice report and the error a Blob above the limit raises. Only the rule module is imported,
 * so no store, util or database code loads. `alert` is mocked so the notice is
 * observable; `language` is the real English table.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ alertError: vi.fn() }))

vi.mock(import('src/ts/alert'), () => ({
    alertError: h.alertError,
}) as unknown as typeof import('src/ts/alert'))

import { language } from 'src/lang'
import {
    AssetTooLargeError,
    assertBlobWithinAssetLimit,
    assetTooLargeMessage,
    reportRefusedAssets,
    splitByAssetLimit,
    warnRefusedAssets,
} from 'src/ts/storage/pickedAssetLimit'

const MIB = 1024 * 1024
const LIMIT = 1024 * MIB

const named = (name: string, size = 1) => ({ name, size })

beforeEach(() => {
    h.alertError.mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('assetFilesTooLargeForLimit (English)', () => {
    test('one name uses the singular sentence', () => {
        expect(language.assetFilesTooLargeForLimit(['a.mp4'], 1024)).toBe('"a.mp4" is larger than the 1024 MB limit, so it was not added.')
    })

    test('two names are joined with "and" in the plural sentence', () => {
        expect(language.assetFilesTooLargeForLimit(['a.mp4', 'b.mp4'], 1024)).toBe('"a.mp4" and "b.mp4" are larger than the 1024 MB limit, so they were not added.')
    })

    test('three names are separated by commas with "and" before the last', () => {
        expect(language.assetFilesTooLargeForLimit(['a.mp4', 'b.mp4', 'c.mp4'], 1024)).toBe('"a.mp4", "b.mp4" and "c.mp4" are larger than the 1024 MB limit, so they were not added.')
    })

    test('exactly 20 names are all listed', () => {
        const names = Array.from({ length: 20 }, (_, i) => `f${i}.mp4`)
        const text = language.assetFilesTooLargeForLimit(names, 1024)
        expect(text).toContain('"f19.mp4" are larger')
        expect(text).not.toContain('more files')
    })

    test('25 names list the first 20 and count the other 5', () => {
        const names = Array.from({ length: 25 }, (_, i) => `f${i}.mp4`)
        const text = language.assetFilesTooLargeForLimit(names, 1024)
        expect(text).toBe(`${names.slice(0, 20).map((name) => `"${name}"`).join(', ')} and 5 more files are larger than the 1024 MB limit, so they were not added.`)
        expect(text).not.toContain('f20.mp4')
    })

    test('a name that contains quotes is shown as it is', () => {
        expect(language.assetFilesTooLargeForLimit(['say "hi".png'], 1024)).toBe('"say "hi".png" is larger than the 1024 MB limit, so it was not added.')
    })
})

describe('assetTooLargeMessage', () => {
    test('shows the limit as whole MB, rounded down', () => {
        expect(assetTooLargeMessage(['a.mp4'], LIMIT)).toContain('the 1024 MB limit')
        expect(assetTooLargeMessage(['a.mp4'], 200 * MIB + 5)).toContain('the 200 MB limit')
    })
})

describe('splitByAssetLimit', () => {
    test('a file of exactly the limit is within, one byte more is refused, and pick order is kept', () => {
        const files = [named('ok1', 5), named('exact', 100), named('over', 101), named('ok2', 1), named('over2', 1000)]

        const { within, refused } = splitByAssetLimit(files, 100)

        expect(within.map((file) => file.name)).toEqual(['ok1', 'exact', 'ok2'])
        expect(refused.map((file) => file.name)).toEqual(['over', 'over2'])
    })

    test('an empty pick gives two empty lists', () => {
        expect(splitByAssetLimit([], 100)).toEqual({ within: [], refused: [] })
    })
})

describe('reportRefusedAssets', () => {
    test('shows one notice naming every refused file', () => {
        reportRefusedAssets([named('a.mp4'), named('b.mp4'), named('c.mp4')], LIMIT)

        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledWith('"a.mp4", "b.mp4" and "c.mp4" are larger than the 1024 MB limit, so they were not added.')
    })

    test('shows nothing when no file was refused', () => {
        reportRefusedAssets([], LIMIT)

        expect(h.alertError).not.toHaveBeenCalled()
    })
})

describe('warnRefusedAssets', () => {
    test('logs the notice without showing an alert, and nothing when none was refused', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        warnRefusedAssets([], LIMIT)
        expect(warn).not.toHaveBeenCalled()

        warnRefusedAssets([named('a.mp4')], LIMIT)
        expect(warn).toHaveBeenCalledWith('"a.mp4" is larger than the 1024 MB limit, so it was not added.')
        expect(h.alertError).not.toHaveBeenCalled()
    })
})

describe('assertBlobWithinAssetLimit', () => {
    test('throws AssetTooLargeError with the display name and the limit for a Blob above the limit, and accepts one at the limit', () => {
        const at = new Blob([Uint8Array.of(1)])
        Object.defineProperty(at, 'size', { value: 100 })
        const over = new Blob([Uint8Array.of(1)])
        Object.defineProperty(over, 'size', { value: 101 })

        expect(() => assertBlobWithinAssetLimit(at, 'at.mp4', 100)).not.toThrow()
        let thrown: unknown = null
        try {
            assertBlobWithinAssetLimit(over, 'over.mp4', 100)
        } catch (error) {
            thrown = error
        }
        expect(thrown).toBeInstanceOf(AssetTooLargeError)
        const refusal = thrown as AssetTooLargeError
        expect(refusal.name).toBe('AssetTooLargeError')
        expect(refusal.fileNames).toEqual(['over.mp4'])
        expect(refusal.limitBytes).toBe(100)
        expect(refusal.message).toBe(assetTooLargeMessage(['over.mp4'], 100))
    })
})
