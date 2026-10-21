import { describe, expect, test } from 'vitest'
import { normalizeOnboarding } from 'src/ts/onboardingData'

/**
 * `normalizeOnboarding` is the only gate between an imported card and `character.onboarding`; it runs with an injected
 * id source, so every expectation here is exact.
 *
 * Titles beginning "guard:" pin the coercions and defaults a card relies on.
 */

function idSource() {
    let n = 0
    return () => `id-${++n}`
}

describe('normalizeOnboarding', () => {
    test.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'form'],
        ['a number', 7],
        ['false', false],
    ])('guard: %s is not onboarding data', (_label, raw) => {
        expect(normalizeOnboarding(raw, idSource())).toBeUndefined()
    })

    test('guard: an empty object becomes a disabled, empty form onboarding', () => {
        expect(normalizeOnboarding({}, idSource())).toEqual({
            enabled: false,
            mode: 'form',
            title: '',
            description: '',
            html: '',
            floatingButton: false,
            questions: [],
        })
    })

    test('guard: only the literal true enables, and only the literal html mode selects html', () => {
        expect(normalizeOnboarding({ enabled: 'true', floatingButton: 1, mode: 'HTML' }, idSource())).toMatchObject({
            enabled: false,
            floatingButton: false,
            mode: 'form',
        })
        expect(normalizeOnboarding({ enabled: true, floatingButton: true, mode: 'html' }, idSource())).toMatchObject({
            enabled: true,
            floatingButton: true,
            mode: 'html',
        })
    })

    test('guard: non-string text fields become empty strings', () => {
        expect(normalizeOnboarding({ title: 5, description: null, html: ['x'] }, idSource())).toMatchObject({
            title: '',
            description: '',
            html: '',
        })
    })

    test('guard: a question is coerced field by field, unknown fields are dropped and a missing id is generated', () => {
        const result = normalizeOnboarding({
            questions: [
                {
                    id: 'keep',
                    title: 'Pick',
                    description: 'One',
                    type: 'multiple',
                    varName: 'v1',
                    required: true,
                    placeholder: 'p',
                    options: [{ label: 'A', value: 'a', extra: 1 }],
                    unknown: 'dropped',
                },
                { title: 'No id', type: 'bogus', required: 'yes', options: 'not-an-array' },
                { id: 7, type: 'text', varName: 3, options: [null, 'x', { label: 9, value: 'v' }] },
            ],
        }, idSource())
        expect(result?.questions).toEqual([
            {
                id: 'keep',
                title: 'Pick',
                description: 'One',
                type: 'multiple',
                varName: 'v1',
                required: true,
                placeholder: 'p',
                options: [{ label: 'A', value: 'a' }],
            },
            {
                id: 'id-1',
                title: 'No id',
                description: '',
                type: 'single',
                varName: '',
                required: false,
                placeholder: '',
                options: [],
            },
            {
                id: 'id-2',
                title: '',
                description: '',
                type: 'text',
                varName: '',
                required: false,
                placeholder: '',
                options: [{ label: '', value: 'v' }],
            },
        ])
    })

    test('guard: non-object questions are dropped and a non-array questions field is empty', () => {
        expect(normalizeOnboarding({ questions: [null, 'q', 4, { title: 'ok' }] }, idSource())?.questions).toHaveLength(1)
        expect(normalizeOnboarding({ questions: 'nope' }, idSource())?.questions).toEqual([])
    })

    test('guard: the default id source yields distinct non-empty ids', () => {
        const result = normalizeOnboarding({ questions: [{}, {}] })
        const ids = result?.questions.map((q) => q.id) ?? []
        expect(ids).toHaveLength(2)
        expect(ids[0]).toBeTruthy()
        expect(ids[0]).not.toBe(ids[1])
    })
})
