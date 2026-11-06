<script lang="ts">
    import { stepSibling, regenerateNewest } from '../../ts/process/composerActions.svelte'
    import { language } from '../../lang'

    interface Props {
        idx: number
        expectedId?: string
        index: number
        count: number
        firstMessage?: boolean
        busy?: boolean
        // An older row only browses its saved alternatives: it has no New reply button and carries none of the hotkey classes.
        browseOnly?: boolean
        // False on the last row when only the end control is wanted (a single alternative with a detached continuation).
        pager?: boolean
        // How many records follow the last path message; the end control brings back the most recent one.
        continuation?: number
        // When set, the two arrows report their direction here instead of stepping the reply tree (the first message browses its greetings).
        onStep?: (direction: 'back' | 'forward') => void
        // When set, the end control reports here instead of stepping the reply tree itself, so the host row can hold its place.
        onEnd?: () => void
        // The row belongs to its message: a wheel over it is the message's wheel.
        onwheel?: (event: WheelEvent) => void
    }
    let { idx, expectedId, index, count, firstMessage = false, busy = false, browseOnly = false, pager = true, continuation = 0, onStep, onEnd, onwheel }: Props = $props()
    const source = { closeMenu: () => {} }
    let lastPage = -Infinity
    let lastGenerate = -Infinity
    function step(direction: 'back' | 'forward'): void {
        lastPage = performance.now()
        if (onStep) onStep(direction)
        else void stepSibling(source, idx, expectedId, direction, { generate: false })
    }
    // The path ends after the last row: position idx + 1 addresses the end of the path, as the classic screen's end control does.
    function goToEnd(): void {
        lastPage = performance.now()
        if (onEnd) onEnd()
        else void stepSibling(source, idx + 1, expectedId, 'back', { generate: false })
    }
    function generate(): void {
        const now = performance.now()
        if (firstMessage || browseOnly || busy || now - lastPage < 500 || now - lastGenerate < 500) return
        lastGenerate = now
        void regenerateNewest(source)
    }
    export function requestNewReply(): void { generate() }
    export function markPageChange(): void { lastPage = performance.now() }
    // The global reroll hotkey clicks the first element with the reroll class: exactly one control of the newest reply carries it, the next arrow while there is one and the new reply button at the end.
    let atEnd = $derived(index >= count)
    let hotkeys = $derived(!firstMessage && !browseOnly)
    let counterName = $derived(firstMessage ? language.chatShellFirstMessageOf(index, count) : language.chatShellReplyOf(index, count))
</script>

{#if pager}
<div data-part="chat-message-alts" role="group" aria-label={counterName} {onwheel}>
    <button type="button" data-step="prev" class:button-icon-unreroll={hotkeys} aria-label={language.chatShellPreviousReply} aria-disabled={index <= 1} title={index <= 1 ? language.chatShellFirstReply : language.chatShellPreviousReply} disabled={busy || index <= 1} onclick={() => step('back')}>‹</button>
    <span aria-live="polite">{firstMessage ? language.chatShellFirstMessageOf(index, count) : `${index} / ${count}`}</span>
    <button type="button" data-step="next" class:button-icon-reroll={hotkeys && !atEnd} aria-label={language.chatShellNextReply} aria-disabled={atEnd} title={atEnd ? language.chatShellLastReply : language.chatShellNextReply} disabled={busy || atEnd} onclick={() => step('forward')}>›</button>
    <span class="space"></span>
    {#if hotkeys}<button type="button" data-action="newReply" class:button-icon-reroll={atEnd} disabled={busy} onclick={generate}>⟳ {language.chatShellNewReply}</button>{/if}
</div>
{/if}
{#if continuation > 0}
<div data-part="chat-message-end">
    <button type="button" data-action="endControl" class="button-icon-end-control" aria-label={language.chatShellEndControl(continuation)} title={language.chatShellEndControl(continuation)} disabled={busy} onclick={goToEnd}>⇤ {continuation}</button>
</div>
{/if}

<style>
    [data-part="chat-message-alts"] { display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-message-end"] { display: flex; justify-content: flex-end; }
    button { min-width: var(--size-21); min-height: var(--size-21); color: var(--nexus-text); }
    .space { flex: 1; min-width: var(--size-14); }
</style>
