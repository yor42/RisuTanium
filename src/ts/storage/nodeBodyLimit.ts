/**
 * The largest request body the self-hosted Node server accepts, in bytes. It
 * must equal `NODE_BODY_LIMIT_BYTES` in `server/node/bodyLimit.cjs`, which the
 * server's body parsers use; no endpoint reports it, so a test pins the two.
 * This module imports nothing, so the save loop can read the number without
 * importing bootArchiveHost.ts, which imports the save loop's module.
 */
export const NODE_BODY_LIMIT_BYTES: number = 104857600

/**
 * The largest asset (or inlay body) the Node server takes in total through its
 * chunked upload route, in bytes. It must equal `NODE_ASSET_LIMIT_BYTES` in
 * `server/node/bodyLimit.cjs`; a test pins the two. A page whose Node server
 * did not record piece support holds only `NODE_BODY_LIMIT_BYTES` per asset.
 */
export const NODE_ASSET_LIMIT_BYTES: number = 1073741824

/** The largest asset or inlay the browser (IndexedDB) store takes until it keeps large values in pieces. */
export const WEB_ASSET_LIMIT_BYTES: number = 209715200
