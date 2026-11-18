/**
 * Labels: (G) compatibility guard over a new module; backed by scratch mutants.
 */
import { describe, test, expect } from 'vitest'
import { wantsStreamUsage } from './streamUsageHosts'

describe('wantsStreamUsage (G)', () => {
    test('only the official OpenAI host', () => {
        expect(wantsStreamUsage('https://api.openai.com/v1/chat/completions')).toBe(true)
        expect(wantsStreamUsage('https://api.openai.com')).toBe(true)
    })

    test('other hosts, look-alikes and subdomains are refused', () => {
        expect(wantsStreamUsage('https://openrouter.ai/api/v1/chat/completions')).toBe(false)
        expect(wantsStreamUsage('https://api.openai.com.example.test/v1')).toBe(false)
        expect(wantsStreamUsage('https://example.test/api.openai.com')).toBe(false)
        expect(wantsStreamUsage('https://eu.api.openai.com/v1')).toBe(false)
        expect(wantsStreamUsage('http://localhost:8080/v1/chat/completions')).toBe(false)
    })

    test('an unparsable url is refused instead of throwing', () => {
        expect(wantsStreamUsage('')).toBe(false)
        expect(wantsStreamUsage('not a url')).toBe(false)
    })
})
