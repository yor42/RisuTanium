<script lang="ts">
    import { tick } from 'svelte'
    import GridCatalog from '../../Others/GridCatalog.svelte'
    import type { LibraryStudio } from '../../Others/CharacterSimpleList.svelte'
    import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { cancelHomeStudioOpen, homeStudioAvailable, startStudioFromHome } from './homeStudio.svelte'
    import { homeView, showHomeLanding, takeHomeReturnFocus } from './homeView.svelte'

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

    let root: HTMLDivElement | undefined = $state()

    // The end of a Home-opened Studio visit asks for the focus to return to the character's control. The
    // opener unmounted with the library, so the library moves it: the character's control when it is drawn
    // (the Simple and List tabs, a row in view), else the library's Back button, so it never falls to the body.
    // The request is read once, on mount, and waits for the library: the library chunk may load after the visit ends.
    $effect(() => {
        const chaId = takeHomeReturnFocus()
        if (chaId === null) {
            return
        }
        let current = true
        void tick().then(() => {
            if (!current || !root) {
                return
            }
            const control = Array.from(root.querySelectorAll<HTMLElement>('[data-part="library-studio"]'))
                .find((candidate) => candidate.getAttribute('data-cha-id') === chaId)
            ;(control ?? root.querySelector<HTMLElement>('[data-part="library-back"]'))?.focus()
        })
        return () => {
            current = false
        }
    })
</script>

<div class="h-full w-full" bind:this={root}>
    <GridCatalog endGrid={() => showHomeLanding()} {studio} />
</div>
