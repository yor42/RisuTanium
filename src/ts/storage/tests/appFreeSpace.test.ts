/**
 * The page's read of the free bytes under the app data directory. The reader never throws: every failure of the command
 * and every value that could not be a byte count the page can compare reads as `null` (unknown). The command is mocked;
 * a mocked success is not evidence about a phone.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const invokeMock = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock.fn(...args) }))

import { readAppDataFreeBytes } from '../appFreeSpace'

beforeEach(() => {
    invokeMock.fn.mockReset()
})

describe('readAppDataFreeBytes', () => {
    test('returns the value of the app_data_free_bytes command', async () => {
        invokeMock.fn.mockResolvedValue(123_456_789)

        expect(await readAppDataFreeBytes()).toBe(123_456_789)
        expect(invokeMock.fn).toHaveBeenCalledTimes(1)
        expect(invokeMock.fn.mock.calls[0][0]).toBe('app_data_free_bytes')
    })

    test('zero free bytes is a value, not unknown', async () => {
        invokeMock.fn.mockResolvedValue(0)

        expect(await readAppDataFreeBytes()).toBe(0)
    })

    test('a rejected command reads as unknown', async () => {
        invokeMock.fn.mockRejectedValue('statvfs failed')

        expect(await readAppDataFreeBytes()).toBeNull()
    })

    test('a command that throws synchronously reads as unknown', async () => {
        invokeMock.fn.mockImplementation(() => { throw new Error('no bridge') })

        expect(await readAppDataFreeBytes()).toBeNull()
    })

    test.each([
        ['negative', -1],
        ['NaN', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
        ['fractional', 1.5],
        ['a string', '1024'],
        ['null', null],
        ['an object', { free: 1 }],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ])('%s reads as unknown', async (_label, value) => {
        invokeMock.fn.mockResolvedValue(value)

        expect(await readAppDataFreeBytes()).toBeNull()
    })
})
