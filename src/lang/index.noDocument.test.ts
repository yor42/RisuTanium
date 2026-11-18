// @vitest-environment node
// `changeLanguage` runs in hosts without a document (server-side imports, workers) without throwing.
import { afterEach, expect, test } from 'vitest'
import { changeLanguage } from './index'

afterEach(() => {
    changeLanguage('en')
})

test('changeLanguage does not need a document', () => {
    expect(typeof document).toBe('undefined')
    expect(() => changeLanguage('ko')).not.toThrow()
})
