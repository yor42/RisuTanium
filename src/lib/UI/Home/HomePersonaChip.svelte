<script lang="ts">
    import { UserRoundIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { personaChipName } from './homeEmpties'
    import { openPersonaSettings } from './homeEmptyActions'

    // Read-only: it shows the stored username and only opens Settings at Personas. `data-part` lets
    // the Settings opener restore focus to it after a remount.
    const name = $derived(personaChipName(DBState.db.username))
</script>

<button
    type="button"
    data-part="home-persona-chip"
    class="mt-2 flex min-h-11 max-w-[calc(100%-2rem)] flex-col items-center rounded-md border border-borderc/10 bg-darkbg px-4 py-1 text-textcolor hover:bg-selected/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected"
    onclick={openPersonaSettings}
>
    <span class="flex max-w-full items-center gap-2">
        <UserRoundIcon size={16} aria-hidden="true" class="shrink-0" />
        <span class="truncate">{name === null ? language.homePersonaChipUnnamed : language.homePersonaChip(name)}</span>
    </span>
    <span class="max-w-full overflow-hidden text-ellipsis break-keep text-xs text-textcolor2">{language.homePersonaChipHint}</span>
    <span class="sr-only">{language.homePersonaChipGo}</span>
</button>
