import type { ReaderIntentSource } from './readerIntent'
import { isShellFocusing } from './shellFocus'

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
    // Re-reads the reader's position after a scroll event or a programmatic scroll; reaching the bottom re-enters following.
    sync: () => void
    // The app itself brought the reader to the newest message: later growth is followed from here on.
    follow: () => void
    // The app itself moved the reader away from the bottom on purpose: later growth is not followed until the bottom is reached again.
    release: () => void
    isFollowing: () => boolean
    dispose: () => void
}

const MESSAGE_ROW_SELECTOR = 'article[data-part="chat-message"][data-chat-index]'

// Keeps a reader who rests at the bottom there while the list content settles to its final height.
// It writes scrollTop at most once per observed size change and never when the reader has left.
// The reader leaves by input only: an older-direction intent, or a user focus into a row that is not the newest. A scroll
// position never decides departure, because the browser moves scrollTop for its own reasons (anchoring, clamps, settling).
// Arriving at the bottom (a position read) re-enters following.
// While `held` is true an alternative-step hold owns the position: the follower neither writes nor re-enters following from
// the transient layout the step leaves behind. A size change it skipped is applied by the first `sync` after the hold ends.
export function createBottomFollower(host: HTMLElement, content: Element, canFollow: () => boolean, intent: ReaderIntentSource, newestIndex: () => number, held: () => boolean = () => false): BottomFollower {
    let following = isScrolledToBottom(host)
    let skippedResize = false
    const stopIntent = intent.subscribe((event) => { if (event.direction === 'older') following = false })

    // A window regaining focus re-fires focusin on the element that had it; that is not the reader choosing a row.
    let windowRefocus = false
    let refocusTimer: ReturnType<typeof setTimeout> | null = null
    const onWindowBlur = () => { windowRefocus = true }
    const onWindowFocus = () => {
        if (refocusTimer !== null) clearTimeout(refocusTimer)
        refocusTimer = setTimeout(() => { windowRefocus = false; refocusTimer = null }, 0)
    }
    const onFocusIn = (event: Event) => {
        if (isShellFocusing() || windowRefocus) return
        const target = event.target instanceof Element ? event.target : null
        const row = target?.closest<HTMLElement>(MESSAGE_ROW_SELECTOR)
        if (!row || !host.contains(row)) return
        // The newest row is read at event time: a reply appended later does not retroactively turn a resting focus into a departure.
        if (Number(row.dataset.chatIndex) < newestIndex()) following = false
    }
    host.addEventListener?.('focusin', onFocusIn)
    if (typeof window !== 'undefined') {
        window.addEventListener('blur', onWindowBlur)
        window.addEventListener('focus', onWindowFocus)
    }

    const toBottom = () => {
        const target = host.scrollHeight - host.clientHeight
        if (target - host.scrollTop > BOTTOM_EPSILON) host.scrollTop = target
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        if (!following || !canFollow()) return
        if (held()) { skippedResize = true; return }
        toBottom()
    })
    observer?.observe(content)
    return {
        sync: () => {
            if (held()) return
            if (isScrolledToBottom(host)) following = true
            if (skippedResize) {
                skippedResize = false
                if (following && canFollow()) toBottom()
            }
        },
        follow: () => {
            if (!canFollow()) return
            following = true
        },
        release: () => { following = false },
        isFollowing: () => following,
        dispose: () => {
            observer?.disconnect()
            stopIntent()
            host.removeEventListener?.('focusin', onFocusIn)
            if (typeof window !== 'undefined') {
                window.removeEventListener('blur', onWindowBlur)
                window.removeEventListener('focus', onWindowFocus)
            }
            if (refocusTimer !== null) clearTimeout(refocusTimer)
        },
    }
}
