<script lang="ts">
    import type { MessageEditorController } from '../../ts/process/messageEditorController.svelte'
    import { formatDraftAge } from '../../ts/draftAge'
    import { DBState } from '../../ts/stores.svelte'
    import { language } from '../../lang'

    let { editor }: { editor: MessageEditorController } = $props()
</script>

{#if editor.editMode}
    <div data-part="chat-message-editor">
        {#if editor.restoredMessageRecord}
            <div role="status" data-part="chat-message-draft-restored">
                {language.draftRestored} · {formatDraftAge(editor.restoredMessageRecord.updatedAt, Date.now(), DBState.db.language ?? '')}
                <button type="button" onclick={editor.revertOriginalEdit}>{language.draftRevert}</button>
            </div>
        {/if}
        <textarea aria-label={language.edit} bind:value={editor.editBuffer} oninput={(event) => editor.captureMessageEdit(event.currentTarget.value)}></textarea>
        <div data-part="chat-message-editor-controls">
            <button type="button" disabled={editor.discardConfirmOpen} onclick={editor.requestDiscardOriginalEdit}>{language.messageEditDiscard}</button>
            <button type="button" onclick={editor.toggleOriginalEdit}>{language.messageEditSave}</button>
        </div>
    </div>
{/if}

<style>
    [data-part="chat-message-editor"] { width: 100%; }
    textarea { width: 100%; min-height: var(--size-30); padding: var(--space-8); color: var(--nexus-text); background: var(--color-field); border: 1px solid var(--nexus-field-border); border-radius: var(--radius-field); }
    [data-part="chat-message-editor-controls"] { display: flex; justify-content: flex-end; gap: var(--space-8); }
    button { min-height: var(--size-touch); color: var(--nexus-text); }
</style>
