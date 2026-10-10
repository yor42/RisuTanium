<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import { addCharacter, changeChar } from "src/ts/characters";
    import { MobileSearch } from "src/ts/stores.svelte";
    import { ArrowLeft, MessageSquareIcon, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { coldStubChatCount } from "src/ts/process/coldCharacter";
    import { language } from "src/lang";
    import { createCharacterSearch, type CharacterSearch } from "src/ts/gui/characterSearch.svelte";
    import { slotKeys } from "src/ts/gui/characterSearch";
    import CharacterTrashList from "../Others/CharacterTrashList.svelte";
    import CharacterWindow from "../Others/CharacterWindow.svelte";
    import CharListAvatar from "../Others/CharListAvatar.svelte";
    import { SIMPLE_ROW_FALLBACK_PX, listRows, type ScrollAnchor } from "../Others/charListRows";

    interface Props {
        endGrid?: () => void;
        search?: string;
        hideTrash?: boolean;
        // Offers a "Trash (n)" row that opens the trash in place. Off for the
        // list embedded in GridCatalog, which has its own Trash tab.
        trashEntry?: boolean;
        // The search result of the screen that embeds this list. Without it the
        // list searches by `search`, else by the mobile header's search box.
        results?: CharacterSearch;
    }

    const agoFormatter = new Intl.RelativeTimeFormat(navigator.languages, { style: 'short' });

    let {endGrid = () => {}, search, hideTrash = true, trashEntry = false, results}: Props = $props();
    // Local on purpose: the swipe gestures move through MobileGUIStack, so the
    // trash view must not be a stack value. Leaving the screen resets it.
    let trashOpen = $state(false);
    // Fixed for the component's life: the effect inside createCharacterSearch
    // can only be created during initialisation, and an embedding screen never
    // swaps its result. The result's properties are getters, so reading them in
    // the template follows later queries.
    // svelte-ignore state_referenced_locally
    const found = results ?? createCharacterSearch(() => search ?? $MobileSearch);

    // The list is unmounted while the trash view is open, so what it needs to come back to the
    // same row is kept here: the row measurements (the saved position only means the same row
    // against the heights it was taken with) and the row at the top when the trash was opened.
    const listHeights = new Map<string, number>();
    let listWindow = $state<ReturnType<typeof CharacterWindow>>();
    let listAnchor = $state<ScrollAnchor | null>(null);
    let anchorQuery = '';

    function openTrash() {
        listAnchor = listWindow?.getAnchor() ?? null;
        anchorQuery = found.query;
        trashOpen = true;
    }

    // A search that changed while the trash was open means a different list: it starts at the top.
    function closeTrash() {
        if (found.query !== anchorQuery) {
            listAnchor = null;
        }
        trashOpen = false;
    }

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
    // the saved scroll anchor and the row heights on the same character. `i` is the slot it is at now.
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
        return entries.sort((a, b) => {
            if (a.interaction === b.interaction) {
                return a.name.localeCompare(b.name);
            }
            return b.interaction - a.interaction;
        });
    });
    const entryByKey = $derived(new Map(sorted.map((entry) => [entry.key, entry])));
    const rows = $derived(listRows(sorted.filter((entry) => found.matched.has(entry.i)).map((entry) => entry.key)));
</script>
{#snippet card(cardKey: string, position: number)}
    {@const entry = entryByKey.get(cardKey)}
    {@const index = entry?.i ?? -1}
    {@const c = DBState.db.characters[index]}
    <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
    {#if entry && c}
        {@const chats = coldStubChatCount(c)}
        {@const agoText = makeAgoText(entry.interaction)}
        <button class="flex p-2 border-t-darkborderc gap-2 w-full" class:border-t={position !== 1} onclick={() => {
            changeChar(index)
            endGrid()
        }}>
            <CharListAvatar src={c.image} class="hover:bg-[#10b981] transition-colors duration-150" />
            <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
                <span>{entry.name}</span>
                <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
                    <span class="mr-1">{chats}</span>
                    <MessageSquareIcon size={14} />
                    <span class="mr-1 ml-1">|</span>
                    <span>{agoText}</span>
                </div>
            </div>
        </button>
    {/if}
{/snippet}
<div class="flex flex-col items-center w-full h-full">
    {#if trashOpen}
        <button class="flex p-2 gap-2 w-full items-center text-textcolor2 border-b border-b-darkborderc shrink-0" onclick={closeTrash}>
            <ArrowLeft size={20} />
            <span>{language.settingsPage.back}</span>
        </button>
        <div class="w-full p-2 flex-1 min-h-0">
            <CharacterTrashList found={found} />
        </div>
    {:else}
    {#if trashEntry && found.trashedTotal > 0}
        <button class="flex p-2 gap-2 w-full items-center text-textcolor2 border-b border-b-darkborderc shrink-0" onclick={openTrash}>
            <TrashIcon size={20} />
            <span>{language.trash} ({found.trashedTotal})</span>
        </button>
    {/if}
    <CharacterWindow bind:this={listWindow} class="w-full flex-1 min-h-0" {rows} fallbackHeight={SIMPLE_ROW_FALLBACK_PX} heights={listHeights} resetToken={found.query} initialAnchor={listAnchor} {card} />
    {/if}
</div>

<!-- Hidden in the trash view: it would cover the actions of the last row. -->
{#if !trashOpen}
    <button class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc" onclick={() => {
        addCharacter()
    }}>
        <PlusIcon size={24} />
    </button>
{/if}
