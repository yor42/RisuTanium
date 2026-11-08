<script lang="ts">
    import { language } from '../../../lang'
    import { toastHost, type ToastHost, type ToastKind } from '../../../ts/toast/toastHost.svelte'
    import { modalLayerOpen } from './modalLayers.svelte'

    interface Props {
        /** True while an alert covers the page: the stack is hidden and inert and its timers are held. */
        covered?: boolean
        host?: ToastHost
    }

    let { covered = false, host = toastHost }: Props = $props()

    // The host is fixed for the component's lifetime; the suspension follows `covered` through the closure.
    // svelte-ignore state_referenced_locally
    host.suspendWhile(() => covered)
    // An open focus-trapping overlay holds the timers only; the stack stays visible.
    // svelte-ignore state_referenced_locally
    host.pauseWhile(() => modalLayerOpen())

    // Holds are derived from DOM facts after every host change, never latched: the host never infers one, so no
    // hold can be forgotten or left set. None of this state is reactive; it is read and written only by the
    // functions and effects below.
    let root: HTMLElement | undefined
    // The toast element under the last mouse pointer event; touch and pen never set it (a tap fires enter without leave).
    let hovered: Element | null = null
    // The focus result of the last `syncHolds`.
    let lastInside = false
    // Where focus came from when it last entered the stack; `focusout` never touches it.
    let origin: HTMLElement | null = null
    // The focused element inside the stack as of before the DOM update of the current flush.
    let before: Element | null = null

    function syncHolds(): void {
        // A pause drops the hover like a suspension: an overlay may inert the toast, so its pointer leave may never arrive.
        if (hovered !== null && (host.suspended || host.paused || !hovered.isConnected)) {
            hovered = null
        }
        const active = document.activeElement
        const inside = root !== undefined && active !== null && root.contains(active)
        host.setHold('focus', inside)
        host.setHold('hover', hovered !== null)
        lastInside = inside
    }

    function onFocusIn(event: FocusEvent): void {
        // A focusin while focus is already inside (Tab between toasts, the window regaining focus) keeps the origin.
        if (!lastInside) {
            const from = event.relatedTarget
            origin = from instanceof HTMLElement && root !== undefined && !root.contains(from) ? from : null
        }
        syncHolds()
    }

    // During `focusout` an engine may report `body` as active although focus is moving within the stack, and a
    // window blur fires it while the focused element stays inside; the microtask sees the settled state.
    function onFocusOut(): void {
        queueMicrotask(syncHolds)
    }

    function onMouseEnterOrMove(event: PointerEvent): void {
        if (event.pointerType !== 'mouse') {
            return
        }
        hovered = event.currentTarget as Element
        syncHolds()
    }

    function onMouseLeave(event: PointerEvent): void {
        if (event.pointerType !== 'mouse') {
            return
        }
        // A leave from another toast is ignored, so entering B before leaving A keeps B.
        if (hovered === event.currentTarget) {
            hovered = null
        }
        syncHolds()
    }

    $effect.pre(() => {
        void host.version
        const active = document.activeElement
        before = root !== undefined && active !== null && root.contains(active) ? active : null
    })

    $effect(() => {
        void host.version
        const hadFocus = before
        before = null
        // The focused button or its toast was removed: focus returns to where it entered the stack from. This reads
        // only the pre-update snapshot and the origin, so it holds whether or not the engine fires `focusout` on
        // removal. While suspended the stack is inert and focus is left alone.
        if (hadFocus !== null && root !== undefined && !root.contains(document.activeElement) && !host.suspended) {
            if (origin !== null && origin.isConnected && !root.contains(origin)) {
                origin.focus()
            }
        }
        syncHolds()
    })

    $effect(() => {
        void host.paused
        syncHolds()
    })

    $effect(() => {
        const onVisibility = (): void => {
            if (document.visibilityState === 'hidden') {
                hovered = null
                syncHolds()
            }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    })

    function edgeClass(kind: ToastKind | 'undo'): string {
        return kind === 'warning' || kind === 'error' ? 'border-draculared' : 'border-darkborderc'
    }
</script>

<div
    bind:this={root}
    class="toast-stack"
    data-part="toast-host"
    data-suspended={host.suspended ? '' : undefined}
    data-paused={host.paused ? '' : undefined}
    inert={host.suspended}
    style:visibility={host.suspended ? 'hidden' : undefined}
    onfocusin={onFocusIn}
    onfocusout={onFocusOut}
>
    {#each host.visible as toast (toast.id)}
        <!-- The pointer handlers only feed the hold derivation; the buttons are the controls. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="toast pointer-events-auto flex items-center gap-2 rounded-md border bg-darkbg p-3 text-textcolor shadow-lg {edgeClass(toast.kind)}"
            data-part="toast"
            data-kind={toast.kind}
            data-part-critical={toast.actionLabel !== undefined ? '' : undefined}
            onpointerenter={onMouseEnterOrMove}
            onpointermove={onMouseEnterOrMove}
            onpointerleave={onMouseLeave}
        >
            <div class="min-w-0 flex-1 break-words">
                <div data-part="toast-text">{toast.text}</div>
                {#if toast.sub !== undefined}
                    <div class="text-sm text-textcolor2" data-part="toast-sub">{toast.sub}</div>
                {/if}
            </div>
            {#if toast.actionLabel !== undefined}
                <button
                    type="button"
                    class="min-h-11 min-w-11 rounded-md bg-darkbutton px-3 hover:bg-selected"
                    data-part="toast-action"
                    aria-disabled={toast.pending ? 'true' : undefined}
                    onclick={() => host.activate(toast.id)}
                >{toast.actionLabel}</button>
            {/if}
            <button
                type="button"
                class="flex min-h-11 min-w-11 items-center justify-center rounded-md text-textcolor2 hover:bg-selected"
                data-part="toast-dismiss"
                aria-label={language.uiCommon.close}
                onclick={() => host.dismiss(toast.id)}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
        </div>
    {/each}
</div>

<!-- The live regions stay outside the part that suspension hides, so the host controls when text is written. -->
<div class="sr-only" role="status" data-part="toast-live-polite">{#key host.polite.seq}<span>{host.polite.text}</span>{/key}</div>
<div class="sr-only" role="alert" data-part="toast-live-assertive">{#key host.assertive.seq}<span>{host.assertive.text}</span>{/key}</div>

<style>
    .toast-stack {
        position: fixed;
        right: var(--pattern-toast-gap);
        /* Clears two text lines of the legacy toast row, so the Back-quit warning is never covered. */
        bottom: calc(5rem + var(--pattern-toast-gap) + env(safe-area-inset-bottom, 0px));
        width: min(var(--pattern-toast-width), calc(100vw - 2 * var(--pattern-toast-gap)));
        z-index: var(--pattern-z-toast);
        display: flex;
        flex-direction: column;
        gap: var(--pattern-toast-gap);
        pointer-events: none;
    }

    .toast {
        animation: toast-rise var(--task-toast-enter-dur) ease-out;
    }

    @keyframes toast-rise {
        from { opacity: 0; transform: translateY(var(--task-toast-distance)); }
        to { opacity: 1; transform: none; }
    }

    @keyframes toast-fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
        .toast { animation-name: toast-fade; }
    }
</style>
