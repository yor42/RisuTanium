import type { JumpOrigin } from './jumpTarget'

// How long the chip waits for the reader before it leaves, and how far the reader's own scrolling must go to dismiss it.
export const CHIP_MS = 15000
export const READER_MOVE_PX = 80

export type ChipHold = 'hover' | 'focus'

export interface ReturnChipDeps {
    setTimer: (callback: () => void, ms: number) => number
    clearTimer: (id: number) => void
    // Called after every change of `state`, so a view can re-read it.
    onChange?: () => void
}

export interface ReturnChipState {
    // The place a tap returns to; null while the chip is hidden.
    origin: JumpOrigin | null
    // The chat the origin belongs to: a return never crosses chats.
    chatKey: string | null
}

export interface ReturnChip {
    // Shows the chip for a new origin; it replaces the previous one and restarts the timer.
    show: (origin: JumpOrigin, chatKey: string) => void
    // Hover or focus on the chip keeps it; releasing the last one re-arms the timer.
    hold: (kind: ChipHold, on: boolean) => void
    // Fed only with the reader's own scrolling (reader-intent events), never with a jump's scroll. A cumulative READER_MOVE_PX hides the chip.
    readerMoved: (distance: number) => void
    // Returns the origin once and hides the chip.
    take: () => JumpOrigin | null
    hide: () => void
    readonly state: ReturnChipState
}

export function createReturnChip(deps: ReturnChipDeps): ReturnChip {
    let state: ReturnChipState = { origin: null, chatKey: null }
    let timer: number | null = null
    let moved = 0
    const holds = new Set<ChipHold>()

    function changed(): void { deps.onChange?.() }
    function disarm(): void {
        if (timer !== null) deps.clearTimer(timer)
        timer = null
    }
    function arm(): void {
        disarm()
        timer = deps.setTimer(() => { timer = null; hide() }, CHIP_MS)
    }
    function hide(): void {
        disarm()
        moved = 0
        holds.clear()
        if (state.origin === null && state.chatKey === null) return
        state = { origin: null, chatKey: null }
        changed()
    }
    return {
        show: (origin, chatKey) => {
            disarm()
            moved = 0
            holds.clear()
            state = { origin, chatKey }
            arm()
            changed()
        },
        hold: (kind, on) => {
            if (state.origin === null) return
            if (on) holds.add(kind)
            else holds.delete(kind)
            if (holds.size > 0) disarm()
            else if (timer === null) arm()
        },
        readerMoved: (distance) => {
            if (state.origin === null) return
            moved += Math.abs(distance)
            if (moved >= READER_MOVE_PX) hide()
        },
        take: () => {
            const origin = state.origin
            hide()
            return origin
        },
        hide,
        get state() { return state },
    }
}
