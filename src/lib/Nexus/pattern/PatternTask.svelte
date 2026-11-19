<script lang="ts">
    import './pattern-task.css'
    import PatternDialog from './PatternDialog.svelte'
    import NexusStatusMark from '../brand/NexusStatusMark.svelte'
    import { language } from '../../../lang'
    import { createArmGuard, type ArmGuard } from './armGuard'
    import { armDelayMs, splitConsequences } from './patternWarning'
    import {
        TASK_SKIPS_SHOWN,
        isTaskTerminal,
        taskAmountText,
        taskAnnouncement,
        taskDeterminate,
        taskMarkStatus,
        taskStepStates,
        taskValueText,
        type TaskLabels,
        type TaskView,
    } from './taskProgress'

    interface Props {
        view: TaskView
        lowPower?: boolean
        /** Cancel was pressed (button, Escape or Back) while it is offered. */
        oncancel: () => void
        /** The result card was answered by OK, Escape, Back or one of its action buttons. */
        onanswer: (answer: { kind: 'ok' } | { kind: 'action', id: string }) => void
        /** The preflight's primary was pressed after its arm delay. */
        onconfirm?: () => void
        /** The preflight was declined by its Cancel button or Escape. */
        ondecline?: () => void
    }

    let { view, lowPower = false, oncancel, onanswer, onconfirm = () => { }, ondecline = () => { } }: Props = $props()

    const uid = $props.id()
    const titleId = `${uid}-title`
    const reasonId = `${uid}-reason`
    const headlineId = `${uid}-headline`
    const confirmHeadlineId = `${uid}-confirm-headline`
    const consequencesId = `${uid}-consequences`

    const labels = $derived<TaskLabels>({
        stepOf: language.patternTaskStepOf,
        fileOf: language.patternTaskFileOf,
        count: language.patternTaskCount,
        countFound: language.patternTaskCountFound,
        bytes: language.patternTaskBytes,
        cancelling: language.patternTaskCancelling,
        cancelledHeadline: language.patternTaskCancelled,
        skippedTitle: language.patternTaskSkippedTitle,
    })

    const confirming = $derived(view.state === 'confirm' && view.confirm !== undefined)
    const confirmParts = $derived(splitConsequences(view.confirm?.consequences))
    const terminal = $derived(isTaskTerminal(view.state))
    const cancelling = $derived(view.state === 'cancelling')
    const reasonShown = $derived(view.state === 'running' && !view.cancelOffered)
    const escapeActs = $derived(view.cancelOffered || terminal)
    const announcement = $derived(taskAnnouncement(view, labels))
    const valueText = $derived(taskValueText(view, labels))
    const amountText = $derived(taskAmountText(view, labels))
    const stepStates = $derived(taskStepStates(view))
    const determinate = $derived(taskDeterminate(view))
    const subtitle = $derived(
        [
            view.subtitle,
            view.file ? `${labels.fileOf(view.file.index + 1, view.file.total)}${view.file.name ? `: ${view.file.name}` : ''}` : undefined,
        ].filter(Boolean).join(' · '),
    )

    const outcome = $derived(view.state === 'failed' ? 'failed' : view.cancelled ? 'cancelled' : view.state)
    const headline = $derived(view.state === 'failed' ? (view.failure?.headline ?? '') : view.cancelled ? language.patternTaskCancelled : (view.result?.headline ?? ''))
    const summary = $derived(view.cancelled ? (view.result?.summary ?? [language.patternTaskNothingChanged]) : (view.result?.summary ?? []))
    const skipped = $derived(view.result?.skipped ?? view.failure?.skipped ?? [])
    const actions = $derived(view.result?.actions ?? view.failure?.actions ?? [])
    const dataLine = $derived.by(() => {
        const failure = view.failure
        if (!failure) return ''
        const base = failure.dataState === 'same'
            ? language.patternTaskDataSame
            : failure.dataState === 'partial'
                ? language.patternTaskDataPartial(failure.kept ?? 0, failure.failed ?? 0)
                : language.patternTaskDataUnknown
        return failure.detail ? `${base} ${failure.detail}` : base
    })

    let expanded = $state(false)
    const shownSkips = $derived(expanded ? skipped : skipped.slice(0, TASK_SKIPS_SHOWN))

    let headlineElement = $state<HTMLElement>()
    // The result headline takes focus when the task ends while the card is open; a card that mounts already ended takes it
    // through the dialog's initial-focus marker.
    $effect(() => {
        if (terminal && headlineElement) headlineElement.focus()
    })

    // Set once a confirm sheet has been rendered: the running card that follows fades in and guards its Cancel.
    let fromConfirm = $state(false)
    $effect(() => {
        if (confirming) fromConfirm = true
    })

    // The preflight's primary ignores input for the arm delay after the sheet mounts, by the click's own event time (see
    // armGuard). The guard starts again on every mount, so a card that yielded to an alert and came back is armed afresh.
    let primary = $state<HTMLButtonElement>()
    let confirmGuard: ArmGuard | null = null
    let confirmAnswered = false
    $effect(() => {
        const element = primary
        confirmAnswered = false
        confirmGuard = null
        if (!element) return
        const delay = armDelayMs(element)
        const guard = createArmGuard(performance.now(), delay)
        confirmGuard = guard
        const timer = setTimeout(() => guard.arm(), delay)
        return () => clearTimeout(timer)
    })

    function onPrimary(event: MouseEvent) {
        if (confirmAnswered || !confirmGuard?.accepts(event.timeStamp)) return
        confirmAnswered = true
        onconfirm()
    }

    // Holding Enter or Space must not confirm a sheet the user has not read.
    function onPrimaryKeydown(event: KeyboardEvent) {
        if (event.repeat) event.preventDefault()
    }

    // The task Cancel that replaces the primary at the swap ignores input for the same delay, so a double tap on the
    // primary cannot land on Cancel. A card that never showed a confirm has no guard.
    let taskCancel = $state<HTMLButtonElement>()
    let cancelGuard: ArmGuard | null = null
    $effect(() => {
        const element = taskCancel
        cancelGuard = null
        if (!element || !fromConfirm) return
        const delay = armDelayMs(element)
        const guard = createArmGuard(performance.now(), delay)
        cancelGuard = guard
        const timer = setTimeout(() => guard.arm(), delay)
        return () => clearTimeout(timer)
    })

    function onEscape() {
        if (terminal) onanswer({ kind: 'ok' })
        else oncancel()
    }

    function onCancelPress(event: MouseEvent) {
        if (cancelGuard && !cancelGuard.accepts(event.timeStamp)) return
        if (view.cancelOffered) oncancel()
    }
</script>

<PatternDialog
    role={confirming ? 'alertdialog' : 'dialog'}
    labelId={confirming ? confirmHeadlineId : titleId}
    descriptionId={confirming ? (confirmParts.shown.length > 0 ? consequencesId : undefined) : (reasonShown ? reasonId : undefined)}
    cancelSafe={confirming || escapeActs}
    oncancel={confirming ? ondecline : onEscape}
    {lowPower}
>
    <section
        data-part="pattern-task-root"
        data-part-critical
        role="group"
        aria-labelledby={confirming ? confirmHeadlineId : titleId}
        data-task-state={view.state}
        data-swap={fromConfirm && !confirming && !terminal ? 'in' : undefined}
        tabindex="-1"
    >
        {#if !confirming}
            <div data-part="pattern-task-head">
                <!-- No ring on the mark (MC-2353): it moves only as a sign of life, and the bar and count carry the progress. -->
                <div data-part="pattern-task-mark" aria-hidden="true">
                    <NexusStatusMark status={taskMarkStatus(view)} size={48} {lowPower} label={announcement} />
                    {#if view.state === 'done-with-skips'}
                        <span data-part="pattern-task-mark-badge">
                            <svg class="pattern-icon" data-part="pattern-task-mark-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v8M12 18h.01" /></svg>
                        </span>
                    {/if}
                </div>
                <div data-part="pattern-task-titles">
                    <h2 id={titleId} data-part="pattern-task-title">{view.title}</h2>
                    {#if subtitle}
                        <p data-part="pattern-task-subtitle">{subtitle}</p>
                    {/if}
                </div>
            </div>

            {#if !terminal}
                <ol data-part="pattern-task-steps" aria-label={language.patternTaskStepsLabel}>
                    {#each view.steps as step, index (index)}
                        <li
                            data-part="pattern-task-step"
                            data-step-state={stepStates[index]}
                            data-near={Math.abs(index - view.stepIndex) <= 1 ? '' : undefined}
                            aria-current={stepStates[index] === 'now' ? 'step' : undefined}
                            style:--i={index}
                        >
                            <span data-part="pattern-task-step-icon" aria-hidden="true">
                                <span data-glyph="next"></span>
                                <span data-glyph="now"></span>
                                <span data-glyph="done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
                                <span data-glyph="failed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg></span>
                            </span>
                            <span data-part="pattern-task-step-label">{step.label}</span>
                        </li>
                    {/each}
                </ol>

                <div
                    data-part="pattern-task-bar"
                    role="progressbar"
                    aria-label={language.patternTaskProgressLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(view.fraction * 100)}
                    aria-valuetext={valueText}
                    data-task-state={view.state}
                    data-task-mode={determinate ? 'determinate' : 'indeterminate'}
                    data-low-power={lowPower ? '' : undefined}
                    style:--p-fill={view.fraction}
                    style:--p-index={view.stepIndex}
                    style:--p-steps={view.steps.length}
                >
                    <div data-part="pattern-task-bar-fill"></div>
                    {#if !determinate}
                        <div data-part="pattern-task-bar-sweep"></div>
                    {/if}
                    <div data-part="pattern-task-bar-ticks"></div>
                </div>
                <!-- Counts reach assistive technology through aria-valuetext only; this line is visual. -->
                <p data-part="pattern-task-count" aria-hidden="true">{amountText}</p>
                <p data-part="pattern-task-slow" aria-hidden="true" data-visible={view.slow ? '' : undefined}>{language.patternTaskSlowHint}</p>
            {/if}
        {/if}

        <!-- The one live region: its text changes only on a step, file or state change. It stays mounted through the
             confirm swap and holds no text while the sheet is up. -->
        <p data-part="pattern-task-status" role="status" aria-live="polite" class:sr-only={terminal || confirming}>{announcement}</p>

        {#if confirming && view.confirm}
            <div data-part="pattern-warn-root" data-part-critical data-form="sheet" data-pattern-severity="confirm">
                <span data-part="pattern-warn-mark" data-part-critical aria-hidden="true">
                    <svg class="pattern-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="5" /><path d="m8 12 3 3 5-6" />
                    </svg>
                </span>
                <h2 id={confirmHeadlineId} data-part="pattern-warn-headline" data-part-critical>{view.confirm.headline}</h2>
                {#if confirmParts.shown.length > 0}
                    <ul id={consequencesId} data-part="pattern-warn-consequences" data-part-critical>
                        {#each confirmParts.shown as line, index (index)}
                            <li data-part="pattern-warn-consequence" data-part-critical style:--i={index}>{line}</li>
                        {/each}
                    </ul>
                {/if}
                <div data-part="pattern-warn-actions" data-part-critical data-count="2">
                    <button type="button" class="pattern-button" data-part="pattern-warn-cancel" data-part-critical data-pattern-initial onclick={() => ondecline()}>{view.confirm.cancelLabel}</button>
                    <button
                        bind:this={primary}
                        type="button"
                        class="pattern-button"
                        data-part="pattern-warn-primary"
                        data-part-critical
                        data-variant="confirm"
                        onclick={onPrimary}
                        onkeydown={onPrimaryKeydown}
                    >{view.confirm.primaryLabel}</button>
                </div>
            </div>
        {:else if !terminal}
            <div data-part="pattern-task-actions">
                {#if view.cancelOffered || cancelling}
                    <button
                        bind:this={taskCancel}
                        type="button"
                        class="pattern-button"
                        data-part="pattern-task-cancel"
                        aria-disabled={cancelling ? 'true' : undefined}
                        onclick={onCancelPress}
                    >{language.cancel}</button>
                {:else}
                    <p id={reasonId} data-part="pattern-task-cancel-reason">{view.lockReason ?? language.patternTaskCancelUnsafe}</p>
                {/if}
            </div>
        {:else}
            <div data-part="pattern-task-result" role="group" aria-labelledby={headlineId} data-outcome={outcome}>
                <h3 id={headlineId} bind:this={headlineElement} data-part="pattern-task-result-headline" tabindex="-1" data-pattern-initial>{headline}</h3>
                {#each summary as line, index (index)}
                    <p data-part="pattern-task-result-summary">{line}</p>
                {/each}
                {#if view.state === 'failed'}
                    <p data-part="pattern-task-result-data">{dataLine}</p>
                {/if}
                {#if skipped.length > 0}
                    <section data-part="pattern-task-result-skipped" aria-label={labels.skippedTitle(skipped.length)}>
                        <h4>{labels.skippedTitle(skipped.length)}</h4>
                        <ul>
                            {#each shownSkips as skip, index (index)}
                                <li data-part="pattern-task-result-skip">
                                    <span data-part="pattern-task-result-skip-name">{skip.name}</span>
                                    <span data-part="pattern-task-result-skip-reason">{skip.reason}</span>
                                </li>
                            {/each}
                        </ul>
                        {#if skipped.length > TASK_SKIPS_SHOWN}
                            <button
                                type="button"
                                class="pattern-button"
                                data-part="pattern-task-result-more"
                                aria-expanded={expanded}
                                onclick={() => (expanded = !expanded)}
                            >{expanded ? language.patternTaskShowLess : language.patternWarningMore(skipped.length - TASK_SKIPS_SHOWN)}</button>
                        {/if}
                    </section>
                {/if}
                <div data-part="pattern-task-result-actions">
                    {#each actions as action (action.id)}
                        <button type="button" class="pattern-button" data-part="pattern-task-result-action" data-variant="secondary" onclick={() => onanswer({ kind: 'action', id: action.id })}>{action.label}</button>
                    {/each}
                    <button type="button" class="pattern-button" data-part="pattern-task-result-ok" data-variant="confirm" onclick={() => onanswer({ kind: 'ok' })}>{language.alertComp.ok}</button>
                </div>
            </div>
        {/if}
    </section>
</PatternDialog>
