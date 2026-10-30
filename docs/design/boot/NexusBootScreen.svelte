<script lang="ts">
    import './nexus-boot.css'
    import { untrack } from 'svelte'
    import NexusStatusMark from '../brand/NexusStatusMark.svelte'
    import { bootAnnouncement, bootFraction, bootLabel, bootMarkStatus, bootStateWithNotice, bootSteps, type BootNotice, type BootProgress } from './bootProgress'

    interface Props {
        progress: BootProgress
        /** Inline boot notice; see BootNotice. A normal or error notice also sets the shown state to waiting. */
        notice?: BootNotice
        /** Drops the glow, the sweep and the mark's repeated layers for mobile and constrained webviews. */
        lowPower?: boolean
        /** Shown under the bar after a step has run for `slowAfterMs`; already translated. */
        slowHint?: string
        slowAfterMs?: number
    }

    let { progress, notice, lowPower = false, slowHint = 'Large libraries can take a minute.', slowAfterMs = 8000 }: Props = $props()

    // What the screen shows: the boot state, unless a notice pauses it (review F-2d). A failed boot stays failed.
    const shownProgress = $derived<BootProgress>({ ...progress, state: bootStateWithNotice(progress.state, notice) })
    const index = $derived(bootSteps.indexOf(shownProgress.step))
    const label = $derived(bootLabel(shownProgress))
    const announcement = $derived(bootAnnouncement(shownProgress))
    // The bar only grows: a count that restarts, or a step reported again, never moves it back.
    let shown = $state(0)
    $effect.pre(() => {
        const next = bootFraction(progress)
        if (next > untrack(() => shown)) shown = next
    })

    let slow = $state(false)
    $effect(() => {
        // Restarts whenever the step changes.
        void progress.step
        slow = false
        const timer = setTimeout(() => (slow = true), slowAfterMs)
        return () => clearTimeout(timer)
    })

    const counted = $derived(progress.count ? ` ${progress.count.done} / ${progress.count.total}` : '')
    const valueText = $derived(`Step ${index + 1} of ${bootSteps.length}: ${label}${progress.detail ? '' : counted}`)

    // Nothing else on the boot screen is interactive, so focus goes to the notice's action, as it would in the
    // alert modal (review N-11). Re-runs only when a different notice arrives.
    let action = $state<HTMLButtonElement>()
    $effect(() => {
        void notice
        untrack(() => action)?.focus()
    })
</script>

{#snippet card(n: BootNotice)}
    <div class="nexus-surface-raised flex flex-col gap-3 rounded-2xl p-4 text-sm text-nexus-text">
        <p class="m-0 whitespace-pre-wrap" class:text-[#ff6b81]={n.kind === 'error'}>{n.message}</p>
        {#if n.detail}
            <!-- alertError's submsg, such as the network-fetch help text (review F-2a). -->
            <p class="m-0 whitespace-pre-wrap text-nexus-text-secondary">{n.detail}</p>
        {/if}
        {#if n.stackTrace}
            <details class="text-nexus-text-secondary">
                <summary class="nexus-focus w-fit cursor-pointer rounded-md">Technical details</summary>
                <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{n.stackTrace}</pre>
            </details>
        {/if}
        {#if n.onDismiss || (n.kind === 'wait' && n.onCancel)}
            <div class="flex justify-end">
                {#if n.kind === 'wait' && n.onCancel}
                    <button bind:this={action} class="nexus-surface-raised nexus-focus rounded-xl px-3.5 py-2 text-nexus-text" onclick={n.onCancel}>{n.cancelLabel ?? 'Cancel'}</button>
                {:else if n.onDismiss}
                    <button bind:this={action} class="nexus-surface-raised nexus-focus rounded-xl px-3.5 py-2 text-nexus-text" onclick={n.onDismiss}>{n.dismissLabel ?? 'OK'}</button>
                {/if}
            </div>
        {/if}
    </div>
{/snippet}

<div class="nexus-canvas flex h-full w-full flex-col items-center justify-center gap-7 px-4" class:nexus-low-power={lowPower}>
    <div class="flex flex-col items-center gap-4">
        <NexusStatusMark status={bootMarkStatus(shownProgress)} label={announcement} size={112} {lowPower} />
        <span class="text-2xl font-semibold tracking-wide text-nexus-text" aria-hidden="true">RisuTanium</span>
    </div>

    <div class="flex w-full max-w-sm flex-col gap-2.5">
        <div
            class="nexus-boot-bar"
            role="progressbar"
            aria-label="Starting RisuTanium"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(shown * 100)}
            aria-valuetext={valueText}
            data-state={shownProgress.state}
            data-low-power={lowPower ? '' : undefined}
            style:--nexus-boot-fill={shown}
            style:--nexus-boot-index={index}
            style:--nexus-boot-steps={bootSteps.length}
        >
            <div class="nexus-boot-fill"></div>
            {#if !progress.count || shownProgress.state === 'failed'}
                <div class="nexus-boot-sweep"></div>
            {/if}
            <div class="nexus-boot-ticks"></div>
        </div>
        <!-- The mark's role=status announces step and state changes; counts are read from aria-valuetext. This copy is visual only. -->
        <div class="flex justify-between gap-3 text-sm text-nexus-text-secondary" aria-hidden="true">
            <span class="truncate">{label}</span>
            <span class="shrink-0 tabular-nums">{index + 1} / {bootSteps.length}</span>
        </div>
        <!-- Space is kept so the centred column does not jump when the hint appears. No hint while a notice is up. -->
        <p class="m-0 text-sm text-nexus-text-muted" class:invisible={!(slow && shownProgress.state === 'running' && !notice)}>{slowHint}</p>
        <!--
            Both live regions stay mounted, empty until a notice arrives, so screen readers announce the card when it
            is inserted (review N-11). Errors interrupt; other notices are polite.
        -->
        <div role="alert">
            {#if notice && notice.kind === 'error'}{@render card(notice)}{/if}
        </div>
        <div role="status">
            {#if notice && notice.kind !== 'error'}{@render card(notice)}{/if}
        </div>
    </div>
</div>
