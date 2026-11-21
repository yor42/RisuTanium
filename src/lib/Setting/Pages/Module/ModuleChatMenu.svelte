<script lang="ts">
    import { CircleCheckIcon, Waypoints, XIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import type { RisuModule } from "src/ts/process/modules";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { selectedCharID } from "src/ts/stores.svelte";
    import { SettingsMenuIndex, settingsOpen } from "src/ts/stores.svelte";
    import { onDestroy } from "svelte";
    import { createWindowHost } from "src/ts/windowing/windowHost.svelte";
    import WindowedSegment from "src/lib/UI/Windowed/WindowedSegment.svelte";
    import { matchingModulePositions, moduleRowKeys } from "./moduleListWindow";

    interface Props {
        close?: any;
        alertMode?: boolean;
    }

    let { close = (i:string) => {}, alertMode = false }: Props = $props();
    let moduleSearch = $state('')
    const uid = $props.id()

    // Rows follow the order of db.modules; the search only filters. Only the rows near the dialog's
    // view are mounted (the dialog box is the scroller); a row is keyed by its module.
    const rowKeys = $derived(moduleRowKeys(DBState.db.modules))
    const moduleByKey = $derived(new Map<string, RisuModule>(rowKeys.map((key, i) => [key, DBState.db.modules[i]])))
    const shownKeys = $derived(matchingModulePositions(DBState.db.modules, moduleSearch).map((i) => rowKeys[i]))
    // One row of a one-line name; each mounted row is measured.
    const MODULE_ROW_FALLBACK_PX = 49
    let listElement = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listElement })
    onDestroy(() => windowHost.dispose())

</script>


<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-full max-h-full overflow-y-auto outline-none" tabindex={alertMode ? -1 : undefined} data-alert-box={alertMode ? '' : undefined}>
        <div class="flex items-center text-textcolor">
            <h2 class="mt-0 mb-0 text-lg">{language.modules}</h2>
            <div class="grow flex justify-end">
                <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer items-center" aria-label={language.uiCommon.close} onclick={() => {
                    close('')
                }}>
                    <XIcon size={24} aria-hidden="true"/>
                </button>
            </div>
        </div>

        <span class="text-sm text-textcolor2">{language.chatModulesInfo}</span>

        <TextInput className="mt-4" placeholder={language.search} label={language.search} bind:value={moduleSearch} />

        <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md" bind:this={listElement}>
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
                    <div class="pl-3 py-3 text-left flex items-center">
                        {#if rmodule.mcp}
                            <Waypoints size={18} class="mr-2" aria-hidden="true" />
                        {/if}
                        {#if !alertMode && DBState.db.enabledModules.includes(rmodule.id)}
                            <span class="text-textcolor2">{rmodule.name}</span>
                        {:else}
                            <span class="">{rmodule.name}</span>
                        {/if}
                        <div class="grow flex justify-end">

                            {#if alertMode}
                                <button class={"text-textcolor2 mr-2 cursor-pointer hover:text-textcolor transition-colors"} aria-label={language.select} onclick={async (e) => {
                                    e.stopPropagation()

                                    close(rmodule.id)
                                }}>
                                    <CircleCheckIcon size={18} aria-hidden="true"/>
                                </button>
                            {:else if DBState.db.enabledModules.includes(rmodule.id)}
                                <span class="mr-2"></span>
                            {:else}
                                {@const inChat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules.includes(rmodule.id)}
                                {@const forCharacter = !inChat && !!DBState.db.characters[$selectedCharID]?.modules?.includes(rmodule.id)}
                                <button class={inChat ?
                                        "mr-2 cursor-pointer rounded-sm bg-selected text-textcolor ring-1 ring-borderc" :
                                        forCharacter ?
                                        "mr-2 cursor-pointer rounded-sm risu-state-violet ring-1 ring-current" :
                                        "text-textcolor2 hover:text-textcolor mr-2 cursor-pointer"
                                } aria-label={language.moduleUseInChat} aria-pressed={inChat}
                                aria-describedby={forCharacter ? `${uid}-char-${i}` : undefined}
                                onclick={async (e) => {
                                    e.stopPropagation()
                                    if(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules.includes(rmodule.id)){
                                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules.splice(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules.indexOf(rmodule.id), 1)

                                    }
                                    else{
                                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules.push(rmodule.id)
                                    }
                                    DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules
                                    // Fork-specific: no pointer bump here. The module effect announces the set change through
                                    // moduleUpdate, which skips display-inert modules.
                                }}
                                oncontextmenu={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if(!DBState.db.characters[$selectedCharID].modules){
                                        DBState.db.characters[$selectedCharID].modules = []
                                    }
                                    if(DBState.db.characters[$selectedCharID].modules.includes(rmodule.id)){
                                        DBState.db.characters[$selectedCharID].modules.splice(DBState.db.characters[$selectedCharID].modules.indexOf(rmodule.id), 1)
                                    }
                                    else{
                                        DBState.db.characters[$selectedCharID].modules.push(rmodule.id)
                                    }
                                    // Fork-specific: no pointer bump here; see the tap handler.
                                }}>

                                    <CircleCheckIcon size={18} aria-hidden="true"/>
                                </button>
                                {#if forCharacter}
                                    <span id="{uid}-char-{i}" hidden>{language.moduleOnForCharacter}</span>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {/if}
                {/snippet}
                </WindowedSegment>
            {/if}
        </div>
        <div>
            <Button className="mt-4 grow-0" size="sm" onclick={() => {
                $SettingsMenuIndex = 14
                $settingsOpen = true
                close('')
            }}>{language.edit}</Button>
        </div>
    </div>
</div>

<style>
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
</style>