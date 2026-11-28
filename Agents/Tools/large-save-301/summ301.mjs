// node summ301.mjs <traceDir> -> per rep and window: clusters of long renderer tasks (>= 14 ms, gaps < 6 ms join), plus medians.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const dir = process.argv[2]
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const files = fs.readdirSync(dir).filter((f) => /^r\d+-[EAUN]\.json\.gz$/.test(f)).sort()
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const per = {}
for (const f of files) {
  const [rep, w] = f.replace('.json.gz', '').split('-')
  const out = JSON.parse(execFileSync('node', [path.join(here, 'analyze301.mjs'), path.join(dir, f), '14', 'r301'], { maxBuffer: 1 << 28 }).toString())
  const clusters = []
  for (const t of out.longTasks) {
    const last = clusters[clusters.length - 1]
    if (last && t.atMs - (last.atMs + last.span) < 6) { last.tasks.push(t.durMs); last.span = t.atMs + t.durMs - last.atMs } else clusters.push({ atMs: t.atMs, span: t.durMs, tasks: [t.durMs] })
  }
  per[`${rep}-${w}`] = { out, clusters }
  console.log(rep, w, 'marks', JSON.stringify(out.marks), 'clusters', clusters.map((c) => `@${(c.atMs / 1000).toFixed(2)}s [${c.tasks.join('/')}] max ${Math.max(...c.tasks)} sum ${c.tasks.reduce((s, x) => s + x, 0).toFixed(1)}`).join(' ; '))
}
for (const w of ['E', 'A', 'U', 'N']) {
  const ks = Object.keys(per).filter((k) => k.endsWith('-' + w))
  const maxAll = ks.map((k) => Math.max(0, ...per[k].out.longTasks.map((t) => t.durMs)))
  const firstAfter = ks.map((k) => per[k].clusters.find((c) => c.atMs > 0))
  console.log(`MEDIAN ${w}: n=${ks.length} longest task per rep ${JSON.stringify(maxAll)} median ${med(maxAll)}; first cluster max ${JSON.stringify(firstAfter.map((c) => c ? Math.max(...c.tasks) : null))} sum ${JSON.stringify(firstAfter.map((c) => c ? +c.tasks.reduce((s, x) => s + x, 0).toFixed(1) : null))}`)
}
