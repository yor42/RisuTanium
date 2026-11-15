// The bundled fonts and images a theme pack may hold, decided by their first bytes: the extension only says what the
// file claims to be, the magic bytes say what it is. An SVG, a link body or a nested archive has none of these heads.
export type PackFileKind = 'font' | 'image'
export type PackFileMime = 'font/woff2' | 'font/woff' | 'font/ttf' | 'font/otf'
    | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif'

/** The longest head any magic needs. */
export const SNIFF_BYTES = 16

const MIME_OF_EXTENSION: Readonly<Record<string, PackFileMime>> = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
}

/** The MIME the extension promises (lower-case extension without the dot), or null for any other extension. */
export function mimeOfExtension(ext: string): PackFileMime | null {
    return Object.hasOwn(MIME_OF_EXTENSION, ext) ? MIME_OF_EXTENSION[ext] : null
}

function startsWith(head: Uint8Array, at: number, bytes: readonly number[]): boolean {
    if (head.length < at + bytes.length) {
        return false
    }
    for (let i = 0; i < bytes.length; i++) {
        if (head[at + i] !== bytes[i]) {
            return false
        }
    }
    return true
}

function asciiAt(head: Uint8Array, at: number, text: string): boolean {
    return startsWith(head, at, Array.from(text, (c) => c.charCodeAt(0)))
}

/** The MIME the first bytes show, or null when no allowed magic matches. */
export function sniffPackFile(head: Uint8Array): PackFileMime | null {
    if (asciiAt(head, 0, 'wOF2')) return 'font/woff2'
    if (asciiAt(head, 0, 'wOFF')) return 'font/woff'
    if (startsWith(head, 0, [0x00, 0x01, 0x00, 0x00]) || asciiAt(head, 0, 'true')) return 'font/ttf'
    if (asciiAt(head, 0, 'OTTO')) return 'font/otf'
    if (startsWith(head, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png'
    if (startsWith(head, 0, [0xFF, 0xD8, 0xFF])) return 'image/jpeg'
    if (asciiAt(head, 0, 'GIF87a') || asciiAt(head, 0, 'GIF89a')) return 'image/gif'
    if (asciiAt(head, 0, 'RIFF') && asciiAt(head, 8, 'WEBP')) return 'image/webp'
    if (asciiAt(head, 4, 'ftyp') && (asciiAt(head, 8, 'avif') || asciiAt(head, 8, 'avis'))) return 'image/avif'
    return null
}

export function kindOfMime(mime: PackFileMime): PackFileKind {
    return mime.startsWith('font/') ? 'font' : 'image'
}
