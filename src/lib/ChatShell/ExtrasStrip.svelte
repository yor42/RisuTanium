<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { character, groupChat } from '../../ts/storage/database.svelte'
    import { language } from '../../lang'
    import AssetInput from '../ChatScreens/AssetInput.svelte'

    interface Props {
        files: readonly string[]
        currentCharacter: character | groupChat | null | undefined
        stickersOpen: boolean
        showSuggestions?: boolean
        translatePreview?: string
        onremove: (index: number) => void
        onselect: (asset: [string, string, string]) => void
        children?: Snippet
    }
    let { files, currentCharacter, stickersOpen, showSuggestions = false, translatePreview = '', onremove, onselect, children }: Props = $props()
</script>

{#if files.length > 0 || (stickersOpen && currentCharacter) || showSuggestions || translatePreview}
    <div data-part="chat-extras-strip">
        {#each files as file, index}
            <span data-part="chat-attachment-chip"><span>{file}</span><button aria-label={`${language.chatShellRemoveAttachment}: ${file}`} onclick={() => onremove(index)}>×</button></span>
        {/each}
        {#if translatePreview}<span data-part="chat-translate-preview">{translatePreview}</span>{/if}
        {#if stickersOpen && currentCharacter}
            <div data-part="chat-sticker-assets"><AssetInput currentCharacter={currentCharacter} onSelect={onselect} /></div>
        {/if}
        {#if showSuggestions && children}<div data-part="chat-suggestions">{@render children()}</div>{/if}
    </div>
{/if}

<style>
    [data-part="chat-extras-strip"] { display: flex; gap: var(--space-3); overflow-x: auto; align-items: center; min-height: var(--size-touch); }
    [data-part="chat-attachment-chip"] { display: inline-flex; align-items: center; height: var(--size-touch); white-space: nowrap; padding-left: var(--space-7); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-5); }
    [data-part="chat-attachment-chip"] button { width: var(--size-touch); height: var(--size-touch); color: var(--nexus-text); }
    [data-part="chat-sticker-assets"] { display: flex; max-height: var(--size-rel-20); overflow: auto; }
    [data-part="chat-translate-preview"] { display: inline-flex; align-items: center; height: var(--size-touch); max-width: var(--size-38); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 var(--space-7); background: var(--nexus-surface-raised); color: var(--nexus-text); }
    [data-part="chat-suggestions"] { flex: none; }
</style>