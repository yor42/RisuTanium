// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (name: string) => readFileSync(path.join(root, name), 'utf8')
const allDeclarations = (css: string) => {
    const names: string[] = []
    postcss.parse(css).walkDecls((decl) => { if (decl.prop.startsWith('--')) names.push(decl.prop) })
    return names
}
/** The selector without its own-scheme island twin: the island re-declares each root block, so the twin is not a rule of its own. */
const withoutIslandTwin = (selector: string) => selector.split(',').map((part) => part.trim()).filter((part) => !part.endsWith('[data-own-scheme]')).join(', ')
const rootDeclarations = (css: string) => {
    const names: string[] = []
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent?.type !== 'root' || withoutIslandTwin(rule.selector) !== ':root') return
        rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) names.push(decl.prop) })
    })
    return names
}

describe('T studio token port', () => {
    test('the :root block parses and defines each of its 314 names once', () => {
        const names = rootDeclarations(read('src/styles/studio-tokens.css'))
        expect(names).toHaveLength(314)
        expect(new Set(names).size).toBe(names.length)
    })
    test('the file neither defines the seconds-valued --risu-animation-speed nor color-scheme, and its durations multiply by the unitless --chat-motion', () => {
        const css = read('src/styles/studio-tokens.css')
        expect(css).not.toContain('--risu-animation-speed')
        const values = new Map<string, string>()
        let colorScheme = 0
        postcss.parse(css).walkRules((rule) => {
            if (rule.parent?.type !== 'root') return
            rule.walkDecls((decl) => {
                if (decl.prop === 'color-scheme') colorScheme++
                values.set(`${withoutIslandTwin(rule.selector)}|${decl.prop}`, decl.value)
            })
        })
        expect(colorScheme).toBe(0)
        expect(values.get(':root|--studio-dur-quick')).toBe('calc(120ms * var(--chat-motion, 1))')
        expect(values.get(':root|--studio-dur-base')).toBe('calc(200ms * var(--chat-motion, 1))')
        expect(values.get('html.nexus-low-power|--studio-dur-base')).toBe('min(calc(200ms * var(--chat-motion, 1)), 120ms)')
    })
    test('every root-subject rule has an own-scheme island twin', () => {
        const heads: string[] = []
        postcss.parse(read('src/styles/studio-tokens.css')).walkRules((rule) => {
            const inMedia = rule.parent?.type === 'atrule'
            if (rule.parent?.type !== 'root' && !inMedia) return
            heads.push(rule.selector)
        })
        expect(heads).toEqual([
            ':root, [data-own-scheme]',
            'html.rm, html.nexus-low-power, html.rm [data-own-scheme], html.nexus-low-power [data-own-scheme]',
            'html.rm, html.rm [data-own-scheme]',
            'html.nexus-low-power, html.nexus-low-power [data-own-scheme]',
            ':root:not(.rm-off), :root:not(.rm-off) [data-own-scheme]',
        ])
    })
    test('shared names have one owner and styles.css does not load the studio block', () => {
        const own = new Set(allDeclarations(read('src/styles/studio-tokens.css')))
        const shared = ['src/styles/nexus-tokens.css', 'src/styles/nexus.css', 'src/styles/pattern-tokens.css', 'src/styles/chat-tokens.css']
            .flatMap((file) => allDeclarations(read(file)))
        expect(shared.filter((name) => own.has(name))).toEqual([])
        expect(read('src/styles.css')).not.toContain('studio-tokens.css')
    })
})
