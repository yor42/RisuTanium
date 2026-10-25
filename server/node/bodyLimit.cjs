// The largest request body, in bytes, the server's three body parsers (json,
// raw and text) accept. The client's boot archive pass holds its own copy of
// this number in src/ts/storage/bootArchiveHost.ts, and a test pins the two
// equal, so changing one without the other fails that test.
const NODE_BODY_LIMIT_BYTES = 104857600; // 100 MiB, what express's '100mb' means

// The largest asset (or inlay body) the upload routes accept in total. A test pins
// it equal to the client's copy in src/ts/storage/nodeBodyLimit.ts. Other
// bodies stay at the body limit. Tests override it through
// RISU_NODE_ASSET_LIMIT_BYTES.
const NODE_ASSET_LIMIT_BYTES = 1073741824; // 1 GiB
// The largest single chunk of an upload append or ranged read.
const NODE_UPLOAD_CHUNK_MAX_BYTES = 8388608; // 8 MiB

module.exports = { NODE_BODY_LIMIT_BYTES, NODE_ASSET_LIMIT_BYTES, NODE_UPLOAD_CHUNK_MAX_BYTES };
