/**
 * The MIME type an asset is shown with, decided from the extension of its key
 * alone. A stored value's own type is never consulted: a picked file carries
 * whatever type the operating system guessed, and a restored value carries the
 * type of an untrusted backup, so neither may decide how the page treats a
 * `blob:` URL. Anything outside the closed table, markup types (`svg`, `html`)
 * included, is shown as opaque bytes.
 *
 * An inlay's body key carries no extension (it is a 16-hex token), so the
 * inlay's own `ext` and kind decide, within the same closed table. A font type
 * is never reachable for an inlay.
 */

const DISPLAY_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
    ['bmp', 'image/bmp'],
    ['mp4', 'video/mp4'],
    ['webm', 'video/webm'],
    ['mov', 'video/quicktime'],
    ['m4v', 'video/x-m4v'],
    ['ogv', 'video/ogg'],
    ['mkv', 'video/x-matroska'],
    ['mp3', 'audio/mpeg'],
    ['wav', 'audio/wav'],
    ['ogg', 'audio/ogg'],
    ['oga', 'audio/ogg'],
    ['m4a', 'audio/mp4'],
    ['aac', 'audio/aac'],
    ['flac', 'audio/flac'],
    ['opus', 'audio/opus'],
    ['ttf', 'font/ttf'],
    ['otf', 'font/otf'],
    ['woff', 'font/woff'],
    ['woff2', 'font/woff2'],
])

/** The type shown for a key whose extension is not in the table. */
export const OPAQUE_DISPLAY_MIME = 'application/octet-stream'

/** The display MIME type of the asset stored under `key`; the extension after the last dot, lower-cased, picks it. */
export function displayMimeOfAssetKey(key: string): string {
    const dot = key.lastIndexOf('.')
    if (dot < 0 || key.indexOf('/', dot) >= 0) {
        return OPAQUE_DISPLAY_MIME
    }
    return DISPLAY_MIME_BY_EXTENSION.get(key.slice(dot + 1).toLowerCase()) ?? OPAQUE_DISPLAY_MIME
}

/**
 * The display MIME type of an inlay of kind `type` (`image`, `video` or `audio`)
 * with extension `ext`. Both arrive from a stored record or an old-store value
 * that a backup may have written, so neither is trusted to be a string. The type
 * is the table's only when its category is the inlay's kind; anything else is opaque.
 */
export function displayMimeOfInlay(type: unknown, ext: unknown): string {
    if (type !== 'image' && type !== 'video' && type !== 'audio') {
        return OPAQUE_DISPLAY_MIME
    }
    if (typeof ext !== 'string') {
        return OPAQUE_DISPLAY_MIME
    }
    const mime = DISPLAY_MIME_BY_EXTENSION.get(ext.toLowerCase())
    if (mime === undefined || !mime.startsWith(type + '/')) {
        return OPAQUE_DISPLAY_MIME
    }
    return mime
}
