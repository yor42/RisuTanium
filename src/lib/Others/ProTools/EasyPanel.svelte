<script lang="ts">
    import { language } from "src/lang";
    import ClaudeThinkingSeparateParams from "src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte";
    import SegmentedControl from "src/lib/UI/GUI/SegmentedControl.svelte";
    import SliderInput from "src/lib/UI/GUI/SliderInput.svelte";
    import ModelList from "src/lib/UI/ModelList.svelte";
    import { DBState, easyPanelStore } from "src/ts/stores.svelte";
    import Help from "../Help.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import AllSeperateParameters from "../AllSeperateParameters.svelte";
    import { onMount } from "svelte";
    import { XIcon } from "@lucide/svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import CustomModelsSettings from "src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";

    let selectedOption = $state('models');
    let selectedParameterOption = $state('memory')
    let parameterModelSelection = $state('')

    let hasEPRequirements = $derived.by(() => {
        return  DBState.db.seperateParametersEnabled &&
                DBState.db.doNotChangeSeperateModels &&
                DBState.db.seperateModels &&
                DBState.db.epEnabled &&
                DBState.db.disableSeperateParameterChangeOnPresetChange
    })

    const onClose = () => {
        easyPanelStore.open = false
    }

    // Back does what the X does. The effect reads no reactive state.
    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => easyPanelStore.open,
        snapshot: () => easyPanelStore.open,
        close: onClose,
    })))

</script>

<div data-part="modal-easy-panel" class="fixed z-50 w-dvw h-dvh top-0 left-0 pointer-events-none flex justify-stretch items-stretch">
    <div data-part="modal-frame" class="m-4 p-4 bg-bgcolor/80 backdrop-blur-sm rounded-lg shadow-lg pointer-events-auto flex-1 flex flex-col overflow-y-auto">
        <h2 data-part="modal-header" class="text-lg font-bold mb-2 flex items-center">
            {language.easyPanel}
            <div data-part="modal-text" class="ml-2 bg-darkbutton text-textcolor p-1 rounded text-sm">{language.othersUi.beta}</div>
            <button data-part="modal-close" class="ml-auto p-1 rounded hover:bg-selected" aria-label={language.uiCommon.close} onclick={() => {
                onClose()
            }}>
                <XIcon size={28} class="ml-auto hover:bg-selected rounded" aria-hidden="true"></XIcon>
            </button>
        </h2>
        <SegmentedControl
            options={[
                { label: language.model, value: 'models' },
                { label: language.parameters, value: 'parameters' },
                { label: language.customModels, value: 'customModels' },
                { label: language.settings, value: 'settings' },
            ]}
            bind:value={selectedOption}
            size="md"
        />

        {#if !hasEPRequirements}
            <div data-part="modal-text" class="mt-4 p-4 bg-darkbutton text-textcolor rounded">
                {language.epRequirementsNotMet}
            </div>

            <Button className="mt-4" onclick={() => {
                DBState.db.seperateParametersEnabled = true
                DBState.db.doNotChangeSeperateModels = true
                DBState.db.seperateModels = {
                    memory: '',
                    translate: '',
                    emotion: '',
                    otherAx: ''
                }
                DBState.db.epEnabled = true
                DBState.db.disableSeperateParameterChangeOnPresetChange = true
            }}>
                {language.run}
            </Button>

        {:else if selectedOption === 'models'}
             <div data-part="modal-body" class="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 justify-center items-center">
                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.mainModel}</span>
                    <ModelList bind:value={DBState.db.aiModel} blankable excludesPrefix="plugin"/>
                </div>
                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.submodel}</span>
                    <ModelList bind:value={DBState.db.subModel} blankable excludesPrefix="plugin"/>
                </div>
                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.longTermMemory}</span>
                    <ModelList bind:value={DBState.db.seperateModels.memory} blankable excludesPrefix="plugin"/>
                </div>
                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.translator}</span>
                    <ModelList bind:value={DBState.db.seperateModels.translate} blankable excludesPrefix="plugin"/>
                </div>
                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.emotionImage}</span>
                    <ModelList bind:value={DBState.db.seperateModels.emotion} blankable excludesPrefix="plugin"/>
                </div>

                <div data-part="modal-controls" class="col-span-1">
                    <span data-part="modal-text" class="text-textcolor">{language.others}</span>
                    <ModelList bind:value={DBState.db.seperateModels.otherAx} blankable excludesPrefix="plugin"/>
                </div>
                
            </div>
        {/if}
        {#if selectedOption === 'parameters'}

            {#if DBState.db.seperateParametersByModel}

                <ModelList bind:value={parameterModelSelection} blankable showRetired excludesPrefix="plugin" onChange={(v) => {
                    DBState.db.seperateParameters.overrides ??= {}
                    DBState.db.seperateParameters.overrides[v] ??= {}
                }}/>

                {#if parameterModelSelection !== ''}
                    <AllSeperateParameters bind:value={DBState.db.seperateParameters.overrides[parameterModelSelection]} withImportExport paramKey={parameterModelSelection} />

                {/if}
            {:else}
                <SegmentedControl
                    options={[
                        { label: language.longTermMemory, value: 'memory' },
                        { label: language.translator, value: 'translate' },
                        { label: language.emotionImage, value: 'emotion' },
                        { label: language.others, value: 'otherAx' },
                    ]}
                    bind:value={selectedParameterOption}
                    size="md"
                />
                <div data-part="modal-body" class="w-full mt-4 flex flex-col">
                    {#if selectedParameterOption === 'memory'}
                        <AllSeperateParameters bind:value={DBState.db.seperateParameters.memory} withImportExport paramKey="memory" />
                    {:else if selectedParameterOption === 'translate'}
                        <AllSeperateParameters bind:value={DBState.db.seperateParameters.translate} withImportExport paramKey="translate" />
                    {:else if selectedParameterOption === 'emotion'}
                        <AllSeperateParameters bind:value={DBState.db.seperateParameters.emotion} withImportExport paramKey="emotion" />
                    {:else if selectedParameterOption === 'otherAx'}
                        <AllSeperateParameters bind:value={DBState.db.seperateParameters.otherAx} withImportExport paramKey="otherAx" />
                    {/if}
                </div>

            {/if}
        {:else if selectedOption === 'customModels'}
            <CustomModelsSettings noAccordion />
        {:else if selectedOption === 'settings'}
             <CheckInput name={language.seperateParametersByModel} bind:check={DBState.db.seperateParametersByModel}/>
        {/if}
    </div>
</div>
