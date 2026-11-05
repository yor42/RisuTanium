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

export interface BottomFollower {
    // Re-reads the reader's position; call from the scroll handler and after a programmatic scroll.
    sync: () => void
    dispose: () => void
}

// Keeps a reader who rests at the bottom there while the list content settles to its final height.
// It writes scrollTop at most once per observed size change and never when the reader has scrolled away.
export function createBottomFollower(host: HTMLElement, content: Element, canFollow: () => boolean = () => true): BottomFollower {
    let following = true
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        if (!following || !canFollow()) return
        const target = host.scrollHeight - host.clientHeight
        if (target - host.scrollTop > BOTTOM_EPSILON) host.scrollTop = target
    })
    observer?.observe(content)
    return {
        sync: () => { following = isScrolledToBottom(host) },
        dispose: () => observer?.disconnect(),
    }
}
