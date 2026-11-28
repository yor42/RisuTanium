// @vitest-environment jsdom
// H-7.3 order semantics for Home: the role defaults (home-roles.css) and the base (home-pack-base.css) both sit at :root
// specificity, so the shell's import order decides. These rows run the shipped order through the cascade model: with no
// area attribute the roles follow the user's scheme; with the base and area=home they are the pinned base; with another
// area the base stays inert; a pack's own :root still wins over the base.
import { afterEach, describe, expect, test } from 'vitest'
import { CascadeModel, compileRules, readRepoFile as read } from './cascadeModel'

const model = (packCss = ''): CascadeModel => new CascadeModel(compileRules([
    { name: 'home-tokens', css: read('src/styles/home-tokens.css') },
    { name: 'home-roles', css: read('src/styles/home-roles.css') },
    { name: 'home-pack-base', css: read('src/styles/home-pack-base.css') },
    { name: 'pack', css: packCss },
]))

function landing(): HTMLElement {
    const root = document.documentElement
    root.style.setProperty('--risu-theme-textcolor', '#111111')
    root.style.setProperty('--risu-theme-bgcolor', '#eeeeee')
    document.body.innerHTML = '<div class="home-root"><p id="p"></p></div>'
    return document.getElementById('p') as HTMLElement
}

afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('data-theme-pack-base')
    root.removeAttribute('data-theme-pack-area')
    root.removeAttribute('style')
})

describe('Home base cascade', () => {
    test('no pack: the roles follow the user scheme', () => {
        const p = landing()
        expect(model().custom(p, '--home-fg')).toBe('#111111')
        expect(model().custom(p, '--home-canvas')).toBe('#eeeeee')
    })

    test('base with area=home pins the roles whatever the scheme', () => {
        const p = landing()
        document.documentElement.setAttribute('data-theme-pack-base', '')
        document.documentElement.setAttribute('data-theme-pack-area', 'home')
        expect(model().custom(p, '--home-fg')).toBe('#f8f8f2')
        expect(model().custom(p, '--home-canvas')).toBe('#282a36')
    })

    test('base with area=chat leaves Home on the scheme', () => {
        const p = landing()
        document.documentElement.setAttribute('data-theme-pack-base', '')
        document.documentElement.setAttribute('data-theme-pack-area', 'chat')
        expect(model().custom(p, '--home-fg')).toBe('#111111')
    })

    test('a pack :root declaration still beats the base', () => {
        const p = landing()
        document.documentElement.setAttribute('data-theme-pack-base', '')
        document.documentElement.setAttribute('data-theme-pack-area', 'home')
        expect(model(':root{--home-fg:#abcdef}').custom(p, '--home-fg')).toBe('#abcdef')
    })
})
