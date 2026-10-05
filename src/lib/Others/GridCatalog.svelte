<script lang="ts">
    import { changeChar, getCharImage, removeChar, removeTrashedCharacters, restoreCharacterFromTrash } from "../../ts/characters";
    import { type Database } from "../../ts/storage/database.svelte";
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
    import { isHiddenSystemCharacter } from "src/ts/hiddenCharacters";
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

    function formatChars(search:string, db:Database, trash = false){
        let charas:{
            image:string
            index:number
            type:string,
            name:string
            desc:string
            chaId:string
            charRef: Database['characters'][number]
        }[] = []

        for(let i=0;i<db.characters.length;i++){
            const c = db.characters[i]
            if(isHiddenSystemCharacter(c)){
                continue
            }
            if(c.trashTime && !trash){
                continue
            }
            if(!c.trashTime && trash){
                continue
            }
            if(c.name.replace(/ /g,"").toLocaleLowerCase().includes(search.toLocaleLowerCase().replace(/ /g,""))){
                charas.push({
                    image: c.image,
                    index: i,
                    type: c.type,
                    name: c.name,
                    desc: c.creatorNotes ?? '',
                    chaId: c.chaId,
                    charRef: c
                })
            }
        }
        return charas
    }
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
                    {formatChars(search, DBState.db).length} {language.character}
                </span>
            </div>
        </div>
        {#if selected === 0}
            <div class="w-full flex justify-center">
                <div class="flex flex-wrap gap-2 w-full justify-center">
                    {#each formatChars(search, DBState.db) as char (char.index)}
                        {@const imgPath = char.image}
                        {@const isVisible = visibleIndices.has(char.index)}
                        {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                        <div class="flex items-center text-textcolor" use:nearViewport={{ onChange: (v, node) => {
                            if (v) { visibleIndices.set(char.index, node) } else if (visibleIndices.get(char.index) === node) { visibleIndices.delete(char.index) }
                        } }}>
                            {#if char.image}
                                <BarIcon onClick={() => {changeChar(char.index)}} additionalStyle={avatarStyle}></BarIcon>
                            {:else}
                                <BarIcon onClick={() => {changeChar(char.index)}} additionalStyle={char.index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}>
                                    {#if char.type === 'group'}
                                        <Users />
                                    {:else}
                                        <User/>
                                    {/if}
                                </BarIcon>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {:else if selected === 1}
            {#each formatChars(search, DBState.db) as char (char.index)}
                {@const imgPath = char.image}
                {@const isVisible = visibleIndices.has(char.index)}
                {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                {@const parsedDesc = parseMultilangString(char.desc)}
                <div class="flex p-2 border border-darkborderc rounded-md mb-2" use:nearViewport={{ onChange: (v, node) => {
                    if (v) { visibleIndices.set(char.index, node) } else if (visibleIndices.get(char.index) === node) { visibleIndices.delete(char.index) }
                } }}>
                    <BarIcon onClick={() => {changeChar(char.index)}} additionalStyle={avatarStyle}></BarIcon>
                    <div class="flex-1 flex flex-col ml-2 min-w-0">
                        <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                        <span class="text-textcolor2 line-clamp-3 wrap-break-word">{parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}</span>
                        <div class="flex gap-2 justify-end">
                            <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                changeChar(char.index)
                            }}>
                                <SquareMousePointer />
                            </button>
                            <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                removeChar(char.charRef, char.name)
                            }}>
                                <TrashIcon />
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        {:else if selected === 2}
            {@const trashList = formatChars(search, DBState.db, true)}
            {@const searching = search.replace(/ /g,"") !== ''}
            <div class="flex items-start gap-2 mb-2">
                <span class="text-textcolor2 text-sm grow">{language.trashDesc}</span>
                {#if trashList.length > 0}
                    <Button styled="danger" size="sm" className="shrink-0" onclick={() => {
                        removeTrashedCharacters(trashList.map((c) => c.charRef), { matching: searching })
                    }}>
                        {searching ? language.emptyTrashMatching(trashList.length) : language.emptyTrash}
                    </Button>
                {/if}
            </div>
            {#each trashList as char (char.index)}
                {@const imgPath = char.image}
                {@const isVisible = visibleIndices.has(char.index)}
                {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                {@const parsedDesc = parseMultilangString(char.desc)}
                <div class="flex p-2 border border-darkborderc rounded-md mb-2" use:nearViewport={{ onChange: (v, node) => {
                    if (v) { visibleIndices.set(char.index, node) } else if (visibleIndices.get(char.index) === node) { visibleIndices.delete(char.index) }
                } }}>
                    <BarIcon onClick={() => {changeChar(char.index)}} additionalStyle={avatarStyle}></BarIcon>
                    <div class="flex-1 flex flex-col ml-2 min-w-0">
                        <h4 class="text-textcolor font-bold text-lg mb-1 break-words">{char.name || language.settingsPage.unnamed}</h4>
                        <span class="text-textcolor2 line-clamp-3 wrap-break-word">{parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}</span>
                        <div class="flex gap-2 justify-end">
                            <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                restoreCharacterFromTrash(char.charRef)
                            }}>
                                <Undo2Icon />
                            </button>
                            <button class="hover:text-textcolor text-textcolor2" onclick={() => {
                                removeChar(char.charRef, char.name, 'permanent')
                            }}>
                                <TrashIcon />
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        {:else if selected === 3}
            <MobileCharacters endGrid={endGrid} search={search} hideTrash={true} />
        {/if}
    </div>
</div>
