<script lang="ts">
    import { language } from "src/lang";
    
    import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte';
    import Button from "src/lib/UI/GUI/Button.svelte";
    import ModuleMenu from "src/lib/Setting/Pages/Module/ModuleMenu.svelte";
    import { exportModule, exportModuleLegacy, importModule, refreshModules, type RisuModule } from "src/ts/process/modules";
    import { SquarePen, TrashIcon, Globe, Share2Icon, PlusIcon, HardDriveUpload, Waypoints, UserIcon } from "@lucide/svelte";
    import { v4 } from "uuid";
    import { tooltip } from "src/ts/gui/tooltip";
    import { alertConfirm, alertNormal, alertSelect } from "src/ts/alert";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import { onDestroy } from "svelte";
    import { importMCPModule } from "src/ts/process/mcp/mcp";
    import { convertModuleToCharacter } from "src/ts/interchangeability";
    import { checkCharOrder } from "src/ts/globalApi.svelte";
    import { useModuleRow } from "src/ts/process/moduleUse";
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

    // Rows follow the order of db.modules; the search only filters.
    function filterModules(modules:RisuModule[], search:string){
        return modules.filter((v) => {
            if(search === '') return true
            return v.name.toLowerCase().includes(search.toLowerCase())
        })
    }

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

    <TextInput className="mt-4" placeholder={language.search} bind:value={moduleSearch} />

    <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md flex-1 overflow-y-auto">
        {#if DBState.db.modules.length === 0}
            <div class="text-textcolor2 p-3">{language.noModules}</div>
        {:else}
            {#each filterModules(DBState.db.modules, moduleSearch) as rmodule, i}
                {#if i !== 0}
                    <div class="border-t-1 border-selected"></div>
                {/if}

                <div class="pl-3 pt-3 text-left flex items-center">
                    {#if rmodule.mcp}
                        <Waypoints size={18} class="mr-2" />
                    {/if}
                    <span class="text-lg">{rmodule.name}</span>
                    <div class="grow flex justify-end">
                        {#if charConversionMode}
                            <button class="cursor-pointer text-violet-500 mr-2" onclick={async (e) => {
                                e.stopPropagation()
                                const used = await useModuleRow(rmodule)
                                if(!used){
                                    return
                                }
                                try{
                                    const char = convertModuleToCharacter(used.module)
                                    DBState.db.characters.push(char)
                                }
                                finally{
                                    used.release()
                                }
                                alertNormal(language.successfullyConverted)
                                checkCharOrder()
                            }}>
                                <UserIcon size={18}/>
                                
                            </button>
                        {:else}
                            <button class={(DBState.db.enabledModules.includes(rmodule.id)) ?
                                    "mr-2 cursor-pointer text-blue-500" :
                                    rmodule.namespace && 
                                    DBState.db.moduleIntergration?.split(',').map((s) => s.trim()).includes(rmodule.namespace) ?
                                    "text-amber-500 hover:text-green-500 mr-2 cursor-pointer" :
                                    "text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                                } use:tooltip={language.enableGlobal} onclick={async (e) => {
                                e.stopPropagation()
                                if(DBState.db.enabledModules.includes(rmodule.id)){
                                    DBState.db.enabledModules.splice(DBState.db.enabledModules.indexOf(rmodule.id), 1)
                                }
                                else{
                                    DBState.db.enabledModules.push(rmodule.id)
                                }
                                DBState.db.enabledModules = DBState.db.enabledModules
                                charConversionMode = false
                            }}>
                                <Globe size={18}/>
                            </button>
                            {#if !rmodule.mcp}
                                <button class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer" use:tooltip={language.download} onclick={async (e) => {
                                    e.stopPropagation()
                                    const sel = parseInt(await alertSelect([`CharX (${language.recommended})`, language.alerts.risumLegacy]))
                                    const used = await useModuleRow(rmodule)
                                    if(!used){
                                        return
                                    }
                                    try{
                                        if(sel === 0){
                                            await exportModule(used.module)
                                        }
                                        else{
                                            await exportModuleLegacy(used.module)
                                        }
                                    }
                                    finally{
                                        used.release()
                                    }
                                }}>
                                    <Share2Icon size={18}/>
                                </button>
                                <button class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer" use:tooltip={language.edit} onclick={async (e) => {
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
                                    <SquarePen size={18}/>
                                </button>
                            {:else}
                                <button class="text-textcolor2 mr-2 cursor-not-allowed">
                                    <Share2Icon size={18}/>
                                </button>
                                <button class="text-textcolor2 mr-2 cursor-not-allowed">
                                    <SquarePen size={18}/>
                                </button>
                            {/if}
                            <button class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer" use:tooltip={language.remove} onclick={async (e) => {
                                e.stopPropagation()
                                const target = rmodule
                                const d = await alertConfirm(`${language.removeConfirm}` + target.name)
                                if(d){
                                    const index = DBState.db.modules.indexOf(target)
                                    if(index === -1){
                                        return
                                    }
                                    DBState.db.modules.splice(index, 1)
                                    DBState.db.modules = DBState.db.modules
                                    if(!DBState.db.modules.some((v) => v.id === target.id) && DBState.db.enabledModules.includes(target.id)){
                                        DBState.db.enabledModules.splice(DBState.db.enabledModules.indexOf(target.id), 1)
                                        DBState.db.enabledModules = DBState.db.enabledModules
                                    }
                                }
                            }}>
                                <TrashIcon size={18}/>
                            </button>
                        {/if}

                    </div>
                </div>
                <div class="mt-1 mb-3 pl-3">
                    <span class="text-sm text-textcolor2">{rmodule.description || language.settingsPage.noDescriptionProvided}</span>
                </div>
            {/each}
        {/if}
    </div>

    <div class="flex mr-2 mt-4">
        <button class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer" onclick={async () => {
            tempModule = {
                name: '',
                description: '',
                id: v4(),
            }
            DBState.db.modules.push(tempModule)
            mode = 1
        }}>
            <PlusIcon />
        </button>
        <button class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer" onclick={async () => {
            charConversionMode = !charConversionMode
        }}>
            <UserIcon />
        </button>
        <button class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer" onclick={async () => {
            importMCPModule()
        }}>
            <Waypoints />
        </button>
        <button class="text-textcolor2 hover:text-blue-500 mr-2 cursor-pointer" onclick={async () => {
            importModule()
        }}>
            <HardDriveUpload  />
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