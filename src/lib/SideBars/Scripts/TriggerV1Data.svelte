<script lang="ts">
    import { PlusIcon, XIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { alertConfirm } from "src/ts/alert";
    import type { triggerscript } from "src/ts/storage/database.svelte";
    import TextInput from "../../UI/GUI/TextInput.svelte";
    import SelectInput from "../../UI/GUI/SelectInput.svelte";
    import OptionInput from "../../UI/GUI/OptionInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import Help from "src/lib/Others/Help.svelte";


    interface Props {
        value: triggerscript;
        lowLevelAble?: boolean;
        onRemove?: (target: triggerscript) => void;
        onClose?: () => void;
        onOpen?: () => void;
        idx: number;
    }

    let {
        value = $bindable(),
        lowLevelAble = false,
        onRemove = () => {},
        onClose = () => {},
        onOpen = () => {},
        idx
    }: Props = $props();
    const uid = $props.id()
    let open = $state(false)
</script>

<div class="w-full flex flex-col pt-2 mt-2 border-t border-t-selected first:pt-0 first:mt-0 first:border-0" data-risu-idx2={idx}>
    <div class="flex items-center transition-colors w-full ">
        <button class="endflex valuer border-borderc" onclick={() => {
            open = !open
            if(open){
                onOpen()
            }
            else{
                onClose()
            }
        }}>
            <span>{value.comment.length === 0 ? language.sidebarUi.unnamedTrigger : value.comment}</span>
        </button>
        <button class="valuer" aria-label={language.remove} onclick={async () => {
            const target = value
            const d = await alertConfirm(language.removeConfirm + target.comment)
            if(d){
                if(!open){
                    onClose()
                }
                onRemove(target)
            }
        }}>
            <XIcon aria-hidden="true" />
        </button>
    </div>
    {#if open}
        <div class="seperator p-2">
            <span id="{uid}-name" class="text-textcolor mt-6">{language.name}</span>
            <TextInput size="sm" labelId="{uid}-name" bind:value={value.comment} />
            <span class="text-textcolor mt-4">{language.type}</span>
            <SelectInput bind:value={value.type}>
                <OptionInput value="start">{language.triggerStart}</OptionInput>
                <OptionInput value="output">{language.triggerOutput}</OptionInput>
                <OptionInput value="input">{language.triggerInput}</OptionInput>
                <OptionInput value="manual">{language.triggerManual}</OptionInput>
            </SelectInput>
            
            <span class="text-textcolor mt-4">{language.sidebarUi.conditions}
                <button aria-label={language.add} class="float-right text-textcolor2 hover:text-textcolor" onclick={() => {
                    value.conditions.push({
                        type: 'value',
                        value: '',
                        operator: 'true',
                        var: ''
                    })
                    value.conditions = value.conditions

                }}><PlusIcon size={18} aria-hidden="true" /></button>
            </span>
            <div class="flex flex-col px-2 py-4 border border-selected rounded-md">
                {#if value.conditions.length === 0}
                    <span class="text-textcolor2 text-sm">{language.always}</span>
                {/if}
                {#each value.conditions as cond,i}
                    {#if i > 0}
                        <hr class="border-selected my-4" />
                    {/if}
                    <span class="text-textcolor2 text-sm">{language.type}
                        <button aria-label={language.remove} class="float-right text-textcolor2 hover:text-textcolor" onclick={() => {
                            value.conditions.splice(i, 1)
                            value.conditions = value.conditions

                        }}><XIcon size={18} aria-hidden="true" /></button>

                    </span>
                    <SelectInput bind:value={cond.type} size="sm" onchange={() => {
                        if(cond.type === 'exists'){
                            value.conditions[i] = {
                                type: 'exists',
                                value: '',
                                type2: 'loose',
                                depth: 3
                            }
                        }
                        if(cond.type === 'var' || cond.type === 'value'){
                            value.conditions[i] = {
                                type: cond.type,
                                var: '',
                                value: '',
                                operator: '='
                            }
                        }
                        if(cond.type === 'chatindex'){
                            value.conditions[i] = {
                                type: 'chatindex',
                                value: '',
                                operator: '='
                            }
                        }
                    }}>
                        <OptionInput value="value">{language.ifValue}</OptionInput>
                        <OptionInput value="exists">{language.triggerCondExists}</OptionInput>
                        <OptionInput value="var">{language.triggerCondVar}</OptionInput>
                        <OptionInput value="chatindex">{language.ifChatIndex}</OptionInput>
                    </SelectInput>

                    {#if cond.type === 'exists'}
                        <SelectInput bind:value={cond.type2} size="sm">
                            <OptionInput value="loose">{language.triggerMatchLoose}</OptionInput>
                            <OptionInput value="strict">{language.triggerMatchStrict}</OptionInput>
                            <OptionInput value="regex">{language.triggerMatchRegex}</OptionInput>
                        </SelectInput>
                        <span id="{uid}-c{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-c{i}-value" bind:value={cond.value} />

                        <span  class="text-textcolor2 text-sm">{language.searchDepth}</span>
                        <NumberInput size="sm" bind:value={cond.depth} />
                    {/if}
                    {#if cond.type === 'var' || cond.type === 'chatindex' || cond.type === 'value'}
                        {#if cond.type === 'var'}
                            <span id="{uid}-c{i}-var" class="text-textcolor2 text-sm">{language.varableName}</span>
                            <TextInput size="sm" labelId="{uid}-c{i}-var" bind:value={cond.var} />
                        {/if}
                        {#if cond.type === 'value'}
                            <TextAreaInput highlight size="sm" label={language.ifValue} bind:value={cond.var} />
                        {/if}
                        <span  class="text-textcolor2 text-sm">{language.value}</span>
                        <SelectInput bind:value={cond.operator} size="sm">
                            <OptionInput value="true">{language.truthy}</OptionInput>
                            <OptionInput value="=">{language.equal}</OptionInput>
                            <OptionInput value="!=">{language.notEqual}</OptionInput>
                            <OptionInput value=">">{language.greater}</OptionInput>
                            <OptionInput value="<">{language.less}</OptionInput>
                            <OptionInput value=">=">{language.greaterEqual}</OptionInput>
                            <OptionInput value="<=">{language.lessEqual}</OptionInput>
                            <OptionInput value="null">{language.isNull}</OptionInput>

                        </SelectInput>
                        {#if cond.operator !== 'null' && cond.operator !== 'true'}
                            <TextAreaInput highlight size="sm" label={language.value} bind:value={cond.value} />
                        {/if}
                    {/if}
                {/each}
            </div>

            <span class="text-textcolor mt-4">{language.sidebarUi.effects}
                <button aria-label={language.add} class="float-right text-textcolor2 hover:text-textcolor" onclick={() => {
                    if(value.type === 'start'){
                        value.effect.push({
                            type: 'systemprompt',
                            value: '',
                            location: 'historyend'
                        })
                    }
                    else{
                        value.effect.push({
                            type: 'setvar',
                            var: '',
                            value: '',
                            operator: '='
                        })
                    }
                    value.effect = value.effect

                }}><PlusIcon size={18} aria-hidden="true" /></button>
            </span>

            <div class="flex flex-col px-2 py-4 border border-selected rounded-md">
                {#if value.effect.length === 0}
                    <span class="text-textcolor2 text-sm">{language.noEffect}</span>
                {/if}
                {#each value.effect as effect,i}
                    {#if i > 0}
                        <hr class="border-selected my-4" />
                    {/if}
                    <span class="text-textcolor2 text-sm">{language.type}
                        <button aria-label={language.remove} class="float-right text-textcolor2 hover:text-textcolor" onclick={() => {
                            value.effect.splice(i, 1)
                            value.effect = value.effect

                        }}><XIcon size={18} aria-hidden="true" /></button>

                    </span>
                    <SelectInput bind:value={effect.type} size="sm" onchange={() => {
                        if(effect.type === 'systemprompt'){
                            value.effect[i] = {
                                type: 'systemprompt',
                                value: '',
                                location: 'historyend'
                            }
                        }
                        else if(effect.type === 'setvar'){
                            value.effect[i] = {
                                type: 'setvar',
                                var: '',
                                value: '',
                                operator: '='
                            }
                        }
                        else if(effect.type === 'impersonate'){
                            value.effect[i] = {
                                type: 'impersonate',
                                role: 'char',
                                value: ''
                            }
                        }
                        else if(effect.type === 'command'){
                            value.effect[i] = {
                                type: 'command',
                                value: ''
                            }
                        }
                        else if(effect.type === 'stop'){
                            value.effect[i] = {
                                type: 'stop',
                            }
                        }
                        else if(effect.type === 'runtrigger'){
                            value.effect[i] = {
                                type: 'runtrigger',
                                value: ''
                            }
                        }
                        else if(effect.type === 'runLLM'){
                            value.effect[i] = {
                                type: 'runLLM',
                                value: '',
                                inputVar: ''
                            }
                        }
                        else if(effect.type === 'checkSimilarity'){
                            value.effect[i] = {
                                type: 'checkSimilarity',
                                source: '',
                                value: '',
                                inputVar: ''
                            }
                        }
                        else if(effect.type === 'showAlert'){
                            value.effect[i] = {
                                type: 'showAlert',
                                alertType: 'normal',
                                value: '',
                                inputVar: ''
                            }
                        }
                        else if(effect.type === 'extractRegex'){
                            value.effect[i] ={
                                type: 'extractRegex',
                                value: '',
                                regex: '',
                                flags: '',
                                inputVar: '',
                                result:''
                            }
                        }
                        else if(effect.type === 'runImgGen'){
                            value.effect[i] = {
                                type: 'runImgGen',
                                value: '',
                                negValue: '',
                                inputVar: ''
                            }
                        }
                        else if(effect.type === 'sendAIprompt'){
                            value.effect[i] = {
                                type: 'sendAIprompt'                           
                            }
                        }
                        else if(effect.type === 'cutchat'){
                            value.effect[i] = {
                                type: 'cutchat',
                                start: '',
                                end: ''                           
                            }
                        }
                        else if(effect.type === 'modifychat'){
                            value.effect[i] = {
                                type: 'modifychat',
                                value: '',
                                index: ''
                            }
                        }
                        else if(effect.type === 'runAxLLM'){
                            value.effect[i] = {
                                type: 'runAxLLM',
                                value: '',
                                inputVar: ''
                            }
                        }
                    }}>
                        <OptionInput value="setvar">{language.triggerEffSetVar}</OptionInput>
                        <OptionInput value="impersonate">{language.triggerEffImperson}</OptionInput>
                        <OptionInput value="command">{language.triggerEffCommand}</OptionInput>
                        <OptionInput value="systemprompt">{language.triggerEffSysPrompt}</OptionInput>
                        <OptionInput value="stop">{language.triggerEffStop}</OptionInput>
                        <OptionInput value="runtrigger">{language.triggerEffRunTrigger}</OptionInput>
                        <OptionInput value="runLLM">{language.triggerEffRunLLM}</OptionInput>
                        <OptionInput value="checkSimilarity">{language.triggerEffCheckSim}</OptionInput>
                        <OptionInput value="showAlert">{language.triggerEffShowAlert}</OptionInput>
                        <OptionInput value="sendAIprompt">{language.triggerEffectSendAI}</OptionInput>
                        <OptionInput value="extractRegex">{language.extractRegex}</OptionInput>
                        <OptionInput value="runImgGen">{language.runImgGen}</OptionInput>
                        <OptionInput value="cutchat">{language.cutChat}</OptionInput>
                        <OptionInput value="modifychat">{language.modifyChat}</OptionInput>
                        <OptionInput value="runAxLLM">{language.triggerEffRunAxLLM}</OptionInput>
                    </SelectInput>
                    {#if
                        (value.type !== 'start' && (effect.type === 'systemprompt' || effect.type === 'stop')) ||
                        (value.type !== 'output' && effect.type === 'sendAIprompt')
                    }
                        <span class="text-draculared text-sm">{language.invaildTriggerEffect}</span>
                    {/if}
                    {#if
                        !lowLevelAble && (
                            effect.type === 'runLLM' ||
                            effect.type === 'checkSimilarity' ||
                            effect.type === 'showAlert' ||
                            effect.type === 'sendAIprompt' ||
                            effect.type === 'extractRegex' ||
                            effect.type === 'runImgGen' ||
                            effect.type === 'runAxLLM'
                        )
                    }
                        <span class="text-draculared text-sm">{language.triggerLowLevelOnly}</span>

                    {/if}

                    {#if effect.type === 'systemprompt'}
                        <span class="text-textcolor2 text-sm">{language.location}</span>
                        <SelectInput bind:value={effect.location}>
                            <OptionInput value="start">{language.promptstart}</OptionInput>
                            <OptionInput value="historyend">{language.historyend}</OptionInput>
                            <OptionInput value="promptend">{language.promptend}</OptionInput>
                        </SelectInput>
                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />
                    {/if}
                    {#if effect.type === 'setvar'}
                        <span id="{uid}-e{i}-var" class="text-textcolor2 text-sm">{language.varableName}</span>
                        <TextInput labelId="{uid}-e{i}-var" bind:value={effect.var} />
                        <span class="text-textcolor2 text-sm">{language.operator}</span>
                        <SelectInput bind:value={effect.operator} >
                            <OptionInput value="=">{language.TriggerSetToVar}</OptionInput>
                            <OptionInput value="+=">{language.TriggerAddToVar}</OptionInput>
                            <OptionInput value="-=">{language.TriggerSubToVar}</OptionInput>
                            <OptionInput value="*=">{language.TriggerMulToVar}</OptionInput>
                            <OptionInput value="/=">{language.TriggerDivToVar}</OptionInput>
                        </SelectInput>
                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />
                    {/if}

                    {#if effect.type === 'runtrigger'}
                        <span id="{uid}-e{i}-name" class="text-textcolor2 text-sm">{language.name}</span>
                        <TextInput size="sm" labelId="{uid}-e{i}-name" bind:value={effect.value} />
                    {/if}
                    {#if effect.type === 'command'}
                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />
                    {/if}
                    {#if effect.type === 'runLLM'}
                        <span class="text-textcolor2 text-sm"><span id="{uid}-e{i}-prompt">{language.prompt}</span> <Help key="triggerLLMPrompt" /></span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-prompt" bind:value={effect.value} />

                        <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                        <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}
                    {#if effect.type === 'checkSimilarity'}
                        <span id="{uid}-e{i}-prompt" class="text-textcolor2 text-sm">{language.prompt}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-prompt" bind:value={effect.source} />

                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />

                        <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                        <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}
                    {#if effect.type === 'showAlert'}
                        <span class="text-textcolor2 text-sm">{language.type}</span>
                        <SelectInput bind:value={effect.alertType}>
                            <OptionInput value="normal">{language.normal}</OptionInput>
                            <OptionInput value="error">{language.error}</OptionInput>
                            <OptionInput value="input">{language.input}</OptionInput>
                            <OptionInput value="select">{language.select}</OptionInput>
                        </SelectInput>

                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />

                        <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                        <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}
                    {#if effect.type === 'impersonate'}
                        <span class="text-textcolor2 text-sm">{language.role}</span>
                        <SelectInput bind:value={effect.role} size="sm">
                            <OptionInput value="user">{language.user}</OptionInput>
                            <OptionInput value="char">{language.character}</OptionInput>
                        </SelectInput>
                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />
                    {/if}

                    {#if effect.type === 'extractRegex'}
                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />

                        <span id="{uid}-e{i}-regex" class="text-textcolor2 text-sm">{language.regex}</span>
                        <TextInput labelId="{uid}-e{i}-regex" bind:value={effect.regex} />

                        <span id="{uid}-e{i}-flags" class="text-textcolor2 text-sm">{language.flags}</span>
                        <TextInput labelId="{uid}-e{i}-flags" bind:value={effect.flags} />

                        <span id="{uid}-e{i}-result-format" class="text-textcolor2 text-sm">{language.resultFormat}</span>
                        <TextInput labelId="{uid}-e{i}-result-format" bind:value={effect.result} />

                        <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                        <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}

                    {#if effect.type === 'runImgGen'}
                        <span id="{uid}-e{i}-prompt" class="text-textcolor2 text-sm">{language.prompt}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-prompt" bind:value={effect.value} />

                        <span id="{uid}-e{i}-neg-prompt" class="text-textcolor2 text-sm">{language.negPrompt}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-neg-prompt" bind:value={effect.negValue} />

                        <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                        <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}

                    {#if effect.type === 'cutchat'}
                        <span id="{uid}-e{i}-start" class="text-textcolor2 text-sm">{language.start}</span>
                        <TextInput labelId="{uid}-e{i}-start" bind:value={effect.start} />

                        <span id="{uid}-e{i}-end" class="text-textcolor2 text-sm">{language.end}</span>
                        <TextInput labelId="{uid}-e{i}-end" bind:value={effect.end} />
                    {/if}

                    {#if effect.type === 'modifychat'}
                        <span id="{uid}-e{i}-index" class="text-textcolor2 text-sm">{language.index}</span>
                        <TextInput labelId="{uid}-e{i}-index" bind:value={effect.index} />

                        <span id="{uid}-e{i}-value" class="text-textcolor2 text-sm">{language.value}</span>
                        <TextAreaInput highlight labelId="{uid}-e{i}-value" bind:value={effect.value} />

                    {/if}

                    {#if effect.type === 'runAxLLM'}
                    <span class="text-textcolor2 text-sm"><span id="{uid}-e{i}-prompt">{language.prompt}</span> <Help key="triggerLLMPrompt" /></span>
                    <TextAreaInput highlight labelId="{uid}-e{i}-prompt" bind:value={effect.value} />

                    <span id="{uid}-e{i}-result-var" class="text-textcolor2 text-sm">{language.resultStoredVar}</span>
                    <TextInput labelId="{uid}-e{i}-result-var" bind:value={effect.inputVar} />
                    {/if}
                {/each}
            </div>
       </div>
    {/if}
</div>

<style>
    .valuer:hover{
        color: rgba(16, 185, 129, 1);
        cursor: pointer;
    }

    .endflex{
        display: flex;
        flex-grow: 1;
        cursor: pointer;
    }

    .seperator{
        border: none;
        outline: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        margin-bottom: 0.5rem;
    }
    
</style>