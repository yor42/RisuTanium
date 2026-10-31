<script lang="ts">
    import './pattern-dialog.css'
    import { untrack, type Snippet } from 'svelte'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from './patternFocus'

    interface Props {
        /** Id of the element that names the dialog. */
        labelId: string
        /** Id of the element that describes it. */
        descriptionId?: string
        /** Escape and `cancel()` call `oncancel` only when this is true. Escape is consumed either way. */
        cancelSafe?: boolean
        oncancel?: () => void
        /** Where focus returns on close. */
        trigger?: HTMLElement | null
        /** Elements made inert while the dialog is open; their previous inert state is restored on close. */
        background?: readonly HTMLElement[]
        /** Drops movement and caps durations. */
        lowPower?: boolean
        open?: boolean
        children: Snippet
    }

    let { labelId, descriptionId, cancelSafe = false, oncancel, trigger = null, background = [], lowPower = false, open = true, children }: Props = $props()

    const PHONE_QUERY = '(max-width: 640px)'
    const token = {}

    let dialog = $state<HTMLElement>()
    let layout = $state<'phone' | 'wide'>('wide')

    /** The shell's own cancel: calls `oncancel` only when the caller marked cancel as safe. */
    export function cancel(): void {
        if (cancelSafe) oncancel?.()
    }

    $effect(() => {
        if (!open || typeof window.matchMedia !== 'function') return
        const query = window.matchMedia(PHONE_QUERY)
        layout = query.matches ? 'phone' : 'wide'
        const onChange = (event: MediaQueryListEvent) => (layout = event.matches ? 'phone' : 'wide')
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    })

    // Open: register as the topmost shell, make the background inert, take first focus, and listen for keys on
    // window in the capture phase so Escape and Tab work whatever has focus. Close or destroy undoes all of it.
    $effect(() => {
        const shell = open ? dialog : undefined
        if (!shell) return
        const opener = untrack(() => trigger)
        const restoreInert = makeInert(untrack(() => background))
        const unregister = registerShell(token)
        const initial = shell.querySelector<HTMLElement>('[data-pattern-initial]') ?? shell
        initial.focus()
        const stopWatching = watchFocus(shell, shell,() => isTopmostShell(token))

        const onKeyDown = (event: KeyboardEvent) => {
            if (!isTopmostShell(token)) return
            if (event.key === 'Escape') {
                // Always consumed: if it reached the document-level hotkey handler after a cancel, that handler
                // would read the alert as idle and close an open settings panel.
                event.preventDefault()
                event.stopPropagation()
                if (!event.repeat && !event.isComposing) cancel()
                return
            }
            trapTab(event, shell)
        }
        window.addEventListener('keydown', onKeyDown, true)

        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            stopWatching()
            unregister()
            restoreInert()
            returnFocus(opener)
        }
    })
</script>

{#if open}
    <div data-part="pattern-layer" data-layout={layout} data-low-power={lowPower ? '' : undefined} data-part-critical>
        <!-- A tap on the scrim does nothing: a dialog is closed only by one of its own answers. -->
        <div data-part="pattern-scrim" data-part-critical aria-hidden="true"></div>
        <div
            bind:this={dialog}
            data-part="pattern-dialog"
            data-part-critical
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            tabindex="-1"
        >
            {@render children()}
        </div>
    </div>
{/if}
