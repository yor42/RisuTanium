<script lang="ts">
    import { removeChar, removeTrashedCharacters, restoreCharacterFromTrash } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import { TrashIcon, Undo2Icon } from "@lucide/svelte";
    import Button from "../UI/GUI/Button.svelte";
    import CharacterDescription from "./CharacterDescription.svelte";
    import CharacterWindow from "./CharacterWindow.svelte";
    import CharListAvatar from "./CharListAvatar.svelte";
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

    const rows = $derived(listRows(found.trash.map((match) => String(match.index))));
</script>
{#snippet card(cardKey: string)}
    {@const char = DBState.db.characters[Number(cardKey)]}
    {#if char}
        {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
        <!-- A trashed row does not open: its avatar is only a picture, and the row keeps restore and delete. -->
        <div class="flex p-2 border border-darkborderc rounded-md">
            <CharListAvatar src={char.image} />
            <div class="flex-1 flex flex-col ml-2 min-w-0">
                <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                <CharacterDescription text={parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription} visible={true} />
                <div class="flex gap-2 justify-end">
                    <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                        restoreCharacterFromTrash(char)
                    }}>
                        <Undo2Icon />
                    </button>
                    <button class="hover:text-textcolor text-textcolor2" onclick={() => {
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
    <CharacterWindow class="flex-1 min-h-0" {rows} fallbackHeight={LIST_ROW_FALLBACK_PX} resetToken={found.query} rowClass="pb-2" {card} />
</div>
