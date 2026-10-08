const express = require('express');
const app = express();
const { parseTrustProxy } = require('./trustProxy.cjs');
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
}
const http = require('http');
const path = require('path');
const net = require('net');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } = require('fs');
const fs = require('fs/promises')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { NODE_BODY_LIMIT_BYTES } = require('./bodyLimit.cjs');
const { hubTargetURL, hubRedirectTarget, hubRequestHeaders, hubResponseHeaders, hubForwardBody } = require('./hubProxy.cjs');
const { ASSET_READ_AUDIENCE, assetKeyFromHex, contentTypeForKey, sniffContentType, cacheControlForKey } = require('./assetRoute.cjs');
app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
// The hub proxy forwards the request body as the client sent it, so it is
// captured as raw bytes before any parser can replace it with a parsed value.
app.use('/hub-proxy', express.raw({ type: () => true, limit: NODE_BODY_LIMIT_BYTES }));
app.use(express.json({ limit: NODE_BODY_LIMIT_BYTES }));
app.use(express.raw({ type: 'application/octet-stream', limit: NODE_BODY_LIMIT_BYTES }));
app.use(express.text({ limit: NODE_BODY_LIMIT_BYTES }));
const {pipeline} = require('stream/promises')
const https = require('https');
const sslPath = path.join(process.cwd(), 'server/node/ssl/certificate');
const hubURL = 'https://sv.risuai.xyz'; 

let password = ''
let knownPublicKeysHashes = []

const savePath = path.join(process.cwd(), "save")
if(!existsSync(savePath)){
    mkdirSync(savePath)
}

const passwordPath = path.join(process.cwd(), 'save', '__password')
if(existsSync(passwordPath)){
    password = readFileSync(passwordPath, 'utf-8')
}

const knownPublicKeysPath = path.join(process.cwd(), 'save', '__known_public_key_hashes.json')
if(existsSync(knownPublicKeysPath)){
    const knownPublicKeysRaw = readFileSync(knownPublicKeysPath, 'utf-8');
    knownPublicKeysHashes = JSON.parse(knownPublicKeysRaw);
}

// Per-file revision counters backing /api/write's optimistic-concurrency
// check. The recovered value of a key is the maximum over the snapshot
// (__revisions.json) and every valid record of the append log
// (__revisions.log, one JSON record `{"k":<key>,"r":<revision>}` per bump,
// each preceded by a newline so a torn tail can never merge into the next
// record). A record is valid only when it parses and has own properties `k`
// (a string) and `r` (a non-negative safe integer); anything else is skipped
// and never lowers a revision. Replay is idempotent under max, so a process
// crash at any point of a compaction recovers every revision that was ever
// exposed to a client.
//
// The in-memory map is a null-prototype object: a key such as `__proto__` or
// `constructor` is data, never a property lookup through the prototype.
// Single-process-only: one Node process owns `savePath`, same assumption the
// rest of this file makes.
const revisionsPath = path.join(process.cwd(), 'save', '__revisions.json')
const revisionsLogPath = path.join(process.cwd(), 'save', '__revisions.log')
const revisions = Object.create(null)

// The log is compacted (a full snapshot written, the log deleted) at startup
// and again once it holds this many records. The default can be overridden by
// the environment for tests.
const REVISION_LOG_COMPACT_DEFAULT = 20000
const revisionLogCompactAt = (() => {
    const configured = Number(process.env.RISU_REVISION_LOG_COMPACT_AT)
    return Number.isSafeInteger(configured) && configured > 0 ? configured : REVISION_LOG_COMPACT_DEFAULT
})()
// Records currently in the log, the count at which the next compaction is
// attempted (pushed out by one threshold after a failed attempt, so a failing
// compaction is not retried on every write), and whether a runtime compaction
// is already queued.
let revisionLogRecords = 0
let revisionCompactionDueAt = revisionLogCompactAt
let revisionCompactionQueued = false

function isValidRevisionValue(value){
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function raiseRevision(key, revision){
    if(revision > (revisions[key] ?? 0)){
        revisions[key] = revision
    }
}

// Returns the record's { k, r } when `line` is a valid revision record, else null.
function parseRevisionRecord(line){
    let record
    try {
        record = JSON.parse(line)
    } catch (error) {
        return null
    }
    if(typeof record !== 'object' || record === null || !Object.hasOwn(record, 'k') || !Object.hasOwn(record, 'r')){
        return null
    }
    if(typeof record.k !== 'string' || !isValidRevisionValue(record.r)){
        return null
    }
    return record
}

function revisionSnapshotTempPath(){
    return path.join(process.cwd(), 'save', `__revisions.json.tmp-${crypto.randomBytes(8).toString('hex')}`)
}

// Startup path (synchronous fs): the new snapshot is renamed into place, after
// being flushed to disk, before the log it absorbs is deleted.
function compactRevisionsSync(){
    const tempPath = revisionSnapshotTempPath()
    try {
        const fd = openSync(tempPath, 'w')
        try {
            writeFileSync(fd, JSON.stringify(revisions))
            fsyncSync(fd)
        } finally {
            closeSync(fd)
        }
        renameSync(tempPath, revisionsPath)
    } catch (error) {
        try { unlinkSync(tempPath) } catch (unlinkError) {}
        throw error
    }
    try {
        unlinkSync(revisionsLogPath)
    } catch (error) {
        if(error?.code !== 'ENOENT'){
            throw error
        }
    }
}

if(existsSync(revisionsPath)){
    try {
        const parsed = JSON.parse(readFileSync(revisionsPath, 'utf-8'))
        if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)){
            throw new Error('not a revision object')
        }
        for(const key of Object.keys(parsed)){
            if(isValidRevisionValue(parsed[key])){
                raiseRevision(key, parsed[key])
            }
        }
    } catch (error) {
        console.error('Failed to parse __revisions.json, starting with an empty revision store:', error);
    }
}
if(existsSync(revisionsLogPath)){
    // An existing log that cannot be read stops startup: running on the
    // snapshot alone would serve revisions lower than ones already exposed to
    // clients. The log is left untouched. It is read as bytes and split on
    // newline bytes, so its size cannot hit the string-length limit.
    let logBytes
    try {
        logBytes = readFileSync(revisionsLogPath)
    } catch (error) {
        console.error(`Cannot read ${revisionsLogPath}; refusing to start with lower revisions (${error?.code ?? 'unknown'}):`, error);
        process.exit(1)
    }
    let lineStart = 0
    while(lineStart <= logBytes.length){
        let lineEnd = logBytes.indexOf(10, lineStart)
        if(lineEnd === -1){
            lineEnd = logBytes.length
        }
        if(lineEnd > lineStart){
            const record = parseRevisionRecord(logBytes.toString('utf-8', lineStart, lineEnd))
            if(record !== null){
                raiseRevision(record.k, record.r)
                revisionLogRecords++
            }
        }
        lineStart = lineEnd + 1
    }
    try {
        compactRevisionsSync()
        revisionLogRecords = 0
    } catch (error) {
        revisionCompactionDueAt = revisionLogRecords + revisionLogCompactAt
        console.error('Failed to compact the revision log at startup, continuing from memory:', error);
    }
}

// Appends one record per key in `keys` (their current in-memory revisions) to
// the revision log. Does NOT queue itself — callers must already be inside
// withRevisionTransaction() below, because compaction snapshots the whole map
// and then deletes the log: no bump, append or rollback may overlap it. A
// multi-key append is not atomic; after a failure some of its records may be
// durable, so a persisted revision can be higher than memory (which can only
// cause a later 409, never a lower revision). Cost is independent of the
// number of keys.
async function appendRevisionRecords(keys){
    const data = keys.map((key) => '\n' + JSON.stringify({ k: key, r: revisions[key] })).join('')
    await fs.appendFile(revisionsLogPath, data)
    revisionLogRecords += keys.length
}

// Runtime compaction, run as its own queued transaction so no bump or append
// overlaps it. Never throws and never affects a request whose append
// succeeded: on failure the log stays intact (the snapshot and the log
// together still hold every revision) and the next attempt waits for another full threshold of records.
async function compactRevisions(){
    revisionCompactionQueued = false
    if(revisionLogRecords < revisionCompactionDueAt){
        return
    }
    const tempPath = revisionSnapshotTempPath()
    try {
        try {
            const handle = await fs.open(tempPath, 'w')
            try {
                await handle.writeFile(JSON.stringify(revisions))
                await handle.sync()
            } finally {
                await handle.close()
            }
            await fs.rename(tempPath, revisionsPath)
        } catch (error) {
            await fs.unlink(tempPath).catch(() => {})
            throw error
        }
        await fs.rm(revisionsLogPath, { force: true })
        revisionLogRecords = 0
        revisionCompactionDueAt = revisionLogCompactAt
    } catch (error) {
        revisionCompactionDueAt = revisionLogRecords + revisionLogCompactAt
        console.error('Failed to compact the revision log, continuing from memory:', error);
    }
}

// Called after a request's append succeeded, outside that request's rollback
// path.
function scheduleRevisionCompaction(){
    if(revisionCompactionQueued || revisionLogRecords < revisionCompactionDueAt){
        return
    }
    revisionCompactionQueued = true
    withRevisionTransaction(compactRevisions).catch(() => {})
}

// Every read-current-revision → validate-precondition → mutate-in-memory →
// append-to-log(-or-roll-back) sequence, for ANY key, goes through this
// single global queue — not just the final disk write. Compaction runs in the
// same queue: it snapshots the whole map and then deletes the log, so a bump
// appended between those two steps would be deleted with the log without being
// in the snapshot. This is intentionally a separate, coarser-grained lock
// than the per-key `fileWriteQueues` below
// (which still lets unrelated keys' actual file I/O run concurrently) —
// only the comparatively cheap revision bookkeeping itself is globally
// serialized, not full-batches's content writes/removals.
let revisionTransactionQueue = Promise.resolve();
function withRevisionTransaction(fn){
    const result = revisionTransactionQueue.then(fn, fn);
    revisionTransactionQueue = result.then(() => undefined, () => undefined);
    return result;
}

// Per-key critical section for /api/write: a plain sequential "read current
// revision, compare, write, bump revision" is NOT safe on its own — two
// concurrent requests for the same key could each read the same revision,
// each pass the comparison, and both proceed to write, since the read and
// the write aren't one atomic operation just because they're sequential
// `await`s in the same async function (Node's event loop yields control
// between them). Queuing each key's whole check-and-write sequence behind
// the previous one for that same key is what actually closes that race.
const fileWriteQueues = new Map();
function withFileWriteLock(key, fn){
    const previous = fileWriteQueues.get(key) || Promise.resolve();
    const result = previous.then(fn, fn);
    // Store a queue tail that always resolves (never rejects), so one
    // request's failure doesn't permanently wedge later requests for the
    // same key behind a rejected promise.
    const settled = result.then(() => undefined, () => undefined);
    fileWriteQueues.set(key, settled);
    // Reclaim the entry once this tail drains — otherwise every distinct key
    // ever written/deleted permanently occupies a Map slot for the life of
    // the process. Guarded by identity: only remove it if nothing newer has
    // queued behind this one in the meantime (i.e. this is still the current
    // tail for `key`), so a fast-arriving next request's own tail is never
    // wrongly deleted out from under it.
    settled.then(() => {
        if(fileWriteQueues.get(key) === settled){
            fileWriteQueues.delete(key);
        }
    });
    return result;
}

// Acquires per-key locks for MULTIPLE keys at once (batch delete), nested in
// a fixed order — every distinct key in `keys`, deduplicated and sorted —
// rather than acquired in whatever order the caller happened to list them.
// This is what makes it safe: two concurrent multi-key requests that share
// some keys but list them in different orders can never deadlock waiting on
// each other, because both always acquire in the same (sorted) order.
// `fn` runs only once every lock in the batch is held, so it can validate
// every key's precondition and then commit every key's mutation as one
// effectively-atomic unit from the perspective of any other request — no
// other request touching any of these keys can observe a partially-applied
// state, since none of their locks release until `fn` (and therefore the
// whole batch) is done.
async function withFileWriteLocks(keys, fn){
    const sortedKeys = [...new Set(keys)].sort();
    async function acquireNext(index){
        if(index >= sortedKeys.length){
            return await fn();
        }
        return await withFileWriteLock(sortedKeys[index], () => acquireNext(index + 1));
    }
    return await acquireNext(0);
}

const hexRegex = /^[0-9a-fA-F]+$/;
const PROXY_STREAM_DEFAULT_TIMEOUT_MS = 600000;
const PROXY_STREAM_MAX_TIMEOUT_MS = 3600000;
const PROXY_STREAM_DEFAULT_HEARTBEAT_SEC = 15;
const PROXY_STREAM_HEARTBEAT_MIN_SEC = 5;
const PROXY_STREAM_HEARTBEAT_MAX_SEC = 60;
const PROXY_STREAM_GC_INTERVAL_MS = 60000;
const PROXY_STREAM_DONE_GRACE_MS = 30000;
const PROXY_STREAM_MAX_ACTIVE_JOBS = 64;
const PROXY_STREAM_MAX_PENDING_EVENTS = 512;
const PROXY_STREAM_MAX_PENDING_BYTES = 2 * 1024 * 1024;
const PROXY_STREAM_MAX_BODY_BASE64_BYTES = 8 * 1024 * 1024;
const proxyStreamJobs = new Map();
const authenticatedRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
// The storage routes carry the app's own save traffic (a full load reads
// hundreds of blocks), so they draw on a bucket apart from the proxy's.
const storageRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
// A page loads many assets at once and a media element issues one request per
// range, so the asset route draws on a bucket apart from the storage routes'.
const assetRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const authRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const loginRouteLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again later.' }
});
function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
}

async function hashJSON(json){
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(json));
    return hash.digest('hex');
}

function isAuthorizedRequest(req) {
    const authHeader = normalizeAuthHeader(req.headers['risu-auth']);
    return !!authHeader && authHeader.trim() === password.trim();
}

function normalizeAuthHeader(authHeader) {
    if (Array.isArray(authHeader)) {
        return authHeader[0] || '';
    }
    return typeof authHeader === 'string' ? authHeader : '';
}

// The one parse-and-verify of a `risu-auth` token, shared by every route that
// takes one. Answers `{ ok: true }`, or `{ ok: false, status, error, log }` with
// the refusal the HTTP routes send.
//
// Without `audience` the token is an ordinary storage token: it carries no
// `aud` claim and a numeric `exp` that has not passed, so a token that never
// expires, or one minted for another purpose, opens none of the storage, proxy
// or websocket routes. With `audience` the token must carry exactly that `aud`;
// its `exp` may be absent, but a present one must be numeric and not passed.
async function verifyJwt(authHeader, audience) {
    try {
        const [
            jsonHeaderB64,
            jsonPayloadB64,
            signatureB64,
        ] = authHeader.split('.');

        //alg, typ
        const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));

        //iat, exp, pub, aud
        const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));

        //signature
        const signature = Buffer.from(signatureB64, 'base64url');

        const hasAudience = Object.prototype.hasOwnProperty.call(jsonPayload, 'aud');
        const hasExpiry = Object.prototype.hasOwnProperty.call(jsonPayload, 'exp');
        const refuseToken = { ok: false, status: 400, error: 'Invalid Token', log: 'Invalid token' };

        if (audience === undefined ? hasAudience : jsonPayload.aud !== audience) {
            return refuseToken;
        }
        if (hasExpiry || audience === undefined) {
            if (typeof jsonPayload.exp !== 'number' || !Number.isFinite(jsonPayload.exp)) {
                return refuseToken;
            }
            const now = Math.floor(Date.now() / 1000);
            if (jsonPayload.exp < now) {
                return { ok: false, status: 400, error: 'Token Expired', log: 'Token expired' };
            }
        }

        //check if public key is known
        const pubKeyHash = await hashJSON(jsonPayload.pub);
        if (!knownPublicKeysHashes.includes(pubKeyHash)) {
            return { ok: false, status: 400, error: 'Unknown Public Key', log: 'Unknown public key' };
        }

        //only support ECDSA for now
        if (jsonHeader.alg !== 'ES256') {
            return { ok: false, status: 400, error: 'Unsupported Algorithm', log: 'Unsupported algorithm' };
        }

        const isValid = await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' },
            },
            await crypto.subtle.importKey(
                'jwk',
                jsonPayload.pub,
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256',
                },
                false,
                ['verify']
            ),
            signature,
            Buffer.from(`${jsonHeaderB64}.${jsonPayloadB64}`)
        );

        if (!isValid) {
            return { ok: false, status: 400, error: 'Invalid Signature', log: 'Invalid signature' };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, status: 500, error: 'Internal Server Error', log: error };
    }
}

async function isAuthorizedJwtHeader(authHeader) {
    const normalized = normalizeAuthHeader(authHeader);
    if (!normalized) {
        return false;
    }
    return (await verifyJwt(normalized)).ok;
}

async function isAuthorizedProxyRequest(req) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await isAuthorizedJwtHeader(req.headers['risu-auth']);
}

async function checkProxyAuth(req, res) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await checkAuth(req, res);
}

// Only RISU_*_KEY / RISU_*_TOKEN or operator-listed names are readable.
const ENV_NAME_SYNTAX = /^[A-Z_][A-Z0-9_]*$/;
const RISU_ENV_NAME = /^RISU_[A-Z0-9_]*_(KEY|TOKEN)$/;
function isResolvableEnvName(name) {
    if (!ENV_NAME_SYNTAX.test(name)) return false;
    if (RISU_ENV_NAME.test(name)) return true;
    const allowed = (process.env.RISU_ALLOWED_ENV || '').split(',').map((s) => s.trim()).filter(Boolean);
    return allowed.includes(name);
}

function getRequestTimeoutMs(timeoutHeader) {
    const raw = Array.isArray(timeoutHeader) ? timeoutHeader[0] : timeoutHeader;
    if (!raw) {
        return null;
    }
    const timeoutMs = Number.parseInt(raw, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return null;
    }
    return timeoutMs;
}

function createTimeoutController(timeoutMs) {
    if (!timeoutMs) {
        return {
            signal: undefined,
            cleanup: () => {}
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timer)
    };
}

function normalizeProxyStreamTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return PROXY_STREAM_DEFAULT_TIMEOUT_MS;
    }
    const parsed = Math.max(1, Math.floor(timeoutMs));
    return Math.min(PROXY_STREAM_MAX_TIMEOUT_MS, parsed);
}

function normalizeHeartbeatSec(heartbeatSec) {
    if (!Number.isFinite(heartbeatSec)) {
        return PROXY_STREAM_DEFAULT_HEARTBEAT_SEC;
    }
    const parsed = Math.floor(heartbeatSec);
    return Math.min(PROXY_STREAM_HEARTBEAT_MAX_SEC, Math.max(PROXY_STREAM_HEARTBEAT_MIN_SEC, parsed));
}

function isPrivateIPv4Host(hostname) {
    const parts = hostname.split('.');
    if (parts.length !== 4) {
        return false;
    }
    const octets = parts.map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return false;
    }
    const [a, b] = octets;
    if (a === 10) {
        return true;
    }
    if (a === 127) {
        return true;
    }
    if (a === 0) {
        return true;
    }
    if (a === 192 && b === 168) {
        return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true;
    }
    if (a === 169 && b === 254) {
        return true;
    }
    return false;
}

function isLocalNetworkHost(hostname) {
    if (typeof hostname !== 'string' || hostname.trim() === '') {
        return false;
    }

    const normalizedHost = hostname.toLowerCase().replace(/\.$/, '').split('%')[0];
    if (normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.endsWith('.local')) {
        return true;
    }

    if (net.isIP(normalizedHost) === 4) {
        return isPrivateIPv4Host(normalizedHost);
    }

    if (net.isIP(normalizedHost) === 6) {
        if (normalizedHost.startsWith('::ffff:')) {
            const mapped = normalizedHost.substring(7);
            return net.isIP(mapped) === 4 && isPrivateIPv4Host(mapped);
        }
        if (normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd')) {
            return true;
        }
        if (/^fe[89ab]/.test(normalizedHost)) {
            return true;
        }
        return normalizedHost === '::1';
    }

    return false;
}

function sanitizeTargetUrl(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        if (!isLocalNetworkHost(parsed.hostname)) {
            return null;
        }
        parsed.username = '';
        parsed.password = '';
        return parsed.toString();
    } catch {
        return null;
    } // lgtm[js/request-forgery]
}

function normalizeForwardHeaders(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof key !== 'string') {
            continue;
        }
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }
    delete normalized['risu-auth'];
    delete normalized['risu-timeout-ms'];
    delete normalized['host'];
    delete normalized['connection'];
    delete normalized['content-length'];
    return normalized;
}

function normalizeProxyResponseHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (value === undefined) {
            continue;
        }
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return normalized;
}

function requestLocalTargetStream(targetUrl, arg) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(targetUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const headers = normalizeForwardHeaders(arg.headers);
        if (!headers['host']) {
            headers['host'] = parsedUrl.host;
        }
        if (arg.bodyBuffer && !headers['content-length']) {
            headers['content-length'] = String(arg.bodyBuffer.length);
        }

        let settled = false;
        let cleanupAbort = () => {};
        const finishReject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupAbort();
            reject(error);
        };

        const req = client.request(parsedUrl, {
            method: arg.method,
            headers
        }, (res) => {
            if (settled) {
                res.destroy();
                return;
            }
            settled = true;
            cleanupAbort();
            resolve({
                status: res.statusCode || 502,
                headers: normalizeProxyResponseHeaders(res.headers),
                body: res
            });
        });

        req.on('error', (error) => {
            finishReject(error);
        });

        req.setTimeout(arg.timeoutMs, () => {
            req.destroy(new Error(`Upstream request timed out after ${arg.timeoutMs}ms`));
        });

        if (arg.signal) {
            const onAbort = () => {
                const abortError = new Error('Proxy stream job aborted');
                abortError.name = 'AbortError';
                req.destroy(abortError);
            };
            if (arg.signal.aborted) {
                onAbort();
                return;
            }
            arg.signal.addEventListener('abort', onAbort, { once: true });
            cleanupAbort = () => arg.signal.removeEventListener('abort', onAbort);
        }

        if (arg.bodyBuffer && arg.method !== 'GET' && arg.method !== 'HEAD') {
            req.write(arg.bodyBuffer);
        }
        req.end();
    });
}

function createProxyStreamJob(arg) {
    const jobId = crypto.randomUUID();
    const timeoutMs = normalizeProxyStreamTimeoutMs(Number(arg.timeoutMs));
    const heartbeatSec = normalizeHeartbeatSec(arg.heartbeatSec);
    const controller = new AbortController();
    const createdAt = Date.now();
    const job = {
        id: jobId,
        createdAt,
        updatedAt: createdAt,
        done: false,
        cleanupAt: 0,
        clients: new Set(),
        pendingEvents: [],
        pendingBytes: 0,
        abortController: controller,
        deadlineAt: createdAt + timeoutMs,
        heartbeatSec,
        timeoutMs // lgtm[js/request-forgery]
    };
    proxyStreamJobs.set(jobId, job);
    return job;
}

function pushJobEvent(job, event) {
    job.updatedAt = Date.now();
    const text = JSON.stringify(event);
    if (job.clients.size === 0) {
        job.pendingEvents.push(text);
        job.pendingBytes += Buffer.byteLength(text);
        while (
            job.pendingEvents.length > PROXY_STREAM_MAX_PENDING_EVENTS
            || job.pendingBytes > PROXY_STREAM_MAX_PENDING_BYTES
        ) {
            const removed = job.pendingEvents.shift();
            if (!removed) {
                break;
            }
            job.pendingBytes -= Buffer.byteLength(removed);
        }
        return;
    }
    for (const client of job.clients) {
        if (client.readyState === client.OPEN) {
            client.send(text);
        }
    }
}

function markJobDone(job) {
    if (job.done) {
        return;
    }
    job.done = true;
    job.cleanupAt = Date.now() + PROXY_STREAM_DONE_GRACE_MS;
}

function cleanupJob(jobId) {
    const job = proxyStreamJobs.get(jobId);
    if (!job) {
        return;
    }
    for (const client of job.clients) {
        try {
            client.close();
        } catch {
            // ignore
        }
    }
    proxyStreamJobs.delete(jobId);
}

async function runProxyStreamJob(job, arg) {
    const targetUrl = sanitizeTargetUrl(arg.targetUrl);
    if (!targetUrl) {
        pushJobEvent(job, {
            type: 'error',
            status: 400,
            message: 'Blocked non-local target URL'
        });
        markJobDone(job);
        return;
    }

    const headers = normalizeForwardHeaders(arg.headers);
    if (!headers['x-forwarded-for']) {
        headers['x-forwarded-for'] = arg.clientIp;
    }
    const bodyBuffer = arg.bodyBase64 ? Buffer.from(arg.bodyBase64, 'base64') : undefined;

    try {
        const upstreamResponse = await requestLocalTargetStream(targetUrl, {
            method: arg.method,
            headers,
            bodyBuffer,
            timeoutMs: job.timeoutMs,
            signal: job.abortController.signal
        });

        const filteredHeaders = {};
        for (const [key, value] of Object.entries(upstreamResponse.headers)) {
            if (key === 'content-security-policy' || key === 'content-security-policy-report-only' || key === 'clear-site-data') {
                continue;
            }
            filteredHeaders[key] = value;
        }

        pushJobEvent(job, {
            type: 'upstream_headers',
            status: upstreamResponse.status,
            headers: filteredHeaders
        });

        if (upstreamResponse.body) {
            for await (const value of upstreamResponse.body) {
                if (job.abortController.signal.aborted) {
                    break;
                }
                if (value && value.length > 0) {
                    pushJobEvent(job, {
                        type: 'chunk',
                        dataBase64: Buffer.from(value).toString('base64')
                    });
                }
            }
        }
        pushJobEvent(job, { type: 'done' });
        markJobDone(job);
    } catch (error) {
        const message = error?.name === 'AbortError' ? 'Proxy stream job aborted' : `${error}`;
        pushJobEvent(job, {
            type: 'error',
            status: 504,
            message
        });
        markJobDone(job);
    }
}

async function forwardUpstreamResponse(originalResponse, res) {
    const head = new Headers(originalResponse.headers);
    head.delete('content-security-policy');
    head.delete('content-security-policy-report-only');
    head.delete('clear-site-data');
    head.delete('Cache-Control');
    head.set('Cache-Control', 'no-store');
    head.delete('Content-Encoding');

    const contentType = (head.get('content-type') || '').toLowerCase();
    const isSSE = contentType.includes('text/event-stream');
    if (isSSE) {
        head.set('Cache-Control', 'no-store, no-transform');
        head.set('Connection', 'keep-alive');
        head.set('X-Accel-Buffering', 'no');
        head.delete('content-length');
    }

    const headObj = {};
    for (const [k, v] of head) {
        headObj[k] = v;
    }

    res.header(headObj);
    res.status(originalResponse.status);

    if (!originalResponse.body) {
        res.end();
        return;
    }

    if (!isSSE) {
        await pipeline(originalResponse.body, res);
        return;
    }

    const reader = originalResponse.body.getReader();

    const onClose = () => {
        reader.cancel().catch(() => {});
    };
    res.on('close', onClose);

    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    try {
        while (!res.writableEnded) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (value && value.length > 0) {
                res.write(Buffer.from(value));
            }
        }
    } catch (error) {
        if (!res.writableEnded) {
            throw error;
        }
    } finally {
        res.off('close', onClose);
        if (!res.writableEnded) {
            res.end();
        }
    }
}

app.get('/', async (req, res, next) => {

    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'Unknown IP';
    const timestamp = new Date().toISOString();
    console.log(`[Server] ${timestamp} | Connection from: ${clientIP}`);
    
    try {
        const mainIndex = await fs.readFile(path.join(process.cwd(), 'dist', 'index.html'))
        const root = htmlparser.parse(mainIndex)
        const head = root.querySelector('head')
        head.innerHTML = `<script>globalThis.__NODE__ = true</script>` + head.innerHTML
        
        res.send(root.toString())
    } catch (error) {
        console.log(error)
        next(error)
    }
})

async function checkAuth(req, res, returnOnlyStatus = false){
    const authHeader = normalizeAuthHeader(req.headers['risu-auth']);

    let refusal;
    if(!authHeader){
        refusal = { status: 400, error: 'No auth header', log: 'No auth header' };
    }
    else{
        const verdict = await verifyJwt(authHeader);
        if(verdict.ok){
            return true
        }
        refusal = verdict;
    }
    console.log(refusal.log)
    if(returnOnlyStatus){
        return false;
    }
    res.status(refusal.status).send({
        error: refusal.error
    });
    return false
}

const reverseProxyFunc = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }

    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: req.method,
            headers: header,
            body: JSON.stringify(req.body),
            signal: timeout.signal
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        // The target is chosen by a request header, so one URL stands for many
        // responses: none may be stored or reused by the browser.
        head.set('Cache-Control', 'no-store');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);

    }
    catch (err) {
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        next(err);
        return;
    } finally {
        timeout.cleanup();
    }
}

const reverseProxyFunc_get = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }
    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: 'GET',
            headers: header,
            signal: timeout.signal
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        // See reverseProxyFunc: the response must never be cached.
        head.set('Cache-Control', 'no-store');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);
    }
    catch (err) {
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        next(err);
        return;
    } finally {
        timeout.cleanup();
    }
}

async function hubProxyFunc(req, res) {
    try {
        const externalURL = hubTargetURL(hubURL, req);

        // Only the allow-listed request headers reach the hub, on the first
        // request and on a followed redirect alike.
        const headersToSend = hubRequestHeaders(req.headers, new URL(hubURL).origin);
        const bodyToSend = hubForwardBody(req.method, req.body);

        let response = await fetch(externalURL, {
            method: req.method,
            headers: headersToSend,
            body: bodyToSend,
            redirect: 'manual',
            duplex: 'half'
        });

        // A redirect to the hub origin is followed here; any other target is
        // passed through to the client and never fetched by the server.
        const redirectUrl = response.status >= 300 && response.status < 400
            ? hubRedirectTarget(hubURL, externalURL, response.headers.get('location'))
            : null;
        if (redirectUrl) {
            response = await fetch(redirectUrl, {
                method: req.method,
                headers: headersToSend,
                body: bodyToSend,
                redirect: 'manual',
                duplex: 'half'
            });
        }

        // The client receives the headers of the response whose body it gets.
        for (const [key, value] of hubResponseHeaders(response.headers.entries())) {
            res.setHeader(key, value);
        }
        res.status(response.status);

        if (response.body) {
            await pipeline(response.body, res);
        } else {
            res.end();
        }

    } catch (error) {
        console.error("[Hub Proxy] Error:", error);
        if (!res.headersSent) {
            res.status(502).send({ error: 'Proxy request failed: ' + error.message });
        } else {
            res.end();
        }
    }
}

app.get('/proxy', authenticatedRouteLimiter, reverseProxyFunc_get);
app.get('/proxy2', authenticatedRouteLimiter, reverseProxyFunc_get);
app.get('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);

app.post('/proxy', authenticatedRouteLimiter, reverseProxyFunc);
app.post('/proxy2', authenticatedRouteLimiter, reverseProxyFunc);
app.post('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);
app.post('/proxy-stream-jobs', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const encodedUrl = encodeURIComponent(rawUrl);
    const url = sanitizeTargetUrl(decodeURIComponent(encodedUrl));
    if (!url) {
        res.status(400).send({ error: 'Invalid target URL. Only local/private network http(s) endpoints are allowed.' });
        return;
    }

    const method = typeof req.body?.method === 'string' ? req.body.method.toUpperCase() : 'POST';
    if (!['POST', 'GET', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        res.status(400).send({ error: 'Invalid method' });
        return;
    }

    const bodyBase64 = typeof req.body?.bodyBase64 === 'string' ? req.body.bodyBase64 : '';
    if (bodyBase64.length > PROXY_STREAM_MAX_BODY_BASE64_BYTES) {
        res.status(413).send({ error: 'Request body too large' });
        return;
    }
    if (proxyStreamJobs.size >= PROXY_STREAM_MAX_ACTIVE_JOBS) {
        res.status(429).send({ error: 'Too many active stream jobs. Retry shortly.' });
        return;
    }
    const headers = normalizeForwardHeaders(req.body?.headers);
    const heartbeatSec = normalizeHeartbeatSec(Number(req.body?.heartbeatSec));
    const job = createProxyStreamJob({
        heartbeatSec,
        timeoutMs: req.body?.timeoutMs
    });

    void runProxyStreamJob(job, {
        targetUrl: url,
        headers,
        method,
        bodyBase64,
        clientIp: req.ip
    });

    res.send({
        jobId: job.id,
        heartbeatSec: job.heartbeatSec
    });
});

// A name that is not allowed and one that is not set answer identically, so names cannot be probed.
app.post('/api/env-secret', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }
    res.set('Cache-Control', 'no-store');
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!isResolvableEnvName(name)) {
        res.status(404).send({ error: 'unavailable' });
        return;
    }
    const value = Object.hasOwn(process.env, name) ? String(process.env[name]).trim() : '';
    if (value === '' || /[\r\n]/.test(value)) {
        res.status(404).send({ error: 'unavailable' });
        return;
    }
    res.send({ value });
});

app.delete('/proxy-stream-jobs/:jobId', authenticatedRouteLimiter, async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }
    const job = proxyStreamJobs.get(req.params.jobId);
    if (!job) {
        res.send({ success: true });
        return;
    }
    job.abortController.abort();
    markJobDone(job);
    cleanupJob(job.id);
    res.send({ success: true });
});

// app.get('/api/password', async(req, res)=> {
//     if(password === ''){
//         res.send({status: 'unset'})
//     }
//     else if(req.body.password && req.body.password.trim() === password.trim()){
//         res.send({status:'correct'})
//     }
//     else{
//         res.send({status:'incorrect'})
//     }
// })

app.get('/api/test_auth', authRouteLimiter, async(req, res) => {

    if(!password){
        res.send({status: 'unset'})
    }
    else if(!await checkAuth(req, res, true)){
        res.send({status: 'incorrect'})
    }
    else{
        res.send({status: 'success'})
    }
})

app.post('/api/login', loginRouteLimiter, async (req, res) => {
    if(password === ''){
        res.status(400).send({error: 'Password not set'})
        return;
    }
    if(req.body.password && req.body.password.trim() === password.trim()){
        knownPublicKeysHashes.push(await hashJSON(req.body.publicKey))
        writeFileSync(knownPublicKeysPath, JSON.stringify(knownPublicKeysHashes), 'utf-8')
        res.send({status:'success'})
    }
    else{
        res.status(400).send({error: 'Password incorrect'})
    }
})

app.post('/api/crypto', async (req, res) => {
    try {
        const hash = crypto.createHash('sha256')
        hash.update(Buffer.from(req.body.data, 'utf-8'))
        res.send(hash.digest('hex'))
    } catch (error) {
        res.status(500).send({ error: 'Crypto operation failed' });
    }
})


app.post('/api/set_password', async (req, res) => {
    if(password === ''){
        password = req.body.password
        writeFileSync(passwordPath, password, 'utf-8')
        res.send({status: 'success'})
    }
    else{
        res.status(400).send("already set")
    }
})

app.get('/api/read', storageRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    let filePath = req.headers['file-path'];
    if (!filePath) {
        console.log('no path')
        res.status(400).send({
            error:'File path required'
        });
        return;
    }

    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }
    // Canonicalize to lowercase — hex is case-insensitive, but a case-variant
    // of the same key (e.g. "aa" vs "AA") would otherwise be tracked as a
    // DIFFERENT entry in `revisions`/`fileWriteQueues` while addressing the
    // SAME physical file on a case-insensitive filesystem (Windows, and
    // macOS by default) — splitting one file's revision identity in two.
    filePath = filePath.toLowerCase();
    try {
        // Reading the revision header and the file content must happen as one
        // atomic pair, under the SAME per-key lock /api/write and /api/remove
        // use — without this, a reader could land in the gap those handlers'
        // crash-safe ordering deliberately creates (revision persisted before
        // content is actually replaced/removed) and walk away with a revision
        // number that doesn't actually correspond to the content it just
        // read. That mismatched pair is dangerous specifically because a
        // later conditional write presenting that revision would PASS the
        // check (the revision genuinely is current) while having never
        // actually observed the write or removal that produced it — silently
        // overwriting content it was never actually consistent with.
        //
        // The lock is held only long enough to capture a consistent
        // (revision, content) snapshot into memory — NOT for the duration of
        // actually sending it to the client. Streaming the response from
        // inside the lock (an earlier version of this fix did, via
        // res.sendFile()) ties the lock's hold time to the client's download
        // speed: a connected client that simply stops reading (deliberately
        // or not) would hold this key's lock open indefinitely, since
        // nothing here previously bounded that wait — blocking every write
        // or removal for that key for as long as the stalled download
        // lasted, an availability hazard with no timeout to end it.
        let currentRevision = 0;
        let content = null;
        await withFileWriteLock(filePath, async () => {
            currentRevision = revisions[filePath] ?? 0;
            const fullPath = path.join(savePath, filePath);
            if(existsSync(fullPath)){
                content = await fs.readFile(fullPath);
            }
        });
        res.setHeader('x-risu-revision', String(currentRevision));
        // A stored empty file and an absent file answer with the same empty
        // body, so whether the key holds a value travels in a header. It is set
        // here, beside the revision and before the send, so a 304 revalidation
        // of this URL carries it too.
        res.setHeader('x-risu-exists', content === null ? '0' : '1');
        if(content === null){
            res.send();
        } else {
            res.setHeader('Content-Type','application/octet-stream');
            res.send(content);
        }
    } catch (error) {
        next(error);
    }
});

// Reads the first bytes of a file for content-type sniffing; null when it cannot.
async function readFileHead(fullPath, length) {
    let handle;
    try {
        handle = await fs.open(fullPath, 'r');
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
    } catch {
        return null;
    } finally {
        await handle?.close().catch(() => {});
    }
}

// A stored asset by URL, for an <img>, <video> or <audio> that cannot send a
// header. The token rides in the query and must carry the asset-read audience;
// the key must be one `isRouteServedKey` allows. The file streams from disk
// with range support and is read under none of the per-key write locks, so a
// client that stops reading never holds a write or remove of that key.
app.get('/api/asset/:hex', assetRouteLimiter, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    const refuse = (status, error) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(status).send({ error });
    };

    const token = req.query['risu-auth'];
    if (typeof token !== 'string' || token === '' || !(await verifyJwt(token, ASSET_READ_AUDIENCE)).ok) {
        refuse(401, 'Unauthorized');
        return;
    }
    const key = assetKeyFromHex(req.params.hex);
    if (key === null) {
        refuse(400, 'Invalid Path');
        return;
    }
    const fileName = req.params.hex.toLowerCase();
    const fullPath = path.join(savePath, fileName);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat === null || !stat.isFile()) {
        refuse(404, 'Not Found');
        return;
    }

    let contentType = contentTypeForKey(key);
    if (contentType === null) {
        contentType = sniffContentType(await readFileHead(fullPath, 16)) ?? 'application/octet-stream';
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControlForKey(key));
    res.sendFile(fileName, { root: savePath, cacheControl: false, dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) {
            res.removeHeader('Content-Type');
            const missing = error.status === 404 || error.code === 'ENOENT';
            refuse(missing ? 404 : 500, missing ? 'Not Found' : 'Internal Server Error');
        }
    });
});

app.get('/api/remove', storageRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    // Canonicalized to lowercase (see /api/read's comment on the same
    // pattern) — done here, before duplicate-checking, locking, revision
    // lookup, or filesystem access, so a case-variant of an already-listed
    // key is actually caught as the duplicate it physically is.
    const filePaths = (req.headers['file-path']?.split('$$') || []).map((p) => p.toLowerCase())
    // Optional, positionally aligned with filePaths (same '$$' join). An
    // empty segment means "no check for this specific key" — unconditional
    // delete for that one key. The header being absent ENTIRELY means "no
    // check for any key" — today's behavior, for back-compat with clients
    // that don't send it at all. If the header IS present, though, it must
    // fully align with file-path (same segment count, every non-empty
    // segment a valid revision number) — silently tolerating a short or
    // malformed header would downgrade whichever keys it doesn't properly
    // cover to unconditional deletes without the caller ever finding out.
    const ifMatchRevisionHeaderPresent = req.headers['if-match-revision'] !== undefined;
    const ifMatchRevisions = ifMatchRevisionHeaderPresent
        ? req.headers['if-match-revision'].split('$$')
        : [];

    for(const filePath of filePaths){
        if (!filePath) {
            res.status(400).send({
                error:'File path required'
            });
            return;
        }
        if(!isHex(filePath)){
            res.status(400).send({
                error:'Invaild Path'
            });
            return;
        }
    }

    // A key repeated within one batch would otherwise get its revision
    // bumped and persisted twice (once per occurrence in the commit loop
    // below) and, on the RIGOROUS reading of "return every key's new
    // revision," a genuinely ambiguous response — reject outright rather
    // than define subtle double-counting semantics nothing actually needs.
    if(new Set(filePaths).size !== filePaths.length){
        res.status(400).send({
            error: 'Duplicate file-path entries are not allowed in one request'
        });
        return;
    }

    if(ifMatchRevisionHeaderPresent){
        if(ifMatchRevisions.length !== filePaths.length){
            res.status(400).send({
                error: 'if-match-revision segment count must match file-path'
            });
            return;
        }
        for(const segment of ifMatchRevisions){
            if(segment !== '' && !/^\d+$/.test(segment)){
                res.status(400).send({
                    error: 'Invalid if-match-revision segment'
                });
                return;
            }
        }
    }

    try {
        // All locks for every key in this batch are held for the ENTIRE
        // operation below — every precondition is checked first, and only
        // if every single one passes does any file actually get removed.
        // Without this, a batch that conflicts partway through (key 2 of 3,
        // say) would otherwise have already deleted key 1 by the time the
        // conflict is discovered, leaving the caller told "409, failed" while
        // some of the deletion had, in fact, already silently committed.
        const committedRevisions = await withFileWriteLocks(filePaths, async () => {
            // Precondition validation, revision bump, and persistence (with
            // rollback on a save failure) all happen inside
            // withRevisionTransaction — the same global queue /api/write uses
            // — not just the per-key locks withFileWriteLocks already holds.
            // See its own comment for why: revision compaction snapshots the
            // whole map and then deletes the log, so no bump, append or
            // rollback of any key may overlap it, and the per-key locks
            // alone do not order requests for different keys.
            const newRevisions = await withRevisionTransaction(async () => {
                const currentRevisions = {};
                for(let i = 0; i < filePaths.length; i++){
                    const filePath = filePaths[i];
                    const currentRevision = revisions[filePath] ?? 0;
                    currentRevisions[filePath] = currentRevision;

                    const expectedRevisionRaw = ifMatchRevisions[i];
                    if(expectedRevisionRaw){
                        const expectedRevision = parseInt(expectedRevisionRaw, 10);
                        if(expectedRevision !== currentRevision){
                            const conflict = new Error('Revision conflict');
                            conflict.isRevisionConflict = true;
                            conflict.filePath = filePath;
                            conflict.currentRevision = currentRevision;
                            throw conflict;
                        }
                    }
                    // Without this check, a client that read this key at an
                    // old revision could still issue an unconditional delete
                    // after a DIFFERENT, newer write had already landed —
                    // fully serialized by the lock, but still silently
                    // destroying content the deleting client never actually
                    // observed.
                }

                // Every precondition above passed — commit. Revisions are
                // bumped (and persisted) for every key BEFORE any file is
                // actually removed, same "safe crash direction" reasoning as
                // /api/write: if the process dies partway through this loop,
                // some files may still be physically present with an
                // already-advanced revision, which just means the next access
                // to them needs a fresh read — never the reverse (a file gone
                // but its revision not yet moved, which is what would let a
                // stale holder of the old revision treat an already-deleted
                // key as if it had observed its disappearance).
                const bumped = {};
                for(const filePath of filePaths){
                    bumped[filePath] = currentRevisions[filePath] + 1;
                    revisions[filePath] = bumped[filePath];
                }
                try {
                    await appendRevisionRecords(filePaths);
                } catch (saveError) {
                    // Persistence itself failed — roll back every key's
                    // in-memory bump from this batch (not just one), safe to
                    // do unconditionally since nothing else could have
                    // mutated these entries in between (globally serialized
                    // by this same queue). The append is not atomic, so some
                    // of this batch's records may be durable and a persisted
                    // revision can end up higher than memory; that can only
                    // cause a later 409, never a lower revision. No file was
                    // removed, so — unlike the fs.rm failure case below —
                    // no committedRevisions is attached here; the client's
                    // existing knownRevisions are still correct.
                    for(const filePath of filePaths){
                        revisions[filePath] = currentRevisions[filePath];
                    }
                    throw saveError;
                }
                scheduleRevisionCompaction();
                return bumped;
            });

            try {
                for(const filePath of filePaths){
                    // { force: true } makes removing an already-absent file a
                    // no-op instead of throwing ENOENT — without this, deleting
                    // the same key twice (or a key another request already
                    // removed) would throw here AFTER this key's revision was
                    // already bumped and persisted above, turning a harmless
                    // repeat delete into a request the caller is told failed.
                    await fs.rm(path.join(savePath, filePath), { force: true });
                }
            } catch (rmError) {
                // Some OTHER I/O failure (permissions, disk error, ...) — the
                // revisions above are already committed regardless, so attach
                // them to the error the caller sees instead of leaving the
                // client with no way to learn they moved.
                rmError.committedRevisions = newRevisions;
                throw rmError;
            }
            return newRevisions;
        });

        res.send({
            success: true,
            revisions: committedRevisions,
        });
    } catch (error) {
        // If this is a genuine I/O failure (not a precondition conflict, which
        // never reaches this far), it happened after revisions had already
        // been bumped and persisted for this whole batch — attaching them to
        // the error response lets the client reconcile its own knownRevisions
        // to match reality instead of being stuck presenting stale values it
        // has no way to learn have moved.
        if(!error?.isRevisionConflict && error?.committedRevisions){
            res.status(500).send({
                success: false,
                error: error.message ?? String(error),
                revisions: error.committedRevisions,
            });
            return;
        }
        if(error?.isRevisionConflict){
            res.status(409).send({
                success: false,
                error: 'Revision conflict',
                filePath: error.filePath,
                currentRevision: error.currentRevision,
            });
            return;
        }
        next(error);
    }
});

app.get('/api/list', storageRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    try {
        // Only whole, even-length hex names are keys. Everything else in the
        // directory (write temps `<hex>.tmp-<random>`, the revision snapshot
        // `__revisions.json`, its log `__revisions.log` and their temps,
        // `__password` and the other `__` files) is not a key. Decoding a `__`
        // file gives an empty name; decoding a write temp gives the key it was
        // written for, a second copy of an existing key or a phantom one when
        // no real file exists.
        const data = (await fs.readdir(path.join(savePath)))
            .filter((v) => /^(?:[0-9a-fA-F]{2})+$/.test(v))
            .map((v) => {
                return Buffer.from(v, 'hex').toString('utf-8')
            })
        res.send({
            success: true,
            content: data
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/write', storageRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    let filePath = req.headers['file-path'];
    const fileContent = req.body
    if (!filePath || !fileContent) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }
    // Canonicalize to lowercase — see /api/read's comment on the same
    // pattern; keeps this key's revision/lock identity consistent with
    // /api/read and /api/remove regardless of the case a given client
    // happens to send its hex encoding in.
    filePath = filePath.toLowerCase();

    // Optional: when the client sends this, it's asserting "I last read this
    // key at revision N" and wants the write rejected if that's gone stale —
    // an older client that never sends it gets today's unconditional-write
    // behavior unchanged (back-compat).
    const ifMatchRevisionHeader = req.headers['if-match-revision'];

    try {
        await withFileWriteLock(filePath, async () => {
            // Revision is committed BEFORE content, not after — these are two
            // separate files (this one's own content, and the shared
            // revision log), so there's no way to rename both atomically
            // as one transaction. Ordering still matters: if the process
            // crashes between the two, "revision bumped, content not yet
            // replaced" is the SAFE direction to fail in — a later reader
            // sees the new revision paired with the OLD (still valid, never
            // torn) content, and any writer whose own if-match-revision no
            // longer matches gets correctly rejected and must re-read before
            // trying again. The other order ("content replaced, revision not
            // yet bumped") would instead let a writer who is still holding
            // the OLD revision pass the check and silently overwrite content
            // they never actually observed — the exact failure this whole
            // mechanism exists to prevent.
            //
            // The precondition-check + bump + persist sequence runs inside
            // withRevisionTransaction (a separate, GLOBAL queue from this
            // per-key lock) — see its own comment for why: revision
            // compaction snapshots the whole map and then deletes the log, so
            // no bump, append or rollback of any key may overlap it.
            const newRevision = await withRevisionTransaction(async () => {
                const currentRevision = revisions[filePath] ?? 0;

                if(ifMatchRevisionHeader !== undefined){
                    const expectedRevision = parseInt(ifMatchRevisionHeader, 10);
                    if(!Number.isFinite(expectedRevision) || expectedRevision !== currentRevision){
                        const conflict = new Error('Revision conflict');
                        conflict.isRevisionConflict = true;
                        conflict.currentRevision = currentRevision;
                        throw conflict;
                    }
                }

                const bumped = currentRevision + 1;
                revisions[filePath] = bumped;
                try {
                    await appendRevisionRecords([filePath]);
                } catch (saveError) {
                    // Persistence itself failed — roll back the in-memory bump.
                    // A partially written record may still be durable, so the
                    // persisted revision can end up higher than memory; that
                    // can only cause a later 409, never a lower revision.
                    // Safe to do unconditionally here (unlike
                    // if this ran outside the transaction queue): nothing else
                    // could have mutated `revisions[filePath]` in between,
                    // since the whole read-validate-mutate-persist sequence for
                    // every key is globally serialized by this same queue.
                    revisions[filePath] = currentRevision;
                    throw saveError;
                }
                scheduleRevisionCompaction();
                return bumped;
            });

            // Write to a unique temp file in the same directory, then atomically
            // rename it over the real path. A plain writeFile() to an existing path
            // is not atomic — two concurrent writers to the same key (e.g. two
            // devices/browsers pointed at this server) could otherwise interleave
            // or leave a torn file; rename() within the same filesystem is atomic.
            const finalPath = path.join(savePath, filePath);
            const tempPath = path.join(savePath, `${filePath}.tmp-${crypto.randomBytes(8).toString('hex')}`);
            try {
                await fs.writeFile(tempPath, fileContent);
                await fs.rename(tempPath, finalPath);
            } catch (error) {
                await fs.unlink(tempPath).catch(() => {});
                // The revision was already bumped above. Leaving it bumped
                // (not rolling back) is intentional and still safe, for the
                // same reason as the crash case in the comment above — it
                // just means the NEXT read/write for this key needs a fresh
                // if-match-revision, which will correctly reflect that this
                // attempt's content never actually landed.
                throw error;
            }

            res.send({
                success: true,
                revision: newRevision
            });
        });
    } catch (error) {
        if(error?.isRevisionConflict){
            res.status(409).send({
                error: 'Revision conflict',
                currentRevision: error.currentRevision
            });
            return;
        }
        next(error);
    }
});

async function getHttpsOptions() {

    const keyPath = path.join(sslPath, 'server.key');
    const certPath = path.join(sslPath, 'server.crt');

    try {
 
        await fs.access(keyPath);
        await fs.access(certPath);

        const [key, cert] = await Promise.all([
            fs.readFile(keyPath),
            fs.readFile(certPath)
        ]);
       
        return { key, cert };

    } catch (error) {
        console.error('[Server] SSL setup errors:', error.message);
        console.log('[Server] Start the server with HTTP instead of HTTPS...');
        return null;
    }
}

function setupProxyStreamWebSocket(server) {
    const wsServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', async (req, socket, head) => {
        try {
            const reqUrl = new URL(req.url, `http://${req.headers.host}`);
            if (!reqUrl.pathname.startsWith('/proxy-stream-jobs/') || !reqUrl.pathname.endsWith('/ws')) {
                socket.destroy();
                return;
            }

            const auth = reqUrl.searchParams.get('risu-auth') || req.headers['risu-auth'];
            if (!await isAuthorizedProxyRequest({ headers: { 'risu-auth': auth } })) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            const pathParts = reqUrl.pathname.split('/').filter(Boolean);
            const jobId = pathParts.length >= 3 ? pathParts[1] : '';
            const job = proxyStreamJobs.get(jobId);
            if (!job) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return;
            }

            wsServer.handleUpgrade(req, socket, head, (ws) => {
                wsServer.emit('connection', ws, req, jobId);
            });
        } catch {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
        }
    });

    wsServer.on('connection', (ws, _req, jobId) => {
        const job = proxyStreamJobs.get(jobId);
        if (!job) {
            ws.close();
            return;
        }

        job.clients.add(ws);
        ws.send(JSON.stringify({ type: 'job_accepted', jobId }));
        for (const event of job.pendingEvents) {
            ws.send(event);
        }
        job.pendingEvents = [];
        job.pendingBytes = 0;

        const pingTimer = setInterval(() => {
            if (ws.readyState !== ws.OPEN) {
                return;
            }
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }, job.heartbeatSec * 1000);

        ws.on('close', () => {
            clearInterval(pingTimer);
            const currentJob = proxyStreamJobs.get(jobId);
            if (!currentJob) {
                return;
            }
            currentJob.clients.delete(ws);
            if (currentJob.done && currentJob.clients.size === 0) {
                cleanupJob(jobId);
            }
        });

        ws.on('error', () => {
            clearInterval(pingTimer);
        });
    });
}

async function startServer() {
    try {
      
        const port = process.env.PORT || 6001;
        const httpsOptions = await getHttpsOptions();
        let server = null;

        if (httpsOptions) {
            // HTTPS
            server = https.createServer(httpsOptions, app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
            });
        } else {
            // HTTP
            server = http.createServer(app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTP server is running.");
                console.log(`[Server] http://localhost:${port}/`);
            });
        }
    } catch (error) {
        console.error('[Server] Failed to start server :', error);
        process.exit(1);
    }
}

(async () => {
    setInterval(() => {
        const now = Date.now();
        for (const [jobId, job] of proxyStreamJobs.entries()) {
            if (!job.done && now >= job.deadlineAt && !job.abortController.signal.aborted) {
                job.abortController.abort();
            }
            if (job.done && job.clients.size === 0 && job.cleanupAt > 0 && now >= job.cleanupAt) {
                cleanupJob(jobId);
                continue;
            }
            if (!job.done && now - job.updatedAt > Math.max(PROXY_STREAM_DEFAULT_TIMEOUT_MS, job.timeoutMs * 2)) {
                cleanupJob(jobId);
            }
        }
    }, PROXY_STREAM_GC_INTERVAL_MS);
    await startServer();
})();
