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
        // When set, the two arrows report their direction here instead of stepping the reply tree (the first message browses its greetings).
        onStep?: (direction: 'back' | 'forward') => void
    }
    let { idx, expectedId, index, count, firstMessage = false, busy = false, onStep }: Props = $props()
    const source = { closeMenu: () => {} }
    let lastPage = -Infinity
    let lastGenerate = -Infinity
    function step(direction: 'back' | 'forward'): void {
        lastPage = performance.now()
        if (onStep) onStep(direction)
        else void stepSibling(source, idx, expectedId, direction, { generate: false })
    }
    function generate(): void {
        const now = performance.now()
        if (firstMessage || busy || now - lastPage < 500 || now - lastGenerate < 500) return
        lastGenerate = now
        void regenerateNewest(source)
    }
    export function requestNewReply(): void { generate() }
    export function markPageChange(): void { lastPage = performance.now() }
    // The global reroll hotkey clicks the first element with the reroll class: exactly one control of the newest reply carries it, the next arrow while there is one and the new reply button at the end.
    let atEnd = $derived(index >= count)
    let counterName = $derived(firstMessage ? language.chatShellFirstMessageOf(index, count) : language.chatShellReplyOf(index, count))
</script>

<div data-part="chat-message-alts" role="group" aria-label={counterName}>
    <button type="button" data-step="prev" class:button-icon-unreroll={!firstMessage} aria-label={language.chatShellPreviousReply} aria-disabled={index <= 1} title={index <= 1 ? language.chatShellFirstReply : language.chatShellPreviousReply} disabled={busy || index <= 1} onclick={() => step('back')}>‹</button>
    <span aria-live="polite">{firstMessage ? language.chatShellFirstMessageOf(index, count) : `${index} / ${count}`}</span>
    <button type="button" data-step="next" class:button-icon-reroll={!firstMessage && !atEnd} aria-label={language.chatShellNextReply} aria-disabled={atEnd} title={atEnd ? language.chatShellLastReply : language.chatShellNextReply} disabled={busy || atEnd} onclick={() => step('forward')}>›</button>
    <span class="space"></span>
    {#if !firstMessage}<button type="button" data-action="newReply" class:button-icon-reroll={atEnd} disabled={busy} onclick={generate}>⟳ {language.chatShellNewReply}</button>{/if}
</div>

<style>
    [data-part="chat-message-alts"] { display: flex; align-items: center; gap: var(--space-7); }
    button { min-width: var(--size-21); min-height: var(--size-21); color: var(--nexus-text); }
    .space { flex: 1; min-width: var(--size-14); }
</style>
