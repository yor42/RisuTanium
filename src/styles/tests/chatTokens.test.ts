// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (name: string) => readFileSync(path.join(root, name), 'utf8')
const declarations = (css: string) => {
    const names: string[] = []
    postcss.parse(css).walkDecls((decl) => { if (decl.prop.startsWith('--')) names.push(decl.prop) })
    return names
}

describe('T chat token port', () => {
    test('the design block parses and defines each of its 345 names once', () => {
        const names = declarations(read('src/styles/chat-tokens.css'))
        expect(names).toHaveLength(345)
        expect(new Set(names).size).toBe(names.length)
    })
    test('durations multiply by the unitless --chat-motion and no chat or pattern CSS multiplies by the seconds-valued --risu-animation-speed', () => {
        const chat = read('src/styles/chat-tokens.css')
        const declared = new Map<string, string>()
        postcss.parse(chat).walkDecls((decl) => { declared.set(decl.prop, decl.value) })
        expect(declared.has('--risu-animation-speed')).toBe(false)
        expect(declared.get('--chat-motion')).toBe('1')
        for (const [name, nominal] of [['fast', 'fast'], ['base', 'base'], ['slow', 'slow']]) {
            expect(declared.get(`--chat-dur-${name}`)).toBe(`calc(var(--dur-${nominal}-nominal) * var(--chat-motion))`)
        }
        const css = [
            'src/styles/chat-tokens.css', 'src/styles/pattern-tokens.css', 'src/lib/Nexus/pattern/pattern-dialog.css',
            ...readdirSync(path.join(root, 'src/lib/ChatShell')).filter((file) => file.endsWith('.css')).map((file) => `src/lib/ChatShell/${file}`),
        ]
        for (const file of css) expect(read(file), file).not.toMatch(/\*\s*var\(--risu-animation-speed/)
    })
    test('shared names have one owner and the old shell entry does not load the chat block', () => {
        const own = new Set(declarations(read('src/styles/chat-tokens.css')))
        const shared = ['src/styles/nexus-tokens.css', 'src/styles/nexus.css', 'src/styles/pattern-tokens.css']
            .flatMap((file) => declarations(read(file)))
        expect(shared.filter((name) => own.has(name))).toEqual([])
        expect(read('src/styles.css')).not.toContain('chat-tokens.css')
    })
})