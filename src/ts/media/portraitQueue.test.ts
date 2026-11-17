// @vitest-environment happy-dom

/**
 * The shrink queue: one job at a time, a time bound per job, cancellation, late values released and the
 * Android whole-read grant. Unit guards of a new module: their evidence is the mutants that must fail them.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { decode, type Decoded } from '../chatCardImage'
import { PORTRAIT_JOB_TIMEOUT_MS, resetPortraitQueueForTest, shrinkPortrait, type PortraitCanvas, type PortraitContext, type PortraitDeps, type ShrinkOutcome } from './portraitDisplay'

const mocks = vi.hoisted(() => ({ android: false, storedSize: 0 }))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../storage/tauriByteTransport')>()),
    isAndroidTransport: () => mocks.android,
    statStoredSize: async () => mocks.storedSize,
}))

import { ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES, androidAssetSizeVerdict, androidWholeReadQueue, rememberWholeReadUrl, resetAssetUrlGateForTest, type InFlightGrant } from '../storage/assetUrlGate'

const MiB = 1024 * 1024

function pngBlob(): Blob {
    const bytes = new Uint8Array(64)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0, 0, 0, 13], 8)
    bytes.set(new TextEncoder().encode('IHDR'), 12)
    bytes.set([0, 0, 0, 1], 16)
    bytes.set([0, 0, 0, 16], 20)
    bytes.set([0, 0, 0, 8], 24)
    bytes.set([0, 0, 0, 4], 28)
    bytes.set([0, 0, 0, 0], 32)
    bytes.set(new TextEncoder().encode('IDAT'), 41)
    return new Blob([bytes])
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

async function turns(count = 12) {
    for (let i = 0; i < count; i++) await Promise.resolve()
}

function fakeCanvas(): PortraitCanvas {
    const context = { imageSmoothingQuality: 'low' as ImageSmoothingQuality, drawImage: () => {} }
    return { width: 0, height: 0, getContext: () => context, toBlob: () => {} }
}

function fakeDecoded(): Decoded & { release: Mock<() => void> } {
    return { source: document.createElement('canvas'), width: 4096, height: 6144, release: vi.fn<() => void>() }
}

interface Rig {
    deps: PortraitDeps
    fetch: ReturnType<typeof vi.fn>
    decode: ReturnType<typeof vi.fn>
    encode: ReturnType<typeof vi.fn>
    createObjectURL: ReturnType<typeof vi.fn>
    canvases: PortraitCanvas[]
    fetchSignals: AbortSignal[]
}

function rig(): Rig {
    const canvases: PortraitCanvas[] = []
    const fetchSignals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_src: string, init: { signal: AbortSignal }) => {
        fetchSignals.push(init.signal)
        return { ok: true, blob: async () => pngBlob() }
    })
    const decode = vi.fn(async () => fakeDecoded())
    const encode = vi.fn(async () => new Blob([new Uint8Array(10)]))
    const createObjectURL = vi.fn(() => 'blob:shrunk')
    const deps: PortraitDeps = {
        fetch: fetchMock,
        decode,
        createCanvas: (width, height) => {
            const canvas = fakeCanvas()
            canvas.width = width
            canvas.height = height
            canvases.push(canvas)
            return canvas
        },
        encode,
        createObjectURL,
    }
    return { deps, fetch: fetchMock, decode, encode, createObjectURL, canvases, fetchSignals }
}

beforeEach(() => {
    mocks.android = false
    resetAssetUrlGateForTest()
})

afterEach(() => {
    resetPortraitQueueForTest()
    vi.useRealTimers()
})

describe('time bound and cancellation', () => {
    test('Q1: a job whose fetch never settles settles as original after the bound and the next job starts', async () => {
        vi.useFakeTimers()
        const r = rig()
        const hung = deferred<{ ok: boolean, blob(): Promise<Blob> }>()
        r.fetch.mockImplementationOnce(async (_src: string, init: { signal: AbortSignal }) => {
            r.fetchSignals.push(init.signal)
            return hung.promise
        })
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        const second = shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS - 1)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1)
        expect(await first).toEqual({ kind: 'original' })
        expect(r.fetchSignals[0].aborted).toBe(true)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(2)
        expect((await second).kind).toBe('shrunk')
    })

    test('Q2: an encode that never settles times out, releases everything and a late blob creates no URL', async () => {
        vi.useFakeTimers()
        const r = rig()
        const decoded = fakeDecoded()
        r.decode.mockResolvedValue(decoded)
        const late = deferred<Blob | null>()
        r.encode.mockReturnValueOnce(late.promise)
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        const second = shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)
        await turns()
        vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS)
        expect(await first).toEqual({ kind: 'original' })
        expect(decoded.release).toHaveBeenCalledTimes(1)
        expect(r.canvases[0].width).toBe(0)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(2)
        late.resolve(new Blob([new Uint8Array(5)]))
        await turns()
        expect(r.createObjectURL).toHaveBeenCalledTimes(1)
        expect((await second).kind).toBe('shrunk')
    })

    test('Q3:a decode value that arrives after the timeout is released once', async () => {
        vi.useFakeTimers()
        const r = rig()
        const late = deferred<Decoded | null>()
        r.decode.mockReturnValueOnce(late.promise)
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        await turns()
        vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS)
        expect(await first).toEqual({ kind: 'original' })
        const decoded = fakeDecoded()
        late.resolve(decoded)
        await turns()
        expect(decoded.release).toHaveBeenCalledTimes(1)
    })

    test('Q4: a queued job aborted before it starts settles cancelled and never calls a dependency', async () => {
        const r = rig()
        const gate = deferred<{ ok: boolean, blob(): Promise<Blob> }>()
        r.fetch.mockImplementationOnce(async () => gate.promise)
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        const controller = new AbortController()
        const second = shrinkPortrait('b.png', 3072, controller.signal, r.deps)
        await turns()
        controller.abort()
        expect(await second).toEqual({ kind: 'cancelled' })
        gate.resolve({ ok: true, blob: async () => pngBlob() })
        await first
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(1)
    })

    test('Q5: aborting a running job settles cancelled at once, aborts its fetch and starts the next job', async () => {
        vi.useFakeTimers()
        const r = rig()
        const hung = deferred<{ ok: boolean, blob(): Promise<Blob> }>()
        r.fetch.mockImplementationOnce(async (_src: string, init: { signal: AbortSignal }) => {
            r.fetchSignals.push(init.signal)
            return hung.promise
        })
        const controller = new AbortController()
        const first = shrinkPortrait('a.png', 3072, controller.signal, r.deps)
        const second = shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)
        await turns()
        controller.abort()
        expect(await first).toEqual({ kind: 'cancelled' })
        expect(r.fetchSignals[0].aborted).toBe(true)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(2)
        hung.resolve({ ok: true, blob: async () => pngBlob() })
        await turns()
        expect(r.decode).toHaveBeenCalledTimes(1)
        await second
    })

    test('Q6: an already aborted signal settles cancelled and calls no dependency', async () => {
        const r = rig()
        const controller = new AbortController()
        controller.abort()
        expect(await shrinkPortrait('a.png', 3072, controller.signal, r.deps)).toEqual({ kind: 'cancelled' })
        expect(r.fetch).not.toHaveBeenCalled()
    })

    test('Q7: two jobs never overlap', async () => {
        const r = rig()
        const gate = deferred<{ ok: boolean, blob(): Promise<Blob> }>()
        r.fetch.mockImplementationOnce(async () => gate.promise)
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        const second = shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(1)
        gate.resolve({ ok: true, blob: async () => pngBlob() })
        await first
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(2)
        await second
    })

    test('Q8: the reset hook cancels a running job and a queued one and leaves a fresh queue', async () => {
        const r = rig()
        const hung = deferred<{ ok: boolean, blob(): Promise<Blob> }>()
        r.fetch.mockImplementationOnce(async (_src: string, init: { signal: AbortSignal }) => {
            r.fetchSignals.push(init.signal)
            return hung.promise
        })
        const first = shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)
        const second = shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)
        await turns()
        resetPortraitQueueForTest()
        expect(await first).toEqual({ kind: 'cancelled' })
        expect(await second).toEqual({ kind: 'cancelled' })
        expect(r.fetchSignals[0].aborted).toBe(true)
        expect(r.fetch).toHaveBeenCalledTimes(1)
        const third = shrinkPortrait('c.png', 3072, new AbortController().signal, r.deps)
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(2)
        expect((await third).kind).toBe('shrunk')
    })
})

describe('Android whole-read grant', () => {
    const BIG = 'asset://portrait-big'

    /** Registers `url` the way getFileSrc does on Android: the size is probed, then the URL is remembered for its key. */
    async function register(url: string, storedSize: number) {
        mocks.android = true
        mocks.storedSize = storedSize
        await androidAssetSizeVerdict(`assets/${url}`)
        rememberWholeReadUrl(url, `assets/${url}`)
    }

    async function expectBudgetFree() {
        let got = false
        void androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES).then((grant) => {
            got = true
            grant.release()
        })
        await turns()
        expect(got).toBe(true)
    }

    test('G1: a portrait of 8 MiB or more is fetched only while a whole-read grant is held', async () => {
        await register(BIG, 20 * MiB)
        const r = rig()
        const blocker = await androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES)
        const job = shrinkPortrait(BIG, 3072, new AbortController().signal, r.deps)
        await turns()
        expect(r.fetch).not.toHaveBeenCalled()
        blocker.release()
        await turns()
        expect(r.fetch).toHaveBeenCalledTimes(1)
        expect((await job).kind).toBe('shrunk')
    })

    test('G2: the grant is released after success, a failed decode, a cancel and a timeout', async () => {
        await register(BIG, 20 * MiB)
        const ok = rig()
        expect((await shrinkPortrait(BIG, 3072, new AbortController().signal, ok.deps)).kind).toBe('shrunk')
        await expectBudgetFree()

        const failed = rig()
        failed.decode.mockResolvedValue(null)
        expect(await shrinkPortrait(BIG, 3072, new AbortController().signal, failed.deps)).toEqual({ kind: 'original' })
        await expectBudgetFree()

        const hungForCancel = rig()
        hungForCancel.fetch.mockImplementation(() => new Promise(() => {}))
        const controller = new AbortController()
        const cancelled = shrinkPortrait(BIG, 3072, controller.signal, hungForCancel.deps)
        await turns()
        controller.abort()
        expect(await cancelled).toEqual({ kind: 'cancelled' })
        await expectBudgetFree()

        vi.useFakeTimers()
        const hungForTimeout = rig()
        hungForTimeout.fetch.mockImplementation(() => new Promise(() => {}))
        const timed = shrinkPortrait(BIG, 3072, new AbortController().signal, hungForTimeout.deps)
        await turns()
        vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS)
        expect(await timed).toEqual({ kind: 'original' })
        await expectBudgetFree()
    })
    test('G3: the wait for the grant is not counted in the bound, and an abort during it releases a later grant', async () => {
        await register(BIG, 20 * MiB)
        vi.useFakeTimers()
        const r = rig()
        const blocker = await androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES)
        const job = shrinkPortrait(BIG, 3072, new AbortController().signal, r.deps)
        await turns()
        vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS * 2)
        await turns()
        expect(r.fetch).not.toHaveBeenCalled()
        blocker.release()
        await turns()
        expect((await job).kind).toBe('shrunk')

        const second = await androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES)
        const controller = new AbortController()
        const waiting = shrinkPortrait(BIG, 3072, controller.signal, rig().deps)
        await turns()
        controller.abort()
        expect(await waiting).toEqual({ kind: 'cancelled' })
        second.release()
        await turns()
        await expectBudgetFree()
    })

    test('G4: a 4 MiB file or a data URL takes no grant', async () => {
        await register('asset://portrait-small', 4 * MiB)
        const r = rig()
        const blocker = await androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES)
        const small = shrinkPortrait('asset://portrait-small', 3072, new AbortController().signal, r.deps)
        const data = shrinkPortrait('data:image/png;base64,AAAA', 3072, new AbortController().signal, r.deps)
        expect((await small).kind).toBe('shrunk')
        expect((await data).kind).toBe('shrunk')
        expect(r.fetch).toHaveBeenCalledTimes(2)
        blocker.release()
    })
})

describe('synchronous throws', () => {
    test('Q9a: a fetch that throws synchronously settles original at once and the next job runs', async () => {
        const r = rig()
        r.fetch.mockImplementationOnce(() => {
            throw new Error('fetch threw')
        })
        expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        // Created after job 1 settled, so it can only run if job 1 freed the slot.
        expect((await shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)).kind).toBe('shrunk')
    })

    test('Q9b: an object URL that cannot be created settles original at once, releases everything and the next job runs', async () => {
        const r = rig()
        const decoded = fakeDecoded()
        r.decode.mockResolvedValueOnce(decoded)
        r.createObjectURL.mockImplementationOnce(() => {
            throw new Error('createObjectURL threw')
        })
        expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        expect(decoded.release).toHaveBeenCalledTimes(1)
        expect(r.canvases[0].width).toBe(0)
        expect(r.canvases[0].height).toBe(0)
        expect((await shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)).kind).toBe('shrunk')
    })

    test('Q9c: a canvas that cannot be created settles original at once, releases the decoded image and the next job runs', async () => {
        const r = rig()
        const decoded = fakeDecoded()
        r.decode.mockResolvedValueOnce(decoded)
        const createCanvas = r.deps.createCanvas
        let calls = 0
        r.deps.createCanvas = (width, height) => {
            calls++
            if (calls === 1) throw new Error('createCanvas threw')
            return createCanvas(width, height)
        }
        expect(await shrinkPortrait('a.png', 3072, new AbortController().signal, r.deps)).toEqual({ kind: 'original' })
        expect(decoded.release).toHaveBeenCalledTimes(1)
        expect((await shrinkPortrait('b.png', 3072, new AbortController().signal, r.deps)).kind).toBe('shrunk')
    })
})

describe('kill-position sweep', () => {
    const BIG = 'asset://portrait-sweep'
    const SWEEP_BYTES = 20 * MiB
    const STAGES = ['grant', 'fetch', 'blob', 'prefix', 'decode', 'encode'] as const
    type Stage = typeof STAGES[number]
    type Killer = 'abort' | 'timeout'
    type Position = 'before' | 'sameTask' | number
    const POSITIONS: Position[] = ['before', 'sameTask', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    /** The dependency call that creates the value a stage waits for. */
    const ENTRY: Record<Stage, string> = { grant: 'acquire', fetch: 'fetch', blob: 'blob', prefix: 'arrayBuffer', decode: 'decode', encode: 'encode' }
    /** The dependency call or effect a live job makes once the stage's value arrives. */
    const NEXT_ENTRY: Record<Stage, string> = { grant: 'fetch', fetch: 'blob', blob: 'slice', prefix: 'decode', decode: 'createCanvas', encode: 'createObjectURL' }

    interface SweepEvent {
        job: number
        name: string
    }

    interface SweepResult {
        stage: Stage
        killer: Killer
        position: Position
        outcomes: ShrinkOutcome[]
        events: SweepEvent[]
        violations: string[]
        killNoop: boolean
        wasEnded: boolean
        timerCountAtKill: number
        job2FetchesAtKill: number
        urlCountAtKill: number
        nextEntryBeforeDead: boolean
        proxyReleases: number
        releaseMocks: Mock<() => void>[]
        canvases: PortraitCanvas[]
        budgetFree: boolean
    }

    function sweepRows(stages: readonly Stage[]) {
        return stages.flatMap((stage) => (['abort', 'timeout'] as const)
            .filter((killer) => !(stage === 'grant' && killer === 'timeout'))
            .flatMap((killer) => POSITIONS.map((position) => ({ stage, killer, position }))))
    }

    /**
     * Runs job 1 through the stages with raw deferreds, kills it at `position` relative to the arrival of the
     * value of `stage`, then settles every outstanding deferred. Jobs 2 and 3 wait behind job 1.
     */
    async function runSweepRow(stage: Stage, killer: Killer, position: Position, bitmapMode: boolean): Promise<SweepResult> {
        resetAssetUrlGateForTest()
        resetPortraitQueueForTest()
        mocks.android = true
        mocks.storedSize = SWEEP_BYTES
        await androidAssetSizeVerdict(`assets/${BIG}`)
        rememberWholeReadUrl(BIG, `assets/${BIG}`)
        const realGrant = await androidWholeReadQueue().acquire(SWEEP_BYTES)
        const prefixBytes = await pngBlob().arrayBuffer()

        const events: SweepEvent[] = []
        const violations: string[] = []
        let dead = false
        let job1Ended = false
        const log = (job: number, name: string) => {
            events.push({ job, name })
            if (job === 1 && dead) violations.push(name)
        }

        const d = {
            grant: deferred<InFlightGrant>(),
            fetch: deferred<{ ok: boolean, blob(): Promise<Blob> }>(),
            blob: deferred<Blob>(),
            prefix: deferred<ArrayBuffer>(),
            decode: deferred<Decoded | null>(),
            encode: deferred<Blob | null>(),
        }
        const bitmapD = deferred<{ width: number, height: number, close: Mock<() => void> }>()
        const called = new Set<Stage>()
        const settled = new Set<Stage>()
        const canvases: PortraitCanvas[] = []
        const releaseMocks: Mock<() => void>[] = []
        let proxyReleases = 0
        const grantProxy: InFlightGrant = {
            release: () => {
                proxyReleases++
                realGrant.release()
            },
        }
        const context: PortraitContext = {
            imageSmoothingQuality: 'low',
            drawImage: () => {
                log(1, 'drawImage')
            },
        }

        const acquireSpy = vi.spyOn(androidWholeReadQueue(), 'acquire').mockImplementationOnce(() => {
            log(1, 'acquire')
            called.add('grant')
            return d.grant.promise
        })
        if (bitmapMode) {
            vi.stubGlobal('createImageBitmap', () => bitmapD.promise)
        }
        const deps1: PortraitDeps = {
            fetch: () => {
                log(1, 'fetch')
                called.add('fetch')
                return d.fetch.promise
            },
            decode: (blob, signal, options) => {
                log(1, 'decode')
                called.add('decode')
                return bitmapMode ? decode(blob, signal, options) : d.decode.promise
            },
            createCanvas: (width, height) => {
                log(1, 'createCanvas')
                const canvas: PortraitCanvas = {
                    width,
                    height,
                    getContext: () => {
                        log(1, 'getContext')
                        return context
                    },
                    toBlob: () => {},
                }
                canvases.push(canvas)
                return canvas
            },
            encode: () => {
                log(1, 'encode')
                called.add('encode')
                return d.encode.promise
            },
            createObjectURL: () => {
                log(1, 'createObjectURL')
                return 'blob:shrunk'
            },
        }
        // A job without a grant stage calls fetch synchronously inside the pump that the previous job's finish runs.
        const autoDeps = (job: number): PortraitDeps => ({
            fetch: () => {
                log(job, 'fetch')
                if (job === 2) job1Ended = true
                return Promise.resolve({ ok: true, blob: () => Promise.resolve(pngBlob()) })
            },
            decode: () => Promise.resolve(fakeDecoded()),
            createCanvas: (width, height) => {
                const canvas = fakeCanvas()
                canvas.width = width
                canvas.height = height
                return canvas
            },
            encode: () => Promise.resolve(new Blob([new Uint8Array(10)])),
            createObjectURL: () => {
                log(job, 'createObjectURL')
                return 'blob:shrunk'
            },
        })

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const controller = new AbortController()
        const job1 = shrinkPortrait(BIG, 3072, controller.signal, deps1)
        const job2 = shrinkPortrait('b.png', 3072, new AbortController().signal, autoDeps(2))
        const job3 = shrinkPortrait('c.png', 3072, new AbortController().signal, autoDeps(3))

        const settle = (s: Stage) => {
            settled.add(s)
            switch (s) {
                case 'grant':
                    d.grant.resolve(grantProxy)
                    break
                case 'fetch':
                    d.fetch.resolve({
                        ok: true,
                        blob: () => {
                            log(1, 'blob')
                            called.add('blob')
                            return d.blob.promise
                        },
                    })
                    break
                case 'blob': {
                    const blob = pngBlob()
                    Object.defineProperty(blob, 'slice', {
                        value: () => {
                            log(1, 'slice')
                            return {
                                arrayBuffer: () => {
                                    log(1, 'arrayBuffer')
                                    called.add('prefix')
                                    return d.prefix.promise
                                },
                            }
                        },
                    })
                    d.blob.resolve(blob)
                    break
                }
                case 'prefix':
                    d.prefix.resolve(prefixBytes.slice(0))
                    break
                case 'decode':
                    if (bitmapMode) {
                        const bitmap = { width: 4096, height: 6144, close: vi.fn<() => void>() }
                        releaseMocks.push(bitmap.close)
                        bitmapD.resolve(bitmap)
                    } else {
                        const decoded = fakeDecoded()
                        releaseMocks.push(decoded.release)
                        d.decode.resolve(decoded)
                    }
                    break
                case 'encode':
                    d.encode.resolve(new Blob([new Uint8Array(10)]))
                    break
            }
        }

        // Walk to the stage under test; a row that never reaches it fails here instead of passing vacuously.
        const seen = (name: string) => events.some((e) => e.job === 1 && e.name === name)
        for (const earlier of STAGES.slice(0, STAGES.indexOf(stage))) {
            settle(earlier)
            await turns()
            expect(seen(ENTRY[STAGES[STAGES.indexOf(earlier) + 1]])).toBe(true)
        }
        expect(seen(ENTRY[stage])).toBe(true)

        let killNoop = false
        let wasEnded = false
        let timerCountAtKill = -1
        let job2FetchesAtKill = -1
        let urlCountAtKill = -1
        let eventsAtKill = -1
        const kill = () => {
            wasEnded = job1Ended
            eventsAtKill = events.length
            urlCountAtKill = events.filter((e) => e.job === 1 && e.name === 'createObjectURL').length
            if (killer === 'timeout' && wasEnded) {
                // Stands for "the timer was already cleared by the job's own finish".
                killNoop = true
            } else {
                events.push({ job: 1, name: 'kill' })
                if (killer === 'abort') {
                    controller.abort()
                } else {
                    timerCountAtKill = vi.getTimerCount()
                    // Firing a timer from inside a microtask is stronger than production, where a timer is a macrotask:
                    // it tests finish from any entry. Only job 1's timer is pending, so only it can fire.
                    vi.advanceTimersByTime(PORTRAIT_JOB_TIMEOUT_MS)
                }
            }
            dead = true
            job2FetchesAtKill = events.filter((e) => e.job === 2 && e.name === 'fetch').length
        }

        if (position === 'before') {
            kill()
            settle(stage)
        } else if (position === 'sameTask') {
            settle(stage)
            kill()
        } else {
            settle(stage)
            let chain = Promise.resolve()
            for (let i = 0; i < position; i++) chain = chain.then(() => {})
            await chain.then(kill)
        }
        await turns()

        for (const s of STAGES) {
            if (called.has(s) && !settled.has(s)) settle(s)
        }
        await turns()
        const outcomes = await Promise.all([job1, job2, job3])

        let budgetFree = false
        void androidWholeReadQueue().acquire(ANDROID_CHAT_IN_FLIGHT_WHOLE_READ_BYTES).then((grant) => {
            budgetFree = true
            grant.release()
        })
        await turns()

        acquireSpy.mockRestore()
        vi.unstubAllGlobals()
        vi.useRealTimers()
        return {
            stage,
            killer,
            position,
            outcomes,
            events,
            violations,
            killNoop,
            wasEnded,
            timerCountAtKill,
            job2FetchesAtKill,
            urlCountAtKill,
            nextEntryBeforeDead: events.slice(0, eventsAtKill).some((e) => e.job === 1 && e.name === NEXT_ENTRY[stage]),
            proxyReleases,
            releaseMocks,
            canvases,
            budgetFree,
        }
    }

    function assertSweepRow(r: SweepResult, releaseLabel: string) {
        const [first, second, third] = r.outcomes
        // (0) while job 1 runs, its timer is the only pending fake timer.
        if (r.killer === 'timeout' && !r.killNoop) expect(r.timerCountAtKill).toBe(1)
        // (1) no dependency call, resource or URL for job 1 after it finished.
        expect(r.violations).toEqual([])
        // (2) the kill finished job 1 and pumped job 2 synchronously, or job 1 had already ended.
        expect(r.job2FetchesAtKill).toBe(1)
        // (3) the outcome is the killer's, or shrunk only when the URL was made before the kill.
        if (first.kind === 'shrunk') {
            expect(r.urlCountAtKill).toBe(1)
        } else {
            expect(first.kind).toBe(r.killer === 'abort' ? 'cancelled' : 'original')
        }
        // (3a) only a live encode ends job 1 before the kill, as shrunk.
        if (r.wasEnded) {
            expect(r.stage).toBe('encode')
            expect(first.kind).toBe('shrunk')
            expect(r.urlCountAtKill).toBe(1)
        }
        // (4) one URL exactly when the outcome is shrunk.
        expect(r.events.filter((e) => e.job === 1 && e.name === 'createObjectURL')).toHaveLength(first.kind === 'shrunk' ? 1 : 0)
        // (5) the whole-read grant is released exactly once.
        expect(r.proxyReleases).toBe(1)
        // (6) every delivered image is released exactly once.
        for (const release of r.releaseMocks) {
            expect(release, releaseLabel).toHaveBeenCalledTimes(1)
        }
        // (7) every canvas of job 1 is zeroed.
        for (const canvas of r.canvases) {
            expect(canvas.width).toBe(0)
            expect(canvas.height).toBe(0)
        }
        // (8) job 2 starts after job 1 ends, job 3 after job 2 is done.
        const endIndex = r.wasEnded
            ? r.events.findIndex((e) => e.job === 1 && e.name === 'createObjectURL')
            : r.events.findIndex((e) => e.name === 'kill')
        expect(endIndex).toBeGreaterThanOrEqual(0)
        const job2Entries = r.events.flatMap((e, index) => e.job === 2 ? [index] : [])
        expect(job2Entries.length).toBeGreaterThan(0)
        expect(Math.min(...job2Entries)).toBeGreaterThan(endIndex)
        const job2Done = r.events.findIndex((e) => e.job === 2 && e.name === 'createObjectURL')
        const job3Entries = r.events.flatMap((e, index) => e.job === 3 ? [index] : [])
        expect(job3Entries.length).toBeGreaterThan(0)
        expect(Math.min(...job3Entries)).toBeGreaterThan(job2Done)
        // (9) the later jobs are unaffected.
        expect(second.kind).toBe('shrunk')
        expect(third.kind).toBe('shrunk')
        // (10) the whole-read budget is free.
        expect(r.budgetFree).toBe(true)
    }

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // Regression reproducer for the hop-1 rows at the fetch, blob, prefix and encode stages; an invariant guard at every other row.
    test.each(sweepRows(STAGES))('QS-1: $stage $killer $position', async ({ stage, killer, position }) => {
        assertSweepRow(await runSweepRow(stage, killer, position, false), 'decoded.release')
    })

    // Keeps the hop range from going vacuous: some hop lets the live job call the next entry, sameTask never does.
    test.each(sweepRows(STAGES).filter((row) => row.position === 'sameTask'))('QS-2: $stage $killer span', async ({ stage, killer }) => {
        const rows: SweepResult[] = []
        for (const position of POSITIONS) rows.push(await runSweepRow(stage, killer, position, false))
        expect(rows.filter((r) => typeof r.position === 'number').some((r) => r.nextEntryBeforeDead)).toBe(true)
        expect(rows.filter((r) => r.position === 'sameTask').every((r) => !r.nextEntryBeforeDead)).toBe(true)
    })

    // Compatibility guard: the real decode, with its own abort handling, composed with the driver's discard.
    test.each(sweepRows(['decode']))('QS-3: real decode $killer $position', async ({ stage, killer, position }) => {
        assertSweepRow(await runSweepRow(stage, killer, position, true), 'bitmap.close')
    })
})
