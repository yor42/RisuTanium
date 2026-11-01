// One-shot meter reader for cdp-session.mjs `eval -f` (plain JS, injected at run time through CDP, read only).
//
// The file body is a single function expression and installs nothing on window. The caller builds the combined expression
// once and passes it to `eval -f`, which evaluates the file verbatim: the file text in parentheses, a newline, then the call, e.g. `(<file text>\n)({"afterSeq": 12})`. It returns one JSON
// value made of finite numbers, booleans and the pass kind label; no timers, no DOM, no storage, no ring is reset or changed.
//
//   netSignals  { present, partGlobal, partFirst } from __risuNetSignals.globals(); { present: false } on a plain build
//   savePass    { present, records } for the __risuSavePassMeter.all() records whose seq is greater than opts.afterSeq. Each
//               record keeps kind (one of KINDS), modules (boolean), every finite number at its top level (seq, at, characters,
//               units, planMs, maxSegmentMs, yields ...) and the numbers of its split and split.finish objects (listMs, frontMs,
//               moduleCount, carriedMs, previousEntriesMs, carriedUnitsMs, finishTreeMs, finish.* ...). Arrays (the per-character
//               split list included), the chaId and every other string are dropped.
//   commit      { present, count, lastUnits, lastMs } from __risuCommitMeter.all()
//   heap        { present, usedJSHeapSize, totalJSHeapSize } from performance.memory
//
// Reading rule for a pass: it is an edit pass when kind === 'edit'; modules is a secondary label only (a due tick encodes the
// modules, so an edit pass may also carry modules: true), and tick-kind records are the idle-net request.
(function (opts) {
  'use strict'
  // SavePassKind in src/ts/storage/store2/savePassMeter.ts
  var KINDS = ['rewriteAll', 'whole', 'tick', 'edit']
  var LABEL_KEYS = ['kind']
  var MAX_LABEL_LENGTH = 40
  var MAX_DEPTH = 3
  var afterSeq = opts && typeof opts.afterSeq === 'number' ? opts.afterSeq : -Infinity

  function isNumber(value) { return typeof value === 'number' && isFinite(value) }

  function reduceObject(record, depth) {
    var reduced = {}
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return reduced
    Object.keys(record).forEach(function (key) {
      var value = record[key]
      if (isNumber(value) || typeof value === 'boolean') reduced[key] = value
      else if (typeof value === 'string') {
        if (LABEL_KEYS.indexOf(key) >= 0 && KINDS.indexOf(value) >= 0 && value.length <= MAX_LABEL_LENGTH) reduced[key] = value
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value) && depth < MAX_DEPTH) {
        reduced[key] = reduceObject(value, depth + 1)
      }
    })
    return reduced
  }

  function readList(handle, method) {
    try {
      if (!handle || typeof handle[method] !== 'function') return null
      var records = handle[method]()
      return Array.isArray(records) ? records : null
    } catch (error) {
      return null
    }
  }

  function readNetSignals() {
    try {
      var handle = window.__risuNetSignals
      if (!handle || typeof handle.globals !== 'function') return { present: false }
      var globals = handle.globals()
      return {
        present: true,
        partGlobal: isNumber(globals && globals.partGlobal) ? globals.partGlobal : 0,
        partFirst: isNumber(globals && globals.partFirst) ? globals.partFirst : 0,
      }
    } catch (error) {
      return { present: false }
    }
  }

  function readSavePass() {
    var records = readList(window.__risuSavePassMeter, 'all')
    if (records === null) return { present: false }
    return {
      present: true,
      records: records
        .filter(function (record) { return record && isNumber(record.seq) && record.seq > afterSeq })
        .map(function (record) { return reduceObject(record, 1) }),
    }
  }

  function readCommit() {
    var records = readList(window.__risuCommitMeter, 'all')
    if (records === null) return { present: false }
    var last = records.length > 0 ? records[records.length - 1] : null
    return {
      present: true,
      count: records.length,
      lastUnits: last && isNumber(last.units) ? last.units : null,
      lastMs: last && isNumber(last.ms) ? last.ms : null,
    }
  }

  function readHeap() {
    var memory = typeof performance !== 'undefined' ? performance.memory : null
    if (!memory) return { present: false }
    return {
      present: true,
      usedJSHeapSize: isNumber(memory.usedJSHeapSize) ? memory.usedJSHeapSize : null,
      totalJSHeapSize: isNumber(memory.totalJSHeapSize) ? memory.totalJSHeapSize : null,
    }
  }

  return { netSignals: readNetSignals(), savePass: readSavePass(), commit: readCommit(), heap: readHeap() }
})
