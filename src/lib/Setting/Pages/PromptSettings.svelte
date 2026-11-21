<script lang="ts">
    import { ArrowLeft, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import PromptDataItem from "src/lib/UI/PromptDataItem.svelte";
    import { tokenizePreset, type PromptItem } from "src/ts/process/prompt";
    import { templateCheck } from "src/ts/process/templates/templateCheck";
    
    import { DBState } from 'src/ts/stores.svelte';
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import ModelList from "src/lib/UI/ModelList.svelte";
    import { onDestroy, onMount } from "svelte";
    import {defaultAutoSuggestPrompt} from "../../../ts/storage/defaultPrompts";
    import { keyEventBlocked } from "src/ts/keyEventBlocked";

    let sorted = 0
    let warns: string[] = $state([])
    let tokens = $state(0)
    let extokens = $state(0)
    let draggedIndex = $state(-1)
    let dragOverIndex = $state(-1)
    let openedItemIndices = $state(new Set<number>())
    executeTokenize(DBState.db.promptTemplate ?? [])
  interface Props {
    onGoBack?: () => void;
    mode?: 'independent'|'inline';
    subMenu?: number;
  }

  let { onGoBack = () => {}, mode = 'independent', subMenu = $bindable(0) }: Props = $props();
  const uid = $props.id()

    async function executeTokenize(prest: PromptItem[]){
        tokens = await tokenizePreset(prest, true)
        extokens = await tokenizePreset(prest, false)
    }

    $effect.pre(() => {
    warns = templateCheck(DBState.db)
  });
  $effect.pre(() => {
    executeTokenize(DBState.db.promptTemplate ?? [])
  });

  function getDisplayTemplate() {
    return (DBState.db.promptTemplate ?? []).map((item, i) => ({
      item,
      originalIndex: i,
      displayIndex: i
    }))
  }

  function getReorderedTemplate() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return getDisplayTemplate()
    }

    const items = getDisplayTemplate()
    const [movedItem] = items.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    items.splice(adjustedDropIndex, 0, movedItem)

    return items.map((item, displayIndex) => ({
      ...item,
      displayIndex
    }))
  }

  function handlePromptDrop() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return
    }

    const templates = [...DBState.db.promptTemplate]
    const [movedItem] = templates.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    templates.splice(adjustedDropIndex, 0, movedItem)

    const newOpenedIndices = new Set<number>()
    openedItemIndices.forEach((index) => {
      if (index === draggedIndex) {
        newOpenedIndices.add(adjustedDropIndex)
      } else if (draggedIndex < adjustedDropIndex) {
        if (index > draggedIndex && index <= adjustedDropIndex) {
          newOpenedIndices.add(index - 1)
        } else {
          newOpenedIndices.add(index)
        }
      } else {
        if (index >= adjustedDropIndex && index < draggedIndex) {
          newOpenedIndices.add(index + 1)
        } else {
          newOpenedIndices.add(index)
        }
      }
    })
    openedItemIndices = newOpenedIndices

    DBState.db.promptTemplate = templates
    draggedIndex = -1
    dragOverIndex = -1
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (keyEventBlocked(e)) {
      return
    }
    if (e.ctrlKey && e.altKey && e.key === 'o') {
      if (openedItemIndices.size === (DBState.db.promptTemplate ?? []).length) {
        openedItemIndices = new Set<number>()
      } else {
        openedItemIndices = new Set((DBState.db.promptTemplate ?? []).map((_, i) => i))
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })
</script>
{#if mode === 'independent'}
    <h2 class="mb-2 text-2xl font-bold mt-2 items-center flex">
        <button aria-label={language.settingsPage.back} class="mr-2 text-textcolor2 hover:text-textcolor" onclick={onGoBack}>
            <ArrowLeft aria-hidden="true" />
        </button>
        {language.promptTemplate}
    </h2>

    <div class="flex w-full rounded-md border border-selected">
        <button onclick={() => {
            subMenu = 0
        }} class="p-2 flex-1" class:bg-selected={subMenu === 0}>
            <span>{language.template}</span>
        </button>
        <button onclick={() => {
            subMenu = 1
        }} class="p-2 flex-1" class:bg-selected={subMenu === 1}>
            <span>{language.settings}</span>
        </button>
    </div>
{/if}
{#if warns.length > 0 && subMenu === 0}
    <div class="text-draculared flex flex-col items-start p-2 rounded-md border-draculared border mt-4">
        <h2 class="text-xl font-bold">{language.settingsPage.warning}</h2>
        <div class="border-b border-b-draculared mt-1 mb-2 w-full"></div>
        {#each warns as warn}
            <span class="ml-4">{warn}</span>
        {/each}
    </div>
{/if}

{#if subMenu === 0}
    <div class="contain w-full max-w-full mt-4 flex flex-col p-3 rounded-md">
        {#if (DBState.db.promptTemplate ?? []).length === 0}
                <div class="text-textcolor2">{language.settingsPage.noFormat}</div>
        {/if}
        {#key sorted}
            {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex }}
                <PromptDataItem
                    bind:promptItem={DBState.db.promptTemplate[originalIndex]}
                    isDragging={draggedIndex === originalIndex}
                    isOpened={openedItemIndices.has(originalIndex)}
                    bind:draggedIndex
                    bind:dragOverIndex
                    bind:openedItemIndices
                    currentIndex={originalIndex}
                    displayIndex={displayIndex}
                    onDrop={handlePromptDrop}
                    onRemove={() => {
                        let templates = DBState.db.promptTemplate
                        templates.splice(originalIndex, 1)
                        DBState.db.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                return
                            } else if (index > originalIndex) {
                                newOpenedIndices.add(index - 1)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices

                        draggedIndex = -1
                        dragOverIndex = -1
                    }}
                    moveDown={() => {
                        if(originalIndex === DBState.db.promptTemplate.length - 1){
                            return
                        }
                        let templates = DBState.db.promptTemplate
                        let temp = templates[originalIndex]
                        templates[originalIndex] = templates[originalIndex + 1]
                        templates[originalIndex + 1] = temp
                        DBState.db.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                newOpenedIndices.add(originalIndex + 1)
                            } else if (index === originalIndex + 1) {
                                newOpenedIndices.add(originalIndex)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices
                    }}
                    moveUp={() => {
                        if(originalIndex === 0){
                            return
                        }
                        let templates = DBState.db.promptTemplate
                        let temp = templates[originalIndex]
                        templates[originalIndex] = templates[originalIndex - 1]
                        templates[originalIndex - 1] = temp
                        DBState.db.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                newOpenedIndices.add(originalIndex - 1)
                            } else if (index === originalIndex - 1) {
                                newOpenedIndices.add(originalIndex)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices
                    }} />
            {/each}
        {/key}
    </div>

    <button aria-label={language.add} class="font-medium cursor-pointer hover:text-textcolor2" onclick={() => {
        let value = DBState.db.promptTemplate ?? []
        value.push({
            type: "plain",
            text: "",
            role: "system",
            type2: 'normal'
        })
        DBState.db.promptTemplate = value
    }}><PlusIcon aria-hidden="true" /></button>

    <span class="text-textcolor2 text-sm mt-2">{tokens} {language.fixedTokens}</span>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{extokens} {language.exactTokens}</span>
{:else}
    <span class="text-textcolor mt-4" id="{uid}-f1">{language.postEndInnerFormat}</span>
    <TextInput labelId="{uid}-f1" bind:value={DBState.db.promptSettings.postEndInnerFormat}/>

    <Check bind:check={DBState.db.promptSettings.sendChatAsSystem} name={language.sendChatAsSystem} className="mt-4"/>
    <Check bind:check={DBState.db.promptSettings.sendName} name={language.formatGroupInSingle} className="mt-4"/>
    <Check bind:check={DBState.db.promptSettings.trimStartNewChat} name={language.trimStartNewChat} className="mt-4"/>
    <Check bind:check={DBState.db.promptSettings.utilOverride} name={language.utilOverride} className="mt-4"/>
    <Check bind:check={DBState.db.jsonSchemaEnabled} name={language.enableJsonSchema} className="mt-4"/>
    <Check bind:check={DBState.db.outputImageModal} name={language.outputImageModal} className="mt-4"/>

    <Check bind:check={DBState.db.strictJsonSchema} name={language.strictJsonSchema} className="mt-4"/>

    {#if DBState.db.showUnrecommended}
        <Check bind:check={DBState.db.promptSettings.customChainOfThought} name={language.customChainOfThought} className="mt-4">
            <Help unrecommended key='customChainOfThought' />
        </Check>
    {/if}
    <span class="text-textcolor mt-4" id="{uid}-v1">{language.maxThoughtTagDepth}</span>
    <NumberInput labelId="{uid}-v1" bind:value={DBState.db.promptSettings.maxThoughtTagDepth}/>
    <span class="text-textcolor mt-4"><span id="{uid}-v2">{language.groupOtherBotRole}</span> <Help key="groupOtherBotRole"/></span>
    <SelectInput labelId="{uid}-v2" bind:value={DBState.db.groupOtherBotRole}>
        <OptionInput value="user">User</OptionInput>
        <OptionInput value="system">System</OptionInput>
        <OptionInput value="assistant">assistant</OptionInput>
    </SelectInput>
    <span class="text-textcolor mt-4"><span id="{uid}-f2">{language.customPromptTemplateToggle}</span> <Help key='customPromptTemplateToggle' /></span>
    <TextAreaInput labelId="{uid}-f2" bind:value={DBState.db.customPromptTemplateToggle}/>
    <span class="text-textcolor mt-4"><span id="{uid}-f3">{language.defaultVariables}</span> <Help key='defaultVariables' /></span>
    <TextAreaInput labelId="{uid}-f3" bind:value={DBState.db.templateDefaultVariables}/>
    <span class="text-textcolor mt-4" id="{uid}-f4">{language.predictedOutput}</span>
    <TextAreaInput labelId="{uid}-f4" bind:value={DBState.db.OAIPrediction}/>
    <span class="text-textcolor mt-4"><span id="{uid}-f5">{language.autoSuggest}</span> <Help key='autoSuggest' /></span>
    <TextAreaInput labelId="{uid}-f5" bind:value={DBState.db.autoSuggestPrompt} placeholder={defaultAutoSuggestPrompt}/>
    <span class="text-textcolor mt-4"><span id="{uid}-f6">{language.groupInnerFormat}</span> <Help key='groupInnerFormat' /></span>
    <TextAreaInput labelId="{uid}-f6" placeholder={`<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`} bind:value={DBState.db.groupTemplate}/>
    <span class="text-textcolor mt-4"><span id="{uid}-f7">{language.systemContentReplacement}</span> <Help key="systemContentReplacement"/></span>
    <TextAreaInput labelId="{uid}-f7" bind:value={DBState.db.systemContentReplacement}/>
    <span class="text-textcolor mt-4"><span id="{uid}-v3">{language.systemRoleReplacement}</span> <Help key="systemRoleReplacement"/></span>
    <SelectInput labelId="{uid}-v3" bind:value={DBState.db.systemRoleReplacement}>
        <OptionInput value="user">User</OptionInput>
        <OptionInput value="assistant">assistant</OptionInput>
    </SelectInput>
    {#if DBState.db.jsonSchemaEnabled}
        <span class="text-textcolor mt-4"><span id="{uid}-f8">{language.jsonSchema}</span> <Help key='jsonSchema' /></span>
        <TextAreaInput labelId="{uid}-f8" bind:value={DBState.db.jsonSchema}/>
        <span class="text-textcolor mt-4"><span id="{uid}-f9">{language.extractJson}</span> <Help key='extractJson' /></span>
        <TextInput labelId="{uid}-f9" bind:value={DBState.db.extractJson}/>
    {/if}

    {#snippet fallbackModelList(arg:'model'|'memory'|'translate'|'emotion'|'otherAx')}
        {#each DBState.db.fallbackModels[arg] as model, i}
            <span class="text-textcolor mt-4">
                {language.model} {i + 1}
            </span>
            <ModelList bind:value={DBState.db.fallbackModels[arg][i]} blankable />
        {/each}
        <div class="flex gap-2">
            <button aria-label={language.add} class="bg-selected text-textcolor p-2 rounded-md" onclick={() => {
                let value = DBState.db.fallbackModels[arg] ?? []
                value.push('')
                DBState.db.fallbackModels[arg] = value
            }}><PlusIcon aria-hidden="true" /></button>
            <button aria-label={language.remove} class="border border-draculared text-draculared hover:bg-draculared hover:text-bgcolor p-2 rounded-md" onclick={() => {
                let value = DBState.db.fallbackModels[arg] ?? []
                value.pop()
                DBState.db.fallbackModels[arg] = value
            }}><TrashIcon aria-hidden="true" /></button>
        </div>
    {/snippet}

    <Accordion name={language.fallbackModel} styled>
        <Check bind:check={DBState.db.fallbackWhenBlankResponse} name={language.fallbackWhenBlankResponse} className="mt-4"/>
        <Check bind:check={DBState.db.doNotChangeFallbackModels} name={language.doNotChangeFallbackModels} className="mt-4"/>

        <Accordion name={language.model} styled>
            {@render fallbackModelList('model')}
        </Accordion>
        <Accordion name={language.settingsPage.memory} styled>
            {@render fallbackModelList('memory')}
        </Accordion>
        <Accordion name={language.settingsPage.translations} styled>
            {@render fallbackModelList('translate')}
        </Accordion>
        <Accordion name={language.settingsPage.emotion} styled>
            {@render fallbackModelList('emotion')}
        </Accordion>
        <Accordion name={language.settingsPage.otherAx} styled>
            {@render fallbackModelList('otherAx')}
        </Accordion>
    </Accordion>

{/if}