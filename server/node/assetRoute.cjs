// Pure helpers of the asset route (GET /api/asset/<hex>) in server.cjs.
// The client holds a twin of `isRouteServedKey` in
// src/ts/storage/store/keyRules.ts (`nodeAssetRouteViolation`): the route
// serves a key exactly when `urlFor` gives it a URL, and one table test runs
// the same keys against both.

// The `aud` claim of the token an asset URL carries. No other route accepts a
// token that has an audience.
const ASSET_READ_AUDIENCE = 'asset-read';

const HEX_PATTERN = /^[0-9a-f]+$/;
// A UTF-16 surrogate with no partner. Matched per code unit (no `u` flag).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// The shape of an inlay body key: `inlays/b-<encoded id>.<16 lowercase hex
// digits>`, the encoded id being a-z, 0-9, `-` and `%` plus two UPPERCASE hex
// digits. Metadata keys (`inlays/m-`) and everything else under `inlays/` stay
// refused. Twin of `INLAY_BODY_KEY_PATTERN` in src/ts/storage/store/keyRules.ts.
const INLAY_BODY_KEY_PATTERN = /^inlays\/b-(?:[a-z0-9-]|%[0-9A-F]{2})+\.[0-9a-f]{16}$/;
// The longest key the server accepts on a write, in UTF-8 bytes; an inlay body
// key is ASCII. Twin of `NODE_MAX_WRITE_KEY_BYTES` in keyRules.ts.
const MAX_WRITE_KEY_BYTES = 117;

// Whether the route may serve the stored key `key`: a key under `assets/`, with
// no backslash and no empty, `.` or `..` segment, that is well-formed UTF-16, or
// an inlay body key of at most MAX_WRITE_KEY_BYTES.
function isRouteServedKey(key) {
    if (typeof key === 'string' && key.startsWith('inlays/')) {
        return INLAY_BODY_KEY_PATTERN.test(key) && key.length <= MAX_WRITE_KEY_BYTES;
    }
    if (typeof key !== 'string' || !key.startsWith('assets/')) {
        return false;
    }
    if (key.includes('\\') || LONE_SURROGATE.test(key)) {
        return false;
    }
    for (const segment of key.split('/')) {
        if (segment === '' || segment === '.' || segment === '..') {
            return false;
        }
    }
    return true;
}

// The stored key the URL hex names, or null when the route must refuse it. The
// hex is case-insensitive and must decode to UTF-8 that encodes back to the
// same hex, so no two URLs reach one file through a lossy decode.
function assetKeyFromHex(hex) {
    if (typeof hex !== 'string') {
        return null;
    }
    const lower = hex.toLowerCase();
    if (lower.length === 0 || lower.length % 2 !== 0 || !HEX_PATTERN.test(lower)) {
        return null;
    }
    const key = Buffer.from(lower, 'hex').toString('utf8');
    if (Buffer.from(key, 'utf8').toString('hex') !== lower) {
        return null;
    }
    return isRouteServedKey(key) ? key : null;
}

const CONTENT_TYPES = {
    png: 'image/png',
    apng: 'image/apng',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    weba: 'audio/webm',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    m4p: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
};

// The content type of an allowlisted extension of the key's last segment, or
// null for an empty, missing or unlisted one.
function contentTypeForKey(key) {
    const name = String(key).split('/').pop();
    const dot = name.lastIndexOf('.');
    if (dot === -1) {
        return null;
    }
    const extension = name.slice(dot + 1).toLowerCase();
    return Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : null;
}

function startsWithBytes(buffer, bytes, offset = 0) {
    if (buffer.length < offset + bytes.length) {
        return false;
    }
    for (let i = 0; i < bytes.length; i++) {
        if (buffer[offset + i] !== bytes[i]) {
            return false;
        }
    }
    return true;
}

function ascii(text) {
    return Array.from(text, (character) => character.charCodeAt(0));
}

// The allowlisted type whose file signature opens `head` (the first bytes of a
// file), or null. Used only when the key's extension names no allowlisted type.
function sniffContentType(head) {
    if (!head || head.length === 0) {
        return null;
    }
    if (startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png';
    }
    if (startsWithBytes(head, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg';
    }
    if (startsWithBytes(head, ascii('GIF87a')) || startsWithBytes(head, ascii('GIF89a'))) {
        return 'image/gif';
    }
    if (startsWithBytes(head, ascii('RIFF')) && startsWithBytes(head, ascii('WEBP'), 8)) {
        return 'image/webp';
    }
    if (startsWithBytes(head, ascii('RIFF')) && startsWithBytes(head, ascii('WAVE'), 8)) {
        return 'audio/wav';
    }
    if (startsWithBytes(head, ascii('ftyp'), 4)) {
        if (startsWithBytes(head, ascii('avif'), 8) || startsWithBytes(head, ascii('avis'), 8)) {
            return 'image/avif';
        }
        if (startsWithBytes(head, ascii('M4A '), 8)) {
            return 'audio/mp4';
        }
        return 'video/mp4';
    }
    if (startsWithBytes(head, [0x1a, 0x45, 0xdf, 0xa3])) {
        return 'video/webm';
    }
    if (startsWithBytes(head, ascii('OggS'))) {
        return 'audio/ogg';
    }
    if (startsWithBytes(head, ascii('fLaC'))) {
        return 'audio/flac';
    }
    if (startsWithBytes(head, ascii('ID3')) || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
        return 'audio/mpeg';
    }
    return null;
}

const HASH_NAMED_ASSET = /^assets\/[0-9a-f]{64}\.[0-9A-Za-z]*$/;

// A content-hash name never changes what it names, so only such a key is
// cached without revalidation.
function cacheControlForKey(key) {
    return HASH_NAMED_ASSET.test(key) ? 'private, max-age=31536000, immutable' : 'private, no-cache';
}

module.exports = {
    ASSET_READ_AUDIENCE,
    assetKeyFromHex,
    isRouteServedKey,
    contentTypeForKey,
    sniffContentType,
    cacheControlForKey,
};
