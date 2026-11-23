<script lang="ts">
    import { ArrowLeft, ArrowRight } from "@lucide/svelte";
    import { DynamicGUI, sideBarClosing, sideBarStore } from "src/ts/stores.svelte";
    import { homeChrome } from "src/lib/UI/Home/homeChrome.svelte";
    import { language } from "src/lang";

</script>

{#if !homeChrome.phoneDrawer}
{#if $sideBarStore && !$DynamicGUI}
    <button aria-label={language.closeSidebar} title={language.closeSidebar} onclick={() => {sideBarClosing.set(true)}} class="absolute top-3 left-0 h-12 w-12 border-r border-b border-t border-transparent  rounded-r-md bg-darkbg hover:border-neutral-200 transition-colors flex items-center justify-center text-textcolor z-20">
        <ArrowLeft aria-hidden="true" />
    </button>
{:else if !$sideBarStore}
    <!-- With the overlay open (DynamicGUI) the overlay wrapper stacks over the chat area, so the arrow lives in Sidebar's backdrop strip instead. -->
    <button data-panel-handle aria-label={language.chatShellSidebar} title={language.chatShellSidebar} aria-expanded={$sideBarStore} onclick={() => {
        sideBarClosing.set(false);
        sideBarStore.set(true)}} class="absolute top-3 left-0 h-12 w-12 border-r border-b border-t border-borderc rounded-r-md bg-darkbg hover:border-neutral-200 transition-colors flex items-center justify-center text-textcolor opacity-50 hover:opacity-90 z-20">
        <ArrowRight aria-hidden="true" />
    </button>
{/if}
{/if}