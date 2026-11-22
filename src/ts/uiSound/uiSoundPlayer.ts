export type UiSoundCue = 'send' | 'receive' | 'error' | 'warning' | 'success' | 'info' | 'undo' | 'toggle-on' | 'toggle-off'
export type UiSoundPack = 'scifi' | 'studio'

export const UI_SOUND_CUES: readonly UiSoundCue[] = ['send', 'receive', 'error', 'warning', 'success', 'info', 'undo', 'toggle-on', 'toggle-off']

/** A louder-priority cue cuts a sounding quieter one; a quieter one is dropped while a louder one sounds. */
export const UI_SOUND_PRIORITY: Readonly<Record<UiSoundCue, number>> = {
    error: 3,
    send: 2,
    receive: 2,
    undo: 2,
    warning: 1,
    success: 1,
    info: 1,
    'toggle-on': 0,
    'toggle-off': 0,
}

// The `defaultVolume` of each cue in the uisfx 0.4.0 manifest, per pack.
const SCIFI_GAIN: Readonly<Record<UiSoundCue, number>> = {
    send: 0.2,
    receive: 0.2,
    error: 0.22,
    warning: 0.22,
    success: 0.23,
    info: 0.16,
    undo: 0.18,
    'toggle-on': 0.2,
    'toggle-off': 0.18,
}
const STUDIO_GAIN: Readonly<Record<UiSoundCue, number>> = {
    send: 0.2,
    receive: 0.2,
    error: 0.22,
    warning: 0.22,
    success: 0.23,
    info: 0.16,
    undo: 0.18,
    'toggle-on': 0.2,
    'toggle-off': 0.18,
}
export const UI_SOUND_GAIN: Readonly<Record<UiSoundPack, Readonly<Record<UiSoundCue, number>>>> = {
    scifi: SCIFI_GAIN,
    studio: STUDIO_GAIN,
}

export const SAME_CUE_DEBOUNCE_MS = 120
export const RESUME_WINDOW_MS = 300
export const IDLE_SUSPEND_MS = 2000

export interface UiSoundPlayerDeps {
    createContext(): AudioContext
    fetchBytes(url: string): Promise<ArrayBuffer>
    now(): number
    /** Starts a one-shot timer and returns its canceller. */
    setTimer(run: () => void, ms: number): () => void
    enabled(): boolean
    muted(): boolean
    pack(): UiSoundPack
    urlOf(pack: UiSoundPack, cue: UiSoundCue): string
}

export interface UiSoundPlayer {
    /** Starts the cue when it is allowed and ready; otherwise drops it. Never throws and never queues. */
    play(cue: UiSoundCue): void
    /** Creates and resumes the context (call from a user gesture), then decodes the pack's cues. */
    unlock(): Promise<void>
    /** Fetches and decodes every cue of the pack; failures are logged once and leave those cues silent. */
    preload(pack: UiSoundPack): Promise<void>
}

interface Voice {
    cue: UiSoundCue
    source: AudioBufferSourceNode
}

export function createUiSoundPlayer(deps: UiSoundPlayerDeps): UiSoundPlayer {
    let context: AudioContext | null = null
    const buffers = new Map<string, AudioBuffer>()
    const decoding = new Map<string, Promise<void>>()
    const failed = new Set<string>()
    const lastStart = new Map<UiSoundCue, number>()
    let voice: Voice | null = null
    let cancelIdle: (() => void) | null = null

    function ensureContext(): AudioContext {
        context ??= deps.createContext()
        return context
    }

    function armIdle(): void {
        cancelIdle?.()
        cancelIdle = deps.setTimer(() => {
            cancelIdle = null
            if (voice !== null) {
                armIdle()
                return
            }
            // A suspended context holds no output stream; the next cue resumes it.
            try {
                void context?.suspend().catch(() => {})
            } catch {
                // A context that cannot suspend stays as it is.
            }
        }, IDLE_SUSPEND_MS)
    }

    function decode(url: string): Promise<void> {
        const pending = decoding.get(url)
        if (pending) return pending
        if (buffers.has(url) || failed.has(url)) return Promise.resolve()
        const run = (async () => {
            try {
                const bytes = await deps.fetchBytes(url)
                buffers.set(url, await ensureContext().decodeAudioData(bytes))
            } catch (error) {
                failed.add(url)
                console.warn('UI sound unavailable:', url, error)
            } finally {
                decoding.delete(url)
                // Decoding may have created or resumed the context; without a cue it must still go idle.
                if (context !== null) armIdle()
            }
        })()
        decoding.set(url, run)
        return run
    }

    function startNow(cue: UiSoundCue, buffer: AudioBuffer, ctx: AudioContext, pack: UiSoundPack): void {
        const now = deps.now()
        const last = lastStart.get(cue)
        if (last !== undefined && now - last < SAME_CUE_DEBOUNCE_MS) return
        if (voice !== null && UI_SOUND_PRIORITY[voice.cue] > UI_SOUND_PRIORITY[cue]) return
        const previous = voice
        voice = null
        if (previous !== null) {
            try {
                previous.source.stop()
            } catch {
                // A source that already ended needs no stop.
            }
        }
        const source = ctx.createBufferSource()
        const gain = ctx.createGain()
        gain.gain.value = UI_SOUND_GAIN[pack][cue]
        source.buffer = buffer
        source.connect(gain)
        gain.connect(ctx.destination)
        const current: Voice = { cue, source }
        source.onended = () => {
            if (voice === current) {
                voice = null
                armIdle()
            }
        }
        voice = current
        lastStart.set(cue, now)
        source.start()
        armIdle()
    }

    function resumeWithinWindow(ctx: AudioContext): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            let settled = false
            const cancel = deps.setTimer(() => finish(false), RESUME_WINDOW_MS)
            function finish(ok: boolean): void {
                if (settled) return
                settled = true
                cancel()
                resolve(ok)
            }
            try {
                ctx.resume().then(() => {
                    // A resume that lands after the window plays nothing, so the running context needs the idle timer.
                    if (settled) armIdle()
                    finish(ctx.state === 'running')
                }, () => finish(false))
            } catch {
                finish(false)
            }
        })
    }

    function play(cue: UiSoundCue): void {
        try {
            if (!deps.enabled() || deps.muted()) return
            const pack = deps.pack()
            const url = deps.urlOf(pack, cue)
            const buffer = buffers.get(url)
            if (buffer === undefined) {
                // A cue still decoding is dropped, not queued: a late sound would no longer match its event.
                void decode(url)
                return
            }
            const ctx = ensureContext()
            if (ctx.state === 'running') {
                startNow(cue, buffer, ctx, pack)
                return
            }
            void resumeWithinWindow(ctx).then((running) => {
                if (running) startNow(cue, buffer, ctx, pack)
            }).catch(() => {})
        } catch (error) {
            console.warn('UI sound failed:', error)
        }
    }

    function preload(pack: UiSoundPack): Promise<void> {
        try {
            return Promise.all(UI_SOUND_CUES.map((cue) => decode(deps.urlOf(pack, cue)))).then(() => {}, () => {})
        } catch (error) {
            console.warn('UI sound failed:', error)
            return Promise.resolve()
        }
    }

    async function unlock(): Promise<void> {
        try {
            if (!deps.enabled()) return
            const ctx = ensureContext()
            if (ctx.state !== 'running') void ctx.resume().then(armIdle, () => {})
            await preload(deps.pack())
            armIdle()
        } catch (error) {
            console.warn('UI sound failed:', error)
        }
    }

    return { play, unlock, preload }
}
