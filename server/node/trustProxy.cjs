// Reads the TRUST_PROXY environment variable into the value for Express's
// `trust proxy` setting. Express rejects the string 'true' (it reads it as an
// IP address) and reads any other string as an address list, so the boolean
// words and plain hop counts become real booleans and numbers. Anything else
// (an IP, a subnet, a list, 'loopback') is passed through trimmed for Express
// to validate. Returns undefined when the variable is unset or blank.
function parseTrustProxy(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        return undefined;
    }
    const lower = trimmed.toLowerCase();
    if (lower === 'true') {
        return true;
    }
    if (lower === 'false') {
        return false;
    }
    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }
    return trimmed;
}

module.exports = { parseTrustProxy };
