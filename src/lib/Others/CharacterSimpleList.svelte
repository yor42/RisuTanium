<script lang="ts" module>
    /**
     * What the Home library hands the lists so a row can open its character in Studio. Absent in every other
     * host, where no Studio control exists.
     */
    export interface LibraryStudio {
        /** Whether Studio can open the character at this slot. */
        available(index: number): boolean;
        /** Selects the slot and opens Studio on it; `opener` is the control that was pressed. */
        open(index: number, opener: HTMLElement): void;
    }
</script>
<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import { addCharacter, changeChar } from "src/ts/characters";
    import { LayoutPanelLeftIcon, MessageSquareIcon, PlusIcon } from "@lucide/svelte";
    import { coldStubChatCount } from "src/ts/process/coldCharacter";
    import { language } from "src/lang";
    import { createCharacterSearch, type CharacterSearch } from "src/ts/gui/characterSearch.svelte";
    import { slotKeys } from "src/ts/gui/characterSearch";
    import CharacterWindow from "./CharacterWindow.svelte";
    import CharListAvatar from "./CharListAvatar.svelte";
    import CharacterNameRow from "./CharacterNameRow.svelte";
    import { SIMPLE_ROW_FALLBACK_PX, listRows } from "./charListRows";
    import { compareRecent } from "./charListOrder";

    interface Props {
        endGrid?: () => void;
        search?: string;
        hideTrash?: boolean;
        // The search result of the screen that embeds this list. Without it the
        // list searches by `search`, else shows every character.
        results?: CharacterSearch;
        // What a tap on a row does with the character's slot. Without it the row opens the
        // character and leaves the screen, as it always did.
        onpick?: (index: number) => void;
        // Whether the character at this slot is being loaded by a pick: the row is marked busy.
        opening?: (index: number) => boolean;
        // Present only in the Home library. A row whose character Studio can open then gets an icon button
        // beside the row button; without it, or for any other row, the markup is unchanged.
        studio?: LibraryStudio;
    }

    const agoFormatter = new Intl.RelativeTimeFormat(navigator.languages, { style: 'short' });

    let {endGrid = () => {}, search, hideTrash = true, results, onpick, opening, studio}: Props = $props();
    // Fixed for the component's life: the effect inside createCharacterSearch
    // can only be created during initialisation, and an embedding screen never
    // swaps its result. The result's properties are getters, so reading them in
    // the template follows later queries.
    // svelte-ignore state_referenced_locally
    const found = results ?? createCharacterSearch(() => search ?? '');

    function makeAgoText(time:number){
        if(time === 0){
            return language.settingsPage.unknown;
        }
        const diff = Date.now() - time;
        if(diff < 3600000){
            const min = Math.floor(diff / 60000);
            return agoFormatter.format(-min, 'minute');
        }
        if(diff < 86400000){
            const hour = Math.floor(diff / 3600000);
            return agoFormatter.format(-hour, 'hour');
        }
        if(diff < 604800000){
            const day = Math.floor(diff / 86400000);
            return agoFormatter.format(-day, 'day');
        }
        if(diff < 2592000000){
            const week = Math.floor(diff / 604800000);
            return agoFormatter.format(-week, 'week');
        }
        if(diff < 31536000000){
            const month = Math.floor(diff / 2592000000);
            return agoFormatter.format(-month, 'month');
        }
        const year = Math.floor(diff / 31536000000);
        return agoFormatter.format(-year, 'year');
    }

    // The order of the list: most recent first, then by name. It depends on
    // neither the search nor the chats, so a keystroke or a new message does
    // not re-sort it; a row reads its own chat count and image when drawn.
    // A row is keyed by its character (`slotKeys`), never by its position, so a removal elsewhere keeps
    // focus and the measured row heights on the same character. `i` is the slot it is at now.
    const sorted = $derived.by(() => {
        const keys = slotKeys(DBState.db.characters);
        const entries: { name: string; i: number; key: string; interaction: number }[] = [];
        DBState.db.characters.forEach((c, i) => {
            const key = keys[i];
            if (key === null || (hideTrash && c.trashTime)) {
                return;
            }
            entries.push({
                name: c.name || language.settingsPage.unnamed,
                i: i,
                key: key,
                interaction: c.lastInteraction || 0,
            });
        });
        return entries.sort(compareRecent);
    });
    const entryByKey = $derived(new Map(sorted.map((entry) => [entry.key, entry])));
    const rows = $derived(listRows(sorted.filter((entry) => found.matched.has(entry.i)).map((entry) => entry.key)));
</script>
{#snippet card(cardKey: string, position: number, visible: () => boolean)}
    {@const entry = entryByKey.get(cardKey)}
    {@const index = entry?.i ?? -1}
    {@const c = DBState.db.characters[index]}
    <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
    {#if entry && c}
        {@const chats = coldStubChatCount(c)}
        {@const agoText = makeAgoText(entry.interaction)}
        {@const busy = opening?.(index) ?? false}
        {@const studioShown = studio?.available(index) ?? false}
        <!-- The row button; with a Studio control beside it the divider line moves to the wrapper, so it runs under both. -->
        {#snippet rowButton(divided: boolean)}
            <button class="flex p-2 border-t-darkborderc gap-2 w-full rounded-md transition-colors duration-150 hover:bg-darkbutton/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-selected" class:border-t={divided} aria-busy={busy ? 'true' : undefined} onclick={() => {
                if (onpick) {
                    onpick(index)
                    return
                }
                changeChar(index)
                endGrid()
            }}>
                <CharListAvatar src={c.image} {visible} {busy} class="hover:bg-selected transition-colors duration-150" />
                <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
                    <CharacterNameRow chaId={c.chaId} name={entry.name} />
                    <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
                        <span class="mr-1">{chats}</span>
                        <MessageSquareIcon size={14} />
                        <span class="mr-1 ml-1">|</span>
                        <span>{agoText}</span>
                    </div>
                </div>
            </button>
        {/snippet}
        {#if studio && studioShown}
            <div class="flex items-center gap-1 border-t-darkborderc" class:border-t={position !== 1}>
                {@render rowButton(false)}
                <button
                    class="shrink-0 p-2 rounded-md text-textcolor2 hover:text-textcolor hover:bg-darkbutton/40 transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-selected"
                    data-part="library-studio"
                    data-cha-id={c.chaId}
                    aria-label={language.studioOpenInNamed(entry.name)}
                    title={language.studioOpenInNamed(entry.name)}
                    onclick={(event) => studio?.open(index, event.currentTarget)}
                >
                    <LayoutPanelLeftIcon size={18} />
                </button>
            </div>
        {:else}
            {@render rowButton(position !== 1)}
        {/if}
    {/if}
{/snippet}
<div class="flex flex-col items-center w-full h-full">
    <CharacterWindow class="w-full flex-1 min-h-0" {rows} fallbackHeight={SIMPLE_ROW_FALLBACK_PX} resetToken={found.query} {card} />
</div>

<button class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc" onclick={() => {
    addCharacter()
}}>
    <PlusIcon size={24} />
</button>
