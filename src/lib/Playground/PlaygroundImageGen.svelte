<script lang="ts">
    import { language } from "src/lang";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { generateAIImage } from "src/ts/process/stableDiff";
    import { createBlankChar } from "src/ts/characters";
    import { alertError } from "src/ts/alert";
    let prompt = $state("");
    let negPrompt = $state("");
    let img = $state("");
    let generating = $state(false)
    const uid = $props.id()
    const run = async () => {
        console.log('running')
        if(generating){
            return
        }
        generating = true
        try {
            const gen = await generateAIImage(prompt, createBlankChar(), negPrompt, 'inlay')
            if(gen){
                img = gen
            }
        } catch (error) {
            alertError(error instanceof Error ? error : String(error))
        } finally {
            generating = false
        }
    }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.imageGeneration}</h2>

<span id="{uid}-prompt" class="text-textcolor text-lg">{language.prompt}</span>
<TextAreaInput labelId="{uid}-prompt" bind:value={prompt} />

<span id="{uid}-neg-prompt" class="text-textcolor text-lg">{language.playground.negPrompt}</span>
<TextAreaInput labelId="{uid}-neg-prompt" bind:value={negPrompt} />

{#if img}
    <span class="text-textcolor text-lg">{language.playground.generated}</span>
    <img src={img} class="max-w-full mt-4" alt={language.playground.generated}/>
{/if}

<Button className="mt-6" onclick={run}>
    {#if generating}
        <div class="loadmove"></div>
    {:else}
        {language.playground.generate}
    {/if}
</Button>