<script lang="ts">
    import { hubURL, type hubType } from "src/ts/characterCards";
    import { DBState } from "src/ts/stores.svelte";

    // A single-row compact preview for the home-screen realm card. Unlike
    // RealmHubIcon.svelte (lg:w-96, an 80-112px image, three nested
    // role="button" children inside an outer <button>), this is one <button>
    // with one click target and no nested interactive elements, so it fits
    // several rows inside the card's committed height.
    interface Props {
        onClick?: () => void;
        chara: hubType;
    }

    let { onClick = () => {}, chara }: Props = $props();
</script>

<button
    class="risu-focus-ring flex min-h-11 w-full items-center gap-2 rounded-lg p-1 text-left transition-colors duration-300 hover:bg-selected/50"
    onclick={onClick}
>
    {#if DBState.db.hideAllImages}
        <div class="h-8 w-8 min-w-8 flex items-center justify-center rounded-md bg-darkbutton text-textcolor2">
            <span class="text-xs">?</span>
        </div>
    {:else}
        <img class="h-8 w-8 min-w-8 rounded-md object-cover object-top" alt={chara.name} src={`${hubURL}/resource/` + chara.img}>
    {/if}
    <span class="min-w-0 grow truncate text-start text-textcolor">{chara.name}</span>
</button>
