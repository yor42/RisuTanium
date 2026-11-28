// @vitest-environment jsdom
/**
 * Stage U (#654): a compatibility guard, true before and after the change by design. A scheme utility paints the same computed
 * colours inside .studio-root as outside it with no pack (so Studio and the dual-use components Studio shares paint what they
 * painted), also inside an own-scheme island; and a re-pointed role reaches only the elements inside the Studio root (the roles
 * are read, and nothing outside changes).
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { CascadeModel, compileAppStyles, compileRules, readRepoFile, type RuleSet } from './cascadeModel'

const ROOT_SCHEME: Record<string, string> = { bgcolor: '#010203', darkbg: '#111213', textcolor: '#212223', textcolor2: '#313233', borderc: '#414243', darkborderc: '#515253', darkbutton: '#616263', selected: '#717273', draculared: '#818283' }
const OWN_SCHEME: Record<string, string> = { bgcolor: '#a1a2a3', darkbg: '#b1b2b3', textcolor: '#c1c2c3', textcolor2: '#d1d2d3', borderc: '#e1e2e3', darkborderc: '#f1f2f3', darkbutton: '#919293', selected: '#818283', draculared: '#717273' }
const ROLE_OF: Record<string, string> = { bgcolor: 'canvas', darkbg: 'surface', textcolor: 'fg', textcolor2: 'fg-2', borderc: 'edge', darkborderc: 'edge-strong', darkbutton: 'surface-raised', selected: 'selected', draculared: 'danger' }
// built at run time: a literal here would be scanned by Tailwind and add a rule the stylesheet-additivity test refuses
const CLASSES = ['bg-bgcolor', 'bg-darkbg', 'bg-darkbg/50', 'bg-darkbutton', 'bg-selected', 'text-textcolor', 'text-textcolor2', 'text-draculared', 'border-borderc', 'border-darkborderc', ['border-borderc', '20'].join('/'), 'hover:bg-selected', 'ring-selected']

let rules: RuleSet
beforeAll(async () => {
    const tailwind = await compileAppStyles([...CLASSES, 'border'])
    rules = compileRules([tailwind, { name: 'studio-roles', css: readRepoFile('src/styles/studio-roles.css') }, { name: 'own-scheme', css: readRepoFile('src/styles/own-scheme.css') }])
}, 120000)

function setScheme(el: HTMLElement, scheme: Record<string, string>): void {
    for (const [name, value] of Object.entries(scheme)) el.style.setProperty(`--risu-theme-${name}`, value)
}

function pair(cls: string, host: HTMLElement, hovered: boolean): { inside: Record<string, string>, outside: Record<string, string> } {
    const studio = document.createElement('div')
    studio.className = 'studio-root'
    const inside = document.createElement('div')
    const outside = document.createElement('div')
    inside.className = cls
    outside.className = cls
    studio.append(inside)
    host.append(studio, outside)
    document.body.append(host)
    const env = (el: HTMLElement) => (hovered ? { hovered: el, hoverMedia: true } : {})
    return { inside: new CascadeModel(rules, env(inside)).painted(inside), outside: new CascadeModel(rules, env(outside)).painted(outside) }
}

describe('studio roles paint', () => {
    for (const state of ['root', 'island'] as const) {
        test(`no pack, ${state}: every scheme utility paints the same inside and outside the Studio root`, () => {
            document.documentElement.removeAttribute('style')
            setScheme(document.documentElement, ROOT_SCHEME)
            document.body.innerHTML = ''
            for (const cls of CLASSES) {
                const host = document.createElement('div')
                if (state === 'island') {
                    host.setAttribute('data-own-scheme', 'escape')
                    setScheme(host, OWN_SCHEME)
                }
                const { inside, outside } = pair(cls, host, cls.startsWith('hover:'))
                expect(Object.keys(outside).length, cls).toBeGreaterThan(0)
                expect(inside, cls).toEqual(outside)
            }
        })
    }

    test('a re-pointed role reaches the elements inside the Studio root only', () => {
        document.documentElement.removeAttribute('style')
        setScheme(document.documentElement, ROOT_SCHEME)
        document.body.innerHTML = ''
        const probes: Array<[string, string, string]> = [['bg-bgcolor', 'background-color', 'bgcolor'], ['text-textcolor', 'color', 'textcolor'], ['border border-borderc', 'border-top-color', 'borderc'], ['bg-darkbg', 'background-color', 'darkbg'], ['text-draculared', 'color', 'draculared']]
        for (const [cls, prop, scheme] of probes) {
            const host = document.createElement('div')
            host.style.setProperty(`--studio-${ROLE_OF[scheme]}`, '#abcdef')
            const { inside, outside } = pair(cls, host, false)
            expect(inside[prop], cls).toBe('#abcdefff')
            expect(outside[prop], cls).not.toBe('#abcdefff')
        }
    })
})
