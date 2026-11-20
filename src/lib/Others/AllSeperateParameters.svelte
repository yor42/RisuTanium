<script lang="ts">
    import { DBState } from "src/ts/stores.svelte";
    import Help from "./Help.svelte";
    import { language } from "src/lang";
    import SliderInput from "../UI/GUI/SliderInput.svelte";
    import SegmentedControl from "../UI/GUI/SegmentedControl.svelte";
    import ClaudeThinkingSeparateParams from "../Setting/Pages/ClaudeThinkingSeparateParams.svelte";
    import type { SeparateParameters } from "src/ts/storage/database.svelte";
    import { downloadFile } from "src/ts/globalApi.svelte";
    import { FileDownIcon, FileUpIcon, ImportIcon } from "@lucide/svelte";
    import { selectSingleFile } from "src/ts/util";
    import { getModelInfo } from "src/ts/model/modellist";
    import { auxSlotModel } from "src/ts/process/request/auxModelSlot";

    type AuxModelKey = 'memory' | 'emotion' | 'translate' | 'otherAx'
    const auxModelKeys: AuxModelKey[] = ['memory', 'emotion', 'translate', 'otherAx']

    let {
        value = $bindable(),
        withImportExport = false,
        paramKey,
    }:{
        value: SeparateParameters
        withImportExport?: boolean
        paramKey?: string
    } = $props()

    let effectiveModel = $derived.by(() => {
        if (!paramKey) return DBState.db.subModel
        if (auxModelKeys.includes(paramKey as AuxModelKey)) {
            return auxSlotModel(DBState.db.seperateModels, paramKey) || DBState.db.subModel
        }
        return paramKey
    })
    let modelInfo = $derived(getModelInfo(effectiveModel))
    let hasTemperature = $derived(modelInfo.parameters.includes('temperature'))
    let hasReasoningEffort = $derived(
        modelInfo.parameters.includes('reasoning_effort') ||
        modelInfo.parameters.includes('reasoning_effort_min_medium') ||
        modelInfo.parameters.includes('reasoning_effort_none') ||
        modelInfo.parameters.includes('reasoning_effort_xhigh')
    )
    let hasVerbosity = $derived(modelInfo.parameters.includes('verbosity'))
    const verbosityOptions = [
        { value: 0, label: language.optLow },
        { value: 1, label: language.optMedium },
        { value: 2, label: language.optHigh },
    ]
    let reasoningEffortOptions = $derived([
        ...(!modelInfo.parameters.includes('reasoning_effort_min_medium') ? [{
            value: -1,
            label: modelInfo.parameters.includes('reasoning_effort_none') ? language.none : language.optMinimal,
        }] : []),
        ...(!modelInfo.parameters.includes('reasoning_effort_min_medium') ? [{ value: 0, label: language.optLow }] : []),
        { value: 1, label: language.optMedium },
        { value: 2, label: language.optHigh },
        ...(modelInfo.parameters.includes('reasoning_effort_xhigh') ? [{ value: 3, label: 'XHigh' }] : []),
    ])

    $effect(() => {
        if (!modelInfo.parameters.includes('reasoning_effort_xhigh') && value.reasoning_effort === 3) {
            value.reasoning_effort = 2
        }
        if (modelInfo.parameters.includes('reasoning_effort_min_medium') && value.reasoning_effort < 1) {
            value.reasoning_effort = 1
        }
    })
</script>

{#if hasTemperature}
<span class="text-textcolor">{language.temperature} <Help key="tempature"/></span>
<SliderInput min={0} max={200} marginBottom bind:value={value.temperature} multiple={0.01} fixed={2} disableable/>
{/if}
<span class="text-textcolor">Top K</span>
<SliderInput min={0} max={100} marginBottom step={1} bind:value={value.top_k} disableable/>
<span class="text-textcolor">{'Repetition Penalty'}</span>
<SliderInput min={0} max={2} marginBottom step={0.01} fixed={2} bind:value={value.repetition_penalty} disableable/>
<span class="text-textcolor">Min P</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.min_p} disableable/>
<span class="text-textcolor">Top A</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.top_a} disableable/>
<span class="text-textcolor">Top P</span>
<SliderInput min={0} max={1} marginBottom step={0.01} fixed={2} bind:value={value.top_p} disableable/>
<span class="text-textcolor">{language.frequencyPenalty}</span>
<SliderInput min={0} max={200} marginBottom step={0.01} fixed={2} bind:value={value.frequency_penalty} disableable/>
<span class="text-textcolor">{language.presensePenalty}</span>
<SliderInput min={0} max={200} marginBottom step={0.01} fixed={2} bind:value={value.presence_penalty} disableable/>
<ClaudeThinkingSeparateParams bind:value={value} {paramKey} />
{#if hasReasoningEffort}
<span class="text-textcolor">Reasoning Effort</span>
<SegmentedControl bind:value={value.reasoning_effort} options={reasoningEffortOptions} />
{/if}
{#if hasVerbosity}
<span class="text-textcolor">{'Verbosity'}</span>
<SegmentedControl bind:value={value.verbosity} options={verbosityOptions} />
{/if}

{#if withImportExport}
    <div class="flex">
        <button class="bg-selected text-textcolor ring-1 ring-borderc hover:ring-2 hover:ring-textcolor2 font-bold py-2 px-4 rounded" aria-label={language.export} onclick={() => {
            const json = JSON.stringify(value, null, 2)
            downloadFile(`parameters-${Date.now()}.json`, json)
        }}>
            <FileDownIcon aria-hidden="true" />
        </button>
        <button class="bg-selected text-textcolor ring-1 ring-borderc hover:ring-2 hover:ring-textcolor2 font-bold py-2 px-4 rounded ml-2" aria-label={language.import} onclick={async () => {
            const file = await selectSingleFile(['json'])
            if(!file){
                return
            }
            const fileText = await (new TextDecoder()).decode(file.data)
            try {
                const json = JSON.parse(fileText)

                value = json
            } catch (e) {
                alert(language.noData)
            }
        }}>
            <FileUpIcon aria-hidden="true" />
        </button>
    </div>
{/if}
