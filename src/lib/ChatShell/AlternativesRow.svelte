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
    }
    let { idx, expectedId, index, count, firstMessage = false, busy = false }: Props = $props()
    const source = { closeMenu: () => {} }
    let lastPage = -Infinity
    let lastGenerate = -Infinity
    function step(direction: 'back' | 'forward'): void {
        lastPage = performance.now()
        void stepSibling(source, idx, expectedId, direction, { generate: false })
    }
    function generate(): void {
        const now = performance.now()
        if (firstMessage || busy || now - lastPage < 500 || now - lastGenerate < 500) return
        lastGenerate = now
        void regenerateNewest(source)
    }
    export function requestNewReply(): void { generate() }
    export function markPageChange(): void { lastPage = performance.now() }
</script>

<div data-part="chat-alternatives" role="group" aria-label={`${language.chatShellReply} ${index} ${language.chatShellOf} ${count}`}>
    <button type="button" class="button-icon-unreroll" aria-label={language.chatShellPreviousReply} aria-disabled={index <= 1} title={index <= 1 ? language.chatShellFirstReply : language.chatShellPreviousReply} disabled={busy || index <= 1} onclick={() => step('back')}>‹</button>
    <span aria-live="polite">{firstMessage ? `${language.chatShellFirstMessage} ` : ''}{index} / {count}</span>
    <button type="button" class="button-icon-reroll" aria-label={language.chatShellNextReply} aria-disabled={index >= count} title={index >= count ? language.chatShellLastReply : language.chatShellNextReply} disabled={busy || index >= count} onclick={() => step('forward')}>›</button>
    <span class="space"></span>
    {#if !firstMessage}<button type="button" data-action="newReply" disabled={busy} onclick={generate}>⟳ {language.chatShellNewReply}</button>{/if}
</div>

<style>
    [data-part="chat-alternatives"] { display: flex; align-items: center; gap: var(--space-7); }
    button { min-width: var(--size-21); min-height: var(--size-21); color: var(--nexus-text); }
    .space { flex: 1; min-width: var(--size-14); }
</style>
