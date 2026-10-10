<script lang="ts">
    import { changeChar, removeChar } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import { ArrowLeft, User, Users, TrashIcon } from "@lucide/svelte";
    import { selectedCharID } from "../../ts/stores.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { language } from "src/lang";
    import { parseMultilangString } from "src/ts/util";
    import MobileCharacters from "../Mobile/MobileCharacters.svelte";
    import CharacterTrashList from "./CharacterTrashList.svelte";
    import CharacterDescription from "./CharacterDescription.svelte";
    import CharacterWindow from "./CharacterWindow.svelte";
    import CharListAvatar from "./CharListAvatar.svelte";
    import { LIST_ROW_FALLBACK_PX, listRows } from "./charListRows";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { clickedButton, clickedLink, selectedInside } from "src/ts/gui/descriptionMarkdown";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { createCharacterSearch } from "src/ts/gui/characterSearch.svelte";
    interface Props {
        endGrid?: any;
    }

    let { endGrid = () => {} }: Props = $props();
    let search = $state('')
    let selected = $state(3)
    // AV-2: indices near the Grid tab's scroll viewport, mapped to the element
    // currently observing that index. Only the grid tiles use it (the other tabs
    // mount just the rows near their viewport). Mapping to the owning element
    // (rather than a plain Set) is what makes releasing an index safe
    // regardless of mount/unmount order: `nearViewport`'s destroy calls
    // `onChange(false, node)` on every unmount (not just via the far band),
    // and a release only actually clears the index if `node` is still the
    // element that owns it.
    let visibleIndices = new SvelteMap<number, Element>()

    // List tab, per row and keyed by the character's chaId (stable when a removal shifts indices): whether the
    // description is expanded, and whether its clamp currently cuts text off.
    // The toggle shows while either holds, so an expanded row keeps its "Show
    // less" even though an unclamped block no longer overflows.
    const expanded = new SvelteSet<string>()
    const overflowing = new SvelteSet<string>()

    // One search result feeds the header count, the open tab and the embedded
    // simple list. It follows the query after the typing debounce, so all three
    // always show the same matches.
    const found = createCharacterSearch(() => search)

    const listRowsNow = $derived(listRows(found.live.map((match) => String(match.index))))

    // Picking an entry opens the character and leaves the screen, as the
    // simple list does.
    function pick(index: number) {
        changeChar(index)
        endGrid()
    }

    function toggleExpanded(id: string) {
        if (expanded.has(id)) {
            expanded.delete(id)
        } else {
            expanded.add(id)
        }
    }

    function reportClamp(id: string, clamped: boolean) {
        // An expanded block is not clamped, so its measurement says nothing.
        if (expanded.has(id)) {
            return
        }
        if (clamped) {
            overflowing.add(id)
        } else {
            overflowing.delete(id)
        }
    }
</script>

{#snippet listCard(cardKey: string)}
    {@const index = Number(cardKey)}
    {@const char = DBState.db.characters[index]}
    <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
    {#if char}
        {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
        <!-- The whole row opens the character. Keyboard users reach it through the name button, whose click bubbles here; the row's other buttons stop their clicks, and a click on a link inside the description is left to the link. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="flex p-2 border border-darkborderc rounded-md cursor-pointer" onclick={(event) => {
            if (clickedLink(event) || (!clickedButton(event) && selectedInside(event.currentTarget, window.getSelection()))) { return }
            pick(index)
        }}>
            <CharListAvatar src={char.image} />
            <div class="flex-1 flex flex-col ml-2 min-w-0">
                <h4 class="text-textcolor font-bold text-lg mb-1 break-words"><button class="text-start font-bold cursor-pointer">{char.name || language.settingsPage.unnamed}</button></h4>
                <CharacterDescription
                    text={parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}
                    visible={true}
                    clamped={!expanded.has(char.chaId)}
                    onClampChange={(clamped) => reportClamp(char.chaId, clamped)}
                />
                <div class="flex gap-2 items-center">
                    {#if expanded.has(char.chaId) || overflowing.has(char.chaId)}
                        <button class="text-sm hover:text-textcolor text-textcolor2" aria-expanded={expanded.has(char.chaId)} onclick={(event) => {
                            event.stopPropagation()
                            toggleExpanded(char.chaId)
                        }}>
                            {expanded.has(char.chaId) ? language.othersUi.showLess : language.othersUi.showMore}
                        </button>
                    {/if}
                    <div class="grow"></div>
                    <button class="hover:text-textcolor text-textcolor2" onclick={(event) => {
                        event.stopPropagation()
                        removeChar(char, char.name)
                    }}>
                        <TrashIcon />
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/snippet}

<div class="h-full w-full flex justify-center">
    <div class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col">
        <div class="mx-4 mb-6 flex flex-col shrink-0">
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
        <!-- The header above stays on screen; each tab below is the only scroller of its content. -->
        {#if selected === 0}
            <div class="flex-1 min-h-0 overflow-y-auto">
                <div class="w-full flex justify-center">
                    <div class="flex flex-wrap gap-2 w-full justify-center">
                        {#each found.live as match (match.index)}
                            {@const char = DBState.db.characters[match.index]}
                            {#if char}
                                {@const isVisible = visibleIndices.has(match.index)}
                                <div class="flex items-center text-textcolor" use:nearViewport={{ onChange: (v, node) => {
                                    if (v) { visibleIndices.set(match.index, node) } else if (visibleIndices.get(match.index) === node) { visibleIndices.delete(match.index) }
                                } }}>
                                    <CharListAvatar
                                        src={isVisible ? char.image : ''}
                                        fallbackStyle={char.image ? '' : match.index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}
                                        label={char.name || language.settingsPage.unnamed}
                                        onclick={() => pick(match.index)}
                                    >
                                        {#if !char.image}
                                            {#if char.type === 'group'}
                                                <Users />
                                            {:else}
                                                <User/>
                                            {/if}
                                        {/if}
                                    </CharListAvatar>
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            </div>
        {:else if selected === 1}
            <CharacterWindow class="flex-1 min-h-0" rows={listRowsNow} fallbackHeight={LIST_ROW_FALLBACK_PX} resetToken={found.query} rowClass="pb-2" card={listCard} />
        {:else if selected === 2}
            <div class="flex-1 min-h-0 flex flex-col">
                <CharacterTrashList found={found} />
            </div>
        {:else if selected === 3}
            <div class="flex-1 min-h-0 flex flex-col">
                <MobileCharacters endGrid={endGrid} hideTrash={true} results={found} />
            </div>
        {/if}
    </div>
</div>
