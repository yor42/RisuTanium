<script lang="ts">
    import { language } from 'src/lang'
    import { pressBootButton } from 'src/ts/storage/store2/ui/bootScreen.svelte'
    import type { BootButton } from 'src/ts/storage/store2/ui/bootText'

    // The saved versions of the recovery screen. Each row only opens a confirmation, and the guard window and the single-answer
    // rule are those of `pressBootButton`, the same as every other boot button.
    let { rows, disabled }: { rows: readonly BootButton[], disabled: boolean } = $props()
</script>

{#if rows.length > 0}
    <h2 class="font-bold">{language.store2Boot.recoveryListHeading}</h2>
    <ul class="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {#each rows as row (row.key)}
            <li>
                <button
                    type="button"
                    data-boot-key={row.key}
                    class="w-full text-left px-4 py-2 rounded-md border border-darkborderc bg-darkbutton hover:bg-selected disabled:opacity-50"
                    {disabled}
                    onclick={() => pressBootButton(row.key)}
                >{row.label}</button>
            </li>
        {/each}
    </ul>
{/if}
