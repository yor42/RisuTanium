<script lang="ts">
    import { LayoutGridIcon, UsersIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import type { Database } from "src/ts/storage/database.svelte";
    import CharListAvatar from "../../Others/CharListAvatar.svelte";

    type Entry = Database['characters'][number];

    interface Props {
        // The characters to offer, most recent first (`recentCharacters`).
        characters: ReadonlyArray<Entry>;
        // The open character; it is always shown, ringed.
        current?: Entry;
        // Five avatars in both overlays, four when docked; names are left out of the follow overlay,
        // where each avatar keeps a tooltip.
        layout: 'follow' | 'wide' | 'docked';
        onpick: (entry: Entry, event: MouseEvent) => void;
        onall: () => void;
    }

    let { characters, current, layout, onpick, onall }: Props = $props();

    const slots = $derived(layout === 'docked' ? 4 : 5);
    const shown = $derived.by(() => {
        const first = characters.slice(0, slots);
        if (!current || first.includes(current) || !characters.includes(current)) {
            return first;
        }
        return first.length < slots ? [...first, current] : [...first.slice(0, slots - 1), current];
    });
    const showNames = $derived(layout !== 'follow');

    function labelOf(entry: Entry): string {
        const name = entry.name || language.settingsPage.unnamed;
        return entry.type === 'group' ? language.chatShellGroupName(name) : name;
    }
</script>

<div data-part="chat-sidebar-strip" role="group" aria-label={language.chatShellRecentCharacters} class="flex items-start gap-1 w-full">
    {#each shown as entry (entry)}
        {@const label = labelOf(entry)}
        <button
            data-part="strip-avatar"
            class="flex flex-col items-center gap-0.5 w-11 min-w-11 cursor-pointer text-textcolor hover:text-textcolor2"
            aria-label={label}
            title={label}
            aria-current={entry === current ? 'true' : undefined}
            onclick={(event) => onpick(entry, event)}
        >
            <span class="relative flex rounded-md" class:ring-2={entry === current} class:ring-textcolor={entry === current}>
                <CharListAvatar src={entry.image ?? ''} class="h-11! w-11! min-h-11!" />
                {#if entry.type === 'group'}
                    <span data-part="strip-group-glyph" class="absolute bottom-0 right-0 flex items-center justify-center rounded-tl-md rounded-br-md bg-darkbg text-textcolor p-0.5" aria-hidden="true">
                        <UsersIcon size={12} />
                    </span>
                {/if}
            </span>
            {#if showNames}
                <span data-part="strip-name" class="w-full truncate text-center text-[10px] leading-tight">{entry.name || language.settingsPage.unnamed}</span>
            {/if}
        </button>
    {/each}
    <button
        data-part="strip-all"
        class="flex items-center justify-center h-11 w-11 min-w-11 rounded-md bg-darkbutton text-textcolor hover:text-textcolor2 cursor-pointer"
        aria-label={language.chatShellAllCharacters}
        title={language.chatShellAllCharacters}
        onclick={onall}
    >
        <LayoutGridIcon size={20} />
    </button>
</div>
