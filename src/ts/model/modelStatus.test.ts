/**
 * The status of a catalog model id is computed from a fork-only table and the local calendar day:
 * a deprecated row becomes retired on its shutdown day, a redirected row never changes with time,
 * and the `-response-api` twin follows its base while the `-vertex` twin never does.
 *
 * The status module is pure (no catalog, no database); the text helper reads the English strings. Clocks are plain objects with local getters (or fake
 * timers built from local components), so a UTC-based date string fails in every time zone.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    MODEL_STATUS_SOURCE_URLS,
    MODEL_STATUS_TABLE,
    buildModelStatusTable,
    type ModelStatusEntry,
    type ModelStatusRow,
} from './modelStatusTable'
import { isHiddenFromPicker, localDateString, modelIdStatus, resolveModelStatus, type ClockDate } from './modelStatus'
import { modelStatusTag, modelStatusWarning } from './modelStatusText'

/** A clock with only the local getters; `month` is 1-based here. */
function day(year: number, month: number, date: number): ClockDate {
    return { getFullYear: () => year, getMonth: () => month - 1, getDate: () => date }
}

function tableOf(...rows: ModelStatusRow[]): Readonly<Record<string, ModelStatusEntry>> {
    return buildModelStatusTable([rows])
}

const TODAY = day(2026, 10, 12)

afterEach(() => {
    vi.useRealTimers()
})

describe('localDateString', () => {
    test('zero-pads the month and the day from local getters', () => {
        expect(localDateString(day(2026, 9, 5))).toBe('2026-09-05')
        expect(localDateString(day(2026, 12, 31))).toBe('2026-12-31')
        expect(localDateString(day(2026, 1, 1))).toBe('2026-01-01')
    })

    test('an unpadded month or day never sorts after a later padded date', () => {
        const table = tableOf(['m', { kind: 'deprecated', date: '2026-10-12', source: 'openai' }])
        expect(resolveModelStatus(table, 'm', day(2026, 9, 5))).toEqual({ kind: 'deprecated', date: '2026-10-12' })
    })
})

describe('deprecated rows', () => {
    const table = tableOf(['m', { kind: 'deprecated', date: '2026-10-23', source: 'openai' }])

    test('are deprecated before the shutdown day, retired on it and after it', () => {
        expect(resolveModelStatus(table, 'm', day(2026, 10, 22))).toEqual({ kind: 'deprecated', date: '2026-10-23' })
        expect(resolveModelStatus(table, 'm', day(2026, 10, 23))).toEqual({ kind: 'retired', date: '2026-10-23' })
        expect(resolveModelStatus(table, 'm', day(2026, 10, 24))).toEqual({ kind: 'retired', date: '2026-10-23' })
        expect(resolveModelStatus(table, 'm', day(2027, 1, 1))).toEqual({ kind: 'retired', date: '2026-10-23' })
    })

    test('modelIdStatus reads the current local day when no clock is passed', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(2026, 9, 22, 12, 0, 0))
        expect(modelIdStatus('o1')).toEqual({ kind: 'deprecated', date: '2026-10-23' })
        vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0))
        expect(modelIdStatus('o1')).toEqual({ kind: 'retired', date: '2026-10-23' })
    })
})

describe('guard: unknown ids', () => {
    test.each(['', 'unknown-model', 'hf:::org/model', 'xcustom:::abc', 'pluginmodel:::x', 'constructor', '__proto__', 'toString'])(
        '%j is ok',
        (id) => {
            expect(modelIdStatus(id, { now: TODAY })).toEqual({ kind: 'ok' })
        })
})

describe('response-api twin', () => {
    test('follows the base row and flips on the same day', () => {
        const table = tableOf(
            ['base', { kind: 'deprecated', date: '2026-10-23', source: 'openai' }],
            ['gone', { kind: 'retired', source: 'openai' }],
        )
        expect(resolveModelStatus(table, 'base-response-api', day(2026, 10, 22))).toEqual({ kind: 'deprecated', date: '2026-10-23' })
        expect(resolveModelStatus(table, 'base-response-api', day(2026, 10, 23))).toEqual({ kind: 'retired', date: '2026-10-23' })
        expect(resolveModelStatus(table, 'gone-response-api', TODAY)).toEqual({ kind: 'retired' })
    })

    test('an explicit row on the twin wins over the base row', () => {
        const table = tableOf(
            ['base', { kind: 'retired', source: 'openai' }],
            ['base-response-api', { kind: 'deprecated', date: '2030-01-01', source: 'openai' }],
        )
        expect(resolveModelStatus(table, 'base-response-api', TODAY)).toEqual({ kind: 'deprecated', date: '2030-01-01' })
    })

    test('real rows: o1 and its twin are deprecated together, a twin without a base row is ok', () => {
        expect(modelIdStatus('o1', { now: TODAY })).toEqual({ kind: 'deprecated', date: '2026-10-23' })
        expect(modelIdStatus('o1-response-api', { now: TODAY })).toEqual({ kind: 'deprecated', date: '2026-10-23' })
        expect(modelIdStatus('gpt4o-response-api', { now: TODAY })).toEqual({ kind: 'ok' })
    })
})

describe('vertex twin', () => {
    test('never inherits the base row', () => {
        const table = tableOf(['base', { kind: 'retired', source: 'geminiApi' }])
        expect(resolveModelStatus(table, 'base-vertex', TODAY)).toEqual({ kind: 'ok' })
    })

    test('real rows keep their own lifecycle apart from the Gemini API entry', () => {
        expect(modelIdStatus('gemini-3.5-flash', { now: TODAY })).toEqual({ kind: 'redirected', target: 'gemini-3.6-flash' })
        expect(modelIdStatus('gemini-3.5-flash-vertex', { now: TODAY })).toEqual({ kind: 'ok' })
        expect(modelIdStatus('gemini-1.5-pro-002', { now: TODAY })).toEqual({ kind: 'retired', date: '2025-09-29' })
        expect(modelIdStatus('gemini-1.5-pro-002-vertex', { now: TODAY })).toEqual({ kind: 'retired', date: '2025-09-24' })
        expect(modelIdStatus('gemini-2.5-pro', { now: TODAY })).toEqual({ kind: 'ok' })
        expect(modelIdStatus('gemini-2.5-pro-vertex', { now: TODAY })).toEqual({ kind: 'deprecated', date: '2026-10-20' })
    })
})

describe('redirected rows', () => {
    test('are redirected with their target, not retired, and do not change with time', () => {
        expect(modelIdStatus('gemini-3.7-flash', { now: TODAY })).toEqual({ kind: 'redirected', target: 'gemini-3.8-flash' })
        expect(modelIdStatus('gemini-3.7-flash', { now: day(2031, 6, 1) })).toEqual({ kind: 'redirected', target: 'gemini-3.8-flash' })
    })
})

describe('status text', () => {
    test('a redirected id reads differently from a retired one and names the target', () => {
        const redirected = modelIdStatus('gemini-3.7-flash', { now: TODAY })
        const retired = modelIdStatus('claude-3-opus-20240229', { now: TODAY })
        expect(modelStatusTag(redirected)).toBe('now uses gemini-3.8-flash')
        expect(modelStatusTag(retired)).toBe('retired')
        expect(modelStatusWarning(redirected, 'Model X')).toContain('gemini-3.8-flash')
        expect(modelStatusWarning(redirected, 'Model X')).not.toBe(modelStatusWarning(retired, 'Model X'))
        expect(modelStatusWarning(retired, 'Model X')).toContain('Model X')
    })

    test('a deprecated id carries its date, and an ok id has no text', () => {
        const deprecated = modelIdStatus('claude-sonnet-4-5-20250929', { now: TODAY })
        expect(modelStatusTag(deprecated)).toBe('retires 2026-11-30')
        expect(modelStatusWarning(deprecated, 'Model X')).toContain('2026-11-30')
        expect(modelStatusTag({ kind: 'ok' })).toBeNull()
        expect(modelStatusWarning({ kind: 'ok' }, 'Model X')).toBeNull()
    })
})

describe('picker visibility', () => {
    test('retired and redirected are hidden, ok and deprecated are listed', () => {
        expect(isHiddenFromPicker({ kind: 'retired' })).toBe(true)
        expect(isHiddenFromPicker({ kind: 'retired', date: '2026-01-05' })).toBe(true)
        expect(isHiddenFromPicker({ kind: 'redirected', target: 't' })).toBe(true)
        expect(isHiddenFromPicker({ kind: 'deprecated', date: '2026-11-30' })).toBe(false)
        expect(isHiddenFromPicker({ kind: 'ok' })).toBe(false)
    })
})

describe('aliases and shipped rows', () => {
    test.each([
        'claude-3-5-sonnet-latest',
        'claude-3-7-sonnet-latest',
        'claude-3-5-haiku-latest',
        'gpt35_16k',
        'gemini-1.5-pro-latest',
        'open-mistral-nemo',
    ])('alias %s is retired', (id) => {
        expect(modelIdStatus(id, { now: TODAY }).kind).toBe('retired')
    })

    test('spot rows carry the provider date', () => {
        expect(modelIdStatus('claude-3-opus-20240229', { now: TODAY })).toEqual({ kind: 'retired', date: '2026-01-05' })
        expect(modelIdStatus('gpt-5.1', { now: TODAY })).toEqual({ kind: 'deprecated', date: '2027-04-01' })
        expect(modelIdStatus('gpt-5-2025-08-07', { now: TODAY })).toEqual({ kind: 'deprecated', date: '2026-12-11' })
        expect(modelIdStatus('novelai', { now: TODAY })).toEqual({ kind: 'retired' })
        expect(modelIdStatus('anthropic.claude-sonnet-4-20250514-v1:0', { now: day(2026, 10, 13) })).toEqual({ kind: 'deprecated', date: '2026-10-14' })
        expect(modelIdStatus('anthropic.claude-sonnet-4-20250514-v1:0', { now: day(2026, 10, 14) })).toEqual({ kind: 'retired', date: '2026-10-14' })
    })

    test.each(['gpt4_1106', 'gpt-5', 'o3', 'cohere-command-r', 'deepseek-v4-flash', 'gemini-3-flash-preview'])(
        'guard: unmarked %s stays ok',
        (id) => {
            expect(modelIdStatus(id, { now: TODAY })).toEqual({ kind: 'ok' })
        })
})

describe('table integrity', () => {
    const entries = Object.entries(MODEL_STATUS_TABLE)

    test('guard: the table is not empty', () => {
        expect(entries.length).toBeGreaterThan(100)
    })

    test('every date is a real calendar day in YYYY-MM-DD form', () => {
        for (const [id, entry] of entries) {
            if (entry.date === undefined) { continue }
            expect(entry.date, id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            const [y, m, d] = entry.date.split('-').map(Number)
            const probe = new Date(Date.UTC(y, m - 1, d))
            expect(`${probe.getUTCFullYear()}-${probe.getUTCMonth() + 1}-${probe.getUTCDate()}`, id).toBe(`${y}-${m}-${d}`)
        }
    })

    test('deprecated rows carry a date and redirected rows a distinct target', () => {
        for (const [id, entry] of entries) {
            if (entry.kind === 'deprecated') {
                expect(entry.date, id).toBeTruthy()
            }
            if (entry.kind === 'redirected') {
                expect(entry.target, id).toBeTruthy()
                expect(entry.target, id).not.toBe(id)
            }
        }
    })

    test('a redirect target is not itself redirected, so there are no chains', () => {
        for (const [id, entry] of entries) {
            if (entry.kind !== 'redirected') { continue }
            expect(MODEL_STATUS_TABLE[entry.target]?.kind, id).not.toBe('redirected')
        }
    })

    test('every row names a source with a documented https page', () => {
        for (const [id, entry] of entries) {
            expect(MODEL_STATUS_SOURCE_URLS[entry.source], id).toMatch(/^https:\/\//)
        }
    })

    test('a duplicate key across groups is an error naming the id', () => {
        const row: ModelStatusRow = ['dup-id', { kind: 'retired', source: 'anthropic' }]
        expect(() => buildModelStatusTable([[row], [row]])).toThrow(/dup-id/)
    })
})
