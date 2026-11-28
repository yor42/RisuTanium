<script lang="ts">
    import { ArrowLeft, ArrowRight } from "@lucide/svelte";
    import { DynamicGUI, sideBarClosing, sideBarStore } from "src/ts/stores.svelte";
    import { homeChrome } from "src/lib/UI/Home/homeChrome.svelte";
    import { language } from "src/lang";

    interface Props {
        // The header toggle sits in the phone header; the floating arrow overlays the chat corner.
        placement?: 'floating' | 'header';
        // The floating arrow steps aside on the phone layout, where the header carries the toggle.
        yieldOnPhone?: boolean;
    }
    let { placement = 'floating', yieldOnPhone = false }: Props = $props();
    const header = $derived(placement === 'header')
    const yieldAttr = $derived(!header && yieldOnPhone ? '' : undefined)

</script>

{#if !homeChrome.phoneDrawer && (!homeChrome.landing || $DynamicGUI)}
{#if $sideBarStore && !$DynamicGUI}
    <button data-classic-arrow-yield={yieldAttr} aria-label={language.closeSidebar} title={language.closeSidebar} onclick={() => {sideBarClosing.set(true)}} class="{header ? 'h-11 w-11 shrink-0 rounded-md border border-transparent' : 'absolute top-3 left-0 h-12 w-12 border-r border-b border-t border-transparent rounded-r-md'} bg-darkbg hover:border-neutral-200 transition-colors flex items-center justify-center text-textcolor z-20">
        <ArrowLeft aria-hidden="true" />
    </button>
{:else if !$sideBarStore}
    <!-- With the overlay open (DynamicGUI) the overlay wrapper stacks over the chat area, so the arrow lives in Sidebar's backdrop strip instead. -->
    <button data-panel-handle data-classic-arrow-yield={yieldAttr} aria-label={language.chatShellSidebar} title={language.chatShellSidebar} aria-expanded={$sideBarStore} onclick={() => {
        sideBarClosing.set(false);
        sideBarStore.set(true)}} class="{header ? 'h-11 w-11 shrink-0 rounded-md border border-borderc' : 'absolute top-3 left-0 h-12 w-12 border-r border-b border-t border-borderc rounded-r-md opacity-50 hover:opacity-90'} bg-darkbg hover:border-neutral-200 transition-colors flex items-center justify-center text-textcolor z-20">
        <ArrowRight aria-hidden="true" />
    </button>
{/if}
{/if}