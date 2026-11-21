<script lang="ts">
    import GridCatalog from '../../Others/GridCatalog.svelte'
    import type { LibraryStudio } from '../../Others/CharacterSimpleList.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { cancelHomeStudioOpen, homeStudioAvailable, startStudioFromHome } from './homeStudio.svelte'

    // The landing's library: the Home variant of the grid. It has no Back handler and no Realm effect: it is part
    // of the landing, and the Realm view unmounts the landing, and this with it. HomeShell moves the focus when
    // the library is revealed.

    // The Home library is the only host that offers Open in Studio. Availability is read from the slot at
    // call time, and the open is Home's own: it selects the slot and ends the visit back here. An archived
    // character is loaded first; `startStudioFromHome` handles its own failures, so the promise is dropped.
    const studio: LibraryStudio = {
        available: (index) => homeStudioAvailable(DBState.db.characters[index]),
        open: (index, opener) => {
            void startStudioFromHome(index, opener)
        },
    }

    // An open still loading an archived character ends with the library: nothing may select after it is gone.
    // A separate effect that reads nothing, so it never re-runs and its cleanup runs only on destroy.
    $effect(() => () => {
        cancelHomeStudioOpen()
    })
</script>

<div class="flex min-h-0 w-full flex-1 flex-col">
    <GridCatalog {studio} variant="home" />
</div>

<!-- The cast-sheet look of the Home variant only. Every rule descends from the root class GridCatalog sets in the
     Home variant and keys on data-part hooks, so the App host's markup and utilities are untouched; the extra
     class in each selector outranks the utilities, so no declaration needs !important. Sizes of tiles and rows
     are unchanged: the windowing engine measures them. -->
<style>
    :global(.home-library [data-part="library-views"] button) {
        background: none;
        border-color: transparent;
        border-radius: var(--home-control-radius);
        box-shadow: none;
        color: var(--nexus-text-secondary);
    }
    :global(.home-library [data-part="library-views"] button:hover) {
        background: var(--nexus-surface-raised);
        color: var(--nexus-text);
    }
    :global(.home-library [data-part="library-views"] button[aria-pressed="true"]) {
        background: var(--nexus-surface-raised);
        color: var(--nexus-text);
        font-weight: 600;
        box-shadow: inset 0 calc(-2 * var(--home-hairline)) 0 var(--home-select-bar);
    }
    :global(.home-library [data-part="library-tile"] .ico) {
        border: var(--home-hairline) solid var(--nexus-edge);
        border-radius: var(--home-radius-5);
        box-shadow: none;
    }
    :global(.home-library [data-part="library-row"]) {
        border-width: 0 0 var(--home-hairline);
        border-color: var(--nexus-edge);
        border-radius: var(--home-radius-5);
    }
</style>
