export interface BottomAnchorDecision {
    wasAtBottom: boolean
    surfaceHidden: boolean
    previousHeight: number
    nextHeight: number
}

// A keyboard resize anchors only a reader who was already following the newest message.
export function shouldAnchorBottom(input: BottomAnchorDecision): boolean {
    return input.wasAtBottom && !input.surfaceHidden && Number.isFinite(input.previousHeight)
        && Number.isFinite(input.nextHeight) && input.nextHeight < input.previousHeight
}

// Fractional scroll metrics leave a sub-pixel gap at a true bottom.
const BOTTOM_EPSILON = 2

export function isScrolledToBottom(host: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>): boolean {
    return host.scrollHeight - host.clientHeight - host.scrollTop <= BOTTOM_EPSILON
}

export interface ProgrammaticScrollMarker {
    // Records the position the shell itself just wrote; call it right after the write.
    mark: (top: number) => void
    // True when a scroll event reports exactly the position of the latest shell write. The mark is spent either way, so a
    // later reader scroll is never taken for the shell's own.
    consume: (top: number) => boolean
}

// The shell's own scrollTop writes (restores, anchors, follower growth) raise scroll events that carry no reader intent.
export function createProgrammaticScrollMarker(): ProgrammaticScrollMarker {
    let marked: number | null = null
    return {
        mark: (top) => { marked = top },
        consume: (top) => {
            const own = marked !== null && marked === top
            marked = null
            return own
        },
    }
}

export interface BottomFollower {
    // Re-reads the reader's position from a scroll event or after a programmatic scroll.
    sync: () => void
    // The app itself brought the reader to the newest message: later growth is followed from here on.
    follow: () => void
    dispose: () => void
}

// Direct reader input on the scroller; a scroll that follows one is the reader's own.
const READER_INPUT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const

// Keeps a reader who rests at the bottom there while the list content settles to its final height.
// It writes scrollTop at most once per observed size change and never when the reader has scrolled away.
// The reader leaves the bottom only by evidence of a reader action: a scroll that moved scrollTop up, or a
// scroll that follows direct input and ends away from the bottom. A scroll event delivered late for our own
// write is judged by direction, never by a position that content growth has made stale.
export function createBottomFollower(host: HTMLElement, content: Element, canFollow: () => boolean = () => true, onWrite: () => void = () => {}): BottomFollower {
    let following = isScrolledToBottom(host)
    let lastTop = host.scrollTop
    let readerInput = false
    const onReaderInput = () => { readerInput = true }
    for (const name of READER_INPUT_EVENTS) host.addEventListener?.(name, onReaderInput, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        readerInput = false
        if (!following || !canFollow()) return
        const target = host.scrollHeight - host.clientHeight
        if (target - host.scrollTop > BOTTOM_EPSILON) {
            host.scrollTop = target
            onWrite()
            lastTop = host.scrollTop
        }
    })
    observer?.observe(content)
    return {
        sync: () => {
            const top = host.scrollTop
            if (isScrolledToBottom(host)) following = true
            else if (top < lastTop || readerInput) following = false
            lastTop = top
            readerInput = false
        },
        follow: () => {
            if (!canFollow()) return
            following = true
            lastTop = host.scrollTop
            readerInput = false
        },
        dispose: () => {
            observer?.disconnect()
            for (const name of READER_INPUT_EVENTS) host.removeEventListener?.(name, onReaderInput)
        },
    }
}
