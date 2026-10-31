<script lang="ts">
    import { untrack } from 'svelte'
    import PatternDialog from './PatternDialog.svelte'
    import { armDelayMs, assertWarningActions, firstFocusAction, splitConsequences, type PatternAnswer, type PatternWarningDef } from './patternWarning'

    interface Props {
        def: PatternWarningDef
        /** Called once with the answer; later presses are ignored. */
        onanswer: (answer: PatternAnswer) => void
        trigger?: HTMLElement | null
        background?: readonly HTMLElement[]
        lowPower?: boolean
        /** Disclosure labels, already translated. */
        labels?: { details?: string, more?: (count: number) => string }
    }

    let { def, onanswer, trigger = null, background = [], lowPower = false, labels = {} }: Props = $props()

    // A sheet without the actions it needs throws rather than trapping the user.
    $effect.pre(() => assertWarningActions(def))

    const uid = $props.id()
    const headlineId = `${uid}-headline`
    const consequencesId = `${uid}-consequences`
    const detailId = `${uid}-detail`

    const parts = $derived(splitConsequences(def.consequences))
    const detailLines = $derived(def.detail ?? [])
    const hasDisclosure = $derived(parts.folded.length > 0 || detailLines.length > 0)
    const toggleLabel = $derived(parts.folded.length > 0 ? (labels.more ?? ((count: number) => `${count} more`))(parts.folded.length) : (labels.details ?? 'Details'))
    const initialAction = $derived(firstFocusAction(def.actions))
    const actionCount = $derived([def.actions.cancel, def.actions.secondary, def.actions.primary].filter(Boolean).length)

    let expanded = $state(false)
    let acknowledged = $state(false)
    let primary = $state<HTMLButtonElement>()

    // The primary of a danger sheet ignores input for the arm delay after opening.
    let armed = false
    let answered = false
    $effect(() => {
        answered = false
        const element = primary
        if (def.severity !== 'danger' || !element) {
            armed = true
            return
        }
        armed = false
        const timer = setTimeout(() => (armed = true), armDelayMs(element))
        return () => clearTimeout(timer)
    })

    function answer(value: PatternAnswer) {
        if (answered) return
        answered = true
        onanswer(value)
    }

    const gated = $derived(!!def.ack && !acknowledged)

    function onPrimary() {
        if (gated || !armed) return
        answer('confirm')
    }

    // Holding Enter or Space must not confirm a sheet the user has not read.
    function onPrimaryKeydown(event: KeyboardEvent) {
        if (event.repeat) event.preventDefault()
    }
</script>

<PatternDialog
    labelId={headlineId}
    descriptionId={parts.shown.length > 0 ? consequencesId : undefined}
    cancelSafe={!!def.actions.cancel}
    oncancel={() => answer('cancel')}
    {trigger}
    {background}
    {lowPower}
>
    <div data-part="pattern-warn-root" data-part-critical data-form="sheet" data-pattern-severity={def.severity}>
        <span data-part="pattern-warn-mark" data-part-critical aria-hidden="true">
            <svg class="pattern-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#if def.severity === 'notice'}
                    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
                {:else if def.severity === 'caution'}
                    <path d="M12 3 22 20H2Z" /><path d="M12 10v4M12 17h.01" />
                {:else if def.severity === 'confirm'}
                    <rect x="3" y="3" width="18" height="18" rx="5" /><path d="m8 12 3 3 5-6" />
                {:else if def.severity === 'danger'}
                    <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8Z" /><path d="M12 7v6M12 16.5h.01" />
                {:else}
                    <circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" />
                {/if}
            </svg>
        </span>
        <h2 id={headlineId} data-part="pattern-warn-headline" data-part-critical>{def.headline}</h2>

        {#if parts.shown.length > 0}
            <ul id={consequencesId} data-part="pattern-warn-consequences" data-part-critical>
                {#each parts.shown as line, index (index)}
                    <li data-part="pattern-warn-consequence" data-part-critical style:--i={index}>{line}</li>
                {/each}
            </ul>
        {/if}

        {#if hasDisclosure}
            <button
                type="button"
                class="pattern-button"
                data-part="pattern-warn-detail-toggle"
                data-part-critical
                aria-expanded={expanded}
                aria-controls={detailId}
                onclick={() => (expanded = !expanded)}
            >
                <svg class="pattern-icon" data-part="pattern-warn-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                {toggleLabel}
            </button>
            <div id={detailId} data-part="pattern-warn-detail" hidden={!expanded}>
                {#if parts.folded.length > 0}
                    <ul>
                        {#each parts.folded as line, index (index)}
                            <li>{line}</li>
                        {/each}
                    </ul>
                {/if}
                {#each detailLines as line, index (index)}
                    <p>{line}</p>
                {/each}
            </div>
        {/if}

        {#if def.undoLine}
            <p data-part="pattern-warn-undo" data-part-critical>{def.undoLine}</p>
        {/if}

        {#if def.ack}
            <label data-part="pattern-warn-ack" data-part-critical>
                <input type="checkbox" class="pattern-ack-box" bind:checked={acknowledged} />
                <span>{def.ack}</span>
            </label>
        {/if}

        <div data-part="pattern-warn-actions" data-part-critical data-count={actionCount}>
            {#if def.actions.cancel}
                <button type="button" class="pattern-button" data-part="pattern-warn-cancel" data-part-critical data-pattern-initial={initialAction === 'cancel' ? '' : undefined} onclick={() => answer('cancel')}>{def.actions.cancel}</button>
            {/if}
            {#if def.actions.secondary}
                <button type="button" class="pattern-button" data-part="pattern-warn-secondary" data-part-critical data-variant="secondary" data-pattern-initial={initialAction === 'secondary' ? '' : undefined} onclick={() => answer('secondary')}>{def.actions.secondary}</button>
            {/if}
            {#if def.actions.primary}
                <button
                    bind:this={primary}
                    type="button"
                    class="pattern-button"
                    data-part="pattern-warn-primary"
                    data-part-critical
                    data-variant={def.severity === 'danger' ? 'danger' : 'confirm'}
                    data-pattern-initial={initialAction === 'confirm' ? '' : undefined}
                    aria-disabled={gated ? 'true' : undefined}
                    onclick={onPrimary}
                    onkeydown={onPrimaryKeydown}
                >{def.actions.primary}</button>
            {/if}
        </div>
    </div>
</PatternDialog>
