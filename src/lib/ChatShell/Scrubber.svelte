<script lang="ts">
    import { readHaptics, tickHaptic } from '../../ts/chatShell/haptics'
    import { bubbleParts, createScrubGesture, fractionAtPointer, indexAtFraction, scrubberFits, tenthCrossed } from '../../ts/chatShell/scrubber'

    // The scrubber draws a thumb and, while it is dragged, a bubble; it never touches the list. Only a recorded pointerup reports an
    // index, so every other ending (cancel, lost capture, Escape, blur, a hidden page, hiding, unmount) leaves the chat where it is.
    // The jump sheet is the keyboard and screen-reader path, so the whole scrubber is hidden from assistive technology.
    interface Props {
        count: number
        fraction: number
        visible: boolean
        trackInteractive: boolean
        formatter: Intl.DateTimeFormat
        label: (position: string, total: string, date: string | null) => string
        timeAt: (index: number) => number | undefined
        pick?: (x: number, y: number) => Element | null | undefined
        onrelease: (index: number) => void
        onpage: (direction: -1 | 1) => void
        onhover: (on: boolean) => void
        ondrag: (on: boolean) => void
        onwheel: (event: WheelEvent) => void
    }
    let { count, fraction, visible, trackInteractive, formatter, label, timeAt, pick, onrelease, onpage, onhover, ondrag, onwheel }: Props = $props()

    interface Session {
        pointerId: number
        pointerType: string
        startIndex: number
        grab: number
        trackTop: number
        trackHeight: number
        thumbHeight: number
        started: boolean
        prevP: number
        lastY: number
    }

    let root: HTMLElement | undefined
    let track: HTMLElement | undefined
    let thumb: HTMLElement | undefined
    let session: Session | null = null
    // A track too short to address the chat hides the scrubber; it is read on each reveal, whenever the track is resized (a window resize or rotation) and again when a drag would start.
    let fits = $state(false)
    let dragP = $state<number | null>(null)

    const hidden = $derived(!visible || !fits)
    const shown = $derived(dragP ?? (Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0))
    const parts = $derived.by(() => {
        if (dragP === null) return null
        const index = indexAtFraction(dragP, count)
        return bubbleParts(index, count, timeAt(index), formatter)
    })

    const gesture = createScrubGesture({
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle),
        onHoldStart: () => { if (session) beginDrag(session.lastY) },
    })

    function measure(): boolean {
        fits = scrubberFits(track?.getBoundingClientRect().height ?? 0, thumb?.getBoundingClientRect().height ?? 0)
        return fits
    }

    function pointerFraction(s: Session, y: number): number {
        return fractionAtPointer({ y, grab: s.grab, trackTop: s.trackTop, trackHeight: s.trackHeight, thumbHeight: s.thumbHeight })
    }

    function beginDrag(y: number): void {
        if (!session) return
        session.started = true
        session.prevP = pointerFraction(session, y)
        dragP = session.prevP
        ondrag(true)
    }

    function applyPoint(s: Session, y: number): void {
        const next = pointerFraction(s, y)
        if (tenthCrossed(s.prevP, next)) tickHaptic('scrub', s.pointerType, readHaptics())
        s.prevP = next
        dragP = next
    }

    function releaseSession(): Session | null {
        const s = session
        if (!s) return null
        session = null
        window.removeEventListener('keydown', onKey, { capture: true })
        window.removeEventListener('blur', abortSession)
        document.removeEventListener('visibilitychange', onVisibility)
        try {
            thumb?.releasePointerCapture(s.pointerId)
        } catch {
            // The pointer is already gone; nothing is left to release.
        }
        return s
    }

    function abortSession(): void {
        const s = releaseSession()
        if (!s) return
        gesture.abort()
        if (s.started) {
            dragP = null
            ondrag(false)
        }
    }

    function onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            abortSession()
        }
    }

    function onVisibility(): void {
        if (document.visibilityState === 'hidden') abortSession()
    }

    function onThumbDown(event: PointerEvent): void {
        if (session || !visible || !thumb || !track) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (!measure()) return
        const thumbRect = thumb.getBoundingClientRect()
        const trackRect = track.getBoundingClientRect()
        session = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            startIndex: indexAtFraction(shown, count),
            grab: event.clientY - thumbRect.top,
            trackTop: trackRect.top,
            trackHeight: trackRect.height,
            thumbHeight: thumbRect.height,
            started: false,
            prevP: shown,
            lastY: event.clientY,
        }
        try {
            thumb.setPointerCapture(event.pointerId)
        } catch {
            // A pointer that is already gone cannot be captured; the window listeners below still end the drag.
        }
        window.addEventListener('keydown', onKey, { capture: true })
        window.addEventListener('blur', abortSession)
        document.addEventListener('visibilitychange', onVisibility)
        gesture.down(event.clientX, event.clientY)
    }

    function onThumbMove(event: PointerEvent): void {
        if (!session || event.pointerId !== session.pointerId) return
        session.lastY = event.clientY
        const outcome = gesture.move(event.clientX, event.clientY)
        if (outcome?.kind === 'dragStart') beginDrag(event.clientY)
        else if (outcome?.kind === 'drag') applyPoint(session, event.clientY)
    }

    function onThumbUp(event: PointerEvent): void {
        if (!session || event.pointerId !== session.pointerId) return
        const outcome = gesture.up()
        const s = releaseSession()
        if (!s || !outcome) return
        if (outcome.kind === 'tap') {
            const target = (pick ?? defaultPick)(outcome.x, outcome.y)
            if (target instanceof HTMLElement) target.click()
        } else if (outcome.kind === 'release') {
            const index = indexAtFraction(s.prevP, count)
            dragP = null
            ondrag(false)
            if (Number.isInteger(index) && index !== s.startIndex) onrelease(index)
        }
    }

    function onThumbCancel(event: PointerEvent): void {
        if (session && event.pointerId === session.pointerId) abortSession()
    }

    function defaultPick(x: number, y: number): Element | undefined {
        if (typeof document.elementsFromPoint !== 'function') return undefined
        return document.elementsFromPoint(x, y).find((element) => !root?.contains(element))
    }

    function swallowClick(event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
    }

    function onTrackClick(event: MouseEvent): void {
        if (hidden || !trackInteractive || !thumb) return
        const rect = thumb.getBoundingClientRect()
        onpage(event.clientY < rect.top + rect.height / 2 ? -1 : 1)
    }

    function onTrackWheel(event: WheelEvent): void {
        if (hidden) return
        if (!event.ctrlKey) event.preventDefault()
        onwheel(event)
    }

    function hover(event: PointerEvent, on: boolean): void {
        if (event.pointerType === 'mouse') onhover(on)
    }

    $effect(() => {
        if (visible) measure()
    })
    $effect(() => {
        // Hiding is opacity only, so the track keeps its size while hidden and a resize can reveal or hide it.
        if (!track || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => { measure() })
        observer.observe(track)
        return () => observer.disconnect()
    })
    $effect(() => {
        if (hidden) abortSession()
    })
    $effect(() => abortSession)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={root} data-part="chat-scrubber" aria-hidden="true" data-hidden={hidden ? '' : undefined} style:--chat-scrub-p={shown} onpointerenter={(event) => hover(event, true)} onpointerleave={(event) => hover(event, false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div bind:this={track} data-part="chat-scrubber-track" data-interactive={trackInteractive && !hidden ? '' : undefined} onclick={onTrackClick} onwheel={onTrackWheel}>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div bind:this={thumb} data-part="chat-scrubber-thumb" data-dragging={dragP === null ? undefined : ''} onpointerdown={onThumbDown} onpointermove={onThumbMove} onpointerup={onThumbUp} onpointercancel={onThumbCancel} onlostpointercapture={onThumbCancel} oncontextmenu={(event) => event.preventDefault()} onclick={swallowClick}></div>
    </div>
    {#if parts}
        <div data-part="chat-scrubber-bubble">{label(parts.position, parts.total, parts.date)}</div>
    {/if}
</div>

<style>
    [data-part="chat-scrubber"] { position: absolute; z-index: calc(var(--pattern-z-layer) - 1); right: calc(var(--space-17) + env(safe-area-inset-right)); top: calc(var(--header-height) + var(--space-7)); bottom: calc(var(--size-37) + var(--size-touch-lg) + var(--space-7)); width: var(--size-touch); pointer-events: none; opacity: 1; transition: opacity var(--chat-dur-fast) var(--chat-ease-out); }
    :global([data-part="chat-shell"][data-find-open]) [data-part="chat-scrubber"] { top: calc(var(--header-height) + var(--size-17) + var(--space-7)); }
    [data-part="chat-scrubber"][data-hidden] { opacity: 0; }
    [data-part="chat-scrubber-track"] { position: absolute; top: 0; bottom: 0; left: 0; right: 0; pointer-events: none; }
    [data-part="chat-scrubber-track"][data-interactive] { pointer-events: auto; }
    [data-part="chat-scrubber-track"]::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: var(--size-2); margin-left: calc(var(--size-2) / -2); border-radius: var(--radius-pill); background: var(--nexus-edge); }
    [data-part="chat-scrubber-thumb"] { position: absolute; left: 0; right: 0; top: calc(var(--chat-scrub-p) * (100% - var(--size-27))); height: var(--size-27); box-sizing: border-box; border-radius: var(--radius-pill); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    [data-part="chat-scrubber"][data-hidden] [data-part="chat-scrubber-thumb"] { pointer-events: none; }
    [data-part="chat-scrubber-thumb"][data-dragging] { border-color: var(--nexus-text); }
    [data-part="chat-scrubber-bubble"] { position: absolute; top: calc(var(--chat-scrub-p) * (100% - var(--size-27))); height: var(--size-27); right: calc(100% + var(--space-5)); display: flex; align-items: center; padding: 0 var(--space-10); box-sizing: border-box; white-space: nowrap; border-radius: var(--radius-pill); background: var(--nexus-surface-raised); color: var(--nexus-text); border: 1px solid var(--nexus-edge); pointer-events: none; }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-scrubber"] { transition: none; } }
    :global(html.rm) [data-part="chat-scrubber"], :global(html[data-low-power]) [data-part="chat-scrubber"], :global(html.nexus-low-power) [data-part="chat-scrubber"] { transition: none; }
</style>
