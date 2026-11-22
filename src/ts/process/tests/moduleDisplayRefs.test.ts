/**
 * The loader's reload rule for an install (moduleDisplayRefs.ts): a slot reloads the chat only when the displayed
 * origin references it, and the rule fails open. Guards: each pins a fail-open or matching branch the loader tests
 * reach only through a registered source.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { displayReferencesModule, setDisplayModuleRefSource } from '../moduleDisplayRefs'

afterEach(() => {
    setDisplayModuleRefSource(null)
    vi.restoreAllMocks()
})

describe('the reload rule for an installed module', () => {
    test('guard: with no source registered every install reloads, as before the rule existed', () => {
        expect(displayReferencesModule({ id: 'a' })).toBe(true)
    })

    test('guard: an id or a non-empty namespace in the references matches; anything else does not', () => {
        setDisplayModuleRefSource(() => ['a', 'ns-b'])
        expect(displayReferencesModule({ id: 'a' })).toBe(true)
        expect(displayReferencesModule({ id: 'b', namespace: 'ns-b' })).toBe(true)
        expect(displayReferencesModule({ id: 'c' })).toBe(false)
        expect(displayReferencesModule({ id: 'c', namespace: '' })).toBe(false)
    })

    test('guard: the references are read on every call, not cached', () => {
        let refs = ['a']
        setDisplayModuleRefSource(() => refs)
        expect(displayReferencesModule({ id: 'b' })).toBe(false)
        refs = ['b']
        expect(displayReferencesModule({ id: 'b' })).toBe(true)
    })

    test('guard: a source that throws reloads and logs the error', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        setDisplayModuleRefSource(() => { throw new Error('no selection') })
        expect(displayReferencesModule({ id: 'a' })).toBe(true)
        expect(logged).toHaveBeenCalledTimes(1)
    })
})
