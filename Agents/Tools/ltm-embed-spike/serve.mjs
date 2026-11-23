// node serve.mjs <root> <port> <logfile>
// Static file server for the embedding spike: model files, transformers.js and the wasm runtime, read by the app WebView over adb reverse.
// Invariants: binds 127.0.0.1 only; never serves a path outside <root>; every response carries CORS and no-store headers
// so a cross-origin module worker can import and the WebView never caches a stale model; every 404 is logged.
import { createServer } from 'node:http'
import { appendFileSync, createReadStream, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.onnx': 'application/octet-stream',
}
const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'no-store',
}

export const createSpikeServer = (rootArg, logFile) => {
  const root = resolve(rootArg)
  const log = (line) => appendFileSync(logFile, line + '\n')

  const resolveFile = (urlPath) => {
    let decoded
    try { decoded = decodeURIComponent(urlPath) } catch { return null }
    if (decoded.includes('\0')) return null
    const file = resolve(root, '.' + decoded)
    if (file !== root && !file.startsWith(root + sep)) return null
    try {
      const stat = statSync(file)
      return stat.isFile() ? { file, size: stat.size } : null
    } catch { return null }
  }

  return createServer((request, response) => {
    const urlPath = (request.url || '/').split('?')[0]
    if (request.method === 'OPTIONS') {
      response.writeHead(204, BASE_HEADERS)
      return response.end()
    }
    const found = resolveFile(urlPath)
    if (!found) {
      log('404 ' + urlPath)
      response.writeHead(404, BASE_HEADERS)
      return response.end()
    }
    const started = Date.now()
    response.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': MIME[extname(found.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': found.size,
    })
    if (request.method === 'HEAD') return response.end()
    createReadStream(found.file).pipe(response)
      .on('close', () => log('200 ' + urlPath + ' ' + found.size + ' ' + (Date.now() - started) + 'ms'))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rootArg, portArg, logFile] = process.argv.slice(2)
  if (!rootArg || !portArg || !logFile) {
    console.error('usage: node serve.mjs <root> <port> <logfile>')
    process.exit(4)
  }
  createSpikeServer(rootArg, logFile).listen(Number(portArg), '127.0.0.1', () => console.log('listening ' + portArg + ' root ' + resolve(rootArg)))
}
