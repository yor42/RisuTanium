<script lang="ts">
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import { risuChatParser } from 'src/ts/parser/parser.svelte';
    import { language } from 'src/lang';
    import { sleep } from 'src/ts/util';
    import { hasModuleStubs, unloadedModulesOf } from 'src/ts/process/moduleRefList';
    import { ensurePlaygroundModulesOrAlert } from 'src/ts/process/moduleEnsure';
    let input = $state("");
    let output = $state("");
    let moduleWait: Promise<boolean> | null = null;
    let moduleWaitFailed = false;
    const onInput = async () => {
        try {
            await sleep(1)
            // A failed wait suppresses parsing only while a referenced stub is unloaded; hasModuleStubs() also counts unreferenced rows.
            if(moduleWaitFailed){
                if(unloadedModulesOf().length > 0){
                    output = ''
                    return
                }
                moduleWaitFailed = false
            }
            if(hasModuleStubs()){
                if(!moduleWait){
                    const wait = ensurePlaygroundModulesOrAlert()
                    moduleWait = wait.finally(() => { moduleWait = null })
                }
                if(!(await moduleWait)){
                    moduleWaitFailed = true
                    output = ''
                    return
                }
            }
            output = risuChatParser(input, {
                consistantChar: true,
            })
        } catch (e) {
            output = `Error: ${e}`
        }
    }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.syntax}</h2>

<span class="text-textcolor text-lg">{language.input}</span>

<TextAreaInput highlight onInput={onInput} bind:value={input} optimaizedInput={false} />

<span class="text-textcolor text-lg">{language.playground.result}</span>

<TextAreaInput value={output} />
