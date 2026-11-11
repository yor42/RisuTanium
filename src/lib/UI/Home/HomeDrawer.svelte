<script lang="ts">
    import { flushSync, untrack } from 'svelte'
    import { get } from 'svelte/store'
    import { XIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { settingsOpen } from 'src/ts/stores.svelte'
    import { studioOpen } from 'src/ts/studio/studioOpen'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from 'src/lib/Nexus/pattern/patternFocus'
    import PluginDefinedIcon from 'src/lib/Others/PluginDefinedIcon.svelte'
    import { holdReturnedFocus } from './homeFocusHold'
    import { homeDrawerItems, type HomeDrawerItem } from './homeDrawerItems'

    interface Props {
        /** The panel's id, referenced by the menu button's aria-controls. */
        id: string
        /** The menu button that opened the drawer; focus returns to it on every close except a cover's. */
        trigger: HTMLElement | null
        /** Asks the owner to unmount the drawer. */
        onclose: () => void
    }

    let { id, trigger, onclose }: Props = $props()

    const token = {}
    const headingId = $derived(`${id}-heading`)
    const items = $derived(homeDrawerItems())

    let layer = $state<HTMLElement>()
    let panel = $state<HTMLElement>()

    // Read by close and by the teardown; neither runs in a tracked context that needs to react.
    let open = true
    let returnOnTeardown = true
    // An item's action owns focus once the drawer is gone, so a chosen item arms no hold.
    let holdAfterClose = true

    function close(): void {
        if (!open) return
        open = false
        onclose()
    }

    // A cover (Settings, Studio) owns the screen: the drawer goes without taking focus back, so
    // no modal layer is ever held under it.
    $effect(() => {
        if ($settingsOpen || $studioOpen) {
            returnOnTeardown = false
            close()
        }
    })

    // The drawer closes first and the update is flushed before the action runs: the page is no
    // longer inert, no layer is held and focus is on the menu button, so an action that opens a
    // cover captures the menu button as its opener.
    function choose(item: HomeDrawerItem): void {
        holdAfterClose = false
        close()
        flushSync()
        item.run()
    }

    /** Every sibling along the path from `node` up to the enclosing `<main>` (or the body). */
    function backgroundOf(node: HTMLElement): HTMLElement[] {
        const held: HTMLElement[] = []
        let current = node
        for (let parent = current.parentElement; parent && parent !== document.body; parent = current.parentElement) {
            for (const sibling of Array.from(parent.children)) {
                if (sibling !== current && sibling instanceof HTMLElement) held.push(sibling)
            }
            if (parent.tagName === 'MAIN') break
            current = parent
        }
        return held
    }

    // Open: Back closes this drawer first, the shell holds a modal layer (toast timers pause), the
    // page behind goes inert, focus moves to the first item, and Escape and Tab are handled on
    // window in the capture phase so they work whatever has focus. Teardown undoes all of it in
    // reverse and returns focus last, once the page is no longer inert.
    $effect(() => {
        const shell = panel
        const area = layer
        if (!shell || !area) return
        const opener = untrack(() => trigger)
        const unregisterBack = registerBackHandler(backCloseHandler({
            isOpen: () => open,
            snapshot: () => open,
            close,
        }))
        const unregisterShell = registerShell(token)
        const restoreInert = makeInert(backgroundOf(area))
        const initial = shell.querySelector<HTMLElement>('[data-part="home-drawer-item"]') ?? shell
        initial.focus()
        const stopWatching = watchFocus(shell, shell, () => isTopmostShell(token))

        const onKeyDown = (event: KeyboardEvent) => {
            if (!isTopmostShell(token)) return
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (!event.repeat && !event.isComposing) close()
                return
            }
            trapTab(event, shell)
        }
        window.addEventListener('keydown', onKeyDown, true)

        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            stopWatching()
            unregisterBack()
            unregisterShell()
            restoreInert()
            // A blur to nothing shortly after the return (a late tap on empty space) puts focus back
            // on the menu button; a move to a real control, a cover or the window's end ends the hold.
            if (returnOnTeardown && returnFocus(opener) && holdAfterClose) {
                holdReturnedFocus(opener, () => get(settingsOpen) || get(studioOpen))
            }
        }
    })
</script>

<div bind:this={layer} data-part="home-drawer-layer" class="absolute inset-0 z-40">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div data-part="home-drawer-scrim" aria-hidden="true" class="absolute inset-0 bg-darkbg/80" onclick={close}></div>
    <div
        bind:this={panel}
        {id}
        data-part="home-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabindex="-1"
        class="home-drawer-panel absolute inset-y-0 start-0 flex w-[240px] max-w-[85vw] flex-col overflow-y-auto border-e border-borderc/10 bg-bgcolor text-textcolor shadow-lg"
    >
        <div class="flex items-center justify-between gap-2 py-2 ps-4 pe-2">
            <h2 id={headingId} class="text-lg font-semibold">{language.menu}</h2>
            <button
                type="button"
                data-part="home-drawer-close"
                aria-label={language.uiCommon.close}
                class="flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-md text-textcolor hover:bg-selected/50"
                onclick={close}
            >
                <XIcon size={22} />
            </button>
        </div>
        <nav aria-label={language.menu} class="flex flex-col pb-2">
            {#each items as item (item.id)}
                <button
                    type="button"
                    data-part="home-drawer-item"
                    aria-current={item.current ? 'page' : undefined}
                    class="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start hover:bg-selected/50 {item.current ? 'bg-selected/30 text-textcolor' : 'text-textcolor2'}"
                    onclick={() => choose(item)}
                >
                    {#if item.icon}
                        <item.icon size={20} aria-hidden="true" />
                    {:else if item.plugin}
                        <PluginDefinedIcon ico={item.plugin} />
                    {/if}
                    <span class="min-w-0 break-words">{item.label}</span>
                </button>
            {/each}
        </nav>
    </div>
</div>

<style>
    /* The panel slides in from the inline start; there is no exit motion, and reduced motion drops it. */
    .home-drawer-panel {
        --home-drawer-from: -100%;
        animation: home-drawer-slide 160ms ease-out;
    }
    :global([dir='rtl']) .home-drawer-panel {
        --home-drawer-from: 100%;
    }
    @keyframes home-drawer-slide {
        from {
            transform: translateX(var(--home-drawer-from));
        }
        to {
            transform: none;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .home-drawer-panel {
            animation: none;
        }
    }
</style>
