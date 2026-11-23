// @vitest-environment node
// The built-in packs: metadata and chat sheet equal the frozen golden packs they were built from. T3B-1.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as builtinsModule from './builtins'
import { BUILTIN_PACKS, builtinPackById } from './builtins'
import { cr, parseHexColour, type Rgba } from './colour'
import { decls } from './csslit'
import { judgeAreaSheet, preprocessCss, THEME_AREAS, type ThemeArea } from './index'
import { deriveTileColours } from './tileColours'

const GOLDENS = new URL('./goldens/', import.meta.url)

interface GoldenManifest { id: string; name: string; version: string; license: string; attribution: string; modes: string[] }

function golden(slug: string): { manifest: GoldenManifest; chat: string } {
    const entries = unzipSync(new Uint8Array(readFileSync(new URL(`${slug}.risutheme`, GOLDENS))))
    return { manifest: JSON.parse(strFromU8(entries['manifest.json'])) as GoldenManifest, chat: strFromU8(entries['chat.css']) }
}

describe('T3B-1 the built-in packs', () => {
    it('are exactly the four chat themes, with the ids the settings and I2 use', () => {
        expect(BUILTIN_PACKS.map((pack) => pack.id)).toEqual(['builtin:origin-navy', 'builtin:banana-cocoa', 'builtin:scratch-white', 'builtin:office-sheet'])
        expect(BUILTIN_PACKS.map((pack) => pack.slug)).toEqual(['origin-navy', 'banana-cocoa', 'scratch-white', 'office-sheet'])
    })

    it.each(BUILTIN_PACKS.filter((pack) => ['origin-navy', 'banana-cocoa'].includes(pack.slug)).map((pack) => [pack.slug, pack] as const))('%s: the metadata equals its golden manifest and the sheet equals its golden chat.css', (slug, pack) => {
        const { manifest, chat } = golden(slug)
        expect(manifest.id).toBe(`risutanium.${slug}`)
        expect({ name: pack.name, version: pack.version, license: pack.license, attribution: pack.attribution, modes: [...pack.modes] })
            .toEqual({ name: manifest.name, version: manifest.version, license: manifest.license, attribution: manifest.attribution, modes: manifest.modes })
        expect(preprocessCss(pack.chatCss)).toBe(chat)
    })

    it.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s: the chat sheet is accepted by the validator and bundles no file', (_slug, pack) => {
        const judged = judgeAreaSheet('chat', pack.chatCss)
        expect(judged.result.errors).toEqual([])
        expect(judged.result.ok).toBe(true)
        expect(judged.resources).toHaveLength(0)
    })

    // Compatibility guard (passes before and after the notes channel): a shipped sheet has neither errors nor notes.
    it.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s: the chat sheet judgement carries no notes', (_slug, pack) => {
        expect(judgeAreaSheet('chat', pack.chatCss).result.notes).toBeUndefined()
    })

    it('carry a chat sheet only: no studio, settings or home sheet is bundled or exported', () => {
        expect(Object.keys(builtinsModule).sort()).toEqual(['BUILTIN_PACKS', 'builtinPackById'])
        for (const pack of BUILTIN_PACKS) {
            expect(Object.keys(pack).sort()).toEqual(['attribution', 'chatCss', 'id', 'license', 'mainColor', 'modes', 'name', 'secondaryColor', 'slug', 'version'])
        }
    })

    it.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s: the tile colours equal what the install derives from the judged sheet', (_slug, pack) => {
        const judged = judgeAreaSheet('chat', pack.chatCss)
        expect(deriveTileColours(judged.canonical)).toEqual({ main: pack.mainColor, secondary: pack.secondaryColor })
    })

    it('builtinPackById matches the id exactly and nothing else', () => {
        expect(builtinPackById('builtin:origin-navy')).toBe(BUILTIN_PACKS[0])
        expect(builtinPackById('builtin:banana-cocoa')).toBe(BUILTIN_PACKS[1])
        for (const id of ['builtin:nope', 'origin-navy', 'builtin:origin-navy ', 'BUILTIN:ORIGIN-NAVY', 'builtin:', '', 'archive:origin-navy']) {
            expect(builtinPackById(id), id).toBeNull()
        }
    })
})

const NEW_BUILTINS = [
    { slug: 'scratch-white', name: 'Scratch White', index: 2, mainColor: '#1f4aa8', secondaryColor: '#fdfdfa' },
    { slug: 'office-sheet', name: 'Office Sheet', index: 3, mainColor: '#1a55ba', secondaryColor: '#f3f4f6' },
] as const

function docsSheet(area: ThemeArea, slug: string): string {
    return readFileSync(new URL(`../../../docs/design/${area}/themes/${slug}.css`, import.meta.url), 'utf8')
}

function rootValue(canonical: string, prop: string): string | undefined {
    return decls(canonical).find((d) => d.ctx.selector.trim() === ':root' && d.prop === prop)?.value.trim()
}

function hex(canonical: string, prop: string): Rgba {
    const value = rootValue(canonical, prop)
    const parsed = value === undefined ? null : parseHexColour(value)
    if (!parsed) throw new Error(`${prop} is not a hex colour in the sheet: ${value}`)
    return parsed
}

describe('MC-2521 the reference-free built-ins', () => {
    it.each(NEW_BUILTINS)('$slug: present, appended in order, with the planned metadata and tile colours', ({ slug, name, index, mainColor, secondaryColor }) => {
        const pack = builtinPackById(`builtin:${slug}`)
        expect(pack).not.toBeNull()
        expect(pack).toBe(BUILTIN_PACKS[index])
        expect({ name: pack?.name, version: pack?.version, license: pack?.license, attribution: pack?.attribution, modes: [...(pack?.modes ?? [])], mainColor: pack?.mainColor, secondaryColor: pack?.secondaryColor })
            .toEqual({ name, version: '1.0.0', license: 'GPL-3.0', attribution: 'RisuTanium contributors', modes: ['light'], mainColor, secondaryColor })
    })

    it.each(NEW_BUILTINS)('$slug: the chat sheet is the docs sheet, registers no font and names no message font', ({ slug }) => {
        const pack = builtinPackById(`builtin:${slug}`)
        expect(pack?.chatCss).toBe(docsSheet('chat', slug))
        const judged = judgeAreaSheet('chat', pack?.chatCss ?? '')
        expect(judged.fontFaceBlocks).toHaveLength(0)
        expect(judged.resources).toHaveLength(0)
    })

    it('Scratch White names no message font: message text keeps the user font', () => {
        const css = builtinPackById('builtin:scratch-white')?.chatCss ?? ''
        expect(css.length).toBeGreaterThan(0)
        expect(decls(css).filter((d) => d.prop === '--chat-message-font')).toEqual([])
    })
})

describe('MC-2524 the docs sheets of the new packs are accepted in every area', () => {
    const cases = NEW_BUILTINS.flatMap(({ slug }) => THEME_AREAS.map((area) => [slug, area] as const))
    it.each(cases)('%s / %s', (slug, area) => {
        const judged = judgeAreaSheet(area, docsSheet(area, slug))
        expect(judged.result.errors).toEqual([])
        expect(judged.result.ok).toBe(true)
        expect(judged.result.notes).toBeUndefined()
    })
})

describe('MC-2522/MC-2523 the designed palette and contrast of the new chat sheets', () => {
    const canonicalOf = (slug: string): string => judgeAreaSheet('chat', docsSheet('chat', slug)).canonical

    it('Scratch White pins its palette', () => {
        const scratch = canonicalOf('scratch-white')
        expect(rootValue(scratch, '--pack-paper')).toBe('#fdfdfa')
        expect(rootValue(scratch, '--nexus-canvas')).toBe('#fdfdfa')
        expect(rootValue(scratch, '--nexus-text')).toBe('#2b2e34')
        expect(rootValue(scratch, '--nexus-text-secondary')).toBe('#464b54')
        expect(rootValue(scratch, '--nexus-text-muted')).toBe('#545a64')
        expect(rootValue(scratch, '--nexus-accent-rgb')).toBe('31 74 168')
        expect(rootValue(scratch, '--nexus-danger-rgb')).toBe('179 38 30')
        expect(rootValue(scratch, '--color-surface-sheet')).toBe('#ffffff')
        expect(rootValue(scratch, '--color-surface-toast')).toBe('#fffef5')
    })

    it('Scratch White text meets 4.5:1 on its paper, sheet and toast', () => {
        const scratch = canonicalOf('scratch-white')
        for (const surface of ['--pack-paper', '--color-surface-sheet', '--color-surface-toast', '--color-surface-bar']) {
            for (const text of ['--nexus-text', '--nexus-text-secondary', '--nexus-text-muted', '--nexus-ring', '--color-warning']) {
                expect(cr(hex(scratch, text), hex(scratch, surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })

    it('Office Sheet carries light-only, non-branded chat tokens', () => {
        const office = canonicalOf('office-sheet')
        expect(rootValue(office, '--color-scheme')).toBe('light')
        expect(rootValue(office, '--nexus-canvas')).toBe('#f3f4f6')
        expect(rootValue(office, '--nexus-ring')).toBe('#1a55ba')
    })

    it('Office Sheet text meets 4.5:1 on its bar, page and desk', () => {
        const office = canonicalOf('office-sheet')
        for (const surface of ['--nexus-canvas', '--pack-page', '--pack-desk']) {
            for (const text of ['--nexus-text', '--nexus-text-secondary', '--nexus-text-muted', '--nexus-ring']) {
                expect(cr(hex(office, text), hex(office, surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })
})

describe('MC-2521 each built-in chat sheet is the downloadable pack chat.css (the Scratch White pack adds the font block)', () => {
    const packEntries = (slug: string): Record<string, Uint8Array> => unzipSync(new Uint8Array(readFileSync(new URL(`../../../theme-packs/${slug}.risutheme`, import.meta.url))))

    it.each(NEW_BUILTINS)('$slug: the pack manifest equals the built-in metadata', ({ slug }) => {
        const pack = builtinPackById(`builtin:${slug}`)
        const manifest = JSON.parse(strFromU8(packEntries(slug)['manifest.json'])) as GoldenManifest
        expect(manifest.id).toBe(`risutanium.${slug}`)
        expect({ name: manifest.name, version: manifest.version, license: manifest.license, attribution: manifest.attribution, modes: manifest.modes })
            .toEqual({ name: pack?.name, version: pack?.version, license: pack?.license, attribution: pack?.attribution, modes: [...(pack?.modes ?? [])] })
    })

    it('office-sheet: the pack chat.css equals the built-in chat sheet', () => {
        const pack = builtinPackById('builtin:office-sheet')
        expect(pack).not.toBeNull()
        expect(strFromU8(packEntries('office-sheet')['chat.css'])).toBe(preprocessCss(pack?.chatCss ?? ''))
    })

    it('scratch-white: the pack chat.css is the built-in chat sheet plus exactly the font block', () => {
        const pack = builtinPackById('builtin:scratch-white')
        expect(pack).not.toBeNull()
        const block = readFileSync(new URL('../../../theme-packs/scratch-white.chat-font.css', import.meta.url), 'utf8')
        expect(strFromU8(packEntries('scratch-white')['chat.css'])).toBe(preprocessCss(pack?.chatCss ?? '') + preprocessCss(block))
    })
})
