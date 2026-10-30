// The destination policy and the outbound header rules of the server's proxy
// routes. Pure apart from the DNS lookup `createCheckedLookup` wraps.
//
// A destination is loopback (always allowed), private (allowed only when the
// operator turns the private-network toggle on) or public (allowed on the
// /proxy routes, refused for stream jobs). The same rule decides a literal
// address in a URL and every address a name resolves to, so a name cannot lead
// to an address the literal form would have been refused.
const net = require('net');
const dns = require('dns');
const http = require('http');

function ipv4Bytes(text) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!match) {
        return null;
    }
    const bytes = match.slice(1).map(Number);
    return bytes.every((byte) => byte <= 255) ? bytes : null;
}

// 16 bytes of an IPv6 text (a dotted IPv4 tail included), or null.
function ipv6Bytes(text) {
    const bare = text.split('%')[0];
    if (!net.isIPv6(bare)) {
        return null;
    }
    let groupsText = bare;
    if (bare.includes('.')) {
        const lastColon = bare.lastIndexOf(':');
        const tail = ipv4Bytes(bare.slice(lastColon + 1));
        if (tail === null) {
            return null;
        }
        groupsText = bare.slice(0, lastColon + 1) + ((tail[0] << 8) | tail[1]).toString(16) + ':' + ((tail[2] << 8) | tail[3]).toString(16);
    }
    const halves = groupsText.split('::');
    if (halves.length > 2) {
        return null;
    }
    const head = halves[0] === '' ? [] : halves[0].split(':');
    const rest = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
    const missing = 8 - head.length - rest.length;
    if (missing < 0 || (halves.length === 1 && missing !== 0)) {
        return null;
    }
    const groups = [...head, ...new Array(missing).fill('0'), ...rest];
    const bytes = [];
    for (const group of groups) {
        const value = Number.parseInt(group, 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
            return null;
        }
        bytes.push(value >> 8, value & 0xff);
    }
    return bytes.length === 16 ? bytes : null;
}

function classifyIPv4(bytes) {
    const [a, b, c, d] = bytes;
    // Exactly 0.0.0.0 is how clients name "this machine".
    if (a === 0 && b === 0 && c === 0 && d === 0) {
        return 'loopback';
    }
    if (a === 127) {
        return 'loopback';
    }
    if (a === 0 || a === 10) {
        return 'private';
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return 'private';
    }
    if (a === 192 && b === 168) {
        return 'private';
    }
    if (a === 169 && b === 254) {
        return 'private';
    }
    // 100.64.0.0/10: carrier-grade NAT, which VPN overlays such as Tailscale use.
    if (a === 100 && b >= 64 && b <= 127) {
        return 'private';
    }
    // Multicast, reserved and the broadcast address.
    if (a >= 224) {
        return 'private';
    }
    return 'public';
}

function classifyIPv6(bytes) {
    const zeroUntil = (end) => bytes.slice(0, end).every((byte) => byte === 0);
    if (zeroUntil(16)) {
        return 'loopback';
    }
    if (zeroUntil(15) && bytes[15] === 1) {
        return 'loopback';
    }
    const embedded = (start) => classifyIPv4(bytes.slice(start, start + 4));
    // ::ffff:0:0/96 (IPv4-mapped).
    if (zeroUntil(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
        return embedded(12);
    }
    // 64:ff9b::/96 (NAT64) and the local-use 64:ff9b:1::/48.
    if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
        if (bytes.slice(4, 12).every((byte) => byte === 0)) {
            return embedded(12);
        }
        if (bytes[4] === 0 && bytes[5] === 1) {
            return 'private';
        }
    }
    // 2002::/16 (6to4): the IPv4 address sits in bytes 2 to 5.
    if (bytes[0] === 0x20 && bytes[1] === 0x02) {
        return embedded(2);
    }
    // 2001::/32 (Teredo).
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) {
        return 'private';
    }
    // ::/96 other than :: and ::1 (IPv4-compatible).
    if (zeroUntil(12)) {
        return embedded(12);
    }
    // fc00::/7 (unique local), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast).
    if ((bytes[0] & 0xfe) === 0xfc || bytes[0] === 0xff) {
        return 'private';
    }
    if (bytes[0] === 0xfe && (bytes[1] & 0x80) === 0x80) {
        return 'private';
    }
    return 'public';
}

// 'loopback', 'private' or 'public' for an address text (brackets and a zone id
// are tolerated). Anything that does not parse is private: it fails closed.
function classifyAddress(text) {
    let host = String(text).trim();
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }
    const v4 = ipv4Bytes(host);
    if (v4 !== null) {
        return classifyIPv4(v4);
    }
    const v6 = ipv6Bytes(host);
    if (v6 !== null) {
        return classifyIPv6(v6);
    }
    return 'private';
}

function isKindAllowed(kind, policy) {
    return kind === 'loopback' || (kind === 'private' && policy.allowPrivate === true) || (kind === 'public' && policy.allowPublic === true);
}

// The kind of a URL hostname that is an address literal, or null for a name
// (a name is judged on the addresses it resolves to).
function literalHostKind(hostname) {
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return net.isIP(bare.split('%')[0]) === 0 ? null : classifyAddress(bare);
}

class ProxyPolicyError extends Error {
    constructor(code, status, message, details = {}) {
        super(message);
        this.name = 'ProxyPolicyError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function blockedError(kind) {
    return new ProxyPolicyError('PROXY_DESTINATION_BLOCKED', 403, 'Proxy destination is not allowed', { kind });
}

// A `lookup` for http.request that refuses a name when any address it resolves
// to is not allowed, and otherwise hands the connection exactly the addresses
// that were checked. It reads `dns.lookup` at call time, through the module.
function createCheckedLookup(policy) {
    return function checkedLookup(hostname, options, callback) {
        let lookupOptions = options;
        let done = callback;
        if (typeof options === 'function') {
            done = options;
            lookupOptions = {};
        }
        if (typeof lookupOptions === 'number') {
            lookupOptions = { family: lookupOptions };
        }
        dns.lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
            if (error) {
                done(error);
                return;
            }
            for (const entry of addresses) {
                const kind = classifyAddress(entry.address);
                if (!isKindAllowed(kind, policy)) {
                    done(blockedError(kind));
                    return;
                }
            }
            if (lookupOptions.all) {
                done(null, addresses);
            } else {
                done(null, addresses[0].address, addresses[0].family);
            }
        });
    };
}

class InvalidHeaderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidHeaderError';
    }
}

// Framing and hop-by-hop headers, and the credentials of the proxy itself.
const DROPPED_OUTBOUND_HEADERS = new Set([
    'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'proxy-connection',
    'te', 'trailer', 'upgrade', 'expect', 'proxy-authorization',
]);

// The one place an outbound header set is built. `input` is the client's header
// map or the browser's own request headers (`fromBrowser`, which also drops the
// cookie). Names are lower-cased; values must be strings, finite numbers or
// booleans without line breaks, else InvalidHeaderError. Names that differ only
// in case are joined with ", ". The framing headers and every risu-* name are
// dropped; the transport sets Host and Content-Length. With `fetchDefaults`
// the headers fetch adds on its own are added when absent (the /proxy routes
// keep them; stream jobs never did and add none).
function sanitizeOutboundHeaders(input, { fromBrowser = false, fetchDefaults = false, hasBody = false } = {}) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new InvalidHeaderError('Header map must be an object');
    }
    const out = {};
    for (const [rawName, rawValue] of Object.entries(input)) {
        const name = rawName.toLowerCase();
        try {
            http.validateHeaderName(name);
        } catch {
            throw new InvalidHeaderError('Invalid header name');
        }
        let value;
        if (typeof rawValue === 'string') {
            value = rawValue;
        } else if ((typeof rawValue === 'number' && Number.isFinite(rawValue)) || typeof rawValue === 'boolean') {
            value = String(rawValue);
        } else {
            throw new InvalidHeaderError('Invalid header value');
        }
        try {
            http.validateHeaderValue(name, value);
        } catch {
            throw new InvalidHeaderError('Invalid header value');
        }
        if (DROPPED_OUTBOUND_HEADERS.has(name) || name.startsWith('risu-') || (fromBrowser && name === 'cookie')) {
            continue;
        }
        out[name] = Object.hasOwn(out, name) ? `${out[name]}, ${value}` : value;
    }
    if (fetchDefaults) {
        const setDefault = (name, value) => {
            if (!Object.hasOwn(out, name)) {
                out[name] = value;
            }
        };
        // A ranged request asks for the identity encoding, as fetch does.
        if (Object.hasOwn(out, 'range')) {
            out['accept-encoding'] = Object.hasOwn(out, 'accept-encoding') ? `${out['accept-encoding']}, identity` : 'identity';
        }
        setDefault('user-agent', 'node');
        setDefault('accept', '*/*');
        setDefault('accept-language', '*');
        setDefault('sec-fetch-mode', 'cors');
        if (hasBody) {
            setDefault('content-type', 'text/plain;charset=UTF-8');
        }
        setDefault('accept-encoding', 'gzip, deflate');
    }
    return out;
}

module.exports = {
    classifyAddress,
    isKindAllowed,
    literalHostKind,
    createCheckedLookup,
    blockedError,
    ProxyPolicyError,
    InvalidHeaderError,
    sanitizeOutboundHeaders,
};
