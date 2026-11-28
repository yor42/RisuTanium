<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import { language } from "src/lang";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import SlotKeyField from "src/lib/SettingsShell/connections/SlotKeyField.svelte";
    import ConnectionsLink from "src/lib/SettingsShell/connections/ConnectionsLink.svelte";
    import CustomModelFields from "./CustomModelFields.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import { PlusIcon, TrashIcon, ArrowUp, ArrowDown } from "@lucide/svelte";
    import { v4 } from "uuid";
    import { customModelUrlValue, setCustomModelUrl } from "src/ts/connections/slotEditor";

    const uid = $props.id();
    let openedModels = $state(new Set<string>());

    let { noAccordion }:{
        noAccordion?: boolean,
    } = $props()
</script>

{#snippet mainBody()}
    {#each DBState.db.customModels as model, index (model.id)}
        <div class="flex flex-col mt-2">
            <button class="hover:bg-selected px-6 py-2 text-lg rounded-t-md border-selected border flex justify-between items-center"
                class:bg-selected={openedModels.has(model.id)}
                class:rounded-b-md={!openedModels.has(model.id)}
                onclick={() => {
                    if (openedModels.has(model.id)) {
                        openedModels.delete(model.id)
                    } else {
                        openedModels.add(model.id)
                    }
                    openedModels = new Set(openedModels)
                }}
            >
                <span class="text-left">{model.name ?? language.settingsPage.unnamed}</span>
                <div class="flex items-center gap-1">
                    <Button size="sm" styled="outlined" onclick={(e) => {
                        e.stopPropagation()
                        if(index === 0) return
                        let models = DBState.db.customModels
                        let temp = models[index]
                        models[index] = models[index - 1]
                        models[index - 1] = temp
                        DBState.db.customModels = models
                    }}>
                        <ArrowUp aria-hidden="true" /><span class="sr-only">{language.chatShellMoveUp}</span>
                    </Button>
                    <Button size="sm" styled="outlined" onclick={(e) => {
                        e.stopPropagation()
                        if(index === DBState.db.customModels.length - 1) return
                        let models = DBState.db.customModels
                        let temp = models[index]
                        models[index] = models[index + 1]
                        models[index + 1] = temp
                        DBState.db.customModels = models
                    }}>
                        <ArrowDown aria-hidden="true" /><span class="sr-only">{language.chatShellMoveDown}</span>
                    </Button>
                    <Button size="sm" styled="outlined" onclick={(e) => {
                        e.stopPropagation()
                        let models = DBState.db.customModels
                        models.splice(index, 1)
                        DBState.db.customModels = models
                        openedModels.delete(model.id)
                        openedModels = new Set(openedModels)
                    }}>
                        <TrashIcon aria-hidden="true" /><span class="sr-only">{language.remove}</span>
                    </Button>
                </div>
            </button>
            {#if openedModels.has(model.id)}
            <div class="flex flex-col border border-selected p-2 rounded-b-md overflow-x-auto">
            <span class="text-textcolor mt-4" id="{uid}-name-{index}">{language.name}</span>
            <TextInput labelId="{uid}-name-{index}" size={"sm"} bind:value={DBState.db.customModels[index].name}/>
            <span class="text-textcolor mt-4" id="{uid}-model-{index}">{language.proxyRequestModel}</span>
            <TextInput labelId="{uid}-model-{index}" size={"sm"} bind:value={DBState.db.customModels[index].internalId}/>
            <span class="text-textcolor mt-4" id="{uid}-url-{index}">URL</span>
            <TextInput labelId="{uid}-url-{index}" size={"sm"} bind:value={() => customModelUrlValue(DBState.db, model.id), (v) => { setCustomModelUrl(DBState.db, model.id, v) }}/>
            <CustomModelFields modelId={model.id} idPrefix={uid} idSuffix="-{index}">
                {#snippet between()}
                    <span class="text-textcolor" id="{uid}-key-{index}">{language.proxyAPIKey}</span>
                    <SlotKeyField keySlot={`customModels:${model.id}`} labelId="{uid}-key-{index}" />
                    <ConnectionsLink />
                {/snippet}
            </CustomModelFields>
                </div>
            {/if}
        </div>
    {/each}
    <div class="flex flex-col mt-2">
        <button aria-label={language.add} class="hover:bg-selected px-6 py-2 text-lg rounded-md border-selected border flex justify-center items-center cursor-pointer" onclick={() => {
            DBState.db.customModels.push({
                internalId: "",
                tokenizer: 0,
                format: 0,
                id: 'xcustom:::' + v4(),
                name: "",
                params: "",
                flags: [],
            })
        }}>
            <PlusIcon aria-hidden="true" />
        </button>
    </div>
    
{/snippet}


{#if noAccordion}
    {@render mainBody()}
{:else}
    <Accordion styled name={language.customModels} className="overflow-x-auto">
        {@render mainBody()}
    </Accordion>

{/if}
