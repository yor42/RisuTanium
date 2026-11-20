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
        expect(chatShellCssImports()).toEqual(['src/styles/chat-tokens.css', 'src/styles/chat-pack-base.css'])
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
