<script lang="ts">
    import { BookIcon, ImageIcon, SmileIcon } from "@lucide/svelte";
    import { alertNormal } from "src/ts/alert";
    import { language } from "src/lang";
    import { hubURL, type hubType } from "src/ts/characterCards";
    import { DBState } from "src/ts/stores.svelte";
    import { parseMultilangString } from "src/ts/util";

    interface Props {
        onClick?: any;
        chara: hubType;
    }

    let { onClick = () => {}, chara }: Props = $props();

    // A role="button" div activates on Enter and Space, and only when it is itself the event target.
    function activateOnKey(e: KeyboardEvent) {
        if(e.target !== e.currentTarget) return
        if((e.key === 'Enter' || e.key === ' ') && e.currentTarget instanceof HTMLElement){
            e.preventDefault()
            e.currentTarget.click()
        }
    }

</script>


<button class="bg-darkbg rounded-lg p-4 flex flex-col hover:bg-selected transition-colors relative lg:w-96 w-full items-start" onclick={onClick}>
    <div class="flex gap-2 w-full">
    {#if DBState.db.hideAllImages}
        <div class="w-20 min-w-20 h-20 sm:h-28 sm:w-28 rounded-md bg-darkbutton flex items-center justify-center text-textcolor2">
            <span class="text-4xl">?</span>
        </div>
    {:else}
        <img class="w-20 min-w-20 h-20 sm:h-28 sm:w-28 rounded-md object-top object-cover" alt={chara.name} src={`${hubURL}/resource/` + chara.img}>
    {/if}
    <div class="flex flex-col grow min-w-0">
        <span class="text-textcolor text-lg min-w-0 max-w-full text-ellipsis whitespace-nowrap overflow-hidden text-start">{chara.name}</span>
        <span class="text-textcolor2 text-xs min-w-0 max-w-full text-ellipsis wrap-break-word max-h-8 whitespace-nowrap overflow-hidden text-start">{parseMultilangString(chara.desc)[DBState.db.language] ?? parseMultilangString(chara.desc).en ?? parseMultilangString(chara.desc).xx}</span>
        <div class="flex flex-wrap">
            {#each chara.tags as tag, i}
                {#if i < 4}
                    <div class="text-xs p-1 text-textcolor2">{tag}</div>
                {:else if i === 4}
                    <div class="text-xs p-1 text-textcolor2">...</div>
                {/if}
            {/each}
        </div>
        <div class="grow"></div>
        <div class="flex flex-wrap w-full flex-row-reverse gap-1">
            {#if chara.hasEmotion}
                <div class="text-textcolor2 hover:text-textcolor transition-colors" role="button" tabindex="0" aria-label={language.alerts.characterHasEmotion} onclick={((e) => {
                    e.stopPropagation()
                    alertNormal(language.alerts.characterHasEmotion)
                })} onkeydown={activateOnKey}><SmileIcon aria-hidden="true" /></div>
            {/if}
            {#if chara.hasAsset}
                <div class="text-textcolor2 hover:text-textcolor transition-colors" role="button" tabindex="0" aria-label={language.alerts.characterHasAssets} onclick={((e) => {
                    e.stopPropagation()
                    alertNormal(language.alerts.characterHasAssets)
                })} onkeydown={activateOnKey}><ImageIcon aria-hidden="true" /></div>
            {/if}
            {#if chara.hasLore}
                <div class="text-textcolor2 hover:text-textcolor transition-colors" role="button" tabindex="0" aria-label={language.alerts.characterHasLore} onclick={((e) => {
                    e.stopPropagation()
                    alertNormal(language.alerts.characterHasLore)
                })} onkeydown={activateOnKey}><BookIcon aria-hidden="true" /></div>
            {/if}
        </div>
    </div>
</div></button>