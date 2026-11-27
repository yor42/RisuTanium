// @vitest-environment node
// Synthetic fixtures for the usage and coverage-gap export; no real usage data.
// Run: node node_modules/vitest/vitest.mjs run Agents/Tools/usage/gaps.test.mjs
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze, canonicalJson } from './mainloop.mjs'
import { GAP_SCHEMA, buildGapExport, main, validateRegistry } from './gaps.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY = JSON.parse(fs.readFileSync(path.join(HERE, 'gap-registry.json'), 'utf8'))
const SECRET = 'sk-SENTINEL-secret'
const T = min => new Date(Date.parse('2026-11-22T10:00:00Z') + min * 60e3).toISOString()
const U = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 50 }
const lines = events => events.map(e => JSON.stringify(e)).join('\n') + '\n'
const manifest = { schema: 'mainloop-manifest/1', since: '2026-11-22T00:00:00Z', until: '2026-11-23T00:00:00Z', parser: { name: 'mainloop', version: '1.0.0' }, options: { attribution: 'union' }, inputs: [{ alias: 'src-001', file: 'a.jsonl', sha256: 'a'.repeat(64), bytes: 1 }] }
const text = lines([
    { type: 'user', timestamp: T(0), message: { content: `please ${SECRET}` } },
    { type: 'assistant', timestamp: T(1), requestId: 'r1', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: U, content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } },
    { type: 'assistant', timestamp: T(2), requestId: 'r2', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't2', name: 'Read' }] } },
])
const result = analyze(manifest, [{ alias: 'src-001', text }])

describe('gap export', () => {
    it('is byte-identical for identical inputs and holds no cost estimate for a gap', () => {
        const a = canonicalJson(buildGapExport(result, REGISTRY))
        expect(canonicalJson(buildGapExport(JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(REGISTRY))))).toBe(a)
        const x = JSON.parse(a)
        expect(x.schema).toBe(GAP_SCHEMA)
        expect(x.gaps.length).toBe(REGISTRY.gaps.length)
        for (const g of x.gaps) expect(g.costUsd).toBeNull()
        expect(x.acceptedResultIds).toBeNull()
    })
    it('lists Codex, Antigravity and native usage gaps by id', () => {
        const ids = buildGapExport(result, REGISTRY).gaps.map(g => g.id)
        expect(ids).toEqual(expect.arrayContaining(['codex-collaboration', 'antigravity-delegation', 'native-dispatch-without-usage-block']))
    })
    it('carries measured totals and the usage-free tuple count from the result', () => {
        const x = buildGapExport(result, REGISTRY)
        expect(x.measured.calls).toBe(1)
        expect(x.measured.coverageDiagnostics['tuple-without-usage']).toBe(1)
        expect(x.manifestDigest).toBe(result.manifestDigest)
    })
    it('rejects a malformed result or registry with allowlisted messages only', () => {
        expect(() => buildGapExport({ schema: 'x' }, REGISTRY)).toThrow('invalid-result schema')
        expect(() => validateRegistry({ schema: 'usage-gap-registry/1', gaps: [{ ...REGISTRY.gaps[0], pricing: 'guess' }] })).toThrow('invalid-registry gap-0')
        expect(() => validateRegistry({ schema: 'usage-gap-registry/1', gaps: [REGISTRY.gaps[0], REGISTRY.gaps[0]] })).toThrow('invalid-registry gap-1')
    })
    it('never emits transcript text or local paths, on success or on error', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaps-'))
        const r = path.join(dir, 'result.json'); fs.writeFileSync(r, canonicalJson(result))
        const out = [], err = []
        const io = { out: s => out.push(s), err: s => err.push(s) }
        expect(main(['--result', r, '--out', path.join(dir, 'gaps.json')], io)).toBe(0)
        expect(main(['--result', r, '--out', path.join(dir, 'gaps.json')], io)).toBe(1)
        expect(main(['--result', path.join(dir, `${SECRET}.json`), '--out', path.join(dir, 'g2.json')], io)).toBe(1)
        const all = out.join('') + err.join('') + fs.readFileSync(path.join(dir, 'gaps.json'), 'utf8')
        expect(all).not.toContain(SECRET); expect(all).not.toContain(dir)
        expect(err.join('')).toContain('output-exists')
        fs.rmSync(dir, { recursive: true, force: true })
    })
})
