<script lang="ts">
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import { getModelInfo } from 'src/ts/model/modellist';
    import { LLMFlags } from 'src/ts/model/types';
    import { auxSlotModel } from 'src/ts/process/request/auxModelSlot';
    import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte';
    import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte';
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte';
    import type { SeparateParameters } from 'src/ts/storage/database.svelte';

    type AuxModelKey = keyof typeof DBState.db.seperateModels

    let {
        value = $bindable(),
        paramKey,
    }:{
        value: SeparateParameters
        paramKey?: string
    } = $props()

    const uid = $props.id()

    const auxModelKeys: AuxModelKey[] = ['memory', 'emotion', 'translate', 'otherAx']

    let effectiveModel = $derived.by(() => {
        if (!paramKey) return DBState.db.subModel
        if (auxModelKeys.includes(paramKey as AuxModelKey)) {
            return auxSlotModel(DBState.db.seperateModels, paramKey) || DBState.db.subModel
        }
        return paramKey
    })
    let modelInfo = $derived(getModelInfo(effectiveModel))

    let hasXHighEffort = $derived(modelInfo.flags.includes(LLMFlags.claudeXHighEffort))

    let adaptiveThinkingEffortOptions = $derived([
        { value: 'low', label: language.optLow },
        { value: 'medium', label: language.optMedium },
        { value: 'high', label: language.optHigh },
        ...(hasXHighEffort ? [{ value: 'xhigh', label: 'XHigh' }] : []),
        { value: 'max', label: language.max },
    ])

    $effect(() => {
        if (value.adaptive_thinking_effort === 'xhigh' && !hasXHighEffort) {
            value.adaptive_thinking_effort = 'high'
        }
    })
</script>

<span class="text-textcolor" id="{uid}-thinkingType">{language.thinkingType ?? 'Thinking Mode'}</span>
<SelectInput labelId="{uid}-thinkingType" bind:value={value.thinking_type}>
    <OptionInput value="off">{language.optOff}</OptionInput>
    <OptionInput value="budget">{language.optBudgetManualTokens}</OptionInput>
    <OptionInput value="adaptive">{language.optAdaptive}</OptionInput>
</SelectInput>
{#if value.thinking_type === 'budget'}
    <span class="text-textcolor" id="{uid}-thinkingTokens">{language.thinkingTokens}</span>
    <SliderInput labelId="{uid}-thinkingTokens" label={language.thinkingTokens} min={0} max={64000} marginBottom step={200} fixed={0} bind:value={value.thinking_tokens} disableable/>
{/if}
{#if value.thinking_type === 'adaptive'}
    <span class="text-textcolor" id="{uid}-adaptiveEffort">{language.adaptiveThinkingEffort ?? 'Adaptive Thinking Effort'}</span>
    <SelectInput labelId="{uid}-adaptiveEffort" bind:value={value.adaptive_thinking_effort}>
        {#each adaptiveThinkingEffortOptions as option}
            <OptionInput value={option.value}>{option.label}</OptionInput>
        {/each}
    </SelectInput>
{/if}
{#if value.deepseek_thinking_type !== undefined}
    <span class="text-textcolor" id="{uid}-deepseekThinking">DeepSeek Thinking Mode</span>
    <SelectInput labelId="{uid}-deepseekThinking" bind:value={value.deepseek_thinking_type}>
        <OptionInput value="off">{language.optOff}</OptionInput>
        <OptionInput value="enabled">{language.optEnabled}</OptionInput>
    </SelectInput>
{/if}
{#if value.deepseek_thinking_type === 'enabled'}
    <span class="text-textcolor" id="{uid}-deepseekEffort">DeepSeek Reasoning Effort</span>
    <SelectInput labelId="{uid}-deepseekEffort" bind:value={value.deepseek_reasoning_effort}>
        <OptionInput value="high">{language.optHigh}</OptionInput>
        <OptionInput value="max">{language.max}</OptionInput>
    </SelectInput>
{/if}
