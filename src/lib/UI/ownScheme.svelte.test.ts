// @vitest-environment jsdom
import postcss from 'postcss'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readRepoFile } from '../../styles/tests/cascadeModel'
import { ownColours, resetOwnColoursForTests } from '../../ts/themePack/ownColours.svelte'
import { ownScheme, type OwnSchemeKind } from './ownScheme.svelte'

const VARS = { '--risu-theme-bgcolor': '#102030', '--risu-theme-textcolor': '#f0f0f0' }

let stopRoot: (() => void) | undefined

function mountAction(kind: OwnSchemeKind | null) {
    const node = document.createElement('button')
    document.body.appendChild(node)
    let action: ReturnType<typeof ownScheme> | undefined
    stopRoot = $effect.root(() => { action = ownScheme(node, kind) })
    flushSync()
    return { node, update: (next: OwnSchemeKind | null) => { action!.update(next); flushSync() } }
}

function turnOn(vars: Record<string, string> = VARS) {
    ownColours.vars = { ...vars }
    ownColours.on = true
    flushSync()
}

beforeEach(() => { resetOwnColoursForTests() })
afterEach(() => {
    stopRoot?.()
    stopRoot = undefined
    document.body.innerHTML = ''
    resetOwnColoursForTests()
})

describe('ownScheme action', () => {
    test('with the own colours off the node carries neither the attribute nor any custom property', () => {
        const { node } = mountAction('escape')
        expect(node.hasAttribute('data-own-scheme')).toBe(false)
        expect(node.getAttribute('style')).toBeNull()
    })

    test('with the own colours off the node stays bare even when vars are present', () => {
        ownColours.vars = { ...VARS }
        const { node } = mountAction('escape')
        expect(node.hasAttribute('data-own-scheme')).toBe(false)
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('')
    })

    test('turning the own colours on sets the kind and the own custom properties, turning them off removes both', () => {
        const { node } = mountAction('escape')
        turnOn()
        expect(node.getAttribute('data-own-scheme')).toBe('escape')
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#102030')
        expect(node.style.getPropertyValue('--risu-theme-textcolor')).toBe('#f0f0f0')
        ownColours.on = false
        flushSync()
        expect(node.hasAttribute('data-own-scheme')).toBe(false)
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('')
        expect(node.style.getPropertyValue('--risu-theme-textcolor')).toBe('')
    })

    test('the own colours already on at mount are applied in the first flush', () => {
        ownColours.vars = { ...VARS }
        ownColours.on = true
        const { node } = mountAction('prompt')
        expect(node.getAttribute('data-own-scheme')).toBe('prompt')
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#102030')
    })

    test('a null kind never marks the node, and update switches between kinds and null', () => {
        turnOn()
        const { node, update } = mountAction(null)
        expect(node.hasAttribute('data-own-scheme')).toBe(false)
        update('prompt')
        expect(node.getAttribute('data-own-scheme')).toBe('prompt')
        update('escape')
        expect(node.getAttribute('data-own-scheme')).toBe('escape')
        update(null)
        expect(node.hasAttribute('data-own-scheme')).toBe(false)
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('')
    })

    test('new vars replace the old ones and a dropped name is removed from the node', () => {
        const { node } = mountAction('escape')
        turnOn()
        ownColours.vars = { '--risu-theme-bgcolor': '#000001', '--risu-theme-borderc': '#abcdef' }
        flushSync()
        expect(node.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#000001')
        expect(node.style.getPropertyValue('--risu-theme-borderc')).toBe('#abcdef')
        expect(node.style.getPropertyValue('--risu-theme-textcolor')).toBe('')
    })

    test('the node keeps its own inline styles', () => {
        const node = document.createElement('div')
        node.style.setProperty('width', '10px')
        document.body.appendChild(node)
        stopRoot = $effect.root(() => { ownScheme(node, 'escape') })
        turnOn()
        expect(node.style.width).toBe('10px')
        ownColours.on = false
        flushSync()
        expect(node.style.width).toBe('10px')
    })
})

const readCss = readRepoFile
const ISLAND = '[data-own-scheme]'

function topLevelRules(css: string) {
    const rules: { selector: string, names: string[] }[] = []
    postcss.parse(css).walkRules((rule) => {
        const names: string[] = []
        rule.each((child) => { if (child.type === 'decl' && child.prop.startsWith('--')) names.push(child.prop) })
        rules.push({ selector: rule.selector.replace(/\s+/g, ' ').trim(), names })
    })
    return rules
}

const parts = (selector: string) => selector.split(',').map((part) => part.trim())

describe('own-scheme island styles', () => {
    test('every root-subject rule of the token files has an island twin, except the pack-base blocks and --chat-motion', () => {
        const files = ['nexus-tokens', 'pattern-tokens', 'home-tokens', 'studio-tokens', 'chat-tokens'].map((name) => `src/styles/${name}.css`)
        const missing: string[] = []
        for (const file of files) {
            for (const { selector, names } of topLevelRules(readCss(file))) {
                const list = parts(selector)
                const rootSubject = list.filter((part) => /^(:root|html)(?![\w-])/.test(part) && !part.endsWith(ISLAND))
                if (rootSubject.length === 0 || names.length === 0) continue
                if (list.some((part) => part.includes('data-theme-pack-base'))) continue
                if (names.length === 1 && names[0] === '--chat-motion') continue
                for (const part of rootSubject) {
                    const twin = part === ':root' ? ISLAND : `${part} ${ISLAND}`
                    if (!list.includes(twin)) missing.push(`${file}: ${part}`)
                }
            }
        }
        expect(missing).toEqual([])
    })

    test('the pack-base blocks are not mirrored', () => {
        for (const file of ['nexus-tokens', 'pattern-tokens']) {
            const packBase = topLevelRules(readCss(`src/styles/${file}.css`)).filter(({ selector }) => selector.includes('data-theme-pack-base'))
            expect(packBase.length).toBeGreaterThan(0)
            for (const { selector } of packBase) expect(selector).not.toContain(ISLAND)
        }
    })

    test('--chat-motion is declared once, in a block that is not mirrored', () => {
        const owners = topLevelRules(readCss('src/styles/chat-tokens.css')).filter(({ names }) => names.includes('--chat-motion'))
        expect(owners.map(({ selector }) => selector)).toEqual([':root'])
        for (const css of ['nexus-tokens', 'pattern-tokens', 'home-tokens', 'studio-tokens', 'chat-tokens']) {
            const mirrored = topLevelRules(readCss(`src/styles/${css}.css`)).filter(({ selector }) => selector.includes(ISLAND))
            for (const { names } of mirrored) expect(names).not.toContain('--chat-motion')
        }
    })

    test('the island re-declares every var()-valued name of the non-inline @theme blocks', () => {
        const themed: string[] = []
        for (const file of ['src/styles.css', 'src/styles/nexus.css']) {
            postcss.parse(readCss(file)).walkAtRules('theme', (theme) => {
                if (theme.params.includes('inline')) return
                theme.walkDecls((decl) => { if (decl.prop.startsWith('--') && decl.value.startsWith('var(')) themed.push(decl.prop) })
            })
        }
        expect(themed.length).toBeGreaterThan(70)
        const redeclared: string[] = []
        postcss.parse(readCss('src/styles/own-scheme.css')).walkAtRules('layer', (layer) => {
            if (layer.params !== 'theme') return
            layer.walkRules((rule) => {
                if (rule.selector !== ISLAND) return
                rule.walkDecls((decl) => { redeclared.push(decl.prop) })
            })
        })
        expect(themed.filter((name) => !redeclared.includes(name))).toEqual([])
    })

    test('an escape island is an opaque backdrop with an inset focus ring in the own colour, a prompt island has neither', () => {
        const css = readCss('src/styles/own-scheme.css')
        const rules = topLevelRules(css)
        const backdrop = postcss.parse(css).nodes.filter((node): node is postcss.Rule => node.type === 'rule' && node.selector === '[data-own-scheme="escape"]')
        expect(backdrop).toHaveLength(1)
        expect(backdrop[0].toString()).toContain('background-color: var(--risu-theme-bgcolor)')
        const ring = postcss.parse(css).nodes.filter((node): node is postcss.Rule => node.type === 'rule' && node.selector.includes(':focus-visible'))
        expect(ring).toHaveLength(1)
        expect(ring[0].selector).toContain('[data-own-scheme="escape"]')
        expect(ring[0].selector).not.toContain('prompt')
        expect(ring[0].toString()).toContain('outline-offset: -2px')
        expect(ring[0].toString()).toContain('var(--risu-theme-role-focus-ring')
        expect(rules.some(({ selector }) => selector.includes('"prompt"'))).toBe(false)
    })

    test('styles.css imports the island file after the token files it mirrors', () => {
        const css = readCss('src/styles.css')
        expect(css.indexOf('./styles/own-scheme.css')).toBeGreaterThan(css.indexOf('./styles/pattern-tokens.css'))
    })
})
