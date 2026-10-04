interface Clip {
    context: AudioContext
    node: AudioBufferSourceNode | null
}

// Every clip whose AudioContext is open. A clip is registered before its audio
// is decoded and released when it ends or is stopped, so a Stop reaches clips
// that have not started yet and every audio context is closed exactly once.
const clips = new Set<Clip>()
let controller = new AbortController()

/** The cancellation signal of the current playback era; `cancelTTSPlayback` aborts it and starts a new one. */
export function currentTTSSignal(): AbortSignal {
    return controller.signal
}

export function beginClip(context: AudioContext): Clip {
    const clip: Clip = { context, node: null }
    clips.add(clip)
    return clip
}

export function releaseClip(clip: Clip): void {
    if (!clips.delete(clip)) return
    try {
        const closing = clip.context.close()
        if (closing && typeof closing.catch === 'function') {
            closing.catch(() => {})
        }
    } catch {
        // closing an already-closed context is harmless
    }
}

/**
 * Starts the decoded buffer unless the clip was cancelled. Returns whether
 * audio started. A cancelled or stopped clip is released.
 */
export function startClip(clip: Clip, buffer: AudioBuffer, signal: AbortSignal, gain?: number): boolean {
    if (signal.aborted || !clips.has(clip)) {
        releaseClip(clip)
        return false
    }
    const node = clip.context.createBufferSource()
    node.buffer = buffer
    if (gain === undefined) {
        node.connect(clip.context.destination)
    } else {
        const gainNode = clip.context.createGain()
        gainNode.gain.value = gain
        node.connect(gainNode)
        gainNode.connect(clip.context.destination)
    }
    node.onended = () => releaseClip(clip)
    clip.node = node
    node.start()
    return true
}

export async function playEncodedAudio(audio: ArrayBuffer, signal: AbortSignal, gain?: number): Promise<void> {
    if (signal.aborted) return
    const clip = beginClip(new AudioContext())
    try {
        const decoded = await clip.context.decodeAudioData(audio)
        startClip(clip, decoded, signal, gain)
    } catch (error) {
        releaseClip(clip)
        throw error
    }
}

/** Aborts the current playback era, stops every clip and closes its context. */
export function cancelTTSPlayback(): void {
    const old = controller
    controller = new AbortController()
    old.abort()
    for (const clip of [...clips]) {
        if (clip.node) {
            try {
                clip.node.stop()
            } catch {
                // a node that never started cannot be stopped
            }
        }
        releaseClip(clip)
    }
}
