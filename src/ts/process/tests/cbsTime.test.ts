/**
 * The `time` CBS function is registered once. The parser keeps the last registration of a name, so a second
 * registration silently replaces the first, and every documentation consumer lists the name twice. The kept
 * registration answers local h:m:s without arguments and formats with `dateTimeFormat` when given a format.
 *
 * Labels: R = regression reproducer (the base registers `time` twice), G = guard (passes before and after).
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { CBSRegisterArg, RegisterCallback, matcherArg } from '../../cbs'

vi.mock(import('../../stores.svelte'), () => ({
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('../../stores.svelte'))

import { defaultCBSRegisterArg, registerCBS } from '../../cbs'

type Registration = Parameters<CBSRegisterArg['registerFunction']>[0]

function registrations(dateTimeFormat: CBSRegisterArg['dateTimeFormat'] = defaultCBSRegisterArg.dateTimeFormat): Registration[] {
    const all: Registration[] = []
    registerCBS({
        ...defaultCBSRegisterArg,
        registerFunction: (entry) => { all.push(entry) },
        dateTimeFormat,
    })
    return all
}

function timeCallback(dateTimeFormat?: CBSRegisterArg['dateTimeFormat']): RegisterCallback {
    // The parser keeps the last registration of a name.
    const callback = registrations(dateTimeFormat).filter((entry) => entry.name === 'time').at(-1)?.callback
    if (typeof callback !== 'function') {
        throw new Error('The function time is not registered.')
    }
    return callback
}

const matcher = { subject: undefined } as unknown as matcherArg

afterEach(() => {
    vi.useRealTimers()
})

describe('the time CBS function', () => {
    test('R time-registered-once', () => {
        const names = registrations().flatMap((entry) => [entry.name, ...entry.alias])
        expect(names.filter((name) => name === 'time')).toHaveLength(1)
    })

    test('G time-without-arguments-is-local-h-m-s', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 0, 2, 7, 5, 9))
        expect(timeCallback()('', matcher, [], null)).toBe('7:5:9')
    })

    test('G time-with-a-format-uses-dateTimeFormat', () => {
        const format = vi.fn((_format: string, _time: number) => 'formatted')
        expect(timeCallback(format)('', matcher, ['HH:mm', '2000'], null)).toBe('formatted')
        expect(format).toHaveBeenCalledWith('HH:mm', 2)
    })
})
