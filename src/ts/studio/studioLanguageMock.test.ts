/**
 * `studioLanguageMock` answers every function-valued top-level key of the English locale with a function, so a component
 * test that renders a newly added argument key does not call the key string instead.
 */
import { describe, test, expect } from 'vitest'
import { languageEnglish } from 'src/lang/en'
import { studioLanguageMock } from './studioFixtures.test-helpers'

describe('studioLanguageMock', () => {
    test('new contract: every function-valued English key is a function in the mock, answering with the key and its arguments', () => {
        const mock = studioLanguageMock()
        const functionKeys = Object.entries(languageEnglish).filter(([, value]) => typeof value === 'function').map(([key]) => key)

        expect(functionKeys.length).toBeGreaterThan(0)
        expect(functionKeys.filter((key) => typeof mock[key] !== 'function')).toEqual([])
        expect((mock.studioTgDeleted as (label: string) => string)('Mood')).toBe('studioTgDeleted(Mood)')
    })

    test('guard: a string key answers with its own key', () => {
        const mock = studioLanguageMock()

        expect(mock.studioLoreTestTitle).toBe('studioLoreTestTitle')
    })
})
