<script lang="ts">
    import type { Component } from 'svelte'
    import { LayoutGridIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import MainMenu from '../MainMenu.svelte'
    import HomeModeSwitcher from './HomeModeSwitcher.svelte'
    import { homeView, openHomeLibrary, showHomeLanding } from './homeView.svelte'

    // Every creation starts at the landing: a selection change, the language remount and a return
    // to Home all create a fresh shell. Covers (Settings, Studio) keep it mounted, so the view
    // survives them.
    showHomeLanding()

    // The library is a separate chunk, loaded on first open. The landing stays up until it is
    // ready, and a failed load goes back to the landing with the error shown, as Studio does.
    let LibraryScreen: Component | null = $state(null)

    $effect(() => {
        if (homeView.view !== 'library' || LibraryScreen !== null) {
            return
        }
        import('./HomeLibrary.svelte').then(
            (module) => {
                LibraryScreen = module.default
            },
            async (error: unknown) => {
                showHomeLanding()
                const { alertError } = await import('src/ts/alert')
                alertError(error instanceof Error ? error : String(error))
            },
        )
    })
</script>

{#snippet homeHeader()}
    <button
        type="button"
        class="mt-2 flex items-center gap-2 rounded-md border border-borderc/10 bg-darkbg px-4 py-2 text-textcolor hover:bg-selected/50"
        onclick={openHomeLibrary}
    >
        <LayoutGridIcon size={18} />
        {language.character}
    </button>
    <HomeModeSwitcher />
{/snippet}

{#if homeView.view === 'library' && LibraryScreen}
    <LibraryScreen />
{:else}
    <MainMenu header={homeHeader} />
{/if}
