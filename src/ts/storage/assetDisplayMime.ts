/**
 * The MIME type an asset is shown with, decided from the extension of its key
 * alone. A stored value's own type is never consulted: a picked file carries
 * whatever type the operating system guessed, and a restored value carries the
 * type of an untrusted backup, so neither may decide how the page treats a
 * `blob:` URL. Anything outside the closed table, markup types (`svg`, `html`)
 * included, is shown as opaque bytes.
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
