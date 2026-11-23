// Evaluated through: node Agents/Tools/device/cdp.mjs <port> -f probe.js
// One IIFE expression. Installs window.__s3a once (idempotent) and returns its version string.
// Methods return JSON-serialisable values and finish quickly; long work (load, index) runs as background promises whose
// progress lives on window.__s3a.state and is read through poll() and snapshot().
// Invariants: monitors only record, they never schedule work that competes with the worker; vectors are never held here.
(function () {
  var VERSION = 's3a-2'
  if (window.__s3a && window.__s3a.version === VERSION) return VERSION
  // An older probe in this page is torn down so its worker and monitors do not outlive the replacement.
  if (window.__s3a && typeof window.__s3a.stop === 'function') { try { window.__s3a.stop() } catch (error) { /* replaced anyway */ } }

  var MAX_LONGTASKS = 5000
  var WORST = 30
  var PHASE_ZERO = 'idle-baseline'

  var EN_WORDS = ('the of and to in is that for it as with was on be at by this had not are but from or have an they which one you ' +
    'were her all she there would their we him been has when who will more no if out so said what up its about into than them can ' +
    'only other new some could time these two may then do first any my now such like our over man me even most made after also did ' +
    'many before must through back years where much your way well down should because each just those people how too little state ' +
    'good very make world still own see men work long get here between both life being under never day same another know while ' +
    'last might us great old year off come since against go came right used take three memory story night garden river letter ' +
    'window silver quiet promise lantern harbor winter morning shadow castle travel whisper market bridge candle forest').split(' ')
  var KO_WORDS = ('오늘은 날씨가 정말 좋아서 우리는 함께 공원을 걸었다 그녀는 조용히 창밖을 바라보며 지난 겨울의 기억을 떠올렸다 ' +
    '그가 말없이 편지를 건네자 방 안에는 잠시 침묵이 흘렀다 하지만 이야기는 거기서 끝나지 않았고 새로운 약속이 시작되었다 ' +
    '바람이 불어오는 언덕 위에서 두 사람은 오래된 등불을 켜고 밤새 서로의 이야기를 나누었다 아침이 되어서야 강가의 시장에는 ' +
    '사람들이 모여들었고 누군가는 다리 위에서 천천히 손을 흔들었다').split(' ')

  var mulberry32 = function (seed) {
    var a = seed >>> 0
    return function () {
      a = (a + 0x6D2B79F5) >>> 0
      var t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  var makeMessages = function (count, seed) {
    var random = mulberry32(seed)
    var out = []
    for (var i = 0; i < count; i++) {
      var text = ''
      if (random() < 0.4) {
        var target = 160 + Math.floor(random() * 41)
        while (text.length < target) {
          var piece = KO_WORDS[Math.floor(random() * KO_WORDS.length)]
          text += (text ? ' ' : '') + piece
        }
        text = text.slice(0, target)
      } else {
        var words = 50 + Math.floor(random() * 21)
        var parts = []
        for (var w = 0; w < words; w++) parts.push(EN_WORDS[Math.floor(random() * EN_WORDS.length)])
        text = parts.join(' ')
      }
      out.push(text)
    }
    return out
  }

  var state = {
    version: VERSION,
    pageSessionId: Math.random().toString(36).slice(2) + Date.now().toString(36),
    installedAt: performance.now(),
    timeline: [{ name: PHASE_ZERO, at: performance.now() }],
    longtasks: [],
    longtaskDropped: 0,
    raf: {},
    interval: {},
    worker: null,
    workerAlive: false,
    workerErrors: [],
    constructError: null,
    cspHint: null,
    monitors: [],
    ready: false,
    loading: false,
    loadMs: null,
    dims: null,
    pending: {},
    nextId: 1,
    config: null,
    index: null,
  }

  var currentPhase = function () { return state.timeline[state.timeline.length - 1].name }
  var phaseAt = function (t) {
    var name = state.timeline[0].name
    for (var i = 0; i < state.timeline.length; i++) {
      if (state.timeline[i].at <= t) name = state.timeline[i].name
      else break
    }
    return name
  }
  var bucket = function (map, name) {
    if (!map[name]) map[name] = { max: 0, over: 0, samples: 0, worst: [] }
    return map[name]
  }
  var record = function (b, value, threshold, at) {
    b.samples++
    if (value > b.max) b.max = value
    if (value > threshold) b.over++
    b.worst.push({ at: Math.round(at), value: Math.round(value * 10) / 10 })
    b.worst.sort(function (x, y) { return y.value - x.value })
    if (b.worst.length > WORST) b.worst.length = WORST
  }

  var startMonitors = function () {
    try {
      var observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (state.longtasks.length >= MAX_LONGTASKS) { state.longtaskDropped++; return }
          state.longtasks.push({ start: Math.round(entry.startTime * 10) / 10, duration: Math.round(entry.duration * 10) / 10 })
        })
      })
      observer.observe({ type: 'longtask', buffered: true })
      state.monitors.push(function () { observer.disconnect() })
    } catch (error) {
      state.longtaskUnsupported = String(error && error.message ? error.message : error)
    }
    var last = performance.now()
    var rafHandle = 0
    var tick = function (now) {
      var t = performance.now()
      record(bucket(state.raf, currentPhase()), t - last, 100, t)
      last = t
      rafHandle = requestAnimationFrame(tick)
    }
    rafHandle = requestAnimationFrame(tick)
    state.monitors.push(function () { cancelAnimationFrame(rafHandle) })
    var expected = performance.now() + 50
    var timer = setInterval(function () {
      var t = performance.now()
      record(bucket(state.interval, currentPhase()), Math.max(0, t - expected), 50, t)
      expected = t + 50
    }, 50)
    state.monitors.push(function () { clearInterval(timer) })
  }

  var markPhase = function (name) {
    state.timeline.push({ name: name, at: performance.now() })
    return name
  }

  var longtaskStats = function () {
    var out = {}
    var names = state.timeline.map(function (p) { return p.name })
    names.forEach(function (name) { out[name] = { count: 0, totalMs: 0, maxMs: 0, over50: 0 } })
    state.longtasks.forEach(function (task) {
      var s = out[phaseAt(task.start)]
      s.count++
      s.totalMs += task.duration
      if (task.duration > s.maxMs) s.maxMs = task.duration
      if (task.duration > 50) s.over50++
    })
    Object.keys(out).forEach(function (k) { out[k].totalMs = Math.round(out[k].totalMs * 10) / 10 })
    return out
  }

  var phaseStats = function () {
    var now = performance.now()
    var lt = longtaskStats()
    var out = {}
    state.timeline.forEach(function (p, i) {
      var end = i + 1 < state.timeline.length ? state.timeline[i + 1].at : now
      var r = state.raf[p.name]
      var iv = state.interval[p.name]
      out[p.name] = {
        durationMs: Math.round(end - p.at),
        longtask: lt[p.name],
        rafMaxGapMs: r ? Math.round(r.max * 10) / 10 : null,
        rafGapsOver100: r ? r.over : 0,
        intervalMaxLatenessMs: iv ? Math.round(iv.max * 10) / 10 : null,
        intervalOver50: iv ? iv.over : 0,
      }
    })
    return out
  }

  var errorText = function (error) {
    return String(error && error.message ? error.message : error)
  }

  var send = function (message) {
    return new Promise(function (resolve, reject) {
      var id = state.nextId++
      message.id = id
      state.pending[id] = { resolve: resolve, reject: reject }
      state.worker.postMessage(message)
    })
  }

  var onWorkerMessage = function (event) {
    var m = event.data
    if (m.type === 'ready') {
      state.ready = true
      state.loading = false
      state.loadMs = m.loadMs
      state.dims = m.dims
    } else if (m.type === 'done') {
      var p = state.pending[m.id]
      if (p) { delete state.pending[m.id]; p.resolve(m) }
    } else if (m.type === 'error') {
      state.workerErrors.push({ at: Math.round(performance.now()), message: String(m.message).slice(0, 600), forType: m.forType || null })
      state.loading = false
      var q = m.id && state.pending[m.id]
      if (q) { delete state.pending[m.id]; q.reject(new Error(m.message)) }
    }
  }

  var api = {
    version: VERSION,
    state: state,

    start: function (cfg) {
      // A second run in the same page must not inherit the previous worker, phases or counters.
      state.ready = false; state.loading = false; state.loadMs = null; state.dims = null
      state.pending = {}; state.index = null; state.workerErrors = []; state.constructError = null; state.cspHint = null
      state.longtasks = []; state.longtaskDropped = 0; state.raf = {}; state.interval = {}
      state.timeline = [{ name: PHASE_ZERO, at: performance.now() }]
      state.config = cfg
      startMonitors()
      return fetch(cfg.base + '/worker.mjs', { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('worker.mjs fetch status ' + response.status)
        return response.text()
      }).then(function (source) {
        var blob = new Blob([source], { type: 'text/javascript' })
        try {
          var worker = new Worker(URL.createObjectURL(blob), { type: 'module' })
          worker.onmessage = onWorkerMessage
          worker.onerror = function (event) {
            state.workerAlive = false
            state.workerErrors.push({ at: Math.round(performance.now()), message: 'onerror ' + (event && event.message ? event.message : 'no message'), forType: null })
          }
          worker.onmessageerror = function () {
            state.workerErrors.push({ at: Math.round(performance.now()), message: 'onmessageerror', forType: null })
          }
          state.worker = worker
          state.workerAlive = true
          return { ok: true, constructError: null }
        } catch (error) {
          state.constructError = errorText(error)
          state.cspHint = 'Worker construction threw; a blob: worker-src/script-src CSP block would appear here'
          return { ok: false, constructError: state.constructError }
        }
      }).catch(function (error) {
        state.constructError = state.constructError || errorText(error)
        return { ok: false, constructError: state.constructError }
      })
    },

    markPhase: markPhase,

    load: function () {
      if (!state.worker) return { ok: false, reason: 'no worker' }
      markPhase('load')
      state.loading = true
      state.worker.postMessage({
        type: 'init', base: state.config.base, model: state.config.model,
        dtype: state.config.dtype || 'q8', threads: 1, pooling: state.config.pooling || 'mean',
      })
      return { ok: true }
    },

    runIndex: function (cfg) {
      if (!state.ready) return { ok: false, reason: 'worker not ready' }
      if (state.index && !state.index.finished) return { ok: false, reason: 'index already running' }
      markPhase('index')
      var messages = makeMessages(cfg.count, cfg.seed || 1)
      var idx = {
        total: cfg.count, batch: cfg.batch, done: 0, batches: 0, callMs: [], wallMs: [],
        startedAt: performance.now(), totalMs: null, msgsPerSec: null, finished: false, error: null, checksums: [],
      }
      state.index = idx
      var step = function (from) {
        if (from >= messages.length) return Promise.resolve()
        var texts = messages.slice(from, from + cfg.batch)
        var t0 = performance.now()
        return send({ type: 'embed', texts: texts }).then(function (m) {
          idx.callMs.push(m.ms)
          idx.wallMs.push(Math.round((performance.now() - t0) * 10) / 10)
          if (idx.checksums.length < 3) idx.checksums.push(m.checksum)
          idx.done += m.n
          idx.batches++
          idx.dim = m.dim
          return step(from + cfg.batch)
        })
      }
      step(0).then(function () {
        idx.totalMs = Math.round(performance.now() - idx.startedAt)
        idx.msgsPerSec = Math.round((idx.done / (idx.totalMs / 1000)) * 100) / 100
        idx.finished = true
      }).catch(function (error) {
        idx.error = errorText(error)
        idx.totalMs = Math.round(performance.now() - idx.startedAt)
        idx.finished = true
      })
      return { ok: true, total: cfg.count }
    },

    poll: function (since) {
      var idx = state.index
      var from = since || 0
      return {
        pageSessionId: state.pageSessionId,
        phase: currentPhase(),
        ready: state.ready,
        loading: state.loading,
        loadMs: state.loadMs,
        dims: state.dims,
        workerAlive: state.workerAlive,
        workerErrors: state.workerErrors.length,
        index: idx ? {
          total: idx.total, done: idx.done, batches: idx.batches, finished: idx.finished, error: idx.error,
          totalMs: idx.totalMs, msgsPerSec: idx.msgsPerSec, dim: idx.dim || null,
          callMs: idx.callMs.slice(from), callCount: idx.callMs.length,
        } : null,
        phaseStats: phaseStats(),
      }
    },

    snapshot: function () {
      var worst = state.longtasks.slice().sort(function (a, b) { return b.duration - a.duration }).slice(0, WORST)
      var memory = performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null
      var rafMax = 0
      var intervalMax = 0
      Object.keys(state.raf).forEach(function (k) { if (state.raf[k].max > rafMax) rafMax = state.raf[k].max })
      Object.keys(state.interval).forEach(function (k) { if (state.interval[k].max > intervalMax) intervalMax = state.interval[k].max })
      return {
        pageSessionId: state.pageSessionId,
        phase: currentPhase(),
        phaseStats: phaseStats(),
        longtasks: worst,
        longtaskTotal: state.longtasks.length,
        longtaskDropped: state.longtaskDropped,
        longtaskUnsupported: state.longtaskUnsupported || null,
        rafMaxGapMs: Math.round(rafMax * 10) / 10,
        intervalMaxLatenessMs: Math.round(intervalMax * 10) / 10,
        workerAlive: state.workerAlive,
        workerErrors: state.workerErrors,
        constructError: state.constructError,
        cspHint: state.cspHint,
        ready: state.ready,
        loadMs: state.loadMs,
        memory: memory,
        deviceMemory: navigator.deviceMemory === undefined ? null : navigator.deviceMemory,
        hardwareConcurrency: navigator.hardwareConcurrency === undefined ? null : navigator.hardwareConcurrency,
        crossOriginIsolated: window.crossOriginIsolated === undefined ? null : window.crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer,
        userAgent: navigator.userAgent,
        origin: location.origin,
        checksums: state.index ? state.index.checksums : [],
      }
    },

    stop: function () {
      if (state.worker) {
        try { state.worker.postMessage({ type: 'dispose' }) } catch (error) { /* terminating anyway */ }
        state.worker.terminate()
      }
      state.worker = null
      state.workerAlive = false
      state.monitors.forEach(function (stopFn) { stopFn() })
      state.monitors = []
      return { ok: true }
    },
  }

  window.__s3a = api
  return VERSION
})()
