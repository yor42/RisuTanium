// Test access to the bundled built-in archives (src/ts/themePack/bundled): the sheet an archive carries for an area, read with
// node:fs the way the Vitest setup reads the archive for the apply path. Tests that once read `pack.chatCss` use this.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import type { BuiltinPack } from '../builtins'
import type { ThemeArea } from '../index'
import { manifestText, validPackFiles, zipPack } from './packBuilder'

// A path, not a URL object: a jsdom test environment replaces `URL`, and node:fs rejects its instances.
const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), '..', 'bundled')

/** What each bundled archive carries, as data. A new bundled pack is one row here; the generic rows read it. */
export interface BuiltinRow {
    slug: string
    id: string
    modes: readonly ('light' | 'dark')[]
    /** The areas whose sheet the archive carries. */
    areas: readonly ThemeArea[]
    /** Bundled files beyond the sheets (fonts, images). */
    files: number
    /** Resources the judged sheets hold. */
    resources: number
}

export const BUILTIN_ROWS: readonly BuiltinRow[] = [
    { slug: 'origin-navy', id: 'builtin:origin-navy', modes: ['dark'], areas: ['chat'], files: 0, resources: 0 },
    { slug: 'banana-cocoa', id: 'builtin:banana-cocoa', modes: ['light'], areas: ['chat'], files: 0, resources: 0 },
    { slug: 'scratch-white', id: 'builtin:scratch-white', modes: ['light'], areas: ['chat'], files: 0, resources: 0 },
    { slug: 'office-sheet', id: 'builtin:office-sheet', modes: ['light'], areas: ['chat'], files: 0, resources: 0 },
]

/** The bundled archive's bytes. */
export function builtinArchiveBytesForTests(slug: string): Uint8Array {
    return new Uint8Array(readFileSync(join(BUNDLED, `${slug}.risutheme`)))
}

/** The archive's `<area>.css` text. Throws when the archive carries no sheet for the area. */
export function builtinSheetForTests(slug: string, area: ThemeArea): string {
    const entry = unzipSync(builtinArchiveBytesForTests(slug))[`${area}.css`]
    if (entry === undefined) {
        throw new Error(`bundled ${slug} carries no ${area}.css`)
    }
    return strFromU8(entry)
}

export interface SyntheticBuiltinOptions {
    slug?: string
    modes?: readonly ('light' | 'dark')[]
    /** Overrides the pinned size, the pinned SHA-256 or the URL, to model an archive that does not match its pins. */
    size?: number
    sha256?: string
    url?: string
}

/** A built-in listing entry over `archive`, read through a `data:` URL by the real reader and pinned to the archive's own size and hash. */
export function syntheticBuiltinForTests(archive: Uint8Array, options: SyntheticBuiltinOptions = {}): BuiltinPack {
    const slug = options.slug ?? 'synthetic'
    return {
        id: `builtin:${slug}`, slug, name: 'Synthetic', version: '1.0.0', license: 'MIT', attribution: 'x', modes: options.modes ?? ['dark'],
        mainColor: '#000000', secondaryColor: '#ffffff',
        archive: {
            url: options.url ?? `data:application/octet-stream;base64,${Buffer.from(archive).toString('base64')}`,
            size: options.size ?? archive.length,
            sha256: options.sha256 ?? createHash('sha256').update(archive).digest('hex'),
        },
    }
}

/** A built-in whose archive is a valid pack holding `chat` as its chat sheet. */
export function syntheticBuiltinOfSheetForTests(chat: string, options: SyntheticBuiltinOptions = {}): BuiltinPack {
    const modes = options.modes ?? ['dark']
    return syntheticBuiltinForTests(zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'Synthetic', modes: [...modes] }), 'chat.css': chat })), { ...options, modes })
}