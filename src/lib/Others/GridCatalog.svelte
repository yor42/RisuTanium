<script lang="ts">
    import { tick, untrack } from "svelte";
    import { changeChar, removeChar } from "../../ts/characters";
    import { DBState } from 'src/ts/stores.svelte';
    import { ArrowLeft, User, Users, TrashIcon, FolderIcon, FolderOpenIcon } from "@lucide/svelte";
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
    import { GRID_ROW_FALLBACK_PX, LIST_ROW_FALLBACK_PX, gridRows, listRows } from "./charListRows";
    import { buildGridEntries, folderTileClass } from "./charListOrder";
    import { loadOpenFolders, saveOpenFolders } from "../SideBars/railMemory";
    import { clickedButton, clickedLink, selectedInside } from "src/ts/gui/descriptionMarkdown";
    import { SvelteSet } from "svelte/reactivity";
    import { createCharacterSearch } from "src/ts/gui/characterSearch.svelte";
    interface Props {
        endGrid?: any;
    }

    let { endGrid = () => {} }: Props = $props();
    let search = $state('')
    let selected = $state(3)
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

    // A card is keyed by its character (`slotKeys`), never by its position, so a removal elsewhere keeps
    // focus, scroll anchor and measured heights on the same character. The map resolves a key to the
    // slot it is at now, in the same derivation as the key list.
    const indexByKey = $derived(new Map(found.live.map((match) => [match.key, match.index])))
    const listRowsNow = $derived(listRows(found.live.map((match) => match.key)))

    // Open folders are shared with the rail and remembered on this device (railMemory), never in the
    // database. The save prunes against every folder id in the order, so a folder with no visible
    // member keeps its state. Only the array reference is read untracked: the loop reads the entries,
    // so the save also re-runs on an in-place edit of the order and rewrites the same set.
    const folderIdsInOrder = (): Set<string> => {
        const ids = new Set<string>()
        for (const entry of untrack(() => DBState.db.characterOrder) ?? []) {
            if (typeof entry === 'object' && entry !== null && typeof entry.id === 'string') {
                ids.add(entry.id)
            }
        }
        return ids
    }
    let openFolders: string[] = $state(loadOpenFolders(folderIdsInOrder()))
    $effect(() => {
        const ids = [...openFolders]
        saveOpenFolders(ids, folderIdsInOrder())
    })
    const openFolderIds = $derived(new Set(openFolders))

    // The Grid tab's tiles, built once per change: the live characters in the saved order with their
    // folders. Reading only; the order is the rail's and is never written or repaired from here.
    const entries = $derived(buildGridEntries({
        live: found.live,
        order: DBState.db.characterOrder,
        openFolderIds,
        sort: 'order',
        searching: found.searching,
    }))
    const entryByKey = $derived(new Map(entries.map((entry) => [entry.key, entry])))
    const gridKeys = $derived(entries.map((entry) => entry.key))
    // The Grid tab builds its rows from the column count its container reports.
    const gridRowsFor = (columns: number) => gridRows(gridKeys, columns)

    // Picking an entry opens the character and leaves the screen, as the
    // simple list does.
    function pick(index: number) {
        changeChar(index)
        endGrid()
    }

    // A toggle re-chunks the rows, which can re-create the tile that holds focus. The focused tile is
    // named before the change; if focus was lost by the change, it goes back to that tile.
    async function toggleFolder(id: string) {
        const held = document.activeElement?.closest('[data-charlist-key]') ?? null
        const heldKey = held?.getAttribute('data-charlist-key') ?? null
        const list = held?.closest('[role="list"]') ?? null
        const at = openFolders.indexOf(id)
        if (at === -1) {
            openFolders.push(id)
        } else {
            openFolders.splice(at, 1)
        }
        if (heldKey === null || list === null) {
            return
        }
        await tick()
        const active = document.activeElement
        if (active && active !== document.body && active.isConnected) {
            return
        }
        const card = Array.from(list.querySelectorAll('[data-charlist-key]')).find((el) => el.getAttribute('data-charlist-key') === heldKey)
        card?.querySelector('button')?.focus()
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
    {@const index = indexByKey.get(cardKey) ?? -1}
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

{#snippet gridCard(cardKey: string)}
    {@const entry = entryByKey.get(cardKey)}
    {#if entry?.kind === 'folder'}
        <!-- The tile is a native button; its picture is decorative and the folder's name is the button's. -->
        <div class="flex items-center text-textcolor">
            <button
                class="relative overflow-hidden shrink-0 flex justify-center items-center rounded-md h-14 w-14 min-h-14 shadow-lg border border-selected cursor-pointer hover:border-textcolor2 transition-colors duration-150 {folderTileClass(entry.color)}"
                aria-expanded={entry.open}
                aria-label={entry.name || language.sidebarUi.defaultFolderName}
                onclick={() => { void toggleFolder(entry.id) }}
            >
                {#if entry.imgFile}
                    <CharListAvatar src={entry.imgFile} class="absolute inset-0" />
                {:else if DBState.db.showFolderName}
                    <span class="truncate font-bold text-sm px-1">{entry.name}</span>
                {:else if entry.open}
                    <FolderOpenIcon />
                {:else}
                    <FolderIcon />
                {/if}
            </button>
        </div>
    {:else if entry}
        {@const index = entry.index}
        {@const char = DBState.db.characters[index]}
        <!-- A search result names the folder of each member. -->
        {@const badge = found.searching && entry.folderName !== undefined ? (entry.folderName || language.sidebarUi.defaultFolderName) : undefined}
        <!-- Defence in depth: a position past the end of a shrinking list draws no tile instead of throwing. -->
        {#if char}
            <div class="flex items-center text-textcolor" class:relative={badge !== undefined}>
                <CharListAvatar
                    src={char.image}
                    fallbackStyle={char.image ? '' : index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}
                    label={char.name || language.settingsPage.unnamed}
                    onclick={() => pick(index)}
                >
                    {#if !char.image}
                        {#if char.type === 'group'}
                            <Users />
                        {:else}
                            <User/>
                        {/if}
                    {/if}
                </CharListAvatar>
                {#if badge !== undefined}
                    <span class="absolute bottom-0 inset-x-0 flex items-center gap-0.5 px-0.5 rounded-b-md bg-darkbg/80 text-textcolor2 text-[10px] leading-tight pointer-events-none">
                        <FolderIcon size={10} class="shrink-0" />
                        <span class="truncate">{badge}</span>
                    </span>
                {/if}
            </div>
        {/if}
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
            <CharacterWindow class="flex-1 min-h-0" layout="grid" rows={gridRowsFor} fallbackHeight={GRID_ROW_FALLBACK_PX} resetToken={found.query} rowClass="flex justify-center supports-[justify-content:safe_center]:[justify-content:safe_center] gap-2 pb-2" card={gridCard} />
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
