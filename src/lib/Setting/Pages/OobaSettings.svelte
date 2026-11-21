<script lang="ts">
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import OptionalInput from "src/lib/UI/GUI/OptionalInput.svelte";
    
    import { DBState } from 'src/ts/stores.svelte';
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import { language } from "src/lang";
    import { PlusIcon, TrashIcon } from "@lucide/svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import ChatFormatSettings from "./ChatFormatSettings.svelte";
    import { fillLang } from "src/lang/fill";
    interface Props {
        instructionMode?: boolean;
    }

    let { instructionMode = false }: Props = $props();
    const uid = $props.id();
</script>

<Accordion name={fillLang(language.settingsPage.nameSettings, { name: 'Ooba' })} styled>
    {#if instructionMode}
        <ChatFormatSettings />
    {:else}
        <span class="text-textcolor" id="{uid}-mode">{fillLang(language.settingsPage.nameMode, { name: 'Ooba' })}</span>
        <SelectInput labelId="{uid}-mode" className="mt-2 mb-4" bind:value={DBState.db.reverseProxyOobaArgs.mode}>
            <OptionInput value="instruct">Instruct</OptionInput>
            <OptionInput value="chat">Chat</OptionInput>
            <OptionInput value="chat-instruct">Chat-Instruct</OptionInput>
        </SelectInput>
        <!-- name1 = user | name2 = bot --->

        {#if DBState.db.reverseProxyOobaArgs.mode === 'instruct'}
            <span class="text-textcolor" id="{uid}-name1_instruct">{language.settingsPage.userPrefix}</span>
            <OptionalInput labelId="{uid}-name1_instruct" label={language.settingsPage.userPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.name1_instruct} />
            <span class="text-textcolor" id="{uid}-name2_instruct">{language.settingsPage.botPrefix}</span>
            <OptionalInput labelId="{uid}-name2_instruct" label={language.settingsPage.botPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.name2_instruct} />
            <span class="text-textcolor" id="{uid}-context_instruct">{language.settingsPage.systemPrefix}</span>
            <OptionalInput labelId="{uid}-context_instruct" label={language.settingsPage.systemPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.context_instruct} />
            <span class="text-textcolor" id="{uid}-system_message">{language.settingsPage.systemMessage}</span>
            <OptionalInput labelId="{uid}-system_message" label={language.settingsPage.systemMessage} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.system_message} />
        {/if}
        {#if DBState.db.reverseProxyOobaArgs.mode === 'chat' || DBState.db.reverseProxyOobaArgs.mode === 'chat-instruct'}
            <span class="text-textcolor" id="{uid}-name1">{language.settingsPage.userPrefix}</span>
            <OptionalInput labelId="{uid}-name1" label={language.settingsPage.userPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.name1} />
            <span class="text-textcolor" id="{uid}-name2">{language.settingsPage.botPrefix}</span>
            <OptionalInput labelId="{uid}-name2" label={language.settingsPage.botPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.name2} />
            <span class="text-textcolor" id="{uid}-context">{language.settingsPage.systemPrefix}</span>
            <OptionalInput labelId="{uid}-context" label={language.settingsPage.systemPrefix} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.context} />
            <span class="text-textcolor" id="{uid}-greeting">{language.settingsPage.startMessage}</span>
            <OptionalInput labelId="{uid}-greeting" label={language.settingsPage.startMessage} marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.greeting} />
        {/if}
        {#if DBState.db.reverseProxyOobaArgs.mode === 'chat-instruct'}
            <span class="text-textcolor" id="{uid}-chat_instruct_command">chat_instruct_command</span>
            <OptionalInput labelId="{uid}-chat_instruct_command" label="chat_instruct_command" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.chat_instruct_command} />
        {/if}
    {/if}
    <span class="text-textcolor" id="{uid}-tokenizer">tokenizer</span>
    <OptionalInput labelId="{uid}-tokenizer" label="tokenizer" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.tokenizer} />
    <span class="text-textcolor" id="{uid}-min_p">min_p</span>
    <OptionalInput labelId="{uid}-min_p" label="min_p" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.min_p} numberMode />
    <span class="text-textcolor" id="{uid}-top_k">top_k</span>
    <OptionalInput labelId="{uid}-top_k" label="top_k" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.top_k} numberMode />
    <span class="text-textcolor" id="{uid}-repetition_penalty">repetition_penalty</span>
    <OptionalInput labelId="{uid}-repetition_penalty" label="repetition_penalty" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.repetition_penalty} numberMode />
    <span class="text-textcolor" id="{uid}-repetition_penalty_range">repetition_penalty_range</span>
    <OptionalInput labelId="{uid}-repetition_penalty_range" label="repetition_penalty_range" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.repetition_penalty_range} numberMode />
    <span class="text-textcolor" id="{uid}-typical_p">typical_p</span>
    <OptionalInput labelId="{uid}-typical_p" label="typical_p" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.typical_p} numberMode />
    <span class="text-textcolor" id="{uid}-tfs">tfs</span>
    <OptionalInput labelId="{uid}-tfs" label="tfs" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.tfs} numberMode />
    <span class="text-textcolor" id="{uid}-top_a">top_a</span>
    <OptionalInput labelId="{uid}-top_a" label="top_a" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.top_a} numberMode />
    <span class="text-textcolor" id="{uid}-epsilon_cutoff">epsilon_cutoff</span>
    <OptionalInput labelId="{uid}-epsilon_cutoff" label="epsilon_cutoff" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.epsilon_cutoff} numberMode />
    <span class="text-textcolor" id="{uid}-eta_cutoff">eta_cutoff</span>
    <OptionalInput labelId="{uid}-eta_cutoff" label="eta_cutoff" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.eta_cutoff} numberMode />
    <span class="text-textcolor" id="{uid}-guidance_scale">guidance_scale</span>
    <OptionalInput labelId="{uid}-guidance_scale" label="guidance_scale" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.guidance_scale} numberMode />
    <span class="text-textcolor" id="{uid}-penalty_alpha">penalty_alpha</span>
    <OptionalInput labelId="{uid}-penalty_alpha" label="penalty_alpha" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.penalty_alpha} numberMode />
    <span class="text-textcolor" id="{uid}-mirostat_mode">mirostat_mode</span>
    <OptionalInput labelId="{uid}-mirostat_mode" label="mirostat_mode" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.mirostat_mode} numberMode />
    <span class="text-textcolor" id="{uid}-mirostat_tau">mirostat_tau</span>
    <OptionalInput labelId="{uid}-mirostat_tau" label="mirostat_tau" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.mirostat_tau} numberMode />
    <span class="text-textcolor" id="{uid}-mirostat_eta">mirostat_eta</span>
    <OptionalInput labelId="{uid}-mirostat_eta" label="mirostat_eta" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.mirostat_eta} numberMode />
    <span class="text-textcolor" id="{uid}-encoder_repetition_penalty">encoder_repetition_penalty</span>
    <OptionalInput labelId="{uid}-encoder_repetition_penalty" label="encoder_repetition_penalty" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.encoder_repetition_penalty} numberMode />
    <span class="text-textcolor" id="{uid}-no_repeat_ngram_size">no_repeat_ngram_size</span>
    <OptionalInput labelId="{uid}-no_repeat_ngram_size" label="no_repeat_ngram_size" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.no_repeat_ngram_size} numberMode />
    <span class="text-textcolor" id="{uid}-min_length">min_length</span>
    <OptionalInput labelId="{uid}-min_length" label="min_length" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.min_length} numberMode />
    <span class="text-textcolor" id="{uid}-num_beams">num_beams</span>
    <OptionalInput labelId="{uid}-num_beams" label="num_beams" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.num_beams} numberMode />
    <span class="text-textcolor" id="{uid}-length_penalty">length_penalty</span>
    <OptionalInput labelId="{uid}-length_penalty" label="length_penalty" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.length_penalty} numberMode />
    <span class="text-textcolor" id="{uid}-truncation_length">truncation_length</span>
    <OptionalInput labelId="{uid}-truncation_length" label="truncation_length" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.truncation_length} numberMode />
    <span class="text-textcolor" id="{uid}-max_tokens_second">max_tokens_second</span>
    <OptionalInput labelId="{uid}-max_tokens_second" label="max_tokens_second" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.max_tokens_second} numberMode />
    <span class="text-textcolor" id="{uid}-negative_prompt">negative_prompt</span>
    <OptionalInput labelId="{uid}-negative_prompt" label="negative_prompt" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.negative_prompt} />
    <span class="text-textcolor" id="{uid}-custom_token_bans">custom_token_bans</span>
    <OptionalInput labelId="{uid}-custom_token_bans" label="custom_token_bans" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.custom_token_bans} />
    <span class="text-textcolor" id="{uid}-grammar_string">grammar_string</span>
    <OptionalInput labelId="{uid}-grammar_string" label="grammar_string" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.grammar_string} />

    <span class="text-textcolor" id="{uid}-temperature_last">temperature_last</span>
    <OptionalInput labelId="{uid}-temperature_last" label="temperature_last" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.temperature_last} boolMode />
    <span class="text-textcolor" id="{uid}-do_sample">do_sample</span>
    <OptionalInput labelId="{uid}-do_sample" label="do_sample" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.do_sample} boolMode />
    <span class="text-textcolor" id="{uid}-early_stopping">early_stopping</span>
    <OptionalInput labelId="{uid}-early_stopping" label="early_stopping" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.early_stopping} boolMode />
    <span class="text-textcolor" id="{uid}-auto_max_new_tokens">auto_max_new_tokens</span>
    <OptionalInput labelId="{uid}-auto_max_new_tokens" label="auto_max_new_tokens" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.auto_max_new_tokens} boolMode />

    <span class="text-textcolor" id="{uid}-ban_eos_token">ban_eos_token</span>
    <OptionalInput labelId="{uid}-ban_eos_token" label="ban_eos_token" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.ban_eos_token} boolMode />
    <span class="text-textcolor" id="{uid}-add_bos_token">add_bos_token</span>
    <OptionalInput labelId="{uid}-add_bos_token" label="add_bos_token" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.add_bos_token} boolMode />
    <span class="text-textcolor" id="{uid}-skip_special_tokens">skip_special_tokens</span>
    <OptionalInput labelId="{uid}-skip_special_tokens" label="skip_special_tokens" marginBottom={true} bind:value={DBState.db.reverseProxyOobaArgs.skip_special_tokens} boolMode />

    
    {#if instructionMode}
        <div class="flex items-center mt-4">
            <CheckInput check={!!DBState.db.localStopStrings} name={language.customStopWords} onChange={() => {
                if(!DBState.db.localStopStrings){
                    DBState.db.localStopStrings = []
                }
                else{
                    DBState.db.localStopStrings = null
                }
            }} />
        </div>
        {#if DBState.db.localStopStrings}
            <div class="flex flex-col p-2 rounded-sm border border-selected mt-2 gap-1">
                <div class="p-2">
                    <button aria-label={language.add} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                        let localStopStrings = DBState.db.localStopStrings
                        localStopStrings.push('')
                        DBState.db.localStopStrings = localStopStrings
                    }}><PlusIcon aria-hidden="true" /></button>
                </div>
                {#each DBState.db.localStopStrings as stopString, i}
                    <div class="flex w-full">
                        <div class="grow">
                            <TextInput label={language.customStopWords} marginBottom bind:value={DBState.db.localStopStrings[i]} fullwidth fullh/>
                        </div>
                        <div>
                            <button aria-label={language.remove} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                                let localStopStrings = DBState.db.localStopStrings
                                localStopStrings.splice(i, 1)
                                DBState.db.localStopStrings = localStopStrings
                            }}><TrashIcon aria-hidden="true" /></button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</Accordion>