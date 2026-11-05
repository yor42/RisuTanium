<script lang="ts">
    import { partition, readSlots, ACTION_IDS, type ActionId } from '../../ts/chatShell/actionSlots'
    import { language } from '../../lang'

    interface Props {
        name: string
        time?: number
        model?: string
        available: readonly ActionId[]
        disabled?: readonly ActionId[]
        generating?: boolean
        onaction: (id: ActionId, shiftKey: boolean) => void
        onmore: (opener: HTMLElement) => void
    }
    let { name, time, model, available, disabled = [], generating = false, onaction, onmore }: Props = $props()
    let layout = $state(readSlots())
    let wide = $state(false)
    $effect(() => {
        if (typeof matchMedia !== 'function') return
        const query = matchMedia('(min-width: 900px)')
        const update = () => { wide = query.matches }
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })
    const labels: Record<string, string> = {
        copy: language.copy, edit: language.edit, translate: language.translate,
        readAloud: language.chatShellReadAloud, delete: language.remove,
        branch: language.chatShellBranch, bookmark: language.bookmark,
        hideAI: language.disableMessage, newReply: language.chatShellNewReply,
        stepPrev: language.chatShellPreviousReply, stepNext: language.chatShellNextReply,
        selectText: language.chatShellSelectText, deleteAfter: language.removeThisAndFollowingMessages,
        customizeButtons: language.chatShellCustomizeButtons,
    }
    const glyphs: Record<string, string> = {
        copy: '⧉', edit: '✎', translate: '文', readAloud: '♪', delete: '×', branch: '⑂', bookmark: '☆',
        hideAI: '◐', newReply: '⟳', stepPrev: '‹', stepNext: '›', selectText: 'T', deleteAfter: '⌫', customizeButtons: '⚙',
    }
    // A generating reply is stopped before it is deleted, so its pinned Delete says so as the action sheet does.
    function labelOf(id: ActionId): string { return id === 'delete' && generating ? language.chatShellStopAndDelete : labels[id] ?? id }
    let pinned = $derived(partition(layout, available, wide ? 6 : 3).pinned)
    export function refresh(): void { layout = readSlots() }
</script>

<div data-part="chat-message-meta-actions">
    {#if time}<time datetime={new Date(time).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(time)}</time>{/if}
    {#if model}<span>{model}</span>{/if}
    <span class="spacer"></span>
    {#each pinned as id (id)}
        <button type="button" data-action={id} data-part={id === 'readAloud' ? 'chat-message-tts' : undefined} aria-label={labelOf(id)} title={labelOf(id)} disabled={disabled.includes(id)} onclick={(event) => onaction(id, event.shiftKey)}>{glyphs[id] ?? '•'}</button>
    {/each}
    <button type="button" aria-label={language.chatShellMoreActions} title={language.chatShellMoreActions} onclick={(event) => onmore(event.currentTarget)}>⋯</button>
</div>

<style>
    [data-part="chat-message-meta-actions"] { display: flex; align-items: center; gap: var(--message-meta-gap); width: 100%; color: var(--nexus-text-secondary); }
    .spacer { flex: 1; }
    button { min-width: var(--size-21); min-height: var(--size-21); color: var(--nexus-text-secondary); }
</style>
