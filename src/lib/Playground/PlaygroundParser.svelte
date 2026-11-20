<script lang="ts">
    import { ParseMarkdown } from "src/ts/parser/parser.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import { language } from "src/lang";
    let input = $state("");
    const uid = $props.id();
    let output = $state("");
    const onInput = async () => {
        try {
            output = await ParseMarkdown(input)
        } catch (e) {
            output = `Error: ${e}`
        }
    }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.playground.fullParser}</h2>

<span id="{uid}-input" class="text-textcolor text-lg">{language.input}</span>

<TextAreaInput labelId="{uid}-input" onInput={onInput} bind:value={input} optimaizedInput={false} />

<span id="{uid}-output" class="text-textcolor text-lg">{language.playground.outputHtml}</span>

<TextAreaInput labelId="{uid}-output" value={output} />