<script lang="ts">
    import { untrack } from 'svelte'
    import { LayoutGridIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import MainMenu from '../MainMenu.svelte'
    import HomeEmptyHero from './HomeEmptyHero.svelte'
    import HomeGreeting from './HomeGreeting.svelte'
    import HomeLibrary from './HomeLibrary.svelte'
    import '../../../styles/home-tokens.css'
    import { DBState, OpenRealmStore, sideBarStore } from 'src/ts/stores.svelte'
    import HomeDrawer from './HomeDrawer.svelte'
    import HomeStoryShelf from './HomeStoryShelf.svelte'
    import HomeTopBar from './HomeTopBar.svelte'
    import { homeChrome } from './homeChrome.svelte'
    import { hasLibraryContent } from './homeEmpties'
    import { homeBand } from './homeLayout'
    import { freezeStories, resolveFrozen } from './homeStories'
    import { engageHomeLibrary, homeView, openHomeLibrary, startHomeView } from './homeView.svelte'

    // Every creation starts at the landing: a selection change, the language remount and a return
    // to Home all create a fresh shell. Covers (Settings, Studio) keep it mounted, so the view
    // survives them. The one exception is the return from a Home-opened Studio visit, which starts
    // at the library.
    startHomeView()

    // The story shelf's order, chat labels and last lines are taken once per shell, here and not in the
    // shelf: the shelf unmounts when the Realm view opens, and a freeze there would re-sort on every
    // close. Removals, names, pictures, times and the archived state stay live through `resolveFrozen`.
    const frozenStories = untrack(() => freezeStories(DBState.db.characters ?? [], language.settingsPage.unnamed))
    const stories = $derived(resolveFrozen(frozenStories, DBState.db.characters ?? []))

    // Home's width band is read here and nowhere else; the chat shell keeps its own bands.
    let viewportWidth = $state(window.innerWidth)
    const band = $derived(homeBand(viewportWidth))

    // The library section exists while any slot would be listed, the Trash included, so the Trash stays
    // reachable. With none, the Create/Import hero is the only content and there is no library to enter.
    const libraryShown = $derived(hasLibraryContent(DBState.db.characters))

    // The phone landing: the landing is the branch on screen, the Realm view is closed and the
    // band is phone. Only here are the menu button and the drawer offered.
    const phoneLanding = $derived(homeView.view !== 'library' && !$OpenRealmStore && band === 'phone')
    let drawerOpen = $state(false)
    let menuButton: HTMLElement | null = $state(null)
    const uid = $props.id()
    const drawerId = `${uid}-home-drawer`
    const libraryHeadingId = `${uid}-home-library`

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
</script>

<svelte:window bind:innerWidth={viewportWidth} />

{#snippet homeHeader()}
    <HomeGreeting />
    <!-- On the phone the drawer carries the Characters entry. With no library content the hero is the only
         content, so there is no Characters button; the drawer keeps its entry (MC-2931). -->
    {#if band !== 'phone' && libraryShown}
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

{#snippet homeStage()}
    {#if stories.length > 0}
        <HomeStoryShelf {stories} {band} />
    {/if}
    {#if libraryShown}
        <!--
          The library is a bounded section: one scroller-height tall at most (the MainMenu scroller is a size
          container), its list scrolling inside. Any touch inside, in the capture phase so a control that stops
          propagation cannot hide it, marks the library as used this visit and so cancels a pending restore.
        -->
        <section
            data-part="home-library"
            aria-labelledby={libraryHeadingId}
            class="flex max-h-[100cqh] min-h-0 flex-col"
            onpointerdowncapture={engageHomeLibrary}
            onkeydowncapture={engageHomeLibrary}
            onfocusin={engageHomeLibrary}
        >
            <h2
                id={libraryHeadingId}
                tabindex="-1"
                data-jump-target="library"
                class="mb-[var(--home-space-8)] text-[length:var(--home-text-lg)] font-bold tracking-[var(--home-tracking-h1)]"
            >{language.homeLibraryHeading}</h2>
            <div class="flex min-h-0 flex-1 flex-col"><HomeLibrary embedded /></div>
        </section>
    {/if}
{/snippet}

{#if homeView.view === 'library'}
    <HomeLibrary />
{:else}
    <div data-part="home-landing" data-layout={band} class="home-root relative flex h-full w-full flex-col">
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
            <MainMenu header={homeHeader} stage={stories.length > 0 || libraryShown ? homeStage : undefined} />
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
