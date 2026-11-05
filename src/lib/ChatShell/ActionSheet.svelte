<script lang="ts">
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
        onaction: (id: SheetAction) => void
        onclose: () => void
    }
    let { open, opener = null, anchor, available, disabled = [], onaction, onclose }: Props = $props()
    let wide = $state(false)
    $effect(() => {
        if (typeof matchMedia !== 'function') return
        const query = matchMedia('(min-width: 900px) and (hover: hover)')
        const update = () => { wide = query.matches }
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })
    const groups: SheetAction[][] = [
        ['copy', 'copyCard', 'selectText', 'edit', 'translate', 'retranslate', 'editTranslation', 'partialEdit', 'readAloud'],
        ['stepPrev', 'stepNext', 'newReply'],
        ['branch', 'bookmark', 'hideAI', 'hideAbove'],
        ['delete', 'deleteAfter'],
        ['customizeButtons'],
    ]
    const labels: Record<string, string> = {
        copy: language.copy, copyCard: language.copyAsCard, selectText: language.chatShellSelectText, edit: language.edit,
        retranslate: language.retranslate, editTranslation: language.editTranslation, partialEdit: language.chatShellPartialEdit,
        translate: language.translate, readAloud: language.chatShellReadAloud,
        stepPrev: language.chatShellPreviousReply, stepNext: language.chatShellNextReply,
        newReply: language.chatShellNewReply, branch: language.chatShellBranch,
        bookmark: language.bookmark, hideAI: language.disableMessage,
        hideAbove: language.disableAbove,
        delete: language.remove, deleteAfter: language.removeThisAndFollowingMessages,
        customizeButtons: language.chatShellCustomizeButtons,
    }
    function activate(id: SheetAction): void { if (!disabled.includes(id)) { onclose(); onaction(id) } }
</script>

<ShellSheet {open} kind="menu" mode={wide ? 'wide-menu' : 'action'} {anchor} label={language.chatShellMoreActions} {opener} {onclose}>
    {#each groups as group, groupIndex}
        <div data-part="chat-action-group" data-destructive-group={groupIndex === 3 ? '' : undefined}>
            {#each group.filter((id) => available.includes(id)) as id}
                <button type="button" role="menuitem" data-action={id} data-sheet-initial={groupIndex === 0 && id === 'copy' ? '' : undefined}
                    disabled={disabled.includes(id)} title={disabled.includes(id) ? language.chatShellReplyInProgress : labels[id] ?? id}
                    onclick={() => activate(id)}>{labels[id] ?? id}</button>
            {/each}
        </div>
    {/each}
</ShellSheet>

<style>
    [data-part="chat-action-group"] { display: flex; flex-wrap: wrap; gap: var(--space-5); padding: var(--space-5); border-bottom: var(--stroke-thin) solid var(--nexus-edge); }
    button { min-height: var(--size-21); padding: var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border-radius: var(--radius-popup); }
    [data-destructive-group] button { color: var(--color-warning); }
</style>
