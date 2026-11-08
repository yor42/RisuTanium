<script module lang="ts">
    import { language } from '../../lang'
    import type { HomeMode } from '../../ts/storage/homeModes'

    export function modeName(mode: HomeMode): string {
        if (mode === 'rp') return language.settingsShellModesNameRp
        if (mode === 'hybrid') return language.settingsShellModesNameHybrid
        return language.settingsShellModesNameUtility
    }

    export function modeNames(modes: readonly HomeMode[]): string {
        return modes.map(modeName).join(', ')
    }

    function modeDescription(mode: HomeMode): string {
        if (mode === 'rp') return language.settingsShellModesDescRp
        if (mode === 'hybrid') return language.settingsShellModesDescHybrid
        return language.settingsShellModesDescUtility
    }
</script>

<script lang="ts">
    import { DBState } from '../../ts/stores.svelte'
    import { HOME_MODES, canShowAll, isRepairState, lockOf, setHideUnusedModes, setVisibleModes, shownModes, withModeToggled } from '../../ts/storage/homeModes'

    /**
     * The profile-wide mode visibility controls. Reads and writes only through the rules in homeModes: a refused
     * activation is cancelled so the box keeps showing the stored value. Show-all is asked of the host, which
     * confirms it before anything is written.
     */
    interface Props {
        onaskshowall: (trigger: HTMLElement, hidden: HomeMode[]) => void
    }

    let { onaskshowall }: Props = $props()

    const uid = $props.id()
    const state = $derived({ visibleModes: DBState.db.visibleModes, hideUnusedModes: DBState.db.hideUnusedModes })
    const shown = $derived(shownModes(state))
    const hidden = $derived(HOME_MODES.filter((mode) => !shown.includes(mode)))
    const repair = $derived(isRepairState(state))
    const showAllEnabled = $derived(canShowAll(state))

    function onToggle(event: MouseEvent, mode: HomeMode): void {
        const input = event.currentTarget as HTMLInputElement
        const next = withModeToggled(state, mode, input.checked)
        if (next === null) {
            event.preventDefault()
            return
        }
        setVisibleModes(DBState.db, next)
    }

    function onShowAll(event: MouseEvent): void {
        if (!showAllEnabled) return
        onaskshowall(event.currentTarget as HTMLElement, hidden)
    }
</script>

<section class="flex flex-col gap-3 mb-6" aria-labelledby="{uid}-title" data-part="mode-visibility">
    <h3 id="{uid}-title" class="text-lg font-semibold" data-part="mode-visibility-title">{language.settingsShellModesTitle}</h3>
    <p class="text-textcolor2" data-part="mode-visibility-note">{language.settingsShellModesNote}</p>
    <p class="text-textcolor2" data-part="mode-visibility-home-note">{language.settingsShellModesHomeNote}</p>

    <button
        type="button"
        role="switch"
        class="flex items-center justify-between gap-3 px-3 min-h-11 rounded-md bg-darkbutton text-textcolor"
        aria-checked={state.hideUnusedModes === true}
        data-part="mode-hide-switch"
        onclick={() => setHideUnusedModes(DBState.db, state.hideUnusedModes !== true)}
    >
        <span>{language.settingsShellModesHide}</span>
        <span class="w-10 h-6 rounded-full border border-borderc flex items-center px-0.5" class:bg-selected={state.hideUnusedModes === true} class:justify-end={state.hideUnusedModes === true} aria-hidden="true">
            <span class="w-5 h-5 rounded-full bg-textcolor"></span>
        </span>
    </button>

    {#if repair}
        <div class="flex flex-col gap-1 px-3 py-2 rounded-md border border-draculared text-textcolor" data-part="mode-repair-banner">
            <span class="font-semibold">{language.settingsShellModesBanner(modeNames(shown))}</span>
            <span class="text-textcolor2">{language.settingsShellModesBannerSub}</span>
        </div>
    {/if}

    <fieldset class="flex flex-col gap-2 border-0 p-0 m-0 min-w-0" data-part="mode-fieldset">
        <legend class="mb-1 font-semibold">{language.settingsShellModesLegend}</legend>
        {#each HOME_MODES as mode (mode)}
            {@const lock = lockOf(mode, state)}
            <label class="flex items-start gap-3 min-h-11 px-3 py-2 rounded-md bg-darkbutton text-textcolor" data-part="mode-row" data-mode={mode}>
                <input
                    type="checkbox"
                    class="mt-1"
                    checked={shown.includes(mode)}
                    aria-disabled={lock !== null ? 'true' : undefined}
                    aria-describedby={lock !== null ? `${uid}-${mode}-desc ${uid}-${mode}-reason` : `${uid}-${mode}-desc`}
                    data-part="mode-checkbox"
                    data-mode={mode}
                    onclick={(event) => onToggle(event, mode)}
                />
                <span class="flex flex-col">
                    <span>{modeName(mode)}</span>
                    <span id="{uid}-{mode}-desc" class="text-textcolor2">{modeDescription(mode)}</span>
                    {#if lock !== null}
                        <span id="{uid}-{mode}-reason" class="text-textcolor2" data-part="mode-lock-reason">{lock === 'off' ? language.settingsShellModesLockOff : language.settingsShellModesLockLast}</span>
                    {/if}
                </span>
            </label>
        {/each}
    </fieldset>

    <p class="text-textcolor2" role="status" aria-live="polite" data-part="mode-status">{shown.length === HOME_MODES.length ? language.settingsShellModesStatusAll : language.settingsShellModesStatusSome(shown.length, modeNames(shown))}</p>

    <div class="flex flex-col gap-1">
        <button
            type="button"
            class="px-3 min-h-11 rounded-md bg-darkbutton text-textcolor self-start"
            class:text-textcolor2={!showAllEnabled}
            aria-disabled={showAllEnabled ? undefined : 'true'}
            aria-describedby={showAllEnabled ? undefined : `${uid}-already`}
            data-part="mode-show-all"
            onclick={onShowAll}
        >{language.settingsShellModesShowAll}</button>
        {#if !showAllEnabled}
            <span id="{uid}-already" class="text-textcolor2" data-part="mode-show-all-reason">{language.settingsShellModesAlready}</span>
        {/if}
    </div>
</section>
