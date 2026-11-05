// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const components = ['ChatShell', 'ShellHeader', 'ShellComposer', 'ShellSheet', 'PlusSheet', 'PersonaSheet', 'ExtrasStrip', 'ShellNotices', 'ShellFloatingButtons', 'ShellMessageList', 'ShellMessage', 'StreamingView']
// Navigation, input, and ordinary menus are reachable surfaces; none here is a protected prompt.
const criticalParts = new Set<string>()

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function markedParts(source: string): string[] {
    const found: string[] = []
    const seen = new Set<object>()
    function visit(value: unknown): void {
        if (Array.isArray(value)) { value.forEach(visit); return }
        const node = object(value)
        if (!node || seen.has(node)) return
        seen.add(node)
        if (node.type === 'RegularElement' && Array.isArray(node.attributes)) {
            const attrs = node.attributes.map(object).filter((attr): attr is Record<string, unknown> => attr !== null)
            if (attrs.some((attr) => attr.name === 'data-part-critical')) {
                const part = attrs.find((attr) => attr.name === 'data-part')
                const text = Array.isArray(part?.value) ? object(part.value[0])?.data : undefined
                found.push(typeof text === 'string' ? text : '(unlisted part)')
            }
        }
        for (const child of Object.values(node)) visit(child)
    }
    visit(parse(source, { modern: true }))
    return found
}

describe('T protected chat parts', () => {
    test('only explicitly protected parts carry data-part-critical', () => {
        const found = components.flatMap((component) => markedParts(readFileSync(path.join(root, 'src/lib/ChatShell', `${component}.svelte`), 'utf8')))
        expect(found.filter((part) => !criticalParts.has(part))).toEqual([])
    })
})