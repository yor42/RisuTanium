<script lang="ts">
    import { ArrowLeft, MenuIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { MobileGUIStack, MobileSearch, selectedCharID, SettingsMenuIndex, MobileSideBar } from "src/ts/stores.svelte";
    import { registerBackHandler } from "src/ts/backHandlers";
    import { closeShellChat, closeShellSettingsDetail, closeShellSidebarPage, createMobileShellBackHandler } from "./mobileBack";

    // Registered while the header is mounted, so it is gone while the Settings overlay replaces the
    // shell. The effect reads no reactive state, so navigating never re-registers it above an overlay.
    $effect(() => registerBackHandler(createMobileShellBackHandler()))

</script>
<div class="w-full px-4 h-16 border-b border-b-darkborderc bg-darkbg flex justify-start items-center gap-2">
    {#if $selectedCharID !== -1 && $MobileSideBar > 0}
        <button onclick={closeShellSidebarPage}>
            <ArrowLeft />
        </button>
        <span class="font-bold text-lg w-2/3 truncate">{language.menu}</span>
    {:else if $selectedCharID !== -1}
        <button onclick={closeShellChat}>
            <ArrowLeft />
        </button>
        <span class="font-bold text-lg w-2/3 truncate">{DBState.db.characters[$selectedCharID].name}</span>
        <div class="flex-1 flex justify-end">
            <button onclick={() => {
                MobileSideBar.set(1)
            }}>
                <MenuIcon />
            </button>
        </div>
    {:else if $MobileGUIStack === 2 && $SettingsMenuIndex > -1}
        <button onclick={closeShellSettingsDetail}>
            <ArrowLeft />
        </button>
        <span class="font-bold text-lg">Risuai</span>
    {:else if $MobileGUIStack === 1}
        <div class="flex items-stretch w-2xl max-w-full">
            <input placeholder={language.search + '...'} bind:value={$MobileSearch} class="peer focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border bg-transparent rounded-md input-text text-xl grow mx-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full">
        </div>
    {:else}
        <span class="font-bold text-lg">Risuai</span>

    {/if}
</div>