/**
 * `openWebExportWriter` and the vendored `src/ts/vendor/streamSaver.ts` on a web page.
 *
 * The vendored module is the real one, running on the real `TransformStream` and `MessageChannel`. The helper page's
 * service worker is replaced by `FakeHelper`, which receives the message `createWriteStream` posts to the helper
 * frame, takes the transferred readable end, and answers with `{ download }` on the channel only when a test says so,
 * as the worker of `public/streamsaver/sw.js` does. The helper frame itself is a recorder: no page is loaded.
 *
 * Labels: (R) marks a test that fails against the export path before this change (one that writes before the helper
 * has answered, or does not use the self-hosted helper page or show the memory-path notice first); (G) is a guard that
 * passes with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 4000 })

const h = vi.hoisted(() => ({
    log: [] as string[],
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertNormalWait: vi.fn(async (msg: string) => { h.log.push('notice:' + msg) }),
}) as unknown as typeof import('src/ts/alert'))

const SELF_HOSTED = '/streamsaver/mitm.html'
const DEFAULT_HELPER = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0'

type FakeFrame = EventTarget & {
    fake: true
    hidden: boolean
    src: string
    name: string
    contentWindow: { postMessage: (message: unknown, origin: string, transfer: Transferable[]) => void }
    remove: () => void
}

/** The service worker of the helper page, as far as the export can tell. */
class FakeHelper {
    private port: MessagePort | null = null
    readonly received: Uint8Array[] = []
    done = false
    error: unknown = undefined
    requests = 0

    /** Called when the helper frame is handed the request and the channel's second port. */
    request(_response: unknown, transfer: Transferable[]) {
        this.requests++
        this.port = transfer[0] as MessagePort
    }

    /** Starts listening on the channel and answers with the download URL, as the worker does at once. */
    answer() {
        const port = this.port!
        port.onmessage = (event: MessageEvent<{ readableStream?: ReadableStream<Uint8Array> }>) => {
            if (event.data?.readableStream) {
                void this.pump(event.data.readableStream)
            }
        }
        port.postMessage({ download: 'https://example.invalid/streamsaver/dl/000001/out.bin' })
    }

    private async pump(stream: ReadableStream<Uint8Array>) {
        const reader = stream.getReader()
        try {
            for (;;) {
                const result = await reader.read()
                if (result.done) {
                    this.done = true
                    return
                }
                this.received.push(result.value)
            }
        } catch (error) {
            this.error = error
        }
    }

    get receivedBytes(): Uint8Array {
        return concat(this.received)
    }
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.byteLength
    }
    return out
}

/** Byte equality without the element-wise diff of `toEqual`, which is far too slow for multi-MiB arrays. */
function expectBytes(actual: Uint8Array, expected: Uint8Array) {
    expect(actual.byteLength).toBe(expected.byteLength)
    const same = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
        .equals(Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))
    expect(same).toBe(true)
}
const settle = async () => {
    for (let i = 0; i < 8; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
    }
}

function body(n: number, seed: number): Uint8Array {
    const out = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        out[i] = (x >> 16) & 0xff
    }
    return out
}

const ENTRIES: Array<[string, Uint8Array]> = [
    ['assets/one', body(1000, 1)],
    ['assets/two', body(1024 * 1024 + 5, 2)],
    ['database.risudat', body(4000, 3)],
]

/** The container as the format has always laid it out: four writes per entry. */
function expectedContainer(): Uint8Array {
    const parts: Uint8Array[] = []
    for (const [name, data] of ENTRIES) {
        const encoded = new TextEncoder().encode(name)
        parts.push(new Uint8Array(new Uint32Array([encoded.byteLength]).buffer), encoded, new Uint8Array(new Uint32Array([data.byteLength]).buffer), data)
    }
    return concat(parts)
}

async function exportAll(sut: typeof import('src/ts/exportWriters'), writer: { write(d: Uint8Array): Promise<void>, close(): Promise<void> }) {
    for (const [name, data] of ENTRIES) {
        await sut.writeBackupEntry(writer, new TextEncoder().encode(name), data)
    }
    await writer.close()
}

let frames: FakeFrame[]
let helper: FakeHelper

function installPage() {
    frames = []
    helper = new FakeHelper()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: unknown[]) => {
        if (tag === 'iframe') {
            const target = new EventTarget() as FakeFrame
            target.fake = true
            target.hidden = false
            target.src = ''
            target.name = ''
            target.remove = () => { }
            target.contentWindow = {
                postMessage: (message, _origin, transfer) => {
                    if (target === frames[0]) {
                        helper.request(message, transfer)
                    }
                },
            }
            frames.push(target)
            return target as unknown as HTMLIFrameElement
        }
        return realCreate(tag, ...(rest as []))
    }) as typeof document.createElement)
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
        if ((node as unknown as FakeFrame).fake) {
            const frame = node as unknown as EventTarget
            setImmediate(() => frame.dispatchEvent(new Event('load')))
            return node
        }
        return realAppend(node)
    }) as typeof document.body.appendChild)
}

async function loadSut(options: { secure: boolean, safari?: boolean }) {
    vi.resetModules()
    vi.stubGlobal('isSecureContext', options.secure)
    if (options.safari) {
        vi.stubGlobal('safari', {})
    }
    // A class's source can contain the word the module's Safari heuristic looks for; a native constructor's cannot.
    vi.stubGlobal('HTMLElement', function HTMLElement() { })
    // The module sends a secure page without service workers to the memory path.
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
    const sut = await import('src/ts/exportWriters')
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    return { sut, streamSaver }
}

beforeEach(() => {
    h.log.length = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    installPage()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'serviceWorker')
    vi.unstubAllGlobals()
})

describe('openWebExportWriter against a helper that answers', () => {
    test('(G) streams every byte through the helper once it has answered, and builds no Blob', async () => {
        const { sut, streamSaver } = await loadSut({ secure: true })
        expect(streamSaver.useBlobFallback).toBe(false)
        const createObjectURL = vi.spyOn(URL, 'createObjectURL')
        const closeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'close')

        const opening = sut.openWebExportWriter('out.bin')
        await settle()
        expect(helper.requests).toBe(1)
        helper.answer()
        const writer = await opening
        await exportAll(sut, writer)
        await settle()

        expectBytes(helper.receivedBytes, expectedContainer())
        expect(helper.done).toBe(true)
        expect(closeSpy).toHaveBeenCalledTimes(1)
        expect(createObjectURL).not.toHaveBeenCalled()
        expect(h.log).toEqual([])
    })

    test('(R) writes nothing to the stream before the helper has answered', async () => {
        const { sut } = await loadSut({ secure: true })
        const writeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'write')

        const opening = sut.openWebExportWriter('out.bin')
        let opened = false
        void opening.then(() => { opened = true })
        await settle()
        expect(opened).toBe(false)
        expect(writeSpy).not.toHaveBeenCalled()

        helper.answer()
        await opening
        expect(writeSpy).not.toHaveBeenCalled()
    })
})

describe('openWebExportWriter against a helper that does not answer', () => {
    test('(R) aborts the stream, never closes it, writes nothing to it, and offers the full container as a Blob', async () => {
        const { sut } = await loadSut({ secure: true })
        const abortSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'abort')
        const closeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'close')
        const writeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'write')
        let blob: Blob | undefined
        vi.spyOn(URL, 'createObjectURL').mockImplementation((object) => { blob = object as Blob; return 'blob:synthetic' })
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })

        const opening = sut.openWebExportWriter('out.bin')
        await settle()
        await vi.advanceTimersByTimeAsync(sut.STREAM_HELPER_READY_TIMEOUT_MS)
        const writer = await opening
        // Against a helper that never answers, an export that writes straight to the stream never finishes.
        await exportAll(sut, writer)

        expect(abortSpy).toHaveBeenCalledTimes(1)
        expect(h.log).toEqual(['notice:' + (await import('src/lang')).language.exportHelperNotResponding])
        expect(closeSpy).not.toHaveBeenCalled()
        expect(writeSpy).not.toHaveBeenCalled()
        expect(helper.receivedBytes.byteLength).toBe(0)
        expect(click).toHaveBeenCalledTimes(1)
        expect(blob).toBeDefined()
        expectBytes(new Uint8Array(await blob!.arrayBuffer()), expectedContainer())
    })

    test('(R) a helper that answers only after the timeout gets an errored stream and never reports done', async () => {
        const { sut } = await loadSut({ secure: true })
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:synthetic')
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })

        const opening = sut.openWebExportWriter('out.bin')
        await settle()
        await vi.advanceTimersByTimeAsync(sut.STREAM_HELPER_READY_TIMEOUT_MS)
        const writer = await opening
        await exportAll(sut, writer)

        helper.answer()
        await settle()

        expect(helper.error).toBeDefined()
        expect(helper.done).toBe(false)
        expect(helper.received).toEqual([])
    })
})

describe("the vendored module's own memory path", () => {
    test('(G) reports itself as the memory path, is ready at once, and hands the browser the full container on close', async () => {
        const { sut, streamSaver } = await loadSut({ secure: true, safari: true })
        expect(streamSaver.useBlobFallback).toBe(true)
        let blob: Blob | undefined
        vi.spyOn(URL, 'createObjectURL').mockImplementation((object) => { blob = object as Blob; return 'blob:synthetic' })
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })

        const writer = await sut.openWebExportWriter('out.bin')
        await exportAll(sut, writer)

        expect(frames).toEqual([])
        expect(click).toHaveBeenCalledTimes(1)
        expectBytes(new Uint8Array(await blob!.arrayBuffer()), expectedContainer())
    })
})

describe('openWebExportWriter chooses the helper page and the memory path', () => {
    async function loadWithFakeStreamSaver(options: { secure: boolean, useBlobFallback: boolean }) {
        vi.resetModules()
        vi.stubGlobal('isSecureContext', options.secure)
        const events: string[] = []
        const fake = {
            mitm: DEFAULT_HELPER,
            useBlobFallback: options.useBlobFallback,
            createWriteStream: vi.fn(() => {
                events.push('create:' + fake.mitm)
                return { writable: new WritableStream<Uint8Array>(), ready: new Promise<void>(() => { }) }
            }),
        }
        vi.doMock('src/ts/vendor/streamSaver', () => ({ default: fake }))
        vi.doMock('src/ts/alert', () => ({
            alertNormalWait: vi.fn(async (msg: string) => { events.push('notice:' + msg) }),
        }))
        const sut = await import('src/ts/exportWriters')
        return { sut, fake, events }
    }

    afterEach(() => {
        vi.doUnmock('src/ts/vendor/streamSaver')
        vi.doUnmock('src/ts/alert')
    })

    test('(R) a secure page uses the self-hosted helper page before the first stream is created', async () => {
        const { sut, events } = await loadWithFakeStreamSaver({ secure: true, useBlobFallback: false })
        void sut.openWebExportWriter('out.bin')
        await settle()
        expect(events).toEqual(['create:' + SELF_HOSTED])
    })

    test('(G) a plain-HTTP page keeps the default helper page', async () => {
        const { sut, events } = await loadWithFakeStreamSaver({ secure: false, useBlobFallback: false })
        void sut.openWebExportWriter('out.bin')
        await settle()
        expect(events).toEqual(['create:' + DEFAULT_HELPER])
    })

    test("(R) streamsaver's own memory path shows the warning before the export starts and does not wait for ready", async () => {
        const { sut, events } = await loadWithFakeStreamSaver({ secure: true, useBlobFallback: true })
        const { language } = await import('src/lang')
        // `ready` here never resolves, so any wait on it would leave this promise pending.
        const writer = await sut.openWebExportWriter('out.bin')
        expect(writer).toBeDefined()
        expect(events).toEqual(['notice:' + language.exportHeldInMemory, 'create:' + SELF_HOSTED])
    })

    test("(R) streamsaver's own memory path reports that it holds the export until it is closed, and can be aborted before", async () => {
        const { sut } = await loadWithFakeStreamSaver({ secure: true, useBlobFallback: true })
        const writer = await sut.openWebExportWriter('out.bin')
        await writer.write(new Uint8Array([1, 2, 3]))
        expect(writer.heldInMemory).toBe(true)
        await writer.abort?.(new Error('synthetic failure'))
        expect(writer.heldInMemory).toBe(true)

        const closing = await sut.openWebExportWriter('out.bin')
        await closing.close()
        expect(closing.heldInMemory).toBe(false)
    })

    test('(G) a live stream reports no in-memory hold, so a failed export is treated as possibly partial', async () => {
        const { sut, fake } = await loadWithFakeStreamSaver({ secure: true, useBlobFallback: false })
        fake.createWriteStream.mockImplementation(() => ({ writable: new WritableStream<Uint8Array>(), ready: Promise.resolve() }))
        const writer = await sut.openWebExportWriter('out.bin')
        expect(writer.heldInMemory).not.toBe(true)
        expect(typeof writer.abort).toBe('function')
    })
})
