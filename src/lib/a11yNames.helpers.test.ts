// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { controlDescription, controlName, controls, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from './a11yNames.test-helpers'

function mount(html: string){
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('controlName', () => {
    it('reads text, aria-label and img alt but not title or hidden glyphs', () => {
        const root = mount(`
            <button id="icon"><svg class="lucide"></svg></button>
            <button id="title" title="Only title"><svg class="lucide"></svg></button>
            <button id="dangling" aria-labelledby="nowhere"></button>
            <button id="label" aria-label="Named"></button>
            <button id="text">Plain <svg aria-hidden="true">X</svg></button>
            <button id="img"><img alt="Pic"></button>
            <button id="hiddenText"><span aria-hidden="true">Hidden</span></button>
            <button id="ref" aria-labelledby="refTarget"></button>
            <span id="refTarget" hidden>Referenced</span>
        `)
        const name = (id: string) => controlName(root.querySelector(`#${id}`)!)
        expect(name('icon')).toBe('')
        expect(name('title')).toBe('')
        expect(name('dangling')).toBe('')
        expect(name('label')).toBe('Named')
        expect(name('text')).toBe('Plain')
        expect(name('img')).toBe('Pic')
        expect(name('hiddenText')).toBe('')
        expect(name('ref')).toBe('Referenced')
    })

    it('names a radio or checkbox only through aria-label, never through aria-labelledby or a label element', () => {
        const root = mount(`
            <label><input type="radio" id="wrapped"> Wrapped text</label>
            <label for="forRadio">For label</label><input type="radio" id="forRadio">
            <input type="radio" id="byLabelled" aria-labelledby="labelSpan"><span id="labelSpan">Named radio</span>
            <input type="radio" id="byAria" aria-label="Aria radio">
            <input type="checkbox" id="check">
            <label><input type="checkbox" id="wrappedCheck"> Wrapped box</label>
            <input type="checkbox" id="checkAria" aria-label="Aria box">
            <input type="radio" id="blankAria" aria-label="  ">
        `)
        const name = (id: string) => controlName(root.querySelector(`#${id}`)!)
        expect(name('wrapped')).toBe('')
        expect(name('forRadio')).toBe('')
        expect(name('byLabelled')).toBe('')
        expect(name('byAria')).toBe('Aria radio')
        expect(name('check')).toBe('')
        expect(name('wrappedCheck')).toBe('')
        expect(name('checkAria')).toBe('Aria box')
        expect(name('blankAria')).toBe('')
    })

    it('names a text input or textarea only through aria-labelledby that aria-describedby also lists', () => {
        const root = mount(`
            <textarea id="areaLabel" aria-label="Only aria-label"></textarea>
            <label for="areaFor">For label</label><textarea id="areaFor"></textarea>
            <label><input type="text" id="wrappedText"> Wrapped field</label>
            <span id="nameSpan">Field name</span><span id="hintSpan">Field hint</span>
            <input type="text" id="labelledOnly" aria-labelledby="nameSpan">
            <input type="text" id="described" aria-labelledby="nameSpan" aria-describedby="nameSpan hintSpan">
            <input type="password" id="describedLate" aria-labelledby="nameSpan" aria-describedby="hintSpan nameSpan">
            <textarea id="hintOnly" aria-labelledby="nameSpan" aria-describedby="hintSpan"></textarea>
            <textarea id="areaOk" aria-label="Ignored" aria-labelledby="nameSpan" aria-describedby="nameSpan"></textarea>
        `)
        const name = (id: string) => controlName(root.querySelector(`#${id}`)!)
        expect(name('areaLabel')).toBe('')
        expect(name('areaFor')).toBe('')
        expect(name('wrappedText')).toBe('')
        expect(name('labelledOnly')).toBe('')
        expect(name('described')).toBe('Field name')
        expect(name('describedLate')).toBe('Field name')
        expect(name('hintOnly')).toBe('')
        expect(name('areaOk')).toBe('Field name')
        expect(controlDescription(root.querySelector('#described')!)).toBe('Field name Field hint')
    })
})

describe('controlName for a contenteditable role="textbox"', () => {
    it('is named only through aria-labelledby that aria-describedby also lists', () => {
        const root = mount(`
            <span id="nameSpan">Field name</span>
            <div role="textbox" contenteditable="true" id="named" aria-labelledby="nameSpan" aria-describedby="nameSpan"></div>
            <div role="textbox" contenteditable="true" id="ariaOnly" aria-label="Only aria-label"></div>
            <div role="textbox" contenteditable="true" id="textOnly">Typed text</div>
        `)
        const name = (id: string) => controlName(root.querySelector(`#${id}`)!)
        expect(name('named')).toBe('Field name')
        expect(name('ariaOnly')).toBe('')
        expect(name('textOnly')).toBe('')
    })

    it('joins the field set only when fields are requested', () => {
        const root = mount('<div role="textbox" contenteditable="true"></div><button>B</button>')
        expect(controls(root).length).toBe(1)
        expect(controls(root, { fields: true }).length).toBe(2)
        expect(unnamedControls(root, { fields: true }).length).toBe(1)
    })
})

describe('textColourTokens', () => {
    const glyph = (root: Element, selector: string) => root.querySelector(selector)!

    it('resolves the rest colour by inheritance and the hover colour up to the control', () => {
        const root = mount('<span class="text-textcolor2"><button class="hover:text-textcolor"><svg></svg></button></span>')
        expect(textColourTokens(glyph(root, 'button'))).toEqual({ rest: 'textcolor2', hover: 'textcolor' })
    })

    it('lets an own colour class win over the parent and skips size classes', () => {
        const root = mount('<span class="text-textcolor"><button class="text-textcolor2 text-sm"><svg></svg></button></span>')
        expect(textColourTokens(glyph(root, 'button'))).toEqual({ rest: 'textcolor2', hover: null })
    })

    it('ignores a hover class above the control', () => {
        const root = mount('<div class="hover:text-draculared"><button><svg></svg></button></div>')
        expect(textColourTokens(glyph(root, 'button')).hover).toBeNull()
    })

    it('reads rest and hover from a wrapper inside the control', () => {
        const root = mount('<button><div class="text-draculared hover:text-textcolor"><svg></svg></div></button>')
        expect(textColourTokens(glyph(root, 'div'))).toEqual({ rest: 'draculared', hover: 'textcolor' })
    })
})

describe('controlDescription', () => {
    it('joins aria-describedby targets, hidden ones included, and reads empty when dangling', () => {
        const root = mount(`
            <button id="a" aria-describedby="d1 d2"></button>
            <span id="d1" hidden>One</span><span id="d2">Two</span>
            <button id="b" aria-describedby="missing"></button>
            <button id="c"></button>
        `)
        expect(controlDescription(root.querySelector('#a')!)).toBe('One Two')
        expect(controlDescription(root.querySelector('#b')!)).toBe('')
        expect(controlDescription(root.querySelector('#c')!)).toBe('')
    })
})

describe('controls and unnamedControls', () => {
    it('lists the default set, adds fields on request and skips aria-hidden subtrees', () => {
        const root = mount(`
            <button>B</button><div role="button">D</div><input type="radio"><textarea></textarea>
            <input type="checkbox"><input type="text"><input>
            <div aria-hidden="true"><button>Hidden</button></div>
        `)
        expect(controls(root).length).toBe(4)
        expect(controls(root, { fields: true }).length).toBe(7)
        expect(unnamedControls(root).length).toBe(2)
    })
})

describe('exposedIcons', () => {
    it('reports lucide svgs without aria-hidden on themselves or an ancestor', () => {
        const root = mount(`
            <button><svg class="lucide lucide-a"></svg></button>
            <svg class="lucide lucide-b"></svg>
            <svg class="lucide lucide-c" aria-hidden="true"></svg>
            <span aria-hidden="true"><svg class="lucide lucide-d"></svg></span>
            <svg class="gradient"></svg>
            <div class="skipme"><svg class="lucide lucide-e"></svg></div>
        `)
        expect(exposedIcons(root, { skip: ['.skipme'] }).length).toBe(2)
        expect(exposedIcons(root, { extra: ['svg.gradient'], skip: ['.skipme'] }).length).toBe(3)
    })
})

describe('paletteClasses', () => {
    it('finds default palette classes and honours allow and skip', () => {
        const root = mount(`
            <div class="text-blue-500 hover:text-green-500 lg:hover:bg-red-500/50 bg-black/50 text-white text-textcolor bg-selected"></div>
            <div class="skipme text-amber-500"></div>
        `)
        expect(paletteClasses(root, { skip: ['.skipme'] })).toEqual([
            'bg-black/50', 'hover:text-green-500', 'lg:hover:bg-red-500/50', 'text-blue-500', 'text-white',
        ])
        expect(paletteClasses(root, { skip: ['.skipme'], allow: [/^bg-black/, /^text-white$/] })).toEqual([
            'hover:text-green-500', 'lg:hover:bg-red-500/50', 'text-blue-500',
        ])
    })
})
