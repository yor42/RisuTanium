<script lang="ts">
    import { language } from '../../../lang'
    import type { ConfirmFacts } from '../../../ts/studio/assets/mergeCommit'

    // The module merge's second look (MC-1201): the characters that still use a removed name or were not read, said before
    // Merge anyway. It decides nothing and writes nothing; Cancel has the first focus and leaves everything as it was.
    interface Props {
        facts: ConfirmFacts
        // The name a character is listed by.
        nameOf: (chaId: string) => string
        onmerge: () => void
        oncancel: () => void
    }

    let { facts, nameOf, onmerge, oncancel }: Props = $props()

    function focusNode(node: HTMLElement): void {
        node.focus()
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div data-part="studio-asset-merge-confirm" data-part-critical role="group" aria-labelledby="studio-asset-merge-confirm-title" class="flex flex-col gap-2 rounded-md border border-darkborderc p-3">
    <h4 id="studio-asset-merge-confirm-title" class="font-bold">{language.studioAssetMergeConfirmTitle}</h4>
    {#if !facts.finished}
        <p data-part="studio-asset-merge-confirm-unfinished" class="text-sm text-textcolor2">{language.studioAssetMergeConfirmUnfinished(facts.hits.length)}</p>
    {/if}
    {#if facts.hits.length > 0}
        <ul class="flex flex-col gap-1 text-sm text-textcolor2">
            {#each facts.hits as hit (hit.chaId)}
                <li data-part="studio-asset-merge-confirm-hit">{language.studioAssetMergeConfirmHit(nameOf(hit.chaId), hit.count)}</li>
            {/each}
        </ul>
    {/if}
    {#if facts.archived > 0}
        <p data-part="studio-asset-merge-confirm-archived" class="text-sm text-textcolor2">{language.studioAssetMergeArchivedCharacters(facts.archived)}</p>
    {/if}
    <p data-part="studio-asset-merge-confirm-warning" class="text-sm text-textcolor2">{language.studioAssetMergeConfirmWarning}</p>
    <div class="flex flex-wrap gap-2">
        <button use:focusNode type="button" data-part="studio-asset-merge-confirm-cancel" class={buttonClass} onclick={oncancel}>{language.cancel}</button>
        <button type="button" data-part="studio-asset-merge-confirm-merge" class={buttonClass} onclick={onmerge}>{language.studioAssetMergeAnyway}</button>
    </div>
</div>
