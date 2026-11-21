// @vitest-environment node
/**
 * `refuseOnReadOnlyPage` (`src/ts/storage/readOnlyPage.ts`): the answer the
 * restore, the internal-backup load and the manual clean-up ask before their
 * first write. It is decided by the page's storage mode alone, so it needs no
 * store selection.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const alertError = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertError,
}) as unknown as typeof import('src/ts/alert'))

import { language } from 'src/lang'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { refuseOnReadOnlyPage } from 'src/ts/storage/readOnlyPage'

beforeEach(() => {
    alertError.mockClear()
    resetPageStorageModeForTests()
})

describe('refuseOnReadOnlyPage', () => {
    test.each([
        { kind: 'read-only', reason: 'server-capability' },
        { kind: 'read-only', reason: 'backend-unavailable' },
        { kind: 'read-only', reason: 'too-new', source: 'tree' },
    ] as const)('guard: a $reason page tells the person why, in the neutral words, and answers that the caller must stop', async (mode) => {
        setPageStorageMode(mode)

        expect(await refuseOnReadOnlyPage()).toBe(true)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.store2Boot.readOnlyRefusal)
    })

    test.each([
        ['an unset page', { kind: 'unset' } as const],
        ['a store2 page', { kind: 'store2' } as const],
    ])('guard: %s lets the caller go on and says nothing', async (_label, mode) => {
        setPageStorageMode(mode)

        expect(await refuseOnReadOnlyPage()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
    })

    test('guard: on any other page it says nothing and lets the caller go on', async () => {
        expect(await refuseOnReadOnlyPage()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
    })
})
