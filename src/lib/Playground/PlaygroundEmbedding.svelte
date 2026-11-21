<script lang="ts">
    import { language } from "src/lang";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { HypaProcesser } from "src/ts/process/memory/hypamemory";
    import { DEFAULT_HYPA_MODEL } from "src/ts/process/memory/embeddingModels";
    import { DBState } from "src/ts/stores.svelte"
    import { alertError } from "src/ts/alert";

    let query = $state("");
    // Starts on the user's own embedding model; the default only fills an unset or empty one.
    let model = $state<string>(DBState.db.hypaModel || DEFAULT_HYPA_MODEL);
    // The OpenAI key and custom URL are this page's own copies, seeded once from the
    // memory settings; editing them never writes the settings.
    let openAIKey = $state(DBState.db.supaMemoryKey ?? "");
    let customEmbeddingUrl = $state(DBState.db.hypaCustomSettings?.url ?? "");
    let data:string[] = $state([]);
    let dataresult:[string, number][] = $state([]);
    let running = $state(false);
    const uid = $props.id();

    // HypaProcesser falls back to the saved value when given a blank one, so a blank
    // local field must stop the run rather than silently use the saved value.
    const missingFieldMessage = (): string | null => {
        if(model === 'custom' && !customEmbeddingUrl.trim()) {
            return language.playground.embeddingUrlMissing;
        }
        if((model === 'openai3small' || model === 'openai3large' || model === 'ada') && !openAIKey.trim()) {
            return language.playground.embeddingOpenAIKeyMissing;
        }
        return null;
    }

    const run = async () => {
        if(running) return;
        const missing = missingFieldMessage();
        if(missing) {
            alertError(missing);
            return;
        }
        running = true;
        try {
            const processer = new HypaProcesser(model as any, customEmbeddingUrl);
            processer.oaikey = openAIKey;
            await processer.addText(data);
            console.log(processer.vectors)
            dataresult = await processer.similaritySearchScored(query);
        } catch (error) {
            alertError(error instanceof Error ? error : String(error));
        } finally {
            running = false;
        }
    }
</script>
  
<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.embedding}</h2>

<span id="{uid}-model" class="text-textcolor text-lg">{language.model}</span>
<SelectInput labelId="{uid}-model" bind:value={model} className="mb-4">
    {#if 'gpu' in navigator}
        <OptionInput value="MiniLMGPU">MiniLM L6 v2 (GPU)</OptionInput>
        <OptionInput value="nomicGPU">Nomic Embed Text v1.5 (GPU)</OptionInput>
        <OptionInput value="bgeSmallEnGPU">BGE Small English (GPU)</OptionInput>
        <OptionInput value="bgem3GPU">BGE Medium 3 (GPU)</OptionInput>
        <OptionInput value="multiMiniLMGPU">Multilingual MiniLM L12 v2 (GPU)</OptionInput>
        <OptionInput value="bgeM3KoGPU">BGE Medium 3 Korean (GPU)</OptionInput>
    {/if}
    <OptionInput value="MiniLM">MiniLM L6 v2 (CPU)</OptionInput>
    <OptionInput value="nomic">Nomic Embed Text v1.5 (CPU)</OptionInput>
    <OptionInput value="bgeSmallEn">BGE Small English (CPU)</OptionInput>
    <OptionInput value="bgem3">BGE Medium 3 (CPU)</OptionInput>
    <OptionInput value="multiMiniLM">Multilingual MiniLM L12 v2 (CPU)</OptionInput>
    <OptionInput value="multiE5Small">Multilingual E5 Small (CPU)</OptionInput>
    <OptionInput value="bgeM3Ko">BGE Medium 3 Korean (CPU)</OptionInput>
    <OptionInput value="openai3small">OpenAI text-embedding-3-small</OptionInput>
    <OptionInput value="openai3large">OpenAI text-embedding-3-large</OptionInput>
    <OptionInput value="ada">OpenAI Ada</OptionInput>
    <OptionInput value="custom">{language.settingsPage.customOpenAiCompatible}</OptionInput>
</SelectInput>

{#if model === 'openai3small' || model === 'openai3large' || model === 'ada'}
    <span id="{uid}-openai-key" class="text-textcolor text-lg">OpenAI API Key</span>
    <TextInput labelId="{uid}-openai-key" size="sm" marginBottom bind:value={openAIKey}/>
{/if}

{#if model === "custom"}
    <span id="{uid}-url" class="text-textcolor text-lg">URL</span>
    <TextInput labelId="{uid}-url" size="sm" marginBottom bind:value={customEmbeddingUrl}/>
    <span id="{uid}-proxy-key" class="text-textcolor text-lg">{language.proxyAPIKey}</span>
    <TextInput labelId="{uid}-proxy-key" size="sm" marginBottom bind:value={DBState.db.hypaCustomSettings.key}/>
    <span id="{uid}-request-model" class="text-textcolor text-lg">{language.playground.requestModel}</span>
    <TextInput labelId="{uid}-request-model" size="sm" marginBottom bind:value={DBState.db.hypaCustomSettings.model}/>
    <span class="text-textcolor2 text-sm mb-4">{language.playground.embeddingSharedSettingsNote}</span>
{/if}

<div class="mb-4"></div>

<span id="{uid}-query" class="text-textcolor text-lg">{language.playground.query}</span>
<TextInput labelId="{uid}-query" bind:value={query} size="lg" fullwidth />

<span id="{uid}-data" class="text-textcolor text-lg mt-6">{language.playground.data}</span>
{#each data as item, i}
    <TextInput labelId="{uid}-data" bind:value={data[i]} size="lg" fullwidth marginBottom />
{/each}
<Button styled="outlined" onclick={() => {
    data.push("");
    data = data
}}>+</Button>

<span class="text-textcolor text-lg mt-6">{language.playground.result}</span>
{#if dataresult.length === 0}
    <span class="text-textcolor2 text-lg">{language.playground.noResult}</span>
{/if}
{#each dataresult as [item, score]}
    <div class="flex justify-between">
        <span>{item}</span>
        <span>{score.toFixed(2)}</span>
    </div>
{/each}

<Button className="mt-6 flex justify-center" size="lg" onclick={() => {
    run()
}}>
    {#if running}
        <div class="loadmove"></div>
    {:else}
        {language.run?.toLocaleUpperCase()}
    {/if}
</Button>