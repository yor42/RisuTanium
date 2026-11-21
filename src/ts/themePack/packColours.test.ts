// @vitest-environment node
// T7: the default scheme of a theme pack. The core gate (MC-3001), the base fill (MC-3004), the nine mappings, `type` by
// luminance and `sameScheme`. The four built-in pins are an independent composite calculation, not the function's output.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_PACKS } from './builtins'
import { decls } from './csslit'
import { judgeAreaSheet } from './index'
import { baseTokenLayers, packDefaultScheme, sameScheme } from './packColours'

const canonicalOf = (css: string): string => judgeAreaSheet('chat', css).canonical
const CORE = '--nexus-canvas:#112233;--nexus-surface:#223344;--nexus-text:#ffffff'

describe('T7 packDefaultScheme: the built-ins', () => {
    // Composited by hand: each translucent colour over the pack's canvas, the canvas over black.
    const PINS: Record<string, unknown> = {
        'origin-navy': { bgcolor: '#21222c', darkbg: '#282a38', darkbutton: '#2f3446', darkBorderc: '#363c52', borderc: '#8be9fd', textcolor: '#f8f8f2', textcolor2: '#9aa5c8', selected: '#343746', draculared: '#ff5555', type: 'dark' },
        'banana-cocoa': { bgcolor: '#b2c7da', darkbg: '#dce6ee', darkbutton: '#a6b9cb', darkBorderc: '#a0b3c4', borderc: '#6b3f18', textcolor: '#191919', textcolor2: '#46505b', selected: '#fffbe0', draculared: '#c62828', type: 'light' },
        'scratch-white': { bgcolor: '#fdfdfa', darkbg: '#f5f5f2', darkbutton: '#ececea', darkBorderc: '#e0e0de', borderc: '#1f4aa8', textcolor: '#2b2e34', textcolor2: '#545a64', selected: '#fffef5', draculared: '#b3261e', type: 'light' },
        'office-sheet': { bgcolor: '#f3f4f6', darkbg: '#ebecee', darkbutton: '#e4e5e8', darkBorderc: '#d1d3d5', borderc: '#1a55ba', textcolor: '#1f2328', textcolor2: '#50565f', selected: '#ffffff', draculared: '#b42318', type: 'light' },
    }
    for (const pack of BUILTIN_PACKS) {
        it(`${pack.slug} gives its pinned scheme`, () => {
            const scheme = packDefaultScheme(canonicalOf(pack.chatCss), pack.modes.length === 1 && pack.modes[0] === 'light' ? 'light' : 'dark')
            expect(scheme).toEqual(PINS[pack.slug])
        })
    }
})

describe('T7 packDefaultScheme: the core gate (MC-3001)', () => {
    it('a pack that declares the three core colours has a scheme', () => {
        expect(packDefaultScheme(`:root{${CORE}}`, 'dark')).not.toBeNull()
    })

    it('a missing core colour gives null, whichever one it is', () => {
        expect(packDefaultScheme(':root{--nexus-canvas:#112233;--nexus-text:#ffffff}', 'dark')).toBeNull()
        expect(packDefaultScheme(':root{--nexus-surface:#223344;--nexus-text:#ffffff}', 'dark')).toBeNull()
        expect(packDefaultScheme(':root{--nexus-canvas:#112233;--nexus-surface:#223344}', 'dark')).toBeNull()
    })

    it('a pack that declares only an accent and part colours has no scheme', () => {
        expect(packDefaultScheme(':root{--nexus-accent:#3366ff}[data-part="chat-send"]{color:#fff}', 'dark')).toBeNull()
        expect(packDefaultScheme('', 'dark')).toBeNull()
    })

    it('a core colour inside an at-rule, under another selector or in a selector list does not count', () => {
        expect(packDefaultScheme(`@media (min-width:1px){:root{${CORE}}}`, 'dark')).toBeNull()
        expect(packDefaultScheme(`@layer x{:root{${CORE}}}`, 'dark')).toBeNull()
        expect(packDefaultScheme(`:root[data-layout="a"]{${CORE}}`, 'dark')).toBeNull()
        expect(packDefaultScheme(`:root,html{${CORE}}`, 'dark')).toBeNull()
        expect(packDefaultScheme(`:root{--nexus-canvas:#112233;--nexus-text:#ffffff}@media (min-width:1px){:root{--nexus-surface:#223344}}`, 'dark')).toBeNull()
    })

    it('html counts like :root, in any case, and the last declaration wins', () => {
        expect(packDefaultScheme(`HTML{${CORE}}`, 'dark')?.bgcolor).toBe('#112233')
        expect(packDefaultScheme(`:root{${CORE}}html{--nexus-canvas:#445566}`, 'dark')?.bgcolor).toBe('#445566')
    })

    it('a core colour that resolves through the pack counts; one that does not resolve gives null', () => {
        expect(packDefaultScheme(':root{--pack-bg:#101820;--nexus-canvas:var(--pack-bg);--nexus-surface:#202830;--nexus-text:#ffffff}', 'dark')?.bgcolor).toBe('#101820')
        expect(packDefaultScheme(':root{--nexus-canvas:var(--pack-missing);--nexus-surface:#202830;--nexus-text:#ffffff}', 'dark')).toBeNull()
        expect(packDefaultScheme(':root{--nexus-canvas:#112233;--nexus-surface:currentcolor;--nexus-text:#ffffff}', 'dark')).toBeNull()
        expect(packDefaultScheme(':root{--nexus-canvas:#112233;--nexus-surface:#223344;--nexus-text:color-mix(in lch,red,blue)}', 'dark')).toBeNull()
    })

    it('a throwing walker gives null and never throws', async () => {
        vi.resetModules()
        vi.doMock('./csslit', () => ({ decls: () => { throw new Error('walker') } }))
        try {
            const { packDefaultScheme: guarded } = await import('./packColours')
            expect(guarded(`:root{${CORE}}`, 'dark')).toBeNull()
        } finally {
            vi.doUnmock('./csslit')
            vi.resetModules()
        }
    })
})

describe('T7 packDefaultScheme: the base fill (MC-3004, A24) and the mappings', () => {
    it('a pack that sets only the core tokens takes the other six from the dark base that colour mode paints', () => {
        // Base values: raised rgb(255 255 255 / 0.06), edge rgb(255 255 255 / 0.07), muted rgb(255 255 255 / 0.55), accent 56 217 255, toast #1c1e45, danger 255 107 129, over #112233.
        expect(packDefaultScheme(`:root{${CORE}}`, 'dark')).toEqual({
            bgcolor: '#112233', darkbg: '#223344', darkbutton: '#1f2f3f', darkBorderc: '#223141', borderc: '#38d9ff', textcolor: '#ffffff', textcolor2: '#949ca3', selected: '#1c1e45', draculared: '#ff6b81', type: 'dark',
        })
    })

    it('a light pack takes them from the light base instead', () => {
        const scheme = packDefaultScheme(`:root{${CORE}}`, 'light')
        // Light base: accent 61 75 168, danger 179 38 60, toast #ffffff.
        expect(scheme).toMatchObject({ borderc: '#3d4ba8', draculared: '#b3263c', selected: '#ffffff' })
    })

    it('a token the pack sets to something that is not a concrete colour falls back to its base value', () => {
        const scheme = packDefaultScheme(`:root{${CORE};--nexus-edge:color-mix(in lch,red,blue)}`, 'dark')
        expect(scheme?.darkBorderc).toBe('#223141')
    })

    it('borderc comes from the accent, rgb(var(--nexus-accent-rgb)) included', () => {
        expect(packDefaultScheme(`:root{${CORE};--nexus-accent:#3366ff}`, 'dark')?.borderc).toBe('#3366ff')
        expect(packDefaultScheme(`:root{${CORE};--nexus-accent-rgb:107 63 24}`, 'dark')?.borderc).toBe('#6b3f18')
        expect(packDefaultScheme(`:root{${CORE};--nexus-edge-strong:#abcdef}`, 'dark')?.borderc).toBe('#38d9ff')
    })

    it('a translucent canvas is laid over black and every other colour over the canvas', () => {
        const scheme = packDefaultScheme(':root{--nexus-canvas:rgb(255 255 255 / 0.5);--nexus-surface:rgb(0 0 0 / 0.5);--nexus-text:#ffffff}', 'dark')
        expect(scheme?.bgcolor).toBe('#808080')
        expect(scheme?.darkbg).toBe('#404040')
    })

    it('type follows the luminance of the canvas, not the base', () => {
        const typeOf = (canvas: string, base: 'dark' | 'light'): string | undefined => packDefaultScheme(`:root{--nexus-canvas:${canvas};--nexus-surface:#223344;--nexus-text:#ffffff}`, base)?.type
        expect(typeOf('#ffffff', 'dark')).toBe('light')
        expect(typeOf('#000000', 'light')).toBe('dark')
        expect(typeOf('#808080', 'dark')).toBe('light')
        expect(typeOf('#707070', 'light')).toBe('dark')
    })

    it('writes lower-case #rrggbb throughout', () => {
        const scheme = packDefaultScheme(':root{--nexus-canvas:#ABCDEF;--nexus-surface:#223344;--nexus-text:#FFEEDD}', 'dark')
        for (const [key, value] of Object.entries(scheme ?? {})) {
            if (key !== 'type') expect(value).toMatch(/^#[0-9a-f]{6}$/)
        }
    })
})

describe('T7 base layers are pinned against the stylesheets they stand for', () => {
    const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
    const ruleOf = (css: string, selector: string): Map<string, string> => {
        const map = new Map<string, string>()
        for (const d of decls(css)) {
            if (d.prop.startsWith('--') && d.ctx.at.length === 0 && d.ctx.selector.trim() === selector) map.set(d.prop, d.value.replace(/\s+/g, ' ').trim())
        }
        return map
    }
    const squash = (map: ReadonlyMap<string, string>): Map<string, string> => new Map([...map].map(([name, value]) => [name, value.replace(/\s+/g, ' ').trim()]))

    it('the light layer equals chat-light-base.css declaration by declaration, without the pattern labels', () => {
        const sheet = ruleOf(read('src/styles/chat-light-base.css'), ':root:where([data-theme-pack-base="light"])')
        for (const name of [...sheet.keys()]) if (name.startsWith('--pattern-')) sheet.delete(name)
        expect(sheet.size).toBeGreaterThan(40)
        expect(squash(baseTokenLayers().light)).toEqual(sheet)
    })

    it('the dark layer holds, for every colour token a scheme field reads, the value the app base blocks restore', () => {
        // The app stylesheets cannot be imported with ?raw under Vitest (it empties a CSS file not listed in the config), so they are read here.
        const sheet = ruleOf(read('src/styles/nexus-tokens.css'), ':root:where([data-theme-pack-base])')
        for (const [name, value] of ruleOf(read('src/styles/chat-pack-base.css'), ':root:where([data-theme-pack-base])')) sheet.set(name, value)
        expect(sheet.size).toBeGreaterThan(20)
        const dark = squash(baseTokenLayers().dark)
        const READ = ['--nexus-canvas', '--nexus-surface', '--nexus-surface-raised', '--nexus-edge', '--nexus-accent', '--nexus-accent-rgb', '--nexus-text', '--nexus-text-muted', '--nexus-danger', '--nexus-danger-rgb', '--color-surface-toast']
        for (const name of READ) {
            expect(sheet.has(name), `${name} in the app base`).toBe(true)
            expect(dark.get(name), name).toBe(sheet.get(name))
        }
        expect(dark.get('--nexus-canvas')).toBe('#00011c')
    })
})

describe('T7 sameScheme', () => {
    const scheme = { bgcolor: '#151836', darkbg: '#0f112a', borderc: '#6f7fc8', selected: '#2f3670', draculared: '#ff6b81', textcolor: '#eef0ff', textcolor2: '#a6b0d4', darkBorderc: '#3c4478', darkbutton: '#242a52', type: 'dark' }

    it('is true for equal schemes and compares colours case-insensitively', () => {
        expect(sameScheme(scheme, { ...scheme })).toBe(true)
        expect(sameScheme(scheme, { ...scheme, darkbg: '#0F112A', textcolor: '#EEF0FF' })).toBe(true)
    })

    it('is false when any one field or the type differs', () => {
        for (const key of ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkBorderc', 'darkbutton', 'type']) {
            expect(sameScheme(scheme, { ...scheme, [key]: key === 'type' ? 'light' : '#000001' }), key).toBe(false)
        }
    })

    it('is false for a non-object or a non-string field, and ignores extra properties', () => {
        expect(sameScheme(null, scheme)).toBe(false)
        expect(sameScheme(scheme, undefined)).toBe(false)
        expect(sameScheme('x', 'x')).toBe(false)
        expect(sameScheme(scheme, { ...scheme, bgcolor: 5 })).toBe(false)
        expect(sameScheme({ ...scheme, bgcolor: 5 }, { ...scheme, bgcolor: 5 })).toBe(false)
        expect(sameScheme(scheme, { ...scheme, extra: 'x' })).toBe(true)
    })
})
