// node Agents/Tools/device/tests/read-meters.accept.mjs
// Acceptance test of probes/read-meters.js on the PC, no device and no browser: the harness builds a fake window and evaluates
// the combined expression exactly as the driver does for `cdp-session.mjs eval -f`: `(<file text>\n)(<options json>)`.
// Env: READ_METERS_PATH (another copy of the reader, for mutant runs).
// Plain asserts print PASS/FAIL; exit 0 only if every assert holds.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const READER = process.env.READ_METERS_PATH ?? path.join(HERE, '..', 'probes', 'read-meters.js')

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}
if (!existsSync(READER)) { console.log('FAIL missing file ' + READER); process.exit(1) }
const readerText = readFileSync(READER, 'utf8')

const KIND_ENUM = ['rewriteAll', 'whole', 'tick', 'edit']
// the reading rule of the reader's header: a pass is an edit pass only by kind
const isEditPass = (record) => record.kind === 'edit'

function evaluate(fakeWindow, options = {}, fakePerformance = {}) {
  const expression = '(' + readerText + '\n)(' + JSON.stringify(options) + ')'
  return new Function('window', 'performance', 'return ' + expression)(fakeWindow, fakePerformance)
}

function makeWindow(overrides = {}) {
  const passes = [
    { kind: 'edit', modules: false, characters: 2, seq: 5, at: 100, units: 3, planMs: 4, maxSegmentMs: 2, yields: 1, title: 'secret title',
      split: { listMs: 1, frontMs: 2, carriedMs: 3, previousEntriesMs: 4, carriedUnitsMs: 5, finishTreeMs: 6, moduleCount: 7,
        finish: { shardsMs: 8, fixedMs: 9, configMs: 10, manifestMs: 11 },
        characters: [{ chaId: 'secret-id', ms: 1, skipped: false }], chaId: 'secret-id' } },
    { kind: 'tick', modules: true, characters: 0, seq: 6, at: 200, units: 1, planMs: 1, maxSegmentMs: 1, yields: 0, split: { listMs: 1, finish: { shardsMs: 1 } } },
  ]
  return {
    __risuNetSignals: { globals: () => ({ partGlobal: 4, partFirst: 2, tagOverwritten: 1, input: 9 }), reset: () => { rings.resetCalled = true } },
    __risuSavePassMeter: { all: () => passes, units: () => [] },
    __risuCommitMeter: { all: () => [{ kind: 'ordinary', units: 2, ms: 3 }, { kind: 'bulk', units: 4, ms: 5, secret: 'secret' }], reset: () => { rings.resetCalled = true } },
    ...overrides,
  }
}
const rings = { resetCalled: false }

// tree walk: every leaf is a number, a boolean, or the string value of key kind that is in the enum
function leafProblems(value, key = '') {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return typeof value === 'number' && !isFinite(value) ? [key] : []
  if (typeof value === 'string') return key === 'kind' && KIND_ENUM.includes(value) ? [] : [key + '=' + value]
  if (Array.isArray(value)) return value.flatMap((item, i) => leafProblems(item, key + '[' + i + ']'))
  return Object.entries(value).flatMap(([k, v]) => leafProblems(v, k))
}

{
  // 1 privacy
  const out = evaluate(makeWindow())
  const text = JSON.stringify(out)
  check(!text.includes('secret'), '1a no secret string in the output', text.slice(0, 300))
  check(leafProblems(out).length === 0, '1b every leaf is a number, a boolean or a whitelisted kind', JSON.stringify(leafProblems(out)))
  check(!text.includes('chaId') && !text.includes('characters":['), '1c no per-character list and no chaId', text.slice(0, 300))

  // 2 fields kept
  const records = out.savePass.records
  check(records.length === 2, '2a both pass records are present', JSON.stringify(records).slice(0, 300))
  check(records[0].kind === 'edit' && records[0].modules === false && records[1].kind === 'tick' && records[1].modules === true,
    '2b kind and modules are kept and distinguishable', JSON.stringify(records.map((r) => [r.kind, r.modules])))
  check(records[0].characters === 2 && records[0].seq === 5 && records[0].units === 3 && records[0].planMs === 4 && records[0].maxSegmentMs === 2 && records[0].yields === 1 && records[0].at === 100,
    '2c the numeric top-level fields are kept', JSON.stringify(records[0]))
  const split = records[0].split ?? {}
  check(split.listMs === 1 && split.frontMs === 2 && split.carriedMs === 3 && split.previousEntriesMs === 4 && split.carriedUnitsMs === 5 && split.finishTreeMs === 6 && split.moduleCount === 7
    && split.finish && split.finish.shardsMs === 8 && split.finish.manifestMs === 11, '2d the numeric split and split.finish fields are kept', JSON.stringify(split))
  const foreign = evaluate(makeWindow({ __risuSavePassMeter: { all: () => [{ kind: 'secret title', modules: false, seq: 1 }, { kind: 'edit', modules: true, seq: 2 }] } }))
  check(foreign.savePass.records[0].kind === undefined && foreign.savePass.records[0].modules === false, '2e a kind outside the enum is dropped', JSON.stringify(foreign.savePass.records))
  check(!JSON.stringify(foreign).includes('secret'), '2f the foreign kind text never reaches the output')

  // reading rule: an edit pass is identified by kind, also when it carries modules: true
  check(isEditPass(foreign.savePass.records[1]) && !isEditPass(records[1]), '2g kind decides the edit pass: {kind:edit, modules:true} counts, the tick does not', JSON.stringify(foreign.savePass.records[1]))

  // 3 afterSeq filter
  const filtered = evaluate(makeWindow(), { afterSeq: 5 })
  check(filtered.savePass.records.length === 1 && filtered.savePass.records[0].seq === 6, '3 records with seq <= afterSeq are absent', JSON.stringify(filtered.savePass.records.map((r) => r.seq)))

  // commit, net signals, heap
  check(out.commit.present && out.commit.count === 2 && out.commit.lastUnits === 4 && out.commit.lastMs === 5, 'commit count and last units and ms', JSON.stringify(out.commit))
  check(out.netSignals.present === true && out.netSignals.partGlobal === 4 && out.netSignals.partFirst === 2 && !('tagOverwritten' in out.netSignals), 'net signals reduced to partGlobal and partFirst', JSON.stringify(out.netSignals))
  const heap = evaluate(makeWindow(), {}, { memory: { usedJSHeapSize: 10, totalJSHeapSize: 20 } }).heap
  check(heap.present === true && heap.usedJSHeapSize === 10 && heap.totalJSHeapSize === 20, 'heap numbers when performance.memory exists', JSON.stringify(heap))
}

{
  // 4 absent rings
  let out
  let threw = null
  try { out = evaluate({}) } catch (error) { threw = error }
  check(threw === null, '4a absent rings do not throw', String(threw))
  check(out && out.netSignals.present === false && out.savePass.present === false && out.commit.present === false && out.heap.present === false, '4b every section reports present:false', JSON.stringify(out))
}

{
  // 5 no mutation of the rings
  const fakeWindow = makeWindow()
  const keysBefore = JSON.stringify(Object.keys(fakeWindow))
  const snapshot = JSON.stringify([fakeWindow.__risuSavePassMeter.all(), fakeWindow.__risuCommitMeter.all(), fakeWindow.__risuNetSignals.globals()])
  rings.resetCalled = false
  evaluate(fakeWindow, { afterSeq: 5 })
  const after = JSON.stringify([fakeWindow.__risuSavePassMeter.all(), fakeWindow.__risuCommitMeter.all(), fakeWindow.__risuNetSignals.globals()])
  check(snapshot === after && rings.resetCalled === false, '5 the rings are deep-equal after the read and reset() was never called')

  // 6 nothing installed on window
  evaluate(fakeWindow)
  check(JSON.stringify(Object.keys(fakeWindow)) === keysBefore, '6 the window keys are identical before and after', JSON.stringify(Object.keys(fakeWindow)))
}

console.log(failures === 0 ? 'ALL PASSED' : 'FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)
