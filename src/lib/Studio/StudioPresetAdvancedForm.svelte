<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon, CircleQuestionMarkIcon } from '@lucide/svelte'
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { defaultAutoSuggestPrompt } from '../../ts/storage/defaultPrompts'
    import { checkSchemaText } from '../../ts/process/templates/jsonSchemaParse'
    import { openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { PRESET_FIELDS, isPresetPath, presetValueAllowed, type PresetPath } from '../../ts/studio/edit/presetFields'
    import { presetEffectiveModel, presetHasTemplate, presetNameOf, presetOwnerKey, presetStateOf, readPresetField } from '../../ts/studio/edit/presetTarget'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { FIELD_PRESENTATION, type SetPath } from '../../ts/studio/history/fieldRegistry'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { registerFieldReveal } from '../../ts/studio/historyFocus'
    import type { LongTextMode, LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { readCollapsedSections, writeCollapsedSections } from '../../ts/studio/presetSections'
    import { setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { studioOpen } from '../../ts/studio/studioOpen'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { parseDefinition, rowsOf } from '../../ts/studio/toggleDef'
    import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'

    // The advanced form of one bot preset, addressed by its stable id. The form holds only the id: every value is read
    // through the preset adapter at render time and every control writes through the history service, which routes
    // the write to the working setting (active preset) or the slot (any other) and records one step. The sections are
    // collapsible; the collapse state is kept per preset on this device.
    interface Props {
        presetId: string
    }

    let { presetId }: Props = $props()

    type SectionId = 'nameIcon' | 'model' | 'prompt' | 'promptOptions' | 'fallback' | 'other'
    type HelpKey = keyof typeof language.help

    const SECTION_ORDER: readonly SectionId[] = ['nameIcon', 'model', 'prompt', 'promptOptions', 'fallback', 'other']
    const SECTION_PATHS: Readonly<Record<SectionId, readonly PresetPath[]>> = {
        nameIcon: ['presetName'],
        model: [],
        prompt: ['presetMainPrompt', 'presetJailbreak', 'presetGlobalNote', 'presetPromptPreprocess'],
        promptOptions: [
            'presetPostEndInnerFormat',
            'presetSendChatAsSystem',
            'presetSendName',
            'presetTrimStartNewChat',
            'presetUtilOverride',
            'presetCustomChainOfThought',
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
        fallback: ['presetFallbackWhenBlank'],
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
        presetMainPrompt: 'mainprompt',
        presetJailbreak: 'jailbreak',
        presetGlobalNote: 'globalNote',
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

    // A field whose slot absence keeps the working value reads "not set" on an inactive preset: switching to it leaves the
    // current value, which the note says. The active preset has no switch to describe.
    function notSetNoted(path: PresetPath): boolean {
        return !active && PRESET_FIELDS[path].absent === 'keeps' && !readPresetField(id, path).had
    }

    const hasTemplate = $derived(presetHasTemplate(id))
    const schemaOn = $derived(boolOf('presetJsonSchemaEnabled'))
    const schemaCheck = $derived(schemaOn && textOf('presetJsonSchema') !== '' ? checkSchemaText(textOf('presetJsonSchema')) : null)
    const showsInstruct = $derived((presetEffectiveModel(id) ?? '').startsWith('openrouter'))
    const fallbackKept = $derived(!active && DBState.db.doNotChangeFallbackModels === true)
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

    // The single-line fields write through a composition gate: nothing is written while an IME composes, the composed
    // value is written once, and a refused write puts the live value back into the input.
    const inputs: Partial<Record<PresetPath, HTMLInputElement>> = {}
    function track(element: HTMLInputElement, path: PresetPath): { destroy(): void } {
        inputs[path] = element
        return { destroy: () => { if (inputs[path] === element) delete inputs[path] } }
    }
    function commitLine(path: PresetPath, value: string): void {
        const element = inputs[path]
        const result = service && editable && presetValueAllowed(path, value) ? service.editText(owner, path, value, 'typing') : null
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
    function onLineInput(path: PresetPath, event: Event & { currentTarget: HTMLInputElement }): void {
        gateOf(path).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onLineBlur(path: PresetPath): void {
        gateOf(path).flush()
        service?.closeOpenStep(owner)
    }
    onDestroy(() => {
        for (const gate of gates.values()) gate.flush()
        service?.closeOpenStep(owner)
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
                        {:else if section === 'model'}
                            <button type="button" data-part="studio-preset-connections-link" class="self-start min-h-11 text-sm text-textcolor2 hover:text-textcolor underline cursor-pointer" onclick={openConnections}>{language.connectionsManageLink}</button>
                            <p data-part="studio-preset-provider-classic" class="text-sm text-textcolor2">{language.studioPresetProviderClassic}</p>
                            <button type="button" data-part="studio-preset-provider-classic-button" class={BUTTON_CLASS} onclick={() => openInClassicEditor('preset', null)}>{language.studioOpenClassic}</button>
                        {:else if section === 'prompt'}
                            {#if hasTemplate}
                                <p role="status" data-part="studio-preset-uses-template" class="text-sm text-textcolor2">{language.studioPresetUsesTemplate}</p>
                                <button type="button" data-part="studio-preset-edit-template" class={BUTTON_CLASS} onclick={() => openInClassicEditor('preset', 'advanced')}>{language.studioPresetEditTemplateItems}</button>
                            {:else}
                                {@render longField('presetMainPrompt', 'cbs')}
                                {@render longField('presetJailbreak', 'cbs')}
                                {@render longField('presetGlobalNote', 'cbs')}
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
