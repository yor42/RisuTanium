import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const libRoot = path.join(repoRoot, 'src/lib')
const stylesPath = path.join(repoRoot, 'src/styles.css')

// ThemePackRow intentionally pairs peer-checked:outline-2 with peer-focus-visible:ring-2 and
// peer-focus-visible:forced-colors:outline-2 so the checked outline and focus ring do not collide.
const EXCLUDED_SVELTE_FILES = new Set([
    'src/lib/Setting/Pages/Display/ThemePackRow.svelte',
])

function walkSvelteFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            walkSvelteFiles(fullPath, out)
        } else if (entry.name.endsWith('.svelte')) {
            out.push(fullPath)
        }
    }
    return out
}

function findViolations(predicate: (line: string) => boolean): string[] {
    const violations: string[] = []
    for (const filePath of walkSvelteFiles(libRoot)) {
        const relPath = path.relative(repoRoot, filePath).replaceAll('\\', '/')
        if (EXCLUDED_SVELTE_FILES.has(relPath)) continue
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
        lines.forEach((line, idx) => {
            if (predicate(line)) {
                violations.push(`${relPath}:${idx + 1}: ${line.trim()}`)
            }
        })
    }
    return violations
}

describe('focus-ring contrast and consistency sweep (#240)', () => {
    test('src/styles.css defines .risu-focus-ring-inset:focus-visible with the scheme focus-ring role', () => {
        const css = fs.readFileSync(stylesPath, 'utf8')
        const insetRuleMatch = css.match(
            /\.risu-focus-ring-inset:focus-visible,\s*\r?\n\.risu-focus-ring-inset-within:has\(:focus-visible\)\s*\{[^}]*\}/,
        )
        expect(insetRuleMatch).not.toBeNull()
        const block = insetRuleMatch![0]
        expect(block).toContain('var(--risu-theme-role-focus-ring, #6f7fc8)')
        expect(block).toContain('outline-offset: -2px;')
    })

    test('no Svelte component uses low-contrast focus-visible:ring-selected', () => {
        const hits = findViolations((line) => /\bfocus-visible:ring-selected\b/.test(line))
        expect(hits).toEqual([])
    })

    test('no Svelte component uses inconsistent focus:ring-borderc, focus:ring-red-600, or *-ring-textcolor2', () => {
        const hits = findViolations((line) =>
            /\b(?:focus:ring-borderc|focus:ring-red-600|focus-visible:ring-textcolor2|peer-focus-visible:ring-textcolor2)\b/.test(line),
        )
        expect(hits).toEqual([])
    })

    test('no Svelte component suppresses outline with focus:outline-hidden without a risu-focus-ring class', () => {
        const hits = findViolations(
            (line) =>
                /\bfocus:outline-hidden\b/.test(line) &&
                !/\brisu-focus-ring(?:-(?:inset|within|inset-within))?\b/.test(line),
        )
        expect(hits).toEqual([])
    })
})
