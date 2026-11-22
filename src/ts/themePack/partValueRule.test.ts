// @vitest-environment node
// The part-value rule (settings and home, registry flag partRequired): every compound of a selector names a part by a non-empty
// [data-part] value; a lone root-tier compound (a.rootOnly) is the one exemption, and root compounds may be ancestors. The reference
// lint in docs/design is read in place and must give the same verdict, so the mirror in packlint.mjs is held to the port.
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lintAreaPack, type ThemeArea } from './index'
import { CHAT_REGISTRY, lintSelector, type RegistryInput } from './engine'
import { HOME_REGISTRY } from './registries/home'
import { SETTINGS_REGISTRY } from './registries/settings'

const DESIGN = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/design')
interface RefError { why: string }
interface RefResult { ok: boolean, errors: RefError[] }
const lib = await (import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'theme/checks/lib.mjs')).href) as Promise<{ LINT: Record<ThemeArea, (css: string, name: string) => RefResult> }>)
type RefSelector = (sel: string) => string[]
const refHome = await (import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'home/registry-home.mjs')).href) as Promise<{ lintHomeSelector: RefSelector }>)
const refSettings = await (import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'settings/checks/th/packlint-settings.mjs')).href) as Promise<{ lintSelector: RefSelector }>)
const refChat = await (import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'chat/checks/th/packlint.mjs')).href) as Promise<{ lintSelector: RefSelector }>)

const REASON = /must name a part by value/
const AREAS: readonly ThemeArea[] = ['settings', 'home']
const portReasons = (area: ThemeArea, css: string): { ok: boolean, whys: string[] } => {
    const r = lintAreaPack(area, css, 'probe')
    return { ok: r.ok, whys: r.errors.map((e) => e.why) }
}
const refReasons = (area: ThemeArea, css: string): { ok: boolean, whys: string[] } => {
    const r = lib.LINT[area](css, 'probe')
    return { ok: r.ok, whys: r.errors.map((e) => e.why) }
}

// A1..A4 and A3b: each is accepted by the lint before the rule; every one carries a declaration the declaration checks accept on a named part.
const REFUSED: readonly [string, string][] = [
    ['A1 a data-page selector', '[data-page="display"]{color:#fff !important;box-shadow:inset 0 0 0 40px #fff !important}'],
    ['A2 a data-kind selector', '[data-kind="button"]{color:#fff}'],
    ['A3 a bare [data-part]', '[data-part]{color:#fff !important}'],
    ['A3b an empty [data-part=""]', '[data-part=""]{color:#fff}'],
    ['A4a a part-less ancestor of a named part', '[data-page="display"] [data-part="home-story"]{color:#fff}'],
    ['A4b a valueless [data-part] ancestor', '[data-part] [data-part="home-story"]{color:#fff}'],
    ['A4c an empty [data-part=""] ancestor', '[data-part=""] [data-part="home-story"]{color:#fff}'],
    ['A4d an empty [data-part=""] inside a root compound', 'html[data-layout="phone"][data-part=""] [data-part="home-story"]{color:#fff}'],
    ['A4e a non-rootOnly root subject', 'html[data-theme="x"]{color:#fff}'],
    ['A4f a root subject with a pseudo class', ':root:hover{color:#fff}'],
    ['A4g a named part with a part-less compound after it', '[data-part="home-story"] [data-x="y"]{color:#fff}'],
]
const ACCEPTED: readonly [string, string][] = [
    ['A7a a named part', '[data-part="home-story"]{color:#fff}'],
    ['A7b a root ancestor of a named part', 'html[data-layout="phone"] [data-part="home-story"]{color:#fff}'],
    ['A7c the lone root tier', ':root{--pack-a:#ffffff}'],
    ['A7d a root attribute alone', 'html[data-layout="phone"]{--pack-a:#ffffff}'],
]

describe('the part-value rule refuses a compound without a named part, in settings and home', () => {
    for (const area of AREAS) {
        for (const [name, css] of REFUSED) {
            it(`${area}: ${name} (port)`, () => {
                const got = portReasons(area, css)
                expect(got.ok, css).toBe(false)
                expect(got.whys.some((w) => REASON.test(w)), JSON.stringify(got.whys)).toBe(true)
            })
            it(`${area}: ${name} (reference lint)`, () => {
                const got = refReasons(area, css)
                expect(got.ok, css).toBe(false)
                expect(got.whys.some((w) => REASON.test(w)), JSON.stringify(got.whys)).toBe(true)
            })
        }
        for (const [name, css] of ACCEPTED) {
            it(`${area}: ${name} stays accepted (GUARD, passes before and after)`, () => {
                const want = portReasons(area, css)
                expect(want.ok, JSON.stringify(want.whys)).toBe(true)
                expect(refReasons(area, css).ok).toBe(true)
            })
        }
    }
})

describe('the part-value rule changes neither chat, studio nor the other reasons', () => {
    it('chat and studio never carry the part-value reason (GUARD, flag off)', () => {
        for (const area of ['chat', 'studio'] as const) for (const [, css] of REFUSED) expect(portReasons(area, css).whys.some((w) => REASON.test(w)), `${area}: ${css}`).toBe(false)
        expect(CHAT_REGISTRY.partRequired).toBe(false)
    })
    it('A11 an unparseable selector keeps its single reason and gains no part-value line (GUARD)', () => {
        // the second form puts a part-less compound in front of the unparseable one: only the grammar result keeps the rule off it
        for (const css of ['.x{color:red}', '[data-kind="a"] .x{color:red}']) for (const area of AREAS) {
            const got = portReasons(area, css)
            expect(got.ok).toBe(false)
            expect(got.whys.some((w) => REASON.test(w)), `${area}: ${css}`).toBe(false)
            expect(got.whys.some((w) => /not allowed in a pack selector/.test(w))).toBe(true)
            expect(refReasons(area, css).whys.some((w) => REASON.test(w)), `${area} reference: ${css}`).toBe(false)
        }
    })
    it('A8 the part-value reason never gates the declaration checks: DD-265 and DD-242 still fire on a kind selector (GUARD)', () => {
        for (const area of AREAS) {
            expect(portReasons(area, '[data-kind="peer"]{padding:64px}').whys.some((w) => /names no part can resize/.test(w)), area).toBe(true)
            expect(portReasons(area, '[data-kind="restore"]{background:#fff}').whys.some((w) => /background on a selector that names no part/.test(w)), area).toBe(true)
            expect(refReasons(area, '[data-kind="peer"]{padding:64px}').whys.some((w) => /names no part can resize/.test(w)), area).toBe(true)
            expect(refReasons(area, '[data-kind="restore"]{background:#fff}').whys.some((w) => /background on a selector that names no part/.test(w)), area).toBe(true)
        }
    })
    it('the part-value reason does not contain the Rule SCOPE text "names no part"', () => {
        const got = portReasons('settings', '[data-page="display"]{color:#fff}').whys.filter((w) => REASON.test(w))
        expect(got.length).toBeGreaterThan(0)
        for (const w of got) expect(w).not.toMatch(/names no part/)
    })
    it('lintSelector carries the reason for the registries that set the flag and not for chat', () => {
        expect(lintSelector('[data-page="x"]', HOME_REGISTRY).some((w) => REASON.test(w))).toBe(true)
        expect(lintSelector('[data-page="x"]', { ...SETTINGS_REGISTRY, partRequired: true } as RegistryInput).some((w) => REASON.test(w))).toBe(true)
        expect(lintSelector('[data-page="x"]').some((w) => REASON.test(w))).toBe(false)
        expect(lintSelector('.x', HOME_REGISTRY).some((w) => REASON.test(w))).toBe(false)
    })
    it('the reference lintSelector carries the reason in home and settings and not in chat (mirror of the lintSelector test)', () => {
        expect(refHome.lintHomeSelector('[data-page="x"]').some((w) => REASON.test(w))).toBe(true)
        expect(refSettings.lintSelector('[data-page="x"]').some((w) => REASON.test(w))).toBe(true)
        expect(refChat.lintSelector('[data-page="x"]').some((w) => REASON.test(w))).toBe(false)
        expect(refHome.lintHomeSelector('.x').some((w) => REASON.test(w))).toBe(false)
    })
})
