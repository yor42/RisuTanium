// @vitest-environment node
// Studio's critical closure (MC-3121): every part at or under a protected Studio element is protected, whatever the
// registry lists by hand. The census reads the real Studio components; the pinned constant is printed on mismatch.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judgeAreaSheet } from './index'
import { shapeOnlySheet } from './shapeMode'
import { censusOfFiles, enclosingPartsOfRoots, svelteFilesUnder } from './fixtures/criticalClosure'
import { STUDIO_CRITICAL, STUDIO_CRITICAL_CLOSURE, STUDIO_SAFE } from './registries/studio'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const studioDir = path.join(root, 'src/lib/Studio')
const files = svelteFilesUnder(studioDir)

/** An in-memory source tree: paths are resolved against `/t`. */
function tree(entries: Readonly<Record<string, string>>): { files: string[]; read: (file: string) => string | null } {
    const resolved = new Map(Object.entries(entries).map(([name, source]) => [path.resolve('/t', name), source]))
    return { files: [...resolved.keys()], read: (file) => resolved.get(file) ?? null }
}

describe('the census scan', () => {
    it('collects the names of a marked element and everything under it, and nothing outside it', () => {
        const t = tree({ 'A.svelte': '<div data-part="outside"></div><div data-part="root" data-part-critical><p data-part="inner"></p></div>' })
        const census = censusOfFiles(t.files, t.read)
        expect(census.roots).toEqual(['root'])
        expect(census.names).toEqual(['inner', 'root'])
        expect(census.problems).toEqual([])
    })

    it('follows a {@render} to a snippet defined in the same file', () => {
        const t = tree({ 'A.svelte': '{#snippet row()}<i data-part="from-snippet"></i>{/snippet}<div data-part="root" data-part-critical>{@render row()}</div>' })
        expect(censusOfFiles(t.files, t.read).names).toEqual(['from-snippet', 'root'])
    })

    it('follows a component element to its imported file, recursively, and reads its slot content', () => {
        const t = tree({
            'A.svelte': '<script>import B from "./B.svelte"</script><div data-part="root" data-part-critical><B><b data-part="slotted"></b></B></div>',
            'B.svelte': '<script>import C from "./sub/C.svelte"</script><section data-part="in-b"><C /></section>',
            'sub/C.svelte': '<span data-part="in-c"></span>',
        })
        expect(censusOfFiles(t.files, t.read).names).toEqual(['in-b', 'in-c', 'root', 'slotted'])
    })

    it('fails the census for a dynamic data-part, an unresolvable component and a {@render} of a prop', () => {
        const dynamic = tree({ 'A.svelte': '<script>let { x } = $props()</script><div data-part="root" data-part-critical><i data-part={x}></i></div>' })
        expect(censusOfFiles(dynamic.files, dynamic.read).problems).toHaveLength(1)
        const unresolved = tree({ 'A.svelte': '<script>import Missing from "./Missing.svelte"</script><div data-part="root" data-part-critical><Missing /></div>' })
        expect(censusOfFiles(unresolved.files, unresolved.read).problems).toHaveLength(1)
        const prop = tree({ 'A.svelte': '<script>let { child } = $props()</script><div data-part="root" data-part-critical>{@render child()}</div>' })
        expect(censusOfFiles(prop.files, prop.read).problems).toHaveLength(1)
    })

    it('reports the parts above a marked root through the render chain', () => {
        const t = tree({
            'Root.svelte': '<div data-part="root" data-part-critical></div>',
            'Mid.svelte': '<script>import Root from "./Root.svelte"</script><section data-part="mid"><Root /></section>',
            'Top.svelte': '<script>import Mid from "./Mid.svelte"</script><main data-part="top"><Mid /></main><footer data-part="unrelated"></footer>',
        })
        expect(enclosingPartsOfRoots(t.files, t.read).names).toEqual(['mid', 'top'])
    })
})

describe('K1 the closure of the real Studio components', () => {
    const census = censusOfFiles(files)

    it('marks exactly the two merge roots and follows every construct under them', () => {
        expect(census.problems).toEqual([])
        expect([...census.roots].sort()).toEqual(['studio-asset-merge-confirm', 'studio-asset-merge-preview'])
    })

    it('every part at or under a marked root is in STUDIO_CRITICAL', () => {
        const missing = census.names.filter((name) => !STUDIO_CRITICAL.includes(name))
        expect(missing).toEqual([])
    })

    it('the pinned STUDIO_CRITICAL_CLOSURE equals the census', () => {
        expect(STUDIO_CRITICAL_CLOSURE, `regenerate: ${JSON.stringify(census.names)}`).toEqual(census.names)
    })

    it('no closure name is also in the safe tier', () => {
        expect(STUDIO_SAFE.filter((name) => census.names.includes(name))).toEqual([])
    })
})

describe('K2 a protected merge control is judged as protected', () => {
    it('a colour on the merge-anyway button is refused in studio', () => {
        const judged = judgeAreaSheet('studio', '[data-part="studio-asset-merge-confirm-merge"]{background-color:#000}', undefined, 'studio')
        expect(judged.result.ok).toBe(false)
    })
})

describe('K3 no part enclosing a protected root is in the safe tier', () => {
    it('the parts above the two merge roots, through the render chain, are not STUDIO_SAFE', () => {
        const enclosing = enclosingPartsOfRoots(files)
        expect(enclosing.problems).toEqual([])
        expect(enclosing.names.length).toBeGreaterThan(0)
        expect(enclosing.names.filter((name) => STUDIO_SAFE.includes(name))).toEqual([])
    })
})

describe('K4 the design Studio sheets still pass after the closure grows', () => {
    const THEMES = new URL('../../../docs/design/studio/themes/', import.meta.url)
    for (const name of ['banana-cocoa', 'office-sheet', 'origin-navy', 'scratch-white']) {
        const css = readFileSync(fileURLToPath(new URL(`${name}.css`, THEMES)), 'utf8').replace(/\r\n/g, '\n')
        it(`${name}.css is accepted whole`, () => {
            const judged = judgeAreaSheet('studio', css, undefined, 'studio')
            expect(judged.result.errors).toEqual([])
            expect(judged.result.ok).toBe(true)
        })
        it(`${name}.css shape variant is accepted`, () => {
            const whole = judgeAreaSheet('studio', css, undefined, 'studio')
            const shape = judgeAreaSheet('studio', shapeOnlySheet(whole.canonical), undefined, 'studio')
            expect(shape.result.ok).toBe(true)
        })
    }
})
