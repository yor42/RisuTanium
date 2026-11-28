// node analyze301.mjs <trace.json.gz> [minMs] [markPrefix]  -> long main-thread tasks of the renderer, relative to the first mark.
import fs from 'node:fs'
import zlib from 'node:zlib'
const [file, minArg, markPrefix] = process.argv.slice(2)
const minMs = Number(minArg ?? 16)
const { traceEvents } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString())
const mains = traceEvents.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
// the renderer with the most RunTask events
let best = null
for (const m of mains) {
  const n = traceEvents.filter((e) => e.pid === m.pid && e.tid === m.tid && e.name === 'RunTask' && e.ph === 'X').length
  if (!best || n > best.n) best = { pid: m.pid, tid: m.tid, n }
}
const ev = traceEvents.filter((e) => e.pid === best.pid && e.tid === best.tid && e.ph === 'X' && e.dur !== undefined)
const tasks = ev.filter((e) => e.name === 'RunTask').sort((a, b) => a.ts - b.ts)
const marks = traceEvents.filter((e) => e.pid === best.pid && e.cat?.includes('blink.user_timing') && (e.ph === 'R' || e.ph === 'I' || e.ph === 'i') && (!markPrefix || e.name.startsWith(markPrefix)))
const t0 = (marks[0] ?? tasks[0]).ts
const out = { file, rendererMainTasks: tasks.length, marks: marks.map((m) => [m.name, +((m.ts - t0) / 1000).toFixed(1)]), longTasks: [] }
for (const t of tasks) {
  if (t.dur / 1000 < minMs) continue
  const inside = ev.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.name !== 'RunTask')
  const sum = (names) => +(inside.filter((e) => names.includes(e.name)).reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1)
  const top = inside.filter((e) => e.name === 'FunctionCall' || e.name === 'v8.callFunction' || e.name === 'EventDispatch' || e.name === 'TimerFire' || e.name === 'FireAnimationFrame' || e.name === 'RunMicrotasks')
    .sort((a, b) => b.dur - a.dur).slice(0, 2).map((e) => `${e.name}:${(e.dur / 1000).toFixed(1)}${e.args?.data?.functionName ? ' ' + e.args.data.functionName : ''}${e.args?.data?.type ? ' ' + e.args.data.type : ''}`)
  out.longTasks.push({
    atMs: +((t.ts - t0) / 1000).toFixed(1), durMs: +(t.dur / 1000).toFixed(1),
    gcMs: sum(['MajorGC', 'MinorGC', 'V8.GC_MC_BACKGROUND_MARKING', 'V8.GC_SCAVENGER']), layoutMs: sum(['UpdateLayoutTree', 'Layout']), paintMs: sum(['Paint', 'PrePaint', 'Layerize', 'Commit']),
    top,
  })
}
console.log(JSON.stringify(out))
