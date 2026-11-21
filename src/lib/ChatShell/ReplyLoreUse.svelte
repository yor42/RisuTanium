<script lang="ts">
    import { BookOpenIcon, ChevronDownIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { DBState } from '../../ts/stores.svelte'
    import { latestLoreUse, loreEntryTarget, loreUseOf, type LoreUsedEntry } from '../../ts/process/loreUse'
    import { openLoreEntry } from '../../ts/chatShell/openLoreEntry'

    interface Props {
        /** The message's `chatId`; only the reply of the latest send has entries (MC-3333). */
        chatId: string | undefined
        /** The character or group whose lorebook the character entries come from. */
        ownerLore: readonly { comment?: string, key?: string }[] | undefined
        /** The chat this message is in: its lorebook holds the chat entries. */
        chat: { id?: string, localLore?: readonly { comment?: string, key?: string }[] } | undefined
    }

    let { chatId, ownerLore, chat }: Props = $props()
    const uid = $props.id()
    let expanded = $state(false)

    let entries = $derived(loreUseOf($latestLoreUse, chatId))

    function sourceLabel(entry: LoreUsedEntry): string {
        if (entry.source === 'character') return language.character
        if (entry.source === 'chat') return language.Chat
        return language.chatShellLoreSourceModule
    }

    // The live list the entry belongs to, read at the tap: the editor opens on the entry only while it is still there.
    function liveListOf(entry: LoreUsedEntry): readonly { comment?: string, key?: string }[] | undefined {
        if (entry.source === 'character') return ownerLore
        if (entry.source === 'chat') return chat?.id === entry.ownerId ? chat.localLore : undefined
        return DBState.db.modules?.find((module) => module?.id === entry.ownerId)?.lorebook
    }

    function open(entry: LoreUsedEntry, element: HTMLElement): void {
        void openLoreEntry(loreEntryTarget(entry, liveListOf(entry)), element)
    }
</script>

{#if entries.length > 0}
    <div data-part="chat-message-lore">
        <button type="button" data-part="chat-message-lore-count" aria-expanded={expanded} aria-controls="{uid}-lore" onclick={() => { expanded = !expanded }}>
            <BookOpenIcon aria-hidden="true" />
            <span>{language.chatShellLoreUsed(entries.length)}</span>
            <ChevronDownIcon aria-hidden="true" data-open={expanded ? '' : undefined} />
        </button>
        {#if expanded}
            <ul id="{uid}-lore" data-part="chat-message-lore-list" aria-label={language.chatShellLoreUsedList}>
                {#each entries as entry, position (position)}
                    <li>
                        <button type="button" data-part="chat-message-lore-entry" onclick={(event) => open(entry, event.currentTarget)}>
                            <span data-part="chat-message-lore-name" data-untitled={entry.name === '' ? '' : undefined}>{entry.name || language.chatShellLoreUntitled}</span>
                            <span data-part="chat-message-lore-source">{sourceLabel(entry)}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
{/if}

<style>
    [data-part="chat-message-lore"] { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); margin-block-start: var(--space-3); max-width: var(--thread-max-width); }
    [data-part="chat-message-lore-count"] { display: inline-flex; align-items: center; gap: var(--space-3); min-block-size: var(--size-12); color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    [data-part="chat-message-lore-count"] :global(svg) { flex: none; width: calc(var(--icon-size-sm) * var(--icon-scale)); height: calc(var(--icon-size-sm) * var(--icon-scale)); stroke-width: var(--icon-stroke); }
    [data-part="chat-message-lore-count"] :global(svg[data-open]) { transform: rotate(180deg); }
    [data-part="chat-message-lore-list"] { display: flex; flex-direction: column; inline-size: 100%; margin: 0; padding: 0; list-style: none; border-inline-start: var(--stroke-bold) solid var(--nexus-edge-strong); }
    [data-part="chat-message-lore-entry"] { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-8); inline-size: 100%; min-block-size: var(--size-12); padding-inline: var(--space-8); text-align: start; color: var(--nexus-text); font-size: var(--font-size-xs); }
    [data-part="chat-message-lore-name"] { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-message-lore-name"][data-untitled] { color: var(--nexus-text-secondary); font-style: italic; }
    [data-part="chat-message-lore-source"] { flex: none; color: var(--nexus-text-secondary); }
</style>
