<script lang="ts">
    import { FolderIcon, ShieldCheckIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import type { alertData } from 'src/ts/alert'
    import { planPresetNames } from 'src/ts/storage/presetBundle'

    /**
     * The preview of a preset bundle file. Every row starts ticked; the name shown is the name the preset will get, from
     * the same planner the import uses, so a row that collides shows its base name with the ` (n)` it will receive. Names,
     * folders and models come from a file and render as text only, never as markup. Import answers the JSON of the ticked
     * row indices and is disabled while nothing is ticked; Cancel answers `cancel`. The count sentence is the dialog's description.
     */
    interface Props {
        view: NonNullable<alertData['presetBundle']>
        messageId: string
        onanswer: (message: string) => void
    }

    let { view, messageId, onanswer }: Props = $props()

    // The rows of one prompt never change, so the initial value is the whole state.
    // svelte-ignore state_referenced_locally
    let ticked = $state<boolean[]>(view.rows.map(() => true))

    const planned = $derived(planPresetNames(view.existingNames, view.rows.map((row) => row.name), ticked))
    const tickedCount = $derived(ticked.filter(Boolean).length)

    function suffixOf(index: number): string {
        const name = planned[index]
        const base = view.rows[index].name
        return name !== null && name !== base && name.startsWith(base) ? name.slice(base.length) : ''
    }
</script>

<div class="flex flex-col gap-3 text-left" data-preset-bundle>
    <p id={messageId} class="m-0 text-xl font-semibold text-textcolor">{language.presetBundleCount(view.rows.length)}</p>
    <p class="m-0 flex items-start gap-2 text-sm text-textcolor2">
        <ShieldCheckIcon size={18} class="shrink-0 mt-0.5" aria-hidden="true" />
        <span>{language.presetBundleKeysRemoved}</span>
    </p>
    <ul class="m-0 p-0 list-none max-h-[50vh] overflow-y-auto border border-darkborderc rounded-md bg-darkbg divide-y divide-darkborderc" data-preset-bundle-rows>
        {#each view.rows as row, i}
            <li>
                <label class="flex items-start gap-3 min-h-11 px-3 py-3 cursor-pointer break-words {ticked[i] ? 'text-textcolor' : 'text-textcolor2'}">
                    <input type="checkbox" class="shrink-0 size-5 mt-0.5 cursor-pointer" bind:checked={ticked[i]} />
                    <span class="flex flex-col min-w-0 gap-1">
                        <span class="break-words" data-row-name>{row.name}<span class="text-textcolor2" data-row-suffix>{suffixOf(i)}</span></span>
                        <span class="flex items-center gap-1 text-xs text-textcolor2 break-words">
                            <FolderIcon size={14} class="shrink-0" aria-hidden="true" />
                            <span data-row-folder>{row.folder === null ? language.presetBundleNoFolder : `${language.presetBundleFolder}: ${row.folder}`}</span>
                        </span>
                        {#if row.aiModel !== ''}
                            <span class="text-xs text-textcolor2 break-words" data-row-model>{language.model}: {row.aiModel}</span>
                        {/if}
                    </span>
                </label>
            </li>
        {/each}
    </ul>
    <div data-part="pattern-warn-actions" data-count="2">
        <button type="button" class="pattern-button" onclick={() => onanswer('cancel')}>{language.cancel}</button>
        <button type="button" class="pattern-button" data-variant="confirm" disabled={tickedCount === 0} aria-disabled={tickedCount === 0} onclick={() => {
            if (tickedCount === 0) return
            onanswer(JSON.stringify(ticked.flatMap((on, i) => on ? [i] : [])))
        }}>{language.import}</button>
    </div>
</div>
