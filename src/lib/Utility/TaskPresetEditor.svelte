<script lang="ts">
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import { alertConfirm } from 'src/ts/alert'
    import { DBState } from 'src/ts/stores.svelte'
    import { TASK_PRESET_TEMPERATURE_MAX, validateTaskPreset, type TaskPreset } from 'src/ts/process/utility/taskPreset'
    import Button from '../UI/GUI/Button.svelte'
    import CheckInput from '../UI/GUI/CheckInput.svelte'
    import NumberInput from '../UI/GUI/NumberInput.svelte'
    import TextInput from '../UI/GUI/TextInput.svelte'
    import ModelList from '../UI/ModelList.svelte'

    // Every edit below assigns one field of the stored preset in place, so a key this build does not know stays on the
    // object through an edit of another field.
    let selectedId = $state<string | null>(null)

    const presets = $derived(DBState.db.taskPresets ?? [])

    function addPreset() {
        const preset: TaskPreset = {
            id: crypto.randomUUID(),
            name: '',
            instructions: '',
            model: '',
        }
        if (!DBState.db.taskPresets) {
            DBState.db.taskPresets = []
        }
        DBState.db.taskPresets.push(preset)
        selectedId = preset.id
    }

    async function deletePreset(preset: TaskPreset) {
        const label = preset.name || language.utility.editor.untitled
        if (!await alertConfirm(fillLang(language.utility.editor.deleteConfirm, { name: label }))) {
            return
        }
        const list = DBState.db.taskPresets
        const index = list ? list.findIndex((candidate) => candidate.id === preset.id) : -1
        if (list && index >= 0) {
            list.splice(index, 1)
        }
        if (selectedId === preset.id) {
            selectedId = null
        }
    }

    function setGlobalTemperature(preset: TaskPreset, useGlobal: boolean) {
        if (useGlobal) {
            delete preset.temperature
        }
        else {
            preset.temperature = 1
        }
    }

    // A blank or non-numeric entry leaves the stored value alone, and the others are brought into the range the preset
    // format accepts, so the editor itself never saves a value the notice below would flag.
    function setTemperature(preset: TaskPreset, entered: number) {
        if (Number.isFinite(entered)) {
            preset.temperature = Math.min(TASK_PRESET_TEMPERATURE_MAX, Math.max(0, entered))
        }
    }

    function setMaxTokens(preset: TaskPreset, entered: number) {
        if (Number.isFinite(entered)) {
            preset.maxTokens = Math.max(1, Math.round(entered))
        }
    }

    function setGlobalMaxTokens(preset: TaskPreset, useGlobal: boolean) {
        if (useGlobal) {
            delete preset.maxTokens
        }
        else {
            preset.maxTokens = 1024
        }
    }
</script>

<div class="flex flex-col gap-3 text-textcolor" data-testid="task-preset-editor">
    <h2 class="text-xl font-bold">{language.utility.editor.heading}</h2>
    <div class="flex flex-wrap gap-2">
        {#each presets as preset (preset.id)}
            <Button selected={preset.id === selectedId} styled="outlined" onclick={() => { selectedId = preset.id }}>
                {preset.name || language.utility.editor.untitled}
            </Button>
        {/each}
        <Button onclick={addPreset}>{language.utility.editor.newPreset}</Button>
    </div>

    {#each presets as preset (preset.id)}
        {#if preset.id === selectedId}
            {@const problems = validateTaskPreset(preset)}
            <div class="flex flex-col gap-2 rounded-md border border-darkborderc bg-darkbg p-4" data-testid="task-preset-fields">
                {#if problems.length > 0}
                    <div class="rounded-md border border-draculared p-2 text-draculared" role="alert" data-testid="task-preset-damaged">
                        <p>{language.utility.damagedPreset}</p>
                        <ul class="list-disc pl-6">
                            {#each problems as problem}
                                <li>{problem}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}

                <label class="text-textcolor2" for="task-preset-name">{language.utility.editor.name}</label>
                <TextInput id="task-preset-name" fullwidth bind:value={preset.name} />

                <label class="text-textcolor2" for="task-preset-instructions">{language.utility.editor.instructions}</label>
                <textarea
                    id="task-preset-instructions"
                    class="min-h-40 w-full resize-y rounded-md border border-darkborderc bg-transparent px-4 py-2 text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                    bind:value={preset.instructions}
                ></textarea>

                <span class="text-textcolor2">{language.utility.editor.model}</span>
                <ModelList bind:value={preset.model} />

                <span class="text-textcolor2">{language.utility.editor.temperature}</span>
                <CheckInput
                    name={language.utility.editor.useGlobalTemperature}
                    check={preset.temperature === undefined}
                    onChange={(check) => setGlobalTemperature(preset, check)}
                />
                {#if preset.temperature !== undefined}
                    <NumberInput id="task-preset-temperature" min={0} max={TASK_PRESET_TEMPERATURE_MAX} value={preset.temperature} onChange={(event) => setTemperature(preset, event.currentTarget.valueAsNumber)} />
                {/if}

                <span class="text-textcolor2">{language.utility.editor.maxTokens}</span>
                <CheckInput
                    name={language.utility.editor.useGlobalMaxTokens}
                    check={preset.maxTokens === undefined}
                    onChange={(check) => setGlobalMaxTokens(preset, check)}
                />
                {#if preset.maxTokens !== undefined}
                    <NumberInput id="task-preset-max-tokens" min={1} value={preset.maxTokens} onChange={(event) => setMaxTokens(preset, event.currentTarget.valueAsNumber)} />
                {/if}

                <div>
                    <Button styled="danger" onclick={() => deletePreset(preset)}>{language.utility.editor.delete}</Button>
                </div>
            </div>
        {/if}
    {/each}
    {#if !presets.some((preset) => preset.id === selectedId)}
        <p class="text-textcolor2">{language.utility.editor.choose}</p>
    {/if}

    <p class="text-sm text-textcolor2" data-testid="task-preset-device-note">{language.utility.editor.deviceOnlyNote}</p>
    <p class="text-sm text-textcolor2" data-testid="task-preset-global-note">{language.utility.editor.globalSettingsNote}</p>
</div>
