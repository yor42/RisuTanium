// The built-in packs: the shipped chat themes, bundled as `.risutheme` archives (src/ts/themePack/bundled). Each listing entry
// carries the metadata the picker shows without reading the archive, and the archive's URL with its size and SHA-256 pins. The
// apply path reads the archive through the installed-archive intake and refuses bytes that do not match the pins, so the bytes
// that run are the bytes the build-time test judged. The manifest values are those of the archive's own manifest.
import originNavyUrl from './bundled/origin-navy.risutheme?url'
import bananaCocoaUrl from './bundled/banana-cocoa.risutheme?url'
import scratchWhiteUrl from './bundled/scratch-white.risutheme?url'
import officeSheetUrl from './bundled/office-sheet.risutheme?url'

export interface BuiltinArchive {
    /** Where the bundled archive is fetched from. */
    url: string
    /** The exact byte length of the archive. */
    size: number
    /** The lower-case hex SHA-256 of the archive's bytes. */
    sha256: string
}

export interface BuiltinPack {
    id: `builtin:${string}`
    slug: string
    name: string
    version: string
    license: string
    attribution: string
    modes: readonly ('light' | 'dark')[]
    /** The tile colours, equal to what the install derives from the archive's chat sheet (or its manifest colours); pinned by the built-ins test. */
    mainColor: string
    secondaryColor: string
    archive: BuiltinArchive
}

export const BUILTIN_PACKS: readonly BuiltinPack[] = [
    {
        id: 'builtin:origin-navy', slug: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['dark'], mainColor: '#8be9fd', secondaryColor: '#21222c',
        archive: { url: originNavyUrl, size: 1619, sha256: 'f9b1d61adf8423ae034e875451ef4b9ff932e645458c7bcfc4522d718dc8305c' },
    },
    {
        id: 'builtin:banana-cocoa', slug: 'banana-cocoa', name: 'Banana Cocoa', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], mainColor: '#6b3f18', secondaryColor: '#b2c7da',
        archive: { url: bananaCocoaUrl, size: 3515, sha256: 'faed96bba8aa6d34a9bd61fe6ff8ec55485021e4112756cb9fc850966b072cab' },
    },
    {
        id: 'builtin:scratch-white', slug: 'scratch-white', name: 'Scratch White', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], mainColor: '#1f4aa8', secondaryColor: '#fdfdfa',
        archive: { url: scratchWhiteUrl, size: 1920, sha256: '718b7f62d1c396d94399e3cf3730299706d222e85e70f7196ca9b0482008ed36' },
    },
    {
        id: 'builtin:office-sheet', slug: 'office-sheet', name: 'Office Sheet', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], mainColor: '#1a55ba', secondaryColor: '#f3f4f6',
        archive: { url: officeSheetUrl, size: 2869, sha256: '1d4076392f31f9d89b2a80e8521f73dbf5725915ae13c881b57b508ef4f27573' },
    },
]

/** An exact match on the id; an id of a newer build's built-in is not found. */
export function builtinPackById(id: string): BuiltinPack | null {
    return BUILTIN_PACKS.find((pack) => pack.id === id) ?? null
}
