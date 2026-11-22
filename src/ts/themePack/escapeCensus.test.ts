// @vitest-environment node
// TA-5(f): the stop mode of the upward census (enclosingPartsOfRoots with options). Every place the lift cannot follow is a problem
// with a fixed text, the `src/` alias resolves, roots can be chosen by name, and without options the output is what it always was.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { enclosingPartsOfRoots } from './fixtures/criticalClosure'

/** An in-memory source tree rooted at `/t`: the paths are resolved against it, and the problems name files relative to it. */
function tree(entries: Readonly<Record<string, string>>): { files: string[]; read: (file: string) => string | null } {
    const resolved = new Map(Object.entries(entries).map(([name, source]) => [path.resolve('/t', name), source]))
    return { files: [...resolved.keys()], read: (file) => resolved.get(file) ?? null }
}

const stop = (entries: Readonly<Record<string, string>>, extra: { rootParts?: ReadonlySet<string>; tops?: readonly string[] } = {}): ReturnType<typeof enclosingPartsOfRoots> => {
    const t = tree(entries)
    return enclosingPartsOfRoots(t.files, t.read, { ...extra, tops: extra.tops?.map((top) => path.resolve('/t', top)), aliasRoot: path.resolve('/t') })
}

const ROOT = '<div data-part="root" data-part-critical></div>'
const MARKED_IN = (outer: string): string => `<section data-part="${outer}"><div data-part="root" data-part-critical></div></section>`

describe('TA-5(f) the stop mode reports every stop of the lift', () => {
    it('problem 1: a file rendered by no scanned file, which also covers a .ts component map, a dynamic import and an import type', () => {
        const lone = stop({ 'A.svelte': ROOT })
        expect(lone.problems).toEqual(['A.svelte: rendered by no scanned file; the parts above it are not followed'])
        const dynamic = stop({
            'Root.svelte': ROOT,
            'Host.svelte': '<script>const load = () => import("./Root.svelte")</script><section data-part="host"></section>',
        })
        expect(dynamic.problems).toEqual(['Root.svelte: rendered by no scanned file; the parts above it are not followed'])
        const typeOnly = stop({
            'Root.svelte': ROOT,
            'Host.svelte': '<script lang="ts">import type Root from "./Root.svelte"</script><section data-part="host"></section>',
        })
        expect(typeOnly.problems).toEqual(['Root.svelte: rendered by no scanned file; the parts above it are not followed'])
        const map = stop({
            'Root.svelte': ROOT,
            'map.ts': 'import Root from "./Root.svelte"\nexport const components = { Root }',
        })
        expect(map.problems).toEqual(['Root.svelte: rendered by no scanned file; the parts above it are not followed'])
    })

    it('a file in tops ends the lift without a problem, and a rendered file reports the parts above it', () => {
        const t = stop({
            'Root.svelte': ROOT,
            'Top.svelte': '<script>import Root from "./Root.svelte"</script><main data-part="top"><Root /></main>',
        }, { tops: ['Top.svelte'] })
        expect(t.names).toEqual(['top'])
        expect(t.problems).toEqual([])
    })

    it('problem 2: a .svelte import that is neither relative nor under src/', () => {
        const t = stop({
            'Root.svelte': ROOT,
            'Host.svelte': '<script>import Elsewhere from "pkg/Elsewhere.svelte"\nimport Root from "./Root.svelte"</script><section data-part="host"><Root /><Elsewhere /></section>',
        }, { tops: ['Host.svelte'] })
        expect(t.problems).toEqual(['Host.svelte: import pkg/Elsewhere.svelte cannot be resolved for the upward lift'])
    })

    it('problem 3: a root or render site inside a component\'s children, whose own wrapper parts are not followed', () => {
        const t = stop({
            'Top.svelte': '<script>import Wrap from "./Wrap.svelte"</script><Wrap><div data-part="root" data-part-critical></div></Wrap>',
            'Wrap.svelte': '<script>let { children } = $props()</script><section data-part="wrapper">{@render children?.()}</section>',
        }, { tops: ['Top.svelte'] })
        expect(t.problems).toEqual(["Top.svelte: a root or render site inside component Wrap's children; Wrap's own wrapper parts are not followed"])
    })

    it('problem 4: a snippet holding a root that is not rendered in its own file', () => {
        const t = stop({
            'Top.svelte': '<script>import Comp from "./Comp.svelte"</script>{#snippet row()}<i data-part="root" data-part-critical></i>{/snippet}<Comp {row} />',
            'Comp.svelte': '<script>let { row } = $props()</script>{@render row()}',
        }, { tops: ['Top.svelte'] })
        expect(t.problems).toEqual(['Top.svelte: snippet row holding a root or render site is not rendered in this file'])
    })

    it('a snippet rendered in its own file reports the parts above the render site and raises no problem', () => {
        const t = stop({ 'Top.svelte': `{#snippet row()}<i data-part="root" data-part-critical></i>{/snippet}<main data-part="top">{@render row()}</main>` }, { tops: ['Top.svelte'] })
        expect(t.names).toEqual(['top'])
        expect(t.problems).toEqual([])
    })

    it('problem 5: a dynamic component site on the lift path', () => {
        const dynamic = stop({
            'Top.svelte': '<script>let { X } = $props()</script><svelte:component this={X}><div data-part="root" data-part-critical></div></svelte:component>',
        }, { tops: ['Top.svelte'] })
        expect(dynamic.problems).toEqual(['Top.svelte: a dynamic component site cannot be lifted'])
        const local = stop({
            'Top.svelte': '<script>let { X } = $props()</script>{@const Icon = X}<Icon><div data-part="root" data-part-critical></div></Icon>',
        }, { tops: ['Top.svelte'] })
        expect(local.problems).toEqual(['Top.svelte: a dynamic component site cannot be lifted'])
    })

    it('resolves an import that starts with src/ against the alias root, and fails it without one', () => {
        const entries = {
            'src/lib/Root.svelte': ROOT,
            'src/lib/Host.svelte': '<script>import Root from "src/lib/Root.svelte"</script><section data-part="host"><Root /></section>',
        }
        const resolved = stop(entries, { tops: ['src/lib/Host.svelte'] })
        expect(resolved.names).toEqual(['host'])
        expect(resolved.problems).toEqual([])
        const t = tree(entries)
        const unresolved = enclosingPartsOfRoots(t.files, t.read, { tops: [path.resolve('/t', 'src/lib/Host.svelte')] })
        expect(unresolved.names).toEqual([])
        expect(unresolved.problems.length).toBeGreaterThan(0)
    })

    it('chooses roots by name when given rootParts, marked or not, and leaves other marked roots out', () => {
        const entries = {
            'Mark.svelte': MARKED_IN('other-section'),
            'Named.svelte': '<section data-part="named-section"><button data-part="escape"></button></section>',
        }
        const named = stop(entries, { rootParts: new Set(['escape']) })
        expect(named.names).toEqual(['named-section'])
        const marked = stop(entries)
        expect(marked.names).toEqual(['other-section'])
    })
})

describe('TA-5(f) without options the census is what it was (compatibility guard: passes before and after)', () => {
    it('returns the enclosing parts of a marked root through the render chain, with no problems, even where the lift cannot follow', () => {
        const t = tree({
            'Root.svelte': ROOT,
            'Mid.svelte': '<script>import Root from "./Root.svelte"</script><section data-part="mid"><Root /></section>',
            'Top.svelte': '<script>import Mid from "./Mid.svelte"</script><main data-part="top"><Mid /></main><footer data-part="unrelated"></footer>',
        })
        const census = enclosingPartsOfRoots(t.files, t.read)
        expect(census.names).toEqual(['mid', 'top'])
        expect(census.problems).toEqual([])
        const dangling = tree({ 'Root.svelte': ROOT })
        expect(enclosingPartsOfRoots(dangling.files, dangling.read).problems).toEqual([])
    })
})
