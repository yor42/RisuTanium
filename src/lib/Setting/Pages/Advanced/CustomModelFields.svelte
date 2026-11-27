<script lang="ts">
    import type { Snippet } from 'svelte';
    import { DBState } from 'src/ts/stores.svelte';
    import { language } from "src/lang";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import type { LLMFlags, LLMFormat, LLMTokenizer } from "src/ts/model/types";

    /*
     * The tokenizer, format, additional-params and flags controls of one stored custom model. The model
     * is found by id (and by connection when `connectionId` is given), so a model of another connection
     * is never written. Label ids are `{idPrefix}-tokenizer{idSuffix}` and so on.
     */
    let { modelId, connectionId, idPrefix, idSuffix = '', between }: {
        modelId: string,
        connectionId?: string,
        idPrefix: string,
        idSuffix?: string,
        /** Rendered between the format select and the additional params. */
        between?: Snippet,
    } = $props()

    const model = $derived(DBState.db.customModels.find((item) => item.id === modelId && (connectionId === undefined || item.connectionId === connectionId)))
</script>

{#snippet CustomFlagButton(name:string,flag:LLMFlags)}
    {#if model}
        <Button className="mt-2" onclick={() => {
            if(model.flags.includes(flag)){
                model.flags = model.flags.filter((f) => f !== flag)
            }
            else{
                model.flags.push(flag)
            }
        }} styled={model.flags.includes(flag) ? 'primary' : 'outlined'}>
            {name}
        </Button>
    {/if}
{/snippet}

{#if model}
<span class="text-textcolor mt-4" id="{idPrefix}-tokenizer{idSuffix}">{language.tokenizer}</span>
<SelectInput labelId="{idPrefix}-tokenizer{idSuffix}" size={"sm"} value={model.tokenizer.toString()} onchange={(e) => {
    model.tokenizer = parseInt(e.currentTarget.value) as LLMTokenizer
}}>
    <OptionInput value="0">{language.settingsPage.unknown}</OptionInput>
    <OptionInput value="1">tiktokenCl100kBase</OptionInput>
    <OptionInput value="2">tiktokenO200Base</OptionInput>
    <OptionInput value="3">Mistral</OptionInput>
    <OptionInput value="4">Llama</OptionInput>
    <OptionInput value="5">NovelAI</OptionInput>
    <OptionInput value="6">Claude</OptionInput>
    <OptionInput value="7">NovelList</OptionInput>
    <OptionInput value="8">Llama3</OptionInput>
    <OptionInput value="9">Gemma</OptionInput>
    <OptionInput value="10">GoogleCloud</OptionInput>
    <OptionInput value="11">Cohere</OptionInput>
    <OptionInput value="13">DeepSeek</OptionInput>
    <OptionInput value="14">DeepSeek V4</OptionInput>
    <OptionInput value="15">GLM4</OptionInput>
    <OptionInput value="16">GLM5</OptionInput>
</SelectInput>
<span class="text-textcolor" id="{idPrefix}-format{idSuffix}">{language.format}</span>
<SelectInput labelId="{idPrefix}-format{idSuffix}" size={"sm"} value={model.format.toString()} onchange={(e) => {
    model.format = parseInt(e.currentTarget.value) as LLMFormat
}}>
    <OptionInput value="0">OpenAICompatible</OptionInput>
    <OptionInput value="1">OpenAILegacyInstruct</OptionInput>
    <OptionInput value="2">Anthropic</OptionInput>
    <OptionInput value="3">AnthropicLegacy</OptionInput>
    <OptionInput value="4">Mistral</OptionInput>
    <OptionInput value="5">GoogleCloud</OptionInput>
    <OptionInput value="6">VertexAIGemini</OptionInput>
    <OptionInput value="7">NovelList</OptionInput>
    <OptionInput value="8">Cohere</OptionInput>
    <OptionInput value="9">NovelAI</OptionInput>
    <OptionInput value="11">OobaLegacy</OptionInput>
    <OptionInput value="13">Ooba</OptionInput>
    <OptionInput value="14">Kobold</OptionInput>
    <OptionInput value="17">AWSBedrockClaude</OptionInput>
    <OptionInput value="18">OpenAIResponseAPI</OptionInput>
</SelectInput>
{@render between?.()}
<span class="text-textcolor" id="{idPrefix}-params{idSuffix}">{language.additionalParams}</span>
<TextAreaInput labelId="{idPrefix}-params{idSuffix}" bind:value={model.params} placeholder={`temperature=0.7
    max_tokens=2000
    reasoning_effort="high"
    header::anthropic-dangerous-direct-browser-access=true
    stop=json::["</s>", "\\n\\n"]
    frequency_penalty={{none}}`}/>
<Accordion styled name={language.flags}>
    {@render CustomFlagButton('hasImageInput', 0)}
    {@render CustomFlagButton('hasImageOutput', 1)}
    {@render CustomFlagButton('hasAudioInput', 2)}
    {@render CustomFlagButton('hasAudioOutput', 3)}
    {@render CustomFlagButton('hasPrefill', 4)}
    {@render CustomFlagButton('hasCache', 5)}
    {@render CustomFlagButton('hasFullSystemPrompt', 6)}
    {@render CustomFlagButton('hasFirstSystemPrompt', 7)}
    {@render CustomFlagButton('hasStreaming', 8)}
    {@render CustomFlagButton('requiresAlternateRole', 9)}
    {@render CustomFlagButton('mustStartWithUserInput', 10)}
    {@render CustomFlagButton('hasVideoInput', 12)}
    {@render CustomFlagButton('OAICompletionTokens', 13)}
    {@render CustomFlagButton('DeveloperRole', 14)}
    {@render CustomFlagButton('geminiThinking', 15)}
    {@render CustomFlagButton('geminiBlockOff', 16)}
    {@render CustomFlagButton('deepSeekPrefix', 17)}
    {@render CustomFlagButton('deepSeekThinkingInput', 18)}
    {@render CustomFlagButton('deepSeekThinkingOutput', 19)}
    {@render CustomFlagButton('noCivilIntegrity', 20)}
    {@render CustomFlagButton('claudeThinking', 21)}
    {@render CustomFlagButton('claudeAdaptiveThinking', 22)}
    {@render CustomFlagButton('claudeXHighEffort', 23)}
    {@render CustomFlagButton('deepSeekThinkingToggle', 24)}
</Accordion>
{/if}
