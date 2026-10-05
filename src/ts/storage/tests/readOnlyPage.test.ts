// @vitest-environment node
/**
 * `refuseOnReadOnlyPage` (`src/ts/storage/readOnlyPage.ts`): the answer the
 * restore, the internal-backup load and the manual clean-up ask before their
 * first write. Only the transitional OPFS page is read-only; a selection that
 * cannot be had is not an answer, so those writers fail on their own terms.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const alertError = vi.hoisted(() => vi.fn())
const selection = vi.hoisted(() => ({ answer: false as boolean | 'throws' }))

vi.mock(import('src/ts/alert'), () => ({
    alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    pageStoreIsOpfsTransitional: async () => {
        if (selection.answer === 'throws') {
            throw new Error('the store could not be selected')
        }
        return selection.answer
    },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { language } from 'src/lang'
import { refuseOnReadOnlyPage } from 'src/ts/storage/readOnlyPage'

beforeEach(() => {
    alertError.mockClear()
    selection.answer = false
})

describe('refuseOnReadOnlyPage', () => {
    test('on the transitional OPFS page it tells the person why and answers that the caller must stop', async () => {
        selection.answer = true

        expect(await refuseOnReadOnlyPage()).toBe(true)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.opfsReadOnlyNotice)
    })

    test('guard: on any other page it says nothing and lets the caller go on', async () => {
        selection.answer = false

        expect(await refuseOnReadOnlyPage()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
    })

    test('guard: a store selection that fails is not "read-only": the caller goes on and fails on its own terms', async () => {
        selection.answer = 'throws'

        expect(await refuseOnReadOnlyPage()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
    })
})
