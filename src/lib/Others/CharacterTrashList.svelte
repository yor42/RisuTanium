<script lang="ts">
    import { removeChar, removeTrashedCharacters, restoreCharacterFromTrash } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import { TrashIcon, Undo2Icon } from "@lucide/svelte";
    import Button from "../UI/GUI/Button.svelte";
    import CharacterDescription from "./CharacterDescription.svelte";
    import CharacterWindow from "./CharacterWindow.svelte";
    import CharListAvatar from "./CharListAvatar.svelte";
    import CharacterNameRow from "./CharacterNameRow.svelte";
    import { trashDaysLeft } from "./trashDays";
    import { LIST_ROW_FALLBACK_PX, listRows } from "./charListRows";
    import { language } from "src/lang";
    import { parseMultilangString } from "src/ts/util";
    import type { CharacterSearch } from "src/ts/gui/characterSearch.svelte";

    interface Props {
        // The search result whose trash list is shown. Read lazily, so a later
        // query or a restore updates the rows.
        found: CharacterSearch;
    }

    let { found }: Props = $props();

    // A row is keyed by its character, never by its position; the map resolves a key to the slot it is at now.
    const indexByKey = $derived(new Map(found.trash.map((match) => [match.key, match.index])));
    const rows = $derived(listRows(found.trash.map((match) => match.key)));
</script>
{#snippet card(cardKey: string, position: number, visible: () => boolean)}
    {@const char = DBState.db.characters[indexByKey.get(cardKey) ?? -1]}
    {#if char}
        {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
        {@const daysLeft = trashDaysLeft(char.trashTime ?? 0, Date.now())}
        <!-- A trashed row does not open: its avatar is only a picture, and the row keeps restore and delete. -->
        <div class="flex p-2 border border-darkborderc rounded-md">
            <CharListAvatar src={char.image} {visible} />
            <div class="flex-1 flex flex-col ml-2 min-w-0">
                <h4 class="text-textcolor font-bold text-lg mb-1 break-words"><CharacterNameRow chaId={char.chaId} name={char.name || language.settingsPage.unnamed} /></h4>
                <CharacterDescription text={parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription} visible={true} />
                <div class="flex flex-wrap gap-2 justify-end">
                    <span class="text-sm text-textcolor2 mr-auto whitespace-nowrap" data-part="trash-days-left">{language.trashDaysLeft(daysLeft)}</span>
                    <button class="hover:text-textcolor text-textcolor2 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-selected" aria-label={language.trashRestore} title={language.trashRestore} onclick={() => {
                        restoreCharacterFromTrash(char)
                    }}>
                        <Undo2Icon />
                    </button>
                    <button class="hover:text-draculared text-textcolor2 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-selected" aria-label={language.trashDeletePermanently} title={language.trashDeletePermanently} onclick={() => {
                        removeChar(char, char.name, 'permanent')
                    }}>
                        <TrashIcon />
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/snippet}
<!-- The header stays on screen; only the rows scroll. The embedding screen gives this list a height. -->
<div class="flex flex-col h-full min-h-0 w-full">
    <div class="flex items-start gap-2 mb-2 shrink-0">
        <span class="text-textcolor2 text-sm grow">{language.trashDesc}</span>
        {#if found.trash.length > 0}
            <Button styled="danger" size="sm" className="shrink-0" onclick={() => {
                removeTrashedCharacters(found.trash.map((m) => DBState.db.characters[m.index]), { matching: found.searching })
            }}>
                {found.searching ? language.emptyTrashMatching(found.trash.length) : language.emptyTrash}
            </Button>
        {/if}
    </div>
    {#if found.trashedTotal === 0}
        <!-- Nothing is trashed at all, whatever the query. The line sits in the tab's one scroller, as the rows do. -->
        <div class="flex-1 min-h-0 overflow-y-auto"><p class="text-textcolor2 text-sm text-center mt-4" data-part="trash-empty">{language.trashEmpty}</p></div>
    {:else if found.trash.length === 0}
        <!-- Trashed characters exist and the landed query hides every one of them. -->
        <div class="flex-1 min-h-0 overflow-y-auto"><p class="text-textcolor2 text-sm text-center mt-4" data-part="library-no-match">{language.libraryNoMatch}</p></div>
    {:else}
        <CharacterWindow class="flex-1 min-h-0" {rows} fallbackHeight={LIST_ROW_FALLBACK_PX} resetToken={found.query} rowClass="pb-2" {card} />
    {/if}
</div>
