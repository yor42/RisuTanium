<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon, CircleQuestionMarkIcon } from '@lucide/svelte'
    import { onDestroy, onMount, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { defaultAutoSuggestPrompt } from '../../ts/storage/defaultPrompts'
    import { checkSchemaText } from '../../ts/process/templates/jsonSchemaParse'
    import { openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { DISABLED_NUMBER, PRESET_FIELDS, presetValueAllowed, type PresetPath } from '../../ts/studio/edit/presetFields'
    import { modelTakesStopStrings } from '../../ts/studio/edit/presetLists'
    import { presetParamContext, presetResolvedThinkingType, presetSegments, visiblePresetParams } from '../../ts/studio/edit/presetParams'
    import { presetEffectiveModel, presetHasTemplate, presetNameOf, presetOwnerKey, presetStateOf, readPresetField } from '../../ts/studio/edit/presetTarget'
    import { exceedsActualMax, formatTokenCount } from '../../ts/model/modelData/openrouterData'
    import { pickPresetIcon } from '../../ts/presetIcon'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { FIELD_PRESENTATION, type SetPath } from '../../ts/studio/history/fieldRegistry'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { registerFieldReveal } from '../../ts/studio/historyFocus'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import type { LongTextMode, LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { readCollapsedSections, writeCollapsedSections } from '../../ts/studio/presetSections'
    import { setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { studioOpen } from '../../ts/studio/studioOpen'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { parseDefinition, rowsOf } from '../../ts/studio/toggleDef'
    import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
    import type { SettingContext, SettingItem } from '../../ts/setting/types'
    import ModelDataRefresh from '../Setting/Pages/Model/ModelDataRefresh.svelte'
    import ModelList from '../UI/ModelList.svelte'
    import NumberInput from '../UI/GUI/NumberInput.svelte'
    import SegmentedControl from '../UI/GUI/SegmentedControl.svelte'
    import SliderInput from '../UI/GUI/SliderInput.svelte'
    import LongTextField from './LongTextField.svelte'
    import StudioPresetBiasField from './StudioPresetBiasField.svelte'
    import StudioPresetListField from './StudioPresetListField.svelte'

    // The advanced form of one bot preset, addressed by its stable id. The form holds only the id: every value is read
    // through the preset adapter at render time and every control writes through the history service, which routes
    // the write to the working setting (active preset) or the slot (any other) and records one step. The sections are
    // collapsible; the collapse state is kept per preset on this device.
    interface Props {
        presetId: string
    }

    let { presetId }: Props = $props()

    type SectionId = 'nameIcon' | 'model' | 'parameters' | 'prompt' | 'promptOptions' | 'fallback' | 'other'
    type HelpKey = keyof typeof language.help

    const SECTION_ORDER: readonly SectionId[] = ['nameIcon', 'model', 'parameters', 'prompt', 'promptOptions', 'fallback', 'other']
    const AUX_PATHS = ['presetAuxMemory', 'presetAuxTranslate', 'presetAuxEmotion', 'presetAuxOtherAx'] as const satisfies readonly PresetPath[]
    const SECTION_PATHS: Readonly<Record<SectionId, readonly PresetPath[]>> = {
        nameIcon: ['presetName', 'presetImage'],
        model: ['presetAiModel', 'presetSubModel', ...AUX_PATHS, 'presetModelTools'],
        parameters: [
            'presetMaxContext',
            'presetMaxResponse',
            'presetThinkingType',
            'presetDeepseekThinkingType',
            'presetThinkingTokens',
            'presetAdaptiveThinkingEffort',
            'presetDeepseekReasoningEffort',
            'presetTemperature',
            'presetTopK',
            'presetMinP',
            'presetTopA',
            'presetRepetitionPenalty',
            'presetReasonEffort',
            'presetVerbosity',
            'presetTopP',
            'presetFrequencyPenalty',
            'presetPresencePenalty',
            'presetLocalStopStrings',
            'presetBias',
        ],
        prompt: ['presetMainPrompt', 'presetJailbreak', 'presetGlobalNote', 'presetFormatingOrder', 'presetPromptPreprocess'],
        promptOptions: [
            'presetPostEndInnerFormat',
            'presetSendChatAsSystem',
            'presetSendName',
            'presetTrimStartNewChat',
            'presetUtilOverride',
            'presetCustomChainOfThought',
            'presetMaxThoughtTagDepth',
            'presetJsonSchemaEnabled',
            'presetOutputImageModal',
            'presetStrictJsonSchema',
            'presetJsonSchema',
            'presetExtractJson',
            'presetGroupOtherBotRole',
            'presetTemplateDefaultVariables',
            'presetAutoSuggestPrompt',
            'presetGroupTemplate',
            'presetSystemContentReplacement',
            'presetSystemRoleReplacement',
        ],
        fallback: ['presetFallbackWhenBlank', 'presetFallbackModel', 'presetFallbackMemory', 'presetFallbackTranslate', 'presetFallbackEmotion', 'presetFallbackOtherAx'],
        other: [
            'presetModuleIntegration',
            'presetUseInstructPrompt',
            'presetAutoSuggestPrefix',
            'presetAutoSuggestClean',
            'presetDynamicAutoAdjustSchema',
            'presetDynamicMessages',
            'presetDynamicMemory',
            'presetDynamicResponseTiming',
            'presetDynamicOutputPrompt',
            'presetDynamicShowTypingEffect',
            'presetDynamicRequest',
        ],
    }
    const DYNAMIC_PATHS = SECTION_PATHS.other.filter((path) => path.startsWith('presetDynamic'))
    const HELP: Readonly<Partial<Record<PresetPath, HelpKey>>> = {
        presetAiModel: 'model',
        presetSubModel: 'submodel',
        presetTemperature: 'tempature',
        presetMainPrompt: 'mainprompt',
        presetJailbreak: 'jailbreak',
        presetGlobalNote: 'globalNote',
        presetFormatingOrder: 'formatOrder',
        presetBias: 'bias',
        presetCustomChainOfThought: 'customChainOfThought',
        presetStrictJsonSchema: 'strictJsonSchema',
        presetJsonSchema: 'jsonSchema',
        presetExtractJson: 'extractJson',
        presetGroupOtherBotRole: 'groupOtherBotRole',
        presetTemplateDefaultVariables: 'defaultVariables',
        presetAutoSuggestPrompt: 'autoSuggest',
        presetGroupTemplate: 'groupInnerFormat',
        presetSystemContentReplacement: 'systemContentReplacement',
        presetSystemRoleReplacement: 'systemRoleReplacement',
        presetModuleIntegration: 'moduleIntergration',
        presetDynamicAutoAdjustSchema: 'autoAdjustSchema',
        presetDynamicMessages: 'dynamicMessages',
        presetDynamicMemory: 'dynamicMemory',
        presetDynamicResponseTiming: 'dynamicResponseTiming',
        presetDynamicOutputPrompt: 'dynamicOutputPrompt',
        presetDynamicShowTypingEffect: 'showTypingEffect',
        presetDynamicRequest: 'dynamicRequest',
    }
    // Classic's hints for an empty field: the auto suggest prompt used when the stored one is empty, and the
    // non-speaker inner format's shape.
    const PLACEHOLDER: Readonly<Partial<Record<PresetPath, string>>> = {
        presetAutoSuggestPrompt: defaultAutoSuggestPrompt,
        presetGroupTemplate: `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>`,
    }
    const ROLE_LABELS:Readonly<Record<string, string>> = { user: 'User', system: 'System', assistant: 'assistant' }
    const FIELD_CLASS = 'min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const LINE_CLASS = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const BUTTON_CLASS = 'min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer'

    // Fixed for the life of the form: a new preset builds a new form (the detail keys it by the id).
    const id = untrack(() => presetId)
    const owner = presetOwnerKey(id)
    const idBase = $props.id()

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    const view = $derived(service ? service.view(owner) : null)
    const presence = $derived(presetStateOf(id))
    const hidden = $derived(presence === null || view?.restricted === true)
    const editable = $derived(view?.editable === true)
    const loadFailed = $derived(!service && studioHistoryLoadFailed())
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    const active = $derived(presence?.active === true)

    function labelOf(path: SetPath): string {
        return language[FIELD_PRESENTATION[path].labelKey]
    }
    function partOf(path: PresetPath): string {
        const focus = FIELD_PRESENTATION[path].focus
        return focus !== null && typeof focus === 'object' ? focus.part : ''
    }
    function textOf(path: PresetPath): string {
        const read = readPresetField(id, path)
        return read.had && typeof read.value === 'string' ? read.value : ''
    }
    function boolOf(path: PresetPath): boolean {
        const read = readPresetField(id, path)
        return read.had && read.value === true
    }

    // A number, or null when the preset holds none (not set, or a value of another type).
    function numberOf(path: PresetPath): number | null {
        const read = readPresetField(id, path)
        return read.had === true && typeof read.value === 'number' ? read.value : null
    }

    // A control's current value as the segmented control compares it: the stored number or text, else nothing selected.
    // The thinking type shows what the request resolves it to for this preset's model.
    function segmentValueOf(path: PresetPath): string | number {
        if (path === 'presetThinkingType') return presetResolvedThinkingType(id)
        return numberOf(path) ?? textOf(path)
    }

    // A field whose slot absence keeps the working value reads "not set" on an inactive preset: switching to it leaves the
    // current value, which the note says. The active preset has no switch to describe.
    function notSetNoted(path: PresetPath): boolean {
        return !active && PRESET_FIELDS[path].absent === 'keeps' && !readPresetField(id, path).had
    }

    const hasTemplate = $derived(presetHasTemplate(id))
    const schemaOn = $derived(boolOf('presetJsonSchemaEnabled'))
    const schemaCheck = $derived(schemaOn && textOf('presetJsonSchema') !== '' ? checkSchemaText(textOf('presetJsonSchema')) : null)
    const showsStops = $derived(modelTakesStopStrings(presetEffectiveModel(id) ?? ''))
    const showsInstruct = $derived((presetEffectiveModel(id) ?? '').startsWith('openrouter'))
    const fallbackKept = $derived(!active && DBState.db.doNotChangeFallbackModels === true)
    const auxKept = $derived(DBState.db.doNotChangeSeperateModels === true)
    // Classic's parameter rows for this preset's own model; null while the preset is gone.
    const paramContext = $derived(presetParamContext(id))
    const paramRows = $derived(paramContext === null ? [] : visiblePresetParams(paramContext))
    const toggleCount = $derived(rowsOf(parseDefinition(textOf('customModuleToggle'))).length)

    // The chain-of-thought switch is shown while the unrecommended-fields setting is on, and stays shown for the visit
    // once it is on, so that an undo that switches it off keeps the element the history focus target names.
    let cotLatched = $state(false)
    $effect(() => {
        if (boolOf('presetCustomChainOfThought')) untrack(() => { cotLatched = true })
    })
    const showsCot = $derived(DBState.db.showUnrecommended === true || cotLatched)

    // ------------------------------------------------------------ sections
    let collapsed = $state<Record<string, boolean>>(untrack(() => readCollapsedSections(id)))
    // Sections a history focus opened for one placement. The reveal is transient: the stored collapse state stays as the
    // user left it, and the next tap on the section header decides from what is shown.
    let revealed = $state<Record<string, boolean>>({})

    function expanded(section: SectionId): boolean {
        return collapsed[section] !== true || revealed[section] === true
    }
    function toggleSection(section: SectionId): void {
        const next = !expanded(section)
        collapsed[section] = !next
        delete revealed[section]
        writeCollapsedSections(id, collapsed)
    }
    function sectionOf(path: SetPath): SectionId | null {
        return SECTION_ORDER.find((section) => (SECTION_PATHS[section] as readonly SetPath[]).includes(path)) ?? null
    }
    $effect(() => registerFieldReveal(async (path) => {
        const section = sectionOf(path)
        if (section === null || expanded(section)) return
        revealed[section] = true
        await afterFlush()
    }))
    function titleOf(section: SectionId): string {
        switch (section) {
            case 'nameIcon': return language.studioPresetSectionNameIcon
            case 'model': return language.model
            case 'parameters': return language.parameters
            case 'prompt': return language.prompt
            case 'promptOptions': return language.studioPresetSectionPromptOptions
            case 'fallback': return language.fallbackModel
            case 'other': return language.studioPresetSectionOther
        }
    }

    // ------------------------------------------------------------ writes
    let refusal = $state<StudioRefusal | null>(null)
    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }
    function onFieldResult(result: StudioResult | null): void {
        if (result) noted(result)
    }

    function textPort(path: PresetPath): LongTextWritePort {
        return {
            read: () => textOf(path),
            write: (value) => (service && editable && presetValueAllowed(path, value) ? service.editText(owner, path, value, 'typing') : null),
            closeStep: () => service?.closeOpenStep(owner),
        }
    }
    const ports: Partial<Record<PresetPath, LongTextWritePort>> = {}
    function port(path: PresetPath): LongTextWritePort {
        return (ports[path] ??= textPort(path))
    }

    function onBoolChange(path: PresetPath, event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!service || !editable || !presetValueAllowed(path, input.checked) || !noted(service.editValue(owner, path, input.checked))) {
            input.checked = boolOf(path)
            return
        }
        // A switch is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    function onEnumChange(path: PresetPath, event: Event & { currentTarget: HTMLSelectElement }): void {
        const select = event.currentTarget
        if (!service || !editable || !presetValueAllowed(path, select.value) || !noted(service.editText(owner, path, select.value, 'single'))) {
            select.value = textOf(path)
            return
        }
        service.closeOpenStep(owner)
    }

    // A model picked in the shared picker (which asks first for a model known from one source only). A refused write
    // changes nothing: the picker shows the live value on its next render.
    function onModelPick(path: PresetPath, model: string): void {
        if (!service || !editable || !presetValueAllowed(path, model)) return
        if (noted(service.editText(owner, path, model, 'single'))) service.closeOpenStep(owner)
    }

    // The bounds a typed number is clamped to, as classic's controls clamp; the sentinel for "off" passes untouched.
    function clampNumber(path: PresetPath, value: number): number {
        const range = PRESET_FIELDS[path].range
        if (range === undefined || (range.disableable === true && value === DISABLED_NUMBER)) return value
        const whole = range.integer === true ? Math.round(value) : value
        return Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, whole))
    }

    // A number from a slider or a number input. Typing and dragging coalesce by path into one step; switching a
    // disableable slider on or off is a discrete step (`switching`: the slider shows a value the preset does not hold).
    // A value that is not a finite number writes nothing.
    function writeNumber(path: PresetPath, raw: unknown, switching = false): void {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || !service || !editable) return
        const next = clampNumber(path, raw)
        if (!presetValueAllowed(path, next)) return
        const discrete = switching || next === DISABLED_NUMBER || numberOf(path) === DISABLED_NUMBER
        if (noted(service.editValue(owner, path, next, { coalesce: !discrete })) && discrete) service.closeOpenStep(owner)
    }

    // After a number input is left, the field shows the live value again (a clamped or refused entry is not kept on screen).
    function onNumberSettled(path: PresetPath, event: Event & { currentTarget: HTMLInputElement }): void {
        service?.closeOpenStep(owner)
        const live = numberOf(path)
        event.currentTarget.value = live === null ? '' : String(live)
    }

    // A segmented choice: a number option is a value edit, a text option a text edit; each is its own step.
    function writeSegment(path: PresetPath, choice: string | number): void {
        if (!service || !editable || !presetValueAllowed(path, choice)) return
        const result = typeof choice === 'number' ? service.editValue(owner, path, choice) : service.editText(owner, path, choice, 'single')
        if (noted(result)) service.closeOpenStep(owner)
    }

    // The icon: one picked image is one step; a cancelled pick writes nothing and records no step. Removing it writes
    // "not set" as one step of its own.
    async function onIconPick(): Promise<void> {
        if (!service || !editable) return
        const data = await pickPresetIcon()
        if (data === null || !service || !editable || !presetValueAllowed('presetImage', data)) return
        if (noted(service.editText(owner, 'presetImage', data, 'single'))) service.closeOpenStep(owner)
    }
    function onIconRemove(): void {
        if (!service || !editable) return
        if (noted(service.clearField(owner, 'presetImage'))) service.closeOpenStep(owner)
    }

    // The single-line fields write through a composition gate: nothing is written while an IME composes, the composed
    // value is written once, and a refused write puts the live value back into the input.
    const inputs: Partial<Record<PresetPath, HTMLInputElement>> = {}
    function track(element: HTMLInputElement, path: PresetPath): { destroy(): void } {
        inputs[path] = element
        return { destroy: () => { if (inputs[path] === element) delete inputs[path] } }
    }
    function commitLine(path: PresetPath, value: string): void {
        const element = inputs[path]
        const activeService = getStudioHistoryService()
        const canEdit = activeService?.view(owner)?.editable === true
        const result = activeService && canEdit && presetValueAllowed(path, value) ? activeService.editText(owner, path, value, 'typing') : null
        if ((result === null || !noted(result)) && element) element.value = textOf(path)
    }
    const gates = new Map<PresetPath, ReturnType<typeof createCompositionGate>>()
    function gateOf(path: PresetPath): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(path)
        if (!gate) {
            gate = createCompositionGate((value) => commitLine(path, value))
            gates.set(path, gate)
        }
        return gate
    }
    function flushGates(): void {
        for (const gate of gates.values()) gate.flush()
    }
    function onLineInput(path: PresetPath, event: Event & { currentTarget: HTMLInputElement }): void {
        gateOf(path).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onLineBlur(path: PresetPath): void {
        gateOf(path).flush()
        service?.closeOpenStep(owner)
    }
    onMount(() => registerStudioField(flushGates))
    onDestroy(() => {
        const closing = getStudioHistoryService()
        queueMicrotask(() => {
            try {
                flushGates()
                closing?.closeOpenStep(owner)
            } catch (error) {
                console.error('Studio preset form flush failed', error)
            }
        })
    })

    // ------------------------------------------------------------ help
    let helpOpen = $state<Record<string, boolean>>({})

    // ------------------------------------------------------------ links
    function openToggles(): void {
        if (studioScreen.selectedOwnerKey !== null) setStudioSelection(studioScreen.selectedOwnerKey, 'toggles', null)
    }
    // Studio closes first, then the Settings page opens, as the classic link-outs do.
    function openConnections(): void {
        studioOpen.set(false)
        SettingsMenuIndex.set(18)
        settingsOpen.set(true)
    }
</script>

{#snippet help(path: PresetPath)}
    {@const key = HELP[path]}
    {#if key}
        <button
            type="button"
            data-part="studio-preset-help"
            aria-expanded={helpOpen[path] === true}
            aria-controls="{idBase}-help-{path}"
            aria-label="{labelOf(path)} {language.showHelp}"
            class="inline-flex min-h-11 min-w-11 items-center justify-center text-textcolor2 hover:text-textcolor cursor-pointer"
            onclick={() => { helpOpen[path] = helpOpen[path] !== true }}
        >
            <CircleQuestionMarkIcon size={14} aria-hidden="true" />
        </button>
    {/if}
{/snippet}

{#snippet helpText(path: PresetPath)}
    {@const key = HELP[path]}
    {#if key && helpOpen[path] === true}
        <p id="{idBase}-help-{path}" role="group" data-part="studio-preset-help-text" class="text-sm text-textcolor2">{language.help[key]}</p>
    {/if}
{/snippet}

{#snippet notSet(path: PresetPath)}
    {#if notSetNoted(path)}
        <p data-part="studio-preset-not-set" class="text-sm text-textcolor2">{language.studioPresetNotSet}</p>
    {/if}
{/snippet}

{#snippet longField(path: PresetPath, mode: LongTextMode)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <LongTextField
            port={port(path)}
            part={partOf(path)}
            label={labelOf(path)}
            placeholder={PLACEHOLDER[path]}
            kind="advanced"
            {mode}
            ownerLabel={presetNameOf(id)}
            {editable}
            busy={!editable}
            fieldClass={FIELD_CLASS}
            onresult={onFieldResult}
        />
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet lineField(path: PresetPath)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <label for="{idBase}-{path}" class="font-bold">{labelOf(path)}</label>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <input
            id="{idBase}-{path}"
            type="text"
            data-part={partOf(path)}
            class={LINE_CLASS}
            readonly={!editable}
            aria-busy={editable ? undefined : 'true'}
            value={textOf(path)}
            use:track={path}
            oninput={(event) => onLineInput(path, event)}
            oncompositionstart={() => gateOf(path).start()}
            oncompositionend={(event) => { gateOf(path).end(event.currentTarget.value) }}
            onblur={() => onLineBlur(path)}
        />
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet iconField(path: PresetPath)}
    {@const icon = textOf(path)}
    <div data-path={path} class="flex flex-col gap-1">
        <span class="font-bold">{labelOf(path)}</span>
        <div data-part={partOf(path)} tabindex="-1" class="flex items-center gap-2 outline-none">
            <div data-part="studio-preset-icon-tile" class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-darkborderc text-xs text-textcolor2">
                {#if icon !== ''}
                    <img src={icon} alt={language.settingsPage.iconAlt} class="h-8 w-8 object-cover" decoding="async" />
                {:else}
                    <span class="sr-only">{language.noImages}</span>
                {/if}
            </div>
            <button type="button" data-part="studio-preset-icon-choose" class={BUTTON_CLASS} disabled={!editable} onclick={onIconPick}>{language.chooseIconImage}</button>
        </div>
        {#if icon !== ''}
            <button type="button" data-part="studio-preset-icon-remove" class={BUTTON_CLASS} disabled={!editable} onclick={onIconRemove}>{language.studioPresetIconRemove}</button>
        {/if}
    </div>
{/snippet}

{#snippet boolField(path: PresetPath)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <label class="flex min-h-11 items-center gap-2">
                <input
                    type="checkbox"
                    data-part={partOf(path)}
                    disabled={!editable}
                    aria-busy={editable ? undefined : 'true'}
                    checked={boolOf(path)}
                    onchange={(event) => onBoolChange(path, event)}
                />
                <span>{labelOf(path)}</span>
            </label>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet enumField(path: PresetPath)}
    {@const current = textOf(path)}
    {@const options = PRESET_FIELDS[path].options ?? []}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <label for="{idBase}-{path}" class="font-bold">{labelOf(path)}</label>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <select
            id="{idBase}-{path}"
            data-part={partOf(path)}
            class={LINE_CLASS}
            disabled={!editable}
            aria-busy={editable ? undefined : 'true'}
            onchange={(event) => onEnumChange(path, event)}
        >
            {#if !options.includes(current)}
                <option value={current} selected disabled>{language.studioPresetUnknownValue(current)}</option>
            {/if}
            {#each options as option (option)}
                <option value={option} selected={option === current}>{ROLE_LABELS[option] ?? option}</option>
            {/each}
        </select>
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet modelField(path: PresetPath, blankable: boolean)}
    <div
        data-path={path}
        data-part={partOf(path)}
        tabindex="-1"
        class="flex flex-col gap-1"
    >
        <div class="flex items-center gap-1">
            <span class="font-bold">{labelOf(path)}</span>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <ModelList
            bind:value={() => textOf(path), () => {}}
            onChange={(model) => onModelPick(path, model)}
            {blankable}
        />
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet numberField(path: PresetPath, item: SettingItem | null, ctx: SettingContext | null)}
    {@const range = PRESET_FIELDS[path].range}
    {@const current = numberOf(path)}
    {@const actual = item?.options?.actualMax && ctx ? item.options.actualMax(ctx) : undefined}
    {@const knownMax = typeof actual === 'number' && Number.isFinite(actual) && actual > 0 ? actual : undefined}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <label for="{idBase}-{path}" class="font-bold">{labelOf(path)}</label>
            {#if knownMax !== undefined && current !== null}
                <span data-part="studio-preset-actual-max" class="text-xs text-textcolor2">{formatTokenCount(current)} / {formatTokenCount(knownMax)}</span>
            {/if}
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <div
            data-part={partOf(path)}
            tabindex="-1"
        >
            <NumberInput
                id="{idBase}-{path}"
                size="md"
                fullwidth
                min={range?.min}
                max={range?.max}
                disabled={!editable}
                bind:value={() => current ?? undefined, (value) => writeNumber(path, value)}
                onChange={(event) => onNumberSettled(path, event)}
            />
        </div>
        {#if knownMax !== undefined && item?.options?.actualMaxWarning && exceedsActualMax(current, knownMax)}
            <p data-part="studio-preset-actual-max-warning" role="status" class="text-sm text-draculared">{item.options.actualMaxWarning(formatTokenCount(knownMax))}</p>
        {/if}
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet sliderField(path: PresetPath, item: SettingItem)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <span id="{idBase}-{path}-label" class="font-bold">{labelOf(path)}</span>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <div
            data-part={partOf(path)}
            tabindex="-1"
        >
            <SliderInput
                labelId="{idBase}-{path}-label"
                label={labelOf(path)}
                min={item.options?.min ?? 0}
                max={item.options?.max ?? 0}
                step={item.options?.step}
                fixed={item.options?.fixed}
                multiple={item.options?.multiple}
                disableable={item.options?.disableable}
                bind:value={() => numberOf(path) ?? DISABLED_NUMBER, (value) => writeNumber(path, value, numberOf(path) === null)}
            />
        </div>
        {@render notSet(path)}
    </div>
{/snippet}

{#snippet listField(path: PresetPath, variant: 'models' | 'stops' | 'tools' | 'order' | null)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <span class="font-bold">{labelOf(path)}</span>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <div data-part={partOf(path)} tabindex="-1" class="outline-none">
            {#if variant === null}
                <StudioPresetBiasField presetId={id} {owner} {service} {editable} {active} />
            {:else}
                <StudioPresetListField presetId={id} {owner} {path} {variant} {service} {editable} {active} />
            {/if}
        </div>
    </div>
{/snippet}

{#snippet segmentField(path: PresetPath, item: SettingItem, ctx: SettingContext)}
    {@const offered = presetSegments(item, ctx)}
    {@const stored = segmentValueOf(path)}
    <div data-path={path} class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
            <span class="font-bold">{labelOf(path)}</span>
            {@render help(path)}
        </div>
        {@render helpText(path)}
        <div
            data-part={partOf(path)}
            tabindex="-1"
        >
            <SegmentedControl
                options={stored !== '' && !offered.some((option) => option.value === stored)
                    ? [...offered, { value: stored, label: language.studioPresetUnknownValue(String(stored)), disabled: true }]
                    : [...offered]}
                bind:value={() => segmentValueOf(path), (choice) => writeSegment(path, choice)}
            />
        </div>
        {@render notSet(path)}
    </div>
{/snippet}

{#if !hidden}
    <div data-part="studio-preset-advanced-form" class="flex flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        {#if loadFailed}
            <p role="status" data-part="studio-form-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-form-banner" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        {#if !active}
            <p role="status" data-part="studio-preset-not-in-chat" class="text-sm text-textcolor2">{language.studioPresetNotInChat}</p>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalTextOf({ reason: refusal }, owner)}</p>
        {/if}
        {#each SECTION_ORDER as section (section)}
            <section data-part="studio-preset-section" data-section={section} class="flex flex-col gap-3 rounded-md border border-darkborderc p-3">
                <button
                    type="button"
                    data-part="studio-preset-section-toggle"
                    aria-expanded={expanded(section)}
                    aria-controls="{idBase}-section-{section}"
                    class="flex min-h-11 w-full items-center gap-2 font-bold cursor-pointer"
                    onclick={() => toggleSection(section)}
                >
                    {#if expanded(section)}
                        <ChevronDownIcon size={18} aria-hidden="true" />
                    {:else}
                        <ChevronRightIcon size={18} aria-hidden="true" />
                    {/if}
                    <span>{titleOf(section)}</span>
                </button>
                {#if expanded(section)}
                    <div id="{idBase}-section-{section}" class="flex flex-col gap-3">
                        {#if section === 'nameIcon'}
                            {@render lineField('presetName')}
                            {@render iconField('presetImage')}
                        {:else if section === 'model'}
                            {@render modelField('presetAiModel', false)}
                            {@render modelField('presetSubModel', false)}
                            {#if auxKept}
                                <p role="status" data-part="studio-preset-aux-note" class="text-sm text-textcolor2">{active ? language.studioPresetAuxNotSaved : language.studioPresetAuxKept}</p>
                            {/if}
                            {#each AUX_PATHS as path (path)}
                                {@render modelField(path, true)}
                            {/each}
                            {@render listField('presetModelTools', 'tools')}
                            <ModelDataRefresh />
                            <button type="button" data-part="studio-preset-connections-link" class="self-start min-h-11 text-sm text-textcolor2 hover:text-textcolor underline cursor-pointer" onclick={openConnections}>{language.connectionsManageLink}</button>
                            <p data-part="studio-preset-provider-classic" class="text-sm text-textcolor2">{language.studioPresetProviderClassic}</p>
                            <button type="button" data-part="studio-preset-provider-classic-button" class={BUTTON_CLASS} onclick={() => openInClassicEditor('preset', null)}>{language.studioOpenClassic}</button>
                        {:else if section === 'parameters'}
                            {#if paramContext}
                                {#each paramRows as row (row.path)}
                                    {#if row.item.type === 'number'}
                                        {@render numberField(row.path, row.item, paramContext)}
                                    {:else if row.item.type === 'slider'}
                                        {@render sliderField(row.path, row.item)}
                                    {:else if row.item.type === 'segmented'}
                                        {@render segmentField(row.path, row.item, paramContext)}
                                    {/if}
                                {/each}
                            {/if}
                            {#if showsStops}
                                {@render listField('presetLocalStopStrings', 'stops')}
                            {/if}
                            {@render listField('presetBias', null)}
                        {:else if section === 'prompt'}
                            {#if hasTemplate}
                                <p role="status" data-part="studio-preset-uses-template" class="text-sm text-textcolor2">{language.studioPresetUsesTemplate}</p>
                                <button type="button" data-part="studio-preset-edit-template" class={BUTTON_CLASS} onclick={() => openInClassicEditor('preset', 'advanced')}>{language.studioPresetEditTemplateItems}</button>
                            {:else}
                                {@render longField('presetMainPrompt', 'cbs')}
                                {@render longField('presetJailbreak', 'cbs')}
                                {@render longField('presetGlobalNote', 'cbs')}
                                {@render listField('presetFormatingOrder', 'order')}
                                {@render boolField('presetPromptPreprocess')}
                            {/if}
                        {:else if section === 'promptOptions'}
                            {@render lineField('presetPostEndInnerFormat')}
                            {@render boolField('presetSendChatAsSystem')}
                            {@render boolField('presetSendName')}
                            {@render boolField('presetTrimStartNewChat')}
                            {@render boolField('presetUtilOverride')}
                            {#if showsCot}
                                {@render boolField('presetCustomChainOfThought')}
                            {/if}
                            {@render numberField('presetMaxThoughtTagDepth', null, null)}
                            {@render boolField('presetJsonSchemaEnabled')}
                            {@render boolField('presetOutputImageModal')}
                            {@render boolField('presetStrictJsonSchema')}
                            {#if schemaOn}
                                {@render longField('presetJsonSchema', 'plain')}
                                {#if schemaCheck?.kind === 'invalid'}
                                    <p role="status" data-part="studio-preset-schema-hint" class="text-sm text-textcolor2">{language.studioPresetSchemaInvalid(schemaCheck.error)}</p>
                                {:else if schemaCheck?.kind === 'macros'}
                                    <p role="status" data-part="studio-preset-schema-hint" class="text-sm text-textcolor2">{language.studioPresetSchemaMacros}</p>
                                {/if}
                                {@render lineField('presetExtractJson')}
                            {/if}
                            {@render enumField('presetGroupOtherBotRole')}
                            {@render longField('presetTemplateDefaultVariables', 'plain')}
                            {@render longField('presetAutoSuggestPrompt', 'cbs')}
                            {@render longField('presetGroupTemplate', 'cbs')}
                            {@render longField('presetSystemContentReplacement', 'cbs')}
                            {@render enumField('presetSystemRoleReplacement')}
                            <div class="flex items-center gap-1">
                                <button type="button" data-part="studio-preset-toggles-row" class={BUTTON_CLASS} onclick={openToggles}>{language.studioPresetTogglesRow(language.customPromptTemplateToggle, toggleCount)}</button>
                            </div>
                        {:else if section === 'fallback'}
                            {#if fallbackKept}
                                <p role="status" data-part="studio-preset-fallback-kept" class="text-sm text-textcolor2">{language.studioPresetFallbackKept}</p>
                            {/if}
                            {@render boolField('presetFallbackWhenBlank')}
                            {@render listField('presetFallbackModel', 'models')}
                            {@render listField('presetFallbackMemory', 'models')}
                            {@render listField('presetFallbackTranslate', 'models')}
                            {@render listField('presetFallbackEmotion', 'models')}
                            {@render listField('presetFallbackOtherAx', 'models')}
                        {:else}
                            {@render longField('presetModuleIntegration', 'plain')}
                            {#if showsInstruct}
                                {@render boolField('presetUseInstructPrompt')}
                            {/if}
                            {@render lineField('presetAutoSuggestPrefix')}
                            <p role="status" data-part="studio-preset-not-used" class="text-sm text-textcolor2">{language.studioPresetNotUsed}</p>
                            {@render boolField('presetAutoSuggestClean')}
                            <p role="status" data-part="studio-preset-auto-suggest-clean-models" class="text-sm text-textcolor2">{language.studioPresetAutoSuggestCleanModels}</p>
                            <p class="font-bold">{language.studioPresetDynamicOutput}</p>
                            <p role="status" data-part="studio-preset-not-used" class="text-sm text-textcolor2">{language.studioPresetNotUsed}</p>
                            {#each DYNAMIC_PATHS as path (path)}
                                {@render boolField(path)}
                            {/each}
                        {/if}
                    </div>
                {/if}
            </section>
        {/each}
    </div>
{/if}
