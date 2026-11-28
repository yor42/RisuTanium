// @vitest-environment happy-dom
/**
 * The rail and persona "+" button takes its glyph colour from the colour scheme (#654). A fixed Tailwind gray-300 read at 1.2 to 1.5:1 on every
 * light scheme. Kinds: the class row is a regression reproducer (fails on the base); the scheme rows are compatibility guards that fix
 * the token the button now reads against the grounds it sits on (page and sidebar), for every preset.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test } from 'vitest'
import BaseRoundedButton from './BaseRoundedButton.svelte'
import { readRepoFile } from '../../styles/tests/cascadeModel'

const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const GRAY_300 = '#d1d5db'
// colorschemeCore pulls the whole app in through a cycle, so the presets are read from its text: every block that names a page ground, a sidebar ground and a text colour.
const SCHEMES = [...readRepoFile('src/ts/gui/colorschemeCore.ts').matchAll(/bgcolor:\s*"(#[0-9a-f]{6})",\s*darkbg:\s*"(#[0-9a-f]{6})"[\s\S]*?\btextcolor:\s*"(#[0-9a-f]{6})"/gi)]
    .map((m, i) => [`preset ${i}`, { bgcolor: m[1], darkbg: m[2], textcolor: m[3] }] as const)

describe('BaseRoundedButton glyph colour', () => {
    test('the button reads the scheme text colour, not a palette gray (REPRO)', () => {
        const target = document.createElement('div')
        document.body.append(target)
        const app = mount(BaseRoundedButton, { target, props: { onClick: () => {}, label: 'x' } })
        flushSync()
        const classes = [...target.querySelector('button')!.classList]
        unmount(app)
        expect(classes).toContain('text-textcolor')
        expect(classes.filter((c) => /gray-\d/.test(c))).toEqual([])
    })

    test('the preset list was read (guard)', () => expect(SCHEMES.length).toBeGreaterThanOrEqual(17))

    test.each(SCHEMES)('%s: the scheme text colour reads at 4.5:1 on the page and the sidebar grounds, and never worse than gray-300 did', (_, scheme) => {
        for (const ground of [scheme.bgcolor, scheme.darkbg]) {
            expect(ratio(scheme.textcolor, ground)).toBeGreaterThanOrEqual(4.5)
            expect(ratio(scheme.textcolor, ground)).toBeGreaterThanOrEqual(ratio(GRAY_300, ground))
        }
    })
})
