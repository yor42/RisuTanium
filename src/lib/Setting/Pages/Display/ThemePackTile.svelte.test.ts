// @vitest-environment jsdom

/**
 * The theme pack tile. Unit specs for a new component: it draws exactly the colours of the spec it is given, hides itself
 * from assistive technology, and uses theme tokens (classes, no hex) when the spec is neutral.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apngBytes, padPngTo, pngBytes, riffWebp, vp8Chunk, vp8xChunk, WEBP_ALPHA, WEBP_ANIMATED, WEBP_LOSSY } from 'src/ts/themePack/fixtures/imageBuilder'
import { tileSpec } from 'src/ts/themePack/tileDesign'
import ThemePackTile from './ThemePackTile.svelte'

/** The page store stand-in: stored bytes by key, every key read, and an optional gate that holds a read until released. */
const store = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    reads: [] as string[],
    gate: null as Promise<void> | null,
}))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        read: async (key: string) => {
            store.reads.push(key)
            if (store.gate !== null) {
                await store.gate
            }
            return { bytes: store.files.get(key) ?? null }
        },
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

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

    test('None draws an empty dashed frame crossed by a diagonal, in theme tokens, and no text', () => {
        const svg = draw(null)
        expect(part(svg, 'tile-none-mark').tagName.toLowerCase()).toBe('line')
        expect(part(svg, 'tile-none-frame').getAttribute('stroke-dasharray')).not.toBeNull()
        expect(part(svg, 'tile-none-frame').getAttribute('class')).toContain('stroke-darkborderc')
        expect(part(svg, 'tile-ground').getAttribute('class')).toContain('fill-bgcolor')
        expect(svg.querySelector('text')).toBeNull()
        expect(svg.getAttribute('aria-hidden')).toBe('true')
    })
})

describe('T3 a stored icon', () => {
    const KEY = `assets/tp-${'ab'.repeat(32)}.png`
    const KEY_WEBP = `assets/tp-${'cd'.repeat(32)}.webp`
    const spec = tileSpec({ seedKey: 'k', name: 'Alpha', main: '#3366ff', secondary: '#101820' })
    let created: Blob[] = []
    let revoked: string[] = []
    let counter = 0

    beforeEach(() => {
        store.files.clear()
        store.reads.length = 0
        store.gate = null
        created = []
        revoked = []
        counter = 0
        URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
            created.push(blob as Blob)
            counter += 1
            return `blob:icon-${counter}`
        })
        URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
    })

    /** Lets the loader's promise chain run to its end. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            flushSync()
        }
    }

    function drawIcon(icon: string | undefined, name = 'Alpha'): { target: HTMLElement, component: ReturnType<typeof mount> } {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const component = mount(ThemePackTile, { target, props: { spec, icon, name } })
        mounted.push(component)
        flushSync()
        return { target, component }
    }

    const imgOf = (target: HTMLElement): HTMLImageElement | null => target.querySelector('img')
    const patternShown = (target: HTMLElement): boolean => target.querySelector('svg')?.getAttribute('class')?.includes('hidden') === false

    test('T3-6: a valid icon is shown as an img with the pack name as alt text, cropped to the square, and the pattern is hidden', async () => {
        store.files.set(KEY, pngBytes(24, 16))
        const { target } = drawIcon(KEY, 'Pack Alpha')

        await settle()

        const img = imgOf(target)!
        expect(img.getAttribute('alt')).toBe('Pack Alpha')
        expect(img.getAttribute('src')).toBe('blob:icon-1')
        expect(img.getAttribute('class')).toContain('object-cover')
        expect(created).toHaveLength(1)
        expect(created[0].type).toBe('image/png')
        expect(patternShown(target)).toBe(false)
    })

    test('T3-6: a WebP icon is shown the same way', async () => {
        store.files.set(KEY_WEBP, WEBP_ALPHA)
        const { target } = drawIcon(KEY_WEBP)

        await settle()

        expect(imgOf(target)).not.toBeNull()
        expect(created[0].type).toBe('image/webp')
    })

    test('T3-6: the same URL is revoked when the tile unmounts', async () => {
        store.files.set(KEY, pngBytes(8, 8))
        const { component } = drawIcon(KEY)
        await settle()
        expect(revoked).toEqual([])

        unmount(component)
        mounted.splice(mounted.indexOf(component), 1)

        expect(revoked).toEqual(['blob:icon-1'])
    })

    test('T3-6: unmounting before the bytes arrive creates no URL at all', async () => {
        store.files.set(KEY, pngBytes(8, 8))
        let release: () => void = () => { }
        store.gate = new Promise<void>((resolve) => { release = resolve })
        const { component } = drawIcon(KEY)
        await settle()

        unmount(component)
        mounted.splice(mounted.indexOf(component), 1)
        release()
        await settle()

        expect(created).toEqual([])
        expect(revoked).toEqual([])
    })

    test('T3-6: when the img fails to decode, the pattern returns', async () => {
        store.files.set(KEY, pngBytes(8, 8))
        const { target } = drawIcon(KEY)
        await settle()

        imgOf(target)!.dispatchEvent(new Event('error'))
        flushSync()

        expect(imgOf(target)).toBeNull()
        expect(patternShown(target)).toBe(true)
    })

    test('a tile with no icon key reads nothing from the store and shows the pattern', async () => {
        const { target } = drawIcon(undefined)

        await settle()

        expect(store.reads).toEqual([])
        expect(imgOf(target)).toBeNull()
        expect(patternShown(target)).toBe(true)
    })

    test('a key with no stored bytes leaves the pattern', async () => {
        const { target } = drawIcon(KEY)

        await settle()

        expect(imgOf(target)).toBeNull()
        expect(created).toEqual([])
        expect(patternShown(target)).toBe(true)
    })

    test.each([
        ['a 30000 x 30000 header', KEY, pngBytes(1, 1, { declaredWidth: 30000, declaredHeight: 30000 })],
        ['an APNG', KEY, apngBytes(8, 8)],
        ['a PNG of 262145 bytes', KEY, padPngTo(pngBytes(8, 8), 262145)],
        ['WebP bytes under a .png key', KEY, WEBP_LOSSY],
        ['an animated WebP', KEY_WEBP, WEBP_ANIMATED],
        ['a 600 x 600 WebP', KEY_WEBP, riffWebp([vp8xChunk(600, 600), vp8Chunk(600, 600)])],
    ])('T3-6h: stored %s under a valid key gives no img, no object URL, and the pattern', async (_label, key, bytes) => {
        store.files.set(key, bytes)
        const { target } = drawIcon(key)

        await settle()

        expect(imgOf(target)).toBeNull()
        expect(created).toEqual([])
        expect(patternShown(target)).toBe(true)
    })

    test('T3-6h: a record that names a user asset is never read, and shows the pattern', async () => {
        const userKey = 'assets/6f2f1c0e9e5d4c8a.png'
        store.files.set(userKey, pngBytes(8, 8))
        const { target } = drawIcon(userKey)

        await settle()

        expect(store.reads).toEqual([])
        expect(created).toEqual([])
        expect(imgOf(target)).toBeNull()
        expect(patternShown(target)).toBe(true)
    })
})
