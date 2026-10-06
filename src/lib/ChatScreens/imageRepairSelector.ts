/**
 * The images the chat body's repair pass re-resolves by asset name: those whose
 * `src` is not already a loadable address. A source the app itself made (a
 * service-worker URL, a Node asset-route URL, an `asset:` URL) is left alone,
 * since re-resolving it as a name would blank a working image.
 */
export const UNRESOLVED_IMAGE_SELECTOR = 'img:not([src^="data:"]):not([src^="http:"]):not([src^="https:"]):not([src^="blob:"]):not([src^="file:"]):not([src^="tauri:"]):not([src^="asset:"]):not([src^="/sw/img/"]):not([src^="/api/asset/"]):not([noimage])'
