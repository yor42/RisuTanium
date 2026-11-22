/**
 * Test harness for the UI-sound player and every hook that drives it: a fake Web Audio and a fake fetch, plus a manual
 * clock for the player's injected timers.
 *
 * Install the fake BEFORE importing the module under test (`installFakeAudio()` then `await import(...)`, after
 * `vi.resetModules()` when the module was loaded earlier). Observation is only through what the code does to the fake:
 * `audio.started` lists each `AudioBufferSourceNode.start()` with the URL its buffer was fetched from and the gain
 * node's value, so a test asserts on the sound that would have been heard.
 *
 * Fake behaviour that matters: a new context starts `suspended` (like a page before a gesture); `resume()` turns it
 * `running` unless `audio.blockResume` is set (then it never settles); `fetch` and `decodeAudioData` succeed unless the
 * URL is in `audio.failFetch` / `audio.failDecode`; `audio.holdFetches()` parks every fetch until `releaseFetches()`.
 * `source.stop()` only marks the source stopped; `audio.endVoices()` fires `onended` for sources still sounding.
 */

export interface StartedSound {
    /** The URL the started buffer was fetched from. */
    url: string
    /** The `gain.value` of the gain node the source was routed through. */
    gain: number
}

export interface FakeBuffer {
    sourceUrl: string
    duration: number
}

export interface FakeAudio {
    /** Every `start()` in order. */
    readonly started: StartedSound[]
    /** The URLs of `started`, for compact assertions. */
    startedUrls(): string[]
    /** Every URL passed to the fake `fetch`. */
    readonly fetched: string[]
    /** Contexts created by `new AudioContext()`. */
    readonly contexts: FakeContext[]
    readonly failFetch: Set<string>
    readonly failDecode: Set<string>
    /** While true, `resume()` never settles. */
    blockResume: boolean
    /** While true, `resume()` rejects. */
    rejectResume: boolean
    holdFetches(): void
    releaseFetches(): void
    /** How many started sources have neither ended nor been stopped. */
    sounding(): number
    /** Fires `onended` of every started, not stopped, source, as the browser does when a clip finishes. */
    endVoices(): void
    /** Removes the fakes from `globalThis`. */
    uninstall(): void
}

export interface FakeContext {
    state: AudioContextState
    resumeCalls: number
    suspendCalls: number
    readonly destination: object
    /** Replaceable per test, e.g. to settle a resume at a chosen moment. */
    resume(): Promise<void>
}

interface FakeSource {
    buffer: FakeBuffer | null
    onended: (() => void) | null
    stopped: boolean
    started: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Lets promise chains the code under test started run to their end. */
export async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

/**
 * Makes the facade ready like a page after its first tap: creates and resumes the context and decodes the active pack, so
 * a cue played afterwards starts at once. Call after `installFakeAudio()`, in a DOM environment.
 */
export async function warmUiSounds(): Promise<void> {
    const facade = await import('./uiSound')
    facade.installUiSoundUnlock()
    window.dispatchEvent(new Event('pointerdown'))
    await flushMicrotasks()
}

export function installFakeAudio(): FakeAudio {
    const scope = globalThis as Record<string, unknown>
    const previous = { AudioContext: scope.AudioContext, webkitAudioContext: scope.webkitAudioContext, fetch: scope.fetch }
    const sources: FakeSource[] = []
    let release: (() => void) | null = null
    let gate: Promise<void> | null = null

    const audio: FakeAudio = {
        started: [],
        startedUrls: () => audio.started.map((entry) => entry.url),
        fetched: [],
        contexts: [],
        failFetch: new Set(),
        failDecode: new Set(),
        blockResume: false,
        rejectResume: false,
        holdFetches() {
            gate = new Promise<void>((resolve) => { release = resolve })
        },
        releaseFetches() {
            release?.()
            gate = null
            release = null
        },
        sounding: () => sources.filter((source) => source.started && !source.stopped).length,
        endVoices() {
            for (const source of sources) {
                if (source.started && !source.stopped) {
                    source.stopped = true
                    source.onended?.()
                }
            }
        },
        uninstall() {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete scope[key]
                else scope[key] = value
            }
        },
    }

    class FakeAudioContext {
        state: AudioContextState = 'suspended'
        resumeCalls = 0
        suspendCalls = 0
        readonly destination = {}
        constructor() {
            audio.contexts.push(this as unknown as FakeContext)
        }
        resume(): Promise<void> {
            this.resumeCalls++
            if (audio.rejectResume) return Promise.reject(new Error('resume refused'))
            if (audio.blockResume) return new Promise<void>(() => {})
            this.state = 'running'
            return Promise.resolve()
        }
        suspend(): Promise<void> {
            this.suspendCalls++
            this.state = 'suspended'
            return Promise.resolve()
        }
        async decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
            const sourceUrl = decoder.decode(bytes)
            if (audio.failDecode.has(sourceUrl)) throw new Error('decode refused')
            return { sourceUrl, duration: 0.3 }
        }
        createGain(): { gain: { value: number }; connect(node: object): void } {
            return { gain: { value: 1 }, connect() {} }
        }
        createBufferSource(): FakeSource & { connect(node: unknown): void; start(): void; stop(): void } {
            let gainNode: { gain: { value: number } } | null = null
            const source: FakeSource & { connect(node: unknown): void; start(): void; stop(): void } = {
                buffer: null,
                onended: null,
                stopped: false,
                started: false,
                connect(node) {
                    gainNode = node as { gain: { value: number } }
                },
                start() {
                    source.started = true
                    audio.started.push({ url: source.buffer?.sourceUrl ?? '', gain: gainNode?.gain.value ?? 1 })
                },
                stop() {
                    source.stopped = true
                },
            }
            sources.push(source)
            return source
        }
    }

    scope.AudioContext = FakeAudioContext
    delete scope.webkitAudioContext
    scope.fetch = async (input: unknown) => {
        const url = String(input)
        audio.fetched.push(url)
        if (gate) await gate
        if (audio.failFetch.has(url)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        return { ok: true, status: 200, arrayBuffer: async () => encoder.encode(url).buffer }
    }
    return audio
}

export interface ManualClock {
    now(): number
    setTimer(run: () => void, ms: number): () => void
    /** Moves time forward and runs every timer that became due, in order. */
    advance(ms: number): void
    pendingTimers(): number
}

export function createManualClock(): ManualClock {
    let time = 0
    let nextId = 0
    const timers = new Map<number, { at: number; run: () => void }>()
    return {
        now: () => time,
        setTimer(run, ms) {
            const id = nextId++
            timers.set(id, { at: time + ms, run })
            return () => { timers.delete(id) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let dueId = -1
                let dueAt = Infinity
                for (const [id, timer] of timers) {
                    if (timer.at <= target && timer.at < dueAt) {
                        dueId = id
                        dueAt = timer.at
                    }
                }
                if (dueId < 0) break
                const due = timers.get(dueId)!
                timers.delete(dueId)
                time = Math.max(time, due.at)
                due.run()
            }
            time = target
        },
        pendingTimers: () => timers.size,
    }
}
