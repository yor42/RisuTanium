import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The shared database and store modules are already on every page's path, so the guard covers the modules that
// only the scheme file import/export actions need.
const FORBIDDEN = ['../globalApi.svelte', '../util', '../alert', '../../lang', './colorscheme']

describe('colorschemeCore imports', () => {
    it('does not import the file, download or lang modules that the boot escape path must not load', () => {
        const text = readFileSync(path.join(__dirname, 'colorschemeCore.ts'), 'utf8')
        const specs = [...text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
        expect(specs.filter((s) => FORBIDDEN.includes(s))).toEqual([])
    })
})