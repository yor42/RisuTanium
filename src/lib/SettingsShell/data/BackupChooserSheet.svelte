<script lang="ts">
    import { language } from '../../../lang'
    import { backCloseHandler, registerBackHandler } from '../../../ts/backHandlers'
    import { backupPasswordProblem, encryptionIsSlow, type BackupPasswordProblem } from '../../../ts/setting/backupPassword'
    import type { BackupChoice, BackupFormat, BackupScope } from '../../../ts/setting/dataSheets.svelte'
    import PatternDialog from '../../Nexus/pattern/PatternDialog.svelte'

    /**
     * The chooser of "Make a backup": a format group and, for `.bin`, a scope group. It answers once with the choice,
     * or `null` for Cancel, Escape and Back. Back answers through its own handler, because the dialog shell registers
     * none; Escape is the dialog shell's. A partial scope shows what it saves and what it does not, which replaces the
     * two explanation confirms of the legacy button. A `.rtb` can be sealed with a password typed twice here; the
     * password lives only in this component's runes and in the answer, and Enter in its fields does nothing.
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
    let encrypt = $state(false)
    let first = $state('')
    let second = $state('')
    let shown = $state(false)
    let problem = $state<BackupPasswordProblem | null>(null)
    let firstField = $state<HTMLInputElement>()
    let secondField = $state<HTMLInputElement>()
    const slow = encryptionIsSlow()
    const problemId = `${uid}-problem`

    // Scope applies to `.bin` only; a stale partial pick is dropped from the answer when `.rtb` is chosen.
    const scopeEnabled = $derived(format === 'bin')

    function answer(choice: BackupChoice | null): void {
        if (answered) return
        answered = true
        onanswer(choice)
    }

    // A bad password keeps the sheet open: one line says why, the field concerned is marked and focused, and the typed
    // text stays.
    function start(): void {
        if (format === 'bin') {
            answer({ format: 'bin', scope })
            return
        }
        if (!encrypt) {
            answer({ format: 'rtb', scope: 'full' })
            return
        }
        problem = backupPasswordProblem(first, second)
        if (problem === null) {
            answer({ format: 'rtb', scope: 'full', password: first })
        } else {
            (problem === 'unusable' ? firstField : secondField)?.focus()
        }
    }

    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => !answered,
        snapshot: () => answered,
        close: () => answer(null),
    })))
</script>

<PatternDialog labelId={headingId} announce={language.settingsShellDataMakeBackup} cancelSafe={true} oncancel={() => answer(null)} {trigger} {background}>
    <div data-part="data-chooser-root">
        <h2 id={headingId} data-part="data-chooser-heading">{language.settingsShellDataMakeBackup}</h2>

        <fieldset data-part="data-chooser-format">
            <legend>{language.settingsShellDataFormat}</legend>
            <label>
                <input type="radio" name="{uid}-format" value="rtb" data-pattern-initial bind:group={format} />
                <span>{language.settingsShellDataFormatRtb}</span>
            </label>
            <p>{language.settingsShellDataFormatRtbHint}</p>
            <div data-part="data-chooser-encrypt">
                <label>
                    <input type="checkbox" data-part="data-chooser-encrypt-toggle" disabled={format !== 'rtb'} bind:checked={encrypt} />
                    <span>{language.settingsShellDataEncrypt}</span>
                </label>
                {#if slow}
                    <p data-part="data-chooser-encrypt-slow">{language.settingsShellDataEncryptSlow}</p>
                {/if}
                {#if format === 'rtb' && encrypt}
                    <label data-part="data-chooser-password-label">
                        <span>{language.rtbRestorePasswordLabel}</span>
                        <input
                            bind:this={firstField}
                            bind:value={first}
                            data-part="data-chooser-password"
                            type={shown ? 'text' : 'password'}
                            autocomplete="off"
                            autocapitalize="off"
                            autocorrect="off"
                            spellcheck="false"
                            aria-invalid={problem === 'unusable' ? 'true' : undefined}
                            aria-describedby={problem === 'unusable' ? problemId : undefined}
                        />
                    </label>
                    <label data-part="data-chooser-password-label">
                        <span>{language.settingsShellDataEncryptAgain}</span>
                        <input
                            bind:this={secondField}
                            bind:value={second}
                            data-part="data-chooser-password-again"
                            type={shown ? 'text' : 'password'}
                            autocomplete="off"
                            autocapitalize="off"
                            autocorrect="off"
                            spellcheck="false"
                            aria-invalid={problem === 'mismatch' ? 'true' : undefined}
                            aria-describedby={problem === 'mismatch' ? problemId : undefined}
                        />
                    </label>
                    <label>
                        <input type="checkbox" data-part="data-chooser-password-show" bind:checked={shown} />
                        <span>{language.rtbRestorePasswordShow}</span>
                    </label>
                    <p data-part="data-chooser-encrypt-warning">{language.settingsShellDataEncryptWarning}</p>
                    {#if problem !== null}
                        <p id={problemId} data-part="data-chooser-password-problem">{problem === 'unusable' ? language.rtbRestorePasswordUnusable : language.settingsShellDataEncryptMismatch}</p>
                    {/if}
                {/if}
            </div>
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
    [data-part="data-chooser-encrypt"] { display: grid; gap: 0.25rem; margin-left: 1.75rem; min-width: 0; }
    [data-part="data-chooser-encrypt"] p { margin: 0 0 0.25rem 0; }
    [data-part="data-chooser-encrypt"] input[type="checkbox"] { width: 1.25rem; height: 1.25rem; flex: none; accent-color: var(--pattern-fill-confirm); }
    [data-part="data-chooser-password-label"] { display: grid; gap: 0.25rem; align-items: stretch; color: var(--nexus-text-secondary); }
    [data-part="data-chooser-password-label"] > input { min-height: var(--nexus-touch, 2.75rem); padding: 0 0.75rem; color: var(--nexus-text); background: var(--nexus-surface-flat); border: 1px solid var(--nexus-field-border); border-radius: var(--radius-field); font: inherit; }
    [data-part="data-chooser-password-label"] > input[aria-invalid="true"] { border-color: var(--pattern-fill-danger, currentColor); }
    [data-part="data-chooser-password-label"] > input:focus-visible { outline: var(--nexus-focus-ring-width, 2px) solid var(--nexus-ring); outline-offset: var(--nexus-focus-ring-offset, 2px); }
    [data-part="data-chooser-password-problem"] { color: var(--nexus-text); font-weight: 600; }
    fieldset:disabled { opacity: 0.7; }
    [data-part="data-chooser-actions"] { display: flex; gap: var(--pattern-warn-gap, 0.75rem); justify-content: flex-end; }
    [data-part="data-chooser-actions"] > :global(.pattern-button) { flex: 1 1 0; }
</style>
