<script lang="ts">
    import GridCatalog from '../../Others/GridCatalog.svelte'
    import { OpenRealmStore } from 'src/ts/stores.svelte'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { homeView, showHomeLanding } from './homeView.svelte'

    // Registered once for the lifetime of the library. The thunks read the view at call time, so
    // the effect reads no reactive state and never re-registers: a re-registration would move this
    // handler above the edit-mode handler GridCatalog registers while editing.
    $effect(() =>
        registerBackHandler(
            backCloseHandler({
                isOpen: () => homeView.view === 'library',
                snapshot: () => homeView.view,
                close: showHomeLanding,
            }),
        ),
    )

    // The Realm full view lives in the landing; opening it from elsewhere (the sidebar's import
    // from Realm) while the library shows would otherwise show nothing.
    $effect(() => {
        if ($OpenRealmStore) {
            showHomeLanding()
        }
    })
</script>

<div class="h-full w-full">
    <GridCatalog endGrid={() => showHomeLanding()} />
</div>
