// Module worker for the embedding spike. The page fetches this file and starts it from a Blob URL.
// Messages in:  {type:'init', base, model, dtype, threads, pooling} | {type:'embed', id, texts, prefix?} | {type:'dispose'}
// Messages out: {type:'ready', loadMs, dims} | {type:'done', id, ms, n, dim, checksum} | {type:'error', message}
// Invariant: vectors never leave the worker; only their count, dimension and a checksum of the first vector are posted.
let extractor = null
let pooling = 'mean'

const describe = (error) => (error && error.stack) ? String(error.stack) : String(error)

const init = async (message) => {
  const started = performance.now()
  const { env, pipeline } = await import(message.base + '/transformers.js')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = message.base + '/models/'
  env.useBrowserCache = false
  env.backends.onnx.wasm.wasmPaths = message.base + '/'
  env.backends.onnx.wasm.numThreads = message.threads || 1
  pooling = message.pooling || 'mean'
  extractor = await pipeline('feature-extraction', message.model, { dtype: message.dtype || 'q8', device: 'wasm' })
  const loadMs = Math.round(performance.now() - started)
  const probe = await extractor(['dimension probe'], { pooling, normalize: true })
  self.postMessage({ type: 'ready', loadMs, dims: probe.dims })
}

const embed = async (message) => {
  if (!extractor) throw new Error('embed before ready')
  const texts = message.prefix ? message.texts.map((text) => message.prefix + text) : message.texts
  const started = performance.now()
  const output = await extractor(texts, { pooling, normalize: true })
  const ms = Math.round((performance.now() - started) * 100) / 100
  const dim = output.dims[output.dims.length - 1]
  let sum = 0
  for (let i = 0; i < dim; i++) sum += output.data[i]
  self.postMessage({ type: 'done', id: message.id, ms, n: texts.length, dim, checksum: Number(sum.toFixed(4)) })
}

const dispose = async () => {
  if (extractor && typeof extractor.dispose === 'function') await extractor.dispose()
  extractor = null
}

self.onmessage = (event) => {
  const message = event.data
  const run = message.type === 'init' ? init : message.type === 'embed' ? embed : message.type === 'dispose' ? dispose : null
  if (!run) return self.postMessage({ type: 'error', message: 'unknown message type ' + message.type })
  run(message).catch((error) => self.postMessage({ type: 'error', message: describe(error), forType: message.type, id: message.id }))
}
self.onerror = (event) => {
  self.postMessage({ type: 'error', message: 'worker onerror ' + (event && event.message) })
}
