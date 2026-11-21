import { describe, expect, test } from 'vitest'
import { greetingKey, greetingPeriod, msUntilNextPeriod, type GreetingPeriod } from './homeGreeting'

const at = (hour: number, minute = 0, second = 0): Date => new Date(2026, 5, 10, hour, minute, second)

describe('greetingPeriod', () => {
    const table: Array<[number, number, GreetingPeriod]> = [
        [0, 0, 'night'],
        [4, 59, 'night'],
        [5, 0, 'morning'],
        [11, 59, 'morning'],
        [12, 0, 'afternoon'],
        [17, 59, 'afternoon'],
        [18, 0, 'evening'],
        [21, 59, 'evening'],
        [22, 0, 'night'],
        [23, 59, 'night'],
    ]
    test.each(table)('%i:%i is %s', (hour, minute, expected) => {
        expect(greetingPeriod(at(hour, minute))).toBe(expected)
    })
})

describe('msUntilNextPeriod', () => {
    const HOUR = 3_600_000

    test('just before a boundary the wait is the remaining time', () => {
        expect(msUntilNextPeriod(at(11, 59, 30))).toBe(30_000)
    })

    test('inside a period the wait reaches the next start', () => {
        expect(msUntilNextPeriod(at(21))).toBe(HOUR)
    })

    test('after the night start the wait reaches the next day morning start', () => {
        expect(msUntilNextPeriod(at(23))).toBe(6 * HOUR)
    })

    test('after midnight the wait reaches the same day morning start', () => {
        expect(msUntilNextPeriod(at(2))).toBe(3 * HOUR)
    })

    test('on a boundary instant the wait is the full span to the following start', () => {
        expect(msUntilNextPeriod(at(12))).toBe(6 * HOUR)
        expect(msUntilNextPeriod(at(22))).toBe(7 * HOUR)
        expect(msUntilNextPeriod(at(5))).toBe(7 * HOUR)
    })

    test('the wait is never under one second', () => {
        expect(msUntilNextPeriod(new Date(2026, 5, 10, 11, 59, 59, 999))).toBe(1000)
        expect(msUntilNextPeriod(new Date(2026, 5, 10, 21, 59, 59, 500))).toBe(1000)
    })
})

describe('greetingKey', () => {
    test('maps the four periods to four distinct keys', () => {
        const keys = (['morning', 'afternoon', 'evening', 'night'] as const).map(greetingKey)
        expect(new Set(keys).size).toBe(4)
        expect(keys).toEqual(['homeGreetingMorning', 'homeGreetingAfternoon', 'homeGreetingEvening', 'homeGreetingNight'])
    })
})
