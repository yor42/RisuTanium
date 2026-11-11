<script lang="ts">
    import type { Component } from 'svelte'
    import { LayoutGridIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import MainMenu from '../MainMenu.svelte'
    import HomeEmptyHero from './HomeEmptyHero.svelte'
    import { OpenRealmStore, sideBarStore } from 'src/ts/stores.svelte'
    import HomeDrawer from './HomeDrawer.svelte'
    import HomeTopBar from './HomeTopBar.svelte'
    import { homeChrome } from './homeChrome.svelte'
    import { homeBand } from './homeLayout'
    import { homeView, openHomeLibrary, showHomeLanding, startHomeView } from './homeView.svelte'

    // Every creation starts at the landing: a selection change, the language remount and a return
    // to Home all create a fresh shell. Covers (Settings, Studio) keep it mounted, so the view
    // survives them. The one exception is the return from a Home-opened Studio visit, which starts
    // at the library.
    startHomeView()

    // Home's width band is read here and nowhere else; the chat shell keeps its own bands.
    let viewportWidth = $state(window.innerWidth)
    const band = $derived(homeBand(viewportWidth))

    // The library is a separate chunk, loaded on first open. The landing stays up until it is
    // ready, and a failed load goes back to the landing with the error shown, as Studio does.
    let LibraryScreen: Component | null = $state(null)

    // The phone landing: the landing is the branch on screen, the Realm view is closed and the
    // band is phone. Only here are the menu button and the drawer offered.
    const phoneLanding = $derived(!(homeView.view === 'library' && LibraryScreen !== null) && !$OpenRealmStore && band === 'phone')
    let drawerOpen = $state(false)
    let menuButton: HTMLElement | null = $state(null)
    const uid = $props.id()
    const drawerId = `${uid}-home-drawer`

    // Runs before the first render and on every change, so the sidebar arrow never shows for a
    // frame on the phone landing. The flag clears when the landing is left and on unmount. Arriving
    // on the phone landing closes a legacy sidebar overlay that was already open: it is not modal
    // here, and the arrow that reopens it is gone. `sideBarStore` is read only here, at that point.
    $effect.pre(() => {
        homeChrome.phoneDrawer = phoneLanding
        if (phoneLanding) {
            sideBarStore.set(false)
        }
        return () => {
            homeChrome.phoneDrawer = false
        }
    })

    // The drawer goes with the phone landing: a resize out of the band, the library and the Realm
    // view all end it, so it never comes back by itself.
    $effect(() => {
        if (!phoneLanding) {
            drawerOpen = false
        }
    })

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

<svelte:window bind:innerWidth={viewportWidth} />

{#snippet homeHeader()}
    <!-- On the phone the drawer carries the Characters entry. -->
    {#if band !== 'phone'}
        <button
            type="button"
            class="mt-2 flex items-center gap-2 rounded-md border border-borderc/10 bg-darkbg px-4 py-2 text-textcolor hover:bg-selected/50"
            onclick={openHomeLibrary}
        >
            <LayoutGridIcon size={18} />
            {language.character}
        </button>
    {/if}
    <HomeEmptyHero />
{/snippet}

{#if homeView.view === 'library' && LibraryScreen}
    <LibraryScreen />
{:else}
    <div data-part="home-landing" data-layout={band} class="relative flex h-full w-full flex-col">
        {#if !$OpenRealmStore}
            <HomeTopBar
                {band}
                bind:menuButton
                {drawerOpen}
                {drawerId}
                onmenu={() => {
                    drawerOpen = true
                }}
            />
        {/if}
        <div class="min-h-0 flex-1">
            <MainMenu header={homeHeader} />
        </div>
        {#if drawerOpen && phoneLanding}
            <HomeDrawer
                id={drawerId}
                trigger={menuButton}
                onclose={() => {
                    drawerOpen = false
                }}
            />
        {/if}
    </div>
{/if}
