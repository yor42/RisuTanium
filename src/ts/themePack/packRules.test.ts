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
    const FACE = '@font-face{font-family:"Pack Serif";src:url(fonts/serif.woff2) format("woff2"),url("fonts/serif.woff") format("woff");font-weight:400 700;font-style:normal;font-display:swap;unicode-range:U+0000-00FF}'

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
