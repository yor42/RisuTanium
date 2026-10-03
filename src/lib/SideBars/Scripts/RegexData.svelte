<script lang="ts">
    import { XIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { ReloadGUIPointer } from "src/ts/stores.svelte";
    import { alertConfirm } from "src/ts/alert";
    import type { customscript } from "src/ts/storage/database.svelte";
    import Check from "../../UI/GUI/CheckInput.svelte";
    import TextInput from "../../UI/GUI/TextInput.svelte";
    import TextAreaInput from "../../UI/GUI/TextAreaInput.svelte";
    import SelectInput from "../../UI/GUI/SelectInput.svelte";
    import OptionInput from "../../UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
  import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
  
interface Props {
    value: customscript;
    onRemove?: (target: customscript) => void;
    onClose?: () => void;
    onOpen?: () => void;
    idx: number;
  }

  let {
    value = $bindable(),
    onRemove = () => {},
    onClose = () => {},
    onOpen = () => {},
    idx
  }: Props = $props();

    const checkFlagContain = (flag:string, matchFlag:string) => {
        if(flag.length === 1){
            matchFlag = value.flag.replace(/<(.+?)>/g, '')
        }
        return matchFlag.includes(flag)
    }

    const toggleFlag = (flag:string) => {
        console.log(flag, checkFlagContain(flag, value.flag), value.flag)
        if(checkFlagContain(flag, value.flag)){
            value.flag = value.flag.replace(flag, '')
        }
        else{
            value.flag += flag
        }
    }

    const getOrder = (flag:string) => {
        const order = flag.match(/<order (-?\d+)>/)?.[1]
        if(order === undefined || order === null){
            return 0
        }
        return parseInt(order)
    }

    const changeOrder = (order:number) => {
        if(value.flag.includes('<order')){
            value.flag = value.flag.replace(/<order (-?\d+)>/, `<order ${order}>`)
        }
        else{
            value.flag += `<order ${order}>`
        }
    }

    const flags = [
        //Vanila JS flags
        [language.sidebarUi.flagGlobal, 'g'],
        [language.sidebarUi.flagCaseInsensitive, 'i'],
        [language.sidebarUi.flagMultiLine, 'm'],
        [language.sidebarUi.flagUnicode, 'u'],
        [language.sidebarUi.flagDotAll, 's'],

        //Custom flags
        [language.sidebarUi.flagMoveTop, '<move_top>'],
        [language.sidebarUi.flagMoveBottom, '<move_bottom>'],
        [language.sidebarUi.flagRepeatBack, '<repeat_back>'],
        [language.sidebarUi.flagInCbsParsing, '<cbs>'],
        [language.sidebarUi.flagNoNewlineSubfix, '<no_end_nl>'],
    ]

    let open = $state(false)
</script>

<div class="w-full flex flex-col pt-2 mt-2 border-t border-t-selected first:pt-0 first:mt-0 first:border-0" data-risu-idx={idx}>
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
            <span>{value.comment.length === 0 ? language.sidebarUi.unnamedScript : value.comment}</span>
        </button>
        <button class="valuer" onclick={async () => {
            const target = value
            const d = await alertConfirm(language.removeConfirm + target.comment)
            if(d){
                if(!open){
                    onClose()
                }
                onRemove(target)
            }
        }}>
            <XIcon />
        </button>
    </div>
    {#if open}
        <div class="seperator p-2">
            <span class="text-textcolor mt-6">{language.name}</span>
            <TextInput size="sm" bind:value={value.comment} onchange={(e) => {
                $ReloadGUIPointer += 1
            }} />
            <span class="text-textcolor mt-4">{language.sidebarUi.modificationType}</span>
            <SelectInput bind:value={value.type} onchange={(e) => {
                $ReloadGUIPointer += 1
            }}>
                <OptionInput value="editinput">{language.editInput}</OptionInput>
                <OptionInput value="editoutput">{language.editOutput}</OptionInput>
                <OptionInput value="editprocess">{language.editProcess}</OptionInput>
                <OptionInput value="editdisplay">{language.editDisplay}</OptionInput>
                <OptionInput value="edittrans">{language.editTranslationDisplay}</OptionInput>
                <OptionInput value="disabled">{language.disabled}</OptionInput>
            </SelectInput>
            <span class="text-textcolor mt-6">{language.sidebarUi.regexIn}</span>
            <TextInput size="sm" bind:value={value.in} />
            <span class="text-textcolor mt-6">{language.sidebarUi.regexOut}</span>
            <TextAreaInput highlight autocomplete="off" size="sm" bind:value={value.out} onInput={(e) => {
                $ReloadGUIPointer += 1
            }} />
            {#if value.ableFlag}
                <!-- <span class="text-textcolor mt-6">FLAG:</span>
                <TextInput size="sm" bind:value={value.flag} /> -->
                <Accordion styled name={language.sidebarUi.flagsHeading}>
                    <span class="text-textcolor mt-3">{language.sidebarUi.normalFlag}</span>
                    <div class="grid w-full grid-cols-2 rounded-md border border-darkborderc">
                        {#each flags as flag, i}
                            <button class="w-full bg-darkbg border-darkborderc text-sm py-1"
                                class:border-r-1={i % 2 === 0}
                                class:border-b-1={i < flags.length - 2}
                                class:text-textcolor2={!checkFlagContain(flag[1], value.flag)}
                                class:text-textcolor={checkFlagContain(flag[1], value.flag)}
                                onclick={() => {
                                    toggleFlag(flag[1])
                                }}
                            >
                                <span>{flag[0]}</span>
                                </button>     
                        {/each}
                    </div>

                    <span class="text-textcolor mt-3">{language.sidebarUi.orderFlag}</span>
                    <NumberInput value={getOrder(value.flag)} onChange={(e)=>{
                        changeOrder(parseInt(e.currentTarget.value))
                    }} />
                    
                </Accordion>
            {/if}
            <div class="flex items-center mt-4">
                <Check bind:check={value.ableFlag} onChange={() => {
                    if(!value.flag){
                        value.flag = 'g'
                    }
                }}/>
                <span>{language.sidebarUi.customFlag}</span>
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