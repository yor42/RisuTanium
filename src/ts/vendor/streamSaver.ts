/*! streamsaver. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */

/*
 * Vendored from streamsaver 2.0.6 (MIT, Copyright (c) 2016 Jimmy Karl Roland Wärting). The full licence text is in
 * the streamsaver package. Patched: createWriteStream (returns { writable, ready }, drops the deprecated argument
 * forms, and its abort sink tolerates a channel already closed by the worker), the module wrapper (ES module with a
 * default export and local types, replacing the UMD wrapper) and the exported useBlobFallback decision. The helper
 * pages are public/streamsaver/mitm.html and sw.js.
 */

/** Options for `createWriteStream`. */
export interface StreamSaverOptions {
  /** Value for the Content-Length header, when the final size is known. */
  size?: number | null
  /** Path of the download URL inside the helper's scope. */
  pathname?: string | null
  writableStrategy?: QueuingStrategy<Uint8Array>
  readableStrategy?: QueuingStrategy<Uint8Array>
}

/**
 * What `createWriteStream` returns.
 *
 * `ready` resolves when the helper's service worker has answered the download request with a `{ download }` message,
 * which happens before any byte is written. It never resolves when the helper does not answer, so a caller that must
 * not stall waits on it with its own timeout. On the Blob path no helper is involved and `ready` is already resolved.
 */
export interface StreamSaverWriteStream {
  writable: WritableStream<Uint8Array>
  ready: Promise<void>
}

export interface StreamSaverApi {
  createWriteStream(filename: string, options?: StreamSaverOptions): StreamSaverWriteStream
  supported: boolean
  version: { full: string, major: number, minor: number, dot: number }
  /** URL of the helper page. Set before the first `createWriteStream`; the page is loaded once. */
  mitm: string
  /** True when downloads are collected in memory and handed to the browser on close, with no helper involved. */
  readonly useBlobFallback: boolean
}

interface Transporter {
  loaded: boolean
  isPopup: boolean
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void
  addEventListener(type: 'load', listener: () => void, options?: AddEventListenerOptions): void
  remove(): void
}

interface HelperResponse {
  transferringReadable: boolean
  pathname: string
  headers: Record<string, string | number>
}

interface HelperMessage {
  download?: string
  abort?: boolean
}

type StreamSaverGlobal = typeof globalThis & {
  WebStreamsPolyfill?: { WritableStream: typeof WritableStream }
  safari?: unknown
  WebKitPoint?: unknown
}

const global = globalThis as StreamSaverGlobal
if (typeof document === 'undefined' || !global.HTMLElement) console.warn('streamsaver is meant to run on browsers main thread')

let mitmTransporter: Transporter | null = null
let supportsTransferable = false
const test = (fn: () => void) => { try { fn() } catch (e) {} }
const ponyfill = global.WebStreamsPolyfill
const isSecureContext = !!global.isSecureContext
// TODO: Must come up with a real detection test (#69)
let useBlobFallback = /constructor/i.test(String(global.HTMLElement)) || !!global.safari || !!global.WebKitPoint
const downloadStrategy: 'iframe' | 'navigate' = isSecureContext || (typeof document !== 'undefined' && 'MozAppearance' in document.documentElement.style)
  ? 'iframe'
  : 'navigate'

const streamSaver: StreamSaverApi = {
  createWriteStream,
  supported: true,
  version: { full: '2.0.6', major: 2, minor: 0, dot: 6 },
  mitm: 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0',
  get useBlobFallback () { return useBlobFallback }
}

/**
 * create a hidden iframe and append it to the DOM (body)
 */
function makeIframe (src: string): Transporter {
  if (!src) throw new Error('meh')
  const iframe = document.createElement('iframe')
  iframe.hidden = true
  iframe.src = src
  iframe.name = 'iframe'
  const transporter: Transporter = {
    loaded: false,
    isPopup: false,
    postMessage: (message, targetOrigin, transfer) => iframe.contentWindow!.postMessage(message, targetOrigin, transfer),
    addEventListener: (type, listener, options) => iframe.addEventListener(type, listener, options),
    remove: () => iframe.remove()
  }
  iframe.addEventListener('load', () => {
    transporter.loaded = true
  }, { once: true })
  document.body.appendChild(iframe)
  return transporter
}

/**
 * create a popup that simulates the basic things
 * of what a iframe can do
 */
function makePopup (src: string): Transporter {
  const options = 'width=200,height=100'
  const delegate = document.createDocumentFragment()
  const frame = global.open(src, 'popup', options)
  const popup: Transporter = {
    loaded: false,
    isPopup: true,
    remove () { frame?.close() },
    addEventListener (type, listener, opts) { delegate.addEventListener(type, listener, opts) },
    postMessage (message, targetOrigin, transfer) { frame!.postMessage(message, targetOrigin, transfer) }
  }

  const onReady = (evt: MessageEvent) => {
    if (evt.source === frame) {
      popup.loaded = true
      global.removeEventListener('message', onReady)
      delegate.dispatchEvent(new Event('load'))
    }
  }

  global.addEventListener('message', onReady)

  return popup
}

try {
  // We can't look for service worker since it may still work on http
  new Response(new ReadableStream())
  if (isSecureContext && !('serviceWorker' in navigator)) {
    useBlobFallback = true
  }
} catch (err) {
  useBlobFallback = true
}

const TransformStreamImpl: typeof TransformStream | undefined = global.TransformStream

test(() => {
  // Transferable stream was first enabled in chrome v73 behind a flag
  const { readable } = new TransformStreamImpl!()
  const mc = new MessageChannel()
  mc.port1.postMessage(readable, [readable])
  mc.port1.close()
  mc.port2.close()
  supportsTransferable = true
})

function loadTransporter (): Transporter {
  if (!mitmTransporter) {
    mitmTransporter = isSecureContext
      ? makeIframe(streamSaver.mitm)
      : makePopup(streamSaver.mitm)
  }
  return mitmTransporter
}

/**
 * @param filename filename that should be used
 * @param options  options for the download
 */
function createWriteStream (filename: string, options: StreamSaverOptions = {}): StreamSaverWriteStream {
  const opts: StreamSaverOptions = options || {}

  let bytesWritten = 0 // by StreamSaver.js (not the service worker)
  let downloadUrl: string | null = null
  let channel: MessageChannel | null = null
  let ts: TransformStream<Uint8Array, Uint8Array> | null = null
  let markReady: () => void = () => {}
  const ready = new Promise<void>(resolve => { markReady = resolve })

  if (!useBlobFallback) {
    const transporter = loadTransporter()
    const port = new MessageChannel()
    channel = port

    // Make filename RFC5987 compatible
    filename = encodeURIComponent(filename.replace(/\//g, ':'))
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A')

    const response: HelperResponse = {
      transferringReadable: supportsTransferable,
      pathname: opts.pathname || Math.random().toString().slice(-6) + '/' + filename,
      headers: {
        'Content-Type': 'application/octet-stream; charset=utf-8',
        'Content-Disposition': "attachment; filename*=UTF-8''" + filename
      }
    }

    if (opts.size) {
      response.headers['Content-Length'] = opts.size
    }

    const args: [HelperResponse, string, Transferable[]] = [ response, '*', [ port.port2 ] ]

    if (supportsTransferable) {
      const transformer: Transformer<Uint8Array, Uint8Array> | undefined = downloadStrategy === 'iframe' ? undefined : {
        // This transformer & flush method is only used by insecure context.
        transform (chunk, controller) {
          if (!(chunk instanceof Uint8Array)) {
            throw new TypeError('Can only write Uint8Arrays')
          }
          bytesWritten += chunk.length
          controller.enqueue(chunk)

          if (downloadUrl) {
            location.href = downloadUrl
            downloadUrl = null
          }
        },
        flush () {
          if (downloadUrl) {
            location.href = downloadUrl
          }
        }
      }
      ts = new TransformStreamImpl!<Uint8Array, Uint8Array>(
        transformer,
        opts.writableStrategy,
        opts.readableStrategy
      )
      const readableStream = ts.readable

      port.port1.postMessage({ readableStream }, [ readableStream ])
    }

    port.port1.onmessage = (evt: MessageEvent<HelperMessage>) => {
      // Service worker sent us a link that we should open.
      if (evt.data.download) {
        // Special treatment for popup...
        if (downloadStrategy === 'navigate') {
          mitmTransporter!.remove()
          mitmTransporter = null
          if (bytesWritten) {
            location.href = evt.data.download
          } else {
            downloadUrl = evt.data.download
          }
        } else {
          if (mitmTransporter!.isPopup) {
            mitmTransporter!.remove()
            mitmTransporter = null
            // Special case for firefox, they can keep sw alive with fetch
            if (downloadStrategy === 'iframe') {
              makeIframe(streamSaver.mitm)
            }
          }

          // We never remove this iframes b/c it can interrupt saving
          makeIframe(evt.data.download)
        }
        markReady()
      } else if (evt.data.abort) {
        chunks = []
        port.port1.postMessage('abort') //send back so controller is aborted
        port.port1.onmessage = null
        port.port1.close()
        port.port2.close()
        channel = null
      }
    }

    if (transporter.loaded) {
      transporter.postMessage(...args)
    } else {
      transporter.addEventListener('load', () => {
        transporter.postMessage(...args)
      }, { once: true })
    }
  }

  let chunks: Uint8Array[] = []

  if (!useBlobFallback && ts) {
    return { writable: ts.writable, ready }
  }

  const WritableStreamImpl: typeof WritableStream = global.WritableStream || ponyfill!.WritableStream
  const writable = new WritableStreamImpl<Uint8Array>({
    write (chunk) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError('Can only write Uint8Arrays')
      }
      if (useBlobFallback) {
        // Safari... The new IE6
        // https://github.com/jimmywarting/StreamSaver.js/issues/69
        //
        // even though it has everything it fails to download anything
        // that comes from the service worker..!
        chunks.push(chunk)
        return
      }

      // is called when a new chunk of data is ready to be written
      // to the underlying sink. It can return a promise to signal
      // success or failure of the write operation. The stream
      // implementation guarantees that this method will be called
      // only after previous writes have succeeded, and never after
      // close or abort is called.

      // TODO: Kind of important that service worker respond back when
      // it has been written. Otherwise we can't handle backpressure
      // EDIT: Transferable streams solves this...
      channel!.port1.postMessage(chunk)
      bytesWritten += chunk.length

      if (downloadUrl) {
        location.href = downloadUrl
        downloadUrl = null
      }
    },
    close () {
      if (useBlobFallback) {
        const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream; charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = filename
        link.click()
      } else {
        channel!.port1.postMessage('end')
      }
    },
    abort () {
      chunks = []
      if (channel) {
        channel.port1.postMessage('abort')
        channel.port1.onmessage = null
        channel.port1.close()
        channel.port2.close()
        channel = null
      }
    }
  }, opts.writableStrategy)

  if (useBlobFallback) {
    markReady()
  }
  return { writable, ready }
}

export default streamSaver
