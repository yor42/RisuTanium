<script module lang="ts">
    // Every row shares the formatter of the current app language, rebuilt only when that language changes. The time zone is fixed when a formatter is built, so a change of it while the app runs shows from the next reload.
    const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
</script>

<script lang="ts">
    import { partition, type ActionId } from '../../ts/chatShell/actionSlots'
    import { currentSlots, syncSlots } from '../../ts/chatShell/slotsStore.svelte'
    import type { Component } from 'svelte'
    import BookmarkIcon from '@lucide/svelte/icons/bookmark'
    import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
    import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
    import CopyIcon from '@lucide/svelte/icons/copy'
    import EllipsisIcon from '@lucide/svelte/icons/ellipsis'
    import EyeOffIcon from '@lucide/svelte/icons/eye-off'
    import GitBranchIcon from '@lucide/svelte/icons/git-branch'
    import LanguagesIcon from '@lucide/svelte/icons/languages'
    import ListXIcon from '@lucide/svelte/icons/list-x'
    import PencilIcon from '@lucide/svelte/icons/pencil'
    import PuzzleIcon from '@lucide/svelte/icons/puzzle'
    import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
    import Settings2Icon from '@lucide/svelte/icons/settings-2'
    import TextSelectIcon from '@lucide/svelte/icons/text-select'
    import Trash2Icon from '@lucide/svelte/icons/trash-2'
    import Volume2Icon from '@lucide/svelte/icons/volume-2'
    import { language } from '../../lang'
    import { appDateFormat } from '../../ts/appIntl.svelte'

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
    syncSlots()
    let layout = $derived(currentSlots())
    const timeFormat = $derived(appDateFormat(TIME_OPTIONS))
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
    // A plugin action and any id without an icon of its own fall back to the puzzle piece.
    const icons: Record<string, Component> = {
        copy: CopyIcon, edit: PencilIcon, translate: LanguagesIcon, readAloud: Volume2Icon, delete: Trash2Icon, branch: GitBranchIcon, bookmark: BookmarkIcon,
        hideAI: EyeOffIcon, newReply: RefreshCwIcon, stepPrev: ChevronLeftIcon, stepNext: ChevronRightIcon, selectText: TextSelectIcon, deleteAfter: ListXIcon, customizeButtons: Settings2Icon,
    }
    // A generating reply is stopped before it is deleted, so its pinned Delete says so as the action sheet does.
    function labelOf(id: ActionId): string { return id === 'delete' && generating ? language.chatShellStopAndDelete : labels[id] ?? id }
    let pinned = $derived(partition(layout, available, wide ? 6 : 3).pinned)
    export function refresh(): void { syncSlots() }
</script>

<div data-part="chat-message-actions">
    {#if time}<time class="time" datetime={new Date(time).toISOString()}>{timeFormat.format(time)}</time>{/if}
    {#if model}<span class="model" title={model}>{model}</span>{/if}
    <span class="spacer"></span>
    {#each pinned as id (id)}
        {@const Icon = icons[id] ?? PuzzleIcon}
        <button type="button" data-action={id} data-part={id === 'readAloud' ? 'chat-message-tts' : undefined} aria-label={labelOf(id)} title={labelOf(id)} disabled={disabled.includes(id)} onclick={(event) => onaction(id, event.shiftKey)}><Icon aria-hidden="true" /></button>
    {/each}
    <button type="button" aria-label={language.chatShellMoreActions} title={language.chatShellMoreActions} onclick={(event) => onmore(event.currentTarget)}><EllipsisIcon aria-hidden="true" /></button>
</div>

<style>
    [data-part="chat-message-actions"] { display: flex; align-items: center; justify-content: flex-end; gap: var(--message-meta-gap); flex: 1 1 auto; min-width: 0; color: var(--nexus-text-secondary); }
    .spacer { flex: 1 1 0; }
    /* The row stays one line at phone width: the time never wraps and the model name gives way with an ellipsis. */
    .time { flex: none; white-space: nowrap; }
    .model { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { display: inline-flex; align-items: center; justify-content: center; min-width: var(--size-21); min-height: var(--size-21); color: var(--nexus-text-secondary); }
    button :global(svg) { flex: none; width: calc(var(--icon-size-md) * var(--icon-scale)); height: calc(var(--icon-size-md) * var(--icon-scale)); stroke-width: var(--icon-stroke); }
    button[data-action="stepPrev"]:dir(rtl) :global(svg), button[data-action="stepNext"]:dir(rtl) :global(svg) { transform: scaleX(-1); }
</style>
