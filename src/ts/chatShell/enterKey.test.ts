import { describe, expect, test } from 'vitest'
import { createEnterKeyController } from './enterKey'

const plainEnter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }

describe('T11 Enter detection', () => {
    test('navigation and shortcuts set detection, text keys do not, touch and viewport drop clear it', () => {
        const controller = createEnterKeyController()
        const key = (name: string, ctrlKey = false) => controller.observeKey({ key: name, ctrlKey, altKey: false, isTrusted: true })
        key('Backspace')
        key('Enter')
        key('7')
        expect(controller.hardwareSeen).toBe(false)
        key('ArrowDown')
        expect(controller.shouldSend(plainEnter, 'auto')).toBe(true)
        controller.touch()
        expect(controller.hardwareSeen).toBe(false)
        key('m', true)
        controller.observeViewport(700, true)
        controller.observeViewport(550, true)
        expect(controller.hardwareSeen).toBe(true)
        controller.observeViewport(399, true)
        expect(controller.hardwareSeen).toBe(false)
        key('Tab')
        controller.observeViewport(200, false)
        expect(controller.hardwareSeen).toBe(true)
        controller.observeKey({ key: 'Home', ctrlKey: false, altKey: false, isTrusted: false })
        expect(controller.hardwareSeen).toBe(true)
    })

    test('isComposing, 229, shift and newline suppress Send; a plain Enter sends', () => {
        const controller = createEnterKeyController()
        controller.observeKey({ key: 'Tab', ctrlKey: false, altKey: false, isTrusted: true })
        expect(controller.shouldSend(plainEnter, 'send')).toBe(true)
        expect(controller.shouldSend({ ...plainEnter, isComposing: true }, 'send')).toBe(false)
        expect(controller.shouldSend({ ...plainEnter, keyCode: 229 }, 'send')).toBe(false)
        expect(controller.shouldSend({ ...plainEnter, shiftKey: true }, 'send')).toBe(false)
        expect(controller.shouldSend({ ...plainEnter, key: 'a' }, 'send')).toBe(false)
        expect(controller.shouldSend(plainEnter, 'newline')).toBe(false)
    })
})

describe('T4 IME keyCode', () => {
    test('229 never sends even when isComposing is false', () => {
        const controller = createEnterKeyController()
        expect(controller.shouldSend({ ...plainEnter, keyCode: 229 }, 'send')).toBe(false)
    })
})
