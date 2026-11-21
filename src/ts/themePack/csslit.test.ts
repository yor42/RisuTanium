// @vitest-environment node
// The declaration offsets of the walker: `ds`/`de` span a whole declaration from its property name to the terminating `;` or `}`, so
// shape mode can cut a declaration out of the text the judge canonicalised without disturbing any other character.
import { describe, expect, it } from 'vitest'
import { decls } from './csslit'

const spans = (css: string): string[] => decls(css).map((d) => css.slice(d.ds, d.de))

describe('decls declaration offsets', () => {
    it('spans each declaration from its property to its terminating semicolon, trailing space included', () => {
        expect(spans('a{b:1; c : 2 ;}')).toEqual(['b:1', 'c : 2 '])
    })

    it('ends the last declaration at the closing brace when it has no semicolon', () => {
        const css = 'a{b:1;c:2}'
        const last = decls(css)[1]
        expect(css.slice(last.ds, last.de)).toBe('c:2')
        expect(css[last.de]).toBe('}')
    })

    it('starts after leading whitespace and a leading comment', () => {
        expect(spans('a{\n  /* note */ color:red;\n  opacity:1\n}')).toEqual(['color:red', 'opacity:1\n'])
    })

    it('keeps a comment inside the declaration in its span and leaves the value offsets as before', () => {
        const css = 'a{color:/* c */red;}'
        const [d] = decls(css)
        expect(css.slice(d.ds, d.de)).toBe('color:/* c */red')
        expect(css.slice(d.vs, d.ve)).toBe(d.value)
    })

    it('covers declarations at every depth, a semicolon inside url() or a string included', () => {
        const css = '@media (min-width:1px){p{background:url("a;b.png");content:"x;y"}}'
        expect(spans(css)).toEqual(['background:url("a;b.png")', 'content:"x;y"'])
    })

    it('cutting the spans from last to first leaves every other character in place', () => {
        const css = 'a{b:1;c:2;d:3}'
        let out = css
        for (const d of [...decls(css)].reverse()) out = out.slice(0, d.ds) + out.slice(css[d.de] === ';' ? d.de + 1 : d.de)
        expect(out).toBe('a{}')
    })
})
