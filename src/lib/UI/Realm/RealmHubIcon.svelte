<script lang="ts">
    import { BookIcon, ImageIcon, SmileIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { hubURL, type hubType } from "src/ts/characterCards";
    import { DBState } from "src/ts/stores.svelte";
    import { parseMultilangString } from "src/ts/util";

    interface Props {
        onClick?: any;
        chara: hubType;
    }

    let { onClick = () => {}, chara }: Props = $props();

    const description = $derived.by(() => {
        const parsed = parseMultilangString(chara.desc);
        return parsed[DBState.db.language] ?? parsed.en ?? parsed.xx;
    });

</script>


<button type="button" class="risu-focus-ring flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl bg-darkbg text-start text-textcolor hover:bg-selected/50" onclick={onClick}>
    {#if DBState.db.hideAllImages}
        <div class="flex aspect-video w-full sm:aspect-[4/3] items-center justify-center bg-darkbutton text-textcolor2">
            <span class="text-4xl">?</span>
        </div>
    {:else}
        <!-- Realm lists hold dozens of full-size card images; only fetch and decode the ones near the viewport -->
        <img class="aspect-video w-full sm:aspect-[4/3] object-cover object-top" alt="" loading="lazy" decoding="async" src={`${hubURL}/resource/` + chara.img}>
    {/if}
    <div class="flex w-full min-w-0 grow flex-col gap-1 p-3">
        <span class="line-clamp-2 text-lg wrap-anywhere">{chara.name}</span>
        {#if chara.creatorName ?? chara.authorname}
            <span class="truncate text-xs text-textcolor2">{chara.creatorName ?? chara.authorname}</span>
        {/if}
        <span class="line-clamp-2 text-xs text-textcolor2 wrap-anywhere">{description}</span>
        <div class="flex flex-wrap gap-1">
            {#each chara.tags as tag, i}
                {#if i < 4}
                    <span class="rounded-full border border-darkborderc px-2 text-xs text-textcolor2 wrap-anywhere">{tag}</span>
                {:else if i === 4}
                    <span class="rounded-full border border-darkborderc px-2 text-xs text-textcolor2">...</span>
                {/if}
            {/each}
        </div>
        <div class="grow"></div>
        {#if chara.hasEmotion || chara.hasAsset || chara.hasLore}
            <div class="flex flex-wrap gap-2 text-xs text-textcolor2">
                {#if chara.hasEmotion}
                    <span class="flex items-center gap-1"><SmileIcon size={14} aria-hidden="true" />{language.realmBadgeEmotion}</span>
                {/if}
                {#if chara.hasAsset}
                    <span class="flex items-center gap-1"><ImageIcon size={14} aria-hidden="true" />{language.realmBadgeAssets}</span>
                {/if}
                {#if chara.hasLore}
                    <span class="flex items-center gap-1"><BookIcon size={14} aria-hidden="true" />{language.realmBadgeLore}</span>
                {/if}
            </div>
        {/if}
    </div>
</button>