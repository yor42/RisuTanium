import { preparePackSheet } from '<WORKTREE>/src/ts/themePack/apply'
import { openJudgeSession } from '<WORKTREE>/src/ts/themePack/judgeClient'
import { BUILTIN_PACKS } from '<WORKTREE>/src/ts/themePack/builtins'
import { LIGHT_BASE_JUDGE_PREFIX } from '<WORKTREE>/src/ts/themePack/lightBase'
const med = (a) => { const b=[...a].sort((x,y)=>x-y); return b[Math.floor(b.length/2)] }
window.__lt = []
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ entryTypes: ['longtask'] })
window.runApply = async (slug, n, stripLight) => {
  const pack = BUILTIN_PACKS.find(p => p.slug === slug)
  const p = stripLight ? { ...pack, modes: ['dark'] } : pack
  const t = []; window.__lt.length = 0
  for (let i = 0; i < n + 2; i++) {
    const session = openJudgeSession()
    const t0 = performance.now()
    const r = await preparePackSheet({ kind: 'builtin', pack: p }, session, () => true)
    const d = performance.now() - t0
    session.close()
    if (!r.ok) throw new Error('apply failed ' + JSON.stringify(r))
    if (i >= 2) t.push(d)
  }
  return { slug, stripLight: !!stripLight, n, median: med(t), min: Math.min(...t), max: Math.max(...t), longtasks: window.__lt.length, ltTotal: window.__lt.reduce((a,b)=>a+b,0) }
}
import { injectAppStore } from '<WORKTREE>/src/ts/storage/store/appStore'
window.runArchive = async (file, key, n, sleep = 800) => {
  const bytes = new Uint8Array(await (await fetch('/packs/' + file)).arrayBuffer())
  injectAppStore({ read: async (k) => ({ bytes: k === key ? bytes : null, version: null }) } as any, null)
  const rows = []
  for (let i = 0; i < n; i++) {
    performance.clearMeasures()
    const session = openJudgeSession()
    window.__mark = 'apply'
    const t0 = performance.now()
    const r = await preparePackSheet({ kind: 'archive', key }, session, () => true)
    const d = performance.now() - t0
    session.close()
    window.__mark = 'idle'
    if (!r.ok) throw new Error('apply failed ' + JSON.stringify(r).slice(0, 400))
    const nb = r.blobs.length
    for (const u of r.blobs) URL.revokeObjectURL(u)
    rows.push({ ms: d, blobs: nb, m: performance.getEntriesByType('measure').map(x => x.name.replace('risu:judge:','') + '=' + Math.round(x.duration) + '@' + Math.round(x.startTime - t0)).join(' ') })
    await new Promise(res => setTimeout(res, sleep))
  }
  return { file, bytes: bytes.length, rows }
}
import { sha256Hex } from '<WORKTREE>/src/ts/assetHash'
import { rangeSourceFrom } from '<WORKTREE>/src/ts/drive/rtb/rangeSource'
import { intakePack, readVerifiedFile } from '<WORKTREE>/src/ts/themePack/intake'
window.__wait = (n) => new Promise(r => { window.__at = n; window.__resume = () => { window.__at = ''; r() } })
window.runStages = async (file) => {
  const bytes = new Uint8Array(await (await fetch('/packs/' + file)).arrayBuffer()); await window.__wait('afterFetch')
  await sha256Hex(bytes); await window.__wait('afterSha')
  const source = rangeSourceFrom({ size: bytes.length, read: async (a, b) => bytes.subarray(a, b) }); const session = openJudgeSession()
  const intake = await intakePack(source, session.judge); await window.__wait('afterIntake')
  const urls = []
  for (const [path] of intake.pack.files) { if (!path.startsWith('fonts/')) continue; const r = await readVerifiedFile(source, intake.pack, path); urls.push(URL.createObjectURL(new Blob([r.bytes], { type: r.mime }))) }
  await window.__wait('afterMint'); session.close(); for (const u of urls) URL.revokeObjectURL(u); await window.__wait('afterRevoke'); return bytes.length
}
window.runPhases = async (file) => {
  const t = (() => { let l = performance.now(); return () => { const n = performance.now(); const d = n - l; l = n; return +d.toFixed(0) } })()
  const bytes = new Uint8Array(await (await fetch('/packs/' + file)).arrayBuffer()); const fetchMs = t()
  const h = await sha256Hex(bytes); const shaMs = t()
  const source = rangeSourceFrom({ size: bytes.length, read: async (a, b) => bytes.subarray(a, b) })
  const session = openJudgeSession()
  const intake = await intakePack(source, session.judge); const intakeMs = t()
  if (!intake.ok) throw new Error('intake ' + JSON.stringify(intake.refusals))
  const readMs = [], blobMs = []; const urls = []
  for (const [path] of intake.pack.files) {
    if (!path.startsWith('fonts/')) continue
    const r = await readVerifiedFile(source, intake.pack, path); readMs.push(t())
    urls.push(URL.createObjectURL(new Blob([r.bytes], { type: r.mime }))); blobMs.push(t())
  }
  session.close(); for (const u of urls) URL.revokeObjectURL(u)
  return { file, shaMs, intakeMs, fetchMs, fontReadMs: readMs, blobMs, sumRead: readMs.reduce((a,b)=>a+b,0), sumBlob: blobMs.reduce((a,b)=>a+b,0) }
}
window.__ready = true






