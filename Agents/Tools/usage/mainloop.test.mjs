// @vitest-environment node
// Deterministic fixtures for the main-loop telemetry tool; synthetic events only, no real usage data.
// Run: node node_modules/vitest/vitest.mjs run Agents/Tools/usage/mainloop.test.mjs
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    PARSER_VERSION, analyze, buildEnvelope, canonicalJson, captureManifest, loadSnapshot, main, manifestDigest, run, sha256, validateManifest,
} from './mainloop.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.join(HERE, 'mainloop.mjs')
const SINCE = '2026-11-22T00:00:00Z'
const UNTIL = '2026-11-23T00:00:00Z'
const T = (min) => new Date(Date.parse('2026-11-22T10:00:00Z') + min * 60e3).toISOString()
const U1 = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 50 }
const U2 = { input_tokens: 11, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 50 }

const user = (text, min) => ({ type: 'user', timestamp: T(min), message: { content: text } })
const toolResult = (min) => ({ type: 'user', timestamp: T(min), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } })
const asst = ({ id = 'm1', rid = 'r1', min, tools = [], text = false, usage = U1, model = 'claude-sonnet-5-5' }) => ({
    type: 'assistant', timestamp: T(min), requestId: rid,
    message: { id, model, usage, content: [...(text ? [{ type: 'text', text: 'hello' }] : []), ...tools.map(id => ({ type: 'tool_use', id, name: 'Read' }))] },
})
const jsonl = (events) => events.map(e => JSON.stringify(e)).join('\n') + '\n'
const manifestFor = (inputs, options = {}, win = [SINCE, UNTIL]) => ({
    schema: 'mainloop-manifest/1', since: win[0], until: win[1], parser: { name: 'mainloop', version: PARSER_VERSION },
    options: { attribution: 'union', ...options },
    inputs: inputs.map((x, i) => ({ alias: x.alias || `src-${String(i + 1).padStart(3, '0')}`, file: `f${i}.jsonl`, sha256: sha256(Buffer.from(x.text)), bytes: Buffer.byteLength(x.text) })),
})
const one = (events, options, win) => {
    const inputs = [{ text: jsonl(events) }]
    const m = manifestFor(inputs, options, win)
    return analyze(m, inputs.map((x, i) => ({ alias: m.inputs[i].alias, text: x.text })))
}
const trig = (r, cls) => r.triggers.find(t => t.cls === cls)
const codes = (r) => r.diagnostics.counts

describe('tool attribution across blocks of one provider message', () => {
    it('keeps a tool that sits in a later block repeating the same usage (text -> tool split)', () => {
        const ev = [user('hi', 0), asst({ min: 1, text: true }), asst({ min: 1, tools: ['t1'] })]
        const r = one(ev)
        expect(r.totals.calls).toBe(1)
        expect(r.totals.tools).toBe(1)
        expect(trig(r, 'maintainer').tools).toBe(1)
        expect(one(ev, { attribution: 'legacy-first-block' }).totals.tools).toBe(0)
    })

    it('unions multiple tools and counts a repeated tool id once', () => {
        const r = one([user('hi', 0), asst({ min: 1, tools: ['a'] }), asst({ min: 1, tools: ['b'] }), asst({ min: 1, tools: ['a'] })])
        expect(r.totals.tools).toBe(2)
        expect(r.totals.calls).toBe(1)
        expect(codes(r)['duplicate-tool-id']).toBe(1)
        expect(codes(r)['usage-repeat']).toBe(2)
    })

    it('keeps tools from usage-free blocks, before and after the usage block', () => {
        const noUsage = (o) => { const e = asst(o); delete e.message.usage; return e }
        const r = one([user('hi', 0), noUsage({ min: 1, tools: ['a'] }), asst({ min: 1, text: true }), noUsage({ min: 1, tools: ['b'] })])
        expect(r.totals.calls).toBe(1)
        expect(r.totals.tools).toBe(2)
    })

    it('binds the call to its original turn when a user event arrives between its blocks', () => {
        const r = one([user('first', 0), asst({ min: 1, text: true }), user('second', 2), asst({ min: 2, tools: ['t1'] })])
        const m = trig(r, 'maintainer')
        expect(m.turns).toBe(2)
        expect(m.calls).toBe(1)
        expect(m.tools).toBe(1)
        expect(r.turnSizes.filter(s => s.bucket === '0').reduce((a, s) => a + s.turns, 0)).toBe(1)
        expect(r.totals.tools).toBe(1)
    })

    it('counts identical usage once and reports conflicting usage while keeping the first', () => {
        const same = one([user('hi', 0), asst({ min: 1, tools: ['a'] }), asst({ min: 1, tools: ['b'] })])
        expect(same.totals.calls).toBe(1)
        expect(same.totals.tokens).toEqual({ in: 10, cw: 1000, cr: 2000, out: 50 })
        const conflict = one([user('hi', 0), asst({ min: 1, tools: ['a'] }), asst({ min: 1, tools: ['b'], usage: U2 })])
        expect(conflict.totals.tokens.in).toBe(10)
        expect(codes(conflict)['usage-conflict']).toBe(1)
        expect(conflict.totals.tools).toBe(2)
    })

    it('does not merge events with missing ids and reports them', () => {
        const noId = (min, tool) => { const e = asst({ min, tools: [tool] }); delete e.requestId; delete e.message.id; return e }
        const r = one([user('hi', 0), noId(1, 'a'), noId(2, 'b')])
        expect(r.totals.calls).toBe(2)
        expect(r.totals.tools).toBe(2)
        expect(codes(r)['missing-id']).toBe(2)
        const half = one([user('hi', 0), (() => { const e = asst({ min: 1 }); delete e.requestId; return e })()])
        expect(codes(half)['missing-id']).toBe(1)
        expect(half.totals.calls).toBe(1)
    })

    it('reports a tool block without an id and a tuple whose usage never arrives', () => {
        const noUsage = asst({ min: 1, id: 'm2', rid: 'r2', tools: ['z'] }); delete noUsage.message.usage
        const r = one([user('hi', 0), asst({ min: 1, tools: [''] }), noUsage])
        expect(codes(r)['missing-tool-id']).toBe(1)
        expect(codes(r)['tuple-without-usage']).toBe(1)
        expect(r.totals.calls).toBe(1)
        expect(r.totals.tools).toBe(0)
    })

    it('skips synthetic messages and says so', () => {
        const r = one([user('hi', 0), asst({ min: 1, model: '<synthetic>', tools: ['a'] }), asst({ min: 2, id: 'm2', tools: ['b'] })])
        expect(r.totals.calls).toBe(1)
        expect(r.totals.tools).toBe(1)
        expect(codes(r)['synthetic-skipped']).toBe(1)
    })

    it('reports a tuple repeated across two transcripts without changing per-transcript totals', () => {
        const ev = [user('hi', 0), asst({ min: 1, tools: ['a'] })]
        const inputs = [{ text: jsonl(ev) }, { text: jsonl([user('hi', 0), asst({ min: 1, tools: ['a'], usage: U2 })]) }]
        const m = manifestFor(inputs)
        const r = analyze(m, inputs.map((x, i) => ({ alias: m.inputs[i].alias, text: x.text })))
        expect(r.totals.calls).toBe(2)
        expect(r.totals.crossTranscriptCollisions).toBe(1)
        expect(codes(r)['cross-transcript-collision']).toBe(1)
        expect(codes(r)['collision-usage-conflict']).toBe(1)
        expect(r.diagnostics.items.find(i => i.code === 'cross-transcript-collision').src).toBe('src-002')
    })
})

describe('malformed fields and outputs', () => {
    it('treats non-numeric usage as zero and an object content as no blocks', () => {
        const e = asst({ min: 1, usage: { input_tokens: '7', output_tokens: 5 } })
        const o = user('x', 2); o.message.content = { not: 'an array' }
        const r = one([user('hi', 0), e, o])
        expect(r.totals.tokens).toEqual({ in: 0, cw: 0, cr: 0, out: 5 })
        expect(r.totals.calls).toBe(1)
    })
    it('refuses to overwrite an existing output file', () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mainloop-out-'))
        try {
            fs.writeFileSync(path.join(d, 'a.jsonl'), jsonl([user('hi', 0), asst({ min: 1 })]))
            const out = path.join(d, 'm.json'); fs.writeFileSync(out, 'keep')
            const err = []
            expect(main(['capture', '--root', d, '--since', SINCE, '--until', UNTIL, '--out', out, 'a.jsonl'], { out: () => {}, err: s => err.push(s) })).toBe(1)
            expect(err.join('')).toBe('error: output-not-writable\n')
            expect(fs.readFileSync(out, 'utf8')).toBe('keep')
        } finally { fs.rmSync(d, { recursive: true, force: true }) }
    })
})

describe('time window [since, until)', () => {
    const at = (iso, id, tools = ['t']) => ({ ...asst({ min: 0, id, rid: id, tools }), timestamp: iso })
    it('includes since, excludes until and anything outside', () => {
        const r = one([user('hi', 0), at(SINCE, 'a'), at(UNTIL, 'b'), at('2026-11-21T23:59:59Z', 'c'), at('2026-11-22T23:59:59.999Z', 'd')])
        expect(r.totals.calls).toBe(2)
        expect(r.totals.tools).toBe(2)
    })
    it('names a tuple whose blocks cross the window edge', () => {
        const a = at('2026-11-22T23:59:59Z', 'm', []); const b = { ...at('2026-11-23T00:00:01Z', 'm'), }
        const r = one([user('hi', 0), a, b])
        expect(r.totals.calls).toBe(1)
        expect(r.totals.tools).toBe(1)
        expect(codes(r)['boundary-straddle']).toBe(1)
    })
    it('reports a turn that started before since', () => {
        const u = { ...user('hi', 0), timestamp: '2026-11-21T23:00:00Z' }
        const r = one([u, at(SINCE, 'a')])
        expect(trig(r, 'maintainer').calls).toBe(1)
        expect(codes(r)['turn-straddles-since']).toBe(1)
    })
    it('reports an event without a usable timestamp instead of guessing', () => {
        const e = asst({ min: 1, tools: ['a'] }); delete e.timestamp
        expect(codes(one([user('hi', 0), e]))['missing-timestamp']).toBe(1)
    })
})

describe('trigger grouping and buckets are unchanged between attribution modes', () => {
    const events = [
        user('hi', 0), asst({ min: 1, text: true }), asst({ min: 1, tools: ['a'] }), toolResult(2), asst({ min: 3, id: 'm2', rid: 'r2', text: true }),
        user('<task-notification>done</task-notification>', 4), asst({ min: 5, id: 'm3', rid: 'r3', text: true }),
        user('<cross-session-message>x</cross-session-message>', 6),
    ]
    it('differs only in tools; calls, tokens, cost, turns and buckets are equal', () => {
        const u = one(events); const l = one(events, { attribution: 'legacy-first-block' })
        expect(u.totals.tools).toBe(1); expect(l.totals.tools).toBe(0)
        const strip = (r) => ({ ...r, options: undefined, manifestDigest: undefined, totals: { ...r.totals, tools: 0 }, triggers: r.triggers.map(t => ({ ...t, tools: 0, noToolTurns: 0, noToolCostUsd: 0, smallTurns: 0, smallCostUsd: 0 })) })
        expect(strip(u)).toEqual(strip(l))
        expect(u.triggers.map(t => t.cls)).toEqual(expect.arrayContaining(['maintainer', 'task-notification', 'cross-session']))
        expect(trig(u, 'cross-session').turns).toBe(1)
        expect(trig(u, 'cross-session').realTurns).toBe(0)
        expect(trig(u, 'maintainer').noToolTurns).toBe(0)
        expect(trig(l, 'maintainer').noToolTurns).toBe(1)
    })
})

describe('mutant: tools dropped once a tuple already carries usage', () => {
    it('fails the text->tool split while token and call totals stay equal', async () => {
        const src = fs.readFileSync(SOURCE, 'utf8')
        const needle = 'for (const b of toolBlocks) {'
        expect(src.split(needle).length).toBe(2)
        const mutant = src.replace(needle, 'for (const b of (t.usage ? [] : toolBlocks)) {')
        const mod = await import('data:text/javascript;base64,' + Buffer.from(mutant).toString('base64'))
        const ev = [user('hi', 0), asst({ min: 1, text: true }), asst({ min: 1, tools: ['t1'] })]
        const inputs = [{ text: jsonl(ev) }]
        const m = manifestFor(inputs)
        const good = analyze(m, [{ alias: 'src-001', text: inputs[0].text }])
        const bad = mod.analyze(m, [{ alias: 'src-001', text: inputs[0].text }])
        expect(good.totals.tools).toBe(1)
        expect(bad.totals.tools).toBe(0)
        expect(bad.totals.calls).toBe(good.totals.calls)
        expect(bad.totals.tokens).toEqual(good.totals.tokens)
    })
})

describe('manifest and frozen snapshot', () => {
    let dir
    const evText = jsonl([user('hi', 0), asst({ min: 1, tools: ['a'] })])
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainloop-test-')); fs.writeFileSync(path.join(dir, 'a.jsonl'), evText); fs.writeFileSync(path.join(dir, 'b.jsonl'), evText.replace('m1', 'm9')) })
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

    it('captures hashes, rejects changed or missing bytes and never copies transcripts', () => {
        const m = captureManifest({ root: dir, files: ['b.jsonl', 'a.jsonl'], since: SINCE, until: UNTIL })
        expect(m.inputs.map(i => i.file)).toEqual(['a.jsonl', 'b.jsonl'])
        expect(m.inputs[0].alias).toBe('src-001')
        expect(loadSnapshot(m, dir)).toHaveLength(2)
        fs.appendFileSync(path.join(dir, 'a.jsonl'), '\n')
        expect(() => loadSnapshot(m, dir)).toThrow('snapshot-changed src-001')
        fs.writeFileSync(path.join(dir, 'a.jsonl'), evText)
        fs.renameSync(path.join(dir, 'b.jsonl'), path.join(dir, 'b2.jsonl'))
        expect(() => loadSnapshot(m, dir)).toThrow('snapshot-missing src-002')
        fs.renameSync(path.join(dir, 'b2.jsonl'), path.join(dir, 'b.jsonl'))
    })

    it('rejects manifests that are not explicit, UTC, versioned or opaque', () => {
        const ok = manifestFor([{ text: 'x' }])
        expect(validateManifest(ok)).toEqual([])
        const bad = (patch) => validateManifest({ ...ok, ...patch }).map(b => b.code)
        expect(bad({ since: '2026-11-22T00:00:00+09:00' })).toContain('bad-utc')
        expect(bad({ since: '2026-11-22' })).toContain('bad-utc')
        expect(bad({ since: UNTIL, until: SINCE })).toContain('empty-window')
        expect(bad({ parser: { name: 'mainloop', version: '0.0.1' } })).toContain('parser-mismatch')
        expect(bad({ options: { attribution: 'other' } })).toContain('bad-option-value')
        expect(bad({ options: { attribution: 'union', seed: 1 } })).toContain('unknown-option')
        expect(bad({ extra: 1 })).toContain('unknown-manifest-key')
        expect(bad({ inputs: [] })).toContain('no-inputs')
        const inp = ok.inputs[0]
        expect(bad({ inputs: [{ ...inp, alias: 'my-user-file' }] })).toContain('bad-alias')
        expect(bad({ inputs: [{ ...inp, file: '../x' }] })).toContain('bad-file')
        expect(bad({ inputs: [{ ...inp, file: 'C:/Users/x.jsonl' }] })).toContain('bad-file')
        expect(bad({ inputs: [{ ...inp, sha256: 'abc' }] })).toContain('bad-hash')
        expect(bad({ inputs: [inp, { ...inp, file: 'other' }] })).toContain('duplicate-alias')
        expect(() => analyze({ ...ok, since: 'x' }, [])).toThrow('invalid-manifest')
    })
})

describe('determinism', () => {
    const files = [
        jsonl([user('hi', 0), asst({ min: 1, text: true }), asst({ min: 1, tools: ['a', 'b'] }), user('<task-notification>x', 3), asst({ min: 4, id: 'm2', rid: 'r2', tools: ['c'] })]),
        jsonl([user('yo', 0), asst({ min: 1, id: 'q1', rid: 'q', tools: ['a'] }), asst({ min: 1, id: 'q1', rid: 'q', usage: U2 })]),
    ]
    const build = (order) => {
        const inputs = files.map((text, i) => ({ alias: `src-00${i + 1}`, text }))
        const m = manifestFor(inputs)
        const ins = order.map(i => inputs[i])
        m.inputs = order.map(i => m.inputs[i])
        return canonicalJson(analyze(m, ins))
    }
    it('is byte identical across repeated runs and manifest enumeration orders', () => {
        const a = build([0, 1])
        expect(build([0, 1])).toBe(a)
        expect(build([1, 0])).toBe(a)
        expect(a).not.toContain('capturedAt')
    })
    it('keeps capture time and runtime out of the analysis and in the envelope', () => {
        const inputs = [{ alias: 'src-001', text: files[0] }]
        const m = manifestFor(inputs)
        const json = canonicalJson(analyze(m, inputs))
        expect(json).not.toContain('capturedAt')
        expect(json).not.toContain(process.version)
        const e1 = buildEnvelope(m, json, new Date('2030-01-01T00:00:00Z')); const e2 = buildEnvelope(m, json, new Date('2031-01-01T00:00:00Z'))
        expect(e1.capturedAt).not.toBe(e2.capturedAt)
        expect(e1.resultSha256).toBe(e2.resultSha256)
        expect(e1.manifestDigest).toBe(manifestDigest(m))
        expect(JSON.parse(json).manifestDigest).toBe(manifestDigest(m))
    })
    it('serialises with sorted keys and rounded numbers', () => {
        expect(canonicalJson({ b: 1, a: 0.1 + 0.2 })).toBe('{\n "a": 0.3,\n "b": 1\n}\n')
        expect(() => canonicalJson({ a: NaN })).toThrow('non-finite-number')
    })
    it('changes its digest when the declared options change', () => {
        const inputs = [{ alias: 'src-001', text: files[0] }]
        expect(manifestDigest(manifestFor(inputs))).not.toBe(manifestDigest(manifestFor(inputs, { attribution: 'legacy-first-block' })))
    })
})

describe('privacy: diagnostics carry no source text, ids or paths', () => {
    const SECRET = 'sk-SENTINEL-SECRET-123'
    const PRIVATE = 'C:\\Users\\sentinel-user\\private\\evidence'
    const RAWID = 'msg_SENTINELRAWID'
    const bad = [
        `{"type":"user","message":{"content":"${SECRET} ${PRIVATE}"` + ' broken-line-padding-padding',
        JSON.stringify({ ...user(`${SECRET} ${PRIVATE}`, 0), cwd: PRIVATE }),
        JSON.stringify(asst({ min: 1, id: RAWID, rid: 'req_SENTINELREQ', tools: ['toolu_SENTINELTOOL'] })),
        JSON.stringify(asst({ min: 1, id: RAWID, rid: 'req_SENTINELREQ', tools: ['toolu_SENTINELTOOL'], usage: U2 })),
        JSON.stringify({ ...asst({ min: 2, id: RAWID + 'b', rid: 'r' }), message: { id: RAWID + 'b', model: SECRET, usage: U1, content: [{ type: 'text', text: SECRET }, { type: 'tool_use', id: 5, name: SECRET }] } }),
    ].join('\n') + '\n'
    const SENTINELS = [SECRET, 'sentinel-user', 'SENTINELRAWID', 'SENTINELREQ', 'SENTINELTOOL', 'private', 'evidence']
    let dir
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainloop-priv-sentinel-user-')); fs.mkdirSync(path.join(dir, 'private-sub')); fs.writeFileSync(path.join(dir, 'private-sub', 'sentinel-file.jsonl'), bad) })
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })
    const clean = (s) => { for (const x of SENTINELS) expect(s).not.toContain(x) }

    it('normal path: result, manifest, envelope and stdout contain none of the sentinels', () => {
        const m = captureManifest({ root: dir, files: ['private-sub/sentinel-file.jsonl'], since: SINCE, until: UNTIL })
        const { json, result } = run(m, dir)
        expect(result.diagnostics.counts['malformed-line']).toBe(1)
        expect(result.diagnostics.counts['usage-conflict']).toBe(1)
        expect(result.diagnostics.counts['missing-tool-id']).toBe(1)
        clean(json)
        clean(canonicalJson(buildEnvelope(m, json)))
        const out = []; const err = []
        const mp = path.join(dir, 'm.json'); const rp = path.join(dir, 'r.json'); const ep = path.join(dir, 'e.json')
        const io = { out: s => out.push(s), err: s => err.push(s) }
        expect(main(['capture', '--root', dir, '--since', SINCE, '--until', UNTIL, '--out', mp, 'private-sub/sentinel-file.jsonl'], io)).toBe(0)
        expect(main(['analyze', '--manifest', mp, '--root', dir, '--out', rp, '--envelope', ep], io)).toBe(0)
        clean(out.join('')); clean(err.join('')); clean(fs.readFileSync(rp, 'utf8')); clean(fs.readFileSync(ep, 'utf8'))
        // The manifest is the one place a (relative) file name is kept, for re-reading the frozen input.
        expect(fs.readFileSync(mp, 'utf8')).toContain('sentinel-file.jsonl')
    })

    it('error paths: thrown messages and CLI stderr name only codes and aliases', () => {
        const m = captureManifest({ root: dir, files: ['private-sub/sentinel-file.jsonl'], since: SINCE, until: UNTIL })
        fs.appendFileSync(path.join(dir, 'private-sub', 'sentinel-file.jsonl'), ' \n')
        let msg = ''
        try { loadSnapshot(m, dir) } catch (e) { msg = String(e.message) }
        expect(msg).toBe('snapshot-changed src-001'); clean(msg)
        fs.writeFileSync(path.join(dir, 'private-sub', 'sentinel-file.jsonl'), bad)
        const poisoned = { ...m, inputs: [{ ...m.inputs[0], file: PRIVATE, alias: SECRET }] }
        try { analyze(poisoned, []) } catch (e) { msg = String(e.message) }
        expect(msg).toContain('invalid-manifest'); clean(msg)
        const mp = path.join(dir, 'bad.json'); fs.writeFileSync(mp, JSON.stringify(poisoned))
        const r = spawnSync(process.execPath, [SOURCE, 'analyze', '--manifest', mp, '--root', dir, '--out', path.join(dir, 'x.json')], { encoding: 'utf8' })
        expect(r.status).toBe(1)
        clean(r.stdout); clean(r.stderr)
        expect(r.stderr).toMatch(/^error: invalid-manifest /)
        const garbage = path.join(dir, 'garbage.json'); fs.writeFileSync(garbage, `{${SECRET} ${PRIVATE}`)
        const g = spawnSync(process.execPath, [SOURCE, 'analyze', '--manifest', garbage, '--root', dir, '--out', path.join(dir, 'x.json')], { encoding: 'utf8' })
        expect(g.status).toBe(1)
        expect(g.stderr).toBe('error: manifest-unreadable\n'); clean(g.stdout + g.stderr)
        const missing = spawnSync(process.execPath, [SOURCE, 'analyze', '--manifest', path.join(dir, `${SECRET}.json`), '--root', dir, '--out', 'x'], { encoding: 'utf8' })
        expect(missing.stderr).toBe('error: manifest-unreadable\n')
    })
})
