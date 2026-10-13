// The key scope of the guarded retire operation. Retiring forgets a key's
// revision entry, so it is only ever allowed for keys under this prefix, whose
// names the client never writes twice. The client holds the same prefix in
// `src/ts/storage/store/keyRules.ts` (`ALITE_PREFIX`); a table test runs both.
const ALITE_PREFIX = 'alite/';

const HEX_PATTERN = /^[0-9a-f]+$/;

// The stored key a hex file name stands for when it is under the prefix, or
// null. The hex is case-insensitive and must decode to UTF-8 that encodes back
// to the same hex, so no two names reach one file through a lossy decode. The
// bare prefix is not a key.
function aliteKeyFromHex(hex) {
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
    if (!key.startsWith(ALITE_PREFIX) || key.length === ALITE_PREFIX.length) {
        return null;
    }
    return key;
}

module.exports = { ALITE_PREFIX, aliteKeyFromHex };
