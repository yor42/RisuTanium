// Startup check for CVE-2026-111497 (Brotli decoder out-of-bounds write behind
// node:zlib). Minimal copy of server/node/nodeVersionCheck.cjs: the Hono
// package builds and deploys on its own and cannot import the CommonJS helper.
// MUST be updated with future Node security releases, and kept equal to the
// original (a test compares the two tables and messages).
type Triple = [number, number, number]

const CVE_ID = 'CVE-2026-111497'
export const LATEST_FIXED_MAJOR = 26
export const FIXED_VERSIONS: Record<number, Triple> = {
    22: [22, 23, 4],
    24: [24, 22, 1],
    26: [26, 12, 1],
}

function parseNodeVersion(version: unknown): Triple | null {
    if (typeof version !== 'string') {
        return null
    }
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
    if (!match) {
        return null
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isBelow(parsed: Triple, fixed: Triple): boolean {
    for (let i = 0; i < 3; i++) {
        if (parsed[i] !== fixed[i]) {
            return parsed[i] < fixed[i]
        }
    }
    return false
}

// Returns a warning message when the given Node version is affected or cannot
// be recognized, and null when it is safe.
export function nodeVersionWarning(version: unknown): string | null {
    const parsed = parseNodeVersion(version)
    if (!parsed) {
        return `${CVE_ID} (Brotli decoder, High severity): the Node.js version "${String(version)}" could not be recognized, so it may be affected. Update Node.js to 22.23.4, 24.22.1, 26.12.1 or newer.`
    }
    const major = parsed[0]
    if (major > LATEST_FIXED_MAJOR) {
        return null
    }
    const fixed = FIXED_VERSIONS[major]
    if (!fixed) {
        return `${CVE_ID} (Brotli decoder, High severity): Node.js ${parsed.join('.')} is on a release line that has no fix or is end-of-life. Update Node.js to 22.23.4, 24.22.1, 26.12.1 or newer.`
    }
    if (isBelow(parsed, fixed)) {
        return `${CVE_ID} (Brotli decoder, High severity): Node.js ${parsed.join('.')} is affected. Update Node.js to ${fixed.join('.')} or newer.`
    }
    return null
}
