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
    <div data-part="chat-extras-strip" data-part-critical>
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
    [data-part="chat-extras-strip"] { display: flex; gap: 4px; overflow-x: auto; align-items: center; min-height: 44px; }
    [data-part="chat-attachment-chip"] { display: inline-flex; align-items: center; height: 44px; white-space: nowrap; padding-left: 8px; background: var(--color-selected); border: 1px solid var(--color-darkborderc); border-radius: 8px; }
    [data-part="chat-attachment-chip"] button { width: 44px; height: 44px; color: var(--color-textcolor); }
    [data-part="chat-sticker-assets"] { display: flex; max-height: 20dvh; overflow: auto; }
    [data-part="chat-translate-preview"] { display: inline-flex; align-items: center; height: 44px; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; background: var(--color-selected); color: var(--color-textcolor); }
    [data-part="chat-suggestions"] { flex: none; }
</style>
