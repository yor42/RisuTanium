<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import BarIcon from "../SideBars/BarIcon.svelte";
    import { addCharacter, changeChar, getCharImage } from "src/ts/characters";
    import { MobileSearch } from "src/ts/stores.svelte";
    import { MessageSquareIcon, PlusIcon } from "@lucide/svelte";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { coldStubChatCount } from "src/ts/process/coldCharacter";
    import { isHiddenSystemCharacter } from "src/ts/hiddenCharacters";
    import { language } from "src/lang";
    import { createCharacterSearch, type CharacterSearch } from "src/ts/gui/characterSearch.svelte";

    interface Props {
        endGrid?: () => void;
        search?: string;
        hideTrash?: boolean;
        // The search result of the screen that embeds this list. Without it the
        // list searches by `search`, else by the mobile header's search box.
        results?: CharacterSearch;
    }

    const agoFormatter = new Intl.RelativeTimeFormat(navigator.languages, { style: 'short' });

    let {endGrid = () => {}, search, hideTrash = false, results}: Props = $props();
    // Fixed for the component's life: the effect inside createCharacterSearch
    // can only be created during initialisation, and an embedding screen never
    // swaps its result. The result's properties are getters, so reading them in
    // the template follows later queries.
    // svelte-ignore state_referenced_locally
    const found = results ?? createCharacterSearch(() => search ?? $MobileSearch);
    // AV-2: indices of characters near this list's own scroll viewport,
    // mapped to their owning element (see GridCatalog.svelte's own comment
    // on `visibleIndices` for why a Map, not a Set: it makes releasing an
    // index on unmount safe regardless of mount/unmount order).
    let visibleIndices = new SvelteMap<number, Element>()

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
    const sorted = $derived(DBState.db.characters.map((c, i) => ({ c, i })).filter(({ c }) => {
        return !isHiddenSystemCharacter(c) && (!hideTrash || !c.trashTime);
    }).map(({ c, i }) => {
        return {
            name: c.name || language.settingsPage.unnamed,
            i: i,
            interaction: c.lastInteraction || 0,
        }
    }).sort((a, b) => {
        if (a.interaction === b.interaction) {
            return a.name.localeCompare(b.name);
        }
        return b.interaction - a.interaction;
    }));
</script>
<div class="flex flex-col items-center w-full overflow-y-auto h-full">
    {#each sorted as char, i (char.i)}
        {#if found.matched.has(char.i)}
            {@const c = DBState.db.characters[char.i]}
            <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
            {#if c}
                {@const imgPath = c.image}
                {@const isVisible = visibleIndices.has(char.i)}
                {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                {@const chats = coldStubChatCount(c)}
                {@const agoText = makeAgoText(char.interaction)}
                <button class="flex p-2 border-t-darkborderc gap-2 w-full" class:border-t={i !== 0} onclick={() => {
                    changeChar(char.i)
                    endGrid()
                }} use:nearViewport={{ onChange: (v, node) => {
                    if (v) { visibleIndices.set(char.i, node) } else if (visibleIndices.get(char.i) === node) { visibleIndices.delete(char.i) }
                } }}>
                    <BarIcon additionalStyle={avatarStyle}></BarIcon>
                    <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
                        <span>{char.name}</span>
                        <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
                            <span class="mr-1">{chats}</span>
                            <MessageSquareIcon size={14} />
                            <span class="mr-1 ml-1">|</span>
                            <span>{agoText}</span>
                        </div>
                    </div>
                </button>
            {/if}
        {/if}
    {/each}
</div>

<button class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc" onclick={() => {
    addCharacter()
}}>
    <PlusIcon size={24} />
</button>
