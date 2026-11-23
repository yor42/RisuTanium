<script lang="ts">
    import { UserRoundIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { personaChipName } from './homeEmpties'
    import { openPersonaSettings } from './homeEmptyActions'

    interface Props {
        /** The phone bar's icon chip: 44 px square, the label and hint stay in the text for the accessible name. */
        compact?: boolean
    }

    let { compact = false }: Props = $props()

    // Read-only: it shows the stored username and only opens Settings at Personas. `data-part` lets
    // the Settings opener restore focus to it after a remount.
    const name = $derived(personaChipName(DBState.db.username))
</script>

<button
    type="button"
    data-part="home-persona-chip"
    class={compact
        ? 'flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-borderc/10 bg-darkbg p-0 text-textcolor hover:bg-selected/50 risu-focus-ring'
        : 'mt-2 flex min-h-11 max-w-[calc(100%-2rem)] flex-col items-center rounded-md border border-borderc/10 bg-darkbg px-4 py-1 text-textcolor hover:bg-selected/50 risu-focus-ring'}
    onclick={openPersonaSettings}
>
    <!-- The set-up label wraps (whole words, break-keep for Korean) so it is never cut at large font
         sizes; a stored name can be arbitrarily long, so the named label stays one truncated line.
         The compact chip is an icon: its label and hint stay in the text, visually hidden, so the name is unchanged. -->
    <span class="flex max-w-full items-center gap-2">
        <UserRoundIcon size={compact ? 22 : 16} aria-hidden="true" class="shrink-0" />
        {#if name === null}
            <span data-part="home-persona-chip-label" class="min-w-0 break-keep text-center" class:sr-only={compact}>{language.homePersonaChipUnnamed}</span>
        {:else}
            <span data-part="home-persona-chip-label" class="min-w-0 truncate" class:sr-only={compact}>{language.homePersonaChip(name)}</span>
        {/if}
    </span>
    <span class="max-w-full overflow-hidden text-ellipsis break-keep text-xs text-textcolor2" class:sr-only={compact}>{language.homePersonaChipHint}</span>
    <span class="sr-only">{language.homePersonaChipGo}</span>
</button>
