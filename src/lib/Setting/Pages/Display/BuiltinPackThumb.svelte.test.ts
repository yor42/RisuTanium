// @vitest-environment jsdom

/**
 * The drawn thumbnails of the built-in packs: every shipped built-in has one, each is a decorative miniature on the
 * pack's own ground colour with no letter badge, and two tiles on one page never share a gradient id.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { BUILTIN_PACKS } from 'src/ts/themePack/builtins'
import BuiltinPackThumb, { hasBuiltinThumb } from './BuiltinPackThumb.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function draw(slug: string): SVGSVGElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(BuiltinPackThumb, { target, props: { slug } }))
    flushSync()
    return target.querySelector('svg')!
}

afterEach(() => {
    for (const app of mounted.splice(0)) {
        unmount(app)
    }
    document.body.innerHTML = ''
})

describe('built-in pack thumbnails', () => {
    test.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s has a drawn thumbnail on its ground colour', (slug, pack) => {
        expect(hasBuiltinThumb(slug)).toBe(true)
        const svg = draw(slug)
        expect(svg.getAttribute('data-thumb')).toBe(slug)
        expect(svg.getAttribute('aria-hidden')).toBe('true')
        expect(svg.querySelector('[data-part="tile-ground"]')!.getAttribute('fill')).toBe(pack.secondaryColor)
        expect(svg.querySelector('[data-part="tile-glyph"], [data-part="tile-plate"]')).toBeNull()
        // A miniature, not a single pattern: several shapes are drawn over the ground.
        expect(svg.querySelectorAll('rect, path, circle, line').length).toBeGreaterThan(10)
    })

    test('an unknown slug has no drawn thumbnail', () => {
        expect(hasBuiltinThumb('not-a-pack')).toBe(false)
        expect(hasBuiltinThumb('')).toBe(false)
    })

    test('two Origin Navy tiles reference their own gradients', () => {
        const first = draw('origin-navy')
        const second = draw('origin-navy')
        const ids = (svg: SVGSVGElement) => [...svg.querySelectorAll('[id]')].map((node) => node.id)
        expect(ids(first)).toHaveLength(2)
        expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([])
        for (const svg of [first, second]) {
            const refs = [...svg.querySelectorAll('*')].flatMap((node) => /^url\(#(.+)\)$/.exec(node.getAttribute('fill') ?? '')?.slice(1) ?? [])
            expect(refs.sort()).toEqual(ids(svg).sort())
        }
    })
})
