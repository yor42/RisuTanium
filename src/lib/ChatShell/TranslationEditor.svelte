<script lang="ts">
    import type { MessageEditorController } from '../../ts/process/messageEditorController.svelte'
    import { formatDraftAge } from '../../ts/draftAge'
    import { DBState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import { alertError } from '../../ts/alert'

    let { editor }: { editor: MessageEditorController } = $props()
</script>

{#if editor.editTranslationMode}
    <div data-part="chat-message-translation-editor">
        {#if editor.restoredTranslationRecord}
            <div role="status" data-part="chat-message-draft-restored">
                {language.draftRestored} · {formatDraftAge(editor.restoredTranslationRecord.updatedAt, Date.now(), DBState.db.language ?? '')}
                <button type="button" onclick={editor.revertTranslationEdit}>{language.draftRevert}</button>
            </div>
        {/if}
        <textarea aria-label={language.editTranslation} bind:value={editor.editTranslationText} oninput={(event) => editor.captureTranslationEdit(event.currentTarget.value)}></textarea>
        <div data-part="chat-message-editor-controls">
            <button type="button" onclick={editor.closeTranslationKeep}>{language.chatShellTranslationClose}</button>
            <button type="button" onclick={() => editor.saveTranslationEdit().catch(alertError)}>{language.editTranslationSave}</button>
        </div>
    </div>
{/if}

<style>
    [data-part="chat-message-translation-editor"] { width: 100%; }
    textarea { width: 100%; min-height: var(--size-30); padding: var(--space-8); color: var(--nexus-text); background: var(--color-field); border: 1px solid var(--nexus-field-border); border-radius: var(--radius-field); }
    [data-part="chat-message-editor-controls"] { display: flex; justify-content: flex-end; gap: var(--space-8); }
    button { min-height: var(--size-touch); color: var(--nexus-text); }
</style>
