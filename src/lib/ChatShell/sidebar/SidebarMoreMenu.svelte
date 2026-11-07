<script lang="ts">
    import { untrack } from "svelte";
    import { ArrowLeft, BookmarkCheckIcon, LayoutPanelLeftIcon, SettingsIcon, ShellIcon, SplitIcon, WrenchIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { openStudio, selectedStudioCharacterId } from "src/ts/studio/studioScreen.svelte";
    import { studioEligible } from "src/ts/studio/studioSwitch.svelte";
    import {
        DBState,
        PlaygroundStore,
        additionalHamburgerMenu,
        alertStore,
        bookmarkListOpen,
        selectedCharID,
    } from "src/ts/stores.svelte";
    import CharConfig from "../../SideBars/CharConfig.svelte";
    import DevTool from "../../SideBars/DevTool.svelte";
    import PluginDefinedIcon from "../../Others/PluginDefinedIcon.svelte";

    interface Props {
        // Resets the sidebar's own state before a destination replaces the page, as the old rail did.
        reseter: () => void;
        // Leaves More for the sidebar frame.
        onclose: () => void;
        // Called after an action that opens a page-level dialog, so an overlay sidebar steps aside.
        afterAction: () => void;
        // Where More opens. A link-out from Studio opens it on Character settings.
        startView?: 'menu' | 'settings';
    }

    let { reseter, onclose, afterAction, startView = 'menu' }: Props = $props();

    // 'menu' is the list; the other two are the old tab bar's character settings and developer tool.
    // The prop only seeds the view when More opens; later navigation inside More is the view's own.
    let view = $state<'menu' | 'settings' | 'dev'>(untrack(() => startView));

    function back() {
        if (view === 'menu') {
            onclose();
            return;
        }
        view = 'menu';
    }

    // More closes first. Its row goes away with it, so Back returns focus to the sidebar's More button.
    function openInStudio(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
        const chaId = selectedStudioCharacterId();
        if (chaId === null) return;
        const opener = { element: event.currentTarget, selector: '[data-part="sidebar-more"]' };
        onclose();
        openStudio({ owner: { type: 'character', id: chaId }, from: 'chat' }, opener);
    }

    function openPlayground() {
        reseter();
        selectedCharID.set(-1);
        PlaygroundStore.set(1);
    }

    const itemClass = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-start text-textcolor hover:bg-selected cursor-pointer";
</script>

<div data-part="sidebar-more-panel" class="absolute inset-0 z-10 flex flex-col bg-darkbg text-textcolor">
    <div class="flex items-center gap-2 border-b border-darkborderc p-2">
        <button class="flex items-center gap-1 rounded-md px-2 py-1 text-textcolor2 hover:text-textcolor cursor-pointer" onclick={back}>
            <ArrowLeft size={18} />
            <span>{language.settingsPage.back}</span>
        </button>
        <span class="ml-auto pr-2 font-bold">{language.chatShellMore}</span>
    </div>
    {#if view === 'menu'}
        <div data-part="more-list" class="flex flex-col gap-1 overflow-y-auto p-2">
            <button class={itemClass} onclick={() => { view = 'settings' }}>
                <SettingsIcon size={18} />
                <span>{language.chatShellCharacterSettings}</span>
            </button>
            {#if studioEligible()}
                <button class={itemClass} data-part="more-studio" onclick={openInStudio}>
                    <LayoutPanelLeftIcon size={18} />
                    <span>{language.studioOpenIn}</span>
                </button>
            {/if}
            <button class={itemClass} onclick={openPlayground}>
                <ShellIcon size={18} />
                <span>{language.playground.playground}</span>
            </button>
            <button class={itemClass} onclick={() => { bookmarkListOpen.set(true); afterAction(); }}>
                <BookmarkCheckIcon size={18} />
                <span>{language.bookmarks}</span>
            </button>
            <button class={itemClass} onclick={() => { alertStore.set({ type: 'branches', msg: '' }); afterAction(); }}>
                <SplitIcon size={18} />
                <span>{language.chatShellBranches}</span>
            </button>
            {#if DBState.db.enableDevTools}
                <button class={itemClass} onclick={() => { view = 'dev' }}>
                    <WrenchIcon size={18} />
                    <span>{language.chatShellDevTool}</span>
                </button>
            {/if}
            {#each additionalHamburgerMenu as menu (menu.id)}
                <button class={itemClass} onclick={() => { reseter(); menu.callback(); }}>
                    <PluginDefinedIcon ico={menu} />
                    <span>{menu.name}</span>
                </button>
            {/each}
        </div>
    {:else}
        <div data-part="more-subview" class="flex-1 overflow-y-auto overflow-x-hidden p-2">
            {#if view === 'settings'}
                <CharConfig studioEntry={false} />
            {:else}
                <DevTool />
            {/if}
        </div>
    {/if}
</div>
