/**
 * The largest request body the self-hosted Node server accepts, in bytes. It
 * must equal `NODE_BODY_LIMIT_BYTES` in `server/node/bodyLimit.cjs`, which the
 * server's body parsers use; no endpoint reports it, so a test pins the two.
 * This module imports nothing, so the save loop can read the number without
 * importing bootArchiveHost.ts, which imports the save loop's module.
 */
export const NODE_BODY_LIMIT_BYTES: number = 104857600
