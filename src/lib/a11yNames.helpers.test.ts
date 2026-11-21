// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { accessibleText, controlDescription, controlName, controls, exposedIcons, fieldControls, fieldNameProblems, hideClosedColorPickerDialogs, paletteClasses, textColourTokens, toggleFor, unnamedControls } from './a11yNames.test-helpers'

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

describe('controlName for value controls', () => {
    it('names a select or a role="slider" only through aria-labelledby that aria-describedby also lists', () => {
        const root = mount(`
            <span id="nameSpan">Field name</span>
            <select id="options"><option>Option text</option></select>
            <select id="ariaOnly" aria-label="Only aria-label"><option>Option text</option></select>
            <label>Wrapping text <select id="wrapped"><option>Option text</option></select></label>
            <select id="labelledOnly" aria-labelledby="nameSpan"><option>Option text</option></select>
            <select id="described" aria-labelledby="nameSpan" aria-describedby="nameSpan"><option>Option text</option></select>
            <div role="slider" tabindex="0" id="sliderText">3 visible</div>
            <div role="slider" tabindex="0" id="sliderAria" aria-label="Only aria-label"></div>
            <div role="slider" tabindex="0" id="sliderNamed" aria-labelledby="nameSpan" aria-describedby="nameSpan"></div>
        `)
        const name = (id: string) => controlName(root.querySelector(`#${id}`)!)
        expect(name('options')).toBe('')
        expect(name('ariaOnly')).toBe('')
        expect(name('wrapped')).toBe('')
        expect(name('labelledOnly')).toBe('')
        expect(name('described')).toBe('Field name')
        expect(name('sliderText')).toBe('')
        expect(name('sliderAria')).toBe('')
        expect(name('sliderNamed')).toBe('Field name')
    })

    it('lists value controls only on request, composes with fields and skips aria-hidden subtrees', () => {
        const root = mount(`
            <select></select><div role="slider" tabindex="0"></div>
            <input type="number"><input type="range"><input type="color"><input type="date">
            <input type="text"><button>B</button>
            <div aria-hidden="true"><select></select></div>
        `)
        expect(controls(root).length).toBe(1)
        expect(controls(root, { values: true }).length).toBe(7)
        expect(controls(root, { fields: true }).length).toBe(1 + 1)
        expect(controls(root, { fields: true, values: true }).length).toBe(8)
        expect(unnamedControls(root, { values: true }).length).toBe(6)
    })
})

describe('accessibleText', () => {
    it('includes a descendant aria-label, skips aria-hidden and hidden subtrees and reads alt and values', () => {
        const root = mount(`
            <span id="a">Name <button aria-label="Show help"><svg aria-hidden="true">X</svg></button></span>
            <span id="b">Plain <span aria-hidden="true">Hidden</span><span hidden>Gone</span> <img alt="Pic"></span>
            <span id="c">Value <input type="text" value="typed"></span>
        `)
        expect(accessibleText(root.querySelector('#a')!)).toBe('Name Show help')
        expect(accessibleText(root.querySelector('#b')!)).toBe('Plain Pic')
        expect(accessibleText(root.querySelector('#c')!)).toBe('Value typed')
    })
})

const rulesOf = (problems: string[]) => Array.from(new Set(problems.map((line) => /\sF(\d)\s/.exec(line)?.[1] ?? '?'))).sort()

describe('toggleFor and fieldControls', () => {
    it('finds the checkbox before a lone field and none when the parent holds another field', () => {
        const root = mount(`
            <div id="lone"><label><input type="checkbox"></label><input type="number" id="loneField"></div>
            <div id="shared"><label><input type="checkbox"></label><input type="number" id="a"><input type="number" id="b"></div>
            <div id="after"><input type="number" id="early"><label><input type="checkbox"></label></div>
        `)
        expect(toggleFor(root.querySelector('#loneField')!)).toBe(root.querySelector('#lone input[type="checkbox"]'))
        expect(toggleFor(root.querySelector('#a')!)).toBeNull()
        expect(toggleFor(root.querySelector('#early')!)).toBeNull()
    })

    it('does not pair a standalone checkbox that shows its own text with the select beside it', () => {
        const root = mount(`
            <div id="standalone">
                <label><input type="checkbox" aria-label="Insert asset prompt"><span aria-hidden="true"></span><span>Insert asset prompt </span></label>
                <span id="style">Asset style</span>
                <select id="styleSelect" aria-labelledby="style" aria-describedby="style"></select>
            </div>
        `)
        expect(toggleFor(root.querySelector('#styleSelect')!)).toBeNull()
        expect(fieldNameProblems(root, [{ name: 'Asset style' }])).toEqual([])
    })

    it('pairs the icon-only enable checkbox that the shared slider and optional inputs render in their own wrapper', () => {
        const root = mount(`
            <div id="shared">
                <span id="n" class="sr-only">Name</span>
                <div><label><input type="checkbox" aria-label="Name"><span aria-hidden="true"></span><span> </span></label></div>
                <input type="number" id="field" aria-labelledby="n" aria-describedby="n">
            </div>
        `)
        expect(toggleFor(root.querySelector('#field')!)).toBe(root.querySelector('#shared input[type="checkbox"]'))
        expect(fieldNameProblems(root, [{ name: 'Name', toggle: true }])).toEqual([])
        expect(rulesOf(fieldNameProblems(root, [{ name: 'Name' }]))).toEqual(['7'])
    })

    it('lists a text field only when it has a toggle', () => {
        const root = mount(`
            <input type="text" id="plain">
            <div><input type="checkbox"><input type="text" id="toggled"></div>
            <select id="select"></select>
        `)
        expect(fieldControls(root).map((el) => el.id)).toEqual(['toggled', 'select'])
    })
})

describe('hideClosedColorPickerDialogs', () => {
    it('hides only the library closed popup, so an open picker and any other dialog stay counted', () => {
        const root = mount(`
            <div class="wrapper" role="dialog"><input type="number" id="closedInner"></div>
            <div class="wrapper is-open" role="dialog"><input type="number" id="openInner"></div>
            <div role="dialog" id="plain"><input type="number" id="plainInner"></div>
        `)
        expect(controls(root, { values: true }).map((el) => el.id)).toEqual(['closedInner', 'openInner', 'plainInner'])
        hideClosedColorPickerDialogs(root)
        expect(controls(root, { values: true }).map((el) => el.id)).toEqual(['openInner', 'plainInner'])
        expect(unnamedControls(root, { values: true })).toHaveLength(2)
        expect(fieldControls(root).map((el) => el.id)).toEqual(['openInner', 'plainInner'])
    })
})

describe('fieldNameProblems', () => {
    const rules = (problems: string[]) => Array.from(new Set(problems.map((line) => /\sF(\d)\s/.exec(line)?.[1] ?? '?'))).sort()
    const FIELD = (id: string, name: string, extra = '') => `<span id="${id}">${name}</span><input type="number" aria-labelledby="${id}" aria-describedby="${id}${extra}">`

    it('accepts a named field, a field with help after the name and a toggled field', () => {
        expect(fieldNameProblems(mount(FIELD('n', 'Name')), [{ name: 'Name' }])).toEqual([])
        const withHelp = mount(`<span id="h">Hint</span>${FIELD('n', 'Name', ' h')}`)
        expect(fieldNameProblems(withHelp, [{ name: 'Name', help: 'Hint' }])).toEqual([])
        const toggled = mount(`<div><label><input type="checkbox" aria-label="Name"></label>${FIELD('n', 'Name')}</div>`)
        expect(fieldNameProblems(toggled, [{ name: 'Name', toggle: true }])).toEqual([])
    })

    it('F1 reports an extra or a missing control', () => {
        const root = mount(`${FIELD('a', 'A')}${FIELD('b', 'B')}`)
        expect(rules(fieldNameProblems(root, [{ name: 'A' }]))).toContain('1')
        expect(rules(fieldNameProblems(root, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]))).toContain('1')
    })

    it('F2 reports a swapped or empty name', () => {
        const root = mount(`${FIELD('a', 'A')}${FIELD('b', 'B')}`)
        expect(rules(fieldNameProblems(root, [{ name: 'B' }, { name: 'A' }]))).toContain('2')
        expect(rules(fieldNameProblems(mount('<input type="number">'), [{ name: 'A' }]))).toContain('2')
    })

    it('F3 reports a help id listed before the name', () => {
        const root = mount(`<span id="h">Hint</span><span id="n">Name</span><input type="number" aria-labelledby="n" aria-describedby="h n">`)
        expect(rules(fieldNameProblems(root, [{ name: 'Name', help: 'Hint' }]))).toContain('3')
    })

    it('F4 reports help text that was not announced as help', () => {
        const root = mount(`<span id="h">Hint</span>${FIELD('n', 'Name', ' h')}`)
        expect(rules(fieldNameProblems(root, [{ name: 'Name' }]))).toEqual(['4'])
    })

    it('F5 reports a Help-like button inside the naming element and a wrapping label', () => {
        const withHelp = mount('<span id="n">Name <button aria-label="Show help"><svg aria-hidden="true"></svg></button></span><input type="number" aria-labelledby="n" aria-describedby="n">')
        expect(rules(fieldNameProblems(withHelp, [{ name: 'Name Show help' }]))).toEqual(['5'])
        const wrapping = mount('<label id="n">Name <input type="number" aria-labelledby="n" aria-describedby="n"></label>')
        expect(rules(fieldNameProblems(wrapping, [{ name: 'Name' }]))).toContain('5')
        const dangling = mount('<input type="number" aria-labelledby="gone" aria-describedby="gone">')
        expect(rules(fieldNameProblems(dangling, [{ name: 'Name' }]))).toContain('5')
    })

    it('F6 reports one naming span shared by two controls even when both names match', () => {
        const root = mount('<span id="n">Name</span><input type="number" aria-labelledby="n" aria-describedby="n"><input type="number" aria-labelledby="n" aria-describedby="n">')
        expect(rules(fieldNameProblems(root, [{ name: 'Name' }, { name: 'Name' }]))).toEqual(['6'])
    })

    it('F7 reports a missing, an unexpected and a wrongly named toggle', () => {
        const toggled = (aria: string) => mount(`<div><label><input type="checkbox"${aria}></label>${FIELD('n', 'Name')}</div>`)
        expect(rules(fieldNameProblems(toggled(''), [{ name: 'Name', toggle: true }]))).toEqual(['7'])
        expect(rules(fieldNameProblems(toggled(' aria-label="Name"'), [{ name: 'Name' }]))).toEqual(['7'])
        expect(rules(fieldNameProblems(toggled(' aria-label="Other"'), [{ name: 'Name', toggle: true }]))).toEqual(['7'])
        expect(rules(fieldNameProblems(mount(FIELD('n', 'Name')), [{ name: 'Name', toggle: true }]))).toEqual(['7'])
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
