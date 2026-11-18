// @vitest-environment node
// The colours a pack's own chat.css declares for its tile: only unconditional :root or html declarations of the accent and
// canvas count, the app's default tokens only resolve var() chains, and nothing here ever throws.
import { describe, expect, it, vi } from 'vitest'
import { deriveTileColours } from './tileColours'

describe('T2b-3 deriveTileColours', () => {
    it('reads the accent as main and the canvas as secondary, lower-case #rrggbb', () => {
        expect(deriveTileColours(':root{--nexus-accent:#3366FF;--nexus-canvas:#101820}')).toEqual({ main: '#3366ff', secondary: '#101820' })
    })

    it('resolves rgb(var(--nexus-accent-rgb)) through the sheet and, failing that, the app defaults', () => {
        expect(deriveTileColours(':root{--nexus-accent-rgb:107 63 24;--nexus-accent:rgb(var(--nexus-accent-rgb));--nexus-canvas:#b2c7da}')).toEqual({ main: '#6b3f18', secondary: '#b2c7da' })
        // The default --nexus-accent-rgb (56 217 255) serves only to resolve the chain.
        expect(deriveTileColours(':root{--nexus-accent:rgb(var(--nexus-accent-rgb))}')).toEqual({ main: '#38d9ff' })
    })

    it('follows a var() with a fallback and a chain of the sheet\'s own tokens', () => {
        expect(deriveTileColours(':root{--brand:#112233;--nexus-accent:var(--brand);--nexus-canvas:var(--missing,#445566)}')).toEqual({ main: '#112233', secondary: '#445566' })
    })

    it('counts html as well as :root, in any case, and the last unconditional declaration wins', () => {
        expect(deriveTileColours('HTML{--nexus-accent:#111111}:ROOT{--nexus-accent:#222222}')).toEqual({ main: '#222222' })
        expect(deriveTileColours(':root{--nexus-accent:#111111}html{--nexus-accent:#222222}')).toEqual({ main: '#222222' })
    })

    it('ignores declarations inside an at-rule and under any other selector', () => {
        expect(deriveTileColours('@media (min-width:1px){:root{--nexus-accent:#111111}}@supports (color:red){:root{--nexus-canvas:#222222}}@layer x{:root{--nexus-accent:#333333}}')).toEqual({})
        expect(deriveTileColours(':root[data-layout="a"]{--nexus-accent:#111111}.x{--nexus-canvas:#222222}:root,html{--nexus-accent:#444444}')).toEqual({})
    })

    it('gives no field for a token the sheet does not declare, whatever the app default is, and no own undefined', () => {
        const none = deriveTileColours(':root{--nexus-text:#ffffff}')
        expect(none).toEqual({})
        expect(Object.keys(none)).toEqual([])
        const onlyMain = deriveTileColours(':root{--nexus-accent:#3366ff}')
        expect(Object.keys(onlyMain)).toEqual(['main'])
        expect(deriveTileColours('')).toEqual({})
    })

    it('leaves a field out when its value is not a concrete colour', () => {
        expect(deriveTileColours(':root{--nexus-accent:var(--nowhere);--nexus-canvas:currentcolor}')).toEqual({})
        expect(deriveTileColours(':root{--nexus-accent:color-mix(in oklch,red,blue);--nexus-canvas:#101820}')).toEqual({ secondary: '#101820' })
    })

    it('leaves secondary out when the canvas is translucent, and lays a translucent accent over an opaque canvas', () => {
        expect(deriveTileColours(':root{--nexus-canvas:rgb(0 0 0 / 0.5);--nexus-accent:#ffffff}')).toEqual({ main: '#ffffff' })
        expect(deriveTileColours(':root{--nexus-canvas:#000000;--nexus-accent:rgb(255 255 255 / 0.5)}')).toEqual({ main: '#808080', secondary: '#000000' })
        expect(deriveTileColours(':root{--nexus-accent:rgb(255 255 255 / 0.5)}')).toEqual({})
    })

    it('reads a resolved color-mix', () => {
        expect(deriveTileColours(':root{--nexus-accent:color-mix(in srgb,#ffffff 50%,#000000)}')).toEqual({ main: '#808080' })
    })

    it('T2b-11: a throwing walker gives {} and never throws', async () => {
        vi.resetModules()
        vi.doMock('./csslit', () => ({ decls: () => { throw new Error('walker') } }))
        try {
            const { deriveTileColours: guarded } = await import('./tileColours')
            expect(guarded(':root{--nexus-accent:#3366ff}')).toEqual({})
        } finally {
            vi.doUnmock('./csslit')
            vi.resetModules()
        }
    })
})
