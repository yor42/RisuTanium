// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { lowPowerMarked } from './lowPower'

afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('data-low-power')
    root.classList.remove('nexus-low-power', 'rm')
})

describe('lowPowerMarked', () => {
    test('is false with neither marker', () => {
        expect(lowPowerMarked()).toBe(false)
        expect(lowPowerMarked(document.createElement('div'))).toBe(false)
    })

    test('is true for the data attribute', () => {
        const el = document.createElement('div')
        el.setAttribute('data-low-power', '')
        expect(lowPowerMarked(el)).toBe(true)
    })

    test('is true for the class', () => {
        const el = document.createElement('div')
        el.classList.add('nexus-low-power')
        expect(lowPowerMarked(el)).toBe(true)
    })

    test('defaults to the document root', () => {
        document.documentElement.setAttribute('data-low-power', '')
        expect(lowPowerMarked()).toBe(true)
    })

    test('reduced motion alone is not low power', () => {
        document.documentElement.classList.add('rm')
        expect(lowPowerMarked()).toBe(false)
    })

    test('a missing root is not low power', () => {
        expect(lowPowerMarked(null)).toBe(false)
    })
})
