// @vitest-environment jsdom
/**
 * Stage S (#654, T5): a compatibility guard, true before and after the markup change by design. Every scheme class the shell
 * used, and the role class that replaced it, paint the same computed colours in the same cascade: nine distinct synthetic
 * scheme colours on the root, the own-scheme island with a second set, and the hover and focus states. A role aliased to the
 * wrong scheme name fails here, except among roles that alias the same name (T1 pins those aliases); the focus state paints no
 * ring colour in the model. The forward table that picks the role is T4's.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import census from '../../lib/SettingsShell/tests/fixtures/schemeClassCensus.base.json'
import { CascadeModel, compileAppStyles, compileRules, readRepoFile, type RuleSet } from './cascadeModel'

const NAMES = ['bgcolor', 'darkbg', 'textcolor', 'textcolor2', 'borderc', 'darkborderc', 'darkbutton', 'selected', 'draculared'] as const
const ROOT_SCHEME: Record<string, string> = { bgcolor: '#010203', darkbg: '#111213', textcolor: '#212223', textcolor2: '#313233', borderc: '#414243', darkborderc: '#515253', darkbutton: '#616263', selected: '#717273', draculared: '#818283' }
const OWN_SCHEME: Record<string, string> = { bgcolor: '#a1a2a3', darkbg: '#b1b2b3', textcolor: '#c1c2c3', textcolor2: '#d1d2d3', borderc: '#e1e2e3', darkborderc: '#f1f2f3', darkbutton: '#919293', selected: '#818283', draculared: '#717273' }
const ROLE_OF = (pre: string, kind: string, name: string): string => {
    const press = /(^|:)(hover|active):/.test(pre)
    const table: Record<string, string> = {
        'bg-bgcolor': 'canvas', 'bg-darkbg': 'panel', 'bg-darkbutton': 'raised', 'bg-selected': press ? 'hover' : 'selected',
        'bg-textcolor': 'swatch', 'bg-textcolor2': 'swatch-2', 'bg-draculared': 'danger-fill',
        'text-textcolor': 'text', 'text-textcolor2': 'text-2', 'text-draculared': 'danger',
        'border-borderc': 'border-strong', 'border-darkborderc': 'border-subtle', 'border-draculared': 'danger',
        'ring-selected': 'focus', 'outline-selected': 'focus',
    }
    return table[`${kind}-${name}`]
}

// Variants a cascade model can state. The placeholder: and has-[:checked]: uses (one each) are not modelled here; they are checked by compile parity outside the tree.
const MODELLED = /^(?:class:|hover:|focus:|active:)?$/
interface Case { old: string, role: string }
const cases: Case[] = []
const seen = new Set<string>()
for (const list of Object.values(census as Record<string, string[]>)) {
    for (const token of list) {
        const m = /^((?:[\w[\]:&>*=.-]*:)?)(bg|text|border|ring|outline)-(\w+?)(\/\d+)?$/.exec(token)!
        if (!MODELLED.test(m[1]) || seen.has(token)) continue
        seen.add(token)
        const variant = m[1].replace(/^class:/, '')
        // bg-selected under hover reads the hover role; on-selected paints as text and its alias is pinned by T1, the forward choice by T4
        cases.push({ old: `${variant}${m[2]}-${m[3]}${m[4] ?? ''}`, role: `${variant}${m[2]}-(--settings-${ROLE_OF(m[1], m[2], m[3])})${m[4] ?? ''}` })
    }
}

let rules: RuleSet
beforeAll(async () => {
    const all = [...new Set(cases.flatMap((c) => [c.old, c.role]))]
    const tailwind = await compileAppStyles(all)
    rules = compileRules([tailwind, { name: 'settings-roles', css: readRepoFile('src/styles/settings-roles.css') }, { name: 'own-scheme', css: readRepoFile('src/styles/own-scheme.css') }])
}, 120000)

function setScheme(el: HTMLElement, scheme: Record<string, string>): void {
    for (const [name, value] of Object.entries(scheme)) el.style.setProperty(`--risu-theme-${name}`, value)
}

describe('T5: a role class paints what its scheme class painted', () => {
    test('the census yields cases', () => {
        expect(cases.length).toBeGreaterThan(20)
        expect(NAMES.length).toBe(9)
    })

    for (const state of ['root', 'island', 'hover', 'focus'] as const) {
        test(`state ${state}`, () => {
            document.documentElement.removeAttribute('style')
            setScheme(document.documentElement, ROOT_SCHEME)
            document.body.innerHTML = ''
            for (const { old, role } of cases) {
                if (state === 'focus' && !/^(focus:|ring-|outline-)/.test(old)) continue
                const host = document.createElement('div')
                if (state === 'island') {
                    host.setAttribute('data-own-scheme', 'escape')
                    setScheme(host, OWN_SCHEME)
                }
                const a = document.createElement('div')
                const b = document.createElement('div')
                a.className = old
                b.className = role
                host.append(a, b)
                document.body.append(host)
                const modelA = new CascadeModel(rules, state === 'hover' ? { hovered: a, hoverMedia: true } : state === 'focus' ? { focused: a } : {})
                const paintedA = modelA.painted(a)
                const modelB = new CascadeModel(rules, state === 'hover' ? { hovered: b, hoverMedia: true } : state === 'focus' ? { focused: b } : {})
                const paintedB = modelB.painted(b)
                expect(paintedB, `${old} -> ${role}`).toEqual(paintedA)
            }
        })
    }

    test('a differing alias is detected: the island paints the own scheme through the roles', () => {
        document.documentElement.removeAttribute('style')
        setScheme(document.documentElement, ROOT_SCHEME)
        document.body.innerHTML = '<div id="h" data-own-scheme="escape"><div id="x" class="bg-(--settings-canvas)"></div></div>'
        setScheme(document.getElementById('h')!, OWN_SCHEME)
        const model = new CascadeModel(rules)
        expect(model.painted(document.getElementById('x')!)['background-color']).toBe('#a1a2a3ff')
    })
})
