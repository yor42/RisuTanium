<script lang="ts">
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import type { HomeMode } from 'src/ts/storage/homeModes'
    import { switcherEntries } from './homeSwitcher'

    // Read-only: the entries follow the stored mode fields through `shownModes` and nothing here
    // writes them. A held mode is an inert, disabled radio carrying its "coming later" tag.
    const entries = $derived(switcherEntries({
        visibleModes: DBState.db.visibleModes,
        hideUnusedModes: DBState.db.hideUnusedModes,
    }))

    const modeNames: Record<HomeMode, () => string> = {
        rp: () => language.settingsShellModesNameRp,
        hybrid: () => language.settingsShellModesNameHybrid,
        utility: () => language.settingsShellModesNameUtility,
    }
</script>

{#if entries.length > 0}
    <fieldset class="mt-2 flex flex-wrap items-center gap-2 border-0 p-0">
        <legend class="sr-only">{language.homeModeSwitcherLabel}</legend>
        {#each entries as entry (entry.mode)}
            <label
                class="flex min-h-11 items-center gap-2 rounded-md border px-4 py-2 {entry.current
                    ? 'border-selected bg-selected/30 text-textcolor'
                    : 'border-borderc/10 bg-darkbg text-textcolor2'} {entry.held ? 'opacity-60' : 'cursor-pointer hover:bg-selected/50'}"
            >
                <input
                    type="radio"
                    name="home-mode"
                    value={entry.mode}
                    checked={entry.current}
                    disabled={entry.held}
                    aria-disabled={entry.held ? 'true' : undefined}
                    class="h-4 w-4"
                />
                <span>{modeNames[entry.mode]()}</span>
                {#if entry.held}
                    <span class="text-xs text-textcolor2">{language.homeModeComingLater}</span>
                {/if}
            </label>
        {/each}
    </fieldset>
{/if}
