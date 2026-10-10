// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { bindRail, type RailMachine } from './railBinding'

function stubMachine(calls: string[]): RailMachine {
    return {
        pointerDown: () => calls.push('pointerDown'),
        pointerMove: () => calls.push('pointerMove'),
        pointerUp: () => calls.push('pointerUp'),
        pointerCancel: () => calls.push('pointerCancel'),
        lostCapture: () => calls.push('lostCapture'),
        scrolled: () => calls.push('scrolled'),
        rectChanged: () => calls.push('rectChanged'),
        interrupt: () => calls.push('interrupt'),
        isTouchContextMenu: () => false,
        consumeClick: () => false,
        shouldPreventTouchMove: () => false,
        keyDown: () => {
            calls.push('keyDown')
            return false
        },
    }
}

describe('bindRail with a machine interface', () => {
    // G: a machine that is not a RailDrag drives the binding.
    test('G: forwards container, window and session events to the supplied machine', () => {
        const calls: string[] = []
        const el = document.createElement('div')
        document.body.appendChild(el)
        const binding = bindRail(el, stubMachine(calls))

        el.dispatchEvent(new Event('pointerdown'))
        el.dispatchEvent(new Event('scroll'))
        window.dispatchEvent(new Event('pointerup'))
        window.dispatchEvent(new Event('pointermove'))
        expect(calls).toEqual(['pointerDown', 'scrolled', 'pointerUp'])

        binding.setSession(true)
        window.dispatchEvent(new Event('pointermove'))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        window.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new Event('blur'))
        expect(calls.slice(3)).toEqual(['pointerMove', 'keyDown', 'rectChanged', 'interrupt'])

        binding.destroy()
        el.remove()
    })
})
