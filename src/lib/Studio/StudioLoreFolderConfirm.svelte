<script lang="ts">
    import { onMount } from 'svelte'
    import { language } from '../../lang'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'

    // The question before a non-empty lorebook folder is deleted. The pane mounts it only while the question stands, with
    // the name and counts it read from the live rows through the folder the question was opened on. It is not modal (a
    // key such as Ctrl+K can move focus away), so the pane closes it when its view or its folder is gone. Cancel, Esc, the
    // backdrop and Back write nothing; only the Delete button asks the pane to delete.
    interface Props {
        name: string
        entries: number
        folders: number
        onconfirm: () => void
        oncancel: () => void
    }

    let { name, entries, folders, onconfirm, oncancel }: Props = $props()

    // `closed` flips when Back closes the question, so the press counts as handled and does not reach an older layer.
    let closed = false
    registerStudioBackLayer({ isOpen: () => !closed, close: () => { closed = true; oncancel() } })

    const titleId = $props.id()
    let cancelButton = $state<HTMLButtonElement | undefined>()

    // Focus starts on Cancel, so a stray Enter never deletes.
    onMount(() => cancelButton?.focus())

    function onKeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        oncancel()
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-end justify-center bg-bgcolor/60 sm:items-center" data-part="studio-lore-confirm-backdrop" onclick={(event) => { if (event.target === event.currentTarget) oncancel() }}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        role="alertdialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabindex="-1"
        data-part="studio-lore-confirm"
        class="flex w-full max-w-md flex-col gap-3 rounded-t border border-darkborderc bg-bgcolor p-3 sm:rounded"
        onkeydown={onKeydown}
    >
        <p id={titleId} data-part="studio-lore-confirm-text">{language.studioLoreFolderDeleteConfirm(name, entries, folders)}</p>
        <div class="flex justify-end gap-2">
            <button type="button" bind:this={cancelButton} data-part="studio-lore-confirm-cancel" class="min-h-11 rounded bg-darkbutton px-3 hover:bg-selected cursor-pointer" onclick={() => oncancel()}>{language.cancel}</button>
            <button type="button" data-part="studio-lore-confirm-delete" class="min-h-11 rounded border border-draculared px-3 text-draculared hover:bg-selected cursor-pointer" onclick={() => onconfirm()}>{language.studioLoreDelete}</button>
        </div>
    </div>
</div>
