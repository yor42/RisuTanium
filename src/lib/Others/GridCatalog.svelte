<script lang="ts">
    import { changeChar, getCharImage, removeChar, removeTrashedCharacters, restoreCharacterFromTrash } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import BarIcon from "../SideBars/BarIcon.svelte";
    import { ArrowLeft, User, Users, SquareMousePointer, TrashIcon, Undo2Icon } from "@lucide/svelte";
    import { selectedCharID } from "../../ts/stores.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { language } from "src/lang";
    import { parseMultilangString } from "src/ts/util";
    import MobileCharacters from "../Mobile/MobileCharacters.svelte";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { createCharacterSearch } from "src/ts/gui/characterSearch.svelte";
    interface Props {
        endGrid?: any;
    }

    let { endGrid = () => {} }: Props = $props();
    let search = $state('')
    let selected = $state(3)
    // AV-2: indices near the grid/list/trash scroll viewport, mapped to the
    // element currently observing that index. Grid, list and trash share one
    // map because they render mutually exclusively (never more than one of
    // the three is in the DOM at once, per `selected`). Mapping to the owning
    // element (rather than a plain Set) is what makes releasing an index safe
    // regardless of mount/unmount order: `nearViewport`'s destroy calls
    // `onChange(false, node)` on every unmount (not just via the far band),
    // and a release only actually clears the index if `node` is still the
    // element that owns it -- so a grid-to-list tab switch that reuses the
    // same `char.index` for a different DOM element can never leave the new
    // element's index wrongly cleared by the old element's own unmount.
    let visibleIndices = new SvelteMap<number, Element>()

    // One search result feeds the header count, the open tab and the embedded
    // simple list. It follows the query after the typing debounce, so all three
    // always show the same matches.
    const found = createCharacterSearch(() => search)
</script>

<div class="h-full w-full flex justify-center">
    <div class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col overflow-y-auto">
        <div class="mx-4 mb-6 flex flex-col">
            <div class="flex items-center gap-3 mb-2">
                <button 
                    class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
                    onclick={() => endGrid()}
                    title={language.settingsPage.back}
                >
                    <ArrowLeft size={20} />
                </button>
                <div class="flex-1">
                    <TextInput placeholder={language.search} bind:value={search} size="lg" autocomplete="off" fullwidth={true}/>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
                <Button styled={selected === 3 ? 'primary' : 'outlined'} size="sm" onclick={() => {selected = 3}}>
                    {language.simple}
                </Button>
                <Button styled={selected === 0 ? 'primary' : 'outlined'} size="sm" onclick={() => {selected = 0}}>
                    {language.grid}
                </Button>
                <Button styled={selected === 1  ? 'primary' : 'outlined'} size="sm" onclick={() => {selected = 1}}>
                    {language.list}
                </Button>
                <Button styled={selected === 2  ? 'primary' : 'outlined'} size="sm" onclick={() => {selected = 2}}>
                    {language.trash}
                </Button>
                <div class="grow"></div>
                <span class="text-textcolor2 text-sm">
                    {selected === 2 ? found.trash.length : found.live.length} {language.character}
                </span>
            </div>
        </div>
        {#if selected === 0}
            <div class="w-full flex justify-center">
                <div class="flex flex-wrap gap-2 w-full justify-center">
                    {#each found.live as match (match.index)}
                        {@const char = DBState.db.characters[match.index]}
                        {#if char}
                            {@const imgPath = char.image}
                            {@const isVisible = visibleIndices.has(match.index)}
                            {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                            <div class="flex items-center text-textcolor" use:nearViewport={{ onChange: (v, node) => {
                                if (v) { visibleIndices.set(match.index, node) } else if (visibleIndices.get(match.index) === node) { visibleIndices.delete(match.index) }
                            } }}>
                                {#if char.image}
                                    <BarIcon onClick={() => {changeChar(match.index)}} additionalStyle={avatarStyle}></BarIcon>
                                {:else}
                                    <BarIcon onClick={() => {changeChar(match.index)}} additionalStyle={match.index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}>
                                        {#if char.type === 'group'}
                                            <Users />
                                        {:else}
                                            <User/>
                                        {/if}
                                    </BarIcon>
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
            </div>
        {:else if selected === 1}
            {#each found.live as match (match.index)}
                {@const char = DBState.db.characters[match.index]}
                <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
                {#if char}
                    {@const imgPath = char.image}
                    {@const isVisible = visibleIndices.has(match.index)}
                    {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                    {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
                    <div class="flex p-2 border border-darkborderc rounded-md mb-2" use:nearViewport={{ onChange: (v, node) => {
                        if (v) { visibleIndices.set(match.index, node) } else if (visibleIndices.get(match.index) === node) { visibleIndices.delete(match.index) }
                    } }}>
                        <BarIcon onClick={() => {changeChar(match.index)}} additionalStyle={avatarStyle}></BarIcon>
                        <div class="flex-1 flex flex-col ml-2 min-w-0">
                            <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                            <span class="text-textcolor2 line-clamp-3 wrap-break-word">{parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}</span>
                            <div class="flex gap-2 justify-end">
                                <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                    changeChar(match.index)
                                }}>
                                    <SquareMousePointer />
                                </button>
                                <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                    removeChar(char, char.name)
                                }}>
                                    <TrashIcon />
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}
            {/each}
        {:else if selected === 2}
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
                    <div class="flex p-2 border border-darkborderc rounded-md mb-2" use:nearViewport={{ onChange: (v, node) => {
                        if (v) { visibleIndices.set(match.index, node) } else if (visibleIndices.get(match.index) === node) { visibleIndices.delete(match.index) }
                    } }}>
                        <BarIcon onClick={() => {changeChar(match.index)}} additionalStyle={avatarStyle}></BarIcon>
                        <div class="flex-1 flex flex-col ml-2 min-w-0">
                            <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                            <span class="text-textcolor2 line-clamp-3 wrap-break-word">{parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}</span>
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
        {:else if selected === 3}
            <MobileCharacters endGrid={endGrid} search={search} hideTrash={true} results={found} />
        {/if}
    </div>
</div>
