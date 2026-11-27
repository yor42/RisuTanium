/**
 * Usage and coverage-gap export. A pure function of one analyze result (mainloop-analysis/1) and the
 * checked-in gap registry: stable key order, no clock, path or environment value. Gaps are listed, never
 * estimated: every cost field of a gap is null and nothing is priced for a provider without a usage block.
 *
 * CLI: node gaps.mjs --result RESULT --out FILE [--registry FILE]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MainloopError, RESULT_SCHEMA, canonicalJson } from './mainloop.mjs'

export const GAP_SCHEMA = 'usage-gaps/1'
export const REGISTRY_SCHEMA = 'usage-gap-registry/1'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAP_KEYS = ['id', 'provider', 'category', 'missing', 'evidence', 'pricing']
const PRICING = ['unverified', 'not-applicable']
// Diagnostic counts that reduce coverage of the measured calls; the rest of the codes do not change totals.
const MEASURED_GAP_CODES = ['tuple-without-usage', 'synthetic-skipped', 'missing-id', 'missing-timestamp', 'boundary-straddle', 'turn-straddles-since', 'cross-transcript-collision']

export function validateRegistry(reg) {
    const ids = new Set()
    if (!reg || reg.schema !== REGISTRY_SCHEMA || !Array.isArray(reg.gaps)) throw new MainloopError('invalid-registry', 'schema')
    reg.gaps.forEach((g, i) => {
        const ok = g && typeof g === 'object' && Object.keys(g).sort().join() === [...GAP_KEYS].sort().join()
            && GAP_KEYS.every(k => k === 'missing' ? Array.isArray(g.missing) && g.missing.length > 0 && g.missing.every(m => typeof m === 'string') : typeof g[k] === 'string' && g[k])
            && PRICING.includes(g.pricing) && !ids.has(g.id)
        if (!ok) throw new MainloopError('invalid-registry', `gap-${i}`)
        ids.add(g.id)
    })
}

export function buildGapExport(result, registry) {
    if (!result || result.schema !== RESULT_SCHEMA || !result.totals || !result.diagnostics) throw new MainloopError('invalid-result', 'schema')
    validateRegistry(registry)
    const t = result.totals
    const counts = result.diagnostics.counts || {}
    const measured = {}
    for (const c of MEASURED_GAP_CODES) measured[c] = counts[c] || 0
    return {
        schema: GAP_SCHEMA,
        resultSchema: result.schema,
        manifestDigest: result.manifestDigest,
        window: result.window,
        attribution: result.options && result.options.attribution,
        // Counted usage is what the frozen inputs report; costUsd there is an assumed-list-price weighting, not an invoice.
        measured: {
            sources: t.sources, calls: t.calls, tools: t.tools, tokens: t.tokens, costUsdAssumedListPrice: t.costUsd,
            coverageDiagnostics: measured,
        },
        gaps: registry.gaps.map(g => ({ ...g, costUsd: null })).sort((a, b) => a.id < b.id ? -1 : 1),
        acceptedResultIds: null,
    }
}

export function main(argv, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
    const o = {}
    for (let i = 0; i < argv.length; i++) { if (['--result', '--out', '--registry'].includes(argv[i])) o[argv[i].slice(2)] = argv[++i]; else { io.err('usage-error\n'); return 2 } }
    if (!o.result || !o.out) { io.err('usage-error\n'); return 2 }
    try {
        let result, registry
        try { result = JSON.parse(fs.readFileSync(o.result, 'utf8')) } catch { throw new MainloopError('invalid-result', 'read') }
        try { registry = JSON.parse(fs.readFileSync(o.registry || path.join(HERE, 'gap-registry.json'), 'utf8')) } catch { throw new MainloopError('invalid-registry', 'read') }
        const text = canonicalJson(buildGapExport(result, registry))
        try { fs.writeFileSync(o.out, text, { flag: 'wx' }) } catch { throw new MainloopError('output-exists') }
        io.out(`gap export ok gaps=${registry.gaps.length}\n`)
        return 0
    } catch (e) {
        io.err(`${e instanceof MainloopError ? e.message : 'internal-error'}\n`)
        return 1
    }
}

const isEntry = (() => { try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) } catch { return false } })()
if (isEntry) process.exitCode = main(process.argv.slice(2))
