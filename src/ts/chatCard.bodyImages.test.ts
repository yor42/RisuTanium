// @vitest-environment jsdom

/**
 * The body rebuild's image collector in a second DOM implementation: a local image becomes a placeholder
 * that carries no address, and the collector holds the placeholder with the address to fetch.
 */
import { describe, expect, test } from 'vitest'
import { captureCardTheme, createInertDocument, rebuildBody, type BodyImageSlot } from './chatCard'

const ORIGIN = 'http://localhost:3000'
const theme = captureCardTheme(() => '')
const env = { origin: ORIGIN, isTauri: false }

describe('rebuildBody with an image collector', () => {
    test('a local image is a placeholder without an address, collected with its resolved address', () => {
        const slots: BodyImageSlot[] = []
        const out = rebuildBody('<p>a <img src="/api/asset/6162" alt="smile" style="max-width:10px"> b</p>', theme, createInertDocument(), env, slots)

        expect(slots).toHaveLength(1)
        expect(slots[0].src).toBe('http://localhost:3000/api/asset/6162')
        const placeholder = out.querySelector('img')!
        expect(placeholder).toBe(slots[0].element)
        expect(placeholder.hasAttribute('src')).toBe(false)
        expect(placeholder.getAttribute('alt')).toBe('smile')
        expect(placeholder.style.getPropertyValue('max-width')).toBe('100%')
    })

    test('a relative address and a data address are collected as the card would fetch them', () => {
        const slots: BodyImageSlot[] = []
        rebuildBody('<img src="api/asset/x"><img src=" data:image/png;base64,AAAA ">', theme, createInertDocument(), env, slots)

        expect(slots.map((slot) => slot.src)).toEqual(['http://localhost:3000/api/asset/x', 'data:image/png;base64,AAAA'])
    })

    test('an outside, dropped or hidden image is not collected', () => {
        const slots: BodyImageSlot[] = []
        const out = rebuildBody('<img src="https://x.example/a.png"><img src="/proxy2?url=x"><img hidden src="/api/asset/a"><img>', theme, createInertDocument(), env, slots)

        expect(slots).toEqual([])
        expect(Array.from(out.querySelectorAll('img')).map((image) => image.getAttribute('src'))).toEqual(['https://x.example/a.png'])
    })

    test('without a collector a local image is left out as before', () => {
        const out = rebuildBody('<p><img src="/api/asset/6162"></p>', theme, createInertDocument(), env)

        expect(out.querySelector('img')).toBeNull()
    })
})
