// @vitest-environment node
// The built-in packs: the bundled archives, their pins, and the listing that points at them. T3B-1.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as builtinsModule from './builtins'
import { BUILTIN_PACKS, builtinPackById } from './builtins'
import { cr, parseHexColour, type Rgba } from './colour'
import { decls } from './csslit'
import { builtinArchiveBytesForTests, builtinSheetForTests } from './fixtures/bundledPacks'
import { judgeAreaSheet, judgePackSheets, preprocessCss, THEME_AREAS, type ThemeArea } from './index'
import { intakePackBytes, type PackJudge, type VerifiedPack } from './intake'
import { deriveTileColours } from './tileColours'

const GOLDENS = new URL('./goldens/', import.meta.url)
const BUNDLED_README = readFileSync(new URL('./bundled/README.md', import.meta.url), 'utf8')
const judge: PackJudge = async (sheets) => judgePackSheets(sheets)

interface GoldenManifest { id: string; name: string; version: string; license: string; attribution: string; modes: string[] }

function golden(slug: string): { manifest: GoldenManifest } {
    const entries = unzipSync(new Uint8Array(readFileSync(new URL(`${slug}.risutheme`, GOLDENS))))
    return { manifest: JSON.parse(strFromU8(entries['manifest.json'])) as GoldenManifest }
}

async function acceptedBundled(slug: string): Promise<VerifiedPack> {
    const result = await intakePackBytes(builtinArchiveBytesForTests(slug), judge)
    if (result.ok === false) throw new Error(`bundled ${slug} refused: ${JSON.stringify(result.refusals)}`)
    return result.pack
}

const EACH_PACK = BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const)

describe('T3B-1 the built-in packs', () => {
    it('are exactly the four chat themes, with the ids the settings and I2 use', () => {
        expect(BUILTIN_PACKS.map((pack) => pack.id)).toEqual(['builtin:origin-navy', 'builtin:banana-cocoa', 'builtin:scratch-white', 'builtin:office-sheet'])
        expect(BUILTIN_PACKS.map((pack) => pack.slug)).toEqual(['origin-navy', 'banana-cocoa', 'scratch-white', 'office-sheet'])
    })

    // The golden packs are frozen bytes of an earlier pack layout: only the pack id is shared, so a later edit of a sheet or a
    // version never reaches back into them (MC-2540).
    it.each(['origin-navy', 'banana-cocoa'])('%s: the bundled manifest id equals the id of its golden manifest', async (slug) => {
        const bundled = await acceptedBundled(slug)
        expect(golden(slug).manifest.id).toBe(`risutanium.${slug}`)
        expect(bundled.manifest.packId).toBe(golden(slug).manifest.id)
    })

    // Build-time guard: the bytes that run are the bytes judged here, so a sheet that gains a note or a refusal fails this test
    // instead of breaking a built-in at runtime. A note is a validator defect to fix, not a reason to tone a pack down (MC-3419).
    it.each(EACH_PACK)('%s: the bundled archive passes the intake with every sheet judged ok, no note, no skipped area and no bundled file', async (slug) => {
        const accepted = await acceptedBundled(slug)
        expect(accepted.skippedAreas).toEqual([])
        expect(Object.keys(accepted.sheets)).toEqual(['chat'])
        for (const [area, sheet] of Object.entries(accepted.sheets)) {
            expect(sheet.result.errors, area).toEqual([])
            expect(sheet.result.ok, area).toBe(true)
            expect(sheet.result.notes, area).toBeUndefined()
            expect(sheet.resources, area).toHaveLength(0)
        }
        expect(accepted.files.size).toBe(0)
    })

    it('carry a listing of the archive and its pins only: the module exports no sheet text', () => {
        expect(Object.keys(builtinsModule).sort()).toEqual(['BUILTIN_PACKS', 'builtinPackById'])
        for (const pack of BUILTIN_PACKS) {
            expect(Object.keys(pack).sort()).toEqual(['archive', 'attribution', 'id', 'license', 'mainColor', 'modes', 'name', 'secondaryColor', 'slug', 'version'])
            expect(Object.keys(pack.archive).sort()).toEqual(['sha256', 'size', 'url'])
        }
    })

    it.each(EACH_PACK)('%s: the listing equals the bundled manifest', async (slug, pack) => {
        const { manifest } = await acceptedBundled(slug)
        expect({ id: pack.id, name: pack.name, version: pack.version, license: pack.license, attribution: pack.attribution, modes: [...pack.modes] })
            .toEqual({ id: `builtin:${slug}`, name: manifest.name, version: manifest.version, license: manifest.license, attribution: manifest.attribution, modes: manifest.modes })
        expect(manifest.packId).toBe(`risutanium.${slug}`)
    })

    // The tile follows the install rule (themePackInstallFlow tileColoursOf): both manifest colours if given, else derived from the judged chat sheet.
    it.each(EACH_PACK)('%s: the tile colours follow the install rule over the bundled archive', async (slug, pack) => {
        const { manifest, sheets } = await acceptedBundled(slug)
        const given = { main: manifest.tile.main.kind === 'ok' ? manifest.tile.main.value : undefined, secondary: manifest.tile.secondary.kind === 'ok' ? manifest.tile.secondary.value : undefined }
        const derived = given.main !== undefined && given.secondary !== undefined ? {} : deriveTileColours(sheets.chat?.canonical ?? '')
        expect({ main: pack.mainColor, secondary: pack.secondaryColor }).toEqual({ main: given.main ?? derived.main, secondary: given.secondary ?? derived.secondary })
    })

    it('builtinPackById matches the id exactly and nothing else', () => {
        expect(builtinPackById('builtin:origin-navy')).toBe(BUILTIN_PACKS[0])
        expect(builtinPackById('builtin:banana-cocoa')).toBe(BUILTIN_PACKS[1])
        for (const id of ['builtin:nope', 'origin-navy', 'builtin:origin-navy ', 'BUILTIN:ORIGIN-NAVY', 'builtin:', '', 'archive:origin-navy']) {
            expect(builtinPackById(id), id).toBeNull()
        }
    })
})

describe('T2 the archive pins agree in the listing, the file and the README', () => {
    it.each(EACH_PACK)('%s: size and SHA-256', (slug, pack) => {
        const bytes = builtinArchiveBytesForTests(slug)
        expect(bytes.length).toBe(pack.archive.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(pack.archive.sha256)
        expect(BUNDLED_README).toContain(pack.archive.sha256)
        expect(BUNDLED_README).toContain(`${pack.archive.size} bytes`)
    })

    it.each(EACH_PACK)('%s: the listing URL names the bundled file', (slug, pack) => {
        expect(pack.archive.url).toContain(`${slug}.risutheme`)
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
        expect(pack).not.toBeNull()
        expect(builtinSheetForTests(slug, 'chat')).toBe(preprocessCss(docsSheet('chat', slug)))
        const judged = judgeAreaSheet('chat', builtinSheetForTests(slug, 'chat'))
        expect(judged.fontFaceBlocks).toHaveLength(0)
        expect(judged.resources).toHaveLength(0)
    })

    it('Scratch White names no message font: message text keeps the user font', () => {
        const css = builtinSheetForTests('scratch-white', 'chat')
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

describe('T8 each bundled chat sheet is the docs sheet, and the downloadable pack chat.css matches it (the Scratch White pack adds the font block)', () => {
    const packEntries = (slug: string): Record<string, Uint8Array> => unzipSync(new Uint8Array(readFileSync(new URL(`../../../theme-packs/${slug}.risutheme`, import.meta.url))))

    it.each(BUILTIN_PACKS.map((pack) => pack.slug))('%s: the bundled chat.css is the preprocessed docs sheet', (slug) => {
        expect(builtinSheetForTests(slug, 'chat')).toBe(preprocessCss(docsSheet('chat', slug)))
    })

    it.each(NEW_BUILTINS)('$slug: the pack manifest equals the built-in metadata', ({ slug }) => {
        const pack = builtinPackById(`builtin:${slug}`)
        const manifest = JSON.parse(strFromU8(packEntries(slug)['manifest.json'])) as GoldenManifest
        expect(manifest.id).toBe(`risutanium.${slug}`)
        expect({ name: manifest.name, version: manifest.version, license: manifest.license, attribution: manifest.attribution, modes: manifest.modes })
            .toEqual({ name: pack?.name, version: pack?.version, license: pack?.license, attribution: pack?.attribution, modes: [...(pack?.modes ?? [])] })
    })

    it('office-sheet: the pack chat.css equals the bundled chat sheet', () => {
        expect(strFromU8(packEntries('office-sheet')['chat.css'])).toBe(builtinSheetForTests('office-sheet', 'chat'))
    })

    it('scratch-white: the pack chat.css is the bundled chat sheet plus exactly the font block', () => {
        const block = readFileSync(new URL('../../../theme-packs/scratch-white.chat-font.css', import.meta.url), 'utf8')
        expect(strFromU8(packEntries('scratch-white')['chat.css'])).toBe(builtinSheetForTests('scratch-white', 'chat') + preprocessCss(block))
    })
})