// In-page probe for cdp-session.mjs `probe` (plain JS, no build, injected at run time through CDP). It installs
// window.__devb32Probe with start(label, opts), mark(name) and stop(); stop() returns plain JSON and removes the property.
//
// What it measures while started (numbers, counts, labels and bucket times only; no DOM text, no names, no settings):
//   - longTasks: PerformanceObserver 'longtask' entries (startTime, duration; attribution is dropped).
//   - frames: rAF gaps as a histogram plus the 20 largest gaps with their times (not every frame, so memory stays bounded).
//   - bursts / buckets: DOM remounts of message bodies. A MutationObserver on document.body (childList, subtree) counts the
//     message-body roots removed and added per observer callback. Callbacks less than BURST_GAP_MS apart form one burst (a
//     coalesced rebuild); callbacks BURST_GAP_MS or more apart are separate bursts (a second rebuild after a chat open).
//   - rings: a read-only snapshot at start and at stop of the MEASURE rings, reported as what was added in between. New records
//     are found by locating the last start record in the stop list (the rings are capped, push then shift, so a full ring keeps
//     its length); wrapped means start records were evicted, lastStartFound false means the count is only a lower bound.
//
// bodySelector (start opts) defaults to '.chattext'. Source reading: src/lib/ChatScreens/Chat.svelte renders each message body
// as the span `<span class="text chat-width chattext prose minw-0" bind:this={bodyRoot}>`, and the Chat.*.svelte.test.ts files
// sample bodies with the same '.chattext' selector. One such element exists per rendered message, so counting elements that
// match it (the node itself, or any descendant of a removed or added subtree) counts rebuilt messages.
//
// Rings (names confirmed in the sources; the accessors differ from the planning spec, which guessed `snapshot()` on all):
//   __risuChatPhases   (src/ts/process/chatPhaseRing.ts)         snapshot(): records of kind select | script | edit, each with t
//   __risuSavePassMeter(src/ts/storage/store2/savePassMeter.ts)  all(): pass records; units(): one record per committed pass
//   __risuCommitMeter  (src/ts/storage/store2/commitMeter.ts)    all(): commit records
//   __risuYieldGapMeter(src/ts/storage/store2/saveYieldMeter.ts) all(): yield-gap records
// A ring may register its global lazily (chatPhaseRing does so at its first note), so one that is absent at start and present at
// stop is reported with appearedDuringRun. ringsPresent is false when none of the four exists: a plain (non-MEASURE) build, which
// must not be mistaken for a MEASURE build. Record fields are reduced to finite numbers, booleans and a few short label strings.
(function () {
  'use strict'
  if (window.__devb32Probe) throw new Error('window.__devb32Probe is already installed')

  var BURST_GAP_MS = 100
  var BUCKET_MS = 100
  var LARGEST_GAPS = 20
  var MAX_BURSTS = 500
  var MAX_LONG_TASKS = 500
  var MAX_ADDED_RECORDS = 200
  var GAP_BOUNDS = [17, 34, 50, 100, 200, 500]
  var LABEL_KEYS = ['kind', 'outcome', 'mode', 'cache', 'status', 'reason', 'verdict', 'label', 'point']

  var state = null

  function now() { return performance.now() }

  function reduceRecord(record) {
    var reduced = {}
    if (record === null || typeof record !== 'object') return reduced
    Object.keys(record).forEach(function (key) {
      var value = record[key]
      if ((typeof value === 'number' && isFinite(value)) || typeof value === 'boolean') reduced[key] = value
      else if (typeof value === 'string' && value.length <= 40 && LABEL_KEYS.indexOf(key) >= 0) reduced[key] = value
    })
    return reduced
  }

  function sumNumbers(records) {
    var sums = {}
    records.forEach(function (record) {
      Object.keys(record).forEach(function (key) {
        if (typeof record[key] === 'number') sums[key] = (sums[key] || 0) + record[key]
      })
    })
    return sums
  }

  // each reader returns { present, length, records } and never throws
  function readList(handle, method) {
    try {
      if (!handle || typeof handle[method] !== 'function') return { present: false, length: 0, records: [] }
      var records = handle[method]()
      return { present: true, length: Array.isArray(records) ? records.length : 0, records: Array.isArray(records) ? records : [] }
    } catch (error) {
      return { present: false, length: 0, records: [], error: String(error && error.message).slice(0, 80) }
    }
  }

  function readRings() {
    return {
      chatPhases: readList(window.__risuChatPhases, 'snapshot'),
      savePass: readList(window.__risuSavePassMeter, 'all'),
      savePassUnits: readList(window.__risuSavePassMeter, 'units'),
      commit: readList(window.__risuCommitMeter, 'all'),
      yieldGap: readList(window.__risuYieldGapMeter, 'all'),
    }
  }

  function fingerprint(record) {
    try { return JSON.stringify(record) } catch (error) { return null }
  }

  // A full ring pushes then shifts, so its length stays constant and the start length cannot locate the new records. The
  // records carry no common sequence field (commit and yield-gap records have none), so the last start record is located in
  // the stop list by content and everything after it is new. wrapped is true when the first start record was evicted (or the
  // ring was reset): the added count is then still exact if the last start record survived, and a lower bound otherwise
  // (lastStartFound false).
  function addedSince(startRead, stopRead) {
    if (startRead.records.length === 0) return { records: stopRead.records.slice(), wrapped: false, lastStartFound: true }
    var firstStart = fingerprint(startRead.records[0])
    var lastStart = fingerprint(startRead.records[startRead.records.length - 1])
    var stopPrints = stopRead.records.map(fingerprint)
    var lastIndex = lastStart === null ? -1 : stopPrints.lastIndexOf(lastStart)
    var firstFound = firstStart !== null && stopPrints.indexOf(firstStart) >= 0
    if (lastIndex < 0) return { records: stopRead.records.slice(), wrapped: true, lastStartFound: false }
    return { records: stopRead.records.slice(lastIndex + 1), wrapped: !firstFound, lastStartFound: true }
  }

  function describeRing(startRead, stopRead) {
    if (!stopRead.present) return { status: 'absent' }
    var added = addedSince(startRead, stopRead)
    var reduced = added.records.map(reduceRecord)
    return {
      status: 'present', appearedDuringRun: !startRead.present, wrapped: added.wrapped, lastStartFound: added.lastStartFound,
      addedCount: reduced.length, sums: sumNumbers(reduced), added: reduced.slice(0, MAX_ADDED_RECORDS),
    }
  }

  function describeChatPhases(startRead, stopRead, startedAt) {
    if (!stopRead.present) return { status: 'absent' }
    // the ring keeps its newest 2000 records, so what this run added is what carries a time at or after the start
    var added = stopRead.records.filter(function (record) { return record && typeof record.t === 'number' && record.t >= startedAt })
    var reduced = added.map(reduceRecord)
    var counts = {}
    reduced.forEach(function (record) { counts[record.kind || 'unknown'] = (counts[record.kind || 'unknown'] || 0) + 1 })
    var scripts = reduced.filter(function (record) { return record.kind === 'script' })
    return {
      status: 'present', appearedDuringRun: !startRead.present, addedCount: reduced.length, countsByKind: counts,
      script: scripts.slice(0, MAX_ADDED_RECORDS).map(function (r) {
        return { mode: r.mode, ms: r.ms, cache: r.cache, scans: r.scans, earlyRejects: r.earlyRejects, t: r.t }
      }),
      scriptMsSum: sumNumbers(scripts).ms || 0, scriptScansSum: sumNumbers(scripts).scans || 0,
      other: reduced.filter(function (record) { return record.kind !== 'script' }).slice(0, MAX_ADDED_RECORDS),
    }
  }

  function countBodies(node, selector) {
    if (node.nodeType !== 1) return 0
    return (node.matches(selector) ? 1 : 0) + node.querySelectorAll(selector).length
  }

  function addBurstEvent(s, t, removed, added) {
    var bucketStart = Math.floor(t / BUCKET_MS) * BUCKET_MS
    var bucket = s.buckets[s.buckets.length - 1]
    if (!bucket || bucket.t0 !== bucketStart) {
      bucket = { t0: bucketStart, removed: 0, added: 0 }
      s.buckets.push(bucket)
    }
    bucket.removed += removed
    bucket.added += added
    var burst = s.currentBurst
    if (burst && t - burst.tEnd < BURST_GAP_MS) {
      burst.tEnd = t
      burst.removed += removed
      burst.added += added
      burst.callbacks += 1
      return
    }
    if (burst && s.bursts.length < MAX_BURSTS) s.bursts.push(burst)
    s.currentBurst = { tStart: t, tEnd: t, removed: removed, added: added, callbacks: 1 }
  }

  function gapBucketIndex(gap) {
    for (var i = 0; i < GAP_BOUNDS.length; i++) { if (gap <= GAP_BOUNDS[i]) return i }
    return GAP_BOUNDS.length
  }

  function histogramOf(counts) {
    var out = {}
    GAP_BOUNDS.forEach(function (bound, i) { out['<=' + bound] = counts[i] })
    out['>' + GAP_BOUNDS[GAP_BOUNDS.length - 1]] = counts[GAP_BOUNDS.length]
    return out
  }

  var probe = {
    start: function (label, opts) {
      if (state) throw new Error('probe already started')
      opts = opts || {}
      var selector = typeof opts.bodySelector === 'string' ? opts.bodySelector : '.chattext'
      document.querySelector(selector) // throws on an invalid selector, before anything is installed
      var s = {
        label: String(label || ''), selector: selector, startedAt: now(), startRings: readRings(),
        longTasks: [], gapCounts: GAP_BOUNDS.concat([0]).map(function () { return 0 }), largestGaps: [], frames: 0, lastFrame: null, rafId: 0,
        bursts: [], currentBurst: null, buckets: [], marks: [], warnings: [],
        longTaskObserver: null, mutationObserver: null,
      }
      state = s
      try {
        s.longTaskObserver = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (entry) {
            if (s.longTasks.length < MAX_LONG_TASKS) s.longTasks.push({ start: entry.startTime, duration: entry.duration })
          })
        })
        s.longTaskObserver.observe({ type: 'longtask', buffered: false })
      } catch (error) {
        s.longTaskObserver = null
        s.warnings.push('longtask observer unavailable')
      }
      s.handleMutations = function (records) {
        var removed = 0
        var added = 0
        records.forEach(function (record) {
          record.removedNodes.forEach(function (node) { removed += countBodies(node, s.selector) })
          record.addedNodes.forEach(function (node) { added += countBodies(node, s.selector) })
        })
        if (removed > 0 || added > 0) addBurstEvent(s, now(), removed, added)
      }
      s.mutationObserver = new MutationObserver(s.handleMutations)
      s.mutationObserver.observe(document.body, { childList: true, subtree: true })
      var onFrame = function (t) {
        if (state !== s) return
        s.frames += 1
        if (s.lastFrame !== null) {
          var gap = t - s.lastFrame
          s.gapCounts[gapBucketIndex(gap)] += 1
          var smallest = s.largestGaps.length < LARGEST_GAPS ? null : s.largestGaps[s.largestGaps.length - 1]
          if (smallest === null || gap > smallest.gapMs) {
            s.largestGaps.push({ t: t, gapMs: gap })
            s.largestGaps.sort(function (a, b) { return b.gapMs - a.gapMs })
            if (s.largestGaps.length > LARGEST_GAPS) s.largestGaps.length = LARGEST_GAPS
          }
        }
        s.lastFrame = t
        s.rafId = requestAnimationFrame(onFrame)
      }
      s.rafId = requestAnimationFrame(onFrame)
    },

    mark: function (name) {
      if (!state) throw new Error('probe not started')
      state.marks.push({ name: String(name), t: now() })
    },

    stop: function () {
      var s = state
      if (!s) throw new Error('probe not started')
      state = null
      var stoppedAt = now()
      cancelAnimationFrame(s.rafId)
      if (s.longTaskObserver) {
        var pending = s.longTaskObserver.takeRecords()
        pending.forEach(function (entry) { if (s.longTasks.length < MAX_LONG_TASKS) s.longTasks.push({ start: entry.startTime, duration: entry.duration }) })
        s.longTaskObserver.disconnect()
      }
      var pendingMutations = s.mutationObserver.takeRecords()
      if (pendingMutations.length > 0) s.handleMutations(pendingMutations)
      s.mutationObserver.disconnect()
      if (s.currentBurst && s.bursts.length < MAX_BURSTS) s.bursts.push(s.currentBurst)
      var stopRings = readRings()
      var rings = {
        chatPhases: describeChatPhases(s.startRings.chatPhases, stopRings.chatPhases, s.startedAt),
        savePass: describeRing(s.startRings.savePass, stopRings.savePass),
        savePassUnits: describeRing(s.startRings.savePassUnits, stopRings.savePassUnits),
        commit: describeRing(s.startRings.commit, stopRings.commit),
        yieldGap: describeRing(s.startRings.yieldGap, stopRings.yieldGap),
      }
      var ringsPresent = ['chatPhases', 'savePass', 'commit', 'yieldGap'].some(function (name) { return rings[name].status === 'present' })
      if (!ringsPresent) s.warnings.push('no MEASURE ring exists on this page: this is not a MEASURE build')
      var result = {
        label: s.label, bodySelector: s.selector, startedAt: s.startedAt, stoppedAt: stoppedAt, durationMs: stoppedAt - s.startedAt,
        ringsPresent: ringsPresent, rings: rings, warnings: s.warnings,
        longTasks: s.longTasks,
        frames: { count: s.frames, histogramMs: histogramOf(s.gapCounts), largestGaps: s.largestGaps },
        burstGapMs: BURST_GAP_MS, bursts: s.bursts.map(function (b) {
          return { tStart: b.tStart, tEnd: b.tEnd, removed: b.removed, added: b.added, callbacks: b.callbacks }
        }),
        buckets: s.buckets, marks: s.marks,
      }
      delete window.__devb32Probe
      return result
    },
  }

  window.__devb32Probe = probe
})()
