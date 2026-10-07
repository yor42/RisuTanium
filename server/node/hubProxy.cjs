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

module.exports = { hubTargetURL, hubRedirectTarget };
