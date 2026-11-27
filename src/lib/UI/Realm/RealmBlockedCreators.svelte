<script lang="ts">
    import { untrack } from "svelte";
    import { XIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
    import { removeBlockedRealmCreator } from "src/ts/realmBlocking";
    import { DBState } from "src/ts/stores.svelte";
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from "src/lib/Nexus/pattern/patternFocus";

    interface Props {
        onClose?: () => void;
        onUnblock?: () => void | Promise<void>;
    }

    let { onClose = () => {}, onUnblock = () => {} }: Props = $props();

    let layer:HTMLElement|undefined = $state()
    let panel:HTMLElement|undefined = $state()
    let closeButton:HTMLElement|undefined = $state()

    const token = {}
    // The control that opened this dialog; focus returns to it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let open = true

    function close(){
        open = false
        onClose()
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

    // While open: Back and Escape close this dialog first, the shell holds a modal layer, the page
    // behind goes inert, focus starts on the close button and Tab stays inside the panel. Teardown
    // undoes all of it in reverse and returns focus last, once the page is no longer inert.
    $effect(() => {
        const shell = panel
        const area = layer
        const initial = closeButton
        if (!shell || !area || !initial) return
        const unregisterBack = registerBackHandler(backCloseHandler({
            isOpen: () => open,
            snapshot: () => open,
            close,
        }))
        const unregisterShell = registerShell(token)
        const restoreInert = makeInert(backgroundOf(area))
        initial.focus()
        const stopWatching = watchFocus(shell, initial, () => isTopmostShell(token))

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
            untrack(() => returnFocus(opener))
        }
    })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div bind:this={layer} data-part="modal-realm-blocked-creators" class="fixed left-0 top-0 z-60 flex h-full w-full items-center justify-center bg-black/50 p-4 text-textcolor" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        bind:this={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="blocked-creators-title"
        tabindex="-1"
        data-part="modal-frame"
        class="flex max-h-full w-xl max-w-full flex-col gap-4 overflow-y-auto rounded-[18px] bg-darkbg p-6 outline-hidden"
        onclick={(e) => e.stopPropagation()}
    >
        <div data-part="modal-header" class="flex items-center justify-between gap-4">
            <h1 id="blocked-creators-title" data-part="modal-title" class="min-w-0 text-2xl font-bold wrap-anywhere">{language.blockedRealmCreators}</h1>
            <button
                type="button"
                bind:this={closeButton}
                data-part="modal-close"
                class="risu-focus-ring flex size-11 shrink-0 items-center justify-center rounded-md text-textcolor2 hover:bg-selected/50"
                onclick={close}
                aria-label={language.uiCommon.close}
            >
                <XIcon aria-hidden="true" />
            </button>
        </div>

        {#if DBState.db.blockedRealmCreators.length === 0}
            <p data-part="modal-text" class="text-textcolor2">{language.noBlockedRealmCreators}</p>
        {:else}
            <div data-part="modal-list" class="flex flex-col gap-2">
                {#each DBState.db.blockedRealmCreators as creator (creator.id)}
                    <div data-part="modal-row" class="flex items-center gap-3 rounded-xl border border-darkborderc p-3">
                        <div class="min-w-0 grow">
                            <div data-part="modal-text" class="truncate font-bold">{creator.name}</div>
                            <div data-part="modal-text" class="truncate text-xs text-textcolor2">{creator.id}</div>
                        </div>
                        <button type="button" data-part="modal-action" class="risu-focus-ring min-h-11 rounded-md bg-selected px-3 text-textcolor hover:bg-selected/50" onclick={async () => {
                            DBState.db.blockedRealmCreators = removeBlockedRealmCreator(
                                DBState.db.blockedRealmCreators,
                                creator.id,
                            )
                            await onUnblock()
                        }}>
                            {language.unblockRealmCreator}
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
