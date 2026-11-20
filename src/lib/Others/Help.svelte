<button title={name+' '+language.showHelp} aria-label={(name ? name + ' ' : '') + language.showHelp} class="relative help inline-flex items-center cursor-default text-textcolor2 hover:text-textcolor" style="vertical-align: -2px;" onclick={() => {
    alertMd(language.help[key])
}}>
    
    {#if key === "experimental"}
        <div class="text-draculared hover:text-textcolor">
            <FlaskConicalIcon size={16} aria-hidden="true" />
        </div>
    {:else if unrecommended}
        <div class="text-draculared hover:text-textcolor">
            <TriangleAlert size={14} aria-hidden="true" />
        </div>
    {:else}
        <CircleQuestionMarkIcon size={14} aria-hidden="true" />
    {/if}
</button>
<script lang="ts">
    import { TriangleAlert, FlaskConicalIcon, CircleQuestionMarkIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { alertMd } from "src/ts/alert";

    interface Props {
        unrecommended?: boolean;
        key: (keyof (typeof language.help));
        name?: string;
    }

    let { unrecommended = false, key, name = '' }: Props = $props();
</script>