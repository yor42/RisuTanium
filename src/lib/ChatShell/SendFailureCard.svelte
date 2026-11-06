<script lang="ts">
    import { tick } from 'svelte'
    import { language } from '../../lang'
    import { fixPending } from '../Setting/settingsRoute'
    import type { SendFailure } from '../../ts/chatShell/sendFailure.svelte'

    interface Props {
        failure: SendFailure
        onfix: () => void
        onretry: () => void
    }
    let { failure, onfix, onretry }: Props = $props()
    let retryButton = $state<HTMLButtonElement>()

    let reason = $derived(failure.reason === 'model' ? language.chatShellFailReasonModel : language.chatShellFailReasonKey)

    // Settings closed after the Fix route: the chat takes focus back on Try again, whether this card was mounted all
    // along or mounts after the chat came back. The request is consumed so a later card does not take focus.
    $effect(() => {
        if (!$fixPending || !retryButton) return
        const button = retryButton
        fixPending.set(false)
        void tick().then(() => button.focus({ preventScroll: true }))
    })
</script>

<div data-part="chat-failed-card" data-part-critical role="alert" data-reason={failure.reason}>
    <p data-part="chat-critical-body" data-line><span class="sr-only">{language.chatShellFailedReply}: </span>{reason}</p>
    {#if failure.provider}<p data-part="chat-critical-body" data-detail>{language.chatShellFailDetail(failure.provider)}</p>{/if}
    <div data-line="actions">
        {#if failure.fix}<button type="button" data-part="chat-critical-action" data-action="fix" onclick={onfix}>{language.chatShellFailFix}</button>{/if}
        <button bind:this={retryButton} type="button" data-part="chat-critical-action" data-action="retry" onclick={onretry}>{language.chatShellFailRetry}</button>
    </div>
</div>

<style>
    [data-part="chat-failed-card"] { margin: var(--space-7) var(--space-7) 0; padding: var(--space-10) var(--space-10) var(--space-7); border: 1px solid var(--color-danger-edge); border-radius: var(--radius-8); background: var(--color-danger-tint); color: var(--nexus-text); }
    [data-part="chat-failed-card"] p { margin: 0; line-height: var(--leading-145); overflow-wrap: anywhere; }
    [data-part="chat-failed-card"] p[data-line] { font-weight: var(--font-weight-semibold); }
    [data-part="chat-failed-card"] p[data-detail] { margin-top: var(--space-1); font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
    [data-part="chat-failed-card"] [data-line="actions"] { display: flex; flex-wrap: wrap; gap: var(--space-7); margin-top: var(--space-8); }
    [data-part="chat-critical-action"] { min-width: var(--size-touch); min-height: var(--size-touch); padding: 0 var(--space-11); border: 1px solid var(--nexus-edge-strong); color: var(--nexus-text); font-size: var(--font-size-md); }
    [data-part="chat-critical-action"][data-action="fix"] { color: var(--nexus-accent); }
    [data-part="chat-critical-action"]:focus-visible { outline: var(--focus-ring-w) solid var(--nexus-ring); outline-offset: var(--focus-ring-offset-inset); }
    @media (forced-colors: active) {
        [data-part="chat-failed-card"] { border: var(--stroke-bold) solid CanvasText; background: Canvas; }
        [data-part="chat-critical-action"] { border: 1px solid CanvasText; background: Canvas; }
        [data-part="chat-critical-action"][data-action="fix"] { color: LinkText; }
    }
</style>
