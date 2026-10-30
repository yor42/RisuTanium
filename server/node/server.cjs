const express = require('express');
const app = express();
const { parseTrustProxy } = require('./trustProxy.cjs');
const { nodeVersionWarning } = require('./nodeVersionCheck.cjs');
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
}
const http = require('http');
const path = require('path');
const net = require('net');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, readdirSync } = require('fs');
const fs = require('fs/promises')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { NODE_BODY_LIMIT_BYTES, NODE_PUBLIC_BODY_LIMIT_BYTES, NODE_ASSET_LIMIT_BYTES, NODE_UPLOAD_CHUNK_MAX_BYTES } = require('./bodyLimit.cjs');
const { hubTargetURL, hubRedirectTarget, hubRequestHeaders, hubResponseHeaders, hubForwardBody } = require('./hubProxy.cjs');
const { ASSET_READ_AUDIENCE, assetKeyFromHex, contentTypeForKey, sniffContentType, cacheControlForKey } = require('./assetRoute.cjs');
const { store2KeyFromHex } = require('./store2Keys.cjs');
const { isKindAllowed, literalHostKind, createCheckedLookup, blockedError, ProxyPolicyError, InvalidHeaderError, sanitizeOutboundHeaders } = require('./proxyPolicy.cjs');

// A positive integer from the environment, else `fallback`. The environment
// overrides exist so tests can use small limits and short timers.
function positiveIntegerFromEnv(name, fallback){
    const configured = Number(process.env[name]);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : fallback;
}
const UPLOAD_ASSET_LIMIT_BYTES = positiveIntegerFromEnv('RISU_NODE_ASSET_LIMIT_BYTES', NODE_ASSET_LIMIT_BYTES);
const UPLOAD_CHUNK_MAX_BYTES = positiveIntegerFromEnv('RISU_UPLOAD_CHUNK_MAX_BYTES', NODE_UPLOAD_CHUNK_MAX_BYTES);
// Bytes all open uploads may hold on disk together; an orphan bound, not a quota.
const UPLOAD_STAGED_CAP_BYTES = positiveIntegerFromEnv('RISU_UPLOAD_STAGED_CAP_BYTES', 4 * 1024 * 1024 * 1024);
// An upload with no request for this long is reaped.
const UPLOAD_IDLE_REAP_MS = positiveIntegerFromEnv('RISU_UPLOAD_IDLE_REAP_MS', 60 * 60 * 1000);
// How long a committed upload answers a retried commit with its first success.
const UPLOAD_TOMBSTONE_MS = positiveIntegerFromEnv('RISU_UPLOAD_TOMBSTONE_MS', 10 * 60 * 1000);
// Under capacity pressure only uploads idle at least this long may be evicted.
const UPLOAD_EVICT_IDLE_MS = positiveIntegerFromEnv('RISU_UPLOAD_EVICT_IDLE_MS', 5 * 60 * 1000);

// Response headers on every answer, static files and errors included. The app
// frames its own StreamSaver helper page, so framing is limited to the same
// origin rather than denied. A proxied response may overwrite these with the
// target's own values; it is fetched, not framed.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
// Upload requests are tracked from their arrival (trackUploadArrival, defined
// with the upload routes), before their body is read.
app.use('/api/upload', trackUploadArrival);
// The hub proxy is anonymous and forwards the request body as the client sent
// it, so it is captured as raw bytes under the small public limit.
app.use('/hub-proxy', express.raw({ type: () => true, limit: NODE_PUBLIC_BODY_LIMIT_BYTES }));
// No body is read before the request is authorised, except under the small
// public limit. A route that reads a body mounts one of these after its gate
// (authBeforeBody), so an unauthenticated client cannot make the server buffer
// or wait for a large body. Each parser sets an empty body when it does not
// apply, and the handlers rely on that.
const authenticatedBodyParsers = [
    express.json({ limit: NODE_BODY_LIMIT_BYTES }),
    express.raw({ type: 'application/octet-stream', limit: NODE_BODY_LIMIT_BYTES }),
    express.text({ limit: NODE_BODY_LIMIT_BYTES }),
];
const publicJsonParser = express.json({ limit: NODE_PUBLIC_BODY_LIMIT_BYTES });
// An append body is read by its own parser with the chunk maximum as the limit,
// so an over-size chunk is refused before more than the chunk maximum is buffered.
const uploadChunkParser = express.raw({ type: () => true, limit: UPLOAD_CHUNK_MAX_BYTES });
// Hands a rejected promise of an async route handler to the final error handler,
// so a failure after an await answers the request instead of ending the process.
function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve().then(() => handler(req, res, next)).catch(next);
    };
}
// The authorisation check sends its own refusal; the request continues to the
// body parsers only when it passed.
function authBeforeBody(check) {
    return async (req, res, next) => {
        try {
            if (await check(req, res)) {
                next();
            }
        } catch (error) {
            next(error);
        }
    };
}
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

// The server never stores the digest of an empty password; one that is already
// stored (an upstream folder, a hand edit) is only warned about, never changed.
const EMPTY_PASSWORD_DIGEST = crypto.createHash('sha256').update('').digest('hex')
function isEmptyPasswordDigest(value) {
    return typeof value === 'string' && value.trim().toLowerCase() === EMPTY_PASSWORD_DIGEST
}

const knownPublicKeysPath = path.join(process.cwd(), 'save', '__known_public_key_hashes.json')
if(existsSync(knownPublicKeysPath)){
    const knownPublicKeysRaw = readFileSync(knownPublicKeysPath, 'utf-8');
    knownPublicKeysHashes = JSON.parse(knownPublicKeysRaw);
}

// Per-file revision counters backing /api/write's optimistic-concurrency
// check. The state is the snapshot (__revisions.json) plus the append log
// (__revisions.log, one JSON record per line, each preceded by a newline so a
// torn tail can never merge into the next record). Two record shapes are
// valid: a bump `{"k":<key>,"r":<revision>}` (a string `k`, a non-negative safe
// integer `r`) and a delete `{"k":<key>,"d":1}`, which only a retire request on
// /api/remove-checked writes. A record with both `d` and `r`, or any other
// shape, is skipped and never lowers a revision.
//
// The recovered value of a key: if the log holds a delete record for it, the
// maximum of the bump records after the last delete (0 if none); otherwise the
// maximum of the snapshot and every bump record. A key with no entry reads 0.
// A compaction renames the snapshot into place before the log is deleted and
// appends are serialised with compaction, so the log always covers every record
// after any delete it holds, and a crash at any point of a compaction recovers
// every revision that was ever exposed to a client. The one exception is a
// retired key: its entry is forgotten, and the client's invariant is that a
// retired name is never written again.
//
// Downgrade: a server that predates delete records skips them as invalid, so
// running it on a save written by this one may bring retired keys back (while
// the log still holds their bump records) as tombstones at their bumped
// revisions; it never lowers a revision.
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

// Returns a normalised { k, r } (bump) or { k, d: 1 } (delete) when `line` is a
// valid revision record, else null. The delete shape is checked first: a record
// is never both, and the replay rule depends only on the fields returned here.
function parseRevisionRecord(line){
    let record
    try {
        record = JSON.parse(line)
    } catch (error) {
        return null
    }
    if(typeof record !== 'object' || record === null || !Object.hasOwn(record, 'k')){
        return null
    }
    if(typeof record.k !== 'string'){
        return null
    }
    const hasDelete = Object.hasOwn(record, 'd')
    const hasRevision = Object.hasOwn(record, 'r')
    if(hasDelete && hasRevision){
        return null
    }
    if(hasDelete){
        return record.d === 1 ? { k: record.k, d: 1 } : null
    }
    if(!hasRevision || !isValidRevisionValue(record.r)){
        return null
    }
    return { k: record.k, r: record.r }
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
        // Running without these revisions could hand out lower ones than a
        // device or tab that is still open from before has already seen, and
        // that client could then overwrite newer data. Neither file is touched.
        console.error(`Cannot use ${revisionsPath} (${error?.code ?? error?.message ?? 'unknown'}); refusing to start, because running without its revisions could let a device or tab that is still open from before overwrite newer data. ` +
            'Restoring a good copy of the file is the safe fix. Moving it aside instead restarts from zero every revision that __revisions.log does not hold, ' +
            'which carries that risk, so only do that knowing it. Keep __revisions.log in place either way.', error);
        process.exit(1)
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
                if(record.d === 1){
                    delete revisions[record.k]
                } else {
                    raiseRevision(record.k, record.r)
                }
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

// Startup sweep, synchronous and before the server listens, so no request can
// be using what it removes: an upload's staging file and a key write's temp
// file left behind by a process that ended mid-request. Only these two exact
// name shapes go; a key file (whole hex name) and every other `__` file stay.
const uploadStagingNamePattern = /^__upload-[0-9a-f]{32}$/i
const keyWriteTempNamePattern = /^(?:[0-9a-f]{2})+\.tmp-[0-9a-f]{16}$/i
for(const entry of readdirSync(savePath, { withFileTypes: true })){
    if(entry.isFile() && (uploadStagingNamePattern.test(entry.name) || keyWriteTempNamePattern.test(entry.name))){
        try {
            unlinkSync(path.join(savePath, entry.name))
        } catch (error) {
            console.error(`Could not remove the leftover ${entry.name}:`, error?.code ?? error)
        }
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

// Appends one delete record per key in `keys` to the revision log. Same
// contract as appendRevisionRecords: callers must already be inside
// withRevisionTransaction() below, and delete the keys' map entries only after
// this resolves, so memory is never lower than what the log has acknowledged.
async function appendRetireRecords(keys){
    const data = keys.map((key) => '\n' + JSON.stringify({ k: key, d: 1 })).join('')
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

// Guarded routes (/api/write-checked, /api/remove-checked, /api/caps). A
// guarded request may name check-only keys: each joins the request's lock set
// and its revision is compared inside the revision transaction before anything
// is mutated, but the key itself is never written, removed or bumped. An absent
// key compares as revision 0, so a check-only key at revision 1 or more fails
// when it is absent or retired.
//
// The client counts what it sent: `check-only-count` (and `retire-count` on a
// remove) must be present and equal the parsed lists, otherwise the request is
// refused before any lock or file work. Headers lost on the way (a proxy that
// forwards only some of them) therefore turn into a refusal, never into an
// unguarded success. The success body echoes what was enforced.
//
// The same holds for the request's own conditions: `own-condition-count` is the
// number of its own keys that carry an `if-match-revision`, and a request whose
// received `if-match-revision` does not yield that count is refused, so a proxy
// that strips the condition cannot turn a conditional write or remove into an
// unconditional one.
const GUARDED_MARKER_HEADER = 'risu-storage-guarded';
const strictHexPattern = /^(?:[0-9a-f]{2})+$/;
const NO_CHECK_ONLY = Object.freeze({ paths: [], revisions: [] });

function markGuarded(res){
    res.setHeader(GUARDED_MARKER_HEADER, '1');
    res.setHeader('Cache-Control', 'no-store');
}

function countRefusal(error){
    return { error, code: 'guarded-count' };
}

// Parses the check-only headers of a guarded request. Returns
// { paths, revisions } or { refusal } (the body of a 400). `ownKeys` are the
// keys the request writes or removes; none may also be a check-only key.
function parseCheckOnly(req, ownKeys){
    const countHeader = req.headers['check-only-count'];
    if(typeof countHeader !== 'string' || !/^\d+$/.test(countHeader)){
        return { refusal: countRefusal('check-only-count is required and must be a non-negative integer') };
    }
    const count = parseInt(countHeader, 10);
    const pathHeader = req.headers['check-only-path'];
    const revisionHeader = req.headers['check-only-revision'];
    if(pathHeader === undefined && revisionHeader === undefined){
        if(count !== 0){
            return { refusal: countRefusal('check-only-count does not match the check-only keys sent') };
        }
        return NO_CHECK_ONLY;
    }
    if(pathHeader === undefined || revisionHeader === undefined){
        return { refusal: { error: 'check-only-path and check-only-revision must be sent together' } };
    }
    const paths = pathHeader.split('$$').map((p) => p.toLowerCase());
    const revisionSegments = revisionHeader.split('$$');
    if(paths.length !== revisionSegments.length){
        return { refusal: { error: 'check-only-revision segment count must match check-only-path' } };
    }
    for(let i = 0; i < paths.length; i++){
        if(!strictHexPattern.test(paths[i])){
            return { refusal: { error: 'Invaild check-only path' } };
        }
        if(!/^\d+$/.test(revisionSegments[i])){
            return { refusal: { error: 'Invalid check-only-revision segment' } };
        }
    }
    if(new Set(paths).size !== paths.length){
        return { refusal: { error: 'Duplicate check-only-path entries are not allowed in one request' } };
    }
    for(const own of ownKeys){
        if(paths.includes(own)){
            return { refusal: { error: 'A check-only key must not also be a written or removed key' } };
        }
    }
    if(paths.length !== count){
        return { refusal: countRefusal('check-only-count does not match the check-only keys sent') };
    }
    return { paths, revisions: revisionSegments.map((r) => parseInt(r, 10)) };
}

// Parses the retire flag of a guarded remove. Returns { retire } or
// { refusal }. Retiring is limited to keys under the A-lite prefix and always
// needs at least one check-only key (the garbage collector's commit-key check).
function parseRetire(req, removedKeys, checkOnly){
    const retireHeader = req.headers['retire'];
    const countHeader = req.headers['retire-count'];
    if(retireHeader !== undefined && retireHeader !== '1'){
        return { refusal: { error: 'retire must be 1 when present' } };
    }
    if(typeof countHeader !== 'string' || !/^\d+$/.test(countHeader)){
        return { refusal: countRefusal('retire-count is required and must be a non-negative integer') };
    }
    const count = parseInt(countHeader, 10);
    const retire = retireHeader === '1';
    if(count !== (retire ? removedKeys.length : 0)){
        return { refusal: countRefusal('retire-count does not match the retire request') };
    }
    if(!retire){
        return { retire: false };
    }
    if(checkOnly.paths.length === 0){
        return { refusal: { error: 'retire needs at least one check-only key' } };
    }
    for(const key of removedKeys){
        if(store2KeyFromHex(key) === null){
            return { refusal: { error: 'retire is limited to keys under the A-lite prefix' } };
        }
    }
    return { retire: true };
}

// Checks the `own-condition-count` header of a guarded write or remove against
// `enforced`, the number of its own keys the server will compare a revision for
// (from the `if-match-revision` it received). Returns { count } or { refusal }.
function parseOwnCondition(req, enforced){
    const countHeader = req.headers['own-condition-count'];
    if(typeof countHeader !== 'string' || !/^\d+$/.test(countHeader)){
        return { refusal: countRefusal('own-condition-count is required and must be a non-negative integer') };
    }
    if(parseInt(countHeader, 10) !== enforced){
        return { refusal: countRefusal('own-condition-count does not match the if-match-revision sent') };
    }
    return { count: enforced };
}

// Throws the revision-conflict error naming the first check-only key whose
// current revision differs. Must run inside withRevisionTransaction.
function assertCheckOnly(checkOnly){
    for(let i = 0; i < checkOnly.paths.length; i++){
        const currentRevision = revisions[checkOnly.paths[i]] ?? 0;
        if(currentRevision !== checkOnly.revisions[i]){
            const conflict = new Error('Revision conflict');
            conflict.isRevisionConflict = true;
            conflict.filePath = checkOnly.paths[i];
            conflict.currentRevision = currentRevision;
            throw conflict;
        }
    }
}

const hexRegex = /^[0-9a-fA-F]+$/;
const PROXY_STREAM_DEFAULT_TIMEOUT_MS = 600000;
const PROXY_STREAM_MAX_TIMEOUT_MS = 3600000;
const PROXY_STREAM_DEFAULT_HEARTBEAT_SEC = 15;
const PROXY_STREAM_HEARTBEAT_MIN_SEC = 5;
const PROXY_STREAM_HEARTBEAT_MAX_SEC = 60;
// The environment overrides let tests use short timers and small bounds.
const PROXY_STREAM_GC_INTERVAL_MS = positiveIntegerFromEnv('RISU_PROXY_STREAM_GC_INTERVAL_MS', 60000);
const PROXY_STREAM_DONE_GRACE_MS = positiveIntegerFromEnv('RISU_PROXY_STREAM_DONE_GRACE_MS', 30000);
const PROXY_STREAM_MAX_ACTIVE_JOBS = positiveIntegerFromEnv('RISU_PROXY_STREAM_MAX_ACTIVE_JOBS', 64);
// Sockets that may follow one job, and the bytes a follower may have queued
// before it is cut off (a stalled reader must not make the server hold the stream).
const PROXY_STREAM_MAX_CLIENTS_PER_JOB = positiveIntegerFromEnv('RISU_PROXY_STREAM_MAX_CLIENTS_PER_JOB', 4);
const PROXY_STREAM_MAX_CLIENT_BUFFER_BYTES = positiveIntegerFromEnv('RISU_PROXY_STREAM_MAX_CLIENT_BUFFER_BYTES', 4 * 1024 * 1024);
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
// Same budget as the login route, counted separately so a burst on one route
// does not use up the other's attempts.
const setPasswordRouteLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again later.' }
});
// The digest helper is public, so it has a bucket of its own: a burst on it
// uses up neither the login nor the password-setup attempts.
const cryptoRouteLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again later.' }
});
function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim());
}

async function hashJSON(json){
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(json));
    return hash.digest('hex');
}

// The direct-password comparison never authorizes before a password exists: a
// blank supplied value would otherwise equal the blank configured one.
function isAuthorizedRequest(req) {
    if (password.trim() === '') {
        return false;
    }
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
const MAX_TOKEN_LIFETIME_SECONDS = 3600;
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
            // An ordinary token lives minutes; the cap bounds what a leaked one is
            // worth. A client token that is refused here while its own clock is
            // right means this server's clock is behind. Asset tokens (with an
            // audience) are not capped.
            if (audience === undefined && jsonPayload.exp - now > MAX_TOKEN_LIFETIME_SECONDS) {
                return { ok: false, status: 400, error: 'Token Lifetime Too Long', log: `Token exp is more than ${MAX_TOKEN_LIFETIME_SECONDS} s after the server clock; the server clock may be behind` };
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
        // A token that cannot be parsed is the client's fault; one line, no stack.
        return { ok: false, status: 400, error: 'Invalid Token', log: 'Invalid token (unparseable)' };
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

// The destination rule of the proxy (see proxyPolicy.cjs): loopback is always
// allowed, a private-network address only when the operator sets
// RISU_PROXY_ALLOW_PRIVATE=1, a public address on /proxy and /proxy2 but never
// for a stream job (jobs exist for local model servers).
const PROXY_ALLOW_PRIVATE = process.env.RISU_PROXY_ALLOW_PRIVATE === '1';
const PROXY_ROUTE_POLICY = { allowPrivate: PROXY_ALLOW_PRIVATE, allowPublic: true };
const PROXY_JOB_POLICY = { allowPrivate: PROXY_ALLOW_PRIVATE, allowPublic: false };

// A pooled keep-alive socket skips the connect-time lookup that enforces a policy,
// so each policy owns its agents and a socket never serves a request of another policy.
const POLICY_AGENTS = new WeakMap();
function agentForPolicy(policy, protocol) {
    let agents = POLICY_AGENTS.get(policy);
    if (agents === undefined) {
        agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
        POLICY_AGENTS.set(policy, agents);
    }
    return agents[protocol];
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

// The one outbound transport of the proxy routes and the stream jobs. Every
// hop is checked twice: the URL gate refuses a bad URL and an address literal
// the policy does not allow, and the checked lookup refuses a name that resolves
// to such an address and hands the connection exactly the addresses it checked.
const MAX_PROXY_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Headers that describe the body of a request; a redirect that drops the body drops them.
const REDIRECT_BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];
// Headers of an upstream response that belong to its own connection.
const HOP_BY_HOP_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'proxy-connection', 'trailer', 'upgrade', 'te']);

function proxyAbortError(message) {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function abortErrorOf(signal) {
    return signal.reason instanceof Error ? signal.reason : proxyAbortError('Proxy request aborted');
}

function gateProxyUrl(raw, policy, isRedirect) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        url = null;
    }
    if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
        throw isRedirect
            ? new ProxyPolicyError('PROXY_REDIRECT_INVALID', 502, 'Redirect target is not a valid http(s) URL')
            : new ProxyPolicyError('PROXY_URL_INVALID', 400, 'Invalid risu-url');
    }
    const kind = literalHostKind(url.hostname);
    if (kind !== null && !isKindAllowed(kind, policy)) {
        throw blockedError(kind);
    }
    return url;
}

// One request to one URL. Resolves once the response headers are in, with the
// response stream; the abort signal keeps governing the request until that
// stream ends, and every upstream object has an error listener for its lifetime
// (an unhandled error on a destroyed upstream request would end the process).
function requestOnce(url, arg) {
    return new Promise((resolve, reject) => {
        if (arg.signal.aborted) {
            reject(abortErrorOf(arg.signal));
            return;
        }
        const client = url.protocol === 'https:' ? https : http;
        const headers = { ...arg.headers, host: url.host };
        if (arg.body !== undefined) {
            headers['content-length'] = String(arg.body.length);
        }
        let settled = false;
        let upstream;
        const onAbort = () => {
            req.destroy(abortErrorOf(arg.signal));
        };
        const detach = () => arg.signal.removeEventListener('abort', onAbort);
        const req = client.request(url, {
            method: arg.method,
            headers,
            agent: agentForPolicy(arg.policy, url.protocol),
            lookup: createCheckedLookup(arg.policy)
        }, (res) => {
            upstream = res;
            res.on('error', () => {});
            res.once('close', detach);
            settled = true;
            resolve({
                status: res.statusCode || 502,
                headers: res.headers,
                body: res
            });
        });
        req.on('error', (error) => {
            if (!settled) {
                settled = true;
                detach();
                reject(error);
                return;
            }
            // After the headers the failure ends the body stream the caller reads.
            upstream?.destroy();
        });
        if (arg.idleTimeoutMs) {
            req.setTimeout(arg.idleTimeoutMs, () => {
                req.destroy(new Error(`Upstream request timed out after ${arg.idleTimeoutMs}ms`));
            });
        }
        arg.signal.addEventListener('abort', onAbort, { once: true });
        req.end(arg.body);
    });
}

// `arg`: method, headers (already sanitized), body (a Buffer or undefined), signal,
// policy, maxRedirects (0 passes a 3xx through) and idleTimeoutMs (optional).
// Redirects follow undici's rules: a 301/302 on POST and a 303 become a GET with
// no body, and a hop to another origin drops the credentials.
async function requestChecked(startUrl, arg) {
    let url = gateProxyUrl(startUrl, arg.policy, false);
    let method = arg.method;
    let body = arg.body;
    const headers = { ...arg.headers };
    for (let redirects = 0; ; ) {
        const response = await requestOnce(url, {
            method,
            headers,
            body,
            signal: arg.signal,
            policy: arg.policy,
            idleTimeoutMs: arg.idleTimeoutMs
        });
        const location = response.headers.location;
        if (arg.maxRedirects === 0 || !REDIRECT_STATUSES.has(response.status) || typeof location !== 'string') {
            return response;
        }
        if (redirects >= arg.maxRedirects) {
            response.body.destroy();
            throw new ProxyPolicyError('PROXY_TOO_MANY_REDIRECTS', 502, 'Too many redirects');
        }
        let next;
        try {
            next = gateProxyUrl(new URL(location, url).toString(), arg.policy, true);
        } catch (error) {
            response.body.destroy();
            throw error instanceof ProxyPolicyError ? error : new ProxyPolicyError('PROXY_REDIRECT_INVALID', 502, 'Redirect target is not a valid http(s) URL');
        }
        response.body.resume();
        redirects++;
        const dropsBody = ((response.status === 301 || response.status === 302) && method === 'POST')
            || (response.status === 303 && method !== 'GET' && method !== 'HEAD');
        if (dropsBody) {
            method = 'GET';
            body = undefined;
            for (const name of REDIRECT_BODY_HEADERS) {
                delete headers[name];
            }
        }
        if (next.origin !== url.origin) {
            delete headers['authorization'];
            delete headers['proxy-authorization'];
            delete headers['cookie'];
        }
        url = next;
    }
}

// One abort signal for a proxied request: it fires at the total deadline (not
// cleared at the response headers) and when the client goes away before the
// answer is complete, so no upstream request outlives its client.
function createProxyAbort(res, timeoutMs) {
    const controller = new AbortController();
    const timer = timeoutMs
        ? setTimeout(() => controller.abort(proxyAbortError(`Proxy request timed out after ${timeoutMs}ms`)), timeoutMs)
        : undefined;
    const onClose = () => {
        if (!res.writableFinished) {
            controller.abort(proxyAbortError('Proxy request aborted'));
        }
    };
    res.on('close', onClose);
    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            res.off('close', onClose);
        }
    };
}

function policyErrorBody(error) {
    if (error.code === 'PROXY_URL_INVALID') {
        return { error: error.message };
    }
    const body = { error: error.message, code: error.code };
    if (error.code === 'PROXY_DESTINATION_BLOCKED' && error.details?.kind === 'private') {
        body.hint = 'Local network targets need RISU_PROXY_ALLOW_PRIVATE=1 on the server.';
    }
    return body;
}

// The headers of a proxied response for the browser: the upstream's own, minus
// the policy and connection headers, never cacheable. The content encoding and
// length pass through, since the body is not decoded here.
function proxyResponseHeaders(upstreamHeaders) {
    const out = {};
    for (const [name, value] of Object.entries(upstreamHeaders)) {
        const key = name.toLowerCase();
        if (key === 'content-security-policy' || key === 'content-security-policy-report-only' || key === 'clear-site-data'
            || key === 'cache-control' || HOP_BY_HOP_RESPONSE_HEADERS.has(key)) {
            continue;
        }
        out[key] = Array.isArray(value) ? (key === 'set-cookie' ? value[value.length - 1] : value.join(', ')) : value;
    }
    // The target is chosen by a request header, so one URL stands for many
    // responses: none may be stored or reused by the browser.
    out['cache-control'] = 'no-store';
    return out;
}

async function forwardProxyRequest(res, next, arg) {
    const abort = createProxyAbort(res, arg.timeoutMs);
    const appliedHeaders = [];
    try {
        const upstream = await requestChecked(arg.urlParam, {
            method: arg.method,
            headers: arg.header,
            body: arg.body,
            signal: abort.signal,
            policy: PROXY_ROUTE_POLICY,
            maxRedirects: MAX_PROXY_REDIRECTS
        });
        const headObj = proxyResponseHeaders(upstream.headers);
        res.header(headObj);
        appliedHeaders.push(...Object.keys(headObj));
        res.status(upstream.status);
        await pipeline(upstream.body, res);
    }
    catch (err) {
        if (res.headersSent) {
            // A stream cut short must never look complete to the client.
            res.destroy();
            return;
        }
        for (const name of appliedHeaders) {
            res.removeHeader(name);
        }
        if (err instanceof ProxyPolicyError) {
            res.status(err.status).send(policyErrorBody(err));
            return;
        }
        if (err?.name === 'AbortError') {
            res.status(504).send({ error: err.message });
            return;
        }
        next(err);
        return;
    } finally {
        abort.cleanup();
    }
}

function createProxyStreamJob(arg) {
    const jobId = crypto.randomUUID();
    const timeoutMs = normalizeProxyStreamTimeoutMs(Number(arg.timeoutMs));
    const heartbeatSec = normalizeHeartbeatSec(arg.heartbeatSec);
    const controller = new AbortController();
    const createdAt = Date.now();
    const job = {
        id: jobId,
        // The credential of this job's WebSocket: the general token never goes into a URL.
        wsTicket: crypto.randomBytes(32).toString('hex'),
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
        if (client.bufferedAmount > PROXY_STREAM_MAX_CLIENT_BUFFER_BYTES) {
            client.terminate();
            continue;
        }
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
            client.close(1000);
        } catch {
            // ignore
        }
    }
    proxyStreamJobs.delete(jobId);
}

async function runProxyStreamJob(job, arg) {
    // The headers arrive sanitized from job creation.
    const headers = { ...arg.headers };
    if (!headers['x-forwarded-for']) {
        headers['x-forwarded-for'] = arg.clientIp;
    }
    const bodyBuffer = arg.bodyBase64 ? Buffer.from(arg.bodyBase64, 'base64') : undefined;

    try {
        const upstreamResponse = await requestChecked(arg.targetUrl, {
            method: arg.method,
            headers,
            body: bodyBuffer,
            idleTimeoutMs: job.timeoutMs,
            signal: job.abortController.signal,
            policy: PROXY_JOB_POLICY,
            maxRedirects: 0
        });

        const filteredHeaders = {};
        for (const [key, value] of Object.entries(normalizeProxyResponseHeaders(upstreamResponse.headers))) {
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
        // A DELETE aborts the job; the body stream then fails with a premature
        // close, which is reported as the abort it was.
        const aborted = error?.name === 'AbortError' || job.abortController.signal.aborted;
        const blocked = error instanceof ProxyPolicyError;
        pushJobEvent(job, {
            type: 'error',
            status: blocked ? error.status : 504,
            message: aborted ? 'Proxy stream job aborted' : (blocked ? error.message : `${error}`)
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

app.get('/', asyncRoute(async (req, res, next) => {

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
}))

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

// The target and the outbound headers of a /proxy or /proxy2 request, or null
// after the 400 answer for an input that cannot be read. With `risu-header` the
// client's map is the source of the outbound headers; without it the browser's
// own request headers are (sanitizeOutboundHeaders drops the credentials and the
// framing in both cases).
function readProxyRequest(req, res, hasBody) {
    let urlParam;
    try {
        urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;
    } catch {
        res.status(400).send({ error: 'Invalid risu-url' });
        return null;
    }
    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return null;
    }
    if (typeof urlParam !== 'string') {
        res.status(400).send({ error: 'Invalid risu-url' });
        return null;
    }
    let source = req.headers;
    let fromBrowser = true;
    if (req.headers['risu-header']) {
        try {
            source = JSON.parse(decodeURIComponent(req.headers['risu-header']));
        } catch {
            source = undefined;
        }
        fromBrowser = false;
    }
    let header;
    try {
        header = sanitizeOutboundHeaders(source, { fromBrowser, fetchDefaults: true, hasBody });
    } catch (error) {
        if (error instanceof InvalidHeaderError) {
            res.status(400).send({ error: 'Invalid risu-header' });
            return null;
        }
        throw error;
    }
    if (!header['x-forwarded-for'] && typeof req.ip === 'string') {
        header['x-forwarded-for'] = req.ip;
    }
    return { urlParam, header };
}

const reverseProxyFunc = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }

    const proxyRequest = readProxyRequest(req, res, true);
    if (proxyRequest === null) {
        return;
    }
    await forwardProxyRequest(res, next, {
        urlParam: proxyRequest.urlParam,
        header: proxyRequest.header,
        method: req.method,
        body: Buffer.from(JSON.stringify(req.body ?? {})),
        timeoutMs: getRequestTimeoutMs(req.headers['risu-timeout-ms'])
    });
}

const reverseProxyFunc_get = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }

    const proxyRequest = readProxyRequest(req, res, false);
    if (proxyRequest === null) {
        return;
    }
    await forwardProxyRequest(res, next, {
        urlParam: proxyRequest.urlParam,
        header: proxyRequest.header,
        method: 'GET',
        body: undefined,
        timeoutMs: getRequestTimeoutMs(req.headers['risu-timeout-ms'])
    });
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

app.get('/proxy', authenticatedRouteLimiter, asyncRoute(reverseProxyFunc_get));
app.get('/proxy2', authenticatedRouteLimiter, asyncRoute(reverseProxyFunc_get));
app.get('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);

app.post('/proxy', authenticatedRouteLimiter, authBeforeBody(checkProxyAuth), authenticatedBodyParsers, asyncRoute(reverseProxyFunc));
app.post('/proxy2', authenticatedRouteLimiter, authBeforeBody(checkProxyAuth), authenticatedBodyParsers, asyncRoute(reverseProxyFunc));
app.post('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);
app.post('/proxy-stream-jobs', authenticatedRouteLimiter, authBeforeBody(checkProxyAuth), authenticatedBodyParsers, asyncRoute(async (req, res) => {
    if (!await checkProxyAuth(req, res)) {
        return;
    }

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    let url;
    try {
        url = gateProxyUrl(rawUrl, PROXY_JOB_POLICY, false).toString();
    } catch (error) {
        if (!(error instanceof ProxyPolicyError)) {
            throw error;
        }
        if (error.code === 'PROXY_URL_INVALID') {
            res.status(400).send({ error: 'Invalid target URL. Only local network http(s) endpoints are allowed.' });
        } else {
            res.status(error.status).send(policyErrorBody(error));
        }
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
    let headers;
    try {
        headers = sanitizeOutboundHeaders(req.body?.headers ?? {}, { fromBrowser: false, fetchDefaults: false, hasBody: bodyBase64 !== '' });
    } catch (error) {
        if (!(error instanceof InvalidHeaderError)) {
            throw error;
        }
        res.status(400).send({ error: 'Invalid risu-header' });
        return;
    }
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
        wsTicket: job.wsTicket,
        heartbeatSec: job.heartbeatSec
    });
}));

// A name that is not allowed and one that is not set answer identically, so names cannot be probed.
app.post('/api/env-secret', authenticatedRouteLimiter, authBeforeBody(checkProxyAuth), authenticatedBodyParsers, asyncRoute(async (req, res) => {
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
}));

app.delete('/proxy-stream-jobs/:jobId', authenticatedRouteLimiter, asyncRoute(async (req, res) => {
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
}));

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

app.get('/api/test_auth', authRouteLimiter, asyncRoute(async(req, res) => {

    if(!password){
        res.send({status: 'unset'})
    }
    else if(!await checkAuth(req, res, true)){
        res.send({status: 'incorrect'})
    }
    else{
        res.send({status: 'success'})
    }
}))

app.post('/api/login', loginRouteLimiter, publicJsonParser, asyncRoute(async (req, res) => {
    if(password === ''){
        res.status(400).send({error: 'Password not set'})
        return;
    }
    if(typeof req.body?.password !== 'string'){
        res.status(400).send({error: 'Password incorrect'})
        return;
    }
    if(req.body.password && req.body.password.trim() === password.trim()){
        if(typeof req.body.publicKey !== 'object' || req.body.publicKey === null){
            res.status(400).send({error: 'Public key missing or invalid'})
            return;
        }
        knownPublicKeysHashes.push(await hashJSON(req.body.publicKey))
        writeFileSync(knownPublicKeysPath, JSON.stringify(knownPublicKeysHashes), 'utf-8')
        res.send({status:'success'})
    }
    else{
        res.status(400).send({error: 'Password incorrect'})
    }
}))

app.post('/api/crypto', cryptoRouteLimiter, publicJsonParser, asyncRoute(async (req, res) => {
    try {
        const hash = crypto.createHash('sha256')
        hash.update(Buffer.from(req.body.data, 'utf-8'))
        res.send(hash.digest('hex'))
    } catch (error) {
        res.status(500).send({ error: 'Crypto operation failed' });
    }
}))


app.post('/api/set_password', setPasswordRouteLimiter, publicJsonParser, asyncRoute(async (req, res) => {
    if(password === ''){
        if(typeof req.body?.password !== 'string' || req.body.password.trim() === '' || isEmptyPasswordDigest(req.body.password)){
            res.status(400).send({error: 'Password missing or invalid'})
            return;
        }
        password = req.body.password
        writeFileSync(passwordPath, password, 'utf-8')
        res.send({status: 'success'})
    }
    else{
        res.status(400).send("already set")
    }
}))

// Whether a key holds a value, without reading it: the answer of HEAD. It is
// registered before the GET route so express does not serve a HEAD request
// through the GET handler, which reads the whole file. The revision and the
// size are taken under the same per-key lock as the GET route's snapshot, so
// the pair is as consistent as a read's.
app.head('/api/read', storageRouteLimiter, asyncRoute(async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = readPathOfRequest(req, res);
    if(filePath === null){
        return;
    }
    try {
        let currentRevision = 0;
        let size = null;
        await withFileWriteLock(filePath, async () => {
            currentRevision = revisions[filePath] ?? 0;
            const stat = await fs.stat(path.join(savePath, filePath)).catch(() => null);
            if(stat !== null && stat.isFile()){
                size = stat.size;
            }
        });
        res.setHeader('x-risu-revision', String(currentRevision));
        res.setHeader('x-risu-exists', size === null ? '0' : '1');
        res.setHeader('x-risu-size', String(size ?? 0));
        if(size !== null){
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', String(size));
        }
        res.end();
    } catch (error) {
        next(error);
    }
}));

app.get('/api/read', storageRouteLimiter, asyncRoute(async (req, res, next) => {
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
}));

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
app.get('/api/asset/:hex', assetRouteLimiter, asyncRoute(async (req, res) => {
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
}));

// The body of /api/remove and /api/remove-checked. With `guarded` false it is
// the original route: it reads neither the check-only nor the retire headers and
// sets no marker. With `guarded` true it also compares the check-only keys,
// optionally retires the removed keys, and answers what it enforced.
async function handleRemove(req, res, next, guarded){
    if(guarded){
        markGuarded(res);
    }
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

    if(guarded && filePaths.length === 0){
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    for(const filePath of filePaths){
        if (!filePath) {
            res.status(400).send({
                error:'File path required'
            });
            return;
        }
        if(!isHex(filePath) || (guarded && !strictHexPattern.test(filePath))){
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

    // Everything a guarded request asked for is parsed and counted here, before
    // any lock is taken or any file is touched.
    const checkOnly = guarded ? parseCheckOnly(req, filePaths) : NO_CHECK_ONLY;
    if(checkOnly.refusal){
        res.status(400).send(checkOnly.refusal);
        return;
    }
    const retireRequest = guarded ? parseRetire(req, filePaths, checkOnly) : { retire: false };
    if(retireRequest.refusal){
        res.status(400).send(retireRequest.refusal);
        return;
    }
    const ownCondition = guarded
        ? parseOwnCondition(req, ifMatchRevisions.filter((segment) => segment !== '').length)
        : { count: 0 };
    if(ownCondition.refusal){
        res.status(400).send(ownCondition.refusal);
        return;
    }

    try {
        // All locks for every key in this batch are held for the ENTIRE
        // operation below — every precondition is checked first, and only
        // if every single one passes does any file actually get removed.
        // Without this, a batch that conflicts partway through (key 2 of 3,
        // say) would otherwise have already deleted key 1 by the time the
        // conflict is discovered, leaving the caller told "409, failed" while
        // some of the deletion had, in fact, already silently committed.
        const committedRevisions = await withFileWriteLocks([...filePaths, ...checkOnly.paths], async () => {
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
                assertCheckOnly(checkOnly);

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
            if(retireRequest.retire){
                // Retiring forgets the keys' revision entries. It runs only after
                // every file is gone (a removal that failed above retires nothing),
                // while the per-key locks are still held (no write to a removed
                // key can land first), and in the revision transaction like every
                // other revision mutation. The records are appended before the map
                // entries are dropped, so memory never sits below the log.
                await withRevisionTransaction(async () => {
                    try {
                        await appendRetireRecords(filePaths);
                    } catch (appendError) {
                        appendError.committedRevisions = newRevisions;
                        throw appendError;
                    }
                    for(const filePath of filePaths){
                        delete revisions[filePath];
                    }
                    scheduleRevisionCompaction();
                });
            }
            return newRevisions;
        });

        if(guarded){
            res.send({
                success: true,
                revisions: committedRevisions,
                revision: Math.max(...Object.values(committedRevisions)),
                checkOnly: checkOnly.paths.length,
                retired: retireRequest.retire ? filePaths.length : 0,
                ownCondition: ownCondition.count,
            });
            return;
        }
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
}

app.get('/api/remove', storageRouteLimiter, asyncRoute((req, res, next) => handleRemove(req, res, next, false)));
app.get('/api/remove-checked', storageRouteLimiter, asyncRoute((req, res, next) => handleRemove(req, res, next, true)));

// What this server's guarded routes can do. The client reads it by shape.
app.get('/api/caps', storageRouteLimiter, asyncRoute(async (req, res, next) => {
    markGuarded(res);
    if(!await checkAuth(req, res)){
        return;
    }
    res.send({ checkOnly: true, retire: true, pieces: true, listPrefix: true, privateProxy: PROXY_ALLOW_PRIVATE });
}));

// Only whole, even-length hex names are keys. Everything else in the
// directory (write temps `<hex>.tmp-<random>`, the revision snapshot
// `__revisions.json`, its log `__revisions.log` and their temps,
// `__password` and the other `__` files) is not a key. Decoding a `__`
// file gives an empty name; decoding a write temp gives the key it was
// written for, a second copy of an existing key or a phantom one when
// no real file exists.
const keyFileNamePattern = /^(?:[0-9a-fA-F]{2})+$/;

app.get('/api/list', storageRouteLimiter, asyncRoute(async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    try {
        const data = (await fs.readdir(path.join(savePath)))
            .filter((v) => keyFileNamePattern.test(v))
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
}));

// The keys whose hex name starts with `prefix` (even-length hex, empty for all),
// matched case-insensitively against the same key-file filter as /api/list. With
// `count=1` only the number of matching files is answered.
app.get('/api/list-prefix', storageRouteLimiter, asyncRoute(async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const prefix = req.query.prefix;
    if(typeof prefix !== 'string' || !/^(?:[0-9a-fA-F]{2})*$/.test(prefix)){
        res.status(400).send({
            success: false,
            error: 'Invalid prefix'
        });
        return;
    }
    const countOnly = req.query.count === '1';
    const lowerPrefix = prefix.toLowerCase();
    // Optional: only keys whose file holds more than this many bytes, answered
    // with their sizes. Without it the answer is the plain key list.
    const minSizeParameter = req.query['min-size'];
    let minSize = null;
    if(minSizeParameter !== undefined){
        minSize = typeof minSizeParameter === 'string' && /^\d+$/.test(minSizeParameter) ? Number(minSizeParameter) : NaN;
        if(!Number.isSafeInteger(minSize)){
            res.status(400).send({
                success: false,
                error: 'Invalid min-size'
            });
            return;
        }
    }
    try {
        const matching = (await fs.readdir(path.join(savePath)))
            .filter((v) => keyFileNamePattern.test(v) && v.toLowerCase().startsWith(lowerPrefix))
        if(minSize !== null){
            const sizes = await fileSizesWithLimit(matching, LIST_STAT_CONCURRENCY)
            const keptNames = []
            const keptSizes = []
            for(let i = 0; i < matching.length; i++){
                if(sizes[i] > minSize){
                    keptNames.push(matching[i])
                    keptSizes.push(sizes[i])
                }
            }
            if(countOnly){
                res.send({
                    success: true,
                    count: keptNames.length
                });
                return;
            }
            res.send({
                success: true,
                content: keptNames.map((v) => Buffer.from(v, 'hex').toString('utf-8')),
                sizes: keptSizes
            });
            return;
        }
        if(countOnly){
            res.send({
                success: true,
                count: matching.length
            });
            return;
        }
        res.send({
            success: true,
            content: matching.map((v) => Buffer.from(v, 'hex').toString('utf-8'))
        });
    } catch (error) {
        next(error);
    }
}));

// The body of /api/write and /api/write-checked; see handleRemove for what
// `guarded` changes.
async function handleWrite(req, res, next, guarded){
    if(guarded){
        markGuarded(res);
    }
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
    if(guarded && !strictHexPattern.test(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    // Optional: when the client sends this, it's asserting "I last read this
    // key at revision N" and wants the write rejected if that's gone stale —
    // an older client that never sends it gets today's unconditional-write
    // behavior unchanged (back-compat).
    const ifMatchRevisionHeader = req.headers['if-match-revision'];

    const checkOnly = guarded ? parseCheckOnly(req, [filePath]) : NO_CHECK_ONLY;
    if(checkOnly.refusal){
        res.status(400).send(checkOnly.refusal);
        return;
    }
    const ownCondition = guarded
        ? parseOwnCondition(req, ifMatchRevisionHeader !== undefined ? 1 : 0)
        : { count: 0 };
    if(ownCondition.refusal){
        res.status(400).send(ownCondition.refusal);
        return;
    }
    // Without check-only keys this is exactly the single-key lock of the
    // original route.
    const withWriteLocks = checkOnly.paths.length === 0
        ? (fn) => withFileWriteLock(filePath, fn)
        : (fn) => withFileWriteLocks([filePath, ...checkOnly.paths], fn);

    try {
        await withWriteLocks(async () => {
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
                assertCheckOnly(checkOnly);

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

            if(guarded){
                res.send({
                    success: true,
                    revision: newRevision,
                    checkOnly: checkOnly.paths.length,
                    ownCondition: ownCondition.count
                });
                return;
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
                ...(guarded && error.filePath !== undefined ? { filePath: error.filePath } : {}),
                currentRevision: error.currentRevision
            });
            return;
        }
        // Any other failure is answered as JSON: the framework's error page
        // would carry a stack and absolute paths. Absolute paths in the message
        // are rewritten relative to the working directory.
        const errorCode = typeof error?.code === 'string' ? error.code : 'WRITE_FAILED';
        const errorMessage = error instanceof Error ? error.message : String(error);
        const workingDirectory = process.cwd();
        const clientErrorMessage = workingDirectory === path.parse(workingDirectory).root
            ? errorMessage
            : errorMessage.split(workingDirectory).join('.');
        console.error('[Storage] Failed to write item:', {
            key: Buffer.from(filePath, 'hex').toString('utf-8'),
            size: fileContent.byteLength,
            code: errorCode,
            message: errorMessage,
        });
        res.status(errorCode === 'ENOSPC' || errorCode === 'EDQUOT' ? 507 : 500).send({
            error: 'Failed to write storage item',
            code: errorCode,
            message: clientErrorMessage,
        });
    }
}

app.post('/api/write', storageRouteLimiter, authBeforeBody(checkAuth), authenticatedBodyParsers, asyncRoute((req, res, next) => handleWrite(req, res, next, false)));
// The marker goes on before the gate, so a refusal and a too-large answer carry it too.
app.post('/api/write-checked', storageRouteLimiter, (req, res, next) => { markGuarded(res); next(); }, authBeforeBody(checkAuth), authenticatedBodyParsers, asyncRoute((req, res, next) => handleWrite(req, res, next, true)));

// ---------------------------------------------------------------------------
// Chunked asset upload and ranged read.
//
// An upload stages its bytes in `__upload-<id>` beside the keys (the same
// filesystem, so the final rename is atomic). The name is not a key name, so
// no key route reaches it. The in-memory registry is the authority on what an
// upload holds: `ack` is the number of bytes a client may rely on, and every
// operation on one id (append, commit, abort, reaping) runs in that id's
// promise chain, so they never overlap. A commit makes the staged file the
// key's value the way handleWrite does: bump and log the revision first, then
// rename, under the key's write lock. No lock is held while waiting for a
// client, and no staging file outlives its upload: the startup sweep removes
// leftovers and the reaper removes idle uploads.
const LIST_STAT_CONCURRENCY = 16
const uploadIdPattern = /^[0-9a-f]{32}$/
const uploads = new Map()
const uploadTombstones = new Map()

// Sizes of the files named `names` in the save directory (-1 for one that is
// not a file or cannot be read), with at most `limit` stats in flight.
async function fileSizesWithLimit(names, limit){
    const sizes = new Array(names.length).fill(-1)
    let next = 0
    async function worker(){
        while(next < names.length){
            const index = next++
            try {
                const stat = await fs.stat(path.join(savePath, names[index]))
                if(stat.isFile()){
                    sizes[index] = stat.size
                }
            } catch (error) {}
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker))
    return sizes
}

// The lower-case file name of a read request's `file-path`, or null after
// answering 400.
function readPathOfRequest(req, res){
    const filePath = req.headers['file-path']
    if(!filePath){
        res.status(400).send({
            error:'File path required'
        })
        return null
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        })
        return null
    }
    return filePath.toLowerCase()
}

function nonNegativeIntegerHeader(req, name){
    const value = req.headers[name]
    if(typeof value !== 'string' || !/^\d+$/.test(value)){
        return null
    }
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : null
}

// The upload id of a request, or null after answering 400.
function uploadIdOfRequest(req, res){
    const id = req.headers['upload-id']
    if(typeof id !== 'string' || !uploadIdPattern.test(id)){
        res.status(400).send({ error: 'Invalid upload id', code: 'upload-id' })
        return null
    }
    return id
}

function runInUploadChain(entry, fn){
    const result = entry.chain.then(fn)
    entry.chain = result.then(() => undefined, () => undefined)
    return result
}

// Runs for every upload request before its body is read: the arrival counts
// as use, and the upload is marked in flight until the response ends, so
// eviction and the reaper never take an upload a request is working on.
function trackUploadArrival(req, res, next){
    const id = req.headers['upload-id']
    const entry = typeof id === 'string' ? uploads.get(id) : undefined
    if(entry !== undefined){
        entry.lastTouch = Date.now()
        entry.inFlight++
        res.once('close', () => {
            entry.inFlight--
        })
    }
    next()
}

function uploadGoneAnswer(){
    return { status: 410, body: { error: 'Upload is gone', code: 'upload-gone' } }
}

function uploadFailureAnswer(error, what){
    const errorCode = typeof error?.code === 'string' ? error.code : 'WRITE_FAILED'
    const errorMessage = error instanceof Error ? error.message : String(error)
    const workingDirectory = process.cwd()
    const clientErrorMessage = workingDirectory === path.parse(workingDirectory).root
        ? errorMessage
        : errorMessage.split(workingDirectory).join('.')
    console.error(`[Storage] ${what}:`, { code: errorCode, message: errorMessage })
    return {
        status: errorCode === 'ENOSPC' || errorCode === 'EDQUOT' ? 507 : 500,
        body: { error: what, code: errorCode, message: clientErrorMessage },
    }
}

function sendUploadAnswer(res, answer){
    res.status(answer.status).send(answer.body)
}

function stagedBytesTotal(){
    let total = 0
    for(const entry of uploads.values()){
        total += entry.ack + entry.reserved
    }
    return total
}

// Frees staged bytes by dropping uploads no request is using and nobody has
// touched for UPLOAD_EVICT_IDLE_MS, least recently touched first, until
// `neededBytes` more fit under the cap. The registry entry goes first and in
// the same turn as the in-flight check, with no await between, so a request
// arriving afterwards finds no upload (410) instead of one whose file is being
// unlinked. The unlink is not awaited and no other id's chain is waited for.
function evictIdleUploads(neededBytes){
    const now = Date.now()
    const candidates = [...uploads.entries()]
        .filter(([, entry]) => entry.inFlight === 0 && now - entry.lastTouch > UPLOAD_EVICT_IDLE_MS)
        .sort((a, b) => a[1].lastTouch - b[1].lastTouch)
    for(const [id, entry] of candidates){
        if(stagedBytesTotal() + neededBytes <= UPLOAD_STAGED_CAP_BYTES){
            break
        }
        uploads.delete(id)
        fs.unlink(entry.stagingPath).catch(() => {})
    }
}

// Holds `bytes` of the cap for an append, synchronously. False when the cap
// cannot be met even after eviction.
function reserveStagedBytes(entry, bytes){
    if(stagedBytesTotal() + bytes > UPLOAD_STAGED_CAP_BYTES){
        evictIdleUploads(bytes)
        if(stagedBytesTotal() + bytes > UPLOAD_STAGED_CAP_BYTES){
            return false
        }
    }
    entry.reserved += bytes
    return true
}

const uploadReapTimer = setInterval(() => {
    const now = Date.now()
    for(const [id, entry] of uploads){
        if(entry.inFlight === 0 && now - entry.lastTouch > UPLOAD_IDLE_REAP_MS){
            runInUploadChain(entry, async () => {
                if(uploads.get(id) !== entry || entry.inFlight > 0 || Date.now() - entry.lastTouch <= UPLOAD_IDLE_REAP_MS){
                    return
                }
                uploads.delete(id)
                await fs.unlink(entry.stagingPath).catch(() => {})
            }).catch(() => {})
        }
    }
}, Math.max(20, Math.min(60000, Math.floor(UPLOAD_IDLE_REAP_MS / 4))))
uploadReapTimer.unref()

app.post('/api/upload/begin', storageRouteLimiter, asyncRoute(async (req, res) => {
    if(!await checkAuth(req, res)){
        return
    }
    const id = crypto.randomBytes(16).toString('hex')
    const stagingPath = path.join(savePath, `__upload-${id}`)
    try {
        await fs.writeFile(stagingPath, '', { flag: 'wx' })
    } catch (error) {
        sendUploadAnswer(res, uploadFailureAnswer(error, 'Failed to start upload'))
        return
    }
    uploads.set(id, { stagingPath, ack: 0, reserved: 0, lastTouch: Date.now(), inFlight: 0, chain: Promise.resolve() })
    res.send({ id })
}))

// One append, in the upload's chain. A chunk at `ack` is written there and
// extends `ack`; the chunk that ends exactly at `ack` is a replay of the last
// one and is answered with `ack` once its bytes match what is staged; any
// other offset is refused with `ack` so the client can resume.
async function appendInChain(id, entry, offset, chunk){
    if(uploads.get(id) !== entry){
        return uploadGoneAnswer()
    }
    entry.lastTouch = Date.now()
    if(offset === entry.ack){
        if(entry.ack + chunk.length > UPLOAD_ASSET_LIMIT_BYTES){
            return { status: 413, body: {
                error: 'Asset is too large',
                code: 'PAYLOAD_TOO_LARGE',
                message: `Assets are limited to ${UPLOAD_ASSET_LIMIT_BYTES} bytes.`,
            } }
        }
        let handle
        let failure = null
        try {
            // No create flag: a staging file removed behind the registry must
            // not come back as an empty file under a non-zero `ack`.
            handle = await fs.open(entry.stagingPath, 'r+')
            let written = 0
            while(written < chunk.length){
                const { bytesWritten } = await handle.write(chunk, written, chunk.length - written, offset + written)
                written += bytesWritten
            }
        } catch (error) {
            failure = error
        } finally {
            await handle?.close().catch(() => {})
        }
        if(failure !== null){
            if(handle === undefined && failure?.code === 'ENOENT'){
                uploads.delete(id)
                return uploadGoneAnswer()
            }
            await fs.truncate(entry.stagingPath, entry.ack).catch(() => {})
            return uploadFailureAnswer(failure, 'Failed to write upload chunk')
        }
        entry.ack += chunk.length
        return { status: 200, body: { success: true, size: entry.ack } }
    }
    if(offset < entry.ack && offset + chunk.length === entry.ack){
        let handle
        try {
            handle = await fs.open(entry.stagingPath, 'r')
            const staged = Buffer.alloc(chunk.length)
            let filled = 0
            while(filled < staged.length){
                const { bytesRead } = await handle.read(staged, filled, staged.length - filled, offset + filled)
                if(bytesRead === 0){
                    break
                }
                filled += bytesRead
            }
            if(filled === staged.length && staged.equals(chunk)){
                return { status: 200, body: { success: true, size: entry.ack } }
            }
        } catch (error) {
            if(handle === undefined && error?.code === 'ENOENT'){
                uploads.delete(id)
                return uploadGoneAnswer()
            }
            return uploadFailureAnswer(error, 'Failed to compare upload chunk')
        } finally {
            await handle?.close().catch(() => {})
        }
    }
    return { status: 409, body: { error: 'Upload offset mismatch', code: 'upload-offset', size: entry.ack } }
}

app.post('/api/upload/append', storageRouteLimiter, authBeforeBody(checkAuth), uploadChunkParser, asyncRoute(async (req, res) => {
    if(!await checkAuth(req, res)){
        return
    }
    const id = uploadIdOfRequest(req, res)
    if(id === null){
        return
    }
    const offset = nonNegativeIntegerHeader(req, 'upload-offset')
    if(offset === null){
        res.status(400).send({ error: 'upload-offset is required and must be a non-negative integer', code: 'upload-offset' })
        return
    }
    const chunk = req.body
    if(!Buffer.isBuffer(chunk)){
        res.status(400).send({ error: 'An upload chunk is required', code: 'upload-body' })
        return
    }
    const entry = uploads.get(id)
    if(entry === undefined){
        sendUploadAnswer(res, uploadGoneAnswer())
        return
    }
    // Only a chunk that would extend the upload takes cap space, and it takes
    // it now, before any await: appends that arrive together cannot all pass
    // the check against the same free space. A replay or a stale offset writes
    // nothing and reserves nothing.
    let reserved = 0
    if(offset === entry.ack + entry.reserved && chunk.length > 0){
        if(!reserveStagedBytes(entry, chunk.length)){
            res.status(503).send({ error: 'The server is holding too many staged upload bytes', code: 'upload-capacity' })
            return
        }
        reserved = chunk.length
    }
    try {
        sendUploadAnswer(res, await runInUploadChain(entry, () => appendInChain(id, entry, offset, chunk)))
    } catch (error) {
        sendUploadAnswer(res, uploadFailureAnswer(error, 'Failed to write upload chunk'))
    } finally {
        entry.reserved -= reserved
    }
}))

// Bumps and logs `filePath`'s revision the way handleWrite does for an
// unconditional write; the caller holds the key's write lock.
function bumpRevisionForUpload(filePath){
    return withRevisionTransaction(async () => {
        const currentRevision = revisions[filePath] ?? 0
        const bumped = currentRevision + 1
        revisions[filePath] = bumped
        try {
            await appendRevisionRecords([filePath])
        } catch (saveError) {
            revisions[filePath] = currentRevision
            throw saveError
        }
        scheduleRevisionCompaction()
        return bumped
    })
}

// The answer of a commit for an upload no longer in the registry: the first
// success again when it was committed under this key and size moments ago.
function committedOrGoneAnswer(id, finalName, size){
    const tombstone = uploadTombstones.get(id)
    if(tombstone !== undefined && tombstone.key === finalName && tombstone.size === size){
        return { status: 200, body: tombstone.body }
    }
    return uploadGoneAnswer()
}

async function commitInChain(id, entry, finalName, size, ifAbsent){
    if(uploads.get(id) !== entry){
        return committedOrGoneAnswer(id, finalName, size)
    }
    entry.lastTouch = Date.now()
    if(size !== entry.ack){
        return { status: 409, body: { error: 'Upload size mismatch', code: 'upload-size', size: entry.ack } }
    }
    // The registry says what was acknowledged; the file must agree before it
    // becomes a value.
    let stagedSize
    try {
        const handle = await fs.open(entry.stagingPath, 'r')
        try {
            stagedSize = (await handle.stat()).size
        } finally {
            await handle.close()
        }
    } catch (error) {
        if(error?.code === 'ENOENT'){
            uploads.delete(id)
            return uploadGoneAnswer()
        }
        return uploadFailureAnswer(error, 'Failed to commit upload')
    }
    if(stagedSize !== entry.ack || stagedSize !== size){
        return { status: 409, body: { error: 'Upload size mismatch', code: 'upload-size', size: stagedSize } }
    }
    const finalPath = path.join(savePath, finalName)
    let body
    try {
        body = await withFileWriteLock(finalName, async () => {
            if(ifAbsent){
                const existing = await fs.stat(finalPath).catch(() => null)
                if(existing !== null && existing.isFile()){
                    await fs.unlink(entry.stagingPath).catch(() => {})
                    return { kept: true, revision: revisions[finalName] ?? 0 }
                }
            }
            // Revision before content, as in handleWrite: a crash or a failed
            // rename leaves a bumped revision over the old, intact value.
            const newRevision = await bumpRevisionForUpload(finalName)
            try {
                await fs.rename(entry.stagingPath, finalPath)
            } catch (error) {
                await fs.unlink(entry.stagingPath).catch(() => {})
                error.stagingRemoved = true
                throw error
            }
            return { success: true, revision: newRevision }
        })
    } catch (error) {
        if(error?.stagingRemoved === true){
            uploads.delete(id)
        }
        return uploadFailureAnswer(error, 'Failed to commit upload')
    }
    uploads.delete(id)
    uploadTombstones.set(id, { key: finalName, size, body })
    setTimeout(() => {
        uploadTombstones.delete(id)
    }, UPLOAD_TOMBSTONE_MS).unref()
    return { status: 200, body }
}

app.post('/api/upload/commit', storageRouteLimiter, asyncRoute(async (req, res) => {
    if(!await checkAuth(req, res)){
        return
    }
    const id = uploadIdOfRequest(req, res)
    if(id === null){
        return
    }
    const rawPath = req.headers['file-path']
    if(typeof rawPath !== 'string' || assetKeyFromHex(rawPath) === null){
        res.status(400).send({ error: 'Invaild Path' })
        return
    }
    const finalName = rawPath.toLowerCase()
    const size = nonNegativeIntegerHeader(req, 'upload-size')
    if(size === null){
        res.status(400).send({ error: 'upload-size is required and must be a non-negative integer', code: 'upload-size' })
        return
    }
    const ifAbsent = req.headers['upload-if-absent'] === '1'
    const entry = uploads.get(id)
    if(entry === undefined){
        sendUploadAnswer(res, committedOrGoneAnswer(id, finalName, size))
        return
    }
    try {
        sendUploadAnswer(res, await runInUploadChain(entry, () => commitInChain(id, entry, finalName, size, ifAbsent)))
    } catch (error) {
        sendUploadAnswer(res, uploadFailureAnswer(error, 'Failed to commit upload'))
    }
}))

app.post('/api/upload/abort', storageRouteLimiter, asyncRoute(async (req, res) => {
    if(!await checkAuth(req, res)){
        return
    }
    const id = uploadIdOfRequest(req, res)
    if(id === null){
        return
    }
    const entry = uploads.get(id)
    if(entry !== undefined){
        await runInUploadChain(entry, async () => {
            if(uploads.get(id) !== entry){
                return
            }
            uploads.delete(id)
            await fs.unlink(entry.stagingPath).catch(() => {})
        })
    }
    res.send({ success: true })
}))

// One bounded piece of a stored asset (or inlay body) and the facts a reader
// needs to assemble pieces: the revision, the whole size and whether the key
// holds a value. All of it is taken under the key's write lock, so each piece's
// revision belongs to the bytes in it; the lock covers one bounded read, never
// the client's pace.
app.get('/api/read-range', storageRouteLimiter, asyncRoute(async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return
    }
    const rawPath = req.headers['file-path']
    if(typeof rawPath !== 'string' || assetKeyFromHex(rawPath) === null){
        res.status(400).send({ error: 'Invaild Path' })
        return
    }
    const filePath = rawPath.toLowerCase()
    const start = nonNegativeIntegerHeader(req, 'range-start')
    const length = nonNegativeIntegerHeader(req, 'range-length')
    if(start === null || length === null || length < 1 || length > UPLOAD_CHUNK_MAX_BYTES){
        res.status(400).send({ error: 'Invalid range' })
        return
    }
    try {
        let currentRevision = 0
        let size = null
        let bytes = Buffer.alloc(0)
        await withFileWriteLock(filePath, async () => {
            currentRevision = revisions[filePath] ?? 0
            let handle
            try {
                handle = await fs.open(path.join(savePath, filePath), 'r')
            } catch (error) {
                if(error?.code === 'ENOENT'){
                    return
                }
                throw error
            }
            try {
                const stat = await handle.stat()
                size = stat.size
                const wanted = Math.max(0, Math.min(length, size - start))
                if(wanted > 0){
                    const buffer = Buffer.alloc(wanted)
                    let filled = 0
                    while(filled < wanted){
                        const { bytesRead } = await handle.read(buffer, filled, wanted - filled, start + filled)
                        if(bytesRead === 0){
                            break
                        }
                        filled += bytesRead
                    }
                    bytes = buffer.subarray(0, filled)
                }
            } finally {
                await handle.close().catch(() => {})
            }
        })
        res.setHeader('x-risu-revision', String(currentRevision))
        res.setHeader('x-risu-size', String(size ?? 0))
        res.setHeader('x-risu-exists', size === null ? '0' : '1')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(bytes)
    } catch (error) {
        next(error)
    }
}))

// A body over a parser's limit is refused before the route handler runs, so it
// is answered here, as JSON and without the framework's error page (which
// carries a stack and absolute paths). A route-level parser's error reaches only
// handlers registered after that route, so this stays after the last route.
// /api/write-checked is a guarded route and keeps its marker on the answer.
app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large' && req.path === '/api/upload/append') {
        res.status(413).send({
            error: 'Upload chunk is too large',
            code: 'PAYLOAD_TOO_LARGE',
            message: `Upload chunks are limited to ${UPLOAD_CHUNK_MAX_BYTES} bytes.`,
        });
        return;
    }
    if (error?.type === 'entity.too.large' && (req.path === '/api/write' || req.path === '/api/write-checked')) {
        console.error('[Storage] Rejected oversized request:', {
            size: error.length,
            limit: error.limit,
        });
        if (req.path === '/api/write-checked') {
            markGuarded(res);
        }
        res.status(413).send({
            error: 'Storage payload is too large',
            code: 'PAYLOAD_TOO_LARGE',
            message: `Storage writes are limited to ${NODE_BODY_LIMIT_BYTES / (1024 * 1024)} MiB.`,
        });
        return;
    }
    if (error?.type === 'entity.too.large') {
        res.status(413).send({
            error: 'Request body is too large',
            code: 'PAYLOAD_TOO_LARGE',
        });
        return;
    }
    // Any other failure: a client-caused one (a body that does not parse) keeps
    // its 4xx status, the rest is a 500. The answer is JSON with no stack, one
    // line is logged, and headers already set (the guarded marker) stay.
    console.error(`[Server] ${req.method} ${req.path} failed: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
    if (res.headersSent) {
        res.destroy();
        return;
    }
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).send({
        error: status === 500 ? 'Internal Server Error' : (error?.type === 'entity.parse.failed' ? 'Invalid request body' : (http.STATUS_CODES[status] ?? 'Bad Request')),
    });
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

function wsTicketMatches(expected, given) {
    const expectedBytes = Buffer.from(expected, 'utf8');
    const givenBytes = Buffer.from(given, 'utf8');
    return expectedBytes.length === givenBytes.length && crypto.timingSafeEqual(expectedBytes, givenBytes);
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

            const pathParts = reqUrl.pathname.split('/').filter(Boolean);
            const jobId = pathParts.length >= 3 ? pathParts[1] : '';
            const job = proxyStreamJobs.get(jobId);
            // The job's own ticket opens only that job. A request without one
            // still presents the general token, as before.
            const ticket = reqUrl.searchParams.get('ticket');
            const authorized = ticket !== null
                ? job !== undefined && wsTicketMatches(job.wsTicket, ticket)
                : await isAuthorizedProxyRequest({ headers: { 'risu-auth': reqUrl.searchParams.get('risu-auth') || req.headers['risu-auth'] } });
            if (!authorized) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            if (!job) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return;
            }
            if (job.clients.size >= PROXY_STREAM_MAX_CLIENTS_PER_JOB) {
                socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
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
        const versionWarning = nodeVersionWarning(process.versions.node);
        if (versionWarning) {
            console.warn(`[Server] WARNING: ${versionWarning}`);
        }
        if (isEmptyPasswordDigest(password)) {
            console.warn('[Server] WARNING: save/__password holds the digest of an empty password, so anyone who can reach this server can sign in without a password. To set a new one, stop the server, delete save/__password, start it again and set the password from the app.');
        }
        const port = process.env.PORT || 6001;
        // HOST narrows the address the server binds; unset, it listens on every interface.
        const host = (process.env.HOST || '').trim();
        const listenArguments = host === '' ? [port] : [port, host];
        const httpsOptions = await getHttpsOptions();
        let server = null;

        if (httpsOptions) {
            // HTTPS
            server = https.createServer(httpsOptions, app);
            setupProxyStreamWebSocket(server);
            server.listen(...listenArguments, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
            });
        } else {
            // HTTP
            server = http.createServer(app);
            setupProxyStreamWebSocket(server);
            server.listen(...listenArguments, () => {
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
            // A done job is retired once its grace has passed, whether or not
            // sockets still follow it; they are closed with it.
            if (job.done && job.cleanupAt > 0 && now >= job.cleanupAt) {
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
