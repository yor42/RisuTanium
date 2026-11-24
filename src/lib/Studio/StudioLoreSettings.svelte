<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte'
    import { onDestroy } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { buildLoreFlag, buildLoreNumber, buildUseGlobal, LORE_NUMBER_RANGE, type LoreFlag, type LoreNumber } from '../../ts/studio/edit/loreSettingsOps'
    import type { character } from '../../ts/storage/database.svelte'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { registerFieldReveal } from '../../ts/studio/historyFocus'
    import { DBState } from '../../ts/stores.svelte'
    import Help from '../Others/Help.svelte'
    import NumberInput from '../UI/GUI/NumberInput.svelte'

    // The lorebook settings of the character an owner tree hosts (the character's use-global switch, four flags and two
    // numbers, and LorePlus). A chat or a module has no settings of its own: it shows a note. Every write goes through
    // the history service as one step; the app-wide values and `useExperimental` are read here and never written.
    interface Props {
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        host: 'character' | 'chat' | 'module'
        // The live character of the character host.
        live?: character | undefined
        // The form's refusal reporter: shows the refusal line and returns whether the write was accepted.
        noted: (result: StudioResult) => boolean
        onOpenCharacter?: () => void
    }

    let { owner, service, editable, host, live, noted, onOpenCharacter }: Props = $props()

    const uid = $props.id()

    const useGlobal = $derived(live?.loreSettings === undefined)
    const settings = $derived(live?.loreSettings)
    const showLorePlus = $derived(DBState.db.useExperimental === true)

    // The section is collapsed until opened. A history focus on LorePlus opens it for that placement only: the next tap on
    // the header decides from what is shown.
    let opened = $state(false)
    let revealed = $state(false)
    const expanded = $derived(opened || revealed)
    function toggle(): void {
        opened = !expanded
        revealed = false
    }
    $effect(() => registerFieldReveal(async (path) => {
        if (host !== 'character' || path !== 'lorePlus' || expanded) return
        revealed = true
        await afterFlush()
    }))

    function onUseGlobalChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!service || !editable) {
            input.checked = useGlobal
            return
        }
        const result = service.objEdit(owner, buildUseGlobal(input.checked, { scanDepth: DBState.db.loreBookDepth, tokenBudget: DBState.db.loreBookToken }))
        if (!noted(result)) {
            input.checked = useGlobal
            return
        }
        // A switch is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    function flagOf(flag: LoreFlag): boolean {
        return settings?.[flag] === true
    }
    function onFlagChange(flag: LoreFlag, event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!service || !editable || !noted(service.objEdit(owner, buildLoreFlag(flag, input.checked)))) {
            input.checked = flagOf(flag)
            return
        }
        service.closeOpenStep(owner)
    }

    function numberOf(field: LoreNumber): number | undefined {
        return settings?.[field]
    }
    // Typing coalesces by field; a value that is not a finite number writes nothing.
    function writeNumber(field: LoreNumber, raw: number | null | undefined): void {
        if (!service || !editable) return
        const value = typeof raw === 'number' ? raw : null
        if (value === null) return
        noted(service.objEdit(owner, buildLoreNumber(field, value)))
    }
    // Leaving the field closes the typing step and shows the live value again, so a clamped or refused entry is not kept.
    function onNumberSettled(field: LoreNumber, event: Event & { currentTarget: HTMLInputElement }): void {
        service?.closeOpenStep(owner)
        const current = numberOf(field)
        event.currentTarget.value = current === undefined ? '' : String(current)
    }

    function onLorePlusChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, 'lorePlus', input.checked, { coalesceKey: null }))) {
            input.checked = live?.lorePlus === true
            return
        }
        service.closeOpenStep(owner)
    }

    onDestroy(() => service?.closeOpenStep(owner))
</script>

<div data-part="studio-lore-settings" class="flex flex-col gap-2">
    {#if host === 'chat'}
        <p data-part="studio-lore-settings-chat-note" class="text-sm text-textcolor2">{language.studioLoreSettingsChatNote}</p>
        <button type="button" data-part="studio-lore-settings-open-character" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => onOpenCharacter?.()}>{language.studioLoreSettingsOpen}</button>
    {:else if host === 'module'}
        <p data-part="studio-lore-settings-module-note" class="text-sm text-textcolor2">{language.studioLoreSettingsModuleNote}</p>
    {:else}
        <button type="button" data-part="studio-lore-settings-toggle" class="flex min-h-11 items-center gap-2 text-left font-bold cursor-pointer" aria-expanded={expanded} aria-controls="{uid}-body" onclick={toggle}>
            {#if expanded}
                <ChevronDownIcon size={16} aria-hidden="true" />
            {:else}
                <ChevronRightIcon size={16} aria-hidden="true" />
            {/if}
            <span>{language.studioLoreSettings}</span>
        </button>
        {#if expanded}
            <div id="{uid}-body" data-part="studio-lore-settings-body" class="flex flex-col gap-2 rounded-md border border-darkborderc p-3">
                <label class="flex min-h-11 items-center gap-2">
                    <input type="checkbox" data-part="studio-lore-use-global" disabled={!editable} checked={useGlobal} onchange={onUseGlobalChange} />
                    <span>{language.useGlobalSettings}</span>
                </label>
                {#if useGlobal}
                    <p data-part="studio-lore-global-values" class="text-sm text-textcolor2">{language.studioLoreGlobalValues(DBState.db.loreBookDepth, DBState.db.loreBookToken)}</p>
                {:else}
                    <label class="flex min-h-11 items-center gap-2">
                        <input type="checkbox" data-part="studio-lore-recursive" disabled={!editable} checked={flagOf('recursiveScanning')} onchange={(event) => onFlagChange('recursiveScanning', event)} />
                        <span>{language.recursiveScanning}</span>
                    </label>
                    <label class="flex min-h-11 items-center gap-2">
                        <input type="checkbox" data-part="studio-lore-full-word" disabled={!editable} checked={flagOf('fullWordMatching')} onchange={(event) => onFlagChange('fullWordMatching', event)} />
                        <span>{language.fullWordMatching}</span>
                    </label>
                    <div class="flex min-h-11 items-center gap-2">
                        <label class="flex min-h-11 items-center gap-2">
                            <input type="checkbox" data-part="studio-lore-ascii-boundary" disabled={!editable} checked={flagOf('fullWordAsciiBoundary')} onchange={(event) => onFlagChange('fullWordAsciiBoundary', event)} />
                            <span>{language.fullWordAsciiBoundary}</span>
                        </label>
                        <Help key="fullWordAsciiBoundary" />
                    </div>
                    <div class="flex min-h-11 items-center gap-2">
                        <label class="flex min-h-11 items-center gap-2">
                            <input type="checkbox" data-part="studio-lore-cjk-start" disabled={!editable} checked={flagOf('cjkWordStart')} onchange={(event) => onFlagChange('cjkWordStart', event)} />
                            <span>{language.cjkWordStart}</span>
                        </label>
                        <Help key="cjkWordStart" />
                    </div>
                    <div class="flex flex-col gap-1">
                        <span id="{uid}-scan-depth" class="font-bold">{language.loreBookDepth}</span>
                        <div data-part="studio-lore-scan-depth">
                            <NumberInput
                                size="md"
                                fullwidth
                                min={LORE_NUMBER_RANGE.scanDepth.min}
                                max={LORE_NUMBER_RANGE.scanDepth.max}
                                labelId="{uid}-scan-depth"
                                disabled={!editable}
                                bind:value={() => numberOf('scanDepth') ?? undefined, (value) => writeNumber('scanDepth', value)}
                                onChange={(event) => onNumberSettled('scanDepth', event)}
                            />
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <span id="{uid}-token-budget" class="font-bold">{language.loreBookToken}</span>
                        <div data-part="studio-lore-token-budget">
                            <NumberInput
                                size="md"
                                fullwidth
                                min={LORE_NUMBER_RANGE.tokenBudget.min}
                                max={LORE_NUMBER_RANGE.tokenBudget.max}
                                labelId="{uid}-token-budget"
                                disabled={!editable}
                                bind:value={() => numberOf('tokenBudget') ?? undefined, (value) => writeNumber('tokenBudget', value)}
                                onChange={(event) => onNumberSettled('tokenBudget', event)}
                            />
                        </div>
                    </div>
                {/if}
                {#if showLorePlus}
                    <div class="flex min-h-11 items-center gap-2">
                        <label class="flex min-h-11 items-center gap-2">
                            <input type="checkbox" data-part="studio-lore-plus" disabled={!editable} checked={live?.lorePlus === true} onchange={onLorePlusChange} />
                            <span>{language.lorePlus}</span>
                        </label>
                        <Help key="lorePlus" />
                        <Help key="experimental" />
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
</div>
