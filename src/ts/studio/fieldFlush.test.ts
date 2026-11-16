// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushStudioFields, registerStudioField, type FieldFlushReason } from './fieldFlush'

const removers: (() => void)[] = []

function register(flush: (reason: FieldFlushReason) => void): void {
    removers.push(registerStudioField(flush))
}

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

afterEach(() => {
    for (const remove of removers.splice(0)) remove()
    setVisibility('visible')
    vi.restoreAllMocks()
})

describe('FF-U1 the Studio field registry', () => {
    test('fields flush in registration order with the reason', () => {
        const calls: string[] = []
        register((reason) => calls.push(`a:${reason}`))
        register((reason) => calls.push(`b:${reason}`))
        flushStudioFields('leave')
        expect(calls).toEqual(['a:leave', 'b:leave'])
    })

    test('a throwing flush does not stop the next one', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const calls: string[] = []
        register(() => { throw new Error('boom') })
        register(() => calls.push('b'))
        flushStudioFields('hide')
        expect(calls).toEqual(['b'])
    })

    test('the capture listeners exist only while a field is registered', () => {
        const add = vi.spyOn(window, 'addEventListener')
        const remove = vi.spyOn(window, 'removeEventListener')
        const first = registerStudioField(() => {})
        const second = registerStudioField(() => {})
        const added = add.mock.calls.filter(([type]) => type === 'visibilitychange' || type === 'pagehide')
        expect(added.map(([type]) => type).sort()).toEqual(['pagehide', 'visibilitychange'])
        for (const call of added) expect(call[2]).toBe(true)
        first()
        expect(remove.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(0)
        second()
        second()
        expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1)
        expect(remove.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(1)
    })

    test('hide while a field is registered: visibilitychange to hidden and pagehide flush with "hide"', () => {
        const calls: string[] = []
        register((reason) => calls.push(reason))
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        window.dispatchEvent(new Event('pagehide'))
        expect(calls).toEqual(['hide', 'hide'])
    })

    test('visibilitychange while visible flushes nothing', () => {
        const calls: string[] = []
        register((reason) => calls.push(reason))
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        expect(calls).toEqual([])
    })

    test('the hide flush runs before a bubbling listener on the document and on the window', () => {
        const order: string[] = []
        register(() => order.push('field'))
        const docListener = (): void => { order.push('doc') }
        const winListener = (): void => { order.push('win') }
        document.addEventListener('visibilitychange', docListener)
        window.addEventListener('pagehide', winListener)
        try {
            setVisibility('hidden')
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
            window.dispatchEvent(new Event('pagehide'))
        } finally {
            document.removeEventListener('visibilitychange', docListener)
            window.removeEventListener('pagehide', winListener)
        }
        expect(order).toEqual(['field', 'doc', 'field', 'win'])
    })

    test('after the last field unregisters, hide events flush nothing', () => {
        const calls: string[] = []
        const remove = registerStudioField((reason) => calls.push(reason))
        remove()
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        window.dispatchEvent(new Event('pagehide'))
        expect(calls).toEqual([])
    })
})
