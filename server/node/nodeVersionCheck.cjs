// Startup check for CVE-2026-111497: an out-of-bounds write in the Brotli
// decoder behind node:zlib. The server fetches user-supplied URLs and undici
// decodes `Content-Encoding: br` through that decoder, so a hostile remote
// server can reach it. The server only warns; it never refuses to start.
//
// MUST be updated with future Node security releases. The Hono Node entry keeps
// a copy of this table in server/hono/src/nodeVersionCheck.ts; keep both equal.
const CVE_ID = 'CVE-2026-111497';
const LATEST_FIXED_MAJOR = 26;
// Lowest fixed version of each fixed release line: [major, minor, patch].
const FIXED_VERSIONS = {
    22: [22, 23, 4],
    24: [24, 22, 1],
    26: [26, 12, 1],
};

function parseNodeVersion(version) {
    if (typeof version !== 'string') {
        return null;
    }
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
    if (!match) {
        return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isBelow(parsed, fixed) {
    for (let i = 0; i < 3; i++) {
        if (parsed[i] !== fixed[i]) {
            return parsed[i] < fixed[i];
        }
    }
    return false;
}

// Returns a warning message when the given Node version is affected or cannot
// be recognized, and null when it is safe.
function nodeVersionWarning(version) {
    const parsed = parseNodeVersion(version);
    if (!parsed) {
        return `${CVE_ID} (Brotli decoder, High severity): the Node.js version "${String(version)}" could not be recognized, so it may be affected. Update Node.js to 22.23.4, 24.22.1, 26.12.1 or newer.`;
    }
    const major = parsed[0];
    if (major > LATEST_FIXED_MAJOR) {
        return null;
    }
    const fixed = FIXED_VERSIONS[major];
    if (!fixed) {
        return `${CVE_ID} (Brotli decoder, High severity): Node.js ${parsed.join('.')} is on a release line that has no fix or is end-of-life. Update Node.js to 22.23.4, 24.22.1, 26.12.1 or newer.`;
    }
    if (isBelow(parsed, fixed)) {
        return `${CVE_ID} (Brotli decoder, High severity): Node.js ${parsed.join('.')} is affected. Update Node.js to ${fixed.join('.')} or newer.`;
    }
    return null;
}

module.exports = { nodeVersionWarning, FIXED_VERSIONS, LATEST_FIXED_MAJOR };
