// @vitest-environment jsdom
// The sanitizer assertions below need a DOM in which DOMPurify removes every
// offending node. happy-dom's NodeIterator stops DOMPurify after the first
// removal, so removal assertions made there only prove the first offender went.
import { describe, expect, test, vi, beforeEach } from 'vitest'
import DOMPurify from 'dompurify'

// `hubHtml.ts` only imports `openURL` from this module. Mocking the whole
// module (rather than importing it for real) keeps this suite from pulling
// in the rest of the app's boot chain -- unmocked, `./globalApi.svelte`
// transitively loads `parser.svelte.ts`, and other modules along that chain
// assume the app has already booted.
//
// `parser.svelte.ts` also registers GLOBAL `DOMPurify.addHook` side effects
// on the shared singleton `dompurify` instance (e.g. forcing
// `target="_blank"` onto any sanitized `http(s):` anchor) purely as an
// import-time effect. An earlier version of this comment claimed those
// hooks would leak into the sanitizer assertions below if this module were
// left unmocked. That claim does not hold: `hubHtml.ts` builds its own
// private instance via `createDOMPurify(window)` specifically so a hook
// registered on the shared singleton can never reach this sink, regardless
// of import order or of what this test file mocks. The "isolation from the
// shared DOMPurify singleton" suite below pins that directly, against the
// real `dompurify` default export, rather than relying on this file's own
// mock to keep the two apart.
vi.mock('./globalApi.svelte', () => ({ openURL: vi.fn() }))

import { sanitizeHubHtml, handleHubHtmlClick } from './hubHtml'
import { openURL } from './globalApi.svelte'

describe('sanitizeHubHtml', () => {
    test('handler attributes are stripped -- not just the well-known onerror', () => {
        const raw = '<p onerror="a()" onfocus="b()" onanimationend="c()" onload="d()" onmouseover="e()">hello</p>'

        const out = sanitizeHubHtml(raw)

        // An allowlist strips every attribute not named in `ALLOWED_ATTR`
        // (only `href`), regardless of which handler it is -- a denylist
        // would have to name each of these individually and would miss the
        // unusual ones. Pinning five different handlers, not just
        // `onerror`, is the point of this test.
        expect(out).toBe('<p>hello</p>')
        expect(out).not.toMatch(/\bon\w+\s*=/i)
    })

    test('script tags and their content are removed entirely', () => {
        const out = sanitizeHubHtml('before<script>alert(1)</script>after')

        expect(out).toBe('beforeafter')
        expect(out.toLowerCase()).not.toContain('script')
    })

    test('a javascript: href does not survive', () => {
        const out = sanitizeHubHtml('<a href="javascript:alert(1)">click</a>')

        expect(out).not.toContain('javascript:')
        // `ALLOWED_URI_REGEXP` rejects the whole attribute rather than
        // keeping it with an emptied value -- the `<a>` tag itself is still
        // allowed, so it survives with no `href` at all.
        expect(out).toBe('<a>click</a>')
    })

    test('a data: href does not survive', () => {
        const out = sanitizeHubHtml('<a href="data:text/html,not-a-link">click</a>')

        expect(out).not.toContain('data:')
        expect(out).toBe('<a>click</a>')
    })

    test('a plain http/https link survives with its href intact, while other attributes on the same tag do not', () => {
        // Folded together deliberately: a version of this test that only
        // checked the href survives would pass just as well against a
        // no-op identity stub, since the input already contains nothing
        // else to strip from that angle. Adding `onclick`/`style`/`class`/
        // `target` alongside the href makes the assertion load-bearing --
        // it fails unless something actually removed them.
        const out = sanitizeHubHtml(
            '<a href="https://example.com/path?q=1" onclick="steal()" style="color:red" class="x" target="_self">RisuRealm</a>'
        )

        expect(out).toBe('<a href="https://example.com/path?q=1">RisuRealm</a>')
    })

    test('ordinary prose and every allowed formatting tag survive, while a disallowed tag and attribute in the same markup do not', () => {
        // As above: mixing in a `style` attribute and a disallowed `<span>`
        // keeps this from being satisfiable by an identity stub. `<span>`'s
        // own inner text ("nope") is kept even though the tag itself is
        // stripped -- confirmed empirically to differ from `<script>`/
        // `<style>`/`<iframe>`/`<svg>`, which drop their inner content too
        // (see the disallowed-structural-tags test below).
        const raw = '<p style="color:red">Hello <b>bold</b>, <strong>strong</strong>, <i>italic</i>, <em>em</em> and <u>underline</u>.<br>Second line. <span class="x">nope</span></p>'

        const out = sanitizeHubHtml(raw)

        expect(out).toBe('<p>Hello <b>bold</b>, <strong>strong</strong>, <i>italic</i>, <em>em</em> and <u>underline</u>.<br>Second line. nope</p>')
    })

    // DOMPurify's own behaviour for a disallowed tag is not uniform: some
    // drop their inner content along with the tag, others keep the inner
    // text and drop only the tag itself. Verified empirically against the
    // real DOMPurify call (not assumed) before writing these expectations --
    // `iframe`, `style`, `svg`, `img` and `embed` fall in the first group,
    // `object` in the second.
    test('disallowed structural tags are stripped; most drop their inner content, but object keeps its inner text', () => {
        expect(sanitizeHubHtml('<p>before<iframe>inner</iframe>after</p>')).toBe('<p>beforeafter</p>')
        expect(sanitizeHubHtml('<p>before<style>inner</style>after</p>')).toBe('<p>beforeafter</p>')
        expect(sanitizeHubHtml('<p>before<svg>inner</svg>after</p>')).toBe('<p>beforeafter</p>')
        expect(sanitizeHubHtml('<p>before<img src="x">after</p>')).toBe('<p>beforeafter</p>')
        expect(sanitizeHubHtml('<p>before<embed src="x">after</p>')).toBe('<p>beforeafter</p>')
        expect(sanitizeHubHtml('<p>before<object>inner</object>after</p>')).toBe('<p>beforeinnerafter</p>')
    })

    // Every offender in one input must go, not only the first one DOMPurify
    // meets; allowed content around them must stay.
    test('every offender in one input is removed while the allowed tags, text and http href stay', () => {
        const out = sanitizeHubHtml(
            '<script>alert(1)</script>' +
            '<p onclick="a()" onmouseover="b()" class="c" style="color:red">first</p>' +
            '<script>alert(2)</script>' +
            '<a href="javascript:alert(3)" onfocus="c()">bad</a>' +
            '<a href="https://example.com/ok" onclick="d()">ok</a>' +
            '<img src="https://example.com/i.png" onerror="e()">' +
            '<iframe src="https://example.com/f"></iframe>' +
            '<svg onload="f()"><circle r="1"></circle></svg>' +
            '<script>alert(4)</script>' +
            '<b onanimationend="g()">bold</b>'
        )

        expect(out).toBe('<p>first</p><a>bad</a><a href="https://example.com/ok">ok</a><b>bold</b>')
    })

    test('an empty string and a plain string with no markup pass through unchanged, sanely', () => {
        // The first two lines below hold for a no-op identity stub too --
        // there is nothing in an empty string or in plain prose for any
        // sanitizer to strip, so they cannot by themselves distinguish the
        // real implementation from a stub. They stay, folded into one test
        // alongside a third line that DOES require real sanitization, so
        // the test as a whole still fails under the identity-stub mutation
        // check (see this file's own test evidence in the PR/report) rather
        // than passing vacuously.
        expect(sanitizeHubHtml('')).toBe('')
        expect(sanitizeHubHtml('just plain text, no tags at all')).toBe('just plain text, no tags at all')
        expect(sanitizeHubHtml('<script>alert(1)</script>')).toBe('')
    })
})

describe('handleHubHtmlClick', () => {
    beforeEach(() => {
        vi.mocked(openURL).mockClear()
    })

    test('a click on a descendant of the anchor routes to openURL with the resolved href, exactly once', () => {
        const anchor = document.createElement('a')
        anchor.href = 'https://example.com/path'
        const span = document.createElement('span')
        span.textContent = 'link text'
        anchor.appendChild(span)

        const preventDefault = vi.fn()
        const event = { target: span, preventDefault } as unknown as MouseEvent

        handleHubHtmlClick(event)

        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledWith('https://example.com/path')
    })

    test('a javascript: anchor calls preventDefault and does not call openURL', () => {
        const anchor = document.createElement('a')
        anchor.setAttribute('href', 'javascript:alert(1)')

        const preventDefault = vi.fn()
        const event = { target: anchor, preventDefault } as unknown as MouseEvent

        handleHubHtmlClick(event)

        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(openURL).not.toHaveBeenCalled()
    })

    test('a mailto: anchor calls preventDefault and does not call openURL', () => {
        const anchor = document.createElement('a')
        anchor.setAttribute('href', 'mailto:someone@example.com')

        const preventDefault = vi.fn()
        const event = { target: anchor, preventDefault } as unknown as MouseEvent

        handleHubHtmlClick(event)

        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(openURL).not.toHaveBeenCalled()
    })

    test('a click with no enclosing anchor does not call openURL and does not call preventDefault', () => {
        const div = document.createElement('div')

        const preventDefault = vi.fn()
        const event = { target: div, preventDefault } as unknown as MouseEvent

        handleHubHtmlClick(event)

        expect(preventDefault).not.toHaveBeenCalled()
        expect(openURL).not.toHaveBeenCalled()
    })

    test('an anchor whose href was stripped (so anchor.href is empty) does not throw and does not call openURL', () => {
        const anchor = document.createElement('a')
        anchor.textContent = 'click'
        // Simulates `sanitizeHubHtml`'s real output for a disallowed scheme:
        // the `href` attribute is removed entirely, so the `href` IDL
        // property resolves to the empty string per spec, and `new URL('')`
        // throws.
        expect(anchor.href).toBe('')

        const preventDefault = vi.fn()
        const event = { target: anchor, preventDefault } as unknown as MouseEvent

        expect(() => handleHubHtmlClick(event)).not.toThrow()
        expect(openURL).not.toHaveBeenCalled()
    })
})

// `hubHtml.ts` calls `createDOMPurify(window)` to get its own private
// instance, precisely so that a hook registered on the shared `dompurify`
// singleton -- such as the three `parser.svelte.ts` registers at import
// time in production -- can never reach this sink's output. Nothing short
// of a test against the REAL default export can pin that: mocking
// `./globalApi.svelte` (see the top of this file) keeps `parser.svelte.ts`
// out of this suite entirely, which proves nothing about isolation, only
// that this suite does not happen to load the module that would register
// the hooks. If `sanitizeHubHtml` is ever reverted to the shared singleton
// (`import DOMPurify from 'dompurify'` used directly, or
// `createDOMPurify()` called with no arguments), this test must fail.
describe('sanitizeHubHtml: isolation from the shared DOMPurify singleton', () => {
    test('a hook registered on the default dompurify export does not affect this sink\'s output', () => {
        const hijackHref = (node: Element) => {
            if (node.tagName === 'A' && node.hasAttribute('href')) {
                node.setAttribute('href', 'https://hijacked.example/')
            }
        }

        // Registered directly on the package's shared singleton, not on
        // anything `hubHtml.ts` exports -- this is what a module loaded
        // elsewhere in the app (like `parser.svelte.ts`) does at import
        // time, entirely outside `hubHtml.ts`'s control.
        DOMPurify.addHook('afterSanitizeAttributes', hijackHref)

        try {
            const out = sanitizeHubHtml('<a href="https://example.com/path">click</a>')

            // If `sanitizeHubHtml` used the shared singleton, the hook above
            // would rewrite this href before the sanitized markup is
            // returned. It must not: `hubHtml.ts` sanitizes through its own
            // `createDOMPurify(window)` instance, whose hook table starts
            // and stays empty regardless of what is registered here.
            expect(out).toBe('<a href="https://example.com/path">click</a>')
        }
        finally {
            // Must not leak into any other test IN THIS FILE -- vitest's
            // default file-level isolation gives each test *file* its own
            // fresh module graph (confirmed directly: a hook left
            // registered by one file's test, with no cleanup, was not
            // visible to a second file's test in the same run), so this
            // hook cannot reach another file's tests regardless of cleanup.
            // It CAN reach every other test in this same file, which all
            // share this one module instance -- that is the leak this
            // `finally` actually guards against.
            DOMPurify.removeHook('afterSanitizeAttributes', hijackHref)
        }

        // Explicit proof the cleanup above actually worked, in this same
        // test rather than by relying on suite ordering: a second call
        // after `removeHook` is back to the un-hijacked output.
        expect(sanitizeHubHtml('<a href="https://example.com/path">click</a>'))
            .toBe('<a href="https://example.com/path">click</a>')
    })
})
