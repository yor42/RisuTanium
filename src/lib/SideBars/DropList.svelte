<script>
    import { ChevronDown, ChevronUp } from "@lucide/svelte";
    import { language } from "../../lang";

    /** @type {{list?: any}} */
    let { list = $bindable([]) } = $props();
</script>

<div class="list flex flex-col rounded-md  border border-selected">
    {#each list as n, i}
        <div class="w-full h-10 flex items-center">
            <span class="ml-2 grow">{language.formating[n]}</span>
            <button class="mr-1" aria-label={language.chatShellMoveUp} onclick={() => {
                if(i !== 0){
                    let tempList = list
                    const temp = tempList[i]
                    tempList[i] = tempList[i-1]
                    tempList[i-1] = temp
                    list = tempList
                }
                else{
                    let tempList = list
                    const temp = tempList[i]
                    tempList[i] = tempList[i+1]
                    tempList[i+1] = temp
                    list = tempList
                }
            }}><ChevronUp aria-hidden="true" /></button>
            <button class="mr-1" aria-label={language.chatShellMoveDown} onclick={() => {
                if(i !== (list.length - 1)){
                    let tempList = list
                    const temp = tempList[i]
                    tempList[i] = tempList[i+1]
                    tempList[i+1] = temp
                    list = tempList
                }
                else{
                    let tempList = list
                    const temp = tempList[i]
                    tempList[i] = tempList[i-1]
                    tempList[i-1] = temp
                    list = tempList
                }
            }}><ChevronDown aria-hidden="true" /></button>
        </div>
        {#if i !== (list.length - 1)}
            <div class="border-t w-full border-selected"></div>
        {/if}
    {/each}
</div>