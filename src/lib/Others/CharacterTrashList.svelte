<script lang="ts">
    import { getCharImage, removeChar, removeTrashedCharacters, restoreCharacterFromTrash } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import { TrashIcon, Undo2Icon } from "@lucide/svelte";
    import Button from "../UI/GUI/Button.svelte";
    import CharacterDescription from "./CharacterDescription.svelte";
    import { language } from "src/lang";
    import { parseMultilangString } from "src/ts/util";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { warnOnReject } from "src/ts/warnOnReject";
    import type { Snippet } from "svelte";
    import type { SvelteMap } from "svelte/reactivity";
    import type { CharacterSearch } from "src/ts/gui/characterSearch.svelte";

    interface Props {
        // The search result whose trash list is shown. Read lazily, so a later
        // query or a restore updates the rows.
        found: CharacterSearch;
        // Owned by the embedding screen, which also uses it for its other
        // layouts: the rows only add and release their own index in it (see
        // GridCatalog.svelte for why it maps to the owning element).
        visibleIndices: SvelteMap<number, Element>;
    }

    let { found, visibleIndices }: Props = $props();
</script>
<!-- An avatar style may still be loading or may have failed to load: either way the avatar shows without it. -->
{#snippet styled(style: string | Promise<string>, body: Snippet<[string]>)}
    {#await warnOnReject('CharacterTrashList: avatar style rejected', style)}
        {@render body('')}
    {:then resolved}
        {@render body(resolved)}
    {:catch}
        {@render body('')}
    {/await}
{/snippet}
<div class="flex items-start gap-2 mb-2">
    <span class="text-textcolor2 text-sm grow">{language.trashDesc}</span>
    {#if found.trash.length > 0}
        <Button styled="danger" size="sm" className="shrink-0" onclick={() => {
            removeTrashedCharacters(found.trash.map((m) => DBState.db.characters[m.index]), { matching: found.searching })
        }}>
            {found.searching ? language.emptyTrashMatching(found.trash.length) : language.emptyTrash}
        </Button>
    {/if}
</div>
{#each found.trash as match (match.index)}
    {@const char = DBState.db.characters[match.index]}
    {#if char}
        {@const imgPath = char.image}
        {@const isVisible = visibleIndices.has(match.index)}
        {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
        {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
        <!-- A trashed row does not open: its avatar is only a picture, and the row keeps restore and delete. -->
        {#snippet face(avatar: string)}
            <div class="ico shrink-0 rounded-md h-14 w-14 min-h-14 shadow-lg bg-[#6b7280]" aria-hidden="true" style={avatar || null}></div>
        {/snippet}
        <div class="flex p-2 border border-darkborderc rounded-md mb-2" use:nearViewport={{ onChange: (v, node) => {
            if (v) { visibleIndices.set(match.index, node) } else if (visibleIndices.get(match.index) === node) { visibleIndices.delete(match.index) }
        } }}>
            {@render styled(avatarStyle, face)}
            <div class="flex-1 flex flex-col ml-2 min-w-0">
                <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                <CharacterDescription text={parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription} visible={isVisible} />
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
{/each}
