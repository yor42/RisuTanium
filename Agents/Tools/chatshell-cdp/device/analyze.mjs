import fs from 'node:fs'
import { loadSharp, outDir, safeName } from './lib.mjs'
// usage: [HARNESS_OUT=<dir outside the checkout>] node analyze.mjs <build> <trial>
// Frame differencing by vertical block matching: a band of the transcript (3 textured sub-bands of the reference frame) is slid
// +-MAXS px over the frame under test; the shift with the lowest mean absolute grey difference is the vertical displacement.
// dy > 0 = the frame's content sits lower than in the reference. References: the settled (last) frame, and the previous frame.
const [build, trial] = process.argv.slice(2, 4)
let OUT
try { safeName(build); safeName(trial); OUT = `${outDir()}/${build}-${trial}` } catch (e) { console.error(String(e.message || e) + '\nusage: node analyze.mjs <build> <trial>'); process.exit(2) }
const sharp = loadSharp()
const raw = JSON.parse(fs.readFileSync(`${OUT}/raw.json`, 'utf8'))
const MAXS = 420, SUBH = 100, COSTMAX = 14, THR = 4
const grey = async (name) => { const { data, info } = await sharp(`${OUT}/frames/${name}`).greyscale().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height } }
const imgs = []
for (const f of raw.frameMeta) imgs.push(await grey(f.name))
if (!imgs.length) { fs.writeFileSync(`${OUT}/analysis.json`, JSON.stringify({ error: 'no frames' })); console.log('no frames'); process.exit(0) }
const W = imgs[0].w, H = imgs[0].h
const scale = W / raw.ra.iw
const yTop = Math.round((raw.ra.hostTop + 8) * scale), yBot = Math.round((raw.ra.hostBottom - 8) * scale)
const x0 = Math.round(10 * scale), x1 = W - x0
const bandVar = (im, y0, h) => { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x1; x += 4) { const v = im.d[y * W + x]; s += v; s2 += v * v; n++ } const m = s / n; return s2 / n - m * m }
const cost = (ref, im, y0, h, s) => { let t = 0, n = 0; for (let y = y0; y < y0 + h; y += 1) { const yy = y + s; if (yy < 0 || yy >= H) return 1e9; for (let x = x0; x < x1; x += 3) { t += Math.abs(ref.d[y * W + x] - im.d[yy * W + x]); n++ } } return t / n }
const subBands = (ref) => {
  const out = []
  const span = yBot - yTop - SUBH
  for (const fr of [0.1, 0.3, 0.5, 0.7, 0.9]) { const y0 = Math.round(yTop + span * fr); out.push({ y0, v: bandVar(ref, y0, SUBH) }) }
  return out.filter(b => b.v > 150).sort((p, q) => q.v - p.v).slice(0, 3)
}
const estimate = (ref, im, bands) => {
  let best = { cost: 1e9, s: null, band: null }
  for (const b of bands) {
    let bc = 1e9, bs = 0
    const cs = new Float64Array(2 * MAXS + 1)
    for (let s = -MAXS; s <= MAXS; s++) { const c = cost(ref, im, b.y0, SUBH, s); cs[s + MAXS] = c; if (c < bc) { bc = c; bs = s } }
    // ambiguity: the best cost at a shift more than 8 px away from the best
    let alt = 1e9; for (let s = -MAXS; s <= MAXS; s++) if (Math.abs(s - bs) > 8 && cs[s + MAXS] < alt) alt = cs[s + MAXS]
    if (bc < best.cost) best = { cost: bc, s: bs, band: b.y0, alt }
  }
  return best
}
// self-check: the settled frame shifted by a known amount must be estimated as that amount
const settled = imgs[imgs.length - 1]
const sb = subBands(settled)
const known = (() => { const shift = 37; const d = Buffer.alloc(W * H, 128); for (let y = 0; y < H; y++) { const sy = y - shift; if (sy >= 0 && sy < H) settled.d.copy(d, y * W, sy * W, sy * W + W) } return { d, w: W, h: H, shift } })()
const kn = sb.length ? estimate(settled, known, sb) : null
// time base: device timestamp (s) -> host clock
const off = raw.clk.reduce((p, k) => p + (k.d - (k.h0 + k.h1) / 2), 0) / raw.clk.length
const t0 = raw.jumpT || raw.swipeT
const series = []
for (let i = 0; i < imgs.length; i++) {
  const f = raw.frameMeta[i]
  const tHost = f.ts * 1000 - off
  const rs = sb.length ? estimate(settled, imgs[i], sb) : { s: null, cost: null }
  const rp = i > 0 && sb.length ? estimate(imgs[i - 1], imgs[i], subBands(imgs[i - 1])) : { s: null, cost: null }
  const blank = bandVar(imgs[i], yTop, yBot - yTop) < 40
  series.push({ i, name: f.name, blank, tRel: Math.round(tHost - t0), tHostRecvRel: f.hostT - t0, dyS: !blank && rs.s !== null && rs.cost < COSTMAX ? rs.s : null, costS: rs.cost && Math.round(rs.cost * 10) / 10, dyPrev: rp.s !== null && rp.cost < COSTMAX ? rp.s : null, costPrev: rp.cost && Math.round(rp.cost * 10) / 10 })
}
const inTrial = series.filter(f => f.tRel >= 0)
const prevPolls = raw.detect ? raw.polls.filter(p => p.host < raw.detect.host) : []
const winStart = prevPolls.length ? prevPolls[prevPolls.length - 1].host - t0 : 0
const inWin = inTrial.filter(f => f.tRel >= winStart)
const displaced = inWin.filter(f => f.dyS !== null && Math.abs(f.dyS) > THR)
const blanks = inWin.filter(f => f.blank)
const nomatch = inWin.filter(f => f.dyS === null && !f.blank)
const detRel = raw.detect ? raw.detect.host - t0 : null
const after = detRel === null ? [] : inTrial.filter(f => f.tRel > detRel)
const moving = after.filter(f => f.dyPrev !== null && Math.abs(f.dyPrev) > 2)
// expected offsets (still trials): row offset before + scrollTop before - scrollTop at the jump target
const ex = (o) => raw.mode === 'still' && o !== null && o !== undefined ? Math.round((o + raw.ra.st - raw.params[0]) * 10) / 10 : null
const rowOut = (key, b) => { const o0 = raw.ra[key] && raw.ra[key].o; const e = ex(o0); const v = b ? b[key] : null; return { i: raw.ra[key] && raw.ra[key].i, before: o0, expected: e, o500: raw.b500 ? raw.b500[key] : null, o1000: raw.b1000 ? raw.b1000[key] : null, drift500: e !== null && raw.b500 && raw.b500[key] !== null ? Math.round((raw.b500[key] - e) * 10) / 10 : null, drift1000: e !== null && raw.b1000 && raw.b1000[key] !== null ? Math.round((raw.b1000[key] - e) * 10) / 10 : null } }
const r2 = (key, a2o, k) => { const v5 = raw.b500 ? raw.b500[k] : null, v10 = raw.b1000 ? raw.b1000[k] : null; const dd = (v) => (a2o === null || a2o === undefined || v === null || v === undefined ? null : Math.round((v - a2o) * 10) / 10); return { i: raw.ra2 && raw.ra2[key] && raw.ra2[key].i, a2: a2o, o500: v5, o1000: v10, drift500: dd(v5), drift1000: dd(v10) } }
const ra2 = raw.ra2 || {}
const held2 = raw.mode === 'still' ? { A2: r2('A2', ra2.A2 && ra2.A2.o, 'A2'), S2: r2('S2', ra2.S2 && ra2.S2.o, 'S2'), R90: r2('R90', ra2.R90 && ra2.R90.o, 'R90'), st: ra2.st, visibleRows: ra2.visibleRows } : null
const summary = {
  held2,
  build, trial, mode: raw.mode, params: raw.params, frameSize: [W, H], scale, band: [yTop, yBot], clockOffsetMs: Math.round(off),
  selfCheck: kn && { knownShift: known.shift, estimated: kn.s, cost: Math.round(kn.cost * 10) / 10 },
  held: rowOut('A'), row90: rowOut('R90'),
  st: { before: raw.ra.st, b500: raw.b500 && raw.b500.st, b1000: raw.b1000 && raw.b1000.st },
  sh: { before: raw.ra.sh, b500: raw.b500 && raw.b500.sh, b1000: raw.b1000 && raw.b1000.sh },
  mounted: { before: raw.ra.nMsg, b500: raw.b500 && raw.b500.mi, mi: [raw.ra.mi, raw.b500 && raw.b500.mi, raw.b1000 && raw.b1000.mi] },
  polls: raw.pollCount, detectAfterStartMs: raw.detect ? raw.detect.host - t0 : null, detectPoll: raw.detect && { n: raw.detect.n, mi: raw.detect.mi },
  loadWindowStartMs: winStart, frames: { total: imgs.length, inTrial: inTrial.length, inLoadWindow: inWin.length, blank: blanks.map(f => f.i), displacedGt4: displaced.length, displacedFrames: displaced.map(f => f.i), noMatch: nomatch.map(f => f.i), afterLoad: after.length, movingAfterLoad: moving.map(f => ({ i: f.i, tRel: f.tRel, dy: f.dyPrev })), movingInWindow: inWin.filter(f => f.dyPrev !== null && Math.abs(f.dyPrev) > 2).map(f => ({ i: f.i, tRel: f.tRel, dy: f.dyPrev })) },
  series
}
fs.writeFileSync(`${OUT}/analysis.json`, JSON.stringify(summary, null, 1))
console.log(JSON.stringify({ build, trial, self: summary.selfCheck, held: summary.held, row90: summary.row90, frames: { total: imgs.length, displaced: displaced.length, nomatch: nomatch.length, movingAfterLoad: moving.length } }))
process.exit(0)
