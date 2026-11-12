// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'

// The validator is browser code: it loads and judges a pack without any node API in a DOM environment.
describe('the validator in a browser environment', () => {
    test('imports and judges the empty pack in every area', async () => {
        const { lintAreaPack, THEME_AREAS } = await import('./index')
        for (const area of THEME_AREAS) expect(lintAreaPack(area, '').ok, area).toBe(true)
    })
})
