/**
 * `changeCharOrAlert` (`characterPick.ts`): the row helper that reports a `changeChar` that throws.
 *
 * Invariants exercised here:
 * - T8: when the generation counter cannot be read the helper still resolves `'error'`, alerts once
 *   and records the original error, not a `TypeError` from the unreadable counter. The alert rule
 *   fails open.
 * - A synchronous throw takes the same path.
 * - An `arg` object is forwarded unchanged, and no `arg` means a call with the index only.
 *
 * MOCKED: `./characters` with a factory that has only a spy `changeChar`, so reading
 * `changeCharGeneration` throws as an unreadable counter would. The alert and the caught-error
 * record are spies. The gate on the generation itself is covered with the real counter by the row
 * component tests (`CharacterSimpleList.pickError` and `SidebarRail.pickError`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { changeCharSpy, alertErrorSpy, recordErrorSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
    recordErrorSpy: vi.fn(),
}))

vi.mock('./characters', () => ({ changeChar: changeCharSpy }))
vi.mock('./alert', () => ({ alertError: alertErrorSpy }))
vi.mock('./caughtErrors', () => ({ recordCaughtError: recordErrorSpy }))

import { language } from '../lang'
import { changeCharOrAlert } from './characterPick'

beforeEach(() => {
    changeCharSpy.mockReset()
    alertErrorSpy.mockReset()
    recordErrorSpy.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('changeCharOrAlert', () => {
    test('T8: an unreadable generation still alerts once and records the original rejection', async () => {
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        expect(await changeCharOrAlert('list.pick', 3)).toBe('error')

        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(recordErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordErrorSpy.mock.calls[0][0]).toBe('list.pick')
        expect(recordErrorSpy.mock.calls[0][1]).toBe(error)
    })

    test('a synchronous throw resolves error, alerts once and records it', async () => {
        const error = new Error('sync boom')
        changeCharSpy.mockImplementationOnce(() => { throw error })

        expect(await changeCharOrAlert('rail.pick', 1)).toBe('error')

        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordErrorSpy.mock.calls[0][1]).toBe(error)
    })

    test('guard: a resolved outcome is returned untouched with no alert and no record', async () => {
        changeCharSpy.mockResolvedValueOnce({ failed: 'unreadable' })

        expect(await changeCharOrAlert('list.pick', 3)).toEqual({ failed: 'unreadable' })

        expect(alertErrorSpy).not.toHaveBeenCalled()
        expect(recordErrorSpy).not.toHaveBeenCalled()
    })

    test('guard: no arg calls changeChar with the index only, and an arg is forwarded as the same object', async () => {
        changeCharSpy.mockResolvedValue('selected')
        const arg = { reseter: () => {} }

        await changeCharOrAlert('list.pick', 4)
        await changeCharOrAlert('rail.pick', 5, arg)

        expect(changeCharSpy.mock.calls).toHaveLength(2)
        expect(changeCharSpy.mock.calls[0]).toEqual([4])
        expect(changeCharSpy.mock.calls[1]).toHaveLength(2)
        expect(changeCharSpy.mock.calls[1][1]).toBe(arg)
    })
})
