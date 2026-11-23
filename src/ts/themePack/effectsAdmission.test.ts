// @vitest-environment node
// #560 PR3: the effects a pack may now use (MC-3422, MC-3427, MC-3429, MC-3431, MC-3638). The stage-1 rows below cover the 64 px total reach of
// Rule E-2 and the admission of outline with its focus-loss note. Every input is an ordinary area sheet with real registry part names, judged
// through the public entry points only, so a base run fails by assertion. Classes: REPRO = refused (or wrongly judged) before the change and
// right after; COMPAT = the same verdict before and after, kept as a guard; GUARD = a kept limit with its reason pinned.
import { describe, expect, it } from 'vitest'
import { lintAreaPack } from './index'
import type { ThemeArea } from './index'
import { shapeOnlySheet } from './shapeMode'

const AREAS: readonly ThemeArea[] = ['chat', 'studio', 'settings', 'home']
// The part used per area: a safe part (S), a reach (control) part (R) and any non-critical part (P).
const PARTS: Record<ThemeArea, { S: string; R: string; P: string }> = {
    chat: { S: 'chat-message-avatar', R: 'chat-send', P: 'chat-shell' },
    studio: { S: 'studio-asset-row', R: 'studio-item-apply', P: 'studio-asset-row' },
    settings: { S: 'settings-section-title', R: 'settings-header', P: 'settings-section-title' },
    home: { S: 'home-brand', R: 'home-run-card', P: 'home-shell' },
}
const sel = (area: ThemeArea, kind: 'S' | 'R' | 'P', suffix = ''): string => `[data-part="${PARTS[area][kind]}"]${suffix}`
const whys = (area: ThemeArea, css: string): string[] => lintAreaPack(area, css).errors.map((e) => e.why)
const expectOk = (area: ThemeArea, css: string): void => {
    const result = lintAreaPack(area, css)
    expect(result.ok, `${area}: ${css}\n${JSON.stringify(result.errors.map((e) => e.why))}`).toBe(true)
}
const expectRefused = (area: ThemeArea, css: string, why: RegExp): void => {
    const result = lintAreaPack(area, css)
    expect(result.ok, `${area}: ${css}`).toBe(false)
    expect(result.errors.some((e) => why.test(e.why)), `${area}: ${JSON.stringify(result.errors.map((e) => e.why))}`).toBe(true)
}
const notesOf = (area: ThemeArea, css: string, rule: string): string[] => (lintAreaPack(area, css).notes ?? []).filter((n) => n.rule === rule).map((n) => n.why)

describe('SH: a shadow may reach 64 px in total in chat and Studio (MC-3427, MC-3431)', () => {
    const SHADOWS = [
        'box-shadow:0 4px 12px rgb(0 0 0 / 0.2)',
        'box-shadow:inset 0 0 0 8px #000000',
        'text-shadow:0 0 6px #000000',
    ]
    for (const area of ['chat', 'studio'] as const) {
        it.each(SHADOWS)(`SH1 REPRO ${area} accepts %s`, (decl) => { expectOk(area, `${sel(area, 'S')}{${decl}}`) })
    }
    for (const area of ['settings', 'home'] as const) {
        it.each(SHADOWS)(`SH1s COMPAT ${area} accepted before and after: %s`, (decl) => { expectOk(area, `${sel(area, 'S')}{${decl}}`) })
    }
    for (const area of ['chat', 'studio'] as const) {
        it(`SH2 ${area} REPRO 64 px total reach is accepted, in every layer kind`, () => {
            expectOk(area, `${sel(area, 'S')}{box-shadow:10px 0 54px #000000}`)
            expectOk(area, `${sel(area, 'S')}{box-shadow:inset 10px 0 0 54px #000000}`)
            expectOk(area, `${sel(area, 'S')}{text-shadow:10px 0 54px #000000}`)
        })
        it(`SH2 ${area} GUARD 65 px total reach is refused with the reach reason`, () => {
            const why = /reaches 65 px.*at most 64 px/
            expectRefused(area, `${sel(area, 'S')}{box-shadow:10px 0 55px #000000}`, why)
            expectRefused(area, `${sel(area, 'S')}{box-shadow:inset 10px 0 0 55px #000000}`, why)
            expectRefused(area, `${sel(area, 'S')}{text-shadow:10px 0 55px #000000}`, why)
        })
        it(`SH2 ${area} GUARD an unmeasurable layer and inherit stay refused`, () => {
            expectRefused(area, `${sel(area, 'S')}{box-shadow:0 0 0 0 0 #000000}`, /cannot be measured/)
            expectRefused(area, `${sel(area, 'S')}{box-shadow:inherit}`, /box-shadow: inherit copies/)
        })
    }
    for (const area of ['settings', 'home'] as const) {
        it(`SH3 ${area} COMPAT keeps the per-length 64 px cap and no total reach`, () => {
            expectOk(area, `${sel(area, 'S')}{box-shadow:10px 0 55px #000000}`)
            expectRefused(area, `${sel(area, 'S')}{box-shadow:0 0 65px #000000}`, /larger than 64 px/)
        })
    }
})

describe('OL: outline is admitted, a focus rule that removes the ring gets a note (DD-243, MC-3429)', () => {
    for (const area of AREAS) {
        it(`OL1 ${area} REPRO an outline on a reach part and on a safe part`, () => {
            expectOk(area, `${sel(area, 'R')}{outline:2px solid #ff0000}`)
            expectOk(area, `${sel(area, 'S')}{outline-offset:2px}`)
            expectOk(area, `${sel(area, 'S')}{outline:2px dashed #ff0000;outline-color:#00ff00;outline-style:solid;outline-width:2px}`)
        })
        it(`OL4 ${area} GUARD the 64 px cap on outline stays, with its own reason`, () => {
            expectRefused(area, `${sel(area, 'R')}{outline:65px solid #ff0000}`, /outline larger than 64 px/)
            expectRefused(area, `${sel(area, 'S')}{outline-offset:65px}`, /outline-offset larger than 64 px/)
            expectRefused(area, `${sel(area, 'S')}{outline-width:65px}`, /outline-width larger than 64 px/)
        })
    }
    it('OL2 chat REPRO the longhands on a reach part', () => {
        expectOk('chat', `${sel('chat', 'R')}{outline-width:2px;outline-offset:2px}`)
        expectOk('chat', `${sel('chat', 'R')}{outline-color:#ff0000;outline-style:solid}`)
    })
    const REMOVALS = [
        'outline:none',
        'outline:0 solid #000000',
        'outline:2px hidden #000000',
        'outline-width:0',
        'outline-style:none',
        'outline-color:transparent',
    ]
    for (const area of AREAS) {
        it.each(REMOVALS)(`OL3 ${area} REPRO a focus rule with %s is accepted with one readability note`, (decl) => {
            const css = `${sel(area, 'R', ':focus-visible')}{${decl}}`
            expectOk(area, css)
            const notes = notesOf(area, css, 'readability').filter((why) => /would remove the indication of focus/.test(why))
            expect(notes, `${area}: ${css}`).toHaveLength(1)
        })
    }
    it('OL3 chat REPRO the same removals under :focus-within and on a safe part', () => {
        for (const decl of REMOVALS) {
            const css = `${sel('chat', 'R', ':focus-within')}{${decl}}`
            expectOk('chat', css)
            expect(notesOf('chat', css, 'readability').filter((why) => /would remove the indication of focus/.test(why)), css).toHaveLength(1)
        }
    })
    it('OL3n chat GUARD a ring that stays gives no focus note (a function interior is not a zero token)', () => {
        for (const decl of ['outline:2px solid rgb(0 0 0)', 'outline:2px solid #000000', 'outline-width:2px', 'outline-style:solid', 'outline-color:#ff0000']) {
            const css = `${sel('chat', 'R', ':focus-visible')}{${decl}}`
            expectOk('chat', css)
            expect(notesOf('chat', css, 'readability').filter((why) => /indication of focus/.test(why)), css).toEqual([])
        }
    })
    it('OL3 chat GUARD an outline removal outside a focus state gives no note', () => {
        const css = `${sel('chat', 'R')}{outline:none}`
        expectOk('chat', css)
        expect(notesOf('chat', css, 'readability').filter((why) => /indication of focus/.test(why))).toEqual([])
    })
})

describe('NC: the notes channel keeps its shape', () => {
    it('NC1 every new note carries a rule of the channel, errors stay empty and `notes` is absent when there is none', () => {
        const withNote = lintAreaPack('chat', `${sel('chat', 'R', ':focus-visible')}{outline:none}`)
        expect(withNote.errors).toEqual([])
        expect(withNote.notes?.length ?? 0).toBeGreaterThan(0)
        for (const n of withNote.notes ?? []) expect(['contrast', 'readability', 'layout']).toContain(n.rule)
        const quiet = lintAreaPack('chat', `${sel('chat', 'S')}{outline:2px solid #ff0000;box-shadow:0 4px 12px #000000}`)
        expect(quiet.ok).toBe(true)
        expect('notes' in quiet).toBe(false)
        expect(whys('chat', `${sel('chat', 'S')}{box-shadow:0 0 65px #000000}`).length).toBeGreaterThan(0)
    })
})

describe('MK, CP, BI: mask, clip-path and border-image are admitted (MC-3422, MC-3429)', () => {
    const GRAD = 'linear-gradient(#000000,transparent)'
    for (const area of AREAS) {
        it(`MK1 ${area} REPRO mask-image and -webkit-mask-image on a safe part`, () => {
            expectOk(area, `${sel(area, 'S')}{mask-image:${GRAD}}`)
            expectOk(area, `${sel(area, 'S')}{-webkit-mask-image:${GRAD}}`)
        })
        it(`MK2 ${area} REPRO mask on a reach part gives exactly one layout note`, () => {
            for (const decl of [`mask-image:${GRAD}`, `-webkit-mask-image:${GRAD}`]) {
                const css = `${sel(area, 'R')}{${decl}}`
                expectOk(area, css)
                const notes = notesOf(area, css, 'layout').filter((why) => /clip/.test(why))
                expect(notes, css).toHaveLength(1)
            }
        })
        it(`CP2 ${area} REPRO clip-path on a reach part gives exactly one layout note`, () => {
            const css = `${sel(area, 'R')}{clip-path:inset(2px)}`
            expectOk(area, css)
            expect(notesOf(area, css, 'layout').filter((why) => /clip/.test(why)), css).toHaveLength(1)
        })
        it(`CP2 ${area} REPRO clip-path on a safe part gives no note`, () => {
            const css = `${sel(area, 'S')}{clip-path:circle(50%)}`
            expectOk(area, css)
            expect(notesOf(area, css, 'layout').filter((why) => /clip/.test(why)), css).toEqual([])
        })
        it(`BI1 ${area} border-image on a safe and a reach part (COMPAT in home)`, () => {
            const decl = 'border-style:solid;border-width:4px;border-image:linear-gradient(#ff0000,#0000ff) 1'
            expectOk(area, `${sel(area, 'S')}{${decl}}`)
            expectOk(area, `${sel(area, 'R')}{${decl}}`)
        })
        it(`BI2 ${area} REPRO the border-image longhands on a reach part`, () => {
            expectOk(area, `${sel(area, 'R')}{border-image-source:linear-gradient(#ff0000,#0000ff);border-image-slice:1;border-image-width:2px;border-image-outset:0;border-image-repeat:round}`)
        })
        it(`K9 ${area} COMPAT an unbundled or fragment url stays refused in every new property`, () => {
            for (const prop of ['mask-image', 'mask', '-webkit-mask-box-image', 'border-image-source', 'clip-path']) {
                for (const u of ["url('https://example.test/a.png')", 'url(#m)']) {
                    expect(lintAreaPack(area, `${sel(area, 'S')}{${prop}:${u}}`).ok, `${area} ${prop} ${u}`).toBe(false)
                }
            }
        })
    }
    it('MK4 chat REPRO a bundled mask url installs with its resource', () => {
        const result = lintAreaPack('chat', `${sel('chat', 'S')}{mask:url(images/m.png) no-repeat center/100%}`)
        expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    })
    const CLIPS = ['inset(2px round 4px)', 'circle(50%)', 'ellipse(40% 30%)', 'polygon(0 0,100% 0,50% 100%)', 'rect(0 10px 10px 0)', 'xywh(0 0 10px 10px)', 'path("M0 0 L8 0 L4 8 Z")']
    it.each(CLIPS)('CP1 chat REPRO clip-path: %s', (value) => { expectOk('chat', `${sel('chat', 'S')}{clip-path:${value}}`) })
    it('CP1 chat REPRO a percentage in mask-position, mask-size and border-image-slice', () => {
        expectOk('chat', `${sel('chat', 'S')}{mask-position:50% 50%;mask-size:100% 50%;border-image-slice:10%}`)
    })
    it('BI3 chat and home REPRO border-image on a chain part', () => {
        expectOk('chat', '[data-part="chat-shell"]{border-image:linear-gradient(#ff0000,#0000ff) 1}')
        expectOk('home', '[data-part="home-shell"]{border-image:linear-gradient(#ff0000,#0000ff) 1}')
    })
    it('BI4 chat REPRO a bundled border-image url installs', () => {
        expectOk('chat', `${sel('chat', 'S')}{border-image:url(images/edge.png) 8 round}`)
    })
    it('BI4 home COMPAT a url in border-image stays refused in Home', () => {
        expect(lintAreaPack('home', `${sel('home', 'S')}{border-image:url(images/edge.png) 8 round}`).ok).toBe(false)
    })
    it('MK GUARD kept global bans stay beside the new admissions', () => {
        for (const area of AREAS) {
            expectRefused(area, `${sel(area, 'S')}{mask-image:${GRAD};z-index:1}`, /can cover, fade or disable/)
            expectRefused(area, `${sel(area, 'S')}{clip-path:inset(2px);all:unset}`, /can cover, fade or disable/)
        }
    })
})

describe('PE, K: a pseudo-element may end the last compound (MC-3422, MC-3427)', () => {
    const BOX = 'content:"";position:absolute;top:0;left:0;width:8px;height:8px;background-color:#ff0000'
    for (const area of AREAS) {
        it(`PE1 ${area} REPRO an empty positioned ::before on a safe part`, () => { expectOk(area, `${sel(area, 'S', '::before')}{${BOX}}`) })
        it(`PE2 ${area} REPRO an empty positioned ::after on a reach part`, () => {
            expectOk(area, `${sel(area, 'R', '::after')}{content:'';position:absolute;bottom:0;left:4px;width:8px;height:8px;border-radius:2px;background-color:#ff0000}`)
        })
    }
    it('PE3 chat REPRO a state before the pseudo-element and a root attribute ancestor', () => {
        expectOk('chat', `${sel('chat', 'S', ':hover::after')}{${BOX}}`)
        expectOk('chat', `html[data-input="hover"] ${sel('chat', 'S', '::before')}{content:""}`)
    })
    it('PE4 chat REPRO Rule S leaves a pseudo box out: an inherited colour on it is accepted', () => {
        expectOk('chat', '[data-part="chat-send"]::before{content:"";color:initial !important}')
    })
    for (const area of AREAS) {
        it(`K1 ${area} GUARD content other than the empty string is refused`, () => {
            for (const value of ['"x"', 'attr(data-part)', 'counter(c)', '"" "x"', 'url(images/a.png)', 'open-quote', 'none', '" "', 'inherit']) {
                expectRefused(area, `${sel(area, 'S', '::before')}{content:${value}}`, /content may only be the empty string/)
            }
        })
        it(`K6 ${area} GUARD content on an element is refused`, () => {
            expectRefused(area, `${sel(area, 'S')}{content:""}`, /content may only be the empty string/)
        })
        it(`K3 ${area} GUARD the overlay family stays refused on a pseudo-element`, () => {
            for (const decl of ['z-index:1', 'direction:rtl', 'unicode-bidi:bidi-override', 'writing-mode:vertical-rl', 'all:unset', 'offset-path:none', 'transform:scale(2)', 'filter:blur(2px)', 'animation:x 1s']) {
                expectRefused(area, `${sel(area, 'S', '::before')}{content:"";${decl}}`, /can cover, fade or disable/)
            }
        })
        it(`K4 ${area} GUARD fixed and sticky stay refused on a pseudo-element`, () => {
            for (const value of ['fixed', 'sticky']) {
                expectRefused(area, `${sel(area, 'S', '::before')}{content:"";position:${value}}`, /position: (fixed|sticky) can cover a protected surface/)
            }
        })
        it(`K7 ${area} COMPAT the pseudo grammar outside the last compound stays refused`, () => {
            const bad = [`${sel(area, 'P')}::before ${sel(area, 'P')}`, `${sel(area, 'P')}::before:hover`, `${sel(area, 'P')}:before`, `${sel(area, 'P')}::marker`, `${sel(area, 'P')}::first-line`, `${sel(area, 'P')}::selection`, `${sel(area, 'P')}::backdrop`, `${sel(area, 'P')}::before::after`]
            for (const s of bad) expect(lintAreaPack(area, `${s}{content:"";width:8px}`).ok, `${area}: ${s}`).toBe(false)
        })
        it(`K7c ${area} COMPAT a pseudo-element after whitespace or a combinator is refused by the grammar`, () => {
            const p = sel(area, 'P')
            for (const s of [`${p} ::before`, `${p}>::before`, `${p} > ::before`, `${p}+::before`, `${p}~::after`, `::before`]) {
                expectRefused(area, `${s}{content:"";position:absolute;width:8px;height:8px}`, /not allowed in a pack selector: ::(before|after)/)
            }
        })
        it(`K10 ${area} COMPAT a pseudo-element on the root or on no part is refused and is not read as the root tier`, () => {
            for (const s of ['html::before', ':root::after', '[data-kind="peer"]::before']) {
                const result = lintAreaPack(area, `${s}{content:""}`)
                expect(result.ok, `${area}: ${s}`).toBe(false)
                expect(result.errors.some((e) => /only custom properties \(and color-scheme\)/.test(e.why)), `${area}: ${s}`).toBe(false)
            }
        })
    }
    for (const area of ['chat', 'studio'] as const) {
        it(`K10 ${area} COMPAT html::before names the allowlist`, () => { expectRefused(area, 'html::before{content:""}', /content: .*not on the declaration allowlist/) })
    }
    for (const area of ['settings', 'home'] as const) {
        it(`K11 ${area} COMPAT a valueless part before a pseudo-element names the part-value rule`, () => {
            expectRefused(area, '[data-part]::before{content:""}', /must name a part by value/)
        })
    }
    it('K8 chat COMPAT a protected part and data-part-critical stay refused with a pseudo-element', () => {
        expectRefused('chat', '[data-part="chat-failed-card"]::before{content:""}', /protected part/)
        expect(lintAreaPack('chat', '[data-part-critical]::before{content:""}').ok).toBe(false)
    })
    it('SM1 the shape variant drops content and paint of a pseudo-element rule', () => {
        const stripped = shapeOnlySheet(`${sel('chat', 'S', '::before')}{${BOX}}`)
        expect(stripped).not.toMatch(/content/)
        expect(stripped).not.toMatch(/background/)
    })
})
