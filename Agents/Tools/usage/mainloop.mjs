/**
 * Deterministic main-loop usage telemetry over frozen transcript snapshots.
 *
 * Re-derives the trigger grouping of the supplied usage-full mainloop script, with two
 * corrections: the tools of one provider message/request tuple are unioned over every block
 * of that tuple (a usage-free or repeated-usage block no longer loses its tool calls), and
 * the call stays bound to the turn that was open when the tuple first appeared.
 *
 * Contract:
 *  - Inputs are named by a manifest: UTC window [since, until), per-input SHA-256 and byte
 *    length, parser identity. A changed or missing input is rejected, never analysed.
 *  - The analytical output is a pure function of (frozen bytes, manifest, parser version,
 *    options): canonical key order, rounded numbers, no clock, no paths, no environment.
 *    Capture time and runtime identity live in a separate envelope.
 *  - Diagnostics carry only allowlisted reason codes, opaque source aliases, counts and
 *    event ordinals. No transcript text, raw provider id or local path is ever emitted,
 *    including in error messages.
 *
 * CLI:
 *   node mainloop.mjs capture --root DIR --since ISO --until ISO --out MANIFEST FILE...
 *   node mainloop.mjs analyze --manifest MANIFEST --root DIR --out RESULT [--envelope FILE]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PARSER_NAME = 'mainloop'
export const PARSER_VERSION = '1.0.0'
export const MANIFEST_SCHEMA = 'mainloop-manifest/1'
export const RESULT_SCHEMA = 'mainloop-analysis/1'
export const ATTRIBUTIONS = ['union', 'legacy-first-block']
export const MAX_DIAGNOSTIC_ITEMS = 200

// Per-million-token prices [input, output] of the compared report; cache write 1.25x, read 0.1x input.
const PRICE = { opus: [5, 25], sonnet: [2, 10], haiku: [1, 5], fable: [5, 25], other: [5, 25] }
const family = model => /opus/.test(model) ? 'opus' : /sonnet/.test(model) ? 'sonnet' : /haiku/.test(model) ? 'haiku' : /fable/.test(model) ? 'fable' : 'other'

export const REASON_CODES = Object.freeze([
    'malformed-line', 'missing-timestamp', 'missing-id', 'missing-tool-id', 'duplicate-tool-id',
    'usage-conflict', 'usage-repeat', 'tuple-without-usage', 'synthetic-skipped',
    'boundary-straddle', 'turn-straddles-since', 'cross-transcript-collision', 'collision-usage-conflict',
])
const CODE_SET = new Set(REASON_CODES)

const ALIAS_RE = /^src-\d{3}$/
const SHA_RE = /^[0-9a-f]{64}$/
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const MANIFEST_KEYS = ['schema', 'since', 'until', 'parser', 'options', 'inputs']
const OPTION_KEYS = ['attribution', 'totalWeighted']
const INPUT_KEYS = ['alias', 'file', 'sha256', 'bytes']

/** Error whose message is only an allowlisted code plus an opaque alias; never data. */
export class MainloopError extends Error {
    constructor(code, ref) {
        super(ref === undefined ? code : `${code} ${ref}`)
        this.name = 'MainloopError'
        this.code = code
        this.ref = ref
    }
}

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')

function round(n) {
    const r = Number(n.toFixed(6))
    return Object.is(r, -0) ? 0 : r
}

/** JSON with recursively sorted keys; floats are rounded before they reach it. */
export function canonicalJson(value) {
    const norm = v => {
        if (Array.isArray(v)) return v.map(norm)
        if (v && typeof v === 'object') {
            const o = {}
            for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = norm(v[k])
            return o
        }
        if (typeof v === 'number') {
            if (!Number.isFinite(v)) throw new MainloopError('non-finite-number')
            return round(v)
        }
        return v
    }
    return JSON.stringify(norm(value), null, 1) + '\n'
}

const hasOnly = (obj, keys) => Object.keys(obj).every(k => keys.includes(k))
const isUtc = s => typeof s === 'string' && UTC_RE.test(s) && Number.isFinite(Date.parse(s))
const safeRelative = f => typeof f === 'string' && f.length > 0 && f.length < 260 && !path.isAbsolute(f) && !/^[A-Za-z]:/.test(f) &&
    !f.split(/[\\/]/).some(p => p === '..' || p === '')

/** Returns an array of {code, ref} problems; ref is a fixed field name or an input index. */
export function validateManifest(m) {
    const bad = []
    const add = (code, ref) => bad.push({ code, ref })
    if (!m || typeof m !== 'object' || Array.isArray(m)) return [{ code: 'manifest-shape', ref: 'manifest' }]
    if (!hasOnly(m, MANIFEST_KEYS)) add('unknown-manifest-key', 'manifest')
    if (m.schema !== MANIFEST_SCHEMA) add('bad-schema', 'schema')
    if (!isUtc(m.since)) add('bad-utc', 'since')
    if (!isUtc(m.until)) add('bad-utc', 'until')
    if (isUtc(m.since) && isUtc(m.until) && !(Date.parse(m.since) < Date.parse(m.until))) add('empty-window', 'window')
    const p = m.parser
    if (!p || typeof p !== 'object' || p.name !== PARSER_NAME || p.version !== PARSER_VERSION || !hasOnly(p, ['name', 'version'])) add('parser-mismatch', 'parser')
    const o = m.options
    if (!o || typeof o !== 'object' || Array.isArray(o)) add('bad-options', 'options')
    else {
        if (!hasOnly(o, OPTION_KEYS)) add('unknown-option', 'options')
        if (!ATTRIBUTIONS.includes(o.attribution)) add('bad-option-value', 'attribution')
        if (o.totalWeighted !== undefined && !(typeof o.totalWeighted === 'number' && Number.isFinite(o.totalWeighted) && o.totalWeighted > 0)) add('bad-option-value', 'totalWeighted')
    }
    if (!Array.isArray(m.inputs) || m.inputs.length === 0) add('no-inputs', 'inputs')
    else {
        const aliases = new Set(); const files = new Set()
        m.inputs.forEach((x, i) => {
            if (!x || typeof x !== 'object' || !hasOnly(x, INPUT_KEYS)) return add('bad-input', i)
            if (typeof x.alias !== 'string' || !ALIAS_RE.test(x.alias)) add('bad-alias', i)
            else if (aliases.has(x.alias)) add('duplicate-alias', i)
            else aliases.add(x.alias)
            if (!safeRelative(x.file)) add('bad-file', i)
            else if (files.has(x.file)) add('duplicate-file', i)
            else files.add(x.file)
            if (typeof x.sha256 !== 'string' || !SHA_RE.test(x.sha256)) add('bad-hash', i)
            if (!Number.isSafeInteger(x.bytes) || x.bytes < 0) add('bad-bytes', i)
        })
    }
    return bad
}

function assertManifest(m) {
    const bad = validateManifest(m)
    if (bad.length) throw new MainloopError('invalid-manifest', bad.map(b => `${b.code}:${b.ref}`).join(','))
}

/** Hash the bytes of the named files and build a manifest. Does not copy the files anywhere. */
export function captureManifest({ root, files, since, until, options = {} }) {
    const sorted = [...files].sort()
    const inputs = sorted.map((file, i) => {
        let buf
        try { buf = fs.readFileSync(path.resolve(root, file)) } catch { throw new MainloopError('snapshot-missing', `src-${String(i + 1).padStart(3, '0')}`) }
        return { alias: `src-${String(i + 1).padStart(3, '0')}`, file, sha256: sha256(buf), bytes: buf.length }
    })
    const manifest = {
        schema: MANIFEST_SCHEMA, since, until, parser: { name: PARSER_NAME, version: PARSER_VERSION },
        options: { attribution: 'union', ...options }, inputs,
    }
    assertManifest(manifest)
    return manifest
}

/** Read every manifest input and reject missing, resized or changed bytes. Returns [{alias, text}]. */
export function loadSnapshot(manifest, root) {
    assertManifest(manifest)
    return [...manifest.inputs].sort((a, b) => a.alias < b.alias ? -1 : 1).map(x => {
        let buf
        try { buf = fs.readFileSync(path.resolve(root, x.file)) } catch { throw new MainloopError('snapshot-missing', x.alias) }
        if (buf.length !== x.bytes || sha256(buf) !== x.sha256) throw new MainloopError('snapshot-changed', x.alias)
        return { alias: x.alias, text: buf.toString('utf8') }
    })
}

function classify(content) {
    const s = typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter(b => b && b.type === 'text').map(b => b.text).join('\n')
    if (/This session is being continued from a previous conversation/.test(s)) return 'compact-summary'
    if (/<task-notification/.test(s)) return 'task-notification'
    if (/<cross-session-message/.test(s)) return 'cross-session'
    if (/<side-sessions-event/.test(s)) return 'side-sessions'
    if (/<command-name>|<local-command/.test(s)) return 'local-command'
    if (/^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(s)) return 'reminder-only'
    return 'maintainer'
}

const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0
const usageOf = u => ({ in: num(u.input_tokens), cw: num(u.cache_creation_input_tokens), cr: num(u.cache_read_input_tokens), out: num(u.output_tokens) })
const sameUsage = (a, b) => a.in === b.in && a.cw === b.cw && a.cr === b.cr && a.out === b.out

/** One transcript: build turns and provider message/request tuples in file order. */
function scan(alias, text, diag) {
    const turns = []; const tuples = new Map(); let anon = 0
    const newTurn = (cls, ts) => { const t = { cls, startTs: ts, calls: 0, cost: 0, out: 0, tools: 0, firstCw: 0, firstCost: 0 }; turns.push(t); return t }
    let trig = newTurn('start', NaN); let busy = false
    const midTurn = {}; let compactions = 0; let autoCompactions = 0
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const ord = i + 1
        const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i]
        if (line.length < 20) continue
        let e
        try { e = JSON.parse(line) } catch { diag.add('malformed-line', alias, ord); continue }
        if (!e || typeof e !== 'object') { diag.add('malformed-line', alias, ord); continue }
        const ts = Date.parse(e.timestamp || '')
        if (e.type === 'system' && e.subtype === 'compact_boundary') {
            compactions++; if (e.compactMetadata && e.compactMetadata.trigger === 'auto') autoCompactions++
            continue
        }
        if (e.type === 'user' && e.message) {
            const c = e.message.content
            if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) { busy = true; continue }
            if (e.isMeta) { const cl = classify(c); if (!['cross-session', 'side-sessions', 'task-notification'].includes(cl)) continue }
            const cl0 = classify(c)
            if (busy) { midTurn[cl0] = (midTurn[cl0] || 0) + 1; continue }
            trig = newTurn(cl0, ts)
            continue
        }
        if (e.type !== 'assistant' || !e.message) continue
        busy = false
        const blocks = Array.isArray(e.message.content) ? e.message.content : []
        const toolBlocks = blocks.filter(b => b && b.type === 'tool_use')
        if (toolBlocks.length) busy = true
        const msgId = typeof e.message.id === 'string' ? e.message.id : ''
        const reqId = typeof e.requestId === 'string' ? e.requestId : ''
        let key
        if (!msgId && !reqId) { key = `#${anon++}`; diag.add('missing-id', alias, ord) } else {
            key = `${msgId}\u0000${reqId}`
            if (!msgId || !reqId) diag.add('missing-id', alias, ord)
        }
        let t = tuples.get(key)
        if (!t) {
            t = { alias, key, keyed: !key.startsWith('#'), firstOrd: ord, turn: trig, tsFirst: ts, tsLast: ts, tools: new Set(), usage: null, legacyTools: 0, model: '?', conflict: false }
            tuples.set(key, t)
        }
        if (Number.isFinite(ts)) { if (!Number.isFinite(t.tsFirst) || ts < t.tsFirst) t.tsFirst = ts; if (!Number.isFinite(t.tsLast) || ts > t.tsLast) t.tsLast = ts }
        for (const b of toolBlocks) {
            if (typeof b.id !== 'string' || !b.id) { diag.add('missing-tool-id', alias, ord); continue }
            if (t.tools.has(b.id)) diag.add('duplicate-tool-id', alias, ord)
            else t.tools.add(b.id)
        }
        const u = e.message.usage
        if (u && typeof u === 'object') {
            const r = usageOf(u)
            if (!t.usage) {
                t.usage = r; t.usageOrd = ord; t.usageTs = ts; t.legacyTools = toolBlocks.length
                t.model = typeof e.message.model === 'string' ? e.message.model : '?'
            } else if (sameUsage(t.usage, r)) diag.add('usage-repeat', alias, ord)
            else { t.conflict = true; diag.add('usage-conflict', alias, ord) }
        }
    }
    return { alias, turns, tuples: [...tuples.values()], midTurn, compactions, autoCompactions }
}

class Diagnostics {
    constructor() { this.counts = Object.create(null); this.items = [] }
    add(code, src, ord) {
        if (!CODE_SET.has(code)) throw new MainloopError('unknown-reason-code')
        this.counts[code] = (this.counts[code] || 0) + 1
        this.items.push({ code, src, ord })
    }
    report() {
        const items = [...this.items].sort((a, b) => a.src < b.src ? -1 : a.src > b.src ? 1 : a.ord - b.ord || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
        const counts = {}; for (const k of Object.keys(this.counts).sort()) counts[k] = this.counts[k]
        return { counts, items: items.slice(0, MAX_DIAGNOSTIC_ITEMS), itemsTruncated: items.length > MAX_DIAGNOSTIC_ITEMS }
    }
}

/**
 * Pure analysis of already-verified inputs [{alias, text}] under a validated manifest.
 * Attribution 'union' ORs every block of a tuple; 'legacy-first-block' keeps only the tools of the
 * first usage-bearing block (the superseded attribution) on the same turn binding, for before/after runs.
 */
export function analyze(manifest, inputs) {
    assertManifest(manifest)
    const sinceMs = Date.parse(manifest.since); const untilMs = Date.parse(manifest.until)
    const inWin = ts => ts >= sinceMs && ts < untilMs
    const legacy = manifest.options.attribution === 'legacy-first-block'
    const diag = new Diagnostics()
    const sources = [...inputs].sort((a, b) => a.alias < b.alias ? -1 : 1).map(x => scan(x.alias, x.text, diag))

    const tok = { in: 0, cw: 0, cr: 0, out: 0 }
    let calls = 0; let tools = 0; let cost = 0; let collisions = 0
    const midTurn = {}; let compactions = 0; let autoCompactions = 0
    const owners = new Map()
    for (const s of sources) {
        for (const [k, v] of Object.entries(s.midTurn)) midTurn[k] = (midTurn[k] || 0) + v
        compactions += s.compactions; autoCompactions += s.autoCompactions
        const ordered = s.tuples.filter(t => t.usage).sort((a, b) => a.usageOrd - b.usageOrd)
        for (const t of s.tuples) if (!t.usage && t.tools.size) diag.add('tuple-without-usage', s.alias, t.firstOrd)
        for (const t of ordered) {
            if (!Number.isFinite(t.usageTs)) { diag.add('missing-timestamp', s.alias, t.usageOrd); continue }
            if (t.model === '<synthetic>') { diag.add('synthetic-skipped', s.alias, t.usageOrd); continue }
            if (t.keyed) {
                const o = owners.get(t.key) || []; o.push({ alias: s.alias, usage: t.usage, ord: t.usageOrd }); owners.set(t.key, o)
            }
            const win = inWin(t.usageTs)
            if (inWin(t.tsFirst) !== inWin(t.tsLast) || inWin(t.tsFirst) !== win) diag.add('boundary-straddle', s.alias, t.usageOrd)
            if (!win) continue
            const [pi, po] = PRICE[family(t.model)]
            const r = t.usage
            const c = (r.in * pi + r.cw * pi * 1.25 + r.cr * pi * 0.1 + r.out * po) / 1e6
            const nTool = legacy ? t.legacyTools : t.tools.size
            const tr = t.turn
            if (tr.calls === 0) { tr.firstCw = r.cw; tr.firstCost = c }
            tr.calls++; tr.cost += c; tr.out += r.out; tr.tools += nTool
            if (Number.isFinite(tr.startTs) && !inWin(tr.startTs)) tr.straddle = true
            tok.in += r.in; tok.cw += r.cw; tok.cr += r.cr; tok.out += r.out
            calls++; tools += nTool; cost += c
        }
    }
    for (const list of owners.values()) {
        if (list.length < 2) continue
        for (const x of list.slice(1)) {
            collisions++
            diag.add('cross-transcript-collision', x.alias, x.ord)
            if (!sameUsage(list[0].usage, x.usage)) diag.add('collision-usage-conflict', x.alias, x.ord)
        }
    }

    const agg = new Map(); const sizes = new Map(); let turnCount = 0
    for (const s of sources) for (const t of s.turns) {
        const started = Number.isFinite(t.startTs) && inWin(t.startTs)
        if (!started && t.calls === 0) continue
        if (t.straddle) diag.add('turn-straddles-since', s.alias, 0)
        turnCount++
        const a = agg.get(t.cls) || { turns: 0, calls: 0, tools: 0, cost: 0, firstCw: 0, firstCost: 0, real: 0, noTool: 0, noToolCost: 0, small: 0, smallCost: 0 }
        a.turns++; a.calls += t.calls; a.tools += t.tools; a.cost += t.cost; a.firstCw += t.firstCw; a.firstCost += t.firstCost
        if (t.calls > 0) a.real++
        if (t.calls > 0 && t.tools === 0) { a.noTool++; a.noToolCost += t.cost }
        if (t.calls > 0 && t.calls <= 2 && t.tools <= 1) { a.small++; a.smallCost += t.cost }
        agg.set(t.cls, a)
        const bucket = t.calls === 0 ? '0' : t.calls <= 2 ? '1-2' : t.calls <= 5 ? '3-5' : t.calls <= 20 ? '6-20' : '>20'
        const k = `${t.cls}|${bucket}`; const b = sizes.get(k) || { cls: t.cls, bucket, turns: 0, cost: 0 }
        b.turns++; b.cost += t.cost; sizes.set(k, b)
    }
    const total = manifest.options.totalWeighted
    const pct = v => total ? round(100 * v / total) : undefined
    const triggers = [...agg].map(([cls, a]) => ({
        cls, turns: a.turns, calls: a.calls, tools: a.tools, costUsd: a.cost, sharePct: pct(a.cost),
        realTurns: a.real, noToolTurns: a.noTool, noToolCostUsd: a.noToolCost, noToolSharePct: pct(a.noToolCost),
        smallTurns: a.small, smallCostUsd: a.smallCost, firstCallCostUsd: a.firstCost, firstCallCacheWriteTokens: a.firstCw,
    })).sort((a, b) => b.costUsd - a.costUsd || (a.cls < b.cls ? -1 : 1))
    const turnSizes = [...sizes.values()].sort((a, b) => a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : a.bucket < b.bucket ? -1 : 1)
        .map(b => ({ cls: b.cls, bucket: b.bucket, turns: b.turns, costUsd: b.cost, sharePct: pct(b.cost) }))

    return {
        schema: RESULT_SCHEMA,
        parser: { name: PARSER_NAME, version: PARSER_VERSION },
        window: { since: manifest.since, until: manifest.until },
        options: manifest.options,
        manifestDigest: manifestDigest(manifest),
        // Bucket labels describe call counts and tool use only; they do not show an acknowledgement or a missed action.
        totals: { sources: sources.length, turns: turnCount, calls, tools, tokens: tok, costUsd: cost, midTurn, compactions, autoCompactions, crossTranscriptCollisions: collisions },
        triggers, turnSizes,
        diagnostics: diag.report(),
    }
}

/** Digest of the analytical manifest content (aliases, hashes, window, options, parser); paths excluded. */
export function manifestDigest(m) {
    return sha256(canonicalJson({ since: m.since, until: m.until, parser: m.parser, options: m.options, inputs: [...m.inputs].sort((x, y) => x.alias < y.alias ? -1 : 1).map(x => ({ alias: x.alias, sha256: x.sha256, bytes: x.bytes })) }))
}

/** Capture-time metadata, kept out of the analytical output. */
export function buildEnvelope(manifest, resultJson, now = new Date()) {
    return { schema: 'mainloop-envelope/1', capturedAt: now.toISOString(), runtime: process.version, manifestDigest: manifestDigest(manifest), resultSha256: sha256(resultJson) }
}

/** Verify, analyse and serialise. Returns { json } of the canonical analytical output. */
export function run(manifest, root) {
    const result = analyze(manifest, loadSnapshot(manifest, root))
    return { result, json: canonicalJson(result) }
}

// Outputs never replace an existing file, so a supplied report or input cannot be overwritten.
function writeNew(file, data) {
    try { fs.writeFileSync(file, data, { flag: 'wx' }) } catch { throw new MainloopError('output-not-writable') }
}

function parseArgs(argv) {
    const o = { rest: [] }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (['--root', '--since', '--until', '--out', '--manifest', '--envelope', '--attribution', '--total'].includes(a)) { o[a.slice(2)] = argv[++i] } else o.rest.push(a)
    }
    return o
}

export function main(argv, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
    const [cmd, ...rest] = argv; const a = parseArgs(rest)
    try {
        if (cmd === 'capture') {
            if (!a.root || !a.out || !a.since || !a.until || !a.rest.length) throw new MainloopError('usage')
            const options = { attribution: a.attribution || 'union' }
            if (a.total !== undefined) options.totalWeighted = Number(a.total)
            const m = captureManifest({ root: a.root, files: a.rest, since: a.since, until: a.until, options })
            writeNew(a.out, canonicalJson(m))
            io.out(`manifest ok inputs=${m.inputs.length}\n`)
            return 0
        }
        if (cmd === 'analyze') {
            if (!a.manifest || !a.root || !a.out) throw new MainloopError('usage')
            let m
            try { m = JSON.parse(fs.readFileSync(a.manifest, 'utf8')) } catch { throw new MainloopError('manifest-unreadable') }
            const { json } = run(m, a.root)
            writeNew(a.out, json)
            if (a.envelope) writeNew(a.envelope, canonicalJson(buildEnvelope(m, json)))
            io.out(`analysis ok sha256=${sha256(json)}\n`)
            return 0
        }
        throw new MainloopError('usage')
    } catch (e) {
        io.err(`error: ${e instanceof MainloopError ? e.message : 'internal-error'}\n`)
        return 1
    }
}

// A copy loaded from a data: URL (the mutant check in the tests) has no file path and is never the entry point.
const isEntry = (() => { try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) } catch { return false } })()
if (isEntry) process.exitCode = main(process.argv.slice(2))
