<script lang="ts">
    import { language } from "src/lang";
    
    import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte';
    import Button from "src/lib/UI/GUI/Button.svelte";
    import ModuleMenu from "src/lib/Setting/Pages/Module/ModuleMenu.svelte";
    import { importModule, refreshModules, type RisuModule } from "src/ts/process/modules";
    import { convertModuleRow, exportModuleRow, moduleIntegrationState, removeModuleRow, setModuleGlobal } from "src/ts/process/moduleListOps";
    import { SquarePen, TrashIcon, Globe, Share2Icon, PlusIcon, HardDriveUpload, Waypoints, UserIcon } from "@lucide/svelte";
    import { v4 } from "uuid";
    import { tooltip } from "src/ts/gui/tooltip";
    import { alertConfirm, alertNormal, alertSelect } from "src/ts/alert";
    import { ALERT_SELECT_CANCEL } from "src/ts/alertCancel";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import { onDestroy } from "svelte";
    import { importMCPModule } from "src/ts/process/mcp/mcp";
    import { useModuleRow } from "src/ts/process/moduleUse";
    import { createWindowHost } from "src/ts/windowing/windowHost.svelte";
    import WindowedSegment from "src/lib/UI/Windowed/WindowedSegment.svelte";
    import { matchingModulePositions, moduleListScroller, moduleRowKeys } from "./moduleListWindow";
    let tempModule:RisuModule = $state({
        name: '',
        description: '',
        id: v4(),
    })
    let mode = $state(0)
    // The editor holds the module it was opened on until it closes; one load runs at a time.
    let editorRelease: (() => void) | null = null
    let editorLoading = false
    let destroyed = false
    let moduleSearch = $state('')
    let charConversionMode = $state(false)
    const uid = $props.id()

    // Rows follow the order of db.modules; the search only filters. Only the rows near the scroller's
    // view are mounted; a row is keyed by its module, so the search never changes a key.
    const rowKeys = $derived(moduleRowKeys(DBState.db.modules))
    const moduleByKey = $derived(new Map(rowKeys.map((key, i) => [key, DBState.db.modules[i]])))
    const shownKeys = $derived(matchingModulePositions(DBState.db.modules, moduleSearch).map((i) => rowKeys[i]))
    // About one row with a one-line description; each mounted row is measured.
    const MODULE_ROW_FALLBACK_PX = 77
    let listElement = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({
        root: () => listElement,
        scroller: () => (listElement ? moduleListScroller(listElement) : null),
    })
    onDestroy(() => windowHost.dispose())

    // The editor (modes 1 and 2) changes modules while open without refreshing the chat;
    // closing it, by a button or by this component being destroyed, refreshes once.
    function closeEditor(){
        releaseEditor()
        mode = 0
        $ReloadGUIPointer += 1
    }

    function releaseEditor(){
        const release = editorRelease
        editorRelease = null
        release?.()
    }

    onDestroy(() => {
        destroyed = true
        releaseEditor()
        refreshModules()
        if(mode !== 0){
            $ReloadGUIPointer += 1
        }
    })
</script>
{#if mode === 0}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.modules}</h2>

    <TextInput className="mt-4" placeholder={language.search} label={language.search} bind:value={moduleSearch} />

    <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md flex-1 overflow-y-auto" bind:this={listElement}>
        {#if DBState.db.modules.length === 0}
            <div class="text-textcolor2 p-3">{language.noModules}</div>
        {:else}
            <WindowedSegment host={windowHost} keys={shownKeys} height={{ fallback: MODULE_ROW_FALLBACK_PX }} class="flex flex-col">
            {#snippet item(key, i)}
            {@const rmodule = moduleByKey.get(key)}
            {#if rmodule}
                {#if i !== 0}
                    <div class="border-t-1 border-selected"></div>
                {/if}

                <div class="pl-3 pt-3 text-left flex items-center">
                    {#if rmodule.mcp}
                        <Waypoints size={18} class="mr-2" aria-hidden="true" />
                    {/if}
                    <span class="text-lg">{rmodule.name}</span>
                    <div class="grow flex justify-end">
                        {#if charConversionMode}
                            <button class="cursor-pointer risu-state-violet mr-2" aria-label={language.moduleConvertRow} onclick={async (e) => {
                                e.stopPropagation()
                                if(await convertModuleRow(rmodule)){
                                    alertNormal(language.successfullyConverted)
                                }
                            }}>
                                <UserIcon size={18} aria-hidden="true"/>
                                
                            </button>
                        {:else}
                            {@const integrationState = moduleIntegrationState(rmodule, DBState.db)}
                            {@const enabledGlobally = integrationState === 'global'}
                            {@const integrated = integrationState === 'integration'}
                            <button class={enabledGlobally ?
                                    "mr-2 cursor-pointer rounded-sm bg-selected text-textcolor ring-1 ring-borderc" :
                                    integrated ?
                                    "risu-state-amber rounded-sm ring-1 ring-current mr-2 cursor-pointer" :
                                    "text-textcolor2 hover:text-textcolor mr-2 cursor-pointer"
                                } aria-label={language.enableGlobal} aria-pressed={enabledGlobally}
                                aria-describedby={integrated ? `${uid}-int-${i}` : undefined}
                                use:tooltip={language.enableGlobal} onclick={async (e) => {
                                e.stopPropagation()
                                setModuleGlobal(rmodule.id, !enabledGlobally)
                                charConversionMode = false
                            }}>
                                <Globe size={18} aria-hidden="true"/>
                            </button>
                            {#if integrated}
                                <span id="{uid}-int-{i}" hidden>{language.moduleOnByIntegration}</span>
                            {/if}
                            {#if !rmodule.mcp}
                                <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.download} use:tooltip={language.download} onclick={async (e) => {
                                    e.stopPropagation()
                                    const answer = await alertSelect([`CharX (${language.recommended})`, language.alerts.risumLegacy], undefined, { cancel: ALERT_SELECT_CANCEL })
                                    if(answer === ALERT_SELECT_CANCEL){
                                        return
                                    }
                                    await exportModuleRow(rmodule, parseInt(answer) === 0 ? 'charx' : 'risum')
                                }}>
                                    <Share2Icon size={18} aria-hidden="true"/>
                                </button>
                                <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.edit} use:tooltip={language.edit} onclick={async (e) => {
                                    e.stopPropagation()
                                    if(editorLoading){
                                        return
                                    }
                                    editorLoading = true
                                    try{
                                        const used = await useModuleRow(rmodule)
                                        if(!used){
                                            return
                                        }
                                        // The editor edits the live module in place. A load that finishes after the
                                        // component was destroyed, while another mode is open, or for a module that
                                        // left the list opens nothing and gives its handle back.
                                        if(destroyed || mode !== 0 || !DBState.db.modules.includes(used.module)){
                                            used.release()
                                            return
                                        }
                                        tempModule = used.module
                                        editorRelease = used.release
                                        mode = 2
                                    }
                                    finally{
                                        editorLoading = false
                                    }
                                }}>
                                    <SquarePen size={18} aria-hidden="true"/>
                                </button>
                            {:else}
                                <button class="text-textcolor2 mr-2 cursor-not-allowed" aria-label={language.download} disabled>
                                    <Share2Icon size={18} aria-hidden="true"/>
                                </button>
                                <button class="text-textcolor2 mr-2 cursor-not-allowed" aria-label={language.edit} disabled>
                                    <SquarePen size={18} aria-hidden="true"/>
                                </button>
                            {/if}
                            <button class="text-textcolor2 hover:text-draculared mr-2 cursor-pointer" aria-label={language.remove} use:tooltip={language.remove} onclick={async (e) => {
                                e.stopPropagation()
                                const target = rmodule
                                const d = await alertConfirm(`${language.removeConfirm}` + target.name)
                                if(d){
                                    removeModuleRow(target)
                                }
                            }}>
                                <TrashIcon size={18} aria-hidden="true"/>
                            </button>
                        {/if}

                    </div>
                </div>
                <div class="mt-1 mb-3 pl-3">
                    <span class="text-sm text-textcolor2">{rmodule.description || language.settingsPage.noDescriptionProvided}</span>
                </div>
            {/if}
            {/snippet}
            </WindowedSegment>
        {/if}
    </div>

    <div class="flex mr-2 mt-4">
        <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.createModule} onclick={async () => {
            tempModule = {
                name: '',
                description: '',
                id: v4(),
            }
            DBState.db.modules.push(tempModule)
            mode = 1
        }}>
            <PlusIcon aria-hidden="true" />
        </button>
        <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.moduleConvertMode} aria-pressed={charConversionMode} onclick={async () => {
            charConversionMode = !charConversionMode
        }}>
            <UserIcon aria-hidden="true" />
        </button>
        <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.moduleImportMcp} onclick={async () => {
            importMCPModule()
        }}>
            <Waypoints aria-hidden="true" />
        </button>
        <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.import} onclick={async () => {
            importModule()
        }}>
            <HardDriveUpload aria-hidden="true" />
        </button>
    </div>
{:else if mode === 1}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.createModule}</h2>
    <ModuleMenu bind:currentModule={tempModule}/>
    <Button className="mt-6" onclick={() => {
        // tempModule was already pushed onto DBState.db.modules when create mode was
        // entered (the "+" button above), so it doesn't need to be pushed again here —
        // doing so would insert every newly-created module twice.
        closeEditor()
    }}>{language.createModule}</Button>
{:else if mode === 2}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.editModule}</h2>
    <ModuleMenu bind:currentModule={tempModule}/>
    {#if tempModule.name !== ''}
        <Button className="mt-6" onclick={() => {
            // The slot is found now, not when the editor opened: the list can change while the editor is open, and a
            // module that left it is not written back. The same-stub install helper is where this write goes once it exists.
            const slot = DBState.db.modules.indexOf(tempModule)
            if(slot !== -1){
                DBState.db.modules[slot] = tempModule
            }
            closeEditor()
        }}>{language.editModule}</Button>
    {/if}
{/if}