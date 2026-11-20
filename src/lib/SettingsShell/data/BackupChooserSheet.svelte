<script lang="ts">
    import { language } from '../../../lang'
    import { backCloseHandler, registerBackHandler } from '../../../ts/backHandlers'
    import type { BackupChoice, BackupFormat, BackupScope } from '../../../ts/setting/dataSheets.svelte'
    import PatternDialog from '../../Nexus/pattern/PatternDialog.svelte'

    /**
     * The chooser of "Make a backup": a format group and, for `.bin`, a scope group. It answers once with the choice,
     * or `null` for Cancel, Escape and Back. Back answers through its own handler, because the dialog shell registers
     * none; Escape is the dialog shell's. A partial scope shows what it saves and what it does not, which replaces the
     * two explanation confirms of the legacy button.
     */
    interface Props {
        trigger?: HTMLElement | null
        background: readonly HTMLElement[]
        onanswer: (choice: BackupChoice | null) => void
    }

    let { trigger = null, background, onanswer }: Props = $props()

    const uid = $props.id()
    const headingId = `${uid}-heading`

    let format = $state<BackupFormat>('rtb')
    let scope = $state<BackupScope>('full')
    let answered = $state(false)

    // Scope applies to `.bin` only; a stale partial pick is dropped from the answer when `.rtb` is chosen.
    const scopeEnabled = $derived(format === 'bin')

    function answer(choice: BackupChoice | null): void {
        if (answered) return
        answered = true
        onanswer(choice)
    }

    function start(): void {
        answer({ format, scope: format === 'bin' ? scope : 'full' })
    }

    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => !answered,
        snapshot: () => answered,
        close: () => answer(null),
    })))
</script>

<PatternDialog labelId={headingId} cancelSafe={true} oncancel={() => answer(null)} {trigger} {background}>
    <div data-part="data-chooser-root">
        <h2 id={headingId} data-part="data-chooser-heading">{language.settingsShellDataMakeBackup}</h2>

        <fieldset data-part="data-chooser-format">
            <legend>{language.settingsShellDataFormat}</legend>
            <label>
                <input type="radio" name="{uid}-format" value="rtb" data-pattern-initial bind:group={format} />
                <span>{language.settingsShellDataFormatRtb}</span>
            </label>
            <p>{language.settingsShellDataFormatRtbHint}</p>
            <label>
                <input type="radio" name="{uid}-format" value="bin" bind:group={format} />
                <span>{language.settingsShellDataFormatBin}</span>
            </label>
            <p>{language.settingsShellDataFormatBinHint}</p>
        </fieldset>

        <fieldset data-part="data-chooser-scope" disabled={!scopeEnabled}>
            <legend>{language.settingsShellDataScope}</legend>
            <label>
                <input type="radio" name="{uid}-scope" value="full" disabled={!scopeEnabled} bind:group={scope} />
                <span>{language.settingsShellDataScopeFull}</span>
            </label>
            <label>
                <input type="radio" name="{uid}-scope" value="partial" disabled={!scopeEnabled} bind:group={scope} />
                <span>{language.settingsShellDataScopePartial}</span>
            </label>
            {#if !scopeEnabled}
                <p data-part="data-chooser-scope-note">{language.settingsShellDataScopeBinOnly}</p>
            {:else if scope === 'partial'}
                <p data-part="data-chooser-scope-note">{language.settingsShellDataScopePartialHint}</p>
            {/if}
        </fieldset>

        <div data-part="data-chooser-actions">
            <button type="button" class="pattern-button" data-part="data-chooser-cancel" onclick={() => answer(null)}>{language.cancel}</button>
            <button type="button" class="pattern-button" data-part="data-chooser-start" data-variant="confirm" onclick={start}>{language.settingsShellDataStart}</button>
        </div>
    </div>
</PatternDialog>

<style>
    [data-part="data-chooser-root"] { display: grid; gap: var(--pattern-warn-gap, 0.75rem); padding: var(--pattern-warn-padding, 1rem); color: var(--nexus-text); font-family: var(--font); }
    [data-part="data-chooser-heading"] { margin: 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
    fieldset { display: grid; gap: 0.25rem; margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: 0.25rem; font-weight: 600; }
    label { display: flex; align-items: center; gap: 0.5rem; min-height: var(--nexus-touch, 2.75rem); }
    input[type="radio"] { width: 1.25rem; height: 1.25rem; flex: none; accent-color: var(--pattern-fill-confirm); }
    p { margin: 0 0 0.5rem 1.75rem; color: var(--nexus-text-secondary); overflow-wrap: anywhere; }
    [data-part="data-chooser-scope-note"] { margin-left: 0; }
    fieldset:disabled { opacity: 0.7; }
    [data-part="data-chooser-actions"] { display: flex; gap: var(--pattern-warn-gap, 0.75rem); justify-content: flex-end; }
    [data-part="data-chooser-actions"] > :global(.pattern-button) { flex: 1 1 0; }
</style>
