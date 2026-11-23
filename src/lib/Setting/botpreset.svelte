<script lang="ts">
    import { alertCardExport, alertConfirm, alertError } from "../../ts/alert";
    import { language } from "../../lang";
    import { changeToPreset, copyPreset, downloadPreset, importPreset } from "../../ts/storage/database.svelte";
    import { DBState, openPresetList } from 'src/ts/stores.svelte';
    import { get } from "svelte/store";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
    import { CopyIcon, Share2Icon, PencilIcon, HardDriveUploadIcon, PlusIcon, TrashIcon, XIcon, GitCompare, ListChecksIcon, CheckIcon } from "@lucide/svelte";
    import { fillLang } from "src/lang/fill";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import { prebuiltPresets } from "src/ts/process/templates/templates";
    import { freshPresetMeta, slotBadgeFor } from "src/ts/storage/presetMeta";
    import { openRealmUpload } from "src/ts/characterCards";
    import PromptDiffModal from "../Others/PromptDiffModal.svelte";
    import { RISU_PRESET_DRAG_TYPE } from "src/ts/dragTypes";
    import WindowedSegment from "../UI/Windowed/WindowedSegment.svelte";
    import { createWindowHost } from "src/ts/windowing/windowHost.svelte";
    import { onDestroy } from "svelte";

    // Only the rows near the view are mounted. A row key is its position, and the drag handlers
    // address data by the snippet index, so unmounted rows never matter to a reorder.
    let listRoot = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listRoot })
    onDestroy(() => windowHost.dispose())
    const PRESET_ROW_FALLBACK_PX = 44
    const rowKeys = $derived(DBState.db.botPresets.map((_, i) => String(i)))

    let editMode = $state(false)
    // Select mode ticks presets for a bundle export. The selection holds preset ids, so it survives a reorder or a removal.
    let selectMode = $state(false)
    let selectedIds = $state<string[]>([])
    let exporting = $state(false)
    const selectedCount = $derived(DBState.db.botPresets.filter((p) => typeof p.id === 'string' && selectedIds.includes(p.id)).length)
    const allSelected = $derived(DBState.db.botPresets.length > 0 && selectedCount === DBState.db.botPresets.length)

    function toggleSelected(id: string | undefined) {
        if (typeof id !== 'string') return
        selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    }

    function toggleAll() {
        selectedIds = allSelected ? [] : DBState.db.botPresets.flatMap((p) => typeof p.id === 'string' ? [p.id] : [])
    }

    function setSelectMode(on: boolean) {
        selectMode = on
        selectedIds = []
        if (on) editMode = false
    }

    async function exportSelected() {
        if (selectedCount === 0 || exporting) return
        exporting = true
        try {
            // Loaded on use so the list does not pull the bundle codec in when no bundle is exported.
            const { downloadPresetBundle } = await import("src/ts/storage/presetBundleFlow")
            await downloadPresetBundle([...selectedIds])
        } finally {
            exporting = false
        }
        setSelectMode(false)
    }
    let isDragging = $state(false)
    let dragOverIndex = $state(-1)

    interface Props {
        close?: any;
    }

    let { close = () => {} }: Props = $props();

    // Back does what the header X does. The diff modal registers its own handler when it opens, so
    // it is newer and answers first. The effect reads no reactive state.
    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => get(openPresetList),
        snapshot: () => get(openPresetList),
        close: () => close(),
    })))

    let showDiffModal = $state(false)
    let selectedDiffPreset = $state<number | null>(null)
    let firstPresetId = $state<number | null>(null);
    let secondPresetId = $state<number | null>(null);

    function movePreset(fromIndex: number, toIndex: number) {
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= DBState.db.botPresets.length || toIndex > DBState.db.botPresets.length) return;

        let botPresets = [...DBState.db.botPresets];
        const movedItem = botPresets.splice(fromIndex, 1)[0];
        if (!movedItem) return;

        const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        botPresets.splice(adjustedToIndex, 0, movedItem);

        const currentId = DBState.db.botPresetsId;
        if (currentId === fromIndex) {
            DBState.db.botPresetsId = adjustedToIndex;
        } else if (fromIndex < currentId && adjustedToIndex >= currentId) {
            DBState.db.botPresetsId = currentId - 1;
        } else if (fromIndex > currentId && adjustedToIndex <= currentId) {
            DBState.db.botPresetsId = currentId + 1;
        }

        DBState.db.botPresets = botPresets;
    }

    function isPresetDrag(e: DragEvent) {
        return e.dataTransfer?.types.includes(RISU_PRESET_DRAG_TYPE) ?? false;
    }

    function markPresetDrag(e: DragEvent, index: number) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'preset');
        e.dataTransfer.setData(RISU_PRESET_DRAG_TYPE, index.toString());
    }

    function handlePresetDrop(targetIndex: number, e: DragEvent) {
        if (!isPresetDrag(e)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const sourceIndex = parseInt(e.dataTransfer?.getData(RISU_PRESET_DRAG_TYPE) || '0');
        movePreset(sourceIndex, targetIndex);
    }


    async function handleDiffMode(id: number) {
        if (selectedDiffPreset === id) {
            selectedDiffPreset = null
            firstPresetId = null
            secondPresetId = null
            return
        }
        
        selectedDiffPreset = id

        if (firstPresetId === null) {
            firstPresetId = id
            secondPresetId = null
            return
        }

        secondPresetId = id
        selectedDiffPreset = null
        showDiffModal = true
    }

    function closeDiff() {
        showDiffModal = false;
        firstPresetId = null;
        secondPresetId = null;
        selectedDiffPreset = null;
    }

</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
    <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-124 max-h-full overflow-y-auto" bind:this={listRoot}>
        <div class="flex items-center text-textcolor mb-4">
            <h2 class="mt-0 mb-0">{language.presets}</h2>
            <div class="grow flex justify-end">
                <button aria-label={language.uiCommon.close} class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer items-center" onclick={close}>
                    <XIcon size={24} aria-hidden="true"/>
                </button>
            </div>
        </div>
        <WindowedSegment host={windowHost} tag="ul" keys={rowKeys} height={{ fallback: PRESET_ROW_FALLBACK_PX }} pinned={isDragging ? rowKeys : []} class="list-none p-0 m-0">
        {#snippet item(key, i)}
            {@const preset = DBState.db.botPresets[i]}
            <div class="w-full transition-all duration-200"
                class:h-0.5={!isDragging || dragOverIndex !== i}
                class:h-1={isDragging && dragOverIndex === i}
                class:bg-selected={isDragging && dragOverIndex === i}
                class:ring-1={isDragging && dragOverIndex === i}
                class:ring-borderc={isDragging && dragOverIndex === i}
                class:shadow-lg={isDragging && dragOverIndex === i}
                class:hover:bg-selected={!isDragging}
                role="listitem"
                ondragover={(e) => {
                    if (!isPresetDrag(e)) {
                        return
                    }
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                    dragOverIndex = i
                }}
                ondragleave={(e) => {
                    dragOverIndex = -1
                }}
                ondrop={(e) => {
                    handlePresetDrop(i, e)
                    dragOverIndex = -1
                }}>
            </div>
            
            <button onclick={() => {
                if(selectMode){
                    toggleSelected(preset.id)
                } else if(!editMode){
                    changeToPreset(i)
                    close()
                }
            }}
            class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer"
            class:min-h-11={selectMode}
            class:bg-selected={i === DBState.db.botPresetsId && !selectMode}
            class:draggable-preset={!editMode && !selectMode}
            draggable={!editMode && !selectMode ? "true" : "false"}
            aria-pressed={selectMode ? (typeof preset.id === 'string' && selectedIds.includes(preset.id)) : undefined}
            ondragstart={(e) => {
                if (editMode || selectMode) {
                    e.preventDefault()
                    return
                }
                isDragging = true
                markPresetDrag(e, i)

                const dragElement = document.createElement('div')
                dragElement.textContent = preset?.name || language.unnamedPreset
                dragElement.className = 'absolute -top-96 -left-96 px-4 py-2 bg-darkbg text-textcolor2 rounded-sm text-sm whitespace-nowrap shadow-lg pointer-events-none z-50'
                document.body.appendChild(dragElement)
                e.dataTransfer?.setDragImage(dragElement, 10, 10)

                setTimeout(() => {
                    document.body.removeChild(dragElement)
                }, 0)
            }}
            ondragend={(e) => {
                isDragging = false
                dragOverIndex = -1
            }}
            ondragover={(e) => {
                if (!isPresetDrag(e)) {
                    return
                }
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                const rect = e.currentTarget.getBoundingClientRect()
                const mouseY = e.clientY
                const elementCenter = rect.top + rect.height / 2

                if (mouseY < elementCenter) {
                    dragOverIndex = i
                } else {
                    dragOverIndex = i + 1
                }
            }}
            ondrop={(e) => {
                handlePresetDrop(dragOverIndex, e)
                dragOverIndex = -1
            }}>
                {#if editMode}
                    <TextInput label={language.name} bind:value={DBState.db.botPresets[i].name} placeholder={language.name} padding={false}/>
                {:else}
                    {#if selectMode}
                        <span class="w-5 h-5 mr-2 shrink-0 flex items-center justify-center rounded-sm border border-solid {typeof preset.id === 'string' && selectedIds.includes(preset.id) ? 'bg-selected border-borderc text-textcolor' : 'border-darkborderc text-transparent'}" data-select-mark>
                            <CheckIcon size={14} aria-hidden="true"/>
                        </span>
                    {:else if slotBadgeFor(DBState.db.botPresets, i) !== undefined}
                        <span class="w-2 text-center mr-2 text-textcolor2">{slotBadgeFor(DBState.db.botPresets, i)}</span>
                    {/if}
                    {#if preset.image}
                        <img src={preset.image} alt={language.settingsPage.iconAlt} class="mr-2 min-w-6 min-h-6 w-6 h-6 rounded-md" decoding="async"/>

                    {/if}
                    <span>{preset.name}</span>
                {/if}
                <div class="grow flex justify-end">
                    {#if !selectMode}
                    {#if DBState.db.showPromptComparison}
                        <div class="{selectedDiffPreset === i ? 'text-textcolor bg-selected ring-1 ring-borderc rounded-sm' : 'text-textcolor2 hover:text-textcolor'} cursor-pointer mr-2" role="button" tabindex="0" aria-label={language.comparePreset} aria-pressed={selectedDiffPreset === i} onclick={(e) => {
                            e.stopPropagation()
                            handleDiffMode(i)
                        }} onkeydown={(e) => {
                            if(e.target !== e.currentTarget) return
                            if((e.key === 'Enter' || e.key === ' ') && e.currentTarget instanceof HTMLElement){
                                e.preventDefault()
                                e.currentTarget.click()
                            }
                        }}>
                            <GitCompare size={18} aria-hidden="true"/>
                        </div>
                    {/if}
                    <div class="text-textcolor2 hover:text-textcolor cursor-pointer mr-2" role="button" tabindex="0" aria-label={language.copy} onclick={(e) => {
                        e.stopPropagation()
                        copyPreset(i)
                    }} onkeydown={(e) => {
                        if(e.target !== e.currentTarget) return
                        if((e.key === 'Enter' || e.key === ' ') && e.currentTarget instanceof HTMLElement){
                            e.preventDefault()
                            e.currentTarget.click()
                        }
                    }}>
                        <CopyIcon size={18} aria-hidden="true"/>
                    </div>
                    <div class="text-textcolor2 hover:text-textcolor cursor-pointer mr-2" role="button" tabindex="0" aria-label={language.export} onclick={async (e) => {
                        e.stopPropagation()
                        const data = await alertCardExport('preset')
                        console.log(data.type)
                        if(data.type === ''){
                            downloadPreset(i, 'risupreset')
                        }
                        if(data.type === 'realm'){
                            await openRealmUpload(`preset:${i}`)
                        }
                    }} onkeydown={(e) => {
                        if(e.target !== e.currentTarget) return
                        if((e.key === 'Enter' || e.key === ' ') && e.currentTarget instanceof HTMLElement){
                            e.preventDefault()
                            e.currentTarget.click()
                        }
                    }}>

                        <Share2Icon size={18} aria-hidden="true" />
                    </div>
                    <div class="text-textcolor2 hover:text-textcolor cursor-pointer" role="button" tabindex="0" aria-label={language.remove} onclick={async (e) => {
                        e.stopPropagation()
                        const target = preset
                        if(DBState.db.botPresets.length === 1){
                            alertError(language.errors.onlyOneChat)
                            return
                        }
                        const d = await alertConfirm(`${language.removeConfirm}${target.name}`)
                        if(d){
                            const targetIndex = DBState.db.botPresets.indexOf(target)
                            if(targetIndex === -1 || DBState.db.botPresets.length <= 1){
                                return
                            }
                            changeToPreset(0)
                            let botPresets = DBState.db.botPresets
                            botPresets.splice(targetIndex, 1)
                            DBState.db.botPresets = botPresets
                            changeToPreset(0, false)
                        }
                    }} onkeydown={(e) => {
                        if(e.target !== e.currentTarget) return
                        if((e.key === 'Enter' || e.key === ' ') && e.currentTarget instanceof HTMLElement){
                            e.preventDefault()
                            e.currentTarget.click()
                        }
                    }}>
                        <TrashIcon size={18} aria-hidden="true"/>
                    </div>
                    {/if}
                </div>
            </button>
        {/snippet}
        </WindowedSegment>

        <div class="w-full transition-all duration-200"
            class:h-0.5={!isDragging || dragOverIndex !== DBState.db.botPresets.length}
            class:h-1={isDragging && dragOverIndex === DBState.db.botPresets.length}
            class:bg-selected={isDragging && dragOverIndex === DBState.db.botPresets.length}
            class:ring-1={isDragging && dragOverIndex === DBState.db.botPresets.length}
            class:ring-borderc={isDragging && dragOverIndex === DBState.db.botPresets.length}
            class:shadow-lg={isDragging && dragOverIndex === DBState.db.botPresets.length}
            class:hover:bg-selected={!isDragging}
            role="listitem"
            ondragover={(e) => {
                if (!isPresetDrag(e)) {
                    return
                }
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                dragOverIndex = DBState.db.botPresets.length
            }}
            ondragleave={(e) => {
                dragOverIndex = -1
            }}
            ondrop={(e) => {
                handlePresetDrop(DBState.db.botPresets.length, e)
                dragOverIndex = -1
            }}>
        </div>
        
        {#if selectMode}
        <div class="sticky bottom-0 bg-darkbg border-t border-solid border-0 border-darkborderc flex items-center gap-2 mt-2 pt-2" data-select-bar>
            <button type="button" class="min-h-11 px-3 text-textcolor2 hover:text-textcolor cursor-pointer rounded-md border border-solid border-darkborderc" class:bg-selected={allSelected} class:text-textcolor={allSelected} aria-pressed={allSelected} onclick={toggleAll}>
                {language.presetBundleAll}
            </button>
            <div class="grow"></div>
            <button type="button" class="min-h-11 px-3 text-textcolor2 hover:text-textcolor cursor-pointer" onclick={() => setSelectMode(false)}>
                {language.cancel}
            </button>
            <button type="button" class="min-h-11 px-4 font-semibold text-textcolor bg-selected rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" disabled={selectedCount === 0 || exporting} onclick={exportSelected}>
                {fillLang(language.presetBundleExport, { count: selectedCount })}
            </button>
        </div>
        {:else}
        <div class="flex mt-2 items-center">
            <button aria-label={language.add} class="text-textcolor2 hover:text-textcolor cursor-pointer mr-1" onclick={() => {
                let botPresets = DBState.db.botPresets
                let newPreset = safeStructuredClone(prebuiltPresets.OAI2)
                newPreset.name = `New Preset`
                botPresets.push(freshPresetMeta(newPreset, { keepFolder: false }))

                DBState.db.botPresets = botPresets
            }}>
                <PlusIcon aria-hidden="true"/>
            </button>
            <button aria-label={language.import} class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" onclick={() => {
                importPreset()
            }}>
                <HardDriveUploadIcon size={18} aria-hidden="true"/>
            </button>
            <button aria-label={language.presetBundleSelect} aria-pressed={selectMode} class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" onclick={() => setSelectMode(true)}>
                <ListChecksIcon size={18} aria-hidden="true"/>
            </button>
            <button aria-label={language.othersUi.editMode} aria-pressed={editMode} class="text-textcolor2 hover:text-textcolor cursor-pointer" onclick={() => {
                editMode = !editMode
            }}>
                <PencilIcon size={18} aria-hidden="true"/>
            </button>
        </div>
        {/if}
        <span class="text-textcolor2 text-sm">{language.quickPreset}</span>
    </div>
</div>

{#if showDiffModal && firstPresetId !== null && secondPresetId !== null}
  <PromptDiffModal
    firstPresetId={firstPresetId}
    secondPresetId={secondPresetId}
    onClose={closeDiff}
  />
{/if}

<style>
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }

    /* Drag and drop styles */
    .draggable-preset:hover {
        cursor: grab;
    }

    .draggable-preset:active {
        cursor: grabbing;
    }

    .h-0\.5 {
        min-height: 2px;
        height: 2px;
    }

    .h-1 {
        min-height: 4px;
        height: 4px;
    }
</style>
