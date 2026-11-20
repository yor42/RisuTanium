<script lang="ts">
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { isImeComposing } from 'src/ts/ime/compositionGuard'
    import PatternDialog from '../Nexus/pattern/PatternDialog.svelte'

    /**
     * The masked password prompt of the encrypted `.rtb` restore. It answers once with the text exactly as typed, or `null`
     * for Cancel, Escape and Back. Escape is the dialog shell's; Back answers through this prompt's own handler, because the
     * shell registers none. The prompt takes first focus into its field on open and moves focus nowhere on close.
     */
    interface Props {
        message: string
        /** Elements made inert while the prompt is open. */
        background?: readonly HTMLElement[]
        /** Called once: the password exactly as typed, or `null` for Cancel, Escape and Back. */
        onanswer: (password: string | null) => void
    }

    let { message, background = [], onanswer }: Props = $props()

    const uid = $props.id()
    const headingId = `${uid}-heading`

    let value = $state('')
    let shown = $state(false)
    let answered = $state(false)
    let field: HTMLInputElement | undefined = $state()

    function answer(password: string | null) {
        if (answered) {
            return
        }
        answered = true
        onanswer(password)
    }

    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => !answered,
        snapshot: () => answered,
        close: () => answer(null),
    })))

    // A key sent while an IME composition is live belongs to the composition: it does not submit.
    // There is no time window after compositionend, so the Enter that follows a composition end submits the text.
    function onFieldKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter' && event.target === field && !isImeComposing(event)) {
            event.preventDefault()
            answer(value)
        }
    }
</script>

<PatternDialog
    labelId={headingId}
    cancelSafe={true}
    oncancel={() => answer(null)}
    trigger={null}
    {background}
>
    <div data-part="password-prompt-root" data-part-critical>
        <h2 id={headingId} data-part="password-prompt-heading" data-part-critical>{message}</h2>
        <label data-part="password-prompt-field-label" data-part-critical>
            <span>{language.rtbRestorePasswordLabel}</span>
            <input
                bind:this={field}
                bind:value={value}
                data-part="password-prompt-field"
                data-part-critical
                data-pattern-initial
                type={shown ? 'text' : 'password'}
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                onkeydown={onFieldKeydown}
            />
        </label>
        <label data-part="password-prompt-show" data-part-critical>
            <input type="checkbox" bind:checked={shown} />
            <span>{language.rtbRestorePasswordShow}</span>
        </label>
        <div data-part="password-prompt-actions" data-part-critical>
            <button type="button" class="pattern-button" data-part="password-prompt-cancel" data-part-critical onclick={() => answer(null)}>{language.cancel}</button>
            <button type="button" class="pattern-button" data-part="password-prompt-ok" data-part-critical data-variant="confirm" onclick={() => answer(value)}>{language.alertComp.ok}</button>
        </div>
    </div>
</PatternDialog>

<style>
    [data-part="password-prompt-root"] { display: grid; gap: var(--pattern-warn-gap, 0.75rem); padding: var(--pattern-warn-padding, 1rem); color: var(--nexus-text); font-family: var(--font); }
    [data-part="password-prompt-heading"] { margin: 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; white-space: pre-wrap; }
    [data-part="password-prompt-field-label"] { display: grid; gap: 0.25rem; color: var(--nexus-text-secondary); }
    [data-part="password-prompt-field"] { min-height: var(--nexus-touch, 2.75rem); padding: 0 0.75rem; color: var(--nexus-text); background: var(--nexus-surface-flat); border: 1px solid var(--nexus-field-border); border-radius: var(--radius-field); font: inherit; }
    [data-part="password-prompt-field"]:focus-visible { outline: var(--nexus-focus-ring-width, 2px) solid var(--nexus-ring); outline-offset: var(--nexus-focus-ring-offset, 2px); }
    [data-part="password-prompt-show"] { display: flex; align-items: center; gap: 0.5rem; min-height: var(--nexus-touch, 2.75rem); }
    [data-part="password-prompt-show"] > input { width: 1.25rem; height: 1.25rem; flex: none; accent-color: var(--pattern-fill-confirm); }
    [data-part="password-prompt-actions"] { display: flex; gap: var(--pattern-warn-gap, 0.75rem); justify-content: flex-end; }
    [data-part="password-prompt-actions"] > :global(.pattern-button) { flex: 1 1 0; }
</style>
