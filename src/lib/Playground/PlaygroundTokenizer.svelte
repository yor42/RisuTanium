<script lang="ts">
    import { encodeWithTokenizer, tokenizerList } from "src/ts/tokenizer";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import { language } from 'src/lang';

    let input = $state("");
    const uid = $props.id();
    let output = $state("");
    let outputLength = $state(0);
    let time = $state(0);
    let selectedTokenizer = $state("tik");

    const onInput = async () => {
        try {
            const start = performance.now();
            const tokenized = await encodeWithTokenizer(input, selectedTokenizer);
            time = performance.now() - start;
            const tokenizedNumArray = Array.from(tokenized)
            outputLength = tokenizedNumArray.length;
            output = JSON.stringify(tokenizedNumArray);
        } catch (e) {
            output = `Error: ${e}`
        }
    }

    const onTokenizerChange = () => {
        if (input) {
            onInput();
        }
    }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.tokenizer}</h2>

<span id="{uid}-tokenizer" class="text-textcolor text-lg">{language.tokenizer}</span>

<SelectInput labelId="{uid}-tokenizer" bind:value={selectedTokenizer} onchange={onTokenizerChange}>
    {#each tokenizerList as [value, label]}
        <option {value} class="bg-bgcolor">{label}</option>
    {/each}
</SelectInput>

<span id="{uid}-input" class="text-textcolor text-lg">{language.input}</span>

<TextAreaInput labelId="{uid}-input" onInput={onInput} bind:value={input} optimaizedInput={false} />

<span id="{uid}-result" class="text-textcolor text-lg">{language.playground.result}</span>

<TextAreaInput labelId="{uid}-result" value={output} />

<span class="text-textcolor2 text-lg">{outputLength} {language.tokens}</span>
<span class="text-textcolor2 text-lg">{time} ms</span>
