// @vitest-environment jsdom

/**
 * The theme pack tile. Unit specs for a new component: it draws exactly the colours of the spec it is given, hides itself
 * from assistive technology, and uses theme tokens (classes, no hex) when the spec is neutral.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { tileSpec } from 'src/ts/themePack/tileDesign'
import ThemePackTile from './ThemePackTile.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function draw(spec: ReturnType<typeof tileSpec> | null): SVGSVGElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ThemePackTile, { target, props: { spec } }))
    flushSync()
    return target.firstElementChild as SVGSVGElement
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

function part(svg: Element, name: string): Element {
    return svg.querySelector(`[data-part="${name}"]`)!
}

describe('T1-10 a coloured tile', () => {
    test('the svg is the root, hidden from assistive technology, and ignores forced colours', () => {
        const svg = draw(tileSpec({ seedKey: 'k', name: 'Alpha', main: '#3366ff', secondary: '#101820' }))
        expect(svg.tagName.toLowerCase()).toBe('svg')
        expect(svg.getAttribute('aria-hidden')).toBe('true')
        expect(svg.getAttribute('style')).toContain('forced-color-adjust:none')
        expect(svg.getAttribute('viewBox')).toBe('0 0 64 64')
    })

    test('the ground, plate, glyph and pattern carry the spec colours', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Alpha', main: '#3366ff', secondary: '#101820' })
        const svg = draw(spec)
        expect(spec.ground).toBe('#101820')
        expect(part(svg, 'tile-ground').getAttribute('fill')).toBe(spec.ground)
        const plate = part(svg, 'tile-plate')
        expect(plate.getAttribute('fill')).toBe(spec.ground)
        expect(plate.getAttribute('stroke')).toBe(spec.ink)
        const glyph = part(svg, 'tile-glyph')
        expect(glyph.getAttribute('fill')).toBe(spec.glyphInk)
        expect(glyph.textContent).toBe('A')
        const pattern = part(svg, 'tile-pattern')
        expect(pattern.getAttribute('fill')).toBe(spec.ink)
        expect(pattern.getAttribute('stroke')).toBe(spec.ink)
    })

    test('a tile with no letter draws no plate and no glyph', () => {
        const svg = draw(tileSpec({ seedKey: 'k', name: ' ', main: '#3366ff', secondary: '#101820' }))
        expect(svg.querySelector('[data-part="tile-plate"]')).toBeNull()
        expect(svg.querySelector('text')).toBeNull()
    })
})

describe('T1-11 clash, neutral and None', () => {
    test('a clashing pair draws the adjusted ink and an extreme glyph, not the main colour', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Alpha', main: '#777777', secondary: '#808080' })
        const svg = draw(spec)
        expect(spec.ink).not.toBe('#777777')
        expect(part(svg, 'tile-pattern').getAttribute('fill')).toBe(spec.ink)
        expect(part(svg, 'tile-plate').getAttribute('stroke')).toBe(spec.ink)
        expect(part(svg, 'tile-glyph').getAttribute('fill')).toBe(spec.glyphInk)
        expect(spec.glyphInk).toMatch(/^#(000000|ffffff)$/)
    })

    test('a neutral tile is styled by theme classes and has no hex attribute anywhere', () => {
        const svg = draw(tileSpec({ seedKey: 'k', name: 'Alpha' }))
        expect(part(svg, 'tile-ground').getAttribute('class')).toContain('fill-darkbg')
        expect(part(svg, 'tile-pattern').getAttribute('class')).toContain('fill-textcolor2')
        expect(part(svg, 'tile-pattern').getAttribute('opacity')).toBe('0.45')
        expect(part(svg, 'tile-plate').getAttribute('class')).toContain('fill-bgcolor')
        expect(part(svg, 'tile-plate').getAttribute('class')).toContain('stroke-borderc')
        expect(part(svg, 'tile-glyph').getAttribute('class')).toContain('fill-textcolor')
        expect(svg.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    })

    test('None draws a diagonal and no text', () => {
        const svg = draw(null)
        expect(part(svg, 'tile-none-mark').tagName.toLowerCase()).toBe('line')
        expect(part(svg, 'tile-ground').getAttribute('class')).toContain('fill-bgcolor')
        expect(svg.querySelector('text')).toBeNull()
        expect(svg.getAttribute('aria-hidden')).toBe('true')
    })
})
