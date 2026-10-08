// Pure target rules of the Realm hub proxy (`/hub-proxy/*`) in server.cjs.
// The route is not behind the proxy password, so the server must never fetch
// an address a peer chose: every request, and every redirect it follows, stays
// on the origin of the configured hub URL.

// The URL to fetch for a request to `/hub-proxy/<rest>`: the hub URL plus the
// request path and query. No header, and nothing else on the request, takes
// part. Throws when the result would leave the hub origin, which a path
// starting with `@` or a backslash could otherwise cause.
function hubTargetURL(hubURL, req) {
    const hubOrigin = new URL(hubURL).origin;
    const pathAndQuery = String(req.originalUrl).replace(/^\/hub-proxy/, '');
    const target = hubURL + pathAndQuery;
    if (new URL(target).origin !== hubOrigin) {
        throw new Error('Hub proxy target is outside the hub origin');
    }
    return target;
}

// The absolute URL a hub redirect may be followed to, or null when the
// `Location` value is missing or points to another origin. Relative values
// resolve against the URL that was requested.
function hubRedirectTarget(hubURL, requestedURL, location) {
    if (typeof location !== 'string' || location === '') {
        return null;
    }
    let resolved;
    try {
        resolved = new URL(location, requestedURL);
    } catch {
        return null;
    }
    return resolved.origin === new URL(hubURL).origin ? resolved.href : null;
}

// The request headers the Realm calls need. The route is open to any peer that
// can reach the server, so credentials the browser holds for the server's own
// origin (`risu-auth`, cookies, `authorization`) and everything else stay out.
const HUB_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent', 'x-risuai-info'];

// The headers to send to the hub for a request carrying `headers`: the allowed
// ones, matched case-insensitively and written lowercase, plus the hub origin.
function hubRequestHeaders(headers, hubOrigin) {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        const key = name.toLowerCase();
        if (!HUB_REQUEST_HEADERS.includes(key) || value === undefined) {
            continue;
        }
        out[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    out.origin = hubOrigin;
    return out;
}

// Response headers that are never copied to the client: the body is already
// decoded and re-framed, and a hub cookie must not be stored on the server's
// own origin.
const HUB_RESPONSE_HEADERS_DROPPED = ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'];

// The [name, value] pairs of a hub response to copy to the client.
function hubResponseHeaders(entries) {
    const out = [];
    for (const [name, value] of entries) {
        if (!HUB_RESPONSE_HEADERS_DROPPED.includes(name.toLowerCase())) {
            out.push([name, value]);
        }
    }
    return out;
}

// The request body to forward: the raw bytes the client sent, or undefined for
// GET, HEAD and a request without a body. Anything that is not a non-empty
// Buffer (the `{}` Express leaves for a bodyless request) is not a body.
function hubForwardBody(method, body) {
    if (method === 'GET' || method === 'HEAD') {
        return undefined;
    }
    return Buffer.isBuffer(body) && body.length > 0 ? body : undefined;
}
module.exports = { hubTargetURL, hubRedirectTarget, hubRequestHeaders, hubResponseHeaders, hubForwardBody };
