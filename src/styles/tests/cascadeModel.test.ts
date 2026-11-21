// @vitest-environment jsdom

/**
 * Helper fidelity: the cascade model must reproduce the custom-property rule the boot pin relies on.
 * A custom property that reads another one is computed once where it is declared, so redeclaring the
 * source further down does not change it unless the reader is redeclared too. These are guards of the
 * helper itself and pass on any base.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { CascadeModel, chatShellCssImports, compileRules, compositeHex, normaliseColours, withPackElement } from './cascadeModel'

function mount(html: string): HTMLElement {
    document.body.innerHTML = html
    return document.body
}

function model(css: string, env: ConstructorParameters<typeof CascadeModel>[1] = {}): CascadeModel {
    return new CascadeModel(compileRules([{ name: 'test', css }]), env)
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('custom properties', () => {
    const CSS = ':root{--a:var(--b);--b:red} .x{--b:blue} .p{color:var(--a)}'

    test('a reader declared at :root keeps the root value below a redeclared source', () => {
        mount('<div class="x"><span class="p y"></span></div>')
        const m = model(CSS)
        expect(m.prop(document.querySelector('.p')!, 'color')).toBe('red')
    })

    test('redeclaring the reader below the source recomputes it there', () => {
        mount('<div class="x"><span class="p y"></span></div>')
        const m = model(`${CSS} .x{--a:var(--b)}`)
        expect(m.prop(document.querySelector('.p')!, 'color')).toBe('blue')
    })

    test('var() fallbacks apply only when the property is guaranteed-invalid', () => {
        mount('<i class="p"></i>')
        expect(model(':root{--a:var(--missing, green)} .p{color:var(--a)}').prop(document.querySelector('.p')!, 'color')).toBe('green')
        expect(model('.p{color:var(--missing)}').prop(document.querySelector('.p')!, 'color')).toBeUndefined()
    })

    test('a cycle is guaranteed-invalid', () => {
        mount('<i class="p"></i>')
        const m = model(':root{--a:var(--b);--b:var(--a)} .p{color:var(--a, black)}')
        expect(m.custom(document.documentElement, '--a')).toBeUndefined()
        expect(m.prop(document.querySelector('.p')!, 'color')).toBe('black')
    })

    test('@property registers an initial value at the root and a non-inherited one resets below', () => {
        mount('<div class="x"><i class="p"></i></div>')
        const m = model('@property --r { syntax: "<color>"; inherits: true; initial-value: red; } @property --n { syntax: "*"; inherits: false; initial-value: solid; } .x{--n:dashed}')
        expect(m.custom(document.querySelector('.p')!, '--r')).toBe('red')
        expect(m.custom(document.querySelector('.x')!, '--n')).toBe('dashed')
        expect(m.custom(document.querySelector('.p')!, '--n')).toBe('solid')
    })
})

describe('cascade order', () => {
    test('unlayered beats layered, later layer beats earlier, specificity beats order, :where counts zero', () => {
        mount('<p id="e" class="a b"></p>')
        const m = model(`
            @layer one, two;
            @layer two { .a { color: #222222 } }
            @layer one { .a.b { color: #111111 } }
            .a { background-color: #333333 }
            @layer two { .a { background-color: #444444 } }
            .a.b { border: 1px solid #555555 }
            :where(.a.b) { border-color: #666666 }
            .a { outline: 2px solid #777777 }
            .b { outline-color: #888888 }
        `)
        const painted = m.painted(document.getElementById('e')!)
        expect(painted.color).toBe('#222222ff')
        expect(painted['background-color']).toBe('#333333ff')
        expect(painted['border-top-color']).toBe('#555555ff')
        // Equal specificity, later source wins.
        expect(painted['outline-color']).toBe('#888888ff')
    })

    test('inline style beats every rule and pseudo-elements are separate nodes', () => {
        mount('<p id="e" class="a" style="color: #010203"></p>')
        const m = model('.a { color: #aaaaaa } .a::before { color: #bbbbbb; content: "" }')
        const el = document.getElementById('e')!
        expect(m.painted(el).color).toBe('#010203ff')
        expect(m.painted(el, '::before').color).toBe('#bbbbbbff')
    })

    test('media and supports conditions: reduced motion is a variant, other environment queries are false', () => {
        mount('<p id="e"></p>')
        const css = '#e{color:#111111} @media (prefers-reduced-motion: reduce){#e{color:#222222}} @media (forced-colors: active){#e{color:#333333}} @supports (color: color-mix(in oklab, red, red)){#e{background-color:#444444}}'
        const el = () => document.getElementById('e')!
        expect(model(css).painted(el()).color).toBe('#111111ff')
        expect(model(css, { reducedMotion: true }).painted(el()).color).toBe('#222222ff')
        expect(model(css).painted(el())['background-color']).toBe('#444444ff')
    })

    test('an at-rule the model does not know is reported', () => {
        mount('<p></p>')
        expect(compileRules([{ name: 'x', css: '@container (min-width: 1px) { p { color: red } }' }]).unmodelled).toEqual(['x: @container (min-width: 1px)'])
    })

    test(':focus-visible matches only the focused element', () => {
        mount('<button id="a" class="f"></button><button id="b" class="f"></button>')
        const css = '.f:focus-visible{outline:2px solid #123456}'
        const m = model(css, { focused: document.getElementById('a') })
        expect(m.painted(document.getElementById('a')!)['outline-color']).toBe('#123456ff')
        expect(m.painted(document.getElementById('b')!)['outline-color']).toBeUndefined()
    })

    test(':focus-within matches the ancestors of the focused element, not a sibling, and nothing without focus', () => {
        mount('<div id="a" class="w"><input id="in"></div><div id="b" class="w"></div>')
        const css = '.w:focus-within{outline:2px solid #123456}'
        const m = model(css, { focused: document.getElementById('in') })
        expect(m.painted(document.getElementById('a')!)['outline-color']).toBe('#123456ff')
        expect(m.painted(document.getElementById('b')!)['outline-color']).toBeUndefined()
        const none = model(css, {})
        expect(none.painted(document.getElementById('a')!)['outline-color']).toBeUndefined()
    })

    test(':hover matches only the hovered element and nothing without one, and a stale hover does not leak into the next model', () => {
        mount('<button id="a" class="h"></button><button id="b" class="h"></button>')
        const css = '.h:hover{outline:2px solid #123456}'
        const a = document.getElementById('a')!
        const b = document.getElementById('b')!
        const m = model(css, { hovered: a })
        expect(m.painted(a)['outline-color']).toBe('#123456ff')
        expect(m.painted(b)['outline-color']).toBeUndefined()
        expect(model(css, {}).painted(a)['outline-color']).toBeUndefined()
        expect(model(css, { hovered: b }).painted(a)['outline-color']).toBeUndefined()
    })

    test('@media (hover: hover) holds only with hoverMedia; other hover queries stay false', () => {
        mount('<button id="a" class="h"></button>')
        const css = '.h{color:#111111} @media (hover: hover){.h:hover{color:#222222}} @media (hover: none){.h:hover{background-color:#333333}} @media (any-hover: hover){.h:hover{border-top-color:#444444}}'
        const a = document.getElementById('a')!
        const on = model(css, { hovered: a, hoverMedia: true }).painted(a)
        expect(on.color).toBe('#222222ff')
        expect(on['background-color']).toBeUndefined()
        expect(on['border-top-color']).toBeUndefined()
        expect(model(css, { hovered: a, hoverMedia: false }).painted(a).color).toBe('#111111ff')
        expect(model(css, { hovered: a }).painted(a).color).toBe('#111111ff')
        expect(model(css, { hoverMedia: true }).painted(a).color).toBe('#111111ff')
    })

    // CM-M: `::marker` is a pseudo-element node of its own, like `::before`.
    test('CM-M: li::marker applies only to the marker node and the marker is not reported as unmodelled', () => {
        mount('<ul><li id="e" class="x">item</li></ul>')
        const rules = compileRules([{ name: 'test', css: '.x { color: #111111 } li::marker { color: #aa0000 } .x::before { color: #0000bb; content: "" }' }])
        expect(rules.unmodelled).toEqual([])
        const m = new CascadeModel(rules, {})
        const li = document.getElementById('e')!
        expect(m.painted(li).color).toBe('#111111ff')
        expect(m.painted(li, '::marker').color).toBe('#aa0000ff')
        expect(m.painted(li, '::before').color).toBe('#0000bbff')
    })

    test('CM-M: a nested rule shaped like the typography output matches the marker', () => {
        mount('<div class="prose"><ul><li id="e">item</li></ul><ol><li id="o">item</li></ol></div>')
        const m = model('.prose { --tw-prose-bullets: #aa0000; :where(ul > li)::marker { color: var(--tw-prose-bullets) } :where(ol > li)::marker { color: #00aa00 } }')
        expect(m.painted(document.getElementById('e')!, '::marker').color).toBe('#aa0000ff')
        expect(m.painted(document.getElementById('o')!, '::marker').color).toBe('#00aa00ff')
    })

    test('CM-M: currentColor on a marker is the colour of its list item', () => {
        mount('<div class="prose" style="color: #123456"><ul><li id="e">item</li></ul></div>')
        const m = model('.prose { --tw-prose-bullets: currentColor } .prose li::marker { color: var(--tw-prose-bullets) } .prose li { color: #654321 }')
        expect(m.painted(document.getElementById('e')!, '::marker').color).toBe('#654321ff')
    })
})

describe('the pack element and the root attribute', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-cm-x')
    })

    test('H1: the pack element counts only while its media is all', () => {
        const el = document.createElement('style')
        el.textContent = ':root{--a:2}'
        el.setAttribute('media', 'not all')
        const sheets = [{ name: 'app', css: ':root{--a:1}' }]
        const read = () => new CascadeModel(compileRules(withPackElement(sheets, el))).custom(document.documentElement, '--a')
        expect(read()).toBe('1')
        el.setAttribute('media', 'all')
        expect(read()).toBe('2')
    })

    test('H2: a :where() rule matches the root attribute, has no extra specificity, and loses or wins by source order', () => {
        const read = (css: string) => new CascadeModel(compileRules([{ name: 't', css }])).custom(document.documentElement, '--a')
        const forward = ':root{--a:1} :root:where([data-cm-x]){--a:2}'
        const reverse = ':root:where([data-cm-x]){--a:2} :root{--a:1}'
        expect(read(forward)).toBe('1')
        document.documentElement.setAttribute('data-cm-x', '')
        expect(read(forward)).toBe('2')
        expect(read(reverse)).toBe('1')
        expect(read(':root{--a:1} :root[data-cm-x]{--a:2}')).toBe('2')
        expect(read(':root[data-cm-x]{--a:2} :root{--a:1}')).toBe('2')
    })

    test('H3: the ChatShell CSS imports are read in source order, chat-tokens first', () => {
        expect(chatShellCssImports()).toEqual(['src/styles/chat-tokens.css', 'src/styles/chat-pack-base.css', 'src/styles/chat-light-base.css'])
    })
})

describe('colour text', () => {
    test('colours are normalised inside gradients and currentcolor is resolved', () => {
        expect(normaliseColours('linear-gradient(90deg, transparent, rgb(1 2 3 / 0.5) 70%, currentcolor)', '#0a0b0cff'))
            .toBe('linear-gradient(90deg, #00000000, #01020380 70%, #0a0b0cff)')
    })

    test('compositing a translucent colour over a canvas', () => {
        expect(compositeHex('#ffffff80', '#000000')).toBe('#808080')
    })
})

describe('the opt-in importance tiers', () => {
    const IMPORTANT = { important: true }
    const colourOf = (m: CascadeModel): string | undefined => m.prop(document.querySelector('p')!, 'color')

    test('CM-I1: an important author rule beats a normal inline declaration, and the suffix is stripped', () => {
        mount('<p style="color:#222222"></p>')
        expect(colourOf(model('p{color:#111111 !important}', IMPORTANT))).toBe('#111111')
    })

    test('CM-I2: an important inline declaration beats an important author rule of any specificity', () => {
        mount('<div id="a"><div class="b"><p style="color:#222222 !important"></p></div></div>')
        expect(colourOf(model('#a .b p{color:#111111 !important}', IMPORTANT))).toBe('#222222')
    })

    test('CM-I3: important declarations in an earlier layer win, normal ones in a later layer win', () => {
        mount('<p></p>')
        expect(colourOf(model('@layer a { p{color:#111111 !important} } p{color:#333333 !important}', IMPORTANT))).toBe('#111111')
        expect(colourOf(model('@layer a { p{color:#111111} } p{color:#333333}', IMPORTANT))).toBe('#333333')
    })

    test('CM-I4: an important inline background reset removes an important author background colour', () => {
        mount('<p style="background: none !important"></p>')
        const reset = model('p{background-color:#123456 !important}', IMPORTANT).painted(document.querySelector('p')!)
        expect(reset['background-color']).toBeUndefined()
        document.body.innerHTML = '<p></p>'
        expect(model('p{background-color:#123456 !important}', IMPORTANT).painted(document.querySelector('p')!)['background-color']).toBe('#123456ff')
    })

    test('CM-I5: without the option the inline declaration is last and !important stays recorded as unmodelled (compatibility guard: passes before and after)', () => {
        mount('<p style="color:#222222"></p>')
        const m = new CascadeModel(compileRules([{ name: 'test', css: 'p{color:#111111 !important}' }]))
        expect(colourOf(m)).toBe('#222222')
        expect(m.unmodelled).toContain('test: !important in p')
    })

    test('CM-I6: with the option !important is no longer unmodelled', () => {
        mount('<p style="color:#222222"></p>')
        expect(model('p{color:#111111 !important}', IMPORTANT).unmodelled.filter((entry) => entry.includes('!important'))).toEqual([])
    })
})
