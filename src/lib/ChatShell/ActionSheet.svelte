<script lang="ts">
    import type { Component } from 'svelte'
    import BookmarkIcon from '@lucide/svelte/icons/bookmark'
    import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
    import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
    import CopyIcon from '@lucide/svelte/icons/copy'
    import EyeOffIcon from '@lucide/svelte/icons/eye-off'
    import GitBranchIcon from '@lucide/svelte/icons/git-branch'
    import LanguagesIcon from '@lucide/svelte/icons/languages'
    import ListXIcon from '@lucide/svelte/icons/list-x'
    import PencilIcon from '@lucide/svelte/icons/pencil'
    import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
    import Settings2Icon from '@lucide/svelte/icons/settings-2'
    import TextSelectIcon from '@lucide/svelte/icons/text-select'
    import Trash2Icon from '@lucide/svelte/icons/trash-2'
    import Volume2Icon from '@lucide/svelte/icons/volume-2'
    import ShellSheet from './ShellSheet.svelte'
    import { language } from '../../lang'
    import type { ActionId } from '../../ts/chatShell/actionSlots'
    type SheetAction = ActionId | 'copyCard' | 'retranslate' | 'editTranslation' | 'partialEdit' | 'hideAbove'

    interface Props {
        open: boolean
        opener?: HTMLElement | null
        anchor?: { x: number; y: number }
        available: readonly SheetAction[]
        disabled?: readonly SheetAction[]
        generating?: boolean
        background?: readonly HTMLElement[]
        onaction: (id: SheetAction) => void
        onclose: () => void
    }
    let { open, opener = null, anchor, available, disabled = [], generating = false, background = [], onaction, onclose }: Props = $props()
    let wide = $state(false)
    $effect(() => {
        if (typeof matchMedia !== 'function') return
        const query = matchMedia('(min-width: 900px) and (hover: hover)')
        const update = () => { wide = query.matches }
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })
    // The destructive group is the last one, so the sheet pins it at the bottom while the rest scrolls.
    const DESTRUCTIVE: readonly SheetAction[] = ['delete', 'deleteAfter']
    const groups: readonly (readonly SheetAction[])[] = [
        ['copy', 'copyCard', 'selectText', 'edit', 'translate', 'retranslate', 'editTranslation', 'partialEdit', 'readAloud'],
        ['stepPrev', 'stepNext', 'newReply'],
        ['branch', 'bookmark', 'hideAI', 'hideAbove'],
        ['customizeButtons'],
        DESTRUCTIVE,
    ]
    // A group with nothing available is not rendered, so no empty divider or pinned strip appears.
    let shownGroups = $derived(groups.map((group) => ({ group, ids: group.filter((id) => available.includes(id)) })).filter((entry) => entry.ids.length > 0))
    const icons: Record<SheetAction, Component> = {
        copy: CopyIcon, copyCard: CopyIcon, selectText: TextSelectIcon, edit: PencilIcon, translate: LanguagesIcon, retranslate: LanguagesIcon,
        editTranslation: PencilIcon, partialEdit: PencilIcon, readAloud: Volume2Icon, stepPrev: ChevronLeftIcon, stepNext: ChevronRightIcon,
        newReply: RefreshCwIcon, branch: GitBranchIcon, bookmark: BookmarkIcon, hideAI: EyeOffIcon, hideAbove: EyeOffIcon,
        delete: Trash2Icon, deleteAfter: ListXIcon, customizeButtons: Settings2Icon,
    }
    const labels: Record<string, string> = {
        copy: language.copy, copyCard: language.copyAsCard, selectText: language.chatShellSelectText, edit: language.edit,
        retranslate: language.retranslate, editTranslation: language.editTranslation, partialEdit: language.chatShellPartialEdit,
        translate: language.translate, readAloud: language.chatShellReadAloud,
        stepPrev: language.chatShellPreviousReply, stepNext: language.chatShellNextReply,
        newReply: language.chatShellNewReply, branch: language.chatShellBranch,
        bookmark: language.bookmark, hideAI: language.disableMessage,
        hideAbove: language.disableAbove,
        delete: language.remove, deleteAfter: language.chatShellDeleteFromHere,
        customizeButtons: language.chatShellCustomizeButtons,
    }
    // A generating reply is stopped before it is deleted, so its Delete says so.
    function labelOf(id: SheetAction): string { return id === 'delete' && generating ? language.chatShellStopAndDelete : labels[id] ?? id }
    function activate(id: SheetAction): void { if (!disabled.includes(id)) { onclose(); onaction(id) } }
</script>

<ShellSheet {open} kind="menu" mode={wide ? 'wide-menu' : 'action'} {anchor} label={language.chatShellMoreActions} {opener} {background} {onclose}>
    {#each shownGroups as { group, ids }}
        {@const destructive = group === DESTRUCTIVE}
        <div data-part="chat-action-group" data-layout={wide ? 'list' : 'grid'} data-destructive-group={destructive ? '' : undefined}>
            {#each ids as id}
                {@const Icon = icons[id]}
                <button type="button" role="menuitem" data-action={id} data-sheet-initial={id === 'copy' ? '' : undefined}
                    disabled={disabled.includes(id)} title={disabled.includes(id) ? language.chatShellReplyInProgress : labelOf(id)}
                    onclick={() => activate(id)}><Icon aria-hidden="true" /><span>{labelOf(id)}</span></button>
            {/each}
        </div>
    {/each}
</ShellSheet>

<style>
    [data-part="chat-action-group"] { display: grid; gap: var(--space-3); padding: var(--space-5); }
    [data-part="chat-action-group"][data-layout="grid"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    [data-part="chat-action-group"][data-layout="list"] { grid-template-columns: minmax(0, 1fr); }
    [data-part="chat-action-group"] + [data-part="chat-action-group"] { border-top: 1px solid var(--nexus-edge); }
    button { display: flex; align-items: center; gap: var(--space-7); min-height: var(--size-21); padding: var(--space-3) var(--space-7); text-align: start; color: var(--nexus-text); border-radius: var(--radius-popup); }
    button > span { min-width: 0; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
    button :global(svg) { flex: none; width: calc(var(--icon-size-md) * var(--icon-scale)); height: calc(var(--icon-size-md) * var(--icon-scale)); stroke-width: var(--icon-stroke); }
    button:hover:not([disabled]), button:focus-visible { background: var(--nexus-surface-raised); }
    /* Danger text and icon sit only on the sheet surface: a fill behind them would drop the pair under 4.5:1, so hover is an outline. */
    [data-destructive-group] button { color: var(--nexus-danger); }
    [data-destructive-group] button:hover:not([disabled]), [data-destructive-group] button:focus-visible { background: none; }
    [data-destructive-group] button:hover:not([disabled]) { outline: 1px solid var(--nexus-danger); outline-offset: -1px; }
</style>
