// @vitest-environment node
/**
 * The page's storage mode and which modes may go live
 * (`src/ts/storage/pageStorageMode.ts`).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    getPageStorageMode,
    pageMayGoLive,
    resetPageStorageModeForTests,
    setPageStorageMode,
} from 'src/ts/storage/pageStorageMode'
import type { PageStorageMode } from 'src/ts/storage/pageStorageMode'

beforeEach(() => {
    resetPageStorageModeForTests()
})

describe('the storage mode', () => {
    test('is unset until boot decides', () => {
        expect(getPageStorageMode()).toEqual({ kind: 'unset' })
    })

    test('a store2 page is a mode of its own: not a read-only one', () => {
        setPageStorageMode({ kind: 'store2' })

        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        expect(getPageStorageMode().kind).not.toBe('read-only')
    })
})

/**
 * Labels: guard. The `unset` rows kill a predicate written as "anything but the refused modes", and the
 * `store2` rows kill one that accepts a store2 page without its active save or any mode with a save.
 */
describe('which pages may go live', () => {
    const rows: Array<[string, PageStorageMode, boolean, boolean]> = [
        ['a store2 page with its active save', { kind: 'store2' }, true, true],
        ['a store2 page with no active save', { kind: 'store2' }, false, false],
        ['a read-only page with no save', { kind: 'read-only', reason: 'server-capability' }, false, true],
        ['a read-only page that somehow holds a save', { kind: 'read-only', reason: 'backend-unavailable' }, true, true],
        ['a too-new read-only page', { kind: 'read-only', reason: 'too-new', source: 'tree' }, false, true],
        ['a page boot has not decided for, with a save', { kind: 'unset' }, true, false],
        ['a page boot has not decided for, with no save', { kind: 'unset' }, false, false],
    ]

    test.each(rows)('%s', (_label, mode, hasActiveSave, expected) => {
        expect(pageMayGoLive(mode, hasActiveSave)).toBe(expected)
    })
})
