<script lang="ts">
    import { tick } from 'svelte'
    import { language } from '../../lang'
    import { backToPrevious, retrySwitch, switchTarget } from '../../ts/chatShell/switchTarget.svelte'

    interface Props {
        /** Where focus goes when the frame goes away while it held focus. */
        transcript?: HTMLElement
    }

    let { transcript }: Props = $props()
    // The derived value changes only when a switch starts or ends, so a loading -> failed change keeps the frame as it is.
    let pending = $derived(switchTarget.phase !== 'idle')
    let loading = $derived(switchTarget.phase === 'loading')
    let skeleton = $state(false)
    let root = $state<HTMLElement>()
    // Not reactive: set by focus events, read when the frame goes. A removed element fires no focusout.
    let holdsFocus = false

    // The skeleton is for switches that take long enough to be noticed; a quick one shows only the named, focusable frame.
    $effect(() => {
        skeleton = false
        if (!loading) return
        const timer = setTimeout(() => { skeleton = true }, 300)
        return () => clearTimeout(timer)
    })

    // The frame removes the controls that held focus, so focus goes back to the transcript instead of the body.
    $effect(() => {
        if (!pending) return
        return () => {
            if (!holdsFocus) return
            holdsFocus = false
            void restoreFocus()
        }
    })

    async function restoreFocus(): Promise<void> {
        await tick()
        const active = document.activeElement
        if (!active || active === document.body) transcript?.focus({ preventScroll: true })
    }

    function retry(): void {
        root?.focus({ preventScroll: true })
        void retrySwitch()
    }
</script>

{#if pending}
    <div bind:this={root} data-part="chat-switch-frame" tabindex="-1" role="group" aria-label={loading ? language.chatShellLoadingChat : language.chatShellLoadFailed} aria-busy={loading} onfocusin={() => holdsFocus = true} onfocusout={() => holdsFocus = false}>
        {#if loading}
            {#if skeleton}
                <div data-part="chat-switch-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
                <p data-part="chat-switch-text">{language.chatShellLoadingChat}</p>
            {/if}
        {:else}
            <p data-part="chat-switch-text" role="status">{language.chatShellLoadFailed}</p>
            <div data-part="chat-switch-actions">
                <button type="button" data-part="chat-switch-retry" data-kind="button" onclick={retry}>{language.chatShellRetry}</button>
                <button type="button" data-part="chat-switch-back" data-kind="button" onclick={backToPrevious}>{language.chatShellBackToPrevious}</button>
            </div>
        {/if}
    </div>
{/if}

<style>
    [data-part="chat-switch-frame"] { position: absolute; inset: var(--header-height) 0 0 0; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: var(--space-7); padding: var(--space-12); pointer-events: none; outline: none; color: var(--nexus-text-secondary); }
    [data-part="chat-switch-skeleton"] { width: 100%; max-width: var(--sheet-width-wide); display: flex; flex-direction: column; gap: var(--space-7); }
    [data-part="chat-switch-skeleton"] span { display: block; height: 3rem; border-radius: 0.5rem; background: var(--nexus-edge); opacity: 0.5; }
    [data-part="chat-switch-text"] { text-align: center; }
    [data-part="chat-switch-actions"] { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-7); pointer-events: auto; }
    [data-part="chat-switch-actions"] button { min-height: var(--size-touch); padding: 0 var(--space-12); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: 0.5rem; }
</style>
