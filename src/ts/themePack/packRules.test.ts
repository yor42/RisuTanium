// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { AREA_LINT, lintAreaPack, PACK_SIZE_WARN_BYTES, preprocessCss, THEME_AREAS, validateThemePack } from './index'
import { normalise } from './engine'
import { extractFontFaces } from './fontFace'
import { packSizeWarning } from './packSize'
import { STUDIO_PARTS, TOKEN_FILES } from './tokens'
import { isBundledTarget, URL_POLICY_REASON, ELEMENT_REASON } from './urlPolicy'
import { canonicalStylesheet } from './canonical'
// The repository root, from this file's location, so the suite does not depend on the working directory.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

// The pack rules the maintainer decided for the app on top of the reference validator: MC-1351 (bundled fonts and images
// only, no remote url()) and MC-1354 (a warning above 20 MB). The reference itself is pinned by parity.test.ts.

const SAFE_LEAF = '[data-part="chat-message-avatar"]'
const REMOTE = /remote or non-bundled url\(\)/

function urlErrors(area: 'chat' | 'studio' | 'settings' | 'home', css: string): string[] {
    return lintAreaPack(area, css).errors.filter((e) => e.prop === 'url()').map((e) => e.why)
}

describe('MC-1351: only bundled resources', () => {
    test.each([
        ['an https image', `${SAFE_LEAF}{background-image:url(https://evil.example/x.png)}`],
        ['an http image, quoted', `${SAFE_LEAF}{background-image:url("http://evil.example/x.png")}`],
        ['a protocol-relative image', `${SAFE_LEAF}{background-image:url('//evil.example/x.png')}`],
        ['a data: URI', `${SAFE_LEAF}{background-image:url(data:image/png;base64,AAAA)}`],
        ['javascript:', `${SAFE_LEAF}{background-image:url(javascript:alert(1))}`],
        ['upper case', `${SAFE_LEAF}{background-image:URL(HTTPS://EVIL.EXAMPLE/X.PNG)}`],
        ['whitespace inside url()', `${SAFE_LEAF}{background-image:url(  "https://evil.example/x.png"  )}`],
        ['an absolute path', `${SAFE_LEAF}{background-image:url(/etc/x.png)}`],
        ['a parent segment', `${SAFE_LEAF}{background-image:url(images/../../x.png)}`],
        ['a percent-encoded parent segment', `${SAFE_LEAF}{background-image:url(images/%2E%2e/x.png)}`],
        ['a backslash in the path', `${SAFE_LEAF}{background-image:url("images\\\\x.png")}`],
        ['backslashes a browser reads as a protocol-relative host', `${SAFE_LEAF}{background-image:url("\\\\\\\\evil.example/x.png")}`],
        ['a scheme-looking relative path', `${SAFE_LEAF}{background-image:url(foo:bar.png)}`],
        ['a fragment-only reference', `${SAFE_LEAF}{background-image:url(#paint)}`],
        ['a string in image-set()', `${SAFE_LEAF}{background-image:image-set("https://evil.example/x.png" 1x)}`],
        ['a string in -webkit-image-set()', `${SAFE_LEAF}{background-image:-webkit-image-set("https://evil.example/x.png" 1x)}`],
        ['a string in src()', `${SAFE_LEAF}{background-image:src("https://evil.example/x.png")}`],
        ['a remote url() inside a custom property', ':root{--pack-bg:url(https://evil.example/x.png)}'],
        ['a remote url() in @font-face src', '@font-face{font-family:p;src:url(https://evil.example/f.woff2)}'],
    ])('rejects %s', (_name, css) => {
        for (const area of THEME_AREAS) {
            const result = lintAreaPack(area, css)
            expect(result.ok, area).toBe(false)
            expect(result.errors.some((e) => REMOTE.test(e.why)), area).toBe(true)
        }
    })

    test('refuses an escaped url() for its escape', () => {
        const result = lintAreaPack('chat', `${SAFE_LEAF}{background-image:\\75 RL(HTTPS://EVIL.EXAMPLE/X.PNG)}`)
        expect(result.ok).toBe(false)
        expect(result.errors.some((e) => /a backslash escape is not allowed/.test(e.why))).toBe(true)
    })

    test('refuses element() outright', () => {
        expect(lintAreaPack('chat', `${SAFE_LEAF}{background-image:element(#x)}`).errors.some((e) => e.why === ELEMENT_REASON)).toBe(true)
    })

    test('a bundled image on a safe leaf passes the url policy, and the reference rules still judge where images may go', () => {
        expect(urlErrors('chat', `${SAFE_LEAF}{background-image:url(images/avatar-frame.png)}`)).toEqual([])
        expect(urlErrors('chat', `${SAFE_LEAF}{background-image:url("./images/a b.png")}`)).toHaveLength(1)
        // A reach subject may not take an image at all under the reference rules, bundled or not.
        const reach = lintAreaPack('chat', '[data-part="chat-header"]{background-image:url(images/x.png)}')
        expect(reach.ok).toBe(false)
        expect(reach.errors.some((e) => /an image/.test(e.why))).toBe(true)
    })

    test('classifies targets', () => {
        for (const ok of ['fonts/a.woff2', 'a.png', './images/x.png', 'images/x.png?v=2', 'deep/er/x.webp']) expect(isBundledTarget(ok), ok).toBe(true)
        for (const bad of ['', 'https://x', '//x', '/x', '#x', 'data:x', 'a\\b', 'a b', 'a\tb', 'a\u0001b', '../x', 'a/../b', 'a/%2e%2e/b', '%zz', 'c:x', 'fonts/a:b.woff2']) expect(isBundledTarget(bad), JSON.stringify(bad)).toBe(false)
        // Only percent-decoding reveals these: a scheme, a protocol-relative host, a backslash, whitespace or a control character.
        for (const encoded of ['https%3a//evil.example/x.png', '%2f%2fevil.example/x.png', '%2Fetc/x.png', 'a%5cb.png', 'a%20b.png', 'a%0ab.png']) expect(isBundledTarget(encoded), encoded).toBe(false)
    })

    test('every resource the tokeniser finds carries the MC-1351 reason and its target', () => {
        const errors = canonicalStylesheet(preprocessCss(`${SAFE_LEAF}{background-image:url(https://a),image-set("https://b" 1x)}`)).errors.filter((e) => e.prop === 'url()')
        expect(errors.map((e) => e.why)).toEqual([`${URL_POLICY_REASON}: https://a`, `${URL_POLICY_REASON}: https://b`])
    })
})

describe('the validator reads the stylesheet as a browser does (Gate 2 round 1)', () => {
    // Each of these hid a remote url() (or a whole declaration) from the engine's comment-stripped view while a browser
    // still applies it; each must be refused.
    test.each([
        ['comment delimiters inside strings around a remote url()', `${SAFE_LEAF}{font-family:"/*";background-image:url(//evil.example/x.png);font-family:"*/"}`],
        ['an escaped slash opening a fake comment', `${SAFE_LEAF}{b:url(x\\/*);background:url(//evil.example/x.png); /* */}`],
        ['a remote @font-face between string delimiters', `@font-face{font-family:f;src:url(x.woff2)} ${SAFE_LEAF}{font-family:"/*"} @font-face{font-family:g;src:url(//evil/f.woff2)} ${SAFE_LEAF}{font-family:"*/"}`],
        ['a remote @font-face after an escaped comment opener', '\\/* @font-face{font-family:f;src:url(//evil/f.woff2)} */'],
        ['an escaped quote that ends the string for the engine only', `${SAFE_LEAF}{font-family:"\\"";display:none;font-family:"x"}`],
        ['a hex escape that closes a block for the engine only', `${SAFE_LEAF}{font-family:a\\7d;display:none}`],
        ['a comment opener inside an unquoted url()', `${SAFE_LEAF}{background-image:url(a/*b.png);x:y} /* */`],
        ['an escaped url token with a comment opener inside', `${SAFE_LEAF}{background-image:\\75rl(a/*b.png);x:y} /* */`],
        ['an upper-case escaped url token with a comment opener inside', `${SAFE_LEAF}{background-image:\\55RL(a/*b.png);x:y} /* */`],
    ])('refuses %s', (_name, css) => {
        for (const area of THEME_AREAS) expect(lintAreaPack(area, css).ok, area).toBe(false)
        expect(canonicalStylesheet(preprocessCss(css)).errors.length).toBeGreaterThan(0)
    })

    // Gate 2 round 2: a browser rewrites CR LF, CR and FF to LF (and NUL to U+FFFD) before tokenising; the validator judges that stream.
    test.each([
        ['a CR ending a hex escape in url', `${SAFE_LEAF}{background-image:u\\72\rl(https://e.x/a.png)}`],
        ['an FF ending a hex escape in url', `${SAFE_LEAF}{background-image:u\\72\fl(https://e.x/a.png)}`],
        ['a CR LF ending a hex escape in url', `${SAFE_LEAF}{background-image:\\75\r\nrl(https://e.x/a.png)}`],
        ['a CR ending a hex escape in a property name', `[data-part="chat-header"]{pos\\69\rtion:fixed;inset:0}`],
        ['a CR ending a string early', `${SAFE_LEAF}{font-family:"a\r;position:fixed;inset:0;--q:"}`],
        ['an FF ending a string early', `${SAFE_LEAF}{font-family:"a\f;position:fixed;inset:0;--q:"}`],
    ])('refuses %s', (_name, css) => {
        for (const area of THEME_AREAS) expect(lintAreaPack(area, css).ok, area).toBe(false)
    })

    // The bypass hunt before Gate 2 round 3 (each confirmed in Chromium: a remote request, or a declaration applied that
    // the engine never judged). The strict profile refuses every one.
    const CB = '[data-part="chat-critical-body"]'
    const FAILED = '[data-part="chat-failed-card"]'
    test.each([
        ['an out-of-range escape between / and *', `${SAFE_LEAF}{x:a/\\110000*}${CB}{position:fixed;inset:0}/* */`],
        ['a line continuation inside a selector string', `[data-part="chat-critical-bo\\\ndy"]{position:fixed}`],
        ['a line continuation hiding a later image-set target', `${SAFE_LEAF}{background-image:image-set("a\\\nb" 1x,"https://evil.example/x.png" 1x)}`],
        ['NBSP after url(', `${SAFE_LEAF}{background-image:url(\u00a0"x.png")}/* ;position:fixed */`],
        ['a vertical tab after url(', `${SAFE_LEAF}{background-image:url(\u000b"x.png")}/* ;position:fixed */`],
        ['a byte-order mark after url(', `${SAFE_LEAF}{background-image:url(\ufeff"x.png")}/* ;position:fixed */`],
        ['a brace inside an unquoted url in @font-face', `@font-face{font-family:f;src:url(a}b.woff2)}${CB}{position:fixed}`],
        ['a remote url() directly inside image-set()', `${SAFE_LEAF}{background-image:image-set(url(https://evil.example/a.png) 1x)}`],
        ['a remote url() inside -webkit-cross-fade()', `${SAFE_LEAF}{background-image:-webkit-cross-fade(url(https://evil.example/h.png),url(a.png),50%)}`],
        ['a remote url() in image-set() inside a custom property', `:root{--pack-bg:image-set(url(https://evil.example/tk.png) 1x)}${SAFE_LEAF}{background-image:var(--pack-bg)}`],
        ['a comment joining a word to url(', `${SAFE_LEAF}{background:red/**/url(https://evil.example/d.png)}`],
        ['a string reaching image-set() through var()', `:root{--pack-u:"https://evil.example/g.png"}${SAFE_LEAF}{background-image:image-set(var(--pack-u) 1x)}`],
        ['a quote inside an unquoted url hiding a rule', `${SAFE_LEAF}{background:red url(x')}${FAILED}{display:none}${SAFE_LEAF}{background:red url(y')}`],
        ['a parenthesis inside an unquoted url hiding a rule', `${SAFE_LEAF}{background:red url(a(b)}${FAILED}{display:none}${SAFE_LEAF}{color:red;--x:c)}`],
        ['@media nested in a rule', `${FAILED} { @media all { display: none } }`],
        ['@media nested in :root', ':root { @media all { --nexus-text: transparent } }'],
        ['a brace inside parentheses', `${FAILED} { ( } ) ; display: none`],
        ['a brace inside brackets', `${FAILED} { [ } ] ; display: none`],
        ['a {} block as a token value', ':root { --color-surface-sheet: {} }'],
        ['a {} block as a value on a protected part', `${FAILED} { --nexus-danger: {}; }`],
        ['a non-ASCII custom property name', '[data-part="chat-send"] { --\u00e9: 0px; font-size: var(--\u00e9) }'],
        ['an escaped custom property name', '[data-part="chat-send"] { --a\\.b: 0px; font-size: var(--a\\.b) }'],
        ['! important with a space', '[data-part="chat-send"] { font-size: 0 ! important }'],
        ['! important around a comment', '[data-part="chat-send"]:focus-visible { box-shadow: none !/**/important }'],
    ])('refuses %s', (_name, css) => {
        for (const area of THEME_AREAS) expect(lintAreaPack(area, css).ok, area).toBe(false)
        expect(canonicalStylesheet(preprocessCss(css)).errors.length).toBeGreaterThan(0)
    })

    // The second bypass hunt (each confirmed in Chromium): a length the size checks would read smaller than the browser
    // draws, written plainly in px it is refused, so it must be refused in these forms too.
    test.each([
        ['an exponent in a border width', `${SAFE_LEAF}{border:1e3px solid red}`],
        ['an upper-case exponent in a border width', `${SAFE_LEAF}{border:1E2px solid red}`],
        ['a fractional exponent in a border width', `${SAFE_LEAF}{border:.5e3px solid red}`],
        ['a negative exponent form', `${SAFE_LEAF}{border:1e-0px solid red}`],
        ['an exponent in a box-shadow spread', `${SAFE_LEAF}{box-shadow:0 0 0 1e3px red}`],
        ['an exponent on a reach-tier part', '[data-part="chat-header"]{border:1e3px solid red}'],
        ['a pica border width', `${SAFE_LEAF}{border:10pc solid red}`],
        ['a quarter-millimetre border width', `${SAFE_LEAF}{border:300q solid red}`],
        ['an upper-case unit', `${SAFE_LEAF}{border:1000PX solid red}`],
        ['a dynamic viewport unit', `${SAFE_LEAF}{box-shadow:0 0 0 100dvh red}`],
    ])('refuses %s', (_name, css) => {
        for (const area of THEME_AREAS) expect(lintAreaPack(area, css).ok, area).toBe(false)
        expect(canonicalStylesheet(preprocessCss(css)).errors.map((e) => e.why)).toEqual([expect.stringMatching(/a number must be written plainly/)])
    })

    // Each strict-profile rule names its own reason, so the rule is pinned even where another rule also refuses the input.
    test.each([
        ['a control character outside a string', `${SAFE_LEAF}{color:red\u0001}`, /a control character other than tab and line feed/],
        ['DEL outside a string', `${SAFE_LEAF}{color:red\u007f}`, /a control character other than tab and line feed/],
        ['a control character inside a string', `${SAFE_LEAF}{font-family:"a\u0002b"}`, /a control character other than tab and line feed/],
        ['an unterminated comment', `${SAFE_LEAF}{color:red} /* open`, /an unterminated comment is not allowed/],
        ['a CDO marker', `<!-- ${SAFE_LEAF}{color:red}`, /the <!-- and --> markers are not allowed/],
        ['a CDC marker', `${SAFE_LEAF}{color:red} -->`, /the <!-- and --> markers are not allowed/],
        ['an unterminated string', `${SAFE_LEAF}{font-family:"abc}`, /a string broken by a line end, or unterminated/],
        ['a string broken by a line end', `${SAFE_LEAF}{font-family:"ab\nc";color:red}`, /a string broken by a line end, or unterminated/],
        ['a space inside an unquoted url', `${SAFE_LEAF}{background-image:url(a b.png)}`, /an unquoted url\(\) may not hold/],
        ['a quote inside an unquoted url', `${SAFE_LEAF}{background-image:url(a'b.png)}`, /an unquoted url\(\) may not hold/],
        ['an unclosed unquoted url', `${SAFE_LEAF}{background-image:url(a.png`, /an unquoted url\(\) may not hold/],
        ['a brace inside parentheses', `${SAFE_LEAF}{color:rgb( { )}`, /a brace inside parentheses or brackets/],
        ['an at-rule inside an @media block', '@media all{@font-face{font-family:f;src:url(f.woff2)}}', /an at-rule inside a rule is not allowed/],
        ['an at-keyword inside a rule', `${SAFE_LEAF}{@x;color:red}`, /an at-rule inside a rule is not allowed/],
        ['an unclosed parenthesis', `${SAFE_LEAF}{color:rgb(1,2,3}`, /every block, parenthesis and bracket must be closed/],
        ['an unclosed block', `${SAFE_LEAF}{color:red`, /every block, parenthesis and bracket must be closed/],
    ])('names its reason for %s', (_name, css, why) => {
        expect(canonicalStylesheet(css).errors.map((e) => e.why)).toContainEqual(expect.stringMatching(why))
    })

    test('ordinary numbers, colours, unicode ranges and an+b pass the number rule', () => {
        const css = [
            `${SAFE_LEAF}{border:1px solid #1e3;color:#1E3E3E;padding:0.5rem 2em;transition:opacity 120ms,transform .2s;transform:rotate(90deg) translateY(-2px);margin:-4px}`,
            `${SAFE_LEAF}{background-image:image-set("a.png" 1x,"b.png" 2x);grid-template-columns:1fr 2fr;width:50%;line-height:1.5;z-index:2}`,
            `${SAFE_LEAF}:nth-child(2n+1){opacity:.9} ${SAFE_LEAF}:nth-child(2n-1){opacity:.8} ${SAFE_LEAF}:nth-child(3){opacity:1}`,
            '@font-face{font-family:f;src:url(f.woff2);unicode-range:U+0025-00FF,u+4E00-9FFF,U+4??}',
            '@media (min-width: 600px) and (max-resolution: 2dppx){:root{--x:1}}',
        ].join('\n')
        expect(canonicalStylesheet(css).errors).toEqual([])
    })

    test('preprocessing matches CSS Syntax and keeps a CR LF pack acceptable', () => {
        expect(preprocessCss('a\r\nb\rc\fd\u0000e')).toBe('a\nb\nc\nd\ufffde')
        for (const area of THEME_AREAS) {
            const lf = readFileSync(path.resolve(ROOT, `docs/design/${area}/themes/origin-navy.css`), 'utf8')
            expect(lintAreaPack(area, lf.replace(/\n/g, '\r\n')).errors, area).toEqual([])
        }
    })

    test('ordinary comments, strings and harmless escapes read the same way and pass', () => {
        // Non-ASCII text is written as itself inside strings and comments; an escape is refused instead.
        expect(canonicalStylesheet(`/* 설명 */${SAFE_LEAF}{font-family:"Pack \u201C Serif";color:#f8f8f2} /* b */ ${SAFE_LEAF}{content:"\u2014"}`).errors).toEqual([])
        expect(canonicalStylesheet(`${SAFE_LEAF}{background-image:url(images/a.png)} /* c */`).errors).toEqual([])
        expect(canonicalStylesheet(`${SAFE_LEAF}{content:"\\2014"}`).errors.map((e) => e.why)).toEqual([expect.stringMatching(/a backslash escape is not allowed/)])
    })

    test('a comment opener inside a string is reported with its reason', () => {
        expect(canonicalStylesheet(`${SAFE_LEAF}{font-family:"/*"} /* x */`).errors.map((e) => e.why)).toEqual([expect.stringMatching(/a string or a url\(\) may not contain \/\* or \*\//)])
    })

    test.each([
        ['-moz-element()', `${SAFE_LEAF}{background:-moz-element(#x)}`, /element\(\) is not allowed/],
        ['a string in -moz-image-set()', `${SAFE_LEAF}{background-image:-moz-image-set("https://evil.example/x.png" 1x)}`, REMOTE],
    ])('refuses %s whatever the vendor prefix', (_name, css, why) => {
        const result = lintAreaPack('chat', css)
        expect(result.ok).toBe(false)
        expect(result.errors.some((e) => why.test(e.why))).toBe(true)
    })
})

describe('MC-1351: bundled fonts through @font-face', () => {
    const FACE = '@font-face{font-family:"pack-serif";src:url(fonts/serif.woff2) format("woff2"),url("fonts/serif.woff") format("woff");font-weight:400 700;font-style:normal;font-display:swap;unicode-range:U+0000-00FF}'

    test('a top-level @font-face with bundled sources is accepted in every area, and the rest is judged as before', () => {
        for (const area of THEME_AREAS) {
            const plain = AREA_LINT[area]('', '')
            const result = lintAreaPack(area, FACE)
            expect(result.ok, `${area}: ${JSON.stringify(result.errors)}`).toBe(true)
            expect(result.errors).toEqual(plain.errors)
        }
    })

    test('the blocks and the remainder reassemble the input, and the remainder is the original text around them', () => {
        const css = `:root{--pack-a:#fff}\n${FACE}\n/* note */${SAFE_LEAF}{color:#fff}\n${FACE}`
        const out = extractFontFaces(css, normalise)
        expect(out.blocks).toHaveLength(2)
        let rebuilt = ''
        let at = 0
        for (const block of out.blocks) { rebuilt += css.slice(at, block.start) + block.text; at = block.end }
        rebuilt += css.slice(at)
        expect(rebuilt).toBe(css)
        expect(out.remainder).toBe(`:root{--pack-a:#fff}\n\n/* note */${SAFE_LEAF}{color:#fff}\n`)
        expect(extractFontFaces(`${SAFE_LEAF}{color:#fff}`, normalise).remainder).toBe(`${SAFE_LEAF}{color:#fff}`)
    })

    test('an escaped at-keyword is still found, and a nested @font-face is left for the engine to refuse', () => {
        expect(extractFontFaces('@\\66ont-face{font-family:p;src:url(f.woff2)}', normalise).blocks).toHaveLength(1)
        expect(extractFontFaces('@FONT-FACE{font-family:p;src:url(f.woff2)}', normalise).blocks).toHaveLength(1)
        const nested = lintAreaPack('chat', '@media (min-width:1px){@font-face{font-family:p;src:url(f.woff2)}}')
        expect(nested.ok).toBe(false)
        expect(nested.errors.some((e) => /@font-face is not allowed/.test(e.why))).toBe(true)
    })

    test('a brace inside a string does not end the block early', () => {
        const css = '@font-face{font-family:"a}b";src:url("f}.woff2")}' + `${SAFE_LEAF}{color:#fff}`
        const out = extractFontFaces(css, normalise)
        expect(out.blocks).toHaveLength(1)
        expect(out.remainder).toBe(`${SAFE_LEAF}{color:#fff}`)
    })

    test.each([
        ['a local() source', '@font-face{font-family:p;src:local("Arial")}', /local\(\) fonts are not allowed/],
        ['a descriptor outside the list', '@font-face{font-family:p;src:url(f.woff2);size-adjust:200%}', /size-adjust is not an allowed @font-face descriptor/],
        ['a function in a plain descriptor', '@font-face{font-family:p;src:url(f.woff2);font-weight:var(--w)}', /takes a plain value/],
        ['a src item that is not url()', '@font-face{font-family:p;src:format("woff2")}', /src item must be url/],
        ['no src', '@font-face{font-family:p}', /must name its bundled font with src/],
        ['no family', '@font-face{src:url(f.woff2)}', /must name its family/],
        ['a prelude before the block', '@font-face x{font-family:p;src:url(f.woff2)}', /followed directly by its block/],
        ['a nested block', '@font-face{font-family:p;src:url(f.woff2);a{b:c}}', /no nested blocks/],
        ['an unterminated block', '@font-face{font-family:p;src:url(f.woff2)', /unterminated @font-face block/],
    ])('rejects %s', (_name, css, why) => {
        const result = lintAreaPack('chat', css)
        expect(result.ok).toBe(false)
        expect(result.errors.some((e) => why.test(e.why)), JSON.stringify(result.errors)).toBe(true)
    })
})

describe('MC-1354: the size warning', () => {
    test('warns only strictly above 20 MiB and never changes the verdict', () => {
        expect(PACK_SIZE_WARN_BYTES).toBe(20 * 1024 * 1024)
        expect(packSizeWarning(PACK_SIZE_WARN_BYTES)).toEqual({ warn: false, limitBytes: PACK_SIZE_WARN_BYTES })
        expect(packSizeWarning(PACK_SIZE_WARN_BYTES + 1).warn).toBe(true)
        const big = validateThemePack({ files: { chat: '' }, totalBytes: PACK_SIZE_WARN_BYTES + 1 })
        expect(big.ok).toBe(true)
        expect(big.size.warn).toBe(true)
        const bad = validateThemePack({ files: { chat: `${SAFE_LEAF}{background-image:url(https://x)}`, home: '' }, totalBytes: 1 })
        expect(bad.ok).toBe(false)
        expect(bad.size.warn).toBe(false)
        expect(Object.keys(bad.areas)).toEqual(['chat', 'home'])
    })
})

describe('the acceptance packs (MC-1355) through the public API', () => {
    test.each(THEME_AREAS.flatMap((area) => ['origin-navy', 'banana-cocoa'].map((pack) => [area, pack] as const)))('%s / %s is accepted', (area, pack) => {
        const css = readFileSync(path.resolve(ROOT, `docs/design/${area}/themes/${pack}.css`), 'utf8')
        const result = lintAreaPack(area, css, pack)
        expect(result.errors).toEqual([])
    })
})

describe('the bundled inputs', () => {
    test('every token stylesheet and Studio parts registry is present with its known tokens', () => {
        const sentinels: Record<string, RegExp> = {
            'chat/theme-tokens.css': /--chat-dur-fast\s*:/, 'theme/nexus-tokens.css': /--nexus-text\s*:/, 'studio/studio-tokens.css': /--studio-[\w-]+\s*:/,
            'studio/st4.css': /--studio-[\w-]+\s*:/, 'settings/theme-tokens.css': /--settings-[\w-]+\s*:/, 'home/home-tokens.css': /--home-[\w-]+\s*:/,
        }
        for (const [file, text] of Object.entries(TOKEN_FILES)) {
            expect(text.length, file).toBeGreaterThan(1000)
            expect(text, file).toMatch(sentinels[file])
            expect(text, file).toBe(readFileSync(path.resolve(ROOT, `docs/design/${file}`), 'utf8'))
        }
        for (const [file, registry] of Object.entries(STUDIO_PARTS)) {
            expect(registry.parts?.length ?? 0, file).toBeGreaterThan(5)
            expect(registry).toEqual(JSON.parse(readFileSync(path.resolve(ROOT, `docs/design/studio/checks/th/${file}`), 'utf8')))
        }
    })

    test('no module of the validator uses a node API (it runs in the browser)', () => {
        const dir = path.resolve(ROOT, 'src/ts/themePack')
        const files = [...readdirSync(dir).map((f) => path.join(dir, f)), ...readdirSync(path.join(dir, 'registries')).map((f) => path.join(dir, 'registries', f))]
            .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        expect(files.length).toBeGreaterThan(10)
        for (const file of files) {
            const source = readFileSync(file, 'utf8')
            expect(source, file).not.toMatch(/from ['"](node:|fs['"]|path['"]|url['"])|\brequire\(|\bprocess\.|import\.meta\.url|\bBuffer\b/)
        }
    })
})

// ---- UI-S6 stage 1: the pack normal form (MC-1549, MC-1550, MC-1555, MC-1556, MC-1564 to MC-1568).
// A reproducer is red on the pre-fix sources by assertion (the pack is accepted and no reason is returned), never at
// import. A guard passes before and after. A "new-rule test" pins a rule whose pre-fix verdict does not change.
type PackArea = 'chat' | 'settings' | 'studio' | 'home'
const TEXT_LEAF = '[data-part="chat-message-text"]'
const SEND = '[data-part="chat-send"]'
const DARK = 'background:#111111;color:#111111'
const reasonsOf = (area: PackArea, css: string): string[] => lintAreaPack(area, css).errors.map((e) => e.why)
function expectRefused(area: PackArea, css: string, ...reasons: RegExp[]): void {
    const result = lintAreaPack(area, css)
    expect(result.ok, `${area}: accepted`).toBe(false)
    for (const re of reasons) expect(result.errors.some((e) => re.test(e.why)), `${area}: ${re} against ${JSON.stringify(result.errors.map((e) => e.why))}`).toBe(true)
}
function expectNoReason(area: PackArea, css: string, re: RegExp): void {
    expect(reasonsOf(area, css).filter((why) => re.test(why)), `${area}: ${css}`).toEqual([])
}
function expectAcceptedPack(area: PackArea, css: string): void {
    const result = lintAreaPack(area, css)
    expect(result.errors, `${area}: ${css}`).toEqual([])
}
const RE_1549 = /MC-1549/
const RE_1550 = /MC-1550/
const RE_1564 = /MC-1564/
const RE_1565 = /MC-1565/
const RE_1568 = /MC-1568/
const I3_RE = /attribute value or at-rule string in a selector or prelude may hold only a-z/
const N1R_RE = /a pack may set tokens only on :root/

describe('U: a bundled target names a file (MC-1549)', () => {
    test.each([
        ['c|/x', 'c|/x'], ['c|x.woff2', 'c|x.woff2'], ['a|b.png', 'a|b.png'], ['an encoded pipe', 'c%7c/x.png'],
        ['a query only', '?x'], ['a lone question mark', '?'], ['a dot', '.'], ['dot slash', './'], ['a directory', 'a/'], ['a trailing dot segment', 'a/.'], ['images/', 'images/'],
    ])('isBundledTarget refuses %s', (_name, target) => { expect(isBundledTarget(target), target).toBe(false) })

    test('isBundledTarget keeps its good list, and a fragment or query after a file name', () => {
        for (const ok of ['fonts/a.woff2', 'a.png', './images/x.png', 'images/x.png?v=2', 'deep/er/x.webp', 'fonts/a.woff2#x']) expect(isBundledTarget(ok), ok).toBe(true)
    })

    test.each([
        ['a Windows drive url', `${SAFE_LEAF}{background:url(c|/Windows/win.ini)}`],
        ['a pipe in a font src', '@font-face{font-family:foo;src:url(c|/x.woff2)}[data-part="chat-message-name"]{font-family:foo}'],
        ['a pipe in a background image', '[data-part="chat-message-name"]{background-image:url(c|/x.png)}'],
        ['a quoted pipe url', `${SAFE_LEAF}{background-image:url("c|/x.png")}`],
        ['a pipe in image-set()', `${SAFE_LEAF}{background-image:image-set("c|/x.png" 1x)}`],
        ['a pipe in -webkit-image-set()', `${SAFE_LEAF}{background-image:-webkit-image-set("c|/x.png" 1x)}`],
        ['a pipe in border-image', `${SAFE_LEAF}{border-image:url(Z|/x.png) 30}`],
        ['a pipe in a font src without a slash', '@font-face{font-family:foo;src:url(c|x.woff2)}'],
        ['an empty path', `${SAFE_LEAF}{background-image:url(?x)}`],
        ['a dot', `${SAFE_LEAF}{background-image:url(.)}`],
        ['dot slash', `${SAFE_LEAF}{background-image:url(./)}`],
        ['a directory', `${SAFE_LEAF}{background-image:url(images/)}`],
        ['an empty path in @font-face src', '@font-face{font-family:foo;src:url(?x)}'],
    ])('refuses %s in every area', (_name, css) => {
        for (const area of THEME_AREAS) expectRefused(area, css, REMOTE)
    })
})

// The bypass hunt's literal stylesheets, in the CSS the hunt used: each was accepted before the pack normal form and is refused in every area.
describe('the bypass hunt literals (MC-1549, MC-1351)', () => {
    test.each([
        ['v_cp01 a calc product in border-width', `${SAFE_LEAF}{border-width:calc(10px * 100);border-style:solid}`],
        ['v_cp03 a calc product with a token factor', `:root{--pack-n:1000}\n${SAFE_LEAF}{border-width:calc(1px * var(--pack-n));border-style:solid}`],
        ['v_cr46 a calc sum in border-width', `${SAFE_LEAF}{border-width:calc(32px + 33px);border-style:solid}`],
        ['v_cp10 a calc product in padding', `${SAFE_LEAF}{padding:calc(10px * 100)}`],
        ['v_cp04 a nested fallback hiding a product', `${SAFE_LEAF}{border-width:var(--pack-none, calc(min(1px, 2px) * 1000));border-style:solid}`],
        ['v_cp07 a calc product in a box-shadow', `${SAFE_LEAF}{box-shadow:0 0 calc(20px * 100) red}`],
    ])('S1 %s', (_name, css) => {
        for (const area of THEME_AREAS) expectRefused(area, css, RE_1549)
    })

    test.each([
        ['max(500%,12px)'], ['calc(12px * 100)'], ['calc(40px * 5)'], ['var(--nope,500%)'], ['min(1%,40px)'], ['calc(40px * 0.001)'], ['calc(12px + 500%)'], ['calc(100% * 50)'],
    ])('FS1 refuses font-size:%s on the message text', (value) => {
        for (const area of THEME_AREAS) expectRefused(area, `${TEXT_LEAF}{font-size:${value}}`, RE_1549)
    })

    test.each([
        ['v-pipe a pipe in a font src', '@font-face{font-family:Foo;src:url(c|/x.woff2)}\n[data-part="chat-message-name"]{font-family:Foo}'],
        ['v-n11 a query-only url', `${SAFE_LEAF}{background:url(?x)}`],
        ['v-n12 a dot url', `${SAFE_LEAF}{background:url(.)}`],
    ])('%s', (_name, css) => {
        for (const area of THEME_AREAS) expectRefused(area, css, REMOTE)
    })
})

describe('N1: tokens have one plain-root value, --pack-* helpers a plain-root default', () => {
    test.each([
        ['a token under data-layout (attribute selector)', ':root{--nexus-pad:10px}html[data-layout="phone"]{--nexus-pad:1000px}' + `${SAFE_LEAF}{padding:var(--nexus-pad)}`],
        ['a token on html', `html{--nexus-fs:2px}${TEXT_LEAF}{font-size:var(--nexus-fs)}`],
        ['a token in an @media :root', `:root{--nexus-fs:2px}@media (min-width:100000px){:root{--nexus-fs:14px}}${TEXT_LEAF}{font-size:var(--nexus-fs)}`],
        ['a selector list holding :root', `:root,html{--nexus-pad:1000px}${SAFE_LEAF}{padding:var(--nexus-pad)}`],
        ['a bounded token under data-layout', ':root{--focus-ring-w:2px}html[data-layout="phone"]{--focus-ring-w:0px}'],
    ])('N1r refuses %s', (_name, css) => { expectRefused('chat', css, N1R_RE, RE_1565) })

    test.each([
        ['a bare --pack- declaration used by padding', `:root{--pack-:1000px}${SAFE_LEAF}{padding:var(--pack-)}`],
        ['a bare --pack- in a border', `:root{--pack-:1000px}${SEND}{border:var(--pack-) solid red}`],
        ['a bare --pack- font size', `:root{--pack-:2px}${TEXT_LEAF}{font-size:var(--pack-)}`],
    ])('N1p refuses %s', (_name, css) => { expectRefused('chat', css, /the bare name --pack- is not a helper token/) })

    test.each([
        ['a helper declared only on a non-root selector', `${SAFE_LEAF}{--pack-c:#111111}${SEND}{background:#ffff00;color:var(--pack-c)}`],
        ['a helper declared only under data-input', `html[data-input="touch"]{--pack-c:#111111}${SEND}{background:#ffff00;color:var(--pack-c)}`],
        ['a helper declared only in an @media :root', `@media (min-width:1px){:root{--pack-c:#111111}}${SEND}{background:#ffff00;color:var(--pack-c)}`],
        ['a focus shadow helper under data-input', `html[data-input="touch"]{--pack-s:0 0 0 2px #ffffff}${SEND}:focus-visible{box-shadow:var(--pack-s)}`],
    ])('N1q refuses %s', (_name, css) => { expectRefused('chat', css, /is used but has no value on :root/, RE_1565) })

    test('N1c refuses "!" in a token value, in the middle of the value too', () => {
        expectRefused('chat', `:root{--nexus-pad:1000px;--nexus-pad:10px !important x}${SAFE_LEAF}{padding:var(--nexus-pad)}`, /"!" is not allowed in a token value/, RE_1564)
        expectRefused('chat', ':root{--pack-a:2px !important}', /"!" is not allowed in a token value/)
    })

    test.each([
        ['an empty token', `:root{--nexus-a:}${SEND}:focus-visible{box-shadow:var(--nexus-a)}`, /may not be empty/],
        ['a whitespace-only token', `:root{--nexus-a: }${SEND}:focus-visible{box-shadow:var(--nexus-a)}`, /may not be empty/],
        ['a CSS-wide keyword', `:root{--nexus-a:initial}${SEND}:focus-visible{box-shadow:var(--nexus-a)}`, /may not be initial/],
        ['an unknown reference inside a token', `:root{--nexus-pad:var(--h)}${SAFE_LEAF}{padding:var(--nexus-pad)}`, /neither the pack nor the app defines/],
        ['a cycle', ':root{--pack-a:var(--pack-b);--pack-b:var(--pack-a)}', /refers to itself through var\(\)/],
    ])('N1d refuses %s', (_name, css, why) => { expectRefused('chat', css, why, RE_1549) })

    test('N1d refuses a chain deeper than 8 tokens', () => {
        let css = ''
        for (let k = 0; k < 13; k++) css += `:root{--nexus-a${k}:var(--nexus-a${k + 1})}`
        css += `:root{--nexus-a13:1000px}${SAFE_LEAF}{padding:var(--nexus-a0)}`
        expectRefused('chat', css, /deeper than 8 tokens/)
    })
})

describe('N2: var() is exactly var(--name)', () => {
    test.each([
        ['a nested fallback', `:root{--nexus-a:1000px;--nexus-b:1px}${SAFE_LEAF}{padding:var(--nexus-a, var(--nexus-b, rgb(0 0 0)))}`],
        ['a nested --pack-* fallback', `:root{--pack-a:1000px;--pack-b:1px}${SAFE_LEAF}{padding:var(--pack-a, var(--pack-b, rgb(0 0 0)))}`],
        ['an empty fallback', `${SAFE_LEAF}{padding:var(--nexus-nope,)}`],
        ['a var() as the name', `:root{--nexus-a:--nexus-pad;--nexus-pad:1000px}${SAFE_LEAF}{padding:var(var(--nexus-a))}`],
        ['an initial token with a fallback', `:root{--pack-a:initial}${SAFE_LEAF}{padding:var(--pack-a, 1000px)}`],
        ['an upper-case VAR with a fallback', `:root{--nexus-a:1000px;--nexus-b:1px}${SAFE_LEAF}{padding:VAR(--nexus-a, VAR(--nexus-b, rgb(0 0 0)))}`],
    ])('N2a refuses %s', (_name, css) => { expectRefused('chat', css, /var\(\) must be exactly var\(--name\), without a fallback/, RE_1564) })

    test('N2b refuses a var() glued to the text after it', () => {
        expectRefused('chat', `:root{--nexus-a:1000px}${SAFE_LEAF}{padding:var(--nexus-a)0}`, /var\(\) must stand apart from the text around it/)
    })

    test.each([
        ['padding', `${SAFE_LEAF}{padding:var(--some-real-app-token)}`],
        ['font-size', `${TEXT_LEAF}{font-size:var(--some-real-app-token)}`],
    ])('N2c refuses an unknown token in %s', (_name, css) => { expectRefused('chat', css, /names no token of the pack or the app/) })
})

describe('N3: lengths in px and rem, allow-listed functions, percent where the engine reads it', () => {
    test.each([
        ['vw font size', `${TEXT_LEAF}{font-size:1.1vw}`],
        ['vw font size on Send', `${SEND}{font-size:1.1vw}`],
        ['vmin font size', `${TEXT_LEAF}{font-size:2vmin}`],
        ['em padding on a safe leaf', `${SEND}{font-size:40px;padding:4em}`],
        ['pt margin', `${SAFE_LEAF}{margin:1000pt}`],
        ['in margin', `${SAFE_LEAF}{margin:10in}`],
        ['a relative unit in a token', `:root{--nexus-pad:4em}${SEND}{font-size:40px;padding:var(--nexus-pad)}`],
    ])('N3a refuses %s', (_name, css) => { expectRefused('chat', css, /only px and rem lengths are allowed/, RE_1549) })

    test.each([
        ['padding through an app token in em', `${SEND}{font-size:40px;padding:var(--size-rel-12)}`],
        ['border through an app token in em', `${SEND}{font-size:40px;border:var(--size-rel-7) solid red}`],
        ['width through an app token in em', `${SAFE_LEAF}{font-size:500px;width:var(--size-rel-19)}`],
        ['min-height through an app token in vh', `${SAFE_LEAF}{min-height:var(--size-rel-20)}`],
        ['padding through a --pack-* helper that reaches an app token', `:root{--pack-p:var(--size-rel-12)}${SEND}{font-size:40px;padding:var(--pack-p)}`],
    ])('N3a refuses %s', (_name, css) => { expectRefused('chat', css, /uses var\(--size-rel-\d+\), whose value .* is in (em|vh)/, RE_1564) })

    test.each([
        ['a calc product', `${TEXT_LEAF}{margin:calc(10px * 100)}`],
        ['a calc sum in a shadow', `${SAFE_LEAF}{box-shadow:0 0 0 calc(32px + 33px) red}`],
        ['a calc product in a text shadow', `${SAFE_LEAF}{text-shadow:0 0 calc(10px * 100) red}`],
        ['a calc product in a token', `:root{--pack-p:calc(10px * 100)}${SAFE_LEAF}{padding:var(--pack-p)}`],
        ['a calc product in a bounded token', ':root{--sheet-padding-x:calc(10px * 100)}'],
        ['a calc product in a font size token', ':root{--font-size-md:calc(40px * 0.001)}'],
        ['a calc in letter-spacing', `${TEXT_LEAF}{letter-spacing:calc(1px * 100)}`],
        ['a negation with a wrong factor', `${SAFE_LEAF}{box-shadow:0 0 0 calc(-10px * -100) red}`],
        ['a negation of a token whose value is a product', `:root{--pack-k:-10px * 100}${SAFE_LEAF}{box-shadow:0 0 0 calc(var(--pack-k) * -1) red}`],
        ['env()', `${SAFE_LEAF}{padding:env(safe-area-inset-top)}`],
        ['min()', `:root{--focus-ring-w:min(0px,2px)}`],
        ['env() in a bounded token', ':root{--focus-ring-w:env(safe-area-inset-left, 2px)}'],
        ['clamp()', `${SAFE_LEAF}{padding:clamp(1px,100px,200px)}`],
        ['env() inside colour arguments', `${SAFE_LEAF}{border:1px solid rgb(env(x) 0 0)}`],
    ])('N3b refuses %s', (_name, css) => { expectRefused('chat', css, /is not allowed in a pack|only px and rem|must be one plain length/, RE_1549) })

    test('N3b names the function', () => {
        expect(reasonsOf('chat', `${SAFE_LEAF}{padding:env(safe-area-inset-top)}`).some((why) => /^env\(\) is not allowed in a pack/.test(why))).toBe(true)
        expect(reasonsOf('chat', `${SAFE_LEAF}{margin:calc(10px * 100)}`).some((why) => /^calc\(\) is not allowed in a pack except as calc\(<x> \* -1\)/.test(why))).toBe(true)
    })

    test.each([
        ['a margin percent', `${SAFE_LEAF}{margin-left:1000%}`, /a percentage is not allowed in margin-left/],
        ['a margin percent in a token', `:root{--nexus-m:1000%}${SAFE_LEAF}{margin-left:var(--nexus-m)}`, /a percentage is not allowed in margin-left .*through var\(--nexus-m\)/],
        ['a letter-spacing percent in a token', `:root{--nexus-ls:10000%}${TEXT_LEAF}{letter-spacing:var(--nexus-ls)}`, /a percentage is not allowed in letter-spacing/],
        ['a letter-spacing percent', `${TEXT_LEAF}{letter-spacing:10000%}`, /a percentage is not allowed in letter-spacing/],
        ['a line-height percent', `${TEXT_LEAF}{line-height:1000%}`, /a line height must be a plain number/],
        ['a margin percent in a --pack-* helper', `:root{--pack-m:1000%}${SAFE_LEAF}{margin-left:var(--pack-m)}`, /a percentage is not allowed in margin-left/],
    ])('N3c refuses %s', (_name, css, why) => { expectRefused('chat', css, why, RE_1549) })
})

describe('font size, line height, bounded tokens (MC-1549, MC-1555, MC-1556, DD-243)', () => {
    test.each([
        ['a percent', '1000%'], ['a size keyword', 'xxx-large'], ['max()', 'max(1px,500px)'], ['calc product', 'calc(10px * 100)'], ['min()', 'min(10px,500px)'],
        ['a zero in pt', '0pt'], ['a zero in vw', '0vw'], ['0.0px', '0.0px'], ['negative zero', '-0px'], ['0.00rem', '0.00rem'], ['a bare zero', '0'], ['a negative length', '-2px'],
    ])('FONTSIZE refuses %s', (_name, value) => {
        expectRefused('chat', `${TEXT_LEAF}{font-size:${value}}`, RE_1549)
        expectRefused('chat', `${SAFE_LEAF}{font-size:${value}}`, RE_1549)
    })

    test.each([
        ['a zero token', `:root{--pack-z:0pt}${TEXT_LEAF}{font-size:var(--pack-z)}`],
        ['a zero in the font shorthand', `${SAFE_LEAF}{font:0px serif}`],
        ['a percent in the font shorthand', `${SAFE_LEAF}{font:1000% serif}`],
    ])('FONTSIZE refuses %s', (_name, css) => { expectRefused('chat', css, /font size must be one px or rem length above 0/) })

    test.each([
        ['a percent', `${SAFE_LEAF}{font:16px/1000% serif}`],
        ['a calc product', `${SAFE_LEAF}{font:16px/calc(1px * 100) serif}`],
    ])('LINEHEIGHT refuses %s in the font shorthand', (_name, css) => { expectRefused('chat', css, RE_1549) })

    test('LINEHEIGHT judges the line height of the font shorthand by its own reason', () => {
        expectRefused('chat', `${SAFE_LEAF}{font:16px/-2px serif}`, /a line height must be/)
    })

    test('FONTSIZE judges the app values of a token even when the pack sets the token on :root', () => {
        // --bubble-pad-end is a pack-settable app token whose other app values are not font sizes; the pack's own value does not hide them.
        expectRefused('chat', `:root{--bubble-pad-end:15px}${TEXT_LEAF}{font-size:var(--bubble-pad-end)}`, /font size must be one px or rem length above 0/)
    })

    test('FONTSIZE judges the app values of a token too', () => {
        expectRefused('chat', `${TEXT_LEAF}{font-size:var(--stop-shimmer-start)}`, RE_1549)
        expectRefused('home', '[data-part="home-shell"]{font-size:var(--stop-shimmer-start)}', RE_1549)
        expectRefused('chat', `${TEXT_LEAF}{letter-spacing:var(--stop-shimmer-end)}`, RE_1549)
        expectRefused('chat', `${TEXT_LEAF}{line-height:var(--stop-shimmer-end)}`, RE_1549)
    })

    test.each([
        ['a pair of lengths', ':root{--focus-ring-w:2px 2px}'],
        ['a colour with a length alpha', ':root{--focus-ring-w:rgb(0 0 0 / 2px)}'],
        ['a comma list', ':root{--focus-ring-w:2px, 3px}'],
        ['a pair in the forced ring', ':root{--focus-ring-w-forced:2px 2px}'],
    ])('rule B refuses %s', (_name, css) => { expectRefused('chat', css, /must be one plain length/) })

    test.each([
        ['zero', ':root{--focus-ring-w-forced:0px}'],
        ['under a pixel through a helper', ':root{--pack-r:0px;--focus-ring-w-forced:var(--pack-r)}'],
    ])('B2 refuses a forced-colours ring of %s', (_name, css) => { expectRefused('chat', css, /--focus-ring-w-forced below 1px removes the focus ring/, /DD-243/) })
})

describe('A16 case-significant spans, A19 comment placement (MC-1568, MC-1549)', () => {
    test.each([
        ['selcase-pair', `${SEND}{${DARK}}[data-part="CHAT-SEND"]{background:#ffff00}`, I3_RE],
        ['selcase-media', `${SEND}{${DARK}}@media (min-width:1px){[data-part="CHAT-SEND"]{background:#ffff00}}`, I3_RE],
        ['selcase-media-upper', `${SEND}{${DARK}}@MEDIA (min-width:1px){[data-part="CHAT-SEND"]{background:#ffff00}}`, I3_RE],
        ['case-ring', ':root{--focus-ring-w:0px;--FOCUS-RING-W:2px}', /a custom property name must be written in lower case/],
        ['var-ref-upper', `:root{--nexus-pad:10px}${SAFE_LEAF}{padding:var(--NEXUS-PAD)}`, /a var\(\) reference must be written in lower case/],
        ['case-pad', `:root{--nexus-pad:1000px;--Nexus-Pad:10px}${SAFE_LEAF}{padding:var(--nexus-pad)}`, /a custom property name must be written in lower case/],
    ])('NF1 refuses %s', (_name, css, why) => { expectRefused('chat', css, why, RE_1568) })

    test.each([
        ['attrcase-ring', 'html[data-layout="phone"]{--focus-ring-w:0px}html[data-layout="PHONE"]{--focus-ring-w:2px}'],
        ['attrcase-fsbase', `html[data-layout="phone"]{--font-size-base:2px}html[data-layout="PHONE"]{--font-size-base:15px}${TEXT_LEAF}{font-size:var(--font-size-base)}`],
        ['attrcase-sheetpad', 'html[data-layout="phone"]{--sheet-padding-x:1000px}html[data-layout="PHONE"]{--sheet-padding-x:12px}'],
    ])('NF1 attribute value case %s is refused for the case and for the token site', (_name, css) => { expectRefused('chat', css, I3_RE, N1R_RE) })

    test('NF1 attribute value case in the settings area', () => {
        expectRefused('settings', 'html[data-layout="phone"]{--control-padding-x:1000px}html[data-layout="PHONE"]{--control-padding-x:12px}', I3_RE, N1R_RE)
    })

    test('NF1v: VAR is a keyword span: the N2a reason is returned and no case reason', () => {
        const css = `:root{--nexus-a:1000px;--nexus-b:1px}${SAFE_LEAF}{padding:VAR(--nexus-a, VAR(--nexus-b, rgb(0 0 0)))}`
        expectRefused('chat', css, /without a fallback/)
        expectNoReason('chat', css, /must be written in lower case/)
    })

    test.each([
        ['studio kelvin pair', 'studio', `[data-part="studio-header-back"]{${DARK}}[data-part="studio-header-bac\u212a"]{background:#ffff00}`],
        ['studio kelvin in @media', 'studio', `[data-part="studio-header-back"]{${DARK}}@media (min-width:1px){[data-part="studio-header-bac\u212a"]{background:#ffff00}}`],
        ['home kelvin pair', 'home', `[data-part="home-tasks-button"]{${DARK}}[data-part="home-tas\u212as-button"]{background:#ffff00}`],
    ] as const)('NF15 %s: the Kelvin sign is not a lower-case k to the browser (U+212A)', (_name, area, css) => {
        expectRefused(area, css, I3_RE, RE_1568)
    })

    test.each([
        ['a dotted capital I', '[data-x="\u0130"] [data-part="chat-message-avatar"]{opacity:0}'],
        ['a long s', '[data-x="\u017f"] [data-part="chat-message-avatar"]{opacity:0}'],
        ['a long s in a role', '[data-role="u\u017fer"] [data-part="chat-message-avatar"]{opacity:0}'],
    ])('NF16 refuses %s in a selector string (new-rule test: the rule is ASCII, no browser exploit is claimed)', (_name, css) => { expectRefused('chat', css, I3_RE, RE_1568) })

    test.each([
        ['chat', `html ${SEND}{${DARK}}html/**/${SEND}{background:#ffff00}`],
        ['studio', `html [data-part="studio-header-back"]{${DARK}}html/**/[data-part="studio-header-back"]{background:#ffff00}`],
        ['home', `html [data-part="home-tasks-button"]{${DARK}}html/**/[data-part="home-tasks-button"]{background:#ffff00}`],
        ['chat', `html[data-input="touch"] ${SEND}{${DARK}}html[data-input="touch"]/**/${SEND}{background:#ffff00}`],
        ['chat', 'html [data-part="chat-transcript"]{padding:0 60px}html/**/[data-part="chat-transcript"]{padding:0 1px}'],
        ['chat', 'html [data-part="chat-message"]{padding:0 60px}html/**/[data-part="chat-message"]{padding:0 1px}'],
        ['chat', 'html [data-part="chat-message-body"]{padding:0 60px}html/**/[data-part="chat-message-body"]{padding:0 1px}'],
    ] as const)('NF17 refuses a comment that joins two selector parts (%s)', (area, css) => { expectRefused(area, css, /a comment needs a space, a line end/, RE_1549) })

    test.each([
        ['attribute names (new-rule test)', '[data-part="pattern-warn-caret"]{color:#ffffff}[DATA-PART="pattern-warn-caret"]{background:#000000}', /an attribute name in a selector must be written in lower case/],
        ['an unquoted attribute value', '[data-x=Ab] [data-part="chat-message-avatar"]{opacity:0}', /an attribute value must be written in lower case/],
        ['a class name', '.Foo [data-part="chat-message-avatar"]{opacity:0}', /a class name must be written in lower case/],
        ['an id', '#Bar [data-part="chat-message-avatar"]{opacity:0}', /an id must be written in lower case/],
    ])('I2 refuses %s', (_name, css, why) => { expectRefused('chat', css, why, RE_1568) })

    test.each([
        ['a quoted family in the descriptor and the use', '@font-face{font-family:"Pack Serif";src:url(f.woff2)}' + `${SAFE_LEAF}{font-family:"Pack Serif"}`],
        ['an unquoted family', '@font-face{font-family:Pack Serif;src:url(f.woff2)}' + `${SAFE_LEAF}{font-family:Pack Serif}`],
        ['the font shorthand', '@font-face{font-family:"pack serif";src:url(f.woff2)}' + `${SAFE_LEAF}{font:14px "Pack Serif"}`],
        ['an upper-case property name at the use site', '@font-face{font-family:"pack serif";src:url(f.woff2)}' + `${SAFE_LEAF}{FONT-FAMILY:"Pack Serif"}`],
        ['an upper-case family at the descriptor and a lower-case use', '@font-face{font-family:"Pack Serif";src:url(f.woff2)}' + `${SAFE_LEAF}{font-family:"pack serif"}`],
        ['a family reached through a token', `@font-face{font-family:pack serif;src:url(f.woff2)}:root{--pack-f:Pack Serif}${SAFE_LEAF}{font-family:var(--pack-f)}`],
        ['a Kelvin family', `@font-face{font-family:"pac\u212a";src:url(f.woff2)}${SAFE_LEAF}{font-family:"pac\u212a"}`],
    ])('NF18 refuses an upper-case or non-ASCII family name: %s', (_name, css) => { expectRefused('chat', css, /a font family name (must be written in lower case|may hold only ASCII)/, RE_1568) })

    test('A19 (PT1): comment placement keeps a verdict, over the NF17 members and the acceptance packs', () => {
        const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
        const members: [PackArea, string][] = [
            ['chat', `html ${SEND}{${DARK}}html/**/${SEND}{background:#ffff00}`],
            ['chat', 'html [data-part="chat-transcript"]{padding:0 60px}html/**/[data-part="chat-transcript"]{padding:0 1px}'],
        ]
        for (const [area, css] of members) {
            // A pack that places a comment where a space differs is refused, so no accepted pack changes verdict when its comments go.
            expect(lintAreaPack(area, css).ok).toBe(false)
        }
        for (const area of THEME_AREAS) {
            for (const pack of ['origin-navy', 'banana-cocoa']) {
                const css = readFileSync(path.resolve(ROOT, `docs/design/${area}/themes/${pack}.css`), 'utf8')
                expect(lintAreaPack(area, strip(css)).ok, `${area}/${pack} without comments`).toBe(lintAreaPack(area, css).ok)
            }
        }
    })
})

describe('GN: compatibility guards (accepted before and after)', () => {
    test.each([
        ['a single root token', ':root{--pack-pad:12px}' + `${SAFE_LEAF}{padding:var(--pack-pad)}`],
        ['a duplicate root token', ':root{--pack-pad:10px}:root{--pack-pad:12px}' + `${SAFE_LEAF}{padding:var(--pack-pad)}`],
        ['a font size token', `:root{--pack-fs:14px}${TEXT_LEAF}{font-size:var(--pack-fs)}`],
        ['a negative margin by negation', `${SAFE_LEAF}{margin-right:calc(var(--space-3) * -1)}`],
        ['a negation of a number', `${SAFE_LEAF}{margin-right:calc(-1 * 8px)}`],
        ['a helper with a root default and a state value', `:root{--pack-a:12px}html[data-input="touch"]{--pack-a:10px}${SAFE_LEAF}{padding:var(--pack-a)}`],
        ['a colour with alpha', `${SAFE_LEAF}{border:1px solid rgb(0 0 0 / 0.4);box-shadow:0 1px 2px rgb(0 0 0 / 20%)}`],
        ['a percent padding', `${SAFE_LEAF}{padding:5%}`],
        ['a calc in a colour argument', `${SAFE_LEAF}{background:hsl(calc(var(--h) + 10) 50% 50%)}`],
        ['a plain font size', `${TEXT_LEAF}{font-size:15px}`],
        ['rem and the app font size token', `${TEXT_LEAF}{font-size:1rem}${SAFE_LEAF}{font-size:var(--font-size-base)}`],
        ['font-family inherit', `${TEXT_LEAF}{font-family:inherit}`],
        ['font-family through the app font token', `${TEXT_LEAF}{font-family:var(--font)}`],
        ['the generic families', `${TEXT_LEAF}{font-family:serif,sans-serif,monospace,cursive,fantasy,system-ui,ui-serif,ui-sans-serif,ui-monospace,ui-rounded,math,emoji,fangsong}`],
        ['a keyword span in any case', `${SAFE_LEAF}{border:1px solid CanvasText;color:#FFFFFF;OPACITY:1}HTML ${SAFE_LEAF}{opacity:1}`],
        [':ROOT as a keyword span', ':ROOT{--focus-ring-w:2px}'],
        ['an upper-case @MEDIA and property name', `@MEDIA (MIN-WIDTH:1px){${SAFE_LEAF}{OPACITY:0}}`],
        ['a lower-case family registered and used in several spellings', '@font-face{font-family:"pack-serif";src:url(fonts/s.woff2)}' + `${SAFE_LEAF}{font-family:"pack-serif"}[data-part="chat-message-name"]{font-family:pack-serif}[data-part="chat-message-badges"]{font:bold 16px/1.5 "pack-serif", serif}`],
        ['comments on their own line, after a comma, a semicolon, a brace and between rules', `${SAFE_LEAF}{opacity:1}\n/* own line */\n${SAFE_LEAF},/* c */[data-part="chat-message-name"]{opacity:1;/* d */padding:1px}/* e */[data-part="chat-message-badges"]{/* f */opacity:1}`],
        ['a run of comments beside a space', `${SAFE_LEAF}{opacity:1} /**//**/${SAFE_LEAF}{opacity:1}`],
        ['a grid function in a token', ':root{--nexus-ease:cubic-bezier(0.2, 0, 0, 1)}'],
    ])('accepts %s', (_name, css) => { expectAcceptedPack('chat', css) })

    test('the settings grid token guard', () => {
        expectNoReason('settings', ':root{--body-columns:240px minmax(0, 1fr)}', RE_1549)
    })

    test('the home alias form is measured: a bad alias value is refused (control)', () => {
        const alias = ':root{--pack-r:2px;--focus-ring-w:var(--pack-r)}html[data-input="touch"]{--pack-r:0px}'
        expectRefused('chat', alias, /no focus ring/)
        expectAcceptedPack('home', ':root{--pack-row:56px;--home-row-height:var(--pack-row)}html[data-input="touch"]{--pack-row:60px}')
    })

    test('the acceptance packs stay accepted in every area, banana-cocoa home included', () => {
        for (const area of THEME_AREAS) {
            for (const pack of ['origin-navy', 'banana-cocoa']) {
                const result = lintAreaPack(area, readFileSync(path.resolve(ROOT, `docs/design/${area}/themes/${pack}.css`), 'utf8'), pack)
                expect(result.errors, `${area}/${pack}`).toEqual([])
            }
        }
    })
})

describe('N0: the engine and the browser split the stylesheet the same way (MC-1549)', () => {
    test.each([
        ['a stray statement before a rule (N0a)', ':root{--focus-ring-w:0px}x;:root{--focus-ring-w:2px}', /text outside a rule/],
        ['a semicolon after an at-keyword (N0a)', ':root{--focus-ring-w:0px}@media x;:root{--focus-ring-w:2px}', /text outside a rule/],
        ['junk after the last statement (N0a)', ':root{--focus-ring-w:2px}x', /text outside a rule/],
        ['a font-face spliced into a prelude (N0b)', ':root{--focus-ring-w:0px}:ro@font-face{font-family:x;src:url(a.woff2)}ot{--focus-ring-w:2px}', /@ may only start a statement/],
        ['a font-face in a selector (N0b)', ':root @font-face{font-family:x;src:url(a.woff2)}{--focus-ring-w:2px}', /@ may only start a statement/],
        ['a bracket in a value (N0c)', ':root{--focus-ring-w:0px;--nexus-x:[;--focus-ring-w:2px;]}', /square brackets are not allowed in a rule block/],
        ['a segment that is not a declaration (N0d)', `${SAFE_LEAF}{opacity:1;nonsense;color:#fff}`, /every part of a rule block must be one name:value declaration/],
        ['a rule without a selector (N0e)', '{opacity:1}', /a rule needs a selector/],
        ['an empty selector list item (N0e)', `${SAFE_LEAF},{opacity:1}`, /a rule needs a selector/],
        ['a trailing combinator (N0e)', `${SAFE_LEAF} >{opacity:1}`, /a rule needs a selector/],
        ['mixed closers (N0f)', ':root{--focus-ring-w:0px}x[(]){}:root{--focus-ring-w:2px}y]{}', /brackets must close in order/],
    ])('refuses %s', (_name, css, why) => { expectRefused('chat', css, why, RE_1549) })
})

describe('MC-1550 and the font rules', () => {
    test.each([
        ['Wingdings', `${TEXT_LEAF}{font-family:"Wingdings","Webdings"}`],
        ['an unquoted system font', `${SAFE_LEAF}{font-family:Wingdings}`],
        ['a mixed-case system font', `${SAFE_LEAF}{font-family:"WingDings"}`],
        ['a list with a system font', `${SAFE_LEAF}{font-family:Wingdings,"Segoe UI Symbol",serif}`],
        ['a fallback naming a system font', `${SAFE_LEAF}{font-family:var(--pack-none, Wingdings)}`],
        ['the shorthand', `${SAFE_LEAF}{font:12px Wingdings}`],
        ['a system font keyword', `${SAFE_LEAF}{font:caption}`],
        ['a family through a helper', `:root{--pack-f:Wingdings}${SAFE_LEAF}{font-family:var(--pack-f)}`],
        ['a font token', ':root{--font:Wingdings}'],
        ['the mono token', ':root{--mono:Wingdings}'],
        ['a quoted generic (not a generic, a name)', `${SAFE_LEAF}{font-family:"serif"}`],
        ['an unresolved non-font token', `${SAFE_LEAF}{font-family:var(--nexus-text)}`],
    ])('F refuses %s', (_name, css) => { expectRefused('chat', css, RE_1550) })

    test('F refuses the settings font token', () => { expectRefused('settings', ':root{--settings-font:Wingdings}', RE_1550) })

    test.each([
        ['a duplicate family descriptor', `@font-face{font-family:Wingdings;font-family:serif;src:url(f.woff2)}${TEXT_LEAF}{font-family:Wingdings}`],
        ['a leading space in a quoted name', `@font-face{font-family:" Wingdings";src:url(f.woff2)}${SAFE_LEAF}{font-family:Wingdings}`],
        ['an important descriptor', '@font-face{font-family:Pack !important;src:url(f.woff2)}'],
        ['a list descriptor', '@font-face{font-family:Wingdings, x;src:url(f.woff2)}'],
        ['a non-ASCII name', `@font-face{font-family:"나눔";src:url(f.woff2)}${SAFE_LEAF}{font-family:"나눔"}`],
        ['a generic name', '@font-face{font-family:serif;src:url(f.woff2)}'],
        ['a CSS-wide name', '@font-face{font-family:inherit;src:url(f.woff2)}'],
        ['default as a name', '@font-face{font-family:default;src:url(f.woff2)}'],
        ['a generic word in a run', '@font-face{font-family:Pack serif;src:url(f.woff2)}'],
    ])('FF refuses %s', (_name, css) => { expectRefused('chat', css, RE_1550) })

    test.each([
        ['a digit word at the descriptor', `@font-face{font-family:Wingdings 2;src:url(f.woff2)}${SAFE_LEAF}{font-family:"Wingdings 2"}`],
        ['a dash-digit word at the descriptor', `@font-face{font-family:Pack -2x;src:url(f.woff2)}${SAFE_LEAF}{font-family:"Pack -2x"}`],
        ['a dash-digit word at the use site', `@font-face{font-family:"Pack -2x";src:url(f.woff2)}${SAFE_LEAF}{font-family:Pack -2x}`],
    ])('FF3 refuses %s as a CSS identifier error', (_name, css) => { expectRefused('chat', css, /a font family word must be a CSS identifier/, RE_1550) })

    test('PW guard: an own family registered in one sheet is known to the others in validateThemePack', () => {
        const settingsSheet = '[data-part="settings-section-title"]{font-family:pack}'
        const verdict = validateThemePack({ files: { chat: '@font-face{font-family:pack;src:url(f.woff2)}', settings: settingsSheet }, totalBytes: 1 })
        expect(verdict.areas.settings?.errors.filter((e) => RE_1550.test(e.why))).toEqual([])
    })

    test('PW reproducer: lintAreaPack judges a sheet with its own families only', () => {
        expectRefused('settings', '[data-part="settings-section-title"]{font-family:pack}', RE_1550)
    })

    test('X20: a second font-family descriptor is refused even when the first one is the name in use', () => {
        expectRefused('chat', `@font-face{font-family:pack;font-family:serif;src:url(f.woff2)}${SAFE_LEAF}{font-family:pack}`, /may name its family only once/)
    })

    test.each([
        ['italic bold shorthand with a generic', `${SAFE_LEAF}{font:italic bold 12px/1.5 "pack-serif", serif}` , '@font-face{font-family:"pack-serif";src:url(f.woff2)}'],
    ])('F guard: %s', (_name, css, face) => { expectAcceptedPack('chat', face + css) })
})

describe('R5: every refusal class names its token, unit, function or span and its decision', () => {
    test.each([
        ['N0a', ':root{--a:1px}x;', /text outside a rule .*\(MC-1549\)$/],
        ['N1r', ':root{--nexus-pad:1px}html{--nexus-pad:2px}', /--nexus-pad is set on html: .*\(MC-1565\)$/],
        ['N1p', ':root{--pack-:1px}', /--pack- .*\(DD-258\)$/],
        ['N1q', `${SAFE_LEAF}{--pack-c:#111111}${SEND}{color:var(--pack-c)}`, /--pack-c is used but has no value on :root.*\(DD-258, MC-1565\)$/],
        ['N1c', ':root{--nexus-a:1px !important x}', /"!" is not allowed in a token value \(--nexus-a\).*\(MC-1564\)$/],
        ['N2a', `${SAFE_LEAF}{padding:var(--nexus-x, 1px)}`, /var\(\) must be exactly var\(--name\).*\(MC-1564\)$/],
        ['N3a', `${SAFE_LEAF}{padding:4em}`, /only px and rem lengths are allowed \(4em\): em depends on the font size.*\(MC-1549, MC-1555\)$/],
        ['N3c', `${SAFE_LEAF}{margin:5%}`, /a percentage is not allowed in margin \(5%\).*\(MC-1549, MC-1555\)$/],
        ['I1', `${SAFE_LEAF}{padding:0 /**/}x[a="b"]/**/[c]{opacity:1}`, /a comment needs a space.*\(MC-1549\)$/],
        ['I2', ':root{--A:1px}', /a custom property name must be written in lower case.*\(MC-1568\)$/],
        ['I3', '[data-x="A"]{opacity:1}', /may hold only a-z, 0-9, - and _.*\(MC-1568\)$/],
        ['F', `${SAFE_LEAF}{font-family:Wingdings}`, /font family "wingdings" is not allowed.*\(MC-1550\)$/],
        ['U', `${SAFE_LEAF}{background:url(c|/x.png)}`, /\(MC-1351\): c\|\/x\.png$/],
    ])('%s', (_name, css, why) => { expect(reasonsOf('chat', css).some((text) => why.test(text)), JSON.stringify(reasonsOf('chat', css))).toBe(true) })
})

describe('drift guard: the font tokens', () => {
    test('every pack-settable token the app uses in font-family or font is judged as a font token', async () => {
        const { FONT_TOKENS } = await import('./valueRules')
        const { isPackSettable } = await import('./engine')
        const { SETTINGS_REGISTRY } = await import('./registries/settings')
        const { STUDIO_REGISTRY } = await import('./registries/studio')
        const { HOME_REGISTRY } = await import('./registries/home')
        // Tokens that carry the size or leading of the font shorthand, not a family.
        const FONT_SHORTHAND_SIZE_TOKENS = ['--font-size-sm', '--font-size-xs', '--leading-140', '--leading-155', '--studio-fs-12px', '--studio-fs-13px', '--studio-lh-20px']
        const root = path.resolve(ROOT, 'docs/design')
        const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.css')).map((f) => path.join(root, f))
        expect(files.length).toBeGreaterThan(20)
        const names = new Set<string>()
        for (const file of files) {
            for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w-])font(?:-family)?\s*:\s*([^;}]*)/g)) for (const v of m[1].matchAll(/var\(\s*(--[\w-]+)/g)) names.add(v[1])
        }
        expect(names.size).toBeGreaterThan(3)
        const registries = [undefined, SETTINGS_REGISTRY, STUDIO_REGISTRY, HOME_REGISTRY]
        for (const name of names) {
            if (!registries.some((r) => isPackSettable(name, r))) continue
            expect(FONT_TOKENS.includes(name) || FONT_SHORTHAND_SIZE_TOKENS.includes(name), name).toBe(true)
        }
    })
})

describe('time on a large hostile stylesheet', () => {
    test('a chain of tokens each declared many times is judged in bounded time (var() expansion is memoised)', () => {
        // Eight links, each declared in eight @media alternatives: without memoising, the expansion is exponential (seconds to minutes).
        const links = 8
        const alternatives = 8
        let css = ':root{--nexus-text:var(--nexus-n0)}'
        for (let k = 0; k < links; k++) {
            const next = k === links - 1 ? '#fff' : `var(--nexus-n${k + 1})`
            for (let w = 0; w < alternatives; w++) css += `@media (min-width:${w + 1}px){:root{--nexus-n${k}:${next}}}`
        }
        const started = performance.now()
        for (const area of THEME_AREAS) lintAreaPack(area, css)
        expect(performance.now() - started).toBeLessThan(5000)
    }, 60000)

    test('a 2 MB stylesheet of rules is judged in bounded time', () => {
        const rule = `${SAFE_LEAF}{color:#f8f8f2;background-image:url(images/x.png)}[data-part="chat-header"]{padding:4px}\n`
        const css = rule.repeat(Math.ceil((2 * 1024 * 1024) / rule.length))
        const started = performance.now()
        const result = lintAreaPack('chat', css)
        const elapsed = performance.now() - started
        expect(result.name).toBe('')
        // Generous: the point is that cost stays roughly linear (no blow-up), not a speed target; the install stage runs it off the main thread.
        expect(elapsed).toBeLessThan(30000)
    }, 60000)
})
