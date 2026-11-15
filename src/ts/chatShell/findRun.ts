// One opening of the in-chat search bar, seen from the transcript: the jump that is in flight, where the reader was before the first
// hit was shown, and whether any hit jump landed. Closing never cancels a show already requested; it waits for that show to settle and
// then judges, from where the reader actually is, whether a return chip is owed. Pure TypeScript: the list and the chat are injected.
import { isLongJump, type JumpOrigin, type JumpResult } from './jumpTarget'

export interface FindRunParams {
    // The reader's place now; null while it cannot be read (a hidden surface, no rows).
    readOrigin: () => JumpOrigin | null
    // Shows message `index` without recording an origin and without taking focus.
    jumpTo: (index: number) => Promise<JumpResult>
    // Identifies the chat on screen; a changed key means the chip would belong to another chat.
    chatKey: () => string
}

export interface FindRunClosed {
    origin: JumpOrigin
    key: string
}

export interface FindRun {
    // The jump's result, or null when the run was closed before or while it ran (the caller must then have no effect).
    show(index: number): Promise<JumpResult | null>
    // Idempotent. The chip owed at close, or null when none is.
    close(): Promise<FindRunClosed | null>
    readonly live: boolean
}

export function createFindRun(params: FindRunParams): FindRun {
    let live = true
    // The reader's place at the first show request of this opening. A jump superseded by a newer one answers with no `from`, even when it
    // had already slid the window, so the origin is read here and never taken from a result.
    let origin: JumpOrigin | null = null
    let moved = false
    let inFlight: Promise<JumpResult> | null = null

    async function show(index: number): Promise<JumpResult | null> {
        if (!live) return null
        if (origin === null) origin = params.readOrigin()
        const request = params.jumpTo(index)
        inFlight = request
        const result = await request
        if (inFlight === request) inFlight = null
        // Recorded even after close: the close judges the chip from where the show actually left the reader.
        if (result.status === 'done') moved = true
        return live ? result : null
    }

    async function close(): Promise<FindRunClosed | null> {
        if (!live) return null
        live = false
        const key = params.chatKey()
        const pending = inFlight
        if (pending) await pending.catch(() => undefined)
        const now = params.readOrigin()
        if (!moved || origin === null || now === null || params.chatKey() !== key) return null
        return isLongJump(origin.index, now.index) ? { origin, key } : null
    }

    return {
        show,
        close,
        get live() { return live },
    }
}
